import {
  attachPoolerServices,
  classifyContainer,
  classifyImage,
  classifyKubernetesPod,
  classifyKubernetesPoolerPod,
  ContainerDatabaseClassification,
  ContainerWorkloadKind,
  DATABASE_OPERATOR_LABEL_KEYS,
  DATABASE_WORKLOAD_NAME_LABEL_VALUES,
  groupKubernetesDatabaseCandidates,
  hasDatabaseWorkloadLabels,
  ImageClassification,
  KubernetesDatabaseCandidate,
  KubernetesDatabaseGroup,
  KubernetesPodLike,
  KubernetesPoolerService,
  normalizeImageRepository,
  parseImageVersion,
  pickMostSpecificDatabaseSystem,
} from "../../../Types/DatabaseServer/DatabaseContainerClassifier";
import {
  ContainerCommandRole,
  classifyContainerCommand,
  isNonServerCommand,
} from "../../../Types/DatabaseServer/DatabaseContainerCommand";
import { buildWorkloadDatabaseServerIdentifier } from "../../../Types/DatabaseServer/DatabaseEndpoint";
import { describe, expect, test } from "@jest/globals";

type ContainerFixture = {
  name: string;
  image: string;
  ports?: Array<{ containerPort?: number }>;
  command?: Array<string | null>;
  args?: Array<string>;
};

function pod(data: {
  name: string;
  namespace?: string;
  phase?: string | null;
  labels?: Record<string, unknown>;
  owner?: { kind: string; name: string } | null;
  containers: Array<ContainerFixture>;
}): KubernetesPodLike {
  return {
    namespaceKey: data.namespace ?? "data",
    name: data.name,
    phase: data.phase === undefined ? "Running" : data.phase,
    labels: data.labels ?? {},
    ownerReferences: data.owner ? { items: [data.owner] } : { items: [] },
    spec: { containers: data.containers },
  };
}

function port(containerPort: number): { containerPort: number } {
  return { containerPort };
}

describe("normalizeImageRepository", () => {
  test.each([
    ["postgres", "postgres"],
    ["postgres:16", "postgres"],
    ["docker.io/library/postgres:16.2-alpine", "postgres"],
    ["library/postgres", "postgres"],
    [
      "ghcr.io/cloudnative-pg/postgresql:16.2@sha256:0123abcd",
      "cloudnative-pg/postgresql",
    ],
    [
      "registry.example.com:5000/mirror/bitnami/postgresql:16",
      "mirror/bitnami/postgresql",
    ],
    ["registry:5000/postgres", "postgres"],
    ["localhost/redis:7", "redis"],
    ["localhost:5000/redis", "redis"],
    ["  MCR.Microsoft.com/MSSQL/Server:2022-latest ", "mssql/server"],
    ["postgres@sha256:abcdef0123", "postgres"],
  ])("%s → %s", (image: string, repository: string) => {
    expect(normalizeImageRepository(image)).toBe(repository);
  });

  test("bare image ids and empty values have no repository", () => {
    expect(normalizeImageRepository(`sha256:${"a".repeat(64)}`)).toBeNull();
    expect(normalizeImageRepository("0123456789ab")).toBeNull();
    expect(normalizeImageRepository("")).toBeNull();
    expect(normalizeImageRepository("   ")).toBeNull();
    expect(normalizeImageRepository(null)).toBeNull();
    expect(normalizeImageRepository(42)).toBeNull();
    expect(normalizeImageRepository("bad image name!")).toBeNull();
  });
});

describe("parseImageVersion", () => {
  test.each([
    ["postgres:16.2-alpine", "16.2"],
    ["bitnami/postgresql:16.2.0-debian-12-r5", "16.2.0"],
    ["ghcr.io/cloudnative-pg/postgresql:16.2-12", "16.2"],
    ["mysql:v8.0.36", "8.0.36"],
    ["redis:7.2.4-alpine3.19", "7.2.4"],
    ["mongo:7.0.5-jammy", "7.0.5"],
    ["mcr.microsoft.com/mssql/server:2022-latest", "2022"],
    ["registry:5000/postgres:16", "16"],
    ["ghcr.io/zalando/spilo-16:3.2-p2", "16"],
    ["percona/percona-postgresql-operator:2.3.1-ppg16-postgres", "16"],
    ["percona/percona-postgresql-operator:2.4.0-ppg16.3-postgres", "16.3"],
  ])("%s → %s", (image: string, version: string) => {
    expect(parseImageVersion(image)).toBe(version);
  });

  test.each([
    ["postgres:latest"],
    ["postgres"],
    ["postgres@sha256:abcdef0123"],
    ["postgres:bookworm"],
    [""],
  ])("%s → null", (image: string) => {
    expect(parseImageVersion(image)).toBeNull();
  });

  test("non-strings are null", () => {
    expect(parseImageVersion(null)).toBeNull();
    expect(parseImageVersion(undefined)).toBeNull();
  });
});

describe("classifyImage — databases (exact repository or basename)", () => {
  test.each([
    ["postgres:16", "postgresql"],
    ["docker.io/library/postgres:16.2-alpine", "postgresql"],
    ["postgis/postgis:16-3.4", "postgresql"],
    ["timescale/timescaledb-ha:pg16", "postgresql"],
    ["pgvector/pgvector:pg16", "postgresql"],
    ["bitnami/postgresql:16", "postgresql"],
    ["registry.example.com/mirror/bitnami/postgresql:16", "postgresql"],
    ["ghcr.io/cloudnative-pg/postgresql:16.2", "postgresql"],
    [
      "registry.developers.crunchydata.com/crunchydata/crunchy-postgres:ubi8-16.2-0",
      "postgresql",
    ],
    ["ghcr.io/zalando/spilo-16:3.2-p2", "postgresql"],
    ["registry.opensource.zalan.do/acid/spilo-15:3.0-p1", "postgresql"],
    ["mysql:8.0", "mysql"],
    ["mysql/mysql-server:8.0", "mysql"],
    ["mariadb:11", "mariadb"],
    ["bitnami/mariadb-galera:11", "mariadb"],
    ["percona/percona-xtradb-cluster:8.0", "mysql"],
    ["redis:7", "redis"],
    ["redis/redis-stack-server:7.2.0-v10", "redis"],
    ["valkey/valkey:8", "valkey"],
    ["docker.dragonflydb.io/dragonflydb/dragonfly:v1.16", "dragonfly"],
    ["eqalpha/keydb", "keydb"],
    ["mongo:7", "mongodb"],
    ["mongodb/mongodb-community-server:7.0-ubi8", "mongodb"],
    ["percona/percona-server-mongodb:7.0", "mongodb"],
    ["mcr.microsoft.com/mssql/server:2022-latest", "microsoft.sql_server"],
    ["mcr.microsoft.com/mssql/rhel/server:2022-latest", "microsoft.sql_server"],
    ["gvenzl/oracle-free:23-slim", "oracle.db"],
    ["container-registry.oracle.com/database/free:23.4", "oracle.db"],
    ["container-registry.oracle.com/database/enterprise:21.3.0.0", "oracle.db"],
    ["docker.elastic.co/elasticsearch/elasticsearch:8.13.0", "elasticsearch"],
    ["opensearchproject/opensearch:2", "opensearch"],
    ["memcached:1.6", "memcached"],
    ["couchdb:3", "couchdb"],
    ["cassandra:5", "cassandra"],
    ["scylladb/scylla:5.4", "scylladb"],
    ["k8ssandra/cass-management-api:4.1", "cassandra"],
    ["clickhouse/clickhouse-server:24.3", "clickhouse"],
    ["altinity/clickhouse-server:23.8", "clickhouse"],
    ["cockroachdb/cockroach:v23.2", "cockroachdb"],
    ["neo4j:5", "neo4j"],
    ["influxdb:2.7", "influxdb"],
    ["couchbase/server:7.6", "couchbase"],
  ])("%s is %s", (image: string, system: string) => {
    expect(classifyImage(image)).toEqual({ kind: "database", system });
  });

  test("never a substring match", () => {
    for (const image of [
      "acme/redis-cache-warmer:1",
      "acme/postgres-migrations:2",
      "acme/mongoose-api",
      "enterprise:1",
      "free:1",
      "cockroach:1",
      "mypostgres",
      "postgresql-client",
    ]) {
      expect(classifyImage(image)).toEqual({ kind: "unknown" });
    }
  });

  test("untagged / id-only / empty images are unknown", () => {
    expect(classifyImage(`sha256:${"b".repeat(64)}`)).toEqual({
      kind: "unknown",
    });
    expect(classifyImage("")).toEqual({ kind: "unknown" });
    expect(classifyImage(null)).toEqual({ kind: "unknown" });
  });
});

describe("classifyImage — exclusions", () => {
  test.each([
    ["prometheuscommunity/postgres-exporter:v0.15.0", "exporter"],
    ["quay.io/prometheuscommunity/postgres-exporter", "exporter"],
    ["bitnami/postgres-exporter:0.15", "exporter"],
    ["wrouesnel/postgres_exporter", "exporter"],
    ["oliver006/redis_exporter:v1.58", "exporter"],
    ["bitnami/redis-exporter", "exporter"],
    ["prom/mysqld-exporter", "exporter"],
    ["percona/mongodb_exporter:0.40", "exporter"],
    ["acme/anything-exporter", "exporter"],
    ["ghcr.io/cloudnative-pg/cloudnative-pg:1.22", "operator"],
    ["registry.opensource.zalan.do/acid/postgres-operator:v1.10", "operator"],
    [
      "registry.developers.crunchydata.com/crunchydata/postgres-operator:ubi8-5.5",
      "operator",
    ],
    ["percona/percona-xtradb-cluster-operator:1.14.0", "operator"],
    ["percona/percona-server-mongodb-operator:1.16", "operator"],
    ["docker.elastic.co/eck/eck-operator:2.12", "operator"],
    ["altinity/clickhouse-operator:0.23", "operator"],
    ["k8ssandra/cass-operator:v1.19", "operator"],
    ["quay.io/opstree/redis-operator", "operator"],
    ["dpage/pgadmin4:8", "admin-ui"],
    ["phpmyadmin:5", "admin-ui"],
    ["adminer", "admin-ui"],
    ["mongo-express", "admin-ui"],
    ["redis/redisinsight:2", "admin-ui"],
    ["rediscommander/redis-commander", "admin-ui"],
    ["docker.elastic.co/kibana/kibana:8.13.0", "admin-ui"],
    ["bitnami/pgbouncer:1.22", "pooler"],
    ["edoburu/pgbouncer", "pooler"],
    ["ghcr.io/cloudnative-pg/pgbouncer:1.22", "pooler"],
    [
      "registry.developers.crunchydata.com/crunchydata/crunchy-pgbouncer:ubi8-1.21",
      "pooler",
    ],
    ["bitnami/pgpool:4", "pooler"],
    ["proxysql/proxysql:2.6", "pooler"],
    ["percona/haproxy:2.8", "pooler"],
    ["haproxy:2.9", "pooler"],
    ["mysql/mysql-router:8.0", "pooler"],
    ["gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.8", "pooler"],
    ["gcr.io/cloudsql-docker/gce-proxy:1.33", "pooler"],
    ["pgbackrest/pgbackrest", "backup"],
    [
      "registry.developers.crunchydata.com/crunchydata/crunchy-pgbackrest:ubi8-2.49",
      "backup",
    ],
    ["bitnami/kubectl:1.29", "backup"],
    ["wal-g/wal-g", "backup"],
    ["percona/percona-xtrabackup:8.0", "backup"],
    ["bitnami/redis-sentinel:7", "companion"],
    ["quay.io/mongodb/mongodb-agent-ubi:107.0", "companion"],
    ["k8ssandra/system-logger:v1.19", "companion"],
  ])("%s is excluded (%s)", (image: string, reason: string) => {
    expect(classifyImage(image)).toEqual({ kind: "excluded", reason });
  });
});

describe("classifyImage — infrastructure sidecars and unknowns", () => {
  test.each([
    ["docker.io/istio/proxyv2:1.20.0"],
    ["cr.l5d.io/linkerd/proxy:stable-2.14"],
    ["envoyproxy/envoy:v1.29"],
    ["hashicorp/vault:1.15"],
    ["fluent/fluent-bit:3.0"],
    ["fluentd:v1.16"],
    ["docker.elastic.co/beats/filebeat:8.13"],
    ["grafana/promtail:2.9"],
    ["otel/opentelemetry-collector-contrib:0.100.0"],
    ["busybox:1.36"],
    ["gcr.io/cadvisor/cadvisor:v0.49"],
    ["registry.k8s.io/pause:3.9"],
  ])("%s is an infrastructure sidecar", (image: string) => {
    expect(classifyImage(image)).toEqual({ kind: "infrastructure-sidecar" });
  });

  test.each([["acme/checkout:1.2.3"], ["nginx:1.25"], ["node:20"]])(
    "%s is unknown",
    (image: string) => {
      expect(classifyImage(image)).toEqual({ kind: "unknown" });
    },
  );
});

