# Ocean Window on Mac

Intel and Apple Silicon Macs use the same **Ocean Window 0.2.1 universal VSIX**. Both regular VS Code and Insiders are supported, starting at VS Code 1.130. Ocean Window adds no M1 requirement; the Mac and macOS version still need to satisfy the requirements of the VS Code build you install.

## Install

1. Install VS Code following [Microsoft's Mac instructions](https://code.visualstudio.com/docs/setup/mac): copy the application into Applications, then launch that copy.
2. Install [Ocean Window by Zeusu Sato](https://marketplace.visualstudio.com/items?itemName=zeusu-sato.ocean-window), choosing the extension's pre-release if prompted. Regular VS Code can use this pre-release extension. Alternatively, use the [universal VSIX](https://github.com/zeusu-sato/ocean-window/releases/download/v0.2.1/ocean-window-0.2.1.vsix) with **Extensions → … → Install from VSIX…**.
3. Press **Command+Shift+P** and run **Ocean Window: Enable / Apply Ocean Wallpaper** (日本語: **海の壁紙を有効化・設定を適用**).
4. Read the native customization notice, enable it, and reload the window when your work is ready.

Ocean Window changes the installed workbench HTML and triggers VS Code's integrity warning. It preserves Content Security Policy and integrity checks. Enabling requires write access to the application. If you launched a read-only downloaded image or temporary copy, quit it, copy the application into Applications, and reopen that installed copy. Administrator-managed applications may still be unwritable; use an installation owned by your account in that case.

Run **Ocean Window: Restore Original Editor** and reload before disabling or uninstalling. The same restoration and update behavior applies to every desktop platform.

## Native validation

The published 0.2.1 VSIX was installed and tested in actual macOS 15 runners on both Intel and Apple Silicon, using Microsoft's official VS Code builds:

| Architecture | Regular VS Code | VS Code Insiders |
| --- | --- | --- |
| Intel x64 | 1.136.1 | 1.137.0-insider |
| Apple Silicon arm64 | 1.136.1 | 1.137.0-insider |

[The native test run](https://github.com/zeusu-sato/ocean-window/actions/runs/33967589195) passed ten checks in each of the four combinations: installation, explicit enable, status while a reload notice is open, online photograph display, code and Markdown visibility, returning to an empty editor, full application restart with the wallpaper applied, restoration, and the directly invoked uninstall hook. The restart uses the same patched application and profile in a new native process, without changing macOS security settings. The workflow uploads screenshots, version and checksum metadata, and test results as artifacts. This validates the downloaded application bundles on hosted Macs; it does not claim testing of every historical macOS release or VS Code's delayed uninstall scheduling.

Mac validation happened after the initial 0.2.1 release, so the README bundled in that original VSIX says that macOS was not yet verified. The binary is unchanged. See [current publication and validation details](publication.md) for subsequent results.

The [workflow](../.github/workflows/macos-native.yml) runs on published releases and can also be launched manually with a published extension version. Its application, profile, extensions, and shared data are isolated from existing installations. The original application HTML is restored and test processes are stopped after verification.
