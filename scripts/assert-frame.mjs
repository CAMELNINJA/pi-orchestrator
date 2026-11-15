#!/usr/bin/env node
// assert-frame.mjs - Validate dashboard renders correctly with color on and boundary widths
// Pure Node ESM, no external dependencies

import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTHS = [40, 50, 80, 100, 120, 200];
const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PATH = join(__dirname, 'orchestrator-dashboard.mjs');

// Create minimal temp state file
const tempStatePath = join(tmpdir(), `dashboard-state-${Date.now()}.json`);
const stateData = {
  updatedAt: Date.now(),
  orchestrator: { model: 'test-model', thinking: 'none' },
  totals: { input: 100, output: 200, cacheRead: 5, cacheWrite: 2, cost: 0.0042 },
  jev: { enabled: true, forks: 2, model: 'test-clf', lastDecisions: [{ question: 'test', answer: 'yes', confidence: 0.85 }] },
  agents: [{ role: 'test', provider: 'test', model: 'test', status: 'done', startedAt: Date.now() - 1000, finishedAt: Date.now(), usage: { input: 50, output: 100, cost: 0.0021 } }],
  log: [{ at: Date.now() - 500, kind: 'session', who: 'test', text: 'test session' }]
};
writeFileSync(tempStatePath, JSON.stringify(stateData, null, 2));

try {
  const results = [];

  for (const cols of WIDTHS) {
    const env = { ...process.env, DASH_ONCE: '1', DASH_FORCE_COLOR: '1', DASH_COLS: String(cols) };
    const result = spawnSync(process.execPath, [DASHBOARD_PATH, tempStatePath], { env, encoding: 'utf8', timeout: 10000 });
    
    if (result.error) {
      results.push({ cols, pass: false, issues: [`spawn error: ${result.error.message}`] });
      continue;
    }
    if (result.signal) {
      results.push({ cols, pass: false, issues: [`terminated by signal ${result.signal}`] });
      continue;
    }
    
    const stdout = result.stdout;
    
    // Parse the frame by splitting on cursor positioning sequences
    // Format: \x1b[?2026h\x1b[2J\x1b[1;1H\x1b[2K<line1>\x1b[2;1H\x1b[2K<line2>...
    // We extract the text after each \x1b[<n>;1H\x1b[2K pattern
    
    const lines = [];
    const linePattern = /\x1b\[\d+;1H\x1b\[2K/g;
    let lastIndex = 0;
    let match;
    
    while ((match = linePattern.exec(stdout)) !== null) {
      // Extract text between the positioning sequences
      const startPos = linePattern.lastIndex;
      // Find the next positioning sequence or end of string
      let endPos = stdout.length;
      const nextMatch = linePattern.exec(stdout);
      if (nextMatch) {
        endPos = nextMatch.index;
        linePattern.lastIndex = nextMatch.index; // reset for next iteration
      }
      const lineText = stdout.substring(startPos, endPos);
      if (lineText.trim() !== '') {
        lines.push(lineText);
      }
      if (!nextMatch) break;
    }
    
    // Aggregate per issue type: count + first location (line/col are 1-based)
    const agg = new Map();
    const note = (type, lineNo, col, extra) => {
      const a = agg.get(type);
      if (a) { a.count++; if (extra !== undefined && extra > a.max) a.max = extra; }
      else agg.set(type, { count: 1, line: lineNo, col, max: extra });
    };

    // Check each line
    for (const [idx, line] of lines.entries()) {
      const lineNo = idx + 1;
      // Strip SGR sequences for visible length
      const stripped = line.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
      const vlen = Array.from(stripped).length;
      
      // a. visible width check
      if (vlen > cols - 1) note('width overflow', lineNo, 1, vlen);
      
      // b. no leaked [38;2; without preceding ESC
      const regex = /(?<!\x1b)\[38;2;/g;
      let match;
      while ((match = regex.exec(line)) !== null) note('leaked "[38;2;"', lineNo, match.index + 1);
      
      // c. no NUL or stray control chars (except ESC-introduced sequences)
      for (let i = 0; i < line.length; i++) {
        const ch = line.charCodeAt(i);
        if (ch === 0) note('NUL bytes', lineNo, i + 1);
        else if (ch >= 1 && ch <= 31 && ch !== 27) note('control chars', lineNo, i + 1);
      }
    }
    
    // d. At widths >= 100, assert at least one real SGR truecolor sequence IS present
    if (cols >= 100) {
      const hasTrueColor = /\x1b\[38;2;[0-9]+;[0-9]+;[0-9]+m/.test(stdout);
      if (!hasTrueColor) agg.set('no truecolor sequence (width>=100)', null);
    }

    const issues = [...agg].map(([type, a]) => {
      if (!a) return type;
      const max = a.max !== undefined ? `, max ${a.max} > ${cols - 1}` : '';
      return `${type}: ${a.count} (first at line ${a.line} col ${a.col}${max})`;
    });
    results.push({ cols, pass: issues.length === 0, issues });
  }
  
  // Print results
  console.log('assert-frame.mjs results:');
  console.log('');
  console.log('width | pass | issues');
  console.log('------|------|--------------------------------------------------');
  for (const r of results) {
    let issuesStr = r.issues.join('; ');
    if (issuesStr.length > 160) issuesStr = issuesStr.slice(0, 157) + '...';
    console.log(`${String(r.cols).padStart(5)} | ${r.pass ? 'PASS' : 'FAIL'} | ${issuesStr}`);
  }
  console.log('');

  const passed = results.filter(r => r.pass).length;
  // Set exitCode instead of process.exit() so the finally block still removes the temp file.
  if (passed === results.length) {
    console.log(`assert-frame: ${passed}/${results.length} widths passed`);
  } else {
    console.log(`assert-frame: FAILED: ${results.length - passed}/${results.length} widths`);
    process.exitCode = 1;
  }
} finally {
  try { unlinkSync(tempStatePath); } catch { /* ignore */ }
}
