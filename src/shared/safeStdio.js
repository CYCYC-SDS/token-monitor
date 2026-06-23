'use strict';

// console.log is wired to the same stdout stream that npm / Electron inherit
// from the parent shell. When the parent closes its end of the pipe (npm
// detached, terminal closed, log redirected to a non-seekable consumer),
// writing to stdout raises EPIPE — which becomes an unhandled promise
// rejection and pops up a "JavaScript error in the main process" dialog.
// Swallow EPIPE here so background log traffic never surfaces to the user.
function safeLog(...args) {
  try {
    process.stdout.write(`${args.map(String).join(' ')}\n`);
  } catch (err) {
    if (!err || err.code !== 'EPIPE') throw err;
  }
}

function safeWarn(...args) {
  try {
    process.stderr.write(`${args.map(String).join(' ')}\n`);
  } catch (err) {
    if (!err || err.code !== 'EPIPE') throw err;
  }
}

// When process.stdout.write returns false (backpressure) and the parent
// closes the pipe, the EPIPE surfaces asynchronously on the 'error' event.
// Without a listener, that becomes an unhandled 'error' event and Electron
// pops a "JavaScript error in the main process" dialog. Install a one-time
// no-op EPIPE handler so background log traffic never disturbs the user.
function installSafeStdout() {
  if (process.stdout._tokenMonitorEpipeHandled) return;
  process.stdout._tokenMonitorEpipeHandled = true;
  process.stdout.on('error', (err) => {
    if (!err || err.code !== 'EPIPE') throw err;
  });
  // stderr mirrors stdout; install a handler there too for symmetry.
  if (!process.stderr._tokenMonitorEpipeHandled) {
    process.stderr._tokenMonitorEpipeHandled = true;
    process.stderr.on('error', (err) => {
      if (!err || err.code !== 'EPIPE') throw err;
    });
  }
}

module.exports = { safeLog, safeWarn, installSafeStdout };