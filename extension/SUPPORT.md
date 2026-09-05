# Support

Ocean Window 0.3 uses the standard Webview API in desktop VS Code 1.130 or later. The universal extension targets Windows, Linux, Intel Macs, and Apple Silicon Macs, with regular VS Code and Insiders.

[Report an issue](https://github.com/zeusu-sato/ocean-window/issues) · [Full guide](https://github.com/zeusu-sato/ocean-window/blob/main/extension/README.md) · [GitHub releases](https://github.com/zeusu-sato/ocean-window/releases)

## The sea is missing

Leave an editor group empty and run **Ocean Window: Show Ocean Window**. Files, Markdown previews, settings, and other editors keep that group occupied. Closing the Ocean Window tab temporarily dismisses it; opening and closing a real editor or running Show brings it back.

For a blank or unexpected photograph, use **Next**, check network access to Wikimedia Commons, and run **Ocean Window: Show Status**. Include the VS Code version, operating system, extension version, and error when reporting an issue. Remove personal installation paths you do not want to share. See [validation status](https://github.com/zeusu-sato/ocean-window/blob/main/docs/publication.md).

## Linux permission errors

If an error mentions `workbench.html.ocean-window.lock` or write access to `/usr/share/code-insiders/resources/app`, check that the installed extension is **0.3.0 or later**. Those requirements belonged to the 0.2.x native wallpaper. The new scene does not write to VS Code application files, so it needs no `sudo`, ACL change, or replacement VS Code installation. This applies equally to regular VS Code and Insiders.

If an older failed enable left a recovery receipt but no patch, legacy cleanup and the uninstall hook can retire it without writing to the application. An unrelated error writing VS Code's own user data remains a separate issue; include the full path in a support report.

## Turn off the scene

Run **Ocean Window: Turn Off Ocean Window**. The choice is remembered for the workspace. Disabling or uninstalling the extension also ends its Webview scene through the normal VS Code lifecycle.

## Remove an existing 0.2.x native patch

Only users who successfully applied the old native wallpaper need **Ocean Window: Restore Legacy Native Wallpaper**, followed by one reload of each affected window. The command checks the current application before writing and preserves unrelated edits and the original backup. It does not change permissions. Failed restoration does not prevent the new Webview scene from working.

If the extension cannot start and you need to restore a known old patch, the included Node.js recovery tool remains available from the installed extension directory:

```
node runtime/tools/install.mjs --app-root "<VS Code resources/app directory>" --uninstall
```

This tool is for legacy recovery, not for showing the 0.3 scene. The old backup is `workbench.html.ocean-window.bak`. Existing Linux ACL changes are described in the [legacy Linux recovery note](https://github.com/zeusu-sato/ocean-window/blob/main/docs/linux-permissions.md).

If the separate `ocean-window-local.ocean-window` prototype is still installed, restore and uninstall it as well. Updating the published extension retains the ID `zeusu-sato.ocean-window`; its new Webview is independent of the old native payload.

See the [Mac guide](https://github.com/zeusu-sato/ocean-window/blob/main/docs/macos.md) for Intel and Apple Silicon installation notes.
