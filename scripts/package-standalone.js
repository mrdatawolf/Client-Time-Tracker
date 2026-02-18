/**
 * Package Standalone Server
 *
 * Assembles the dist-server/ directory with everything needed to run the app:
 * - web/          Next.js standalone server
 * - api-server.js Bundled Hono API server (created by bundle-api-server.js)
 * - node_modules/ External packages (PGlite, pg, pdfkit)
 * - start.js      Process manager that launches both servers
 * - .env          Default configuration
 * - start-server.bat  Windows launcher
 *
 * Run with: pnpm build:standalone
 * Prerequisites: pnpm build (Next.js) and pnpm build:server (esbuild) must run first
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist-server');
// Next.js standalone may be flat or nested under the project name
const STANDALONE_DIR_NESTED = path.join(ROOT_DIR, '.next', 'standalone', 'client-time-tracker');
const STANDALONE_DIR_FLAT = path.join(ROOT_DIR, '.next', 'standalone');
const STANDALONE_DIR = fs.existsSync(path.join(STANDALONE_DIR_NESTED, 'server.js'))
  ? STANDALONE_DIR_NESTED
  : STANDALONE_DIR_FLAT;
const STATIC_DIR = path.join(ROOT_DIR, '.next', 'static');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const API_BUNDLE = path.join(DIST_DIR, 'api-server.js');

// Windows reserved device names that cause NSIS build failures
const EXCLUDE_FILES = ['nul', 'con', 'prn', 'aux'];

// Folders to skip when copying
const EXCLUDE_FOLDERS = [
  'dist-electron', 'dist-server', '.node-portable', 'temp-server-build',
  'distribute', 'distribute_server', 'electron-app', '.git',
];

function getVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  return packageJson.version;
}

function copyDir(src, dest, excludeFolders = []) {
  if (!fs.existsSync(src)) {
    console.warn(`  Warning: Source not found: ${src}`);
    return;
  }
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip symlinks (pnpm uses them heavily)
    if (entry.isSymbolicLink()) {
      // Resolve and copy the real directory/file instead
      const realPath = fs.realpathSync(srcPath);
      if (fs.statSync(realPath).isDirectory()) {
        copyDir(realPath, destPath, excludeFolders);
      } else {
        fs.copyFileSync(realPath, destPath);
      }
      continue;
    }

    if (entry.isDirectory() && excludeFolders.includes(entry.name)) continue;
    if (!entry.isDirectory() && EXCLUDE_FILES.includes(entry.name.toLowerCase())) continue;

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, excludeFolders);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Resolve a pnpm node_modules path to the real directory (through .pnpm symlinks)
 */
function resolvePackagePath(packageName) {
  const candidates = [
    path.join(ROOT_DIR, 'node_modules', packageName),
    path.join(ROOT_DIR, 'packages', 'shared', 'node_modules', packageName),
    path.join(ROOT_DIR, 'packages', 'server', 'node_modules', packageName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.realpathSync(candidate);
    }
  }
  return null;
}

