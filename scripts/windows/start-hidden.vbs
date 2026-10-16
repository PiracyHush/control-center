' Starts Control Center in the background with no console window.
' Run at sign-in by the "Control Center" task that scripts/windows/autostart.ps1
' registers. The launcher exits immediately if the dashboard is already running.
Option Explicit

Dim fso, shell, repo, logDir, logFile, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' This file lives in <repo>\scripts\windows\.
repo = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
logDir = repo & "\logs"
logFile = logDir & "\launch.log"

If Not fso.FolderExists(logDir) Then fso.CreateFolder logDir
' Keep the log small: start a fresh one once it passes about 1 MB. A running
' dashboard keeps the log open, so a failed rotation is skipped, not fatal.
On Error Resume Next
If fso.FileExists(logFile) Then
  If fso.GetFile(logFile).Size > 1000000 Then
    If fso.FileExists(logDir & "\launch.old.log") Then fso.DeleteFile logDir & "\launch.old.log"
    fso.MoveFile logFile, logDir & "\launch.old.log"
  End If
End If
On Error GoTo 0

shell.CurrentDirectory = repo
command = "cmd.exe /c npm run launch -- --no-open >> """ & logFile & """ 2>&1"
' 0 = hidden window, False = do not wait for it to finish.
shell.Run command, 0, False
