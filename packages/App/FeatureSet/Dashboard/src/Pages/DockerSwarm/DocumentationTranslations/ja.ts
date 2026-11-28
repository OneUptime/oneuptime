import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The DockerSwarm setup guide in Japanese (#8341): each piece of the English
 * guide's markdown (Pages/DockerSwarm/Utils/DocumentationMarkdown.ts) and its
 * Japanese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Japanese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Docker Swarm **manager** node to run it on — the inventory poller calls manager-only API endpoints (`/nodes`, `/services`, `/tasks`)":
    "実行先となる Docker Swarm の **manager** ノード。インベントリポーラーは manager だけが持つ API エンドポイント (`/nodes`、`/services`、`/tasks`) を呼び出します",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin":
    "Docker Compose v2 プラグイン付きの Docker Engine 20.10 以降",
  "When it asks, enter the OneUptime URL and the ingestion key shown in step 1, and a name for the cluster, such as `prod-swarm`. The name is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "尋ねられたら、ステップ 1 に表示されている OneUptime URL と取り込みキー、そしてクラスター名 (例: `prod-swarm`) を入力します。OneUptime ではこの名前でクラスターが表示されるので、変えないでください。新しい名前は新しいクラスターとして登録されます。",
  "The script puts the agent in `/opt/oneuptime-docker-swarm-agent` and starts it with Docker Compose.":
    "スクリプトはエージェントを `/opt/oneuptime-docker-swarm-agent` に置き、Docker Compose で起動します。",
  "`docker compose ps` lists three containers: the collector (`oneuptime-docker-swarm-agent`), the inventory poller (`oneuptime-docker-swarm-inventory`) and the OneUptime AI agent (`oneuptime-docker-swarm-ai-agent`). The cluster appears in the **Docker Swarm** section within a few minutes, and its Nodes, Services, Tasks, Stacks, Networks, Secrets, Configs and Volumes pages fill in after the first inventory snapshot (≤ 5 minutes).":
    "`docker compose ps` には 3 つのコンテナが表示されます: コレクター (`oneuptime-docker-swarm-agent`)、インベントリポーラー (`oneuptime-docker-swarm-inventory`)、OneUptime AI エージェント (`oneuptime-docker-swarm-ai-agent`) です。クラスターは数分以内に **Docker Swarm** セクションに表示され、最初のインベントリのスナップショット (≤ 5 分) の後で、ノード、サービス、タスク、スタック、ネットワーク、シークレット、設定、ボリュームの各ページが埋まります。",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only docker commands such as `docker node ls` and `docker service ps`, and changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced.":
    "**OneUptime AI エージェント (既定でオン、読み取り専用)。** AI 調査はオンです: これを使って OneUptime AI は、`docker node ls` や `docker service ps` などの読み取り専用の docker コマンドでこのクラスターのインシデントやアラートを調査し、修正を許可しない限り何も変更しません。詳しくは 詳細 の **OneUptime AI エージェント** を参照してください。",
  "Run the agent on a **manager** node: the inventory poller and the OneUptime AI agent call manager-only API endpoints. The collector reports the containers of the node it runs on, so for per-node container metrics run the collector on every node, all with the same `DOCKER_SWARM_CLUSTER_NAME`; the inventory poller only needs to run on one manager. Run the install script on a node that is not a manager, and it leaves the OneUptime AI agent out there.":
    "エージェントは **manager** ノードで実行してください。インベントリポーラーと OneUptime AI エージェントは manager だけが持つ API エンドポイントを呼び出します。コレクターは自分が動いているノードのコンテナを報告するので、ノードごとのコンテナメトリクスが必要なら、すべてのノードで同じ `DOCKER_SWARM_CLUSTER_NAME` を使ってコレクターを実行します。インベントリポーラーは 1 台の manager で動けば十分です。manager ではないノードでインストールスクリプトを実行すると、そのノードには OneUptime AI エージェントを入れません。",
  "Deploying the agent as a swarm stack rather than with Compose? Pin the inventory poller and the AI agent to managers — docker-compose.yml carries this block, commented out, on both services:":
    "Compose ではなく swarm スタックとしてエージェントをデプロイしますか？ インベントリポーラーと AI エージェントを manager に固定してください。docker-compose.yml の両方のサービスに、このブロックがコメントアウトされて入っています:",
  "| Variable | Required | Description |": "| 変数 | 必須 | 説明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | はい | OneUptime インスタンスの URL (例: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | はい | ステップ 1 のテレメトリ取り込みキー |",
  "| `DOCKER_SWARM_CLUSTER_NAME` | Yes | The cluster's name in OneUptime, and its join key: stamped on every signal as the `docker.swarm.cluster.name` resource attribute. Defaults to `docker-swarm` |":
    "| `DOCKER_SWARM_CLUSTER_NAME` | はい | OneUptime でのクラスター名で、結び付けのキーでもあります。すべてのシグナルにリソース属性 `docker.swarm.cluster.name` として付きます。既定値は `docker-swarm` |",
  "| `DOCKER_SWARM_NODE_NAME` | No | This node's name, stamped on its containers' metrics and logs as `docker.swarm.node.name` — what a Docker Swarm monitor's **Node Name** filter matches. The install script sets it to the node's hostname, the name `docker node ls` shows. Empty: no node name is stamped |":
    "| `DOCKER_SWARM_NODE_NAME` | いいえ | このノードの名前で、そのコンテナのメトリクスとログに `docker.swarm.node.name` として付きます。Docker Swarm モニターの **ノード名** フィルターはこれに一致します。インストールスクリプトはノードのホスト名 (`docker node ls` が表示する名前) を設定します。空の場合: ノード名は付きません |",
  "| `DOCKER_INVENTORY_INTERVAL_SECONDS` | No | How often the poller refreshes the inventory snapshot (default `300`) |":
    "| `DOCKER_INVENTORY_INTERVAL_SECONDS` | いいえ | ポーラーがインベントリのスナップショットを更新する間隔 (既定値 `300`) |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the collector and the inventory poller speak. Empty by default: they use the daemon's own, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | いいえ | コレクターとインベントリポーラーが使う Docker Engine API のバージョン。既定では空で、デーモン自身のバージョンを使うので、20.10 以降のどの Docker Engine でも動きます。バージョンを固定したいときだけ設定してください (トラブルシューティング を参照) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1`～`ONEUPTIME_LOG_OPERATOR_5` | いいえ | エージェントが読み取らないログ形式のための、独自のコレクターのオペレーター。それぞれ JSON で指定します |",
  "The install script writes the first four to `/opt/oneuptime-docker-swarm-agent/.env`. Add or change any of them there, then run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent` to recreate the containers with the new values.":
    "インストールスクリプトは最初の 4 つを `/opt/oneuptime-docker-swarm-agent/.env` に書き込みます。そこで追加や変更をしてから、`/opt/oneuptime-docker-swarm-agent` で `docker compose up -d` を実行し、新しい値でコンテナを作り直します。",
  "The agent's docker-compose.yml also runs the OneUptime AI agent, `oneuptime-docker-swarm-ai-agent`. It runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this cluster, and it appears on the cluster's **AI → AI agent** page. Like the inventory poller it must run on a manager node — on a worker it runs nothing.":
    "エージェントの docker-compose.yml は OneUptime AI エージェント `oneuptime-docker-swarm-ai-agent` も実行します。これは、OneUptime AI がこのクラスターのインシデントやアラートを調査する間に要求する `docker` コマンドを実行し、クラスターの **AI → AI エージェント** ページに表示されます。インベントリポーラーと同じく manager ノードで動かす必要があり、worker では何も実行しません。",
  "- **Read-only by default.** It runs commands such as `docker node ls`, `docker service ls`, `docker service ps NAME` and `docker service logs --tail 200 NAME` — never `service create`/`rm`, `stack deploy`/`rm`, secrets, configs or `exec`. Environment values in `docker service inspect` output are masked before anything leaves the node.":
    "- **既定では読み取り専用です。** `docker node ls`、`docker service ls`、`docker service ps NAME`、`docker service logs --tail 200 NAME` などのコマンドを実行し、`service create`/`rm`、`stack deploy`/`rm`、シークレット、config、`exec` は決して実行しません。`docker service inspect` の出力に含まれる環境変数の値は、ノードの外に出る前にマスクされます。",
  "- **Fixes are opt-in.** Set `ONEUPTIME_AI_ALLOW_WRITES=true` in `/opt/oneuptime-docker-swarm-agent/.env` and run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent` to let it roll a named service (`docker service update --force`), roll it back or scale it. `ONEUPTIME_AI_FIXES` in the same file says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the cluster's **AI → AI agent** page shows it. Draining a node always needs a person's approval. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs of service and node names) limits what fixes may touch; `ONEUPTIME_AI_PROTECTED_TARGETS` adds services it must never change. It never changes itself, the collector or the inventory poller.":
    "- **修正は許可したときだけです。** `/opt/oneuptime-docker-swarm-agent/.env` に `ONEUPTIME_AI_ALLOW_WRITES=true` を設定し、`/opt/oneuptime-docker-swarm-agent` で `docker compose up -d` を実行すると、名前を指定したサービスの再デプロイ (`docker service update --force`)、ロールバック、スケールを許可できます。同じファイルの `ONEUPTIME_AI_FIXES` で、各修正に承認が必要かどうか (`ask-for-approval`、`automatic`、`bypass-approval`) を決め、クラスターの **AI → AI エージェント** ページにそれが表示されます。ノードのドレインには常に人の承認が必要です。`ONEUPTIME_AI_WRITE_TARGETS` (サービス名とノード名のカンマ区切りのグロブ) で修正の対象を絞り込み、`ONEUPTIME_AI_PROTECTED_TARGETS` で決して変更してはいけないサービスを追加します。自分自身、コレクター、インベントリポーラーは決して変更しません。",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- Docker ソケットの所有者が root なので、root で実行されます。ソケットを `:ro` でマウントしても Docker API は読み取り専用になりません。制限はエージェントのコマンドポリシーです。",
  "- To leave it out, run the install script with `--no-ai-agent`: `sh install.sh --no-ai-agent`.":
    "- 入れない場合は、`--no-ai-agent` を付けてインストールスクリプトを実行します: `sh install.sh --no-ai-agent`。",
  "- Its logs: `docker compose logs -f oneuptime-docker-swarm-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-swarm-clusters).":
    "- ログ: `docker compose logs -f oneuptime-docker-swarm-ai-agent`。実行できる操作と修正の仕組み: [インフラストラクチャの AI エージェント](/docs/ai/infrastructure-ai-agents#docker-swarm-clusters)。",
  "The agent is three containers, all defined in its docker-compose.yml:":
    "エージェントは 3 つのコンテナで構成され、すべて docker-compose.yml で定義されています:",
  "1. **Collector** (`oneuptime-docker-swarm-agent`) — the stock `otel/opentelemetry-collector-contrib` image with a tuned config. It scrapes `docker_stats` for per-container CPU and memory, tails container logs, and tails the inventory snapshot file — stamping everything with `docker.swarm.cluster.name`, and each task's metrics with its service and node, before shipping it to OneUptime over OTLP.":
    "1. **コレクター** (`oneuptime-docker-swarm-agent`) — 調整済みの設定を入れた標準の `otel/opentelemetry-collector-contrib` イメージです。コンテナごとの CPU とメモリのために `docker_stats` を収集し、コンテナのログとインベントリのスナップショットファイルを追跡して、すべてに `docker.swarm.cluster.name` を、各タスクのメトリクスにはそのサービスとノードを付けてから、OTLP で OneUptime に送ります。",
  "2. **Inventory poller** (`oneuptime-docker-swarm-inventory`) — a small `alpine` + `curl` + `jq` sidecar that every 5 minutes walks the Swarm manager API (`/nodes`, `/services`, `/tasks`, `/networks`, `/secrets`, `/configs`, `/volumes`) and derives stacks from the `com.docker.stack.namespace` service label, writing one JSON line per object for the collector to forward.":
    "2. **インベントリポーラー** (`oneuptime-docker-swarm-inventory`) — `alpine` + `curl` + `jq` の小さなサイドカーで、5 分ごとに Swarm の manager API (`/nodes`、`/services`、`/tasks`、`/networks`、`/secrets`、`/configs`、`/volumes`) をたどり、サービスラベル `com.docker.stack.namespace` からスタックを導き出して、オブジェクトごとに JSON を 1 行書き込みます。それをコレクターが転送します。",
  "3. **OneUptime AI agent** (`oneuptime-docker-swarm-ai-agent`) — runs the commands OneUptime AI asks for; see **The OneUptime AI agent** above.":
    "3. **OneUptime AI エージェント** (`oneuptime-docker-swarm-ai-agent`) — OneUptime AI が要求するコマンドを実行します。上の **OneUptime AI エージェント** を参照してください。",
  "**Upgrade** — run the install script again. It downloads the latest docker-compose.yml, collector config and inventory poller into `/opt/oneuptime-docker-swarm-agent`, pulls the images and restarts the agent; answer its questions with the same URL, key and cluster name:":
    "**アップグレード**: インストールスクリプトを再実行します。最新の docker-compose.yml、コレクターの設定、インベントリポーラーを `/opt/oneuptime-docker-swarm-agent` にダウンロードし、イメージを取得してエージェントを再起動します。質問には同じ URL、キー、クラスター名で答えてください:",
  "It rewrites `.env` from your answers and keeps only the AI agent's target lists and what AI may do (`ONEUPTIME_AI_INVESTIGATION`, `ONEUPTIME_AI_FIXES`): add back any variable you set yourself, such as `DOCKER_API_VERSION`. Turned on AI fixes? Run it as `ONEUPTIME_AI_ALLOW_WRITES=true sh install.sh` to keep them on. Left the AI agent out? Pass `--no-ai-agent` again.":
    "回答をもとに `.env` を書き直し、AI エージェントの対象リストと AI に許可する操作 (`ONEUPTIME_AI_INVESTIGATION`、`ONEUPTIME_AI_FIXES`) だけを残します。`DOCKER_API_VERSION` のように自分で設定した変数は追加し直してください。AI の修正をオンにしていましたか？ オンのままにするには `ONEUPTIME_AI_ALLOW_WRITES=true sh install.sh` として実行します。AI エージェントを入れていませんでしたか？ もう一度 `--no-ai-agent` を渡してください。",
  "**Uninstall:**": "**アンインストール:**",
  "| Signal | Source | Powers |": "| シグナル | 取得元 | 用途 |",
  "| Node / Service / Task / Stack / Network / Secret / Config / Volume inventory | inventory poller → Swarm manager API | the cluster's resource list + detail pages |":
    "| ノード / サービス / タスク / スタック / ネットワーク / シークレット / config / ボリュームのインベントリ | インベントリポーラー → Swarm の manager API | クラスターのリソース一覧と詳細ページ |",
  "| Cluster counts (nodes ready, tasks running, services, stacks, …) | derived from the same snapshot | the overview cards + sidebar badges |":
    "| クラスターの件数 (準備完了のノード、実行中のタスク、サービス、スタックなど…) | 同じスナップショットから導出 | 概要のカードとサイドバーのバッジ |",
  "| Container CPU / memory / pids / uptime | `docker_stats` receiver | the Metrics tab |":
    "| コンテナの CPU / メモリ / PID / 稼働時間 | `docker_stats` レシーバー | メトリクス タブ |",
  "| Container stdout/stderr logs | `filelog` receiver | the Logs tab |":
    "| コンテナの stdout/stderr ログ | `filelog` レシーバー | ログ タブ |",
  "Each task's metrics carry its container (`container.name`, `container.image.name`, and `container.runtime=docker`, which the `docker_stats` receiver adds), its service (`docker.swarm.service.name`) and its node (`docker.swarm.node.id`, and `docker.swarm.node.name` from `DOCKER_SWARM_NODE_NAME`). The agent stamps `docker.swarm.cluster.name` on everything and never `host.name`, so OneUptime attributes the telemetry to this swarm cluster rather than registering each node as a standalone Host or Docker Host.":
    "各タスクのメトリクスには、そのコンテナ (`container.name`、`container.image.name`、そして `docker_stats` レシーバーが付ける `container.runtime=docker`)、サービス (`docker.swarm.service.name`)、ノード (`docker.swarm.node.id`、および `DOCKER_SWARM_NODE_NAME` から来る `docker.swarm.node.name`) が付きます。エージェントはすべてに `docker.swarm.cluster.name` を付け、`host.name` は決して付けないので、OneUptime は各ノードを単独のホストや Docker ホストとして登録せず、テレメトリをこの swarm クラスターのものとして扱います。",
  "Run the diagnostic script on the manager node. It checks the containers, that the inventory poller is on a manager, the snapshot file, the cluster name and the key — and asks OneUptime directly whether it accepts the ingestion key. A rejected key (`401` or `422`) otherwise shows only as an easy-to-miss `Exporting failed` line in the collector's logs.":
    "manager ノードで診断スクリプトを実行します。コンテナ、インベントリポーラーが manager 上にあるか、スナップショットファイル、クラスター名、キーを確認し、取り込みキーを受け付けるかどうかを OneUptime に直接問い合わせます。そうしないと、拒否されたキー (`401` または `422`) は、コレクターのログにある見落としやすい `Exporting failed` の行としてしか現れません。",
  "Otherwise, check the collector's logs (`docker compose logs oneuptime-docker-swarm-agent` in `/opt/oneuptime-docker-swarm-agent`), that `ONEUPTIME_SERVICE_TOKEN` and `ONEUPTIME_URL` in `/opt/oneuptime-docker-swarm-agent/.env` are correct, and that the manager can reach your OneUptime instance.":
    "それ以外の場合は、コレクターのログ (`/opt/oneuptime-docker-swarm-agent` での `docker compose logs oneuptime-docker-swarm-agent`)、`/opt/oneuptime-docker-swarm-agent/.env` の `ONEUPTIME_SERVICE_TOKEN` と `ONEUPTIME_URL` が正しいこと、manager が OneUptime インスタンスに到達できることを確認します。",
  "Confirm the poller runs on a manager: `docker node ls` must succeed there. Then look for `failed to emit ...` lines in its logs:":
    "ポーラーが manager 上で動いていることを確認します。そこで `docker node ls` が成功する必要があります。次に、そのログで `failed to emit ...` の行を探します:",
  "The cluster is marked disconnected after 15 minutes without telemetry. Make sure the collector container (`oneuptime-docker-swarm-agent`) stays running — `docker compose ps` in `/opt/oneuptime-docker-swarm-agent` shows it.":
    "テレメトリが 15 分届かないと、クラスターは切断済みとしてマークされます。コレクターのコンテナ (`oneuptime-docker-swarm-agent`) が動き続けていることを確認してください。`/opt/oneuptime-docker-swarm-agent` で `docker compose ps` を実行すると表示されます。",
  "The collector's logs show:": "コレクターのログには次のように表示されます:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The collector pins a version only when `DOCKER_API_VERSION` names one, and older agent files pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Run the install script again: it downloads the current files, which leave the version empty. Then take any `DOCKER_API_VERSION=` line with a version out of `/opt/oneuptime-docker-swarm-agent/.env`, or set it empty — `DOCKER_API_VERSION=` — and run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent`, on every node the collector runs on. The collector then negotiates the version with the daemon.":
    "デーモンは自身の上限より新しいクライアントを拒否し、そのためコレクターが終了して、コンテナが再起動を繰り返します。コレクターがバージョンを固定するのは `DOCKER_API_VERSION` で指定されたときだけですが、古いエージェントのファイルは `1.44` を固定しており、Docker Engine 20.10 から 24 はこれを拒否します。インストールスクリプトを再実行してください。現在のファイルがダウンロードされ、バージョンは空になります。次に、`/opt/oneuptime-docker-swarm-agent/.env` からバージョンを指定した `DOCKER_API_VERSION=` の行を外すか空にして (`DOCKER_API_VERSION=`)、コレクターが動いているすべてのノードで、`/opt/oneuptime-docker-swarm-agent` にて `docker compose up -d` を実行します。するとコレクターがデーモンとバージョンを交渉します。",
  "To pin a version anyway, use no more than the daemon's maximum, such as `DOCKER_API_VERSION=1.41`:":
    "それでもバージョンを固定する場合は、デーモンの上限を超えないようにします (例: `DOCKER_API_VERSION=1.41`):",
  "Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "新しいデーモンも古い API バージョンを引き続き提供するので、固定したバージョンは Docker をアップグレードした後も動き続けます。",
  "The cluster's name comes from `DOCKER_SWARM_CLUSTER_NAME`. Change it in `/opt/oneuptime-docker-swarm-agent/.env` and run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent` — note that a new name registers a new cluster.":
    "クラスターの名前は `DOCKER_SWARM_CLUSTER_NAME` から決まります。`/opt/oneuptime-docker-swarm-agent/.env` で変更し、`/opt/oneuptime-docker-swarm-agent` で `docker compose up -d` を実行します。新しい名前は新しいクラスターとして登録されることに注意してください。",
  "When it asks, enter the OneUptime URL and the ingestion key shown in step 1, and **`swarm-1`** as the cluster name — exactly, or the data registers as a new cluster.":
    "尋ねられたら、ステップ 1 に表示されている OneUptime URL と取り込みキーを入力し、クラスター名には **`swarm-1`** をそのとおりに入力します。違うとデータが新しいクラスターとして登録されます。",
  "Replace `my-swarm` with a name for this cluster, such as `prod-swarm`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "`my-swarm` をこのクラスターの名前 (例: `prod-swarm`) に置き換えます。OneUptime ではこの名前でクラスターが表示されるので、変えないでください。新しい名前は新しいクラスターとして登録されます。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` に入ります。",
  "Add this node's name to it. The collector puts it on the node's container metrics, and a Docker Swarm monitor's **Node Name** filter matches it:":
    "これにこのノードの名前を加えます。コレクターはそれをノードのコンテナメトリクスに付け、Docker Swarm モニターの **ノード名** フィルターはそれに一致します:",
  "Then start it:": "次に起動します:",
  "Run the agent on a **manager** node: the inventory poller and the OneUptime AI agent call manager-only API endpoints. The collector reports the containers of the node it runs on, so for per-node container metrics run the collector on every node, all with the same `DOCKER_SWARM_CLUSTER_NAME`; the inventory poller only needs to run on one manager.":
    "エージェントは **manager** ノードで実行してください。インベントリポーラーと OneUptime AI エージェントは manager だけが持つ API エンドポイントを呼び出します。コレクターは自分が動いているノードのコンテナを報告するので、ノードごとのコンテナメトリクスが必要なら、すべてのノードで同じ `DOCKER_SWARM_CLUSTER_NAME` を使ってコレクターを実行します。インベントリポーラーは 1 台の manager で動けば十分です。",
  "| `DOCKER_SWARM_NODE_NAME` | No | This node's name, stamped on its containers' metrics and logs as `docker.swarm.node.name` — what a Docker Swarm monitor's **Node Name** filter matches. Set it to the node's hostname, the name `docker node ls` shows: `echo \"DOCKER_SWARM_NODE_NAME=$(docker info --format '{{.Name}}')\" >> .env`. Empty: no node name is stamped |":
    "| `DOCKER_SWARM_NODE_NAME` | いいえ | このノードの名前で、そのコンテナのメトリクスとログに `docker.swarm.node.name` として付きます。Docker Swarm モニターの **ノード名** フィルターはこれに一致します。ノードのホスト名 (`docker node ls` が表示する名前) を設定してください: `echo \"DOCKER_SWARM_NODE_NAME=$(docker info --format '{{.Name}}')\" >> .env`。空の場合: ノード名は付きません |",
  "Set them in the `.env` next to docker-compose.yml, then run `docker compose up -d` to recreate the containers with the new values.":
    "docker-compose.yml の横にある `.env` に設定してから、`docker compose up -d` を実行して新しい値でコンテナを作り直します。",
  "- **Fixes are opt-in.** Set `ONEUPTIME_AI_ALLOW_WRITES=true` in the `.env` next to docker-compose.yml and run `docker compose up -d` in the agent's folder to let it roll a named service (`docker service update --force`), roll it back or scale it. `ONEUPTIME_AI_FIXES` in the same file says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the cluster's **AI → AI agent** page shows it. Draining a node always needs a person's approval. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs of service and node names) limits what fixes may touch; `ONEUPTIME_AI_PROTECTED_TARGETS` adds services it must never change. It never changes itself, the collector or the inventory poller.":
    "- **修正は許可したときだけです。** docker-compose.yml の横にある `.env` に `ONEUPTIME_AI_ALLOW_WRITES=true` を設定し、エージェントのフォルダーで `docker compose up -d` を実行すると、名前を指定したサービスの再デプロイ (`docker service update --force`)、ロールバック、スケールを許可できます。同じファイルの `ONEUPTIME_AI_FIXES` で、各修正に承認が必要かどうか (`ask-for-approval`、`automatic`、`bypass-approval`) を決め、クラスターの **AI → AI エージェント** ページにそれが表示されます。ノードのドレインには常に人の承認が必要です。`ONEUPTIME_AI_WRITE_TARGETS` (サービス名とノード名のカンマ区切りのグロブ) で修正の対象を絞り込み、`ONEUPTIME_AI_PROTECTED_TARGETS` で決して変更してはいけないサービスを追加します。自分自身、コレクター、インベントリポーラーは決して変更しません。",
  "- To leave it out, delete the `oneuptime-docker-swarm-ai-agent` service from docker-compose.yml.":
    "- 入れない場合は、docker-compose.yml から `oneuptime-docker-swarm-ai-agent` サービスを削除します。",
  "**Upgrade** — the collector image is pinned in docker-compose.yml and its config is a file next to it, so pulling alone does not move the agent forward. Download the three files again (the commands in step 2 — then re-apply any change you made to docker-compose.yml), and in the agent's folder:":
    "**アップグレード**: コレクターのイメージは docker-compose.yml で固定され、その設定は横にあるファイルなので、イメージを取得するだけではエージェントは新しくなりません。3 つのファイルをもう一度ダウンロードし (ステップ 2 のコマンド。その後、docker-compose.yml に加えた変更を適用し直します)、エージェントのフォルダーで次を実行します:",
  "**Uninstall** — in the agent's folder:":
    "**アンインストール**: エージェントのフォルダーで:",
  "Otherwise, check the collector's logs (`docker compose logs oneuptime-docker-swarm-agent` in the agent's folder), that `ONEUPTIME_SERVICE_TOKEN` and `ONEUPTIME_URL` in the `.env` next to docker-compose.yml are correct, and that the manager can reach your OneUptime instance.":
    "それ以外の場合は、コレクターのログ (エージェントのフォルダーでの `docker compose logs oneuptime-docker-swarm-agent`)、docker-compose.yml の横にある `.env` の `ONEUPTIME_SERVICE_TOKEN` と `ONEUPTIME_URL` が正しいこと、manager が OneUptime インスタンスに到達できることを確認します。",
  "The cluster is marked disconnected after 15 minutes without telemetry. Make sure the collector container (`oneuptime-docker-swarm-agent`) stays running — `docker compose ps` in the agent's folder shows it.":
    "テレメトリが 15 分届かないと、クラスターは切断済みとしてマークされます。コレクターのコンテナ (`oneuptime-docker-swarm-agent`) が動き続けていることを確認してください。エージェントのフォルダーで `docker compose ps` を実行すると表示されます。",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The collector pins a version only when `DOCKER_API_VERSION` names one, and older agent files pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Download the agent's files again (step 2), which leave the version empty. Then take any `DOCKER_API_VERSION=` line with a version out of the `.env` next to docker-compose.yml, or set it empty — `DOCKER_API_VERSION=` — and run `docker compose up -d` in the agent's folder, on every node the collector runs on. The collector then negotiates the version with the daemon.":
    "デーモンは自身の上限より新しいクライアントを拒否し、そのためコレクターが終了して、コンテナが再起動を繰り返します。コレクターがバージョンを固定するのは `DOCKER_API_VERSION` で指定されたときだけですが、古いエージェントのファイルは `1.44` を固定しており、Docker Engine 20.10 から 24 はこれを拒否します。エージェントのファイルをもう一度ダウンロードしてください (ステップ 2)。バージョンは空になります。次に、docker-compose.yml の横にある `.env` からバージョンを指定した `DOCKER_API_VERSION=` の行を外すか空にして (`DOCKER_API_VERSION=`)、コレクターが動いているすべてのノードで、エージェントのフォルダーにて `docker compose up -d` を実行します。するとコレクターがデーモンとバージョンを交渉します。",
  "The cluster's name comes from `DOCKER_SWARM_CLUSTER_NAME`. Change it in the `.env` next to docker-compose.yml and run `docker compose up -d` in the agent's folder — note that a new name registers a new cluster.":
    "クラスターの名前は `DOCKER_SWARM_CLUSTER_NAME` から決まります。docker-compose.yml の横にある `.env` で変更し、エージェントのフォルダーで `docker compose up -d` を実行します。新しい名前は新しいクラスターとして登録されることに注意してください。",
  "This installs the agent for **`swarm-1`** — keep `DOCKER_SWARM_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "これは **`swarm-1`** 用にエージェントをインストールします。`DOCKER_SWARM_CLUSTER_NAME` はそのまま変えないでください。変えるとデータが新しいクラスターとして登録されます。",
};

export default TRANSLATION;
