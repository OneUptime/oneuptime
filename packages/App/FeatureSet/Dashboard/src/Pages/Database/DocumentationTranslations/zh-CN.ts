import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Database setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/Database/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the database's port — nothing is installed on the database server":
    "带 Docker Compose v2 插件的 Docker Engine 20.10+，运行在能访问数据库端口的机器上——数据库服务器上不会安装任何东西",
  "A database login that may create users and grant privileges, for the monitoring user in step 2":
    "一个可以创建用户和授予权限的数据库登录，用于第 2 步中的监控用户",
  "The host name your applications use to reach the database — it becomes the database's identity in OneUptime":
    "您的应用程序访问数据库时使用的主机名——它会成为数据库在 OneUptime 中的身份",
  "`pg_monitor` (PostgreSQL 10 and later) reads the statistics views and grants no access to your tables. Without it `pg_stat_activity` does not fail — it returns only the agent's own session, so connection counts read `1`. The receiver connects to every database to read per-database statistics, so the user also needs `CONNECT` on each one (`PUBLIC` has it by default). The PostgreSQL receiver refuses to start without a password. On a managed service where `pg_monitor` is unavailable, `pg_read_all_stats` covers the same views.":
    "`pg_monitor`（PostgreSQL 10 及更高版本）读取统计视图，不授予对您的表的访问权限。没有它时 `pg_stat_activity` 不会报错——它只返回代理自己的会话，因此连接数显示为 `1`。接收器会连接到每个数据库以读取各数据库的统计信息，因此该用户还需要每个数据库上的 `CONNECT`（`PUBLIC` 默认拥有）。PostgreSQL 接收器没有密码就不会启动。在无法使用 `pg_monitor` 的托管服务上，`pg_read_all_stats` 覆盖相同的视图。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for your OneUptime URL, the ingestion key from step 1, the endpoint to connect to and the monitoring credentials (the password is read without echo), then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行会把脚本下载为 `install.sh`，以便您在运行前先阅读它。脚本会询问您的 OneUptime URL、第 1 步中的摄取密钥、要连接的端点和监控凭据（密码以不回显的方式读取），然后安装到 `/opt/oneuptime-database-agent`，写入权限为 `0600` 的 `.env` 文件并启动代理。当端点只在这台机器上有意义时（`localhost`、`host.docker.internal`），它还会询问您的应用程序使用的主机名：这个名称就是数据库在 OneUptime 中的身份。",
  "Download `docker-compose.yml` and `configs/postgresql.yaml` (saved as `otel-collector-config.yaml`) from this OneUptime into one folder:":
    "从此 OneUptime 将 `docker-compose.yml` 和 `configs/postgresql.yaml`（另存为 `otel-collector-config.yaml`）下载到同一个文件夹：",
  "Create a `.env` file next to them (`chmod 600 .env` — it holds a password):":
    "在它们旁边创建一个 `.env` 文件（`chmod 600 .env`——其中包含密码）：",
  "Start the agent:": "启动代理：",
  "`DATABASE_ENDPOINT` is where the agent connects (`host.docker.internal:<port>` when it runs on the database machine). `DATABASE_SERVER_ADDRESS` is the database's identity: the host name your **applications** use to reach it, never `localhost`. Keep it stable — changing it registers a second database.":
    "`DATABASE_ENDPOINT` 是代理连接的地址（代理运行在数据库机器上时为 `host.docker.internal:<port>`）。`DATABASE_SERVER_ADDRESS` 是数据库的身份：即您的**应用程序**访问它时使用的主机名，绝不能是 `localhost`。请保持它稳定——更改它会注册第二个数据库。",
  "In a hand-written `.env`, single-quote the password and write every `$` in it as `$$`: the collector expands `$$` and `${...}` inside it once more. The first line says so, in the words of the `.env` the install script writes — and the script, re-run on this folder, reads the file the same way.":
    "在手写的 `.env` 中，请用单引号括住密码，并将其中的每个 `$` 写成 `$$`：收集器会再展开一次其中的 `$$` 和 `${...}`。第一行用安装脚本所写 `.env` 中的原话说明了这一点——在此文件夹中重新运行的脚本也以同样的方式读取该文件。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中选择一个摄取密钥，以填入 `<YOUR_API_KEY>`。",
  "After the first collection (about one `DATABASE_COLLECTION_INTERVAL`, 30 seconds by default) the database appears under **Databases** — or, when OneUptime already shows it from traces or containers at the same address, its **Engine metrics** status turns to Connected and its Overview charts the engine.":
    "首次收集后（大约一个 `DATABASE_COLLECTION_INTERVAL`，默认 30 秒），数据库会出现在**数据库**下——或者，如果 OneUptime 已经根据同一地址的追踪或容器显示了它，它的**引擎指标**状态会变为已连接，其概览中会显示引擎的图表。",
  "If nothing arrives, run the diagnostic script where the agent runs. It checks the container, the identity in `.env`, the connection to the database, the collector's log and the ingestion key, and names the most likely problem:":
    "如果没有任何数据到达，请在代理运行的地方运行诊断脚本。它会检查容器、`.env` 中的身份、与数据库的连接、收集器的日志和摄取密钥，并指出最可能的问题：",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: with the install script or Docker Compose, the OneUptime AI agent runs beside the collector and lets OneUptime AI read this database's diagnostics while it investigates an incident or alert, and it changes nothing unless you allow fixes — see **The files the agent runs** under Advanced.":
    "**OneUptime AI 代理（默认开启，只读）** AI 调查已开启：使用安装脚本或 Docker Compose 时，OneUptime AI 代理会在收集器旁边运行，让 OneUptime AI 在调查事件或警报时读取此数据库的诊断信息，除非您允许修复，否则它不会更改任何内容——请参阅高级下的**代理运行的文件**。",
  "The OneUptime Database Agent collects PostgreSQL engine metrics — connections against `max_connections`, commits and rollbacks, cache hit ratio, row throughput, locks and deadlocks, temporary files, database, table and index sizes, checkpoints and the background writer, vacuums and replication lag, plus optional query samples and top queries (`DATABASE_QUERY_EVENTS`) — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `postgresql` receiver (`configs/postgresql.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `postgresql` 接收器（`configs/postgresql.yaml`），收集 PostgreSQL 的引擎指标（相对于 `max_connections` 的连接数、提交和回滚、缓存命中率、行吞吐量、锁和死锁、临时文件、数据库/表/索引大小、检查点和后台写进程、VACUUM 和复制延迟，以及可选的查询样本和热门查询（`DATABASE_QUERY_EVENTS`））。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  "With `DATABASE_QUERY_EVENTS=true` the agent also ships query samples and top queries as logs: they arrive on the database's **Logs** tab with the query text as their message. They contain query text, so they are off by default — the install script asks whether to ship them.":
    "设置 `DATABASE_QUERY_EVENTS=true` 后，代理还会将查询样本和热门查询作为日志发送：它们会以查询文本作为消息到达数据库的**日志**选项卡。由于其中包含查询文本，默认处于关闭状态——安装脚本会询问是否发送。",
  "To turn them on later, set `DATABASE_QUERY_EVENTS=true` in the agent's `.env` and recreate the container with `docker compose up -d --force-recreate` in its folder.":
    "要稍后开启，请在代理的 `.env` 中设置 `DATABASE_QUERY_EVENTS=true`，并在其文件夹中用 `docker compose up -d --force-recreate` 重新创建容器。",
  "Top queries (`DATABASE_QUERY_EVENTS=true`) also need the `pg_stat_statements` extension, loaded through `shared_preload_libraries = 'pg_stat_statements'` (a restart) and created in every monitored database:":
    "热门查询（`DATABASE_QUERY_EVENTS=true`）还需要 `pg_stat_statements` 扩展，通过 `shared_preload_libraries = 'pg_stat_statements'` 加载（需要重启），并在每个受监控的数据库中创建：",
  "Their explain plans additionally need `SELECT` on the tables the queries touch, which `pg_monitor` does not grant (for example `GRANT SELECT ON ALL TABLES IN SCHEMA app TO oneuptime_monitor`). Without it top queries still arrive, with empty plans, and the collector logs `failed to explain` for each one.":
    "它们的执行计划还需要对查询所涉及的表拥有 `SELECT`，而 `pg_monitor` 不授予该权限（例如 `GRANT SELECT ON ALL TABLES IN SCHEMA app TO oneuptime_monitor`）。没有它时热门查询仍会到达，只是计划为空，并且收集器会为每个查询记录 `failed to explain`。",
  "| Variable | Required | Description |": "| 变量 | 必需 | 说明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime URL |":
    "| `ONEUPTIME_URL` | 是 | 您的 OneUptime URL |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | The telemetry ingestion key selected above |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 上面选择的遥测摄取密钥 |",
  "| `DATABASE_SYSTEM` | Yes | The engine, stamped as `db.system.name`: `postgresql`, `mysql`, `mariadb`, `redis`, `valkey`, `keydb`, `dragonfly`, `mongodb`, `microsoft.sql_server`, `oracle.db`, `elasticsearch`, `opensearch` or `memcached` |":
    "| `DATABASE_SYSTEM` | 是 | 引擎，记录为 `db.system.name`：`postgresql`、`mysql`、`mariadb`、`redis`、`valkey`、`keydb`、`dragonfly`、`mongodb`、`microsoft.sql_server`、`oracle.db`、`elasticsearch`、`opensearch` 或 `memcached` |",
  "| `DATABASE_ENDPOINT` | Yes | `host:port` the agent connects to (a `http://` or `https://` URL for Elasticsearch / OpenSearch) |":
    "| `DATABASE_ENDPOINT` | 是 | 代理连接的 `host:port`（对于 Elasticsearch / OpenSearch 为 `http://` 或 `https://` URL） |",
  "| `DATABASE_ENDPOINT_HOST` | SQL Server | `DATABASE_ENDPOINT`'s host (install.sh writes it) |":
    "| `DATABASE_ENDPOINT_HOST` | SQL Server | `DATABASE_ENDPOINT` 的主机（由 install.sh 写入） |",
  "| `DATABASE_ENDPOINT_PORT` | SQL Server | `DATABASE_ENDPOINT`'s port (install.sh writes it) |":
    "| `DATABASE_ENDPOINT_PORT` | SQL Server | `DATABASE_ENDPOINT` 的端口（由 install.sh 写入） |",
  "| `DATABASE_ORACLE_SERVICE` | Oracle | The service to connect to, e.g. `FREEPDB1` |":
    "| `DATABASE_ORACLE_SERVICE` | Oracle | 要连接的服务，例如 `FREEPDB1` |",
  "| `DATABASE_SERVER_ADDRESS` | Yes | The host name your applications use — the database's identity |":
    "| `DATABASE_SERVER_ADDRESS` | 是 | 您的应用程序使用的主机名——数据库的身份 |",
  "| `DATABASE_SERVER_PORT` | Yes | The port your applications use |":
    "| `DATABASE_SERVER_PORT` | 是 | 您的应用程序使用的端口 |",
  "| `DATABASE_USERNAME` | PostgreSQL, MySQL, SQL Server, Oracle | The monitoring user |":
    "| `DATABASE_USERNAME` | PostgreSQL、MySQL、SQL Server、Oracle | 监控用户 |",
  "| `DATABASE_PASSWORD` | PostgreSQL, SQL Server, Oracle | Its password (single-quoted in `.env`, every `$` written as `$$`) |":
    "| `DATABASE_PASSWORD` | PostgreSQL、SQL Server、Oracle | 其密码（在 `.env` 中用单引号括住，每个 `$` 写成 `$$`） |",
  "| `DATABASE_TLS_INSECURE` | No | `true` (default) connects without TLS, `false` turns TLS on |":
    "| `DATABASE_TLS_INSECURE` | 否 | `true`（默认）不使用 TLS 连接，`false` 开启 TLS |",
  "| `DATABASE_TLS_INSECURE_SKIP_VERIFY` | No | `true` accepts a certificate the collector image does not trust |":
    "| `DATABASE_TLS_INSECURE_SKIP_VERIFY` | 否 | `true` 接受收集器镜像不信任的证书 |",
  "| `DATABASE_TLS_SSLMODE` | No | PostgreSQL: the two settings above as libpq's `sslmode`, for the config's own SQL checks - `disable` while `DATABASE_TLS_INSECURE` is `true`, `require` when `DATABASE_TLS_INSECURE_SKIP_VERIFY` is `true`, `verify-full` otherwise (install.sh writes it) |":
    "| `DATABASE_TLS_SSLMODE` | 否 | PostgreSQL：上述两项设置以 libpq 的 `sslmode` 形式表示，用于配置自身的 SQL 检查 - `DATABASE_TLS_INSECURE` 为 `true` 时为 `disable`，`DATABASE_TLS_INSECURE_SKIP_VERIFY` 为 `true` 时为 `require`，否则为 `verify-full`（由 install.sh 写入） |",
  "| `DATABASE_TLS_MYSQL` | No | MySQL and MariaDB: the same two settings as the driver's `tls`, for the config's readings of Galera - `false` while `DATABASE_TLS_INSECURE` is `true`, `skip-verify` when `DATABASE_TLS_INSECURE_SKIP_VERIFY` is `true`, `true` otherwise. `install.sh` works it out. Default `false` |":
    "| `DATABASE_TLS_MYSQL` | 否 | MySQL 和 MariaDB：同样两项设置以驱动的 `tls` 形式表示，用于配置对 Galera 的读取 - `DATABASE_TLS_INSECURE` 为 `true` 时为 `false`，`DATABASE_TLS_INSECURE_SKIP_VERIFY` 为 `true` 时为 `skip-verify`，否则为 `true`。由 `install.sh` 推算。默认 `false` |",
  "| `DATABASE_COLLECTION_INTERVAL` | No | How often statistics are read. Default `30s` |":
    "| `DATABASE_COLLECTION_INTERVAL` | 否 | 读取统计信息的频率。默认 `30s` |",
  "| `DATABASE_QUERY_EVENTS` | No | `true` ships query samples and top queries as logs (they contain query text) |":
    "| `DATABASE_QUERY_EVENTS` | 否 | `true` 将查询样本和热门查询作为日志发送（其中包含查询文本） |",
  "| `DATABASE_SERVER_ID` | No | The id of a database OneUptime already shows; the data then joins it directly |":
    "| `DATABASE_SERVER_ID` | 否 | OneUptime 已显示的某个数据库的 ID；数据随后会直接关联到它 |",
  "The install script downloads both into `/opt/oneuptime-database-agent`; the Docker Compose steps use the same files.":
    "安装脚本会将两者下载到 `/opt/oneuptime-database-agent`；Docker Compose 步骤使用相同的文件。",
  "**docker-compose.yml**": "**docker-compose.yml** 文件",
  "**otel-collector-config.yaml** — `configs/postgresql.yaml`, the PostgreSQL config":
    "**otel-collector-config.yaml** — `configs/postgresql.yaml`，PostgreSQL 的配置",
  "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent: it lets OneUptime AI read the database's diagnostics while it investigates an incident or alert — read-only unless you allow fixes — and shows on the database's **AI → AI agent** page. Remove its service if you do not use OneUptime AI.":
    "Compose 文件还会运行 OneUptime AI 代理 `oneuptime-database-ai-agent`：它让 OneUptime AI 在调查事件或警报时读取数据库的诊断信息——除非您允许修复，否则为只读——并显示在数据库的 **人工智能 → AI 代理** 页面上。如果您不使用 OneUptime AI，请删除它的服务。",
  "**Upgrade** by running the current install script again. It reuses your `.env`, replaces `docker-compose.yml` and `otel-collector-config.yaml` with the current versions and recreates the container; a file you edited is kept next to the new one as `<file>.bak.<timestamp>`.":
    "**升级**的方法是再次运行当前的安装脚本。它会沿用您的 `.env`，用当前版本替换 `docker-compose.yml` 和 `otel-collector-config.yaml`，并重新创建容器；您编辑过的文件会以 `<file>.bak.<timestamp>` 保留在新文件旁边。",
  "After editing `.env` or `otel-collector-config.yaml` yourself, apply the change with `docker compose up -d --force-recreate` in the agent's folder: the collector reads its config only when it starts, and a plain `docker compose up -d` keeps the running container when only the config file changed.":
    "自行编辑 `.env` 或 `otel-collector-config.yaml` 后，请在代理的文件夹中用 `docker compose up -d --force-recreate` 应用更改：收集器只在启动时读取配置，而当只有配置文件改变时，普通的 `docker compose up -d` 会保留正在运行的容器。",
  "**Monitor a second database server** with a second agent in a directory of its own — one agent monitors one server:":
    "**监控第二台数据库服务器**时，请在单独的目录中使用第二个代理——一个代理监控一台服务器：",
  "**Uninstall** the agent:": "**卸载**代理：",
  "Then drop the monitoring user.": "然后删除监控用户。",
  "For a probe-based check that needs no agent at all — connections, locks, cache and replication health, with alerting — [create a Database Health monitor](/dashboard/1/monitors/create?monitorType=Database) (PostgreSQL, MySQL and SQL Server). It uses the same monitoring user. Its alerts and incidents also appear on the database whose endpoints include the host and port it connects to.":
    "如需一种完全不需要代理、基于探测的检查——连接、锁、缓存和复制的健康状况，并带有警报——请[创建数据库健康监视器](/dashboard/1/monitors/create?monitorType=Database)（PostgreSQL、MySQL 和 SQL Server）。它使用相同的监控用户。它的警报和事件也会显示在端点包含其所连接主机和端口的数据库上。",
  "- `DATABASE_SERVER_ADDRESS` is `localhost`, `127.0.0.1` or `host.docker.internal`: OneUptime ignores addresses that only mean something on one machine. Use the host name your applications use.":
    "- `DATABASE_SERVER_ADDRESS` 为 `localhost`、`127.0.0.1` 或 `host.docker.internal`：OneUptime 会忽略只在一台机器上有意义的地址。请使用您的应用程序使用的主机名。",
  "- It is a private IP, a single-label name or a cluster-local name (`*.svc.cluster.local`): such names never create a database on their own. Create the database under **Databases → Create Database** with that address and port, or install the agent from the database's own **Documentation** tab, which sets `DATABASE_SERVER_ID`.":
    "- 它是私有 IP、单标签名称或集群本地名称（`*.svc.cluster.local`）：这类名称本身永远不会创建数据库。请在 **数据库 → 创建数据库** 下用该地址和端口创建数据库，或者从数据库自己的**文档**选项卡安装代理，该选项卡会设置 `DATABASE_SERVER_ID`。",
  "- The ingestion key is wrong — the diagnostic script from step 4 checks it.":
    "- 摄取密钥错误——第 4 步的诊断脚本会检查它。",
  "Inside the agent's container, `localhost` is the container itself. Use `host.docker.internal:<port>` (the compose file maps it to the machine on Linux too) with the database listening on the Docker bridge address as well — or uncomment `network_mode: host` in `docker-compose.yml` and use `localhost:<port>`. For a remote server, check DNS, firewalls and the server's own allow-list (`pg_hba.conf`).":
    "在代理的容器内，`localhost` 指容器本身。请使用 `host.docker.internal:<port>`（Compose 文件在 Linux 上也会将其映射到这台机器），并让数据库同时监听 Docker 网桥地址——或者取消注释 `docker-compose.yml` 中的 `network_mode: host` 并使用 `localhost:<port>`。对于远程服务器，请检查 DNS、防火墙和服务器自己的允许列表（`pg_hba.conf`）。",
  "The collector's log (`docker compose logs --tail 100` in the agent's folder) names the problem:":
    "收集器的日志（在代理的文件夹中运行 `docker compose logs --tail 100`）会指出问题：",
  "- `password authentication failed`: the database rejected the login. Check `DATABASE_USERNAME` and `DATABASE_PASSWORD` — the collector expands `$` inside them once more, so every `$` must be written as `$$` in `.env` or a Kubernetes Secret (the install script does this).":
    "- `password authentication failed`：数据库拒绝了登录。请检查 `DATABASE_USERNAME` 和 `DATABASE_PASSWORD`——收集器会再展开一次其中的 `$`，因此在 `.env` 或 Kubernetes Secret 中每个 `$` 都必须写成 `$$`（安装脚本会这样做）。",
  "- `permission denied`, `must be superuser`, or connection counts that always read `1`: the monitoring user is missing the grants from step 2.":
    "- `permission denied`、`must be superuser`，或连接数始终显示为 `1`：监控用户缺少第 2 步中的权限。",
  "- `pg_stat_statements` errors: top queries are on without the extension — create it (see Query samples and top queries), or set `DATABASE_QUERY_EVENTS=false`.":
    "- `pg_stat_statements` 错误：热门查询已开启，但没有该扩展——请创建它（参见查询样本和热门查询），或设置 `DATABASE_QUERY_EVENTS=false`。",
  "- `failed to explain` is not a missing grant: explain plans of top queries need `SELECT` on your tables, which `pg_monitor` deliberately does not give. Metrics and top queries are unaffected; only the plans stay empty.":
    "- `failed to explain` 并不是缺少权限：热门查询的执行计划需要对您的表拥有 `SELECT`，而 `pg_monitor` 有意不授予该权限。指标和热门查询不受影响；只是计划为空。",
  "- TLS errors (`SSL is not enabled on the server`): match `DATABASE_TLS_INSECURE` to the server — `true` when it does not speak TLS, `false` when it requires it, plus `DATABASE_TLS_INSECURE_SKIP_VERIFY=true` for a certificate the collector image does not trust.":
    "- TLS 错误（`SSL is not enabled on the server`）：让 `DATABASE_TLS_INSECURE` 与服务器一致——服务器不使用 TLS 时为 `true`，要求 TLS 时为 `false`，对于收集器镜像不信任的证书，还要加上 `DATABASE_TLS_INSECURE_SKIP_VERIFY=true`。",
  "After changing `.env`, apply it with `docker compose up -d --force-recreate`.":
    "更改 `.env` 后，请用 `docker compose up -d --force-recreate` 应用。",
  "The collector cannot deliver to `ONEUPTIME_URL`. `HTTP Status Code 401` or `422` in that line means OneUptime refused the ingestion key: it is unknown, revoked, disabled or expired — or a Browser key, which ingest only accepts from a browser. Pick a server key in step 1. Otherwise check the URL, outbound HTTPS from the agent's machine and, for a self-hosted OneUptime, its certificate.":
    "收集器无法将数据发送到 `ONEUPTIME_URL`。该行中出现 `HTTP Status Code 401` 或 `422` 表示 OneUptime 拒绝了摄取密钥：它未知、已吊销、已禁用或已过期——或者是只接受来自浏览器的浏览器密钥。请在第 1 步中选择服务器密钥。否则，请检查 URL、代理所在机器的出站 HTTPS，以及自托管 OneUptime 的证书。",
  "A restart loop is almost always a configuration error, which the collector names on its first log lines:":
    "重启循环几乎总是配置错误，收集器会在其最初几行日志中指出：",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for the endpoint to connect to and the monitoring credentials (the password is read without echo), then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行会把脚本下载为 `install.sh`，以便您在运行前先阅读它。脚本会询问要连接的端点和监控凭据（密码以不回显的方式读取），然后安装到 `/opt/oneuptime-database-agent`，写入权限为 `0600` 的 `.env` 文件并启动代理。当端点只在这台机器上有意义时（`localhost`、`host.docker.internal`），它还会询问您的应用程序使用的主机名：这个名称就是数据库在 OneUptime 中的身份。",
  "`PROCESS` and `REPLICATION CLIENT` cover the global status counters, InnoDB status and replica status; `performance_schema` is read for query samples and top queries.":
    "`PROCESS` 和 `REPLICATION CLIENT` 涵盖全局状态计数器、InnoDB 状态和副本状态；`performance_schema` 用于读取查询样本和热门查询。",
  "The OneUptime Database Agent collects MySQL engine metrics — threads and connections, connection errors, queries and slow queries, commands, the InnoDB buffer pool, row and table locks, row operations and handlers, temporary tables and sorts, and replica lag, plus optional query samples and top queries (`DATABASE_QUERY_EVENTS`) — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `mysql` receiver (`configs/mysql.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `mysql` 接收器（`configs/mysql.yaml`），收集 MySQL 的引擎指标（线程和连接、连接错误、查询和慢查询、命令、InnoDB 缓冲池、行锁和表锁、行操作和处理程序、临时表和排序，以及副本延迟，以及可选的查询样本和热门查询（`DATABASE_QUERY_EVENTS`））。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  "They read `performance_schema`, which the monitoring user's grant from step 2 already covers.":
    "它们读取 `performance_schema`，第 2 步中授予监控用户的权限已涵盖这一点。",
  "**otel-collector-config.yaml** — `configs/mysql.yaml`, the MySQL / MariaDB config":
    "**otel-collector-config.yaml** — `configs/mysql.yaml`，MySQL / MariaDB 的配置",
  "- `Access denied; you need … privilege(s)`: the monitoring user is missing the grants from step 2. MySQL / MariaDB error 1227 names the privilege: `PROCESS`, or `SLAVE MONITOR` on MariaDB 10.5.9 and later.":
    "- `Access denied; you need … privilege(s)`：监控用户缺少第 2 步中的权限。MySQL / MariaDB 错误 1227 会指出所需的权限：`PROCESS`，或者在 MariaDB 10.5.9 及更高版本上为 `SLAVE MONITOR`。",
  "- TLS errors: match `DATABASE_TLS_INSECURE` to the server — `true` when it does not speak TLS, `false` when it requires it, plus `DATABASE_TLS_INSECURE_SKIP_VERIFY=true` for a certificate the collector image does not trust.":
    "- TLS 错误：让 `DATABASE_TLS_INSECURE` 与服务器一致——服务器不使用 TLS 时为 `true`，要求 TLS 时为 `false`，对于收集器镜像不信任的证书，还要加上 `DATABASE_TLS_INSECURE_SKIP_VERIFY=true`。",
  "`PROCESS` and `REPLICATION CLIENT` cover the global status counters, InnoDB status and replica status; `performance_schema` is read for query samples and top queries. MariaDB 10.5.9 and later split replica status into its own privilege, so also run `GRANT SLAVE MONITOR ON *.* TO 'oneuptime_monitor'@'%';` there.":
    "`PROCESS` 和 `REPLICATION CLIENT` 涵盖全局状态计数器、InnoDB 状态和副本状态；`performance_schema` 用于读取查询样本和热门查询。MariaDB 10.5.9 及更高版本将副本状态拆分为单独的权限，因此在这些版本上还要运行 `GRANT SLAVE MONITOR ON *.* TO 'oneuptime_monitor'@'%';`。",
  "The OneUptime Database Agent collects MariaDB engine metrics — threads and connections, connection errors, queries and slow queries, commands, the InnoDB buffer pool, row and table locks, row operations and handlers, temporary tables and sorts, and replica lag, plus optional query samples and top queries (`DATABASE_QUERY_EVENTS`) — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `mysql` receiver (`configs/mysql.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `mysql` 接收器（`configs/mysql.yaml`），收集 MariaDB 的引擎指标（线程和连接、连接错误、查询和慢查询、命令、InnoDB 缓冲池、行锁和表锁、行操作和处理程序、临时表和排序，以及副本延迟，以及可选的查询样本和热门查询（`DATABASE_QUERY_EVENTS`））。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  "`VIEW SERVER STATE` (on SQL Server 2022 and later `VIEW SERVER PERFORMANCE STATE` is enough) reads the dynamic management views every metric comes from, and grants no access to your data. The receiver puts the login into a connection string without quoting it, so the user name and password must not contain a semicolon (`;`) or a double quote (`\"`), nor start or end with a space — the install script refuses them. For a named instance (`host\\instance`), connect to the instance's own TCP port (`host:port`), never the default instance's 1433: SQL Server Configuration Manager shows it, or run `SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id = @@SPID;` on the instance.":
    '`VIEW SERVER STATE`（在 SQL Server 2022 及更高版本上 `VIEW SERVER PERFORMANCE STATE` 即可）读取每个指标所来自的动态管理视图，不授予对您数据的访问权限。接收器会把登录信息不加引号地放入连接字符串，因此用户名和密码不能包含分号（`;`）或双引号（`"`），也不能以空格开头或结尾——安装脚本会拒绝它们。对于命名实例（`host\\instance`），请连接到该实例自己的 TCP 端口（`host:port`），而不是默认实例的 1433：SQL Server 配置管理器会显示该端口，或者在实例上运行 `SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id = @@SPID;`。',
  "The OneUptime Database Agent collects SQL Server engine metrics — user connections, batch requests and compilations, buffer cache hit ratio, page life expectancy, lock waits, deadlocks and blocked processes, pending memory grants, CPU, database I/O and latency, and availability-group replica lag, plus optional query samples and top queries (`DATABASE_QUERY_EVENTS`) — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `sqlserver` receiver (`configs/sqlserver.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `sqlserver` 接收器（`configs/sqlserver.yaml`），收集 SQL Server 的引擎指标（用户连接、批处理请求和编译、缓冲区缓存命中率、页面预期寿命、锁等待、死锁和被阻塞的进程、待处理的内存授予、CPU、数据库 I/O 和延迟，以及可用性组副本延迟，以及可选的查询样本和热门查询（`DATABASE_QUERY_EVENTS`））。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  "They read the dynamic management views, which `VIEW SERVER STATE` from step 2 already covers.":
    "它们读取动态管理视图，第 2 步中的 `VIEW SERVER STATE` 已涵盖这一点。",
  "**otel-collector-config.yaml** — `configs/sqlserver.yaml`, the SQL Server config":
    "**otel-collector-config.yaml** — `configs/sqlserver.yaml`，SQL Server 的配置",
  "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent. It has no AI diagnostics for SQL Server yet, so it runs nothing — remove its service if you do not want it running.":
    "Compose 文件还会运行 OneUptime AI 代理 `oneuptime-database-ai-agent`。它目前还没有针对 SQL Server 的 AI 诊断，因此什么也不运行——如果您不希望它运行，请删除它的服务。",
  "Inside the agent's container, `localhost` is the container itself. Use `host.docker.internal:<port>` (the compose file maps it to the machine on Linux too) with the database listening on the Docker bridge address as well — or uncomment `network_mode: host` in `docker-compose.yml` and use `localhost:<port>`. For a remote server, check DNS, firewalls and the server's own allow-list.":
    "在代理的容器内，`localhost` 指容器本身。请使用 `host.docker.internal:<port>`（Compose 文件在 Linux 上也会将其映射到这台机器），并让数据库同时监听 Docker 网桥地址——或者取消注释 `docker-compose.yml` 中的 `network_mode: host` 并使用 `localhost:<port>`。对于远程服务器，请检查 DNS、防火墙和服务器自己的允许列表。",
  "- `Login failed for user`: the database rejected the login. Check `DATABASE_USERNAME` and `DATABASE_PASSWORD` — the collector expands `$` inside them once more, so every `$` must be written as `$$` in `.env` or a Kubernetes Secret (the install script does this). A login containing `;` or `\"`, or with spaces around it, always fails: the receiver's connection string cannot carry them.":
    '- `Login failed for user`：数据库拒绝了登录。请检查 `DATABASE_USERNAME` 和 `DATABASE_PASSWORD`——收集器会再展开一次其中的 `$`，因此在 `.env` 或 Kubernetes Secret 中每个 `$` 都必须写成 `$$`（安装脚本会这样做）。包含 `;` 或 `"`、或前后带空格的登录信息总会失败：接收器的连接字符串无法承载它们。',
  "- `VIEW SERVER STATE`: the monitoring user is missing the grants from step 2.":
    "- `VIEW SERVER STATE`：监控用户缺少第 2 步中的权限。",
  "`SELECT_CATALOG_ROLE` reads the `V$` and `DBA_` views the metrics, query samples and top queries come from, and grants no access to your tables. `DATABASE_ORACLE_SERVICE` is the service the agent connects to (`FREEPDB1`, `ORCLPDB1`, …).":
    "`SELECT_CATALOG_ROLE` 读取指标、查询样本和热门查询所来自的 `V$` 和 `DBA_` 视图，不授予对您的表的访问权限。`DATABASE_ORACLE_SERVICE` 是代理连接的服务（`FREEPDB1`、`ORCLPDB1`、…）。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for your OneUptime URL, the ingestion key from step 1, the endpoint to connect to, the Oracle service name and the monitoring credentials (the password is read without echo), then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行会把脚本下载为 `install.sh`，以便您在运行前先阅读它。脚本会询问您的 OneUptime URL、第 1 步中的摄取密钥、要连接的端点、Oracle 服务名和监控凭据（密码以不回显的方式读取），然后安装到 `/opt/oneuptime-database-agent`，写入权限为 `0600` 的 `.env` 文件并启动代理。当端点只在这台机器上有意义时（`localhost`、`host.docker.internal`），它还会询问您的应用程序使用的主机名：这个名称就是数据库在 OneUptime 中的身份。",
  "The OneUptime Database Agent collects Oracle engine metrics — sessions, executions, commits and rollbacks, parses, logical and physical reads, CPU and DB time, PGA and SGA memory and tablespace usage, plus optional query samples and top queries (`DATABASE_QUERY_EVENTS`) — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `oracledb` receiver (`configs/oracledb.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `oracledb` 接收器（`configs/oracledb.yaml`），收集 Oracle 的引擎指标（会话、执行、提交和回滚、解析、逻辑读和物理读、CPU 时间和数据库时间、PGA 和 SGA 内存，以及表空间使用量，以及可选的查询样本和热门查询（`DATABASE_QUERY_EVENTS`））。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  "They read the `V$` views, which `SELECT_CATALOG_ROLE` from step 2 already covers.":
    "它们读取 `V$` 视图，第 2 步中的 `SELECT_CATALOG_ROLE` 已涵盖这一点。",
  "**otel-collector-config.yaml** — `configs/oracledb.yaml`, the Oracle config":
    "**otel-collector-config.yaml** — `configs/oracledb.yaml`，Oracle 的配置",
  "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent. It has no AI diagnostics for Oracle yet, so it runs nothing — remove its service if you do not want it running.":
    "Compose 文件还会运行 OneUptime AI 代理 `oneuptime-database-ai-agent`。它目前还没有针对 Oracle 的 AI 诊断，因此什么也不运行——如果您不希望它运行，请删除它的服务。",
  "- `ORA-00942`, `ORA-01031`: the monitoring user is missing the grants from step 2.":
    "- `ORA-00942`、`ORA-01031`：监控用户缺少第 2 步中的权限。",
  "- `ORA-12514` or `ORA-12505`: the listener answers but does not know the service `DATABASE_ORACLE_SERVICE` names — `lsnrctl services` on the database host lists the ones it does.":
    "- `ORA-12514` 或 `ORA-12505`：监听器有响应，但不认识 `DATABASE_ORACLE_SERVICE` 所指的服务——在数据库主机上运行 `lsnrctl services` 可列出它认识的服务。",
  "- `ORA-28000` or `ORA-28001`: the monitoring user is locked or its password expired.":
    "- `ORA-28000` 或 `ORA-28001`：监控用户已被锁定或其密码已过期。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for the endpoint to connect to, the Oracle service name and the monitoring credentials (the password is read without echo), then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行会把脚本下载为 `install.sh`，以便您在运行前先阅读它。脚本会询问要连接的端点、Oracle 服务名和监控凭据（密码以不回显的方式读取），然后安装到 `/opt/oneuptime-database-agent`，写入权限为 `0600` 的 `.env` 文件并启动代理。当端点只在这台机器上有意义时（`localhost`、`host.docker.internal`），它还会询问您的应用程序使用的主机名：这个名称就是数据库在 OneUptime 中的身份。",
  "The receiver only runs `INFO`. Persist the user with `ACL SAVE` (or a `user` line in `redis.conf` / your ACL file). On a server protected only by `requirepass`, leave `DATABASE_USERNAME` empty and set `DATABASE_PASSWORD`; on a server without authentication leave both empty.":
    "接收器只运行 `INFO`。请用 `ACL SAVE`（或 `redis.conf` / 您的 ACL 文件中的 `user` 行）持久保存该用户。在仅由 `requirepass` 保护的服务器上，请将 `DATABASE_USERNAME` 留空并设置 `DATABASE_PASSWORD`；在没有身份验证的服务器上，请将两者都留空。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for your OneUptime URL, the ingestion key from step 1, the endpoint to connect to and the monitoring credentials, if the server has users (the password is read without echo), then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行会把脚本下载为 `install.sh`，以便您在运行前先阅读它。脚本会询问您的 OneUptime URL、第 1 步中的摄取密钥、要连接的端点，以及服务器有用户时的监控凭据（密码以不回显的方式读取），然后安装到 `/opt/oneuptime-database-agent`，写入权限为 `0600` 的 `.env` 文件并启动代理。当端点只在这台机器上有意义时（`localhost`、`host.docker.internal`），它还会询问您的应用程序使用的主机名：这个名称就是数据库在 OneUptime 中的身份。",
  "The OneUptime Database Agent collects Redis engine metrics — connected and blocked clients, commands per second and their latency, keyspace hits and misses, memory against `maxmemory`, evicted and expired keys, and replication — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `redis` receiver (`configs/redis.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `redis` 接收器（`configs/redis.yaml`），收集 Redis 的引擎指标（已连接和被阻塞的客户端、每秒命令数及其延迟、键空间命中和未命中、相对于 `maxmemory` 的内存、被驱逐和过期的键，以及复制）。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  "**otel-collector-config.yaml** — `configs/redis.yaml`, the Redis / Valkey / KeyDB / Dragonfly config":
    "**otel-collector-config.yaml** — `configs/redis.yaml`，Redis / Valkey / KeyDB / Dragonfly 的配置",
  "- `WRONGPASS`, `NOAUTH`: the database rejected the login. Check `DATABASE_USERNAME` and `DATABASE_PASSWORD` — the collector expands `$` inside them once more, so every `$` must be written as `$$` in `.env` or a Kubernetes Secret (the install script does this).":
    "- `WRONGPASS`、`NOAUTH`：数据库拒绝了登录。请检查 `DATABASE_USERNAME` 和 `DATABASE_PASSWORD`——收集器会再展开一次其中的 `$`，因此在 `.env` 或 Kubernetes Secret 中每个 `$` 都必须写成 `$$`（安装脚本会这样做）。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for the endpoint to connect to and the monitoring credentials, if the server has users (the password is read without echo), then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行会把脚本下载为 `install.sh`，以便您在运行前先阅读它。脚本会询问要连接的端点，以及服务器有用户时的监控凭据（密码以不回显的方式读取），然后安装到 `/opt/oneuptime-database-agent`，写入权限为 `0600` 的 `.env` 文件并启动代理。当端点只在这台机器上有意义时（`localhost`、`host.docker.internal`），它还会询问您的应用程序使用的主机名：这个名称就是数据库在 OneUptime 中的身份。",
  "The receiver only runs `INFO`. Persist the user with `ACL SAVE` (or a `user` line in `redis.conf` / your ACL file). On a server protected only by `requirepass`, leave `DATABASE_USERNAME` empty and set `DATABASE_PASSWORD`; on a server without authentication leave both empty. Valkey, KeyDB and Dragonfly take the same ACL.":
    "接收器只运行 `INFO`。请用 `ACL SAVE`（或 `redis.conf` / 您的 ACL 文件中的 `user` 行）持久保存该用户。在仅由 `requirepass` 保护的服务器上，请将 `DATABASE_USERNAME` 留空并设置 `DATABASE_PASSWORD`；在没有身份验证的服务器上，请将两者都留空。Valkey、KeyDB 和 Dragonfly 使用相同的 ACL。",
  "The OneUptime Database Agent collects Valkey engine metrics — connected and blocked clients, commands per second and their latency, keyspace hits and misses, memory against `maxmemory`, evicted and expired keys, and replication — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `redis` receiver (`configs/redis.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `redis` 接收器（`configs/redis.yaml`），收集 Valkey 的引擎指标（已连接和被阻塞的客户端、每秒命令数及其延迟、键空间命中和未命中、相对于 `maxmemory` 的内存、被驱逐和过期的键，以及复制）。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  "The OneUptime Database Agent collects KeyDB engine metrics — connected and blocked clients, commands per second and their latency, keyspace hits and misses, memory against `maxmemory`, evicted and expired keys, and replication — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `redis` receiver (`configs/redis.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `redis` 接收器（`configs/redis.yaml`），收集 KeyDB 的引擎指标（已连接和被阻塞的客户端、每秒命令数及其延迟、键空间命中和未命中、相对于 `maxmemory` 的内存、被驱逐和过期的键，以及复制）。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  "The OneUptime Database Agent collects Dragonfly engine metrics — connected and blocked clients, commands per second and their latency, keyspace hits and misses, memory against `maxmemory`, evicted and expired keys, and replication — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `redis` receiver (`configs/redis.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `redis` 接收器（`configs/redis.yaml`），收集 Dragonfly 的引擎指标（已连接和被阻塞的客户端、每秒命令数及其延迟、键空间命中和未命中、相对于 `maxmemory` 的内存、被驱逐和过期的键，以及复制）。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  "A Memcached server without SASL authentication (`-S`): Memcached has no users, and the agent runs `stats` over the text protocol without logging in":
    "未启用 SASL 身份验证（`-S`）的 Memcached 服务器：Memcached 没有用户，代理无需登录即可通过文本协议运行 `stats`",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for your OneUptime URL, the ingestion key from step 1 and the endpoint to connect to, then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行会把脚本下载为 `install.sh`，以便您在运行前先阅读它。脚本会询问您的 OneUptime URL、第 1 步中的摄取密钥和要连接的端点，然后安装到 `/opt/oneuptime-database-agent`，写入权限为 `0600` 的 `.env` 文件并启动代理。当端点只在这台机器上有意义时（`localhost`、`host.docker.internal`），它还会询问您的应用程序使用的主机名：这个名称就是数据库在 OneUptime 中的身份。",
  "Create a `.env` file next to them (`chmod 600 .env` — it holds your ingestion key):":
    "在它们旁边创建一个 `.env` 文件（`chmod 600 .env`——其中包含您的摄取密钥）：",
  "The OneUptime Database Agent collects Memcached engine metrics — connections, commands, get hits and misses (the cache hit ratio), evictions, items, memory used, network traffic, threads and CPU — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `memcached` receiver (`configs/memcached.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `memcached` 接收器（`configs/memcached.yaml`），收集 Memcached 的引擎指标（连接、命令、get 命中和未命中（缓存命中率）、驱逐、条目、已用内存、网络流量、线程和 CPU）。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  "**otel-collector-config.yaml** — `configs/memcached.yaml`, the Memcached config":
    "**otel-collector-config.yaml** — `configs/memcached.yaml`，Memcached 的配置",
  "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent. It has no AI diagnostics for Memcached yet, so it runs nothing — remove its service if you do not want it running.":
    "Compose 文件还会运行 OneUptime AI 代理 `oneuptime-database-ai-agent`。它目前还没有针对 Memcached 的 AI 诊断，因此什么也不运行——如果您不希望它运行，请删除它的服务。",
  "- The ingestion key is wrong — the diagnostic script from step 3 checks it.":
    "- 摄取密钥错误——第 3 步的诊断脚本会检查它。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for the endpoint to connect to, then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行会把脚本下载为 `install.sh`，以便您在运行前先阅读它。脚本会询问要连接的端点，然后安装到 `/opt/oneuptime-database-agent`，写入权限为 `0600` 的 `.env` 文件并启动代理。当端点只在这台机器上有意义时（`localhost`、`host.docker.internal`），它还会询问您的应用程序使用的主机名：这个名称就是数据库在 OneUptime 中的身份。",
  "`clusterMonitor` covers every metric. The agent connects to exactly one member, so run one agent per replica-set member.":
    "`clusterMonitor` 涵盖所有指标。代理只连接到一个成员，因此请为副本集的每个成员运行一个代理。",
  "The OneUptime Database Agent collects MongoDB engine metrics — connections, operations and their latency, active reads and writes, cache operations, memory, data, storage and index sizes, cursors, sessions and page faults, plus optional query samples and top queries (`DATABASE_QUERY_EVENTS`) — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `mongodb` receiver (`configs/mongodb.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `mongodb` 接收器（`configs/mongodb.yaml`），收集 MongoDB 的引擎指标（连接、操作及其延迟、活动读写、缓存操作、内存、数据/存储/索引大小、游标、会话和缺页，以及可选的查询样本和热门查询（`DATABASE_QUERY_EVENTS`））。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  'Explain plans on top queries additionally need `{ role: "read", db: "<database>" }` for each monitored database.':
    '热门查询的执行计划还需要为每个受监控的数据库授予 `{ role: "read", db: "<database>" }`。',
  "**otel-collector-config.yaml** — `configs/mongodb.yaml`, the MongoDB config":
    "**otel-collector-config.yaml** — `configs/mongodb.yaml`，MongoDB 的配置",
  "The `monitor` privileges read node, cluster and index statistics and no documents. On a cluster without security, leave `DATABASE_USERNAME` and `DATABASE_PASSWORD` empty.":
    "`monitor` 权限读取节点、集群和索引的统计信息，不读取任何文档。在没有安全功能的集群上，请将 `DATABASE_USERNAME` 和 `DATABASE_PASSWORD` 留空。",
  "The OneUptime Database Agent collects Elasticsearch engine metrics — cluster health, nodes, shards and pending tasks, documents, indexing and search operations, thread pools, caches, disk, and JVM heap and garbage collection — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `elasticsearch` receiver (`configs/elasticsearch.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `elasticsearch` 接收器（`configs/elasticsearch.yaml`），收集 Elasticsearch 的引擎指标（集群健康状况、节点、分片和待处理任务、文档、索引和搜索操作、线程池、缓存、磁盘，以及 JVM 堆和垃圾回收）。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  "**otel-collector-config.yaml** — `configs/elasticsearch.yaml`, the Elasticsearch / OpenSearch config":
    "**otel-collector-config.yaml** — `configs/elasticsearch.yaml`，Elasticsearch / OpenSearch 的配置",
  "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent. It has no AI diagnostics for Elasticsearch yet, so it runs nothing — remove its service if you do not want it running.":
    "Compose 文件还会运行 OneUptime AI 代理 `oneuptime-database-ai-agent`。它目前还没有针对 Elasticsearch 的 AI 诊断，因此什么也不运行——如果您不希望它运行，请删除它的服务。",
  "- TLS errors: the `http://` or `https://` of `DATABASE_ENDPOINT` decides whether the agent uses TLS. Set `DATABASE_TLS_INSECURE_SKIP_VERIFY=true` for a certificate the collector image does not trust.":
    "- TLS 错误：`DATABASE_ENDPOINT` 中的 `http://` 或 `https://` 决定代理是否使用 TLS。对于收集器镜像不信任的证书，请设置 `DATABASE_TLS_INSECURE_SKIP_VERIFY=true`。",
  "On OpenSearch with the security plugin, give the monitoring user the cluster permission `cluster_monitor` and the index permission `indices_monitor` on `*`. On a cluster without security, leave `DATABASE_USERNAME` and `DATABASE_PASSWORD` empty.":
    "在带安全插件的 OpenSearch 上，请为监控用户授予集群权限 `cluster_monitor` 以及对 `*` 的索引权限 `indices_monitor`。在没有安全功能的集群上，请将 `DATABASE_USERNAME` 和 `DATABASE_PASSWORD` 留空。",
  "The OneUptime Database Agent collects OpenSearch engine metrics — cluster health, nodes, shards and pending tasks, documents, indexing and search operations, thread pools, caches, disk, and JVM heap and garbage collection — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `elasticsearch` receiver (`configs/elasticsearch.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用标准的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）运行收集器原生的 `elasticsearch` 接收器（`configs/elasticsearch.yaml`），收集 OpenSearch 的引擎指标（集群健康状况、节点、分片和待处理任务、文档、索引和搜索操作、线程池、缓存、磁盘，以及 JVM 堆和垃圾回收）。数据库服务器上不会安装任何东西。**一个代理监控一台数据库服务器**；如需监控第二台服务器，请在第二个目录中运行第二个副本。",
  "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent. It has no AI diagnostics for OpenSearch yet, so it runs nothing — remove its service if you do not want it running.":
    "Compose 文件还会运行 OneUptime AI 代理 `oneuptime-database-ai-agent`。它目前还没有针对 OpenSearch 的 AI 诊断，因此什么也不运行——如果您不希望它运行，请删除它的服务。",
};

export default TRANSLATION;
