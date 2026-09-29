import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
  getDatabaseSystemDescriptor,
  getDatabaseSystemFamily,
  getDefaultDatabasePort,
  getMoreSpecificDatabaseSystem,
  isSameDatabaseFamily,
} from "./DatabaseSystem";
import { isNonServerCommand } from "./DatabaseContainerCommand";

/*
 * "Is this pod / container a database, and which one?" — the pure classifier
 * behind Kubernetes, Docker and Podman database auto-detection.
 *
 * Evidence, strongest first:
 *   1. operator / Helm chart LABELS on a Kubernetes pod (CloudNativePG,
 *      Zalando, Crunchy, Percona, the Oracle MySQL operator, ECK, Altinity,
 *      cass-operator, the Vitess operator, Bitnami-style
 *      `app.kubernetes.io/name`) — they also name the logical cluster, its
 *      role and its Services;
 *   2. the container IMAGE, matched on the normalized repository or its
 *      basename EXACTLY (never a substring: `acme/redis-cache-warmer` is not
 *      Redis). Normalization drops the registry, `library/`, the tag and the
 *      digest, folds republishing organisations into the original
 *      (`bitnamilegacy/`, `bitnamisecure/` → `bitnami/`) and reads Red Hat
 *      Software Collections names (`rhel9/postgresql-16` → `postgresql`, 16).
 *
 * What it refuses, on purpose: exporters, operators, admin UIs, poolers and
 * proxies, backup tools (they run DB images or talk to one but are not one);
 * batch pods (Job / CronJob owners — `pg_dump` runs the postgres image);
 * finished pods; client, debug and Sentinel runs of a database image
 * (`psql`, `redis-cli`, `sleep infinity`, an interactive shell,
 * `redis-sentinel` — only on positive evidence, see
 * DatabaseContainerCommand); an owner-less pod
 * that declares no port (`kubectl run --rm -it psql --image=postgres`);
 * Docker containers started by Testcontainers, `docker compose run` or the
 * kubelet; and an application pod that merely has a database SIDECAR
 * (pod-level telemetry would show the whole app on the database's page).
 *
 * It NEVER reads environment variables: pod specs in the inventory keep
 * direct env values verbatim, passwords included. Only container name,
 * image, declared ports and what a container's command line runs (its
 * program, a shell's flags and the known command names of its script)
 * are read.
 */

export type ImageClassification =
  | { kind: "database"; system: string }
  | { kind: "excluded"; reason: string }
  | { kind: "infrastructure-sidecar" }
  | { kind: "unknown" };

export interface KubernetesContainerLike {
  name?: string | undefined;
  image?: string | undefined;
  ports?: Array<{ containerPort?: number | undefined }> | undefined;
  /*
   * The container's command and args as Kubernetes has them (the program
   * started is `command` followed by `args`), or the reduction
   * CANDIDATE_PODS_SQL projects as `command` — see DatabaseContainerCommand.
   */
  command?: Array<string | null> | undefined;
  args?: Array<string | null> | undefined;
}

export interface KubernetesPodLike {
  namespaceKey: string;
  name: string;
  phase?: string | null | undefined;
  labels?: Record<string, unknown> | null | undefined;
  ownerReferences?:
    | {
        items?:
          | Array<{ kind?: string | undefined; name?: string | undefined }>
          | undefined;
      }
    | null
    | undefined;
  spec?:
    | {
        containers?: Array<KubernetesContainerLike> | undefined;
      }
    | null
    | undefined;
}

export interface KubernetesDatabaseCandidate {
  system: string;
  namespace: string;
  workloadKind: string;
  workloadName: string;
  /*
   * The workload that owns the pod (a Deployment after its ReplicaSet's
   * pod-template-hash is stripped), whatever identity the database got —
   * a chart-labelled Deployment is a "Cluster" database whose Deployment
   * still scopes telemetry. Null for an owner-less pod.
   */
  ownerKind: string | null;
  ownerName: string | null;
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
  // The workloads owning the member pods (kind + name), deduped and sorted.
  ownerWorkloads: Array<{ kind: string; name: string }>;
}

/*
 * A connection-pooler pod of an operator cluster: not a member, but the
 * Service it backs is one more name clients reach the cluster by.
 */
export interface KubernetesPoolerService {
  system: string;
  namespace: string;
  clusterName: string;
  serviceName: string;
}

export interface ContainerLike {
  name: string;
  imageName?: string | null | undefined;
  containerId?: string | null | undefined;
  labels?: Record<string, unknown> | null | undefined;
}

/*
 * What a Docker / Podman database's workload is: the Swarm service or the
 * Compose service its replicas were grouped by, else a container of its own.
 * Stored as the database's workloadKind and read back as written ("detected
 * from Compose service shop-db", "Swarm service/mystack_db").
 */
