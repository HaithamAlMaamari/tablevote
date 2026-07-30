import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

const PROHIBITED_PRIVATE_FIELDS =
  /"(?:prefs|token|hostToken|perPerson|scoringSheet|meanUtility|minUtility|cuisineScore|priceScore|distanceScore|explanation)"/;
const RESPONSIVE_WIDTHS = [320, 360, 390, 480, 1280] as const;
const TEXT_SPACING_CSS = `
  * {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p { margin-block-end: 2em !important; }
`;

function collectReceivedFrames(page: Page) {
  const frames: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      const frame = payload.toString();
      // Socket.IO type 2 packets are pushed events; type 3 ACKs may carry the
      // requesting participant's credentials and are not broadcast state.
      if (frame.startsWith('42')) frames.push(frame);
    });
  });
  return frames;
}

function collectBrowserSignals(page: Page) {
  const requests: { method: string; url: string }[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));
  page.on('console', (message) => {
    const text = message.text();
    const blockedDependencyProbe =
      text.includes('Content-Security-Policy') &&
      text.includes('blocked a JavaScript eval') &&
      text.includes("script-src 'self'") &&
      text.includes('/assets/session-state-');
    if (message.type() === 'error' && !blockedDependencyProbe) errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return { requests, errors };
}

function isAllowedBackgroundRequest(request: { method: string; url: string }, expectedOrigin: string) {
  const url = new URL(request.url);
  if (url.protocol === 'blob:') return request.method === 'GET' && url.origin === expectedOrigin;
  if (url.origin !== expectedOrigin) return false;
  if (request.method === 'GET' && (url.pathname === '/' || /^\/assets\/[\w.-]+\.(?:js|css|svg)$/.test(url.pathname)))
    return true;
  if (url.pathname === '/socket.io/' && ['GET', 'POST'].includes(request.method)) {
    return [...url.searchParams.keys()].every((key) => ['EIO', 'transport', 'sid', 't'].includes(key));
  }
  if (request.method === 'GET' && /^\/api\/sessions\/[^/]+(?:\/state)?$/.test(url.pathname)) return url.search === '';
  if (request.method !== 'POST' || url.search !== '') return false;
  return (
    url.pathname === '/api/sessions' ||
    url.pathname === '/api/sessions/join' ||
    /^\/api\/sessions\/[^/]+\/(?:submit|leave|reveal|rerun|end)$/.test(url.pathname) ||
    /^\/api\/sessions\/[^/]+\/participants\/[^/]+\/remove$/.test(url.pathname)
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth,
    ),
  ).toBe(true);
}

async function expectControlContentFits(locator: Locator, viewportWidth: number) {
  const metrics = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const html = element as HTMLElement;
    return {
      bottom: box.bottom,
      clientHeight: html.clientHeight,
      clientWidth: html.clientWidth,
      left: box.left,
      right: box.right,
      scrollHeight: html.scrollHeight,
      scrollWidth: html.scrollWidth,
      top: box.top,
    };
  });
  expect(metrics.left).toBeGreaterThanOrEqual(-1);
  expect(metrics.right).toBeLessThanOrEqual(viewportWidth + 1);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
}

async function sessionStorageReference(page: Page, code: string) {
  return page.evaluate((sessionCode) => localStorage.getItem(`tablevote:idref:${sessionCode}`), code);
}

async function expectSessionStorageCleared(page: Page, references: string[]) {
  const leftovers = await page.evaluate(
    (targets) =>
      Object.entries(localStorage).filter(([key, value]) =>
        targets.some((target) => key.includes(target) || value.includes(target)),
      ),
    references,
  );
  expect(leftovers).toEqual([]);
}

async function waitForLayout(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function waitForFiniteAnimations(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((animation) => {
            const endTime = animation.effect?.getComputedTiming().endTime;
            return animation.playState === 'running' && typeof endTime === 'number' && Number.isFinite(endTime);
          }).length,
      ),
    )
    .toBe(0);
}

async function setViewportAndWait(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
  await waitForLayout(page);
}

