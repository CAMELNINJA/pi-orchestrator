#!/usr/bin/env node
// Orchestrator Dashboard - TUI for live orchestration state
// Pure Node ESM, no external dependencies, follows tui-design skill

import { readFileSync, watch, existsSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import process from 'node:process';

// --- Semantic color tokens (truecolor, disabled by NO_COLOR or non-TTY) ---
const COLORS = {
  advisor: [180, 142, 220],  // purple
  subagent: [94, 156, 234],  // blue
  jev: [78, 201, 160],       // green
  running: [86, 182, 194],   // cyan
  done: [120, 200, 140],     // green
  error: [224, 108, 108],    // red
  accent: [230, 150, 90],    // orange
  dim: [120, 128, 140],      // gray
  text: [200, 208, 220],     // white-ish
  header: [230, 200, 150],   // light accent
};

// --- ASCII fallback detection ---
function useAscii() {
  if (process.env.DASH_ASCII) return true;
  const loc = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '';
  return !/utf[_-]?8/i.test(loc);
}

const UI = {
  // Unicode mode (default)
  u: {
    boxTL: '╭', boxTR: '╮', boxBL: '╰', boxBR: '╯', boxH: '─', boxV: '│',
    barFull: '█', barEmpty: '░', ellipsis: '…',
    spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    separator: '⋅', check: '✓', cross: '✗', bullet: '●',
  },
  // ASCII mode (fallback)
  a: {
    boxTL: '+', boxTR: '+', boxBL: '+', boxBR: '+', boxH: '-', boxV: '|',
    barFull: '#', barEmpty: '-', ellipsis: '...',
    spinner: ['|', '/', '-', '\\'],
    separator: '|', check: '*', cross: 'x', bullet: '*',
  },
};

// Get current UI mode
function ui() { return useAscii() ? UI.a : UI.u; }

// --- Helpers ---

function color(rgb, text) {
  const forceColor = process.env.DASH_FORCE_COLOR === '1';
  // Force colors in DASH_ONCE with DASH_FORCE_COLOR for testing
  if (process.env.NO_COLOR) return text;
  if (process.env.DASH_ONCE) {
    return forceColor ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[39m` : text;
  }
  if (!process.stdout.isTTY) return text;
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[39m`;
}

function visibleLen(s) {
  // Strip all CSI sequences then count code points
  // SGR: \x1b[[0-9;]*m, other CSI: \x1b[[?0-9;]*[a-zA-Z]
  const stripped = s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  return Array.from(stripped).length;
}

// Sanitize untrusted text: strip all ANSI sequences to prevent escape injection
function sanitizeText(s) {
  if (s == null) return '';
  // Remove all ANSI CSI sequences
  return String(s).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\]0;[^\x07]*\x07/g, '');
}

function truncate(s, w) {
  if (w <= 0) return '';
  const vlen = visibleLen(s);
  if (vlen <= w) return s;
  const ell = ui().ellipsis;
  const maxInner = w - visibleLen(ell);
  if (maxInner <= 0) return ell;
  let result = '';
  let currentLen = 0;
  for (const ch of Array.from(s)) {
    const chLen = visibleLen(ch);
    if (currentLen + chLen <= maxInner) {
      result += ch;
      currentLen += chLen;
    } else {
      break;
    }
  }
  return result + ell;
}

function padRight(s, w) {
  const vlen = visibleLen(s);
  return s + ' '.repeat(Math.max(0, w - vlen));
}

function padLeft(s, w) {
  const vlen = visibleLen(s);
  return ' '.repeat(Math.max(0, w - vlen)) + s;
}

function fmtCount(n) {
  if (n == null || isNaN(n)) return '0';
  n = Number(n);
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + 'k';
  if (n < 1000000) return Math.round(n / 1000) + 'k';
  return (n / 1000000).toFixed(1) + 'M';
}

function fmtCost(n) {
  if (n == null || isNaN(n)) return '$0.0000';
  return '$' + Number(n).toFixed(4);
}

function fmtElapsed(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return minutes + 'm' + String(remaining).padStart(2, '0') + 's';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours + 'h' + String(remainingMinutes).padStart(2, '0') + 'm';
}

function fmtTime(epoch) {
  if (!epoch) return '00:00:00';
  const d = new Date(epoch);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// --- Box renderer (single border depth) ---
function box(title, lines, width, colorFn) {
  const innerWidth = width - 2;
  const u = ui();
  const border = colorFn ? colorFn(u.boxV) : u.boxV;
  const top = colorFn ? colorFn(u.boxTL + u.boxH + title + ' ' + u.boxH.repeat(Math.max(0, innerWidth - visibleLen(title) - 2)) + u.boxTR) : (u.boxTL + u.boxH + title + ' ' + u.boxH.repeat(Math.max(0, innerWidth - visibleLen(title) - 2)) + u.boxTR);
  const bottom = colorFn ? colorFn(u.boxBL + u.boxH.repeat(width - 2) + u.boxBR) : (u.boxBL + u.boxH.repeat(width - 2) + u.boxBR);
  const result = [top];
  
  for (const line of lines) {
    const fitted = visibleLen(line) > innerWidth ? truncate(line, innerWidth) : line;
    const padded = padRight(fitted, innerWidth);
    result.push(border + padded + border);
  }
  
  result.push(bottom);
  return result;
}

// --- State management ---
let lastState = null;
let spinnerIndex = 0;
let intervalId = null;
let watcher = null;
let needClear = true;

function getTermSize() {
  const rows = Number(process.env.DASH_ROWS) || process.stdout.rows || 24;
  const cols = Number(process.env.DASH_COLS) || process.stdout.columns || 80;
  return { rows, cols };
}

function readStateFile(path) {
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// --- Core rendering ---
function render() {
  try {
    const term = getTermSize();
    const cols = term.cols;
    const rows = term.rows;
    
    // Handle too-small state
    if (cols < 50 || rows < 14) {
      const frame = [];
      const msg = 'terminal too small · need 50x14';
      const sub = 'press q to quit';
      const centerPad = Math.max(0, Math.floor((cols - visibleLen(msg)) / 2));
      frame.push(' '.repeat(centerPad) + msg);
      frame.push(' '.repeat(Math.max(0, Math.floor((cols - visibleLen(sub)) / 2))) + sub);
      while (frame.length < rows) frame.push('');
      emitFrame(frame, rows, cols);
      return;
    }
    
    const state = lastState;
    const u = ui();
    
    // Compute available lines: header(1) + legend(1) + blank(1) + advisor+jev + subagents + blank(1) + logHeader(1) + blank(1) + status(1)
    const advisorLines = 5;
    const jevLines = 5;
    const blankLines = 3; // 1 between header/legend, 1 between jev/subagents, 1 before log
    const logHeaderLines = 1;
    const statusBarLines = 1;
    
    // Determine advisor+jev layout: side-by-side if cols >= 100, else stack
    const sideBySide = cols >= 100;
    const jevAdvisorHeight = sideBySide ? Math.max(advisorLines, jevLines) + 1 : advisorLines + jevLines + 2;
    
    // Build frame
    const frame = [];
    
    // 1) Header row
    if (state) {
      const model = state.orchestrator?.model || 'unknown';
      const agentCount = (state.agents?.length || 0);
      const label = agentCount === 1 ? 'agent' : 'agents';
      const jevForks = state.jev?.forks || 0;
      let headerLeft = ` ORCHESTRATOR · ${model} `;
      let headerRight = ` ${agentCount} ${label} · forks ${jevForks} `;
      if (state.updatedAt) {
        const age = Date.now() - state.updatedAt;
        if (age > 30000) {
          headerRight += ` IDLE ${fmtElapsed(age)}`;
        }
      }
      const totalWidth = visibleLen(headerLeft) + visibleLen(headerRight);
      if (totalWidth <= cols - 1) {
        frame.push(padRight(headerLeft, cols - visibleLen(headerRight) - 1) + headerRight);
      } else {
        // Truncate right first, then left if needed
        const rightWidth = Math.max(0, cols - visibleLen(headerLeft) - 2);
        headerRight = truncate(headerRight, rightWidth);
        frame.push(padRight(headerLeft + ' ', cols - visibleLen(headerRight) - 1) + headerRight);
      }
    } else {
      frame.push(' ORCHESTRATOR DASHBOARD ');
    }
    
    // 2) Legend row
    if (!process.env.NO_COLOR && state) {
      const legend = [
        color(COLORS.advisor, u.bullet) + ' advisor',
        color(COLORS.subagent, u.bullet) + ' subagent',
        color(COLORS.jev, u.bullet) + ' jev',
      ].join('  ');
      frame.push('  ' + padRight(legend, cols - 3));
    } else if (state) {
      frame.push('  advisor  subagent  jev');
    }
    
    // 3) Blank separator
    frame.push('');
    
    // 4) Advisor and JEV sections
    if (state) {
      // ADVISOR
      const advisorInnerWidth = sideBySide ? Math.floor((cols - 3) / 2) - 1 : cols - 4;
      const advisorWidth = advisorInnerWidth + 2;
      const advisorContent = [];
      advisorContent.push(`thinking: ${state.orchestrator?.thinking || 'unknown'}`);
      advisorContent.push(`tokens: ${fmtCount(state.totals?.input)} / ${fmtCount(state.totals?.output)}`);
      advisorContent.push(`cache: ${fmtCount(state.totals?.cacheRead)}r / ${fmtCount(state.totals?.cacheWrite)}w`);
      advisorContent.push(`cost: ${fmtCost(state.totals?.cost)}`);
      advisorContent.push('status: coordinating');
      const advisorBox = box('ADVISOR', advisorContent, advisorWidth, (s) => color(COLORS.advisor, s));
      frame.push(...advisorBox);
      
      if (sideBySide) {
        // JEV (side by side)
        const jevInnerWidth = advisorInnerWidth;
        const jevWidth = jevInnerWidth + 2;
        const jevContent = [];
        jevContent.push(`forks: ${state.jev?.forks || 0}`);
        const model = state.jev?.model || '~typesafe/jev-latest';
        jevContent.push(truncate(`model: ${model}`, jevInnerWidth - 8));
        
        if (state.jev?.enabled) {
          const decisions = state.jev.lastDecisions || [];
          const seen = new Set();
          let count = 0;
          for (let i = decisions.length - 1; i >= 0 && count < 3; i--) {
            const d = decisions[i];
            if (!seen.has(d.question)) {
              seen.add(d.question);
              const confidence = d.confidence ?? 0;
              const label = `${d.question} ${d.answer}`;
              const pText = `p=${confidence.toFixed(2)}`;
              const labelLen = visibleLen(label);
              const pLen = visibleLen(pText);
              const barWidth = Math.max(0, jevInnerWidth - labelLen - pLen - 6);
              const filled = Math.round(confidence * barWidth);
              const barPart = u.barFull.repeat(Math.max(0, filled)) + u.barEmpty.repeat(Math.max(0, barWidth - filled));
              jevContent.push(padRight(label, jevInnerWidth - pLen - 4) + ' ' + barPart + ' ' + pText);
              count++;
            }
          }
          if (seen.size === 0) {
            jevContent.push('no decisions yet');
          }
        } else {
          jevContent.push(color(COLORS.dim, 'disabled'));
        }
        
        const jevBox = box('JEV', jevContent, jevWidth, (s) => color(COLORS.jev, s));
        frame.push(...jevBox);
      } else {
        // Stack JEV below Advisor
        const jevInnerWidth = cols - 4;
        const jevWidth = jevInnerWidth + 2;
        frame.push('');
        const jevContent = [];
        jevContent.push(`forks: ${state.jev?.forks || 0}`);
        const model = state.jev?.model || '~typesafe/jev-latest';
        jevContent.push(truncate(`model: ${model}`, jevInnerWidth - 8));
        
        if (state.jev?.enabled) {
          const decisions = state.jev.lastDecisions || [];
          const seen = new Set();
          let count = 0;
          for (let i = decisions.length - 1; i >= 0 && count < 3; i--) {
            const d = decisions[i];
            if (!seen.has(d.question)) {
              seen.add(d.question);
              const confidence = d.confidence ?? 0;
              const label = `${d.question} ${d.answer}`;
              const pText = `p=${confidence.toFixed(2)}`;
              const labelLen = visibleLen(label);
              const pLen = visibleLen(pText);
              const barWidth = Math.max(0, jevInnerWidth - labelLen - pLen - 6);
              const filled = Math.round(confidence * barWidth);
              const barPart = u.barFull.repeat(Math.max(0, filled)) + u.barEmpty.repeat(Math.max(0, barWidth - filled));
              jevContent.push(padRight(label, jevInnerWidth - pLen - 4) + ' ' + barPart + ' ' + pText);
              count++;
            }
          }
          if (seen.size === 0) {
            jevContent.push('no decisions yet');
          }
        } else {
          jevContent.push(color(COLORS.dim, 'disabled'));
        }
        
        const jevBox = box('JEV', jevContent, jevWidth, (s) => color(COLORS.jev, s));
        frame.push(...jevBox);
      }
      
      // 5) Blank separator
      frame.push('');
      
      // 6) Subagent boxes - render as grid
      const agents = state.agents || [];
      const maxSubagentWidth = 28;
      const subagentGutter = 2;
      
      // Grid layout: compute how many boxes fit per row
      const perRow = Math.max(1, Math.floor((cols - 1) / (maxSubagentWidth + subagentGutter)));
      const subagentWidth = Math.min(maxSubagentWidth, Math.floor((cols - 1 - subagentGutter) / Math.min(agents.length, perRow)));
      
      // Build all agent boxes first
      const agentBoxes = [];
      for (const agent of agents) {
        const agentLines = [];
        const model = sanitizeText(`${agent.provider}/${agent.model}`);
        agentLines.push(truncate(model, subagentWidth - 2));
        
        let statusLine = '';
        let statusColor = null;
        
        if (agent.status === 'running') {
          const elapsed = Date.now() - (agent.startedAt || Date.now());
          const spinner = u.spinner[spinnerIndex % u.spinner.length];
          statusLine = `${spinner} running ${fmtElapsed(elapsed)}`;
          statusColor = COLORS.running;
        } else if (agent.status === 'done') {
          const elapsed = (agent.finishedAt || Date.now()) - (agent.startedAt || Date.now());
          statusLine = `${u.check} done ${fmtElapsed(elapsed)}`;
          statusColor = COLORS.done;
        } else if (agent.status === 'error') {
          statusLine = `${u.cross} error`;
          statusColor = COLORS.error;
        } else {
          statusLine = 'idle';
          statusColor = COLORS.subagent;
        }
        
        agentLines.push(truncate(statusLine, subagentWidth - 2));
        
        const usage = agent.usage || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
        agentLines.push(`${fmtCount(usage.input || 0)}/${fmtCount(usage.output || 0)}  ${fmtCost(usage.cost || 0)}`);
        
        // Render box
        const agentBox = box(sanitizeText(agent.role), agentLines, subagentWidth, statusColor ? (s) => color(statusColor, s) : null);
        agentBoxes.push(agentBox);
      }
      
      // Arrange boxes into grid rows (perRow per row)
      const gridRows = [];
      for (let i = 0; i < agentBoxes.length; i += perRow) {
        gridRows.push(agentBoxes.slice(i, i + perRow));
      }
      
      // Calculate how many lines we can show for subagents
      // Reserve minimum 4 lines: blank(1) + logHeader(1) + logEntry(1) + statusBar(1)
      // Status bar MUST be the last row, so we ensure it always fits
      const reservedAfterSubagents = 4; // blank + log header + log entry + status bar
      const availableSubagentLines = Math.max(1, rows - frame.length - reservedAfterSubagents);
      
      // Each grid row uses maxBoxHeight lines (typically 5 for full box)
      // Calculate how many full grid rows we can show
      const maxBoxHeight = gridRows.reduce((max, row) => Math.max(max, row.reduce((h, box) => Math.max(h, box.length), 0)), 0);
      const maxGridRowsToShow = Math.max(0, Math.floor(availableSubagentLines / maxBoxHeight));
      
      // Only show COMPLETE grid rows that fully fit
      // A grid row is only shown if ALL its lines fit in the budget
      let gridRowsToShow = [];
      let linesUsed = 0;
      for (let i = 0; i < gridRows.length; i++) {
        const gridRow = gridRows[i];
        const rowHeight = gridRow.reduce((h, box) => Math.max(h, box.length), 0);
        if (linesUsed + rowHeight <= availableSubagentLines) {
          gridRowsToShow.push(gridRow);
          linesUsed += rowHeight;
        } else {
          // This row doesn't fully fit, stop here
          // Any remaining agents will be shown as +N more
          break;
        }
      }
      
      // Check if we had to omit any grid rows
      let showMore = gridRowsToShow.length < gridRows.length;
      
      // Render grid: merge boxes line-by-line within each grid row
      for (const gridRow of gridRowsToShow) {
        const rowHeight = gridRow.reduce((max, box) => Math.max(max, box.length), 0);
        for (let lineIdx = 0; lineIdx < rowHeight; lineIdx++) {
          let mergedLine = '';
          for (let boxIdx = 0; boxIdx < gridRow.length; boxIdx++) {
            const box = gridRow[boxIdx];
            const boxLine = lineIdx < box.length ? box[lineIdx] : '';
            // Pad box line to full width
            const padded = padRight(boxLine, subagentWidth);
            if (boxIdx > 0) mergedLine += ' '.repeat(subagentGutter);
            mergedLine += padded;
          }
          frame.push(mergedLine);
        }
      }
      
      // Add "+N more" if truncated (after last grid row)
      if (showMore) {
        const remainingAgents = agentBoxes.length - gridRowsToShow.length * perRow;
        frame.push(color(COLORS.dim, '+N more'));
      }
      
      // Add blank separator after subagents (if any shown)
      frame.push('');
      
    } else {
      // State not available yet
      frame.push(color(COLORS.dim, '  waiting for orchestrator state...'));
    }
    
    // 7) Blank separator
    frame.push('');
    
    // 8) Session log
    const logLinesContent = [];
    if (state) {
      const log = state.log || [];
      const availableLogLines = rows - frame.length - 2; // -1 for status bar, -1 for log header
      
      for (let i = Math.max(0, log.length - availableLogLines); i < log.length; i++) {
        const entry = log[i];
        let kindColor = COLORS.text;
        if (entry.kind === 'jev') kindColor = COLORS.jev;
        else if (entry.kind === 'done') kindColor = COLORS.done;
        else if (entry.kind === 'error') kindColor = COLORS.error;
        else if (entry.kind === 'delegate') kindColor = COLORS.subagent;
        else if (entry.kind === 'session') kindColor = COLORS.dim;
        
        const timeStr = fmtTime(entry.at);
        const kindStr = color(kindColor, entry.kind);
        const whoStr = sanitizeText(entry.who || '');
        const textStr = sanitizeText(truncate(entry.text || '', cols - 35));
        
        logLinesContent.push(`${timeStr}  ${kindStr}  ${whoStr}  ${textStr}`);
      }
    }
    
    frame.push(color(COLORS.dim, 'SESSION LOG:'));
    frame.push(...logLinesContent);
    
    // Add blank separator between log and status bar (slack space)
    // This ensures status bar is the LAST row when we pad below
    
    // 9) Status bar (always last row)
    const totals = state?.totals || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    const agents = state?.agents || [];
    const runningCount = agents.filter(a => a.status === 'running').length;
    const doneCount = agents.filter(a => a.status === 'done').length;
    
    const statusBarParts = [
      `tokens ${fmtCount(totals.input || 0)}/${fmtCount(totals.output || 0)}`,
      `cache ${fmtCount(totals.cacheRead || 0)}`,
      `cost ${fmtCost(totals.cost || 0)}`,
      `run[${runningCount}]`,
      `done[${doneCount}]`,
      `${u.bullet} q quit`,
    ];
    
    let statusBar = statusBarParts.join(' ' + u.separator + ' ');
    statusBar = padRight(truncate(statusBar, cols - 1), cols - 1);
    frame.push(color(COLORS.dim, statusBar));
    
    // Height adjustment: ensure exactly rows lines with status bar at the end
    if (frame.length > rows) {
      frame.length = rows;
    } else if (frame.length < rows) {
      // Calculate how many blank lines we need (insert BEFORE status bar)
      // Status bar is the last item added, so:
      // - 1 line for status bar
      // - The rest are blank padding above log
      const blankNeeded = rows - frame.length;
      
      // Find where to insert blanks (after log, before status bar)
      // The last line is the status bar, insert blanks just before it
      const insertIdx = frame.length - 1; // Position of status bar
      
      // Insert blank lines before status bar
      for (let i = 0; i < blankNeeded; i++) {
        frame.splice(insertIdx, 0, '');
      }
    }
    
    // Validate and emit
    emitFrame(frame, rows, cols);
    
    // Increment spinner
    spinnerIndex++;
    
  } catch (err) {
    console.error('Render error:', err);
  }
}

function emitFrame(frame, rows, cols) {
  // Validate each row: visibleLen <= cols-1, no NUL or control chars
  const maxVisibleWidth = cols - 1;
  
  for (let i = 0; i < frame.length; i++) {
    const row = frame[i];
    // Remove NUL and C0 controls EXCEPT ESC (0x1B) - preserve ANSI sequences
    const cleaned = row.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F]/g, '');
    frame[i] = cleaned;
    
    const vlen = visibleLen(frame[i]);
    if (vlen > maxVisibleWidth) {
      frame[i] = truncate(frame[i], maxVisibleWidth);
    } else if (vlen < maxVisibleWidth) {
      frame[i] = padRight(frame[i], maxVisibleWidth);
    }
  }
  
  // Synchronized output
  let out = '\x1b[?2026h';
  if (needClear) {
    out += '\x1b[2J';
    needClear = false;
  }
  
  for (let i = 0; i < rows; i++) {
    out += `\x1b[${i + 1};1H\x1b[2K` + (frame[i] || '');
  }
  
  out += '\x1b[0m\x1b[?2026l';
  process.stdout.write(out);
}

// --- Cleanup ---

function cleanup() {
  try {
    if (intervalId) clearInterval(intervalId);
    if (watcher) {
      watcher.close();
    }
    process.stdout.write('\x1b[?25h'); // show cursor
    process.stdout.write('\x1b[?1049l'); // leave alt-screen
    process.stdout.write('\x1b[H\x1b[J'); // clear and home
  } catch {
    // Ignore cleanup errors
  }
}

function restoreAndExit(code = 0) {
  cleanup();
  process.exit(code);
}

// --- Main ---

function main() {
  const statePath = process.argv[2];
  
  if (!statePath) {
    process.stderr.write('Usage: orchestrator-dashboard.mjs <state-file-path>\n');
    process.stderr.write('Example: orchestrator-dashboard.mjs ~/.pi/agent/orchestrator-dashboard/<sessionId>.json\n');
    process.exit(1);
  }
  
  // Read initial state
  lastState = readStateFile(statePath);
  
  // Test mode: render once and exit
  if (process.env.DASH_ONCE) {
    render();
    process.exit(0);
  }
  
  // Setup terminal (only in live mode)
  process.stdout.write('\x1b[?1049h'); // enter alt-screen
  process.stdout.write('\x1b[?25l');   // hide cursor
  needClear = true;
  
  // Setup cleanup handlers
  process.on('SIGINT', () => restoreAndExit(0));
  process.on('SIGTERM', () => restoreAndExit(0));
  process.on('uncaughtException', (err) => {
    process.stderr.write('Uncaught exception: ' + String(err) + '\n');
    restoreAndExit(1);
  });
  
  // Setup stdin if TTY
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(true);
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (key) => {
        if (key === 'q' || key === '\x03') {
          restoreAndExit(0);
        }
      });
    } catch {
      // ignore raw mode errors
    }
  }
  
  // Setup resize handler
  process.stdout.on('resize', () => {
    needClear = true;
    render();
  });
  
  // Watch directory for changes
  const dir = dirname(statePath);
  
  function setupWatcher() {
    if (watcher) {
      try { watcher.close(); } catch {}
    }
    
    if (!existsSync(dir)) return;
    
    watcher = watch(dir, { persistent: false }, (event, filename) => {
      if (filename === basename(statePath)) {
        const newState = readStateFile(statePath);
        if (newState) {
          lastState = newState;
          render();
        }
      }
    });
  }
  
  setupWatcher();
  
  // Render loop
  render();
  intervalId = setInterval(() => {
    render();
  }, 80); // ~12.5 fps for smooth spinner
}

main();