describe("classifyKubernetesPod — operators and charts", () => {
  test("CloudNativePG instance: the cluster, its role and its Services", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "pg-main-1",
          labels: {
            "cnpg.io/cluster": "pg-main",
            "cnpg.io/podRole": "instance",
            "cnpg.io/instanceRole": "primary",
          },
          owner: { kind: "Cluster", name: "pg-main" },
          containers: [
            {
              name: "postgres",
              image: "ghcr.io/cloudnative-pg/postgresql:16.2",
              ports: [port(5432), port(9187), port(8000)],
            },
          ],
        }),
      ),
    ).toEqual({
      system: "postgresql",
      namespace: "data",
      workloadKind: "Cluster",
      workloadName: "pg-main",
      ownerKind: "Cluster",
      ownerName: "pg-main",
      podName: "pg-main-1",
      containerName: "postgres",
      image: "ghcr.io/cloudnative-pg/postgresql:16.2",
      version: "16.2",
      ports: [5432, 9187, 8000],
      operator: "cloudnative-pg",
      role: "primary",
      serviceNames: ["pg-main", "pg-main-rw", "pg-main-ro", "pg-main-r"],
      headlessServiceName: null,
      evidence: [
        "label:cnpg.io/cluster=pg-main",
        "image:ghcr.io/cloudnative-pg/postgresql:16.2",
      ],
    });
  });

  test("CloudNativePG: the legacy `role` label and a missing podRole", () => {
    const candidate: KubernetesDatabaseCandidate | null = classifyKubernetesPod(
      pod({
        name: "pg-main-2",
        labels: { "cnpg.io/cluster": "pg-main", role: "replica" },
        containers: [
          { name: "postgres", image: "ghcr.io/cloudnative-pg/postgresql:16" },
        ],
      }),
    );
    expect(candidate?.role).toBe("replica");
    expect(candidate?.workloadName).toBe("pg-main");
  });

  test("CloudNativePG pooler pods are not members", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "pg-main-pooler-rw-6d9f",
          labels: {
            "cnpg.io/cluster": "pg-main",
            "cnpg.io/poolerName": "pg-main-pooler-rw",
          },
          containers: [
            {
              name: "pgbouncer",
              image: "ghcr.io/cloudnative-pg/pgbouncer:1.22",
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      classifyKubernetesPod(
        pod({
          name: "pg-main-pooler-x",
          labels: { "cnpg.io/cluster": "pg-main", "cnpg.io/podRole": "pooler" },
          containers: [
            {
              name: "pgbouncer",
              image: "ghcr.io/cloudnative-pg/pgbouncer:1.22",
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  test("Zalando (Spilo): cluster-name, spilo-role, the -repl Service", () => {
    const candidate: KubernetesDatabaseCandidate | null = classifyKubernetesPod(
      pod({
        name: "acid-main-0",
        namespace: "pg",
        labels: {
          application: "spilo",
          "cluster-name": "acid-main",
          "spilo-role": "master",
        },
        owner: { kind: "StatefulSet", name: "acid-main" },
        containers: [
          {
            name: "postgres",
            image: "ghcr.io/zalando/spilo-16:3.2-p2",
            ports: [port(8008), port(5432), port(8080)],
          },
        ],
      }),
      { statefulSetServiceNames: { "acid-main": "acid-main-config" } },
    );
    expect(candidate).toMatchObject({
      system: "postgresql",
      workloadKind: "Cluster",
      workloadName: "acid-main",
      operator: "zalando",
      role: "primary",
      version: "16",
      // The poolers clients connect through, the StatefulSet and its headless Service.
      serviceNames: [
        "acid-main",
        "acid-main-repl",
        "acid-main-pooler",
        "acid-main-pooler-repl",
        "acid-main-config",
      ],
      headlessServiceName: "acid-main-config",
    });
  });

  test("Zalando: application=spilo without a cluster-name falls back to the image", () => {
    const candidate: KubernetesDatabaseCandidate | null = classifyKubernetesPod(
      pod({
        name: "spilo-0",
        labels: { application: "spilo" },
        owner: { kind: "StatefulSet", name: "spilo" },
        containers: [
          { name: "postgres", image: "ghcr.io/zalando/spilo-16:3.2" },
        ],
      }),
    );
    expect(candidate).toMatchObject({
      workloadKind: "StatefulSet",
      workloadName: "spilo",
      operator: null,
    });
  });

  test("Crunchy PGO: the cluster (not the per-instance-set StatefulSet)", () => {
    const candidate: KubernetesDatabaseCandidate | null = classifyKubernetesPod(
      pod({
        name: "hippo-instance1-abcd-0",
        namespace: "postgres-operator",
        labels: {
          "postgres-operator.crunchydata.com/cluster": "hippo",
          "postgres-operator.crunchydata.com/instance-set": "instance1",
          "postgres-operator.crunchydata.com/instance": "hippo-instance1-abcd",
          "postgres-operator.crunchydata.com/role": "master",
          "postgres-operator.crunchydata.com/data": "postgres",
        },
        owner: { kind: "StatefulSet", name: "hippo-instance1-abcd" },
        containers: [
          {
            name: "database",
            image:
              "registry.developers.crunchydata.com/crunchydata/crunchy-postgres:ubi8-16.2-0",
            ports: [port(5432)],
          },
          {
            name: "replication-cert-copy",
            image:
              "registry.developers.crunchydata.com/crunchydata/crunchy-postgres:ubi8-16.2-0",
          },
          {
            name: "pgbackrest",
            image:
              "registry.developers.crunchydata.com/crunchydata/crunchy-pgbackrest:ubi8-2.49",
          },
        ],
      }),
      { statefulSetServiceNames: { "hippo-instance1-abcd": "hippo-pods" } },
    );
    expect(candidate).toMatchObject({
      system: "postgresql",
      workloadKind: "Cluster",
      workloadName: "hippo",
      operator: "crunchy",
      role: "primary",
      containerName: "database",
      ports: [5432],
      serviceNames: [
        "hippo",
        "hippo-primary",
        "hippo-replicas",
        "hippo-ha",
        "hippo-pgbouncer",
        "hippo-instance1-abcd",
        "hippo-pods",
      ],
      headlessServiceName: "hippo-pods",
    });
  });

  test("Crunchy pgBouncer, repo host and pgAdmin pods are not members", () => {
    for (const labels of [
      {
        "postgres-operator.crunchydata.com/cluster": "hippo",
        "postgres-operator.crunchydata.com/role": "pgbouncer",
      },
      {
        "postgres-operator.crunchydata.com/cluster": "hippo",
        "postgres-operator.crunchydata.com/pgbackrest-dedicated": "",
      },
      {
        "postgres-operator.crunchydata.com/cluster": "hippo",
        "postgres-operator.crunchydata.com/pgadmin": "",
      },
    ]) {
      expect(
        classifyKubernetesPod(
          pod({
            name: "hippo-other-0",
            labels,
            containers: [
              {
                name: "database",
                image:
                  "registry.developers.crunchydata.com/crunchydata/crunchy-postgres:ubi8-16.2-0",
              },
            ],
          }),
        ),
      ).toBeNull();
    }
  });

  test("Percona PostgreSQL v2 (a Crunchy fork) keeps its operand despite the -operator image", () => {
    const candidate: KubernetesDatabaseCandidate | null = classifyKubernetesPod(
      pod({
        name: "cluster1-instance1-x9z-0",
        labels: {
          "postgres-operator.crunchydata.com/cluster": "cluster1",
          "postgres-operator.crunchydata.com/role": "replica",
        },
        owner: { kind: "StatefulSet", name: "cluster1-instance1-x9z" },
        containers: [
          {
            name: "database",
            image: "percona/percona-postgresql-operator:2.3.1-ppg16-postgres",
            ports: [port(5432)],
          },
          {
            name: "pgbackrest",
            image: "percona/percona-postgresql-operator:2.3.1-ppg16-pgbackrest",
          },
        ],
      }),
    );
    expect(candidate).toMatchObject({
      workloadName: "cluster1",
      containerName: "database",
      version: "16",
      role: "replica",
    });
  });

  test("Percona XtraDB Cluster: instance label, -pxc Service; haproxy is not a member", () => {
    const labels: Record<string, string> = {
      "app.kubernetes.io/managed-by": "percona-xtradb-cluster-operator",
      "app.kubernetes.io/name": "percona-xtradb-cluster",
      "app.kubernetes.io/instance": "cluster1",
    };
    expect(
      classifyKubernetesPod(
        pod({
          name: "cluster1-pxc-0",
          labels: { ...labels, "app.kubernetes.io/component": "pxc" },
          owner: { kind: "StatefulSet", name: "cluster1-pxc" },
          containers: [
            {
              name: "pxc",
              image: "percona/percona-xtradb-cluster:8.0.35-27.1",
              ports: [port(3306), port(4444)],
            },
            {
              name: "logs",
              image:
                "percona/percona-xtradb-cluster-operator:1.14.0-logcollector",
            },
          ],
        }),
      ),
    ).toMatchObject({
      system: "mysql",
      workloadKind: "Cluster",
      workloadName: "cluster1",
      operator: "percona",
      // HAProxy / ProxySQL are where applications connect.
      serviceNames: [
        "cluster1",
        "cluster1-pxc",
        "cluster1-haproxy",
        "cluster1-haproxy-replicas",
        "cluster1-proxysql",
      ],
      version: "8.0.35",
    });

    for (const component of ["haproxy", "proxysql"]) {
      expect(
        classifyKubernetesPod(
          pod({
            name: `cluster1-${component}-0`,
            labels: { ...labels, "app.kubernetes.io/component": component },
            containers: [{ name: component, image: "percona/haproxy:2.8" }],
          }),
        ),
      ).toBeNull();
    }
  });

  test("Percona Server for MongoDB: the replset Service; mongos is not a member", () => {
    const labels: Record<string, string> = {
      "app.kubernetes.io/managed-by": "percona-server-mongodb-operator",
      "app.kubernetes.io/name": "percona-server-mongodb",
      "app.kubernetes.io/instance": "my-cluster-name",
    };
    expect(
      classifyKubernetesPod(
        pod({
          name: "my-cluster-name-rs0-0",
          labels: {
            ...labels,
            "app.kubernetes.io/component": "mongod",
            "app.kubernetes.io/replset": "rs0",
          },
          containers: [
            {
              name: "mongod",
              image: "percona/percona-server-mongodb:7.0.8-5",
            },
          ],
        }),
      ),
    ).toMatchObject({
      system: "mongodb",
      workloadName: "my-cluster-name",
      serviceNames: [
        "my-cluster-name",
        "my-cluster-name-rs0",
        "my-cluster-name-mongos",
      ],
    });
    expect(
      classifyKubernetesPod(
        pod({
          name: "my-cluster-name-mongos-0",
          labels: { ...labels, "app.kubernetes.io/component": "mongos" },
          containers: [
            { name: "mongos", image: "percona/percona-server-mongodb:7.0.8-5" },
          ],
        }),
      ),
    ).toBeNull();
  });

  test("a non-Percona managed-by is not the Percona rule", () => {
    const candidate: KubernetesDatabaseCandidate | null = classifyKubernetesPod(
      pod({
        name: "x-0",
        labels: {
          "app.kubernetes.io/managed-by": "Helm",
          "app.kubernetes.io/name": "percona-xtradb-cluster",
          "app.kubernetes.io/instance": "x",
        },
        owner: { kind: "StatefulSet", name: "x" },
        containers: [
          { name: "pxc", image: "percona/percona-xtradb-cluster:8.0" },
        ],
      }),
    );
    expect(candidate?.operator).toBeNull();
    expect(candidate?.workloadKind).toBe("StatefulSet");
  });

  test("Oracle MySQL operator: cluster role; router pods are not members", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "mycluster-0",
          labels: {
            "mysql.oracle.com/cluster": "mycluster",
            "mysql.oracle.com/cluster-role": "PRIMARY",
          },
          owner: { kind: "StatefulSet", name: "mycluster" },
          containers: [
            {
              name: "mysql",
              image:
                "container-registry.oracle.com/mysql/community-server:8.3.0",
              ports: [port(3306), port(33060)],
            },
            {
              name: "sidecar",
              image:
                "container-registry.oracle.com/mysql/community-operator:8.3.0-2.1.2",
            },
          ],
        }),
      ),
    ).toMatchObject({
      system: "mysql",
      workloadKind: "Cluster",
      workloadName: "mycluster",
      operator: "mysql-operator",
      role: "primary",
      serviceNames: ["mycluster", "mycluster-instances"],
      containerName: "mysql",
    });

    // Router Deployment pods, whether or not they carry a component label.
    expect(
      classifyKubernetesPod(
        pod({
          name: "mycluster-router-5c6d",
          labels: {
            "mysql.oracle.com/cluster": "mycluster",
            component: "mysqlrouter",
          },
          containers: [
            {
              name: "router",
              image: "container-registry.oracle.com/mysql/community-router:8.3",
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      classifyKubernetesPod(
        pod({
          name: "mycluster-router-5c6e",
          labels: { "mysql.oracle.com/cluster": "mycluster" },
          containers: [{ name: "router", image: "mysql/mysql-router:8.0" }],
        }),
      ),
    ).toBeNull();
  });

  test("ECK: the Elasticsearch cluster and its -es-http Service", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "quickstart-es-default-0",
          namespace: "elastic",
          labels: {
            "common.k8s.elastic.co/type": "elasticsearch",
            "elasticsearch.k8s.elastic.co/cluster-name": "quickstart",
            "elasticsearch.k8s.elastic.co/node-master": "true",
          },
          owner: { kind: "StatefulSet", name: "quickstart-es-default" },
          containers: [
            {
              name: "elasticsearch",
              image: "docker.elastic.co/elasticsearch/elasticsearch:8.13.0",
              ports: [port(9200), port(9300)],
            },
          ],
        }),
        {
          statefulSetServiceNames: {
            "quickstart-es-default": "quickstart-es-default",
          },
        },
      ),
    ).toMatchObject({
      system: "elasticsearch",
      workloadName: "quickstart",
      operator: "eck",
      serviceNames: [
        "quickstart",
        "quickstart-es-http",
        "quickstart-es-default",
      ],
      headlessServiceName: "quickstart-es-default",
      version: "8.13.0",
    });
  });

  test("ECK Kibana pods are not Elasticsearch members", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "quickstart-kb-6d9f",
          labels: {
            "common.k8s.elastic.co/type": "kibana",
            "kibana.k8s.elastic.co/name": "quickstart",
          },
          containers: [
            {
              name: "kibana",
              image: "docker.elastic.co/kibana/kibana:8.13.0",
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  test("Altinity ClickHouse: the installation and its clickhouse-<chi> Service", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "chi-demo-cluster-0-0-0",
          labels: { "clickhouse.altinity.com/chi": "demo" },
          owner: { kind: "StatefulSet", name: "chi-demo-cluster-0-0" },
          containers: [
            {
              name: "clickhouse",
              image: "altinity/clickhouse-server:23.8.8.21.altinitystable",
            },
          ],
        }),
      ),
    ).toMatchObject({
      system: "clickhouse",
      workloadName: "demo",
      operator: "altinity",
      // Altinity names each replica's Service after its StatefulSet.
      serviceNames: ["demo", "clickhouse-demo", "chi-demo-cluster-0-0"],
    });
  });

  test("cass-operator: the cluster and its <cluster>-<dc>-service", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "demo-dc1-default-sts-0",
          labels: {
            "cassandra.datastax.com/cluster": "demo",
            "cassandra.datastax.com/datacenter": "dc1",
          },
          owner: { kind: "StatefulSet", name: "demo-dc1-default-sts" },
          containers: [
            {
              name: "cassandra",
              image: "k8ssandra/cass-management-api:4.1.4",
              ports: [port(9042)],
            },
            {
              name: "server-system-logger",
              image: "k8ssandra/system-logger:v1.19.0",
            },
          ],
        }),
      ),
    ).toMatchObject({
      system: "cassandra",
      workloadName: "demo",
      operator: "cass-operator",
      serviceNames: [
        "demo",
        "demo-dc1-service",
        "demo-dc1-all-pods-service",
        "demo-dc1-default-sts",
      ],
    });
  });

  test("Bitnami chart: release fullname, headless and component Services", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "my-pg-postgresql-primary-0",
          labels: {
            "app.kubernetes.io/name": "postgresql",
            "app.kubernetes.io/instance": "my-pg",
            "app.kubernetes.io/component": "primary",
            "app.kubernetes.io/managed-by": "Helm",
          },
          owner: { kind: "StatefulSet", name: "my-pg-postgresql-primary" },
          containers: [
            {
              name: "postgresql",
              image: "docker.io/bitnami/postgresql:16.2.0-debian-12-r5",
              ports: [port(5432)],
            },
            {
              name: "metrics",
              image: "docker.io/bitnami/postgres-exporter:0.15.0",
              ports: [port(9187)],
            },
          ],
        }),
        {
          statefulSetServiceNames: {
            "my-pg-postgresql-primary": "my-pg-postgresql-primary-hl",
          },
        },
      ),
    ).toEqual({
      system: "postgresql",
      namespace: "data",
      workloadKind: "Cluster",
      workloadName: "my-pg-postgresql",
      ownerKind: "StatefulSet",
      ownerName: "my-pg-postgresql-primary",
      podName: "my-pg-postgresql-primary-0",
      containerName: "postgresql",
      image: "docker.io/bitnami/postgresql:16.2.0-debian-12-r5",
      version: "16.2.0",
      ports: [5432],
      operator: "helm",
      role: "primary",
      serviceNames: [
        "my-pg-postgresql",
        "my-pg-postgresql-headless",
        "my-pg-postgresql-hl",
        "my-pg-postgresql-primary",
        "my-pg-postgresql-primary-hl",
      ],
      headlessServiceName: "my-pg-postgresql-primary-hl",
      evidence: [
        "label:app.kubernetes.io/name=postgresql",
        "image:docker.io/bitnami/postgresql:16.2.0-debian-12-r5",
      ],
    });
  });

  test("Bitnami chart: a release named after the chart is the fullname itself", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "redis-replicas-0",
          labels: {
            "app.kubernetes.io/name": "redis",
            "app.kubernetes.io/instance": "redis",
            "app.kubernetes.io/component": "replica",
          },
          containers: [{ name: "redis", image: "bitnami/redis:7.2" }],
        }),
      ),
    ).toMatchObject({
      workloadName: "redis",
      role: "replica",
      operator: null,
      serviceNames: [
        "redis",
        "redis-headless",
        "redis-hl",
        "redis-replica",
        "redis-replicas",
      ],
    });
  });

  test("Bitnami Redis with a Sentinel container in the pod is still Redis", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "cache-redis-node-0",
          labels: {
            "app.kubernetes.io/name": "redis",
            "app.kubernetes.io/instance": "cache",
            "app.kubernetes.io/component": "node",
          },
          containers: [
            { name: "redis", image: "bitnami/redis:7.2" },
            { name: "sentinel", image: "bitnami/redis-sentinel:7.2" },
          ],
        }),
      )?.workloadName,
    ).toBe("cache-redis");
  });

  test.each(["metrics", "exporter", "pgpool", "pgbouncer", "mongos"])(
    "Bitnami component %s is not a member",
    (component: string) => {
      expect(
        classifyKubernetesPod(
          pod({
            name: `x-${component}-0`,
            labels: {
              "app.kubernetes.io/name": "postgresql-ha",
              "app.kubernetes.io/instance": "x",
              "app.kubernetes.io/component": component,
            },
            containers: [{ name: component, image: "bitnami/postgresql:16" }],
          }),
        ),
      ).toBeNull();
    },
  );

  test("a chart label without an instance names the workload after the owner", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "mongo-0",
          labels: { "app.kubernetes.io/name": "mongodb" },
          owner: { kind: "StatefulSet", name: "mongo" },
          containers: [{ name: "mongodb", image: "bitnami/mongodb:7.0" }],
        }),
      ),
    ).toMatchObject({
      system: "mongodb",
      workloadKind: "StatefulSet",
      workloadName: "mongo",
      serviceNames: ["mongo"],
    });
  });

  test("the operator's engine wins over an unrecognised image", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "pg-main-1",
          labels: { "cnpg.io/cluster": "pg-main" },
          containers: [
            { name: "postgres", image: "registry.corp/custom/pg-build:16" },
          ],
        }),
      ),
    ).toMatchObject({
      system: "postgresql",
      containerName: "postgres",
      image: "registry.corp/custom/pg-build:16",
    });
  });
});

