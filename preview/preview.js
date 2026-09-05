const group = document.querySelector('.editor-group-container');
function openDocument(text) {
  group.querySelector('.document')?.remove();
  group.classList.remove('empty');
  group.querySelector('.editor-group-watermark').hidden = true;
  const pre = document.createElement('pre');
  pre.className = 'document';
  pre.textContent = text;
  group.append(pre);
}
document.querySelector('#open-code').onclick = () => openDocument('function hello() {\n  return "Hello, ocean!";\n}\n\n// コードはいつもの背景で\nconsole.log(hello());');
document.querySelector('#open-markdown').onclick = () => openDocument('# 今日のメモ\n\nMarkdownも読みやすく。\n海はファイルを閉じると\nまた見えるようになります。');
document.querySelector('#close-file').onclick = () => {
  group.querySelector('.document')?.remove();
  group.querySelector('.editor-group-watermark').hidden = false;
  group.classList.add('empty');
};
