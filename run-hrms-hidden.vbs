' Launches the Hrika HRMS server completely hidden (no console window).
' This is what Windows runs at login.
Set WshShell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run """" & scriptDir & "\start-hrms-server.bat""", 0, False