describe("classifyKubernetesPod — the Vitess operator", () => {
  /*
   * What the operator (planetscale/vitess-operator) stamps on every pod of a
   * VitessCluster: `planetscale.com/cluster` and `planetscale.com/component`.
   * Every component runs `vitess/lite`; the vttablets add a mysqld.
   */
  function vitessPod(data: {
    name: string;
    component: string | null;
    owner?: { kind: string; name: string } | null;
    containers: Array<ContainerFixture>;
    extraLabels?: Record<string, string>;
  }): KubernetesPodLike {
    const labels: Record<string, string> = {
      "planetscale.com/cluster": "example",
      ...(data.extraLabels || {}),
    };
    if (data.component !== null) {
      labels["planetscale.com/component"] = data.component;
    }
    return pod({
      name: data.name,
      namespace: "vitess",
      labels,
      owner: data.owner === undefined ? null : data.owner,
      containers: data.containers,
    });
  }

  test("vtgate is the database: the VitessCluster, on vitess/lite", () => {
    const candidate: KubernetesDatabaseCandidate | null = classifyKubernetesPod(
      vitessPod({
        name: "example-zone1-vtgate-bc6cde92-6bd99c6888-vwcj5",
        component: "vtgate",
        extraLabels: {
          "planetscale.com/cell": "zone1",
          "pod-template-hash": "6bd99c6888",
        },
        owner: {
          kind: "ReplicaSet",
          name: "example-zone1-vtgate-bc6cde92-6bd99c6888",
        },
        containers: [
          {
            name: "vtgate",
            image: "vitess/lite:v19.0.4",
            command: ["/vt/bin/vtgate"],
            args: ["--cell=zone1", "--mysql_server_port=3306"],
            ports: [port(15000), port(15999), port(3306)],
          },
        ],
      }),
    );

    expect(candidate).toMatchObject({
      system: "vitess",
      namespace: "vitess",
      workloadKind: "Cluster",
      workloadName: "example",
      ownerKind: "Deployment",
      ownerName: "example-zone1-vtgate-bc6cde92",
      operator: "vitess-operator",
      role: null,
      containerName: "vtgate",
      image: "vitess/lite:v19.0.4",
      version: "19.0.4",
      // The cell's vtgate Deployment - the operator hashes Service names.
      serviceNames: ["example", "example-zone1-vtgate-bc6cde92"],
      evidence: [
        "label:planetscale.com/cluster=example",
        "image:vitess/lite:v19.0.4",
      ],
    });
    // Without the labels, vitess/lite is no database at all.
    expect(classifyImage("vitess/lite:v19.0.4").kind).not.toBe("database");
  });

  test("a vtgate on the dedicated vitess/vtgate image is the same database", () => {
    expect(
      classifyKubernetesPod(
        vitessPod({
          name: "example-zone2-vtgate-0a1b2c3d-7f8e9d-abcde",
          component: "vtgate",
          owner: { kind: "Deployment", name: "example-zone2-vtgate-0a1b2c3d" },
          containers: [
            {
              name: "vtgate",
              image: "vitess/vtgate:v19.0.4",
              ports: [port(3306)],
            },
          ],
        }),
      ),
    ).toMatchObject({
      system: "vitess",
      workloadKind: "Cluster",
      workloadName: "example",
    });
  });

  test.each(["vttablet", "vtctld", "vtorc", "vtbackup", "vtadmin", "etcd"])(
    "%s pods belong to the VitessCluster but are not members",
    (component: string) => {
      expect(
        classifyKubernetesPod(
          vitessPod({
            name: `example-${component}-zone1-2469782763-bfadd780`,
            component,
            owner: { kind: "VitessShard", name: "example-commerce-x-x" },
            containers: [
              {
                name: component,
                image: "vitess/lite:v19.0.4",
                ports: [port(15000), port(15999)],
              },
            ],
          }),
        ),
      ).toBeNull();
    },
  );

  test("a vttablet's mysqld container never makes it a MySQL database of its own", () => {
    const tablet: KubernetesPodLike = vitessPod({
      name: "example-vttablet-zone1-2548885007-46a852d0",
      component: "vttablet",
      extraLabels: {
        "planetscale.com/keyspace": "commerce",
        "planetscale.com/shard": "x-x",
        "planetscale.com/tablet-type": "replica",
      },
      owner: { kind: "VitessShard", name: "example-commerce-x-x-2b3c4d5e" },
      containers: [
        {
          name: "vttablet",
          image: "vitess/lite:v19.0.4",
          ports: [port(15000), port(15999)],
        },
        { name: "mysqld", image: "mysql:8.0.30", ports: [port(3306)] },
        { name: "mysqld-exporter", image: "prom/mysqld-exporter:v0.14.0" },
      ],
    });
    expect(classifyKubernetesPod(tablet)).toBeNull();

    /*
     * The labels decide, not the neighbours: a tablet pod whose only
     * server is its mysqld is not a member either, though the image alone
     * would make it MySQL.
     */
    const mysqldOnly: KubernetesPodLike = {
      ...tablet,
      spec: {
        containers: [
          { name: "mysqld", image: "mysql:8.0.30", ports: [port(3306)] },
          { name: "mysqld-exporter", image: "prom/mysqld-exporter:v0.14.0" },
        ],
      },
    };
    expect(classifyKubernetesPod(mysqldOnly)).toBeNull();
    expect(classifyKubernetesPod({ ...mysqldOnly, labels: {} })).toMatchObject({
      system: "mysql",
    });
  });

  test("a VitessCluster pod without a component is not guessed a member", () => {
    expect(
      classifyKubernetesPod(
        vitessPod({
          name: "example-x",
          component: null,
          owner: { kind: "Deployment", name: "example-x" },
          containers: [{ name: "x", image: "vitess/lite:v19.0.4" }],
        }),
      ),
    ).toBeNull();
  });

  test("the cells' vtgates fold into ONE database, keyed in the mysql family", () => {
    const vtgate: (
      cell: string,
      suffix: string,
    ) => KubernetesDatabaseCandidate = (
      cell: string,
      suffix: string,
    ): KubernetesDatabaseCandidate => {
      return classifyKubernetesPod(
        vitessPod({
          name: `example-${cell}-vtgate-${suffix}-5d6f7-abcde`,
          component: "vtgate",
          owner: {
            kind: "Deployment",
            name: `example-${cell}-vtgate-${suffix}`,
          },
          containers: [
            {
              name: "vtgate",
              image: "vitess/lite:v19.0.4",
              ports: [port(3306)],
            },
          ],
        }),
      )!;
    };

    const groups: Array<KubernetesDatabaseGroup> =
      groupKubernetesDatabaseCandidates([
        vtgate("zone2", "0a1b2c3d"),
        vtgate("zone1", "bc6cde92"),
      ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      system: "vitess",
      workloadKind: "Cluster",
      workloadName: "example",
      operator: "vitess-operator",
      ownerWorkloads: [
        { kind: "Deployment", name: "example-zone1-vtgate-bc6cde92" },
        { kind: "Deployment", name: "example-zone2-vtgate-0a1b2c3d" },
      ],
    });
    expect(
      buildWorkloadDatabaseServerIdentifier({
        system: groups[0]!.system,
        platform: "kubernetes",
        parentName: "prod",
        namespace: groups[0]!.namespace,
        workloadKind: groups[0]!.workloadKind,
        workloadName: groups[0]!.workloadName,
      }),
    ).toBe("mysql|kubernetes:prod/vitess/cluster/example");
  });
});

