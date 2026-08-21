Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\Users\John\Desktop\PROJECTS\Wordbank"
shell.Run "cmd /c npm start >> wordbank.log 2>&1", 0, False
