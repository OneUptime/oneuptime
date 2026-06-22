# 服务器/虚拟机监控器

服务器和虚拟机监控允许您通过安装一个轻量级 Agent 来监控服务器、虚拟机和其他基础设施的健康状况和性能，该 Agent 将系统指标上报给 OneUptime。

## 概述

服务器监控器使用安装在服务器上的基础设施 Agent 来收集和上报系统指标。这使您能够：

- 监控服务器正常运行时间和可用性
- 跟踪 CPU、内存和磁盘使用情况
- 监控运行中的进程
- 基于资源利用率阈值设置告警
- 在基础设施问题影响服务之前检测到它们

## 创建服务器监控器

1. 在 OneUptime 控制台中转到 **监控器**
2. 点击 **创建监控器**
3. 选择 **服务器/虚拟机** 作为监控器类型
4. 将为此监控器生成一个 **密钥** — 您需要它来配置 Agent
5. 按照安装说明在服务器上设置 Agent

## 安装基础设施 Agent

OneUptime 基础设施 Agent 是一个轻量级的 Go 语言守护进程，它每 30 秒收集系统指标并发送给 OneUptime。支持 Linux、macOS 和 Windows。

### Linux / macOS

```bash
# 安装 Agent
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# 配置 Agent
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# 启动 Agent
sudo oneuptime-infrastructure-agent start
```

将 `YOUR_SECRET_KEY` 替换为监控器设置中显示的密钥，如果是自托管，请将 `https://oneuptime.com` 替换为您的 OneUptime 实例 URL。

### Windows

1. 从 [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest) 下载最新版 Agent
   - `oneuptime-infrastructure-agent_windows_amd64.zip`（x64 系统）
   - `oneuptime-infrastructure-agent_windows_arm64.zip`（ARM64 系统）
2. 解压 zip 文件
3. 以管理员身份打开命令提示符并运行：

```bash
# 配置 Agent
oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# 启动 Agent
oneuptime-infrastructure-agent start
```

### 代理支持

如果您的服务器通过代理连接到互联网，可以配置 Agent 使用代理：

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## Agent 命令

基础设施 Agent 支持以下命令：

| 命令        | 描述                                                  |
| ----------- | ----------------------------------------------------- |
| `configure` | 使用密钥和 OneUptime URL 配置 Agent                   |
| `start`     | 启动 Agent 服务                                       |
| `stop`      | 停止 Agent 服务                                       |
| `restart`   | 重启 Agent 服务                                       |
| `status`    | 显示当前服务状态                                      |
| `logs`      | 查看 Agent 日志（使用 `-n` 指定行数，使用 `-f` 跟踪） |
| `uninstall` | 卸载 Agent 服务                                       |

## 收集的指标

Agent 从服务器收集以下指标：

### CPU

- **CPU 使用率** — 整体 CPU 利用率百分比
- **CPU 核心数** — CPU 核心数量

### 内存

- **总内存** — 总可用内存
- **已用内存** — 当前使用的内存
- **可用内存** — 可用的空闲内存
- **内存使用率** — 内存利用率百分比

### 磁盘

对于每个挂载的磁盘/卷：

- **磁盘总空间** — 磁盘总容量
- **已用磁盘空间** — 当前使用的空间
- **可用磁盘空间** — 可用的空闲空间
- **磁盘使用率** — 磁盘利用率百分比
- **磁盘路径** — 磁盘挂载路径

### 进程

- **进程名称** — 运行中进程的名称
- **进程 ID（PID）** — 进程标识符
- **进程命令** — 启动进程的完整命令

## 监控标准

您可以配置标准来判断服务器何时处于在线、降级或离线状态。

### 可用检查类型

| 检查类型       | 描述                                     |
| -------------- | ---------------------------------------- |
| 是否在线       | 服务器 Agent 是否正在上报（基于心跳）    |
| CPU 使用率     | 当前 CPU 利用率百分比                    |
| 内存使用率     | 当前内存利用率百分比                     |
| 磁盘使用率     | 当前磁盘利用率百分比（针对特定磁盘路径） |
| 服务器进程名称 | 检查特定名称的进程是否正在运行           |
| 服务器进程命令 | 检查使用特定命令的进程是否正在运行       |
| 服务器进程 PID | 检查具有特定 PID 的进程是否正在运行      |

### 过滤类型

对于数值指标（CPU、内存、磁盘）：

- **大于** — 值超过阈值
- **小于** — 值低于阈值
- **大于或等于** — 值等于或超过阈值
- **小于或等于** — 值等于或低于阈值
- **随时间评估** — 使用聚合（平均值、求和、最大值、最小值、所有值、任意值）在时间窗口内评估

对于进程检查：

- **正在执行** — 进程当前正在运行
- **未在执行** — 进程未在运行

### 示例标准

#### 如果 Agent 停止上报则将服务器标记为离线

- **检查项**：是否在线
- **过滤类型**：False

#### 当 CPU 使用率超过 90% 时发出告警

- **检查项**：CPU 使用率
- **过滤类型**：大于
- **值**：90

#### 当磁盘使用率超过 85% 时发出告警

- **检查项**：磁盘使用率
- **磁盘路径**：`/`
- **过滤类型**：大于
- **值**：85

#### 当内存使用率超过 80% 时发出告警

- **检查项**：内存使用率
- **过滤类型**：大于
- **值**：80

#### 如果关键进程停止运行则发出告警

- **检查项**：服务器进程名称
- **过滤类型**：未在执行
- **值**：`nginx`

## 故障排查

### Agent 未上报

- 验证 Agent 是否正在运行：`sudo oneuptime-infrastructure-agent status`
- 检查 Agent 日志：`sudo oneuptime-infrastructure-agent logs -n 50`
- 确认密钥是否正确
- 确保服务器能够访问您的 OneUptime 实例 URL
- 检查防火墙规则是否允许出站 HTTPS 连接

### Agent 资源占用高

Agent 设计为轻量级。如果您注意到资源占用高：

- 重启 Agent：`sudo oneuptime-infrastructure-agent restart`
- 检查 Agent 日志中的错误

### 代理问题

- 验证代理 URL 和端口是否正确
- 确保代理允许连接到您的 OneUptime 实例
- 重新配置：`sudo oneuptime-infrastructure-agent configure --proxy-url=http://proxy:port --secret-key=YOUR_KEY --oneuptime-url=YOUR_URL`

## 最佳实践

1. **设置有意义的阈值** — 配置与服务器正常运行范围匹配的降级和离线标准
2. **监控关键进程** — 使用进程监控确保 Web 服务器和数据库等关键服务始终在运行
3. **主动监控磁盘使用率** — 磁盘空间问题可能导致应用程序故障；在磁盘满之前设置告警
4. **使用"随时间评估"** — 对于 CPU 等可能短暂峰值的指标，使用基于时间的聚合以避免误报
5. **保持 Agent 更新** — 定期更新基础设施 Agent 以获取最新改进和修复
