# Ocean Window on Mac

Intel and Apple Silicon Macs use the same universal Ocean Window package. Both regular VS Code and Insiders are supported, starting at VS Code 1.130. Ocean Window adds no M1 requirement; the Mac and macOS version still need to satisfy the requirements of the VS Code build you install.

## Install

1. Install VS Code using [Microsoft's Mac instructions](https://code.visualstudio.com/docs/setup/mac).
2. Install [Ocean Window by Zeusu Sato](https://marketplace.visualstudio.com/items?itemName=zeusu-sato.ocean-window), choosing the extension's pre-release if prompted. Regular VS Code can use a pre-release extension. A universal VSIX is also available from [GitHub releases](https://github.com/zeusu-sato/ocean-window/releases).
3. Leave an editor group empty. Ocean Window 0.3 opens the sea automatically.

Press **Command+Shift+P** for **Ocean Window: Show Ocean Window** (日本語: **海を表示する**) or **Turn Off Ocean Window** (**海の表示をオフにする**). Opening a file closes the scene tab, and closing your files brings it back. Settings apply without reloading.

Version 0.3 uses the standard Webview API and does not require write access to the VS Code application. Showing the scene needs no native patch or special Mac security settings.

If you previously applied 0.2.x's native wallpaper, run **Restore Legacy Native Wallpaper** (**旧方式の壁紙を元に戻す**) once and reload the affected window to remove that old patch. This optional migration cleanup is separate from the new scene.

## Validation history

The 0.3 Webview rewrite passed **13 checks per combination** on macOS 15: Intel x64 and Apple Silicon arm64, each with regular VS Code 1.136.1 and Insiders 1.137.0. Checks covered automatic scenery, code/Markdown/image editors, chat focus, live settings, manual dismissal, on/off commands, and a new native process restoring the same photograph, pause state, and next shuffle choice. Native workbench files remained unchanged. [0.3 source-candidate run](https://github.com/zeusu-sato/ocean-window/actions/runs/33971066169), [current artifact and publication status](publication.md).

The following evidence is specifically for the older native 0.2.1 implementation.

The published 0.2.1 VSIX was tested on actual macOS 15 runners using official VS Code builds:

| Architecture | Regular VS Code | VS Code Insiders |
| --- | --- | --- |
| Intel x64 | 1.136.1 | 1.137.0-insider |
| Apple Silicon arm64 | 1.136.1 | 1.137.0-insider |

[That historical run](https://github.com/zeusu-sato/ocean-window/actions/runs/33967589195) passed ten checks in each combination, including native installation, explicit enable, online photograph display, code and Markdown visibility, full application restart, restoration, and the directly invoked uninstall hook. It did not test 0.3's new tab lifecycle or every historical macOS release.

The [Mac workflow](../.github/workflows/macos-native.yml) isolates applications, profiles, extensions, and shared data and publishes version, checksum, screenshot, and test-report evidence.
