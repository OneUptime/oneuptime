# 升級 OneUptime

本指南說明如何安全地升級您自行託管的 OneUptime 安裝環境。

## 一般指引

- 跨主要版本時請逐步升級（例如 6 → 7 → 8）。請勿跳過主要版本。
- 只要您依循發行說明，便可跨越多個次要／修補版本（例如 8.1 → 8.4）。
- 升級前請務必進行備份，並驗證您能夠成功還原這些備份。

## 從 OneUptime 8 升級至 9

Helm chart 不再佈建 Kubernetes Ingress 資源。OneUptime 隨附一個 ingress gateway 容器，該容器已負責終止 TLS、管理狀態頁面網域，並為平台路由流量，因此不再需要叢集 ingress controller。

- 升級前，請從您自訂的 `values.yaml` 檔案中移除任何 `oneuptimeIngress` 覆寫設定。這些鍵值現已被忽略，若保留將會造成驗證錯誤。
- 確保 `nginx.service.type` 反映您希望如何公開內建的 ingress gateway（例如 `LoadBalancer`、`NodePort`，或搭配外部負載平衡器的 `ClusterIP`）。
- 確認狀態頁面或主要主機的任何 DNS 記錄仍指向位於 OneUptime ingress gateway 前端的 Service 或負載平衡器。
- 升級後，請確認 TLS 憑證持續透過內嵌 gateway 進行更新，且狀態頁面網域可正確解析。


## 從 OneUptime 7 升級至 8

如果您在 Kubernetes 上執行，將會有重要的破壞性變更：

- 由於 [Bitnami License Changes](https://github.com/bitnami/charts/issues/35164)，我們不再為 Postgres、Redis 與 ClickHouse 使用 Bitnami charts
- 這些變更不向下相容。您必須依循 Helm chart `values.yaml` 中的新結構。
- 升級前請備份您的資料（Postgres、ClickHouse，以及任何持久性磁碟區）。


> 提示：請先在預備（staging）環境中測試升級。在升級正式環境之前，請確認您的工作負載正常且資料完整無損。
