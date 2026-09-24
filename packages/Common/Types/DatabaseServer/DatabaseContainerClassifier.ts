import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
  getDatabaseSystemDescriptor,
} from "./DatabaseSystem";

/*
 * "Is this pod / container a database, and which one?" — the pure classifier
 * behind Kubernetes, Docker and Podman database auto-detection.
 *
 * Evidence, strongest first:
 *   1. operator / Helm chart LABELS on a Kubernetes pod (CloudNativePG,
 *      Zalando, Crunchy, Percona, the Oracle MySQL operator, ECK, Altinity,
 *      cass-operator, Bitnami-style `app.kubernetes.io/name`) — they also
 *      name the logical cluster, its role and its Services;
 *   2. the container IMAGE, matched on the normalized repository or its
 *      basename EXACTLY (never a substring: `acme/redis-cache-warmer` is not
 *      Redis).
 *
 * What it refuses, on purpose: exporters, operators, admin UIs, poolers and
 * proxies, backup tools (they run DB images or talk to one but are not one);
 * batch pods (Job / CronJob owners — `pg_dump` runs the postgres image);
 * finished pods; and an application pod that merely has a database SIDECAR
 * (pod-level telemetry would show the whole app on the database's page).
 *
 * It NEVER reads environment variables: pod specs in the inventory keep
 * direct env values verbatim, passwords included. Only container name,
 * image and declared ports are read.
 */

export type ImageClassification =
  | { kind: "database"; system: string }
  | { kind: "excluded"; reason: string }
  | { kind: "infrastructure-sidecar" }
  | { kind: "unknown" };

export interface KubernetesPodLike {
  namespaceKey: string;
  name: string;
  phase?: string | null;
  labels?: Record<string, unknown> | null;
  ownerReferences?: {
    items?: Array<{ kind?: string; name?: string }>;
  } | null;
  spec?: {
    containers?: Array<{
      name?: string;
      image?: string;
      ports?: Array<{ containerPort?: number }>;
    }>;
  } | null;
}

export interface KubernetesDatabaseCandidate {
  system: string;
  namespace: string;
  workloadKind: string;
  workloadName: string;
  podName: string;
  containerName: string;
  image: string | null;
  version: string | null;
  ports: Array<number>;
  operator: string | null;
  role: "primary" | "replica" | null;
  serviceNames: Array<string>;
  headlessServiceName: string | null;
  evidence: Array<string>;
}

export interface KubernetesDatabaseGroup {
  system: string;
  namespace: string;
  workloadKind: string;
  workloadName: string;
  podNames: Array<string>;
  image: string | null;
  version: string | null;
  ports: Array<number>;
  operator: string | null;
  serviceNames: Array<string>;
  headlessServiceName: string | null;
  /*
   * Each member pod with the headless Service it resolves under, for
   * `buildKubernetesDatabaseAliases({ podServiceNames })`. Members of one
   * operator cluster can sit behind different StatefulSets.
   */
  podServiceNames: Array<{ podName: string; serviceName: string }>;
}

export interface ContainerLike {
  name: string;
  imageName?: string | null;
  containerId?: string | null;
  labels?: Record<string, unknown> | null;
}

export interface ContainerDatabaseClassification {
  system: string;
  workloadName: string;
  containerName: string;
  version: string | null;
}

// ---- images --------------------------------------------------------------

interface ExcludedImageGroup {
  reason: string;
  repositories: ReadonlyArray<string>;
}

/*
 * Same matching rule as DatabaseSystemDescriptor.imageRepositories: an entry
 * without "/" is an exact basename, an entry with one is an exact path (or
 * a path suffix at a "/" boundary, for registry mirrors).
 */
const EXCLUDED_IMAGE_GROUPS: ReadonlyArray<ExcludedImageGroup> = [
  {
    reason: "exporter",
    repositories: [
      "postgres-exporter",
      "postgres_exporter",
      "redis_exporter",
      "mysqld-exporter",
      "mongodb_exporter",
      "elasticsearch-exporter",
      "memcached-exporter",
    ],
  },
  {
    reason: "operator",
    repositories: [
      "cloudnative-pg/cloudnative-pg",
      "zalando/postgres-operator",
      "acid/postgres-operator",
      "crunchydata/postgres-operator",
      "mongodb/mongodb-kubernetes",
      "eck/eck-operator",
    ],
  },
  {
    reason: "admin-ui",
    repositories: [
      "dpage/pgadmin4",
      "pgadmin4",
      "phpmyadmin",
      "adminer",
      "mongo-express",
      "redisinsight",
      "redis-commander",
      "kibana",
      "opensearch-dashboards",
      "cerebro",
    ],
  },
  {
    reason: "pooler",
    repositories: [
      "pgbouncer",
      "crunchydata/crunchy-pgbouncer",
      "pgpool",
      "pgpool2",
      "pgcat",
      "odyssey",
      "supavisor",
      "proxysql",
      "proxysql2",
      "haproxy",
      "mysql-router",
      "twemproxy",
      "gce-proxy",
      "cloud-sql-proxy",
    ],
  },
  {
    reason: "backup",
    repositories: [
      "pgbackrest",
      "crunchydata/crunchy-pgbackrest",
      "barman",
      "wal-g",
      "kubectl",
      "percona-xtrabackup",
      "percona-backup-mongodb",
      "mydumper",
    ],
  },
  {
    // Part of a database deployment, but not the database process itself.
    reason: "companion",
    repositories: [
      "redis-sentinel",
      "mongodb-agent",
      "mongodb-agent-ubi",
      "k8ssandra/system-logger",
    ],
  },
];

