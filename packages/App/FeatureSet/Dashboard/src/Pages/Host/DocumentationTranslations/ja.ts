import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Japanese (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Japanese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Japanese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "監視したいホストに Docker がインストールされていること",
  "Network access from the host to your OneUptime instance":
    "ホストから OneUptime インスタンスへのネットワークアクセス",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "これを、`docker run` を実行するディレクトリに `config.yaml` として保存します。ステップ 3 でコンテナーにマウントします。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` に入ります。",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`、`--pid host`、`/hostfs` のバインドマウントにより、`hostmetrics` と `process` のスクレーパーは CPU、メモリ、ディスク、プロセスごとの情報をコンテナーではなくホストのカーネルから読み取れます。これらがないと、コレクターのコンテナー自体のメトリクスしか見えません。",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "OneUptime で **ホスト** の一覧を開きます。最初のメトリクスのバッチが届くと (通常 30 秒以内)、ホストが自動的に表示されます。表示されない場合は、コレクターを確認します:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI 調査はすべてのホストで既定でオンです**。ホスト AI エージェントがそのホストで動き始めると、OneUptime AI は `systemctl status`、`df -h`、`free -m`、`ps aux` などの読み取り専用コマンドでそのホストのインシデントとアラートを調査し、修正を許可しない限り何も変更しません。これは専用のインストーラーを持つ Linux コンテナーです。そのため Linux ホストにのみ追加してください。Compose プラグイン付きの Docker (rootless Docker ではなくシステムのエンジン) が必要です:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "1 行目でスクリプトを `install.sh` としてダウンロードするので、実行する前に内容を読めます。スクリプトは OneUptime の URL、取り込みキー、ホスト名を尋ねます。名前を空のままにすると、このコレクターが報告するホスト名が使われます。接続されると、ホストの **AI → AI エージェント** ページと **概要** の下部に接続済みとして表示されます。実行できるコマンドと修正のしくみ: [インフラストラクチャ AI エージェント](/docs/ai/infrastructure-ai-agents#hosts)。",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "設定はすでに、マシンの IP アドレス、MAC アドレス、アーキテクチャ、マシン ID、OS の説明と OS のバージョンを、**インベントリ** のそのマシンの項目に入れています。CMDB のエクスポートが読むのはこの項目です。シリアル番号、メーカー、モデル、ファームウェア (BIOS / UEFI) のバージョンは事情が異なり、**どのリソース検出器もこれらを取得できません**。これらは DMI を通じてマシンのファームウェアから取得します。プロビジョニング時に一度読み取り、リソースに書き込みます。このプロセッサーをコンテナーにマウントした `config.yaml`に追加し、メトリクスパイプラインで指定します。設定にすでにあるセクションに統合してください。`processors:` や `service:` のキーを 2 つ目として追加しないでください。",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "その後、編集したファイルを読み込むようにコンテナーを作り直します。コンテナーを削除し、ステップ 3 の `docker run` コマンドをもう一度実行します:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "これらの値はマシン固有のものなので、マシンをプロビジョニングする仕組みが一度だけ書き込みます。Linux では root で読み取ります (`bios_version` は誰でも読めます):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "数分以内に、**インベントリ** のマシンの項目の **詳細** に値が表示されます。値は検出ではなく書き込んだものなので、マザーボードの交換やファームウェアの更新の後にはもう一度実行してください。",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`、`host.model.name`、`host.firmware.version`、`host.bios.version` も別の表記として受け付けられ、上の `device.*` キーに保存されます (`device.serial_number` は `host.serial_number` に保存されます)。そのため、どちらの書き方の設定でも同じ場所に入ります。",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **同じ設定から、モバイルアプリのリソースとホストのリソースの両方に `device.manufacturer` を設定しないでください。** `host.name` も `host.id` もないリソースでは、`device.manufacturer` があるとバッチはモバイルの Real User Monitoring と見なされます。",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "`oneuptime.label.` で始まるリソース属性は、プロジェクトのラベルに昇格してホスト (およびこのコレクターが出力するテレメトリサービス) に付けられます。パターン: `oneuptime.label.<dimension>=<value>` は `<dimension>:<value>` という名前のラベルになります。",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`resource` プロセッサーをコンテナーにマウントした `config.yaml`に追加し、メトリクスパイプラインから参照します。設定にすでにあるセクションに統合してください。`processors:` や `service:` のキーを 2 つ目として追加しないでください。",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "ホストには `team:payments`、`env:production`、`region:us-east-1` のタグが付いて表示されます。ラベルは大文字と小文字を区別せずに照合されるため、手動で作成した既存の `Production` ラベルは重複せずに再利用されます。OneUptime の UI で手動で追加したラベルを、コレクターが削除することはありません。",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "ホストは OTel のリソース属性 `host.name` から自動的に検出されます。この属性は `resourcedetection` プロセッサーが設定します。OneUptime は、`host.name` を含むバッチが次のいずれかも含んでいる時点でホストを登録します:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- `hostmetrics` レシーバーのメトリクス (CPU、メモリ、ディスク、ファイルシステム、ネットワーク、負荷、プロセス)、または",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- `process` スクレーパーのメトリクス (プロセスごとの CPU/メモリ/スレッド)、または",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- メトリクス、ログ、トレースのいずれかに付いた、`os.type` または `container.runtime` のリソース属性",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…そして、概要、メトリクス、プロセス、ログの各タブを埋め始めます。`host.id` や `host.arch` だけではホストは登録されません。また、Kubernetes の ID (`k8s.cluster.name`、`k8s.node.name`、`k8s.pod.name`、…) を持つテレメトリは、代わりにその Kubernetes クラスターの下に分類されます。",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**OpenStack 上で動いていますか？** `detectors: [nova, system, env]` を使うと、`host.id` がインスタンスの UUID になり、OneUptime がこのホストをそのインスタンスに関連付けます。さらに `nova: resource_attributes:` の下で `host.name` を `enabled: false` にすると、名前は `system` が報告するもののままになります。",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "同じリソース属性が、**インベントリ** のマシンの項目になります。CMDB のエクスポートが読むのはこの項目です。`host.ip`、`host.mac`、`host.arch`、`host.id`、`os.type`、`os.description`、`os.version` はすべて `resourcedetection` プロセッサーから来ます。シリアル番号、メーカー、モデル、ファームウェアのバージョンには検出器がないため、別に書き込みます (**シリアル番号、メーカー、モデル、ファームウェアのバージョンを記録** を参照)。",
  "Once the host is reporting:": "ホストがデータを送り始めると:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- **メトリクス** タブに `system.*` の時系列が表示されます。",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- `process` スクレーパーを有効にすると、**プロセス** タブにプロセスが CPU 順に一覧表示されます。",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- **ログ** タブには、リソース属性に `host.name` を含むログがすべて流れます。",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "設定は、対象とするコレクターのリリース (`oneuptime.agent.version`) をホストの **エージェントバージョン** として報告します。この OneUptime がより新しいリリースを固定すると、その横の警告マークからこれらの手順が開きます。",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. ステップ 2 の設定を、同じ取り込みキーでもう一度保存します。新しいバージョンが報告されるようになります。自分の設定に加えた変更は、すべて移し替えてください。",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. 設定のあるフォルダーで新しいリリースをインストールし、コレクターを再起動します:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. コレクターのログでエクスポートエラーを確認します: `docker logs -f otel-collector`。HTTP `401` はキーがない、誤っている、または期限切れであることを、`422` は無効化されている (またはホストのテレメトリを送信できないブラウザーキーである) ことを意味します。ステップ 1 で有効なキーを選び、コンテナーにマウントした `config.yaml`の `x-oneuptime-token` を更新してください。",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. ホストが OneUptime に到達できることを確認します: 同じマシンから `curl -v <YOUR_ONEUPTIME_URL>/otlp`。",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. メトリクスパイプラインに `resourcedetection` を残してください。これが `host.name` を設定し、OneUptime はそれでホストを認識します。",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "コレクターが自分のコンテナーから見たカーネルを読んでいます。ステップ 3 のとおり、`--network host`、`--pid host`、`/:/hostfs` のバインドマウント、`HOST_*` 変数を付けて実行してください。これらがないと、`hostmetrics` と `process` のスクレーパーにはコレクターのコンテナー自体しか見えません。",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "`sudo` を使える Debian または Ubuntu のホスト (amd64 または arm64)",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "これを現在のディレクトリに `config.yaml` として保存します。ステップ 3 でインストールします。",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **ネイティブインストールについての注意:** Docker と違い、パッケージのインストールは `/proc` と `/sys` を直接読むため、`HOST_PROC` 環境変数も `/hostfs` のマウントも不要です。パッケージに付属の systemd ユニットは非特権ユーザー `otelcol-contrib` として動きます。`process` スクレーパーに他のユーザーのプロセスを見せたい場合は、`CAP_SYS_PTRACE` を付与するか root で実行してください。",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` には **v0.142.0** から `systemd` レシーバーが同梱されています。CPU メトリクスが現在の名前に落ち着き、サービス以外のユニットを問い合わせなくなった **v0.143.0 以降** を使ってください。`/etc/otelcol-contrib/config.yaml` とメトリクスパイプラインに追加すると有効になります。設定にすでにあるセクションに統合してください。`processors:` や `service:` のキーを 2 つ目として追加しないでください。",
  "Then restart the service:": "その後、サービスを再起動します:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "このレシーバーは **Linux 専用** で **アルファ版** です。`systemctl list-units` と同じ読み取り専用の呼び出しでシステムの D-Bus からユニットの状態を読み、systemd はこれを特権なしで許可しているため、`otelcol-contrib` ユーザーとして動くパッケージのサービスに追加の権限は要りません。コンテナー化したコレクターはホストのバスに到達できないので、ネイティブインストールを使ってください。メトリクスが届くと、ホストの **Systemd ユニット** タブに、収集した各ユニットとその現在の状態 (`active`、`failed`、`inactive`、...) が表示されます。",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "各ユニットは収集のたびに状態セット用に 8 つ、CPU メトリクスを有効のままにするとさらに 2 つのデータポイントを使います。そのため、ユニットが数百あるホストでは、すべてを収集せずに `units:` を絞り込むか `collection_interval` を長くしてください。",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI 調査はすべてのホストで既定でオンです**。ホスト AI エージェントがそのホストで動き始めると、OneUptime AI は `systemctl status`、`df -h`、`free -m`、`ps aux` などの読み取り専用コマンドでそのホストのインシデントとアラートを調査し、修正を許可しない限り何も変更しません。これは専用のインストーラーを持つ Linux コンテナーです。Compose プラグイン付きの Docker (rootless Docker ではなくシステムのエンジン) が必要です:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "設定はすでに、マシンの IP アドレス、MAC アドレス、アーキテクチャ、マシン ID、OS の説明と OS のバージョンを、**インベントリ** のそのマシンの項目に入れています。CMDB のエクスポートが読むのはこの項目です。シリアル番号、メーカー、モデル、ファームウェア (BIOS / UEFI) のバージョンは事情が異なり、**どのリソース検出器もこれらを取得できません**。これらは DMI を通じてマシンのファームウェアから取得しますが、パッケージのコレクターは特権なしで動くため、自分では読み取れません。プロビジョニング時に一度読み取り、リソースに書き込みます。このプロセッサーを`/etc/otelcol-contrib/config.yaml`に追加し、メトリクスパイプラインで指定します。設定にすでにあるセクションに統合してください。`processors:` や `service:` のキーを 2 つ目として追加しないでください。",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`resource` プロセッサーを`/etc/otelcol-contrib/config.yaml`に追加し、メトリクスパイプラインから参照します。設定にすでにあるセクションに統合してください。`processors:` や `service:` のキーを 2 つ目として追加しないでください。",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- `systemd` レシーバーを有効にすると、**Systemd ユニット** タブにユニットの状態が一覧表示されます (**「Systemd ユニット」タブを有効化** を参照)。",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. コレクターのログでエクスポートエラーを確認します: `sudo journalctl -u otelcol-contrib -f`。HTTP `401` はキーがない、誤っている、または期限切れであることを、`422` は無効化されている (またはホストのテレメトリを送信できないブラウザーキーである) ことを意味します。ステップ 1 で有効なキーを選び、`/etc/otelcol-contrib/config.yaml`の `x-oneuptime-token` を更新してください。",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. `resourcedetection` は `systemd` レシーバーと同じメトリクスパイプラインに残してください。レシーバーは各ユニットに `systemd.unit.name` しか付けないため、`host.name` がないとサンプルがホストに結び付きません。",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. `otelcol-contrib` v0.143.0 以降を使ってください。それより古いビルドは起動時に `'receivers' unknown type: \"systemd\"` で止まるか、CPU メトリクスを別の名前で出します (**「Systemd ユニット」タブを有効化** を参照)。",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. コレクターがシステムの D-Bus に到達できることを確認します。`/run/dbus/system_bus_socket` が存在する必要があり、コレクターのユーザーで `systemctl list-units` を実行するのが最も手早い確認方法です。root は不要です。",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "`sudo` を使える RHEL、CentOS、Fedora または Amazon Linux のホスト (x86_64 または aarch64)",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "systemd が動き、`sudo` を使える Linux ホスト (x86_64 または aarch64)",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "`/etc/systemd/system/otelcol-contrib.service` に systemd ユニットを置きます:",
  "Then enable and start it:": "その後、有効にして起動します:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "パッケージが使えない場合に使います。たとえば、制限の厳しいサーバーや、外部から計装したいコンテナーのベースイメージです。`HOST_PROC` 環境変数も `/hostfs` のマウントも不要です。コレクターはカーネルの状態を直接読み、`User=root` により `process` スクレーパーは他のユーザーのプロセスも見られます (代わりに `CAP_SYS_PTRACE` を付与しても動きます)。",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "このレシーバーは **Linux 専用** で **アルファ版** です。`systemctl list-units` と同じ読み取り専用の呼び出しでシステムの D-Bus からユニットの状態を読み、systemd はこれを特権なしで許可しているため、追加の権限は要りません。コンテナー化したコレクターはホストのバスに到達できないので、ネイティブインストールを使ってください。メトリクスが届くと、ホストの **Systemd ユニット** タブに、収集した各ユニットとその現在の状態 (`active`、`failed`、`inactive`、...) が表示されます。",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "設定はすでに、マシンの IP アドレス、MAC アドレス、アーキテクチャ、マシン ID、OS の説明と OS のバージョンを、**インベントリ** のそのマシンの項目に入れています。CMDB のエクスポートが読むのはこの項目です。シリアル番号、メーカー、モデル、ファームウェア (BIOS / UEFI) のバージョンは事情が異なり、**どのリソース検出器もこれらを取得できません**。これらは DMI を通じてマシンのファームウェアから取得します。プロビジョニング時に一度読み取り、リソースに書き込みます。このプロセッサーを`/opt/otelcol-contrib/config.yaml`に追加し、メトリクスパイプラインで指定します。設定にすでにあるセクションに統合してください。`processors:` や `service:` のキーを 2 つ目として追加しないでください。",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "Mac (Apple シリコンまたは Intel) と、`sudo` 用の管理者アカウント",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "`/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist` を作成します:",
  "Load it:": "読み込みます:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **上のとおり contrib ビルドをインストールしてください。** core の `otelcol` ビルドには `resourcedetection` プロセッサーがないため、この設定では起動しません。",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "設定はすでに、マシンの IP アドレス、MAC アドレス、アーキテクチャ、マシン ID、OS の説明と OS のバージョンを、**インベントリ** のそのマシンの項目に入れています。CMDB のエクスポートが読むのはこの項目です。シリアル番号、メーカー、モデル、ファームウェア (BIOS / UEFI) のバージョンは事情が異なり、**どのリソース検出器もこれらを取得できません**。これらはマシンのファームウェアから取得します。プロビジョニング時に一度読み取り、リソースに書き込みます。このプロセッサーを`/etc/otelcol-contrib/config.yaml`に追加し、メトリクスパイプラインで指定します。設定にすでにあるセクションに統合してください。`processors:` や `service:` のキーを 2 つ目として追加しないでください。",
  "Then restart the collector:": "その後、コレクターを再起動します:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "これらの値はマシン固有のものなので、マシンをプロビジョニングする仕組みが一度だけ書き込みます。Mac では次のように読み取ります。メーカーは `Apple Inc.` です:",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` はモデルの *識別子* (`MacBookPro18,3`) で、製品名ではありません。それでも `device.model.name` に入れてください。`device.model.identifier` を使うとバッチがモバイルアプリと見なされます。",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803 以降または Windows Server 2019 以降 (組み込みの `tar.exe` のため)",
  "An elevated PowerShell prompt (Run as administrator)":
    "管理者として実行した PowerShell プロンプト",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "これを、PowerShell のコマンドを実行するフォルダーに `config.yaml` として保存します。ステップ 3 でこれを所定の場所にコピーします。",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "Windows では、アップストリームの **`otelcol-contrib`** コレクターをインストールします。**v0.155.0** 以降には、ホストの **サービス** タブを支える `windows_service` レシーバーが同梱されています。管理者として実行した PowerShell プロンプトで実行します:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **注意:** サービスはすべての Windows サービスを読めるように `LocalSystem` として動きます。Windows の `load` スクレーパーは *Processor Queue Length* カウンターから負荷平均をエミュレートするだけで (0 から始まります)、カウンターを読めない場合はログに記録して省略し、`hostmetrics` の残りの設定はそのまま動きます。[ホスト向け OpenTelemetry Collector のドキュメント](/docs/telemetry/host-otel-collector) では、署名付きの `.msi` インストーラーも扱っています。",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "ログは Windows のアプリケーションイベントログに書き込まれます。**Event Viewer → Windows Logs → Application** (ソース `otelcol-contrib`) で確認します。",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "**v0.155.0** 以降の `otelcol-contrib` には `windows_service` レシーバーが含まれています。`C:\\Program Files\\otelcol-contrib\\config.yaml` とメトリクスパイプラインに追加すると有効になります。設定にすでにあるセクションに統合してください。`processors:` や `service:` のキーを 2 つ目として追加しないでください。",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "このレシーバーは **Windows 専用** で **アルファ版** です。メトリクスが届くと、ホストの **サービス** タブに各サービスの実行状態とスタートアップの種類が自動的に表示されます。",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "設定はすでに、マシンの IP アドレス、MAC アドレス、アーキテクチャ、マシン ID、OS の説明と OS のバージョンを、**インベントリ** のそのマシンの項目に入れています。CMDB のエクスポートが読むのはこの項目です。シリアル番号、メーカー、モデル、ファームウェア (BIOS / UEFI) のバージョンは事情が異なり、**どのリソース検出器もこれらを取得できません**。これらは WMI を通じてマシンのファームウェアから取得します。",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "マシン上で、管理者として実行した PowerShell プロンプトからこれを実行します。WMI を照会し、*このマシン* 用の正確な YAML を出力します:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "インデント済みのプロセッサーのエントリが 1 つ出力されます。`config.yaml` にすでにある `processors:` ブロックの中に、`resourcedetection:`、`resource:`、`batch:` と並べて追加し (2 つ目の `processors:` キーにはしないでください)、メトリクスパイプラインで指定します:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "非推奨の `Get-WmiObject` ではなく `Get-CimInstance` を使ってください。前者は PowerShell 7 以降にはありません。値はシングルクォートで囲まれ、内部の引用符は二重にして出力されるので、記号を含むシリアル番号やモデルでも有効な YAML のままです。ファームウェアが空のままにしている項目は `''` と出力されます。空の属性を送らず、その属性を削除してください。",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "数分以内に、**インベントリ** のマシンの項目の **詳細** に、検出器がすでに提供している IP アドレス、MAC アドレス、マシン ID と並んで、`host.serial_number`、`device.manufacturer`、`device.model.name`、`device.firmware.version` が表示されます。値は検出ではなく書き込んだものなので自動では更新されません。マザーボードの交換や BIOS の更新の後にはもう一度実行してください。",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- `windows_service` レシーバーを有効にすると、**サービス** タブに各サービスの状態が一覧表示されます (**「Windows サービス」タブを有効化** を参照)。",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. コレクターのログでエクスポートエラーを確認します: **Event Viewer → Windows Logs → Application** (ソース `otelcol-contrib`)。HTTP `401` はキーがない、誤っている、または期限切れであることを、`422` は無効化されている (またはホストのテレメトリを送信できないブラウザーキーである) ことを意味します。ステップ 1 で有効なキーを選び、`C:\\Program Files\\otelcol-contrib\\config.yaml`の `x-oneuptime-token` を更新してください。",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. 汎用的な `Error 1064` ではなく本当のエラーを見るため、コレクターをフォアグラウンドで実行します:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` は、サービスが存在しないファイルを指していることを意味します。`sc.exe qc "otelcol-contrib"` の `BINARY_PATH_NAME` を `C:\\Program Files\\otelcol-contrib` の内容と比べてください。アーカイブは `otelcol-contrib.exe` を展開する `otelcol-contrib_` のものでなければなりません。',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (ソース `otelcol-contrib`) には、サービスマネージャーが握りつぶした起動エラーが記録されています。",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "`include_services` を設定してもすべてのサービスが表示される場合、コレクターは変更を読み込んでいません。サービスを再起動し (`Restart-Service otelcol-contrib`)、サービスタブが移動ウィンドウを更新するまで数分待ってください。",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Kubernetes のノードは、ホストのコレクターではなく **OneUptime Kubernetes エージェント** が監視します。各ノードは **ホスト** の一覧ではなく、**Kubernetes** → 対象のクラスター → **ノード** に、そのポッドやワークロードと並んで表示されます。以下の手順は標準的なクラスターにエージェントをインストールします。Amazon EKS、Google GKE、Azure AKS、GKE Autopilot、EKS Fargate の手順は、**Kubernetes** セクションのインストールガイドにあります。",
  "A Kubernetes cluster running v1.23 or later":
    "v1.23 以降で動作する Kubernetes クラスター",
  "`kubectl` and `helm` (v3) installed on your machine":
    "お使いのマシンにインストールされた `kubectl` と `helm` (v3)",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "クラスターが違いますか？ `kubectl config use-context <context-name>` で切り替えます。",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "`my-cluster` をこのクラスターの名前 (例: `prod-us-east-1`) に置き換えます。OneUptime ではこの名前でクラスターが表示されるので、変えないでください。新しい名前は新しいクラスターとして登録されます。",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` は、chart の既定どおり **AI 調査** をオンにします。OneUptime AI は Kubernetes AI エージェントを通じて、読み取り専用の kubectl でこのクラスターのインシデントやアラートを調査します。",
  "You should see:": "次のように表示されます:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "コレクターと Kubernetes AI エージェント、さらに各ノードに `-logs` と `-ebpf` の Pod が 1 つずつ。これらが `Running` になると、クラスターは **Kubernetes** セクションに自動で表示されます。通常は 1、2 分です。",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes AI エージェント (既定でオン、読み取り専用)。** `kubernetes-agent-ai-agent` Pod は、同じ API キーを使い、読み取り専用の kubectl (`get`、`describe`、`logs`、`events`、`top`) で OneUptime AI がこのクラスターのインシデントやアラートを調査できるようにします。後で書き込み権限を与えない限り、何も変更できません。確認するには、クラスターを開いて **AI → エージェント** に移動します。不要ですか？ `--set aiAgent.enabled=true` の代わりに `--set aiAgent.enabled=false` を付けてインストールしてください。",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "名前空間のルールで、エージェントが各名前空間から何を収集するかが決まります。`default`、`production`、`staging` からだけ Pod のログと eBPF データを収集するには:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "すべてを残しつつ、ノイズの多い名前空間のログだけを止めるには、それらを `podLogs` からだけ除外します:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **スコープ:** `podLogs` (コンテナーの stdout/stderr)、`ebpfDiscovery` (eBPF のトレースとメトリクス)、`metrics` (名前空間のあるメトリクス)、`traces` (すべてのスパン)。",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **パターン** は名前空間の名前全体に一致し、`team-*` のように `*` を使えます。`exclude` ルールは常に `include` ルールより優先されます。",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **ルールを設定すると既定のルールが置き換わります**。既定のルールは `kube-system` を `podLogs` と `ebpfDiscovery` から除外します。引き続き必要なら、2 つ目の例のように一覧に残してください。",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- ノードとクラスターのメトリクスには名前空間がないため、常に残ります。",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` には Helm 3.10 以降が必要です。",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**重要な行だけを送る。** クラスターから出る前に、一定の重大度未満の Pod のログ行を破棄します:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    '`TRACE`、`DEBUG`、`INFO`、`WARN`、`ERROR`、`FATAL` を受け付けます。`WARN` は警告、エラー、致命的な行を残します。重大度はログ行そのもの (`[ERROR]`、`level=warn`、`"level":"info"`) から読み取ります。Kubernetes のイベントがこれで破棄されることはありません。',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Pod のログをオフにする。** メトリクスには影響しません。ノードコレクターは kubelet と cAdvisor のメトリクスのために動き続け、Pod のログを読むのをやめるだけです:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**ログの読み方を変える。** プリセットが自動で選びますが、明示した `logs.mode` が常に優先されます:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: 各ノードの `/var/log/pods` を hostPath 経由で読みます (オーバーヘッドが最も小さい。hostPath が必要)。",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: Deployment が Kubernetes API を通じて Pod のログを追跡します (どのクラスターでも動作)。",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: Pod のログを収集しません。",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "これで、クラスター内で応答する API サーバーを読み取ります。etcd、スケジューラー、コントローラーマネージャーはコントロールプレーンのノードで応答し、エージェントの Pod はそれを推測できないため、各ノードのアドレスを指定すると読み取ります:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **スケジューラーとコントローラーマネージャー** は HTTPS を提供し、エージェントのトークンを受け付けますが、kubeadm はこれらを `127.0.0.1` にバインドします。エージェントの Pod から到達できる `--bind-address` を指定してください。",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** は、前述のとおり kubeadm の `--listen-metrics-urls` (ポート 2381。ノードのアドレスを追加するまで `127.0.0.1` にバインド) で平文 HTTP のメトリクスを提供します。または、要求されるクライアント証明書を使って HTTPS のクライアントポート 2379 を収集します。`ca.crt`、`tls.crt`、`tls.key` を `oneuptime-agent` の Secret に入れ、`controlPlane.etcd.clientCertSecret` にその名前を指定してください。",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "自己管理クラスターのみ: マネージドサービス (EKS、GKE、AKS) はコントロールプレーンのメトリクスを公開しません。",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "コストの監視は既定でオンです。エージェントにはオープンソースの OpenCost エンジン (と、それが必要とする小さな Prometheus) が含まれ、クラウドプロバイダーの公開価格表をもとにノードとボリュームに価格を付け (認証情報は不要です)、各名前空間とワークロードのコストを送信します。最初の 1 時間が経過した後、クラスターの概要ページと「コスト」ページに最初のデータが表示されます。",
  "On an agent installed before it was on by default, upgrade it:":
    "既定でオンになる前にインストールしたエージェントでは、次のようにアップグレードします:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **オフにするには:** 同じアップグレードに `--set cost.enabled=false` を追加します。",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **すでに Kubecost や OpenCost を使っていますか？** エージェントがそれを見つけて同梱のエンジンの代わりに読み取り、クラスターの概要ページにもそう表示されます。2 つ目のエンジンを同梱しないようにするには、`--set cost.engine.url=auto` を追加します。",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **オンプレミスやベアメタルですか？** `--set cost.opencost.customPricing.enabled=true` で料金表を設定します (リソース時間あたりの USD。chart の `values.yaml` を参照)。",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "詳しいガイド: [Kubernetes のコストオブザーバビリティ](/docs/telemetry/kubernetes-cost)。",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "エージェントは各ノードで [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) を実行します。Go、.NET、Java、Node.js、Python、Ruby、Rust のサービスの HTTP/HTTPS、gRPC、SQL/Redis のトラフィックを、SDK もサイドカーもなしで捕捉し、トレース、リクエスト (RED) メトリクス、サービスグラフのデータをコレクター経由で送信します。",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**要件:** BTF 付きの Linux カーネル **5.8+** (Debian 11+、Ubuntu 20.10+、Fedora 34+、RHEL 9+ では既定)。eBPF の Pod は eBPF プログラムを読み込むために **特権** で動作します。",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "ノードのカーネルが古い場合、特権 Pod が許可されていない場合、またはサービスがすでに OpenTelemetry SDK でトレースを送っていて重複を避けたい場合は、**オフにします**:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**シグナルを選ぶ。** 各ファミリーは `--set ebpf.features.<name>=false` (または `=true`) で切り替えます:",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | 既定 | 追加されるもの |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | オン | サービスごとの HTTP/gRPC のリクエスト率、エラー、レイテンシー |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | オン | スパンの呼び出し数と所要時間 (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | オン | 呼び出し元 → 呼び出し先のエッジ。サービスマップを作ります |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | オン | Pod 間の TCP/UDP フローのカウンター |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | オフ | ゾーン間のネットワークメトリクス (カーディナリティが 2 倍になります) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | オン | ノード単位の TCP RTT、接続失敗と再送のカウンター |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**サービス間のトレース伝搬** (Pod A → Pod B へ渡るリクエストを、別のノード上でも 1 つのトレースにつなぐこと) は **既定でオン** です。これはすでに流れているトラフィックを書き換えて動作します (カーネル内で平文の HTTP リクエストを広げ、TLS と生の TCP に TCP オプションを追加します)。このバイト計算に誤りがあるとストリームが非同期になり、報告されている症状は、nginx などの L7 プロキシを通る転送が、レスポンスが ~64KB を超えたところで止まることです。これが見られる場合や、サービスメッシュで Pod が失敗し始めた場合は、`--set ebpf.contextPropagation=false` でオフにしてください。OpenTelemetry SDK は、こうしたことをせずにユーザー空間で `traceparent` を伝搬します。",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "各 `oneuptime.labels.<key>=<value>` は、クラスターと、それが報告するサービスやホストのラベル `<key>:<value>` になります。ラベルは大文字と小文字を区別せずに照合されるため、既存の `Production` ラベルが再利用されます。OneUptime の画面で追加したラベルを、エージェントが削除することはありません。",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "最新の chart に **アップグレード** します。`--reset-then-reuse-values` (Helm 3.14+) は設定した値 (プリセット、クラスター名、フィルター) を残し、それ以外はすべて新しい chart から取ります。新しい `--set` フラグはその上に追加してください:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Helm 3.13 以前では、代わりに設定した値を指定してアップグレードします:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "`--reuse-values` は使わないでください。アップグレード元の chart の既定値まで残るため、新しい chart の既定値 (eBPF イメージなど) が適用されなくなります。",
  "**Uninstall** the agent and its namespace:":
    "エージェントとその名前空間を **アンインストール** します:",
  "| Category | Data |": "| カテゴリー | データ |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **ノードのメトリクス** | CPU、メモリ、ファイルシステム、ネットワークの使用量 |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod とコンテナーのメトリクス** | CPU、メモリ、ネットワーク I/O、再起動 |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **クラスターのメトリクス** | ノードの状態、割り当て可能なリソース、Pod とワークロードの数 |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes のイベント** | 警告、エラー、スケジューリングのイベント |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Pod のログ** | 各ノードで読み取る、すべてのコンテナーの stdout/stderr |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **アプリケーショントレース** *(eBPF)* | すべての Pod からの HTTP、gRPC、SQL/Redis のスパン。SDK もコード変更も不要 |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **リクエストのメトリクスとサービスグラフ** *(eBPF)* | サービスごとのリクエスト率、エラー、レイテンシーと、サービスマップ用の呼び出し元 → 呼び出し先のエッジ |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **ネットワークフロー** *(eBPF)* | Pod 間の TCP/UDP のバイト数とパケット数のカウンター |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **ワークロードのコスト** *(既定でオン)* | 名前空間、ワークロード、Pod ごとの支出と、アイドル容量および効率。アラートを設定できるメトリクスとしても提供 |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "クラスターが `hostPath` ボリュームか特権 Pod をブロックしています。**GKE Autopilot** と **EKS Fargate** ではこれが普通です。このガイドの上部でそのプラットフォームを選び、手順に従ってください。一方 **OpenShift** ではインストール自体は成功しますが、エージェントのノード Pod が起動しません。**Red Hat OpenShift** を選んでください。",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "制限の厳しい Pod Security ポリシーを持つほかのクラスターでは、失敗したリリースを削除します:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "その後、`--set preset=gke-autopilot` を付けてインストールコマンドをもう一度実行します。このプリセットは hostPath の代わりに Kubernetes API を通じて Pod のログを読み、強化されたセキュリティコンテキストを適用し、特権が必要な eBPF とプロファイリングの Pod を含めません。",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. エージェントの Pod が動いていることを確認します: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. コレクターのログを確認します: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. インストールコマンドの OneUptime の URL と取り込みキーが正しいことを確認します。",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. クラスターからネットワーク経由で OneUptime インスタンスに到達できることを確認します。",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. AI エージェントの Pod を確認します: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. そのログを確認します: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Pod がありませんか？ chart をアップグレードし (「詳細」の **エージェントをアップグレードまたはアンインストール** を参照)、`--set aiAgent.enabled=true` を追加してください。",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. クラスター名が一致していることを確認します。このガイドがインストールするのは **`my-cluster`** です。",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. エージェントの RBAC 権限を確認します: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. コレクターのログでエクスポートのエラーを探します: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **カーネルが古いか BTF がない。** eBPF には BTF 付きの Linux 5.8+ が必要です。ノードで `uname -r` を実行して確認してください。アップグレードできない場合は、`--set ebpf.enabled=false` で eBPF をオフにします。",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **特権 Pod がブロックされている。** 制限の厳しいクラスターの中には特権 Pod を拒否するものがあります。eBPF をオフにしてください。",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **ホストで `debugfs` / `tracefs` が使えない。** TCP 統計のファミリーだけをオフにします: `--set ebpf.features.tcpStats=false`。",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. eBPF の Pod が正常であることを確認します: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. OBI のデバッグ出力をオンにして、トラフィックが見えていることを確かめます: `--set ebpf.printTraces=true --set ebpf.logLevel=debug` を設定し、`kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200` を読みます。",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. スパンがそこには出るのに OneUptime に出ない場合は、コレクターのログでエクスポートのエラーを確認します: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
