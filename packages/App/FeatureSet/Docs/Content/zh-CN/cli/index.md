# OneUptime CLI

OneUptime CLI 是一个命令行界面，用于直接从终端管理您的 OneUptime 资源。它支持对监控器、事件、告警、状态页面等进行完整的 CRUD 操作。

## 功能特性

- **多环境支持**：为生产、预发布和开发环境提供命名上下文
- **自动发现**：自动发现您 OneUptime 实例中的可用资源
- **灵活认证**：支持通过 CLI 标志、环境变量或已保存上下文进行认证
- **智能输出格式**：支持 JSON、表格和宽表显示模式
- **可脚本化**：适用于 CI/CD 流水线和自动化工作流

## 安装

```bash
npm install -g @oneuptime/cli
```

## 快速开始

```bash
# 向您的 OneUptime 实例进行认证
oneuptime login <your-api-key> https://oneuptime.com

# 列出您的监控器
oneuptime monitor list

# 查看特定事件
oneuptime incident get <incident-id>

# 查看所有可用资源
oneuptime resources
```

## 文档

| 指南                                 | 描述                                 |
| ------------------------------------ | ------------------------------------ |
| [认证](./authentication.md)          | 登录、上下文和凭据管理               |
| [资源操作](./resource-operations.md) | 对监控器、事件、告警等进行 CRUD 操作 |
| [输出格式](./output-formats.md)      | JSON、表格和宽表输出模式             |
| [脚本与 CI/CD](./scripting.md)       | 自动化、环境变量和流水线用法         |
| [命令参考](./command-reference.md)   | 所有命令和选项的完整参考             |

## 全局选项

这些标志可与任何命令一起使用：

| 标志                    | 描述                              |
| ----------------------- | --------------------------------- |
| `--api-key <key>`       | 覆盖此命令的 API 密钥             |
| `--url <url>`           | 覆盖此命令的实例 URL              |
| `--context <name>`      | 使用特定的命名上下文              |
| `-o, --output <format>` | 输出格式：`json`、`table`、`wide` |
| `--no-color`            | 禁用彩色输出                      |
| `--help`                | 显示命令帮助                      |
| `--version`             | 显示 CLI 版本                     |

## 获取帮助

```bash
# 通用帮助
oneuptime --help

# 特定命令的帮助
oneuptime monitor --help
oneuptime monitor list --help
```
