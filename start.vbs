' bzxz - Silent launcher (no terminal window)
' Double-click this file instead of start.bat to run completely hidden

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\start.bat"

' Run batch hidden (window style 0), wait for completion disabled
WshShell.Run "cmd /c """ & batPath & """", 0, False

' Balloon tip not reliably available in all Windows versions,
' open browser after a short delay instead
WScript.Sleep 3000
WshShell.Run "http://localhost:3000"
