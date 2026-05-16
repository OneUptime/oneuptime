# OneUptime Terraformプロバイダー

OneUptime Terraformプロバイダーを使用すると、Infrastructure as Code（IaC）でOneUptimeのリソースを管理できます。このプロバイダーを使用することで、Terraform経由でモニタリング、インシデント管理、ステータスページ、その他のOneUptime機能を設定できます。

## 目次

- [インストール](#インストール)
- [プロバイダー設定](#プロバイダー設定)
- [クイックスタート](#クイックスタート)
- [バージョン互換性](#バージョン互換性)
- [利用可能なリソース](#利用可能なリソース)
- [使用例](#使用例)
- [ベストプラクティス](#ベストプラクティス)
- [移行ガイド](#移行ガイド)

## インストール

### Terraform Registryから（推奨）

OneUptime Terraformプロバイダーは [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime) で利用可能です。

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 最新の7.xバージョンを使用
    }
  }
  required_version = ">= 1.0"
}
```

### セルフホストインストールのバージョン固定

⚠️ **セルフホストのお客様への重要なお知らせ**：APIの互換性を確保するために、TerraformプロバイダーのバージョンはOneUptimeのインストールバージョンに合わせて固定してください。

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # OneUptimeのインストールバージョンに完全一致させる
    }
  }
  required_version = ">= 1.0"
}
```

#### OneUptimeのバージョン確認方法

OneUptimeのバージョンはいくつかの方法で確認できます：

1. **ダッシュボード**：OneUptime ダッシュボードの設定 → About に移動
2. **API**：`GET /api/status` エンドポイントを呼び出す
3. **Docker**：使用しているイメージタグを確認
4. **Helm**：Helmチャートのバージョンを確認

```bash
# 例：OneUptime 7.0.123を実行している場合
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## プロバイダー設定

### 基本設定

```hcl
provider "oneuptime" {
  oneuptime_url = "https://your-oneuptime-instance.com"  # またはクラウドの場合 https://oneuptime.com
  api_key       = var.oneuptime_api_key
}
```

### 環境変数

環境変数を使用してプロバイダーを設定できます：

```bash
export ONEUPTIME_URL="https://your-oneuptime-instance.com"
export ONEUPTIME_API_KEY="your-api-key-here"
```

環境変数から読み取る場合、明示的な設定なしでプロバイダーを使用できます：

```hcl
provider "oneuptime" {
  # 設定は環境変数から読み取られます
}
```

### 設定オプション

| 引数 | 環境変数 | 説明 | 必須 |
|----------|---------------------|-------------|----------|
| `oneuptime_url` | `ONEUPTIME_URL` | OneUptime URL | はい |
| `api_key` | `ONEUPTIME_API_KEY` | OneUptime APIキー | はい |

## クイックスタート

### 1. APIキーの作成

まず、OneUptime ダッシュボードでAPIキーを作成します：

1. **設定** → **APIキー** に移動
2. **APIキーの作成** をクリック
3. わかりやすい名前を付けます（例：「Terraform Automation」）
4. 適切な権限を選択
5. 生成されたAPIキーをコピー

### 2. 基本的なTerraform設定

`main.tf` ファイルを作成します：

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
  oneuptime_url = "https://oneuptime.com"  # インスタンスURLを使用
  api_key       = var.oneuptime_api_key
}

# 注意：プロジェクトはOneUptime ダッシュボードで手動作成する必要があります
variable "project_id" {
  description = "OneUptimeのプロジェクトID"
  type        = string
}

# モニターを作成
resource "oneuptime_monitor" "website" {
  name        = "ウェブサイトモニター"
  description = "ウェブサイトの稼働時間監視"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# チームを作成
resource "oneuptime_team" "platform" {
  name        = "プラットフォームチーム"
  description = "プラットフォームエンジニアリングチーム"
}
    value = "alerts@example.com"
  }
}
```

### 3. 初期化と適用

```bash
# Terraformを初期化
terraform init

# 変更を計画
terraform plan

# 設定を適用
terraform apply
```

## バージョン互換性

### クラウドのお客様

OneUptime Cloudのお客様は最新のプロバイダーバージョンを使用してください：

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 常に最新の互換バージョンを使用
    }
  }
}
```

### セルフホストのお客様

**重要**：セルフホストのお客様はOneUptimeのインストールに合わせてプロバイダーバージョンを固定する必要があります：

| OneUptimeバージョン | プロバイダーバージョン | 設定 |
|-------------------|------------------|---------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| 7.2.x | 7.2.x | `version = "~> 7.2.0"` |

OneUptime 7.0.123の例：

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # バージョンを完全一致させる
    }
  }
}
```

## 利用可能なリソース

OneUptime Terraformプロバイダーは以下のリソースをサポートしています：

### コアリソース
- `oneuptime_team` — チームの管理

### モニタリング
- `oneuptime_monitor` — モニターの作成と管理
- `oneuptime_probe` — 監視プローブの管理

### オンコール管理
- `oneuptime_on_call_duty_policy` — オンコールスケジュールの設定

### ステータスページ
- `oneuptime_status_page` — ステータスページの作成

### サービスカタログ
- `oneuptime_service_catalog` — サービスカタログエントリの管理

### サービスカタログ
- `oneuptime_service` — サービスの定義
- `oneuptime_service_dependency` — サービス依存関係のマッピング

### データソース
注意：プロバイダースキーマにデータソースが定義されていないため、データソースは現在プロバイダーで利用できません。

## 使用例

### 完全なモニタリングセットアップ

```hcl
# 変数
variable "oneuptime_api_key" {
  description = "OneUptime APIキー"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "OneUptimeプロジェクトID（ダッシュボードで手動作成）"
  type        = string
}

variable "oneuptime_url" {
  description = "OneUptime URL"
  type        = string
  default     = "https://oneuptime.com"
}

# プロバイダー設定
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# チーム
resource "oneuptime_team" "platform" {
  name        = "プラットフォームチーム"
  description = "プラットフォームエンジニアリングチーム"
}

# モニター
resource "oneuptime_monitor" "api" {
  name        = "APIヘルスチェック"
  description = "APIヘルスエンドポイントのモニター"
  data        = jsonencode({
    url = "https://api.mycompany.com/health"
    method = "GET"
    interval = "1m"
    timeout = "30s"
  })
  }
}

resource "oneuptime_monitor" "database" {
  name       = "データベース接続"
  project_id = oneuptime_project.production.id
  
  monitor_type = "port"
  hostname     = "db.mycompany.com"
  port         = 5432
  interval     = "2m"
  
  tags = {
    service     = "database"
    environment = "production"
    criticality = "critical"
  }
}

# オンコールポリシー
resource "oneuptime_on_call_policy" "platform_oncall" {
  name       = "プラットフォームオンコール"
  project_id = oneuptime_project.production.id
  team_id    = oneuptime_team.platform.id
  
  schedules {
    name      = "営業時間"
    timezone  = "America/New_York"
    
    layers {
      name = "プライマリ"
      users = ["user1@mycompany.com", "user2@mycompany.com"]
      rotation_type = "weekly"
      start_time = "09:00"
      end_time = "17:00"
      days = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    }
  }
}

# アラートポリシー
resource "oneuptime_alert_policy" "critical_alerts" {
  name       = "重要システムアラート"
  project_id = oneuptime_project.production.id
  
  conditions {
    monitor_id = oneuptime_monitor.api.id
    threshold  = "down"
  }
  
  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }
  
  actions {
    type = "webhook"
    url  = "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
  }
  
  actions {
    type           = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.platform_oncall.id
  }
}

# ステータスページ
resource "oneuptime_status_page" "public" {
  name       = "MyCompanyステータス"
  project_id = oneuptime_project.production.id
  
  domain = "status.mycompany.com"
  
  components {
    name       = "API"
    monitor_id = oneuptime_monitor.api.id
  }
  
  components {
    name       = "データベース"
    monitor_id = oneuptime_monitor.database.id
  }
}
```

### セルフホスト設定例

```hcl
# セルフホストOneUptimeインスタンスバージョン7.0.123の場合
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # OneUptimeバージョンと完全一致させる必要あり
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # セルフホストURL
  api_key       = var.oneuptime_api_key
}

# その他の設定...
```

## ベストプラクティス

### 1. バージョン管理

**クラウドのお客様：**
- セマンティックバージョニングを `~>` で使用して互換性のある更新を取得する
- メジャーバージョンアップグレード前にchangelogを確認する

**セルフホストのお客様：**
- インストールに合わせて常に正確なバージョンに固定する
- OneUptimeのアップグレード時にプロバイダーバージョンを更新する
- まず非本番環境でテストする

### 2. ステート管理

```hcl
terraform {
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. 環境の分離

異なる環境にはワークスペースまたは個別のステートファイルを使用します：

```bash
# ワークスペースを使用
terraform workspace new production
terraform workspace new staging

# 個別のディレクトリを使用
mkdir -p environments/{staging,production}
```

### 4. 変数管理

```hcl
# variables.tf
variable "environment" {
  description = "環境名"
  type        = string
}

variable "monitors" {
  description = "作成するモニターのリスト"
  type = list(object({
    name = string
    url  = string
    type = string
  }))
}

# terraform.tfvars
environment = "production"
monitors = [
  {
    name = "ウェブサイト"
    url  = "https://example.com"
    type = "website"
  },
  {
    name = "API"
    url  = "https://api.example.com/health"
    type = "api"
  }
]
```

### 5. リソースの命名

一貫した命名規則を使用します：

```hcl
resource "oneuptime_monitor" "website_production" {
  name = "${var.environment}-website-monitor"
  # ...
}

resource "oneuptime_alert_policy" "critical_production" {
  name = "${var.environment}-critical-alerts"
  # ...
}
```

## 移行ガイド

### 手動設定からの移行

1. OneUptime ダッシュボードの**既存リソースを監査**する
2. 既存リソースの**Terraform設定を作成**する
3. Terraformステートに**既存リソースをインポート**する
4. 設定が現在の状態と**一致することを確認**する
5. 段階的に**変更を適用**する

インポート例：

```bash
# 既存のモニターをインポート
terraform import oneuptime_monitor.website monitor-id-here

# 既存のプロジェクトをインポート
terraform import oneuptime_project.main project-id-here
```

### バージョンアップグレード

OneUptimeをアップグレードする場合（セルフホスト）：

1. **現在のステートをバックアップ**する
2. **プロバイダーの互換性を確認**する
3. 設定で**プロバイダーバージョンを更新**する
4. **ステージング環境でテスト**する
5. **本番環境に適用**する

```bash
# ステートをバックアップ
terraform state pull > backup.tfstate

# プロバイダーバージョンを更新
# 設定のterraformブロックを編集

# 計画して適用
terraform init -upgrade
terraform plan
terraform apply
```

## サポートとリソース

- **ドキュメント**：[OneUptimeドキュメント](https://docs.oneuptime.com)
- **Terraform Registry**：[OneUptimeプロバイダー](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHubのissue**：[OneUptime GitHub](https://github.com/OneUptime/oneuptime/issues)
- **コミュニティ**：[OneUptimeコミュニティ](https://community.oneuptime.com)

## トラブルシューティング

### 一般的な問題

1. **バージョンの不一致（セルフホスト）**
   ```
   Error: API version incompatible
   ```
   **解決策**：プロバイダーバージョンがOneUptimeのインストールと一致していることを確認する

2. **認証の問題**
   ```
   Error: Invalid API key
   ```
   **解決策**：APIキーと権限を確認する

3. **リソースが見つからない**
   ```
   Error: Resource not found
   ```
   **解決策**：リソースIDを確認してリソースが存在することを確認する

### デバッグモード

詳細なログを有効にします：

```bash
export TF_LOG=DEBUG
terraform apply
```

### バージョン確認

セットアップを確認します：

```bash
# Terraformのバージョンを確認
terraform version

# プロバイダーのバージョンを確認
terraform providers

# 設定を検証
terraform validate
```
