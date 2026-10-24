# Docker Compose

使用 Docker Compose 在一台 Linux 服务器上运行一个完整、免费的 OneUptime 实例。本页带你从一台全新的服务器走到一个运行中的实例，然后介绍 HTTPS、生产环境加固、备份、更新和卸载。如果要开发 OneUptime 本身的代码，请参阅 [本地开发](/docs/installation/local-development)。

:::cards
- [安装 OneUptime](#安装-oneuptime): 从全新服务器到第一个账号，共五步。
- [设置 HTTPS](#设置-https): 让 OneUptime 获取证书，或在前面放置你自己的代理。
- [生产环境检查清单](#生产环境检查清单): 真实流量到来之前需要确定的事项。
- [更新 OneUptime](#更新-oneuptime): 升级到最新版本。
:::

## 工作原理

Docker Compose 把 OneUptime 的每个部分作为容器运行在你的服务器上。所有流量都从 `ingress` 容器进入，再由它路由到 `app`。应用把数据保存在 PostgreSQL、ClickHouse 和 Valkey 中。内置的探针执行监控器的检查，并通过 ingress 回报结果。

```mermaid title="Docker Compose 部署"
flowchart TB
    Users["用户和代理"]
    Proxy["你的反向代理<br/>（可选）"]
    Targets["你监控的站点"]
    subgraph Server["你的服务器"]
        Ingress["ingress"]
        App["app"]
        Probe["probe-1"]
        Runner["runner"]
        subgraph Data["数据存储"]
            direction LR
            PG[("postgres")]
            CH[("clickhouse")]
            VK[("valkey")]
        end
    end
    Users -->|HTTPS| Proxy
    Proxy -->|HTTP| Ingress
    Users -.->|"不经代理"| Ingress
    Ingress --> App
    App --> PG
    App --> CH
    App --> VK
    Probe -->|结果| Ingress
    Runner -->|任务| Ingress
    Probe -->|检查| Targets
    Data ~~~ Probe
    Data ~~~ Runner
```

| 服务 | 镜像 | 作用 |
| --- | --- | --- |
| `ingress` | `oneuptime/nginx` | 接收端口 80 和 443 上的所有流量，并路由到应用。当 OneUptime 管理证书时提供 HTTPS。 |
| `app` | `oneuptime/app` | 仪表板、API、状态页面、遥测数据接收和后台任务进程。 |
| `probe-1` | `oneuptime/probe` | 执行监控器检查的全局探针。它使用主机网络。 |
| `runner` | `oneuptime/runner` | 实例的 Runner，负责执行 AI 代码修复。它使用主机网络。 |
| `postgres` | `postgres:15` | 配置和状态：监控器、事件、用户。保存在 `postgres` 卷中。 |
| `clickhouse` | `clickhouse/clickhouse-server:26.7` | 遥测数据：日志、指标、追踪和异常。保存在 `clickhouse` 卷中。 |
| `valkey` | `valkey/valkey:9.1-alpine` | 缓存和队列。它不在磁盘上保存任何数据。 |

> [!NOTE]
> `valkey` 服务运行 [Valkey](https://valkey.io)，即 Redis 7.2 的 BSD 许可分支，通过 `config.env` 中的 `VALKEY_*` 设置进行配置。任何支持 Redis 协议的服务器都可以使用——如果你愿意，可以把 `VALKEY_HOST` 指向托管的 Redis。这些设置在 13.0.0 之前名为 `REDIS_*`；旧名称仍然会被读取，容器仍然响应主机名 `redis`，而且 `npm run update` 不会改写它们，因此较旧的 `config.env` 无需修改。

对于大规模生产环境，或需要高可用性时，请改用 Kubernetes 上的 [Helm chart](https://artifacthub.io/packages/helm/oneuptime/oneuptime)：Docker Compose 在一台服务器上为每个服务只运行一个副本。

## 要求

根据要在服务器上运行的内容选择服务器规格。决定内存和磁盘用量的是遥测数据（日志、指标、追踪）；了解数据量后，请参阅 [规模与容量规划](/docs/installation/sizing)。

| | 推荐 | 家庭实验室最低配置 |
| --- | --- | --- |
| **内存** | 16 GB | 8 GB |
| **CPU** | 8 核 | 4 核 |
| **磁盘** | 400 GB | 20 GB |
| **系统** | Ubuntu 22.04，或其他基于 Debian、Ubuntu 或 RHEL 的 Linux | 相同 |
| **架构** | x86-64（`amd64`）或 ARM（`arm64`） | 相同 |

家庭实验室最低配置适合个人和实验用途——有些用户在 Raspberry Pi 上运行 OneUptime。

你还需要：

- **Docker** 以及 **Docker Compose v2** 插件（即 `docker compose` 命令）。
- **Git**，用于获取 OneUptime。
- **Node.js 和 npm**，用于运行封装 Docker Compose 的 `npm start` 和 `npm run update` 脚本。
- 服务器上**空闲的端口 80 和 443**。下表列出了 OneUptime 在主机上使用的每个端口。

| 主机端口 | 使用者 | 设置 | 用途 |
| --- | --- | --- | --- |
| 80 | `ingress` | `ONEUPTIME_HTTP_PORT` | 仪表板、API、遥测数据接收和 Let's Encrypt 验证。 |
| 443 | `ingress` | `STATUS_PAGE_HTTPS_PORT` | 当 OneUptime 管理证书时为实例提供 HTTPS，并为自定义域名上的状态页面和仪表板提供 HTTPS。 |
| 5400 | `postgres` | 在 `docker-compose.yml` 中设置 | 让 `npm run backup` 和 `restore.sh` 从服务器本机访问 PostgreSQL。它只发布在 `127.0.0.1` 上。 |
| 3874 | `probe-1` | `GLOBAL_PROBE_1_PORT` | 探针自身的服务器。服务器之外不需要访问它。 |
| 3876 | `runner` | `ONEUPTIME_RUNNER_PORT` | Runner 自身的服务器。服务器之外不需要访问它。 |

另有一个安装过程的 [视频演示](https://youtu.be/j1SWmMW2oL4)。

## 安装 OneUptime

在全新的 Ubuntu、Debian 或基于 RHEL 的服务器上，一条命令就能替你完成下面的步骤：它会安装缺少的 Docker、Git 和 Node.js，把 release 分支克隆到 `oneuptime` 文件夹，询问大家将使用的地址，然后运行 `npm start`：

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

:::steps
### 克隆 release 分支

`release` 分支包含最新版本的文件。

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
```

### 创建 config.env

OneUptime 的所有设置都在 `config.env` 中。从示例文件开始：

```bash
cp config.example.env config.env
```

### 设置主机名

打开 `config.env`，把 `HOST` 设为人们访问 OneUptime 时使用的域名或 IP 地址，不要带 `http://`。只有在自己的电脑上试用 OneUptime 时才保留 `localhost`。

```ini title="config.env"
HOST=oneuptime.example.com
```

### 启动 OneUptime

:::tabs
@tab npm
```bash
npm start
```
@tab Docker CLI
```bash
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)
```
首次启动前，请按 [生成随机密钥](#生成随机密钥) 中的说明自己替换占位密钥：只有 `npm start` 会替你完成这一步。
:::

`npm start` 会先检查服务器：Docker、内存、磁盘空间、OneUptime 使用的端口以及 `HOST`。遇到任何会让 OneUptime 无法工作的问题，它都会停下来并说明要改什么。然后它为 `config.env` 中的每个占位密钥生成各自的随机值，启动 OneUptime，并等待每个部分都有响应。首次启动需要几分钟，因为 Docker 要下载镜像，OneUptime 要创建数据库。最后它输出 **OneUptime is up!** 和要打开的地址。

### 创建第一个账号

打开 `http://` 加上你的 `HOST`（例如 `http://localhost`）并注册。新实例上的第一个账号会成为它的主管理员，可以在 `/admin` 打开 Admin Dashboard。

在你之后，任何能访问该页面的人都可以注册。要阻止这一点，请打开 Admin Dashboard，前往 **设置 > 认证**，然后关闭 **允许注册**。你邀请加入项目的人仍然可以创建账号。
:::

### 生成随机密钥

`config.example.env` 中的每个密钥都是占位值，而这些占位值在 GitHub 上是公开的。`npm start` 会在启动任何内容之前为每一个生成各自的随机值，并列出它填写的设置：

| 设置 | 保护的内容 |
| --- | --- |
| `ONEUPTIME_SECRET` | OneUptime 自身服务之间的调用。 |
| `ENCRYPTION_SECRET` | OneUptime 存储的密钥（如集成令牌和 SMTP 密码），以及它签发的登录令牌。 |
| `DATABASE_PASSWORD`、`CLICKHOUSE_PASSWORD`、`VALKEY_PASSWORD` | 三个数据存储。 |
| `REGISTER_PROBE_KEY` | 向你的实例注册探针。 |
| `GLOBAL_PROBE_1_KEY`、`GLOBAL_PROBE_2_KEY` | Docker Compose 可以运行的全局探针（默认运行 `probe-1`）。 |
| `ONEUPTIME_RUNNER_KEY` | 内置的 Runner。 |
| `GLOBAL_RUNNER_KEY` | 内置的全局 Runner，运行所有项目的 JavaScript 步骤。 |

> [!IMPORTANT]
> OneUptime 启动后，请保持这些密钥不变。PostgreSQL 只在创建数据库时采用密码，而之后更改 `ENCRYPTION_SECRET` 会让所有用旧密钥加密的值都无法读取。因此 `npm start` 只在全新安装、PostgreSQL 创建数据库之前设置 `DATABASE_PASSWORD` 和 `ENCRYPTION_SECRET`。

如果使用 Docker CLI，请在首次启动前自己替换占位值：

```bash
while grep -q "please-change-this-to-random-value" config.env; do
  sed -i "0,/please-change-this-to-random-value/{s/please-change-this-to-random-value/$(openssl rand -hex 32)/}" config.env
done
grep -c "please-change-this" config.env
```

最后一条命令输出 `0`：说明没有剩下任何占位值。这个循环使用 GNU `sed`，每台 Linux 服务器都有。

## 设置 HTTPS

在你选择以下两种添加 HTTPS 的方式之一前，OneUptime 只提供普通 HTTP：

| | 让 OneUptime 获取证书 | 使用你自己的反向代理 |
| --- | --- | --- |
| **TLS 终止于** | OneUptime 的 `ingress`，使用它自动续期的免费 Let's Encrypt 证书 | 你的代理：Caddy、Nginx 或负载均衡器 |
| **你需要** | 一个指向该服务器的公共域名，以及可从互联网访问的端口 80 和 443 | 一个代理，以及你的域名的证书 |
| **设置** | `PROVISION_SSL=true`、`HTTP_PROTOCOL=https` | `PROVISION_SSL=false`、`HTTP_PROTOCOL=https`、`TRUSTED_PROXY_HOPS=2` |
| **自定义域名上的状态页面** | 无需额外设置即可工作 | 你的代理也必须为这些域名提供服务 |

如果你把状态页面或仪表板放在自定义域名上，让 OneUptime 处理 TLS 是更简单的方案：ingress 会自己申请并提供这些域名的证书。

设置 `HTTP_PROTOCOL=https` 后，OneUptime 会生成 HTTPS 链接，把登录 Cookie 留在 HTTPS 上，并告诉浏览器只通过 HTTPS 访问你的 `HOST`。浏览器会在一年内、在这个名称的所有端口上遵守这一点；所以如果 `HOST` 将来需要重新通过普通 HTTP 应答，请提前一段时间把 `HSTS_MAX_AGE_SECONDS=0` 写进 `config.env`：浏览器会在下次访问时忘掉这条规则。

### 让 OneUptime 获取证书

:::steps
#### 将域名指向服务器

为你的域名创建一条 DNS `A` 记录（IPv6 用 `AAAA`），值为服务器的公网 IP 地址。如果添加了 `AAAA` 记录，还要为 OneUptime 开启 IPv6：参见[访问者地址](#访问者地址)。

#### 开启证书申请

在 `config.env` 中设置以下值：

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

`HOST` 必须是域名：OneUptime 无法为 IP 地址或 `localhost` 获取证书。

#### 使用新设置重新启动

```bash
npm start
```

#### 通过 HTTPS 打开你的实例

打开 `https://oneuptime.example.com`。OneUptime 在启动时申请证书，之后每小时检查一次，并在剩余有效期少于 30 天时续期。在第一张证书到来之前（通常在几分钟内），ingress 会提供一张临时的自签名证书，浏览器会发出警告。
:::

### 使用你自己的反向代理

以下步骤在与 OneUptime 相同的服务器上运行代理。如果你的代理运行在另一台机器上，请跳过第一步，把代理指向这台服务器的端口 80，并用云服务商的防火墙只让代理访问端口 80 和 443：绕过代理访问 OneUptime 的访问者，可以自己选择 OneUptime 用来计算他的地址。

:::steps
#### 将 ingress 移出端口 80 和 443

代理需要端口 80 和 443，所以要把 ingress 移到其他端口，并且只发布在这台服务器的回环地址 `127.0.0.1` 上，让访问者只能通过你的代理访问 OneUptime：

```ini title="config.env"
ONEUPTIME_HTTP_PORT=127.0.0.1:8080
STATUS_PAGE_HTTPS_PORT=127.0.0.1:8443
```

探针和 Runner 使用主机网络，通过 `http://localhost` 访问 OneUptime。`npm start` 会把它们改到 ingress 的新端口 `http://localhost:8080`，并加以说明。

#### 告诉 OneUptime 它位于代理之后

```ini title="config.env"
HOST=oneuptime.example.com
HTTP_PROTOCOL=https
PROVISION_SSL=false
TRUSTED_PROXY_HOPS=2
```

`HTTP_PROTOCOL=https` 让 OneUptime 生成的链接使用 HTTPS。`TRUSTED_PROXY_HOPS=2` 把你的代理和 OneUptime 的 ingress 都计算在内，这样 OneUptime 会在 IP 允许列表和速率限制中读取访问者的真实地址。每多一层会追加 `X-Forwarded-For` 的代理（例如 CDN 或负载均衡器），就再加一。

#### 在新端口上重新启动 OneUptime

```bash
npm start
```

`npm start` 会在新端口 `localhost:8080` 上检查 OneUptime，最后输出 **OneUptime is up!**

#### 配置代理

:::tabs
@tab Caddy
```text title="Caddyfile"
oneuptime.example.com {
	reverse_proxy localhost:8080
}
```
Caddy 会自己获取并续期证书，把 HTTP 重定向到 HTTPS，并放行 WebSocket 连接。修改文件后请重新加载 Caddy，例如使用 `sudo systemctl reload caddy`。
@tab Nginx
```nginx title="/etc/nginx/conf.d/oneuptime.conf"
map $http_upgrade $oneuptime_connection_upgrade {
    default upgrade;
    ""      close;
}

server {
    listen 80;
    server_name oneuptime.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name oneuptime.example.com;

    ssl_certificate     /etc/letsencrypt/live/oneuptime.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/oneuptime.example.com/privkey.pem;

    # The limits OneUptime's own ingress uses.
    client_max_body_size 50M;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $oneuptime_connection_upgrade;

    location / {
        proxy_pass http://127.0.0.1:8080;
    }

    # MCP clients keep a stream open.
    location /mcp {
        proxy_pass http://127.0.0.1:8080;
        proxy_buffering off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```
证书路径是 Certbot 存放 Let's Encrypt 证书的位置；如果你的证书来自其他地方，请使用它自己的路径。使用 `sudo nginx -t && sudo systemctl reload nginx` 检查文件并重新加载 Nginx。
:::

两者都会发送 `X-Forwarded-Proto`，它告诉 OneUptime 访问者是通过 HTTPS 来的。其他任何代理也必须发送它，否则你自定义域名上的状态页面和仪表板的登录 Cookie 不会被留在 HTTPS 上。

#### 通过代理打开你的实例

打开 `https://oneuptime.example.com`。你应该会看到 OneUptime 的登录页面，使用的是你的代理的证书。
:::

> [!NOTE]
> 在你自己的代理之后，请通过 OTLP/HTTP（`/otlp`）发送遥测数据。只有当 OneUptime 自己的 ingress 终止 TLS 时（`PROVISION_SSL=true`），通过 gRPC 的 OTLP 才能到达 OneUptime。

## 访问者地址

OneUptime 按访问者连接时所用的地址来计算每个访问者：登录限制、其他按地址的限制，以及状态页和仪表板的 IP 允许列表，都读取这个地址。有两种部署需要一项设置，才能让这个地址是访问者自己的地址：

| 部署 | 设置 |
| --- | --- |
| 有人通过 IPv6 访问 OneUptime，例如通过 `AAAA` 记录 | 在 `docker-compose.override.yml` 中为 OneUptime 的网络开启 IPv6 |
| OneUptime 前面有你自己的反向代理 | `TRUSTED_PROXY_HOPS=2`，并且 ingress 发布在 `127.0.0.1` 上（参见[使用你自己的反向代理](#使用你自己的反向代理)） |

OneUptime 的网络没有开启 IPv6 时，Docker 会用它自己的一个地址把每个通过 IPv6 来的访问者转交给 OneUptime，OneUptime 就会把他们全部算作同一个访问者：一个人的登录失败可能会把其他人锁在外面。开启 IPv6 需要 Docker Engine 27 或更高版本（`docker version` 会显示你的版本）。

:::steps
### 开启 IPv6

创建 `docker-compose.override.yml`（放在 `docker-compose.yml` 旁边），或把以下内容加到你已有的文件中；`npm start` 和 `npm run update` 会读取它：

```yaml title="docker-compose.override.yml"
networks:
  oneuptime:
    enable_ipv6: true
```

### 重新启动 OneUptime

```bash
npm stop
npm start
```

OneUptime 会先停止，再在网络开启 IPv6 的情况下重新启动。你的数据会保留。如果你自己的容器（例如反向代理）仍连接在 OneUptime 的网络上，Docker 无法删除这个网络：请先把它从 OneUptime 的网络断开，之后再连接回来。如果 `npm start` 因 `has active endpoints` 而停止，请断开它，然后再次运行 `npm stop` 和 `npm start`。

### 检查网络

```bash
docker network ls --quiet --filter name=_oneuptime | xargs docker network inspect | grep EnableIPv6
```

它会输出 `"EnableIPv6": true,`。
:::

当多人从同一个私有网络地址登录时，Admin Dashboard 的 **OneUptime 健康状况** 页面会指出这一点，并给出可以改变它的设置。

## 生产环境检查清单

Docker Compose 在一台服务器上为每个服务只运行一个副本，适合小团队和家庭实验室。在依赖它之前，请逐项检查这份清单。

| 方面 | 要做的事 |
| --- | --- |
| **密钥** | `config.env` 中没有任何值仍是 `please-change-this-to-random-value` 占位值。请参阅 [生成随机密钥](#生成随机密钥)。对于以占位值 `DATABASE_PASSWORD` 启动过的安装，请参阅 [更改数据库密码](#更改数据库密码)。 |
| **HTTPS** | 人们通过 HTTPS 访问 OneUptime，并且已设置 `HTTP_PROTOCOL=https`。请参阅 [设置 HTTPS](#设置-https)。 |
| **注册** | 团队成员都有账号后，在 Admin Dashboard 的 **设置 > 认证** 下关闭 **允许注册**。 |
| **防火墙** | 只有端口 80 和 443（以及 SSH）对互联网开放。OneUptime 只在 `127.0.0.1` 上发布 PostgreSQL 的端口 5400。你自己发布的其他端口，请用云服务商的防火墙关闭：`ufw` 规则不适用于 Docker 发布的端口。 |
| **访问者地址** | Admin Dashboard 的 **OneUptime 健康状况** 页面没有提示多人从同一个地址登录。参见[访问者地址](#访问者地址)。 |
| **备份** | 每天备份 PostgreSQL，并把副本移出服务器。请参阅 [备份与恢复](#备份与恢复)。 |
| **电子邮件** | 已在 Admin Dashboard 的 **设置 > 通知 > 电子邮件** 下设置邮件服务器，以便 OneUptime 发送邀请和通知。请参阅 [SMTP](/docs/emails/smtp)。 |
| **磁盘** | 持续关注剩余空间。ClickHouse 会随保留的遥测数据增长（请参阅 [规模与容量规划](/docs/installation/sizing)）；每个容器的日志上限为 1000 MB。 |
| **更新** | 至少每周更新一次 OneUptime。新版本发布频繁。请参阅 [更新 OneUptime](#更新-oneuptime)。 |
| **高可用性** | 如果需要，请迁移到 Kubernetes 上的 [Helm chart](https://artifacthub.io/packages/helm/oneuptime/oneuptime)。 |

### 更改数据库密码

PostgreSQL 会一直使用创建时的密码，所以只更改 `config.env` 中的 `DATABASE_PASSWORD` 会让 OneUptime 无法连接自己的数据库。要为以占位值启动过的安装设置专属密码，请同时在 PostgreSQL 和 `config.env` 中更改它，然后重新启动 OneUptime：

```bash
NEW_PASSWORD=$(openssl rand -hex 32) &&
  (export $(grep -v '^#' config.env | xargs) && docker compose exec -T postgres psql -U "$DATABASE_USERNAME" -d "$DATABASE_NAME" -c "ALTER USER \"$DATABASE_USERNAME\" PASSWORD '$NEW_PASSWORD'") &&
  sed -i "s/^DATABASE_PASSWORD=.*/DATABASE_PASSWORD=$NEW_PASSWORD/" config.env
npm start
```

如果你设置了 `DATABASE_BACKUP_PASSWORD` 和 `DATABASE_RESTORE_PASSWORD`，也请为它们填入新值。

## 备份与恢复

PostgreSQL 保存你配置的一切：监控器、事件、状态页面、用户。`npm run backup` 会把它转储到 `Backups` 文件夹中的一个文件里。

:::steps
### 为备份脚本提供数据库密码

在 `config.env` 中，把 `DATABASE_BACKUP_PASSWORD` 设为 `DATABASE_PASSWORD` 的值。脚本把 `config.env` 当作纯文本读取，因此它自带的 `${DATABASE_PASSWORD}` 永远不会被替换。

### 运行备份

```bash
npm run backup
```

它会询问你的 sudo 密码，并写入 `Backups/db-<day of the month>.backup`，因此每天的备份会覆盖一个月前的备份。请至少每天运行一次。

### 把备份复制到服务器之外

与数据库位于同一块磁盘上的备份，无法在这块磁盘损坏后幸存。
:::

只有服务器本机能访问 PostgreSQL：它在 `127.0.0.1` 的端口 5400 上应答。要从另一台机器备份它，请在那台机器上打开一条 SSH 隧道，然后连接那台机器自己的端口 5400：

```bash
ssh -N -L 5400:127.0.0.1:5400 you@oneuptime.example.com
```

:::details 在私有网络地址上发布 PostgreSQL
如果私有网络中的某个工具必须不经隧道访问 PostgreSQL，请同时把它发布在服务器在该网络中的地址上，并使用单独的端口。在 `docker-compose.yml` 旁边创建 `docker-compose.override.yml`；`npm start` 和 `npm run update` 会读取它：

```yaml title="docker-compose.override.yml"
services:
  postgres:
    ports:
      - "10.0.0.5:5401:5432"
```

把 `10.0.0.5` 换成服务器自己的私有地址，绝不要使用公网地址，并先为 PostgreSQL 设置专属密码（请参阅 [更改数据库密码](#更改数据库密码)）。然后运行 `npm start`，PostgreSQL 也会在该地址的端口 5401 上应答。
:::

ClickHouse 把遥测数据保存在 Docker 卷 `oneuptime_clickhouse` 中，没有任何脚本会备份它。如果需要保留这些遥测数据，请使用 [clickhouse-backup](https://github.com/Altinity/clickhouse-backup) 等 ClickHouse 工具备份该卷，或在 OneUptime 停止时复制它。

要恢复 PostgreSQL，请在 `config.env` 中设置 `DATABASE_RESTORE_*` 值：与备份时一样，把 `DATABASE_RESTORE_PASSWORD` 设为 `DATABASE_PASSWORD` 的值，并把 `DATABASE_RESTORE_FILENAME` 设为要恢复的备份，例如 `db-31.backup`。然后运行 `bash restore.sh`。它恢复到的数据库必须已经存在；在运行中的安装上，它是存在的。

> [!CAUTION]
> `restore.sh` 会先从目标数据库中删除备份里的每个对象，再重新创建它们。它在开始前会进行确认；请核对它显示的数据库名称。

## 更新 OneUptime

先备份，然后运行：

```bash
git checkout release
git pull
npm run update
```

`npm run update` 会把 `config.example.env` 中的新设置添加到你的 `config.env`（你自己的值保持不变），拉取新镜像并重启 OneUptime。与 `npm start` 一样，它最后输出 **OneUptime is up!**

升级到新的主版本（例如从 13 到 14）可能需要更多操作：开始前请阅读 [升级 OneUptime](/docs/installation/upgrading)。

`config.env` 中的 `APP_TAG=release` 总是拉取 Community Edition 的最新版本。要固定在某个版本，请把 `APP_TAG` 设为该版本号，例如 `14.0.22`。对于 Enterprise Edition，标签是 `enterprise-release` 和 `enterprise-14.0.22`。

## 卸载 OneUptime

停止 OneUptime 并删除它的容器和网络：

```bash
npm run down
```

你的数据保留在 `oneuptime_postgres` 和 `oneuptime_clickhouse` 卷中，`oneuptime` 文件夹也会保留 `config.env` 和你的备份。如果还要删除数据：

```bash
(export $(grep -v '^#' config.env | xargs) && docker compose down --volumes --remove-orphans)
```

然后删除 `oneuptime` 文件夹。

> [!CAUTION]
> `--volumes` 会永久删除所有监控器、事件、用户和全部遥测数据。如果你可能还需要其中任何内容，请先备份。

## 故障排除

:::details npm start 在启动 OneUptime 之前停止
`npm start` 会先检查服务器，遇到任何会让 OneUptime 无法工作的问题都会停下来：缺少 Docker 或其 Compose 插件、Docker 未运行或你的用户无权使用、某个端口被其他程序占用，或者 `HOST` 是任何浏览器都打不开的地址。每一行标有 ✗ 的内容都说明了要改什么。改好后再次运行 `npm start`。如果某项检查对你的服务器判断有误，可以跳过检查启动：

```bash
ONEUPTIME_SKIP_PREFLIGHT=true npm start
```
:::

:::details 运行 npm start 时 Docker 提示 "permission denied"
你的用户无法访问 Docker 守护进程。把该用户加入 `docker` 组，然后注销并重新登录：

```bash
sudo usermod -aG docker $USER
```
:::

:::details ingress 无法启动，因为端口 80 或 443 已被占用
服务器上的另一个程序（通常是 Web 服务器）占用了该端口。`npm start` 会在启动任何内容之前检查端口，如果占用端口的是 Docker 运行的容器，还会给出它的名称。停止该程序，或者把 ingress 移到其他端口，并按 [使用你自己的反向代理](#使用你自己的反向代理) 中的说明把该程序放在 OneUptime 前面。
:::

:::details npm start 以 "Maximum retries reached" 结束
`npm start` 末尾的检查在 OneUptime 响应之前就放弃了。首次启动时要下载镜像和创建数据库，耗时可能超过检查的等待时间。查看正在运行的内容并阅读日志：

```bash
npm run ps
npm run logs
```

所有容器都运行后，用 `npm run status-check` 再次运行检查。它会在 `ONEUPTIME_HTTP_PORT` 设定的端口上检查 ingress。
:::

:::details 浏览器显示 "此地址未设置 OneUptime"
你是用 `HOST` 以外的地址打开 OneUptime 的，例如在 `HOST` 仍为 `localhost` 时使用了服务器的 IP 地址。页面会显示与你打开的地址对应的 `HOST` 行，并提供复制按钮：把这一行写入 `config.env`，然后运行 `npm start`。如果你打开的就是 `HOST` 中的地址，而页面提示你的代理没有传递该地址，请让代理原样传递浏览器请求的主机名：Caddy 默认就会这样做，Nginx 要用 `proxy_set_header Host $host;`，Apache 要用 `ProxyPreserveHost On`。
:::

:::details 部分页面能加载，但实时更新或上传失败
请通过 `HOST` 中的地址打开 OneUptime。ingress 按主机名路由请求：只有 `HOST` 和 `localhost` 能访问整个应用，其他任何名称（例如服务器的 IP 地址）都会被当作状态页面的域名。把 `HOST` 设为人们实际使用的名称，然后运行 `npm start`。
:::

:::details 注册或登录失败，显示 "Page not found"
注册页面能加载，但注册失败并显示 `Page not found - /identity/signup`，登录失败并显示 `Page not found - /identity/login`。请求以 `HOST` 以外的主机名到达 OneUptime，所以 ingress 把它当作状态页面的自定义域名来路由，而那里不提供 OneUptime 自身的注册和登录。请检查以下两项：

- `HOST` 是人们打开的地址；如果使用端口，就带上端口，例如 `oneuptime.example.com:8080`。修改后运行 `npm start`。
- OneUptime 前面的代理原样传递浏览器请求的主机名。Caddy 默认就会这样做，Nginx 要用 `proxy_set_header Host $host;`（见[使用你自己的反向代理](#使用你自己的反向代理)），Apache 要用 `ProxyPreserveHost On`。
:::

:::details 设置 PROVISION_SSL 后浏览器对证书发出警告
在 Let's Encrypt 签发证书之前，ingress 会提供一张临时的自签名证书。如果警告持续超过几分钟，请检查：

- `HOST` 是域名，而不是 IP 地址或 `localhost`。
- 域名的 DNS 记录指向这台服务器。
- 端口 80 可从互联网访问，以便 Let's Encrypt 验证该域名。

当申请失败时，应用会记录一条以 `CoreSSL:EnsurePrimaryHostCertificate` 开头、后面跟着原因的错误：

```bash
(export $(grep -v '^#' config.env | xargs) && docker compose logs app) | grep -A 5 CoreSSL
```
:::

:::details 移动 ingress 端口后，内置探针显示已断开
Admin Dashboard 在 **设置 > 监控 > 全局探针** 下列出该探针。它通过 `GLOBAL_PROBE_1_ONEUPTIME_URL` 访问 OneUptime，默认值为 `http://localhost`（端口 80）。只要它和 `ONEUPTIME_RUNNER_ONEUPTIME_URL` 指向 `localhost`，`npm start` 就会把它们改到 ingress 的端口。如果你把它们设成了其他地址，或者是用 Docker CLI 启动的 OneUptime，请把两者都设为 ingress 的新端口，例如 `http://localhost:8080`，然后重启 OneUptime。
:::

## 后续步骤

:::cards
- [升级 OneUptime](/docs/installation/upgrading): 每个主版本需要你做的事。
- [规模与容量规划](/docs/installation/sizing): 为你的遥测数据规划内存和磁盘。
- [自托管架构](/docs/self-hosted/architecture): 各组件如何协同工作。
- [企业版](/docs/self-hosted/enterprise): Enterprise 镜像增加了什么，以及它的许可证。
:::
