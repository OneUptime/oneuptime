# 升級 OneUptime

本指南介紹如何安全地升級您的自託管 OneUptime 安裝。

## 通用指南

- 跨主版本逐步升級（例如 6 → 7 → 8）。不要跳過主版本。
- 只要遵循發佈說明，您可以跨越次要/補丁版本（例如 8.1 → 8.4）。
- 升級前務必做好備份，並驗證可以從備份中恢復。

## 從 OneUptime 8 升級到 9

Helm 圖表不再配置 Kubernetes Ingress 資源。OneUptime 內置了一個 ingress 網關容器，該容器已經負責終止 TLS、管理狀態頁面域名並路由平臺流量，因此不再需要集羣 ingress 控制器。

- 在升級前，從您的自定義 `values.yaml` 文件中刪除所有 `oneuptimeIngress` 覆蓋項。這些鍵現在已被忽略，如果保留會導致驗證錯誤。
- 確保 `nginx.service.type` 反映您希望暴露捆綁的 ingress 網關的方式（例如 `LoadBalancer`、`NodePort`，或帶有外部負載均衡器的 `ClusterIP`）。
- 驗證狀態頁面或主機的所有 DNS 記錄是否仍指向 OneUptime ingress 網關前端的 Service 或負載均衡器。
- 升級後，確認 TLS 證書通過嵌入式網關繼續續期，並且狀態頁面域名可正常解析。


## 從 OneUptime 7 升級到 8

如果您在 Kubernetes 上運行，存在重要的破壞性變更：

- 我們不再使用 Bitnami 圖表用於 Postgres、Redis 和 ClickHouse，原因是 [Bitnami 許可證變更](https://github.com/bitnami/charts/issues/35164)
- 這些變更不向後兼容。您必須遵循 Helm 圖表 `values.yaml` 中的新結構。
- 在升級前備份您的數據（Postgres、ClickHouse 和任何持久化卷）。


> 提示：先在預發佈環境中測試升級。在升級生產環境之前，確認您的工作負載健康且數據完整。
