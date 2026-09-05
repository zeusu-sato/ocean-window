# Distribution and validation

## GitHub preview

Ocean Window `0.2.0` is distributed as a Windows x64 VSIX through the [GitHub prerelease](https://github.com/zeusu-sato/ocean-window/releases/tag/v0.2.0). The asset is named `ocean-window-0.2.0-win32-x64.vsix`. Source and support are hosted at [zeusu-sato/ocean-window](https://github.com/zeusu-sato/ocean-window).

The [Marketplace publisher **zeusu-sato**](https://marketplace.visualstudio.com/publishers/zeusu-sato), displayed as **Zeusu Sato**, is registered with homepage [dorodango.biz](https://dorodango.biz). On 2026-09-05, the same audited VSIX was submitted to the Marketplace with public availability. **Microsoft's package verification is in progress.** The management page currently shows `Verifying`; the public extension page and validated Gallery entry are not yet available.

This is an experimental native customization: it modifies workbench HTML, preserves Content Security Policy and integrity checks, and requires an explicit enable command. The [full guide](../extension/README.md) explains the integrity warning, configuration, and restoration.

## Build

Use Node.js and an installed Google Chrome, which the browser tests and icon builder access through Playwright's `chrome` channel. From the repository root:

```powershell
npm ci
npm test
npm run package:extension
```

The builder takes the default publisher identity from `extension/package.json`. It stages an explicit set of runtime files, package metadata, documentation, and an original icon. Test profiles, VS Code binaries, image fixtures, user settings, install receipts, and development dependencies are excluded from the VSIX. The credited image fixtures remain in the source repository for reproducible browser tests.

## Tested scope

The preview passed **50 automated tests: 44 Node tests and six browser tests**. These cover initial opt-in, settings, concurrent operations, recovery receipts, restoration, Wikimedia discovery and caching, and the empty-editor display lifecycle. Browser tests use local photograph fixtures; they do not establish the availability of the live Wikimedia service.

Native checks used an isolated copy of **VS Code Insiders 1.137.0 on Windows x64**. They exercised the packaged extension's activation, enable, status, settings, and restore commands, and confirmed scenery in the empty editor while code and Markdown retained their normal display.

The packaged uninstall hook was also invoked directly and restored the isolated native application from its extension receipt. This verifies the hook executable, not VS Code's delayed uninstall scheduling. Stable VS Code, macOS, Linux, and WSL/Remote SSH combinations are not claimed as tested.

## Restore and preview migration

Run **Ocean Window: Restore Original Editor** and reload before disabling or uninstalling. Disabling the extension does not reverse an already applied native patch. The uninstall hook is a fallback that VS Code runs after full removal and a later restart.

Users of the earlier `ocean-window-local.ocean-window` preview must restore it, reload, uninstall it, and completely quit and restart VS Code before enabling `zeusu-sato.ocean-window`. Otherwise, the old preview's delayed cleanup could remove the replacement's wallpaper.

## Marketplace status

Publication was submitted through the official [publisher management page](https://marketplace.visualstudio.com/manage/publishers/zeusu-sato), following Microsoft's [publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension). Once validation completes, the intended listing address is `https://marketplace.visualstudio.com/items?itemName=zeusu-sato.ocean-window`. Until then, use the GitHub VSIX above.

Marketplace acceptance of this native technique remains a review decision. The supported extension API does not provide arbitrary workbench DOM access, as described in its [restrictions](https://code.visualstudio.com/api/extension-capabilities/overview#restrictions). GitHub distribution and successful packaging do not establish Marketplace approval.
