### Postgres Ops

To access postgres use port forwarding in kubernetes

```
kubectl port-forward --address 0.0.0.0 service/oneuptime-postgresql 5432:5432
```

then you should be able to access from the localhost and port 5432

You also need to read postgres password which is stored in kubenretes secrets. You can decode the password by using this command: 


```
# Username for Postgres user is `postgres`
echo $(kubectl get secret --namespace "default" oneuptime-postgresql -o jsonpath="{.data.postgres-password}" | base64 -d)
```

Important: Please ignore % in the end of the password output. 


```
# Username for Postgres user is `oneuptime`
echo $(kubectl get secret --namespace "default" oneuptime-postgresql -o jsonpath="{.data.password}" | base64 -d)
```

Important: Please ignore % in the end of the password output. 


This will make the database accessible from the localhost:5432.


### Postgres Backup

Please fill the values in config.env file and run the following command to take the backup of the database.

```
bash ./backup.sh
```

### Postgres Restore

Please fill the values in config.env file and run the following command to restore the database.

```
bash ./restore.sh
```

### Create Read Only User in Postgres (This can be used for reporting purpose like Metabase)

```
CREATE ROLE readonlyuser WITH LOGIN PASSWORD '<password>'
GRANT pg_read_all_data TO readonlyuser;
```


### Increasing max_connections for postgres. 

To see the current number of max_connections. You need to run the following command in psql.

```
SHOW max_connections;
```

To increase the max_connections, you need to run this sql command in psql.


```
ALTER SYSTEM SET max_connections = 200;
```

Then you need to restart the postgres pod. 


### Check used and free space in Postgres

```sql
SELECT
    datname AS database_name,
    pg_size_pretty(pg_database_size(datname)) AS used_space
FROM pg_database
ORDER BY pg_database_size(datname) DESC;
```

### Operator-managed Postgres with CloudNativePG (optional)

By default OneUptime runs Postgres as a single-replica `StatefulSet` (no
replication, failover, or built-in backups). You can instead run Postgres under
the [CloudNativePG](https://cloudnative-pg.io) operator, which adds HA
(primary + hot standbys), automated failover, rolling minor upgrades, and
backup/PITR.

Enabling it is a single switch. The CloudNativePG operator is **bundled** as a
chart dependency and installed together with the release. The config lives in a
self-contained, top-level `postgres-operator` object (**not** nested under
`postgresql`); `cnpg` is nested so other operators can be added later:

```yaml
# values.yaml
postgres-operator:
  cnpg:
    enabled: true        # turns on the operator + an operator-managed Cluster
    instances: 3         # 1 primary + 2 hot standbys (use 1 for single node)
    imageName: "ghcr.io/cloudnative-pg/postgresql:17.4"   # pin a minor version
    database: oneuptimedb
```

When `postgres-operator.cnpg.enabled` is `true`:

* The built-in `StatefulSet`, its `Service`s and `ConfigMap`s are **not**
  rendered (regardless of `postgresql.enabled`; the operator path takes
  precedence).
* A CloudNativePG `Cluster` named `<release>-postgresql-cnpg` is created.
* The app connects as the `postgres` superuser to the read-write service
  `<release>-postgresql-cnpg-rw` on port `5432`, using the password in the
  `<release>-postgresql-cnpg-superuser` secret (auto-generated, or set
  `postgres-operator.cnpg.postgresPassword`). The password is preserved across
  upgrades.
* The object is self-contained — `database`, `persistence`, `resources`,
  `nodeSelector`, `tolerations` and CloudNativePG `parameters` all live under
  `postgres-operator.cnpg.*`. It does not read any `postgresql.*` values.

Read the superuser password:

```
echo $(kubectl get secret --namespace "default" oneuptime-postgresql-cnpg-superuser -o jsonpath="{.data.password}" | base64 -d)
```

> **Bundled-operator caveats.** The operator is cluster-scoped and owns the
> CloudNativePG CRDs. Do **not** enable the bundled operator in more than one
> OneUptime release in the same cluster (they would fight over the CRDs/RBAC).
> Because the CRDs are installed by the chart, `helm uninstall` can remove them
> and cascade-delete every CloudNativePG `Cluster` in the cluster — back up
> first. If you already run CloudNativePG cluster-wide, do not use the bundled
> mode.

### Migrating existing StatefulSet data into CloudNativePG

Turning on `postgres-operator.cnpg.enabled` bootstraps a **fresh, empty**
cluster — it does not copy data from the existing `StatefulSet`. There is no supported way to hand the
operator your existing PV in place (different PVC ownership, a `pgdata`
sub-directory layout, and a different runtime UID). Use one of these one-time
migrations instead, keeping the old `StatefulSet` running until cutover.

**Option A — logical import (recommended).** Apply a one-off `Cluster` that
imports over the network with `pg_dump`/`pg_restore`. Version-flexible; downtime
≈ dump/restore time. Keep the old StatefulSet (`postgresql.enabled: true`,
`postgres-operator.cnpg.enabled: false`) running while this completes, then cut
the app over.

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: oneuptime-postgresql-cnpg
spec:
  instances: 1                       # scale up AFTER recovery is healthy
  imageName: ghcr.io/cloudnative-pg/postgresql:17.4   # match/upgrade your major
  storage:
    size: 25Gi
  superuserSecret:
    name: oneuptime-postgresql-cnpg-superuser
  enableSuperuserAccess: true
  bootstrap:
    initdb:
      import:
        type: microservice
        databases: ["oneuptimedb"]
        source:
          externalCluster: old-statefulset
  externalClusters:
    - name: old-statefulset
      connectionParameters:
        host: oneuptime-postgresql      # the existing StatefulSet service
        user: postgres
        dbname: oneuptimedb
      password:
        name: oneuptime-postgresql      # existing secret
        key: postgres-password
```

**Option B — `pg_basebackup` (minimal downtime, physical clone).** Requires the
**same major version** as the source. Set `bootstrap.pg_basebackup` instead of
`initdb.import`, pointing at the same `externalClusters` entry. Note: the
StatefulSet's `pg_hba.conf` uses `host all all ...`, which does **not** match
replication connections — add `host replication all 0.0.0.0/0 md5` to
`postgresql.primary.hbaConfiguration` on the source first, or basebackup is
rejected.

After either migration completes and the new cluster is healthy, switch the
release to operator mode (`postgres-operator.cnpg.enabled: true`) so the app
points at `<release>-postgresql-cnpg-rw`, scale `instances` up for HA, then
decommission the old StatefulSet and its PVC.

