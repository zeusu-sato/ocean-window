# Linux: upgrading from the old permission-dependent wallpaper

**Ocean Window 0.3 does not need write access to VS Code application files.** Its standard Webview scene works without a wallpaper-specific `sudo` command, ACL change, or replacement installation.

An error mentioning `workbench.html.ocean-window.lock` under `/usr/share/code-insiders/resources/app` comes from the 0.2.x native wallpaper or an explicit attempt to restore an existing old patch. Update the extension to 0.3 or later, leave the editor empty, and use **Ocean Window: Show Ocean Window** if it was turned off.

## Failed old enable with no patch

Version 0.2.x could save a `pending-enable` recovery receipt before failing to create its application lock. If this happened, the application is still clean. Legacy cleanup checks the application first and retires that receipt without attempting another native write or requiring a reload. The new scene works independently of the receipt.

## An old native patch was successfully applied

Use **Ocean Window: Restore Legacy Native Wallpaper**, then reload each affected window once. Restoration removes Ocean Window's marked block and owned payload while preserving unrelated edits and the original backup. It requires the same application access used to apply the old patch; the extension does not change permissions automatically.

A failed legacy restoration does not prevent the new scene from working. Include the exact error and application path in a [support report](https://github.com/zeusu-sato/ocean-window/issues) if cleanup is unavailable.

## If you previously added the documented ACL

This section only applies if you already added the named-user ACL from the old guide. It is not an installation step for 0.3.

First restore any old native patch and reload the affected windows. Then remove only the ACL entry you previously added. For the exact Insiders directory from that procedure:

```bash
sudo setfacl -x "u:$(id -u)" -- \
  /usr/share/code-insiders/resources/app/out/vs/code/electron-browser/workbench
```

Use your original target if it differed. Do not remove an ACL established for some other purpose. The old procedure changed only that directory's ACL; native HTML replacement also changed the HTML file owner to the applying user, and restoration restores contents rather than package-manager ownership metadata.

The earlier directory-ACL workaround was tested with the 0.2.1 native installer. That historical result is not a requirement or setup recommendation for the standard Webview scene.
