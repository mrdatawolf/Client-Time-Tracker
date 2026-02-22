; Custom NSIS hooks for Client Time Tracker
; Note: The main app-running check is patched via scripts/patch-nsis-template.js
; These macros provide additional safety.

!macro customInit
  ; Force-kill the app before install/upgrade as a safety net
  nsExec::ExecToLog 'taskkill /F /IM "Client Time Tracker.exe"'
  Sleep 1000

  ; If a previous installation exists, offer to remove it first.
  ; This avoids "app is still running" errors from the OLD uninstaller
  ; whose PowerShell-based process check false-triggers on file handles
  ; held by antivirus, Explorer, or other system processes.
  IfFileExists "$INSTDIR\Client Time Tracker.exe" 0 skipClean
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "An existing installation was detected at:$\r$\n$INSTDIR$\r$\n$\r$\nWould you like to remove it first? (Recommended for upgrades)$\r$\n$\r$\nThis only removes program files. Your database and settings (in AppData\Roaming) are not affected." \
      IDNO skipClean
    RMDir /r "$INSTDIR"
    Sleep 500
  skipClean:
!macroend

!macro customUnInit
  ; Force-kill the app before uninstall
  nsExec::ExecToLog 'taskkill /F /IM "Client Time Tracker.exe"'
  Sleep 1000
!macroend
