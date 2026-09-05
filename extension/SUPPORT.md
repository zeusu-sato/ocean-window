# Support

This is an experimental native wallpaper preview for Windows x64 desktop.

[Report an issue](https://github.com/zeusu-sato/ocean-window/issues) · [Full guide](https://github.com/zeusu-sato/ocean-window/blob/main/extension/README.md) · [GitHub releases](https://github.com/zeusu-sato/ocean-window/releases)

For a blank or unexpected scene, run **Ocean Window: Show Status** and inspect the **Ocean Window** output channel. Include the VS Code version, operating system, extension version, and the error when reporting an issue. Remove any personal installation paths you do not want to share.

For immediate removal, run **Ocean Window: Restore Original Editor** and reload before disabling or uninstalling the extension. If the extension cannot start, open a terminal in its installed extension directory and run the included restore tool with Node.js:

```
node runtime/tools/install.mjs --app-root "<VS Code resources/app directory>" --uninstall
```

Do not delete or overwrite the whole VS Code installation to remove this wallpaper. The installer retains `workbench.html.ocean-window.bak`, and the restore command removes the marked Ocean Window block while preserving other edits.

When moving from `ocean-window-local.ocean-window` to `zeusu-sato.ocean-window`, restore and uninstall the old preview, then completely quit and restart VS Code before enabling the replacement. This allows the old extension's delayed uninstall cleanup to finish first.

Download the preview from GitHub and check the [publication status](https://github.com/zeusu-sato/ocean-window/blob/main/docs/publication.md) for Marketplace availability.
