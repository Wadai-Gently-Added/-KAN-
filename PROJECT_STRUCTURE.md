# PROJECT_STRUCTURE.md — 換-KAN-

最終更新：2026-09-12（v1.0.0 初版）

```
kan-tool/
├─ index.html          … 画面構造（フォルダ／ルール／プレビュー／実行）
├─ styles.css           … 見た目（墨×藍のダークトーン、モノスペースでパス表示）
├─ app.js                … コアロジック
│   ├─ state              … folders / rules / preview / history / redoStack
│   ├─ フォルダ管理        … addFolder / removeFolder / renderFolders
│   ├─ ルール管理          … addRule / removeRule / renderRules / ruleValidationMessage
│   ├─ 探索                … scanDirectory（再帰・深さ制限つき）
│   ├─ プレビュー          … buildPreview / renderPreview
│   ├─ 実行                … renameOne（作成→書込→検証→削除）/ executeAll
│   └─ Undo/Redo           … undoBatch / undoLast / redoLast
├─ manifest.json         … PWAマニフェスト（アイコン未設定＝要追加）
├─ sw.js                  … Service Worker（オフラインキャッシュ、静的アセットのみ）
├─ README.md              … 使い方・既知の制約
└─ PROJECT_STRUCTURE.md   … このファイル
```

## 状態管理の方針

- 全て**インメモリ**（ページを閉じると消える）。IndexedDBへのフォルダハンドル永続化はv1では未実装。
- フォルダの`handle`、ファイルの`fileHandle`/`dirHandle`はJSオブジェクトとして直接保持し、
  ページリロードをまたいでは使えない前提。

## 次にやるなら（優先順）

1. Redoの安定性向上・エラー処理強化（仕様書の優先順位どおり）
2. ルールのIndexedDB保存（毎回入力し直さなくて済むように）
3. フォルダハンドルのIndexedDB永続化＋権限再要求フロー
4. アイコン画像の用意（`manifest.json`の`icons`が空のまま）
5. 使用感を見た上で iOS対応 or デスクトップアプリ化を再検討

## 既知の制約（設計上の判断）

- リネームは「作成→書込→検証→削除」の疑似操作（3. 仕様確認の回答を参照）
- Safari/iOS/Firefoxは非対応（起動時に自動検出してバナー表示）
- Undo/Redoはセッション内限定
