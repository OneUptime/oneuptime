# OneUptime CLI

OneUptime CLI 是一個命令列介面，可讓您直接從終端機管理您的 OneUptime 資源。它支援對監控器、事件、警報、狀態頁面等進行完整的 CRUD 操作。

## 功能特色

- **多環境支援**，透過具名情境（context）管理正式環境、預備環境與開發環境
- 從您的 OneUptime 執行個體**自動探索**可用資源
- **彈性驗證**，可透過 CLI 旗標、環境變數或已儲存的情境進行驗證
- **智慧輸出格式**，支援 JSON、表格與寬版顯示模式
- **可指令碼化**，適用於 CI/CD 管線與自動化工作流程

## 安裝

```bash
npm install -g @oneuptime/cli
```

## 快速開始

```bash
# Authenticate with your OneUptime instance
oneuptime login <your-api-key> https://oneuptime.com

# List your monitors
oneuptime monitor list

# View a specific incident
oneuptime incident get <incident-id>

# See all available resources
oneuptime resources
```

## 文件

| 指南 | 說明 |
|-------|-------------|
| [驗證](./authentication.md) | 登入、情境與認證資訊管理 |
| [資源操作](./resource-operations.md) | 對監控器、事件、警報等進行 CRUD 操作 |
| [輸出格式](./output-formats.md) | JSON、表格與寬版輸出模式 |
| [指令碼與 CI/CD](./scripting.md) | 自動化、環境變數與管線使用方式 |
| [指令參考](./command-reference.md) | 所有指令與選項的完整參考 |

## 全域選項

這些旗標可搭配任何指令使用：

| 旗標 | 說明 |
|------|-------------|
| `--api-key <key>` | 為此指令覆寫 API 金鑰 |
| `--url <url>` | 為此指令覆寫執行個體 URL |
| `--context <name>` | 使用特定的具名情境 |
| `-o, --output <format>` | 輸出格式：`json`、`table`、`wide` |
| `--no-color` | 停用彩色輸出 |
| `--help` | 顯示指令說明 |
| `--version` | 顯示 CLI 版本 |

## 取得協助

```bash
# General help
oneuptime --help

# Help for a specific command
oneuptime monitor --help
oneuptime monitor list --help
```
