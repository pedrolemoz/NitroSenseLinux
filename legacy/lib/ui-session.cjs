const crypto = require('node:crypto');
const fs = require('node:fs');
const readline = require('node:readline');

// Emit categories only: Acer logs can contain push credentials and cookies.
function sessionAccumulator(exitCodeText) {
  const exitText = exitCodeText === null ? null : String(exitCodeText).trim();
  if (exitText !== null && !/^(0|[1-9]\d{0,2})$/.test(exitText)) {
    throw new Error('Invalid exit-code.txt');
  }
  const exitCode = exitText === null ? null : Number(exitText);
  if (exitCode > 255) throw new Error('Invalid exit-code.txt');
  const events = [];
  const names = new Map([
    ['[compat-window] close requested', 'window-close-requested'],
    ['[compat-window] closed', 'window-closed'],
    ['[compat-app] before-quit', 'app-before-quit'],
    ['[compat-app] will-quit', 'app-will-quit'],
  ]);
  let preloadFailed = false;
  let missingRemote = false, undefinedClose = false, sigintRecorded = false, sandboxHelperFailed = false;
  const diagnostics = { rpcQueueLimitLines: 0, rpcTimeoutLines: 0, accessDeniedLines: 0, missingPreloadListLines: 0 };
  function addLine(line) {
    const name = names.get(line.trim());
    if (name && events.length < 256) events.push(name);
    if (line.startsWith('[compat-renderer] preload failed:')) preloadFailed = true;
    missingRemote ||= /Cannot find module ['"]@electron\/remote['"]/.test(line);
    undefinedClose ||= /Cannot read propert(?:y|ies)[^\r\n]*undefined[^\r\n]*close/.test(line);
    sigintRecorded ||= /\bSIGINT\b/.test(line);
    sandboxHelperFailed ||= line.includes('setuid_sandbox_host.cc') && line.includes('not configured correctly');
    if (line.includes('ERR_NITROSENSE_RPC_QUEUE_LIMIT')) diagnostics.rpcQueueLimitLines++;
    if (line.includes('ERR_NITROSENSE_RPC_TIMEOUT')) diagnostics.rpcTimeoutLines++;
    if (/\bEACCES\b/.test(line)) diagnostics.accessDeniedLines++;
    if (/Cannot read properties of undefined \(reading 'PreloadList'\)/.test(line)) diagnostics.missingPreloadListLines++;
  }
  function result(sha256) { return {
    schemaVersion: 1,
    launchLogSha256: sha256,
    exitCode,
    processOutcome: exitCode === null ? 'exit-not-recorded' :
      exitCode === 0 ? 'exited-zero' : 'exited-nonzero',
    events,
    issues: {
      preloadFailed,
      missingRemote, undefinedClose, sigintRecorded, sandboxHelperFailed,
    },
    diagnostics,
    // Neither an exit code nor a lifecycle event establishes which UI action was used.
    guiCloseConfirmed: false,
    limitation: 'Lifecycle observations only. Confirm GUI close with the operator; missing exit code does not establish whether the process is still running.',
  }; }
  return { addLine, result };
}

function summarizeUiSession(log, exitCodeText = null) {
  const state = sessionAccumulator(exitCodeText);
  const text = Buffer.isBuffer(log) ? log.toString('utf8') : String(log);
  for (const line of text.split(/\r?\n/)) state.addLine(line);
  return state.result(crypto.createHash('sha256').update(log).digest('hex'));
}

async function summarizeUiSessionFile(filename, exitCodeText = null) {
  const state = sessionAccumulator(exitCodeText);
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(filename);
  input.on('data', chunk => hash.update(chunk));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) state.addLine(line);
    return state.result(hash.digest('hex'));
  } finally { lines.close(); input.destroy(); }
}

module.exports = { summarizeUiSession, summarizeUiSessionFile };
