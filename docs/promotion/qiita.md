---
title: VS Codeが世界中のビーチリゾートの窓に？ Webviewで海を映す拡張を作った
tags:
  - VSCode
  - VSCode拡張機能
  - JavaScript
---

VS Code で AI チャットを使う時間が増えて、中央のエディターが空いていることが多くなりました。あの大きなロゴの代わりにカリブの海でも見えたらいいな、と思って作ったのが **Ocean Window** です。

![空のエディターに海を表示した Linux 版 VS Code](https://raw.githubusercontent.com/zeusu-sato/ocean-window/main/docs/ocean-window-webview-preview.png)

写真：[Cala Macarella](https://commons.wikimedia.org/wiki/File:Cala_Macarella.jpg) / Paul Stephenson / [CC BY 2.0](https://creativecommons.org/licenses/by/2.0)。トリミングと暗いオーバーレイを適用。

## 海を見るだけで権限設定は面倒

最初は VS Code 本体の workbench HTML を書き換えていました。ところが Linux の `/usr/share` 配下では `EACCES`。海を見るために権限を変えてもらうのは面倒です。

0.3.0 で標準の [Webview API](https://code.visualstudio.com/api/extension-guides/webview) に作り直しました。本体への書き込みは不要です。

海を表示している間だけタブが1枚出ます。コードや Markdown を開けば閉じ、グループが空になれば戻ってきます。文字の後ろには写真を敷かないので、いつもの配色で作業できます。

[パネルを作る部分](https://github.com/zeusu-sato/ocean-window/blob/main/extension/src/extension.cjs)は、こんなコードです。

```javascript
const panel = vscode.window.createWebviewPanel(
  VIEW_TYPE,
  'Ocean Window',
  { viewColumn: group.viewColumn, preserveFocus: true },
  { ...getWebviewOptions(vscode, context), retainContextWhenHidden: false }
);
```

`preserveFocus: true` で、チャットに入力中でも海にフォーカスを持っていかれません。

## 空かどうか、いつ戻すか

テキストエディターだけで空きを判定すると、画像や Markdown プレビューを開いていても海が出てしまいます。[TabGroups API](https://code.visualstudio.com/api/references/vscode-api#TabGroups) でタブの変更を受け取り、グループごとに自分以外のタブがあるかを調べます。あれば海を閉じる。空なら作る。

ただし、手動で閉じた直後に復活すると邪魔です。閉じたグループを覚えておき、ファイルを開いて閉じるか、表示コマンドを実行するまで再表示しません。

もう一つ、`onDidDispose` の中でパネルの `viewColumn` を読んで例外になりました。イベントが来た時点でパネルは破棄済み。所属グループを先に記録し、破棄時にはその記録を使うように直しました。

写真は Wikimedia Commons から取得して、既定で10分ごとにシャッフル。一巡するまで同じ写真を繰り返しません。画像は HTTP キャッシュを使い、再生状態も保存するので、海を開き直しても同じ写真に戻れます。撮影者とライセンスも写真ごとに確認できます。

[Marketplace](https://marketplace.visualstudio.com/items?itemName=zeusu-sato.ocean-window) の **Ocean Window / Zeusu Sato**、プレリリース版 **0.3.0** から使えます。インストールしてエディターを空にすれば海が出ます。ソースは [GitHub](https://github.com/zeusu-sato/ocean-window) にあります。