async function closeContexts(...contexts: BrowserContext[]) {
  await Promise.all(contexts.map((context) => context.close({ reason: 'TableVote test cleanup' })));
}

async function expectAccessible(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await waitForLayout(page);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForLayout(page);
  await waitForFiniteAnimations(page);
  // Scan final content colors, not translucent entry-animation frames.
  await page.addStyleTag({ content: 'main [style*="opacity"] { opacity: 1 !important; }' });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations,
    results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help}\n${violation.nodes.map((node) => node.target.join(' ')).join('\n')}`,
      )
      .join('\n\n'),
  ).toEqual([]);
}

async function createSession(page: Page, publicHostNickname?: string) {
  await page.goto('/#/create');
  await page.getByLabel('Session area label').fill('Demo District A');
  if (publicHostNickname) {
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByLabel('Your nickname (host)').fill(publicHostNickname);
    await page.getByLabel('Include my nickname in the invitation').click();
  }
  await page.getByRole('button', { name: 'Create session' }).click();
  await expect(page).toHaveURL(/#\/s\/[A-Z2-9]{5}\/host$/);
  const code = page.url().match(/#\/s\/([A-Z2-9]{5})\/host$/)?.[1];
  if (!code) throw new Error('Session code was missing from the host URL');
  return code;
}

async function joinSession(page: Page, code: string, nickname: string, expectedInviteHeading?: string) {
  await page.goto(`/#/join/${code}`);
  if (expectedInviteHeading) {
    await expect(page.getByRole('heading', { name: expectedInviteHeading })).toBeVisible();
  }
  await page.getByLabel('What should we call you?').fill(nickname);
  await page.getByRole('button', { name: 'Join the table' }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/s\\/${code}\\/preferences$`));
}

async function submitBallot(page: Page, cuisine: string, strictAll = false) {
  await page.getByRole('button', { name: new RegExp(`^${cuisine}: neutral`) }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'How much per person?' })).toBeFocused();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'How far will you go?' })).toBeFocused();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: "Anything you can't eat?" })).toBeFocused();
  if (strictAll) {
    for (const requirement of ['Vegetarian', 'Vegan', 'Halal', 'Kosher', 'Gluten-free']) {
      await page.getByRole('button', { name: requirement, exact: true }).click();
      await expect(page.getByRole('button', { name: `${requirement} Required`, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
    await expect(page.getByRole('switch')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Look right?' })).toBeFocused();
  await page.getByRole('button', { name: 'Lock in my vote' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
}

async function newReducedMotionPage(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport });
  return { context, page: await context.newPage() };
}

test('route focus, disclosure behavior, and public screens are accessible', async ({ page }) => {
  test.setTimeout(90_000);
  const startupErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') startupErrors.push(message.text());
  });
  page.on('pageerror', (error) => startupErrors.push(error.message));
  page.on('requestfailed', (request) =>
    startupErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`),
  );
  await page.goto('/');
  await expect(page).toHaveTitle('TableVote');
  await expect(page.getByRole('heading', { name: 'Stop debating where to eat.' })).toBeFocused();
  const logoMark = page.locator('header img[alt=""]').first();
  await expect(logoMark).toBeVisible();
  expect(await logoMark.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([
    60, 50,
  ]);
  expect(await page.locator('link[rel="icon"]').evaluate((link: HTMLLinkElement) => link.href)).toBe(
    await logoMark.evaluate((image: HTMLImageElement) => image.currentSrc),
  );
  expect(startupErrors).toEqual([]);
  const howItWorks = page.getByRole('button', { name: 'How does it work?' });
  await howItWorks.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'How TableVote works' })).toBeFocused();
  expect(page.url()).not.toContain('#how');
  await expectAccessible(page);

  await page.goto('/#/create');
  await expect(page).toHaveTitle('Create a session | TableVote');
  await expect(page.getByRole('heading', { name: 'Where are we eating?' })).toBeFocused();
  const disclosure = page.getByRole('button', { name: 'More options' });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Your nickname (host)')).toHaveCount(0);
  await disclosure.focus();
  await expect(disclosure).toBeFocused();
  await page.keyboard.press('Space');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Your nickname (host)')).toBeVisible();
  await expect(page.getByLabel('Include my nickname in the invitation')).toBeDisabled();
  await page.getByLabel('Your nickname (host)').fill('First name');
  await page.getByLabel('Include my nickname in the invitation').click();
  await expect(page.getByLabel('Include my nickname in the invitation')).toBeChecked();
  await page.getByLabel('Your nickname (host)').fill('');
  await page.getByLabel('Your nickname (host)').fill('Second name');
  await expect(page.getByLabel('Include my nickname in the invitation')).not.toBeChecked();
  await expectAccessible(page);

  await page.goto('/#/join');
  await expect(page).toHaveTitle('Join a session | TableVote');
  await expect(page.getByLabel('Code character 1')).toBeFocused();
  await expectAccessible(page);
});

