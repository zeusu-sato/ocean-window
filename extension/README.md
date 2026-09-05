# Ocean Window

A quiet window onto the world's oceans, only while your editor is empty.

Ocean Window replaces the unused editor watermark with a real coastal photograph. Open code, Markdown, a preview, or another editor and the scene disappears. Your normal editor background and chat colors remain in place.

[GitHub release](https://github.com/zeusu-sato/ocean-window/releases/tag/v0.2.0) · [Source code](https://github.com/zeusu-sato/ocean-window) · [Report an issue](https://github.com/zeusu-sato/ocean-window/issues)

![Browser layout preview showing a narrow ocean scene beside the work area](https://raw.githubusercontent.com/zeusu-sato/ocean-window/main/docs/ocean-window-preview.png)

Browser layout preview using the actual wallpaper renderer. Photograph: [Matira Beach, Bora Bora](https://commons.wikimedia.org/wiki/File:Matira_Beach,_Bora_Bora,_French_Polynesia.jpg) by Scott Williams, [CC BY 2.5](https://creativecommons.org/licenses/by/2.5), displayed with a crop and dark overlay.

The Windows preview is available as a VSIX from the GitHub release above. See the [publication status](https://github.com/zeusu-sato/ocean-window/blob/main/docs/publication.md) for Marketplace availability.

## Experimental native wallpaper

**This extension changes VS Code's installed workbench HTML.** It is an unofficial customization and causes VS Code's installation integrity warning. It preserves the existing Content Security Policy and does not suppress integrity checks.

Installing the extension does not apply the wallpaper. You explicitly enable it with the command below. The change applies to this VS Code installation, across its windows and profiles, and may need reapplication after VS Code updates. Enabling it requires write access to your VS Code installation. Administrator privileges are not requested automatically.

The initial preview package targets Windows x64 desktop. Rendering has been tested with VS Code Insiders 1.137.0. Stable builds are not yet verified. VS Code for the Web is not supported. It is configured as a local UI extension for WSL and Remote SSH workspaces; those combinations have not yet been tested.

## Start looking out

1. Download the [Windows x64 VSIX](https://github.com/zeusu-sato/ocean-window/releases/download/v0.2.0/ocean-window-0.2.0-win32-x64.vsix).
2. In VS Code's Extensions view, choose **… → Install from VSIX…** and select it.
3. Open the Command Palette and run **Ocean Window: Enable / Apply Ocean Wallpaper**. Read the native customization notice and enable it.
4. Reload the window when your running work is ready.

Photos change every 10 minutes. Move the pointer over the scene for **Next**, **Pause**, and **Photo credits**. Shuffling avoids repetition until the current catalog is exhausted. While the editor is occupied, hidden, or minimized, rotation pauses. Reduced-motion preferences disable the crossfade.

## Real photographs, refreshed online

Wikimedia Commons supplies the photographs. The default catalog contains up to 60 candidates across 12 coastal regions and refreshes after 24 hours. Metadata is cached, and images load on demand through Chromium's HTTP cache. No API key or separate service is required.

Photos are selected using coastal categories, image dimensions, descriptions, and reusable licenses. The selection is automatic; composition and weather will vary. Use Next when a scene does not suit you. Photographer, source, and license links remain available on every photograph.

Network failures keep the current picture. A fresh installation that cannot download a picture keeps the standard empty editor until a later retry.

## Settings

Use **Ocean Window: Open Settings**, then apply your changes with the Enable / Apply command.

| Setting | Default | Meaning |
| --- | --- | --- |
| `oceanWindow.intervalMinutes` | 10 | Minutes between pictures |
| `oceanWindow.brightness` | 0.78 | Picture brightness, from 0 to 1 |
| `oceanWindow.showCaption` | true | Show place names |
| `oceanWindow.refreshHours` | 24 | Online catalog refresh interval |
| `oceanWindow.targetPhotoCount` | 60 | Maximum catalog size, up to 200 |

These are application settings because all windows share the installed workbench. Changing a workspace cannot silently apply a different wallpaper configuration.

## Restore before uninstalling

Run **Ocean Window: Restore Original Editor**, then reload the window. This restores the normal empty editor and removes only Ocean Window's owned payload. Backups are kept alongside the workbench HTML.

**Disabling the extension alone does not undo an already applied native patch.** An uninstall hook also attempts restoration, but VS Code runs that hook only after a complete uninstall and a later restart. Restore explicitly before disabling or uninstalling for immediate, predictable removal.

After a VS Code update, run the Enable / Apply command again if the scenery has disappeared. Ocean Window never silently patches a new VS Code version at startup.

### Migrating from the earlier local preview

If the previous extension ID is `ocean-window-local.ocean-window`, run its Restore command, reload, and uninstall it. Completely quit and restart VS Code before enabling this release (`zeusu-sato.ocean-window`). The old extension's delayed cleanup must finish first, because both versions customize the same workbench.

## Privacy and licenses

The extension does not read or transmit your code, file names, or chat contents. Image requests go to Wikimedia Commons and its image hosts. The source receives ordinary network request information, such as your IP address. There is no extension analytics, account, or advertising service.

A small restore receipt records the VS Code installation path in extension storage and in the extension directory's parent `.ocean-window` folder. This lets cleanup work across extension updates. The image catalog is stored under the workbench's `oceanWindow.wikimedia.v1` cache key.

Extension code is MIT licensed. Photographs retain their individual Creative Commons or public-domain terms; the MIT license does not apply to photographs. See the included `PHOTO-CREDITS.md`, the [source credits and fixture metadata](https://github.com/zeusu-sato/ocean-window/blob/main/docs/photo-sources.md), and each picture's credits.

For troubleshooting and restoration help, see [Support](https://github.com/zeusu-sato/ocean-window/blob/main/extension/SUPPORT.md) or [open an issue](https://github.com/zeusu-sato/ocean-window/issues).

## 日本語

何も開いていないエリアだけに、世界の海を映す拡張です。コマンドパレットの **Ocean Window: 海の壁紙を有効化・設定を適用** で開始し、作業が落ち着いてからウィンドウを再読み込みしてください。

VS Code本体の表示ファイルを変更する実験的な方式のため、整合性警告が出ます。解除は **Ocean Window: 元のエディターに戻す** を実行してから再読み込みします。拡張を「無効」にするだけでは、適用済みの壁紙は解除されません。

GitHub から VSIX をダウンロードできます。Marketplace への掲載状況は[公開状況](https://github.com/zeusu-sato/ocean-window/blob/main/docs/publication.md)をご覧ください。旧 `ocean-window-local` 版を使っていた場合は、旧版を復元・削除し、VS Code を完全に終了して起動し直してから新版を有効にしてください。
