# Linux: permission denied when enabling

An `EACCES` error creating `workbench.html.ocean-window.lock` under `/usr/share/code-insiders/resources/app` means Ocean Window cannot create files in that system installation's workbench directory. Installing the extension and applying its native wallpaper have separate permission requirements.

A user-owned official VS Code `.tar.gz` installation is one option. To keep an existing system installation on your own machine, an administrator can instead give your user access to the exact workbench directory reported in the error. This grants the user permission to create and replace entries in that directory, which the native customization requires.

For this specific Insiders path, run the following in your ordinary Linux user's terminal:

```bash
sudo setfacl -m "u:$(id -u):rwx" -- \
  /usr/share/code-insiders/resources/app/out/vs/code/electron-browser/workbench
```

The [setfacl command](https://man7.org/linux/man-pages/man1/setfacl.1.html) adds an access entry for the current user to that one directory. It does not apply recursively. The directory owner remains unchanged. If the machine has custom ACLs, inspect them with `getfacl` first: adding an ACL can recalculate the effective group/named-user mask.

If `setfacl` is missing, Ubuntu/Debian users can install the `acl` package with `sudo apt install acl`, then repeat the command.

Run **Ocean Window: Enable / Apply Ocean Wallpaper** again, then reload when your work is ready. Use the actual directory from your error if its path differs; regular VS Code normally uses a different installation directory.

The installer creates its lock, backup, payload stage and temporary HTML in the workbench directory. It then atomically replaces HTML, so granting write access only to the old HTML file would not be sufficient. Replacement HTML is owned by the applying user; Restore restores its contents, not package-manager ownership metadata.

This procedure was verified with the published 0.2.1 installer under actual Linux: a root-owned, mode-0755 workbench directory reproduced the same lock `EACCES` for an ordinary user. Adding only the directory ACL allowed enable, reapply and exact HTML restoration while the directory and an unrelated file remained root-owned. An existing Ocean Window payload created by a different account needs separate inspection.

The ACL does not make a read-only filesystem writable, so it cannot fix a read-only Snap installation. A VS Code package update that recreates the directory may also remove the added ACL.

To remove the added ACL, first run **Ocean Window: Restore Original Editor** and reload, then use:

```bash
sudo setfacl -x "u:$(id -u)" -- \
  /usr/share/code-insiders/resources/app/out/vs/code/electron-browser/workbench
```