test('public entry screens reflow with WCAG text spacing at 320px', async ({ page }) => {
  test.setTimeout(60_000);
  const viewportWidth = 320;
  await page.setViewportSize({ width: viewportWidth, height: 844 });

  await page.goto('/');
  await page.addStyleTag({ content: TEXT_SPACING_CSS });
  expect(
    await page
      .getByRole('heading', { level: 1 })
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).letterSpacing)),
  ).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(page);
  await expectControlContentFits(page.getByRole('button', { name: 'Create a table' }).first(), viewportWidth);
  await expectControlContentFits(page.getByRole('button', { name: 'Join with code' }), viewportWidth);

  await page.goto('/#/create');
  await page.addStyleTag({ content: TEXT_SPACING_CSS });
  await page.getByLabel('Session area label').fill('Demo District A');
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByLabel('Your nickname (host)').fill('Sam');
  await expectNoHorizontalOverflow(page);
  await expectControlContentFits(page.getByRole('button', { name: /10 min walk/ }), viewportWidth);
  await expectControlContentFits(page.getByRole('button', { name: /20 min drive/ }), viewportWidth);
  await expectControlContentFits(page.getByRole('button', { name: 'Create session' }), viewportWidth);

  await page.goto('/#/join');
  await page.addStyleTag({ content: TEXT_SPACING_CSS });
  await expectNoHorizontalOverflow(page);
  await expectControlContentFits(page.getByRole('button', { name: 'Join the table' }), viewportWidth);
});

test('forced colors preserve control boundaries, state, and focus', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/#/create');
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);

  const selectedRadius = page.getByRole('button', { name: /10 min walk/ });
  const nextRadius = page.getByRole('button', { name: /15 min ride/ });
  await expect(selectedRadius).toHaveAttribute('aria-pressed', 'true');
  await nextRadius.click();
  await expect(nextRadius).toHaveAttribute('aria-pressed', 'true');
  expect(
    await nextRadius.evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth)),
  ).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByLabel('Your nickname (host)').fill('Sam');
  const shareSwitch = page.getByRole('switch', { name: 'Include my nickname in the invitation' });
  const thumb = shareSwitch.locator('span');
  const before = await thumb.boundingBox();
  await shareSwitch.click();
  await expect(shareSwitch).toBeChecked();
  expect(before).not.toBeNull();
  await expect.poll(async () => (await thumb.boundingBox())?.x ?? 0).toBeGreaterThan(before!.x);

  await page.getByLabel('Session area label').fill('Demo District A');
  const create = page.getByRole('button', { name: 'Create session' });
  await create.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(create).toBeFocused();
  expect(await create.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  const createStyle = await create.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderWidth: Number.parseFloat(style.borderTopWidth),
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(createStyle.borderWidth).toBeGreaterThan(0);
  expect(createStyle.outlineWidth).toBeGreaterThan(0);
});

test('every session route uses the authoritative typed missing state', async ({ page }) => {
  for (const route of ['host', 'preferences', 'lobby', 'reveal', 'result']) {
    await page.goto(`/#/s/ZZZZZ/${route}`);
    await expect(page.getByRole('heading', { name: "We couldn't find this table" })).toBeFocused();
  }
  await expectAccessible(page);
});

