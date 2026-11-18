# Kubernetes 和 Helm

使用 Helm chart 在你自己的 Kubernetes 集群上运行 OneUptime。这个页面由你的 OneUptime 服务器自己提供，所以不连互联网也能打开，并且描述的是你运行的版本的 chart。chart 接受的每个值都在 chart 自己的文档里，见 [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)。

:::cards
- [安装 chart](#安装-chart): 一个值文件和两条命令。
- [备份你的数据](#备份你的数据): 把 PostgreSQL 和 ClickHouse 备份到集群之外的存储。
- [保管你的密钥](#保管你的密钥): 没有它们就读不了你的备份。
:::

## 安装 chart

创建一个 `values.yaml`，写上大家将使用的域名或 IP 地址，不要带 `http://`：

```yaml title="values.yaml"
host: oneuptime.example.com
```

然后安装 chart：

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**已生效的标志：** `kubectl get pods` 显示每个 Pod 都是 `Running`，并且该地址能打开 OneUptime。接下来的步骤见[自托管指南](/docs/installation/self-hosting-guide)：HTTPS、管理员账号，以及邮件、短信和电话。

## 备份你的数据

OneUptime 把数据保存在集群的持久卷上：PostgreSQL 保存你的项目、监视器、事件、状态页和用户，ClickHouse 保存你的日志、链路追踪和指标。请用下面任一方式，把两者都备份到集群之外的存储：

- **企业版的定时备份。** 在 Admin Dashboard 的 **设置 > 备份** 中设置。参见[备份](/docs/installation/backups)。
- **云服务商对持久卷的备份**，例如定时为 PostgreSQL 和 ClickHouse 的磁盘做快照。
- **CloudNativePG 的卷快照备份**，适用于 PostgreSQL 运行在 CloudNativePG operator 上的情况。在 `values.yaml` 中开启，然后应用改动：

```yaml title="values.yaml"
postgresOperator:
  cnpg:
    enabled: true
    backup:
      enabled: true
      schedule: "0 0 3 * * *"
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

按上面的计划，PostgreSQL 每天 03:00 备份一次。CloudNativePG 不会删除旧的卷快照，不再需要的请自己删除。

OneUptime 看不到在它之外做的备份。你的备份运行起来后，请在 Admin Dashboard 的 **服务器设置** 页面上，点击备份一项的 **此服务器已有备份**。

## 保管你的密钥

OneUptime 加密的内容，只能用加密时所用的 `encryptionSecret` 读取。请在 `values.yaml` 中自己设置 `oneuptimeSecret` 和 `encryptionSecret`，这样升级不会替换它们，并把一份副本和备份一起保存在集群之外：

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## 后续步骤

:::cards
- [自托管指南](/docs/installation/self-hosting-guide): 从一个空集群到一台能呼叫你的服务器。
- [升级](/docs/installation/upgrading): 每次升级前先备份。
- [备份](/docs/installation/backups): 企业版的定时备份。
:::
