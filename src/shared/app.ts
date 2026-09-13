// The product name is temporary. It lives here and nowhere else, so renaming
// the app later stays a one-line change.
export const APP_NAME = 'Bothy'

// What Windows files our windows under: the Application User Model ID. The
// taskbar groups by this, and "pin to taskbar" only works when the running
// window and the Start Menu shortcut carry the same one - otherwise Windows
// pins the host executable (electron.exe) with no arguments and the pinned
// icon opens an empty Electron. scripts/install-shortcut.ps1 writes this same
// string into the shortcut, and the two have to
// stay the same.
export const APP_ID = `ard0x10.${APP_NAME}`

// What Electron names the folder state.json lives in: the "name" in
// package.json, lower case, not APP_NAME. The MCP server has no Electron to ask
// and works the folder out from this, so it has to match
// package.json.
export const USER_DATA_NAME = 'bothy'