describe("classifyKubernetesPod — images", () => {
  test("a plain StatefulSet running postgres", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "pg-0",
          namespace: "shop",
          owner: { kind: "StatefulSet", name: "pg" },
          containers: [
            {
              name: "postgres",
              image: "postgres:16.2-alpine",
              ports: [port(5432), port(5432), { containerPort: 0 }, {}],
            },
          ],
        }),
        { statefulSetServiceNames: { pg: "pg-hl", other: "x" } },
      ),
    ).toEqual({
      system: "postgresql",
      namespace: "shop",
      workloadKind: "StatefulSet",
      workloadName: "pg",
      ownerKind: "StatefulSet",
      ownerName: "pg",
      podName: "pg-0",
      containerName: "postgres",
      image: "postgres:16.2-alpine",
      version: "16.2",
      ports: [5432],
      operator: null,
      role: null,
      // The headless Service is a name clients reach the database by too.
      serviceNames: ["pg", "pg-hl"],
      headlessServiceName: "pg-hl",
      evidence: ["image:postgres:16.2-alpine"],
    });
  });

  test("a Deployment is named by stripping the pod-template-hash", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "cache-7d9f8b6c5d-x2x4z",
          labels: { "pod-template-hash": "7d9f8b6c5d" },
          owner: { kind: "ReplicaSet", name: "cache-7d9f8b6c5d" },
          containers: [{ name: "redis", image: "redis:7" }],
        }),
      ),
    ).toMatchObject({ workloadKind: "Deployment", workloadName: "cache" });
  });

  test("a ReplicaSet without a matching hash label stays a ReplicaSet (no guessing)", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "cache-7d9f8b6c5d-x2x4z",
          owner: { kind: "ReplicaSet", name: "cache-7d9f8b6c5d" },
          containers: [{ name: "redis", image: "redis:7" }],
        }),
      ),
    ).toMatchObject({
      workloadKind: "ReplicaSet",
      workloadName: "cache-7d9f8b6c5d",
    });
    expect(
      classifyKubernetesPod(
        pod({
          name: "cache-abc-x",
          labels: { "pod-template-hash": "zzz" },
          owner: { kind: "ReplicaSet", name: "cache-abc" },
          containers: [{ name: "redis", image: "redis:7" }],
        }),
      )?.workloadKind,
    ).toBe("ReplicaSet");
  });

  test("a DaemonSet, a bare pod and another owner kind", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "memcached-node-1",
          owner: { kind: "DaemonSet", name: "memcached" },
          containers: [{ name: "memcached", image: "memcached:1.6" }],
        }),
      ),
    ).toMatchObject({ workloadKind: "DaemonSet", workloadName: "memcached" });
    // An owner-less pod counts once it declares a port (a server run).
    expect(
      classifyKubernetesPod(
        pod({
          name: "scratch-db",
          containers: [
            { name: "mysql", image: "mysql:8", ports: [port(3306)] },
          ],
        }),
      ),
    ).toMatchObject({
      workloadKind: "Pod",
      workloadName: "scratch-db",
      ownerKind: null,
      ownerName: null,
      serviceNames: ["scratch-db"],
    });
    expect(
      classifyKubernetesPod(
        pod({
          name: "x-1",
          owner: { kind: "MongoDBCommunity", name: "mdb" },
          containers: [{ name: "mongod", image: "mongo:7" }],
        }),
      ),
    ).toMatchObject({ workloadKind: "MongoDBCommunity", workloadName: "mdb" });
  });

  test("a StatefulSet owner without a known serviceName has no headless Service", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "pg-0",
          owner: { kind: "StatefulSet", name: "pg" },
          containers: [{ name: "postgres", image: "postgres:16" }],
        }),
      )?.headlessServiceName,
    ).toBeNull();
    // Object.prototype keys are not StatefulSet names.
    expect(
      classifyKubernetesPod(
        pod({
          name: "constructor-0",
          owner: { kind: "StatefulSet", name: "constructor" },
          containers: [{ name: "postgres", image: "postgres:16" }],
        }),
        { statefulSetServiceNames: {} },
      )?.headlessServiceName,
    ).toBeNull();
  });

  test("exporters, mesh proxies and log shippers next to the DB are fine", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "pg-0",
          owner: { kind: "StatefulSet", name: "pg" },
          containers: [
            { name: "istio-proxy", image: "docker.io/istio/proxyv2:1.20.0" },
            { name: "postgres", image: "postgres:16" },
            {
              name: "exporter",
              image: "quay.io/prometheuscommunity/postgres-exporter:v0.15.0",
            },
            { name: "fluent-bit", image: "fluent/fluent-bit:3.0" },
            { name: "backup", image: "bitnami/kubectl:1.29" },
          ],
        }),
      ),
    ).toMatchObject({ system: "postgresql", containerName: "postgres" });
  });

  test("an app pod with a database SIDECAR is not a database", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "api-6c9f-x",
          labels: { "pod-template-hash": "6c9f" },
          owner: { kind: "ReplicaSet", name: "api-6c9f" },
          containers: [
            { name: "api", image: "acme/api:1.4.2" },
            { name: "redis", image: "redis:7" },
          ],
        }),
      ),
    ).toBeNull();
    // Even when the DB container is listed first.
    expect(
      classifyKubernetesPod(
        pod({
          name: "api-x",
          containers: [
            { name: "redis", image: "redis:7" },
            { name: "api", image: "acme/api:1.4.2" },
          ],
        }),
      ),
    ).toBeNull();
    // A container without an image is unknown, so it rejects too.
    expect(
      classifyKubernetesPod(
        pod({
          name: "api-y",
          containers: [
            { name: "redis", image: "redis:7" },
            { name: "api", image: "" },
          ],
        }),
      ),
    ).toBeNull();
  });

  test.each([
    ["an exporter", "prometheuscommunity/postgres-exporter:v0.15.0"],
    ["an operator", "ghcr.io/cloudnative-pg/cloudnative-pg:1.22"],
    ["an admin UI", "dpage/pgadmin4:8"],
    ["a pooler", "bitnami/pgbouncer:1.22"],
    ["a backup tool", "pgbackrest/pgbackrest"],
    ["a mesh proxy", "istio/proxyv2:1.20"],
    ["an application", "acme/api:1"],
  ])(
    "a pod running only %s is not a database",
    (_label: string, image: string) => {
      expect(
        classifyKubernetesPod(
          pod({
            name: "x-0",
            owner: { kind: "Deployment", name: "x" },
            containers: [{ name: "c", image }],
          }),
        ),
      ).toBeNull();
    },
  );

  test("backup Jobs and CronJobs running a DB image are skipped", () => {
    for (const owner of [
      { kind: "Job", name: "pg-dump-28491230" },
      { kind: "CronJob", name: "pg-dump" },
    ]) {
      expect(
        classifyKubernetesPod(
          pod({
            name: "pg-dump-28491230-abcde",
            owner,
            containers: [{ name: "dump", image: "postgres:16" }],
          }),
        ),
      ).toBeNull();
    }
  });

  test("a Job owner anywhere in the owner list skips the pod, labels or not", () => {
    const skipped: KubernetesPodLike = {
      ...pod({
        name: "backup-x",
        labels: { "cnpg.io/cluster": "pg-main" },
        containers: [{ name: "postgres", image: "postgres:16" }],
      }),
      ownerReferences: {
        items: [
          { kind: "Cluster", name: "pg-main" },
          { kind: "Job", name: "pg-main-backup" },
        ],
      },
    };
    expect(classifyKubernetesPod(skipped)).toBeNull();
  });

  test.each(["Succeeded", "Failed", "succeeded"])(
    "a %s pod is skipped",
    (phase: string) => {
      expect(
        classifyKubernetesPod(
          pod({
            name: "pg-0",
            phase,
            containers: [{ name: "postgres", image: "postgres:16" }],
          }),
        ),
      ).toBeNull();
    },
  );

  test("Pending and phase-less pods are still classified", () => {
    for (const phase of ["Pending", null]) {
      expect(
        classifyKubernetesPod(
          pod({
            name: "pg-0",
            phase,
            owner: { kind: "StatefulSet", name: "pg" },
            containers: [{ name: "postgres", image: "postgres:16" }],
          }),
        )?.system,
      ).toBe("postgresql");
    }
  });

  test("malformed input never throws", () => {
    expect(
      classifyKubernetesPod(null as unknown as KubernetesPodLike),
    ).toBeNull();
    expect(classifyKubernetesPod({ namespaceKey: "x", name: "" })).toBeNull();
    expect(
      classifyKubernetesPod({
        namespaceKey: "x",
        name: "p",
        spec: { containers: "nope" } as unknown as KubernetesPodLike["spec"],
        ownerReferences: {
          items: [null, { kind: "" }, { name: "x" }],
        } as unknown as KubernetesPodLike["ownerReferences"],
        labels: null,
      }),
    ).toBeNull();
    expect(
      classifyKubernetesPod({
        namespaceKey: "x",
        name: "p",
        ownerReferences: { items: [{ kind: "StatefulSet", name: "p" }] },
        spec: {
          containers: [
            null,
            {
              name: 5,
              image: "postgres:16",
              ports: "5432",
              command: "not-a-list",
              args: [7, "x"],
            },
          ] as unknown as Array<{ name?: string; image?: string }>,
        },
      }),
    ).toMatchObject({ system: "postgresql", containerName: "", ports: [] });
  });
});

describe("classifyKubernetesPod — never reads environment variables", () => {
  const SECRET: string = "hunter2-do-not-copy";

  test("env values are not read, even when present", () => {
    let envReads: number = 0;
    const container: Record<string, unknown> = {
      name: "postgres",
      image: "postgres:16",
      ports: [{ containerPort: 5432 }],
    };
    Object.defineProperty(container, "env", {
      enumerable: true,
      get: (): Array<{ name: string; value: string }> => {
        envReads++;
        return [{ name: "POSTGRES_PASSWORD", value: SECRET }];
      },
    });

    const candidate: KubernetesDatabaseCandidate | null = classifyKubernetesPod(
      {
        namespaceKey: "data",
        name: "pg-0",
        spec: {
          containers: [container] as unknown as Array<{
            name?: string;
            image?: string;
          }>,
        },
      },
    );

    expect(candidate?.system).toBe("postgresql");
    expect(envReads).toBe(0);
    expect(JSON.stringify(candidate)).not.toContain(SECRET);
  });

  test("a secret in env never reaches the candidate on the label path either", () => {
    const candidate: KubernetesDatabaseCandidate | null = classifyKubernetesPod(
      {
        namespaceKey: "data",
        name: "pg-main-1",
        labels: { "cnpg.io/cluster": "pg-main" },
        spec: {
          containers: [
            {
              name: "postgres",
              image: "ghcr.io/cloudnative-pg/postgresql:16",
              env: [{ name: "PGPASSWORD", value: SECRET }],
            },
          ] as unknown as Array<{ name?: string; image?: string }>,
        },
      },
    );
    expect(candidate).not.toBeNull();
    expect(JSON.stringify(candidate)).not.toContain(SECRET);
  });
});

describe("groupKubernetesDatabaseCandidates", () => {
  function cnpgMember(
    name: string,
    role: "primary" | "replica",
    image: string,
  ): KubernetesDatabaseCandidate {
    return classifyKubernetesPod(
      pod({
        name,
        labels: {
          "cnpg.io/cluster": "pg-main",
          "cnpg.io/instanceRole": role,
        },
        owner: { kind: "Cluster", name: "pg-main" },
        containers: [{ name: "postgres", image, ports: [port(5432)] }],
      }),
    )!;
  }

  test("one group per operator cluster; image/version from the primary", () => {
    const groups: Array<KubernetesDatabaseGroup> =
      groupKubernetesDatabaseCandidates([
        cnpgMember(
          "pg-main-3",
          "replica",
          "ghcr.io/cloudnative-pg/postgresql:16.3",
        ),
        cnpgMember(
          "pg-main-1",
          "replica",
          "ghcr.io/cloudnative-pg/postgresql:16.3",
        ),
        cnpgMember(
          "pg-main-2",
          "primary",
          "ghcr.io/cloudnative-pg/postgresql:16.2",
        ),
      ]);
    expect(groups).toEqual([
      {
        system: "postgresql",
        namespace: "data",
        workloadKind: "Cluster",
        workloadName: "pg-main",
        podNames: ["pg-main-1", "pg-main-2", "pg-main-3"],
        image: "ghcr.io/cloudnative-pg/postgresql:16.2",
        version: "16.2",
        ports: [5432],
        operator: "cloudnative-pg",
        serviceNames: ["pg-main", "pg-main-rw", "pg-main-ro", "pg-main-r"],
        headlessServiceName: null,
        podServiceNames: [],
        ownerWorkloads: [{ kind: "Cluster", name: "pg-main" }],
      },
    ]);
  });

  test("StatefulSet members carry their headless Service; ports are unioned", () => {
    const members: Array<KubernetesDatabaseCandidate> = [
      "mongo-1",
      "mongo-0",
    ].map((name: string, index: number): KubernetesDatabaseCandidate => {
      return classifyKubernetesPod(
        pod({
          name,
          owner: { kind: "StatefulSet", name: "mongo" },
          containers: [
            {
              name: "mongod",
              image: "mongo:7.0.5",
              ports: index === 0 ? [port(27017), port(27018)] : [port(27017)],
            },
          ],
        }),
        { statefulSetServiceNames: { mongo: "mongo-headless" } },
      )!;
    });

    const groups: Array<KubernetesDatabaseGroup> =
      groupKubernetesDatabaseCandidates(members);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      podNames: ["mongo-0", "mongo-1"],
      ports: [27017, 27018],
      headlessServiceName: "mongo-headless",
      podServiceNames: [
        { podName: "mongo-0", serviceName: "mongo-headless" },
        { podName: "mongo-1", serviceName: "mongo-headless" },
      ],
      image: "mongo:7.0.5",
      operator: null,
    });
  });

  test("different namespaces, kinds, names or engines never merge; output is sorted", () => {
    const base: KubernetesDatabaseCandidate = classifyKubernetesPod(
      pod({
        name: "pg-0",
        namespace: "b",
        owner: { kind: "StatefulSet", name: "pg" },
        containers: [{ name: "postgres", image: "postgres:16" }],
      }),
    )!;
    const groups: Array<KubernetesDatabaseGroup> =
      groupKubernetesDatabaseCandidates([
        base,
        { ...base, namespace: "a", podName: "pg-0" },
        { ...base, workloadKind: "Deployment", podName: "pg-x" },
        { ...base, system: "redis", podName: "pg-1" },
        { ...base, podName: "pg-1" },
      ]);
    expect(
      groups.map((group: KubernetesDatabaseGroup): string => {
        return `${group.namespace}/${group.workloadKind}/${group.workloadName}/${group.system}:${group.podNames.join(",")}`;
      }),
    ).toEqual([
      "a/StatefulSet/pg/postgresql:pg-0",
      "b/Deployment/pg/postgresql:pg-x",
      "b/StatefulSet/pg/postgresql:pg-0,pg-1",
      "b/StatefulSet/pg/redis:pg-1",
    ]);
  });

  describe("a fork and its family engine on one workload are ONE database", () => {
    function cacheMember(
      name: string,
      image: string,
    ): KubernetesDatabaseCandidate {
      return classifyKubernetesPod(
        pod({
          name,
          namespace: "cache",
          owner: { kind: "StatefulSet", name: "cache" },
          containers: [{ name: "server", image, ports: [port(6379)] }],
        }),
        { statefulSetServiceNames: { cache: "cache-headless" } },
      )!;
    }

    function identifierOf(group: KubernetesDatabaseGroup): string {
      return buildWorkloadDatabaseServerIdentifier({
        system: group.system,
        platform: "kubernetes",
        parentName: "prod",
        namespace: group.namespace,
        workloadKind: group.workloadKind,
        workloadName: group.workloadName,
      });
    }

    test("mid-rollout from redis to valkey: one group, the fork's engine, every pod", () => {
      const groups: Array<KubernetesDatabaseGroup> =
        groupKubernetesDatabaseCandidates([
          cacheMember("cache-0", "redis:7.2.4"),
          cacheMember("cache-1", "redis:7.2.4"),
          cacheMember("cache-2", "valkey/valkey:8.0.1"),
        ]);

      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        system: "valkey",
        workloadKind: "StatefulSet",
        workloadName: "cache",
        podNames: ["cache-0", "cache-1", "cache-2"],
        // Image and version describe the engine shown, not the first pod.
        image: "valkey/valkey:8.0.1",
        version: "8.0.1",
        podServiceNames: [
          { podName: "cache-0", serviceName: "cache-headless" },
          { podName: "cache-1", serviceName: "cache-headless" },
          { podName: "cache-2", serviceName: "cache-headless" },
        ],
      });
      expect(identifierOf(groups[0]!)).toBe(
        "redis|kubernetes:prod/cache/statefulset/cache",
      );
    });

    test("a fork is never undone by more pods of the family engine, and order never matters", () => {
      const members: Array<KubernetesDatabaseCandidate> = [
        cacheMember("cache-2", "redis:7.2.4"),
        cacheMember("cache-0", "valkey/valkey:8.0.1"),
        cacheMember("cache-1", "redis:7.2.4"),
      ];
      const groups: Array<KubernetesDatabaseGroup> =
        groupKubernetesDatabaseCandidates(members);

      expect(
        groups.map((group: KubernetesDatabaseGroup) => {
          return group.system;
        }),
      ).toEqual(["valkey"]);
      expect(groups).toEqual(
        groupKubernetesDatabaseCandidates([...members].reverse()),
      );
    });

    test("MySQL and MariaDB pods of one StatefulSet are one MariaDB", () => {
      const member: (
        name: string,
        image: string,
      ) => KubernetesDatabaseCandidate = (
        name: string,
        image: string,
      ): KubernetesDatabaseCandidate => {
        return classifyKubernetesPod(
          pod({
            name,
            owner: { kind: "StatefulSet", name: "orders" },
            containers: [{ name: "db", image, ports: [port(3306)] }],
          }),
        )!;
      };
      const groups: Array<KubernetesDatabaseGroup> =
        groupKubernetesDatabaseCandidates([
          member("orders-0", "mariadb:11.4.2"),
          member("orders-1", "mysql:8.0.36"),
        ]);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        system: "mariadb",
        podNames: ["orders-0", "orders-1"],
        version: "11.4.2",
      });
    });

    test("engines of different families on one workload stay two databases", () => {
      const base: KubernetesDatabaseCandidate = cacheMember(
        "cache-0",
        "redis:7.2.4",
      );
      const groups: Array<KubernetesDatabaseGroup> =
        groupKubernetesDatabaseCandidates([
          base,
          { ...base, system: "memcached", podName: "cache-1" },
        ]);
      expect(
        groups.map((group: KubernetesDatabaseGroup): string => {
          return `${group.system}:${group.podNames.join(",")}`;
        }),
      ).toEqual(["memcached:cache-1", "redis:cache-0"]);
    });

    test("a pooler still reaches its cluster whatever engine of the family the cluster shows", () => {
      const cluster: KubernetesDatabaseGroup = {
        ...groupKubernetesDatabaseCandidates([
          cnpgMember(
            "pg-main-1",
            "primary",
            "ghcr.io/cloudnative-pg/postgresql:16",
          ),
        ])[0]!,
        system: "cockroachdb",
      };
      expect(
        attachPoolerServices(
          [cluster],
          [
            {
              system: "postgresql",
              namespace: "data",
              clusterName: "pg-main",
              serviceName: "pg-main-pooler-rw",
            },
            {
              system: "mysql",
              namespace: "data",
              clusterName: "pg-main",
              serviceName: "not-this-one",
            },
          ],
        )[0]!.serviceNames,
      ).toEqual([
        "pg-main",
        "pg-main-rw",
        "pg-main-ro",
        "pg-main-r",
        "pg-main-pooler-rw",
      ]);
    });
  });

  test("input order does not change the result", () => {
    const members: Array<KubernetesDatabaseCandidate> = [
      cnpgMember(
        "pg-main-1",
        "replica",
        "ghcr.io/cloudnative-pg/postgresql:16",
      ),
      cnpgMember(
        "pg-main-2",
        "replica",
        "ghcr.io/cloudnative-pg/postgresql:16",
      ),
    ];
    expect(groupKubernetesDatabaseCandidates(members)).toEqual(
      groupKubernetesDatabaseCandidates([...members].reverse()),
    );
  });

  test("without a primary, image/version come from the first pod by name", () => {
    const groups: Array<KubernetesDatabaseGroup> =
      groupKubernetesDatabaseCandidates([
        cnpgMember(
          "pg-main-2",
          "replica",
          "ghcr.io/cloudnative-pg/postgresql:16.3",
        ),
        cnpgMember(
          "pg-main-1",
          "replica",
          "ghcr.io/cloudnative-pg/postgresql:16.2",
        ),
      ]);
    expect(groups[0]!.version).toBe("16.2");
  });

  test("malformed candidates are dropped; non-arrays give []", () => {
    expect(
      groupKubernetesDatabaseCandidates([
        null as unknown as KubernetesDatabaseCandidate,
        { system: "" } as unknown as KubernetesDatabaseCandidate,
      ]),
    ).toEqual([]);
    expect(
      groupKubernetesDatabaseCandidates(
        undefined as unknown as Array<KubernetesDatabaseCandidate>,
      ),
    ).toEqual([]);
  });
});

