// Test entry point: node tests/run.js  (or npm test)

import { runAll } from './harness.js';

await import('./craft.test.js');
await import('./world.test.js');
await import('./battle.test.js');
await import('./minigames.test.js');
await import('./soak.test.js');
await import('./autopilot.test.js');
await import('./chem.test.js');
await import('./clocks.test.js');
await import('./ornament.test.js');
await import('./portraits.test.js');

process.exit(await runAll());
