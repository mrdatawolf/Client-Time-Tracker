; Custom NSIS hooks for Client Time Tracker
; Note: The main app-running check is patched via scripts/patch-nsis-template.js
; These macros provide additional safety.

!macro customInit
  ; Force-kill the app before install/upgrade as a safety net
  nsExec::ExecToLog 'taskkill /F /IM "Client Time Tracker.exe"'
  Sleep 1000

  ; If a previous installation exists, offer to remove program files first.
  ; This avoids "app is still running" errors from the OLD uninstaller
  ; whose PowerShell-based process check false-triggers on file handles
  ; held by antivirus, Explorer, or other system processes.
  ; IMPORTANT: Never use RMDir /r on $INSTDIR — it would destroy the data/ folder
  ; if data hasn't been migrated to AppData yet. Instead, remove only known program dirs.
  IfFileExists "$INSTDIR\Client Time Tracker.exe" 0 skipClean
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "An existing installation was detected at:$\r$\n$INSTDIR$\r$\n$\r$\nWould you like to remove it first? (Recommended for upgrades)$\r$\n$\r$\nThis only removes program files. Your database and settings are preserved." \
      IDNO skipClean
    ; Remove only known program files/dirs — preserve data/ and data-migrated/
    RMDir /r "$INSTDIR\resources"
    RMDir /r "$INSTDIR\locales"
    RMDir /r "$INSTDIR\swiftshader"
    Delete "$INSTDIR\Client Time Tracker.exe"
    Delete "$INSTDIR\*.dll"
    Delete "$INSTDIR\*.pak"
    Delete "$INSTDIR\*.bin"
    Delete "$INSTDIR\*.dat"
    Delete "$INSTDIR\*.json"
    Delete "$INSTDIR\LICENSE*"
    Delete "$INSTDIR\LICENSES*"
    Delete "$INSTDIR\chrome_*"
    Delete "$INSTDIR\vk_swiftshader*"
    Delete "$INSTDIR\vulkan*"
    Sleep 500
  skipClean:
!macroend

!macro customUnInit
  ; Force-kill the app before uninstall
  nsExec::ExecToLog 'taskkill /F /IM "Client Time Tracker.exe"'
  Sleep 1000
!macroend
