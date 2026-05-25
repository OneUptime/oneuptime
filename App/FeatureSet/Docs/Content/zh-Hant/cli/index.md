# OneUptime CLI

OneUptime CLI 是一個命令行界面，用於直接從終端管理您的 OneUptime 資源。它支持對監控器、事件、警報、狀態頁面等進行完整的 CRUD 操作。

## 功能特性

- **多環境支持**：爲生產、預發佈和開發環境提供命名上下文
- **自動發現**：自動發現您 OneUptime 實例中的可用資源
- **靈活認證**：支持通過 CLI 標誌、環境變量或已保存上下文進行認證
- **智能輸出格式**：支持 JSON、表格和寬表顯示模式
- **可腳本化**：適用於 CI/CD 流水線和自動化工作流

## 安裝

```bash
npm install -g @oneuptime/cli
```

## 快速開始

```bash
# 向您的 OneUptime 實例進行認證
oneuptime login <your-api-key> https://oneuptime.com

# 列出您的監控器
oneuptime monitor list

# 查看特定事件
oneuptime incident get <incident-id>

# 查看所有可用資源
oneuptime resources
```

## 文檔

| 指南 | 描述 |
|------|------|
| [認證](./authentication.md) | 登錄、上下文和憑據管理 |
| [資源操作](./resource-operations.md) | 對監控器、事件、警報等進行 CRUD 操作 |
| [輸出格式](./output-formats.md) | JSON、表格和寬表輸出模式 |
| [腳本與 CI/CD](./scripting.md) | 自動化、環境變量和流水線用法 |
| [命令參考](./command-reference.md) | 所有命令和選項的完整參考 |

## 全局選項

這些標誌可與任何命令一起使用：

| 標誌 | 描述 |
|------|------|
| `--api-key <key>` | 覆蓋此命令的 API 密鑰 |
| `--url <url>` | 覆蓋此命令的實例 URL |
| `--context <name>` | 使用特定的命名上下文 |
| `-o, --output <format>` | 輸出格式：`json`、`table`、`wide` |
| `--no-color` | 禁用彩色輸出 |
| `--help` | 顯示命令幫助 |
| `--version` | 顯示 CLI 版本 |

## 獲取幫助

```bash
# 通用幫助
oneuptime --help

# 特定命令的幫助
oneuptime monitor --help
oneuptime monitor list --help
```
