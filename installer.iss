; Inno Setup script. Built in CI: iscc /DAppVersion=1.0.0 installer.iss
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6B4E2F0A-6C3D-4E8B-9C59-2D1E7A3F5B10}
AppName=Takeaway Code Finder
AppVersion={#AppVersion}
AppPublisher=Takeaway Code Finder
DefaultDirName={localappdata}\Programs\TakeawayCodeFinder
DefaultGroupName=Takeaway Code Finder
PrivilegesRequired=lowest
OutputDir=installer-out
OutputBaseFilename=TakeawayCodeFinder-Setup
SetupIconFile=tcf\static\icon.ico
UninstallDisplayIcon={app}\TakeawayCodeFinder.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes

[Files]
Source: "dist\TakeawayCodeFinder\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Takeaway Code Finder"; Filename: "{app}\TakeawayCodeFinder.exe"
Name: "{autodesktop}\Takeaway Code Finder"; Filename: "{app}\TakeawayCodeFinder.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\TakeawayCodeFinder.exe"; Description: "Open Takeaway Code Finder"; Flags: nowait postinstall skipifsilent
