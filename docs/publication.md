# Distribution and validation

## GitHub preview

Ocean Window `0.2.1` is a universal desktop VSIX for VS Code **1.130 or later**, including Insiders. The [GitHub prerelease](https://github.com/zeusu-sato/ocean-window/releases/tag/v0.2.1) asset is named `ocean-window-0.2.1.vsix`. It replaces the Windows x64 restriction and minimum VS Code 1.136 requirement of `0.2.0`. Source and support are hosted at [zeusu-sato/ocean-window](https://github.com/zeusu-sato/ocean-window).

The [Marketplace publisher **zeusu-sato**](https://marketplace.visualstudio.com/publishers/zeusu-sato), displayed as **Zeusu Sato**, is registered with homepage [dorodango.biz](https://dorodango.biz). The extension is published on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=zeusu-sato.ocean-window) under the unchanged ID `zeusu-sato.ocean-window`. Version 0.2.0 passed Microsoft's package verification on 2026-09-05; the universal 0.2.1 update is being submitted to that same listing.

This is an experimental native customization: it modifies workbench HTML, preserves Content Security Policy and integrity checks, and requires an explicit enable command. The [full guide](../extension/README.md) explains the integrity warning, configuration, and restoration.

## Build

Use Node.js and an installed Google Chrome, which the browser tests and icon builder access through Playwright's `chrome` channel. From the repository root:

```powershell
npm ci
npm test
npm run package:extension
```

The builder takes the default publisher identity from `extension/package.json`. It packages a pre-release without `--target`, producing a universal VSIX with no `Identity.TargetPlatform`. The runtime is JavaScript with Node built-ins and has no native binary dependencies. It stages an explicit set of runtime files, package metadata, documentation, and an original icon. Test profiles, VS Code binaries, image fixtures, user settings, install receipts, and development dependencies are excluded from the VSIX. The credited image fixtures remain in the source repository for reproducible browser tests.

## Tested scope

For 0.2.1, the Windows regression run passed **50 Node tests and six browser tests**, with one POSIX symlink case skipped. The installer and extension adapter also ran under actual Linux Node: **40 passed**, with two Windows sharing cases skipped and the POSIX symlink case passing. These cover initial opt-in, settings, concurrent operations, recovery receipts, restoration, permission failures, Wikimedia discovery and caching, and the empty-editor display lifecycle. Browser tests use local photograph fixtures; they do not establish the availability of the live Wikimedia service.

Native 0.2.1 checks used Microsoft's official **Linux x64 VS Code 1.130.0 stable** (`1b6a188127eeaf9194f945eb6eb89a657e93c54c`) and **1.137.0 Insiders** (`de8cc55dae905582f191fdcfb6dff8c811a743c4`) archives, with their download SHA-256 values verified. Both ran as native Linux Electron processes under Ubuntu in WSL, with headless rendering and isolated applications, profiles, extensions, and shared data. This tests a Linux desktop extension host, not a Windows UI connected to a WSL workspace.

Both Linux builds passed nine checks with the exact release VSIX: installation and activation without auto-patching, explicit enable, nonblocking status, a real online sea photograph in the empty editor, code and Markdown hiding the scenery, closing files returning the scenery, restoration, and the packaged uninstall hook. The hook was invoked directly with Linux Node and completed within its five-second limit; this does not test VS Code's delayed uninstall scheduling. The tested VSIX SHA-256 is `28659cbc125e2ea2fa43cb88ccc36d9dea1adc2eae209646fac2792c76775ad5`.

The exact historical **1.130.0-insider** binary was unavailable from the named download endpoint. Compatibility is supported by the 1.130 stable native test and review of the official 1.130 API definitions, alongside the newer Insiders native test.

The preceding 0.2.0 release was also tested natively in an isolated **Windows x64 VS Code Insiders 1.137.0** installation, including activation, enable, status, settings, restoration, code and Markdown display, and the directly invoked uninstall hook. macOS, ARM architectures, and WSL/Remote SSH workspace combinations remain unverified. VS Code for the Web is unsupported.

Applying the wallpaper requires write access to VS Code's installed workbench. Linux system packages may be owned by root; read-only Snap installations cannot be patched. An official `.tar.gz` extracted into a user-owned directory is an alternative. The extension never changes installation permissions or elevates itself.

## Restore and preview migration

Run **Ocean Window: Restore Original Editor** and reload before disabling or uninstalling. Disabling the extension does not reverse an already applied native patch. The uninstall hook is a fallback that VS Code runs after full removal and a later restart.

Users of the earlier `ocean-window-local.ocean-window` preview must restore it, reload, uninstall it, and completely quit and restart VS Code before enabling `zeusu-sato.ocean-window`. Otherwise, the old preview's delayed cleanup could remove the replacement's wallpaper.

## Marketplace status

Publication was submitted through the official [publisher management page](https://marketplace.visualstudio.com/manage/publishers/zeusu-sato), following Microsoft's [publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension). The public Marketplace listing and the GitHub release are both available.

Marketplace publication does not change the native customization mechanism: the supported extension API does not provide arbitrary workbench DOM access, as described in its [restrictions](https://code.visualstudio.com/api/extension-capabilities/overview#restrictions). The extension continues to disclose its workbench changes and expected integrity warning.
