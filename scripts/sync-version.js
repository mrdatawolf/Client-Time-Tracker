/**
 * Sync Version
 *
 * Synchronizes the version number from root package.json to electron-app/package.json.
 * Run automatically before electron:build.
 */

const fs = require('fs');
const path = require('path');

console.log('');
console.log('========================================');
console.log('  Sync Version');
console.log('========================================');

const rootPackagePath = path.join(__dirname, '..', 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
const version = rootPackage.version;

console.log(`  Version: ${version}`);
console.log('========================================');
console.log('');

// Update electron-app/package.json version
const electronPackagePath = path.join(__dirname, '..', 'electron-app', 'package.json');

if (fs.existsSync(electronPackagePath)) {
  const electronPackage = JSON.parse(fs.readFileSync(electronPackagePath, 'utf8'));

  if (electronPackage.version !== version) {
    console.log(`Updating electron-app version from ${electronPackage.version} to ${version}`);
    electronPackage.version = version;
    fs.writeFileSync(electronPackagePath, JSON.stringify(electronPackage, null, 2) + '\n');
    console.log('Version synced successfully');
  } else {
    console.log('Versions already in sync');
  }
} else {
  console.log('Warning: electron-app/package.json not found');
}

console.log('');
