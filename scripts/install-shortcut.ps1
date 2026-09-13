# Puts Bothy in the Start Menu and on the Desktop, without packaging anything.
# There is no .exe: the shortcut runs the electron.exe that npm already
# downloaded, pointed at this repo.
#
#   npm run shortcut                     install for the current user
#   npm run shortcut -- -Icon path.ico   same, with another icon
#
# Two details here are not cosmetic, and both were measured before being chosen.
#
# 1. The argument is the REPO ROOT, not out\main\index.js. Electron takes the
#    app name from the package.json it finds at the path it is given, and the
#    app name is what names %APPDATA%\<name>, where state.json - the last vault
#    you had open - lives. Pointed at the .js file there is no package.json
#    beside it, the name falls back to "Electron", and the app opens against
#    %APPDATA%\Electron\state.json instead: a shortcut that quietly forgets
#    which vault you were in. app.setName() does not undo this; the userData
#    path is fixed before the app's own code runs. Measured 2026-09-09.
#
# 2. The shortcut carries an AppUserModelID, and it is the same string the app
#    sets on itself (src/shared/app.ts). The taskbar groups windows by this id
#    and "pin to taskbar" looks for a Start Menu shortcut carrying it. With no
#    id on the shortcut the two do not match, and pinning writes a shortcut to
#    electron.exe with no arguments - an icon that opens an empty Electron.
#    Setting it needs the shortcut's property store, which is why this file
#    talks COM instead of using WScript.Shell.
[CmdletBinding()]
param(
  # Write the shortcuts here instead of the Start Menu and Desktop. The tests
  # use this so a measurement never touches the real Start Menu.
  [string]$Destination = '',
  # An .ico for the shortcut. Left out, it is resources\icon.ico, the file the
  # app's windows use (src/main/icon.ts); without any the shortcut would show
  # electron.exe's own icon, honest about the host and wrong about the app.
  [string]$Icon = '',
  # Print one shortcut's target, arguments, app id and icon as JSON, then exit.
  [string]$Read = ''
)

$ErrorActionPreference = 'Stop'

