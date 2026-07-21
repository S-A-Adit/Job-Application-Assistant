/**
 * regression-runner.js — AI Job Agent Benchmark Regression Runner
 *
 * Compares the most recent benchmark session against the previous one.
 * Exits with code 1 if any metric regresses beyond its defined threshold.
 *
 * Usage:
 *   node backend/tests/regression-runner.js [--threshold=0.05]
 *
 * Environment:
 *   BACKEND_URL — defaults to http://127.0.0.1:5000
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:5000';
const REPORT_PATH = path.join(__dirname, '../regression_report.json');

// Parse optional threshold override from CLI args
const thresholdArg = process.argv.find(a => a.startsWith('--threshold='));
const DEFAULT_THRESHOLD = thresholdArg ? parseFloat(thresholdArg.split('=')[1]) : 0.05;

// ── Metric Configuration ──────────────────────────────────────────
// name: field in BenchmarkSession
// higher_is_better: true means regression = decrease, false = regression = increase
// threshold: allowable drop/increase (absolute) before flagging as regression
// weight: relative importance in the weighted regression score
const METRICS = [
  { name: 'completionRate',       higherIsBetter: true,  threshold: DEFAULT_THRESHOLD, weight: 0.30 },
  { name: 'fieldAccuracy',        higherIsBetter: true,  threshold: DEFAULT_THRESHOLD, weight: 0.25 },
  { name: 'avgConfidence',        higherIsBetter: true,  threshold: DEFAULT_THRESHOLD, weight: 0.15 },
  { name: 'semanticAccuracy',     higherIsBetter: true,  threshold: DEFAULT_THRESHOLD, weight: 0.10 },
  { name: 'skipRate',             higherIsBetter: false, threshold: DEFAULT_THRESHOLD, weight: 0.10 },
  { name: 'errorRate',            higherIsBetter: false, threshold: DEFAULT_THRESHOLD, weight: 0.10 },
];

// ANSI colors
const C = {
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
};

function log(msg, color = '') {
  console.log(`${color}${msg}${C.reset}`);
}

function formatNum(n) {
  if (n == null) return 'N/A';
  if (typeof n === 'number') return n.toFixed(4);
  return String(n);
}

// ── Fetch benchmark sessions ──────────────────────────────────────
async function fetchBenchmarks() {
  const url = `${BACKEND_URL}/api/benchmarks`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Cannot reach backend at ${BACKEND_URL}. Is the server running? (${err.message})`);
  }
  if (!res.ok) throw new Error(`Backend returned HTTP ${res.status} for GET /api/benchmarks`);
  const data = await res.json();
  return data; // Array of BenchmarkSession objects
}

// ── Fetch full benchmark report ───────────────────────────────────
async function fetchReport() {
  const url = `${BACKEND_URL}/api/benchmarks/report`;
  let res;
  try {
    res = await fetch(url);
    if (res.ok) return await res.json();
  } catch {
    // Endpoint may not exist yet, fall through
  }
  return null;
}

// ── Compute regression between two sessions ───────────────────────
function computeRegression(previous, current) {
  const regressions = [];
  const improvements = [];
  const stable = [];

  for (const metric of METRICS) {
    const prev = previous[metric.name];
    const curr = current[metric.name];

    if (prev == null || curr == null) {
      stable.push({ metric: metric.name, status: 'missing', prev, curr, delta: null });
      continue;
    }

    const delta = curr - prev;
    const isRegression = metric.higherIsBetter
      ? delta < -metric.threshold
      : delta > metric.threshold;
    const isImprovement = metric.higherIsBetter
      ? delta > metric.threshold
      : delta < -metric.threshold;

    const record = {
      metric: metric.name,
      prev: parseFloat(prev.toFixed(4)),
      curr: parseFloat(curr.toFixed(4)),
      delta: parseFloat(delta.toFixed(4)),
      threshold: metric.threshold,
      higherIsBetter: metric.higherIsBetter,
      weight: metric.weight,
      status: isRegression ? 'regression' : isImprovement ? 'improvement' : 'stable',
    };

    if (isRegression) regressions.push(record);
    else if (isImprovement) improvements.push(record);
    else stable.push(record);
  }

  return { regressions, improvements, stable };
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  log('\n' + C.bold + '═══════════════════════════════════════════════════════', C.cyan);
  log('  AI Job Agent — Benchmark Regression Runner', C.cyan);
  log('  Backend: ' + BACKEND_URL, C.cyan);
  log(`  Regression threshold: ±${DEFAULT_THRESHOLD}`, C.cyan);
  log('═══════════════════════════════════════════════════════' + C.reset);

  let sessions;
  try {
    sessions = await fetchBenchmarks();
  } catch (err) {
    log(`\n❌ ${err.message}`, C.red);
    process.exit(2);
  }

  if (!sessions || sessions.length < 2) {
    log('\n⚠️  Not enough benchmark sessions to compare (need at least 2).', C.yellow);
    log('   Run a benchmark first by triggering the autofill agent on the Synthetic ATS.', C.yellow);

    // Write a stub report for CI systems
    const stubReport = {
      timestamp: new Date().toISOString(),
      status: 'insufficient_data',
      reason: `Only ${sessions?.length || 0} session(s) available. Need at least 2.`,
      sessions: sessions?.length || 0,
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(stubReport, null, 2));
    log(`\n📊 Stub report written to: ${REPORT_PATH}`, C.cyan);
    process.exit(0);
  }

  // Sort by createdAt ascending (oldest first)
  sessions.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const previous = sessions[sessions.length - 2];
  const current = sessions[sessions.length - 1];

  log(`\n📅 Comparing sessions:`, C.dim);
  log(`   Previous: ${previous.id} (${new Date(previous.createdAt).toLocaleString()})`, C.dim);
  log(`   Current:  ${current.id} (${new Date(current.createdAt).toLocaleString()})`, C.dim);

  const { regressions, improvements, stable } = computeRegression(previous, current);

  // ─── Print Results Table ───────────────────────────────────────
  log('\n┌─────────────────────────┬────────────┬────────────┬────────────┬──────────┐');
  log('│ Metric                  │ Previous   │ Current    │ Delta      │ Status   │');
  log('├─────────────────────────┼────────────┼────────────┼────────────┼──────────┤');

  const allMetrics = [...regressions, ...improvements, ...stable];
  allMetrics.sort((a, b) => {
    const order = { regression: 0, improvement: 1, stable: 2, missing: 3 };
    return (order[a.status] || 3) - (order[b.status] || 3);
  });

  for (const m of allMetrics) {
    const name = m.metric.padEnd(23);
    const prev = formatNum(m.prev).padStart(10);
    const curr = formatNum(m.curr).padStart(10);
    const deltaStr = (m.delta !== null ? (m.delta >= 0 ? '+' : '') + formatNum(m.delta) : 'N/A').padStart(10);

    let statusLabel, color;
    if (m.status === 'regression')   { statusLabel = '🔴 REGR  '; color = C.red; }
    else if (m.status === 'improvement') { statusLabel = '🟢 IMPROV'; color = C.green; }
    else if (m.status === 'missing') { statusLabel = '⚪ MISS  '; color = C.dim; }
    else                             { statusLabel = '🟡 STABLE'; color = C.yellow; }

    log(`│ ${color}${name}${C.reset} │${prev} │${curr} │${color}${deltaStr}${C.reset} │ ${color}${statusLabel}${C.reset} │`);
  }
  log('└─────────────────────────┴────────────┴────────────┴────────────┴──────────┘');

  // ─── Summary ──────────────────────────────────────────────────
  log('');
  if (improvements.length > 0) {
    log(`✅ Improvements: ${improvements.map(m => m.metric).join(', ')}`, C.green);
  }
  if (stable.length > 0) {
    log(`🟡 Stable: ${stable.map(m => m.metric).join(', ')}`, C.yellow);
  }
  if (regressions.length > 0) {
    log(`\n🔴 REGRESSIONS DETECTED (${regressions.length}):`, C.red);
    for (const r of regressions) {
      const dir = r.higherIsBetter ? 'decreased' : 'increased';
      log(`   • ${r.metric}: ${dir} by ${Math.abs(r.delta).toFixed(4)} (threshold: ${r.threshold})`, C.red);
    }
  }

  // ─── Write Report ─────────────────────────────────────────────
  const report = {
    timestamp: new Date().toISOString(),
    backendUrl: BACKEND_URL,
    threshold: DEFAULT_THRESHOLD,
    previousSession: {
      id: previous.id,
      createdAt: previous.createdAt,
      platform: previous.platform,
    },
    currentSession: {
      id: current.id,
      createdAt: current.createdAt,
      platform: current.platform,
    },
    summary: {
      totalMetrics: METRICS.length,
      regressions: regressions.length,
      improvements: improvements.length,
      stable: stable.length,
    },
    regressions,
    improvements,
    stable,
    status: regressions.length > 0 ? 'FAILED' : 'PASSED',
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  log(`\n📊 Regression report saved to: ${REPORT_PATH}`, C.cyan);

  if (regressions.length > 0) {
    log('\n❌ Regression check FAILED. See report for details.', C.red);
    process.exit(1);
  } else {
    log('\n✅ Regression check PASSED. No regressions detected.', C.green);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal regression runner error:', err);
  process.exit(2);
});
