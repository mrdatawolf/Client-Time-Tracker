/**
 * Build Next.js for Electron packaging.
 *
 * Forces NEXT_PUBLIC_API_URL=http://localhost:3701 so the bundled frontend
 * always calls the local API server that Electron starts on each machine,
 * regardless of what .env.local contains (which may have a LAN IP for dev use).
 */

const { spawnSync } = require('child_process');

const env = {
  ...process.env,
  NEXT_PUBLIC_API_URL: 'http://localhost:3701',
};

const result = spawnSync('pnpm', ['run', 'build'], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