// Basename suffixes that are never a database, whatever comes before them.
const EXCLUDED_BASENAME_SUFFIXES: ReadonlyArray<{
  reason: string;
  suffix: string;
}> = [
  { reason: "exporter", suffix: "-exporter" },
  { reason: "exporter", suffix: "_exporter" },
  { reason: "operator", suffix: "-operator" },
];

// Mesh proxies, log shippers and agents that sit next to anything.
const INFRASTRUCTURE_SIDECAR_REPOSITORIES: ReadonlyArray<string> = [
  "proxyv2",
  "linkerd/proxy",
  "linkerd2-proxy",
  "envoy",
  "envoyproxy/envoy",
  "hashicorp/vault",
  "hashicorp/consul-dataplane",
  "fluent-bit",
  "fluentd",
  "filebeat",
  "promtail",
  "opentelemetry-collector",
  "opentelemetry-collector-contrib",
  "opentelemetry-collector-k8s",
  "busybox",
  "cadvisor",
  "datadog/agent",
  "grafana/agent",
  "grafana/alloy",
  "timberio/vector",
  "aws-xray-daemon",
  "daprd",
  "kuma-dp",
  "pause",
];

/*
 * Anchored basename patterns for images whose name carries a version, so no
 * finite exact list covers them (Zalando Spilo: `spilo-15`, `spilo-16`).
 * Still whole-basename matches, never substrings.
 */
const DATABASE_BASENAME_PATTERNS: ReadonlyArray<{
  system: string;
  pattern: RegExp;
}> = [{ system: "postgresql", pattern: /^spilo(?:-\d+)?$/ }];

const IMAGE_REPOSITORY_REGEX: RegExp = /^[a-z0-9._/-]+$/;

// A bare image id (untagged docker_stats image) names no repository.
const BARE_IMAGE_ID_REGEX: RegExp = /^(?:sha256:)?[0-9a-f]{12,64}$/;

interface SplitImageReference {
  repository: string;
  tag: string | null;
}

function splitImageReference(image: unknown): SplitImageReference | null {
  if (typeof image !== "string") {
    return null;
  }

  let value: string = image.trim().toLowerCase();
  if (!value || BARE_IMAGE_ID_REGEX.test(value)) {
    return null;
  }

  const digestIndex: number = value.indexOf("@");
  if (digestIndex >= 0) {
    value = value.substring(0, digestIndex);
  }

  let tag: string | null = null;
  const tagIndex: number = value.lastIndexOf(":");
  if (tagIndex > value.lastIndexOf("/")) {
    tag = value.substring(tagIndex + 1) || null;
    value = value.substring(0, tagIndex);
  }

  const segments: Array<string> = value
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  // Registry host: the first segment when it has a "." or ":" or is localhost.
  if (
    segments.length > 1 &&
    (segments[0]!.includes(".") ||
      segments[0]!.includes(":") ||
      segments[0] === "localhost")
  ) {
    segments.shift();
  }
  if (segments.length > 1 && segments[0] === "library") {
    segments.shift();
  }

  const repository: string = segments.join("/");
  if (!repository || !IMAGE_REPOSITORY_REGEX.test(repository)) {
    return null;
  }

  return { repository, tag };
}

function basenameOf(repository: string): string {
  return repository.substring(repository.lastIndexOf("/") + 1);
}

function repositoryMatches(repository: string, entry: string): boolean {
  if (entry.includes("/")) {
    return repository === entry || repository.endsWith(`/${entry}`);
  }
  return basenameOf(repository) === entry;
}

function matchesAny(
  repository: string,
  entries: ReadonlyArray<string>,
): boolean {
  for (const entry of entries) {
    if (repositoryMatches(repository, entry)) {
      return true;
    }
  }
  return false;
}

/**
 * The image's repository path without registry host, `library/`, tag or
 * digest, lowercased: `docker.io/library/postgres:16` → `postgres`,
 * `ghcr.io/cloudnative-pg/postgresql:16.2@sha256:…` →
 * `cloudnative-pg/postgresql`. Null for an empty value or a bare image id.
 */
