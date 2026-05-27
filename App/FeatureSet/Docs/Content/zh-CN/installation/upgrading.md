# 升级 OneUptime

本指南介绍如何安全地升级您的自托管 OneUptime 安装。

## 通用指南

- 跨主版本逐步升级（例如 6 → 7 → 8）。不要跳过主版本。
- 只要遵循发布说明，您可以跨越次要/补丁版本（例如 8.1 → 8.4）。
- 升级前务必做好备份，并验证可以从备份中恢复。

## 从 OneUptime 8 升级到 9

Helm 图表不再配置 Kubernetes Ingress 资源。OneUptime 内置了一个 ingress 网关容器，该容器已经负责终止 TLS、管理状态页面域名并路由平台流量，因此不再需要集群 ingress 控制器。

- 在升级前，从您的自定义 `values.yaml` 文件中删除所有 `oneuptimeIngress` 覆盖项。这些键现在已被忽略，如果保留会导致验证错误。
- 确保 `nginx.service.type` 反映您希望暴露捆绑的 ingress 网关的方式（例如 `LoadBalancer`、`NodePort`，或带有外部负载均衡器的 `ClusterIP`）。
- 验证状态页面或主机的所有 DNS 记录是否仍指向 OneUptime ingress 网关前端的 Service 或负载均衡器。
- 升级后，确认 TLS 证书通过嵌入式网关继续续期，并且状态页面域名可正常解析。


## 从 OneUptime 7 升级到 8

如果您在 Kubernetes 上运行，存在重要的破坏性变更：

- 我们不再使用 Bitnami 图表用于 Postgres、Redis 和 ClickHouse，原因是 [Bitnami 许可证变更](https://github.com/bitnami/charts/issues/35164)
- 这些变更不向后兼容。您必须遵循 Helm 图表 `values.yaml` 中的新结构。
- 在升级前备份您的数据（Postgres、ClickHouse 和任何持久化卷）。


> 提示：先在预发布环境中测试升级。在升级生产环境之前，确认您的工作负载健康且数据完整。