test('typed session errors recover through keyboard retry', async ({ page }) => {
  let lookups = 0;
  await page.route('**/api/sessions/ABCDE', async (route) => {
    lookups += 1;
    await route.fulfill(
      lookups === 1
        ? {
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Server unavailable', errorCode: 'unavailable' }),
          }
        : {
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              invite: {
                code: 'ABCDE',
                areaLabel: 'Retry District',
                expiresAt: Date.now() + 60_000,
                joinable: true,
              },
            }),
          },
    );
  });

  await page.goto('/#/s/ABCDE/host');
  await expect(page.getByRole('heading', { name: 'TableVote is unavailable' })).toBeFocused();
  const retry = page.getByRole('button', { name: 'Try again' });
  await retry.focus();
  await page.keyboard.press('Enter');

  await expect.poll(() => lookups).toBe(2);
  await expect(page.getByRole('heading', { name: 'Session access required' })).toBeFocused();
});

test('separate host and guest contexts complete a private responsive result', async ({ browser, page: host }) => {
  test.setTimeout(120_000);
  await host.emulateMedia({ reducedMotion: 'no-preference' });
  const { context: guestContext, page: guest } = await newReducedMotionPage(browser, { width: 320, height: 720 });
  const hostFrames = collectReceivedFrames(host);
  const guestFrames = collectReceivedFrames(guest);
  const hostSignals = collectBrowserSignals(host);
  const guestSignals = collectBrowserSignals(guest);
  try {
    const code = await createSession(host, 'Browser Host');
    const publicInvite = await host.evaluate(
      async (sessionCode) => (await fetch(`/api/sessions/${sessionCode}`)).json(),
      code,
    );
    expect(publicInvite.invite.hostNickname).toBe('Browser Host');
    expect(JSON.stringify(publicInvite)).not.toMatch(/participant|token|prefs/i);
    await joinSession(
      guest,
      code,
      'Browser Guest',
      'Browser Host is choosing where the group should eat for Demo District A.',
    );
    await expect(host.getByText('Browser Guest', { exact: true })).toBeVisible();

    await host.getByRole('button', { name: 'Vote too' }).click();
    await expect(host).toHaveURL(/\/preferences$/);
    await Promise.all([submitBallot(host, 'Japanese'), submitBallot(guest, 'Lebanese')]);

    await expect(host.getByRole('button', { name: 'Invite more people' })).toBeVisible();

    await host.getByRole('button', { name: 'Edit my vote' }).click();
    await expect(host.getByRole('button', { name: /^Japanese: like/ })).toBeVisible();
    for (const heading of ['How much per person?', 'How far will you go?', "Anything you can't eat?", 'Look right?']) {
      await host.getByRole('button', { name: 'Next' }).click();
      await expect(host.getByRole('heading', { name: heading })).toBeFocused();
    }
    await host.getByRole('button', { name: 'Update my vote' }).click();
    await expect(host).toHaveURL(/\/lobby$/);

    const reveal = host.getByRole('button', { name: 'Start the reveal' });
    await expect(reveal).toBeEnabled();
    await reveal.click();
    await expect(host).toHaveURL(/\/reveal$/);
    await expect(guest).toHaveURL(/\/reveal$/);
    await expect(guest.getByRole('button', { name: 'See full results' })).toBeVisible();
    await expect(host.getByRole('button', { name: 'Skip' })).toBeVisible();
    await expect(host.getByRole('button', { name: 'See full results' })).toBeVisible();
    for (const width of RESPONSIVE_WIDTHS) {
      await setViewportAndWait(guest, width, width < 500 ? 844 : 800);
      await expectNoHorizontalOverflow(guest);
      const boxes = await guest.getByTestId('reveal-finalist').evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right };
        }),
      );
      expect(boxes).toHaveLength(3);
      for (const box of boxes) {
        expect(box.left, `${width}px: ${JSON.stringify(boxes)}`).toBeGreaterThanOrEqual(-0.5);
        expect(box.right, `${width}px: ${JSON.stringify(boxes)}`).toBeLessThanOrEqual(width + 0.5);
      }
    }

    await Promise.all([
      host.getByRole('button', { name: 'See full results' }).click(),
      guest.getByRole('button', { name: 'See full results' }).click(),
    ]);
    await expect(host).toHaveURL(/\/result$/);
    await expect(guest).toHaveURL(/\/result$/);
    await expect(host.getByRole('heading', { name: 'Your private fit' })).toBeVisible({ timeout: 20_000 });
    await expect(guest.getByRole('heading', { name: 'Your private fit' })).toBeVisible({ timeout: 20_000 });
    const hostWinnerHeading = host.locator('h1[tabindex="-1"]');
    const guestWinnerHeading = guest.locator('h1[tabindex="-1"]');
    await expect(hostWinnerHeading).toBeVisible();
    await expect(guestWinnerHeading).toBeVisible();
    const hostWinner = await hostWinnerHeading.innerText();
    await expect(guestWinnerHeading).toHaveText(hostWinner);
    await expect(host.getByText('Ranking tv-rank-1.0.0')).toHaveCount(0);
    await expect(
      host.getByText(/Each private fit combines cuisine 35, price 25, distance 20, and rating 20 points/),
    ).toBeVisible();
    await expect(
      host.getByText(/group-fit index combines average fit 70, least-satisfied fit 20, and normalized rank points 10/),
    ).toBeVisible();
    await expect(host.getByText('Browser Guest', { exact: true })).toHaveCount(0);

    const privateState = await host.evaluate(async (sessionCode) => {
      const identity = JSON.parse(localStorage.getItem(`tablevote:me:${sessionCode}`) ?? '{}') as { token?: string };
      const response = await fetch(`/api/sessions/${sessionCode}/state`, {
        headers: { Authorization: `Bearer ${identity.token ?? ''}` },
      });
      return response.json();
    }, code);
    expect(JSON.stringify(privateState)).not.toMatch(PROHIBITED_PRIVATE_FIELDS);
    const refreshedPublicInvite = await host.evaluate(
      async (sessionCode) => (await fetch(`/api/sessions/${sessionCode}`)).json(),
      code,
    );
    expect(Object.keys(refreshedPublicInvite)).toEqual(['invite']);
    expect(JSON.stringify(refreshedPublicInvite)).not.toMatch(/participants|result|selfParticipantId/);

    for (const width of RESPONSIVE_WIDTHS) {
      await setViewportAndWait(guest, width, width < 500 ? 844 : 800);
      await expectNoHorizontalOverflow(guest);
      await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
    }
    await setViewportAndWait(guest, 320, 720);
    for (const signals of [hostSignals, guestSignals]) {
      expect(signals.errors).toEqual([]);
      signals.errors.length = 0;
    }
    await expectAccessible(guest);

    const firstWinner = hostWinner;
    const rerunTrigger = host.getByRole('button', { name: "Can't make it? Re-run" });
    await rerunTrigger.focus();
    await host.keyboard.press('Enter');
    await expect(host.getByRole('alertdialog')).toBeVisible();
    await host.keyboard.press('Escape');
    await expect(rerunTrigger).toBeFocused();
    await host.keyboard.press('Enter');
    const rerunAlert = host.getByRole('alertdialog');
    const keepResult = rerunAlert.getByRole('button', { name: 'Keep it' });
    await expect(keepResult).toBeFocused();
    await host.keyboard.press('Tab');
    const confirmRerun = rerunAlert.getByRole('button', { name: 'Re-run', exact: true });
    await expect(confirmRerun).toBeFocused();
    await host.keyboard.press('Enter');
    await expect(host.getByRole('heading', { level: 1 })).not.toHaveText(firstWinner);
    await expect(host.getByRole('heading', { level: 1 })).toBeFocused();
    const secondWinner = await host.getByRole('heading', { level: 1 }).innerText();
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(secondWinner);
    await expect(host.getByText(/Round 2/)).toBeVisible();
    expect(hostFrames.join('\n')).not.toMatch(PROHIBITED_PRIVATE_FIELDS);
    expect(guestFrames.join('\n')).not.toMatch(PROHIBITED_PRIVATE_FIELDS);
    expect(hostFrames.join('\n')).toMatch(/"phase":"locking"/);
    const expectedOrigin = new URL(host.url()).origin;
    for (const signals of [hostSignals, guestSignals]) {
      expect(signals.errors).toEqual([]);
      for (const request of signals.requests) {
        expect(isAllowedBackgroundRequest(request, expectedOrigin), `${request.method} ${request.url}`).toBe(true);
      }
    }
  } finally {
    await guestContext.close();
  }
});