export function normalizeImageRepository(image: unknown): string | null {
  const split: SplitImageReference | null = splitImageReference(image);
  return split ? split.repository : null;
}

/**
 * Best-effort engine version from the image: the leading
 * `major[.minor[.patch]]` of the tag (`16.2-alpine` → `16.2`,
 * `16.2.0-debian-12-r5` → `16.2.0`), the Postgres major of a Spilo image
 * (`spilo-16` → `16`) or of a Percona `…-ppg16-postgres` tag. Null for
 * `latest`, a digest-only reference or a tag that does not start with a
 * number.
 */
export function parseImageVersion(image: unknown): string | null {
  const split: SplitImageReference | null = splitImageReference(image);
  if (!split) {
    return null;
  }

  const spilo: RegExpExecArray | null = /^spilo-(\d+)$/.exec(
    basenameOf(split.repository),
  );
  if (spilo) {
    return spilo[1]!;
  }

  if (!split.tag) {
    return null;
  }

  const percona: RegExpExecArray | null = /(?:^|-)ppg(\d+(?:\.\d+)?)(?:-|$)/.exec(
    split.tag,
  );
  if (percona) {
    return percona[1]!;
  }

  const version: RegExpExecArray | null = /^v?(\d+(?:\.\d+){0,2})/.exec(
    split.tag,
  );
  return version ? version[1]! : null;
}

/**
 * What a container image is: a known database engine, something that must
 * not count as one (with the reason), an infrastructure sidecar, or unknown.
 */
export function classifyImage(image: unknown): ImageClassification {
  const repository: string | null = normalizeImageRepository(image);
  if (!repository) {
    return { kind: "unknown" };
  }

  for (const group of EXCLUDED_IMAGE_GROUPS) {
    if (matchesAny(repository, group.repositories)) {
      return { kind: "excluded", reason: group.reason };
    }
  }

  const basename: string = basenameOf(repository);
  for (const excluded of EXCLUDED_BASENAME_SUFFIXES) {
    if (basename.endsWith(excluded.suffix)) {
      return { kind: "excluded", reason: excluded.reason };
    }
  }

  if (matchesAny(repository, INFRASTRUCTURE_SIDECAR_REPOSITORIES)) {
    return { kind: "infrastructure-sidecar" };
  }

  for (const descriptor of DATABASE_SYSTEMS) {
    if (matchesAny(repository, descriptor.imageRepositories)) {
      return { kind: "database", system: descriptor.system };
    }
  }

  for (const entry of DATABASE_BASENAME_PATTERNS) {
    if (entry.pattern.test(basename)) {
      return { kind: "database", system: entry.system };
    }
  }

  return { kind: "unknown" };
}

// ---- Kubernetes pods -----------------------------------------------------

interface ContainerView {
  name: string;
  image: string | null;
  ports: Array<number>;
  classification: ImageClassification;
}

interface OperatorMatch {
  operator: string | null;
  system: string;
  // Null → name the workload after the pod's owner instead.
  clusterName: string | null;
  role: "primary" | "replica" | null;
  serviceNames: Array<string>;
  evidence: string;
}

type OperatorRuleResult = OperatorMatch | "skip" | null;

type OperatorRule = (labels: Record<string, unknown>) => OperatorRuleResult;

const SKIPPED_POD_PHASES: ReadonlySet<string> = new Set<string>([
  "succeeded",
  "failed",
]);

const BATCH_OWNER_KINDS: ReadonlySet<string> = new Set<string>([
  "job",
  "cronjob",
]);

/*
 * `app.kubernetes.io/component` values of pods that carry a database's
 * cluster/chart labels but are not a database member: poolers, proxies,
 * routers, exporters, orchestrators, backup and monitoring pods.
 */
const NON_MEMBER_COMPONENTS: ReadonlySet<string> = new Set<string>([
  "pgpool",
  "pgbouncer",
  "proxysql",
  "haproxy",
  "mongos",
  "metrics",
  "exporter",
  "router",
  "mysqlrouter",
  "orc",
  "orchestrator",
  "backup",
  "pmm",
]);

/*
 * Exclusion reasons that make a pod a non-member on their own. "operator"
 * and "companion" are deliberately absent: Percona's PostgreSQL operator
 * ships its postgres operand in the operator's image repository, and a
 * Sentinel / agent container never runs alone in a member pod anyway.
 */
const NON_MEMBER_IMAGE_REASONS: ReadonlySet<string> = new Set<string>([
  "pooler",
  "exporter",
  "admin-ui",
  "backup",
]);

const PRIMARY_ROLE_VALUES: ReadonlySet<string> = new Set<string>([
  "primary",
  "master",
]);

