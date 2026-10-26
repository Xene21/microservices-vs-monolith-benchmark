// Copies the shared modules into every service so each Docker build context
// is self-contained. Run after editing anything in /shared:  node scripts/sync-shared.js
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const targets = [
  'gateway',
  'services/auth-service',
  'services/course-service',
  'services/results-service',
  'services/payment-service',
  'monolith',
];
for (const t of targets) {
  const dest = path.join(root, t, 'src', 'shared');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(path.join(root, 'shared'))) {
    fs.copyFileSync(path.join(root, 'shared', f), path.join(dest, f));
  }
  console.log(`synced shared/ -> ${t}/src/shared`);
}
