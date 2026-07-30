import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateAuditReport } from './audit-report.mjs';

const advisory = {
  source: 123,
  name: 'example',
  dependency: 'example',
  title: 'Example advisory',
  url: 'https://github.com/advisories/GHSA-example',
  severity: 'high',
  range: '<2.0.0',
};

function auditReport(vulnerabilities = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const vulnerability of Object.values(vulnerabilities)) counts[vulnerability.severity] += 1;
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: { ...counts, total: Object.keys(vulnerabilities).length },
      dependencies: { prod: 1, dev: 1, optional: 0, peer: 0, peerOptional: 0, total: 2 },
    },
  };
}

function vulnerability(overrides = {}) {
  return {
    name: 'example',
    severity: 'high',
    isDirect: true,
    via: [advisory],
    effects: [],
    range: '<2.0.0',
    nodes: ['node_modules/example'],
    fixAvailable: false,
    ...overrides,
  };
}

test('accepts a complete clean npm audit report', () => {
  assert.deepEqual(evaluateAuditReport(auditReport()), { accepted: [], blocking: [] });
});

test('separates explicitly accepted and blocking advisories', () => {
  const report = auditReport({ example: vulnerability() });
  assert.equal(evaluateAuditReport(report).blocking[0].url, advisory.url);

  const reason = 'Not reachable in this deployment model.';
  const result = evaluateAuditReport(report, new Map([[advisory.url, reason]]));
  assert.deepEqual(result, { accepted: [{ advisory, reason }], blocking: [] });
});

test('follows package references to the underlying advisory', () => {
  const dependencyAdvisory = { ...advisory, name: 'nested', dependency: 'nested' };
  const report = auditReport({
    example: vulnerability({ via: ['nested'] }),
    nested: vulnerability({ name: 'nested', isDirect: false, via: [dependencyAdvisory] }),
  });
  assert.equal(evaluateAuditReport(report).blocking[0].url, advisory.url);
});

test('rejects npm error responses', () => {
  assert.throws(() => evaluateAuditReport({ error: { code: 'ENETWORK' } }), /error response/);
});

test('rejects missing or unsupported schema versions', () => {
  const report = auditReport();
  delete report.auditReportVersion;
  assert.throws(() => evaluateAuditReport(report), /auditReportVersion/);
  assert.throws(() => evaluateAuditReport({ ...report, auditReportVersion: 3 }), /auditReportVersion/);
});

test('rejects incomplete vulnerability and advisory records', () => {
  const incompleteVulnerability = vulnerability();
  delete incompleteVulnerability.nodes;
  assert.throws(() => evaluateAuditReport(auditReport({ example: incompleteVulnerability })), /nodes/);

  const incompleteAdvisory = { ...advisory };
  delete incompleteAdvisory.url;
  assert.throws(
    () => evaluateAuditReport(auditReport({ example: vulnerability({ via: [incompleteAdvisory] }) })),
    /\.url/,
  );
});

test('rejects dangling package references and severity-only findings', () => {
  assert.throws(
    () => evaluateAuditReport(auditReport({ example: vulnerability({ via: ['missing'] }) })),
    /references missing vulnerability/,
  );
  assert.throws(
    () =>
      evaluateAuditReport(auditReport({ example: vulnerability({ via: [{ ...advisory, severity: 'moderate' }] }) })),
    /no corresponding high or critical advisory/,
  );
});

test('rejects inconsistent metadata instead of treating it as no findings', () => {
  const report = auditReport({ example: vulnerability() });
  report.metadata.vulnerabilities.total = 0;
  assert.throws(() => evaluateAuditReport(report), /total/);

  const incompleteReport = auditReport();
  delete incompleteReport.metadata.dependencies;
  assert.throws(() => evaluateAuditReport(incompleteReport), /metadata\.dependencies/);
});