const REPLICA_ROLE_VALUES: ReadonlySet<string> = new Set<string>([
  "replica",
  "replicas",
  "read",
  "secondary",
  "slave",
  "standby",
]);

function labelValue(
  labels: Record<string, unknown>,
  key: string,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(labels, key)) {
    return null;
  }
  const value: unknown = labels[key];
  if (typeof value === "string") {
    const trimmed: string = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function hasLabel(labels: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(labels, key);
}

function roleFrom(value: string | null): "primary" | "replica" | null {
  if (!value) {
    return null;
  }
  const normalized: string = value.trim().toLowerCase();
  if (PRIMARY_ROLE_VALUES.has(normalized)) {
    return "primary";
  }
  if (REPLICA_ROLE_VALUES.has(normalized)) {
    return "replica";
  }
  return null;
}

const CHART_SYSTEM_BY_NAME: ReadonlyMap<string, string> = ((): Map<
  string,
  string
> => {
  const map: Map<string, string> = new Map<string, string>();
  for (const descriptor of DATABASE_SYSTEMS) {
    for (const chartName of descriptor.kubernetesChartNames) {
      map.set(chartName, descriptor.system);
    }
  }
  return map;
})();

const PERCONA_SYSTEM_BY_NAME: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["percona-xtradb-cluster", "mysql"],
  ["percona-server", "mysql"],
  ["percona-server-mongodb", "mongodb"],
]);

/*
 * Operator / chart label rules, most specific first. Each returns a match,
 * "skip" (the pod belongs to a database cluster but is not a member — a
 * pooler, a backup repo host), or null (not this operator). Label keys and
 * Service naming follow each operator's documented conventions.
 */
