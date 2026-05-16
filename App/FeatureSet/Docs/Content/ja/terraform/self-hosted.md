# セルフホストOneUptime Terraform設定ガイド

このガイドは、セルフホストのOneUptimeインスタンスを運用しているお客様向けです。Terraformプロバイダーを自社のOneUptimeデプロイメントで使用するためのバージョン管理、設定、ベストプラクティスについて説明します。

## 重要なお知らせ

⚠️ **TerraformでProjectsは作成できません** — プロジェクトはまずOneUptime ダッシュボードで手動作成する必要があります。Terraform設定ではプロジェクトIDを使用してください。

⚠️ **セルフホストのお客様への最重要ルール**：TerraformプロバイダーのバージョンはOneUptimeのインストールバージョンに完全一致するよう常に固定してください。

## リソース構造

すべてのOneUptime Terraformリソースはシンプルな構造に従います：
- `name`（必須）— リソース名
- `description`（オプション）— リソースの説明
- `data`（オプション）— JSONとして表現された複雑な設定

## 重要：バージョン互換性

⚠️ **セルフホストのお客様への最重要ルール**：TerraformプロバイダーのバージョンはOneUptimeのインストールバージョンに完全一致するよう常に固定してください。

### バージョン固定が重要な理由

- TerraformプロバイダーはOneUptime APIから自動生成されます
- 各OneUptimeバージョンは異なるAPIエンドポイントとスキーマを持つ可能性があります
- バージョンが一致しないプロバイダーはエラーや予期しない動作を引き起こす可能性があります
- バージョン固定は互換性と予測可能な動作を保証します

## OneUptimeのバージョン確認方法

### 方法1：ダッシュボード
1. OneUptime ダッシュボードにログイン
2. **設定** → **About** に移動
3. バージョン番号を確認（例：「7.0.123」）

### 方法2：APIエンドポイント
```bash
curl https://your-oneuptime-instance.com/api/status
```

### 方法3：Dockerイメージ
DockerでOneUptimeを実行している場合：
```bash
docker images | grep oneuptime
# タグを確認、例：oneuptime/dashboard:7.0.123
```

### 方法4：Helmチャート
Helmを使用している場合：
```bash
helm list -n oneuptime
# チャートのバージョンを確認
```

### 方法5：環境変数
設定ファイルでバージョン変数を確認：
```bash
grep -r "APP_VERSION\|IMAGE_TAG" /path/to/your/oneuptime/config
```

## プロバイダー設定テンプレート

### バージョン7.0.x用テンプレート

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 正確なビルド番号に置き換えてください
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # セルフホストURL
  api_key       = var.oneuptime_api_key
}
```

### バージョン7.1.x用テンプレート

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # 正確なバージョンに置き換えてください
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## セルフホストの完全な設定例

以下はセルフホストのOneUptimeインスタンスの完全な例です：

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # OneUptimeのバージョンと一致させる必要あり
    }
  }
  required_version = ">= 1.0"
  
  # オプション：チームコラボレーション用のリモートステートを使用
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}

# variables.tf
variable "oneuptime_url" {
  description = "OneUptimeインスタンスURL"
  type        = string
  default     = "https://oneuptime.yourcompany.com"
}

variable "oneuptime_api_key" {
  description = "OneUptime APIキー"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "環境名"
  type        = string
  default     = "production"
}

# providers.tf
provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# variables.tf
variable "project_id" {
  description = "OneUptimeプロジェクトID（ダッシュボードで手動作成）"
  type        = string
}

# main.tf
# チームを作成
resource "oneuptime_team" "infrastructure" {
  name        = "インフラストラクチャチーム"
  description = "インフラストラクチャ・運用チーム"
}

resource "oneuptime_team" "development" {
  name        = "開発チーム"
  description = "アプリケーション開発チーム"  
  project_id = oneuptime_project.main.id
}

# インフラストラクチャモニター
resource "oneuptime_monitor" "database" {
  name       = "${var.environment}-database"
  project_id = oneuptime_project.main.id
  
  monitor_type = "port"
  hostname     = "db.internal.yourcompany.com"
  port         = 5432
  interval     = "2m"
  timeout      = "10s"
  
  tags = {
    team        = "infrastructure"
    service     = "database"
    environment = var.environment
    criticality = "critical"
  }
}

resource "oneuptime_monitor" "application" {
  name       = "${var.environment}-application"
  project_id = oneuptime_project.main.id
  
  monitor_type = "website"
  url          = "https://app.yourcompany.com/health"
  interval     = "1m"
  timeout      = "30s"
  
  expected_status_codes = [200]
  
  tags = {
    team        = "development"
    service     = "application"
    environment = var.environment
    criticality = "high"
  }
}

# オンコールポリシー
resource "oneuptime_on_call_policy" "infrastructure_oncall" {
  name       = "インフラストラクチャオンコール"
  project_id = oneuptime_project.main.id
  team_id    = oneuptime_team.infrastructure.id
  
  schedules {
    name     = "24x7インフラストラクチャ"
    timezone = "America/New_York"
    
    layers {
      name          = "プライマリ"
      users         = ["infra1@yourcompany.com", "infra2@yourcompany.com"]
      rotation_type = "weekly"
      start_time    = "00:00"
      end_time      = "23:59"
      days          = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    }
  }
}

# アラートポリシー
resource "oneuptime_alert_policy" "critical_infrastructure" {
  name       = "重要インフラストラクチャアラート"
  project_id = oneuptime_project.main.id
  
  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }
  
  actions {
    type = "email"
    recipients = ["infrastructure@yourcompany.com"]
  }
  
  actions {
    type             = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.infrastructure_oncall.id
  }
}

# 内部ステータスページ
resource "oneuptime_status_page" "internal" {
  name       = "内部サービスステータス"
  project_id = oneuptime_project.main.id
  
  domain = "status.internal.yourcompany.com"
  
  components {
    name       = "データベース"
    monitor_id = oneuptime_monitor.database.id
  }
  
  components {
    name       = "アプリケーション"
    monitor_id = oneuptime_monitor.application.id
  }
}

# outputs.tf
output "project_id" {
  description = "プロジェクトID"
  value       = oneuptime_project.main.id
}

output "status_page_url" {
  description = "ステータスページURL"
  value       = "https://${oneuptime_status_page.internal.domain}"
}
```

