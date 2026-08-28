; Дополнения к установщику EVA VPN.
; Главное: после удаления в системе не должно остаться ничего — ни процессов ядра,
; ни задачи автозапуска, ни правил брандмауэра, ни включённого системного прокси.

!macro customUnInstall
  DetailPrint "Останавливаем ядро..."
  nsExec::Exec 'taskkill /F /T /IM sing-box.exe'

  DetailPrint "Снимаем killswitch..."
  nsExec::Exec "powershell -NoProfile -ExecutionPolicy Bypass -Command $\"Remove-NetFirewallRule -Group 'EVA VPN' -ErrorAction SilentlyContinue; Set-NetFirewallProfile -All -DefaultOutboundAction Allow -ErrorAction SilentlyContinue$\""

  DetailPrint "Удаляем задачу автозапуска..."
  nsExec::Exec 'schtasks /Delete /TN "EVA VPN Autostart" /F'

  DetailPrint "Сбрасываем системный прокси..."
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Internet Settings" "ProxyEnable" 0
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Internet Settings" "ProxyServer"
  nsExec::Exec 'netsh winhttp reset proxy'
  nsExec::Exec 'ipconfig /flushdns'
  Delete "$PROFILE\.eva-vpn-guard.json"
!macroend

!macro customInstall
  DetailPrint "Останавливаем предыдущую версию..."
  nsExec::Exec 'taskkill /F /T /IM sing-box.exe'
!macroend