test('create and join outages stay explicit without local fallback or stuck loading', async ({ context, page }) => {
  await page.goto('/#/create');
  await page.getByLabel('Session area label').fill('Demo District A');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Create session' }).click();
  await expect(page.getByText('Could not create the session — try again.')).toBeVisible();
  await expect(page.getByRole('alert').getByText('TableVote is unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create session' })).toBeEnabled();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);

  await context.setOffline(false);
  await page.goto('/#/join/ABCDE');
  await page.getByLabel('What should we call you?').fill('Offline Guest');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Join the table' }).click();
  await expect(page.getByRole('alert').getByText('TableVote is unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join the table' })).toBeEnabled();
  await expect(page.getByLabel('What should we call you?')).toHaveValue('Offline Guest');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await context.setOffline(false);
});

test('offline participant reattaches before returning to live state', async ({ browser, page: host }) => {
  test.setTimeout(60_000);
  const reconnecting = await newReducedMotionPage(browser);
  const newcomer = await newReducedMotionPage(browser);
  try {
    const code = await createSession(host);
    await joinSession(reconnecting.page, code, 'Reconnect Guest');
    await reconnecting.page.goto(`/#/s/${code}/lobby`);
    await expect(reconnecting.page.getByText('2 online')).toBeVisible();

    await reconnecting.context.setOffline(true);
    await expect(reconnecting.page.getByText('Reconnecting…')).toBeVisible();
    await expect(host.getByText(', offline', { exact: true })).toBeAttached();
    await joinSession(newcomer.page, code, 'Offline Joiner');
    await expect(host.getByText('Offline Joiner', { exact: true })).toBeVisible();

    await reconnecting.context.setOffline(false);
    await expect(reconnecting.page.getByText('3 online')).toBeVisible({ timeout: 15_000 });
    await expect(reconnecting.page.getByText('Offline Joiner', { exact: true })).toBeVisible();
    await expect(reconnecting.page.getByText('Offline Joiner', { exact: true })).toHaveCount(1);
  } finally {
    await closeContexts(reconnecting.context, newcomer.context);
  }
});

