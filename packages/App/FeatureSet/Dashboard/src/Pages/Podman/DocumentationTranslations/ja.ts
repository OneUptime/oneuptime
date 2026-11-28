import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Japanese (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Japanese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Japanese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 以降",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "`/run/podman/podman.sock` にある Podman の Docker 互換 API ソケット。`sudo systemctl enable --now podman.socket` で有効にします",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "ログを収集したいコンテナは `k8s-file` ログドライバーを使う必要があります。rootful の Podman の既定は `journald` で、エージェントはこれを読めません",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "次に、同じ URL、キー、ホスト名で OneUptime AI エージェントを横に起動します。**AI 調査は既定でオンです**: OneUptime AI がこのホストのインシデントやアラートを調査する間、AI エージェント経由で Podman の Docker 互換ソケットに対して読み取り専用の `docker` コマンドを実行し、修正を許可しない限り何も変更しません。詳しくは 詳細 の **OneUptime AI エージェント** を参照してください。AI 調査なしでコレクターを実行するには、このコマンドを省略します。",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "`my-podman-host` をこのホストの名前 (例: `prod-podman-01`) に置き換えます。OneUptime ではこの名前でホストが表示されるので、変えないでください。新しい名前は新しいホストとして登録されます。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` に入ります。",
  "Look for this line in the logs:": "ログでこの行を探します:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "エージェントが接続すると、ホストは **Podman** セクションに自動で表示されます。通常は 1 分ほどです。OneUptime AI エージェントは、ホストの **AI → AI エージェント** ページと **概要** の下部に 接続済み と表示されます。",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**メトリクスはあるのにログがない？** rootful の Podman は既定でコンテナのログを `journald` に書き込み、エージェントはこれを読めません。コンテナを `--log-driver k8s-file` で実行してください。詳しくは 詳細 の **すべてのコンテナからログを収集 (k8s-file ログドライバー)** を参照してください。",
  "| Variable | Required | Description |": "| 変数 | 必須 | 説明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | はい | OneUptime インスタンスの URL (例: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | はい | ステップ 1 のテレメトリ取り込みキー |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | いいえ | このホストのわかりやすい名前。既定値は `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | いいえ | エージェントが Podman ソケットとの通信に使う Docker API のバージョン。既定では空で、エージェントがソケットと交渉します。バージョンを固定したいときだけ設定してください (トラブルシューティング を参照) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1`～`ONEUPTIME_LOG_OPERATOR_5` | いいえ | エージェントが読み取らないログ形式のための、独自のコレクターのオペレーター。それぞれ JSON で指定します |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "それぞれを `-e NAME=value` として `podman run` に渡します。後で変更するには、`podman rm -f oneuptime-podman-agent` でエージェントを削除し、新しい値でコマンドを実行し直します。",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "エージェントは Podman の **`k8s-file`** ログドライバーが書き込むファイル (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`) を読むため、それを使うコンテナ (または、Podman が同じファイルベースのドライバーとして扱う `json-file`) のログしか見えません。rootful の Podman の既定は **`journald`** で、エージェントはこれを読めず、`syslog` のようなリモートドライバーも読めません。",
  "Check a container's log driver, and Podman's default:":
    "コンテナのログドライバーと Podman の既定を確認します:",
  "Run a single container with `k8s-file`:":
    "コンテナを 1 つ `k8s-file` で実行します:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "Compose サービスをローテーション付きで `k8s-file` に切り替えます:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "または、`containers.conf` (rootful では `/etc/containers/containers.conf`、rootless では `~/.config/containers/containers.conf`) で、以降に作成されるすべてのコンテナの既定を変更します:",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "その後、影響を受けるコンテナを **作り直して** ください (再起動だけでは足りません)。コンテナは作成時のログドライバーを使い続けます。`journald` を使い続ける必要がありますか？ その場合もエージェントはソケット経由でメトリクスを収集します。ファイルベースのドライバーが必要なのはコンテナのログだけです。",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent` (ステップ 2 で起動する 2 つ目のコンテナ) は、OneUptime AI がこのホストのインシデントやアラートを調査する間、要求された `docker` コマンドを Podman の Docker 互換ソケット経由で実行します。**AI 調査は既定でオンです**: 接続するとすぐに OneUptime AI がこれを使って調査し、ホストの **AI → AI エージェント** ページと **概要** にその状態が表示されます。調査をオフにするには、そのページの **AI に許可する操作** を使います。AI エージェントなしでコレクターを実行するには、`podman rm -f oneuptime-podman-ai-agent` で削除します。",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **既定では読み取り専用です。** `docker ps`、`docker logs --tail 200 NAME`、`docker inspect`、`docker stats --no-stream` などのコマンドを実行し、`exec`、`run`、`rm`、`prune` は決して実行しません。`docker inspect` の出力に含まれる環境変数の値は、ホストの外に出る前にマスクされます。",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **修正は許可したときだけです。** コマンドに `-e ONEUPTIME_AI_ALLOW_WRITES=true` を加えると、名前を指定したコンテナの再起動、起動、停止、一時停止、強制終了、制限の変更を許可できます。その横の `ONEUPTIME_AI_FIXES` で、各修正に承認が必要かどうか (`ask-for-approval`、`automatic`、`bypass-approval`) を決め、ホストの **AI → AI エージェント** ページにそれが表示されます。`ONEUPTIME_AI_WRITE_TARGETS` (`web-*,api-*` のようなカンマ区切りのグロブ) で対象のコンテナを絞り込み、`ONEUPTIME_AI_PROTECTED_TARGETS` で決して変更してはいけないコンテナを追加します。自分自身とコレクターは決して変更しません。",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- コレクターと同じソケットが必要で、ソケットの所有者が root なので root で実行されます。ソケットを `:ro` でマウントしても API は読み取り専用になりません。制限はエージェントのコマンドポリシーです。",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- ログ: `podman logs -f oneuptime-podman-ai-agent`。実行できる操作と修正の仕組み: [インフラストラクチャの AI エージェント](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts)。",
  "| Tag | Description |": "| タグ | 説明 |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | 最新の安定版 (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | 最新の安定版 (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | 固定したバージョン (例: `10.0.31`) |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | GHCR にミラーされた同じイメージ |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "`podman run` コマンドの末尾の `oneuptime/podman-agent:release` の代わりに、いずれかを使います。",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**アップグレード**: 最新のイメージを取得し、実行中のエージェントを削除します:",
  "Then run both `podman run` commands from step 2 again.":
    "その後、ステップ 2 の 2 つの `podman run` コマンドを実行し直します。",
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
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **コンテナログ** | `k8s-file` ログドライバーを使うすべてのコンテナの stdout/stderr ログ |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'メトリクスは Podman の Docker 互換ソケットを通じてコレクターの `docker_stats` レシーバーから来るので、名前は Docker エージェントと同じです。各ログ行には、その行が示すレベル (`[ERROR]`、`level=warn`、`{"level":"info"}`) から重大度が付きます。レベルのない行はストリームで決まり、stderr は `ERROR`、stdout は `INFO` になります。',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "`/run/podman/podman.sock` を読むには、エージェントを root で実行する必要があります。`podman run` コマンドに `--user 0:0` フラグがあり、ソケットが有効になっていることを確認してください:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "これは rootful の Podman のソケットで、エージェントが読むものです。Podman を rootless で使っていますか？ その場合、ソケットは `/run/user/<uid>/podman/podman.sock` (`systemctl --user enable --now podman.socket` で有効にします)、ストレージは `~/.local/share/containers/storage` です。代わりにこれらをエージェントのコンテナの `/run/podman/podman.sock` と `/var/lib/containers/storage` にマウントしてください。詳しくは Podman エージェントのドキュメントを参照してください。",
  "The agent's logs show:": "エージェントのログには次のように表示されます:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "上限を設けているサーバーは新しいクライアントを拒否し、そのためコレクターが終了して、コンテナが再起動を繰り返します。エージェントが Docker API のバージョンを固定するのは `DOCKER_API_VERSION` で指定されたときだけですが、古いエージェントイメージは `1.44` を固定していました。エージェントを削除し (`podman rm -f oneuptime-podman-agent`)、最新のイメージを取得して (`podman pull oneuptime/podman-agent:release`)、`-e DOCKER_API_VERSION` なしでステップ 2 のコマンドを実行し直してください。するとエージェントがソケットとバージョンを交渉します。",
  "To pin a version anyway, use no more than the version the socket reports:":
    "それでもバージョンを固定する場合は、ソケットが報告するバージョンを超えないようにします:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "コマンドに加えます (例: `-e DOCKER_API_VERSION=1.41`)。新しいサーバーも古い API バージョンを引き続き提供するので、固定したバージョンはアップグレード後も動き続けます。",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. エージェントが実行中か確認します: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. エージェントのログでエラーを確認します: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. `podman run` コマンドの OneUptime URL と取り込みキーが正しいことを確認します。",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. ホストがネットワーク経由で OneUptime インスタンスに到達できることを確認します。",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Podman ソケットがエージェントにマウントされているか確認します。イメージにはシェルがないので、同じマウントを共有する使い捨てのコンテナから確認します:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "次に、エージェントのログでエクスポートのエラーを探し (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`)、取り込みキーが有効で期限切れでないことを確認します。",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "メトリクスは届くのに **ログ** タブが空、またはエージェント自身のログしか表示されませんか？ コンテナがファイルベースのログドライバー (`k8s-file` または `json-file`) を使っていない可能性が高いです。rootful の Podman の既定は `journald` で、エージェントはこれを読めません。",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "ステップ 1 で `no files match the configured criteria` と表示される、またはステップ 3 でコンテナのファイルが 1 つも表示されない場合、そのコンテナは `k8s-file` を使っていません。切り替えてから (詳細 の **すべてのコンテナからログを収集 (k8s-file ログドライバー)** を参照)、1 つずつ作り直してください。コンテナは作成時のログドライバーを使い続けます:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "ホストのページには、ホスト名がそのホストの識別子であるデータが表示されます。識別子はエージェントが `PODMAN_HOST_NAME` から取ります。ホストの登録後に `PODMAN_HOST_NAME` を変えると、OneUptime は新しい名前で 2 つ目のホストを登録し、ログはそちらに入ります。エージェントが報告している名前を確認します:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "ホストの名前は `PODMAN_HOST_NAME` から決まります。これを指定せずに起動したエージェントは `podman-host` を報告するので、そのように設定したホストはすべて同じホストに見えます。各ホストで `PODMAN_HOST_NAME` に固有の名前を設定し、エージェントを作り直してください。`podman rm -f oneuptime-podman-agent` を実行してから、新しい名前でステップ 2 のコマンドを実行します。",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "これは **`web-1`** 用にエージェントをインストールします。`PODMAN_HOST_NAME` はそのまま変えないでください。変えるとデータが新しいホストとして登録されます。",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "`podman compose` 用の Compose プロバイダー: `podman-compose` または Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "2 つ目のサービスは、同じ URL、キー、ホスト名を使う OneUptime AI エージェントです。**AI 調査は既定でオンです**: OneUptime AI がこのホストのインシデントやアラートを調査する間、AI エージェント経由で Podman の Docker 互換ソケットに対して読み取り専用の `docker` コマンドを実行し、修正を許可しない限り何も変更しません。詳しくは 詳細 の **OneUptime AI エージェント** を参照してください。AI 調査なしでコレクターを実行するには、`oneuptime-podman-ai-agent` サービスを削除します。",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "それぞれをエージェントの `environment:` リストに設定し、`podman compose up -d` を実行して新しい値で作り直します。",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent` (docker-compose.yml の 2 つ目のサービス) は、OneUptime AI がこのホストのインシデントやアラートを調査する間、要求された `docker` コマンドを Podman の Docker 互換ソケット経由で実行します。**AI 調査は既定でオンです**: 接続するとすぐに OneUptime AI がこれを使って調査し、ホストの **AI → AI エージェント** ページと **概要** にその状態が表示されます。調査をオフにするには、そのページの **AI に許可する操作** を使います。AI エージェントなしでコレクターを実行するには、そのサービスを削除して `podman compose up -d --remove-orphans` を実行します。",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **修正は許可したときだけです。** `environment:` リストに `- ONEUPTIME_AI_ALLOW_WRITES=true` を加えると、名前を指定したコンテナの再起動、起動、停止、一時停止、強制終了、制限の変更を許可できます。その横の `ONEUPTIME_AI_FIXES` で、各修正に承認が必要かどうか (`ask-for-approval`、`automatic`、`bypass-approval`) を決め、ホストの **AI → AI エージェント** ページにそれが表示されます。`ONEUPTIME_AI_WRITE_TARGETS` (`web-*,api-*` のようなカンマ区切りのグロブ) で対象のコンテナを絞り込み、`ONEUPTIME_AI_PROTECTED_TARGETS` で決して変更してはいけないコンテナを追加します。自分自身とコレクターは決して変更しません。",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "エージェントの `image:` 行の `oneuptime/podman-agent:release` の代わりに、いずれかを使います。",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**アップグレード**: docker-compose.yml のあるフォルダーで最新のイメージを取得し、コンテナを作り直します:",
  "**Uninstall** — stop and remove everything the file started:":
    "**アンインストール**: ファイルが起動したものをすべて停止して削除します:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    '`/run/podman/podman.sock` を読むには、エージェントを root で実行する必要があります。docker-compose.yml のエージェントのサービスに `user: "0:0"` があり、ソケットが有効になっていることを確認してください:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "上限を設けているサーバーは新しいクライアントを拒否し、そのためコレクターが終了して、コンテナが再起動を繰り返します。エージェントが Docker API のバージョンを固定するのは `DOCKER_API_VERSION` で指定されたときだけですが、古いエージェントイメージは `1.44` を固定していました。エージェントの `environment:` リストから `DOCKER_API_VERSION` を外し、`podman compose pull` と `podman compose up -d` を実行してください。するとエージェントがソケットとバージョンを交渉します。",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "エージェントの `environment:` リストに加えて (例: `- DOCKER_API_VERSION=1.41`)、`podman compose up -d` を実行します。新しいサーバーも古い API バージョンを引き続き提供するので、固定したバージョンはアップグレード後も動き続けます。",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. docker-compose.yml の OneUptime URL と取り込みキーが正しいことを確認します。",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "ホストの名前は `PODMAN_HOST_NAME` から決まります。これを指定せずに起動したエージェントは `podman-host` を報告するので、そのように設定したホストはすべて同じホストに見えます。各ホストで `PODMAN_HOST_NAME` に固有の名前を設定し、`podman compose up -d` を実行してエージェントを作り直してください。",
};

export default TRANSLATION;
