; Дополнения к установщику EVA VPN.
; Главное: после удаления в системе не должно остаться ничего — ни процессов ядра,
; ни задачи автозапуска, ни правил брандмауэра, ни включённого системного прокси.

Var evaRequestedInstallDir

!macro preInit
  ; NSIS already parsed the final, unquoted /D= including spaces. Builder's
  ; multi-user initialization reparses it with StdUtils and truncates at a space.
  ; Preserve the native result before that initialization can overwrite it.
  Push $0
  ${StdUtils.GetParameter} $0 "D" ""
  ${if} $0 != ""
    StrCpy $evaRequestedInstallDir $INSTDIR
  ${endif}
  Pop $0
!macroend

!macro stopEvaCore
  ; Match our installation path, never all sing-box processes on the machine.
  Push $0
  System::Call 'Kernel32::SetEnvironmentVariable(t "EVAVPN_INSTALL_CORE", t "$INSTDIR\resources\core\sing-box.exe") i .r0'
  nsExec::Exec /TIMEOUT=10000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Property ExecutablePath,ProcessId -ErrorAction SilentlyContinue | Where-Object { $$_.ExecutablePath -eq $$env:EVAVPN_INSTALL_CORE } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
  Pop $0
  System::Call 'Kernel32::SetEnvironmentVariable(t "EVAVPN_INSTALL_CORE", p 0) i .r0'
  Pop $0
!macroend

!macro customInit
  InitPluginsDir
  ${if} $evaRequestedInstallDir != ""
    StrCpy $INSTDIR $evaRequestedInstallDir
  ${endif}
  ; Older uninstallers delete this recovery record even during an upgrade.
  ; Preserve it so the new application can restore the original network state.
  ${if} ${FileExists} "$PROFILE\.eva-vpn-guard.json"
    CopyFiles /SILENT "$PROFILE\.eva-vpn-guard.json" "$PLUGINSDIR\eva-vpn-guard.json"
  ${endif}
!macroend

!macro customUnInstall
  DetailPrint "Останавливаем ядро..."
  !insertmacro stopEvaCore

  ${ifNot} ${isUpdated}

  DetailPrint "Снимаем killswitch..."
  nsExec::Exec "powershell -NoProfile -ExecutionPolicy Bypass -Command $\"Remove-NetFirewallRule -Group 'EVA VPN' -ErrorAction SilentlyContinue; Set-NetFirewallProfile -All -DefaultOutboundAction Allow -ErrorAction SilentlyContinue$\""

  ; При обновлении старая версия удаляется своим же деинсталлятором.
  ; Снимать задачу автозапуска тогда нельзя: человек включал автозапуск,
  ; а после обновления он молча пропадал бы.
    DetailPrint "Удаляем задачу автозапуска..."
    nsExec::Exec 'schtasks /Delete /TN "EVA VPN Autostart" /F'

  DetailPrint "Сбрасываем системный прокси..."
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Internet Settings" "ProxyEnable" 0
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Internet Settings" "ProxyServer"
  nsExec::Exec 'netsh winhttp reset proxy'
  nsExec::Exec 'ipconfig /flushdns'
  Delete "$PROFILE\.eva-vpn-guard.json"
  ${endIf}
!macroend

!macro customInstall
  DetailPrint "Останавливаем предыдущую версию..."
  !insertmacro stopEvaCore
  ${ifNot} ${FileExists} "$PROFILE\.eva-vpn-guard.json"
  ${andIf} ${FileExists} "$PLUGINSDIR\eva-vpn-guard.json"
    CopyFiles /SILENT "$PLUGINSDIR\eva-vpn-guard.json" "$PROFILE\.eva-vpn-guard.json"
  ${endif}
!macroend
