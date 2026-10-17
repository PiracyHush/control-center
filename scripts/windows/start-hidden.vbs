' Starts Control Center in the background with no console window.
' Run at sign-in by the "Control Center" task that scripts/windows/autostart.ps1
' registers. The launcher exits immediately if the dashboard is already running,
' and otherwise exits as soon as the dashboard is ready, leaving only the server.
Option Explicit

Dim fso, shell, repo, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' This file lives in <repo>\scripts\windows\.
repo = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
' The launcher creates logs\ and rotates launch.log itself, and only when no
' server is running, since a live server keeps writing to the open file.

shell.CurrentDirectory = repo
' Node directly, not "npm run launch": npm would stay resident for the whole
' session and can stall for minutes when memory is short. --background makes
' the launcher write logs\launch.log itself and exit once the dashboard is up.
command = "node scripts\launch.mjs --background"
' 0 = hidden window, False = do not wait for it to finish.
shell.Run command, 0, False