# Kept in step with APP_NAME / APP_ID in src/shared/app.ts. Nothing forces that
# by construction, so change both together.
$AppName = 'Bothy'
$AppId = 'ard0x10.Bothy'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace BothyShortcut {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PropertyKey {
    public Guid fmtid;
    public uint pid;
    public PropertyKey(Guid id, uint p) { fmtid = id; pid = p; }
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PropVariant {
    public ushort vt;
    public ushort r1;
    public ushort r2;
    public ushort r3;
    public IntPtr p;
    public IntPtr p2;
  }

  [ComImport, Guid("000214F9-0000-0000-C000-000000000046"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int cch, IntPtr fd, uint flags);
    void GetIDList(out IntPtr pidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int cch);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int cch);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int cch);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
    void GetHotkey(out short key);
    void SetHotkey(short key);
    void GetShowCmd(out int cmd);
    void SetShowCmd(int cmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int cch, out int index);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
    void Resolve(IntPtr hwnd, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
  }

  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    void GetCount(out uint count);
    void GetAt(uint index, out PropertyKey key);
    void GetValue(ref PropertyKey key, out PropVariant value);
    void SetValue(ref PropertyKey key, ref PropVariant value);
    void Commit();
  }

  [ComImport, Guid("0000010b-0000-0000-C000-000000000046"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPersistFile {
    void GetClassID(out Guid id);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.Bool)] bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file);
  }

  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  public class ShellLink { }

  public static class Link {
    // PKEY_AppUserModel_ID
    static readonly Guid AppUserModel = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    const ushort VT_LPWSTR = 31;

    [DllImport("ole32.dll", ExactSpelling = true, PreserveSig = false)]
    static extern void PropVariantClear(ref PropVariant value);

    // The obvious call here is InitPropVariantFromString, but propsys.dll does
    // not export it - it is an inline helper in the SDK header, so P/Invoke
    // finds nothing at run time. A VT_LPWSTR variant is two fields, so build
    // it. The string must come from the COM allocator, because PropVariantClear
    // is what frees it.
    static PropVariant StringVariant(string text) {
      PropVariant value = new PropVariant();
      value.vt = VT_LPWSTR;
      value.p = Marshal.StringToCoTaskMemUni(text);
      return value;
    }

    public static void Write(string lnk, string target, string args, string workDir,
                             string description, string icon, string appId) {
      IShellLinkW link = (IShellLinkW)new ShellLink();
      link.SetPath(target);
      link.SetArguments(args);
      link.SetWorkingDirectory(workDir);
      link.SetDescription(description);
      if (!string.IsNullOrEmpty(icon)) link.SetIconLocation(icon, 0);

      IPropertyStore store = (IPropertyStore)link;
      PropertyKey key = new PropertyKey(AppUserModel, 5);
      PropVariant value = StringVariant(appId);
      store.SetValue(ref key, ref value);
      store.Commit();
      PropVariantClear(ref value);

      ((IPersistFile)link).Save(lnk, true);
      Marshal.ReleaseComObject(link);
    }

    static IShellLinkW Load(string lnk) {
      IShellLinkW link = (IShellLinkW)new ShellLink();
      // No SLR_ flags: resolving would let Windows repair a broken target
      // behind our back, and a test that reads back what was written wants
      // what was written.
      ((IPersistFile)link).Load(lnk, 0);
      return link;
    }

    public static string ReadTarget(string lnk) {
      IShellLinkW link = Load(lnk);
      StringBuilder text = new StringBuilder(1024);
      link.GetPath(text, text.Capacity, IntPtr.Zero, 0);
      Marshal.ReleaseComObject(link);
      return text.ToString();
    }

    public static string ReadArguments(string lnk) {
      IShellLinkW link = Load(lnk);
      StringBuilder text = new StringBuilder(4096);
      link.GetArguments(text, text.Capacity);
      Marshal.ReleaseComObject(link);
      return text.ToString();
    }

    public static string ReadIcon(string lnk) {
      IShellLinkW link = Load(lnk);
      StringBuilder text = new StringBuilder(1024);
      int index;
      link.GetIconLocation(text, text.Capacity, out index);
      Marshal.ReleaseComObject(link);
      return text.ToString();
    }

    public static string ReadAppId(string lnk) {
      IShellLinkW link = Load(lnk);
      IPropertyStore store = (IPropertyStore)link;
      PropertyKey key = new PropertyKey(AppUserModel, 5);
      PropVariant value;
      store.GetValue(ref key, out value);
      string text = value.vt == VT_LPWSTR ? Marshal.PtrToStringUni(value.p) : "";
      PropVariantClear(ref value);
      Marshal.ReleaseComObject(link);
      return text == null ? "" : text;
    }
  }
}
'@

if ($Read -ne '') {
  if (-not (Test-Path -LiteralPath $Read)) { throw "No shortcut at $Read" }
  $full = (Resolve-Path -LiteralPath $Read).Path
  [pscustomobject]@{
    target = [BothyShortcut.Link]::ReadTarget($full)
    arguments = [BothyShortcut.Link]::ReadArguments($full)
    appId = [BothyShortcut.Link]::ReadAppId($full)
    icon = [BothyShortcut.Link]::ReadIcon($full)
  } | ConvertTo-Json -Compress
  exit 0
}

$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$entry = Join-Path $root 'out\main\index.js'

if (-not (Test-Path -LiteralPath $electron)) {
  throw "electron.exe is missing. Run: npm install"
}
if (-not (Test-Path -LiteralPath $entry)) {
  throw "The app is not built. Run: npm run build"
}

if ($Icon -eq '') { $Icon = Join-Path $root 'resources\icon.ico' }
if ($Icon -ne '') {
  if (-not (Test-Path -LiteralPath $Icon)) { throw "No icon at $Icon" }
  $Icon = (Resolve-Path -LiteralPath $Icon).Path
}

# Quoted because the repo path may contain spaces, and this is one argument.
$arguments = '"' + $root + '"'
$description = $AppName

if ($Destination -ne '') {
  if (-not (Test-Path -LiteralPath $Destination)) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  }
  $places = @((Resolve-Path -LiteralPath $Destination).Path)
} else {
  $places = @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
    [Environment]::GetFolderPath('Desktop')
  )
}

foreach ($place in $places) {
  $lnk = Join-Path $place ($AppName + '.lnk')
  [BothyShortcut.Link]::Write($lnk, $electron, $arguments, $root, $description, $Icon, $AppId)
  Write-Output ("wrote " + $lnk)
}
