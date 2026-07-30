const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const blockingSeverities = new Set(['high', 'critical']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid npm audit report: ${message}`);
}

function assertString(value, path) {
  assert(typeof value === 'string' && value.length > 0, `${path} must be a non-empty string`);
}

function validateAdvisory(advisory, path) {
  assert(isRecord(advisory), `${path} must be an advisory object or package name`);
  assert(
    (typeof advisory.source === 'number' && Number.isInteger(advisory.source)) ||
      (typeof advisory.source === 'string' && advisory.source.length > 0),
    `${path}.source must identify the advisory`,
  );
  for (const field of ['name', 'dependency', 'title', 'url', 'range']) {
    assertString(advisory[field], `${path}.${field}`);
  }
  assert(severities.includes(advisory.severity), `${path}.severity is not recognized`);
}

function validateVulnerability(vulnerability, name, vulnerabilities) {
  const path = `vulnerabilities.${name}`;
  assert(isRecord(vulnerability), `${path} must be an object`);
  assertString(vulnerability.name, `${path}.name`);
  assert(severities.includes(vulnerability.severity), `${path}.severity is not recognized`);
  assert(typeof vulnerability.isDirect === 'boolean', `${path}.isDirect must be a boolean`);
  assert(Array.isArray(vulnerability.via) && vulnerability.via.length > 0, `${path}.via must not be empty`);
  for (const [index, advisory] of vulnerability.via.entries()) {
    if (typeof advisory === 'string') {
      assert(advisory.length > 0, `${path}.via[${index}] must not be empty`);
      assert(
        Object.hasOwn(vulnerabilities, advisory),
        `${path}.via[${index}] references missing vulnerability ${advisory}`,
      );
    } else {
      validateAdvisory(advisory, `${path}.via[${index}]`);
    }
  }
  assert(Array.isArray(vulnerability.effects), `${path}.effects must be an array`);
  vulnerability.effects.forEach((effect, index) => assertString(effect, `${path}.effects[${index}]`));
  assertString(vulnerability.range, `${path}.range`);
  assert(Array.isArray(vulnerability.nodes), `${path}.nodes must be an array`);
  vulnerability.nodes.forEach((node, index) => assertString(node, `${path}.nodes[${index}]`));
  assert(
    typeof vulnerability.fixAvailable === 'boolean' || isRecord(vulnerability.fixAvailable),
    `${path}.fixAvailable must be a boolean or object`,
  );
  if (isRecord(vulnerability.fixAvailable)) {
    assertString(vulnerability.fixAvailable.name, `${path}.fixAvailable.name`);
    assertString(vulnerability.fixAvailable.version, `${path}.fixAvailable.version`);
    assert(
      typeof vulnerability.fixAvailable.isSemVerMajor === 'boolean',
      `${path}.fixAvailable.isSemVerMajor must be a boolean`,
    );
  }
}

function validateMetadata(report, vulnerabilities) {
  assert(isRecord(report.metadata), 'metadata must be an object');
  assert(isRecord(report.metadata.vulnerabilities), 'metadata.vulnerabilities must be an object');

  let total = 0;
  for (const severity of severities) {
    const count = report.metadata.vulnerabilities[severity];
    assert(
      Number.isInteger(count) && count >= 0,
      `metadata.vulnerabilities.${severity} must be a non-negative integer`,
    );
    total += count;
  }
  assert(
    report.metadata.vulnerabilities.total === total,
    'metadata vulnerability total does not match severity counts',
  );
  assert(Object.keys(vulnerabilities).length === total, 'metadata vulnerability total does not match vulnerabilities');

  const actualCounts = Object.fromEntries(severities.map((severity) => [severity, 0]));
  for (const vulnerability of Object.values(vulnerabilities)) actualCounts[vulnerability.severity] += 1;
  for (const severity of severities) {
    assert(
      actualCounts[severity] === report.metadata.vulnerabilities[severity],
      `metadata ${severity} count is inconsistent`,
    );
  }

  assert(isRecord(report.metadata.dependencies), 'metadata.dependencies must be an object');
  for (const kind of ['prod', 'dev', 'optional', 'peer', 'peerOptional', 'total']) {
    const count = report.metadata.dependencies[kind];
    assert(Number.isInteger(count) && count >= 0, `metadata.dependencies.${kind} must be a non-negative integer`);
  }
}

function advisoriesFor(name, vulnerabilities, visited = new Set()) {
  if (visited.has(name)) return [];
  visited.add(name);
  return vulnerabilities[name].via.flatMap((advisory) =>
    typeof advisory === 'string' ? advisoriesFor(advisory, vulnerabilities, visited) : [advisory],
  );
}

export function evaluateAuditReport(report, allowedAdvisories = new Map()) {
  assert(isRecord(report), 'root value must be an object');
  assert(!Object.hasOwn(report, 'error'), 'report contains an error response');
  assert(report.auditReportVersion === 2, 'auditReportVersion must be 2');
  assert(isRecord(report.vulnerabilities), 'vulnerabilities must be an object');

  const vulnerabilities = report.vulnerabilities;
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    validateVulnerability(vulnerability, name, vulnerabilities);
  }
  validateMetadata(report, vulnerabilities);

  const relevant = new Map();
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (!blockingSeverities.has(vulnerability.severity)) continue;
    const advisories = advisoriesFor(name, vulnerabilities);
    assert(
      advisories.some((advisory) => blockingSeverities.has(advisory.severity)),
      `high or critical vulnerability ${name} has no corresponding high or critical advisory`,
    );
    for (const advisory of advisories) {
      if (blockingSeverities.has(advisory.severity)) relevant.set(advisory.url, advisory);
    }
  }

  const accepted = [];
  const blocking = [];
  for (const advisory of relevant.values()) {
    const reason = allowedAdvisories.get(advisory.url);
    if (reason) accepted.push({ advisory, reason });
    else blocking.push(advisory);
  }
  return { accepted, blocking };
}
