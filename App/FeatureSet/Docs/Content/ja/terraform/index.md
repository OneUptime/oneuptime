# Terraformプロバイダードキュメント

OneUptime Terraformプロバイダーを使用すると、OneUptimeのモニタリング、アラート、可観測性リソースをInfrastructure as Code（IaC）で管理できます。

## ドキュメントのセクション

### [はじめに](./quick-start.md)
OneUptime Terraformプロバイダーを数分で使い始めるためのクイックセットアップガイド。

### [完全なプロバイダーガイド](./README.md)
インストール、設定、リソース、ベストプラクティスを網羅した包括的なドキュメント。

### [セルフホスト設定](./self-hosted.md)
**セルフホストのお客様に重要**：バージョン固定、互換性、デプロイメント戦略。

### [使用例](./examples.md)
一般的なOneUptime Terraform設定の実際の使用例とパターン。

## クイックリンク

### OneUptime Cloudのお客様
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### セルフホストのお客様
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # OneUptimeのバージョンと完全一致させる必要があります
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## セルフホストユーザーへの重要なお知らせ

**バージョン互換性が重要です**：Terraformプロバイダーのバージョンを常にOneUptimeのインストールバージョンに完全一致するよう固定してください。バージョンの不一致はAPIの互換性問題を引き起こす可能性があります。

## 外部リソース

- **Terraform Registry**：[OneUptimeプロバイダー](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHubリポジトリ**：[OneUptimeソースコード](https://github.com/OneUptime/oneuptime)
- **コミュニティサポート**：[OneUptimeコミュニティ](https://community.oneuptime.com)

## 利用可能なリソース

プロバイダーはOneUptimeリソースの包括的な管理をサポートしています：

- **プロジェクト & チーム**：モニタリング構造の整理
- **モニター**：ウェブサイト、API、ポート、ハートビート、カスタムモニター
- **インシデント管理**：アラートポリシー、オンコールスケジュール、エスカレーション
- **ステータスページ**：カスタムブランディング付きの公開・プライベートステータスページ
- **サービスカタログ**：サービスの定義と依存関係のマッピング
- **ワークフロー**：自動化されたレスポンスと修復ワークフロー

## サポート

issueや質問、貢献に関しては：

1. **ドキュメントの問題**：[OneUptimeリポジトリ](https://github.com/OneUptime/oneuptime/issues)でissueを作成
2. **プロバイダーのバグ**：メインのOneUptimeリポジトリに報告
3. **機能リクエスト**：OneUptimeコミュニティで議論
4. **一般的な質問**：コミュニティフォーラムを使用

## 次のステップ

1. **新規ユーザー**：[クイックスタートガイド](./quick-start.md)から始めましょう
2. **セルフホスト**：[セルフホスト設定](./self-hosted.md)を確認してください
3. **上級ユーザー**：複雑なセットアップのための[使用例](./examples.md)を探索してください
4. **完全なリファレンス**：すべての機能については[完全なガイド](./README.md)を確認してください
