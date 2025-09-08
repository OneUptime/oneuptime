````markdown
# Upgrading OneUptime

This guide covers how to safely upgrade your self-hosted OneUptime installation.

## General Guidance

- Upgrade step-by-step across major versions (for example, 6 → 7 → 8). Do not skip major versions.
- You can leapfrog minor/patch versions (for example, 8.1 → 8.4) as long as you follow the release notes.
- Always take backups before upgrading, and validate you can restore them.

## Upgrading from OneUptime 7 → 8

If you're running on Kubernetes, there are important breaking changes:

- We no longer use Bitnami charts for Postgres, Redis, and ClickHouse.
- These changes are not backward compatible. You must follow the new structure in the Helm chart `values.yaml`.
- Backup your data (Postgres, ClickHouse, and any persistent volumes) before upgrading.


> Tip: Test the upgrade in a staging environment first. Confirm your workloads are healthy and data is intact before upgrading production.
````