test('exact browser expiry clears identities, references, and ballot drafts', async ({ page }) => {
  const code = await createSession(page);
  const sessionId = await sessionStorageReference(page, code);
  expect(sessionId).toBeTruthy();
  await page.getByRole('button', { name: 'Vote too' }).click();
  await page.getByRole('button', { name: /^Japanese: neutral/ }).click();
  await expect
    .poll(() => page.evaluate((sessionCode) => localStorage.getItem(`tablevote:prefs:${sessionCode}`), code))
    .not.toBeNull();
  const expiresAt = await page.evaluate((sessionCode) => {
    const identity = JSON.parse(localStorage.getItem(`tablevote:me:${sessionCode}`) ?? '{}') as { expiresAt?: number };
    return identity.expiresAt;
  }, code);
  expect(expiresAt).toBeTruthy();

  await page.context().addInitScript((deadline) => {
    Date.now = () => deadline;
  }, expiresAt!);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'This table expired' })).toBeFocused();
  await expect(page.getByText('reached its 24-hour limit')).toBeVisible();
  await expectSessionStorageCleared(page, [code, sessionId!]);
});

test('rerun never relaxes strict requirements when no verified candidate remains', async ({ browser, page: host }) => {
  test.setTimeout(60_000);
  const guest = await newReducedMotionPage(browser);
  try {
    const code = await createSession(host);
    await joinSession(guest.page, code, 'Strict Guest');
    await host.getByRole('button', { name: 'Vote too' }).click();
    await Promise.all([submitBallot(host, 'Japanese', true), submitBallot(guest.page, 'Lebanese', true)]);

    await host.getByRole('button', { name: 'Start the reveal' }).click();
    await expect(host.getByRole('button', { name: 'See full results' })).toBeVisible();
    await host.getByRole('button', { name: 'See full results' }).click();
    await expect(host.getByRole('heading', { level: 1 })).toHaveText('Demo Italian Table 01');
    await host.getByRole('button', { name: "Can't make it? Re-run" }).click();
    await host.getByRole('alertdialog').getByRole('button', { name: 'Re-run', exact: true }).click();

    await expect(host.getByRole('heading', { name: 'No demo match' })).toBeVisible();
    await expect(guest.page).toHaveURL(/\/result$/);
    await expect(guest.page.getByRole('heading', { name: 'No demo match' })).toBeVisible();
    await expect(host.getByText('No requirement was relaxed.')).toBeVisible();
    await expectAccessible(host);
  } finally {
    await closeContexts(guest.context);
  }
});

