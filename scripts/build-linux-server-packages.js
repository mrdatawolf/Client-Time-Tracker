/**
 * Linux Server Package Builder
 *
 * Creates RPM (Fedora) and DEB (Debian/Ubuntu) packages for the standalone server.
 * Uses `fpm` to generate native Linux packages from the dist-server/ directory.
 *
 * Run with: pnpm server:installer:linux
 * Prerequisites: pnpm build:standalone must run first
 *
 * Install fpm: gem install fpm
 * On Fedora also: sudo dnf install rpm-build
 * On Debian also: sudo apt install ruby-dev build-essential
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_SERVER_DIR = path.join(ROOT_DIR, 'dist-server');
const STAGING_DIR = path.join(ROOT_DIR, 'temp-linux-build');
const OUTPUT_DIR = path.join(ROOT_DIR, 'dist-electron');

const APP_NAME = 'client-time-tracker-server';
const APP_DESCRIPTION = 'Client Time Tracker - time tracking and invoicing server';
const APP_URL = 'https://github.com/mrdatawolf/Client-Time-Tracker';
const APP_LICENSE = 'MIT';
const INSTALL_DIR = '/opt/client-time-tracker';
const CONFIG_DIR = '/etc/client-time-tracker';
const DATA_DIR = '/var/lib/client-time-tracker';

function getVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  return packageJson.version;
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isSymbolicLink()) {
      const realPath = fs.realpathSync(srcPath);
      if (fs.statSync(realPath).isDirectory()) {
        copyDir(realPath, destPath);
      } else {
        fs.copyFileSync(realPath, destPath);
      }
      continue;
    }

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function createSystemdService(version) {
  return `[Unit]
Description=Client Time Tracker Server v${version}
Documentation=${APP_URL}
After=network.target

[Service]
Type=simple
User=client-time-tracker
Group=client-time-tracker
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/start.cjs
Restart=on-failure
RestartSec=5
EnvironmentFile=-${CONFIG_DIR}/.env

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`;
}

function createPostInstallScript() {
  return `#!/bin/bash
# Create system user if it doesn't exist
if ! id -u client-time-tracker >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin --home-dir ${INSTALL_DIR} client-time-tracker
fi

# Create data directory
mkdir -p ${DATA_DIR}/time-tracker
chown -R client-time-tracker:client-time-tracker ${DATA_DIR}

# Set ownership on install directory
chown -R client-time-tracker:client-time-tracker ${INSTALL_DIR}

# Update .env to point to system data directory
if [ -f ${CONFIG_DIR}/.env ]; then
  # Only update if still using default paths
  sed -i 's|PGLITE_DB_LOCATION=./data/time-tracker|PGLITE_DB_LOCATION=${DATA_DIR}/time-tracker|g' ${CONFIG_DIR}/.env
  sed -i 's|CTT_DATA_DIR=./data|CTT_DATA_DIR=${DATA_DIR}|g' ${CONFIG_DIR}/.env
fi

# Reload systemd
systemctl daemon-reload

# Check for Node.js and provide guidance if missing or old
NODE_VER=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
if [ -z "$NODE_VER" ]; then
  echo ""
  echo "WARNING: Node.js is not found in PATH."
  echo "This server requires Node.js 20 or newer to run."
  echo "Please install it using your package manager (e.g., 'sudo apt install nodejs' or 'sudo dnf install nodejs')."
elif [ "$NODE_VER" -lt 20 ]; then
  echo ""
  echo "WARNING: Found Node.js v$(node -v), but version 20 or newer is required."
  echo "The server may fail to start."
fi

echo ""
echo "========================================"
echo "  Client Time Tracker Server installed!"
echo "========================================"
echo ""
echo "  Command: client-time-tracker-server"
echo "  Service: sudo systemctl start client-time-tracker"
echo "  Enable:  sudo systemctl enable client-time-tracker"
echo "  Config:  ${CONFIG_DIR}/.env"
echo "  Data:    ${DATA_DIR}/"
echo "  Logs:    journalctl -u client-time-tracker"
echo ""
echo "  Web UI:  http://localhost:3700"
echo "  API:     http://localhost:3701"
echo "========================================"
echo ""
`;
}

function createPreInstallScript() {
  return `#!/bin/bash
# Check for Node.js 20+
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -lt 20 ]; then
    echo "Warning: Node.js version 20 or higher is recommended (found v$(node -v))."
  fi
fi
`;
}

function createPreUninstallScript() {
  return `#!/bin/bash
# Stop the service if running
if systemctl is-active --quiet client-time-tracker 2>/dev/null; then
  systemctl stop client-time-tracker
fi
if systemctl is-enabled --quiet client-time-tracker 2>/dev/null; then
  systemctl disable client-time-tracker
fi
`;
}

function createPostUninstallScript() {
  return `#!/bin/bash
systemctl daemon-reload

echo ""
echo "Client Time Tracker Server has been removed."
echo "Note: Data directory preserved at ${DATA_DIR}/"
echo "      Config preserved at ${CONFIG_DIR}/"
echo "      Remove manually if no longer needed."
echo ""
`;
}

/**
 * Detect the Linux distribution family.
 * Returns 'fedora', 'debian', or 'unknown'.
 */
