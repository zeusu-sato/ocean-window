# VS Code 1.107 compatibility

Ocean Window 0.3.0 declared `engines.vscode: ^1.130.0`, so VS Code 1.107.0 refused to install it. That requirement was inherited from the earlier native implementation. Ocean Window 0.3.1 lowers the declared minimum to `^1.107.0`; the scene implementation needs no runtime changes.

## API review

The [official VS Code 1.107.0 API definitions](https://github.com/microsoft/vscode/blob/1.107.0/src/vscode-dts/vscode.d.ts) include the APIs used by the scene: `window.tabGroups`, its tab and group events, `TabInputWebview`, `createWebviewPanel` with `preserveFocus`, Webview resource and message APIs, `Uri.joinPath`, configuration events, and workspace state. The [1.107.0 Webview panel implementation](https://github.com/microsoft/vscode/blob/1.107.0/src/vs/workbench/api/browser/mainThreadWebviewPanels.ts) uses the `mainThreadWebview-` view-type prefix already handled by Ocean Window.

The [extension-manifest documentation](https://code.visualstudio.com/api/references/extension-manifest#engines) explains how the declared VS Code engine range controls installation. The manifest gate, rather than a missing Webview API, caused the reported installation failure.

## Native verification on 2026-09-09

The compatibility candidate used Microsoft's official Windows x64 VS Code **1.107.0** archive. Its checksum was checked against [Microsoft's version-specific download metadata](https://update.code.visualstudio.com/api/versions/1.107.0/win32-x64-archive/stable):

| Evidence | Value |
| --- | --- |
| VS Code commit | `618725e67565b290ba4da6fe2d29f8fa1d4e3622` |
| Archive SHA-256 | `9ff926a0cabc98e356f66d64c0e068cf1252caa841215e4d951c2301f7e74fa1` |
| Electron / Node.js / Chromium | `39.2.3` / `22.21.1` / `142.0.7444.175` |
| Compatibility candidate SHA-256 | `c95e631aafd2c4b534980611c6a4b6fa26a05691cac6dca3eabf98eba24a761d` |
| Workbench HTML SHA-256, before and after | `217b39ea59c03aae0692cccb51352eb89c824e679114ca85d240e6f8eb91a4f4` |

The candidate, still internally versioned 0.3.0 solely for this private test, passed **13 native checks**: VSIX installation and automatic online photograph display; code, Markdown, and image editor exclusion; automatic return preserving chat focus; photograph and pause continuity; live settings; manual dismissal and return; disable/enable; a new native process restoring the current photograph, pause state, and next shuffle choice; and unchanged application files. It is not the published 0.3.0 package. Final release checks and distribution status belong in [publication notes](publication.md).

The test controlled a separately downloaded application, temporary profile, extension directory, and fixture workspace. It did not use or restart the user's normal VS Code windows. The general regression suite also passed **70 Node tests and seven browser tests**, with one POSIX-specific test skipped on Windows.

Reports, logs, and screenshots from this private candidate run are kept locally at `.test-app/compatibility-1.107.0/candidate-smoke-2/`; downloaded applications and private profile data are excluded from Git and the VSIX. A first attempt stopped on a Windows test-bridge file-sharing error after successfully installing and rendering the scene. Bounded file-rename retries corrected the test driver; the complete rerun passed without changing the extension runtime.

## Repeating the native test

Download the official Windows archive using the version-specific metadata above, verify its SHA-256, and extract it under this repository's `.test-app/` directory. Build a candidate VSIX, then run:

```powershell
node tools/native-desktop-smoke.mjs --app-root .test-app/compatibility-1.107.0/application/resources/app --executable .test-app/compatibility-1.107.0/application/Code.exe --vsix releases/ocean-window-0.3.1.vsix --output .test-app/compatibility-1.107.0/release-smoke
```

The runner also supports private macOS bundles, checks decoded image previews, and audits disposed-Webview errors. Windows applications outside the repository's `.test-app/` directory are rejected. The 1.107 lower-bound native run above covers Windows x64. Earlier Linux and Mac checks cover the versions recorded in [publication notes](publication.md); this run does not establish native 1.107 results on those operating systems or on ARM Windows/Linux. Versions below 1.107 remain unsupported and untested.
