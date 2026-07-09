# Releases, Upgrade Notes & Dependencies

## Releases

We release frequently, sometimes multiple times a day. It's usually safe to
upgrade to the latest version. Any breaking changes are documented in the
[release notes](https://github.com/OneUptime/oneuptime/releases) — please read
them before upgrading.

See [Installation & Upgrades](installation.md#upgrading) for the upgrade command.

## Upgrade notes

- **9.0.0 (2025-11-21)** — Kubernetes Ingress objects are no longer created.
  OneUptime already ships an ingress gateway container that manages TLS
  certificates, status page domains, and routing. Remove any `oneuptimeIngress`
  overrides from your values files and ensure `nginx.service.type` matches how
  you expose the ingress gateway (for example `LoadBalancer`).

## Chart dependencies

These charts are used as dependencies for some components. You don't need to
install them separately. Read each chart's own README to understand its
configuration options.

| Chart                          | Description                                                                                 | Repository |
|--------------------------------|---------------------------------------------------------------------------------------------|------------|
| `keda`                         | Kubernetes Event-driven Autoscaling.                                                        | https://kedacore.github.io/charts |
| `cloudnative-pg`               | CloudNativePG operator — installed only when `postgresOperator.cnpg.enabled` is `true`.     | https://cloudnative-pg.github.io/charts |
| `altinity-clickhouse-operator` | Altinity ClickHouse operator — installed only when `clickhouseOperator.altinity.enabled` is `true`. | https://helm.altinity.com/ |
