import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import QRCode from 'qrcode';

// Regeneration requires a current production build and ffmpeg 8 on PATH.
const root = fileURLToPath(new URL('..', import.meta.url));
const output = fileURLToPath(new URL('../docs/assets', import.meta.url));
const port = 3101;
const baseURL = `http://127.0.0.1:${port}`;
const captureCode = 'TABLE';
const walkthroughViewport = { width: 1280, height: 720 };
const chapters = [
  ['01', 'LANDING'],
  ['02', 'CREATE'],
  ['03', 'INVITE'],
  ['04', 'PRIVATE BALLOT'],
  ['05', 'READY'],
  ['06', 'REVEAL'],
  ['07', 'RESULT'],
];

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}\n${stderr.trim()}`));
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
    } catch {
      // The built server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the screenshot server');
}

async function submitBallot(page, cuisine) {
  const neutralChoice = page.getByRole('button', { name: new RegExp(`^${cuisine}: neutral`) });
  if (await neutralChoice.count()) await neutralChoice.click();
  for (let step = 0; step < 4; step++) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Lock in my vote' }).click();
  await page.waitForURL(/\/lobby$/);
}

async function settleVisuals(page, delay = 400) {
  await page.waitForTimeout(delay);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: `
      main [style*="opacity"] { opacity: 1 !important; }
      [data-sonner-toaster], canvas { display: none !important; }
      *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        transition: none !important;
      }
    `,
  });
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      const endTime = animation.effect?.getComputedTiming().endTime;
      if (typeof endTime === 'number' && Number.isFinite(endTime)) animation.finish();
      else animation.cancel();
    }
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function captureChapter(page, frames, index) {
  const [number, label] = chapters[index];
  await page.evaluate(() => window.scrollTo(0, 0));
  await settleVisuals(page, 0);
  await page.evaluate(
    ({ number, label }) => {
      document.querySelector('[data-walkthrough-chapter]')?.remove();
      const chapter = document.createElement('div');
      chapter.dataset.walkthroughChapter = '';
      chapter.setAttribute('aria-hidden', 'true');
      chapter.innerHTML = `<strong>${number}</strong><span>${label}</span>`;
      chapter.style.cssText = [
        'position:fixed',
        'left:24px',
        'bottom:24px',
        'z-index:2147483647',
        'display:flex',
        'align-items:center',
        'border:3px solid #241329',
        'background:#FCFDF8',
        'color:#241329',
        'box-shadow:5px 5px 0 #2457FF',
        'font-family:"IBM Plex Mono",monospace',
        'font-size:14px',
        'font-weight:600',
        'letter-spacing:.1em',
        'line-height:1',
      ].join(';');
      const strong = chapter.querySelector('strong');
      const span = chapter.querySelector('span');
      strong.style.cssText = 'display:block;background:#C7F43D;padding:13px 14px;border-right:3px solid #241329';
      span.style.cssText = 'display:block;padding:13px 16px';
      document.body.append(chapter);
    },
    { number, label },
  );
  await page.screenshot({ path: frames[index] });
  await page.evaluate(() => document.querySelector('[data-walkthrough-chapter]')?.remove());
}

async function createWalkthrough(frames, destination) {
  const holdSeconds = 1.25;
  const fadeSeconds = 0.25;
  const filter = frames.map(
    (_, index) =>
      `[${index}:v]scale=960:540:flags=lanczos,setsar=1,fps=10,format=rgba,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`,
  );
  let previous = 'v0';
  for (let index = 1; index < frames.length; index++) {
    const next = `x${index}`;
    filter.push(
      `[${previous}][v${index}]xfade=transition=fade:duration=${fadeSeconds}:offset=${(holdSeconds * index).toFixed(2)}[${next}]`,
    );
    previous = next;
  }
  filter.push(
    `[${previous}]split[walkthrough-a][walkthrough-b]`,
    '[walkthrough-a]palettegen=max_colors=96:stats_mode=diff[palette]',
    '[walkthrough-b][palette]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[out]',
  );

  const inputArgs = frames.flatMap((frame) => ['-loop', '1', '-t', String(holdSeconds + fadeSeconds), '-i', frame]);
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...inputArgs,
    '-filter_complex_threads',
    '1',
    '-filter_complex',
    filter.join(';'),
    '-map',
    '[out]',
    '-loop',
    '0',
    destination,
  ]);
}

await access(path.join(root, 'dist-server', 'index.js')).catch(() => {
  throw new Error('Built server not found. Run `npm run build` before this capture script.');
});
await access(path.join(root, 'dist', 'index.html')).catch(() => {
  throw new Error('Built client not found. Run `npm run build` before this capture script.');
});
await run('ffmpeg', ['-version']).catch((error) => {
  throw new Error(`ffmpeg 8 must be available on PATH. ${error.message}`);
});
await mkdir(output, { recursive: true });

const temporary = await mkdtemp(path.join(tmpdir(), 'tablevote-capture-'));
const frames = chapters.map(([number]) => path.join(temporary, `${number}.png`));
const server = spawn(process.execPath, ['dist-server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: 'ignore',
});

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();

  const landingContext = await browser.newContext({ viewport: walkthroughViewport, reducedMotion: 'reduce' });
  const landing = await landingContext.newPage();
  await landing.goto(baseURL);
  await landing.getByRole('heading', { name: 'Stop debating where to eat.' }).waitFor();
  await settleVisuals(landing);
  await captureChapter(landing, frames, 0);
  await landing.screenshot({
    path: path.join(output, 'social-preview.png'),
    clip: { x: 0, y: 0, width: 1280, height: 640 },
  });
  const landingHero = await landing.locator('[data-capture="landing"]').boundingBox();
  if (!landingHero) throw new Error('Landing capture region was missing');
  await landing.screenshot({
    path: path.join(output, 'landing.png'),
    clip: { x: 0, y: 0, width: 1280, height: Math.ceil(landingHero.y + landingHero.height) },
  });
  await landingContext.close();

  const hostContext = await browser.newContext({ viewport: walkthroughViewport, reducedMotion: 'reduce' });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto(`${baseURL}/#/create`);
  await host.getByLabel('Session area label').fill('Friday dinner');
  await host.getByRole('button', { name: 'More options' }).click();
  await host.getByLabel('Your nickname (host)').fill('Alex');
  await host.getByLabel('Include my nickname in the invitation').click();
  await host.getByRole('button', { name: 'More options' }).click();
  await settleVisuals(host);
  await captureChapter(host, frames, 1);
  await host.getByRole('button', { name: 'Create session' }).click();
  await host.waitForURL(/#\/s\/[A-Z2-9]{5}\/host$/);
  const code = host.url().match(/#\/s\/([A-Z2-9]{5})\/host$/)?.[1];
  if (!code) throw new Error('Session code was missing from the host URL');

  await host.getByRole('img', { name: 'Session QR code' }).waitFor();
  await settleVisuals(host);
  const captureQr = await QRCode.toDataURL(`http://tablevote.local/#/join/${captureCode}`, {
    margin: 1,
    width: 400,
    color: { dark: '#241329', light: '#FCFDF8' },
  });
  await host.getByRole('img', { name: 'Session QR code' }).evaluate((image, source) => {
    image.src = source;
  }, captureQr);
  await host.getByRole('img', { name: 'Session QR code' }).evaluate((image) => image.decode());
  await host.getByRole('group', { name: /^Session code / }).evaluate((group, stableCode) => {
    group.setAttribute('aria-label', `Session code ${stableCode.split('').join(' ')}`);
    [...group.querySelectorAll('span')].forEach((tile, index) => {
      tile.textContent = stableCode[index];
    });
  }, captureCode);
  await captureChapter(host, frames, 2);

  await guest.goto(`${baseURL}/#/join/${code}`);
  await guest.getByLabel('What should we call you?').fill('Jordan');
  await guest.getByRole('button', { name: 'Join the table' }).click();
  await guest.waitForURL(/\/preferences$/);

  await host.getByRole('button', { name: 'Vote too' }).click();
  await host.getByRole('heading', { name: 'What sounds good?' }).waitFor();
  await host.getByRole('button', { name: /^Japanese: neutral/ }).click();
  await settleVisuals(host);
  await captureChapter(host, frames, 3);
  await host.setViewportSize({ width: 390, height: 844 });
  await settleVisuals(host);
  await host.screenshot({ path: path.join(output, 'ballot.png') });
  await host.setViewportSize(walkthroughViewport);

  await Promise.all([submitBallot(host, 'Japanese'), submitBallot(guest, 'Lebanese')]);
  await host.getByText('2 of 2 voted').waitFor();
  await settleVisuals(host);
  await captureChapter(host, frames, 4);

  await host.getByRole('button', { name: 'Start the reveal' }).click();
  await host.getByRole('button', { name: 'See full results' }).waitFor();
  await settleVisuals(host);
  await captureChapter(host, frames, 5);
  await host.getByRole('button', { name: 'See full results' }).click();
  await host.getByRole('heading', { name: 'Your private fit' }).waitFor();
  await settleVisuals(host);
  await captureChapter(host, frames, 6);

  await host.setViewportSize({ width: 1280, height: 900 });
  await settleVisuals(host);
  await host.evaluate(() => window.scrollTo(0, 0));
  await host.screenshot({ path: path.join(output, 'result.png') });

  await createWalkthrough(frames, path.join(output, 'walkthrough.gif'));
  await hostContext.close();
  await guestContext.close();
} finally {
  await browser?.close();
  server.kill();
  await rm(temporary, { recursive: true, force: true });
}
