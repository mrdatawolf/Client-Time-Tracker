/**
 * Patch electron-builder's NSIS template to skip the app-running check.
 *
 * The default _CHECK_APP_RUNNING macro uses PowerShell to find ANY process
 * whose path starts with $INSTDIR. This falsely triggers when file handles
 * are held by antivirus, Explorer, or leftover child processes — even when
 * the app itself is not running. Since we already force-kill the app via
 * taskkill in customInit, we can safely skip the built-in check.
 *
 * This script patches allowOnlyOneInstallerInstance.nsh in node_modules
 * before electron-builder runs. It's idempotent (safe to run multiple times).
 */

const fs = require('fs');
const path = require('path');

const templatePath = path.join(
  __dirname, '..', 'node_modules', 'app-builder-lib',
  'templates', 'nsis', 'include', 'allowOnlyOneInstallerInstance.nsh'
);

if (!fs.existsSync(templatePath)) {
  console.log('[patch-nsis] Template not found, skipping (not on Windows?)');
  process.exit(0);
}

let content = fs.readFileSync(templatePath, 'utf8');

const PATCH_MARKER = '; PATCHED BY CLIENT-TIME-TRACKER';

if (content.includes(PATCH_MARKER)) {
  console.log('[patch-nsis] Template already patched, skipping.');
  process.exit(0);
}

// 1. Remove the getProcessInfo.nsh include and Var pid declaration.
//    Our patched _CHECK_APP_RUNNING doesn't use _GetProcessInfo, so leaving it
//    causes NSIS warning 6010 "uninstall function not referenced" which
//    electron-builder treats as an error.
content = content.replace(
  /!ifmacrondef customCheckAppRunning\s*\n\s*!include "getProcessInfo\.nsh"\s*\n\s*Var pid\s*\n!endif/,
  `; getProcessInfo.nsh include removed by patch (unused after _CHECK_APP_RUNNING replacement)`
);

// 2. Replace the _CHECK_APP_RUNNING macro body to just do a force-kill and proceed.
const macroStart = content.indexOf('!macro _CHECK_APP_RUNNING');
const macroEnd = content.indexOf('!macroend', macroStart);

if (macroStart === -1 || macroEnd === -1) {
  console.error('[patch-nsis] Could not locate macro boundaries!');
  process.exit(1);
}

const replacement = `!macro _CHECK_APP_RUNNING ${PATCH_MARKER}
  ; Force-kill the app exe if running, then proceed without blocking
  nsExec::ExecToLog 'taskkill /F /IM "\${APP_EXECUTABLE_FILENAME}"'
  Sleep 1500
!macroend`;

content = content.substring(0, macroStart) + replacement + content.substring(macroEnd + '!macroend'.length);

fs.writeFileSync(templatePath, content, 'utf8');
console.log('[patch-nsis] Successfully patched _CHECK_APP_RUNNING and removed unused getProcessInfo include.');