## 環境ごとの設定

### 開発環境

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.yourcompany.com"
environment = "development"
```

### ステージング環境

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.yourcompany.com"  
environment = "staging"
```

### 本番環境

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.yourcompany.com"
environment = "production"
```

## セルフホストのアップグレード手順

OneUptimeインスタンスをアップグレードする場合：

### 1. アップグレード前チェックリスト

```bash
# 現在のTerraformステートをバックアップ
terraform state pull > backup-$(date +%Y%m%d).tfstate

# 現在のOneUptimeバージョンをメモ
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# 現在のプロバイダーバージョンをメモ
terraform providers | grep oneuptime
```

### 2. OneUptimeインスタンスのアップグレード

標準のOneUptimeアップグレードプロセスに従ってください（Docker、Helmなど）。

### 3. Terraformプロバイダーの更新

```hcl
# terraformブロックのバージョンを更新
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # アップグレード後の新バージョン
    }
  }
}
```

### 4. テストと適用

```bash
# プロバイダーを更新
terraform init -upgrade

# 変更を計画
terraform plan

# 問題なければ適用
terraform apply
```

## ネットワーク設定

### ファイアウォールルール

Terraformランナーが以下にアクセスできることを確認：
- OneUptime APIエンドポイント（通常はポート443/HTTPS）
- 監視対象の内部リソース

### VPN/プライベートネットワーク

OneUptimeがプライベートネットワーク上にある場合：

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # 内部IP
  api_key       = var.oneuptime_api_key
}
```

## セキュリティのベストプラクティス

### 1. APIキー管理

```bash
# 環境変数を使用
export ONEUPTIME_API_KEY="your-api-key"

# またはシークレット管理システムを使用
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. 最小権限のAPIキー

必要最小限の権限を持つAPIキーを作成：
- モニター管理
- アラートポリシー管理
- チーム管理（必要な場合）

### 3. ネットワークセキュリティ

```hcl
# TLS検証付きの例
provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
  
  # サポートされている場合の追加セキュリティオプション
  verify_ssl = true
  timeout    = "30s"
}
```

## Terraform自動化の監視

Terraform自動化のモニターを作成：

```hcl
resource "oneuptime_monitor" "terraform_runner" {
  name       = "Terraformランナーの正常性"
  project_id = oneuptime_project.main.id
  
  monitor_type = "heartbeat"
  interval     = "15m"
  
  tags = {
    automation = "terraform"
    criticality = "medium"
  }
}
```

## セルフホストのトラブルシューティング

### 問題：接続が拒否される

```
Error: connection refused
```

**解決策**：
1. OneUptimeインスタンスが実行中か確認する
2. APIURL が正しいか確認する
3. ファイアウォール/ネットワーク接続を確認する
4. TLS証明書が有効か確認する

### 問題：APIバージョンの不一致

```
Error: API version incompatible
```

**解決策**：
1. OneUptimeのバージョンを確認：`curl https://your-instance/api/status`
2. プロバイダーバージョンを一致するよう更新する
3. `terraform init -upgrade` を実行する

### 問題：自己署名証明書

自己署名証明書を使用している場合：

```bash
# TLS検証を一時的にスキップ（本番環境では非推奨）
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

より良い解決策：システムの信頼ストアにCA証明書を追加する。

## バックアップとディザスタリカバリ

### ステートのバックアップ

```bash
# 定期的なステートバックアップ
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate

# 自動バックアップスクリプト
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

### 設定のバックアップ

```bash
# Terraform設定をバックアップ
tar -czf terraform-config-$(date +%Y%m%d).tar.gz *.tf *.tfvars
```

## マルチ環境管理

### ワークスペースの使用

```bash
# 環境を作成
terraform workspace new dev
terraform workspace new staging  
terraform workspace new prod

# 環境を切り替え
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### 個別ディレクトリの使用

```
terraform/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   ├── staging/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   └── prod/
│       ├── main.tf
│       └── terraform.tfvars
└── modules/
    └── oneuptime/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

このアプローチはより良い分離と、環境ごとのバージョン管理を容易にします。
