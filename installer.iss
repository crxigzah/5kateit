; Inno Setup script. Built in CI: iscc /DAppVersion=1.0.0 installer.iss
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{3F1C9A52-8E47-4D2B-A6B1-5C0E7D9F2A84}
AppName=Snackhack
AppVersion={#AppVersion}
AppPublisher=Snackhack
DefaultDirName={localappdata}\Programs\Snackhack
DefaultGroupName=Snackhack
PrivilegesRequired=lowest
OutputDir=installer-out
OutputBaseFilename=Snackhack-Setup
SetupIconFile=tcf\static\icon.ico
UninstallDisplayIcon={app}\Snackhack.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
; Same AppId as 5kateit, so this upgrades it in place under the new name.
UsePreviousAppDir=no
CloseApplications=yes

[InstallDelete]
; Leftovers from when the app was called 5kateit
Type: filesandordirs; Name: "{localappdata}\Programs\5kateit"
Type: files; Name: "{autoprograms}\5kateit.lnk"
Type: files; Name: "{autodesktop}\5kateit.lnk"

[Files]
Source: "dist\Snackhack\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Snackhack"; Filename: "{app}\Snackhack.exe"
Name: "{autodesktop}\Snackhack"; Filename: "{app}\Snackhack.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\Snackhack.exe"; Description: "Open Snackhack"; Flags: nowait postinstall skipifsilent
