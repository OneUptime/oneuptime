import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Database setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/Database/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the database's port — nothing is installed on the database server":
    "附 Docker Compose v2 外掛程式的 Docker Engine 20.10+，執行在能連到資料庫連接埠的機器上——資料庫伺服器上不會安裝任何東西",
  "A database login that may create users and grant privileges, for the monitoring user in step 2":
    "一個可以建立使用者與授與權限的資料庫登入，用於步驟 2 的監控使用者",
  "The host name your applications use to reach the database — it becomes the database's identity in OneUptime":
    "您的應用程式連到資料庫時所使用的主機名稱——它會成為資料庫在 OneUptime 中的身分",
  "`pg_monitor` (PostgreSQL 10 and later) reads the statistics views and grants no access to your tables. Without it `pg_stat_activity` does not fail — it returns only the agent's own session, so connection counts read `1`. The receiver connects to every database to read per-database statistics, so the user also needs `CONNECT` on each one (`PUBLIC` has it by default). The PostgreSQL receiver refuses to start without a password. On a managed service where `pg_monitor` is unavailable, `pg_read_all_stats` covers the same views.":
    "`pg_monitor`（PostgreSQL 10 及更新版本）會讀取統計檢視，且不授與您資料表的存取權。沒有它時 `pg_stat_activity` 不會失敗——它只會傳回代理程式自己的工作階段，因此連線數會顯示為 `1`。接收器會連線到每個資料庫以讀取各資料庫的統計資料，因此該使用者也需要每個資料庫上的 `CONNECT`（`PUBLIC` 預設擁有）。PostgreSQL 接收器沒有密碼就不會啟動。在無法使用 `pg_monitor` 的受控服務上，`pg_read_all_stats` 涵蓋相同的檢視。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for your OneUptime URL, the ingestion key from step 1, the endpoint to connect to and the monitoring credentials (the password is read without echo), then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行會將指令碼下載為 `install.sh`，讓您在執行前先閱讀它。指令碼會詢問您的 OneUptime URL、步驟 1 的擷取金鑰、要連線的端點與監控認證資訊（密碼以不回顯的方式讀取），然後安裝到 `/opt/oneuptime-database-agent`，寫入權限為 `0600` 的 `.env` 檔案並啟動代理程式。當端點只在這台機器上有意義時（`localhost`、`host.docker.internal`），它也會詢問您的應用程式所使用的主機名稱：這個名稱就是資料庫在 OneUptime 中的身分。",
  "Download `docker-compose.yml` and `configs/postgresql.yaml` (saved as `otel-collector-config.yaml`) from this OneUptime into one folder:":
    "從此 OneUptime 將 `docker-compose.yml` 與 `configs/postgresql.yaml`（另存為 `otel-collector-config.yaml`）下載到同一個資料夾：",
  "Create a `.env` file next to them (`chmod 600 .env` — it holds a password):":
    "在它們旁邊建立一個 `.env` 檔案（`chmod 600 .env`——其中包含密碼）：",
  "Start the agent:": "啟動代理程式：",
  "`DATABASE_ENDPOINT` is where the agent connects (`host.docker.internal:<port>` when it runs on the database machine). `DATABASE_SERVER_ADDRESS` is the database's identity: the host name your **applications** use to reach it, never `localhost`. Keep it stable — changing it registers a second database.":
    "`DATABASE_ENDPOINT` 是代理程式連線的位址（代理程式在資料庫機器上執行時為 `host.docker.internal:<port>`）。`DATABASE_SERVER_ADDRESS` 是資料庫的身分：也就是您的**應用程式**連到它時所使用的主機名稱，絕不能是 `localhost`。請保持穩定——變更它會註冊第二個資料庫。",
  "In a hand-written `.env`, single-quote the password and write every `$` in it as `$$`: the collector expands `$$` and `${...}` inside it once more. The first line says so, in the words of the `.env` the install script writes — and the script, re-run on this folder, reads the file the same way.":
    "在手寫的 `.env` 中，請以單引號括住密碼，並將其中的每個 `$` 寫成 `$$`：收集器會再展開一次其中的 `$$` 與 `${...}`。第一行以安裝指令碼所寫 `.env` 中的原話說明了這一點——在此資料夾中重新執行的指令碼也會以相同方式讀取該檔案。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中選擇一個擷取金鑰，以填入 `<YOUR_API_KEY>`。",
  "After the first collection (about one `DATABASE_COLLECTION_INTERVAL`, 30 seconds by default) the database appears under **Databases** — or, when OneUptime already shows it from traces or containers at the same address, its **Engine metrics** status turns to Connected and its Overview charts the engine.":
    "第一次收集後（大約一個 `DATABASE_COLLECTION_INTERVAL`，預設 30 秒），資料庫會出現在**資料庫**下——或者，如果 OneUptime 已經根據相同位址的追蹤或容器顯示了它，它的**引擎指標**狀態會變為已連線，其概覽中會顯示引擎的圖表。",
  "If nothing arrives, run the diagnostic script where the agent runs. It checks the container, the identity in `.env`, the connection to the database, the collector's log and the ingestion key, and names the most likely problem:":
    "如果沒有任何資料送達，請在代理程式執行的地方執行診斷指令碼。它會檢查容器、`.env` 中的身分、與資料庫的連線、收集器的日誌與擷取金鑰，並指出最可能的問題：",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: with the install script or Docker Compose, the OneUptime AI agent runs beside the collector and lets OneUptime AI read this database's diagnostics while it investigates an incident or alert, and it changes nothing unless you allow fixes — see **The files the agent runs** under Advanced.":
    "**OneUptime AI 代理程式（預設開啟，唯讀）** AI 調查已開啟：使用安裝指令碼或 Docker Compose 時，OneUptime AI 代理程式會在收集器旁邊執行，讓 OneUptime AI 在調查事件或警示時讀取此資料庫的診斷資訊，除非您允許修正，否則它不會變更任何內容——請參閱進階下的**代理程式執行的檔案**。",
  "The OneUptime Database Agent collects PostgreSQL engine metrics — connections against `max_connections`, commits and rollbacks, cache hit ratio, row throughput, locks and deadlocks, temporary files, database, table and index sizes, checkpoints and the background writer, vacuums and replication lag, plus optional query samples and top queries (`DATABASE_QUERY_EVENTS`) — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `postgresql` receiver (`configs/postgresql.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `postgresql` 接收器（`configs/postgresql.yaml`），收集 PostgreSQL 的引擎指標（相對於 `max_connections` 的連線數、提交與復原、快取命中率、資料列輸送量、鎖定與死結、暫存檔、資料庫/資料表/索引大小、檢查點與背景寫入程序、VACUUM 與複寫延遲，以及選用的查詢樣本與熱門查詢（`DATABASE_QUERY_EVENTS`））。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  "With `DATABASE_QUERY_EVENTS=true` the agent also ships query samples and top queries as logs: they arrive on the database's **Logs** tab with the query text as their message. They contain query text, so they are off by default — the install script asks whether to ship them.":
    "設定 `DATABASE_QUERY_EVENTS=true` 後，代理程式也會將查詢樣本與熱門查詢以日誌傳送：它們會以查詢文字作為訊息送達資料庫的**日誌**分頁。由於其中包含查詢文字，預設為關閉——安裝指令碼會詢問是否傳送。",
  "To turn them on later, set `DATABASE_QUERY_EVENTS=true` in the agent's `.env` and recreate the container with `docker compose up -d --force-recreate` in its folder.":
    "若要稍後開啟，請在代理程式的 `.env` 中設定 `DATABASE_QUERY_EVENTS=true`，並在其資料夾中以 `docker compose up -d --force-recreate` 重新建立容器。",
  "Top queries (`DATABASE_QUERY_EVENTS=true`) also need the `pg_stat_statements` extension, loaded through `shared_preload_libraries = 'pg_stat_statements'` (a restart) and created in every monitored database:":
    "熱門查詢（`DATABASE_QUERY_EVENTS=true`）還需要 `pg_stat_statements` 擴充功能，透過 `shared_preload_libraries = 'pg_stat_statements'` 載入（需要重新啟動），並在每個受監控的資料庫中建立：",
  "Their explain plans additionally need `SELECT` on the tables the queries touch, which `pg_monitor` does not grant (for example `GRANT SELECT ON ALL TABLES IN SCHEMA app TO oneuptime_monitor`). Without it top queries still arrive, with empty plans, and the collector logs `failed to explain` for each one.":
    "它們的執行計畫還需要對查詢所涉及的資料表擁有 `SELECT`，而 `pg_monitor` 不授與此權限（例如 `GRANT SELECT ON ALL TABLES IN SCHEMA app TO oneuptime_monitor`）。沒有它時熱門查詢仍會送達，只是計畫為空，且收集器會為每個查詢記錄 `failed to explain`。",
  "| Variable | Required | Description |": "| 變數 | 必要 | 說明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime URL |":
    "| `ONEUPTIME_URL` | 是 | 您的 OneUptime URL |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | The telemetry ingestion key selected above |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 上方選取的遙測擷取金鑰 |",
  "| `DATABASE_SYSTEM` | Yes | The engine, stamped as `db.system.name`: `postgresql`, `mysql`, `mariadb`, `redis`, `valkey`, `keydb`, `dragonfly`, `mongodb`, `microsoft.sql_server`, `oracle.db`, `elasticsearch`, `opensearch` or `memcached` |":
    "| `DATABASE_SYSTEM` | 是 | 引擎，記錄為 `db.system.name`：`postgresql`、`mysql`、`mariadb`、`redis`、`valkey`、`keydb`、`dragonfly`、`mongodb`、`microsoft.sql_server`、`oracle.db`、`elasticsearch`、`opensearch` 或 `memcached` |",
  "| `DATABASE_ENDPOINT` | Yes | `host:port` the agent connects to (a `http://` or `https://` URL for Elasticsearch / OpenSearch) |":
    "| `DATABASE_ENDPOINT` | 是 | 代理程式連線的 `host:port`（Elasticsearch / OpenSearch 為 `http://` 或 `https://` URL） |",
  "| `DATABASE_ENDPOINT_HOST` | SQL Server | `DATABASE_ENDPOINT`'s host (install.sh writes it) |":
    "| `DATABASE_ENDPOINT_HOST` | SQL Server | `DATABASE_ENDPOINT` 的主機（由 install.sh 寫入） |",
  "| `DATABASE_ENDPOINT_PORT` | SQL Server | `DATABASE_ENDPOINT`'s port (install.sh writes it) |":
    "| `DATABASE_ENDPOINT_PORT` | SQL Server | `DATABASE_ENDPOINT` 的連接埠（由 install.sh 寫入） |",
  "| `DATABASE_ORACLE_SERVICE` | Oracle | The service to connect to, e.g. `FREEPDB1` |":
    "| `DATABASE_ORACLE_SERVICE` | Oracle | 要連線的服務，例如 `FREEPDB1` |",
  "| `DATABASE_SERVER_ADDRESS` | Yes | The host name your applications use — the database's identity |":
    "| `DATABASE_SERVER_ADDRESS` | 是 | 您的應用程式所使用的主機名稱——資料庫的身分 |",
  "| `DATABASE_SERVER_PORT` | Yes | The port your applications use |":
    "| `DATABASE_SERVER_PORT` | 是 | 您的應用程式所使用的連接埠 |",
  "| `DATABASE_USERNAME` | PostgreSQL, MySQL, SQL Server, Oracle | The monitoring user |":
    "| `DATABASE_USERNAME` | PostgreSQL、MySQL、SQL Server、Oracle | 監控使用者 |",
  "| `DATABASE_PASSWORD` | PostgreSQL, SQL Server, Oracle | Its password (single-quoted in `.env`, every `$` written as `$$`) |":
    "| `DATABASE_PASSWORD` | PostgreSQL、SQL Server、Oracle | 其密碼（在 `.env` 中以單引號括住，每個 `$` 寫成 `$$`） |",
  "| `DATABASE_TLS_INSECURE` | No | `true` (default) connects without TLS, `false` turns TLS on |":
    "| `DATABASE_TLS_INSECURE` | 否 | `true`（預設）不使用 TLS 連線，`false` 開啟 TLS |",
  "| `DATABASE_TLS_INSECURE_SKIP_VERIFY` | No | `true` accepts a certificate the collector image does not trust |":
    "| `DATABASE_TLS_INSECURE_SKIP_VERIFY` | 否 | `true` 接受收集器映像檔不信任的憑證 |",
  "| `DATABASE_TLS_SSLMODE` | No | PostgreSQL: the two settings above as libpq's `sslmode`, for the config's own SQL checks - `disable` while `DATABASE_TLS_INSECURE` is `true`, `require` when `DATABASE_TLS_INSECURE_SKIP_VERIFY` is `true`, `verify-full` otherwise (install.sh writes it) |":
    "| `DATABASE_TLS_SSLMODE` | 否 | PostgreSQL：上述兩項設定以 libpq 的 `sslmode` 形式表示，供設定本身的 SQL 檢查使用 - `DATABASE_TLS_INSECURE` 為 `true` 時為 `disable`，`DATABASE_TLS_INSECURE_SKIP_VERIFY` 為 `true` 時為 `require`，否則為 `verify-full`（由 install.sh 寫入） |",
  "| `DATABASE_TLS_MYSQL` | No | MySQL and MariaDB: the same two settings as the driver's `tls`, for the config's readings of Galera - `false` while `DATABASE_TLS_INSECURE` is `true`, `skip-verify` when `DATABASE_TLS_INSECURE_SKIP_VERIFY` is `true`, `true` otherwise. `install.sh` works it out. Default `false` |":
    "| `DATABASE_TLS_MYSQL` | 否 | MySQL 與 MariaDB：同樣兩項設定以驅動程式的 `tls` 形式表示，供設定讀取 Galera 使用 - `DATABASE_TLS_INSECURE` 為 `true` 時為 `false`，`DATABASE_TLS_INSECURE_SKIP_VERIFY` 為 `true` 時為 `skip-verify`，否則為 `true`。由 `install.sh` 推算。預設 `false` |",
  "| `DATABASE_COLLECTION_INTERVAL` | No | How often statistics are read. Default `30s` |":
    "| `DATABASE_COLLECTION_INTERVAL` | 否 | 讀取統計資料的頻率。預設 `30s` |",
  "| `DATABASE_QUERY_EVENTS` | No | `true` ships query samples and top queries as logs (they contain query text) |":
    "| `DATABASE_QUERY_EVENTS` | 否 | `true` 將查詢樣本與熱門查詢以日誌傳送（其中包含查詢文字） |",
  "| `DATABASE_SERVER_ID` | No | The id of a database OneUptime already shows; the data then joins it directly |":
    "| `DATABASE_SERVER_ID` | 否 | OneUptime 已顯示的某個資料庫的 ID；資料隨後會直接關聯到它 |",
  "The install script downloads both into `/opt/oneuptime-database-agent`; the Docker Compose steps use the same files.":
    "安裝指令碼會將兩者下載到 `/opt/oneuptime-database-agent`；Docker Compose 步驟使用相同的檔案。",
  "**docker-compose.yml**": "**docker-compose.yml** 檔案",
  "**otel-collector-config.yaml** — `configs/postgresql.yaml`, the PostgreSQL config":
    "**otel-collector-config.yaml** — `configs/postgresql.yaml`，PostgreSQL 的設定",
  "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent: it lets OneUptime AI read the database's diagnostics while it investigates an incident or alert — read-only unless you allow fixes — and shows on the database's **AI → AI agent** page. Remove its service if you do not use OneUptime AI.":
    "Compose 檔案也會執行 OneUptime AI 代理程式 `oneuptime-database-ai-agent`：它讓 OneUptime AI 在調查事件或警示時讀取資料庫的診斷資訊——除非您允許修正，否則為唯讀——並顯示在資料庫的 **人工智慧 → AI 代理程式** 頁面上。如果您不使用 OneUptime AI，請移除它的服務。",
  "**Upgrade** by running the current install script again. It reuses your `.env`, replaces `docker-compose.yml` and `otel-collector-config.yaml` with the current versions and recreates the container; a file you edited is kept next to the new one as `<file>.bak.<timestamp>`.":
    "**升級**的方法是再次執行目前的安裝指令碼。它會沿用您的 `.env`，以目前版本取代 `docker-compose.yml` 與 `otel-collector-config.yaml`，並重新建立容器；您編輯過的檔案會以 `<file>.bak.<timestamp>` 保留在新檔案旁邊。",
  "After editing `.env` or `otel-collector-config.yaml` yourself, apply the change with `docker compose up -d --force-recreate` in the agent's folder: the collector reads its config only when it starts, and a plain `docker compose up -d` keeps the running container when only the config file changed.":
    "自行編輯 `.env` 或 `otel-collector-config.yaml` 後，請在代理程式的資料夾中以 `docker compose up -d --force-recreate` 套用變更：收集器只在啟動時讀取設定，而只有設定檔變更時，一般的 `docker compose up -d` 會保留正在執行的容器。",
  "**Monitor a second database server** with a second agent in a directory of its own — one agent monitors one server:":
    "**監控第二台資料庫伺服器**時，請在獨立的目錄中使用第二個代理程式——一個代理程式監控一台伺服器：",
  "**Uninstall** the agent:": "**解除安裝**代理程式：",
  "Then drop the monitoring user.": "然後刪除監控使用者。",
  "For a probe-based check that needs no agent at all — connections, locks, cache and replication health, with alerting — [create a Database Health monitor](/dashboard/1/monitors/create?monitorType=Database) (PostgreSQL, MySQL and SQL Server). It uses the same monitoring user. Its alerts and incidents also appear on the database whose endpoints include the host and port it connects to.":
    "若需要完全不用代理程式、以探測為基礎的檢查——連線、鎖定、快取與複寫的健康狀況，並具備警示——請[建立資料庫健康監測器](/dashboard/1/monitors/create?monitorType=Database)（PostgreSQL、MySQL 與 SQL Server）。它使用相同的監控使用者。它的警示與事件也會顯示在端點包含其所連線主機與連接埠的資料庫上。",
  "- `DATABASE_SERVER_ADDRESS` is `localhost`, `127.0.0.1` or `host.docker.internal`: OneUptime ignores addresses that only mean something on one machine. Use the host name your applications use.":
    "- `DATABASE_SERVER_ADDRESS` 為 `localhost`、`127.0.0.1` 或 `host.docker.internal`：OneUptime 會忽略只在一台機器上有意義的位址。請使用您的應用程式所使用的主機名稱。",
  "- It is a private IP, a single-label name or a cluster-local name (`*.svc.cluster.local`): such names never create a database on their own. Create the database under **Databases → Create Database** with that address and port, or install the agent from the database's own **Documentation** tab, which sets `DATABASE_SERVER_ID`.":
    "- 它是私人 IP、單一標籤名稱或叢集本機名稱（`*.svc.cluster.local`）：這類名稱本身永遠不會建立資料庫。請在 **資料庫 → 建立資料庫** 下以該位址與連接埠建立資料庫，或從資料庫自己的**文件**分頁安裝代理程式，該分頁會設定 `DATABASE_SERVER_ID`。",
  "- The ingestion key is wrong — the diagnostic script from step 4 checks it.":
    "- 擷取金鑰錯誤——步驟 4 的診斷指令碼會檢查它。",
  "Inside the agent's container, `localhost` is the container itself. Use `host.docker.internal:<port>` (the compose file maps it to the machine on Linux too) with the database listening on the Docker bridge address as well — or uncomment `network_mode: host` in `docker-compose.yml` and use `localhost:<port>`. For a remote server, check DNS, firewalls and the server's own allow-list (`pg_hba.conf`).":
    "在代理程式的容器內，`localhost` 指的是容器本身。請使用 `host.docker.internal:<port>`（Compose 檔案在 Linux 上也會將它對應到這台機器），並讓資料庫同時接聽 Docker 橋接位址——或取消 `docker-compose.yml` 中 `network_mode: host` 的註解並使用 `localhost:<port>`。若是遠端伺服器，請檢查 DNS、防火牆與伺服器自己的允許清單（`pg_hba.conf`）。",
  "The collector's log (`docker compose logs --tail 100` in the agent's folder) names the problem:":
    "收集器的日誌（在代理程式的資料夾中執行 `docker compose logs --tail 100`）會指出問題：",
  "- `password authentication failed`: the database rejected the login. Check `DATABASE_USERNAME` and `DATABASE_PASSWORD` — the collector expands `$` inside them once more, so every `$` must be written as `$$` in `.env` or a Kubernetes Secret (the install script does this).":
    "- `password authentication failed`：資料庫拒絕了登入。請檢查 `DATABASE_USERNAME` 與 `DATABASE_PASSWORD`——收集器會再展開一次其中的 `$`，因此在 `.env` 或 Kubernetes Secret 中每個 `$` 都必須寫成 `$$`（安裝指令碼會這麼做）。",
  "- `permission denied`, `must be superuser`, or connection counts that always read `1`: the monitoring user is missing the grants from step 2.":
    "- `permission denied`、`must be superuser`，或連線數始終顯示為 `1`：監控使用者缺少步驟 2 的權限。",
  "- `pg_stat_statements` errors: top queries are on without the extension — create it (see Query samples and top queries), or set `DATABASE_QUERY_EVENTS=false`.":
    "- `pg_stat_statements` 錯誤：熱門查詢已開啟，但沒有該擴充功能——請建立它（參閱查詢樣本與熱門查詢），或設定 `DATABASE_QUERY_EVENTS=false`。",
  "- `failed to explain` is not a missing grant: explain plans of top queries need `SELECT` on your tables, which `pg_monitor` deliberately does not give. Metrics and top queries are unaffected; only the plans stay empty.":
    "- `failed to explain` 並不是缺少權限：熱門查詢的執行計畫需要對您的資料表擁有 `SELECT`，而 `pg_monitor` 刻意不授與此權限。指標與熱門查詢不受影響；只有計畫為空。",
  "- TLS errors (`SSL is not enabled on the server`): match `DATABASE_TLS_INSECURE` to the server — `true` when it does not speak TLS, `false` when it requires it, plus `DATABASE_TLS_INSECURE_SKIP_VERIFY=true` for a certificate the collector image does not trust.":
    "- TLS 錯誤（`SSL is not enabled on the server`）：讓 `DATABASE_TLS_INSECURE` 與伺服器一致——伺服器不使用 TLS 時為 `true`，要求 TLS 時為 `false`，對於收集器映像檔不信任的憑證，還要加上 `DATABASE_TLS_INSECURE_SKIP_VERIFY=true`。",
  "After changing `.env`, apply it with `docker compose up -d --force-recreate`.":
    "變更 `.env` 後，請以 `docker compose up -d --force-recreate` 套用。",
  "The collector cannot deliver to `ONEUPTIME_URL`. `HTTP Status Code 401` or `422` in that line means OneUptime refused the ingestion key: it is unknown, revoked, disabled or expired — or a Browser key, which ingest only accepts from a browser. Pick a server key in step 1. Otherwise check the URL, outbound HTTPS from the agent's machine and, for a self-hosted OneUptime, its certificate.":
    "收集器無法將資料傳送到 `ONEUPTIME_URL`。該行中出現 `HTTP Status Code 401` 或 `422` 表示 OneUptime 拒絕了擷取金鑰：它是未知、已撤銷、已停用或已過期的金鑰——或是只接受來自瀏覽器的瀏覽器金鑰。請在步驟 1 選擇伺服器金鑰。否則，請檢查 URL、代理程式所在機器的輸出 HTTPS，以及自行託管之 OneUptime 的憑證。",
  "A restart loop is almost always a configuration error, which the collector names on its first log lines:":
    "重新啟動迴圈幾乎總是設定錯誤，收集器會在最初幾行日誌中指出：",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for the endpoint to connect to and the monitoring credentials (the password is read without echo), then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行會將指令碼下載為 `install.sh`，讓您在執行前先閱讀它。指令碼會詢問要連線的端點與監控認證資訊（密碼以不回顯的方式讀取），然後安裝到 `/opt/oneuptime-database-agent`，寫入權限為 `0600` 的 `.env` 檔案並啟動代理程式。當端點只在這台機器上有意義時（`localhost`、`host.docker.internal`），它也會詢問您的應用程式所使用的主機名稱：這個名稱就是資料庫在 OneUptime 中的身分。",
  "`PROCESS` and `REPLICATION CLIENT` cover the global status counters, InnoDB status and replica status; `performance_schema` is read for query samples and top queries.":
    "`PROCESS` 與 `REPLICATION CLIENT` 涵蓋全域狀態計數器、InnoDB 狀態與複本狀態；`performance_schema` 用於讀取查詢樣本與熱門查詢。",
  "The OneUptime Database Agent collects MySQL engine metrics — threads and connections, connection errors, queries and slow queries, commands, the InnoDB buffer pool, row and table locks, row operations and handlers, temporary tables and sorts, and replica lag, plus optional query samples and top queries (`DATABASE_QUERY_EVENTS`) — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `mysql` receiver (`configs/mysql.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `mysql` 接收器（`configs/mysql.yaml`），收集 MySQL 的引擎指標（執行緒與連線、連線錯誤、查詢與慢查詢、命令、InnoDB 緩衝集區、資料列鎖定與資料表鎖定、資料列操作與處理常式、暫存資料表與排序，以及複本延遲，以及選用的查詢樣本與熱門查詢（`DATABASE_QUERY_EVENTS`））。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  "They read `performance_schema`, which the monitoring user's grant from step 2 already covers.":
    "它們會讀取 `performance_schema`，步驟 2 授與監控使用者的權限已涵蓋這一點。",
  "**otel-collector-config.yaml** — `configs/mysql.yaml`, the MySQL / MariaDB config":
    "**otel-collector-config.yaml** — `configs/mysql.yaml`，MySQL / MariaDB 的設定",
  "- `Access denied; you need … privilege(s)`: the monitoring user is missing the grants from step 2. MySQL / MariaDB error 1227 names the privilege: `PROCESS`, or `SLAVE MONITOR` on MariaDB 10.5.9 and later.":
    "- `Access denied; you need … privilege(s)`：監控使用者缺少步驟 2 的權限。MySQL / MariaDB 錯誤 1227 會指出所需的權限：`PROCESS`，或在 MariaDB 10.5.9 及更新版本上為 `SLAVE MONITOR`。",
  "- TLS errors: match `DATABASE_TLS_INSECURE` to the server — `true` when it does not speak TLS, `false` when it requires it, plus `DATABASE_TLS_INSECURE_SKIP_VERIFY=true` for a certificate the collector image does not trust.":
    "- TLS 錯誤：讓 `DATABASE_TLS_INSECURE` 與伺服器一致——伺服器不使用 TLS 時為 `true`，要求 TLS 時為 `false`，對於收集器映像檔不信任的憑證，還要加上 `DATABASE_TLS_INSECURE_SKIP_VERIFY=true`。",
  "`PROCESS` and `REPLICATION CLIENT` cover the global status counters, InnoDB status and replica status; `performance_schema` is read for query samples and top queries. MariaDB 10.5.9 and later split replica status into its own privilege, so also run `GRANT SLAVE MONITOR ON *.* TO 'oneuptime_monitor'@'%';` there.":
    "`PROCESS` 與 `REPLICATION CLIENT` 涵蓋全域狀態計數器、InnoDB 狀態與複本狀態；`performance_schema` 用於讀取查詢樣本與熱門查詢。MariaDB 10.5.9 及更新版本將複本狀態拆分為獨立的權限，因此在這些版本上還要執行 `GRANT SLAVE MONITOR ON *.* TO 'oneuptime_monitor'@'%';`。",
  "The OneUptime Database Agent collects MariaDB engine metrics — threads and connections, connection errors, queries and slow queries, commands, the InnoDB buffer pool, row and table locks, row operations and handlers, temporary tables and sorts, and replica lag, plus optional query samples and top queries (`DATABASE_QUERY_EVENTS`) — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `mysql` receiver (`configs/mysql.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `mysql` 接收器（`configs/mysql.yaml`），收集 MariaDB 的引擎指標（執行緒與連線、連線錯誤、查詢與慢查詢、命令、InnoDB 緩衝集區、資料列鎖定與資料表鎖定、資料列操作與處理常式、暫存資料表與排序，以及複本延遲，以及選用的查詢樣本與熱門查詢（`DATABASE_QUERY_EVENTS`））。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  "`VIEW SERVER STATE` (on SQL Server 2022 and later `VIEW SERVER PERFORMANCE STATE` is enough) reads the dynamic management views every metric comes from, and grants no access to your data. The receiver puts the login into a connection string without quoting it, so the user name and password must not contain a semicolon (`;`) or a double quote (`\"`), nor start or end with a space — the install script refuses them. For a named instance (`host\\instance`), connect to the instance's own TCP port (`host:port`), never the default instance's 1433: SQL Server Configuration Manager shows it, or run `SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id = @@SPID;` on the instance.":
    '`VIEW SERVER STATE`（在 SQL Server 2022 及更新版本上 `VIEW SERVER PERFORMANCE STATE` 即可）會讀取每個指標所來自的動態管理檢視，且不授與您資料的存取權。接收器會將登入資訊不加引號地放入連線字串，因此使用者名稱與密碼不能包含分號（`;`）或雙引號（`"`），也不能以空格開頭或結尾——安裝指令碼會拒絕它們。若是具名執行個體（`host\\instance`），請連線到該執行個體自己的 TCP 連接埠（`host:port`），而不是預設執行個體的 1433：SQL Server 組態管理員會顯示此連接埠，或在執行個體上執行 `SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id = @@SPID;`。',
  "The OneUptime Database Agent collects SQL Server engine metrics — user connections, batch requests and compilations, buffer cache hit ratio, page life expectancy, lock waits, deadlocks and blocked processes, pending memory grants, CPU, database I/O and latency, and availability-group replica lag, plus optional query samples and top queries (`DATABASE_QUERY_EVENTS`) — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `sqlserver` receiver (`configs/sqlserver.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `sqlserver` 接收器（`configs/sqlserver.yaml`），收集 SQL Server 的引擎指標（使用者連線、批次要求與編譯、緩衝區快取命中率、頁面預期存留時間、鎖定等候、死結與遭封鎖的處理程序、擱置中的記憶體授與、CPU、資料庫 I/O 與延遲，以及可用性群組的複本延遲，以及選用的查詢樣本與熱門查詢（`DATABASE_QUERY_EVENTS`））。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  "They read the dynamic management views, which `VIEW SERVER STATE` from step 2 already covers.":
    "它們會讀取動態管理檢視，步驟 2 的 `VIEW SERVER STATE` 已涵蓋這一點。",
  "**otel-collector-config.yaml** — `configs/sqlserver.yaml`, the SQL Server config":
    "**otel-collector-config.yaml** — `configs/sqlserver.yaml`，SQL Server 的設定",
  "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent. It has no AI diagnostics for SQL Server yet, so it runs nothing — remove its service if you do not want it running.":
    "Compose 檔案也會執行 OneUptime AI 代理程式 `oneuptime-database-ai-agent`。它目前還沒有針對 SQL Server 的 AI 診斷，因此不會執行任何內容——如果您不希望它執行，請移除它的服務。",
  "Inside the agent's container, `localhost` is the container itself. Use `host.docker.internal:<port>` (the compose file maps it to the machine on Linux too) with the database listening on the Docker bridge address as well — or uncomment `network_mode: host` in `docker-compose.yml` and use `localhost:<port>`. For a remote server, check DNS, firewalls and the server's own allow-list.":
    "在代理程式的容器內，`localhost` 指的是容器本身。請使用 `host.docker.internal:<port>`（Compose 檔案在 Linux 上也會將它對應到這台機器），並讓資料庫同時接聽 Docker 橋接位址——或取消 `docker-compose.yml` 中 `network_mode: host` 的註解並使用 `localhost:<port>`。若是遠端伺服器，請檢查 DNS、防火牆與伺服器自己的允許清單。",
  "- `Login failed for user`: the database rejected the login. Check `DATABASE_USERNAME` and `DATABASE_PASSWORD` — the collector expands `$` inside them once more, so every `$` must be written as `$$` in `.env` or a Kubernetes Secret (the install script does this). A login containing `;` or `\"`, or with spaces around it, always fails: the receiver's connection string cannot carry them.":
    '- `Login failed for user`：資料庫拒絕了登入。請檢查 `DATABASE_USERNAME` 與 `DATABASE_PASSWORD`——收集器會再展開一次其中的 `$`，因此在 `.env` 或 Kubernetes Secret 中每個 `$` 都必須寫成 `$$`（安裝指令碼會這麼做）。包含 `;` 或 `"`、或前後有空格的登入資訊一定會失敗：接收器的連線字串無法承載它們。',
  "- `VIEW SERVER STATE`: the monitoring user is missing the grants from step 2.":
    "- `VIEW SERVER STATE`：監控使用者缺少步驟 2 的權限。",
  "`SELECT_CATALOG_ROLE` reads the `V$` and `DBA_` views the metrics, query samples and top queries come from, and grants no access to your tables. `DATABASE_ORACLE_SERVICE` is the service the agent connects to (`FREEPDB1`, `ORCLPDB1`, …).":
    "`SELECT_CATALOG_ROLE` 會讀取指標、查詢樣本與熱門查詢所來自的 `V$` 與 `DBA_` 檢視，且不授與您資料表的存取權。`DATABASE_ORACLE_SERVICE` 是代理程式連線的服務（`FREEPDB1`、`ORCLPDB1`、…）。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for your OneUptime URL, the ingestion key from step 1, the endpoint to connect to, the Oracle service name and the monitoring credentials (the password is read without echo), then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行會將指令碼下載為 `install.sh`，讓您在執行前先閱讀它。指令碼會詢問您的 OneUptime URL、步驟 1 的擷取金鑰、要連線的端點、Oracle 服務名稱與監控認證資訊（密碼以不回顯的方式讀取），然後安裝到 `/opt/oneuptime-database-agent`，寫入權限為 `0600` 的 `.env` 檔案並啟動代理程式。當端點只在這台機器上有意義時（`localhost`、`host.docker.internal`），它也會詢問您的應用程式所使用的主機名稱：這個名稱就是資料庫在 OneUptime 中的身分。",
  "The OneUptime Database Agent collects Oracle engine metrics — sessions, executions, commits and rollbacks, parses, logical and physical reads, CPU and DB time, PGA and SGA memory and tablespace usage, plus optional query samples and top queries (`DATABASE_QUERY_EVENTS`) — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `oracledb` receiver (`configs/oracledb.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `oracledb` 接收器（`configs/oracledb.yaml`），收集 Oracle 的引擎指標（工作階段、執行、提交與復原、剖析、邏輯讀取與實體讀取、CPU 時間與資料庫時間、PGA 與 SGA 記憶體，以及資料表空間使用量，以及選用的查詢樣本與熱門查詢（`DATABASE_QUERY_EVENTS`））。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  "They read the `V$` views, which `SELECT_CATALOG_ROLE` from step 2 already covers.":
    "它們會讀取 `V$` 檢視，步驟 2 的 `SELECT_CATALOG_ROLE` 已涵蓋這一點。",
  "**otel-collector-config.yaml** — `configs/oracledb.yaml`, the Oracle config":
    "**otel-collector-config.yaml** — `configs/oracledb.yaml`，Oracle 的設定",
  "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent. It has no AI diagnostics for Oracle yet, so it runs nothing — remove its service if you do not want it running.":
    "Compose 檔案也會執行 OneUptime AI 代理程式 `oneuptime-database-ai-agent`。它目前還沒有針對 Oracle 的 AI 診斷，因此不會執行任何內容——如果您不希望它執行，請移除它的服務。",
  "- `ORA-00942`, `ORA-01031`: the monitoring user is missing the grants from step 2.":
    "- `ORA-00942`、`ORA-01031`：監控使用者缺少步驟 2 的權限。",
  "- `ORA-12514` or `ORA-12505`: the listener answers but does not know the service `DATABASE_ORACLE_SERVICE` names — `lsnrctl services` on the database host lists the ones it does.":
    "- `ORA-12514` 或 `ORA-12505`：接聽程式有回應，但不認得 `DATABASE_ORACLE_SERVICE` 所指的服務——在資料庫主機上執行 `lsnrctl services` 可列出它認得的服務。",
  "- `ORA-28000` or `ORA-28001`: the monitoring user is locked or its password expired.":
    "- `ORA-28000` 或 `ORA-28001`：監控使用者已遭鎖定或其密碼已過期。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for the endpoint to connect to, the Oracle service name and the monitoring credentials (the password is read without echo), then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行會將指令碼下載為 `install.sh`，讓您在執行前先閱讀它。指令碼會詢問要連線的端點、Oracle 服務名稱與監控認證資訊（密碼以不回顯的方式讀取），然後安裝到 `/opt/oneuptime-database-agent`，寫入權限為 `0600` 的 `.env` 檔案並啟動代理程式。當端點只在這台機器上有意義時（`localhost`、`host.docker.internal`），它也會詢問您的應用程式所使用的主機名稱：這個名稱就是資料庫在 OneUptime 中的身分。",
  "The receiver only runs `INFO`. Persist the user with `ACL SAVE` (or a `user` line in `redis.conf` / your ACL file). On a server protected only by `requirepass`, leave `DATABASE_USERNAME` empty and set `DATABASE_PASSWORD`; on a server without authentication leave both empty.":
    "接收器只會執行 `INFO`。請以 `ACL SAVE`（或 `redis.conf` / 您的 ACL 檔案中的 `user` 行）永久保存該使用者。在僅由 `requirepass` 保護的伺服器上，請將 `DATABASE_USERNAME` 留空並設定 `DATABASE_PASSWORD`；在沒有驗證的伺服器上，請將兩者都留空。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for your OneUptime URL, the ingestion key from step 1, the endpoint to connect to and the monitoring credentials, if the server has users (the password is read without echo), then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行會將指令碼下載為 `install.sh`，讓您在執行前先閱讀它。指令碼會詢問您的 OneUptime URL、步驟 1 的擷取金鑰、要連線的端點，以及伺服器有使用者時的監控認證資訊（密碼以不回顯的方式讀取），然後安裝到 `/opt/oneuptime-database-agent`，寫入權限為 `0600` 的 `.env` 檔案並啟動代理程式。當端點只在這台機器上有意義時（`localhost`、`host.docker.internal`），它也會詢問您的應用程式所使用的主機名稱：這個名稱就是資料庫在 OneUptime 中的身分。",
  "The OneUptime Database Agent collects Redis engine metrics — connected and blocked clients, commands per second and their latency, keyspace hits and misses, memory against `maxmemory`, evicted and expired keys, and replication — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `redis` receiver (`configs/redis.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `redis` 接收器（`configs/redis.yaml`），收集 Redis 的引擎指標（已連線與遭封鎖的用戶端、每秒命令數及其延遲、鍵空間命中與未命中、相對於 `maxmemory` 的記憶體、被逐出與已過期的鍵，以及複寫）。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  "**otel-collector-config.yaml** — `configs/redis.yaml`, the Redis / Valkey / KeyDB / Dragonfly config":
    "**otel-collector-config.yaml** — `configs/redis.yaml`，Redis / Valkey / KeyDB / Dragonfly 的設定",
  "- `WRONGPASS`, `NOAUTH`: the database rejected the login. Check `DATABASE_USERNAME` and `DATABASE_PASSWORD` — the collector expands `$` inside them once more, so every `$` must be written as `$$` in `.env` or a Kubernetes Secret (the install script does this).":
    "- `WRONGPASS`、`NOAUTH`：資料庫拒絕了登入。請檢查 `DATABASE_USERNAME` 與 `DATABASE_PASSWORD`——收集器會再展開一次其中的 `$`，因此在 `.env` 或 Kubernetes Secret 中每個 `$` 都必須寫成 `$$`（安裝指令碼會這麼做）。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for the endpoint to connect to and the monitoring credentials, if the server has users (the password is read without echo), then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行會將指令碼下載為 `install.sh`，讓您在執行前先閱讀它。指令碼會詢問要連線的端點，以及伺服器有使用者時的監控認證資訊（密碼以不回顯的方式讀取），然後安裝到 `/opt/oneuptime-database-agent`，寫入權限為 `0600` 的 `.env` 檔案並啟動代理程式。當端點只在這台機器上有意義時（`localhost`、`host.docker.internal`），它也會詢問您的應用程式所使用的主機名稱：這個名稱就是資料庫在 OneUptime 中的身分。",
  "The receiver only runs `INFO`. Persist the user with `ACL SAVE` (or a `user` line in `redis.conf` / your ACL file). On a server protected only by `requirepass`, leave `DATABASE_USERNAME` empty and set `DATABASE_PASSWORD`; on a server without authentication leave both empty. Valkey, KeyDB and Dragonfly take the same ACL.":
    "接收器只會執行 `INFO`。請以 `ACL SAVE`（或 `redis.conf` / 您的 ACL 檔案中的 `user` 行）永久保存該使用者。在僅由 `requirepass` 保護的伺服器上，請將 `DATABASE_USERNAME` 留空並設定 `DATABASE_PASSWORD`；在沒有驗證的伺服器上，請將兩者都留空。Valkey、KeyDB 與 Dragonfly 使用相同的 ACL。",
  "The OneUptime Database Agent collects Valkey engine metrics — connected and blocked clients, commands per second and their latency, keyspace hits and misses, memory against `maxmemory`, evicted and expired keys, and replication — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `redis` receiver (`configs/redis.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `redis` 接收器（`configs/redis.yaml`），收集 Valkey 的引擎指標（已連線與遭封鎖的用戶端、每秒命令數及其延遲、鍵空間命中與未命中、相對於 `maxmemory` 的記憶體、被逐出與已過期的鍵，以及複寫）。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  "The OneUptime Database Agent collects KeyDB engine metrics — connected and blocked clients, commands per second and their latency, keyspace hits and misses, memory against `maxmemory`, evicted and expired keys, and replication — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `redis` receiver (`configs/redis.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `redis` 接收器（`configs/redis.yaml`），收集 KeyDB 的引擎指標（已連線與遭封鎖的用戶端、每秒命令數及其延遲、鍵空間命中與未命中、相對於 `maxmemory` 的記憶體、被逐出與已過期的鍵，以及複寫）。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  "The OneUptime Database Agent collects Dragonfly engine metrics — connected and blocked clients, commands per second and their latency, keyspace hits and misses, memory against `maxmemory`, evicted and expired keys, and replication — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `redis` receiver (`configs/redis.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `redis` 接收器（`configs/redis.yaml`），收集 Dragonfly 的引擎指標（已連線與遭封鎖的用戶端、每秒命令數及其延遲、鍵空間命中與未命中、相對於 `maxmemory` 的記憶體、被逐出與已過期的鍵，以及複寫）。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  "A Memcached server without SASL authentication (`-S`): Memcached has no users, and the agent runs `stats` over the text protocol without logging in":
    "未啟用 SASL 驗證（`-S`）的 Memcached 伺服器：Memcached 沒有使用者，代理程式不需登入即可透過文字通訊協定執行 `stats`",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for your OneUptime URL, the ingestion key from step 1 and the endpoint to connect to, then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行會將指令碼下載為 `install.sh`，讓您在執行前先閱讀它。指令碼會詢問您的 OneUptime URL、步驟 1 的擷取金鑰與要連線的端點，然後安裝到 `/opt/oneuptime-database-agent`，寫入權限為 `0600` 的 `.env` 檔案並啟動代理程式。當端點只在這台機器上有意義時（`localhost`、`host.docker.internal`），它也會詢問您的應用程式所使用的主機名稱：這個名稱就是資料庫在 OneUptime 中的身分。",
  "Create a `.env` file next to them (`chmod 600 .env` — it holds your ingestion key):":
    "在它們旁邊建立一個 `.env` 檔案（`chmod 600 .env`——其中包含您的擷取金鑰）：",
  "The OneUptime Database Agent collects Memcached engine metrics — connections, commands, get hits and misses (the cache hit ratio), evictions, items, memory used, network traffic, threads and CPU — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `memcached` receiver (`configs/memcached.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `memcached` 接收器（`configs/memcached.yaml`），收集 Memcached 的引擎指標（連線、命令、get 命中與未命中（快取命中率）、逐出、項目、已用記憶體、網路流量、執行緒與 CPU）。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  "**otel-collector-config.yaml** — `configs/memcached.yaml`, the Memcached config":
    "**otel-collector-config.yaml** — `configs/memcached.yaml`，Memcached 的設定",
  "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent. It has no AI diagnostics for Memcached yet, so it runs nothing — remove its service if you do not want it running.":
    "Compose 檔案也會執行 OneUptime AI 代理程式 `oneuptime-database-ai-agent`。它目前還沒有針對 Memcached 的 AI 診斷，因此不會執行任何內容——如果您不希望它執行，請移除它的服務。",
  "- The ingestion key is wrong — the diagnostic script from step 3 checks it.":
    "- 擷取金鑰錯誤——步驟 3 的診斷指令碼會檢查它。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. The script asks for the endpoint to connect to, then installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.":
    "第一行會將指令碼下載為 `install.sh`，讓您在執行前先閱讀它。指令碼會詢問要連線的端點，然後安裝到 `/opt/oneuptime-database-agent`，寫入權限為 `0600` 的 `.env` 檔案並啟動代理程式。當端點只在這台機器上有意義時（`localhost`、`host.docker.internal`），它也會詢問您的應用程式所使用的主機名稱：這個名稱就是資料庫在 OneUptime 中的身分。",
  "`clusterMonitor` covers every metric. The agent connects to exactly one member, so run one agent per replica-set member.":
    "`clusterMonitor` 涵蓋所有指標。代理程式只會連線到一個成員，因此請為複本集的每個成員執行一個代理程式。",
  "The OneUptime Database Agent collects MongoDB engine metrics — connections, operations and their latency, active reads and writes, cache operations, memory, data, storage and index sizes, cursors, sessions and page faults, plus optional query samples and top queries (`DATABASE_QUERY_EVENTS`) — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `mongodb` receiver (`configs/mongodb.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `mongodb` 接收器（`configs/mongodb.yaml`），收集 MongoDB 的引擎指標（連線、操作及其延遲、作用中的讀取與寫入、快取操作、記憶體、資料/儲存/索引大小、資料指標、工作階段與分頁錯誤，以及選用的查詢樣本與熱門查詢（`DATABASE_QUERY_EVENTS`））。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  'Explain plans on top queries additionally need `{ role: "read", db: "<database>" }` for each monitored database.':
    '熱門查詢的執行計畫還需要為每個受監控的資料庫授與 `{ role: "read", db: "<database>" }`。',
  "**otel-collector-config.yaml** — `configs/mongodb.yaml`, the MongoDB config":
    "**otel-collector-config.yaml** — `configs/mongodb.yaml`，MongoDB 的設定",
  "The `monitor` privileges read node, cluster and index statistics and no documents. On a cluster without security, leave `DATABASE_USERNAME` and `DATABASE_PASSWORD` empty.":
    "`monitor` 權限會讀取節點、叢集與索引的統計資料，不會讀取任何文件。在沒有安全性功能的叢集上，請將 `DATABASE_USERNAME` 與 `DATABASE_PASSWORD` 留空。",
  "The OneUptime Database Agent collects Elasticsearch engine metrics — cluster health, nodes, shards and pending tasks, documents, indexing and search operations, thread pools, caches, disk, and JVM heap and garbage collection — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `elasticsearch` receiver (`configs/elasticsearch.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `elasticsearch` 接收器（`configs/elasticsearch.yaml`），收集 Elasticsearch 的引擎指標（叢集健康狀況、節點、分片與擱置中的工作、文件、索引與搜尋操作、執行緒集區、快取、磁碟，以及 JVM 堆積與記憶體回收）。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  "**otel-collector-config.yaml** — `configs/elasticsearch.yaml`, the Elasticsearch / OpenSearch config":
    "**otel-collector-config.yaml** — `configs/elasticsearch.yaml`，Elasticsearch / OpenSearch 的設定",
  "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent. It has no AI diagnostics for Elasticsearch yet, so it runs nothing — remove its service if you do not want it running.":
    "Compose 檔案也會執行 OneUptime AI 代理程式 `oneuptime-database-ai-agent`。它目前還沒有針對 Elasticsearch 的 AI 診斷，因此不會執行任何內容——如果您不希望它執行，請移除它的服務。",
  "- TLS errors: the `http://` or `https://` of `DATABASE_ENDPOINT` decides whether the agent uses TLS. Set `DATABASE_TLS_INSECURE_SKIP_VERIFY=true` for a certificate the collector image does not trust.":
    "- TLS 錯誤：`DATABASE_ENDPOINT` 中的 `http://` 或 `https://` 決定代理程式是否使用 TLS。對於收集器映像檔不信任的憑證，請設定 `DATABASE_TLS_INSECURE_SKIP_VERIFY=true`。",
  "On OpenSearch with the security plugin, give the monitoring user the cluster permission `cluster_monitor` and the index permission `indices_monitor` on `*`. On a cluster without security, leave `DATABASE_USERNAME` and `DATABASE_PASSWORD` empty.":
    "在具備安全性外掛程式的 OpenSearch 上，請為監控使用者授與叢集權限 `cluster_monitor`，以及對 `*` 的索引權限 `indices_monitor`。在沒有安全性功能的叢集上，請將 `DATABASE_USERNAME` 與 `DATABASE_PASSWORD` 留空。",
  "The OneUptime Database Agent collects OpenSearch engine metrics — cluster health, nodes, shards and pending tasks, documents, indexing and search operations, thread pools, caches, disk, and JVM heap and garbage collection — with a stock OpenTelemetry Collector container (`otel/opentelemetry-collector-contrib:0.161.0`) running the collector's native `elasticsearch` receiver (`configs/elasticsearch.yaml`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.":
    "OneUptime Database Agent 使用標準的 OpenTelemetry Collector 容器（`otel/opentelemetry-collector-contrib:0.161.0`）執行收集器原生的 `elasticsearch` 接收器（`configs/elasticsearch.yaml`），收集 OpenSearch 的引擎指標（叢集健康狀況、節點、分片與擱置中的工作、文件、索引與搜尋操作、執行緒集區、快取、磁碟，以及 JVM 堆積與記憶體回收）。資料庫伺服器上不會安裝任何東西。**一個代理程式監控一台資料庫伺服器**；若要監控第二台伺服器，請在第二個目錄中執行第二個副本。",
  "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent. It has no AI diagnostics for OpenSearch yet, so it runs nothing — remove its service if you do not want it running.":
    "Compose 檔案也會執行 OneUptime AI 代理程式 `oneuptime-database-ai-agent`。它目前還沒有針對 OpenSearch 的 AI 診斷，因此不會執行任何內容——如果您不希望它執行，請移除它的服務。",
};

export default TRANSLATION;
