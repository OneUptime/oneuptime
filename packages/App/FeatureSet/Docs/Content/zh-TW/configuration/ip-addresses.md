# IP 位址

OneUptime Cloud 的探測器會從一組固定的 IP 位址檢查您的網站、API 和伺服器。如果您監測的對象前面有防火牆或允許清單，請允許這些位址，讓檢查能夠通過。

```mermaid title="允許清單的作用位置"
flowchart LR
    P["OneUptime 探測器"] -->|"從列出的 IP 發出檢查"| F["您的防火牆"]
    F -->|"已允許"| S["您的網站、API 或伺服器"]
```

## 需要允許的 IP 位址

在防火牆中允許來自以下位址的流量：

{{IP_WHITELIST}}

> [!NOTE]
> 這些位址可能會變更。位址變更時，OneUptime 會事先通知您。如果不想一直留意公告也能保持最新，可以在每次更新防火牆時 [取得清單](#以程式方式取得清單)。

## 以程式方式取得清單

同一份清單以 JSON 形式提供，不需要 API 金鑰，因此指令碼可以讓您的防火牆規則保持同步：

```bash
curl -s https://oneuptime.com/ip-whitelist
```

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

`ipWhitelist` 是一個陣列，每個元素是一個位址。若要每行輸出一個位址（例如用於防火牆指令碼），可以這樣做：

```bash
curl -s https://oneuptime.com/ip-whitelist | jq -r '.ipWhitelist[]'
```

## 自行託管的 OneUptime

在您自己的執行個體上，本頁和 `/ip-whitelist` 端點顯示的是執行個體 `IP_WHITELIST` 設定中的位址，這是一個以逗號分隔的清單。請填寫您自己的探測器發出檢查時使用的位址。

:::tabs
@tab Kubernetes
設定 Helm chart 的 `ipWhitelist` 值：

```yaml title="values.yaml"
ipWhitelist: "203.0.113.1,203.0.113.2"
```
@tab Docker Compose
`config.env` 不會把這個設定傳給應用程式。請在 `docker-compose.yml` 旁邊的 `docker-compose.override.yml` 中，把它加入 `app` 服務的環境變數，然後重新啟動 OneUptime：

```yaml title="docker-compose.override.yml"
services:
  app:
    environment:
      IP_WHITELIST: "203.0.113.1,203.0.113.2"
```
:::

如果沒有設定任何位址，本頁會顯示 **No IP addresses configured.**，端點會傳回一個空的 `ipWhitelist` 陣列。

## 後續步驟

:::cards
- [自訂探針](/docs/probe/custom-probe): 在您自己的網路中執行探測器，而不是開啟防火牆。
- [建立監測器](/docs/monitor/create-monitor): 開始檢查網站、API 或伺服器。
:::
