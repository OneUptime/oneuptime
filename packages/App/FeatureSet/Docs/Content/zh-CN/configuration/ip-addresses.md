# IP 地址

OneUptime Cloud 的探测器从一组固定的 IP 地址检查您的网站、API 和服务器。如果您监控的对象前面有防火墙或允许列表，请允许这些地址，以便检查能够通过。

```mermaid title="允许列表的作用位置"
flowchart LR
    P["OneUptime 探测器"] -->|"从列出的 IP 发起检查"| F["您的防火墙"]
    F -->|"已允许"| S["您的网站、API 或服务器"]
```

## 需要允许的 IP 地址

在防火墙中允许来自以下地址的流量：

{{IP_WHITELIST}}

> [!NOTE]
> 这些地址可能会变化。地址变化时，OneUptime 会提前通知您。如果不想一直关注公告也能保持最新，可以在每次更新防火墙时 [获取列表](#以编程方式获取列表)。

## 以编程方式获取列表

同一份列表以 JSON 形式提供，无需 API 密钥，因此脚本可以让您的防火墙规则保持同步：

```bash
curl -s https://oneuptime.com/ip-whitelist
```

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

`ipWhitelist` 是一个数组，每个元素是一个地址。要每行输出一个地址（例如用于防火墙脚本），可以这样做：

```bash
curl -s https://oneuptime.com/ip-whitelist | jq -r '.ipWhitelist[]'
```

## 自托管的 OneUptime

在您自己的实例上，本页和 `/ip-whitelist` 端点显示的是实例 `IP_WHITELIST` 设置中的地址，这是一个以逗号分隔的列表。请填写您自己的探测器发出检查时使用的地址。

:::tabs
@tab Kubernetes
设置 Helm chart 的 `ipWhitelist` 值：

```yaml title="values.yaml"
ipWhitelist: "203.0.113.1,203.0.113.2"
```
@tab Docker Compose
`config.env` 不会把该设置传给应用。请在 `docker-compose.yml` 旁边的 `docker-compose.override.yml` 中，把它添加到 `app` 服务的环境变量里，然后重新启动 OneUptime：

```yaml title="docker-compose.override.yml"
services:
  app:
    environment:
      IP_WHITELIST: "203.0.113.1,203.0.113.2"
```
:::

如果没有设置任何地址，本页会显示 **No IP addresses configured.**，端点会返回一个空的 `ipWhitelist` 数组。

## 后续步骤

:::cards
- [自定义探针](/docs/probe/custom-probe): 在您自己的网络中运行探测器，而不是打开防火墙。
- [创建监视器](/docs/monitor/create-monitor): 开始检查网站、API 或服务器。
:::
