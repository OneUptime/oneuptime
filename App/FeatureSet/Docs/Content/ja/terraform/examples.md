# Terraformプロバイダーの使用例

このドキュメントでは、一般的なOneUptime Terraform設定の包括的な例を提供します。

## 基本的な例

### シンプルなプロジェクト

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # セルフホストの場合は "= 7.0.123" を使用
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # セルフホストの場合は変更してください
  api_key       = var.oneuptime_api_key
}

```

### 基本的なモニター

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "ホームページモニター"
  description = "メインウェブサイトのホームページモニター"
  monitor_type = "Manual"
}
```

### ステータスページ

```hcl
# 公開ステータスページ
resource "oneuptime_status_page" "public" {
  name        = "公開ステータスページ"
  description = "顧客向けサービスの公開ステータスページ"
}
```
