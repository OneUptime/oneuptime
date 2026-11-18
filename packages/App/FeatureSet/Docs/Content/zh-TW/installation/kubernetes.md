# Kubernetes 和 Helm

使用 Helm chart 在你自己的 Kubernetes 叢集上執行 OneUptime。這個頁面由你的 OneUptime 伺服器自己提供，所以不連網際網路也能開啟，而且說明的是你執行的版本的 chart。chart 接受的每個值都在 chart 自己的文件裡，請見 [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)。

:::cards
- [安裝 chart](#安裝-chart): 一個值檔案和兩個指令。
- [備份你的資料](#備份你的資料): 把 PostgreSQL 和 ClickHouse 備份到叢集之外的儲存空間。
- [保管你的金鑰](#保管你的金鑰): 沒有它們就讀不了你的備份。
:::

## 安裝 chart

建立一個 `values.yaml`，寫上大家將使用的網域名稱或 IP 位址，不要加上 `http://`：

```yaml title="values.yaml"
host: oneuptime.example.com
```

然後安裝 chart：

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**已生效的標誌：** `kubectl get pods` 顯示每個 Pod 都是 `Running`，而且該位址能開啟 OneUptime。接下來的步驟請見[自架部署指南](/docs/installation/self-hosting-guide)：HTTPS、管理員帳號，以及電子郵件、簡訊和電話。

## 備份你的資料

OneUptime 把資料存放在叢集的持久磁碟區上：PostgreSQL 存放你的專案、監測器、事件、狀態頁面和使用者，ClickHouse 存放你的日誌、追蹤和指標。請用下列任一方式，把兩者都備份到叢集之外的儲存空間：

- **企業版的排程備份。** 在 Admin Dashboard 的 **設定 > 備份** 中設定。請參閱[備份](/docs/installation/backups)。
- **雲端供應商對持久磁碟區的備份**，例如定期為 PostgreSQL 和 ClickHouse 的磁碟建立快照。
- **CloudNativePG 的磁碟區快照備份**，適用於 PostgreSQL 在 CloudNativePG operator 上執行的情況。在 `values.yaml` 中開啟，然後套用變更：

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

依上面的排程，PostgreSQL 每天 03:00 備份一次。CloudNativePG 不會刪除舊的磁碟區快照，不再需要的請自行刪除。

OneUptime 看不到在它之外建立的備份。你的備份開始執行後，請在 Admin Dashboard 的 **伺服器設定** 頁面上，點擊備份一項的 **此伺服器已有備份**。

## 保管你的金鑰

OneUptime 加密的內容，只能用加密時所用的 `encryptionSecret` 讀取。請在 `values.yaml` 中自行設定 `oneuptimeSecret` 和 `encryptionSecret`，這樣升級就不會取代它們，並把一份副本和備份一起保存在叢集之外：

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## 後續步驟

:::cards
- [自架部署指南](/docs/installation/self-hosting-guide): 從一個空叢集到一台能呼叫你的伺服器。
- [升級](/docs/installation/upgrading): 每次升級前先備份。
- [備份](/docs/installation/backups): 企業版的排程備份。
:::