const OPERATOR_RULES: ReadonlyArray<OperatorRule> = [
  // CloudNativePG.
  (labels: Record<string, unknown>): OperatorRuleResult => {
    const cluster: string | null = labelValue(labels, "cnpg.io/cluster");
    if (!cluster) {
      return null;
    }
    const podRole: string | null = labelValue(labels, "cnpg.io/podRole");
    if (
      (podRole && podRole.toLowerCase() !== "instance") ||
      labelValue(labels, "cnpg.io/poolerName")
    ) {
      return "skip";
    }
    return {
      operator: "cloudnative-pg",
      system: "postgresql",
      clusterName: cluster,
      role: roleFrom(
        labelValue(labels, "cnpg.io/instanceRole") ||
          labelValue(labels, "role"),
      ),
      serviceNames: [`${cluster}-rw`, `${cluster}-ro`, `${cluster}-r`],
      evidence: `label:cnpg.io/cluster=${cluster}`,
    };
  },

  // Zalando postgres-operator (Spilo).
  (labels: Record<string, unknown>): OperatorRuleResult => {
    const application: string | null = labelValue(labels, "application");
    const cluster: string | null = labelValue(labels, "cluster-name");
    if (!application || application.toLowerCase() !== "spilo" || !cluster) {
      return null;
    }
    return {
      operator: "zalando",
      system: "postgresql",
      clusterName: cluster,
      role: roleFrom(labelValue(labels, "spilo-role")),
      serviceNames: [cluster, `${cluster}-repl`],
      evidence: `label:cluster-name=${cluster}`,
    };
  },

  // Crunchy Data PGO v5 (also Percona's PostgreSQL operator v2, a fork).
  (labels: Record<string, unknown>): OperatorRuleResult => {
    const cluster: string | null = labelValue(
      labels,
      "postgres-operator.crunchydata.com/cluster",
    );
    if (!cluster) {
      return null;
    }
    const role: string | null = labelValue(
      labels,
      "postgres-operator.crunchydata.com/role",
    );
    if (
      (role && ["pgbouncer", "pgadmin"].includes(role.toLowerCase())) ||
      hasLabel(labels, "postgres-operator.crunchydata.com/pgbackrest-dedicated") ||
      hasLabel(labels, "postgres-operator.crunchydata.com/pgadmin")
    ) {
      return "skip";
    }
    return {
      operator: "crunchy",
      system: "postgresql",
      clusterName: cluster,
      role: roleFrom(role),
      serviceNames: [`${cluster}-primary`, `${cluster}-replicas`],
      evidence: `label:postgres-operator.crunchydata.com/cluster=${cluster}`,
    };
  },

  // Percona XtraDB Cluster / Server for MySQL / Server for MongoDB operators.
  (labels: Record<string, unknown>): OperatorRuleResult => {
    const managedBy: string | null = labelValue(
      labels,
      "app.kubernetes.io/managed-by",
    );
    const name: string | null = labelValue(labels, "app.kubernetes.io/name");
    const instance: string | null = labelValue(
      labels,
      "app.kubernetes.io/instance",
    );
    if (
      !managedBy ||
      !managedBy.toLowerCase().startsWith("percona-") ||
      !name ||
      !instance
    ) {
      return null;
    }
    const system: string | undefined = PERCONA_SYSTEM_BY_NAME.get(
      name.toLowerCase(),
    );
    if (!system) {
      return null;
    }
    const serviceNames: Array<string> = [];
    const normalizedName: string = name.toLowerCase();
    if (normalizedName === "percona-xtradb-cluster") {
      serviceNames.push(`${instance}-pxc`);
    } else if (normalizedName === "percona-server") {
      serviceNames.push(`${instance}-mysql`);
    } else {
      const replicaSet: string | null = labelValue(
        labels,
        "app.kubernetes.io/replset",
      );
      if (replicaSet) {
        serviceNames.push(`${instance}-${replicaSet}`);
      }
    }
    return {
      operator: "percona",
      system,
      clusterName: instance,
      role: null,
      serviceNames,
      evidence: `label:app.kubernetes.io/name=${name}`,
    };
  },

  // Oracle MySQL Operator (InnoDB Cluster).
  (labels: Record<string, unknown>): OperatorRuleResult => {
    const cluster: string | null = labelValue(labels, "mysql.oracle.com/cluster");
    if (!cluster) {
      return null;
    }
    const component: string | null = labelValue(labels, "component");
    if (component && NON_MEMBER_COMPONENTS.has(component.toLowerCase())) {
      return "skip";
    }
    const clusterRole: string | null = labelValue(
      labels,
      "mysql.oracle.com/cluster-role",
    );
    return {
      operator: "mysql-operator",
      system: "mysql",
      clusterName: cluster,
      role: roleFrom(clusterRole),
      serviceNames: [`${cluster}-instances`],
      evidence: `label:mysql.oracle.com/cluster=${cluster}`,
    };
  },

  // Elastic Cloud on Kubernetes.
  (labels: Record<string, unknown>): OperatorRuleResult => {
    const type: string | null = labelValue(labels, "common.k8s.elastic.co/type");
    const cluster: string | null = labelValue(
      labels,
      "elasticsearch.k8s.elastic.co/cluster-name",
    );
    if (!type || type.toLowerCase() !== "elasticsearch" || !cluster) {
      return null;
    }
    return {
      operator: "eck",
      system: "elasticsearch",
      clusterName: cluster,
      role: null,
      serviceNames: [`${cluster}-es-http`],
      evidence: `label:elasticsearch.k8s.elastic.co/cluster-name=${cluster}`,
    };
  },

  // Altinity ClickHouse operator.
  (labels: Record<string, unknown>): OperatorRuleResult => {
    const installation: string | null = labelValue(
      labels,
      "clickhouse.altinity.com/chi",
    );
    if (!installation) {
      return null;
    }
    return {
      operator: "altinity",
      system: "clickhouse",
      clusterName: installation,
      role: null,
      serviceNames: [`clickhouse-${installation}`],
      evidence: `label:clickhouse.altinity.com/chi=${installation}`,
    };
  },

  // K8ssandra cass-operator.
  (labels: Record<string, unknown>): OperatorRuleResult => {
    const cluster: string | null = labelValue(
      labels,
      "cassandra.datastax.com/cluster",
    );
    if (!cluster) {
      return null;
    }
    const datacenter: string | null = labelValue(
      labels,
      "cassandra.datastax.com/datacenter",
    );
    return {
      operator: "cass-operator",
      system: "cassandra",
      clusterName: cluster,
      role: null,
      serviceNames: datacenter ? [`${cluster}-${datacenter}-service`] : [],
      evidence: `label:cassandra.datastax.com/cluster=${cluster}`,
    };
  },

  // Bitnami and most other Helm charts (`app.kubernetes.io/name`).
  (labels: Record<string, unknown>): OperatorRuleResult => {
    const chartName: string | null = labelValue(
      labels,
      "app.kubernetes.io/name",
    );
    if (!chartName) {
      return null;
    }
    const chart: string = chartName.toLowerCase();
    const system: string | undefined = CHART_SYSTEM_BY_NAME.get(chart);
    if (!system) {
      return null;
    }

    const instance: string | null = labelValue(
      labels,
      "app.kubernetes.io/instance",
    );
    const component: string | null = labelValue(
      labels,
      "app.kubernetes.io/component",
    );

    /*
     * Helm's conventional fullname: the release name when it already
     * contains the chart name, else `${release}-${chart}`.
     */
    const fullName: string | null = instance
      ? instance.toLowerCase().includes(chart)
        ? instance
        : `${instance}-${chart}`
      : null;

    const serviceNames: Array<string> = [];
    if (fullName) {
      serviceNames.push(`${fullName}-headless`, `${fullName}-hl`);
      if (component) {
        serviceNames.push(`${fullName}-${component.toLowerCase()}`);
        if (component.toLowerCase() === "replica") {
          serviceNames.push(`${fullName}-replicas`);
        }
      }
    }

    const managedBy: string | null = labelValue(
      labels,
      "app.kubernetes.io/managed-by",
    );

    return {
      operator:
        managedBy && managedBy.toLowerCase() === "helm" ? "helm" : null,
      system,
      clusterName: fullName,
      role: roleFrom(component),
      serviceNames,
      evidence: `label:app.kubernetes.io/name=${chartName}`,
    };
  },
];

