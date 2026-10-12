; Inno Setup script. Built in CI: iscc /DAppVersion=1.0.0 installer.iss
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{3F1C9A52-8E47-4D2B-A6B1-5C0E7D9F2A84}
AppName=5kateit
AppVersion={#AppVersion}
AppPublisher=5kable
DefaultDirName={localappdata}\Programs\5kateit
DefaultGroupName=5kateit
PrivilegesRequired=lowest
OutputDir=installer-out
OutputBaseFilename=5kateit-Setup
SetupIconFile=tcf\static\icon.ico
UninstallDisplayIcon={app}\5kateit.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes

[Files]
Source: "dist\5kateit\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{autoprograms}\5kateit"; Filename: "{app}\5kateit.exe"
Name: "{autodesktop}\5kateit"; Filename: "{app}\5kateit.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\5kateit.exe"; Description: "Open 5kateit"; Flags: nowait postinstall skipifsilent