describe("pickMostSpecificDatabaseSystem", () => {
  test.each([
    [["redis"], "redis"],
    [["redis", "redis", "valkey"], "valkey"],
    [["valkey", "valkey", "redis"], "valkey"],
    [["mysql", "mariadb"], "mariadb"],
    [["mariadb", "mysql", "mysql", "mysql"], "mariadb"],
    [["postgresql", "cockroachdb"], "cockroachdb"],
    // Two forks that do not refine each other: the more reported one.
    [["keydb", "valkey", "valkey"], "valkey"],
    [["keydb", "keydb", "valkey"], "keydb"],
    // ...the first by name on a tie, whatever the order.
    [["valkey", "keydb"], "keydb"],
    [["keydb", "valkey"], "keydb"],
    [["redis", "valkey", "keydb"], "keydb"],
  ])("%j -> %s", (systems: Array<string>, expected: string) => {
    expect(pickMostSpecificDatabaseSystem(systems)).toBe(expected);
    expect(pickMostSpecificDatabaseSystem([...systems].reverse())).toBe(
      expected,
    );
  });

  test("nothing to pick is null; junk entries are ignored", () => {
    expect(pickMostSpecificDatabaseSystem([])).toBeNull();
    expect(
      pickMostSpecificDatabaseSystem(undefined as unknown as Array<string>),
    ).toBeNull();
    expect(
      pickMostSpecificDatabaseSystem(["", null as unknown as string, "valkey"]),
    ).toBe("valkey");
  });
});

describe("classifyContainer (Docker / Podman)", () => {
  test("Compose replicas are grouped by the Compose project + service labels", () => {
    expect(
      classifyContainer({
        name: "/shop-postgres-1",
        imageName: "postgres:16",
        labels: {
          "com.docker.compose.project": "shop",
          "com.docker.compose.service": "postgres",
          "com.docker.compose.container-number": "1",
        },
      }),
    ).toEqual({
      system: "postgresql",
      workloadKind: ContainerWorkloadKind.ComposeService,
      workloadName: "shop-postgres",
      containerName: "shop-postgres-1",
      version: "16",
    });
    // Compose v1 naming groups the same way.
    expect(
      classifyContainer({
        name: "shop_redis_2",
        imageName: "redis:7.2.4",
        labels: {
          "com.docker.compose.project": "shop",
          "com.docker.compose.service": "redis",
        },
      }),
    ).toEqual({
      system: "redis",
      workloadKind: ContainerWorkloadKind.ComposeService,
      workloadName: "shop-redis",
      containerName: "shop_redis_2",
      version: "7.2.4",
    });
  });

  test("a custom container_name in a Compose file still groups by the service", () => {
    expect(
      classifyContainer({
        name: "legacy-db",
        imageName: "mysql:8",
        labels: {
          "com.docker.compose.project": "shop",
          "com.docker.compose.service": "database",
        },
      })?.workloadName,
    ).toBe("shop-database");
  });

  test("podman-compose labels group replicas too", () => {
    expect(
      classifyContainer({
        name: "shop_db_1",
        imageName: "docker.io/library/postgres:16",
        labels: {
          "io.podman.compose.project": "shop",
          "io.podman.compose.service": "db",
        },
      })?.workloadName,
    ).toBe("shop-db");
    expect(
      classifyContainer({
        name: "shop_db_2",
        imageName: "postgres:16",
        labels: {
          "io.podman.compose.project": "shop",
          "com.docker.compose.service": "db",
        },
      })?.workloadName,
    ).toBe("shop-db");
  });

  test("half a Compose label pair is not an identity: the container name is", () => {
    expect(
      classifyContainer({
        name: "shop-db-1",
        imageName: "mysql:8",
        labels: { "com.docker.compose.project": "shop" },
      })?.workloadName,
    ).toBe("shop-db-1");
  });

  test("a plain name is its own workload", () => {
    expect(
      classifyContainer({ name: "postgres", imageName: "postgres:16" })
        ?.workloadName,
    ).toBe("postgres");
  });

  test.each([
    ["redis-6379", "redis-6380", "redis:7"],
    ["pg-14", "pg-16", "postgres:16"],
    ["orders-db-2024", "orders-db-2025", "postgres:16"],
    ["mysql_1", "mysql_2", "mysql:8"],
    ["shop-postgres-1", "shop-postgres-2", "postgres:16"],
  ])(
    "without Compose labels %s and %s stay two servers (no suffix is guessed away)",
    (first: string, second: string, imageName: string) => {
      const a: ContainerDatabaseClassification | null = classifyContainer({
        name: first,
        imageName,
      });
      const b: ContainerDatabaseClassification | null = classifyContainer({
        name: second,
        imageName,
      });
      expect(a?.workloadName).toBe(first);
      expect(b?.workloadName).toBe(second);
      expect(a?.workloadName).not.toBe(b?.workloadName);
    },
  );

  test("a Swarm task is grouped by its service label, whatever its task name", () => {
    expect(
      classifyContainer({
        name: "mystack_db.1.x7y8z9abcdefghijklmnopqrs",
        imageName: "postgres:16",
        labels: {
          "com.docker.swarm.service.name": "mystack_db",
          "com.docker.swarm.task.id": "x7y8z9abcdefghijklmnopqrs",
        },
      })?.workloadName,
    ).toBe("mystack_db");
  });

  test("a Swarm task name without labels still names its service, never the task", () => {
    expect(
      classifyContainer({
        name: "mystack_db.1.x7y8z9abcdefghijklmnopqrs",
        imageName: "postgres:16",
      })?.workloadName,
    ).toBe("mystack_db");
    // A global service's task: <service>.<node id>.<task id>.
    expect(
      classifyContainer({
        name: "mon_redis.abcdefghijklmnopqrstuvwxy.x7y8z9abcdefghijklmnopqrs",
        imageName: "redis:7",
      })?.workloadName,
    ).toBe("mon_redis");
    // Dots alone are not a task name.
    expect(
      classifyContainer({ name: "db.internal.local", imageName: "redis:7" })
        ?.workloadName,
    ).toBe("db.internal.local");
    expect(
      classifyContainer({ name: "db.1.shortid", imageName: "redis:7" })
        ?.workloadName,
    ).toBe("db.1.shortid");
  });

  test.each([
    [{ "org.testcontainers": "true" }],
    [{ "org.testcontainers.sessionId": "0f1e2d3c" }],
    [{ "com.docker.compose.oneoff": "True" }],
    [{ "io.kubernetes.pod.name": "orders-db-0" }],
    [{ "io.kubernetes.container.name": "postgres" }],
  ])(
    "an ephemeral or kubelet-managed container (%j) is not a database",
    (labels: Record<string, string>) => {
      expect(
        classifyContainer({
          name: "eager_turing",
          imageName: "postgres:16",
          labels,
        }),
      ).toBeNull();
    },
  );

  test("a Compose service that is not a one-off is a database", () => {
    expect(
      classifyContainer({
        name: "shop-db-1",
        imageName: "postgres:16",
        labels: {
          "com.docker.compose.project": "shop",
          "com.docker.compose.service": "db",
          "com.docker.compose.oneoff": "False",
        },
      })?.workloadName,
    ).toBe("shop-db");
  });

  test("labels that are not an object are ignored", () => {
    for (const labels of [null, undefined, ["a"], "x"]) {
      expect(
        classifyContainer({
          name: "shop-db-1",
          imageName: "postgres:16",
          labels: labels as unknown as Record<string, unknown>,
        })?.workloadName,
      ).toBe("shop-db-1");
    }
  });

  /*
   * Regression (live re-verification): every Docker / Podman database was
   * stored with workloadKind "Container", so a two-replica Compose service
   * read "detected from container e2e-docker-spans-compose-postgres" (no
   * container has that name) and "workload: Container/…" in its header.
   */
  test("the workload kind says what grouped the container: a Swarm service, a Compose service, or itself", () => {
    const kindOf: (
      name: string,
      labels?: Record<string, string>,
    ) => ContainerWorkloadKind | undefined = (
      name: string,
      labels?: Record<string, string>,
    ): ContainerWorkloadKind | undefined => {
      return classifyContainer({ name, imageName: "postgres:16", labels })
        ?.workloadKind;
    };

    expect(
      kindOf("shop-db-1", {
        "com.docker.compose.project": "shop",
        "com.docker.compose.service": "db",
      }),
    ).toBe("Compose service");
    expect(
      kindOf("shop_db_1", {
        "io.podman.compose.project": "shop",
        "io.podman.compose.service": "db",
      }),
    ).toBe("Compose service");
    expect(
      kindOf("mystack_db.1.x7y8z9abcdefghijklmnopqrs", {
        "com.docker.swarm.service.name": "mystack_db",
        // A stack's task carries Compose-style labels as well.
        "com.docker.compose.project": "mystack",
        "com.docker.compose.service": "db",
      }),
    ).toBe("Swarm service");
    // A task name alone still names its Swarm service.
    expect(kindOf("mystack_db.1.x7y8z9abcdefghijklmnopqrs")).toBe(
      "Swarm service",
    );
    // Anything else is a container of its own, half a Compose pair included.
    expect(kindOf("postgres")).toBe("Container");
    expect(kindOf("shop-db-1", { "com.docker.compose.project": "shop" })).toBe(
      "Container",
    );
  });

  test("Docker's comma-joined Names keep the first", () => {
    expect(
      classifyContainer({ name: "/web-db,/web-db-alias", imageName: "mongo:7" })
        ?.containerName,
    ).toBe("web-db");
  });

  test("non-database images are null", () => {
    for (const imageName of [
      "acme/api:1",
      "oliver006/redis_exporter",
      "dpage/pgadmin4",
      "bitnami/pgbouncer",
      "busybox",
      "",
      null,
      undefined,
    ]) {
      expect(classifyContainer({ name: "x", imageName })).toBeNull();
    }
  });

  test("a blank name is null; the container id is never needed", () => {
    expect(classifyContainer({ name: "  ", imageName: "redis:7" })).toBeNull();
    expect(classifyContainer({ name: "/", imageName: "redis:7" })).toBeNull();
    expect(
      classifyContainer({
        name: "cache",
        imageName: "redis:7",
        containerId: null,
      })?.system,
    ).toBe("redis");
    expect(classifyContainer(null as unknown as { name: string })).toBeNull();
  });

  test("the classification is exact-match, like for pods", () => {
    const classification: ImageClassification = classifyImage(
      "acme/redis-cache-warmer",
    );
    expect(classification.kind).toBe("unknown");
    expect(
      classifyContainer({
        name: "warmer",
        imageName: "acme/redis-cache-warmer",
      }),
    ).toBeNull();
  });
});