test('host removal and session ending reach only the correct terminal clients', async ({ browser, page: host }) => {
  test.setTimeout(90_000);
  const removed = await newReducedMotionPage(browser);
  const ended = await newReducedMotionPage(browser);
  try {
    const code = await createSession(host);
    await joinSession(removed.page, code, 'Removed Guest');
    const removedSessionId = await sessionStorageReference(removed.page, code);
    await expect(host.getByText('Removed Guest', { exact: true })).toBeVisible();

    const removeButton = host.getByRole('button', { name: 'Remove Removed Guest' });
    await removeButton.focus();
    const dismissal = new Promise<void>((resolve, reject) => {
      host.once('dialog', async (dialog) => {
        try {
          expect(dialog.type()).toBe('confirm');
          expect(dialog.message()).toBe('Remove Removed Guest from this table?');
          await dialog.dismiss();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    await host.keyboard.press('Enter');
    await dismissal;
    await expect(removeButton).toBeFocused();

    const acceptance = new Promise<void>((resolve, reject) => {
      host.once('dialog', async (dialog) => {
        try {
          await dialog.accept();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    await host.keyboard.press('Enter');
    await acceptance;
    await expect(host.getByRole('heading', { name: "Who's in" })).toBeFocused();
    await expect(removed.page.getByRole('heading', { name: 'You left this table' })).toBeFocused();
    await expectSessionStorageCleared(removed.page, [code, removedSessionId!]);
    await expect(host.getByRole('heading', { name: 'Get everyone in' })).toBeVisible();

    await joinSession(ended.page, code, 'Ended Guest');
    const endedSessionId = await sessionStorageReference(ended.page, code);
    await expect(host.getByText('Ended Guest', { exact: true })).toBeVisible();
    await ended.context.setOffline(true);
    const endTrigger = host.getByRole('button', { name: 'End session' });
    await endTrigger.focus();
    await host.keyboard.press('Enter');
    const alert = host.getByRole('alertdialog');
    await expect(alert.getByRole('heading', { name: 'End this session?' })).toBeVisible();
    const keepSession = alert.getByRole('button', { name: 'Keep it' });
    await expect(keepSession).toBeFocused();
    await host.keyboard.press('Escape');
    await expect(endTrigger).toBeFocused();
    await host.keyboard.press('Enter');
    await expect(keepSession).toBeFocused();
    await host.keyboard.press('Tab');
    const confirmEnd = alert.getByRole('button', { name: 'End session' });
    await expect(confirmEnd).toBeFocused();
    await host.keyboard.press('Enter');

    await expect(host).toHaveURL(/\/#\/$/);
    await expect(host.getByRole('heading', { name: 'Stop debating where to eat.' })).toBeFocused();
    await ended.context.setOffline(false);
    await expect(ended.page.getByRole('heading', { name: 'This table is closed' })).toBeVisible();
    await expect(ended.page.getByRole('heading', { name: 'This table is closed' })).toBeFocused();
    await expectSessionStorageCleared(ended.page, [code, endedSessionId!]);
    await expectAccessible(ended.page);
  } finally {
    await closeContexts(removed.context, ended.context);
  }
});
