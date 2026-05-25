# 使用 Docker Compose 完全免费部署 OneUptime

如果您希望在自己的服务器上托管 OneUptime，可以使用 Docker Compose 在 Debian、Ubuntu 或 RHEL 上部署单服务器实例。此选项让您对实例拥有更多控制权和自定义能力，但也需要更多技术技能和资源来进行部署和维护。

#### 选择您的系统要求
根据您的使用量和预算，您可以为服务器选择不同的系统要求。为获得最佳性能，我们建议 OneUptime 使用以下配置：

- **推荐系统要求**
  - 16GB 内存
  - 8 核 CPU
  - 400 GB 磁盘
  - Ubuntu 22.04
  - 已安装 Docker 和 Docker Compose
- **家庭实验室 / 最低要求**
  - 如果您想在家庭环境中用于个人或实验目的运行 OneUptime（我们的一些用户甚至将其安装在 RaspberryPi 上），可以使用家庭实验室要求：
    - 8 GB 内存
    - 4 核 CPU
    - 20 GB 磁盘
    - 已安装 Docker 和 Docker Compose


#### 单服务器部署的前提条件

安装教程：[https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

在开始部署流程之前，请确保您已准备好：

- 运行 Debian、Ubuntu 或 RHEL 衍生版本的服务器
- 在服务器上安装了 Docker 和 Docker Compose

安装 OneUptime：

```
# 仅克隆 release 分支并进入目录
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 将 config.example.env 复制为 config.env
cp config.example.env config.env

# 重要：编辑 config.env 文件。请确保您使用了随机密钥。

npm start
```

如果您不想使用 npm 或未安装 npm，请运行以下命令代替：

```
# 从 config.env 文件读取环境变量并运行 docker compose up
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# 如果绑定端口时遇到权限问题，请使用 sudo
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```


### 访问 OneUptime

OneUptime 应运行在：http://localhost。您需要注册一个新账号才能开始使用您的实例。

### 设置 TLS/SSL 证书

OneUptime **不支持**自行设置 SSL/TLS 证书。您需要自行设置 SSL/TLS 证书。

如果您需要使用 SSL/TLS 证书，请按照以下步骤操作：

1. 使用反向代理，如 Nginx 或 Caddy。
2. 使用 Let's Encrypt 颁发证书。
3. 将反向代理指向 OneUptime 服务器。
4. 更新以下设置：
   - 将 `HTTP_PROTOCOL` 环境变量设置为 `https`。
   - 将 `HOST` 环境变量更改为托管反向代理的服务器域名。

## 生产就绪检查清单

理想情况下，不要在生产环境中使用 docker-compose 部署 OneUptime。我们强烈建议使用 Kubernetes。OneUptime 有可用的 Helm 图表，请查看[此处](https://artifacthub.io/packages/helm/oneuptime/oneuptime)。

如果您仍然希望在生产环境中使用 docker-compose 部署 OneUptime，请考虑以下事项：

- **SSL/TLS**：设置 SSL/TLS 证书。OneUptime 不支持自行设置 SSL/TLS 证书。您需要自行设置。请参阅上方说明。
- **密钥**：确保您的 `config.env` 文件中包含随机密钥。该文件中有一些默认密钥，请将它们替换为随机长字符串。
- **备份**：定期备份您的数据库（Clickhouse、Postgres）。Redis 用作缓存，是无状态的，可以安全地忽略。
- **更新**：请定期更新 OneUptime。我们每天发布更新。如果在生产环境中运行，建议每周至少更新一次软件。

### 更新 OneUptime

更新方法：

```
git checkout release # 请确保您在 release 分支上
git pull
npm run update
```

### 注意事项

- 在我们的 Docker 设置中，我们使用本地日志驱动程序。OneUptime，尤其是探针和数据摄取容器，会生成大量日志。为防止存储空间占满，限制 Docker 中的日志存储至关重要。有关详细说明，请参阅 Docker 官方文档[此处](https://docs.docker.com/config/containers/logging/local/)。


### 卸载 OneUptime

要卸载 OneUptime，请运行以下命令：

```
npm run down
```

这将停止并删除 OneUptime 创建的所有容器、网络和卷。它不会删除 `config.env` 文件或克隆的代码仓库。