export enum ContainerWorkloadKind {
  Container = "Container",
  ComposeService = "Compose service",
  SwarmService = "Swarm service",
}

export interface ContainerDatabaseClassification {
  system: string;
  workloadKind: ContainerWorkloadKind;
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
      "postgres-backup-local",
      "postgres-backup-s3",
      "mysql-backup",
      "db-backup",
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

// Mesh proxies, log shippers, VPN / tunnel and monitoring agents that sit next to anything.
const INFRASTRUCTURE_SIDECAR_REPOSITORIES: ReadonlyArray<string> = [
  "proxyv2",
  "linkerd/proxy",
  "linkerd2-proxy",
  "envoy",
  "envoyproxy/envoy",
  "aws-appmesh-envoy",
  "hashicorp/vault",
  "hashicorp/consul-dataplane",
  "fluent-bit",
  "fluentd",
  "filebeat",
  "promtail",
  "opentelemetry-collector",
  "opentelemetry-collector-contrib",
  "opentelemetry-collector-k8s",
  "splunk-otel-collector",
  "busybox",
  "cadvisor",
  "datadog/agent",
  "datadoghq/agent",
  "grafana/agent",
  "grafana/alloy",
  "timberio/vector",
  "vectordotdev/vector",
  "jaeger-agent",
  "pmm-client",
  "aws-xray-daemon",
  "daprd",
  "kuma-dp",
  "tailscale/tailscale",
  "cloudflare/cloudflared",
  "bitnami/os-shell",
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

/*
 * Organisations that republish another organisation's images unchanged:
 * Bitnami's catalogue moved to `bitnamilegacy/` (frozen tags) and
 * `bitnamisecure/` (hardened builds), under every registry that mirrors it
 * (`docker.io/`, `public.ecr.aws/`, a Harbor proxy …).
 */
const IMAGE_ORGANIZATION_ALIASES: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["bitnamilegacy", "bitnami"],
  ["bitnamisecure", "bitnami"],
]);

/*
 * Red Hat Software Collections put the engine AND its version in the image
 * name and the image build in the tag: `registry.redhat.io/rhel9/postgresql-16:1-54`,
 * `quay.io/sclorg/mysql-80-c9s`, `centos/postgresql-96-centos7`. Recognised
 * only under these namespaces, so `bitnami/postgresql-repmgr` or an
 * application called `api-2` keeps its name.
 */
const SOFTWARE_COLLECTION_NAMESPACE_REGEX: RegExp =
  /^(?:rhel\d*|rhscl|sclorg|centos\d*|fedora)$/;
const SOFTWARE_COLLECTION_PLATFORM_REGEX: RegExp =
  /^(?:rhel\d+|el\d+|centos\d+|c\d+s|ubi\d+|fedora)$/;
const SOFTWARE_COLLECTION_VERSION_REGEX: RegExp = /^\d{1,4}$/;
const SOFTWARE_COLLECTION_ENGINE_REGEX: RegExp = /^[a-z][a-z0-9]*$/;

// Red Hat UBI rebuilds carry a `-ubi` / `-ubi8` basename suffix.
const UBI_BASENAME_SUFFIX_REGEX: RegExp = /-ubi\d*$/;

/*
 * Version sources in an image reference: a Spilo image name carries the
 * PostgreSQL major, a Percona tag carries "ppg<version>", any other tag
 * starts with it.
 */
const SPILO_IMAGE_REGEX: RegExp = /^spilo-(\d+)$/;
const PERCONA_POSTGRESQL_TAG_REGEX: RegExp = /(?:^|-)ppg(\d+(?:\.\d+)?)(?:-|$)/;
const IMAGE_TAG_VERSION_REGEX: RegExp = /^v?(\d+(?:\.\d+){0,2})/;

interface SplitImageReference {
  repository: string;
  tag: string | null;
  // Engine version carried by a Software Collections image NAME.
  nameVersion: string | null;
}

/*
 * `rhel9/postgresql-16` → { engine "postgresql", digits "16" }; null for any
 * basename that is not `<engine>-<1-4 digits>[-<platform>]`.
 */
function parseSoftwareCollectionBasename(
  basename: string,
): { engine: string; digits: string } | null {
  const parts: Array<string> = basename.split("-");
  if (
    parts.length > 2 &&
    SOFTWARE_COLLECTION_PLATFORM_REGEX.test(parts[parts.length - 1]!)
  ) {
    parts.pop();
  }
  if (parts.length !== 2) {
    return null;
  }
  const engine: string = parts[0]!;
  const digits: string = parts[1]!;
  if (
    !SOFTWARE_COLLECTION_ENGINE_REGEX.test(engine) ||
    !SOFTWARE_COLLECTION_VERSION_REGEX.test(digits)
  ) {
    return null;
  }
  return { engine, digits };
}