function main() {
  const version = getVersion();

  console.log('');
  console.log('========================================');
  console.log('  Package Standalone Server');
  console.log(`  Version: ${version}`);
  console.log('========================================');
  console.log('');

  // Verify prerequisites
  if (!fs.existsSync(path.join(STANDALONE_DIR, 'server.js'))) {
    console.error('Error: Next.js standalone build not found. Expected server.js in:', STANDALONE_DIR);
    console.error('Run "pnpm build" first.');
    process.exit(1);
  }
  console.log('Using standalone dir:', STANDALONE_DIR);

  if (!fs.existsSync(API_BUNDLE)) {
    console.error('Error: API server bundle not found at:', API_BUNDLE);
    console.error('Run "pnpm build:server" first.');
    process.exit(1);
  }

  // Clean and recreate dist-server (preserve api-server.js which was created by build:server)
  const webDir = path.join(DIST_DIR, 'web');
  if (fs.existsSync(webDir)) {
    fs.rmSync(webDir, { recursive: true, force: true });
  }

  // 1. Copy Next.js standalone to dist-server/web/
  console.log('Copying Next.js standalone server...');
  copyDir(STANDALONE_DIR, webDir, EXCLUDE_FOLDERS);

  // 2. Copy .next/static to dist-server/web/.next/static
  console.log('Copying static assets...');
  const distStaticDir = path.join(webDir, '.next', 'static');
  if (!fs.existsSync(distStaticDir)) {
    fs.mkdirSync(distStaticDir, { recursive: true });
  }
  copyDir(STATIC_DIR, distStaticDir);

  // 3. Copy public/ to dist-server/web/public/
  if (fs.existsSync(PUBLIC_DIR)) {
    console.log('Copying public folder...');
    copyDir(PUBLIC_DIR, path.join(webDir, 'public'));
  }

  // 4. Copy external node_modules (packages that can't be bundled by esbuild)
  console.log('Copying external packages...');
  const nodeModulesDir = path.join(DIST_DIR, 'node_modules');
  if (fs.existsSync(nodeModulesDir)) {
    fs.rmSync(nodeModulesDir, { recursive: true, force: true });
  }
  fs.mkdirSync(nodeModulesDir, { recursive: true });

  // Complete list of external packages + all transitive dependencies
  // Generated by scripts/find-all-deps.js — update if adding new externals
  const externalPackages = [
    '@electric-sql/pglite',
    '@swc/helpers',
    'base64-js',
    'brotli',
    'buffer-writer',
    'clone',
    'crypto-js',
    'dfa',
    'fast-deep-equal',
    'fontkit',
    'jpeg-exif',
    'linebreak',
    'packet-reader',
    'pako',
    'pdfkit',
    'pg',
    'pg-connection-string',
    'pg-int8',
    'pg-pool',
    'pg-protocol',
    'pg-types',
    'pgpass',
    'png-js',
    'postgres-array',
    'postgres-bytea',
    'postgres-date',
    'postgres-interval',
    'postgres-range',
    'restructure',
    'split2',
    'tiny-inflate',
    'tslib',
    'unicode-properties',
    'unicode-trie',
    'xtend',
  ];

  for (const pkg of externalPackages) {
    const realPath = resolvePackagePath(pkg);
    if (realPath) {
      // Create the right nested directory structure
      const destPath = path.join(nodeModulesDir, pkg);
      copyDir(realPath, destPath);
      console.log(`  Copied: ${pkg}`);
    } else {
      // Not all packages may be present (some are optional)
      console.log(`  Skipped (not found): ${pkg}`);
    }
  }

  // 5. Create data directory placeholder
  console.log('Creating data directory...');
  const dataDir = path.join(DIST_DIR, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const timeTrackerDir = path.join(dataDir, 'time-tracker');
  if (!fs.existsSync(timeTrackerDir)) {
    fs.mkdirSync(timeTrackerDir, { recursive: true });
  }

  // 6. Create .env file
  console.log('Creating .env file...');
  const envContent = `# ============================================
# CLIENT TIME TRACKER SERVER CONFIGURATION
# ============================================

# Server Configuration
API_PORT=3701
PORT=3700
HOSTNAME=0.0.0.0
NODE_ENV=production

# Authentication
JWT_SECRET=CHANGE-THIS-TO-A-RANDOM-SECRET

# Database Location (PGlite embedded PostgreSQL)
PGLITE_DB_LOCATION=./data/time-tracker

# Data Directory (for Supabase config and other data files)
CTT_DATA_DIR=./data
`;
  fs.writeFileSync(path.join(DIST_DIR, '.env'), envContent);

  // 6b. Create package.json to mark dist-server as ESM (for api-server.js)
  fs.writeFileSync(path.join(DIST_DIR, 'package.json'), JSON.stringify({
    name: 'client-time-tracker-server',
    version: version,
    type: 'module',
    private: true
  }, null, 2) + '\n');

  // 7. Create start.js (process manager)
  console.log('Creating start.js...');
  const startJs = `// Client Time Tracker - Server Process Manager
// Starts both the API server and web server
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Load .env file manually (no dotenv dependency)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

// Set defaults
process.env.API_PORT = process.env.API_PORT || '3701';
process.env.PORT = process.env.PORT || '3700';
process.env.HOSTNAME = process.env.HOSTNAME || '0.0.0.0';
process.env.PGLITE_DB_LOCATION = process.env.PGLITE_DB_LOCATION || path.join(__dirname, 'data', 'time-tracker');
process.env.CTT_DATA_DIR = process.env.CTT_DATA_DIR || path.join(__dirname, 'data');
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

console.log('');
console.log('========================================');
console.log('  Client Time Tracker Server');
console.log('========================================');
console.log('');
console.log('  API Server:  http://localhost:' + process.env.API_PORT);
console.log('  Web App:     http://localhost:' + process.env.PORT);
console.log('  Database:    ' + process.env.PGLITE_DB_LOCATION);
console.log('');
console.log('  Press Ctrl+C to stop');
console.log('========================================');
console.log('');

const children = [];

// Start API server (ESM module, must use spawn not fork)
const apiServer = spawn(process.execPath, [path.join(__dirname, 'api-server.js')], {
  cwd: __dirname,
  env: process.env,
  stdio: 'inherit'
});
children.push(apiServer);

apiServer.on('error', (err) => console.error('API server error:', err));
apiServer.on('exit', (code) => console.log('API server exited with code', code));

// Start web server
const webServer = spawn(process.execPath, [path.join(__dirname, 'web', 'server.js')], {
  cwd: path.join(__dirname, 'web'),
  env: process.env,
  stdio: 'inherit'
});
children.push(webServer);

webServer.on('error', (err) => console.error('Web server error:', err));
webServer.on('exit', (code) => console.log('Web server exited with code', code));

// Cleanup on exit
function cleanup() {
  console.log('\\nShutting down...');
  children.forEach(child => {
    try { child.kill('SIGTERM'); } catch {}
  });
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
`;
  fs.writeFileSync(path.join(DIST_DIR, 'start.cjs'), startJs);

  // 8. Create start-server.sh (Linux launcher)
  console.log('Creating start-server.sh...');
  const shContent = `#!/bin/bash
echo ""
echo "========================================"
echo "  Client Time Tracker Server"
echo "  Version: ${version}"
echo "========================================"
echo ""
echo "  Starting servers..."
echo "    API:  http://localhost:3701"
echo "    Web:  http://localhost:3700"
echo ""
echo "  Press Ctrl+C to stop"
echo "========================================"
echo ""

cd "$(dirname "$0")"
node start.cjs
`;
  fs.writeFileSync(path.join(DIST_DIR, 'start-server.sh'), shContent, { mode: 0o755 });

  // 9. Create start-server.bat
  console.log('Creating start-server.bat...');
  const batContent = `@echo off
title Client Time Tracker Server v${version}
echo.
echo ========================================
echo   Client Time Tracker Server
echo   Version: ${version}
echo ========================================
echo.
echo Starting servers...
echo   API:  http://localhost:3701
echo   Web:  http://localhost:3700
echo.
echo Press Ctrl+C to stop
echo ========================================
echo.

node start.cjs

pause
`;
  fs.writeFileSync(path.join(DIST_DIR, 'start-server.bat'), batContent);

  console.log('');
  console.log('========================================');
  console.log('  Standalone package created!');
  console.log('========================================');
  console.log(`  Version: ${version}`);
  console.log(`  Output:  dist-server/`);
  console.log('========================================');
  console.log('');
  console.log('To test: cd dist-server && node start.cjs');
  console.log('');
}

main();