describe("normalizeImageRepository — republished and Red Hat images", () => {
  test.each([
    ["bitnamilegacy/postgresql:16.4.0", "bitnami/postgresql"],
    ["docker.io/bitnamilegacy/redis-cluster:7.2", "bitnami/redis-cluster"],
    ["bitnamisecure/mongodb:7.0", "bitnami/mongodb"],
    ["public.ecr.aws/bitnami/mysql:8.4", "bitnami/mysql"],
    ["docker.io/bitnami/postgresql:16", "bitnami/postgresql"],
    [
      "harbor.corp/dockerhub-proxy/bitnamilegacy/mongodb-sharded:7",
      "dockerhub-proxy/bitnami/mongodb-sharded",
    ],
    ["registry.redhat.io/rhel9/postgresql-16:1-54", "rhel9/postgresql"],
    ["registry.redhat.io/rhel8/mysql-80", "rhel8/mysql"],
    ["registry.redhat.io/rhel9/mariadb-1011", "rhel9/mariadb"],
    ["registry.redhat.io/rhel9/redis-7:latest", "rhel9/redis"],
    ["quay.io/sclorg/postgresql-15-c9s", "sclorg/postgresql"],
    ["quay.io/sclorg/mysql-80-c9s:c9s", "sclorg/mysql"],
    ["centos/postgresql-96-centos7", "centos/postgresql"],
    [
      "registry.access.redhat.com/rhscl/postgresql-10-rhel7",
      "rhscl/postgresql",
    ],
    ["quay.io/fedora/postgresql-15", "fedora/postgresql"],
    [
      "quay.io/mongodb/mongodb-enterprise-database-ubi:2.0.2",
      "mongodb/mongodb-enterprise-database",
    ],
    ["quay.io/mongodb/mongodb-agent-ubi:107.0", "mongodb/mongodb-agent"],
  ])("%s → %s", (image: string, repository: string) => {
    expect(normalizeImageRepository(image)).toBe(repository);
  });

  test("a versioned basename outside the Software Collections namespaces keeps its name", () => {
    expect(normalizeImageRepository("bitnami/postgresql-repmgr:16")).toBe(
      "bitnami/postgresql-repmgr",
    );
    expect(normalizeImageRepository("acme/api-2:1")).toBe("acme/api-2");
    expect(normalizeImageRepository("postgresql-16")).toBe("postgresql-16");
    expect(normalizeImageRepository("rhel9/nodejs-20-minimal")).toBe(
      "rhel9/nodejs-20-minimal",
    );
    // An organisation alias never renames the image itself.
    expect(normalizeImageRepository("acme/bitnamilegacy")).toBe(
      "acme/bitnamilegacy",
    );
  });
});

describe("parseImageVersion — Red Hat Software Collections", () => {
  test.each([
    ["registry.redhat.io/rhel9/postgresql-16:1-54", "16"],
    ["centos/postgresql-96-centos7", "9.6"],
    ["registry.access.redhat.com/rhscl/postgresql-10-rhel7", "10"],
    ["registry.redhat.io/rhel8/mysql-80:1", "8.0"],
    ["quay.io/sclorg/mysql-84-c10s", "8.4"],
    ["registry.redhat.io/rhel9/mariadb-1011", "10.11"],
    ["registry.redhat.io/rhel8/mariadb-105", "10.5"],
    ["registry.redhat.io/rhel9/redis-7:1-12", "7"],
    ["centos/mongodb-36-centos7", "3.6"],
  ])(
    "%s → %s (the name, never the image build in the tag)",
    (image: string, version: string) => {
      expect(parseImageVersion(image)).toBe(version);
    },
  );

  test("republished images keep their tag version", () => {
    expect(parseImageVersion("bitnamilegacy/postgresql:16.4.0-debian-12")).toBe(
      "16.4.0",
    );
  });
});

describe("classifyImage — registries, republishers and sidecars", () => {
  test.each([
    ["bitnamilegacy/postgresql:16", "postgresql"],
    ["bitnamilegacy/mongodb:7.0", "mongodb"],
    ["bitnamilegacy/redis-cluster:7.2", "redis"],
    ["bitnamilegacy/postgresql-repmgr:16", "postgresql"],
    ["bitnamisecure/postgresql:17", "postgresql"],
    ["public.ecr.aws/bitnami/mongodb-sharded:7", "mongodb"],
    ["registry.redhat.io/rhel9/postgresql-16", "postgresql"],
    ["quay.io/sclorg/postgresql-15-c9s", "postgresql"],
    ["registry.redhat.io/rhel8/mysql-80", "mysql"],
    ["registry.redhat.io/rhel9/redis-7", "redis"],
    ["quay.io/mongodb/mongodb-enterprise-database-ubi:2.0", "mongodb"],
  ])("%s is %s", (image: string, system: string) => {
    expect(classifyImage(image)).toEqual({ kind: "database", system });
  });

  test.each([
    ["timberio/vector:0.34.0-debian"],
    ["docker.io/vectordotdev/vector:0.39.0-distroless-libc"],
    ["public.ecr.aws/appmesh/aws-appmesh-envoy:v1.29.5.0-prod"],
    ["tailscale/tailscale:v1.70"],
    ["cloudflare/cloudflared:2024.6.1"],
    ["percona/pmm-client:2.41.0"],
    ["gcr.io/datadoghq/agent:7"],
    ["jaegertracing/jaeger-agent:1.57"],
    ["docker.io/bitnamilegacy/os-shell:12"],
    ["quay.io/signalfx/splunk-otel-collector:0.100.0"],
  ])("%s is an infrastructure sidecar", (image: string) => {
    expect(classifyImage(image)).toEqual({ kind: "infrastructure-sidecar" });
  });

  test.each([
    ["prodrigestivill/postgres-backup-local:16"],
    ["schickling/postgres-backup-s3"],
    ["databack/mysql-backup:1.0"],
    ["tiredofit/db-backup:4"],
  ])("%s is a backup tool", (image: string) => {
    expect(classifyImage(image)).toEqual({
      kind: "excluded",
      reason: "backup",
    });
  });
});

describe("classifyContainerCommand / isNonServerCommand", () => {
  test.each<
    [
      {
        command?: Array<string | null> | undefined;
        args?: Array<string | null> | undefined;
      },
      ContainerCommandRole,
    ]
  >([
    [{}, "server"],
    [{ command: [], args: [] }, "server"],
    [{ args: ["postgres", "-c", "max_connections=200"] }, "server"],
    [{ args: ["-c", "config_file=/etc/pg.conf"] }, "server"],
    [{ command: ["docker-entrypoint.sh"], args: ["postgres"] }, "server"],
    [{ command: ["/usr/bin/psql", "-h", "db"] }, "client"],
    [{ args: ["psql", "-h", "prod-db"] }, "client"],
    [{ command: ["redis-cli"], args: ["-h", "cache"] }, "client"],
    [{ command: ["sh", "-c", "psql -h db -f /x.sql"] }, "client"],
    [
      { command: ["/bin/bash"], args: ["-ec", "exec redis-server /conf"] },
      "server",
    ],
    [
      { command: ["/bin/bash", "-c"], args: ["/opt/bitnami/scripts/start.sh"] },
      "server",
    ],
    [{ command: ["bash"] }, "keep-alive"],
    [{ command: ["sh", "-x"] }, "keep-alive"],
    [{ args: ["sleep", "infinity"] }, "keep-alive"],
    [{ command: ["SH", "-c", "  SLEEP  3600"] }, "keep-alive"],
    [{ command: ["sh", "-c", "exec"] }, "server"],
    // Launchers are looked through to the program they start.
    [{ command: ["tini", "--", "psql"] }, "client"],
    [{ command: ["env", "PGPASSWORD=x", "psql"] }, "client"],
    [{ command: ["tini", "--", "docker-entrypoint.sh", "postgres"] }, "server"],
    [{ command: ["timeout", "30", "psql"] }, "server"],
    [{ command: [null, "x"] }, "server"],
    [{ command: ["redis-sentinel", "/conf"] }, "companion"],
  ])(
    "%j → %s",
    (
      container: {
        command?: Array<string | null> | undefined;
        args?: Array<string | null> | undefined;
      },
      role: ContainerCommandRole,
    ) => {
      expect(classifyContainerCommand(container)).toBe(role);
    },
  );

  test("clients, dump tools and keep-alives are not servers; the default entrypoint is", () => {
    for (const container of [
      { args: ["psql", "-h", "db"] },
      { command: ["pg_dump", "-Fc"] },
      { command: ["mongosh"] },
      { command: ["mysql"], args: ["-h", "db"] },
      { command: ["redis-cli", "monitor"] },
      { command: ["sleep", "infinity"] },
      { command: ["tail", "-f", "/dev/null"] },
      { command: ["bash"] },
      { command: ["sh", "-c", "exec valkey-cli -h cache"] },
    ]) {
      expect(isNonServerCommand(container)).toBe(true);
    }
    for (const container of [
      {},
      { args: ["postgres"] },
      { args: ["--requirepass", "x"] },
      { command: ["docker-entrypoint.sh", "mysqld"] },
      { command: ["/bin/bash"], args: ["-ec", "/opt/bitnami/scripts/run.sh"] },
      { command: ["mongod", "--replSet", "rs0"] },
    ]) {
      expect(isNonServerCommand(container)).toBe(false);
    }
  });
});

describe("classifyKubernetesPod — client runs and one-off pods are not databases", () => {
  test("`kubectl run --rm -it psql --image=postgres -- psql -h prod-db` (no owner, no port)", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "psql",
          containers: [
            {
              name: "psql",
              image: "postgres:16",
              args: ["psql", "-h", "prod-db"],
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  test("init containers are never read: a migration step in a database image is not a database", () => {
    const withInit: KubernetesPodLike = {
      ...pod({
        name: "api-5f6d7-x",
        labels: { "pod-template-hash": "5f6d7" },
        owner: { kind: "ReplicaSet", name: "api-5f6d7" },
        containers: [{ name: "api", image: "acme/api:1" }],
      }),
    };
    (withInit.spec as Record<string, unknown>)["initContainers"] = [
      {
        name: "wait-for-db",
        image: "postgres:16",
        command: ["sh", "-c", "until pg_isready -h db; do sleep 1; done"],
      },
    ];
    expect(classifyKubernetesPod(withInit)).toBeNull();
  });

  test("an owner-less pod running the server but declaring no port is still a one-off", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "tmp-db",
          containers: [{ name: "postgres", image: "postgres:16" }],
        }),
      ),
    ).toBeNull();
  });

  test("a client run is rejected even when it declares a port or has an owner", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "psql",
          containers: [
            {
              name: "psql",
              image: "postgres:16",
              ports: [port(5432)],
              command: ["psql"],
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      classifyKubernetesPod(
        pod({
          name: "redis-monitor-6d9f-x",
          labels: { "pod-template-hash": "6d9f" },
          owner: { kind: "ReplicaSet", name: "redis-monitor-6d9f" },
          containers: [
            {
              name: "cli",
              image: "redis:7",
              command: ["redis-cli", "-h", "cache", "monitor"],
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  test.each([
    // The end-to-end kind cluster's pg-client-envprefix and pg-client-loop.
    [
      [
        "sh",
        "-c",
        "PGPASSWORD=e2e-pg-pass psql -h postgres -U postgres -c 'select pg_sleep(100000)'",
      ],
    ],
    [
      [
        "sh",
        "-c",
        "while true; do psql -h postgres -U postgres -c 'select 1' >/dev/null 2>&1; sleep 15; done",
      ],
    ],
    // The same client behind the launchers images and charts use.
    [["env", "PGPASSWORD=e2e-pg-pass", "psql", "-h", "postgres"]],
    [["/usr/bin/env", "-i", "PGHOST=postgres", "psql", "-c", "select 1"]],
    [["nohup", "psql", "-h", "postgres"]],
    [["/sbin/tini", "--", "psql", "-h", "postgres"]],
    [["dumb-init", "--", "sh", "-c", "exec env PGPASSWORD=x psql -h db"]],
    [["docker-entrypoint.sh", "sleep", "infinity"]],
  ])(
    "regression: a client Deployment of a database image (%j) is not a database",
    (command: Array<string>) => {
      expect(
        classifyKubernetesPod(
          pod({
            name: "pg-client-loop-58fdcb4994-4v59m",
            namespace: "data",
            labels: {
              app: "pg-client-loop",
              "pod-template-hash": "58fdcb4994",
            },
            owner: { kind: "ReplicaSet", name: "pg-client-loop-58fdcb4994" },
            containers: [{ name: "client", image: "postgres:16", command }],
          }),
        ),
      ).toBeNull();
    },
  );

  test("a server behind a launcher is still a server", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "orders-db-0",
          owner: { kind: "StatefulSet", name: "orders-db" },
          containers: [
            {
              name: "postgres",
              image: "postgres:16",
              ports: [port(5432)],
              command: ["/sbin/tini", "--", "docker-entrypoint.sh"],
              args: ["-c", "max_connections=200"],
            },
          ],
        }),
      )?.system,
    ).toBe("postgresql");
  });

  test.each([
    [["sleep", "infinity"]],
    [["tail", "-f", "/dev/null"]],
    [["bash"]],
    [["sh", "-c", "sleep 3600"]],
  ])(
    "a debug pod in a database image (%j) is not a database",
    (command: Array<string>) => {
      expect(
        classifyKubernetesPod(
          pod({
            name: "debug-0",
            owner: { kind: "StatefulSet", name: "debug" },
            containers: [
              {
                name: "pg",
                image: "postgres:16",
                ports: [port(5432)],
                command,
              },
            ],
          }),
        ),
      ).toBeNull();
    },
  );

  test("a server started through a shell script is still a server", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "cache-0",
          owner: { kind: "StatefulSet", name: "cache" },
          containers: [
            {
              name: "redis",
              image: "bitnami/redis:7.2",
              command: ["/bin/bash"],
              args: [
                "-ec",
                "exec /opt/bitnami/scripts/start-scripts/start-master.sh",
              ],
            },
          ],
        }),
      )?.system,
    ).toBe("redis");
  });

  test("the server container is picked over a client sidecar in the same image", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "pg-0",
          owner: { kind: "StatefulSet", name: "pg" },
          containers: [
            {
              name: "wait-and-migrate",
              image: "postgres:15",
              command: ["sh", "-c", "psql -f /migrations.sql"],
            },
            { name: "postgres", image: "postgres:16.3", ports: [port(5432)] },
          ],
        }),
      ),
    ).toMatchObject({ containerName: "postgres", version: "16.3" });
  });

  test("a chart's test hook pod (chart labels, a client command) is not a member", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "cache-redis-test-connection",
          labels: {
            "app.kubernetes.io/name": "redis",
            "app.kubernetes.io/instance": "cache",
          },
          containers: [
            {
              name: "test",
              image: "bitnami/redis:7.2",
              command: ["redis-cli", "-h", "cache-redis-master", "ping"],
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  test("a labelled member with a client sidecar keeps the server container", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "pg-main-1",
          labels: { "cnpg.io/cluster": "pg-main" },
          owner: { kind: "Cluster", name: "pg-main" },
          containers: [
            { name: "probe", image: "postgres:16", command: ["pg_isready"] },
            {
              name: "postgres",
              image: "ghcr.io/cloudnative-pg/postgresql:16.3",
            },
          ],
        }),
      ),
    ).toMatchObject({ containerName: "postgres", version: "16.3" });
  });
});

