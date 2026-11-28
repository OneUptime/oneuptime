import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The OpenStack setup guide in Japanese (#8341): each piece of the English
 * guide's markdown (Pages/OpenStack/Utils/DocumentationMarkdown.ts) and its
 * Japanese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Japanese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "With `enable_prometheus` on in `/etc/kolla/globals.yml`, which Kolla-Ansible leaves off until you set it, it runs Prometheus, Alertmanager and an exporter for each thing under the cloud, and ships no alert rules. This guide reads what those run rather than starting a second copy.":
    "`/etc/kolla/globals.yml` で `enable_prometheus` をオンにすると (Kolla-Ansible は設定するまでオフのままにします)、Prometheus、Alertmanager、そしてクラウドを支える各コンポーネントのエクスポーターが動き、アラートルールは同梱されません。このガイドは 2 つ目のコピーを起動せず、それらが動かしているものを読み取ります。",
  "**How far this guide has been tested:** Its paths and ports were read from Kolla-Ansible's own source. Its commands were then run on a real all-in-one at stable/2026.1 with Open vSwitch, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, without Docker, on Kolla-Ansible's own exporter and on your own at the pinned version and at 1.7.0, the agent's exporter on the Infrastructure only credential, the targets read from its real prometheus.yml, and the logs profile. With Memcached really stopped there, its Alertmanager posted a firing webhook and then a resolved one, and what it posted, sent to a running OneUptime, opened one incident on the right cloud and on no other, and resolved it. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**このガイドのテスト範囲:** パスとポートは Kolla-Ansible 自身のソースから読み取りました。そのうえでコマンドを、stable/2026.1 と Open vSwitch の実際の all-in-one で、エージェントが送ったものを保持する OneUptime の代役を相手に実行しました。対象は、フルビューの認証情報でのエージェント (Docker なし、Kolla-Ansible 自身のエクスポーターと、固定バージョンおよび 1.7.0 のご自身のエクスポーター)、インフラのみの認証情報でのエージェントのエクスポーター、実際の prometheus.yml から読んだターゲット、そしてログプロファイルです。そこで Memcached を実際に停止すると、Alertmanager は発火の Webhook に続いて解決の Webhook を送り、それを稼働中の OneUptime に送ると、正しいクラウドにだけインシデントが 1 件開き、解決されました。エージェントとプローブはそれぞれ、実際の DevStack を、nova-compute の停止と復旧を経て、稼働中の OneUptime まで通しましたが、このツールからではありません。",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent (or `bash install.sh --without-docker`, under Advanced)":
    "Docker Engine 20.10 以降と Docker Compose v2 プラグインが入った、エージェントを動かすマシン (または「詳細」にある `bash install.sh --without-docker`)",
  "A machine outside the cloud it watches: an agent inside a failed cloud goes quiet with it":
    "監視するクラウドの外にあるマシン: 障害の起きたクラウドの中にあるエージェントは、クラウドと一緒に沈黙します",
  "That machine can reach Keystone and every service's API":
    "そのマシンから Keystone と各サービスの API に到達できること",
  "The `openstack` command line, as someone who can create the credential below":
    "下の認証情報を作成できるユーザーとして使える `openstack` コマンドライン",
  "An alert that fires becomes an incident, with on-call and status pages from the first hour, and it resolves when the alert does. There is nothing to install.":
    "発火したアラートはインシデントになり、最初の 1 時間からオンコールとステータスページが働き、アラートが解決するとインシデントも解決します。インストールするものはありません。",
  "1. In OneUptime, make an Incoming Request monitor as [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) says, and copy its **Heartbeat URL**. That is the `<secret key>` address below.":
    "1. OneUptime で、[Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) の説明どおりに受信リクエストモニターを作成し、その **ハートビート URL** をコピーします。これが下の `<secret key>` を含むアドレスです。",
  "2. Open the monitor's **Overview → Linked Resources** and add the OpenStack cloud `my-openstack-cloud`. Each incident is then on that cloud's **Incidents** page, so each cloud's Alertmanager needs a monitor of its own. The cloud shows up in that list once its first data arrives, so do this after the steps below, or add the cloud under **OpenStack → All Clouds** first.":
    "2. モニターの **概要 → リンクされたリソース** を開き、OpenStack クラウド `my-openstack-cloud` を追加します。これで各インシデントがそのクラウドの **インシデント** ページに載るので、クラウドごとの Alertmanager にはそれぞれ専用のモニターが必要です。クラウドは最初のデータが届くとその一覧に現れるので、下の手順のあとでこれを行うか、先に **OpenStack → すべてのクラウド** でクラウドを追加してください。",
  "Then, on the host you deploy from, write `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, which Kolla-Ansible reads in place of its own, and apply it:":
    "次に、デプロイ元のホストで `/etc/kolla/config/prometheus/prometheus-alertmanager.yml` を書き込み (Kolla-Ansible は自身のものの代わりにこれを読みます)、適用します:",
  "- Log in as an admin with `source /etc/kolla/admin-openrc.sh`, which `kolla-ansible post-deploy` writes.":
    "- `source /etc/kolla/admin-openrc.sh` で管理者としてログインします。このファイルは `kolla-ansible post-deploy` が書き込みます。",
  "- **Full view** needs one change, to Cinder. Kolla-Ansible's templates already set `service_type` under `[keystone_authtoken]` on Nova, Neutron, Glance and Placement, but its Cinder says `volume` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Add `service_type = block-storage` under `[keystone_authtoken]` in `/etc/kolla/config/cinder.conf`, then run `kolla-ansible reconfigure -i <inventory> --tags cinder`.":
    "- **フルビュー** には Cinder への変更が 1 つ必要です。Kolla-Ansible のテンプレートは Nova、Neutron、Glance、Placement ではすでに `[keystone_authtoken]` に `service_type` を設定していますが、その Cinder は `volume`、カタログは `block-storage` と言い、両者が一致しない限り、keystonemiddleware はアクセスルールで制限された認証情報を `401` で拒否します。`/etc/kolla/config/cinder.conf` の `[keystone_authtoken]` に `service_type = block-storage` を追加し、`kolla-ansible reconfigure -i <inventory> --tags cinder` を実行します。",
  "- **Infrastructure only** takes its overrides at `/etc/kolla/config/nova/policy.yaml`, and the same for `neutron`, `keystone` and `placement`, merged with anything already there. Apply them with `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.":
    "- **インフラのみ** のオーバーライドは `/etc/kolla/config/nova/policy.yaml` に置き、`neutron`、`keystone`、`placement` も同様にして、既存の内容とマージします。`kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement` で適用します。",
  "**Recommended.** The agent sees everything it reads: services, hypervisors, every project's instances, volumes, networks and routers, and `cinder-volume` and `cinder-scheduler` state and storage pools, which only this level sees. It leaves out Keystone's users and groups, on purpose.":
    "**推奨。** エージェントは読み取るものすべてを見ます: サービス、ハイパーバイザー、各プロジェクトのインスタンス、ボリューム、ネットワーク、ルーター、そしてこのレベルだけが見られる `cinder-volume` と `cinder-scheduler` の状態とストレージプールです。Keystone のユーザーとグループは、意図して読みません。",
  "This is an application credential on an account with `admin` on a project of its own, limited by access rules to the exact `GET` calls the agent makes, so it cannot write: on every release we record, every read answered `200` and every write `401`. As an admin, make the project and the account:":
    "これは専用のプロジェクトで `admin` を持つアカウントのアプリケーション認証情報で、アクセスルールによってエージェントが行う `GET` 呼び出しだけに制限されているため、書き込みはできません: 記録しているどのリリースでも、読み取りはすべて `200`、書き込みはすべて `401` で応答しました。管理者として、プロジェクトとアカウントを作成します:",
  "Then, logged in as that account on that project, make the credential. An access rule is matched against the path the service sees, and a service behind a path prefix refuses the shipped rules with a `401`, so these commands fit them to this cloud from its catalog first:":
    "次に、そのプロジェクトにそのアカウントでログインした状態で、認証情報を作成します。アクセスルールはサービスから見えるパスと照合され、パスプレフィックスの背後にあるサービスは同梱のルールを `401` で拒否するため、これらのコマンドはまずカタログをもとにルールをこのクラウドに合わせます:",
  "- Copy the `id` and the `secret` it prints: the secret is shown only once.":
    "- 出力された `id` と `secret` をコピーします。シークレットは一度しか表示されません。",
  "- Never add `--unrestricted`, which would let it make more credentials.":
    "- `--unrestricted` は絶対に付けないでください。付けると、この認証情報がさらに認証情報を作れるようになります。",
  "- Access rules work only where each service sets `service_type` in its `[keystone_authtoken]` section and has been restarted since: `compute`, `network`, `block-storage` (the rules also carry `volume` and `volumev3`, for a Cinder configured that way), `image` and `placement`. Keystone needs nothing. Without that, the services refuse the credential with a `401`.":
    "- アクセスルールが機能するのは、各サービスが `[keystone_authtoken]` セクションで `service_type` を設定し、その後に再起動している場合だけです: `compute`、`network`、`block-storage` (そのように設定した Cinder 向けに、ルールには `volume` と `volumev3` も含まれます)、`image`、`placement`。Keystone には何も要りません。これがないと、サービスは認証情報を `401` で拒否します。",
  "- If you won't change that, leave out `--access-rules`. That makes a plain admin application credential, which can write as well as read, so keep it as safe as an admin password.":
    "- これを変更しない場合は、`--access-rules` を外します。読み取りだけでなく書き込みもできる通常の管理者用アプリケーション認証情報になるので、管理者パスワードと同じくらい厳重に保管してください。",
  "- It stops working when it expires. To replace it, make the second credential before you delete the first.":
    "- 有効期限が切れると使えなくなります。置き換えるときは、古い認証情報を削除する前に新しい認証情報を作成します。",
  "No admin. The agent sees all of Keystone's projects, domains, services and endpoints, all of Nova including every project's instances, all of Placement, and Neutron's agents and address pools. Volumes, snapshots, networks, subnets, routers, floating IPs and ports appear only for the projects the role is assigned on, so on a project that holds nothing just the shared and external ones, and OneUptime can't see the others.":
    "管理者なし。エージェントは Keystone のすべてのプロジェクト、ドメイン、サービス、エンドポイント、各プロジェクトのインスタンスを含む Nova のすべて、Placement のすべて、そして Neutron のエージェントとアドレスプールを見ます。ボリューム、スナップショット、ネットワーク、サブネット、ルーター、Floating IP、ポートは、ロールが割り当てられたプロジェクトの分だけ表示されるので、空のプロジェクトでは共有と外部のものだけになり、それ以外は OneUptime から見えません。",
  "It does not see `cinder-volume` or `cinder-scheduler` state or storage pools: Cinder's own code asks for an admin there, after policy has already passed, so no override opens them, and only **Full view** sees them.":
    "`cinder-volume` や `cinder-scheduler` の状態とストレージプールは見えません: ポリシーを通過したあとで Cinder 自身のコードが管理者を要求するため、どのオーバーライドでも開けず、見えるのは **フルビュー** だけです。",
  "This is a role of its own, `oneuptime_monitoring`, with the policy overrides the agent ships, on a project of its own that holds nothing and has zero quota. Where Cinder has `enforce_new_defaults` off, which is Cinder's own default, any role on a project can create that project's volumes. With nothing to touch and no quota to make anything with, there is nothing for it to write: on every release we record, every write answered `403`, or `409` and `413` from quota. As an admin, make the role, the project and an account:":
    "これは専用のロール `oneuptime_monitoring` で、エージェントが同梱するポリシーオーバーライドを持ち、何も含まずクォータがゼロの専用プロジェクトにあります。Cinder で `enforce_new_defaults` がオフの場合 (これは Cinder 自身の既定値です)、プロジェクト上のどのロールでもそのプロジェクトのボリュームを作成できます。触れるものも、何かを作るクォータもないので、書き込むものはありません: 記録しているどのリリースでも、書き込みはすべて `403`、またはクォータによる `409` と `413` で応答しました。管理者として、ロール、プロジェクト、アカウントを作成します:",
  "Download the overrides, and merge each, on every controller, into the file named by `[oslo_policy] policy_file` in that service's config. That is `/etc/nova/policy.yaml` and so on, unless your deployment says otherwise. Each override keeps the service's default and adds the role. oslo.policy notices a changed file on its own, so nothing restarts:":
    "オーバーライドをダウンロードし、各コントローラーで、それぞれをそのサービスの設定にある `[oslo_policy] policy_file` が指すファイルにマージします。デプロイで別の指定がない限り、`/etc/nova/policy.yaml` などです。各オーバーライドはサービスの既定値を残したままロールを追加します。oslo.policy は変更されたファイルを自分で検知するので、何も再起動しません:",
  "**To take the overrides off again, empty the file (`{}`) and never delete it.** On Flamingo (2025.2) and Epoxy (2025.1), oslo.policy raises on every check once a policy file it has read is gone, so that service fails every request. When the service is Keystone, it stops validating tokens and the whole cloud answers `503`. If it has already happened, restart the service.":
    "**オーバーライドを外すときは、ファイルを空 (`{}`) にし、決して削除しないでください。** Flamingo (2025.2) と Epoxy (2025.1) では、読み込んだポリシーファイルがなくなると、oslo.policy がすべてのチェックでエラーを出し、そのサービスはすべてのリクエストに失敗します。そのサービスが Keystone の場合はトークンの検証が止まり、クラウド全体が `503` を返します。すでに起きてしまった場合は、サービスを再起動してください。",
  "Then, logged in as that account on that project, make the credential and copy the `id` and the `secret` it prints:":
    "次に、そのプロジェクトにそのアカウントでログインした状態で、認証情報を作成し、出力された `id` と `secret` をコピーします:",
  "Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off. `troubleshoot.sh` warns when the credential's project holds things.":
    "ボリュームやルーターを見るために実際のプロジェクトにロールを付けると、Cinder で `enforce_new_defaults` がオフのクラウドでは、そのアカウントがそこに書き込めるようにもなります。認証情報のプロジェクトに何かがあると、`troubleshoot.sh` が警告します。",
  "For a team watching its own part of a cloud someone else runs. The agent sees one project's volumes, networks and routers, and no infrastructure: no hypervisors, services or storage pools.":
    "他の人が運用するクラウドのうち、自分たちの担当部分を監視するチーム向けです。エージェントは 1 つのプロジェクトのボリューム、ネットワーク、ルーターを見て、インフラは見ません: ハイパーバイザー、サービス、ストレージプールはどれも見えません。",
  "Through the agent it shows no instances at all: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.":
    "このレベルでは、エージェント経由ではインスタンスがまったく表示されません: エクスポーターは Nova に全プロジェクトのサーバーを要求し、Nova は通常の閲覧者を拒否し、その読み取りは丸ごと失敗します。1 つのプロジェクトのインスタンスを一覧できるのは、このエージェントなしで収集する OneUptime プローブだけです。",
  "This is the plain `reader` role. Give an account the role on the project:":
    "これは通常の `reader` ロールです。プロジェクトでアカウントにロールを付与します:",
  "Neutron and Cinder answer a reader with its own project and no error, so these lists look complete, and hold only that project.":
    "Neutron と Cinder は閲覧者に対して、その閲覧者のプロジェクトだけをエラーなしで返すので、これらの一覧は完全に見えますが、そのプロジェクトしか含みません。",
  "It may be able to write. On a cloud where Cinder has `enforce_new_defaults` off, which is Cinder's own default, plain `reader` can create volumes in its project too. On Epoxy, Flamingo and Gazpacho it did, and on Hibiscus it was refused, because DevStack only turns `enforce_new_defaults` on there.":
    "書き込みができる場合があります。Cinder で `enforce_new_defaults` がオフのクラウド (これは Cinder 自身の既定値です) では、通常の `reader` でも自分のプロジェクトにボリュームを作成できます。Epoxy、Flamingo、Gazpacho では作成でき、Hibiscus では拒否されました。DevStack がそこでだけ `enforce_new_defaults` をオンにするためです。",
  "No credential and nothing new to run: the agent reads the exporter Kolla-Ansible already runs, through its internal VIP on `9198`. Skip the install's credential questions by giving it the address:":
    "認証情報も、新たに動かすものも不要です: エージェントは、Kolla-Ansible がすでに動かしているエクスポーターを、`9198` の内部 VIP 経由で読み取ります。インストール時にアドレスを渡すと、認証情報の質問を省略できます:",
  "Kolla-Ansible pins exporter 1.7.0 and runs it without `--multi-cloud`, so it has no `/probe`: the agent asks it for everything at once, every 2 minutes, on top of Kolla-Ansible's own Prometheus asking every minute. Its answer also says less. On five real clouds, the pages went without:":
    "Kolla-Ansible はエクスポーターを 1.7.0 に固定し、`--multi-cloud` なしで動かすので、`/probe` がありません: エージェントは 2 分ごとにすべてを一度に要求し、それに加えて Kolla-Ansible 自身の Prometheus も毎分問い合わせます。応答に含まれる情報も少なくなります。5 つの実際のクラウドで、ページに欠けたものは次のとおりです:",
  "| Goes without | Because | What it costs |": "| 欠けるもの | 理由 | 影響 |",
  "| Everything of Cinder's | It asks the catalog for `volumev3`, and finds no such thing where Cinder registers as `block-storage` | **Volumes** and **Storage pools** stay empty, and **Services** has no Block Storage API, `cinder-volume` or `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** and **Volume Stuck** stay quiet |":
    "| Cinder のすべて | カタログに `volumev3` を問い合わせるが、Cinder が `block-storage` として登録されている環境では見つからない | **ボリューム** と **ストレージプール** は空のままで、**サービス** には Block Storage API、`cinder-volume`、`cinder-scheduler` が表示されない。**Block Storage API Down**、**Block Storage Service Down**、**Storage Pool Warning**、**Storage Pool Critical**、**Volumes in Error**、**Volume Stuck** は発火しない |",
  "| How many instances a hypervisor holds, and its aggregates | Nova's list of hypervisors fails at the newest microversion, which Kolla-Ansible asks for | Those two on **Hypervisors**, and what a lost host says it takes with it. Its vCPUs, memory and disk are still there: they come from Placement |":
    "| ハイパーバイザーが抱えるインスタンス数と、そのアグリゲート | Kolla-Ansible が要求する最新のマイクロバージョンで、Nova のハイパーバイザー一覧が失敗する | **ハイパーバイザー** のその 2 項目と、失われたホストが道連れにすると示すもの。vCPU、メモリー、ディスクは引き続き表示される (Placement から取得) |",
  "| Domains | It has no such series | **Domains** stays empty |":
    "| ドメイン | そのような系列がない | **ドメイン** は空のまま |",
  "| An image's status, visibility and creation date | It has no such labels | Those columns on **Images**. **Image Stuck** stays quiet, so an image stuck on its way to `active` goes unnoticed |":
    "| イメージのステータス、可視性、作成日 | そのようなラベルがない | **イメージ** のそれらの列。**Image Stuck** は発火しないため、`active` になる途中で止まったイメージに気付かない |",
  "| A network's MTU | It has no such label | That line on a network's page |":
    "| ネットワークの MTU | そのようなラベルがない | ネットワークのページのその行 |",
  "If you need those, use one of the other tabs and the agent's own exporter. You can change your mind later: a cloud keeps its name whichever reads it.":
    "これらが必要な場合は、ほかのタブのいずれかとエージェント自身のエクスポーターを使ってください。あとから変更もできます: どれが読み取っても、クラウドの名前は変わりません。",
  "The script asks for:": "スクリプトは次の項目を尋ねます:",
  "- **OneUptime URL and ingestion key**, both shown in step 1. Pick a key there to have them filled in here.":
    "- **OneUptime の URL と取り込みキー**: どちらもステップ 1 に表示されます。そこでキーを選ぶと、ここに入力されます。",
  "- **Cloud name**: how the cloud appears in OneUptime. Keep it stable: a new name registers a new cloud.":
    "- **クラウド名**: OneUptime でのクラウドの表示名です。変えないでください。新しい名前は新しいクラウドとして登録されます。",
  "- **Keystone auth URL**, such as `https://keystone.example.com:5000/v3`.":
    "- **Keystone の認証 URL**: たとえば `https://keystone.example.com:5000/v3`。",
  "- **Region names**, comma-separated (`RegionOne` if you have one).":
    "- **リージョン名**: カンマ区切り (1 つだけなら `RegionOne`)。",
  "- **Application credential**: the ID and secret from the previous step. Neither is echoed to the screen, and neither goes on a command line.":
    "- **アプリケーション認証情報**: 前のステップの ID とシークレットです。どちらも画面には表示されず、コマンドラインにも載りません。",
  "- **Private CA file**, only if the cloud's certificate comes from its own certificate authority.":
    "- **プライベート CA ファイル**: クラウドの証明書が独自の認証局のものである場合のみ。",
  "It checks the credential with Keystone before it installs anything, installs to `/opt/oneuptime-openstack-agent` (or to `oneuptime-openstack-agent` in your home folder if you have no rights on `/opt`, and it says which), writes a `.env` file and a `clouds.yaml` only their owner can read, and starts everything with Docker Compose. Running it again reuses all of that instead of asking again, so it is also how you upgrade.":
    "何かをインストールする前に Keystone で認証情報を確認し、`/opt/oneuptime-openstack-agent` にインストールし (`/opt` に権限がない場合はホームフォルダーの `oneuptime-openstack-agent` に入れ、どちらにしたかを表示します)、所有者だけが読める `.env` ファイルと `clouds.yaml` を書き込み、Docker Compose ですべてを起動します。もう一度実行すると、改めて尋ねずにそのすべてを再利用するので、アップグレードもこの方法で行います。",
  "`docker compose ps` lists the collector (`oneuptime-openstack-agent`), the bundled exporter (`oneuptime-openstack-exporter`) and the OneUptime AI agent (`oneuptime-openstack-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cloud then appears in the **OpenStack** section by itself. Give it about five minutes to fill in: compute, network, volume and Placement are read every 2 minutes, identity and images every 5.":
    "`docker compose ps` には、コレクター (`oneuptime-openstack-agent`)、同梱のエクスポーター (`oneuptime-openstack-exporter`)、OneUptime AI エージェント (`oneuptime-openstack-ai-agent`) が表示されます。コレクターのログで `Everything is ready. Begin running and processing data.` を探してください。その後、クラウドは **OpenStack** セクションに自動で表示されます。データが揃うまで 5 分ほど待ってください: compute、ネットワーク、ボリューム、Placement は 2 分ごと、Identity とイメージは 5 分ごとに読み取られます。",
  "On the host that runs Kolla-Ansible's Prometheus, this reads its targets from the file Kolla-Ansible rendered, and prints them as settings for the agent:":
    "Kolla-Ansible の Prometheus を動かしているホストで、これは Kolla-Ansible が生成したファイルからターゲットを読み取り、エージェント用の設定として出力します:",
  "Add what it prints to the agent's `.env`, then run `docker compose up -d` in the agent's folder. Each exporter listens on the API network, so the agent's machine needs a route there. The cloud's **Control Plane** card then says how each one is, and says plainly which ones are not watched.":
    "出力された内容をエージェントの `.env` に追加し、エージェントのフォルダーで `docker compose up -d` を実行します。各エクスポーターは API ネットワークで待ち受けているので、エージェントのマシンにはそこへのルートが必要です。これでクラウドの **コントロールプレーン** カードが各エクスポーターの状態を示し、監視されていないものもはっきり示します。",
  "| Reads | Port | Setting |": "| 読み取り元 | ポート | 設定 |",
  "| RabbitMQ's Prometheus plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |":
    "| RabbitMQ の Prometheus プラグイン | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |",
  "| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |":
    "| mysqld_exporter (MariaDB 用) | `9104` | `OPENSTACK_MARIADB_TARGETS` |",
  "| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |":
    "| memcached_exporter (Memcached 用) | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |",
  "| HAProxy's own exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |":
    "| HAProxy 自身のエクスポーター | `9101` | `OPENSTACK_HAPROXY_TARGETS` |",
  "| openstack-network-exporter, for OVN and Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |":
    "| openstack-network-exporter (OVN と Open vSwitch 用) | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |",
  "| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |":
    "| prometheus-libvirt-exporter (libvirt 用) | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |",
  "- **OVN's databases:** Kolla-Ansible runs openstack-network-exporter from 2026.1, on compute and network nodes only, and an OVN database is read from the host it runs on. If your control nodes are neither, add them under `[prometheus-openstack-network-exporter:children]` in your inventory and reconfigure, or the Northbound and Southbound databases read as not watched.":
    "- **OVN のデータベース:** Kolla-Ansible は 2026.1 から、コンピュートノードとネットワークノードでだけ openstack-network-exporter を動かし、OVN データベースはそれが動くホストから読み取られます。コントロールノードがそのどちらでもない場合は、インベントリーの `[prometheus-openstack-network-exporter:children]` に追加して再設定してください。そうしないと、Northbound と Southbound のデータベースは監視対象外と表示されます。",
  "- **Before 2026.1** there is no network exporter, so OVN and Open vSwitch read as not watched.":
    "- **2026.1 より前** はネットワークエクスポーターがないため、OVN と Open vSwitch は監視対象外と表示されます。",
  "The agent's logs profile runs on each node, and reads Kolla-Ansible's files. It is what joins a line to the cloud's pages:":
    "エージェントのログプロファイルは各ノードで動き、Kolla-Ansible のファイルを読み取ります。ログの行をクラウドのページに結び付けるのはこれです:",
  "Kolla's own Fluentd can forward too, with an output in `/etc/kolla/config/fluentd/output/*.conf` as [Fluentd](/docs/telemetry/fluentd) describes, but those records reach **Logs** under a service's name, and not the cloud's pages.":
    "Kolla 自身の Fluentd でも、[Fluentd](/docs/telemetry/fluentd) の説明どおりに `/etc/kolla/config/fluentd/output/*.conf` へ出力を置けば転送できますが、そのレコードはサービス名で **ログ** に届き、クラウドのページには届きません。",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from `/var/log/kolla`.":
    "どちらもサービス自身のログに書き込み、バス上にコンシューマーはいません。**セキュリティイベント → 接続** で **ログからセキュリティイベントを見つける** をオンにすると、OneUptime はそこからそれらを読み取ります。 エージェントのログプロファイルは、どちらも `/var/log/kolla` から読み取ります。",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.":
    "これはログインごとに 1 行を送り、それを **OpenStack admin credential used from a new address** が読み取ります。失敗したログインだけを送るには、`notification_opt_out` に `identity.authenticate.success` を追加します。その検出は、監査フィルターが見たものを読むようになります。",
  "For who did what through Nova, Neutron, Cinder and Glance, the audit filter needs a setting, which goes in every service's config at once:":
    "Nova、Neutron、Cinder、Glance を通じて誰が何をしたかを知るには、監査フィルターに設定が 1 つ必要で、それをすべてのサービスの設定に一度に入れます:",
  "It also needs a paste file, and Kolla-Ansible's config tasks copy no paste file for these services. Put yours on each API host, and mount it over the one in the image with `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` and `glance_api_extra_volumes` in `globals.yml`. pyCADF's map files are in `/var/lib/kolla/venv/etc/pycadf` in the image. [Who did what](/docs/telemetry/openstack#who-did-what) has the filter's lines.":
    "paste ファイルも必要ですが、Kolla-Ansible の設定タスクはこれらのサービスの paste ファイルをコピーしません。各 API ホストにご自身のものを置き、`globals.yml` の `nova_api_extra_volumes`、`neutron_server_extra_volumes`、`cinder_api_extra_volumes`、`glance_api_extra_volumes` で、イメージ内のものの上にマウントします。pyCADF のマップファイルはイメージ内の `/var/lib/kolla/venv/etc/pycadf` にあります。フィルターの行は [誰が何をしたか](/docs/telemetry/openstack#who-did-what) にあります。",
  "OpenStack's `reader` role is scoped to a project everywhere except Keystone and Ironic, and hypervisors, services, agents, pools and Placement default to admin. A policy override can't open all-project lists in Cinder or Neutron, because they scope those lists in code, and Cinder's own code keeps its services and storage pools for an admin. So what a credential can read depends on which level you choose. This is what five real clouds answered, on Epoxy, Flamingo, Gazpacho (OVN and OVS) and Hibiscus:":
    "OpenStack の `reader` ロールは Keystone と Ironic 以外ではプロジェクト単位に限られ、ハイパーバイザー、サービス、エージェント、プール、Placement は既定で管理者専用です。Cinder と Neutron は全プロジェクトの一覧をコードで絞り込むため、ポリシーオーバーライドでは開けず、Cinder 自身のコードはサービスとストレージプールを管理者に限っています。そのため、認証情報で読み取れる範囲は、選ぶレベルによって決まります。Epoxy、Flamingo、Gazpacho (OVN と OVS)、Hibiscus の 5 つの実際のクラウドの応答は次のとおりです:",
  "| Read | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |":
    "| 読み取り | レベル 1: フルビュー | レベル 2: インフラのみ | レベル 3: プロジェクトビュー |",
  "| Keystone: projects | all | all | refused |":
    "| Keystone: プロジェクト | すべて | すべて | 拒否 |",
  "| Keystone: domains | all | all | refused |":
    "| Keystone: ドメイン | すべて | すべて | 拒否 |",
  "| Keystone: regions | all | what anyone sees | what anyone sees |":
    "| Keystone: リージョン | すべて | 誰でも見えるもの | 誰でも見えるもの |",
  "| Keystone: services | all | all | refused |":
    "| Keystone: サービス | すべて | すべて | 拒否 |",
  "| Keystone: endpoints | all | all | refused |":
    "| Keystone: エンドポイント | すべて | すべて | 拒否 |",
  "| Nova: servers, all projects | all | all | refused |":
    "| Nova: サーバー (全プロジェクト) | すべて | すべて | 拒否 |",
  "| Nova: services | all | all | refused |":
    "| Nova: サービス | すべて | すべて | 拒否 |",
  "| Nova: hypervisors | all | all | refused |":
    "| Nova: ハイパーバイザー | すべて | すべて | 拒否 |",
  "| Nova: aggregates | all | all | refused |":
    "| Nova: アグリゲート | すべて | すべて | 拒否 |",
  "| Nova: availability zones, detail | all | all | refused |":
    "| Nova: アベイラビリティゾーン (詳細) | すべて | すべて | 拒否 |",
  "| Nova: flavors | all | what anyone sees | what anyone sees |":
    "| Nova: フレーバー | すべて | 誰でも見えるもの | 誰でも見えるもの |",
  "| Nova: usage per project | all | all | refused |":
    "| Nova: プロジェクトごとの使用量 | すべて | すべて | 拒否 |",
  "| Placement: resource providers | all | all | refused |":
    "| Placement: リソースプロバイダー | すべて | すべて | 拒否 |",
  "| Neutron: agents | all | all | nothing |":
    "| Neutron: エージェント | すべて | すべて | なし |",
  "| Neutron: networks | all | own project only | own project only |":
    "| Neutron: ネットワーク | すべて | 自分のプロジェクトのみ | 自分のプロジェクトのみ |",
  "| Neutron: subnets | all | own project only | own project only |":
    "| Neutron: サブネット | すべて | 自分のプロジェクトのみ | 自分のプロジェクトのみ |",
  "| Neutron: routers | all | own project only | own project only |":
    "| Neutron: ルーター | すべて | 自分のプロジェクトのみ | 自分のプロジェクトのみ |",
  "| Neutron: floating IPs | all | own project only | own project only |":
    "| Neutron: Floating IP | すべて | 自分のプロジェクトのみ | 自分のプロジェクトのみ |",
  "| Neutron: IP availabilities | all | all | nothing |":
    "| Neutron: IP の空き状況 | すべて | すべて | なし |",
  "| Neutron: security groups | all | 409, expected | own project only |":
    "| Neutron: セキュリティグループ | すべて | 409 (想定どおり) | 自分のプロジェクトのみ |",
  "| Neutron: ports | all | own project only | own project only |":
    "| Neutron: ポート | すべて | 自分のプロジェクトのみ | 自分のプロジェクトのみ |",
  "| Neutron: quotas | all | refused | refused |":
    "| Neutron: クォータ | すべて | 拒否 | 拒否 |",
  "| Cinder: volumes, all projects | all | own project only | own project only |":
    "| Cinder: ボリューム (全プロジェクト) | すべて | 自分のプロジェクトのみ | 自分のプロジェクトのみ |",
  "| Cinder: services | all | refused | refused |":
    "| Cinder: サービス | すべて | 拒否 | 拒否 |",
  "| Cinder: pools | all | refused | refused |":
    "| Cinder: プール | すべて | 拒否 | 拒否 |",
  "| Cinder: snapshots, all projects | all | own project only | own project only |":
    "| Cinder: スナップショット (全プロジェクト) | すべて | 自分のプロジェクトのみ | 自分のプロジェクトのみ |",
  "| Cinder: backups, all projects | all | none recorded | none recorded |":
    "| Cinder: バックアップ (全プロジェクト) | すべて | 記録なし | 記録なし |",
  "| Cinder: volume types | all | what anyone sees | what anyone sees |":
    "| Cinder: ボリュームタイプ | すべて | 誰でも見えるもの | 誰でも見えるもの |",
  "| Glance: images | all | what anyone sees | what anyone sees |":
    "| Glance: イメージ | すべて | 誰でも見えるもの | 誰でも見えるもの |",
  "- **all**: the same rows an admin saw.":
    "- **すべて**: 管理者が見たのと同じ行。",
  "- **own project only**: that project's rows, and anything shared or external. On a project that holds nothing, that is just the shared and external ones.":
    "- **自分のプロジェクトのみ**: そのプロジェクトの行と、共有または外部のものすべて。空のプロジェクトでは、共有と外部のものだけです。",
  "- **refused**: a `401` or a `403`.": "- **拒否**: `401` または `403`。",
  "- **what anyone sees**: every credential saw every row, on clouds that hold only public flavors, volume types and images. A private one in another project takes **Full view**.":
    "- **誰でも見えるもの**: パブリックなフレーバー、ボリュームタイプ、イメージしかないクラウドで、どの認証情報もすべての行を見ました。別のプロジェクトにあるプライベートなものには **フルビュー** が必要です。",
  "- **nothing**: a `200` with no rows, on a project that has networks too. It looks like it worked, and it did not.":
    "- **なし**: ネットワークもあるプロジェクトで、行のない `200`。うまくいったように見えますが、そうではありません。",
  "- **none recorded**: a `200` with no rows where an admin saw none either, so there was nothing to tell by.":
    "- **記録なし**: 管理者も何も見なかった場所での、行のない `200`。そのため、判断の手がかりがありませんでした。",
  "- **409, expected**: Neutron tries to create the project's default security group when it lists them, and zero quota does not let it, so it answers `409 Quota exceeded`. That is harmless, and nothing to fix.":
    "- **409 (想定どおり)**: Neutron はセキュリティグループを一覧表示するときにプロジェクトの既定のセキュリティグループを作成しようとしますが、クォータがゼロなので作成できず、`409 Quota exceeded` を返します。これは無害で、直すものはありません。",
  "A list a credential can't read looks empty here: `troubleshoot.sh` says what this credential can read, and what each gap costs.":
    "認証情報で読み取れない一覧は、ここでは空に見えます: `troubleshoot.sh` は、この認証情報で読み取れるものと、欠けているものごとの影響を示します。",
  "Monitoring must never be what takes a cloud down, so the agent is gentle by default:":
    "監視がクラウドを落とす原因になってはならないので、エージェントは既定で控えめに動きます:",
  "| Reads | Every | Gives |": "| 読み取り先 | 間隔 | 得られるもの |",
  "| **Compute (Nova)** | 2 minutes | Services, hypervisors, instances and flavors |":
    "| **Compute (Nova)** | 2 分 | サービス、ハイパーバイザー、インスタンス、フレーバー |",
  "| **Placement** | 2 minutes | What each hypervisor can promise, and has promised |":
    "| **Placement** | 2 分 | 各ハイパーバイザーが約束できる量と、約束済みの量 |",
  "| **Networking (Neutron)** | 2 minutes | Agents, networks, subnets, address use, routers and floating IPs |":
    "| **ネットワーク (Neutron)** | 2 分 | エージェント、ネットワーク、サブネット、アドレス使用量、ルーター、Floating IP |",
  "| **Block Storage (Cinder)** | 2 minutes | Services, volumes, snapshots and storage pools |":
    "| **ブロックストレージ (Cinder)** | 2 分 | サービス、ボリューム、スナップショット、ストレージプール |",
  "| **Identity (Keystone)** | 5 minutes | Projects and domains |":
    "| **Identity (Keystone)** | 5 分 | プロジェクトとドメイン |",
  "| **Images (Glance)** | 5 minutes | Images |":
    "| **イメージ (Glance)** | 5 分 | イメージ |",
  "- Each service is read on its own, so a failing Nova costs only Nova's numbers, and the rest keep reporting.":
    "- 各サービスは個別に読み取られるので、Nova が失敗しても失うのは Nova の数値だけで、残りは報告を続けます。",
  "- A read never outlasts its interval, so a slow one never stacks on the next.":
    "- 読み取りが間隔を超えて続くことはないので、遅い読み取りが次の読み取りに積み重なることはありません。",
  "- Each project's quotas are off. To turn them on, run the installer again with `OPENSTACK_COLLECT_QUOTAS=true`: a second exporter reads them once an hour, at four calls per project per region. Neutron's quotas answer only **Full view**.":
    "- 各プロジェクトのクォータはオフです。オンにするには、`OPENSTACK_COLLECT_QUOTAS=true` を付けてインストーラーを再実行します: 2 つ目のエクスポーターが 1 時間に 1 回、プロジェクトとリージョンごとに 4 回の呼び出しで読み取ります。Neutron のクォータは **フルビュー** にしか応答しません。",
  "- Nova's own quota lists and usage per server are off. To turn one on, delete its `--disable-metric` line from the exporter's `command` in `docker-compose.yml`. The cost is one call per project per scrape.":
    "- Nova 自身のクォータ一覧とサーバーごとの使用量はオフです。どちらかをオンにするには、`docker-compose.yml` にあるエクスポーターの `command` から該当する `--disable-metric` 行を削除します。コストは、スクレイプごとにプロジェクトあたり 1 回の呼び出しです。",
  "- The per-port series are off: listing every port with an admin credential can saturate Neutron on a large cloud.":
    "- ポートごとの系列はオフです: 管理者の認証情報ですべてのポートを一覧すると、大規模なクラウドでは Neutron が飽和することがあります。",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Give the install script every region's name. It writes one `clouds.yaml` entry for each. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "1 つのクラウドは、リージョンがいくつあっても 1 つの Keystone で、1 つのエージェントがそのすべてを読み取ります。インストールスクリプトにすべてのリージョン名を渡してください。リージョンごとに `clouds.yaml` のエントリーを 1 つ書き込みます。各エントリーにはリージョンの名前を付ける必要があります: 系列にはどのリージョンのものかが含まれないため、コレクターがその名前を `openstack.region.name` としてエクスポーターの系列に付けます。これで OneUptime のすべての一覧をリージョンで絞り込めます。",
  "Regions with a Keystone of their own are separate clouds to OneUptime: run one agent for each.":
    "独自の Keystone を持つリージョンは、OneUptime では別のクラウドです: それぞれにエージェントを 1 つずつ動かしてください。",
  "**[Very Large OpenStack Clouds](/docs/telemetry/openstack-very-large-clouds)** has what each size costs and how each of these works.":
    "規模ごとのコストとそれぞれの仕組みは **[非常に大規模な OpenStack クラウド](/docs/telemetry/openstack-very-large-clouds)** にあります。",
  "**Past 5,000 instances, summary mode.** The cloud keeps a row for every part and counts per hypervisor, project and status, and its series per instance and per volume stop. It gives up the history of each settled instance's and volume's status, and a chart or a monitor over those series. An instance or volume in a state an alert watches keeps its series, so every alert template goes on working. To keep them for some, choose their projects under **Real usage per instance** on the cloud's **Settings** page.":
    "**5,000 インスタンスを超えたら、サマリーモード。** クラウドはすべての構成要素の行と、ハイパーバイザー、プロジェクト、ステータスごとの件数を保持し、インスタンスごとおよびボリュームごとの系列は止まります。落ち着いたインスタンスとボリュームのステータス履歴と、それらの系列に対するグラフやモニターはなくなります。アラートが監視している状態のインスタンスやボリュームは系列を保持するので、どのアラートテンプレートも動き続けます。一部について保持したい場合は、クラウドの **設定** ページの **インスタンスごとの実際の使用量** でそのプロジェクトを選んでください。",
  "**Sharing a cloud between agents.** Run one agent per region, or per service for the largest clouds, each with the same `OPENSTACK_CLOUD_NAME`. A region and a service belong to one agent, and Keystone to one agent for the whole cloud, or their series arrive twice. List an agent's regions in `OPENSTACK_EXPORTER_CLOUDS`, and its services in `OPENSTACK_AGENT_SERVICES`, such as `compute|placement`.":
    "**クラウドを複数のエージェントで分担する。** リージョンごとに、最大級のクラウドではサービスごとにエージェントを 1 つ動かし、それぞれに同じ `OPENSTACK_CLOUD_NAME` を設定します。リージョンとサービスは 1 つのエージェントに、Keystone はクラウド全体で 1 つのエージェントに属します。そうしないと系列が二重に届きます。エージェントのリージョンは `OPENSTACK_EXPORTER_CLOUDS` に、サービスは `OPENSTACK_AGENT_SERVICES` に指定します (例: `compute|placement`)。",
  "**Past 1,500 hypervisors or 100,000 instances, the database path.** The agent can read the cloud's databases rather than its APIs, which at that size cannot be read in a scrape's time. It asks for a read-only account on each service's database, a route to them from this machine, and one exporter per region and Nova cell. It reads the same series, but for whether each Nova worker is alive and how full each storage pool is, which it still reads from the API, and it cannot say whether an API answers. It has not yet been run against a real database.":
    "**1,500 ハイパーバイザーまたは 10 万インスタンスを超えたら、データベース経由。** エージェントは API の代わりにクラウドのデータベースを読み取れます。この規模では、API はスクレイプの時間内に読み切れないからです。各サービスのデータベースの読み取り専用アカウント、このマシンからそこへのルート、そしてリージョンと Nova セルごとに 1 つのエクスポーターが必要です。同じ系列を読み取りますが、各 Nova ワーカーが生きているかと各ストレージプールの使用率は引き続き API から読み、API が応答するかどうかはわかりません。実際のデータベースではまだ実行していません。",
  "The install script writes these to `/opt/oneuptime-openstack-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`.":
    "インストールスクリプトはこれらを `/opt/oneuptime-openstack-agent/.env` に書き込みます。変更したら、`/opt/oneuptime-openstack-agent` で `docker compose up -d` を実行して適用します。",
  "| Variable | Required | Description |": "| 変数 | 必須 | 説明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | はい | OneUptime インスタンスの URL (例: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key: the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | はい | テレメトリ取り込みキー (ステップ 1 で選んだもの) |",
  "| `OPENSTACK_CLOUD_NAME` | Yes | The cloud's name in OneUptime, stamped on every metric as the `openstack.cloud.name` resource attribute. Keep it stable: changing it registers a new cloud |":
    "| `OPENSTACK_CLOUD_NAME` | はい | OneUptime でのクラウド名。すべてのメトリクスにリソース属性 `openstack.cloud.name` として付きます。変えないでください。変更すると新しいクラウドとして登録されます |",
  "| `OPENSTACK_EXPORTER_CLOUDS` | Yes | The `clouds.yaml` entries to read, one per region and named for the region, in square brackets: `[RegionOne,RegionTwo]` |":
    "| `OPENSTACK_EXPORTER_CLOUDS` | はい | 読み取る `clouds.yaml` のエントリー。リージョンごとに 1 つで、リージョン名を付け、角かっこで囲みます: `[RegionOne,RegionTwo]` |",
  "| `OPENSTACK_AUTH_URL` | Bundled exporter | The Keystone auth URL. `/v3` is added if it is missing |":
    "| `OPENSTACK_AUTH_URL` | 同梱のエクスポーター | Keystone の認証 URL。`/v3` がなければ付け足されます |",
  "| `OPENSTACK_EXPORTER_ADDRESS` | No | `host:port` of your own exporter, with no scheme. Leave it out for the bundled one |":
    "| `OPENSTACK_EXPORTER_ADDRESS` | いいえ | ご自身のエクスポーターの `host:port` (スキームなし)。同梱のものを使う場合は省略します |",
  "| `OPENSTACK_QUOTA_CLOUDS` | No | The `clouds.yaml` entries to read each project's quotas from, once an hour. The install script sets it when run with `OPENSTACK_COLLECT_QUOTAS=true` |":
    "| `OPENSTACK_QUOTA_CLOUDS` | いいえ | 各プロジェクトのクォータを 1 時間に 1 回読み取る `clouds.yaml` のエントリー。 `OPENSTACK_COLLECT_QUOTAS=true` を付けて実行すると、インストールスクリプトが設定します |",
  "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | No | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | いいえ | それらを読み取るエクスポーターの `host:port`。同梱のものを使う場合は省略します |",
  "| `OPENSTACK_EXPORTER_USER` | No | The `uid:gid` the exporter's container runs as, which must own `clouds.yaml` (default: `65532:65532`) |":
    "| `OPENSTACK_EXPORTER_USER` | いいえ | エクスポーターのコンテナーを実行する `uid:gid`。`clouds.yaml` の所有者である必要があります (既定値: `65532:65532`) |",
  "| `OPENSTACK_CA_FILE` | No | A PEM file with the certificate authority of a cloud that has its own |":
    "| `OPENSTACK_CA_FILE` | いいえ | 独自の認証局を持つクラウドの認証局を含む PEM ファイル |",
  "| `COMPOSE_PROFILES` | Bundled exporter | `openstack-exporter` starts the bundled exporter, and `openstack-ai-agent` the OneUptime AI agent |":
    "| `COMPOSE_PROFILES` | 同梱のエクスポーター | `openstack-exporter` は同梱のエクスポーターを、`openstack-ai-agent` は OneUptime AI エージェントを起動します |",
  "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | No | An exporter already running without `--multi-cloud`, such as Kolla-Ansible's: `[10.0.0.254:9198]`. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it |":
    "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | いいえ | すでに `--multi-cloud` なしで動いているエクスポーター (Kolla-Ansible のものなど): `[10.0.0.254:9198]`。あわせて `OPENSTACK_EXPORTER_CLOUDS=[]` を設定します |",
  "| `OPENSTACK_RABBITMQ_TARGETS` | No | RabbitMQ's Prometheus plugin on each node: `[10.0.0.11:15692,10.0.0.12:15692]` |":
    "| `OPENSTACK_RABBITMQ_TARGETS` | いいえ | 各ノードの RabbitMQ の Prometheus プラグイン: `[10.0.0.11:15692,10.0.0.12:15692]` |",
  "| `OPENSTACK_MARIADB_TARGETS` | No | mysqld_exporter beside each MariaDB node, usually on `9104` |":
    "| `OPENSTACK_MARIADB_TARGETS` | いいえ | 各 MariaDB ノードの横にある mysqld_exporter (通常は `9104`) |",
  "| `OPENSTACK_MEMCACHED_TARGETS` | No | memcached_exporter beside each Memcached, usually on `9150` |":
    "| `OPENSTACK_MEMCACHED_TARGETS` | いいえ | 各 Memcached の横にある memcached_exporter (通常は `9150`) |",
  "| `OPENSTACK_HAPROXY_TARGETS` | No | HAProxy's own Prometheus exporter |":
    "| `OPENSTACK_HAPROXY_TARGETS` | いいえ | HAProxy 自身の Prometheus エクスポーター |",
  "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | No | openstack-network-exporter on each node, for OVN and Open vSwitch, usually on `1981` |":
    "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | いいえ | 各ノードの openstack-network-exporter (OVN と Open vSwitch 用、通常は `1981`) |",
  "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | No | prometheus-libvirt-exporter on each compute node, usually on `9177`, for whether libvirt answers and nothing per instance |":
    "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | いいえ | 各コンピュートノードの prometheus-libvirt-exporter (通常は `9177`)。libvirt が応答するかどうかだけで、インスタンスごとの情報はありません |",
  "| `OPENSTACK_CONTROL_PLANE_REGION` | No | The region of a target above that does not say its own. A target can: `RegionTwo@10.1.0.11:15692` |":
    "| `OPENSTACK_CONTROL_PLANE_REGION` | いいえ | 上のターゲットのうち、自分のリージョンを示さないもののリージョン。ターゲット側で示すこともできます: `RegionTwo@10.1.0.11:15692` |",
  "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | No | The same exporter, for what each instance is really doing. Per-instance series multiply fast |":
    "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | いいえ | 同じエクスポーターで、各インスタンスが実際に何をしているかを読みます。インスタンスごとの系列はすぐに増えます |",
  "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | No | Ceilometer's exporter on each compute node, usually on `9101`, for the same |":
    "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | いいえ | 各コンピュートノードの Ceilometer のエクスポーター (通常は `9101`)。用途は同じです |",
  "`clouds.yaml` alone holds the credential.":
    "認証情報を持つのは `clouds.yaml` だけです。",
  "Only the largest clouds need these, and none is asked for:":
    "これらが必要なのは最大級のクラウドだけで、どれも質問されません:",
  "| Variable | Description |": "| 変数 | 説明 |",
  "| `OPENSTACK_AGENT_SERVICES` | Which services this agent reads, as a pattern: `compute\\|placement` here and the rest on a second agent. Every service by default. No two agents should read one service of one region |":
    "| `OPENSTACK_AGENT_SERVICES` | このエージェントが読み取るサービスをパターンで指定します: ここでは `compute\\|placement`、残りは 2 つ目のエージェントで。既定ではすべてのサービスです。1 つのリージョンの 1 つのサービスを 2 つのエージェントで読まないでください |",
  "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | The memory the collector may use, in MiB (default: `512`). It holds a whole scrape, so raise this past tens of thousands of instances |":
    "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | コレクターが使えるメモリー (MiB、既定値: `512`)。スクレイプ 1 回分を丸ごと保持するので、インスタンスが数万を超えたら引き上げてください |",
  "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | Reading each service's database rather than its API, with a read-only account: where that exporter answers. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it, or every series arrives twice |":
    "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | API の代わりに各サービスのデータベースを読み取り専用アカウントで読むときに、そのエクスポーターが応答する場所。あわせて `OPENSTACK_EXPORTER_CLOUDS=[]` を設定してください。そうしないとすべての系列が二重に届きます |",
  "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | The database of each service it reads, as `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. One left empty is a service it leaves alone. Each holds a password, and `.env` is readable by its owner alone |":
    "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | 読み取る各サービスのデータベース。`mysql+pymysql://oneuptime:secret@db.example:3306/nova` の形式です。空のままにしたものは、触らないサービスになります。どれもパスワードを含み、`.env` は所有者しか読めません |",
  "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | What Nova adds to a host's name to make a hypervisor's, such as `.example.org`, so an instance finds the hypervisor it runs on |":
    "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | Nova がホスト名に付け足してハイパーバイザー名にする部分 (例: `.example.org`)。これでインスタンスが自分の動くハイパーバイザーを見つけられます |",
  "| `OPENSTACK_WORKER_STATE_CLOUDS` | The `clouds.yaml` entries to read from Nova's and Cinder's APIs what their databases cannot say: whether each worker is alive, and how full each pool is |":
    "| `OPENSTACK_WORKER_STATE_CLOUDS` | データベースからはわからないこと (各ワーカーが生きているか、各プールの使用率) を、Nova と Cinder の API から読み取るための `clouds.yaml` のエントリー |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | それらを読み取るエクスポーターの `host:port`。同梱のものを使う場合は省略します |",
  "| `OPENSTACK_QUOTA_CLOUDS` | The `clouds.yaml` entries to read each project's quotas from, once an hour. Empty reads none, and `OPENSTACK_COLLECT_QUOTAS=true` in the install script fills it in |":
    "| `OPENSTACK_QUOTA_CLOUDS` | 各プロジェクトのクォータを 1 時間に 1 回読み取る `clouds.yaml` のエントリー。 空なら何も読まず、インストールスクリプトの `OPENSTACK_COLLECT_QUOTAS=true` で値が入ります |",
  "The OneUptime AI agent reads the credential in `clouds.yaml` unless these say otherwise, and none is asked for:":
    "これらで別の指定がない限り、OneUptime AI エージェントは `clouds.yaml` の認証情報を読みます。どれも質問されません:",
  "| `ONEUPTIME_AI_INVESTIGATION` | `false` stops OneUptime AI investigating this cloud with the agent |":
    "| `ONEUPTIME_AI_INVESTIGATION` | `false` にすると、OneUptime AI がエージェントでこのクラウドを調査しなくなります |",
  "| `OPENSTACK_AI_CLOUDS_FILE` | The `clouds.yaml` it mounts. `/dev/null` when it has a credential of its own and there is no such file beside it |":
    "| `OPENSTACK_AI_CLOUDS_FILE` | マウントする `clouds.yaml`。専用の認証情報を持ち、横にそのようなファイルがない場合は `/dev/null` |",
  "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | The entry of `clouds.yaml` to use, when it is not the first of `OPENSTACK_EXPORTER_CLOUDS` |":
    "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | 使う `clouds.yaml` のエントリー (`OPENSTACK_EXPORTER_CLOUDS` の先頭でない場合) |",
  "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | A credential of its own, used instead of `clouds.yaml`'s. Set both, with `OPENSTACK_AUTH_URL` |":
    "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | `clouds.yaml` のものの代わりに使う専用の認証情報。両方を、`OPENSTACK_AUTH_URL` とあわせて設定します |",
  "| `OPENSTACK_AUTH_URL` | The Keystone a credential of its own logs in to |":
    "| `OPENSTACK_AUTH_URL` | 専用の認証情報がログインする Keystone |",
  "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | The region a command reads when it names none, which endpoints it uses (`public`, `internal` or `admin`), and a certificate authority. `clouds.yaml` says these unless they do |":
    "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | コマンドがリージョンを指定しないときに読むリージョン、使うエンドポイント (`public`、`internal`、`admin`)、そして認証局。これらで指定しない限り、`clouds.yaml` の値が使われます |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | The name it registers under, when it is not `OPENSTACK_CLOUD_NAME` |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | 登録時の名前 (`OPENSTACK_CLOUD_NAME` でない場合) |",
  "| `LOG_LEVEL` | How much it logs |": "| `LOG_LEVEL` | ログの詳しさ |",
  "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | Off until set: let it make changes, through a credential of their own. The OpenStack guide says how to make it with the least it needs |":
    "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | 設定するまではオフ: 専用の認証情報を通じて変更を許可します。必要最小限で作成する方法は OpenStack のガイドにあります |",
  "| `ONEUPTIME_AI_FIXES` | How AI may apply a fix: off, ask-for-approval, automatic or bypass-approval. Empty: fixes stay off until someone chooses on this page |":
    "| `ONEUPTIME_AI_FIXES` | AI が修正を適用する方法: off、ask-for-approval、automatic、bypass-approval。空の場合: 誰かがこのページで選ぶまで修正はオフのままです |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | What is never touched, whatever else is set and whoever approves it: `project:ID`, `host:NAME` or `instance:ID`, separated by commas |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | ほかに何が設定されていても、誰が承認しても、決して触れないもの: `project:ID`、`host:NAME`、`instance:ID` をカンマ区切りで |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | Where changes may land, written the same way. Empty: anywhere that is not protected |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | 変更を加えてよい場所 (同じ書き方)。空の場合: 保護されていない場所すべて |",
  "Set `OPENSTACK_EXPORTER_ADDRESS` as you run the install script, such as `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. The bundled exporter then never starts, and no Keystone URL or credential is asked for.":
    "インストールスクリプトの実行時に `OPENSTACK_EXPORTER_ADDRESS` を設定します (例: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`)。こうすると同梱のエクスポーターは起動せず、Keystone の URL や認証情報も尋ねられません。",
  "Your exporter must run with `--multi-cloud`, and its `clouds.yaml` needs an entry named for each region. Turn off what the bundled one turns off: see **What the agent collects, and what it costs your cloud**. Use an address the agent's container can reach: `localhost` inside the container is the container itself.":
    "ご自身のエクスポーターは `--multi-cloud` 付きで動かし、その `clouds.yaml` にはリージョンごとにその名前のエントリーが必要です。同梱のものがオフにしているものはオフにしてください: **エージェントが収集する内容と、クラウドにかかる負荷** を参照してください。エージェントのコンテナーから到達できるアドレスを使ってください: コンテナー内の `localhost` はそのコンテナー自身です。",
  "**Started without `--multi-cloud`?** Kolla-Ansible's is, and Canonical's charm. It has no `/probe`, so set `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` instead of the address above, with `OPENSTACK_EXPORTER_CLOUDS=[]` and `OPENSTACK_CONTROL_PLANE_REGION`. It is then asked for everything at once, every 2 minutes.":
    "**`--multi-cloud` なしで起動していますか？** Kolla-Ansible のものも Canonical の charm もそうです。`/probe` がないので、上のアドレスの代わりに `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` を設定し、`OPENSTACK_EXPORTER_CLOUDS=[]` と `OPENSTACK_CONTROL_PLANE_REGION` もあわせて設定します。その場合、2 分ごとにすべてを一度に要求されます。",
  "**On exporter 1.7.0,** which Kolla-Ansible pins, it answers either way, and the pages go without what it does not say. On five real clouds that was:":
    "**エクスポーター 1.7.0 では、** (Kolla-Ansible が固定するバージョン) どちらの方法でも応答しますが、エクスポーターが返さないものはページに欠けます。5 つの実際のクラウドでは次のとおりでした:",
  "Give the install script the file when it asks for a private CA file. It copies it to `ca.pem`, and names it in `clouds.yaml`.":
    "インストールスクリプトがプライベート CA ファイルを尋ねたら、そのファイルを渡してください。スクリプトはそれを `ca.pem` にコピーし、`clouds.yaml` で指定します。",
  "On Linux (x86_64 or arm64) with systemd 235 or later and glibc 2.34 or later (not RHEL 8), the install script can run the same collector and exporter releases as systemd services instead:":
    "systemd 235 以降と glibc 2.34 以降の Linux (x86_64 または arm64、RHEL 8 は除く) では、インストールスクリプトは同じリリースのコレクターとエクスポーターを、代わりに systemd サービスとして動かせます:",
  "Moving off a Docker install? Run `docker compose down` first, or every metric arrives twice. Running the script again stays whichever it was, so `sudo bash install.sh` is the upgrade.":
    "Docker でのインストールから移行しますか？ 先に `docker compose down` を実行してください。そうしないとすべてのメトリクスが二重に届きます。スクリプトを再実行しても方式はそのままなので、`sudo bash install.sh` がアップグレードになります。",
  "The `resource` processor in `otel-collector-config.yaml` stamps every metric with the cloud's name. OneUptime registers the cloud from that attribute, and every page and monitor scopes on it. The two deletes keep OneUptime from registering a Service named after the scrape job, so keep them if you customize the file:":
    "`otel-collector-config.yaml` の `resource` プロセッサーは、すべてのメトリクスにクラウドの名前を付けます。OneUptime はその属性からクラウドを登録し、すべてのページとモニターがそれで範囲を絞ります。2 つの削除は、スクレイプジョブにちなんだ名前のサービスが OneUptime に登録されるのを防ぐので、ファイルをカスタマイズする場合も残しておいてください:",
  "The whole file is on this OneUptime:":
    "ファイル全体はこの OneUptime にあります:",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cloud: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `openstack.cloud.name`:":
    "`oneuptime.label.` で始まるリソース属性は、クラウドのプロジェクトラベルになります: `oneuptime.label.<dimension>=<value>` はラベル `<dimension>:<value>` です。`otel-collector-config.yaml` の `resource` プロセッサーの、`openstack.cloud.name` の横に追加します:",
  "Then restart the collector so it reads the new config:":
    "次に、新しい設定を読み込むようにコレクターを再起動します:",
  "The cloud shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "クラウドには `team:platform` と `env:production` のタグが付いて表示されます。ラベルは大文字と小文字を区別せずに照合されるので、既存の `Production` ラベルが再利用されます。OneUptime の UI で追加したラベルを、エージェントが削除することはありません。",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` and `clouds.yaml` (nothing is asked again), downloads the latest files (a file you edited is kept next to the new one as `<file>.bak.<timestamp>`), pulls the images and recreates the agent with them:":
    "**アップグレード。** イメージは `docker-compose.yml` で固定され、その設定は横にあるファイルなので、pull だけではエージェントは新しくなりません。インストールスクリプトを再実行してください。既存の `.env` と `clouds.yaml` の値をすべて再利用し (何も尋ねません)、最新のファイルをダウンロードし (編集したファイルは新しいファイルの横に `<file>.bak.<timestamp>` として残ります)、イメージを pull し、それでエージェントを作り直します:",
  "The config reports the collector version it pins as the cloud's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "設定は、固定しているコレクターのバージョンをクラウドの **エージェントバージョン** として報告します。この OneUptime がより新しいバージョンを固定すると、その横の警告マークからこれらのコマンドが開きます。",
  "**Uninstall** the agent:": "エージェントを **アンインストール** する:",
  "Then delete `/opt/oneuptime-openstack-agent`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "次に、認証情報を含む `/opt/oneuptime-openstack-agent` と、アプリケーション認証情報そのものを削除します: `openstack application credential delete oneuptime-agent`。",
  "`troubleshoot.sh` checks the whole chain, from DNS and TLS to Keystone, each service in the catalog and your ingestion key, and says what this credential can read and what each gap costs.":
    "`troubleshoot.sh` は、DNS と TLS から Keystone、カタログ内の各サービス、取り込みキーまでチェーン全体を確認し、この認証情報で読み取れるものと、欠けているものごとの影響を示します。",
  "It needs `sudo` to read `clouds.yaml`, or it skips the credential checks. It ends with a verdict naming the most likely cause.":
    "`clouds.yaml` を読むには `sudo` が必要で、ないと認証情報のチェックを飛ばします。最後に、最も可能性の高い原因を挙げた結論を出します。",
  "1. Check that the agent is running (in `/opt/oneuptime-openstack-agent`): `docker compose ps`":
    "1. エージェントが動いていることを確認します (`/opt/oneuptime-openstack-agent` で): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-openstack-agent | grep -i error`":
    "2. エージェントのログでエラーを確認します: `docker compose logs oneuptime-openstack-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. OneUptime の URL と取り込みキーが正しいことを確認します。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. エージェントのマシンからネットワーク経由で OneUptime インスタンスに到達できることを確認します。",
  "A **Project view** credential can't read them, and neither can a role without the policy overrides: Nova, Neutron and Placement keep them for admins by default. Use **Full view**, or **Infrastructure only** with the files in `access/policy` merged into the file each service's `[oslo_policy] policy_file` names. `troubleshoot.sh` says which reads were refused.":
    "**プロジェクトビュー** の認証情報では読み取れず、ポリシーオーバーライドのないロールでも読み取れません: Nova、Neutron、Placement は既定でそれらを管理者に限っています。**フルビュー** を使うか、`access/policy` のファイルを各サービスの `[oslo_policy] policy_file` が指すファイルにマージしたうえで **インフラのみ** を使ってください。どの読み取りが拒否されたかは `troubleshoot.sh` が示します。",
  "Only **Full view** sees `cinder-volume` and `cinder-scheduler` state and storage pools. Cinder's own code answers anything else with `403 User does not have admin privileges`, after policy has already passed, so no override opens them.":
    "`cinder-volume` と `cinder-scheduler` の状態とストレージプールが見えるのは **フルビュー** だけです。ポリシーを通過したあとで、Cinder 自身のコードがそれ以外には `403 User does not have admin privileges` で応答するため、どのオーバーライドでも開けません。",
  "Neutron and Cinder answer anything but an admin with `200` and only its own project, which looks like it worked. Seeing every project takes **Full view**. With **Infrastructure only**, they appear for the projects the role is assigned on, and a role on a real project can also write there on many clouds.":
    "Neutron と Cinder は、管理者以外には `200` と自分のプロジェクトだけを返すので、うまくいったように見えます。すべてのプロジェクトを見るには **フルビュー** が必要です。**インフラのみ** では、ロールが割り当てられたプロジェクトの分が表示され、実際のプロジェクトに付けたロールは、多くのクラウドでそこに書き込むこともできます。",
  "A **Project view** credential shows no instances through the agent: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. **Full view** and **Infrastructure only** both see every project's instances.":
    "**プロジェクトビュー** の認証情報では、エージェント経由でインスタンスは表示されません: エクスポーターは Nova に全プロジェクトのサーバーを要求し、Nova は通常の閲覧者を拒否し、その読み取りは丸ごと失敗します。**フルビュー** と **インフラのみ** はどちらも、すべてのプロジェクトのインスタンスを見ます。",
  "That is expected with **Infrastructure only**, and harmless. Neutron tries to create a project's default security group when it lists them, and a project with zero quota cannot hold one. There is nothing to fix.":
    "**インフラのみ** ではこれは想定どおりで、無害です。Neutron はセキュリティグループを一覧表示するときにプロジェクトの既定のセキュリティグループを作成しようとしますが、クォータがゼロのプロジェクトには作成できません。直すものはありません。",
  "On Flamingo and Epoxy, oslo.policy raises on every check once a policy file it has read is gone, and when the service is Keystone the whole cloud answers `503`. Restart the service. To take the overrides off, empty the file (`{}`) and never delete it.":
    "Flamingo と Epoxy では、読み込んだポリシーファイルがなくなると oslo.policy がすべてのチェックでエラーを出し、そのサービスが Keystone の場合はクラウド全体が `503` を返します。サービスを再起動してください。オーバーライドを外すときは、ファイルを空 (`{}`) にし、決して削除しないでください。",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "エージェントは各サービスを個別に読み取るので、失敗したサービスで失うのはそのサービスの数値だけです。 エクスポーターが読み取れない理由を確認してください (`/opt/oneuptime-openstack-agent` で): `docker compose logs oneuptime-openstack-exporter`。**サービス** ページでは、その API が `down` と表示されます。古いルールのコピーから作ったアクセスルール付き認証情報も、Swift と、パスの背後にある Octavia で同じことを起こします: **フルビュー** の手順どおりに新しく作り直してください。",
  "The services are refusing a credential limited by access rules. A service behind a path prefix refuses the shipped rules: fit them to this cloud with `access-rules-for-cloud.py`, as **Full view** does. And each service needs `service_type` set for keystonemiddleware, and a restart:":
    "サービスが、アクセスルールで制限された認証情報を拒否しています。パスプレフィックスの背後にあるサービスは同梱のルールを拒否します: **フルビュー** の手順どおりに、`access-rules-for-cloud.py` でルールをこのクラウドに合わせてください。また、各サービスには keystonemiddleware 用の `service_type` の設定と再起動が必要です:",
  "If you won't change that, create the credential without `--access-rules`, knowing it can write.":
    "これを変更しない場合は、書き込みもできることを承知のうえで、`--access-rules` なしで認証情報を作成します。",
  "The exporter runs as uid 65532, and `clouds.yaml` is readable by its owner alone. Give the file to that user, or set `OPENSTACK_EXPORTER_USER` in `.env` to the file owner's `uid:gid`, and apply it with `docker compose up -d`.":
    "エクスポーターは uid 65532 で動き、`clouds.yaml` は所有者しか読めません。ファイルをそのユーザーの所有にするか、`.env` で `OPENSTACK_EXPORTER_USER` をファイル所有者の `uid:gid` に設定し、`docker compose up -d` で適用します。",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "クラウドの識別情報は `OPENSTACK_CLOUD_NAME` から来ており、すべてのメトリクスに `openstack.cloud.name` として付きます。`.env` で修正し、`/opt/oneuptime-openstack-agent` で `docker compose up -d` を実行して適用します。新しい名前は新しいクラウドとして登録されます。",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "クラウドの識別情報は `OPENSTACK_CLOUD_NAME` から来ており、すべてのメトリクスに `openstack.cloud.name` として付きます。このクラウドは **`cloud-1`** です。`.env` で修正し、`/opt/oneuptime-openstack-agent` で `docker compose up -d` を実行して適用します。新しい名前は新しいクラウドとして登録されます。",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent":
    "Docker Engine 20.10 以降と Docker Compose v2 プラグインが入った、エージェントを動かすマシン",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "この OneUptime から、`docker-compose.yml` と `otel-collector-config.yaml` を新しいフォルダーにダウンロードします:",
  "Create a `clouds.yaml` file next to them, with the credential from the previous step. It needs one entry per region, each named for its region, because the exporter's series do not say which region they are from:":
    "その横に、前のステップの認証情報を入れた `clouds.yaml` ファイルを作成します。エクスポーターの系列にはどのリージョンのものかが含まれないため、リージョンごとに、そのリージョン名を付けたエントリーが 1 つずつ必要です:",
  "Create a `.env` file next to them too:":
    "その横に `.env` ファイルも作成します:",
  "- Replace `my-openstack-cloud` with a name for this cloud, such as `prod-eu`. It is how the cloud appears in OneUptime, so keep it stable: a new name registers a new cloud.":
    "- `my-openstack-cloud` を、このクラウドの名前 (例: `prod-eu`) に置き換えます。これが OneUptime でのクラウドの表示名なので、変えないでください。新しい名前は新しいクラウドとして登録されます。",
  "- List every region in `OPENSTACK_EXPORTER_CLOUDS`, in square brackets, such as `[RegionOne,RegionTwo]`.":
    "- `OPENSTACK_EXPORTER_CLOUDS` に、すべてのリージョンを角かっこで囲んで列挙します (例: `[RegionOne,RegionTwo]`)。",
  "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` starts the bundled exporter, which reads the cloud with `clouds.yaml`, and the OneUptime AI agent, which reads it with the same file while OneUptime AI investigates.":
    "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` は、`clouds.yaml` でクラウドを読む同梱のエクスポーターと、OneUptime AI が調査する間、同じファイルでクラウドを読む OneUptime AI エージェントを起動します。",
  "Both files hold secrets, so keep them to their owner. The exporter runs as uid 65532, and must be the one account that can read `clouds.yaml`. Then start the agent:":
    "どちらのファイルにもシークレットが含まれるので、所有者だけが読めるようにしてください。エクスポーターは uid 65532 で動き、`clouds.yaml` を読めるアカウントはそれだけでなければなりません。次に、エージェントを起動します:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` に値が入ります。",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Add one `clouds.yaml` entry per region, and list them all in `OPENSTACK_EXPORTER_CLOUDS`. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "1 つのクラウドは、リージョンがいくつあっても 1 つの Keystone で、1 つのエージェントがそのすべてを読み取ります。リージョンごとに `clouds.yaml` のエントリーを 1 つ追加し、そのすべてを `OPENSTACK_EXPORTER_CLOUDS` に列挙します。各エントリーにはリージョンの名前を付ける必要があります: 系列にはどのリージョンのものかが含まれないため、コレクターがその名前を `openstack.region.name` としてエクスポーターの系列に付けます。これで OneUptime のすべての一覧をリージョンで絞り込めます。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "エージェントはこれらを `docker-compose.yml` の横の `.env` ファイルから読みます。変更したら、`docker-compose.yml` のあるフォルダーで `docker compose up -d` を実行して適用します。",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter, as `host:port` with no scheme: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. The bundled exporter then never starts.":
    "`.env` から `COMPOSE_PROFILES` を外し、エージェントの向き先をご自身のエクスポーターにします。スキームなしの `host:port` で指定します: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`。こうすると同梱のエクスポーターは起動しません。",
  "Put the file next to `docker-compose.yml` as `ca.pem`, set `OPENSTACK_CA_FILE=./ca.pem` in `.env`, and add `cacert: /etc/openstack/ca.pem` to each entry of `clouds.yaml`.":
    "ファイルを `ca.pem` として `docker-compose.yml` の横に置き、`.env` に `OPENSTACK_CA_FILE=./ca.pem` を設定し、`clouds.yaml` の各エントリーに `cacert: /etc/openstack/ca.pem` を追加します。",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "これらは、エージェントのフォルダー (`docker-compose.yml` のあるフォルダー) で実行してください。",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `clouds.yaml` stay, and a change you made to either file has to be made again:":
    "**アップグレード。** イメージは `docker-compose.yml` で固定され、その設定は横にあるファイルなので、pull だけではエージェントは新しくなりません。両方のファイルをもう一度ダウンロードしてください。`.env` と `clouds.yaml` はそのまま残りますが、ダウンロードした 2 つのファイルに加えた変更は、もう一度加える必要があります:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "次に、イメージを pull してエージェントを作り直し、コレクターに新しい設定を読み込ませます:",
  "Then delete the folder with `docker-compose.yml`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "次に、認証情報を含む `docker-compose.yml` のフォルダーと、アプリケーション認証情報そのものを削除します: `openstack application credential delete oneuptime-agent`。",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. エージェントが動いていることを確認します (エージェントのフォルダーで): `docker compose ps`",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in the agent's folder): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "エージェントは各サービスを個別に読み取るので、失敗したサービスで失うのはそのサービスの数値だけです。 エクスポーターが読み取れない理由を確認してください (エージェントのフォルダーで): `docker compose logs oneuptime-openstack-exporter`。**サービス** ページでは、その API が `down` と表示されます。古いルールのコピーから作ったアクセスルール付き認証情報も、Swift と、パスの背後にある Octavia で同じことを起こします: **フルビュー** の手順どおりに新しく作り直してください。",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "クラウドの識別情報は `OPENSTACK_CLOUD_NAME` から来ており、すべてのメトリクスに `openstack.cloud.name` として付きます。`.env` で修正し、`docker-compose.yml` のあるフォルダーで `docker compose up -d` を実行して適用します。新しい名前は新しいクラウドとして登録されます。",
  "- This installs the agent for **`cloud-1`**. Keep `OPENSTACK_CLOUD_NAME` exactly as it is, or the data registers as a new cloud.":
    "- これは **`cloud-1`** 用にエージェントをインストールします。`OPENSTACK_CLOUD_NAME` は変えないでください。変えると、データは新しいクラウドとして登録されます。",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "クラウドの識別情報は `OPENSTACK_CLOUD_NAME` から来ており、すべてのメトリクスに `openstack.cloud.name` として付きます。このクラウドは **`cloud-1`** です。`.env` で修正し、`docker-compose.yml` のあるフォルダーで `docker compose up -d` を実行して適用します。新しい名前は新しいクラウドとして登録されます。",
  "OpenStack-Ansible keeps its services' logs in journald and runs no Prometheus of its own, so the agent is the way in, and the logs have a path of their own.":
    "OpenStack-Ansible はサービスのログを journald に保持し、独自の Prometheus は動かさないので、エージェントが入り口になり、ログには専用の経路があります。",
  "**How far this guide has been tested:** Its paths and variables were read from OpenStack-Ansible's own source and docs. Its commands were then run on a real all-in-one at stable/2026.1, in LXC containers, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, the agent's exporter on the Infrastructure only credential with its policy overrides, the RabbitMQ and HAProxy settings with the agent reading each, and the logs profile on the journal. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**このガイドのテスト範囲:** パスと変数は OpenStack-Ansible 自身のソースとドキュメントから読み取りました。そのうえでコマンドを、LXC コンテナーで動く stable/2026.1 の実際の all-in-one で、エージェントが送ったものを保持する OneUptime の代役を相手に実行しました。対象は、フルビューの認証情報でのエージェント、インフラのみの認証情報とそのポリシーオーバーライドでのエージェントのエクスポーター、RabbitMQ と HAProxy の設定 (それぞれをエージェントが読み取り)、そして journal でのログプロファイルです。エージェントとプローブはそれぞれ、実際の DevStack を、nova-compute の停止と復旧を経て、稼働中の OneUptime まで通しましたが、このツールからではありません。",
  "- Log in as an admin from the utility container: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, then `. ~/openrc`. It has no `curl`, which the commands below use, so run `apt-get install -y curl` there first.":
    "- utility コンテナーから管理者としてログインします: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`、続けて `. ~/openrc`。このコンテナーには下のコマンドが使う `curl` がないので、先にそこで `apt-get install -y curl` を実行します。",
  "- **Full view** needs one change, to Cinder. OpenStack-Ansible's roles already set `service_type` under `[keystone_authtoken]`, but its Cinder says `volumev3` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Set `service_type: block-storage` under `keystone_authtoken` in `cinder_cinder_conf_overrides` in `/etc/openstack_deploy/user_variables.yml`, then run `openstack-ansible openstack.osa.cinder --tags cinder-config`.":
    "- **フルビュー** には Cinder への変更が 1 つ必要です。OpenStack-Ansible のロールはすでに `[keystone_authtoken]` に `service_type` を設定していますが、その Cinder は `volumev3`、カタログは `block-storage` と言い、両者が一致しない限り、keystonemiddleware はアクセスルールで制限された認証情報を `401` で拒否します。`/etc/openstack_deploy/user_variables.yml` の `cinder_cinder_conf_overrides` で、`keystone_authtoken` の下に `service_type: block-storage` を設定し、`openstack-ansible openstack.osa.cinder --tags cinder-config` を実行します。",
  "- **Infrastructure only** takes its overrides as `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` and `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Apply each with its own playbook and tag, such as `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Taking one out later leaves an empty file behind rather than none, so nothing fails.":
    "- **インフラのみ** のオーバーライドは、`/etc/openstack_deploy/user_variables.yml` の `nova_policy_overrides`、`neutron_policy_overrides`、`keystone_policy_overrides`、`placement_policy_overrides` として指定します。それぞれを専用の playbook とタグで適用します (例: `openstack-ansible openstack.osa.nova --tags nova-policy-override`)。あとから 1 つを外しても、ファイルがなくなるのではなく空のファイルが残るので、何も失敗しません。",
  "- **RabbitMQ:** turn on its Prometheus plugin, then name each container's address on `15692` as `OPENSTACK_RABBITMQ_TARGETS` in the agent's `.env`:":
    "- **RabbitMQ:** Prometheus プラグインをオンにし、各コンテナーの `15692` のアドレスを、エージェントの `.env` の `OPENSTACK_RABBITMQ_TARGETS` に指定します:",
  "- **HAProxy:** its exporter is off, and its stats listener is on `127.0.0.1` with TLS, which the agent cannot read. Turn it on where the agent can, then name that address on `1936` as `OPENSTACK_HAPROXY_TARGETS`:":
    "- **HAProxy:** エクスポーターはオフで、統計リスナーは TLS 付きの `127.0.0.1` にあり、エージェントは読めません。エージェントが読める場所でオンにし、その `1936` のアドレスを `OPENSTACK_HAPROXY_TARGETS` に指定します:",
  "- **MariaDB and Memcached:** OpenStack-Ansible ships no exporter for either. Run [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) and [memcached_exporter](https://github.com/prometheus/memcached_exporter) yourself and name them as `OPENSTACK_MARIADB_TARGETS` and `OPENSTACK_MEMCACHED_TARGETS`, or leave them out: the cloud's **Control Plane** card then says they are not watched, rather than that they are fine.":
    "- **MariaDB と Memcached:** OpenStack-Ansible はどちらのエクスポーターも同梱していません。[mysqld_exporter](https://github.com/prometheus/mysqld_exporter) と [memcached_exporter](https://github.com/prometheus/memcached_exporter) をご自身で動かして `OPENSTACK_MARIADB_TARGETS` と `OPENSTACK_MEMCACHED_TARGETS` に指定するか、省略してください: 省略すると、クラウドの **コントロールプレーン** カードには、正常ではなく監視対象外と表示されます。",
  "This runs the agent's logs profile as a systemd service, and reads `/var/log/journal/`, where OpenStack-Ansible's containers' journals arrive.":
    "これはエージェントのログプロファイルを systemd サービスとして動かし、OpenStack-Ansible のコンテナーの journal が届く `/var/log/journal/` を読み取ります。",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from the journal.":
    "どちらもサービス自身のログに書き込み、バス上にコンシューマーはいません。**セキュリティイベント → 接続** で **ログからセキュリティイベントを見つける** をオンにすると、OneUptime はそこからそれらを読み取ります。 エージェントのログプロファイルは、どちらも journal から読み取ります。",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw. A second value of `notification_opt_out` goes in as a YAML set, as [its config_template](https://docs.openstack.org/ansible-config_template/latest/) writes a repeated key.":
    "これはログインごとに 1 行を送り、それを **OpenStack admin credential used from a new address** が読み取ります。失敗したログインだけを送るには、`notification_opt_out` に `identity.authenticate.success` を追加します。その検出は、監査フィルターが見たものを読むようになります。 `notification_opt_out` の 2 つ目の値は、[その config_template](https://docs.openstack.org/ansible-config_template/latest/) が繰り返しのキーを書くのと同じく、YAML のセットとして入れます。",
  "For who did what through Nova, Neutron, Cinder and Glance, each API takes the filter's setting in its conf overrides, and the filter in its paste overrides, with `audit` right after `authtoken` and the context filter that follows it in each pipeline. Nova's, and the same in `neutron_neutron_conf_overrides` and `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` and `cinder_api_paste_ini_overrides`, and `glance_glance_api_conf_overrides` and `glance_glance_api_paste_ini_overrides`:":
    "Nova、Neutron、Cinder、Glance を通じて誰が何をしたかを知るには、各 API の conf オーバーライドにフィルターの設定を、paste オーバーライドにフィルターを入れます。各パイプラインでは、`audit` を `authtoken` とそれに続くコンテキストフィルターの直後に置きます。これは Nova の例で、`neutron_neutron_conf_overrides` と `neutron_api_paste_ini_overrides`、`cinder_cinder_conf_overrides` と `cinder_api_paste_ini_overrides`、`glance_glance_api_conf_overrides` と `glance_glance_api_paste_ini_overrides` も同様です:",
  "OpenStack-Helm offers charts for Prometheus, Alertmanager and exporters, and whether they are running is up to you. Its control plane runs in Kubernetes, so a probe reads the APIs and the Kubernetes agent sees the pods.":
    "OpenStack-Helm は Prometheus、Alertmanager、エクスポーター向けの chart を提供しており、それらを動かすかどうかはあなた次第です。そのコントロールプレーンは Kubernetes で動くので、プローブが API を読み、Kubernetes エージェントがポッドを見ます。",
  "**How far this guide has been tested:** Its chart values were read from OpenStack-Helm's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**このガイドのテスト範囲:** chart の値は OpenStack-Helm 自身のソースから読み取りました。このツールの実際のデプロイで、最初から最後まで通して試したことはありません。エージェントとプローブはそれぞれ、実際の DevStack を、nova-compute の停止と復旧を経て、稼働中の OneUptime まで通しましたが、このツールからではありません。プローブと Kubernetes エージェントはそれぞれ個別にテストしたもので、このツール上で一緒に試してはいません。",
  "Then add the receiver under `conf.alertmanager` in the chart's values, and send your route to it:":
    "次に、chart の値の `conf.alertmanager` にレシーバーを追加し、ルートをそこに向けます:",
  "Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. [OpenStack Without an Agent](/docs/telemetry/openstack-agentless) says what each level of access reads, and the connection test says what yours can. The agent also works from any machine with a route to the APIs: choose **Not sure, or something else** above for its steps.":
    "**OpenStack → すべてのクラウド** を開き、**クラウドを接続** をクリックして、Keystone のアドレス、アプリケーション認証情報、使うプローブを指定します。プローブはクラウドと HTTPS でしか通信しません。各アクセスレベルが読み取るものは [エージェントなしの OpenStack](/docs/telemetry/openstack-agentless) に、あなたのレベルで読めるものは接続テストに示されます。エージェントは API へのルートがあるどのマシンからでも動きます: その手順を見るには、上で **不明、またはその他** を選んでください。",
  "Follow **Kubernetes → Documentation** for this cluster. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "このクラスターの **Kubernetes → ドキュメント** に従ってください。これでポッド、そのログ、ノードが Kubernetes のページに届き、その中の OpenStack サービスもそこで監視されます。",
  "To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:":
    "それらのサービスのログを、スタックトレースごとに 1 レコードとしてこのクラウドの **ログ** ページにも載せるには、サービスが動く名前空間とあわせて、エージェントの値でクラウドを指定します:",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.":
    "どちらもサービス自身のログに書き込み、バス上にコンシューマーはいません。**セキュリティイベント → 接続** で **ログからセキュリティイベントを見つける** をオンにすると、OneUptime はそこからそれらを読み取ります。 Kubernetes エージェントは、値で指定されたクラウドとして、どちらもポッドのログから読み取ります。",
  "A chart's `logging.conf` keeps the root logger at `WARNING`, and the log driver writes under a logger of its own, so without one for it nothing is written. A list in values replaces the chart's, so `keys` holds what the chart's has, plus this:":
    "chart の `logging.conf` はルートロガーを `WARNING` に保ち、ログドライバーは専用のロガーで書き込むので、そのロガーがないと何も書き込まれません。値に書いたリストは chart のリストを置き換えるので、`keys` には chart の内容に加えて次のものを入れます:",
  "For who did what through Nova, Neutron and Cinder, their charts' `conf.paste` already has the audit filter in each pipeline, and it needs telling where to write. Each needs the same logger, in `conf.logging`. Glance's chart has the map, and neither the filter nor a place for it in its pipelines: add both to its `conf.paste`.":
    "Nova、Neutron、Cinder を通じて誰が何をしたかを知るには、その chart の `conf.paste` にはすでに各パイプラインに監査フィルターがあり、書き込み先を指定するだけです。どれも `conf.logging` に同じロガーが必要です。Glance の chart にはマップがありますが、フィルターもパイプライン内のその場所もありません: 両方をその `conf.paste` に追加してください。",
  "Atmosphere runs kube-prometheus-stack with its own alert rules, and Loki with Vector for logs. Forward its alerts first, then a probe reads the APIs and the Kubernetes agent sees the pods.":
    "Atmosphere は独自のアラートルール付きの kube-prometheus-stack と、ログ用に Vector 付きの Loki を動かします。まずそのアラートを転送し、そのうえでプローブが API を読み、Kubernetes エージェントがポッドを見ます。",
  "**How far this guide has been tested:** Its configuration was read from Atmosphere's own docs and source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**このガイドのテスト範囲:** 設定は Atmosphere 自身のドキュメントとソースから読み取りました。このツールの実際のデプロイで、最初から最後まで通して試したことはありません。エージェントとプローブはそれぞれ、実際の DevStack を、nova-compute の停止と復旧を経て、稼働中の OneUptime まで通しましたが、このツールからではありません。プローブと Kubernetes エージェントはそれぞれ個別にテストしたもので、このツール上で一緒に試してはいません。",
  "Then add the receiver to your Atmosphere configuration, beside whichever receivers you already have, and deploy it:":
    "次に、既存のレシーバーと並べて Atmosphere の設定にレシーバーを追加し、デプロイします:",
  "For who did what through Nova, Neutron and Cinder, the charts Atmosphere deploys already have the audit filter in each pipeline, and it needs telling where to write, in `nova_helm_values`, `neutron_helm_values` and `cinder_helm_values`. Glance's chart has neither the filter nor a place for it in its pipelines: add both to its `conf.paste`, in `glance_helm_values`.":
    "Nova、Neutron、Cinder を通じて誰が何をしたかを知るには、Atmosphere がデプロイする chart にはすでに各パイプラインに監査フィルターがあり、`nova_helm_values`、`neutron_helm_values`、`cinder_helm_values` で書き込み先を指定するだけです。Glance の chart にはフィルターもパイプライン内のその場所もありません: `glance_helm_values` で、両方をその `conf.paste` に追加してください。",
  "Sunbeam can deploy the Canonical Observability Stack, with `sunbeam enable observability embedded`. Canonical also has an `openstack-exporter` charm, which the agent can read if you run it.":
    "Sunbeam は `sunbeam enable observability embedded` で Canonical Observability Stack をデプロイできます。Canonical には `openstack-exporter` charm もあり、それを動かしていればエージェントが読み取れます。",
  "**How far this guide has been tested:** Its commands were read from Canonical's docs and its charms' source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. Nothing here has been run on Sunbeam, and Sunbeam's own docs do not mention the exporter charm.":
    "**このガイドのテスト範囲:** コマンドは Canonical のドキュメントとその charm のソースから読み取りました。このツールの実際のデプロイで、最初から最後まで通して試したことはありません。エージェントとプローブはそれぞれ、実際の DevStack を、nova-compute の停止と復旧を経て、稼働中の OneUptime まで通しましたが、このツールからではありません。ここにあるものは Sunbeam 上で何も実行しておらず、Sunbeam 自身のドキュメントはエクスポーター charm に触れていません。",
  "Then give the stack's Alertmanager a configuration with the receiver in it:":
    "次に、スタックの Alertmanager に、レシーバーを含む設定を渡します:",
  "If you run Canonical's `openstack-exporter` charm, the agent can read it with no credential of its own. It answers one cloud on `/metrics`, on port `9180` unless you changed its `port` setting. Find its address with `juju status openstack-exporter`:":
    "Canonical の `openstack-exporter` charm を動かしている場合、エージェントは専用の認証情報なしでそれを読み取れます。`port` 設定を変えていなければ、ポート `9180` の `/metrics` で 1 つのクラウドについて応答します。アドレスは `juju status openstack-exporter` で調べます:",
  "Which series it says depends on the exporter release in its snap, which was not recorded here: `bash troubleshoot.sh` says whether it reads the cloud.":
    "どの系列を返すかは snap 内のエクスポーターのリリースによりますが、ここでは記録していません: クラウドを読めるかどうかは `bash troubleshoot.sh` が示します。",
  "With observability on, the stack's Loki holds the services' logs. OneUptime has no way to read Loki, and the agent's logs profile has not been tried on Sunbeam's charms, so nothing here collects them yet.":
    "observability をオンにすると、サービスのログはスタックの Loki が保持します。OneUptime には Loki を読む方法がなく、エージェントのログプロファイルは Sunbeam の charm では試していないので、ここではまだ何もそれらを収集しません。",
  "Sunbeam's charms write each service's configuration from their own templates, and its Keystone charm has no setting for where notifications go. So neither Keystone's audit trail nor the audit filter can be turned on from outside the charm, and nothing here reaches Security Events.":
    "Sunbeam の charm は各サービスの設定を独自のテンプレートから書き出し、その Keystone charm には通知の送り先の設定がありません。そのため、Keystone の監査証跡も監査フィルターも charm の外からはオンにできず、ここからセキュリティイベントに届くものはありません。",
  "Its Telemetry Operator runs Ceilometer's Prometheus exporter and a monitoring stack with Alertmanager on OpenShift. The Kubernetes agent's OpenShift preset watches the control plane, and Ceilometer's exporter says what the compute nodes are doing.":
    "その Telemetry Operator は、Ceilometer の Prometheus エクスポーターと、Alertmanager を含む監視スタックを OpenShift 上で動かします。Kubernetes エージェントの OpenShift プリセットがコントロールプレーンを監視し、Ceilometer のエクスポーターがコンピュートノードの動作を示します。",
  "**How far this guide has been tested:** Its resources were read from the Telemetry Operator's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The OpenShift preset and Ceilometer's exporter were each tested on their own, not together on this tool.":
    "**このガイドのテスト範囲:** リソースは Telemetry Operator 自身のソースから読み取りました。このツールの実際のデプロイで、最初から最後まで通して試したことはありません。エージェントとプローブはそれぞれ、実際の DevStack を、nova-compute の停止と復旧を経て、稼働中の OneUptime まで通しましたが、このツールからではありません。OpenShift プリセットと Ceilometer のエクスポーターはそれぞれ個別にテストしたもので、このツール上で一緒に試してはいません。",
  "Then apply a receiver the monitoring stack picks up:":
    "次に、監視スタックが取り込むレシーバーを適用します:",
  "Follow **Kubernetes → Documentation** for this cluster, with **Red Hat OpenShift** picked, which sets `preset=openshift`. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "**Red Hat OpenShift** を選んで (`preset=openshift` が設定されます)、このクラスターの **Kubernetes → ドキュメント** に従ってください。これでポッド、そのログ、ノードが Kubernetes のページに届き、その中の OpenStack サービスもそこで監視されます。",
  "A probe says what is allocated, not what is busy. To read real usage, run the agent on a machine that can reach the compute nodes, with `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` naming each node on Ceilometer's port, `9101`.":
    "プローブが示すのは割り当て量で、実際の使用量ではありません。実際の使用量を読むには、コンピュートノードに到達できるマシンでエージェントを動かし、`OPENSTACK_CEILOMETER_EXPORTER_TARGETS` に各ノードを Ceilometer のポート `9101` で指定します。",
  "For who did what through Nova and Neutron, each takes the filter's setting in its `customServiceConfig`, and its paste file in `defaultConfigOverwrite`. Cinder's and Glance's operators take no paste file, so nothing here reaches them.":
    "Nova と Neutron を通じて誰が何をしたかを知るには、それぞれの `customServiceConfig` にフィルターの設定を、`defaultConfigOverwrite` に paste ファイルを入れます。Cinder と Glance のオペレーターは paste ファイルを受け付けないので、ここからそれらには届きません。",
  "StackLight already watches OpenStack's services, MariaDB, Memcached, RabbitMQ and libvirt, with its own alert rules. Forward its alerts first, then a probe reads the APIs.":
    "StackLight は独自のアラートルールで、OpenStack のサービス、MariaDB、Memcached、RabbitMQ、libvirt をすでに監視しています。まずそのアラートを転送し、そのうえでプローブが API を読みます。",
  "**How far this guide has been tested:** Its settings were read from Mirantis's docs, whose examples show other receivers rather than a webhook. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**このガイドのテスト範囲:** 設定は Mirantis のドキュメントから読み取りましたが、その例は Webhook ではなく別のレシーバーを示しています。このツールの実際のデプロイで、最初から最後まで通して試したことはありません。エージェントとプローブはそれぞれ、実際の DevStack を、nova-compute の停止と復旧を経て、稼働中の OneUptime まで通しましたが、このツールからではありません。",
  "Then add the receiver and its route to your StackLight values:":
    "次に、StackLight の値にレシーバーとそのルートを追加します:",
  "For who did what through Nova, Neutron, Cinder and Glance, MOSK has a setting of its own, with the audit filter already in place. With the log driver, each service writes to its standard output, and the Kubernetes agent reads that from the pods' logs, with the cloud named in its values. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "Nova、Neutron、Cinder、Glance を通じて誰が何をしたかを知るには、MOSK に専用の設定があり、監査フィルターはすでに組み込まれています。ログドライバーを使うと各サービスは標準出力に書き込み、Kubernetes エージェントは値で指定されたクラウドとして、それをポッドのログから読み取ります。どちらもサービス自身のログに書き込み、バス上にコンシューマーはいません。**セキュリティイベント → 接続** で **ログからセキュリティイベントを見つける** をオンにすると、OneUptime はそこからそれらを読み取ります。",
  "That setting does not cover Keystone. Its own audit trail takes `spec:services`, which Mirantis does not validate and takes no responsibility for, so weigh this with your support contract:":
    "その設定は Keystone を対象にしていません。Keystone 自身の監査証跡には `spec:services` を使いますが、Mirantis はこれを検証せず責任も負わないので、サポート契約と照らし合わせて判断してください:",
  "Keystone's audit trail says who signed in and who changed what in Keystone, and the audit filter says who did what through Nova, Neutron, Cinder and Glance. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "Keystone の監査証跡は、誰がサインインし、誰が Keystone で何を変更したかを示し、監査フィルターは、Nova、Neutron、Cinder、Glance を通じて誰が何をしたかを示します。どちらもサービス自身のログに書き込み、バス上にコンシューマーはいません。**セキュリティイベント → 接続** で **ログからセキュリティイベントを見つける** をオンにすると、OneUptime はそこからそれらを読み取ります。",
  "The audit filter goes in each API's paste file, right after `authtoken` and the context filter that follows it in each pipeline, with the map file pyCADF ships for that service, in `etc/pycadf` under the Python environment the service runs in. Not at the end of a pipeline: Neutron's `extensions` filter answers its routers and security groups, and the filter would never see them.":
    "監査フィルターは各 API の paste ファイルの、各パイプラインで `authtoken` とそれに続くコンテキストフィルターの直後に、pyCADF がそのサービス用に同梱するマップファイルとともに入れます。マップファイルは、サービスが動く Python 環境の `etc/pycadf` にあります。パイプラインの末尾には置かないでください: Neutron の `extensions` フィルターがルーターとセキュリティグループに応答するので、監査フィルターはそれらを見られなくなります。",
  "[Who did what](/docs/telemetry/openstack#who-did-what) says what reaches Security Events, and [each tool's guide](/docs/telemetry/openstack-deployment-tools) says where these go on it.":
    "セキュリティイベントに届くものは [誰が何をしたか](/docs/telemetry/openstack#who-did-what) に、それぞれのツールでの置き場所は [各ツールのガイド](/docs/telemetry/openstack-deployment-tools) にあります。",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | いいえ | コレクターのコンテナー名 (既定: `oneuptime-openstack-agent`)。同じマシン上の 2 つ目のクラウドのエージェントには専用の名前が必要です。設定しない場合、インストールスクリプトは新しいエージェントのコンテナーにそのフォルダーにちなんだ名前を付け、スクリプトを再実行してもその名前を維持します |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). The install script names a second cloud's bundled exporter after its collector (`oneuptime-openstack-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | いいえ | 同梱のエクスポーターのコンテナー名 (既定: `oneuptime-openstack-exporter`)。設定しない場合、インストールスクリプトは 2 つ目のクラウドの同梱のエクスポーターにそのコレクターにちなんだ名前を付け (`oneuptime-openstack-exporter-cloud2` を `oneuptime-openstack-agent-cloud2` の隣に)、スクリプトを再実行してもその名前を維持します |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). The install script names a second cloud's quota exporter after its collector (`oneuptime-openstack-quota-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | いいえ | クォータのエクスポーターのコンテナー名 (既定: `oneuptime-openstack-quota-exporter`)。設定しない場合、インストールスクリプトは 2 つ目のクラウドのクォータのエクスポーターにそのコレクターにちなんだ名前を付け (`oneuptime-openstack-quota-exporter-cloud2` を `oneuptime-openstack-agent-cloud2` の隣に)、スクリプトを再実行してもその名前を維持します |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). The install script names a second cloud's database exporter after its collector (`oneuptime-openstack-database-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | いいえ | データベースのエクスポーターのコンテナー名 (既定: `oneuptime-openstack-database-exporter`)。設定しない場合、インストールスクリプトは 2 つ目のクラウドのデータベースのエクスポーターにそのコレクターにちなんだ名前を付け (`oneuptime-openstack-database-exporter-cloud2` を `oneuptime-openstack-agent-cloud2` の隣に)、スクリプトを再実行してもその名前を維持します |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). The install script names a second cloud's worker state exporter after its collector (`oneuptime-openstack-worker-state-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | いいえ | ワーカーの状態のエクスポーターのコンテナー名 (既定: `oneuptime-openstack-worker-state-exporter`)。設定しない場合、インストールスクリプトは 2 つ目のクラウドのワーカーの状態のエクスポーターにそのコレクターにちなんだ名前を付け (`oneuptime-openstack-worker-state-exporter-cloud2` を `oneuptime-openstack-agent-cloud2` の隣に)、スクリプトを再実行してもその名前を維持します |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). The install script names a second cloud's AI agent after its collector (`oneuptime-openstack-ai-agent-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | いいえ | AI エージェントのコンテナー名 (既定: `oneuptime-openstack-ai-agent`)。設定しない場合、インストールスクリプトは 2 つ目のクラウドの AI エージェントにそのコレクターにちなんだ名前を付け (`oneuptime-openstack-ai-agent-cloud2` を `oneuptime-openstack-agent-cloud2` の隣に)、スクリプトを再実行してもその名前を維持します |",
  "One agent reads one cloud. For a second cloud, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "1 つのエージェントは 1 つのクラウドを読み取ります。2 つ目のクラウドには、専用のフォルダーに専用のコンテナー名で 2 つ目のエージェントをインストールします。2 つのコンテナーが同じ名前を使うことはできません:",
  "The script names the containers after the folder, such as `oneuptime-openstack-agent-cloud2`, unless you set their variables, such as `OPENSTACK_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "変数 (`OPENSTACK_AGENT_CONTAINER_NAME` など) を設定しない場合、スクリプトはフォルダーにちなんでコンテナーに `oneuptime-openstack-agent-cloud2` のような名前を付けます。その名前はそのエージェントの `.env` に保存されるため、同じ `INSTALL_DIR` でスクリプトを再実行してエージェントをアップグレードしても維持されます。また、`docker-compose.yml` で `container_name` を以前編集したエージェントも、その名前を維持します。",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "フォルダーにはそれぞれ専用の名前を付けてください。Docker Compose はプロジェクトにフォルダー名だけにちなんだ名前を付けるため、別の場所ですでにエージェントを実行しているフォルダーと同じ名前のフォルダーはスクリプトが拒否します。フォルダーは `-d` で診断スクリプトに渡します。",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | いいえ | コレクターのコンテナー名 (既定: `oneuptime-openstack-agent`)。同じマシン上の 2 つ目のクラウドのエージェントには専用の名前が必要です |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | いいえ | 同梱のエクスポーターのコンテナー名 (既定: `oneuptime-openstack-exporter`)。同じマシン上の 2 つ目のクラウドのエージェントには専用の名前が必要です |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | いいえ | クォータのエクスポーターのコンテナー名 (既定: `oneuptime-openstack-quota-exporter`)。同じマシン上の 2 つ目のクラウドのエージェントには専用の名前が必要です |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | いいえ | データベースのエクスポーターのコンテナー名 (既定: `oneuptime-openstack-database-exporter`)。同じマシン上の 2 つ目のクラウドのエージェントには専用の名前が必要です |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | いいえ | ワーカーの状態のエクスポーターのコンテナー名 (既定: `oneuptime-openstack-worker-state-exporter`)。同じマシン上の 2 つ目のクラウドのエージェントには専用の名前が必要です |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | いいえ | AI エージェントのコンテナー名 (既定: `oneuptime-openstack-ai-agent`)。同じマシン上の 2 つ目のクラウドのエージェントには専用の名前が必要です |",
  "One agent reads one cloud. For a second cloud, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "1 つのエージェントは 1 つのクラウドを読み取ります。2 つ目のクラウドには、専用のフォルダーに専用のコンテナー名で 2 つ目のエージェントを用意します。2 つのコンテナーが同じ名前を使うことはできません。名前はそのエージェントの `.env` で設定します:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "フォルダーにはそれぞれ専用の名前を付けてください。Docker Compose はプロジェクトにフォルダー名だけにちなんだ名前を付けるため、同じ名前の 2 つ目のフォルダーは最初のエージェントのコンテナーを置き換えてしまいます。名前は `docker-compose.yml` に書かないでください。このファイルはアップグレードで置き換えられます。",
};

export default TRANSLATION;
