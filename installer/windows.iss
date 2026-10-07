; Adapted from xisf-photoshop. Adobe UPIA owns the UXP installation.
#ifndef PluginVersion
  #error PluginVersion is required
#endif
#ifndef SourceRoot
  #error SourceRoot is required
#endif
#ifndef PackagePath
  #error PackagePath is required
#endif
#ifndef OutputRoot
  #error OutputRoot is required
#endif

[Setup]
AppName=Layer Math for Photoshop
AppVersion={#PluginVersion}
AppPublisher=StackFoundry LLC
AppPublisherURL=https://github.com/theatrus/layer-math-photoshop
AppSupportURL=https://github.com/theatrus/layer-math-photoshop/issues
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible and not arm64
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
DisableDirPage=yes
DisableWelcomePage=no
DisableProgramGroupPage=yes
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
OutputDir={#OutputRoot}
SetupLogging=yes
CloseApplications=no
RestartApplications=no
RestartIfNeededByRun=no
UninstallLogMode=append
UninstallDisplayName=Layer Math for Photoshop
#ifndef TestRoot
AppId=LayerMath.Photoshop
DefaultDirName={localappdata}\Layer Math\Photoshop
OutputBaseFilename=LayerMath-Photoshop-Windows-x64-Setup-{#PluginVersion}
SetupMutex=LayerMathPhotoshopInstaller
#else
AppId=LayerMath.Photoshop.InstallerTest
DefaultDirName={#TestRoot}\App
OutputBaseFilename=InstallerTest
SetupMutex=LayerMathPhotoshopInstallerTest
UsePreviousAppDir=no
#endif

[Files]
Source: "{#PackagePath}"; DestName: "LayerMath.ccx"; Flags: dontcopy
Source: "{#SourceRoot}\scripts\windows-install.txt"; DestDir: "{app}"; DestName: "Read me first.txt"; Flags: ignoreversion
Source: "{#SourceRoot}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\NOTICE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\THIRD_PARTY_NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion

[Messages]
WelcomeLabel2=Install Layer Math for Photoshop using Adobe Creative Cloud.%n%nClose Photoshop before continuing. Creative Cloud Desktop and Photoshop must already be installed for this Windows user. Adobe manages the plugin files and updates.
FinishedLabelNoIcons=Layer Math is installed. Open Photoshop, then choose Plugins > Layer Math.%n%nTo remove it, use Windows Settings > Apps or Creative Cloud > Manage Plugins. Saved documents and recipe files are kept.

[Code]
function AgentPath: String;
begin
#ifdef TestRoot
  Result := '{#TestRoot}\FakeUPIA.exe';
#else
  Result := ExpandConstant('{commoncf64}\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe');
#endif
end;

function PhotoshopClosed: Boolean;
var Locator, Services, Processes: Variant;
begin
  Result := False;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Services := Locator.ConnectServer('', 'root\cimv2');
#ifdef TestRoot
    Processes := Services.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''LayerMathInstallerTestHost.exe''');
#else
    Processes := Services.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''Photoshop.exe''');
#endif
    Result := Processes.Count = 0;
  except
    Log('Cannot check Photoshop processes: ' + GetExceptionMessage);
  end;
end;

function Prerequisites: String;
begin
  Result := '';
  if not PhotoshopClosed then
    Result := 'Close Photoshop before installing, updating or removing Layer Math.'
  else if not FileExists(AgentPath) then
    Result := 'Adobe plugin installer is missing. Install or repair Creative Cloud Desktop, then try again.';
end;

function RunAgent(Arguments: String; var Output: TExecOutput): Boolean;
var Code: Integer;
begin
  Result := ExecAndCaptureOutput(AgentPath, Arguments, ExtractFileDir(AgentPath),
    SW_HIDE, ewWaitUntilTerminated, Code, Output);
  Log('Adobe installer exit code: ' + IntToStr(Code));
  Result := Result and (Code = 0) and not Output.Error;
end;

function NormalizeSpaces(Line: String): String;
begin
  StringChangeEx(Line, #9, ' ', True);
  while Pos('  ', Line) > 0 do StringChangeEx(Line, '  ', ' ', True);
  Result := Trim(Line);
end;

function InstalledVersion(var Version: String): Boolean;
var Output: TExecOutput; I, J, Dots: Integer; Line, Prefix, Candidate: String; Valid: Boolean;
begin
  Version := '';
  Result := RunAgent('/list all', Output);
  if not Result then Exit;
  for I := 0 to GetArrayLength(Output.StdOut) - 1 do begin
    Line := NormalizeSpaces(Output.StdOut[I]);
    { Discard the status column; do not depend on its display language. }
    J := Pos(' ', Line);
    if J > 0 then Line := Copy(Line, J + 1, MaxInt);
    Prefix := 'Layer Math ';
    if Pos(Prefix, Line) = 1 then begin
      Candidate := Copy(Line, Length(Prefix) + 1, MaxInt);
      Valid := Length(Candidate) >= 5; Dots := 0;
      for J := 1 to Length(Candidate) do
        if Candidate[J] = '.' then Dots := Dots + 1
        else if (Candidate[J] < '0') or (Candidate[J] > '9') then Valid := False;
      if Valid and (Dots = 2) and (Pos('..', Candidate) = 0) then begin
        Version := Candidate;
        Exit;
      end;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Output: TExecOutput; Version: String;
begin
  Result := Prerequisites;
  if Result <> '' then Exit;
  if not InstalledVersion(Version) then begin
    Result := 'Adobe could not list installed plugins. Repair Creative Cloud Desktop and try again.';
    Exit;
  end;
  if Version = '{#PluginVersion}' then Exit;
  ExtractTemporaryFile('LayerMath.ccx');
  if not RunAgent('/install "' + ExpandConstant('{tmp}\LayerMath.ccx') + '"', Output) then begin
    Result := 'Adobe could not install Layer Math. Check Creative Cloud for details. Existing plugin files are managed by Adobe.';
    Exit;
  end;
  if not InstalledVersion(Version) or (Version <> '{#PluginVersion}') then
    Result := 'Adobe did not confirm Layer Math {#PluginVersion}. Check Manage Plugins in Creative Cloud before retrying.';
end;

function InitializeUninstall: Boolean;
var Error, Version: String; Output: TExecOutput;
begin
  Error := Prerequisites;
  if Error = '' then begin
    if not InstalledVersion(Version) then Error := 'Adobe could not list installed plugins.'
    else if Version <> '' then begin
      if not RunAgent('/remove "Layer Math"', Output) then Error := 'Adobe could not remove Layer Math.'
      else if not InstalledVersion(Version) or (Version <> '') then Error := 'Adobe did not confirm removal of Layer Math.';
    end;
  end;
  Result := Error = '';
  if not Result then SuppressibleMsgBox(Error + ' The setup files are kept so you can retry.', mbError, MB_OK, IDOK);
end;
