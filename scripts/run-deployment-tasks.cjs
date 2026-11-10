// Run separately gated maintenance tasks after a successful production build.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const scripts = [
  "correct-monitoring-po10077.cjs",
  "update-monitoring-items.cjs",
  "update-monitoring-cbf-source.cjs",
  "provision-jonathan.cjs",
  "repair-monitoring-po10139.cjs",
  "enable-order-monitoring-users.cjs"
];
for (const script of scripts) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
