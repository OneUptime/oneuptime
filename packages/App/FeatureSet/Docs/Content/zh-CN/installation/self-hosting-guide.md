# 自托管指南

从上到下按这个页面操作，就能从一台空服务器走到你自己的 OneUptime：它运行在 HTTPS 上，已经给你发过一封测试邮件，并且能向你发送告警。每一步都以如何确认它已生效结尾，细节则链接到更长的页面。

:::cards
- [安装 OneUptime](#安装-oneuptime): 在一台服务器上用 Docker Compose，或在 Kubernetes 上用 Helm chart。
- [完成服务器设置](#完成服务器设置): 先是邮件，然后是短信和电话，每一项都带测试。
- [检查你的安装](#检查你的安装): 一条命令，指出哪里有问题。
- [快速开始](/docs/introduction/quickstart): 你的第一个监控器、第一个值班策略和第一个状态页。
:::

## 你需要什么

- **一台服务器。** 用 Docker Compose 试用 OneUptime，需要一台有 8 GB 内存、4 个核心和 20 GB 磁盘的 Linux 服务器；团队使用则需要 16 GB、8 个核心和 400 GB：参见[规模与容量规划](/docs/installation/sizing)。用 Helm chart 则需要一个 Kubernetes 集群。
- **一个域名**，人们用它打开 OneUptime，例如 `oneuptime.example.com`，并有一条指向服务器的 DNS `A` 记录。你可以先用服务器的 IP 地址开始，但 Let's Encrypt 的证书需要域名。
- **端口 80 和 443**，可以从互联网访问，用于 HTTPS。
- **一种发送邮件的方式**：一台邮件服务器，例如公司自己的、Microsoft 365 或 Google Workspace，或者 Amazon SES、SendGrid、Mailgun、Postmark 或 Resend 的账号。
- **一个 Twilio 账号**，用于通过短信和电话接收告警。邮件和推送通知不需要它。

**已生效的标志：** `dig +short oneuptime.example.com` 输出服务器的 IP 地址。

## 安装 OneUptime

:::tabs
@tab Docker Compose
在全新的 Ubuntu、Debian 或基于 RHEL 的服务器上，一条命令就能装好缺少的 Docker、Git 和 Node.js，把 OneUptime 克隆到 `oneuptime` 文件夹，询问人们将使用的地址，并启动它：

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

要手动完成同样的事，在装好 Docker、Git 和 Node.js 后运行：

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

打开 `config.env`，把它的第一项设置 `HOST` 设为你的域名或 IP 地址，不要带 `http://`。这是你唯一必须修改的设置：邮件、短信和电话在 Admin Dashboard 中设置，而 `ADVANCED` 下面的一切保持原样就能工作。然后启动 OneUptime：

```bash
npm start
```

**已生效的标志：** `npm start` 以 **OneUptime is up!** 和要打开的地址结束。第一次启动需要几分钟，因为 Docker 要下载镜像。如果 `npm start` 在此之前停下，它会说明需要修改什么。[Docker Compose](/docs/installation/docker-compose) 中有全部细节。
@tab Kubernetes
创建一个 `values.yaml`，写上你的域名或 IP 地址，不要带 `http://`：

```yaml title="values.yaml"
host: oneuptime.example.com
```

chart 把数据保存在集群的默认存储类上。如果 `kubectl get storageclass` 没有把任何一个标记为 `(default)`，就用其中一个的名称添加 `global.storageClass`。然后安装 chart：

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**已生效的标志：** `kubectl get pods` 显示每个 Pod 都是 `Running`，并且 `helm install` 输出的地址能打开 OneUptime。[chart 的安装指南](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md)中有全部细节。
:::

## 开启 HTTPS

域名指向服务器后，让 OneUptime 从 Let's Encrypt 获取免费证书。证书也由它自己续期。

:::tabs
@tab Docker Compose
在 `config.env` 中设置这些值，然后再次运行 `npm start`：

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

已经在用反向代理，例如 Caddy、Nginx 或负载均衡器？保持 `PROVISION_SSL=false`，设置 `HTTP_PROTOCOL=https` 和 `TRUSTED_PROXY_HOPS=2`，并参见[使用你自己的反向代理](/docs/installation/docker-compose#使用你自己的反向代理)。
@tab Kubernetes
在 `values.yaml` 中设置这些值，然后应用它们：

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

如果想改为在你自己的 Ingress 控制器上终止 TLS，就保持 `ssl.provision` 关闭，只设置 `httpProtocol: https`。
:::

**已生效的标志：** `https://oneuptime.example.com` 打开时没有证书警告。第一张证书通常几分钟内就会到位。在 `localhost` 上试用 OneUptime？跳过这一步：证书需要域名。

## 创建管理员账号

打开你的地址，例如 `https://oneuptime.example.com`，然后注册。新服务器上的第一个账号会成为它的主管理员，可以在 `/admin` 打开 Admin Dashboard。

**已生效的标志：** `/admin` 打开 Admin Dashboard。在邮件、HTTPS 或关于注册的选择还没完成时，它会打开在 **完成此服务器的设置** 上。

## 完成服务器设置

Admin Dashboard 的 **服务器设置** 页面位于 `/admin/setup`，按重要程度列出新服务器需要的东西。邮件、HTTPS 和谁可以注册是必需的。短信和电话、一个全局探针、备份和更新检查是推荐的。每一项都有一个按钮，打开设置它的地方，而 `npm start` 最后会输出这个页面的地址。

:::steps
### 设置邮件

点击 **设置电子邮件**。它会打开 **设置 > 通知 > 邮件**，在那里填写你的邮件服务器（大多使用端口 `587`）或邮件服务商，以及发信地址。保存后，点击 **发送测试邮件**，给自己发一封。

**已生效的标志：** 邮件送达，并且清单把邮件标记为已完成。测试失败时，它会显示邮件服务器的回应：参见 [SMTP](/docs/emails/smtp#故障排查)。

### 选择谁可以注册

任何能打开你的地址的人都可以注册。等团队的账号都建好后，在 **设置 > 认证** 中关闭 **允许注册**：你邀请到项目里的人仍然可以加入。要保持开放注册，点击 **保持开放注册**。

**已生效的标志：** 清单把注册标记为已完成。

### 设置短信和电话，或只用邮件和推送

要通过短信和电话接收告警，点击 **设置短信和电话**，并在 **设置 > 通知 > 电话和短信** 中添加你的 Twilio 账号：[Twilio 集成](/docs/self-hosted/twilio-integration)说明了每个值在哪里找。然后点击 **发送测试短信** 和 **拨打测试电话**。如果想改用你自己的网关发送，参见[短信和电话网关](/docs/self-hosted/sms-and-call-gateway)。如果邮件和推送通知就够了，点击 **只用电子邮件和推送**。

**已生效的标志：** 短信送达、电话响起，或者清单显示了你的选择。
:::

[开启 HTTPS](#开启-https) 生效后，HTTPS 一项就完成了，而每个推荐项都会说明要做什么。

## 检查你的安装

:::tabs
@tab Docker Compose
在 `oneuptime` 文件夹中运行 doctor：

```bash
npm run doctor
```

它会检查每个容器、`config.env`、`HOST` 能否到达这台服务器、证书和剩余磁盘，并询问 OneUptime 它看到的自身状态，例如邮件和探针。每个问题都附带修复方法：参见[检查你的安装](/docs/installation/docker-compose#检查你的安装)。
@tab Kubernetes
按 [chart 的故障排除指南](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it)中的步骤，针对你的集群运行 chart 的诊断脚本。它只读取，最后按严重程度给出它发现的问题摘要。
:::

**已生效的标志：** doctor 以 **Everything looks right.** 结束，并以 `0` 退出。有需要修复的问题时以 `1` 退出，无法运行检查时以 `2` 退出。在 Kubernetes 上，摘要中没有任何 `CRITICAL` 发现。

## 监控点什么并接收告警

现在你的服务器可以发邮件并向人们发送告警了。[快速开始](/docs/introduction/quickstart)在产品中继续：一个监控你网站的监控器，一个在网站宕机时向你告警的值班策略，以及一个状态页，大约十五分钟完成。它的最后一部分会宣布一次测试事件，让你看到告警到达。

## 故障排除

:::details npm start 停止并提示 HOST 还不是一个地址
`config.env` 中的 `HOST` 仍然是一个占位符，例如 `<your-address>`。把它设为你的域名或 IP 地址，不要带 `http://`，然后再次运行 `npm start`。
:::

:::details 测试邮件失败
按钮下方的消息就是邮件服务器的回应。检查主机名、端口、用户名和密码，以及邮件服务器是否允许你从发信地址发送。参见 [SMTP](/docs/emails/smtp#故障排查)。
:::

:::details 浏览器对证书发出警告
Let's Encrypt 需要能从互联网访问的端口 80 和 443，以及指向这台服务器的域名。等几分钟，然后运行 `npm run doctor`：它会检查证书并说明哪里有问题。
:::

## 后续步骤

:::cards
- [快速开始](/docs/introduction/quickstart): 十五分钟内建好一个监控器、一个值班策略和一个状态页。
- [Docker Compose](/docs/installation/docker-compose): 你自己的代理、备份、更新和生产环境清单。
- [升级](/docs/installation/upgrading): 升级到新版本，一次只升一个主版本。
- [架构](/docs/self-hosted/architecture): OneUptime 的各部分如何协同工作。
:::
