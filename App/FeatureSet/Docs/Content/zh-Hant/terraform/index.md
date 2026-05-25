# Terraform 提供商文檔

OneUptime Terraform 提供商支持以基礎設施即代碼（IaC）的方式管理您的 OneUptime 監控、警報和可觀測性資源。

## 文檔目錄

### [快速開始](./quick-start.md)
快速設置指南，幫助您在幾分鐘內開始使用 OneUptime Terraform 提供商。

### [完整提供商指南](./README.md)
涵蓋安裝、配置、資源和最佳實踐的綜合文檔。

### [自託管配置](./self-hosted.md)
**自託管客戶的關鍵信息**：版本固定、兼容性和部署策略。

### [示例](./examples.md)
常見 OneUptime Terraform 配置的實際示例和模式。

## 快速鏈接

### 適用於 OneUptime 雲端客戶
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

### 適用於自託管客戶
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 必須與您的 OneUptime 版本匹配
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## 自託管用戶的重要提示

**版本兼容性至關重要**：始終將 Terraform 提供商版本固定到與您的 OneUptime 安裝版本完全匹配的版本。版本不匹配可能導致 API 兼容性問題。

## 外部資源

- **Terraform Registry**：[OneUptime 提供商](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub 倉庫**：[OneUptime 源代碼](https://github.com/OneUptime/oneuptime)
- **社區支持**：[OneUptime 社區](https://community.oneuptime.com)

## 可用資源

提供商支持全面的 OneUptime 資源管理：

- **項目和團隊**：組織您的監控結構
- **監控器**：網站、API、端口、心跳和自定義監控器
- **事件管理**：警報策略、值班排班、升級鏈
- **狀態頁面**：具有自定義品牌的公共和私有狀態頁面
- **服務目錄**：服務定義和依賴關係映射
- **工作流**：自動化響應和修復工作流

## 支持

如有問題、疑問或貢獻：

1. **文檔問題**：在 [OneUptime 倉庫](https://github.com/OneUptime/oneuptime/issues) 中創建 Issue
2. **提供商錯誤**：在主 OneUptime 倉庫中報告
3. **功能請求**：在 OneUptime 社區中討論
4. **一般問題**：使用社區論壇

## 下一步

1. **新用戶**：從[快速開始指南](./quick-start.md)開始
2. **自託管用戶**：查看[自託管配置](./self-hosted.md)
3. **高級用戶**：探索[示例](./examples.md)瞭解複雜設置
4. **完整參考**：查看[完整指南](./README.md)瞭解所有功能
