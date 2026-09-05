# Changelog

## 0.3.0 — Standard editor scene

- Display photographs through VS Code's standard Webview API, with no application-file changes, administrator access, or native integrity warning for new installations.
- Automatically show a temporary Ocean Window tab in an empty editor group and close it when a file or another editor opens.
- Remember the on/off choice per workspace. Closing the scene tab keeps it dismissed until a real editor is opened and closed, or Show Ocean Window is run.
- Apply photograph settings without reloading VS Code.
- Keep explicit legacy restoration for existing 0.2.x native patches. Failed first-enable receipts on clean, read-only Linux installations can be retired without native writes.
- Retain one universal package for Windows, Linux, Intel Macs, and Apple Silicon Macs, in regular VS Code and Insiders 1.130 or later.

## 0.2.1 — Universal preview

- Remove the Windows x64 package restriction so Linux desktop clients can install the extension.
- Lower the minimum VS Code version from 1.136 to 1.130.
- Explain native installation write-permission and read-only filesystem failures without requesting elevated privileges.
- Locate standalone VS Code Insiders installations on Unix systems as well as Windows.

## 0.2.0 — Preview

- Package the existing empty-editor scenery as a Windows desktop extension.
- Add explicit enable, restore, status, and settings commands in English and Japanese.
- Read the current VS Code application root, with serialized native changes and recovery receipts.
- Retain online Wikimedia discovery, cached catalogs, pause controls, credits, and empty-only rendering.
- Add best-effort restoration on complete extension uninstall.

## 0.1.0 — Local prototype

- Create native empty-editor scenery with a reversible PowerShell installer.
