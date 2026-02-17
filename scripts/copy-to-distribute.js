/**
 * Copy to Distribute
 *
 * Copies the built exe files to distribution folders.
 * - Client setup → distribute/
 * - Server setup → distribute_server/
 *
 * Used as the final step of build:all to collect distribution artifacts.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_ELECTRON_DIR = path.join(ROOT_DIR, 'dist-electron');
const DISTRIBUTE_DIR = path.join(ROOT_DIR, 'distribute');
const DISTRIBUTE_SERVER_DIR = path.join(ROOT_DIR, 'distribute_server');

function getPackageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  return packageJson.version;
}

function main() {
  const version = getPackageVersion();

  console.log('');
  console.log('========================================');
  console.log('  Copy to Distribute');
  console.log('========================================');
  console.log(`  Version: ${version}`);
  console.log('');

  if (!fs.existsSync(DIST_ELECTRON_DIR)) {
    console.log('Warning: dist-electron not found, nothing to copy');
    return;
  }

  const files = fs.readdirSync(DIST_ELECTRON_DIR);

  // Find and copy client Setup exe (does NOT contain "Server")
  const clientSetupExe = files.find(f => f.endsWith('.exe') && f.includes('Setup') && !f.includes('Server'));

  if (clientSetupExe) {
    if (!fs.existsSync(DISTRIBUTE_DIR)) {
      fs.mkdirSync(DISTRIBUTE_DIR, { recursive: true });
    }

    const srcPath = path.join(DIST_ELECTRON_DIR, clientSetupExe);
    const destFileName = `Client-Time-Tracker-${version}-Setup.exe`;
    const destPath = path.join(DISTRIBUTE_DIR, destFileName);

    fs.copyFileSync(srcPath, destPath);
    console.log(`Client: ${destFileName}`);
    console.log(`  -> ${DISTRIBUTE_DIR}`);
  } else {
    console.log('Warning: No client Setup exe found in dist-electron');
  }

  // Find and copy server Setup exe (contains "Server")
  const serverSetupExe = files.find(f => f.endsWith('.exe') && f.includes('Server') && f.includes('Setup'));

  if (serverSetupExe) {
    if (!fs.existsSync(DISTRIBUTE_SERVER_DIR)) {
      fs.mkdirSync(DISTRIBUTE_SERVER_DIR, { recursive: true });
    }

    const srcPath = path.join(DIST_ELECTRON_DIR, serverSetupExe);
    const destFileName = `Client-Time-Tracker-Server-${version}-Setup.exe`;
    const destPath = path.join(DISTRIBUTE_SERVER_DIR, destFileName);

    fs.copyFileSync(srcPath, destPath);
    console.log(`Server: ${destFileName}`);
    console.log(`  -> ${DISTRIBUTE_SERVER_DIR}`);
  } else {
    console.log('Warning: No server Setup exe found in dist-electron');
  }

  console.log('');
  console.log('========================================');
  console.log('  Distribution complete!');
  console.log('========================================');
  console.log('');
}

main();