/*
 * Reads ONLY name, image and declared ports — never `env` (see the file
 * header), never by spreading the container object.
 */
function readContainers(pod: KubernetesPodLike): Array<ContainerView> {
  const containers: unknown = pod.spec?.containers;
  if (!Array.isArray(containers)) {
    return [];
  }

  const views: Array<ContainerView> = [];
  for (const container of containers) {
    if (!container || typeof container !== "object") {
      continue;
    }
    const name: unknown = (container as { name?: unknown }).name;
    const image: unknown = (container as { image?: unknown }).image;
    const declaredPorts: unknown = (container as { ports?: unknown }).ports;

    const ports: Array<number> = [];
    if (Array.isArray(declaredPorts)) {
      for (const declared of declaredPorts) {
        const port: unknown =
          declared && typeof declared === "object"
            ? (declared as { containerPort?: unknown }).containerPort
            : undefined;
        if (
          typeof port === "number" &&
          Number.isInteger(port) &&
          port >= 1 &&
          port <= 65535 &&
          !ports.includes(port)
        ) {
          ports.push(port);
        }
      }
    }

    const imageText: string | null =
      typeof image === "string" && image.trim() ? image.trim() : null;

    views.push({
      name: typeof name === "string" ? name.trim() : "",
      image: imageText,
      ports,
      classification: classifyImage(imageText),
    });
  }
  return views;
}

function readOwners(
  pod: KubernetesPodLike,
): Array<{ kind: string; name: string }> {
  const items: unknown = pod.ownerReferences?.items;
  if (!Array.isArray(items)) {
    return [];
  }
  const owners: Array<{ kind: string; name: string }> = [];
  for (const item of items) {
    const kind: unknown = item?.kind;
    const name: unknown = item?.name;
    if (
      typeof kind === "string" &&
      kind.trim() &&
      typeof name === "string" &&
      name.trim()
    ) {
      owners.push({ kind: kind.trim(), name: name.trim() });
    }
  }
  return owners;
}

function resolveOwnerWorkload(
  podName: string,
  owner: { kind: string; name: string } | null,
  labels: Record<string, unknown>,
): { workloadKind: string; workloadName: string } {
  if (!owner) {
    return { workloadKind: "Pod", workloadName: podName };
  }

  const kind: string = owner.kind.toLowerCase();

  if (kind === "statefulset") {
    return { workloadKind: "StatefulSet", workloadName: owner.name };
  }
  if (kind === "daemonset") {
    return { workloadKind: "DaemonSet", workloadName: owner.name };
  }
  if (kind === "replicaset") {
    /*
     * A Deployment's ReplicaSet is `${deployment}-${pod-template-hash}`, and
     * the pod carries that hash as a label — so stripping it is exact, with
     * no guessing at what a hash looks like.
     */
    const hash: string | null = labelValue(labels, "pod-template-hash");
    const suffix: string = hash ? `-${hash}` : "";
    if (
      hash &&
      owner.name.endsWith(suffix) &&
      owner.name.length > suffix.length
    ) {
      return {
        workloadKind: "Deployment",
        workloadName: owner.name.substring(
          0,
          owner.name.length - suffix.length,
        ),
      };
    }
    return { workloadKind: "ReplicaSet", workloadName: owner.name };
  }

  return { workloadKind: owner.kind, workloadName: owner.name };
}

