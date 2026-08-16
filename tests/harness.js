// A test harness small enough to read in one sitting.

const suites = [];
let current = null;

export function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

export function test(name, fn) {
  if (!current) throw new Error('test() outside describe()');
  current.tests.push({ name, fn });
}

export function assert(cond, message = 'assertion failed') {
  if (!cond) throw new Error(message);
}

export function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function deepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message || `expected ${b}, got ${a}`);
}

export function close(actual, expected, tol = 1e-6, message) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(message || `expected ~${expected}, got ${actual}`);
  }
}

export function between(actual, lo, hi, message) {
  if (actual < lo || actual > hi) {
    throw new Error(message || `expected ${actual} within [${lo}, ${hi}]`);
  }
}

export function throws(fn, message = 'expected a throw') {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

export async function runAll() {
  let passed = 0;
  const failures = [];

  for (const suite of suites) {
    const results = [];
    for (const t of suite.tests) {
      try {
        await t.fn();
        passed += 1;
        results.push(`  \x1b[32m✓\x1b[0m ${t.name}`);
      } catch (err) {
        failures.push({ suite: suite.name, test: t.name, err });
        results.push(`  \x1b[31m✗ ${t.name}\x1b[0m`);
      }
    }
    console.log(`\n\x1b[1m${suite.name}\x1b[0m`);
    for (const line of results) console.log(line);
  }

  console.log('');
  if (failures.length) {
    console.log(`\x1b[31m${failures.length} failed\x1b[0m, ${passed} passed\n`);
    for (const f of failures) {
      console.log(`\x1b[31m${f.suite} › ${f.test}\x1b[0m`);
      console.log(`  ${f.err.message}`);
      if (process.env.VERBOSE) console.log(f.err.stack);
    }
    return 1;
  }
  console.log(`\x1b[32mall ${passed} tests passed\x1b[0m\n`);
  return 0;
}