describe("classifyKubernetesPod — servers started through shells and scripts are databases", () => {
  const MONGOD_SCRIPT: string =
    '\nif [ -e "/hooks/version-upgrade" ]; then\n\t#run post-start hook to handle version changes (if exists)\n    /hooks/version-upgrade\nfi\n\n# wait for config and keyfile to be created by the agent\n while ! [ -f /data/automation-mongod.conf -a -f /var/lib/mongodb-mms-automation/authentication/keyfile ]; do sleep 3 ; done ; sleep 2 ;\n\n# start mongod with this configuration\nexec mongod -f /data/automation-mongod.conf;\n\n';

  function mongoCommunityPod(command: Array<string | null>): KubernetesPodLike {
    return pod({
      name: "orders-mongo-0",
      labels: { app: "orders-mongo-svc" },
      owner: { kind: "StatefulSet", name: "orders-mongo" },
      containers: [
        {
          name: "mongod",
          image: "quay.io/mongodb/mongodb-community-server:7.0.12-ubi8",
          command,
        },
        {
          name: "mongodb-agent",
          image: "quay.io/mongodb/mongodb-agent-ubi:107.0.12.8669-1",
          command: ["/bin/bash", "-c", "agent/mongodb-agent -noDaemonize"],
        },
      ],
    });
  }

  test("regression: a MongoDB Community Operator member (newline-led sh -c script) is MongoDB", () => {
    expect(
      classifyKubernetesPod(
        mongoCommunityPod(["/bin/sh", "-c", MONGOD_SCRIPT]),
      ),
    ).toMatchObject({
      system: "mongodb",
      workloadKind: "StatefulSet",
      workloadName: "orders-mongo",
      containerName: "mongod",
      version: "7.0.12",
    });
    // A script the projection could not read is still a possible server.
    expect(
      classifyKubernetesPod(mongoCommunityPod(["/bin/sh", "-c", null])),
    ).toMatchObject({ system: "mongodb", containerName: "mongod" });
  });

  test("regression: CockroachDB's StatefulSet (bash -ecx 'exec cockroach start') is CockroachDB, plain or chart-labelled", () => {
    for (const labels of [
      { app: "cockroachdb" },
      {
        "app.kubernetes.io/name": "cockroachdb",
        "app.kubernetes.io/instance": "crdb",
      },
    ]) {
      expect(
        classifyKubernetesPod(
          pod({
            name: "cockroachdb-0",
            labels,
            owner: { kind: "StatefulSet", name: "cockroachdb" },
            containers: [
              {
                name: "cockroachdb",
                image: "cockroachdb/cockroach:v24.1.0",
                ports: [port(26257), port(8080)],
                command: [
                  "/bin/bash",
                  "-ecx",
                  "exec /cockroach/cockroach start --logtostderr --insecure --join cockroachdb-0.cockroachdb",
                ],
              },
            ],
          }),
        ),
      ).toMatchObject({ system: "cockroachdb", containerName: "cockroachdb" });
    }
  });

  test.each([
    [["/bin/bash", "/scripts/start-redis.sh"]],
    [["sh", "/docker-entrypoint-initdb.d/run.sh"]],
    [["bash", "-cex", "exec redis-server /conf/redis.conf"]],
    [["bash", "-c", "#!/bin/bash\nset -euo pipefail\nexec redis-server"]],
    [["sh", "-c", "sleep 5 && exec redis-server /conf/redis.conf"]],
    [
      [
        "sh",
        "-c",
        "cat /tmpl > /etc/redis.conf; exec redis-server /etc/redis.conf",
      ],
    ],
    [
      [
        "sh",
        "-c",
        "until nslookup redis-0.redis; do sleep 2; done\nexec redis-server",
      ],
    ],
    [["sh", "-c", "\texec redis-server"]],
  ])(
    "regression: a StatefulSet started with %j is Redis",
    (command: Array<string>) => {
      expect(
        classifyKubernetesPod(
          pod({
            name: "cache-0",
            owner: { kind: "StatefulSet", name: "cache" },
            containers: [
              {
                name: "redis",
                image: "redis:7.2",
                ports: [port(6379)],
                command,
              },
            ],
          }),
        ),
      ).toMatchObject({ system: "redis", containerName: "redis" });
    },
  );

  test("a Sentinel in the database image is not the database: the server container is picked", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "cache-ha-server-0",
          owner: { kind: "StatefulSet", name: "cache-ha-server" },
          containers: [
            {
              name: "sentinel",
              image: "redis:7.2",
              ports: [port(26379)],
              command: ["redis-sentinel", "/data/conf/sentinel.conf"],
            },
            {
              name: "redis",
              image: "redis:7.2",
              ports: [port(6379)],
              command: ["redis-server", "/data/conf/redis.conf"],
            },
          ],
        }),
      ),
    ).toMatchObject({ system: "redis", containerName: "redis", ports: [6379] });
  });

  test("a Sentinel-only pod in the database image is not a database", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "rfs-cache-5d8f-x",
          labels: { "pod-template-hash": "5d8f" },
          owner: { kind: "ReplicaSet", name: "rfs-cache-5d8f" },
          containers: [
            {
              name: "sentinel",
              image: "redis:7.2",
              ports: [port(26379)],
              command: ["redis-server", "/redis/sentinel.conf", "--sentinel"],
            },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("classifyKubernetesPod — a labelled pod whose database container does not run", () => {
  function labelledPod(sidecar: ContainerFixture): KubernetesPodLike {
    return pod({
      name: "orders-postgresql-0",
      labels: {
        "app.kubernetes.io/name": "postgresql",
        "app.kubernetes.io/instance": "orders",
      },
      owner: { kind: "StatefulSet", name: "orders-postgresql" },
      containers: [
        {
          name: "postgresql",
          image: "docker.io/bitnami/postgresql:16.2.0",
          ports: [port(5432)],
          command: ["sleep"],
          args: ["infinity"],
        },
        sidecar,
      ],
    });
  }

  test.each([
    [
      {
        name: "metrics",
        image: "docker.io/bitnami/postgres-exporter:0.15.0-debian-12-r14",
        ports: [port(9187)],
      },
    ],
    [
      {
        name: "pgbouncer",
        image: "docker.io/bitnami/pgbouncer:1.22.0",
        ports: [port(6432)],
      },
    ],
    [{ name: "istio-proxy", image: "docker.io/istio/proxyv2:1.22.0" }],
    [
      {
        name: "sentinel",
        image: "docker.io/bitnami/redis-sentinel:7.2",
        ports: [port(26379)],
      },
    ],
  ])(
    "regression: only %j still runs → not a member (never the sidecar's version and ports)",
    (sidecar: ContainerFixture) => {
      expect(classifyKubernetesPod(labelledPod(sidecar))).toBeNull();
    },
  );

  test("an unrecognised running container is still a possible database", () => {
    expect(
      classifyKubernetesPod(
        labelledPod({ name: "custom", image: "acme/pg-custom:3" }),
      ),
    ).toMatchObject({ system: "postgresql", containerName: "custom" });
  });
});

describe("classifyKubernetesPod — an uncatalogued neighbour of a database StatefulSet", () => {
  function statefulSetPod(data: {
    owner?: { kind: string; name: string } | null;
    databasePorts?: Array<number>;
    neighbours: Array<ContainerFixture>;
  }): KubernetesPodLike {
    return pod({
      name: "pg-0",
      owner:
        data.owner === undefined
          ? { kind: "StatefulSet", name: "pg" }
          : data.owner,
      containers: [
        {
          name: "postgres",
          image: "postgres:16",
          ports: (data.databasePorts ?? [5432]).map(port),
        },
        ...data.neighbours,
      ],
    });
  }

  test("one unknown sidecar is tolerated when the database declares its default port", () => {
    expect(
      classifyKubernetesPod(
        statefulSetPod({
          neighbours: [{ name: "shipper", image: "acme/log-shipper:3" }],
        }),
      ),
    ).toMatchObject({ system: "postgresql", workloadName: "pg" });
  });

  test("…but not without the default port, in a Deployment, or with two unknown containers", () => {
    expect(
      classifyKubernetesPod(
        statefulSetPod({
          databasePorts: [15432],
          neighbours: [{ name: "shipper", image: "acme/log-shipper:3" }],
        }),
      ),
    ).toBeNull();
    expect(
      classifyKubernetesPod(
        statefulSetPod({
          owner: { kind: "Deployment", name: "pg" },
          neighbours: [{ name: "api", image: "acme/api:1" }],
        }),
      ),
    ).toBeNull();
    expect(
      classifyKubernetesPod(
        statefulSetPod({
          neighbours: [
            { name: "api", image: "acme/api:1" },
            { name: "worker", image: "acme/worker:1" },
          ],
        }),
      ),
    ).toBeNull();
  });

  test("catalogued sidecars need no exception at all", () => {
    expect(
      classifyKubernetesPod(
        statefulSetPod({
          databasePorts: [],
          neighbours: [
            { name: "vector", image: "vectordotdev/vector:0.39" },
            { name: "backup", image: "prodrigestivill/postgres-backup-local" },
            {
              name: "mesh",
              image: "public.ecr.aws/appmesh/aws-appmesh-envoy:v1",
            },
            { name: "tailscale", image: "tailscale/tailscale:v1.70" },
          ],
        }),
      )?.system,
    ).toBe("postgresql");
  });
});

describe("classifyKubernetesPod — the Service names clients use", () => {
  test("a chart with fullnameOverride: the owner StatefulSet and its headless Service are aliases", () => {
    const candidate: KubernetesDatabaseCandidate | null = classifyKubernetesPod(
      pod({
        name: "postgres-0",
        labels: {
          "app.kubernetes.io/name": "postgresql",
          "app.kubernetes.io/instance": "rel",
          "app.kubernetes.io/component": "primary",
        },
        owner: { kind: "StatefulSet", name: "postgres" },
        containers: [
          {
            name: "postgresql",
            image: "bitnami/postgresql:16",
            ports: [port(5432)],
          },
        ],
      }),
      { statefulSetServiceNames: { postgres: "postgres-hl" } },
    );
    expect(candidate?.workloadName).toBe("rel-postgresql");
    expect(candidate?.serviceNames).toEqual(
      expect.arrayContaining(["postgres", "postgres-hl"]),
    );
  });

  test("a chart-labelled Deployment keeps its Deployment as the owner workload", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "cache-memcached-7d9f8-x2x4z",
          labels: {
            "app.kubernetes.io/name": "memcached",
            "app.kubernetes.io/instance": "cache",
            "pod-template-hash": "7d9f8",
          },
          owner: { kind: "ReplicaSet", name: "cache-memcached-7d9f8" },
          containers: [{ name: "memcached", image: "bitnami/memcached:1.6" }],
        }),
      ),
    ).toMatchObject({
      workloadKind: "Cluster",
      workloadName: "cache-memcached",
      ownerKind: "Deployment",
      ownerName: "cache-memcached",
    });
  });

  test("a ReplicaSet without its hash is not a Service name", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "x-abc-1",
          labels: {
            "app.kubernetes.io/name": "redis",
            "app.kubernetes.io/instance": "x",
          },
          owner: { kind: "ReplicaSet", name: "x-abc" },
          containers: [{ name: "redis", image: "redis:7" }],
        }),
      )?.serviceNames,
    ).not.toContain("x-abc");
  });

  test("Percona Server for MySQL: the primary, router and HAProxy Services", () => {
    expect(
      classifyKubernetesPod(
        pod({
          name: "ps1-mysql-0",
          labels: {
            "app.kubernetes.io/managed-by": "percona-server-mysql-operator",
            "app.kubernetes.io/name": "percona-server",
            "app.kubernetes.io/instance": "ps1",
            "app.kubernetes.io/component": "mysql",
          },
          owner: { kind: "StatefulSet", name: "ps1-mysql" },
          containers: [{ name: "mysql", image: "percona/percona-server:8.0" }],
        }),
      )?.serviceNames,
    ).toEqual([
      "ps1",
      "ps1-mysql",
      "ps1-mysql-primary",
      "ps1-haproxy",
      "ps1-router",
    ]);
  });
});

describe("CloudNativePG poolers", () => {
  const poolerPod: KubernetesPodLike = pod({
    name: "pg-main-pooler-rw-6d9f-x",
    namespace: "db",
    labels: {
      "cnpg.io/cluster": "pg-main",
      "cnpg.io/poolerName": "pg-main-pooler-rw",
    },
    owner: { kind: "ReplicaSet", name: "pg-main-pooler-rw-6d9f" },
    containers: [
      { name: "pgbouncer", image: "ghcr.io/cloudnative-pg/pgbouncer:1.22" },
    ],
  });

  test("a pooler pod is not a member but names the Service it backs", () => {
    expect(classifyKubernetesPod(poolerPod)).toBeNull();
    expect(classifyKubernetesPoolerPod(poolerPod)).toEqual({
      system: "postgresql",
      namespace: "db",
      clusterName: "pg-main",
      serviceName: "pg-main-pooler-rw",
    });
  });

  test("only CloudNativePG pooler pods, and never finished ones, name a pooler", () => {
    expect(
      classifyKubernetesPoolerPod({ ...poolerPod, phase: "Succeeded" }),
    ).toBeNull();
    expect(
      classifyKubernetesPoolerPod(
        pod({
          name: "pg-main-1",
          labels: { "cnpg.io/cluster": "pg-main" },
          containers: [{ name: "postgres", image: "postgres:16" }],
        }),
      ),
    ).toBeNull();
    expect(
      classifyKubernetesPoolerPod(null as unknown as KubernetesPodLike),
    ).toBeNull();
  });

  test("attachPoolerServices adds the pooler Service to its cluster only", () => {
    const member: KubernetesDatabaseCandidate = classifyKubernetesPod(
      pod({
        name: "pg-main-1",
        namespace: "db",
        labels: { "cnpg.io/cluster": "pg-main" },
        owner: { kind: "Cluster", name: "pg-main" },
        containers: [
          { name: "postgres", image: "ghcr.io/cloudnative-pg/postgresql:16" },
        ],
      }),
    )!;
    const other: KubernetesDatabaseCandidate = {
      ...member,
      namespace: "elsewhere",
    };
    const pooler: KubernetesPoolerService =
      classifyKubernetesPoolerPod(poolerPod)!;

    const groups: Array<KubernetesDatabaseGroup> = attachPoolerServices(
      groupKubernetesDatabaseCandidates([member, other]),
      [pooler, { ...pooler, clusterName: "another" }],
    );

    expect(
      groups.find((group: KubernetesDatabaseGroup): boolean => {
        return group.namespace === "db";
      })?.serviceNames,
    ).toEqual([
      "pg-main",
      "pg-main-rw",
      "pg-main-ro",
      "pg-main-r",
      "pg-main-pooler-rw",
    ]);
    expect(
      groups.find((group: KubernetesDatabaseGroup): boolean => {
        return group.namespace === "elsewhere";
      })?.serviceNames,
    ).not.toContain("pg-main-pooler-rw");
    expect(attachPoolerServices(groups, [])).toEqual(groups);
    expect(
      attachPoolerServices(
        undefined as unknown as Array<KubernetesDatabaseGroup>,
        [],
      ),
    ).toEqual([]);
  });
});

