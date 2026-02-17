import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const processes = [];

function startProcess(name, command, args, cwd, env = {}) {
  const proc = spawn(command, args, {
    cwd,
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, ...env },
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => console.log(`[${name}] ${line}`));
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => console.error(`[${name}] ${line}`));
  });

  proc.on('close', (code) => {
    console.log(`[${name}] exited with code ${code}`);
  });

  processes.push(proc);
  return proc;
}

// Start API server
startProcess('api', 'pnpm', ['--filter', '@ctt/server', 'dev'], root);

// Start Next.js frontend (slight delay to let API start first)
setTimeout(() => {
  startProcess('web', 'pnpm', ['dev', '--hostname', '0.0.0.0'], root, { PORT: '3700' });
}, 1000);

// Handle cleanup
function cleanup() {
  console.log('\nShutting down...');
  processes.forEach(proc => {
    try { proc.kill('SIGTERM'); } catch {}
  });
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
