# Hospital Rounds

現在のバージョン: 1.0.0

## バージョニング方針

[セマンティックバージョニング](https://semver.org/lang/ja/) (`MAJOR.MINOR.PATCH`) に従う:

- MAJOR: 破壊的変更（Bundle schema の bump など、旧データが動かなくなる変更）
- MINOR: 互換性を保った機能追加
- PATCH: バグ修正

## リリース履歴

- **1.0.0**: データ構造リファクタ完了。正式リリース基準点
  - Bundle 形式（`format` / `schema` / `sections`）導入で前後互換を確保
  - `storage.js` で永続化を抽象化（IndexedDB 等への将来移行に対応）
  - `appState` から rosterState を分離（管理機能OFF時に名簿系メタを生成しない）
  - 管理機能QRペイロードを Bundle セクションで構築
  - 共有QRのタグピッカーを共有一覧と統一、状態を共有
  - 共有QRの受信フローを QR ボタン+カメラに集約
- 0.1.0: snishi-code.com から hospital-rounds リポへ分割