describe("groupKubernetesDatabaseCandidates — owner workloads", () => {
  test("the Deployments / StatefulSets behind a cluster's members are unioned and sorted", () => {
    const labels: Record<string, string> = {
      "app.kubernetes.io/name": "redis",
      "app.kubernetes.io/instance": "cache",
    };
    const members: Array<KubernetesDatabaseCandidate> = [
      classifyKubernetesPod(
        pod({
          name: "cache-redis-replicas-0",
          labels,
          owner: { kind: "StatefulSet", name: "cache-redis-replicas" },
          containers: [{ name: "redis", image: "redis:7" }],
        }),
      )!,
      classifyKubernetesPod(
        pod({
          name: "cache-redis-master-0",
          labels,
          owner: { kind: "StatefulSet", name: "cache-redis-master" },
          containers: [{ name: "redis", image: "redis:7" }],
        }),
      )!,
      classifyKubernetesPod(
        pod({
          name: "cache-redis-master-1",
          labels,
          owner: { kind: "StatefulSet", name: "cache-redis-master" },
          containers: [{ name: "redis", image: "redis:7" }],
        }),
      )!,
    ];
    expect(
      groupKubernetesDatabaseCandidates(members)[0]!.ownerWorkloads,
    ).toEqual([
      { kind: "StatefulSet", name: "cache-redis-master" },
      { kind: "StatefulSet", name: "cache-redis-replicas" },
    ]);
  });

  test("owner-less members add no owner workload", () => {
    const member: KubernetesDatabaseCandidate = classifyKubernetesPod(
      pod({
        name: "scratch",
        containers: [{ name: "redis", image: "redis:7", ports: [port(6379)] }],
      }),
    )!;
    expect(
      groupKubernetesDatabaseCandidates([member])[0]!.ownerWorkloads,
    ).toEqual([]);
  });
});

describe("hasDatabaseWorkloadLabels — the store-side pre-filter's twin", () => {
  /*
   * Every label set an operator / chart rule matches (or skips) must pass
   * the pre-filter, or the job's SQL would never hand that pod to the
   * classifier.
   */
  const RULE_TRIGGERS: Array<Record<string, string>> = [
    { "cnpg.io/cluster": "pg-main" },
    { "cnpg.io/cluster": "pg-main", "cnpg.io/poolerName": "rw" },
    { application: "spilo", "cluster-name": "acid-main" },
    { "postgres-operator.crunchydata.com/cluster": "hippo" },
    {
      "app.kubernetes.io/managed-by": "percona-xtradb-cluster-operator",
      "app.kubernetes.io/name": "percona-xtradb-cluster",
      "app.kubernetes.io/instance": "cluster1",
    },
    {
      "app.kubernetes.io/managed-by": "percona-server-mongodb-operator",
      "app.kubernetes.io/name": "percona-server-mongodb",
      "app.kubernetes.io/instance": "x",
    },
    {
      "app.kubernetes.io/managed-by": "percona-server-mysql-operator",
      "app.kubernetes.io/name": "percona-server",
      "app.kubernetes.io/instance": "x",
    },
    { "mysql.oracle.com/cluster": "mycluster" },
    {
      "common.k8s.elastic.co/type": "elasticsearch",
      "elasticsearch.k8s.elastic.co/cluster-name": "quickstart",
    },
    { "clickhouse.altinity.com/chi": "demo" },
    { "cassandra.datastax.com/cluster": "demo" },
    {
      "planetscale.com/cluster": "example",
      "planetscale.com/component": "vtgate",
    },
    {
      "planetscale.com/cluster": "example",
      "planetscale.com/component": "vttablet",
    },
    { "app.kubernetes.io/name": "postgresql" },
    { "app.kubernetes.io/name": " Redis " },
    { "app.kubernetes.io/name": "mongodb-sharded" },
  ];

  test.each(RULE_TRIGGERS)("%j passes", (labels: Record<string, string>) => {
    expect(hasDatabaseWorkloadLabels(labels)).toBe(true);
  });

  test("every chart name any catalog engine declares passes", () => {
    for (const name of DATABASE_WORKLOAD_NAME_LABEL_VALUES) {
      expect(name).toBe(name.toLowerCase());
      expect(
        hasDatabaseWorkloadLabels({ "app.kubernetes.io/name": name }),
      ).toBe(true);
    }
    for (const key of DATABASE_OPERATOR_LABEL_KEYS) {
      expect(hasDatabaseWorkloadLabels({ [key]: "" })).toBe(true);
    }
  });

  test("anything a rule would not look at is filtered out", () => {
    for (const labels of [
      {},
      { app: "postgres" },
      { "app.kubernetes.io/name": "api" },
      { "app.kubernetes.io/instance": "postgresql" },
      null,
      ["cnpg.io/cluster"],
      "cnpg.io/cluster",
    ]) {
      expect(hasDatabaseWorkloadLabels(labels)).toBe(false);
    }
  });

  test("a pod the rules classify by labels alone always passes the pre-filter", () => {
    for (const labels of RULE_TRIGGERS) {
      const candidate: KubernetesDatabaseCandidate | null =
        classifyKubernetesPod(
          pod({
            name: "x-0",
            labels,
            owner: { kind: "StatefulSet", name: "x" },
            containers: [{ name: "db", image: "registry.corp/custom:1" }],
          }),
        );
      if (candidate && candidate.evidence[0]!.startsWith("label:")) {
        expect(hasDatabaseWorkloadLabels(labels)).toBe(true);
      }
    }
  });
});

/*
 * The dashboard's workload badge (DatabaseWorkloadLookup) runs this
 * classifier on a StatefulSet or Deployment page, and on a pod listed
 * without its spec, from the object's LABELS alone: `spec.containers` is
 * empty, and a StatefulSet / Deployment stands in as the owner of a pod of
 * its own name. That is how those pages ask for the name discovery gave the
 * database (Bitnami's `shop-redis-master` for `shop-redis`, Percona's
 * `cluster1-pxc` for `cluster1`).
 *
 * So an empty container list must mean "not known", never "none that could
 * be the server": the two container checks inside the label rules only run
 * when there are containers, while the label-only rejections (a chart's
 * non-member component, an operator's pooler / backup pods) still apply.
 */
describe("classifyKubernetesPod — label rules for an object whose containers are not known", () => {
  function labelsOnly(data: {
    name: string;
    labels: Record<string, unknown>;
    owner: { kind: string; name: string };
  }): KubernetesPodLike {
    return {
      namespaceKey: "data",
      name: data.name,
      phase: null,
      labels: data.labels,
      ownerReferences: { items: [data.owner] },
      spec: { containers: [] },
    };
  }

  type MemberCase = {
    labels: Record<string, unknown>;
    owner: { kind: string; name: string };
    // The server container a real member pod runs.
    image: string;
    system: string;
    workloadName: string;
  };

  const MEMBERS: Array<[string, MemberCase]> = [
    [
      "a CloudNativePG instance",
      {
        labels: {
          "cnpg.io/cluster": "pg-main",
          "cnpg.io/podRole": "instance",
          "cnpg.io/instanceRole": "primary",
        },
        owner: { kind: "Cluster", name: "pg-main" },
        image: "ghcr.io/cloudnative-pg/postgresql:16.2",
        system: "postgresql",
        workloadName: "pg-main",
      },
    ],
    [
      "a Zalando (Spilo) StatefulSet",
      {
        labels: {
          application: "spilo",
          "cluster-name": "acid-main",
          "spilo-role": "master",
        },
        owner: { kind: "StatefulSet", name: "acid-main" },
        image: "ghcr.io/zalando/spilo-16:3.2-p2",
        system: "postgresql",
        workloadName: "acid-main",
      },
    ],
    [
      "a Percona XtraDB StatefulSet",
      {
        labels: {
          "app.kubernetes.io/managed-by": "percona-xtradb-cluster-operator",
          "app.kubernetes.io/name": "percona-xtradb-cluster",
          "app.kubernetes.io/instance": "cluster1",
          "app.kubernetes.io/component": "pxc",
        },
        owner: { kind: "StatefulSet", name: "cluster1-pxc" },
        image: "percona/percona-xtradb-cluster:8.0.36",
        system: "mysql",
        workloadName: "cluster1",
      },
    ],
    [
      "a Bitnami Redis replication StatefulSet",
      {
        labels: {
          "app.kubernetes.io/name": "redis",
          "app.kubernetes.io/instance": "shop",
          "app.kubernetes.io/component": "master",
          "app.kubernetes.io/managed-by": "Helm",
        },
        owner: { kind: "StatefulSet", name: "shop-redis-master" },
        image: "bitnami/redis:7.2.4",
        system: "redis",
        workloadName: "shop-redis",
      },
    ],
  ];

  test.each(MEMBERS)(
    "%s is named from its labels exactly as its member pods are",
    (_label: string, member: MemberCase) => {
      const fromLabels: KubernetesDatabaseCandidate | null =
        classifyKubernetesPod(
          labelsOnly({
            name: member.owner.name,
            labels: member.labels,
            owner: member.owner,
          }),
        );

      const fromMemberPod: KubernetesDatabaseCandidate | null =
        classifyKubernetesPod(
          pod({
            name: `${member.owner.name}-0`,
            labels: member.labels,
            owner: member.owner,
            containers: [{ name: "server", image: member.image }],
          }),
        );

      expect(fromLabels).not.toBeNull();
      expect(fromLabels).toMatchObject({
        system: member.system,
        workloadName: member.workloadName,
        // No container stands in for the server's image, version or ports.
        containerName: "",
        image: null,
        version: null,
        ports: [],
      });

      // Discovery's name for the database, whichever of the two asks.
      expect(fromMemberPod).not.toBeNull();
      expect({
        system: fromLabels!.system,
        workloadKind: fromLabels!.workloadKind,
        workloadName: fromLabels!.workloadName,
        operator: fromLabels!.operator,
        role: fromLabels!.role,
      }).toEqual({
        system: fromMemberPod!.system,
        workloadKind: fromMemberPod!.workloadKind,
        workloadName: fromMemberPod!.workloadName,
        operator: fromMemberPod!.operator,
        role: fromMemberPod!.role,
      });
    },
  );

  test("an object with no spec at all is treated like an empty container list", () => {
    const withoutSpec: KubernetesPodLike = {
      namespaceKey: "data",
      name: "pg-main-1",
      phase: null,
      labels: { "cnpg.io/cluster": "pg-main" },
      ownerReferences: { items: [{ kind: "Cluster", name: "pg-main" }] },
    };

    expect(classifyKubernetesPod(withoutSpec)?.workloadName).toBe("pg-main");
  });

  test.each([
    [
      "a chart's pooler component (Bitnami postgresql-ha's pgpool)",
      {
        "app.kubernetes.io/name": "postgresql-ha",
        "app.kubernetes.io/instance": "shop",
        "app.kubernetes.io/component": "pgpool",
      },
      { kind: "Deployment", name: "shop-postgresql-ha-pgpool" },
    ],
    [
      "a chart's metrics component",
      {
        "app.kubernetes.io/name": "redis",
        "app.kubernetes.io/instance": "shop",
        "app.kubernetes.io/component": "metrics",
      },
      { kind: "Deployment", name: "shop-redis-metrics" },
    ],
    [
      "a CloudNativePG pooler",
      {
        "cnpg.io/cluster": "pg-main",
        "cnpg.io/poolerName": "pg-main-pooler-rw",
      },
      { kind: "Deployment", name: "pg-main-pooler-rw" },
    ],
    [
      "a Crunchy pgbouncer Deployment",
      {
        "postgres-operator.crunchydata.com/cluster": "hippo",
        "postgres-operator.crunchydata.com/role": "pgbouncer",
      },
      { kind: "Deployment", name: "hippo-pgbouncer" },
    ],
    [
      "a Crunchy backup repo host",
      {
        "postgres-operator.crunchydata.com/cluster": "hippo",
        "postgres-operator.crunchydata.com/pgbackrest-dedicated": "",
      },
      { kind: "StatefulSet", name: "hippo-repo-host" },
    ],
    [
      "a Zalando connection pooler",
      {
        application: "db-connection-pooler",
        "cluster-name": "acid-main",
      },
      { kind: "Deployment", name: "acid-main-pooler" },
    ],
  ])(
    "%s is still not a member without its containers",
    (
      _label: string,
      labels: Record<string, unknown>,
      owner: { kind: string; name: string },
    ) => {
      expect(
        classifyKubernetesPod(
          labelsOnly({ name: owner.name, labels: labels, owner: owner }),
        ),
      ).toBeNull();
    },
  );

  test("known containers still decide: the same labels on a pod running only an exporter are not a member", () => {
    const labels: Record<string, unknown> = {
      "cnpg.io/cluster": "pg-main",
      "cnpg.io/podRole": "instance",
    };
    const owner: { kind: string; name: string } = {
      kind: "Cluster",
      name: "pg-main",
    };

    expect(
      classifyKubernetesPod(
        labelsOnly({ name: "pg-main-1", labels: labels, owner: owner }),
      )?.workloadName,
    ).toBe("pg-main");

    expect(
      classifyKubernetesPod(
        pod({
          name: "pg-main-1",
          labels: labels,
          owner: owner,
          containers: [
            {
              name: "exporter",
              image: "quay.io/prometheuscommunity/postgres-exporter:v0.15.0",
            },
          ],
        }),
      ),
    ).toBeNull();
  });
});
