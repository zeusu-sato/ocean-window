# Support

This is an experimental native wallpaper preview for desktop VS Code 1.130 or later, including Insiders. Version 0.2.1 uses a universal package; version 0.2.0 was restricted to Windows x64 and required VS Code 1.136.

[Report an issue](https://github.com/zeusu-sato/ocean-window/issues) · [Full guide](https://github.com/zeusu-sato/ocean-window/blob/main/extension/README.md) · [GitHub releases](https://github.com/zeusu-sato/ocean-window/releases)

For a blank or unexpected scene, run **Ocean Window: Show Status** and inspect the **Ocean Window** output channel. Include the VS Code version, operating system, extension version, and the error when reporting an issue. Remove any personal installation paths you do not want to share.

For immediate removal, run **Ocean Window: Restore Original Editor** and reload before disabling or uninstalling the extension. If the extension cannot start, open a terminal in its installed extension directory and run the included restore tool with Node.js:

```
node runtime/tools/install.mjs --app-root "<VS Code resources/app directory>" --uninstall
```

Do not delete or overwrite the whole VS Code installation to remove this wallpaper. The installer retains `workbench.html.ocean-window.bak`, and the restore command removes the marked Ocean Window block while preserving other edits.

When moving from `ocean-window-local.ocean-window` to `zeusu-sato.ocean-window`, restore and uninstall the old preview, then completely quit and restart VS Code before enabling the replacement. This allows the old extension's delayed uninstall cleanup to finish first.

If Linux reports an incompatible platform or requires VS Code 1.136, check that you are installing **0.2.1 or later**. Use the Marketplace pre-release or the universal VSIX from GitHub.

Installing the extension and applying the native wallpaper are separate steps. Application requires write access to VS Code's `resources/app` directory. System-managed `.deb`/`.rpm` installations may deny this, and read-only Snap installations cannot be patched. An official VS Code `.tar.gz` extracted into a directory you own is an alternative. Do not run VS Code as root or broadly change system permissions to enable the wallpaper. Ocean Window leaves permissions unchanged and reports the installation path when access is denied.

See the [publication status and tested platforms](https://github.com/zeusu-sato/ocean-window/blob/main/docs/publication.md).
