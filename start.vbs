' bzxz - Silent launcher (no terminal window)
' Double-click this file instead of start.bat to run completely hidden

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\start.bat"
portFile = scriptDir & "\data\.server-port"

' Remove stale port file so we wait for the *new* server.
If FSO.FileExists(portFile) Then FSO.DeleteFile portFile, True

' Run batch hidden (window style 0). The bat itself launches node, polls the
' port file, and opens the browser — but since we ran hidden we can't see the
' browser launch from within the bat reliably across all Windows versions. So
' we poll the port file ourselves and open the browser when ready.
WshShell.Run "cmd /c """ & batPath & """", 0, False

' Wait up to 30 seconds for the server to publish its port.
port = ""
For i = 1 To 60
    WScript.Sleep 500
    If FSO.FileExists(portFile) Then
        Set f = FSO.OpenTextFile(portFile, 1, False)
        If Not f.AtEndOfStream Then port = Trim(f.ReadLine)
        f.Close
        If Len(port) > 0 Then Exit For
    End If
Next

If Len(port) > 0 Then
    WshShell.Run "http://localhost:" & port
Else
    MsgBox "bzxz 启动超时（30 秒未就绪），请查看 startup.log。", 48, "bzxz"
End If