function detectDistro() {
  try {
    const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
    const idLine = osRelease.split('\n').find(l => l.startsWith('ID='));
    const idLikeLine = osRelease.split('\n').find(l => l.startsWith('ID_LIKE='));
    const id = idLine ? idLine.split('=')[1].replace(/"/g, '').trim() : '';
    const idLike = idLikeLine ? idLikeLine.split('=')[1].replace(/"/g, '').trim() : '';

    if (['fedora', 'rhel', 'centos', 'rocky', 'alma'].includes(id) || idLike.includes('fedora') || idLike.includes('rhel')) {
      return 'fedora';
    }
    if (['debian', 'ubuntu', 'linuxmint', 'pop'].includes(id) || idLike.includes('debian') || idLike.includes('ubuntu')) {
      return 'debian';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Check if a command exists on the system.
 */
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run all prerequisite checks and return a list of problems.
 * Each problem has { tool, message, fix }.
 */
function runPreChecks() {
  const distro = detectDistro();
  const problems = [];

  // Check: running on Linux
  if (process.platform !== 'linux') {
    problems.push({
      tool: 'Linux',
      message: 'This script must be run on a Linux system.',
      fix: 'Run this build on a Linux machine or inside a Linux container/VM.',
    });
    return { distro, problems }; // No point checking further
  }

  // Check: Ruby (required for fpm)
  if (!commandExists('ruby')) {
    problems.push({
      tool: 'ruby',
      message: 'Ruby is required to run fpm.',
      fix: distro === 'fedora'
        ? 'sudo dnf install ruby ruby-devel'
        : distro === 'debian'
          ? 'sudo apt install ruby ruby-dev'
          : 'Install Ruby using your package manager.',
    });
  }

  // Check: gem (Ruby package manager)
  if (!commandExists('gem')) {
    problems.push({
      tool: 'gem',
      message: 'RubyGems is required to install fpm.',
      fix: distro === 'fedora'
        ? 'sudo dnf install rubygems'
        : distro === 'debian'
          ? 'sudo apt install rubygems'
          : 'Install RubyGems using your package manager.',
    });
  }

  // Check: fpm
  if (!commandExists('fpm')) {
    problems.push({
      tool: 'fpm',
      message: 'fpm (Effing Package Management) is required to build packages.',
      fix: 'gem install fpm',
    });
  }

  // Check: rpmbuild (needed for RPM output)
  if (!commandExists('rpmbuild')) {
    problems.push({
      tool: 'rpmbuild',
      message: 'rpmbuild is required to create RPM packages.',
      fix: distro === 'fedora'
        ? 'sudo dnf install rpm-build'
        : distro === 'debian'
          ? 'sudo apt install rpm'
          : 'Install rpm-build using your package manager.',
    });
  }

  // Check: dpkg-deb (needed for DEB output)
  if (!commandExists('dpkg-deb')) {
    problems.push({
      tool: 'dpkg-deb',
      message: 'dpkg-deb is required to create DEB packages.',
      fix: distro === 'fedora'
        ? 'sudo dnf install dpkg'
        : distro === 'debian'
          ? 'Already included with dpkg (should be pre-installed).'
          : 'Install dpkg using your package manager.',
    });
  }

  // Check: build tools (gcc/make — needed by some fpm gem native extensions)
  if (!commandExists('gcc') || !commandExists('make')) {
    problems.push({
      tool: 'build tools',
      message: 'C compiler and make are needed to install fpm native extensions.',
      fix: distro === 'fedora'
        ? 'sudo dnf groupinstall "Development Tools"'
        : distro === 'debian'
          ? 'sudo apt install build-essential'
          : 'Install gcc and make using your package manager.',
    });
  }

  return { distro, problems };
}

function buildPackage(format, version) {
  const outputFile = format === 'rpm'
    ? `${APP_NAME}-${version}-1.x86_64.rpm`
    : `${APP_NAME}_${version}_amd64.deb`;

  const depFlag = format === 'rpm'
    ? '--depends "nodejs >= 20"'
    : '--depends "nodejs (>= 20)"';

  const configFlag = `--config-files ${CONFIG_DIR}/.env`;

  const cmd = [
    'fpm',
    `-s dir`,
    `-t ${format}`,
    `--name ${APP_NAME}`,
    `--version ${version}`,
    `--architecture x86_64`,
    `--description "${APP_DESCRIPTION}"`,
    `--url "${APP_URL}"`,
    `--license "${APP_LICENSE}"`,
    `--maintainer "Lost Coast IT"`,
    depFlag,
    configFlag,
    `--before-install ${path.join(STAGING_DIR, 'scripts', 'pre-install.sh')}`,
    `--after-install ${path.join(STAGING_DIR, 'scripts', 'post-install.sh')}`,
    `--before-remove ${path.join(STAGING_DIR, 'scripts', 'pre-uninstall.sh')}`,
    `--after-remove ${path.join(STAGING_DIR, 'scripts', 'post-uninstall.sh')}`,
    `--package ${path.join(OUTPUT_DIR, outputFile)}`,
    `-C ${path.join(STAGING_DIR, 'root')}`,
    '.',
  ].join(' ');

  console.log(`Building ${format.toUpperCase()} package...`);
  execSync(cmd, { stdio: 'inherit' });
  console.log(`  Created: ${outputFile}`);

  return outputFile;
}

async function build() {
  const version = getVersion();

  console.log('');
  console.log('========================================');
  console.log('  Linux Server Package Builder');
  console.log('========================================');
  console.log(`  Version: ${version}`);
  console.log(`  Formats: RPM (Fedora), DEB (Debian)`);
  console.log('========================================');
  console.log('');

  // Check dist-server exists
  if (!fs.existsSync(DIST_SERVER_DIR)) {
    console.error('Error: dist-server not found. Run "pnpm build:standalone" first.');
    process.exit(1);
  }

  // Run prerequisite checks
  console.log('Checking prerequisites...');
  const { distro, problems } = runPreChecks();
  const distroLabel = distro === 'fedora' ? 'Fedora/RHEL'
    : distro === 'debian' ? 'Debian/Ubuntu'
    : 'Unknown distro';
  console.log(`  Detected: ${distroLabel}`);

  if (problems.length > 0) {
    console.error('');
    console.error('========================================');
    console.error('  Missing prerequisites');
    console.error('========================================');
    console.error('');

    for (const p of problems) {
      console.error(`  [MISSING] ${p.tool}`);
      console.error(`    ${p.message}`);
      console.error(`    Fix: ${p.fix}`);
      console.error('');
    }

    // Provide a one-liner install command for convenience
    if (distro === 'fedora') {
      console.error('  Quick setup (Fedora):');
      console.error('    sudo dnf install ruby ruby-devel rpm-build dpkg gcc make');
      console.error('    gem install fpm');
    } else if (distro === 'debian') {
      console.error('  Quick setup (Debian/Ubuntu):');
      console.error('    sudo apt install ruby ruby-dev build-essential rpm');
      console.error('    gem install fpm');
    } else {
      console.error('  Install ruby, gcc, make, rpm-build, and dpkg for your distro,');
      console.error('  then run: gem install fpm');
    }

    console.error('');
    console.error('========================================');
    console.error('');
    process.exit(1);
  }

  console.log('  All prerequisites satisfied.');

  // Clean staging directory
  console.log('Preparing staging directory...');
  cleanDir(STAGING_DIR);

  // Create FHS directory structure
  const rootDir = path.join(STAGING_DIR, 'root');
  const appDir = path.join(rootDir, 'opt', 'client-time-tracker');
  const binDir = path.join(rootDir, 'usr', 'bin');
  const configDir = path.join(rootDir, 'etc', 'client-time-tracker');
  const systemdDir = path.join(rootDir, 'usr', 'lib', 'systemd', 'system');
  const dataDir = path.join(rootDir, 'var', 'lib', 'client-time-tracker', 'time-tracker');
  const scriptsDir = path.join(STAGING_DIR, 'scripts');

  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(systemdDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });

  // Copy dist-server contents to /opt/client-time-tracker/
  console.log('Copying server files...');
  copyDir(DIST_SERVER_DIR, appDir);

  // Create symlink in /usr/bin/
  console.log('Creating symlink in /usr/bin...');
  try {
    // Relative symlink for the package: /usr/bin/x -> ../../opt/client-time-tracker/start-server.sh
    fs.symlinkSync('../../opt/client-time-tracker/start-server.sh', path.join(binDir, 'client-time-tracker-server'));
  } catch (err) {
    console.warn('Warning: Could not create symlink:', err.message);
  }

  // Move .env to /etc/client-time-tracker/ and symlink it
  const appEnvPath = path.join(appDir, '.env');
  const configEnvPath = path.join(configDir, '.env');
  if (fs.existsSync(appEnvPath)) {
    fs.copyFileSync(appEnvPath, configEnvPath);
    fs.unlinkSync(appEnvPath);
    // Create symlink from app dir to config dir
    fs.symlinkSync(path.join(CONFIG_DIR, '.env'), appEnvPath);
  }

  // Remove Windows-specific files
  const windowsFiles = ['start-server.bat'];
  for (const file of windowsFiles) {
    const filePath = path.join(appDir, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // Create systemd service
  console.log('Creating systemd service...');
  fs.writeFileSync(
    path.join(systemdDir, 'client-time-tracker.service'),
    createSystemdService(version)
  );

  // Create package scripts
  console.log('Creating package scripts...');
  fs.writeFileSync(path.join(scriptsDir, 'pre-install.sh'), createPreInstallScript());
  fs.writeFileSync(path.join(scriptsDir, 'post-install.sh'), createPostInstallScript());
  fs.writeFileSync(path.join(scriptsDir, 'pre-uninstall.sh'), createPreUninstallScript());
  fs.writeFileSync(path.join(scriptsDir, 'post-uninstall.sh'), createPostUninstallScript());
  fs.chmodSync(path.join(scriptsDir, 'pre-install.sh'), 0o755);
  fs.chmodSync(path.join(scriptsDir, 'post-install.sh'), 0o755);
  fs.chmodSync(path.join(scriptsDir, 'pre-uninstall.sh'), 0o755);
  fs.chmodSync(path.join(scriptsDir, 'post-uninstall.sh'), 0o755);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Build RPM (Fedora first)
  let rpmFile, debFile;
  try {
    rpmFile = buildPackage('rpm', version);
  } catch (err) {
    console.error('Warning: RPM build failed:', err.message);
    console.error('  You may need: sudo dnf install rpm-build');
  }

  // Build DEB
  try {
    debFile = buildPackage('deb', version);
  } catch (err) {
    console.error('Warning: DEB build failed:', err.message);
    console.error('  You may need: sudo apt install ruby-dev build-essential');
  }

  console.log('');
  console.log('========================================');
  console.log('  Linux packages created!');
  console.log('========================================');
  console.log(`  Version: ${version}`);
  if (rpmFile) console.log(`  RPM: ${OUTPUT_DIR}/${rpmFile}`);
  if (debFile) console.log(`  DEB: ${OUTPUT_DIR}/${debFile}`);
  console.log('');
  console.log('  Install (Fedora):');
  console.log(`    sudo dnf install ./${rpmFile || 'client-time-tracker-server-*.rpm'}`);
  console.log('');
  console.log('  Install (Debian/Ubuntu):');
  console.log(`    sudo dpkg -i ./${debFile || 'client-time-tracker-server_*.deb'}`);
  console.log('');
  console.log('  Then:');
  console.log('    sudo systemctl enable --now client-time-tracker');
  console.log('========================================');
  console.log('');

  // Cleanup
  console.log('Cleaning up...');
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
}

build().catch(console.error);
