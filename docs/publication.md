# Distribution and validation

## Published 0.3.0 release

Version **0.3.0** replaces application-file patching with a standard Webview scene. The extension opens a temporary Ocean Window tab in an empty editor group, closes it when a real editor opens, and remembers its on/off state per workspace. Showing the scene requires no native file write, permission change, administrator access, or window reload. The existing extension ID remains `zeusu-sato.ocean-window`.

The universal package targets regular VS Code and Insiders **1.130 or later** on Windows, Linux, Intel Macs, and Apple Silicon Macs. VS Code for the Web is currently unsupported.

The final 0.3.0 package has passed native Linux, Windows, and all four Mac combinations below. On 2026-09-05, Microsoft's public Gallery returned the validated **0.3.0 universal prerelease**, with engine requirement `^1.130.0`. Unauthenticated downloads from both Marketplace and the [GitHub release](https://github.com/zeusu-sato/ocean-window/releases/tag/v0.3.0) matched the tested VSIX SHA-256 exactly. The historical 0.2.x results are recorded separately.

The [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=zeusu-sato.ocean-window), [GitHub releases](https://github.com/zeusu-sato/ocean-window/releases), and [source repository](https://github.com/zeusu-sato/ocean-window) retain their existing locations. Publisher **zeusu-sato**, displayed as **Zeusu Sato**, uses [dorodango.biz](https://dorodango.biz) as its publisher homepage.

## Build

Use Node.js and an installed Google Chrome, which browser tests and the icon builder access through Playwright's `chrome` channel:

```powershell
npm ci
npm test
npm run package:extension
```

The builder uses the identity from `extension/package.json`. It packages a pre-release without `--target`, producing a universal VSIX with no `Identity.TargetPlatform`. The runtime uses JavaScript and Node built-ins with no native binary dependencies. Test profiles, VS Code binaries, image fixtures, user settings, install receipts, and development dependencies are excluded from the VSIX. Credited photograph fixtures remain in source for reproducible browser tests.

The 0.3 package retains a legacy native restoration module and uninstall hook solely to clean up existing 0.2.x installations. Its normal scene controller does not apply native patches.

## 0.3.0 Linux Webview verification

The final VSIX passed **14 checks each** in actual Linux x64 VS Code **1.130.0 stable** and **1.137.0 Insiders**, running as ordinary UID 1000 against root-owned application installations. Native write probes returned `EACCES`, while automatic scene display, online photograph loading, code/Markdown/image editors, return to the empty editor, chat focus, saved pause state, settings changes, manual dismissal, and turning the scene off all passed. Native application and extension-host logs contained no disposed-webview errors.

The workbench HTML and directory contents remained unchanged. These checks validate the standard extension in a Linux desktop host under Ubuntu/WSL, rather than a Windows UI connected to a WSL workspace. The exact historical 1.130.0-insider binary remains unavailable; the lower-version test uses 1.130 stable.

The legacy migration and uninstall tests also passed **40 Node tests**, covering read-only inspection, clean failed-enable receipts, manual old patches, recovery state, and uninstall behavior.

The full Windows regression run passed **70 Node tests and seven browser tests**, with one POSIX case skipped. The final controller changes were checked again with its nine lifecycle tests. The tested universal VSIX is 60,350 bytes with SHA-256 `c949c51e0e43a5ad254c92b3e3857eaf44773f4ff43bb14098f1a7150c5d17d8`. The reproducible native Linux checks are in `tools/webview-linux-smoke.mjs`; they use an isolated helper extension from `tools/webview-smoke-driver.cjs` only for testing.

## 0.3.0 Windows and Mac Webview verification

The final VSIX passed **12 checks** on native Windows x64 VS Code Insiders **1.137.0**, including online photograph loading, code/Markdown/image exclusion, automatic return with chat focus preserved, saved photograph and pause state, live settings, manual dismissal, and disable/enable. Its native workbench HTML and directory were unchanged. The test used an owned private application and a fresh profile.

The source at `fd6fa1a` also passed **13 checks in each of four macOS 15 combinations**: Intel x64 and Apple Silicon arm64, each running regular VS Code **1.136.1** and Insiders **1.137.0**. Besides the scene/file lifecycle, these checks stop the native application and start a new process with the same profile and workspace, verifying the saved photo, pause state, and next shuffle choice. All four applications retained their original workbench HTML and directory contents. [Mac Webview verification run](https://github.com/zeusu-sato/ocean-window/actions/runs/33971066169).

Those initial Mac candidates were built from the checked-out source on each runner. The exact published VSIX subsequently passed the same **13 checks in all four Mac combinations**, with every report recording SHA-256 `c949c51e0e43a5ad254c92b3e3857eaf44773f4ff43bb14098f1a7150c5d17d8`, successful cold restart, and unchanged native files. [Published-package Mac run](https://github.com/zeusu-sato/ocean-window/actions/runs/33971360461/attempts/2). Its first attempt stopped before installation because the release checksum asset was named without the expected `.txt` suffix; renaming that checksum asset allowed the same run to pass, with no VSIX change. Windows/Linux ARM and WSL/Remote SSH workspace combinations remain unverified.

## Legacy migration

An update leaves an existing native patch untouched. A read-only startup check can offer **Ocean Window: Restore Legacy Native Wallpaper**. Only that explicit command restores the current application's old patch; reload each affected window once afterward. Cleanup failures do not block the Webview scene.

A clean application with a failed 0.2.x `pending-enable` receipt is handled without native writes. Explicit cleanup or the uninstall hook retires the receipt after a read-only inspection. Validated receipts for other old application installations remain available for recovery. See [legacy Linux recovery](linux-permissions.md).

Users with the separate `ocean-window-local.ocean-window` prototype should restore and uninstall it. Its native cleanup is independent of the new scene. Normal updates of `zeusu-sato.ocean-window` retain the same extension identity.

## Historical 0.2.1 distribution

The [0.2.1 GitHub prerelease](https://github.com/zeusu-sato/ocean-window/releases/tag/v0.2.1) supplied `ocean-window-0.2.1.vsix`, removing 0.2.0's Windows x64 restriction and lowering the minimum VS Code version from 1.136 to 1.130. On 2026-09-05, that universal pre-release passed Microsoft's Marketplace verification. The old Windows-specific 0.2.0 remains in version history.

Version 0.2.x modified the installed workbench HTML, required explicit native enable and write access, and triggered VS Code's integrity warning. It preserved the original Content Security Policy and integrity checks. Those native application requirements do not apply to the new 0.3 scene.

## Historical 0.2.x tested scope

For 0.2.1, the Windows regression run passed **50 Node tests and six browser tests**, with one POSIX symlink case skipped. The installer and extension adapter also ran under actual Linux Node: **40 passed**, with two Windows sharing cases skipped and the POSIX symlink case passing. These cover initial opt-in, settings, concurrent operations, recovery receipts, restoration, permission failures, Wikimedia discovery and caching, and the empty-editor display lifecycle. Browser tests use local photograph fixtures; they do not establish the availability of the live Wikimedia service.

Native 0.2.1 checks used Microsoft's official **Linux x64 VS Code 1.130.0 stable** (`1b6a188127eeaf9194f945eb6eb89a657e93c54c`) and **1.137.0 Insiders** (`de8cc55dae905582f191fdcfb6dff8c811a743c4`) archives, with their download SHA-256 values verified. Both ran as native Linux Electron processes under Ubuntu in WSL, with headless rendering and isolated applications, profiles, extensions, and shared data. This tests a Linux desktop extension host, not a Windows UI connected to a WSL workspace.

Both Linux builds passed nine checks with the exact release VSIX: installation and activation without auto-patching, explicit enable, nonblocking status, a real online sea photograph in the empty editor, code and Markdown hiding the scenery, closing files returning the scenery, restoration, and the packaged uninstall hook. The hook was invoked directly with Linux Node and completed within its five-second limit; this does not test VS Code's delayed uninstall scheduling. The tested VSIX SHA-256 is `28659cbc125e2ea2fa43cb88ccc36d9dea1adc2eae209646fac2792c76775ad5`.

The exact historical **1.130.0-insider** binary was unavailable from the named download endpoint. Compatibility is supported by the 1.130 stable native test and review of the official 1.130 API definitions, alongside the newer Insiders native test.

The preceding 0.2.0 release was also tested natively in an isolated **Windows x64 VS Code Insiders 1.137.0** installation, including activation, enable, status, settings, restoration, code and Markdown display, and the directly invoked uninstall hook. Windows/Linux ARM architectures and WSL/Remote SSH workspace combinations remain unverified. VS Code for the Web is unsupported.

The same published 0.2.1 binary subsequently passed native checks on **macOS 15, both Intel x64 and Apple Silicon arm64**, with **regular VS Code 1.136.1** (`a44adf7f53e00964ab890f9f8758a334f1fc15bc`) and **Insiders 1.137.0** (`de8cc55dae905582f191fdcfb6dff8c811a743c4`). All four combinations passed ten checks covering installation, opt-in, status, online image loading, code and Markdown hiding the scenery, returning to an empty editor, a full application restart with the wallpaper applied, restoration, and the directly invoked uninstall hook. The restart uses a new native process and the same patched application and profile, with no macOS security settings changed. [Native Mac run and artifacts](https://github.com/zeusu-sato/ocean-window/actions/runs/33967589195). The binary and its release checksum are unchanged; the bundled README's earlier unverified-Mac note predates these checks. See the [Mac guide](macos.md).

For the historical native version, applying the wallpaper requires write access to VS Code's installed workbench. Linux system packages may be owned by root; read-only Snap installations cannot be patched. An official `.tar.gz` extracted into a user-owned directory is an alternative. The extension never changes installation permissions or elevates itself.

The [Mac native workflow](../.github/workflows/macos-native.yml) runs against published release VSIX files on standard GitHub-hosted Macs, for both architectures and both VS Code release channels. It verifies Microsoft's application archive checksum and the published extension checksum before installation. Evidence contains only reports, logs, and screenshots; test profiles and caches are excluded from uploaded artifacts.

## Publication process

Publication uses the official [publisher management page](https://marketplace.visualstudio.com/manage/publishers/zeusu-sato) and Microsoft's [publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension). A release is reported as published only after the public Gallery returns the validated version and its universal package metadata.
