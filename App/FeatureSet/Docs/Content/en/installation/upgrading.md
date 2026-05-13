# Upgrading OneUptime

This guide covers how to safely upgrade your self-hosted OneUptime installation.

## General Guidance

- Upgrade step-by-step across major versions (for example, 6 → 7 → 8). Do not skip major versions.
- You can leapfrog minor/patch versions (for example, 8.1 → 8.4) as long as you follow the release notes.
- Always take backups before upgrading, and validate you can restore them.

## Upgrading from OneUptime 8 → 9

The Helm chart no longer provisions a Kubernetes Ingress resource. OneUptime ships an ingress gateway container that already terminates TLS, manages status page domains, and routes traffic for the platform, so a cluster ingress controller is no longer necessary.

- Remove any `oneuptimeIngress` overrides from your custom `values.yaml` files before upgrading. Those keys are now ignored and will cause validation errors if left in place.
- Ensure `nginx.service.type` reflects how you want to expose the bundled ingress gateway (for example `LoadBalancer`, `NodePort`, or `ClusterIP` with an external load balancer).
- Verify any DNS records for status pages or primary hosts still point to the Service or load balancer that fronts the OneUptime ingress gateway.
- After the upgrade, confirm TLS certificates continue to renew via the embedded gateway and that status page domains resolve correctly.


## Upgrading from OneUptime 7 → 8

If you're running on Kubernetes, there are important breaking changes:

- We no longer use Bitnami charts for Postgres, Redis, and ClickHouse because of [Bitnami License Changes](https://github.com/bitnami/charts/issues/35164)
- These changes are not backward compatible. You must follow the new structure in the Helm chart `values.yaml`.
- Backup your data (Postgres, ClickHouse, and any persistent volumes) before upgrading.


> Tip: Test the upgrade in a staging environment first. Confirm your workloads are healthy and data is intact before upgrading production.