/*
 * Software Collections spell versions without the dot: `postgresql-96` is
 * 9.6 but `postgresql-16` is 16, `mysql-80` is 8.0, `mariadb-105` 10.5 and
 * `mariadb-1011` 10.11.
 */
function formatSoftwareCollectionVersion(
  engine: string,
  digits: string,
): string {
  if (engine === "postgresql") {
    return digits.length === 2 && digits.startsWith("9")
      ? `9.${digits.substring(1)}`
      : digits;
  }
  if (digits.length === 2) {
    return `${digits.substring(0, 1)}.${digits.substring(1)}`;
  }
  if (digits.length === 3) {
    return `${digits.substring(0, 2)}.${digits.substring(2)}`;
  }
  if (digits.length === 4) {
    return `${digits.substring(0, 2)}.${digits.substring(2)}`;
  }
  return digits;
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

  // Republishing organisations → the original (never the basename itself).
  for (let index: number = 0; index < segments.length - 1; index++) {
    const alias: string | undefined = IMAGE_ORGANIZATION_ALIASES.get(
      segments[index]!,
    );
    if (alias) {
      segments[index] = alias;
    }
  }

  let nameVersion: string | null = null;
  const lastIndex: number = segments.length - 1;

  if (lastIndex >= 0) {
    let basename: string = segments[lastIndex]!;

    const withoutUbi: string = basename.replace(UBI_BASENAME_SUFFIX_REGEX, "");
    if (withoutUbi && withoutUbi !== basename) {
      basename = withoutUbi;
    }

    if (
      lastIndex >= 1 &&
      SOFTWARE_COLLECTION_NAMESPACE_REGEX.test(segments[lastIndex - 1]!)
    ) {
      const collection: { engine: string; digits: string } | null =
        parseSoftwareCollectionBasename(basename);
      if (collection) {
        basename = collection.engine;
        nameVersion = formatSoftwareCollectionVersion(
          collection.engine,
          collection.digits,
        );
      }
    }

    segments[lastIndex] = basename;
  }

  const repository: string = segments.join("/");
  if (!repository || !IMAGE_REPOSITORY_REGEX.test(repository)) {
    return null;
  }

  return { repository, tag, nameVersion };
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
 * `cloudnative-pg/postgresql`. Republished images read as the original
 * (`bitnamilegacy/redis-cluster` → `bitnami/redis-cluster`), a Red Hat
 * Software Collections name loses its version and platform
 * (`registry.redhat.io/rhel9/postgresql-16` → `rhel9/postgresql`) and a UBI
 * rebuild its `-ubi` suffix. Null for an empty value or a bare image id.
 */
export function normalizeImageRepository(image: unknown): string | null {
  const split: SplitImageReference | null = splitImageReference(image);
  return split ? split.repository : null;
}

/**
 * Best-effort engine version from the image: the leading
 * `major[.minor[.patch]]` of the tag (`16.2-alpine` → `16.2`,
 * `16.2.0-debian-12-r5` → `16.2.0`), the Postgres major of a Spilo image
 * (`spilo-16` → `16`) or of a Percona `…-ppg16-postgres` tag, and the
 * version in a Software Collections name (`rhel9/mysql-80` → `8.0`; its tag
 * is the image build, never read). Null for `latest`, a digest-only
 * reference or a tag that does not start with a number.
 */
export function parseImageVersion(image: unknown): string | null {
  const split: SplitImageReference | null = splitImageReference(image);
  if (!split) {
    return null;
  }

  if (split.nameVersion) {
    return split.nameVersion;
  }

  const spilo: RegExpExecArray | null = SPILO_IMAGE_REGEX.exec(
    basenameOf(split.repository),
  );
  if (spilo) {
    return spilo[1]!;
  }

  if (!split.tag) {
    return null;
  }

  const percona: RegExpExecArray | null = PERCONA_POSTGRESQL_TAG_REGEX.exec(
    split.tag,
  );
  if (percona) {
    return percona[1]!;
  }

  const version: RegExpExecArray | null = IMAGE_TAG_VERSION_REGEX.exec(
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
  nonServer: boolean;
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

// Owner kinds whose name conventionally is also a Service's name.
const SERVICE_NAMED_OWNER_KINDS: ReadonlySet<string> = new Set<string>([
  "StatefulSet",
  "Deployment",
  "DaemonSet",
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

/*
 * False for a container whose image is never the database process itself:
 * a mesh proxy / log shipper, or an image excluded as a pooler, exporter,
 * admin UI, backup tool or companion (Sentinel, agent). An "operator" image
 * still could be — Percona ships its postgres operand in one.
 */
function couldBeDatabaseProcess(container: ContainerView): boolean {
  const classification: ImageClassification = container.classification;
  if (classification.kind === "infrastructure-sidecar") {
    return false;
  }
  return !(
    classification.kind === "excluded" &&
    (NON_MEMBER_IMAGE_REASONS.has(classification.reason) ||
      classification.reason === "companion")
  );
}

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
      // Labels are compared lowercased.
      map.set(chartName.toLowerCase(), descriptor.system);
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

/**
 * Label keys whose presence makes an operator rule look at a pod. With
 * DATABASE_WORKLOAD_NAME_LABEL_VALUES this is the whole trigger surface of
 * the label rules, so a store can pre-select the pods worth classifying
 * (`labels ?| keys OR lower(labels->>'app.kubernetes.io/name') = ANY(values)`)
 * — see hasDatabaseWorkloadLabels, which is the same test in TypeScript.
 */
export const DATABASE_OPERATOR_LABEL_KEYS: ReadonlyArray<string> = [
  "cnpg.io/cluster",
  "cluster-name",
  "postgres-operator.crunchydata.com/cluster",
  "mysql.oracle.com/cluster",
  "elasticsearch.k8s.elastic.co/cluster-name",
  "clickhouse.altinity.com/chi",
  "cassandra.datastax.com/cluster",
  "planetscale.com/cluster",
];

// Lowercase `app.kubernetes.io/name` values a chart / Percona rule matches.
export const DATABASE_WORKLOAD_NAME_LABEL_VALUES: ReadonlyArray<string> =
  Array.from(
    new Set<string>([
      ...Array.from(CHART_SYSTEM_BY_NAME.keys()),
      ...Array.from(PERCONA_SYSTEM_BY_NAME.keys()),
    ]),
  ).sort();

/**
 * True when a pod's labels could make an operator / chart rule match — the
 * TypeScript twin of the store-side pre-filter over
 * DATABASE_OPERATOR_LABEL_KEYS and DATABASE_WORKLOAD_NAME_LABEL_VALUES.
 */
export function hasDatabaseWorkloadLabels(labels: unknown): boolean {
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    return false;
  }
  const record: Record<string, unknown> = labels as Record<string, unknown>;
  for (const key of DATABASE_OPERATOR_LABEL_KEYS) {
    if (hasLabel(record, key)) {
      return true;
    }
  }
  const name: string | null = labelValue(record, "app.kubernetes.io/name");
  return (
    name !== null &&
    DATABASE_WORKLOAD_NAME_LABEL_VALUES.includes(name.toLowerCase())
  );
}

/*
 * Operator / chart label rules, most specific first. Each returns a match,
 * "skip" (the pod belongs to a database cluster but is not a member — a
 * pooler, a backup repo host), or null (not this operator). Label keys and
 * Service naming follow each operator's documented conventions, including
 * the proxy / pooler Services clients usually connect through.
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
      serviceNames: [
        cluster,
        `${cluster}-repl`,
        `${cluster}-pooler`,
        `${cluster}-pooler-repl`,
      ],
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
      hasLabel(
        labels,
        "postgres-operator.crunchydata.com/pgbackrest-dedicated",
      ) ||
      hasLabel(labels, "postgres-operator.crunchydata.com/pgadmin")
    ) {
      return "skip";
    }
    return {
      operator: "crunchy",
      system: "postgresql",
      clusterName: cluster,
      role: roleFrom(role),
      serviceNames: [
        `${cluster}-primary`,
        `${cluster}-replicas`,
        `${cluster}-ha`,
        `${cluster}-pgbouncer`,
      ],
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
      serviceNames.push(
        `${instance}-pxc`,
        `${instance}-haproxy`,
        `${instance}-haproxy-replicas`,
        `${instance}-proxysql`,
      );
    } else if (normalizedName === "percona-server") {
      serviceNames.push(
        `${instance}-mysql`,
        `${instance}-mysql-primary`,
        `${instance}-haproxy`,
        `${instance}-router`,
      );
    } else {
      const replicaSet: string | null = labelValue(
        labels,
        "app.kubernetes.io/replset",
      );
      if (replicaSet) {
        serviceNames.push(`${instance}-${replicaSet}`);
      }
      serviceNames.push(`${instance}-mongos`);
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
    const cluster: string | null = labelValue(
      labels,
      "mysql.oracle.com/cluster",
    );
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
    const type: string | null = labelValue(
      labels,
      "common.k8s.elastic.co/type",
    );
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
      serviceNames: datacenter
        ? [
            `${cluster}-${datacenter}-service`,
            `${cluster}-${datacenter}-all-pods-service`,
          ]
        : [],
      evidence: `label:cassandra.datastax.com/cluster=${cluster}`,
    };
  },

  /*
   * The Vitess operator (PlanetScale). It runs every component on the same
   * `vitess/lite` image, so only `planetscale.com/component` tells them
   * apart. The database clients connect to is vtgate, speaking MySQL; the
   * vttablets (each with its own mysqld), vtctld, vtorc, vtbackup, vtadmin,
   * the etcd lockserver and the backup-storage subcontroller are parts of
   * the VitessCluster, not members. vtgate Services carry a hash suffix
   * (`<cluster>-vtgate-<hash>`), so none are guessed: the owner
   * Deployment's name is added, as for any Deployment.
   */
  (labels: Record<string, unknown>): OperatorRuleResult => {
    const cluster: string | null = labelValue(
      labels,
      "planetscale.com/cluster",
    );
    if (!cluster) {
      return null;
    }
    const component: string | null = labelValue(
      labels,
      "planetscale.com/component",
    );
    if (!component || component.toLowerCase() !== "vtgate") {
      return "skip";
    }
    return {
      operator: "vitess-operator",
      system: "vitess",
      clusterName: cluster,
      role: null,
      serviceNames: [],
      evidence: `label:planetscale.com/cluster=${cluster}`,
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
     * contains the chart name, else `${release}-${chart}`. A
     * `fullnameOverride` breaks the guess; the owner StatefulSet's name and
     * its headless Service (added for every pod) still name the real ones.
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
      operator: managedBy && managedBy.toLowerCase() === "helm" ? "helm" : null,
      system,
      clusterName: fullName,
      role: roleFrom(component),
      serviceNames,
      evidence: `label:app.kubernetes.io/name=${chartName}`,
    };
  },
];

function readPorts(declaredPorts: unknown): Array<number> {
  const ports: Array<number> = [];
  if (!Array.isArray(declaredPorts)) {
    return ports;
  }
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
  return ports;
}

/*
 * Reads ONLY name, image, declared ports and what command/args run —
 * never `env` (see the file header), never by spreading the container
 * object.
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

    const imageText: string | null =
      typeof image === "string" && image.trim() ? image.trim() : null;

    views.push({
      name: typeof name === "string" ? name.trim() : "",
      image: imageText,
      ports: readPorts((container as { ports?: unknown }).ports),
      nonServer: isNonServerCommand({
        command: (container as { command?: Array<string | null> }).command,
        args: (container as { args?: Array<string | null> }).args,
      }),
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

/*
 * A database container with one unrecognised neighbour is still a database
 * pod when the evidence says so on its own: a StatefulSet (the shape
 * databases are deployed in, not apps with a cache sidecar) whose database
 * container declares its engine's default port. A log shipper or backup
 * agent nobody has catalogued yet must not hide a Postgres StatefulSet.
 */
function toleratesUnknownNeighbour(data: {
  ownerKind: string | null;
  databaseContainer: ContainerView;
  system: string;
  unknownNeighbours: number;
}): boolean {
  if (data.unknownNeighbours !== 1 || data.ownerKind !== "StatefulSet") {
    return false;
  }
  const defaultPort: number | null = getDefaultDatabasePort(data.system);
  return (
    defaultPort !== null && data.databaseContainer.ports.includes(defaultPort)
  );
}

/**
 * The database a Kubernetes pod runs, or null. Operator / chart labels are
 * consulted first (they name the cluster: workloadKind "Cluster"); otherwise
 * the first container whose image is a database, provided no other
 * container is an unrecognised application (a DB sidecar in an app pod is
 * not a database — one unknown neighbour is tolerated in a StatefulSet whose
 * database container declares the engine's default port). Batch pods,
 * finished pods, client / debug runs, owner-less pods declaring no port and
 * non-member pods of a database cluster (poolers, routers, exporters,
 * backup repos) are null.
 */
export function classifyKubernetesPod(
  pod: KubernetesPodLike,
  extra?: {
    // StatefulSet name → its spec.serviceName (the headless Service).
    statefulSetServiceNames?: Record<string, string> | null | undefined;
  },
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
  const ownerKind: string | null = owner ? ownerWorkload.workloadKind : null;
  const ownerName: string | null = owner ? ownerWorkload.workloadName : null;

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

    /*
     * A chart's test hook or a debug pod is labelled like the cluster but
     * only runs a client, and a member whose database container is held
     * asleep (diagnostic mode) may still run its exporter, pooler or mesh
     * proxy: with no running container left that could be the server, it
     * is not a member — a sidecar's image, version and ports never stand in
     * for the database's.
     */
    const serverContainers: Array<ContainerView> = containers.filter(
      (container: ContainerView): boolean => {
        return !container.nonServer && couldBeDatabaseProcess(container);
      },
    );
    if (containers.length > 0 && serverContainers.length === 0) {
      return null;
    }

    const databaseContainer: ContainerView | null =
      serverContainers.find((container: ContainerView): boolean => {
        return (
          container.classification.kind === "database" &&
          container.classification.system === match.system
        );
      }) ||
      serverContainers.find((container: ContainerView): boolean => {
        return container.classification.kind === "database";
      }) ||
      serverContainers.find((container: ContainerView): boolean => {
        return container.classification.kind === "unknown";
      }) ||
      serverContainers[0] ||
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
      ownerKind,
      ownerName,
      podName,
      containerName: databaseContainer?.name || "",
      image: databaseContainer?.image || null,
      version: parseImageVersion(databaseContainer?.image),
      ports: databaseContainer ? [...databaseContainer.ports] : [],
      operator: match.operator,
      role: match.role,
      serviceNames: uniqueNonEmpty([
        workloadName,
        ...match.serviceNames,
        ownerKind && SERVICE_NAMED_OWNER_KINDS.has(ownerKind) && ownerName
          ? ownerName
          : "",
        headlessServiceName || "",
      ]),
      headlessServiceName,
      evidence,
    };
  }

  // 2. Container images: the first database container that runs a server.
  const databaseContainer: ContainerView | undefined = containers.find(
    (container: ContainerView): boolean => {
      return (
        container.classification.kind === "database" && !container.nonServer
      );
    },
  );
  if (
    !databaseContainer ||
    databaseContainer.classification.kind !== "database"
  ) {
    return null;
  }
  const system: string = databaseContainer.classification.system;

  const unknownNeighbours: number = containers.filter(
    (container: ContainerView): boolean => {
      return (
        container !== databaseContainer &&
        container.classification.kind === "unknown"
      );
    },
  ).length;
  if (
    unknownNeighbours > 0 &&
    !toleratesUnknownNeighbour({
      ownerKind,
      databaseContainer,
      system,
      unknownNeighbours,
    })
  ) {
    return null;
  }

  /*
   * An owner-less pod is what `kubectl run` makes — usually a one-off client
   * session in a database image. A server run that way declares its port.
   */
  if (!owner && databaseContainer.ports.length === 0) {
    return null;
  }

  return {
    system,
    namespace,
    workloadKind: ownerWorkload.workloadKind,
    workloadName: ownerWorkload.workloadName,
    ownerKind,
    ownerName,
    podName,
    containerName: databaseContainer.name,
    image: databaseContainer.image,
    version: parseImageVersion(databaseContainer.image),
    ports: [...databaseContainer.ports],
    operator: null,
    role: null,
    serviceNames: uniqueNonEmpty([
      ownerWorkload.workloadName,
      headlessServiceName || "",
    ]),
    headlessServiceName,
    evidence: [`image:${databaseContainer.image}`],
  };
}

/**
 * The Service a CloudNativePG pooler pod backs (the Pooler's name), for
 * attachPoolerServices; null for any other pod. Pooler pods are never
 * members (classifyKubernetesPod is null for them), but applications
 * connect through their Service.
 */
export function classifyKubernetesPoolerPod(
  pod: KubernetesPodLike,
): KubernetesPoolerService | null {
  if (!pod || typeof pod !== "object") {
    return null;
  }
  if (
    typeof pod.phase === "string" &&
    SKIPPED_POD_PHASES.has(pod.phase.trim().toLowerCase())
  ) {
    return null;
  }
  const labels: Record<string, unknown> =
    pod.labels && typeof pod.labels === "object" ? pod.labels : {};
  const cluster: string | null = labelValue(labels, "cnpg.io/cluster");
  const pooler: string | null = labelValue(labels, "cnpg.io/poolerName");
  if (!cluster || !pooler) {
    return null;
  }
  return {
    system: "postgresql",
    namespace:
      typeof pod.namespaceKey === "string" ? pod.namespaceKey.trim() : "",
    clusterName: cluster,
    serviceName: pooler,
  };
}

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * The engine of a database whose members report several engines of one
 * family: the most specific of them (getMoreSpecificDatabaseSystem). A
 * StatefulSet mid-rollout from a redis image to a valkey image is ONE
 * Valkey database, as its family-keyed identifier
 * (buildWorkloadDatabaseServerIdentifier) already says. The engines are
 * folded most-reported first, then by name, so member order never changes
 * the answer; of two forks that do not refine each other (valkey and keydb)
 * the more reported one stays, the first by name on a tie. Null when no
 * engine is given.
 */
export function pickMostSpecificDatabaseSystem(
  systems: Array<string>,
): string | null {
  const counts: Map<string, number> = new Map<string, number>();

  for (const system of Array.isArray(systems) ? systems : []) {
    if (typeof system === "string" && system) {
      counts.set(system, (counts.get(system) || 0) + 1);
    }
  }

  const ordered: Array<string> = Array.from(counts.keys()).sort(
    (a: string, b: string): number => {
      return (
        (counts.get(b) || 0) - (counts.get(a) || 0) || compareStrings(a, b)
      );
    },
  );

  let result: string | null = null;

  for (const system of ordered) {
    result = getMoreSpecificDatabaseSystem(result, system);
  }

  return result;
}

/**
 * Fold per-pod candidates into one entry per database workload
 * (engine FAMILY + namespace + workloadKind + workloadName - the parts of
 * its family-keyed identifier). The group's engine is the most specific its
 * members report (pickMostSpecificDatabaseSystem). Member pods, ports,
 * Service names and owner workloads are unioned; image and version come
 * from the primary member running that engine when one is known, else from
 * the first such pod by name. Deterministic: groups and pod names are
 * sorted.
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
      getDatabaseSystemFamily(candidate.system) || candidate.system,
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
    const system: string =
      pickMostSpecificDatabaseSystem(
        sorted.map((member: KubernetesDatabaseCandidate): string => {
          return member.system;
        }),
      ) || first.system;

    // Image and version describe the engine the group is shown as.
    const runningSystem: Array<KubernetesDatabaseCandidate> = sorted.filter(
      (member: KubernetesDatabaseCandidate): boolean => {
        return member.system === system;
      },
    );
    const pool: Array<KubernetesDatabaseCandidate> =
      runningSystem.length > 0 ? runningSystem : sorted;
    const representative: KubernetesDatabaseCandidate =
      pool.find((member: KubernetesDatabaseCandidate): boolean => {
        return member.role === "primary";
      }) || pool[0]!;

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

    const podServiceNames: Array<{ podName: string; serviceName: string }> = [];
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

    const ownerWorkloads: Array<{ kind: string; name: string }> = [];
    for (const member of sorted) {
      if (
        member.ownerKind &&
        member.ownerName &&
        !ownerWorkloads.some(
          (entry: { kind: string; name: string }): boolean => {
            return (
              entry.kind === member.ownerKind && entry.name === member.ownerName
            );
          },
        )
      ) {
        ownerWorkloads.push({ kind: member.ownerKind, name: member.ownerName });
      }
    }
    ownerWorkloads.sort(
      (
        a: { kind: string; name: string },
        b: { kind: string; name: string },
      ): number => {
        return compareStrings(a.kind, b.kind) || compareStrings(a.name, b.name);
      },
    );

    groups.push({
      system,
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
      ownerWorkloads,
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

/**
 * Add each pooler's Service to the operator cluster it pools (same engine
 * family, namespace and cluster name). Returns new group objects; a pooler
 * whose cluster has no group this run is dropped.
 */
export function attachPoolerServices(
  groups: Array<KubernetesDatabaseGroup>,
  poolers: Array<KubernetesPoolerService>,
): Array<KubernetesDatabaseGroup> {
  if (!Array.isArray(groups)) {
    return [];
  }
  const list: Array<KubernetesPoolerService> = Array.isArray(poolers)
    ? poolers
    : [];

  return groups.map(
    (group: KubernetesDatabaseGroup): KubernetesDatabaseGroup => {
      if (group.workloadKind !== "Cluster") {
        return group;
      }
      const extra: Array<string> = list
        .filter((pooler: KubernetesPoolerService): boolean => {
          return (
            Boolean(pooler) &&
            isSameDatabaseFamily(pooler.system, group.system) &&
            pooler.namespace === group.namespace &&
            pooler.clusterName === group.workloadName
          );
        })
        .map((pooler: KubernetesPoolerService): string => {
          return pooler.serviceName;
        })
        .sort(compareStrings);
      if (extra.length === 0) {
        return group;
      }
      return {
        ...group,
        serviceNames: uniqueNonEmpty([...group.serviceNames, ...extra]),
      };
    },
  );
}

// ---- Docker / Podman containers -------------------------------------------

/*
 * Every container label classifyContainer reads: the Swarm / Compose
 * service that groups replicas, and the marks of Testcontainers runs,
 * `docker compose run` one-offs and kubelet-managed containers. The Docker
 * and Podman agents copy exactly these onto their docker_stats metrics as
 * resource attributes (`container_labels_to_metric_labels`, same names),
 * and the metrics ingest stores them as the container row's labels — the
 * one inventory path every agent version runs.
 */
export const CONTAINER_CLASSIFIER_LABEL_KEYS: ReadonlyArray<string> = [
  "com.docker.compose.oneoff",
  "com.docker.compose.project",
  "com.docker.compose.service",
  "com.docker.swarm.service.name",
  "io.kubernetes.pod.name",
  "io.podman.compose.project",
  "io.podman.compose.service",
  "org.testcontainers",
  "org.testcontainers.sessionId",
];

// A Swarm task id: 25 lowercase alphanumerics (`stack_db.1.<task id>`).
const SWARM_TASK_ID_REGEX: RegExp = /^[a-z0-9]{25}$/;
const SWARM_SLOT_REGEX: RegExp = /^(?:\d+|[a-z0-9]{25})$/;

/*
 * Containers that are never a long-lived database server of their own:
 * Testcontainers runs (CI), `docker compose run` one-offs, and containers
 * the kubelet manages on a Docker node (the Kubernetes path discovers those
 * as pods).
 */
function isEphemeralOrManagedContainer(
  labels: Record<string, unknown>,
): boolean {
  for (const key of Object.keys(labels)) {
    if (key === "org.testcontainers" || key.startsWith("org.testcontainers.")) {
      return true;
    }
  }
  const oneOff: string | null = labelValue(labels, "com.docker.compose.oneoff");
  if (oneOff && oneOff.toLowerCase() === "true") {
    return true;
  }
  return (
    hasLabel(labels, "io.kubernetes.pod.name") ||
    hasLabel(labels, "io.kubernetes.container.name")
  );
}

/*
 * The Swarm service a task container belongs to, from its name alone
 * (`stack_db.1.<25-char task id>`, `stack_db.<node id>.<task id>`) — for
 * rows whose labels have not been inventoried.
 */
function swarmServiceFromTaskName(containerName: string): string | null {
  const parts: Array<string> = containerName.split(".");
  if (parts.length < 3) {
    return null;
  }
  const taskId: string = parts[parts.length - 1]!;
  const slot: string = parts[parts.length - 2]!;
  if (!SWARM_TASK_ID_REGEX.test(taskId) || !SWARM_SLOT_REGEX.test(slot)) {
    return null;
  }
  const service: string = parts.slice(0, -2).join(".");
  return service || null;
}

/*
 * What groups a container's replicas: its Swarm service, its Compose
 * project + service (Docker Compose and podman-compose both stamp
 * `com.docker.compose.*`; podman-compose also `io.podman.compose.*`), else
 * the container name exactly as it is — never a guessed-away suffix, since
 * `redis-6379` and `redis-6380` or `pg-14` and `pg-16` are different
 * servers. The kind says which of the three it is.
 */
function containerWorkload(
  containerName: string,
  labels: Record<string, unknown>,
): { workloadKind: ContainerWorkloadKind; workloadName: string } {
  const swarmService: string | null =
    labelValue(labels, "com.docker.swarm.service.name") ||
    swarmServiceFromTaskName(containerName);
  if (swarmService) {
    return {
      workloadKind: ContainerWorkloadKind.SwarmService,
      workloadName: swarmService,
    };
  }

  const project: string | null =
    labelValue(labels, "com.docker.compose.project") ||
    labelValue(labels, "io.podman.compose.project");
  const service: string | null =
    labelValue(labels, "com.docker.compose.service") ||
    labelValue(labels, "io.podman.compose.service");
  if (project && service) {
    return {
      workloadKind: ContainerWorkloadKind.ComposeService,
      workloadName: `${project}-${service}`,
    };
  }

  return {
    workloadKind: ContainerWorkloadKind.Container,
    workloadName: containerName,
  };
}

/**
 * The database a Docker / Podman container runs, or null. The workload is
 * the Swarm service or Compose service the container belongs to (so its
 * replicas group together), else the container's own name, and its kind
 * says which. Testcontainers runs, `docker compose run` one-offs and
 * kubelet-managed containers are null.
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

  const labels: Record<string, unknown> =
    container.labels &&
    typeof container.labels === "object" &&
    !Array.isArray(container.labels)
      ? container.labels
      : {};

  if (isEphemeralOrManagedContainer(labels)) {
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
  const workload: {
    workloadKind: ContainerWorkloadKind;
    workloadName: string;
  } = containerWorkload(containerName, labels);

  return {
    system: descriptor ? descriptor.system : classification.system,
    workloadKind: workload.workloadKind,
    workloadName: workload.workloadName,
    containerName,
    version: parseImageVersion(container.imageName),
  };
}