function uniqueNonEmpty(values: Array<string>): Array<string> {
  const result: Array<string> = [];
  for (const value of values) {
    const trimmed: string = typeof value === "string" ? value.trim() : "";
    if (trimmed && !result.includes(trimmed)) {
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * The database a Kubernetes pod runs, or null. Operator / chart labels are
 * consulted first (they name the cluster: workloadKind "Cluster"); otherwise
 * the first container whose image is a database, provided no other
 * container is an unrecognised application (a DB sidecar in an app pod is
 * not a database). Batch pods, finished pods and non-member pods of a
 * database cluster (poolers, routers, exporters, backup repos) are null.
 */
export function classifyKubernetesPod(
  pod: KubernetesPodLike,
  extra?: { statefulSetServiceNames?: Record<string, string> },
): KubernetesDatabaseCandidate | null {
  if (!pod || typeof pod !== "object") {
    return null;
  }

  const podName: string = typeof pod.name === "string" ? pod.name.trim() : "";
  const namespace: string =
    typeof pod.namespaceKey === "string" ? pod.namespaceKey.trim() : "";
  if (!podName) {
    return null;
  }

  if (
    typeof pod.phase === "string" &&
    SKIPPED_POD_PHASES.has(pod.phase.trim().toLowerCase())
  ) {
    return null;
  }

  const owners: Array<{ kind: string; name: string }> = readOwners(pod);
  for (const owner of owners) {
    if (BATCH_OWNER_KINDS.has(owner.kind.toLowerCase())) {
      return null;
    }
  }
  const owner: { kind: string; name: string } | null = owners[0] || null;

  const labels: Record<string, unknown> =
    pod.labels && typeof pod.labels === "object" ? pod.labels : {};

  const containers: Array<ContainerView> = readContainers(pod);

  const statefulSetServiceNames: Record<string, string> =
    extra?.statefulSetServiceNames &&
    typeof extra.statefulSetServiceNames === "object"
      ? extra.statefulSetServiceNames
      : {};
  const headlessServiceName: string | null =
    owner &&
    owner.kind.toLowerCase() === "statefulset" &&
    Object.prototype.hasOwnProperty.call(statefulSetServiceNames, owner.name) &&
    typeof statefulSetServiceNames[owner.name] === "string" &&
    statefulSetServiceNames[owner.name]!.trim()
      ? statefulSetServiceNames[owner.name]!.trim()
      : null;

  const ownerWorkload: { workloadKind: string; workloadName: string } =
    resolveOwnerWorkload(podName, owner, labels);

  // 1. Operator / chart labels.
  for (const rule of OPERATOR_RULES) {
    const match: OperatorRuleResult = rule(labels);
    if (match === null) {
      continue;
    }
    if (match === "skip") {
      return null;
    }

    const component: string | null = labelValue(
      labels,
      "app.kubernetes.io/component",
    );
    if (component && NON_MEMBER_COMPONENTS.has(component.toLowerCase())) {
      return null;
    }

    /*
     * A pod that only runs poolers / exporters / admin UIs / backup tools is
     * not a member even when it carries the cluster's labels (a router or
     * pooler Deployment the operator labels as part of the cluster).
     */
    const onlyNonMemberContainers: boolean =
      containers.length > 0 &&
      containers.every((container: ContainerView): boolean => {
        return (
          container.classification.kind === "excluded" &&
          NON_MEMBER_IMAGE_REASONS.has(container.classification.reason)
        );
      });
    if (onlyNonMemberContainers) {
      return null;
    }

    const databaseContainer: ContainerView | null =
      containers.find((container: ContainerView): boolean => {
        return (
          container.classification.kind === "database" &&
          container.classification.system === match.system
        );
      }) ||
      containers.find((container: ContainerView): boolean => {
        return container.classification.kind === "database";
      }) ||
      containers.find((container: ContainerView): boolean => {
        return container.classification.kind === "unknown";
      }) ||
      containers[0] ||
      null;

    const workloadKind: string = match.clusterName
      ? "Cluster"
      : ownerWorkload.workloadKind;
    const workloadName: string =
      match.clusterName || ownerWorkload.workloadName;

    const evidence: Array<string> = [match.evidence];
    if (databaseContainer?.image) {
      evidence.push(`image:${databaseContainer.image}`);
    }

    return {
      system: match.system,
      namespace,
      workloadKind,
      workloadName,
      podName,
      containerName: databaseContainer?.name || "",
      image: databaseContainer?.image || null,
      version: parseImageVersion(databaseContainer?.image),
      ports: databaseContainer ? [...databaseContainer.ports] : [],
      operator: match.operator,
      role: match.role,
      serviceNames: uniqueNonEmpty([workloadName, ...match.serviceNames]),
      headlessServiceName,
      evidence,
    };
  }

  // 2. Container images.
  const databaseContainer: ContainerView | undefined = containers.find(
    (container: ContainerView): boolean => {
      return container.classification.kind === "database";
    },
  );
  if (
    !databaseContainer ||
    databaseContainer.classification.kind !== "database"
  ) {
    return null;
  }

  const hasApplicationContainer: boolean = containers.some(
    (container: ContainerView): boolean => {
      return (
        container !== databaseContainer &&
        container.classification.kind === "unknown"
      );
    },
  );
  if (hasApplicationContainer) {
    return null;
  }

  return {
    system: databaseContainer.classification.system,
    namespace,
    workloadKind: ownerWorkload.workloadKind,
    workloadName: ownerWorkload.workloadName,
    podName,
    containerName: databaseContainer.name,
    image: databaseContainer.image,
    version: parseImageVersion(databaseContainer.image),
    ports: [...databaseContainer.ports],
    operator: null,
    role: null,
    serviceNames: uniqueNonEmpty([ownerWorkload.workloadName]),
    headlessServiceName,
    evidence: [`image:${databaseContainer.image}`],
  };
}

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Fold per-pod candidates into one entry per database workload
 * (system + namespace + workloadKind + workloadName). Member pods, ports and
 * Service names are unioned; image and version come from the primary member
 * when one is known, else from the first pod by name. Deterministic: groups
 * and pod names are sorted.
 */
export function groupKubernetesDatabaseCandidates(
  candidates: Array<KubernetesDatabaseCandidate>,
): Array<KubernetesDatabaseGroup> {
  if (!Array.isArray(candidates)) {
    return [];
  }

  const byKey: Map<string, Array<KubernetesDatabaseCandidate>> = new Map<
    string,
    Array<KubernetesDatabaseCandidate>
  >();

  for (const candidate of candidates) {
    if (!candidate || !candidate.system || !candidate.workloadName) {
      continue;
    }
    const key: string = [
      candidate.system,
      candidate.namespace,
      candidate.workloadKind,
      candidate.workloadName,
    ].join("\u0000");
    const members: Array<KubernetesDatabaseCandidate> = byKey.get(key) || [];
    members.push(candidate);
    byKey.set(key, members);
  }

  const groups: Array<KubernetesDatabaseGroup> = [];

  for (const members of byKey.values()) {
    const sorted: Array<KubernetesDatabaseCandidate> = [...members].sort(
      (a: KubernetesDatabaseCandidate, b: KubernetesDatabaseCandidate) => {
        return compareStrings(a.podName, b.podName);
      },
    );
    const first: KubernetesDatabaseCandidate = sorted[0]!;
    const representative: KubernetesDatabaseCandidate =
      sorted.find((member: KubernetesDatabaseCandidate): boolean => {
        return member.role === "primary";
      }) || first;

    const podNames: Array<string> = uniqueNonEmpty(
      sorted.map((member: KubernetesDatabaseCandidate): string => {
        return member.podName;
      }),
    );

    const ports: Array<number> = [];
    for (const member of sorted) {
      for (const port of member.ports || []) {
        if (!ports.includes(port)) {
          ports.push(port);
        }
      }
    }
    ports.sort((a: number, b: number): number => {
      return a - b;
    });

    const serviceNames: Array<string> = uniqueNonEmpty(
      sorted.flatMap((member: KubernetesDatabaseCandidate): Array<string> => {
        return member.serviceNames || [];
      }),
    );

    const podServiceNames: Array<{ podName: string; serviceName: string }> =
      [];
    for (const member of sorted) {
      if (
        member.headlessServiceName &&
        !podServiceNames.some(
          (entry: { podName: string; serviceName: string }): boolean => {
            return entry.podName === member.podName;
          },
        )
      ) {
        podServiceNames.push({
          podName: member.podName,
          serviceName: member.headlessServiceName,
        });
      }
    }

    groups.push({
      system: first.system,
      namespace: first.namespace,
      workloadKind: first.workloadKind,
      workloadName: first.workloadName,
      podNames,
      image: representative.image,
      version: representative.version,
      ports,
      operator:
        sorted.find((member: KubernetesDatabaseCandidate): boolean => {
          return Boolean(member.operator);
        })?.operator || null,
      serviceNames,
      headlessServiceName:
        sorted.find((member: KubernetesDatabaseCandidate): boolean => {
          return Boolean(member.headlessServiceName);
        })?.headlessServiceName || null,
      podServiceNames,
    });
  }

  return groups.sort(
    (a: KubernetesDatabaseGroup, b: KubernetesDatabaseGroup): number => {
      return (
        compareStrings(a.namespace, b.namespace) ||
        compareStrings(a.workloadKind, b.workloadKind) ||
        compareStrings(a.workloadName, b.workloadName) ||
        compareStrings(a.system, b.system)
      );
    },
  );
}

// ---- Docker / Podman containers -------------------------------------------

/**
 * The database a Docker / Podman container runs, or null. The workload name
 * is the container name minus a trailing compose replica suffix
 * (`shop-postgres-1` → `shop-postgres`), so replicas of one compose service
 * group together and compose labels appearing later never change identity.
 */
export function classifyContainer(
  container: ContainerLike,
): ContainerDatabaseClassification | null {
  if (!container || typeof container.name !== "string") {
    return null;
  }

  // Docker reports names as "/name" (and occasionally "/a,/b").
  const containerName: string = (container.name.split(",")[0] || "")
    .trim()
    .replace(/^\/+/, "");
  if (!containerName) {
    return null;
  }

  const classification: ImageClassification = classifyImage(
    container.imageName,
  );
  if (classification.kind !== "database") {
    return null;
  }

  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(classification.system);

  return {
    system: descriptor ? descriptor.system : classification.system,
    workloadName: containerName.replace(/[-_]\d+$/, "") || containerName,
    containerName,
    version: parseImageVersion(container.imageName),
  };
}
