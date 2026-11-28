import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The OpenStack setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/OpenStack/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "With `enable_prometheus` on in `/etc/kolla/globals.yml`, which Kolla-Ansible leaves off until you set it, it runs Prometheus, Alertmanager and an exporter for each thing under the cloud, and ships no alert rules. This guide reads what those run rather than starting a second copy.":
    "在 `/etc/kolla/globals.yml` 中打开 `enable_prometheus` 后（在你设置之前，Kolla-Ansible 会保持关闭），它会运行 Prometheus、Alertmanager，并为云下面的每个组件各运行一个导出器，但不附带任何警报规则。本指南读取它们已在运行的内容，而不是再启动一份副本。",
  "**How far this guide has been tested:** Its paths and ports were read from Kolla-Ansible's own source. Its commands were then run on a real all-in-one at stable/2026.1 with Open vSwitch, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, without Docker, on Kolla-Ansible's own exporter and on your own at the pinned version and at 1.7.0, the agent's exporter on the Infrastructure only credential, the targets read from its real prometheus.yml, and the logs profile. With Memcached really stopped there, its Alertmanager posted a firing webhook and then a resolved one, and what it posted, sent to a running OneUptime, opened one incident on the right cloud and on no other, and resolved it. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**本指南的测试程度：** 其路径和端口取自 Kolla-Ansible 自己的源码。随后，它的命令在一台真实的 stable/2026.1 all-in-one（使用 Open vSwitch）上运行过，并以一个保存代理所发送内容的 OneUptime 替身作为接收端：使用完整视图凭据的代理（不使用 Docker，分别对接 Kolla-Ansible 自己的导出器，以及你自己的固定版本和 1.7.0 版导出器）、使用仅基础设施凭据的代理自带导出器、从其真实 prometheus.yml 读取的目标，以及日志配置文件。在那里真正停止 Memcached 后，它的 Alertmanager 先发送了触发的 Webhook，再发送了已解决的 Webhook；把这些内容发送到运行中的 OneUptime 后，只在正确的云上打开了一个事件，没有出现在其他云上，并随后将其解决。代理和探测器各自把一个真实的 DevStack 一路接入了运行中的 OneUptime，中间经历了 nova-compute 的停止和恢复，但不是通过该工具完成的。",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent (or `bash install.sh --without-docker`, under Advanced)":
    "运行代理的机器上装有 Docker Engine 20.10 或更高版本以及 Docker Compose v2 插件（或者使用“高级”中的 `bash install.sh --without-docker`）",
  "A machine outside the cloud it watches: an agent inside a failed cloud goes quiet with it":
    "一台在所监控的云之外的机器：位于故障云内部的代理会随它一起沉默",
  "That machine can reach Keystone and every service's API":
    "这台机器能访问 Keystone 和每个服务的 API",
  "The `openstack` command line, as someone who can create the credential below":
    "`openstack` 命令行，并以能够创建下面凭据的身份使用",
  "An alert that fires becomes an incident, with on-call and status pages from the first hour, and it resolves when the alert does. There is nothing to install.":
    "触发的警报会变成事件，从第一个小时起就有值班和状态页面，警报解决时事件也随之解决。无需安装任何东西。",
  "1. In OneUptime, make an Incoming Request monitor as [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) says, and copy its **Heartbeat URL**. That is the `<secret key>` address below.":
    "1. 在 OneUptime 中，按照 [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) 的说明创建一个传入请求监视器，并复制它的 **Heartbeat URL**。这就是下面带有 `<secret key>` 的地址。",
  "2. Open the monitor's **Overview → Linked Resources** and add the OpenStack cloud `my-openstack-cloud`. Each incident is then on that cloud's **Incidents** page, so each cloud's Alertmanager needs a monitor of its own. The cloud shows up in that list once its first data arrives, so do this after the steps below, or add the cloud under **OpenStack → All Clouds** first.":
    "2. 打开监视器的 **概览 → 已关联资源**，添加 OpenStack 云 `my-openstack-cloud`。这样每个事件都会出现在该云的 **事件** 页面上，因此每个云的 Alertmanager 都需要自己的监视器。云在第一批数据到达后才会出现在该列表中，所以请在完成下面的步骤后再做这一步，或者先在 **OpenStack → 所有云** 中添加该云。",
  "Then, on the host you deploy from, write `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, which Kolla-Ansible reads in place of its own, and apply it:":
    "然后，在你执行部署的主机上写入 `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`（Kolla-Ansible 会用它代替自己的文件），并应用它：",
  "- Log in as an admin with `source /etc/kolla/admin-openrc.sh`, which `kolla-ansible post-deploy` writes.":
    "- 使用 `source /etc/kolla/admin-openrc.sh` 以管理员身份登录，该文件由 `kolla-ansible post-deploy` 写入。",
  "- **Full view** needs one change, to Cinder. Kolla-Ansible's templates already set `service_type` under `[keystone_authtoken]` on Nova, Neutron, Glance and Placement, but its Cinder says `volume` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Add `service_type = block-storage` under `[keystone_authtoken]` in `/etc/kolla/config/cinder.conf`, then run `kolla-ansible reconfigure -i <inventory> --tags cinder`.":
    "- **完整视图** 需要对 Cinder 做一处修改。Kolla-Ansible 的模板已在 Nova、Neutron、Glance 和 Placement 的 `[keystone_authtoken]` 下设置了 `service_type`，但它的 Cinder 写的是 `volume`，目录写的是 `block-storage`，两者不一致时，keystonemiddleware 会以 `401` 拒绝受访问规则限制的凭据。在 `/etc/kolla/config/cinder.conf` 的 `[keystone_authtoken]` 下添加 `service_type = block-storage`，然后运行 `kolla-ansible reconfigure -i <inventory> --tags cinder`。",
  "- **Infrastructure only** takes its overrides at `/etc/kolla/config/nova/policy.yaml`, and the same for `neutron`, `keystone` and `placement`, merged with anything already there. Apply them with `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.":
    "- **仅基础设施** 的覆盖放在 `/etc/kolla/config/nova/policy.yaml`，`neutron`、`keystone` 和 `placement` 也一样，并与其中已有的内容合并。用 `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement` 应用它们。",
  "**Recommended.** The agent sees everything it reads: services, hypervisors, every project's instances, volumes, networks and routers, and `cinder-volume` and `cinder-scheduler` state and storage pools, which only this level sees. It leaves out Keystone's users and groups, on purpose.":
    "**推荐。** 代理能看到它读取的一切：服务、Hypervisor、每个项目的实例、卷、网络和路由器，以及只有这一级别才能看到的 `cinder-volume` 和 `cinder-scheduler` 状态与存储池。它有意不读取 Keystone 的用户和组。",
  "This is an application credential on an account with `admin` on a project of its own, limited by access rules to the exact `GET` calls the agent makes, so it cannot write: on every release we record, every read answered `200` and every write `401`. As an admin, make the project and the account:":
    "这是一个应用凭据，属于在自己专用项目上拥有 `admin` 的账户，并通过访问规则限制为只能发出代理所需的那些 `GET` 调用，因此无法写入：在我们记录的每个版本上，每次读取都返回 `200`，每次写入都返回 `401`。以管理员身份创建项目和账户：",
  "Then, logged in as that account on that project, make the credential. An access rule is matched against the path the service sees, and a service behind a path prefix refuses the shipped rules with a `401`, so these commands fit them to this cloud from its catalog first:":
    "然后，以该账户登录到该项目，创建凭据。访问规则会与服务看到的路径匹配，而位于路径前缀之后的服务会以 `401` 拒绝自带的规则，因此这些命令会先根据目录把规则适配到这个云：",
  "- Copy the `id` and the `secret` it prints: the secret is shown only once.":
    "- 复制它输出的 `id` 和 `secret`：密钥只显示一次。",
  "- Never add `--unrestricted`, which would let it make more credentials.":
    "- 切勿添加 `--unrestricted`，否则该凭据就能创建更多凭据。",
  "- Access rules work only where each service sets `service_type` in its `[keystone_authtoken]` section and has been restarted since: `compute`, `network`, `block-storage` (the rules also carry `volume` and `volumev3`, for a Cinder configured that way), `image` and `placement`. Keystone needs nothing. Without that, the services refuse the credential with a `401`.":
    "- 只有每个服务都在自己的 `[keystone_authtoken]` 部分设置了 `service_type` 并且之后重启过，访问规则才会生效：`compute`、`network`、`block-storage`（规则中还带有 `volume` 和 `volumev3`，供这样配置的 Cinder 使用）、`image` 和 `placement`。Keystone 无需任何设置。否则，服务会以 `401` 拒绝该凭据。",
  "- If you won't change that, leave out `--access-rules`. That makes a plain admin application credential, which can write as well as read, so keep it as safe as an admin password.":
    "- 如果你不打算改这些，就去掉 `--access-rules`。这样得到的是一个普通的管理员应用凭据，既能读也能写，所以请像保管管理员密码一样保管它。",
  "- It stops working when it expires. To replace it, make the second credential before you delete the first.":
    "- 凭据到期后就会失效。要替换它，请先创建新凭据，再删除旧凭据。",
  "No admin. The agent sees all of Keystone's projects, domains, services and endpoints, all of Nova including every project's instances, all of Placement, and Neutron's agents and address pools. Volumes, snapshots, networks, subnets, routers, floating IPs and ports appear only for the projects the role is assigned on, so on a project that holds nothing just the shared and external ones, and OneUptime can't see the others.":
    "无需管理员。代理能看到 Keystone 的所有项目、域、服务和端点，整个 Nova（包括每个项目的实例），整个 Placement，以及 Neutron 的代理和地址池。卷、快照、网络、子网、路由器、浮动 IP 和端口只对分配了该角色的项目显示，因此在空项目上只能看到共享和外部的那些，OneUptime 看不到其他的。",
  "It does not see `cinder-volume` or `cinder-scheduler` state or storage pools: Cinder's own code asks for an admin there, after policy has already passed, so no override opens them, and only **Full view** sees them.":
    "它看不到 `cinder-volume` 或 `cinder-scheduler` 的状态以及存储池：在策略已经放行之后，Cinder 自己的代码仍要求管理员，所以任何覆盖都打不开它们，只有 **完整视图** 能看到。",
  "This is a role of its own, `oneuptime_monitoring`, with the policy overrides the agent ships, on a project of its own that holds nothing and has zero quota. Where Cinder has `enforce_new_defaults` off, which is Cinder's own default, any role on a project can create that project's volumes. With nothing to touch and no quota to make anything with, there is nothing for it to write: on every release we record, every write answered `403`, or `409` and `413` from quota. As an admin, make the role, the project and an account:":
    "这是一个专用角色 `oneuptime_monitoring`，带有代理自带的策略覆盖，位于一个不含任何内容、配额为零的专用项目上。在 Cinder 关闭了 `enforce_new_defaults` 的地方（这是 Cinder 自己的默认值），项目上的任何角色都能创建该项目的卷。既没有可碰的东西，也没有能用来创建任何东西的配额，所以它没有可写的内容：在我们记录的每个版本上，每次写入都返回 `403`，或者因配额返回 `409` 和 `413`。以管理员身份创建角色、项目和账户：",
  "Download the overrides, and merge each, on every controller, into the file named by `[oslo_policy] policy_file` in that service's config. That is `/etc/nova/policy.yaml` and so on, unless your deployment says otherwise. Each override keeps the service's default and adds the role. oslo.policy notices a changed file on its own, so nothing restarts:":
    "下载这些覆盖，并在每个控制器上把每个覆盖合并到该服务配置中 `[oslo_policy] policy_file` 指向的文件里。除非你的部署另有规定，否则就是 `/etc/nova/policy.yaml` 等。每个覆盖都保留服务的默认值并加上该角色。oslo.policy 会自行察觉文件变化，因此无需重启任何东西：",
  "**To take the overrides off again, empty the file (`{}`) and never delete it.** On Flamingo (2025.2) and Epoxy (2025.1), oslo.policy raises on every check once a policy file it has read is gone, so that service fails every request. When the service is Keystone, it stops validating tokens and the whole cloud answers `503`. If it has already happened, restart the service.":
    "**要再次移除覆盖，请清空文件（`{}`），永远不要删除它。** 在 Flamingo（2025.2）和 Epoxy（2025.1）上，一旦已读取过的策略文件消失，oslo.policy 会在每次检查时报错，于是该服务的每个请求都会失败。当这个服务是 Keystone 时，它会停止验证令牌，整个云都返回 `503`。如果已经发生，请重启该服务。",
  "Then, logged in as that account on that project, make the credential and copy the `id` and the `secret` it prints:":
    "然后，以该账户登录到该项目，创建凭据并复制它输出的 `id` 和 `secret`：",
  "Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off. `troubleshoot.sh` warns when the credential's project holds things.":
    "为了查看真实项目的卷和路由器而把角色放到该项目上，在 Cinder 关闭了 `enforce_new_defaults` 的云上，也会让该账户能在那里写入。当凭据所在的项目中有内容时，`troubleshoot.sh` 会发出警告。",
  "For a team watching its own part of a cloud someone else runs. The agent sees one project's volumes, networks and routers, and no infrastructure: no hypervisors, services or storage pools.":
    "适用于在别人运营的云中监控自己那一部分的团队。代理能看到一个项目的卷、网络和路由器，看不到任何基础设施：没有 Hypervisor、服务或存储池。",
  "Through the agent it shows no instances at all: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.":
    "通过代理，这一级别完全看不到实例：导出器向 Nova 请求所有项目的服务器，Nova 拒绝普通读者，这次读取就整体失败。只有不经过此代理采集的 OneUptime 探测器，才能列出一个项目的实例。",
  "This is the plain `reader` role. Give an account the role on the project:":
    "这是普通的 `reader` 角色。在项目上把该角色授予一个账户：",
  "Neutron and Cinder answer a reader with its own project and no error, so these lists look complete, and hold only that project.":
    "Neutron 和 Cinder 会向读者返回其自己的项目且不报错，所以这些列表看起来完整，实际只包含该项目。",
  "It may be able to write. On a cloud where Cinder has `enforce_new_defaults` off, which is Cinder's own default, plain `reader` can create volumes in its project too. On Epoxy, Flamingo and Gazpacho it did, and on Hibiscus it was refused, because DevStack only turns `enforce_new_defaults` on there.":
    "它可能能够写入。在 Cinder 关闭了 `enforce_new_defaults` 的云上（这是 Cinder 自己的默认值），普通的 `reader` 也能在自己的项目中创建卷。在 Epoxy、Flamingo 和 Gazpacho 上确实如此，而在 Hibiscus 上被拒绝，因为 DevStack 只在那里打开 `enforce_new_defaults`。",
  "No credential and nothing new to run: the agent reads the exporter Kolla-Ansible already runs, through its internal VIP on `9198`. Skip the install's credential questions by giving it the address:":
    "无需凭据，也无需运行任何新东西：代理通过 `9198` 上的内部 VIP 读取 Kolla-Ansible 已在运行的导出器。安装时把地址交给它，即可跳过凭据相关的提问：",
  "Kolla-Ansible pins exporter 1.7.0 and runs it without `--multi-cloud`, so it has no `/probe`: the agent asks it for everything at once, every 2 minutes, on top of Kolla-Ansible's own Prometheus asking every minute. Its answer also says less. On five real clouds, the pages went without:":
    "Kolla-Ansible 把导出器固定在 1.7.0，并在不带 `--multi-cloud` 的情况下运行，所以它没有 `/probe`：代理每 2 分钟一次性向它请求所有内容，此外 Kolla-Ansible 自己的 Prometheus 还会每分钟请求一次。它的响应包含的信息也更少。在五个真实的云上，页面缺少了以下内容：",
  "| Goes without | Because | What it costs |": "| 缺少的内容 | 原因 | 影响 |",
  "| Everything of Cinder's | It asks the catalog for `volumev3`, and finds no such thing where Cinder registers as `block-storage` | **Volumes** and **Storage pools** stay empty, and **Services** has no Block Storage API, `cinder-volume` or `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** and **Volume Stuck** stay quiet |":
    "| Cinder 的全部内容 | 它向目录请求 `volumev3`，而在 Cinder 注册为 `block-storage` 的地方找不到 | **卷** 和 **存储池** 一直为空，**服务** 中没有 Block Storage API、`cinder-volume` 或 `cinder-scheduler`。**Block Storage API Down**、**Block Storage Service Down**、**Storage Pool Warning**、**Storage Pool Critical**、**Volumes in Error** 和 **Volume Stuck** 都不会触发 |",
  "| How many instances a hypervisor holds, and its aggregates | Nova's list of hypervisors fails at the newest microversion, which Kolla-Ansible asks for | Those two on **Hypervisors**, and what a lost host says it takes with it. Its vCPUs, memory and disk are still there: they come from Placement |":
    "| Hypervisor 承载的实例数量及其聚合 | Nova 的 Hypervisor 列表在 Kolla-Ansible 请求的最新微版本上失败 | **Hypervisor** 上的这两项，以及失去的主机声称会一并带走的内容。它的 vCPU、内存和磁盘仍然存在：它们来自 Placement |",
  "| Domains | It has no such series | **Domains** stays empty |":
    "| 域 | 它没有这样的序列 | **域名** 一直为空 |",
  "| An image's status, visibility and creation date | It has no such labels | Those columns on **Images**. **Image Stuck** stays quiet, so an image stuck on its way to `active` goes unnoticed |":
    "| 镜像的状态、可见性和创建日期 | 它没有这样的标签 | **镜像** 上的这些列。**Image Stuck** 不会触发，因此卡在变为 `active` 途中的镜像不会被发现 |",
  "| A network's MTU | It has no such label | That line on a network's page |":
    "| 网络的 MTU | 它没有这样的标签 | 网络页面上的那一行 |",
  "If you need those, use one of the other tabs and the agent's own exporter. You can change your mind later: a cloud keeps its name whichever reads it.":
    "如果你需要这些，请使用其他标签页之一以及代理自己的导出器。你之后也可以改变主意：无论由谁读取，云都会保留它的名称。",
  "The script asks for:": "脚本会询问：",
  "- **OneUptime URL and ingestion key**, both shown in step 1. Pick a key there to have them filled in here.":
    "- **OneUptime URL 和摄取密钥**，两者都显示在第 1 步中。在那里选择一个密钥，即可在这里自动填入。",
  "- **Cloud name**: how the cloud appears in OneUptime. Keep it stable: a new name registers a new cloud.":
    "- **云名称**：云在 OneUptime 中的显示名称。请保持不变：新名称会注册一个新的云。",
  "- **Keystone auth URL**, such as `https://keystone.example.com:5000/v3`.":
    "- **Keystone 认证 URL**，例如 `https://keystone.example.com:5000/v3`。",
  "- **Region names**, comma-separated (`RegionOne` if you have one).":
    "- **区域名称**，以逗号分隔（只有一个时为 `RegionOne`）。",
  "- **Application credential**: the ID and secret from the previous step. Neither is echoed to the screen, and neither goes on a command line.":
    "- **应用凭据**：上一步中的 ID 和密钥。两者都不会显示在屏幕上，也不会出现在命令行中。",
  "- **Private CA file**, only if the cloud's certificate comes from its own certificate authority.":
    "- **私有 CA 文件**，仅当云的证书来自它自己的证书颁发机构时才需要。",
  "It checks the credential with Keystone before it installs anything, installs to `/opt/oneuptime-openstack-agent` (or to `oneuptime-openstack-agent` in your home folder if you have no rights on `/opt`, and it says which), writes a `.env` file and a `clouds.yaml` only their owner can read, and starts everything with Docker Compose. Running it again reuses all of that instead of asking again, so it is also how you upgrade.":
    "它会在安装任何东西之前先向 Keystone 校验凭据，安装到 `/opt/oneuptime-openstack-agent`（如果你对 `/opt` 没有权限，则安装到你主文件夹下的 `oneuptime-openstack-agent`，并告诉你装在了哪里），写入只有所有者才能读取的 `.env` 文件和 `clouds.yaml`，然后用 Docker Compose 启动所有组件。再次运行时会复用这些内容而不再提问，因此升级也是这样做的。",
  "`docker compose ps` lists the collector (`oneuptime-openstack-agent`), the bundled exporter (`oneuptime-openstack-exporter`) and the OneUptime AI agent (`oneuptime-openstack-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cloud then appears in the **OpenStack** section by itself. Give it about five minutes to fill in: compute, network, volume and Placement are read every 2 minutes, identity and images every 5.":
    "`docker compose ps` 会列出收集器（`oneuptime-openstack-agent`）、内置导出器（`oneuptime-openstack-exporter`）和 OneUptime AI 代理（`oneuptime-openstack-ai-agent`）。在收集器的日志中查找 `Everything is ready. Begin running and processing data.`。之后云会自动出现在 **OpenStack** 部分。请等待约五分钟让数据填满：compute、网络、卷和 Placement 每 2 分钟读取一次，identity 和镜像每 5 分钟读取一次。",
  "On the host that runs Kolla-Ansible's Prometheus, this reads its targets from the file Kolla-Ansible rendered, and prints them as settings for the agent:":
    "在运行 Kolla-Ansible 的 Prometheus 的主机上，这会从 Kolla-Ansible 生成的文件中读取它的目标，并把它们输出为代理的设置：",
  "Add what it prints to the agent's `.env`, then run `docker compose up -d` in the agent's folder. Each exporter listens on the API network, so the agent's machine needs a route there. The cloud's **Control Plane** card then says how each one is, and says plainly which ones are not watched.":
    "把输出内容加到代理的 `.env` 中，然后在代理文件夹中运行 `docker compose up -d`。每个导出器都在 API 网络上监听，因此代理所在机器需要一条通往那里的路由。之后云的 **控制平面** 卡片会显示每个导出器的状态，并明确指出哪些没有被监控。",
  "| Reads | Port | Setting |": "| 读取对象 | 端口 | 设置 |",
  "| RabbitMQ's Prometheus plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |":
    "| RabbitMQ 的 Prometheus 插件 | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |",
  "| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |":
    "| mysqld_exporter（用于 MariaDB） | `9104` | `OPENSTACK_MARIADB_TARGETS` |",
  "| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |":
    "| memcached_exporter（用于 Memcached） | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |",
  "| HAProxy's own exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |":
    "| HAProxy 自己的导出器 | `9101` | `OPENSTACK_HAPROXY_TARGETS` |",
  "| openstack-network-exporter, for OVN and Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |":
    "| openstack-network-exporter（用于 OVN 和 Open vSwitch） | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |",
  "| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |":
    "| prometheus-libvirt-exporter（用于 libvirt） | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |",
  "- **OVN's databases:** Kolla-Ansible runs openstack-network-exporter from 2026.1, on compute and network nodes only, and an OVN database is read from the host it runs on. If your control nodes are neither, add them under `[prometheus-openstack-network-exporter:children]` in your inventory and reconfigure, or the Northbound and Southbound databases read as not watched.":
    "- **OVN 的数据库：** Kolla-Ansible 从 2026.1 起只在计算节点和网络节点上运行 openstack-network-exporter，而 OVN 数据库是从它所在的主机读取的。如果你的控制节点两者都不是，请把它们加到清单的 `[prometheus-openstack-network-exporter:children]` 下并重新配置，否则 Northbound 和 Southbound 数据库会显示为未监控。",
  "- **Before 2026.1** there is no network exporter, so OVN and Open vSwitch read as not watched.":
    "- **2026.1 之前** 没有网络导出器，因此 OVN 和 Open vSwitch 会显示为未监控。",
  "The agent's logs profile runs on each node, and reads Kolla-Ansible's files. It is what joins a line to the cloud's pages:":
    "代理的日志配置文件在每个节点上运行，读取 Kolla-Ansible 的文件。正是它把日志行关联到云的页面：",
  "Kolla's own Fluentd can forward too, with an output in `/etc/kolla/config/fluentd/output/*.conf` as [Fluentd](/docs/telemetry/fluentd) describes, but those records reach **Logs** under a service's name, and not the cloud's pages.":
    "Kolla 自己的 Fluentd 也能转发，只需按 [Fluentd](/docs/telemetry/fluentd) 的说明在 `/etc/kolla/config/fluentd/output/*.conf` 中添加输出，但这些记录会以服务名进入 **日志**，而不会出现在云的页面上。",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from `/var/log/kolla`.":
    "两者都写入服务自己的日志，总线上没有任何消费者。在 **安全事件 → 连接** 中打开 **在日志中查找安全事件** 后，OneUptime 就会从那里读取它们。代理的日志配置文件从 `/var/log/kolla` 读取这两者。",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.":
    "这会为每次登录发送一行，由 **OpenStack admin credential used from a new address** 读取。若只想发送失败的登录，请把 `identity.authenticate.success` 加到 `notification_opt_out` 中，这项检测随后会读取审计过滤器看到的内容。",
  "For who did what through Nova, Neutron, Cinder and Glance, the audit filter needs a setting, which goes in every service's config at once:":
    "要知道谁通过 Nova、Neutron、Cinder 和 Glance 做了什么，审计过滤器需要一项设置，它要同时放进所有服务的配置中：",
  "It also needs a paste file, and Kolla-Ansible's config tasks copy no paste file for these services. Put yours on each API host, and mount it over the one in the image with `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` and `glance_api_extra_volumes` in `globals.yml`. pyCADF's map files are in `/var/lib/kolla/venv/etc/pycadf` in the image. [Who did what](/docs/telemetry/openstack#who-did-what) has the filter's lines.":
    "它还需要一个 paste 文件，而 Kolla-Ansible 的配置任务不会为这些服务复制任何 paste 文件。把你自己的文件放到每台 API 主机上，并在 `globals.yml` 中用 `nova_api_extra_volumes`、`neutron_server_extra_volumes`、`cinder_api_extra_volumes` 和 `glance_api_extra_volumes` 把它挂载到镜像中的文件之上。pyCADF 的映射文件位于镜像中的 `/var/lib/kolla/venv/etc/pycadf`。过滤器的配置行见 [谁做了什么](/docs/telemetry/openstack#who-did-what)。",
  "OpenStack's `reader` role is scoped to a project everywhere except Keystone and Ironic, and hypervisors, services, agents, pools and Placement default to admin. A policy override can't open all-project lists in Cinder or Neutron, because they scope those lists in code, and Cinder's own code keeps its services and storage pools for an admin. So what a credential can read depends on which level you choose. This is what five real clouds answered, on Epoxy, Flamingo, Gazpacho (OVN and OVS) and Hibiscus:":
    "OpenStack 的 `reader` 角色除 Keystone 和 Ironic 外，在所有地方都限定在一个项目内，而 Hypervisor、服务、代理、池和 Placement 默认只对管理员开放。策略覆盖无法打开 Cinder 或 Neutron 中跨所有项目的列表，因为它们在代码中限定了这些列表的范围，而 Cinder 自己的代码把它的服务和存储池留给管理员。所以凭据能读取什么，取决于你选择的级别。以下是五个真实的云在 Epoxy、Flamingo、Gazpacho（OVN 和 OVS）以及 Hibiscus 上的响应：",
  "| Read | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |":
    "| 读取 | 级别 1：完整视图 | 级别 2：仅基础设施 | 级别 3：项目视图 |",
  "| Keystone: projects | all | all | refused |":
    "| Keystone：项目 | 全部 | 全部 | 被拒绝 |",
  "| Keystone: domains | all | all | refused |":
    "| Keystone：域 | 全部 | 全部 | 被拒绝 |",
  "| Keystone: regions | all | what anyone sees | what anyone sees |":
    "| Keystone：区域 | 全部 | 任何人都能看到的 | 任何人都能看到的 |",
  "| Keystone: services | all | all | refused |":
    "| Keystone：服务 | 全部 | 全部 | 被拒绝 |",
  "| Keystone: endpoints | all | all | refused |":
    "| Keystone：端点 | 全部 | 全部 | 被拒绝 |",
  "| Nova: servers, all projects | all | all | refused |":
    "| Nova：服务器，所有项目 | 全部 | 全部 | 被拒绝 |",
  "| Nova: services | all | all | refused |":
    "| Nova：服务 | 全部 | 全部 | 被拒绝 |",
  "| Nova: hypervisors | all | all | refused |":
    "| Nova：Hypervisor | 全部 | 全部 | 被拒绝 |",
  "| Nova: aggregates | all | all | refused |":
    "| Nova：聚合 | 全部 | 全部 | 被拒绝 |",
  "| Nova: availability zones, detail | all | all | refused |":
    "| Nova：可用区，详细信息 | 全部 | 全部 | 被拒绝 |",
  "| Nova: flavors | all | what anyone sees | what anyone sees |":
    "| Nova：规格 | 全部 | 任何人都能看到的 | 任何人都能看到的 |",
  "| Nova: usage per project | all | all | refused |":
    "| Nova：按项目的用量 | 全部 | 全部 | 被拒绝 |",
  "| Placement: resource providers | all | all | refused |":
    "| Placement：资源提供者 | 全部 | 全部 | 被拒绝 |",
  "| Neutron: agents | all | all | nothing |":
    "| Neutron：代理 | 全部 | 全部 | 无 |",
  "| Neutron: networks | all | own project only | own project only |":
    "| Neutron：网络 | 全部 | 仅本项目 | 仅本项目 |",
  "| Neutron: subnets | all | own project only | own project only |":
    "| Neutron：子网 | 全部 | 仅本项目 | 仅本项目 |",
  "| Neutron: routers | all | own project only | own project only |":
    "| Neutron：路由器 | 全部 | 仅本项目 | 仅本项目 |",
  "| Neutron: floating IPs | all | own project only | own project only |":
    "| Neutron：浮动 IP | 全部 | 仅本项目 | 仅本项目 |",
  "| Neutron: IP availabilities | all | all | nothing |":
    "| Neutron：IP 可用性 | 全部 | 全部 | 无 |",
  "| Neutron: security groups | all | 409, expected | own project only |":
    "| Neutron：安全组 | 全部 | 409，符合预期 | 仅本项目 |",
  "| Neutron: ports | all | own project only | own project only |":
    "| Neutron：端口 | 全部 | 仅本项目 | 仅本项目 |",
  "| Neutron: quotas | all | refused | refused |":
    "| Neutron：配额 | 全部 | 被拒绝 | 被拒绝 |",
  "| Cinder: volumes, all projects | all | own project only | own project only |":
    "| Cinder：卷，所有项目 | 全部 | 仅本项目 | 仅本项目 |",
  "| Cinder: services | all | refused | refused |":
    "| Cinder：服务 | 全部 | 被拒绝 | 被拒绝 |",
  "| Cinder: pools | all | refused | refused |":
    "| Cinder：池 | 全部 | 被拒绝 | 被拒绝 |",
  "| Cinder: snapshots, all projects | all | own project only | own project only |":
    "| Cinder：快照，所有项目 | 全部 | 仅本项目 | 仅本项目 |",
  "| Cinder: backups, all projects | all | none recorded | none recorded |":
    "| Cinder：备份，所有项目 | 全部 | 无记录 | 无记录 |",
  "| Cinder: volume types | all | what anyone sees | what anyone sees |":
    "| Cinder：卷类型 | 全部 | 任何人都能看到的 | 任何人都能看到的 |",
  "| Glance: images | all | what anyone sees | what anyone sees |":
    "| Glance：镜像 | 全部 | 任何人都能看到的 | 任何人都能看到的 |",
  "- **all**: the same rows an admin saw.":
    "- **全部**：与管理员看到的行相同。",
  "- **own project only**: that project's rows, and anything shared or external. On a project that holds nothing, that is just the shared and external ones.":
    "- **仅本项目**：该项目的行，以及所有共享或外部的内容。在空项目上，就只有共享和外部的那些。",
  "- **refused**: a `401` or a `403`.": "- **被拒绝**：`401` 或 `403`。",
  "- **what anyone sees**: every credential saw every row, on clouds that hold only public flavors, volume types and images. A private one in another project takes **Full view**.":
    "- **任何人都能看到的**：在只有公共规格、卷类型和镜像的云上，每个凭据都看到了每一行。其他项目中的私有项需要 **完整视图**。",
  "- **nothing**: a `200` with no rows, on a project that has networks too. It looks like it worked, and it did not.":
    "- **无**：在一个也有网络的项目上返回没有任何行的 `200`。看起来成功了，实际上并没有。",
  "- **none recorded**: a `200` with no rows where an admin saw none either, so there was nothing to tell by.":
    "- **无记录**：在管理员也一行都没看到的地方返回没有任何行的 `200`，因此无从判断。",
  "- **409, expected**: Neutron tries to create the project's default security group when it lists them, and zero quota does not let it, so it answers `409 Quota exceeded`. That is harmless, and nothing to fix.":
    "- **409，符合预期**：Neutron 在列出安全组时会尝试创建项目的默认安全组，而零配额不允许这样做，于是它返回 `409 Quota exceeded`。这无害，也无需修复。",
  "A list a credential can't read looks empty here: `troubleshoot.sh` says what this credential can read, and what each gap costs.":
    "凭据无法读取的列表在这里看起来是空的：`troubleshoot.sh` 会说明这个凭据能读取什么，以及每处缺口的代价。",
  "Monitoring must never be what takes a cloud down, so the agent is gentle by default:":
    "监控绝不能成为拖垮云的原因，所以代理默认很温和：",
  "| Reads | Every | Gives |": "| 读取 | 间隔 | 提供 |",
  "| **Compute (Nova)** | 2 minutes | Services, hypervisors, instances and flavors |":
    "| **计算（Nova）** | 2 分钟 | 服务、Hypervisor、实例和规格 |",
  "| **Placement** | 2 minutes | What each hypervisor can promise, and has promised |":
    "| **Placement** | 2 分钟 | 每个 Hypervisor 能承诺的量，以及已经承诺的量 |",
  "| **Networking (Neutron)** | 2 minutes | Agents, networks, subnets, address use, routers and floating IPs |":
    "| **网络（Neutron）** | 2 分钟 | 代理、网络、子网、地址使用、路由器和浮动 IP |",
  "| **Block Storage (Cinder)** | 2 minutes | Services, volumes, snapshots and storage pools |":
    "| **块存储（Cinder）** | 2 分钟 | 服务、卷、快照和存储池 |",
  "| **Identity (Keystone)** | 5 minutes | Projects and domains |":
    "| **身份（Keystone）** | 5 分钟 | 项目和域 |",
  "| **Images (Glance)** | 5 minutes | Images |":
    "| **镜像（Glance）** | 5 分钟 | 镜像 |",
  "- Each service is read on its own, so a failing Nova costs only Nova's numbers, and the rest keep reporting.":
    "- 每个服务单独读取，因此 Nova 出故障只损失 Nova 的数据，其余服务照常上报。",
  "- A read never outlasts its interval, so a slow one never stacks on the next.":
    "- 一次读取绝不会超过它的间隔，因此慢的读取永远不会叠加到下一次上。",
  "- Each project's quotas are off. To turn them on, run the installer again with `OPENSTACK_COLLECT_QUOTAS=true`: a second exporter reads them once an hour, at four calls per project per region. Neutron's quotas answer only **Full view**.":
    "- 每个项目的配额默认关闭。要打开，请用 `OPENSTACK_COLLECT_QUOTAS=true` 重新运行安装程序：第二个导出器会每小时读取一次，每个项目在每个区域调用四次。Neutron 的配额只对 **完整视图** 响应。",
  "- Nova's own quota lists and usage per server are off. To turn one on, delete its `--disable-metric` line from the exporter's `command` in `docker-compose.yml`. The cost is one call per project per scrape.":
    "- Nova 自己的配额列表和按服务器的用量默认关闭。要打开其中之一，请从 `docker-compose.yml` 中导出器的 `command` 里删除对应的 `--disable-metric` 行。代价是每次抓取时每个项目多一次调用。",
  "- The per-port series are off: listing every port with an admin credential can saturate Neutron on a large cloud.":
    "- 按端口的序列默认关闭：在大型云上用管理员凭据列出每个端口，可能会让 Neutron 饱和。",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Give the install script every region's name. It writes one `clouds.yaml` entry for each. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "一个云就是一个 Keystone，不管它有多少个区域，一个代理就能读取所有区域。把每个区域的名称都交给安装脚本。它会为每个区域写入一个 `clouds.yaml` 条目。每个条目都必须以其区域命名：由于序列本身不说明来自哪个区域，收集器会把这个名称作为 `openstack.region.name` 加到导出器的序列上。之后 OneUptime 中的每个列表都能按区域筛选。",
  "Regions with a Keystone of their own are separate clouds to OneUptime: run one agent for each.":
    "拥有自己 Keystone 的区域在 OneUptime 中是独立的云：请为每个区域各运行一个代理。",
  "**[Very Large OpenStack Clouds](/docs/telemetry/openstack-very-large-clouds)** has what each size costs and how each of these works.":
    "**[超大型 OpenStack 云](/docs/telemetry/openstack-very-large-clouds)** 介绍了每种规模的代价以及这些方式各自如何运作。",
  "**Past 5,000 instances, summary mode.** The cloud keeps a row for every part and counts per hypervisor, project and status, and its series per instance and per volume stop. It gives up the history of each settled instance's and volume's status, and a chart or a monitor over those series. An instance or volume in a state an alert watches keeps its series, so every alert template goes on working. To keep them for some, choose their projects under **Real usage per instance** on the cloud's **Settings** page.":
    "**超过 5,000 个实例：摘要模式。** 云会为每个部件保留一行，并按 Hypervisor、项目和状态计数，而它按实例和按卷的序列会停止。它会放弃每个已稳定的实例和卷的状态历史，以及基于这些序列的图表或监视器。处于警报所监视状态的实例或卷会保留其序列，因此每个警报模板都能继续工作。若想为部分实例保留，请在云的 **设置** 页面的 **每个实例的真实用量** 下选择它们的项目。",
  "**Sharing a cloud between agents.** Run one agent per region, or per service for the largest clouds, each with the same `OPENSTACK_CLOUD_NAME`. A region and a service belong to one agent, and Keystone to one agent for the whole cloud, or their series arrive twice. List an agent's regions in `OPENSTACK_EXPORTER_CLOUDS`, and its services in `OPENSTACK_AGENT_SERVICES`, such as `compute|placement`.":
    "**在多个代理之间分担一个云。** 每个区域运行一个代理，对于最大的云则每个服务运行一个，并且都使用同一个 `OPENSTACK_CLOUD_NAME`。一个区域和一个服务只属于一个代理，Keystone 则在整个云中只属于一个代理，否则它们的序列会到达两次。在 `OPENSTACK_EXPORTER_CLOUDS` 中列出代理的区域，在 `OPENSTACK_AGENT_SERVICES` 中列出它的服务，例如 `compute|placement`。",
  "**Past 1,500 hypervisors or 100,000 instances, the database path.** The agent can read the cloud's databases rather than its APIs, which at that size cannot be read in a scrape's time. It asks for a read-only account on each service's database, a route to them from this machine, and one exporter per region and Nova cell. It reads the same series, but for whether each Nova worker is alive and how full each storage pool is, which it still reads from the API, and it cannot say whether an API answers. It has not yet been run against a real database.":
    "**超过 1,500 个 Hypervisor 或 100,000 个实例：数据库路径。** 代理可以读取云的数据库而不是它的 API，因为在这种规模下，API 无法在一次抓取的时间内读完。它需要每个服务数据库上的只读账户、从这台机器到那里的路由，以及每个区域和每个 Nova cell 各一个导出器。它读取相同的序列，但每个 Nova worker 是否存活、每个存储池有多满仍从 API 读取，而且它无法判断 API 是否有响应。它尚未在真实数据库上运行过。",
  "The install script writes these to `/opt/oneuptime-openstack-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`.":
    "安装脚本会把这些写入 `/opt/oneuptime-openstack-agent/.env`。更改其中任何一项后，在 `/opt/oneuptime-openstack-agent` 中用 `docker compose up -d` 应用它。",
  "| Variable | Required | Description |": "| 变量 | 必填 | 说明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 实例的 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key: the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 遥测摄取密钥：在第 1 步中选择的那个 |",
  "| `OPENSTACK_CLOUD_NAME` | Yes | The cloud's name in OneUptime, stamped on every metric as the `openstack.cloud.name` resource attribute. Keep it stable: changing it registers a new cloud |":
    "| `OPENSTACK_CLOUD_NAME` | 是 | 云在 OneUptime 中的名称，作为资源属性 `openstack.cloud.name` 加到每个指标上。请保持不变：更改它会注册一个新的云 |",
  "| `OPENSTACK_EXPORTER_CLOUDS` | Yes | The `clouds.yaml` entries to read, one per region and named for the region, in square brackets: `[RegionOne,RegionTwo]` |":
    "| `OPENSTACK_EXPORTER_CLOUDS` | 是 | 要读取的 `clouds.yaml` 条目，每个区域一个并以区域命名，放在方括号中：`[RegionOne,RegionTwo]` |",
  "| `OPENSTACK_AUTH_URL` | Bundled exporter | The Keystone auth URL. `/v3` is added if it is missing |":
    "| `OPENSTACK_AUTH_URL` | 内置导出器 | Keystone 认证 URL。缺少 `/v3` 时会自动补上 |",
  "| `OPENSTACK_EXPORTER_ADDRESS` | No | `host:port` of your own exporter, with no scheme. Leave it out for the bundled one |":
    "| `OPENSTACK_EXPORTER_ADDRESS` | 否 | 你自己的导出器的 `host:port`，不带协议。使用内置导出器时省略 |",
  "| `OPENSTACK_QUOTA_CLOUDS` | No | The `clouds.yaml` entries to read each project's quotas from, once an hour. The install script sets it when run with `OPENSTACK_COLLECT_QUOTAS=true` |":
    "| `OPENSTACK_QUOTA_CLOUDS` | 否 | 每小时一次从中读取每个项目配额的 `clouds.yaml` 条目。用 `OPENSTACK_COLLECT_QUOTAS=true` 运行时，安装脚本会设置它 |",
  "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | No | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | 否 | 读取这些内容的导出器的 `host:port`。使用内置导出器时省略 |",
  "| `OPENSTACK_EXPORTER_USER` | No | The `uid:gid` the exporter's container runs as, which must own `clouds.yaml` (default: `65532:65532`) |":
    "| `OPENSTACK_EXPORTER_USER` | 否 | 导出器容器运行时使用的 `uid:gid`，它必须拥有 `clouds.yaml`（默认：`65532:65532`） |",
  "| `OPENSTACK_CA_FILE` | No | A PEM file with the certificate authority of a cloud that has its own |":
    "| `OPENSTACK_CA_FILE` | 否 | 一个 PEM 文件，包含拥有自己证书颁发机构的云的 CA |",
  "| `COMPOSE_PROFILES` | Bundled exporter | `openstack-exporter` starts the bundled exporter, and `openstack-ai-agent` the OneUptime AI agent |":
    "| `COMPOSE_PROFILES` | 内置导出器 | `openstack-exporter` 启动内置导出器，`openstack-ai-agent` 启动 OneUptime AI 代理 |",
  "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | No | An exporter already running without `--multi-cloud`, such as Kolla-Ansible's: `[10.0.0.254:9198]`. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it |":
    "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | 否 | 已经在不带 `--multi-cloud` 的情况下运行的导出器，例如 Kolla-Ansible 的：`[10.0.0.254:9198]`。同时设置 `OPENSTACK_EXPORTER_CLOUDS=[]` |",
  "| `OPENSTACK_RABBITMQ_TARGETS` | No | RabbitMQ's Prometheus plugin on each node: `[10.0.0.11:15692,10.0.0.12:15692]` |":
    "| `OPENSTACK_RABBITMQ_TARGETS` | 否 | 每个节点上 RabbitMQ 的 Prometheus 插件：`[10.0.0.11:15692,10.0.0.12:15692]` |",
  "| `OPENSTACK_MARIADB_TARGETS` | No | mysqld_exporter beside each MariaDB node, usually on `9104` |":
    "| `OPENSTACK_MARIADB_TARGETS` | 否 | 每个 MariaDB 节点旁边的 mysqld_exporter，通常在 `9104` |",
  "| `OPENSTACK_MEMCACHED_TARGETS` | No | memcached_exporter beside each Memcached, usually on `9150` |":
    "| `OPENSTACK_MEMCACHED_TARGETS` | 否 | 每个 Memcached 旁边的 memcached_exporter，通常在 `9150` |",
  "| `OPENSTACK_HAPROXY_TARGETS` | No | HAProxy's own Prometheus exporter |":
    "| `OPENSTACK_HAPROXY_TARGETS` | 否 | HAProxy 自己的 Prometheus 导出器 |",
  "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | No | openstack-network-exporter on each node, for OVN and Open vSwitch, usually on `1981` |":
    "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | 否 | 每个节点上的 openstack-network-exporter，用于 OVN 和 Open vSwitch，通常在 `1981` |",
  "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | No | prometheus-libvirt-exporter on each compute node, usually on `9177`, for whether libvirt answers and nothing per instance |":
    "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | 否 | 每个计算节点上的 prometheus-libvirt-exporter，通常在 `9177`，只看 libvirt 是否响应，不含任何按实例的数据 |",
  "| `OPENSTACK_CONTROL_PLANE_REGION` | No | The region of a target above that does not say its own. A target can: `RegionTwo@10.1.0.11:15692` |":
    "| `OPENSTACK_CONTROL_PLANE_REGION` | 否 | 上面那些目标中没有自带区域的目标所属的区域。目标也可以自带区域：`RegionTwo@10.1.0.11:15692` |",
  "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | No | The same exporter, for what each instance is really doing. Per-instance series multiply fast |":
    "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | 否 | 同一个导出器，用于了解每个实例实际在做什么。按实例的序列增长很快 |",
  "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | No | Ceilometer's exporter on each compute node, usually on `9101`, for the same |":
    "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | 否 | 每个计算节点上 Ceilometer 的导出器，通常在 `9101`，用途相同 |",
  "`clouds.yaml` alone holds the credential.": "只有 `clouds.yaml` 保存凭据。",
  "Only the largest clouds need these, and none is asked for:":
    "只有最大的云才需要这些，而且都不会被询问：",
  "| Variable | Description |": "| 变量 | 说明 |",
  "| `OPENSTACK_AGENT_SERVICES` | Which services this agent reads, as a pattern: `compute\\|placement` here and the rest on a second agent. Every service by default. No two agents should read one service of one region |":
    "| `OPENSTACK_AGENT_SERVICES` | 此代理读取哪些服务，以模式表示：这里是 `compute\\|placement`，其余的放在第二个代理上。默认读取所有服务。不能有两个代理读取同一区域的同一个服务 |",
  "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | The memory the collector may use, in MiB (default: `512`). It holds a whole scrape, so raise this past tens of thousands of instances |":
    "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | 收集器可使用的内存，单位 MiB（默认：`512`）。它要容纳一次完整的抓取，因此实例超过数万个时请调高 |",
  "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | Reading each service's database rather than its API, with a read-only account: where that exporter answers. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it, or every series arrives twice |":
    "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | 用只读账户读取每个服务的数据库而不是它的 API 时，那个导出器应答的位置。同时设置 `OPENSTACK_EXPORTER_CLOUDS=[]`，否则每个序列都会到达两次 |",
  "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | The database of each service it reads, as `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. One left empty is a service it leaves alone. Each holds a password, and `.env` is readable by its owner alone |":
    "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | 它读取的每个服务的数据库，格式为 `mysql+pymysql://oneuptime:secret@db.example:3306/nova`。留空的就是它不碰的服务。每一项都包含密码，而 `.env` 只有其所有者可读 |",
  "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | What Nova adds to a host's name to make a hypervisor's, such as `.example.org`, so an instance finds the hypervisor it runs on |":
    "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | Nova 加在主机名后面以构成 Hypervisor 名称的部分，例如 `.example.org`，这样实例才能找到它所运行的 Hypervisor |",
  "| `OPENSTACK_WORKER_STATE_CLOUDS` | The `clouds.yaml` entries to read from Nova's and Cinder's APIs what their databases cannot say: whether each worker is alive, and how full each pool is |":
    "| `OPENSTACK_WORKER_STATE_CLOUDS` | 用于从 Nova 和 Cinder 的 API 读取其数据库无法说明的内容的 `clouds.yaml` 条目：每个 worker 是否存活，以及每个池有多满 |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | 读取这些内容的导出器的 `host:port`。使用内置导出器时省略 |",
  "| `OPENSTACK_QUOTA_CLOUDS` | The `clouds.yaml` entries to read each project's quotas from, once an hour. Empty reads none, and `OPENSTACK_COLLECT_QUOTAS=true` in the install script fills it in |":
    "| `OPENSTACK_QUOTA_CLOUDS` | 每小时一次从中读取每个项目配额的 `clouds.yaml` 条目。留空则不读取任何配额，安装脚本中的 `OPENSTACK_COLLECT_QUOTAS=true` 会填好它 |",
  "The OneUptime AI agent reads the credential in `clouds.yaml` unless these say otherwise, and none is asked for:":
    "除非以下变量另有指定，OneUptime AI 代理会读取 `clouds.yaml` 中的凭据，而且这些变量都不会被询问：",
  "| `ONEUPTIME_AI_INVESTIGATION` | `false` stops OneUptime AI investigating this cloud with the agent |":
    "| `ONEUPTIME_AI_INVESTIGATION` | `false` 会阻止 OneUptime AI 借助此代理调查这个云 |",
  "| `OPENSTACK_AI_CLOUDS_FILE` | The `clouds.yaml` it mounts. `/dev/null` when it has a credential of its own and there is no such file beside it |":
    "| `OPENSTACK_AI_CLOUDS_FILE` | 它挂载的 `clouds.yaml`。当它有自己的凭据、旁边又没有这样的文件时为 `/dev/null` |",
  "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | The entry of `clouds.yaml` to use, when it is not the first of `OPENSTACK_EXPORTER_CLOUDS` |":
    "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | 要使用的 `clouds.yaml` 条目（当它不是 `OPENSTACK_EXPORTER_CLOUDS` 中的第一个时） |",
  "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | A credential of its own, used instead of `clouds.yaml`'s. Set both, with `OPENSTACK_AUTH_URL` |":
    "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | 它自己的凭据，用来代替 `clouds.yaml` 中的凭据。两者都要设置，并配合 `OPENSTACK_AUTH_URL` |",
  "| `OPENSTACK_AUTH_URL` | The Keystone a credential of its own logs in to |":
    "| `OPENSTACK_AUTH_URL` | 它自己的凭据登录的 Keystone |",
  "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | The region a command reads when it names none, which endpoints it uses (`public`, `internal` or `admin`), and a certificate authority. `clouds.yaml` says these unless they do |":
    "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | 命令未指定区域时读取的区域、它使用的端点（`public`、`internal` 或 `admin`），以及证书颁发机构。除非这些变量另有设置，否则由 `clouds.yaml` 决定 |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | The name it registers under, when it is not `OPENSTACK_CLOUD_NAME` |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | 它注册时使用的名称（当它不是 `OPENSTACK_CLOUD_NAME` 时） |",
  "| `LOG_LEVEL` | How much it logs |":
    "| `LOG_LEVEL` | 它记录日志的详细程度 |",
  "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | Off until set: let it make changes, through a credential of their own. The OpenStack guide says how to make it with the least it needs |":
    "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | 设置之前保持关闭：通过它们自己的凭据允许它进行更改。OpenStack 指南说明了如何以最小权限创建该凭据 |",
  "| `ONEUPTIME_AI_FIXES` | How AI may apply a fix: off, ask-for-approval, automatic or bypass-approval. Empty: fixes stay off until someone chooses on this page |":
    "| `ONEUPTIME_AI_FIXES` | AI 应用修复的方式：off、ask-for-approval、automatic 或 bypass-approval。留空：在有人在此页面上做出选择之前，修复保持关闭 |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | What is never touched, whatever else is set and whoever approves it: `project:ID`, `host:NAME` or `instance:ID`, separated by commas |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | 无论其他设置如何、无论谁批准，都永远不会被碰的对象：`project:ID`、`host:NAME` 或 `instance:ID`，用逗号分隔 |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | Where changes may land, written the same way. Empty: anywhere that is not protected |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | 允许更改落在哪里，写法相同。留空：任何未受保护的地方 |",
  "Set `OPENSTACK_EXPORTER_ADDRESS` as you run the install script, such as `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. The bundled exporter then never starts, and no Keystone URL or credential is asked for.":
    "在运行安装脚本时设置 `OPENSTACK_EXPORTER_ADDRESS`，例如 `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`。这样内置导出器永远不会启动，也不会询问 Keystone URL 或凭据。",
  "Your exporter must run with `--multi-cloud`, and its `clouds.yaml` needs an entry named for each region. Turn off what the bundled one turns off: see **What the agent collects, and what it costs your cloud**. Use an address the agent's container can reach: `localhost` inside the container is the container itself.":
    "你的导出器必须带 `--multi-cloud` 运行，其 `clouds.yaml` 需要为每个区域准备一个以该区域命名的条目。关闭内置导出器所关闭的内容：参见 **代理采集什么，以及对您的云有什么开销**。使用代理容器能访问到的地址：容器内的 `localhost` 指的是容器本身。",
  "**Started without `--multi-cloud`?** Kolla-Ansible's is, and Canonical's charm. It has no `/probe`, so set `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` instead of the address above, with `OPENSTACK_EXPORTER_CLOUDS=[]` and `OPENSTACK_CONTROL_PLANE_REGION`. It is then asked for everything at once, every 2 minutes.":
    "**未带 `--multi-cloud` 启动？** Kolla-Ansible 的导出器就是这样，Canonical 的 charm 也是。它没有 `/probe`，所以请设置 `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` 来代替上面的地址，并同时设置 `OPENSTACK_EXPORTER_CLOUDS=[]` 和 `OPENSTACK_CONTROL_PLANE_REGION`。之后每 2 分钟会向它一次性请求所有内容。",
  "**On exporter 1.7.0,** which Kolla-Ansible pins, it answers either way, and the pages go without what it does not say. On five real clouds that was:":
    "**在导出器 1.7.0 上，** 也就是 Kolla-Ansible 固定的版本，无论哪种方式它都会响应，而页面上会缺少它没有提供的内容。在五个真实的云上，缺少的是：",
  "Give the install script the file when it asks for a private CA file. It copies it to `ca.pem`, and names it in `clouds.yaml`.":
    "当安装脚本询问私有 CA 文件时，把该文件交给它。它会把文件复制为 `ca.pem`，并在 `clouds.yaml` 中引用它。",
  "On Linux (x86_64 or arm64) with systemd 235 or later and glibc 2.34 or later (not RHEL 8), the install script can run the same collector and exporter releases as systemd services instead:":
    "在装有 systemd 235 或更高版本、glibc 2.34 或更高版本的 Linux（x86_64 或 arm64，不包括 RHEL 8）上，安装脚本可以改为把相同版本的收集器和导出器作为 systemd 服务运行：",
  "Moving off a Docker install? Run `docker compose down` first, or every metric arrives twice. Running the script again stays whichever it was, so `sudo bash install.sh` is the upgrade.":
    "要从 Docker 安装迁移过来？先运行 `docker compose down`，否则每个指标都会到达两次。再次运行脚本时会保持原来的方式，因此 `sudo bash install.sh` 就是升级。",
  "The `resource` processor in `otel-collector-config.yaml` stamps every metric with the cloud's name. OneUptime registers the cloud from that attribute, and every page and monitor scopes on it. The two deletes keep OneUptime from registering a Service named after the scrape job, so keep them if you customize the file:":
    "`otel-collector-config.yaml` 中的 `resource` 处理器会给每个指标加上云的名称。OneUptime 根据这个属性注册云，每个页面和监视器也都按它限定范围。那两处删除可防止 OneUptime 注册一个以抓取任务命名的服务，所以自定义该文件时请保留它们：",
  "The whole file is on this OneUptime:": "完整文件就在这个 OneUptime 上：",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cloud: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `openstack.cloud.name`:":
    "任何以 `oneuptime.label.` 为前缀的资源属性都会成为云上的项目标签：`oneuptime.label.<dimension>=<value>` 就是标签 `<dimension>:<value>`。把它们添加到 `otel-collector-config.yaml` 中 `resource` 处理器里 `openstack.cloud.name` 的旁边：",
  "Then restart the collector so it reads the new config:":
    "然后重启收集器，让它读取新配置：",
  "The cloud shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "云会带着 `team:platform` 和 `env:production` 标签出现。标签匹配不区分大小写，因此会复用已有的 `Production` 标签；在 OneUptime 界面中添加的标签永远不会被代理删除。",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` and `clouds.yaml` (nothing is asked again), downloads the latest files (a file you edited is kept next to the new one as `<file>.bak.<timestamp>`), pulls the images and recreates the agent with them:":
    "**升级。** 镜像固定在 `docker-compose.yml` 中，它的配置是旁边的一个文件，所以单靠拉取镜像无法让代理前进。请重新运行安装脚本。它会复用你现有 `.env` 和 `clouds.yaml` 中的每个值（不会再询问任何内容），下载最新的文件（你编辑过的文件会以 `<file>.bak.<timestamp>` 保留在新文件旁边），拉取镜像，并用它们重新创建代理：",
  "The config reports the collector version it pins as the cloud's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "配置会把它固定的收集器版本报告为云的 **代理版本**。当这个 OneUptime 固定了更新的版本时，旁边的警告标志会打开这些命令。",
  "**Uninstall** the agent:": "**卸载**代理：",
  "Then delete `/opt/oneuptime-openstack-agent`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "然后删除保存着凭据的 `/opt/oneuptime-openstack-agent`，以及应用凭据本身：`openstack application credential delete oneuptime-agent`。",
  "`troubleshoot.sh` checks the whole chain, from DNS and TLS to Keystone, each service in the catalog and your ingestion key, and says what this credential can read and what each gap costs.":
    "`troubleshoot.sh` 会检查整条链路，从 DNS 和 TLS 到 Keystone、目录中的每个服务以及你的摄取密钥，并说明这个凭据能读取什么，以及每处缺口的代价。",
  "It needs `sudo` to read `clouds.yaml`, or it skips the credential checks. It ends with a verdict naming the most likely cause.":
    "它需要 `sudo` 才能读取 `clouds.yaml`，否则会跳过凭据检查。最后它会给出一个结论，指出最可能的原因。",
  "1. Check that the agent is running (in `/opt/oneuptime-openstack-agent`): `docker compose ps`":
    "1. 检查代理是否在运行（在 `/opt/oneuptime-openstack-agent` 中）：`docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-openstack-agent | grep -i error`":
    "2. 检查代理日志中的错误：`docker compose logs oneuptime-openstack-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. 确认你的 OneUptime URL 和摄取密钥正确。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 确保代理所在机器能通过网络访问 OneUptime 实例。",
  "A **Project view** credential can't read them, and neither can a role without the policy overrides: Nova, Neutron and Placement keep them for admins by default. Use **Full view**, or **Infrastructure only** with the files in `access/policy` merged into the file each service's `[oslo_policy] policy_file` names. `troubleshoot.sh` says which reads were refused.":
    "**项目视图** 凭据无法读取它们，没有策略覆盖的角色也不行：Nova、Neutron 和 Placement 默认只对管理员开放这些内容。请使用 **完整视图**，或者使用 **仅基础设施**，并把 `access/policy` 中的文件合并到每个服务的 `[oslo_policy] policy_file` 所指向的文件中。`troubleshoot.sh` 会说明哪些读取被拒绝了。",
  "Only **Full view** sees `cinder-volume` and `cinder-scheduler` state and storage pools. Cinder's own code answers anything else with `403 User does not have admin privileges`, after policy has already passed, so no override opens them.":
    "只有 **完整视图** 能看到 `cinder-volume` 和 `cinder-scheduler` 的状态以及存储池。在策略已经放行之后，Cinder 自己的代码仍会对其他任何凭据返回 `403 User does not have admin privileges`，所以任何覆盖都打不开它们。",
  "Neutron and Cinder answer anything but an admin with `200` and only its own project, which looks like it worked. Seeing every project takes **Full view**. With **Infrastructure only**, they appear for the projects the role is assigned on, and a role on a real project can also write there on many clouds.":
    "Neutron 和 Cinder 对除管理员以外的任何身份都返回 `200` 并且只给出其自己的项目，看起来像是成功了。要看到每个项目，需要 **完整视图**。使用 **仅基础设施** 时，它们会显示分配了该角色的项目，而且在许多云上，真实项目上的角色也能在那里写入。",
  "A **Project view** credential shows no instances through the agent: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. **Full view** and **Infrastructure only** both see every project's instances.":
    "**项目视图** 凭据通过代理看不到任何实例：导出器向 Nova 请求所有项目的服务器，Nova 拒绝普通读者，这次读取就整体失败。**完整视图** 和 **仅基础设施** 都能看到每个项目的实例。",
  "That is expected with **Infrastructure only**, and harmless. Neutron tries to create a project's default security group when it lists them, and a project with zero quota cannot hold one. There is nothing to fix.":
    "使用 **仅基础设施** 时这是预期的，而且无害。Neutron 在列出安全组时会尝试创建项目的默认安全组，而配额为零的项目无法拥有安全组。无需修复。",
  "On Flamingo and Epoxy, oslo.policy raises on every check once a policy file it has read is gone, and when the service is Keystone the whole cloud answers `503`. Restart the service. To take the overrides off, empty the file (`{}`) and never delete it.":
    "在 Flamingo 和 Epoxy 上，一旦已读取过的策略文件消失，oslo.policy 会在每次检查时报错，而当该服务是 Keystone 时，整个云都会返回 `503`。请重启该服务。要移除覆盖，请清空文件（`{}`），永远不要删除它。",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "代理分别读取每个服务，因此出故障的服务只损失它自己的数据。查看导出器为什么无法读取它（在 `/opt/oneuptime-openstack-agent` 中）：`docker compose logs oneuptime-openstack-exporter`。**服务** 页面会把该 API 显示为 `down`。用旧版规则副本创建的访问规则凭据，在 Swift 以及路径后面的 Octavia 上也会这样：请按 **完整视图** 中的做法重新创建一个。",
  "The services are refusing a credential limited by access rules. A service behind a path prefix refuses the shipped rules: fit them to this cloud with `access-rules-for-cloud.py`, as **Full view** does. And each service needs `service_type` set for keystonemiddleware, and a restart:":
    "这些服务正在拒绝受访问规则限制的凭据。位于路径前缀之后的服务会拒绝自带的规则：请按 **完整视图** 中的做法，用 `access-rules-for-cloud.py` 把规则适配到这个云。此外，每个服务都需要为 keystonemiddleware 设置 `service_type`，并重启：",
  "If you won't change that, create the credential without `--access-rules`, knowing it can write.":
    "如果你不打算改这些，就不带 `--access-rules` 创建凭据，但要清楚它能够写入。",
  "The exporter runs as uid 65532, and `clouds.yaml` is readable by its owner alone. Give the file to that user, or set `OPENSTACK_EXPORTER_USER` in `.env` to the file owner's `uid:gid`, and apply it with `docker compose up -d`.":
    "导出器以 uid 65532 运行，而 `clouds.yaml` 只有其所有者可读。把文件交给该用户，或者在 `.env` 中把 `OPENSTACK_EXPORTER_USER` 设为文件所有者的 `uid:gid`，然后用 `docker compose up -d` 应用。",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "云的身份来自 `OPENSTACK_CLOUD_NAME`，它作为 `openstack.cloud.name` 加在每个指标上。在 `.env` 中改正它，然后在 `/opt/oneuptime-openstack-agent` 中用 `docker compose up -d` 应用。新名称会注册一个新的云。",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "云的身份来自 `OPENSTACK_CLOUD_NAME`，它作为 `openstack.cloud.name` 加在每个指标上。这个云是 **`cloud-1`**。在 `.env` 中改正它，然后在 `/opt/oneuptime-openstack-agent` 中用 `docker compose up -d` 应用。新名称会注册一个新的云。",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent":
    "运行代理的机器上装有 Docker Engine 20.10 或更高版本以及 Docker Compose v2 插件",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "从这个 OneUptime 把 `docker-compose.yml` 和 `otel-collector-config.yaml` 下载到一个新文件夹中：",
  "Create a `clouds.yaml` file next to them, with the credential from the previous step. It needs one entry per region, each named for its region, because the exporter's series do not say which region they are from:":
    "在它们旁边创建一个 `clouds.yaml` 文件，写入上一步的凭据。由于导出器的序列本身不说明来自哪个区域，它需要每个区域一个条目，并各自以区域命名：",
  "Create a `.env` file next to them too:":
    "在它们旁边再创建一个 `.env` 文件：",
  "- Replace `my-openstack-cloud` with a name for this cloud, such as `prod-eu`. It is how the cloud appears in OneUptime, so keep it stable: a new name registers a new cloud.":
    "- 把 `my-openstack-cloud` 替换为这个云的名称，例如 `prod-eu`。这是云在 OneUptime 中的显示方式，所以请保持不变：新名称会注册一个新的云。",
  "- List every region in `OPENSTACK_EXPORTER_CLOUDS`, in square brackets, such as `[RegionOne,RegionTwo]`.":
    "- 在 `OPENSTACK_EXPORTER_CLOUDS` 中用方括号列出每个区域，例如 `[RegionOne,RegionTwo]`。",
  "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` starts the bundled exporter, which reads the cloud with `clouds.yaml`, and the OneUptime AI agent, which reads it with the same file while OneUptime AI investigates.":
    "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` 会启动用 `clouds.yaml` 读取云的内置导出器，以及在 OneUptime AI 调查时用同一个文件读取云的 OneUptime AI 代理。",
  "Both files hold secrets, so keep them to their owner. The exporter runs as uid 65532, and must be the one account that can read `clouds.yaml`. Then start the agent:":
    "这两个文件都含有机密，所以只让其所有者访问。导出器以 uid 65532 运行，并且必须是唯一能读取 `clouds.yaml` 的账户。然后启动代理：",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中选择一个摄取密钥来填入 `<YOUR_API_KEY>`。",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Add one `clouds.yaml` entry per region, and list them all in `OPENSTACK_EXPORTER_CLOUDS`. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "一个云就是一个 Keystone，不管它有多少个区域，一个代理就能读取所有区域。每个区域添加一个 `clouds.yaml` 条目，并把它们都列在 `OPENSTACK_EXPORTER_CLOUDS` 中。每个条目都必须以其区域命名：由于序列本身不说明来自哪个区域，收集器会把这个名称作为 `openstack.region.name` 加到导出器的序列上。之后 OneUptime 中的每个列表都能按区域筛选。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "代理从 `docker-compose.yml` 旁边的 `.env` 文件中读取这些。更改其中任何一项后，在包含 `docker-compose.yml` 的文件夹中用 `docker compose up -d` 应用它。",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter, as `host:port` with no scheme: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. The bundled exporter then never starts.":
    "从 `.env` 中去掉 `COMPOSE_PROFILES`，并把代理指向你的导出器，写成不带协议的 `host:port`：`OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`。这样内置导出器永远不会启动。",
  "Put the file next to `docker-compose.yml` as `ca.pem`, set `OPENSTACK_CA_FILE=./ca.pem` in `.env`, and add `cacert: /etc/openstack/ca.pem` to each entry of `clouds.yaml`.":
    "把该文件以 `ca.pem` 的名称放在 `docker-compose.yml` 旁边，在 `.env` 中设置 `OPENSTACK_CA_FILE=./ca.pem`，并在 `clouds.yaml` 的每个条目中添加 `cacert: /etc/openstack/ca.pem`。",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "在代理所在的文件夹（即包含 `docker-compose.yml` 的文件夹）中运行这些命令。",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `clouds.yaml` stay, and a change you made to either file has to be made again:":
    "**升级。** 镜像固定在 `docker-compose.yml` 中，它的配置是旁边的一个文件，所以单靠拉取镜像无法让代理前进。请重新下载这两个文件；你的 `.env` 和 `clouds.yaml` 会保留，但你对这两个下载文件中任何一个所做的修改都需要重新做一遍：",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "然后拉取镜像并重新创建代理，让收集器读取它的新配置：",
  "Then delete the folder with `docker-compose.yml`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "然后删除包含 `docker-compose.yml` 的文件夹（其中保存着凭据），以及应用凭据本身：`openstack application credential delete oneuptime-agent`。",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. 检查代理是否在运行（在代理所在的文件夹中）：`docker compose ps`",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in the agent's folder): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "代理分别读取每个服务，因此出故障的服务只损失它自己的数据。查看导出器为什么无法读取它（在代理所在的文件夹中）：`docker compose logs oneuptime-openstack-exporter`。**服务** 页面会把该 API 显示为 `down`。用旧版规则副本创建的访问规则凭据，在 Swift 以及路径后面的 Octavia 上也会这样：请按 **完整视图** 中的做法重新创建一个。",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "云的身份来自 `OPENSTACK_CLOUD_NAME`，它作为 `openstack.cloud.name` 加在每个指标上。在 `.env` 中改正它，然后在包含 `docker-compose.yml` 的文件夹中用 `docker compose up -d` 应用。新名称会注册一个新的云。",
  "- This installs the agent for **`cloud-1`**. Keep `OPENSTACK_CLOUD_NAME` exactly as it is, or the data registers as a new cloud.":
    "- 这会为 **`cloud-1`** 安装代理。请保持 `OPENSTACK_CLOUD_NAME` 原样不动，否则数据会注册为一个新的云。",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "云的身份来自 `OPENSTACK_CLOUD_NAME`，它作为 `openstack.cloud.name` 加在每个指标上。这个云是 **`cloud-1`**。在 `.env` 中改正它，然后在包含 `docker-compose.yml` 的文件夹中用 `docker compose up -d` 应用。新名称会注册一个新的云。",
  "OpenStack-Ansible keeps its services' logs in journald and runs no Prometheus of its own, so the agent is the way in, and the logs have a path of their own.":
    "OpenStack-Ansible 把其服务的日志保存在 journald 中，也不运行自己的 Prometheus，因此代理是接入方式，而日志另有路径。",
  "**How far this guide has been tested:** Its paths and variables were read from OpenStack-Ansible's own source and docs. Its commands were then run on a real all-in-one at stable/2026.1, in LXC containers, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, the agent's exporter on the Infrastructure only credential with its policy overrides, the RabbitMQ and HAProxy settings with the agent reading each, and the logs profile on the journal. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**本指南的测试程度：** 其路径和变量取自 OpenStack-Ansible 自己的源码和文档。随后，它的命令在一台真实的 stable/2026.1 all-in-one（运行在 LXC 容器中）上运行过，并以一个保存代理所发送内容的 OneUptime 替身作为接收端：使用完整视图凭据的代理、使用仅基础设施凭据及其策略覆盖的代理自带导出器、由代理逐一读取的 RabbitMQ 和 HAProxy 设置，以及读取 journal 的日志配置文件。代理和探测器各自把一个真实的 DevStack 一路接入了运行中的 OneUptime，中间经历了 nova-compute 的停止和恢复，但不是通过该工具完成的。",
  "- Log in as an admin from the utility container: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, then `. ~/openrc`. It has no `curl`, which the commands below use, so run `apt-get install -y curl` there first.":
    "- 从 utility 容器以管理员身份登录：`lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`，然后 `. ~/openrc`。它没有下面命令要用的 `curl`，所以请先在那里运行 `apt-get install -y curl`。",
  "- **Full view** needs one change, to Cinder. OpenStack-Ansible's roles already set `service_type` under `[keystone_authtoken]`, but its Cinder says `volumev3` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Set `service_type: block-storage` under `keystone_authtoken` in `cinder_cinder_conf_overrides` in `/etc/openstack_deploy/user_variables.yml`, then run `openstack-ansible openstack.osa.cinder --tags cinder-config`.":
    "- **完整视图** 需要对 Cinder 做一处修改。OpenStack-Ansible 的角色已在 `[keystone_authtoken]` 下设置了 `service_type`，但它的 Cinder 写的是 `volumev3`，目录写的是 `block-storage`，两者不一致时，keystonemiddleware 会以 `401` 拒绝受访问规则限制的凭据。在 `/etc/openstack_deploy/user_variables.yml` 的 `cinder_cinder_conf_overrides` 中，于 `keystone_authtoken` 下设置 `service_type: block-storage`，然后运行 `openstack-ansible openstack.osa.cinder --tags cinder-config`。",
  "- **Infrastructure only** takes its overrides as `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` and `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Apply each with its own playbook and tag, such as `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Taking one out later leaves an empty file behind rather than none, so nothing fails.":
    "- **仅基础设施** 的覆盖以 `/etc/openstack_deploy/user_variables.yml` 中的 `nova_policy_overrides`、`neutron_policy_overrides`、`keystone_policy_overrides` 和 `placement_policy_overrides` 提供。用各自的 playbook 和标签分别应用，例如 `openstack-ansible openstack.osa.nova --tags nova-policy-override`。以后去掉其中一个时，会留下一个空文件而不是没有文件，因此不会有任何东西失败。",
  "- **RabbitMQ:** turn on its Prometheus plugin, then name each container's address on `15692` as `OPENSTACK_RABBITMQ_TARGETS` in the agent's `.env`:":
    "- **RabbitMQ：** 打开它的 Prometheus 插件，然后在代理的 `.env` 中把每个容器在 `15692` 上的地址写为 `OPENSTACK_RABBITMQ_TARGETS`：",
  "- **HAProxy:** its exporter is off, and its stats listener is on `127.0.0.1` with TLS, which the agent cannot read. Turn it on where the agent can, then name that address on `1936` as `OPENSTACK_HAPROXY_TARGETS`:":
    "- **HAProxy：** 它的导出器是关闭的，统计监听器位于带 TLS 的 `127.0.0.1` 上，代理无法读取。在代理能读取的位置打开它，然后把那个 `1936` 上的地址写为 `OPENSTACK_HAPROXY_TARGETS`：",
  "- **MariaDB and Memcached:** OpenStack-Ansible ships no exporter for either. Run [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) and [memcached_exporter](https://github.com/prometheus/memcached_exporter) yourself and name them as `OPENSTACK_MARIADB_TARGETS` and `OPENSTACK_MEMCACHED_TARGETS`, or leave them out: the cloud's **Control Plane** card then says they are not watched, rather than that they are fine.":
    "- **MariaDB 和 Memcached：** OpenStack-Ansible 没有为两者提供任何导出器。请自行运行 [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) 和 [memcached_exporter](https://github.com/prometheus/memcached_exporter)，并把它们写为 `OPENSTACK_MARIADB_TARGETS` 和 `OPENSTACK_MEMCACHED_TARGETS`，或者省略它们：这样云的 **控制平面** 卡片会显示它们未被监控，而不是显示一切正常。",
  "This runs the agent's logs profile as a systemd service, and reads `/var/log/journal/`, where OpenStack-Ansible's containers' journals arrive.":
    "这会把代理的日志配置文件作为 systemd 服务运行，并读取 `/var/log/journal/`，OpenStack-Ansible 容器的 journal 就汇集在那里。",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from the journal.":
    "两者都写入服务自己的日志，总线上没有任何消费者。在 **安全事件 → 连接** 中打开 **在日志中查找安全事件** 后，OneUptime 就会从那里读取它们。代理的日志配置文件从 journal 读取这两者。",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw. A second value of `notification_opt_out` goes in as a YAML set, as [its config_template](https://docs.openstack.org/ansible-config_template/latest/) writes a repeated key.":
    "这会为每次登录发送一行，由 **OpenStack admin credential used from a new address** 读取。若只想发送失败的登录，请把 `identity.authenticate.success` 加到 `notification_opt_out` 中，这项检测随后会读取审计过滤器看到的内容。`notification_opt_out` 的第二个值以 YAML 集合的形式写入，就像 [它的 config_template](https://docs.openstack.org/ansible-config_template/latest/) 写入重复的键那样。",
  "For who did what through Nova, Neutron, Cinder and Glance, each API takes the filter's setting in its conf overrides, and the filter in its paste overrides, with `audit` right after `authtoken` and the context filter that follows it in each pipeline. Nova's, and the same in `neutron_neutron_conf_overrides` and `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` and `cinder_api_paste_ini_overrides`, and `glance_glance_api_conf_overrides` and `glance_glance_api_paste_ini_overrides`:":
    "要知道谁通过 Nova、Neutron、Cinder 和 Glance 做了什么，每个 API 都要在 conf 覆盖中加入过滤器的设置，在 paste 覆盖中加入过滤器本身，并在每个管道中把 `audit` 放在 `authtoken` 及其后的上下文过滤器之后。这里是 Nova 的写法，`neutron_neutron_conf_overrides` 和 `neutron_api_paste_ini_overrides`、`cinder_cinder_conf_overrides` 和 `cinder_api_paste_ini_overrides`，以及 `glance_glance_api_conf_overrides` 和 `glance_glance_api_paste_ini_overrides` 也一样：",
  "OpenStack-Helm offers charts for Prometheus, Alertmanager and exporters, and whether they are running is up to you. Its control plane runs in Kubernetes, so a probe reads the APIs and the Kubernetes agent sees the pods.":
    "OpenStack-Helm 提供 Prometheus、Alertmanager 和导出器的 chart，是否运行它们由你决定。它的控制平面运行在 Kubernetes 中，因此由探测器读取 API，由 Kubernetes 代理查看 Pod。",
  "**How far this guide has been tested:** Its chart values were read from OpenStack-Helm's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**本指南的测试程度：** 其 chart 值取自 OpenStack-Helm 自己的源码。尚未在该工具的真实部署上从头到尾完整走过一遍。代理和探测器各自把一个真实的 DevStack 一路接入了运行中的 OneUptime，中间经历了 nova-compute 的停止和恢复，但不是通过该工具完成的。探测器和 Kubernetes 代理各自单独测试过，没有在该工具上一起测试。",
  "Then add the receiver under `conf.alertmanager` in the chart's values, and send your route to it:":
    "然后在 chart 值的 `conf.alertmanager` 下添加接收器，并把你的路由发送给它：",
  "Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. [OpenStack Without an Agent](/docs/telemetry/openstack-agentless) says what each level of access reads, and the connection test says what yours can. The agent also works from any machine with a route to the APIs: choose **Not sure, or something else** above for its steps.":
    "打开 **OpenStack → 所有云**，点击 **连接云**，并提供 Keystone 的地址、一个应用凭据以及要使用的探测器。探测器与云之间只使用 HTTPS 通信。[无代理的 OpenStack](/docs/telemetry/openstack-agentless) 说明了每个访问级别能读取什么，连接测试则会告诉你你的级别能读取什么。代理也可以在任何有路由通往这些 API 的机器上运行：在上方选择 **不确定，或其他原因** 即可查看它的步骤。",
  "Follow **Kubernetes → Documentation** for this cluster. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "按照此集群的 **Kubernetes → 文档** 操作。之后它的 Pod、Pod 的日志和节点都会进入 Kubernetes 页面，其中的 OpenStack 服务也会在那里受到监控。",
  "To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:":
    "若还想让这些服务的日志出现在此云的 **日志** 页面上，并让每条堆栈追踪成为一条记录，请在代理的值中为云命名，并写上其服务运行所在的命名空间：",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.":
    "两者都写入服务自己的日志，总线上没有任何消费者。在 **安全事件 → 连接** 中打开 **在日志中查找安全事件** 后，OneUptime 就会从那里读取它们。Kubernetes 代理会从 Pod 的日志中读取这两者，并归入其值中所命名的云。",
  "A chart's `logging.conf` keeps the root logger at `WARNING`, and the log driver writes under a logger of its own, so without one for it nothing is written. A list in values replaces the chart's, so `keys` holds what the chart's has, plus this:":
    "chart 的 `logging.conf` 把根日志记录器保持在 `WARNING`，而日志驱动使用它自己的日志记录器写入，所以没有为它配置的日志记录器就什么都不会写入。值中的列表会替换 chart 中的列表，因此 `keys` 要包含 chart 列表中已有的内容，再加上这个：",
  "For who did what through Nova, Neutron and Cinder, their charts' `conf.paste` already has the audit filter in each pipeline, and it needs telling where to write. Each needs the same logger, in `conf.logging`. Glance's chart has the map, and neither the filter nor a place for it in its pipelines: add both to its `conf.paste`.":
    "要知道谁通过 Nova、Neutron 和 Cinder 做了什么：它们 chart 中的 `conf.paste` 已在每个管道中带有审计过滤器，只需告诉它写到哪里。每个服务都需要在 `conf.logging` 中配置同一个日志记录器。Glance 的 chart 有映射，却既没有过滤器，也没有在其管道中为它留出位置：请把两者都添加到它的 `conf.paste` 中。",
  "Atmosphere runs kube-prometheus-stack with its own alert rules, and Loki with Vector for logs. Forward its alerts first, then a probe reads the APIs and the Kubernetes agent sees the pods.":
    "Atmosphere 运行带有自己警报规则的 kube-prometheus-stack，并用 Loki 加 Vector 处理日志。先转发它的警报，然后由探测器读取 API，由 Kubernetes 代理查看 Pod。",
  "**How far this guide has been tested:** Its configuration was read from Atmosphere's own docs and source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**本指南的测试程度：** 其配置取自 Atmosphere 自己的文档和源码。尚未在该工具的真实部署上从头到尾完整走过一遍。代理和探测器各自把一个真实的 DevStack 一路接入了运行中的 OneUptime，中间经历了 nova-compute 的停止和恢复，但不是通过该工具完成的。探测器和 Kubernetes 代理各自单独测试过，没有在该工具上一起测试。",
  "Then add the receiver to your Atmosphere configuration, beside whichever receivers you already have, and deploy it:":
    "然后把接收器添加到你的 Atmosphere 配置中，与你已有的接收器放在一起，并部署它：",
  "For who did what through Nova, Neutron and Cinder, the charts Atmosphere deploys already have the audit filter in each pipeline, and it needs telling where to write, in `nova_helm_values`, `neutron_helm_values` and `cinder_helm_values`. Glance's chart has neither the filter nor a place for it in its pipelines: add both to its `conf.paste`, in `glance_helm_values`.":
    "要知道谁通过 Nova、Neutron 和 Cinder 做了什么：Atmosphere 部署的 chart 已在每个管道中带有审计过滤器，只需在 `nova_helm_values`、`neutron_helm_values` 和 `cinder_helm_values` 中告诉它写到哪里。Glance 的 chart 既没有过滤器，也没有在其管道中为它留出位置：请在 `glance_helm_values` 中把两者都添加到它的 `conf.paste`。",
  "Sunbeam can deploy the Canonical Observability Stack, with `sunbeam enable observability embedded`. Canonical also has an `openstack-exporter` charm, which the agent can read if you run it.":
    "Sunbeam 可以通过 `sunbeam enable observability embedded` 部署 Canonical Observability Stack。Canonical 还有一个 `openstack-exporter` charm，如果你运行了它，代理就能读取。",
  "**How far this guide has been tested:** Its commands were read from Canonical's docs and its charms' source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. Nothing here has been run on Sunbeam, and Sunbeam's own docs do not mention the exporter charm.":
    "**本指南的测试程度：** 其命令取自 Canonical 的文档及其 charm 的源码。尚未在该工具的真实部署上从头到尾完整走过一遍。代理和探测器各自把一个真实的 DevStack 一路接入了运行中的 OneUptime，中间经历了 nova-compute 的停止和恢复，但不是通过该工具完成的。这里的任何内容都没有在 Sunbeam 上运行过，Sunbeam 自己的文档也没有提到导出器 charm。",
  "Then give the stack's Alertmanager a configuration with the receiver in it:":
    "然后给该栈的 Alertmanager 一份包含接收器的配置：",
  "If you run Canonical's `openstack-exporter` charm, the agent can read it with no credential of its own. It answers one cloud on `/metrics`, on port `9180` unless you changed its `port` setting. Find its address with `juju status openstack-exporter`:":
    "如果你运行了 Canonical 的 `openstack-exporter` charm，代理无需自己的凭据就能读取它。它在 `/metrics` 上为一个云提供响应，端口为 `9180`，除非你改过它的 `port` 设置。用 `juju status openstack-exporter` 查找它的地址：",
  "Which series it says depends on the exporter release in its snap, which was not recorded here: `bash troubleshoot.sh` says whether it reads the cloud.":
    "它提供哪些序列取决于其 snap 中的导出器版本，而这里没有记录该版本：`bash troubleshoot.sh` 会说明它是否能读取这个云。",
  "With observability on, the stack's Loki holds the services' logs. OneUptime has no way to read Loki, and the agent's logs profile has not been tried on Sunbeam's charms, so nothing here collects them yet.":
    "打开可观测性后，该栈的 Loki 会保存这些服务的日志。OneUptime 无法读取 Loki，代理的日志配置文件也没有在 Sunbeam 的 charm 上试过，因此这里目前还没有任何东西采集这些日志。",
  "Sunbeam's charms write each service's configuration from their own templates, and its Keystone charm has no setting for where notifications go. So neither Keystone's audit trail nor the audit filter can be turned on from outside the charm, and nothing here reaches Security Events.":
    "Sunbeam 的 charm 用它们自己的模板写入每个服务的配置，而它的 Keystone charm 没有设置通知去向的选项。因此 Keystone 的审计跟踪和审计过滤器都无法从 charm 外部打开，这里也没有任何内容进入安全事件。",
  "Its Telemetry Operator runs Ceilometer's Prometheus exporter and a monitoring stack with Alertmanager on OpenShift. The Kubernetes agent's OpenShift preset watches the control plane, and Ceilometer's exporter says what the compute nodes are doing.":
    "它的 Telemetry Operator 在 OpenShift 上运行 Ceilometer 的 Prometheus 导出器和一个带 Alertmanager 的监控栈。Kubernetes 代理的 OpenShift 预设负责监控控制平面，而 Ceilometer 的导出器说明计算节点在做什么。",
  "**How far this guide has been tested:** Its resources were read from the Telemetry Operator's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The OpenShift preset and Ceilometer's exporter were each tested on their own, not together on this tool.":
    "**本指南的测试程度：** 其资源取自 Telemetry Operator 自己的源码。尚未在该工具的真实部署上从头到尾完整走过一遍。代理和探测器各自把一个真实的 DevStack 一路接入了运行中的 OneUptime，中间经历了 nova-compute 的停止和恢复，但不是通过该工具完成的。OpenShift 预设和 Ceilometer 的导出器各自单独测试过，没有在该工具上一起测试。",
  "Then apply a receiver the monitoring stack picks up:":
    "然后应用一个监控栈会采用的接收器：",
  "Follow **Kubernetes → Documentation** for this cluster, with **Red Hat OpenShift** picked, which sets `preset=openshift`. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "选中 **Red Hat OpenShift**（这会设置 `preset=openshift`），按照此集群的 **Kubernetes → 文档** 操作。之后它的 Pod、Pod 的日志和节点都会进入 Kubernetes 页面，其中的 OpenStack 服务也会在那里受到监控。",
  "A probe says what is allocated, not what is busy. To read real usage, run the agent on a machine that can reach the compute nodes, with `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` naming each node on Ceilometer's port, `9101`.":
    "探测器说明的是已分配了什么，而不是实际在忙什么。要读取真实用量，请在能访问计算节点的机器上运行代理，并用 `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` 列出每个节点上 Ceilometer 的端口 `9101`。",
  "For who did what through Nova and Neutron, each takes the filter's setting in its `customServiceConfig`, and its paste file in `defaultConfigOverwrite`. Cinder's and Glance's operators take no paste file, so nothing here reaches them.":
    "要知道谁通过 Nova 和 Neutron 做了什么，每个服务都在自己的 `customServiceConfig` 中加入过滤器的设置，在 `defaultConfigOverwrite` 中加入自己的 paste 文件。Cinder 和 Glance 的 operator 不接受 paste 文件，因此这里的内容无法到达它们。",
  "StackLight already watches OpenStack's services, MariaDB, Memcached, RabbitMQ and libvirt, with its own alert rules. Forward its alerts first, then a probe reads the APIs.":
    "StackLight 已经用它自己的警报规则监控 OpenStack 的服务、MariaDB、Memcached、RabbitMQ 和 libvirt。先转发它的警报，然后由探测器读取 API。",
  "**How far this guide has been tested:** Its settings were read from Mirantis's docs, whose examples show other receivers rather than a webhook. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**本指南的测试程度：** 其设置取自 Mirantis 的文档，而文档中的示例展示的是其他接收器，而不是 Webhook。尚未在该工具的真实部署上从头到尾完整走过一遍。代理和探测器各自把一个真实的 DevStack 一路接入了运行中的 OneUptime，中间经历了 nova-compute 的停止和恢复，但不是通过该工具完成的。",
  "Then add the receiver and its route to your StackLight values:":
    "然后把接收器及其路由添加到你的 StackLight 值中：",
  "For who did what through Nova, Neutron, Cinder and Glance, MOSK has a setting of its own, with the audit filter already in place. With the log driver, each service writes to its standard output, and the Kubernetes agent reads that from the pods' logs, with the cloud named in its values. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "要知道谁通过 Nova、Neutron、Cinder 和 Glance 做了什么，MOSK 有自己的设置，而且审计过滤器已经就位。使用日志驱动时，每个服务都写入自己的标准输出，Kubernetes 代理会从 Pod 的日志中读取，并归入其值中所命名的云。两者都写入服务自己的日志，总线上没有任何消费者。在 **安全事件 → 连接** 中打开 **在日志中查找安全事件** 后，OneUptime 就会从那里读取它们。",
  "That setting does not cover Keystone. Its own audit trail takes `spec:services`, which Mirantis does not validate and takes no responsibility for, so weigh this with your support contract:":
    "该设置不涵盖 Keystone。Keystone 自己的审计跟踪需要通过 `spec:services` 设置，而 Mirantis 不验证这一项，也不为其承担任何责任，所以请结合你的支持合同权衡：",
  "Keystone's audit trail says who signed in and who changed what in Keystone, and the audit filter says who did what through Nova, Neutron, Cinder and Glance. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "Keystone 的审计跟踪说明谁登录了、谁在 Keystone 中改了什么，审计过滤器则说明谁通过 Nova、Neutron、Cinder 和 Glance 做了什么。两者都写入服务自己的日志，总线上没有任何消费者。在 **安全事件 → 连接** 中打开 **在日志中查找安全事件** 后，OneUptime 就会从那里读取它们。",
  "The audit filter goes in each API's paste file, right after `authtoken` and the context filter that follows it in each pipeline, with the map file pyCADF ships for that service, in `etc/pycadf` under the Python environment the service runs in. Not at the end of a pipeline: Neutron's `extensions` filter answers its routers and security groups, and the filter would never see them.":
    "审计过滤器放在每个 API 的 paste 文件中，位于每个管道里 `authtoken` 及其后的上下文过滤器之后，并配合 pyCADF 为该服务提供的映射文件，该文件位于服务运行所在 Python 环境下的 `etc/pycadf` 中。不要放在管道末尾：Neutron 的 `extensions` 过滤器会直接应答它的路由器和安全组，审计过滤器将永远看不到它们。",
  "[Who did what](/docs/telemetry/openstack#who-did-what) says what reaches Security Events, and [each tool's guide](/docs/telemetry/openstack-deployment-tools) says where these go on it.":
    "[谁做了什么](/docs/telemetry/openstack#who-did-what) 说明了什么会进入安全事件，[每个工具的指南](/docs/telemetry/openstack-deployment-tools) 说明了这些设置在各工具上放在哪里。",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | 否 | 收集器的容器名称（默认：`oneuptime-openstack-agent`）。同一台机器上第二个云的代理需要自己的容器名称：除非你自行设置，否则安装脚本会按新代理的文件夹为其容器命名，并在你再次运行脚本时保留这些名称 |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). The install script names a second cloud's bundled exporter after its collector (`oneuptime-openstack-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | 否 | 内置导出器的容器名称（默认：`oneuptime-openstack-exporter`）。除非你自行设置，否则安装脚本会按第二个云的收集器为其内置导出器命名（`oneuptime-openstack-exporter-cloud2` 与 `oneuptime-openstack-agent-cloud2` 并列），并在你再次运行脚本时保留该名称 |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). The install script names a second cloud's quota exporter after its collector (`oneuptime-openstack-quota-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | 否 | 配额导出器的容器名称（默认：`oneuptime-openstack-quota-exporter`）。除非你自行设置，否则安装脚本会按第二个云的收集器为其配额导出器命名（`oneuptime-openstack-quota-exporter-cloud2` 与 `oneuptime-openstack-agent-cloud2` 并列），并在你再次运行脚本时保留该名称 |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). The install script names a second cloud's database exporter after its collector (`oneuptime-openstack-database-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | 否 | 数据库导出器的容器名称（默认：`oneuptime-openstack-database-exporter`）。除非你自行设置，否则安装脚本会按第二个云的收集器为其数据库导出器命名（`oneuptime-openstack-database-exporter-cloud2` 与 `oneuptime-openstack-agent-cloud2` 并列），并在你再次运行脚本时保留该名称 |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). The install script names a second cloud's worker state exporter after its collector (`oneuptime-openstack-worker-state-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | 否 | worker 状态导出器的容器名称（默认：`oneuptime-openstack-worker-state-exporter`）。除非你自行设置，否则安装脚本会按第二个云的收集器为其 worker 状态导出器命名（`oneuptime-openstack-worker-state-exporter-cloud2` 与 `oneuptime-openstack-agent-cloud2` 并列），并在你再次运行脚本时保留该名称 |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). The install script names a second cloud's AI agent after its collector (`oneuptime-openstack-ai-agent-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理的容器名称（默认：`oneuptime-openstack-ai-agent`）。除非你自行设置，否则安装脚本会按第二个云的收集器为其 AI 代理命名（`oneuptime-openstack-ai-agent-cloud2` 与 `oneuptime-openstack-agent-cloud2` 并列），并在你再次运行脚本时保留该名称 |",
  "One agent reads one cloud. For a second cloud, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "一个代理读取一个云。对于第二个云，请在单独的文件夹中安装第二个代理，并使用它自己的容器名称——两个容器不能共用一个名称：",
  "The script names the containers after the folder, such as `oneuptime-openstack-agent-cloud2`, unless you set their variables, such as `OPENSTACK_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "除非你设置它们的变量（例如 `OPENSTACK_AGENT_CONTAINER_NAME`），否则脚本会按文件夹为容器命名，例如 `oneuptime-openstack-agent-cloud2`。它会把名称保存在该代理的 `.env` 中，所以用同一个 `INSTALL_DIR` 再次运行脚本来升级代理时会保留这些名称；而你曾在 `docker-compose.yml` 中编辑过 `container_name` 的代理，也会保留那个名称。",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "请为每个文件夹取一个独有的名称：Docker Compose 只按文件夹为项目命名，因此如果某个文件夹与别处已在运行代理的文件夹同名，脚本会拒绝它。用 `-d` 把文件夹传给诊断脚本。",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | 否 | 收集器的容器名称（默认：`oneuptime-openstack-agent`）。同一台机器上第二个云的代理需要自己的容器名称 |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | 否 | 内置导出器的容器名称（默认：`oneuptime-openstack-exporter`）。同一台机器上第二个云的代理需要自己的容器名称 |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | 否 | 配额导出器的容器名称（默认：`oneuptime-openstack-quota-exporter`）。同一台机器上第二个云的代理需要自己的容器名称 |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | 否 | 数据库导出器的容器名称（默认：`oneuptime-openstack-database-exporter`）。同一台机器上第二个云的代理需要自己的容器名称 |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | 否 | worker 状态导出器的容器名称（默认：`oneuptime-openstack-worker-state-exporter`）。同一台机器上第二个云的代理需要自己的容器名称 |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理的容器名称（默认：`oneuptime-openstack-ai-agent`）。同一台机器上第二个云的代理需要自己的容器名称 |",
  "One agent reads one cloud. For a second cloud, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "一个代理读取一个云。对于第二个云，请在单独的文件夹中设置第二个代理，并使用它自己的容器名称——两个容器不能共用一个名称。请在该代理的 `.env` 中设置这些名称：",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "请为每个文件夹取一个独有的名称：Docker Compose 只按文件夹为项目命名，因此同名的第二个文件夹会替换第一个代理的容器。不要把这些名称写进 `docker-compose.yml`，升级会替换该文件。",
};

export default TRANSLATION;
