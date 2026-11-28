import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in Japanese (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * Japanese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Japanese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine 20.10 以降",
  "Access to `/var/run/docker.sock` on the host":
    "ホスト上の `/var/run/docker.sock` へのアクセス",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "ログを収集したいコンテナは、Docker の既定のログドライバーである `json-file` を使う必要があります",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "次に、同じ URL、キー、ホスト名で OneUptime AI エージェントを横に起動します。**AI 調査は既定でオンです**: OneUptime AI がこのホストのインシデントやアラートを調査する間、AI エージェント経由で読み取り専用の `docker` コマンドを実行し、修正を許可しない限り何も変更しません。詳しくは 詳細 の **OneUptime AI エージェント** を参照してください。AI 調査なしでコレクターを実行するには、このコマンドを省略します。",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "`my-docker-host` をこのホストの名前 (例: `prod-docker-01`) に置き換えます。OneUptime ではこの名前でホストが表示されるので、変えないでください。新しい名前は新しいホストとして登録されます。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` に入ります。",
  "Look for this line in the logs:": "ログでこの行を探します:",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "エージェントが接続すると、ホストは **Docker** セクションに自動で表示されます。通常は 1 分ほどです。OneUptime AI エージェントは、ホストの **AI → AI エージェント** ページと **概要** の下部に 接続済み と表示されます。",
  "| Variable | Required | Description |": "| 変数 | 必須 | 説明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | はい | OneUptime インスタンスの URL (例: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | はい | ステップ 1 のテレメトリ取り込みキー |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | いいえ | このホストのわかりやすい名前。既定値は `docker-host` |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | いいえ | エージェントが使う Docker Engine API のバージョン。既定では空です。エージェントがデーモンと交渉するので、20.10 以降のどの Docker Engine でも動きます。バージョンを固定したいときだけ設定してください (トラブルシューティング を参照) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1`～`ONEUPTIME_LOG_OPERATOR_5` | いいえ | エージェントが読み取らないログ形式のための、独自のコレクターのオペレーター。それぞれ JSON で指定します |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "それぞれを `-e NAME=value` として `docker run` に渡します。後で変更するには、`docker rm -f oneuptime-docker-agent` でエージェントを削除し、新しい値でコマンドを実行し直します。",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "エージェントは `/var/lib/docker/containers/*/*-json.log` を追跡するため、Docker の **`json-file`** ログドライバーを使うコンテナのログしか見えません。これは Docker の既定ですが、`local` (エージェントが解析できないバイナリファイル) やリモートドライバー (`journald`、`syslog`、`fluentd`、`gelf` など…) に切り替えているホストもあり、その場合は読み取れるファイルが残りません。",
  "Check a container's log driver, and the daemon's default:":
    "コンテナのログドライバーとデーモンの既定を確認します:",
  "Switch a Compose service to `json-file`, with rotation:":
    "Compose サービスをローテーション付きで `json-file` に切り替えます:",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "または、`/etc/docker/daemon.json` で、以降に作成されるすべてのコンテナに対するデーモンの既定を変更します:",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "その後 Docker を再起動し、影響を受けるコンテナを **作り直して** ください (再起動だけでは足りません)。コンテナは作成時のログドライバーを使い続けます。",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent` (ステップ 2 で起動する 2 つ目のコンテナ) は、OneUptime AI がこのホストのインシデントやアラートを調査する間、要求された `docker` コマンドを実行します。**AI 調査は既定でオンです**: 接続するとすぐに OneUptime AI がこれを使って調査し、ホストの **AI → AI エージェント** ページと **概要** にその状態が表示されます。調査をオフにするには、そのページの **AI に許可する操作** を使います。AI エージェントなしでコレクターを実行するには、`docker rm -f oneuptime-docker-ai-agent` で削除します。",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **既定では読み取り専用です。** `docker ps`、`docker logs --tail 200 NAME`、`docker inspect`、`docker stats --no-stream` などのコマンドを実行し、`exec`、`run`、`rm`、`prune` は決して実行しません。`docker inspect` の出力に含まれる環境変数の値は、ホストの外に出る前にマスクされます。",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **修正は許可したときだけです。** コマンドに `-e ONEUPTIME_AI_ALLOW_WRITES=true` を加えると、名前を指定したコンテナの再起動、起動、停止、一時停止、強制終了、制限の変更を許可できます。その横の `ONEUPTIME_AI_FIXES` で、各修正に承認が必要かどうか (`ask-for-approval`、`automatic`、`bypass-approval`) を決め、ホストの **AI → AI エージェント** ページにそれが表示されます。`ONEUPTIME_AI_WRITE_TARGETS` (`web-*,api-*` のようなカンマ区切りのグロブ) で対象のコンテナを絞り込み、`ONEUPTIME_AI_PROTECTED_TARGETS` で決して変更してはいけないコンテナを追加します。自分自身とコレクターは決して変更しません。",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- Docker ソケットの所有者が root なので、root で実行されます。ソケットを `:ro` でマウントしても Docker API は読み取り専用になりません。制限はエージェントのコマンドポリシーです。",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- ログ: `docker logs -f oneuptime-docker-ai-agent`。実行できる操作と修正の仕組み: [インフラストラクチャの AI エージェント](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts)。",
  "| Tag | Description |": "| タグ | 説明 |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | 最新の安定版 (community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | 最新の安定版 (enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | 固定したバージョン (例: `10.0.31`) |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | GHCR にミラーされた同じイメージ |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "`docker run` コマンドの末尾の `oneuptime/docker-agent:release` の代わりに、いずれかを使います。",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**アップグレード**: 最新のイメージを取得し、実行中のエージェントを削除します:",
  "Then run both `docker run` commands from step 2 again.":
    "その後、ステップ 2 の 2 つの `docker run` コマンドを実行し直します。",
  "**Uninstall:**": "**アンインストール:**",
  "| Category | Data |": "| カテゴリ | データ |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **CPU メトリクス** | 合計使用量、使用率、スロットリング時間 (コンテナごと) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **メモリメトリクス** | 使用量、上限、割合、RSS、キャッシュ (コンテナごと) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **ネットワークメトリクス** | 受信/送信したバイト数とパケット数 (コンテナごと) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **ブロック I/O メトリクス** | 読み取り/書き込みのバイト数と操作数 (コンテナごと) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **コンテナ情報** | 稼働時間、再起動回数、プロセス数 |",
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **コンテナログ** | すべてのコンテナの stdout/stderr ログ |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    '各ログ行には、その行が示すレベル (`[ERROR]`、`level=warn`、`{"level":"info"}`) から重大度が付きます。レベルのない行はストリームで決まり、stderr は `ERROR`、stdout は `INFO` になります。',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "`/var/run/docker.sock` を読むには、エージェントを root で実行する必要があります。`docker run` コマンドに `--user 0:0` フラグがあることを確認してください。",
  "The agent's logs show:": "エージェントのログには次のように表示されます:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "デーモンは自身の上限より新しいクライアントを拒否し、そのためコレクターが終了して、コンテナが再起動を繰り返します。エージェントがバージョンを固定するのは `DOCKER_API_VERSION` で指定されたときだけですが、古いエージェントイメージは `1.44` を固定しており、Docker Engine 20.10 から 24 はこれを拒否します。エージェントを削除し (`docker rm -f oneuptime-docker-agent`)、最新のイメージを取得して (`docker pull oneuptime/docker-agent:release`)、`-e DOCKER_API_VERSION` なしでステップ 2 のコマンドを実行し直してください。するとエージェントがデーモンとバージョンを交渉します。",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "それでもバージョンを固定する場合は、デーモンの上限を超えないようにします:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "コマンドに加えます (例: `-e DOCKER_API_VERSION=1.41`)。新しいデーモンも古い API バージョンを引き続き提供するので、固定したバージョンは Docker をアップグレードした後も動き続けます。",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. エージェントが実行中か確認します: `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. エージェントのログでエラーを確認します: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. `docker run` コマンドの OneUptime URL と取り込みキーが正しいことを確認します。",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. ホストがネットワーク経由で OneUptime インスタンスに到達できることを確認します。",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Docker ソケットがエージェントにマウントされているか確認します。イメージにはシェルがないので、同じマウントを共有する使い捨てのコンテナから確認します:",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "次に、エージェントのログでエクスポートのエラーを探し (`docker logs oneuptime-docker-agent 2>&1 | grep -i error`)、取り込みキーが有効で期限切れでないことを確認します。",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "メトリクスは届くのに **ログ** タブが空、またはエージェント自身のログしか表示されませんか？ コンテナが `json-file` ログドライバーを使っていない可能性が高いです。",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "ステップ 1 で `no files match the configured criteria` と表示される、またはステップ 3 でコンテナのファイルが 1 つも表示されない場合、そのコンテナは `json-file` を使っていません。切り替えてから (詳細 の **すべてのコンテナからログを収集 (json-file ログドライバー)** を参照)、1 つずつ作り直してください。コンテナは作成時のログドライバーを使い続けます:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "ホストのページには、ホスト名がそのホストの識別子であるデータが表示されます。識別子はエージェントが `DOCKER_HOST_NAME` から取ります。ホストの登録後に `DOCKER_HOST_NAME` を変えると、OneUptime は新しい名前で 2 つ目のホストを登録し、ログはそちらに入ります。エージェントが報告している名前を確認します:",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "ホストの名前は `DOCKER_HOST_NAME` から決まります。これを指定せずに起動したエージェントは `docker-host` を報告するので、そのように設定したホストはすべて同じホストに見えます。各ホストで `DOCKER_HOST_NAME` に固有の名前を設定し、エージェントを作り直してください。`docker rm -f oneuptime-docker-agent` を実行してから、新しい名前でステップ 2 のコマンドを実行します。",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "これは **`web-1`** 用にエージェントをインストールします。`DOCKER_HOST_NAME` はそのまま変えないでください。変えるとデータが新しいホストとして登録されます。",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (`docker compose` コマンド)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "2 つ目のサービスは、同じ URL、キー、ホスト名を使う OneUptime AI エージェントです。**AI 調査は既定でオンです**: OneUptime AI がこのホストのインシデントやアラートを調査する間、AI エージェント経由で読み取り専用の `docker` コマンドを実行し、修正を許可しない限り何も変更しません。詳しくは 詳細 の **OneUptime AI エージェント** を参照してください。AI 調査なしでコレクターを実行するには、`oneuptime-docker-ai-agent` サービスを削除します。",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "それぞれをエージェントの `environment:` リストに設定し、`docker compose up -d` を実行して新しい値で作り直します。",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent` (docker-compose.yml の 2 つ目のサービス) は、OneUptime AI がこのホストのインシデントやアラートを調査する間、要求された `docker` コマンドを実行します。**AI 調査は既定でオンです**: 接続するとすぐに OneUptime AI がこれを使って調査し、ホストの **AI → AI エージェント** ページと **概要** にその状態が表示されます。調査をオフにするには、そのページの **AI に許可する操作** を使います。AI エージェントなしでコレクターを実行するには、そのサービスを削除して `docker compose up -d --remove-orphans` を実行します。",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **修正は許可したときだけです。** `environment:` リストに `- ONEUPTIME_AI_ALLOW_WRITES=true` を加えると、名前を指定したコンテナの再起動、起動、停止、一時停止、強制終了、制限の変更を許可できます。その横の `ONEUPTIME_AI_FIXES` で、各修正に承認が必要かどうか (`ask-for-approval`、`automatic`、`bypass-approval`) を決め、ホストの **AI → AI エージェント** ページにそれが表示されます。`ONEUPTIME_AI_WRITE_TARGETS` (`web-*,api-*` のようなカンマ区切りのグロブ) で対象のコンテナを絞り込み、`ONEUPTIME_AI_PROTECTED_TARGETS` で決して変更してはいけないコンテナを追加します。自分自身とコレクターは決して変更しません。",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "エージェントの `image:` 行の `oneuptime/docker-agent:release` の代わりに、いずれかを使います。",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**アップグレード**: docker-compose.yml のあるフォルダーで最新のイメージを取得し、コンテナを作り直します:",
  "**Uninstall** — stop and remove everything the file started:":
    "**アンインストール**: ファイルが起動したものをすべて停止して削除します:",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    '`/var/run/docker.sock` を読むには、エージェントを root で実行する必要があります。docker-compose.yml のエージェントのサービスに `user: "0:0"` があることを確認してください。',
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "デーモンは自身の上限より新しいクライアントを拒否し、そのためコレクターが終了して、コンテナが再起動を繰り返します。エージェントがバージョンを固定するのは `DOCKER_API_VERSION` で指定されたときだけですが、古いエージェントイメージは `1.44` を固定しており、Docker Engine 20.10 から 24 はこれを拒否します。エージェントの `environment:` リストから `DOCKER_API_VERSION` を外し、`docker compose pull` と `docker compose up -d` を実行してください。するとエージェントがデーモンとバージョンを交渉します。",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "エージェントの `environment:` リストに加えて (例: `- DOCKER_API_VERSION=1.41`)、`docker compose up -d` を実行します。新しいデーモンも古い API バージョンを引き続き提供するので、固定したバージョンは Docker をアップグレードした後も動き続けます。",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. docker-compose.yml の OneUptime URL と取り込みキーが正しいことを確認します。",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "ホストの名前は `DOCKER_HOST_NAME` から決まります。これを指定せずに起動したエージェントは `docker-host` を報告するので、そのように設定したホストはすべて同じホストに見えます。各ホストで `DOCKER_HOST_NAME` に固有の名前を設定し、`docker compose up -d` を実行してエージェントを作り直してください。",
};

export default TRANSLATION;
