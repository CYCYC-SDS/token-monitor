'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { safeLog, safeWarn, installSafeStdout } = require('../../src/shared/safeStdio');

test('safeLog coerces non-string args to strings and joins with spaces', () => {
  const original = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    safeLog('hello', 42, { nested: true });
  } finally {
    process.stdout.write = original;
  }
  assert.match(captured, /hello 42 \[object Object\]\n/);
});

test('safeLog swallows EPIPE on the synchronous write path', () => {
  const original = process.stdout.write;
  process.stdout.write = () => {
    const err = new Error('EPIPE');
    err.code = 'EPIPE';
    throw err;
  };
  try {
    assert.doesNotThrow(() => safeLog('ignored'));
  } finally {
    process.stdout.write = original;
  }
});

test('safeLog re-throws non-EPIPE errors so genuine bugs surface', () => {
  const original = process.stdout.write;
  process.stdout.write = () => {
    const err = new Error('disk full');
    err.code = 'ENOSPC';
    throw err;
  };
  try {
    assert.throws(() => safeLog('ignored'), /disk full/);
  } finally {
    process.stdout.write = original;
  }
});

test('safeWarn mirrors safeLog but writes to stderr', () => {
  const original = process.stderr.write;
  let captured = '';
  process.stderr.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    safeWarn('warn', 1);
  } finally {
    process.stderr.write = original;
  }
  assert.match(captured, /warn 1\n/);
});

test('safeWarn swallows EPIPE on stderr', () => {
  const original = process.stderr.write;
  process.stderr.write = () => {
    const err = new Error('EPIPE');
    err.code = 'EPIPE';
    throw err;
  };
  try {
    assert.doesNotThrow(() => safeWarn('ignored'));
  } finally {
    process.stderr.write = original;
  }
});

test('installSafeStdout registers a no-op EPIPE handler on stdout', () => {
  installSafeStdout();
  const handlers = process.stdout.listeners('error');
  assert.ok(handlers.length >= 1, 'stdout should have at least one error listener');
});

test('installSafeStdout re-throws non-EPIPE errors so genuine bugs surface', () => {
  installSafeStdout();
  const handlers = process.stdout.listeners('error');
  const handler = handlers[handlers.length - 1];
  const err = new Error('disk full');
  err.code = 'ENOSPC';
  assert.throws(() => handler(err), /disk full/);
});

test('installSafeStdout is idempotent', () => {
  installSafeStdout();
  const stdoutCount = process.stdout.listeners('error').length;
  installSafeStdout();
  assert.equal(process.stdout.listeners('error').length, stdoutCount);
});