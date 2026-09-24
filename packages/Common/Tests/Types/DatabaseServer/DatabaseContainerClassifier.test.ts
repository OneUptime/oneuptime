import {
  classifyContainer,
  classifyImage,
  classifyKubernetesPod,
  ContainerDatabaseClassification,
  groupKubernetesDatabaseCandidates,
  ImageClassification,
  KubernetesDatabaseCandidate,
  KubernetesDatabaseGroup,
  KubernetesPodLike,
  normalizeImageRepository,
  parseImageVersion,
} from "../../../Types/DatabaseServer/DatabaseContainerClassifier";
import { describe, expect, test } from "@jest/globals";

type ContainerFixture = {
  name: string;
  image: string;
  ports?: Array<{ containerPort?: number }>;
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
    ["mariadb:11", "mysql"],
    ["bitnami/mariadb-galera:11", "mysql"],
    ["percona/percona-xtradb-cluster:8.0", "mysql"],
    ["redis:7", "redis"],
    ["redis/redis-stack-server:7.2.0-v10", "redis"],
    ["valkey/valkey:8", "redis"],
    ["docker.dragonflydb.io/dragonflydb/dragonfly:v1.16", "redis"],
    ["eqalpha/keydb", "redis"],
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
    ["scylladb/scylla:5.4", "cassandra"],
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
      serviceNames: ["acid-main", "acid-main-repl"],
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
      serviceNames: ["hippo", "hippo-primary", "hippo-replicas"],
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
      serviceNames: ["cluster1", "cluster1-pxc"],
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
      serviceNames: ["my-cluster-name", "my-cluster-name-rs0"],
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
      serviceNames: ["quickstart", "quickstart-es-http"],
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
      serviceNames: ["demo", "clickhouse-demo"],
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
      serviceNames: ["demo", "demo-dc1-service"],
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
      podName: "pg-0",
      containerName: "postgres",
      image: "postgres:16.2-alpine",
      version: "16.2",
      ports: [5432],
      operator: null,
      role: null,
      serviceNames: ["pg"],
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
    expect(
      classifyKubernetesPod(
        pod({
          name: "scratch-db",
          containers: [{ name: "mysql", image: "mysql:8" }],
        }),
      ),
    ).toMatchObject({
      workloadKind: "Pod",
      workloadName: "scratch-db",
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
        spec: {
          containers: [
            null,
            { name: 5, image: "postgres:16", ports: "5432" },
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

describe("classifyContainer (Docker / Podman)", () => {
  test("a compose replica suffix is stripped from the workload name", () => {
    expect(
      classifyContainer({ name: "/shop-postgres-1", imageName: "postgres:16" }),
    ).toEqual({
      system: "postgresql",
      workloadName: "shop-postgres",
      containerName: "shop-postgres-1",
      version: "16",
    });
    expect(
      classifyContainer({ name: "shop_redis_2", imageName: "redis:7.2.4" }),
    ).toEqual({
      system: "redis",
      workloadName: "shop_redis",
      containerName: "shop_redis_2",
      version: "7.2.4",
    });
  });

  test("a plain name is its own workload", () => {
    expect(
      classifyContainer({ name: "postgres", imageName: "postgres:16" })
        ?.workloadName,
    ).toBe("postgres");
  });

  test("compose labels never change the identity", () => {
    const withoutLabels: ContainerDatabaseClassification | null =
      classifyContainer({ name: "shop-db-1", imageName: "mysql:8" });
    const withLabels: ContainerDatabaseClassification | null =
      classifyContainer({
        name: "shop-db-1",
        imageName: "mysql:8",
        labels: {
          "com.docker.compose.project": "shop",
          "com.docker.compose.service": "database",
        },
      });
    expect(withLabels).toEqual(withoutLabels);
    expect(withLabels?.workloadName).toBe("shop-db");
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
