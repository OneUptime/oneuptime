import {
  AccountsRoute,
  AdminDashboardRoute,
  DashboardRoute,
  AppApiRoute,
  StatusPageApiRoute,
  DocsRoute,
  HomeRoute,
} from "../ServiceRoute";
import BillingConfig from "./BillingConfig";
import { getDistributedDdlTaskTimeoutSeconds } from "./Utils/AnalyticsDatabase/ClusterConfig";
import Protocol from "../Types/API/Protocol";
import URL from "../Types/API/URL";
import Route from "../Types/API/Route";
import SubscriptionPlan from "../Types/Billing/SubscriptionPlan";
import Email from "../Types/Email";
import { JSONObject } from "../Types/JSON";
import LIMIT_MAX from "../Types/Database/LimitMax";
import ObjectID from "../Types/ObjectID";
import Port from "../Types/Port";
import Hostname from "../Types/API/Hostname";
import ConfigLogLevel from "./Types/ConfigLogLevel";

export const getAllEnvVars: () => JSONObject = (): JSONObject => {
  return process.env;
};

const FRONTEND_ENV_ALLOW_LIST: Array<string> = [
  "NODE_ENV",
  "HTTP_PROTOCOL",
  "HOST",
  "BILLING_ENABLED",
  "BILLING_PUBLIC_KEY",
  "IS_ENTERPRISE_EDITION",
  "STRIPE_PUBLIC_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_SUBJECT",
  "VERSION",
  "STATUS_PAGE_CNAME_RECORD",
  "DASHBOARD_CNAME_RECORD",
  "ANALYTICS_KEY",
  "ANALYTICS_HOST",
  "GIT_SHA",
  "APP_VERSION",
  "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
  "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
  "DISABLE_TELEMETRY",
  "SLACK_APP_CLIENT_ID",
  "MICROSOFT_TEAMS_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_NAME",
  "CAPTCHA_ENABLED",
  "CAPTCHA_SITE_KEY",
  "INBOUND_EMAIL_DOMAIN",
];

const FRONTEND_ENV_ALLOW_PREFIXES: Array<string> = [
  "SUBSCRIPTION_PLAN_",
  "PUBLIC_",
];

export const getFrontendEnvVars: () => JSONObject = (): JSONObject => {
  const frontendEnv: JSONObject = {};

  for (const key of Object.keys(process.env)) {
    const shouldInclude: boolean =
      FRONTEND_ENV_ALLOW_LIST.includes(key) ||
      FRONTEND_ENV_ALLOW_PREFIXES.some((prefix: string) => {
        return key.startsWith(prefix);
      });

    if (!shouldInclude) {
      continue;
    }

    const value: string | undefined = process.env[key];

    if (typeof value !== "undefined") {
      frontendEnv[key] = value;
    }
  }

  return frontendEnv;
};

const parsePositiveNumberFromEnv: (
  envKey: string,
  fallback: number,
) => number = (envKey: string, fallback: number): number => {
  const rawValue: string | undefined = process.env[envKey];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue: number = parseFloat(rawValue);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
};

/*
 * Like parsePositiveNumberFromEnv, but for settings that count things
 * (requests, seconds): "1.5" or "0" are misconfigurations and fall back to the
 * default rather than being rounded into something the operator did not ask
 * for.
 */
const parsePositiveIntegerFromEnv: (
  envKey: string,
  fallback: number,
) => number = (envKey: string, fallback: number): number => {
  const rawValue: string | undefined = process.env[envKey];

  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }

  const parsedValue: number = Number(rawValue.trim());

  if (
    !Number.isFinite(parsedValue) ||
    !Number.isInteger(parsedValue) ||
    parsedValue <= 0
  ) {
    return fallback;
  }

  return parsedValue;
};

/*
 * parsePositiveIntegerFromEnv with a ceiling the rest of the system can
 * actually honour. A configured value the app would silently fail to enforce
 * is worse than a visibly clamped one -- so this clamps rather than trusting
 * the operator, and every call site documents WHY its ceiling exists.
 */
const parseClampedIntegerFromEnv: (
  envKey: string,
  fallback: number,
  ceiling: number,
) => number = (envKey: string, fallback: number, ceiling: number): number => {
  return Math.min(parsePositiveIntegerFromEnv(envKey, fallback), ceiling);
};

export const IsBillingEnabled: boolean = BillingConfig.IsBillingEnabled;
export const BillingPublicKey: string = BillingConfig.BillingPublicKey;
export const BillingPrivateKey: string = BillingConfig.BillingPrivateKey;
export const BillingWebhookSecret: string = BillingConfig.BillingWebhookSecret;

export const DatabaseHost: Hostname = Hostname.fromString(
  process.env["DATABASE_HOST"] || "postgres",
);

export const LetsEncryptNotificationEmail: Email = Email.fromString(
  process.env["LETS_ENCRYPT_NOTIFICATION_EMAIL"] || "notifications@example.com",
);

export const LetsEncryptAccountKey: string =
  process.env["LETS_ENCRYPT_ACCOUNT_KEY"] || "";

export const DatabasePort: Port = new Port(
  process.env["DATABASE_PORT"] || "5432",
);

export const DatabaseUsername: string =
  process.env["DATABASE_USERNAME"] || "postgres";

export const DatabasePassword: string =
  process.env["DATABASE_PASSWORD"] || "password";

export const DatabaseName: string =
  process.env["DATABASE_NAME"] || "oneuptimedb";

export const DatabaseSslCa: string | undefined =
  process.env["DATABASE_SSL_CA"] || undefined;

export const DatabaseSslKey: string | undefined =
  process.env["DATABASE_SSL_KEY"] || undefined;

export const DatabaseSslCert: string | undefined =
  process.env["DATABASE_SSL_CERT"] || undefined;

export const DatabaseRejectUnauthorized: boolean =
  process.env["DATABASE_SSL_REJECT_UNAUTHORIZED"] === "true";

export const ShouldDatabaseSslEnable: boolean = Boolean(
  DatabaseSslCa || (DatabaseSslCert && DatabaseSslKey),
);

/*
 * Postgres pool size per API/Worker node. TypeORM's default is 10 which
 * starves the API under any meaningful load — pick a number that, when
 * multiplied by the number of running Node processes, stays under the
 * Postgres server's `max_connections` (100 on a stock PostgreSQL cluster; the
 * OneUptime Helm chart ships 500, or front the DB with the chart's pgbouncer).
 */
export const MaxPostgresConnections: number = parseInt(
  process.env["DATABASE_MAX_OPEN_CONNECTIONS"] || "50",
  10,
);

/*
 * Postgres-side statement timeout (ms). Caps the wall-clock time of any
 * single SQL statement. Without this, a single runaway query can pin a
 * connection forever and starve the pool.
 */
export const PostgresStatementTimeoutMs: number = parseInt(
  process.env["DATABASE_STATEMENT_TIMEOUT_MS"] || "30000",
  10,
);

/*
 * Postgres-side lock timeout (ms). Caps how long a statement will WAIT for a
 * row/table lock before giving up — distinct from statement_timeout, which
 * caps total execution.
 *
 * Without it, contention on a hot row degrades into a strictly-ordered queue:
 * every waiter pins a backend for the sum of everyone ahead of it. That is the
 * row-lock convoy that took production down — 892 connections parked on locks,
 * the tail waiting 3.7 hours — and no amount of database capacity changes it,
 * because the queue itself is the failure. A short lock_timeout converts an
 * unbounded wait into a fast, retryable error.
 *
 * Must stay well below statement_timeout so a lock wait surfaces as
 * `lock_not_available` (55P03) rather than a generic statement timeout — the
 * two want very different handling.
 */
export const PostgresLockTimeoutMs: number = parseInt(
  process.env["DATABASE_LOCK_TIMEOUT_MS"] || "3000",
  10,
);

/*
 * Node-postgres client-side query timeout (ms). Belt-and-braces for the
 * server-side statement_timeout — fires even if the connection has gone
 * silent or the server-side timeout doesn't kick in.
 *
 * Deliberately LONGER than statement_timeout. These two used to be equal, and
 * because the client timer starts before the packet even reaches the backend,
 * the client always won by a round trip — so the app never observed Postgres's
 * real SQLSTATE and, worse, the client-side timeout only ABANDONS the query:
 * the backend keeps running and keeps its place in the lock queue. Letting the
 * server win means contention is cancelled server-side instead of accumulating
 * invisibly behind a pooler.
 */
export const PostgresQueryTimeoutMs: number = parseInt(
  process.env["DATABASE_QUERY_TIMEOUT_MS"] ||
    String(PostgresStatementTimeoutMs + 5000),
  10,
);

/*
 * Postgres-side idle-in-transaction timeout (ms). Kills connections that
 * are stuck holding row locks inside a BEGIN without committing.
 */
export const PostgresIdleInTransactionTimeoutMs: number = parseInt(
  process.env["DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS"] || "60000",
  10,
);

/*
 * pg-pool acquire timeout (ms). How long a query waits for a free
 * connection before failing. Without this, requests pile up invisibly
 * when the pool is exhausted.
 */
export const PostgresConnectionAcquireTimeoutMs: number = parseInt(
  process.env["DATABASE_CONNECTION_TIMEOUT_MS"] || "5000",
  10,
);

/*
 * pg-pool idle connection timeout (ms). Closes connections that have
 * been sitting unused for this long, freeing server-side slots.
 */
export const PostgresIdleTimeoutMs: number = parseInt(
  process.env["DATABASE_IDLE_TIMEOUT_MS"] || "30000",
  10,
);

/*
 * TCP keepalive initial delay (ms) for Postgres sockets. When the client
 * process dies ungracefully (SIGKILL, OOM, crash) or a network partition cuts
 * the link, Postgres has no way to know the client is gone and the backend
 * lingers as an orphaned connection — by default up to the OS
 * tcp_keepalive_time (~2h on Linux). Enabling socket keepalive makes
 * node-postgres probe the peer so dead connections are detected and torn down
 * promptly.
 */
export const PostgresKeepAliveInitialDelayMs: number = parseInt(
  process.env["DATABASE_KEEPALIVE_INITIAL_DELAY_MS"] || "10000",
  10,
);

/*
 * Postgres-side idle-session timeout (ms). Server-side backstop for orphaned
 * connections: the server terminates any session that sits idle (outside a
 * transaction) longer than this. MUST be larger than the pool's
 * idleTimeoutMillis (PostgresIdleTimeoutMs) so the pool reaps its own healthy
 * idle connections first and only truly-orphaned sessions (client gone) ever
 * hit this. Set to 0 to disable. Requires Postgres 14+.
 */
export const PostgresIdleSessionTimeoutMs: number = parseInt(
  process.env["DATABASE_IDLE_SESSION_TIMEOUT_MS"] || "300000",
  10,
);

/*
 * TypeORM slow-query log threshold (ms). Any query exceeding this is
 * logged so we can find offenders in production without per-query
 * tracing. Set to 0 to disable.
 */
export const PostgresSlowQueryLogThresholdMs: number = parseInt(
  process.env["DATABASE_SLOW_QUERY_LOG_THRESHOLD_MS"] || "1000",
  10,
);

export const EncryptionSecret: ObjectID = new ObjectID(
  process.env["ENCRYPTION_SECRET"] || "secret",
);

/*
 * The ENCRYPTION_SECRET values that ship in this repository, and are therefore
 * as public as the source tree itself.
 *
 * "secret" is the fallback above. "please-change-this-to-random-value" is what
 * `config.example.env` sets, and the documented Docker Compose install is
 * `cp config.example.env config.env` (README) with
 * `ENCRYPTION_SECRET: ${ENCRYPTION_SECRET}` passed straight through by
 * docker-compose.base.yml -- so it is the key an install that follows the docs
 * actually runs with unless the operator edits it. Home/Scripts/Install.sh
 * randomizes the placeholders, but nothing in the documented compose path
 * calls it, and Scripts/Install/MergeEnvTemplate.js carries the placeholder
 * forward on upgrade. The Helm chart is unaffected: it generates a random
 * secret when `encryptionSecret` is left empty.
 */
export const InsecureEncryptionSecretValues: Array<string> = [
  "secret",
  "please-change-this-to-random-value",
];

/*
 * The prefix every placeholder in config.example.env starts with. Flagging it
 * catches a partially edited placeholder ("please-change-this-to-random-value-2")
 * as well as the exact strings above.
 */
export const InsecureEncryptionSecretPrefix: string = "please-change-this";

/*
 * True when the install is encrypting columns with a value the repository
 * ships rather than one the operator chose.
 *
 * Every `@TableColumn({ encrypted: true })` value -- OAuth tokens, SMTP
 * passwords, the on-call calendar feed tokens -- is AES-encrypted with
 * ENCRYPTION_SECRET, so leaving it unset or at one of the shipped placeholders
 * means anyone who can read a database dump can read every one of those
 * columns with a key that is public on GitHub. Nothing refuses to start over
 * it (that would take down an existing install on upgrade), but the boot log
 * says so loudly; see EncryptionSecretWarning and StartServer.init.
 *
 * The comparison is case-sensitive on purpose: the encryption key is, and the
 * warning is about the exact values an attacker would try first. Any other
 * weak key is the operator's own choice.
 */
export const IsEncryptionSecretInsecure: boolean = ((): boolean => {
  const rawValue: string | undefined = process.env["ENCRYPTION_SECRET"];

  if (rawValue === undefined) {
    return true;
  }

  const value: string = rawValue.trim();

  return (
    value === "" ||
    InsecureEncryptionSecretValues.includes(value) ||
    value.startsWith(InsecureEncryptionSecretPrefix)
  );
})();

/*
 * The boot warning itself, or null when the secret is fine. EnvironmentConfig
 * cannot log it directly -- Logger imports LogLevel from this module, so
 * importing Logger here would be circular -- which is why the message is
 * exported and the process entrypoint emits it.
 */
export const EncryptionSecretWarning: string | null = IsEncryptionSecretInsecure
  ? 'ENCRYPTION_SECRET is unset or still one of the placeholder values shipped in this repository ("secret", or the "please-change-this-to-random-value" that config.example.env sets). Every encrypted database column (integration tokens, SMTP credentials, on-call calendar feed tokens) is protected only by a key that is public in the OneUptime repository. Set ENCRYPTION_SECRET to a long random value in config.env (or the Helm chart) before storing anything sensitive. Note that changing it later makes values encrypted with the old key unreadable.'
  : null;

export const OpenSourceDeploymentWebhookUrl: string =
  process.env["OPEN_SOURCE_DEPLOYMENT_WEBHOOK_URL"] || "";

export const AirtableApiKey: string = process.env["AIRTABLE_API_KEY"] || "";

export const AirtableBaseId: string = process.env["AIRTABLE_BASE_ID"] || "";

export const ClusterKey: ObjectID = new ObjectID(
  process.env["ONEUPTIME_SECRET"] || "secret",
);

export const HasClusterKey: boolean = Boolean(process.env["ONEUPTIME_SECRET"]);

export const EnableQueueDashboard: boolean =
  process.env["ENABLE_QUEUE_DASHBOARD"] === "true";

export const QueueDashboardSecret: string =
  process.env["QUEUE_DASHBOARD_SECRET"] || "";

export const RegisterProbeKey: ObjectID = new ObjectID(
  process.env["REGISTER_PROBE_KEY"] || "secret",
);

export const HasRegisterProbeKey: boolean = Boolean(
  process.env["REGISTER_PROBE_KEY"],
);

export const AppApiHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_APP_HOSTNAME"] || "localhost"}:${
    process.env["APP_PORT"] || 80
  }`,
);

export const WorkerHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_APP_HOSTNAME"] || "localhost"}:${
    process.env["APP_PORT"] || 80
  }`,
);

export const WorkflowHostname: Hostname = WorkerHostname;

export const HomeHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_HOME_HOSTNAME"] || "localhost"}:${
    process.env["HOME_PORT"] || 80
  }`,
);

export const Env: string = process.env["NODE_ENV"] || "production";

// Redis does not require password.
export const RedisHostname: string = process.env["REDIS_HOST"] || "redis";
export const RedisPort: Port = new Port(process.env["REDIS_PORT"] || "6379");
export const RedisDb: number = Number(process.env["REDIS_DB"]) || 0;
export const RedisUsername: string = process.env["REDIS_USERNAME"] || "default";
export const RedisPassword: string =
  process.env["REDIS_PASSWORD"] || "password";

export const RedisTlsCa: string | undefined =
  process.env["REDIS_TLS_CA"] || undefined;

export const RedisTlsCert: string | undefined =
  process.env["REDIS_TLS_CERT"] || undefined;

export const RedisTlsKey: string | undefined =
  process.env["REDIS_TLS_KEY"] || undefined;

export const RedisTlsSentinelMode: boolean =
  process.env["REDIS_TLS_SENTINEL_MODE"] === "true";

export const ShouldRedisTlsEnable: boolean = Boolean(
  RedisTlsCa || (RedisTlsCert && RedisTlsKey),
);

export const RedisIPFamily: number = process.env["REDIS_IP_FAMILY"]
  ? Number(process.env["REDIS_IP_FAMILY"])
  : 4;

export const IsProduction: boolean =
  process.env["ENVIRONMENT"] === "production";

export const IsDevelopment: boolean =
  process.env["ENVIRONMENT"] === "development";

export const IsTest: boolean = process.env["ENVIRONMENT"] === "test";

export const SubscriptionPlans: Array<SubscriptionPlan> =
  SubscriptionPlan.getSubscriptionPlans(getAllEnvVars());

export const AnalyticsKey: string = process.env["ANALYTICS_KEY"] || "";
export const AnalyticsHost: string = process.env["ANALYTICS_HOST"] || "";

/*
 * Whether this deployment loads the Google Tag Manager container and pushes
 * marketing conversions into it.
 *
 * Billing being enabled is necessary — a self-hosted install must never load
 * googletagmanager.com — but it is not sufficient. CI runs the SaaS end-to-end
 * suite with BILLING_ENABLED forced to true, and those scripted registrations
 * fire a real `sign_up` into the production container: the key-events trigger
 * matches on the event name alone, with no hostname condition, and GA4 data
 * filters do not apply retroactively. This is the second condition, so an
 * environment can keep billing on and still stay out of the container.
 *
 * Defaults to on, so the hosted product needs no deploy change.
 */
export const GoogleTagManagerEnabled: boolean =
  IsBillingEnabled && process.env["GOOGLE_TAG_MANAGER_ENABLED"] !== "false";

/*
 * Outbound marketing conversion webhooks.
 *
 * OneUptime does not store conversions. Signups and plan
 * upgrades/downgrades are POSTed to this endpoint as they happen and kept
 * nowhere afterwards, so an unset URL means those moments are simply not
 * measured — nothing accumulates waiting for one to be configured.
 *
 * Both are required. The payload carries email addresses and campaign data,
 * so a URL set without a secret is refused rather than sent unsigned. The
 * secret is server-only and must never reach FRONTEND_ENV_ALLOW_LIST.
 */
export const MarketingWebhookUrl: string =
  process.env["MARKETING_WEBHOOK_URL"] || "";
export const MarketingWebhookSecret: string =
  process.env["MARKETING_WEBHOOK_SECRET"] || "";

export const DisableAutomaticIncidentCreation: boolean =
  process.env["DISABLE_AUTOMATIC_INCIDENT_CREATION"] === "true";

export const DisableAutomaticAlertCreation: boolean =
  process.env["DISABLE_AUTOMATIC_ALERT_CREATION"] === "true";

export const DisableTelemetryIngestion: boolean =
  process.env["DISABLE_TELEMETRY_INGESTION"] === "true";

/*
 * When true, this process does NOT register any BullMQ queue consumers
 * (the "api" role). Background jobs — telemetry ingestion processing, the
 * general Worker/cron jobs, Workflow runs and Runbook executions — are
 * instead drained by the dedicated "worker" deployment so heavy queue
 * processing never competes with API request handling on the same event
 * loop. Default false → this process consumes queues (backwards compatible
 * single-container behavior). The process still mounts ingest endpoints and
 * enqueues jobs; only consumption is gated.
 */
export const DisableQueueWorkers: boolean =
  process.env["DISABLE_QUEUE_WORKERS"] === "true";

/*
 * When "false", this process does NOT run schema or data migrations on boot.
 * Set on runtime pods (app/worker/nginx) when a dedicated one-shot migrate Job
 * (App/Migrate.ts) owns migrations instead, so the fleet's many replicas never
 * run them — which keeps boot DDL off pooled connections and, since the data
 * migration runner no longer takes an advisory lock, is also what keeps two
 * replicas from running the same migration concurrently.
 *
 * Default true preserves the original self-migrating-on-boot behavior used by
 * docker-compose and any deploy that does not run the migrate Job. Those
 * deployments DO run several unserialized runners, so data migrations must be
 * written to tolerate it (see Workers/Utils/DataMigration.ts).
 */
export const RunDatabaseMigrationsOnBoot: boolean =
  process.env["RUN_DATABASE_MIGRATIONS_ON_BOOT"] !== "false";

export const ClickhouseHost: Hostname = Hostname.fromString(
  process.env["CLICKHOUSE_HOST"] || "clickhouse",
);

export const StatusPageCNameRecord: string =
  process.env["STATUS_PAGE_CNAME_RECORD"] || "";

export const DashboardCNameRecord: string =
  process.env["DASHBOARD_CNAME_RECORD"] || "";

export const ClickhousePort: Port = new Port(
  process.env["CLICKHOUSE_PORT"] || "8123",
);

export const ClickhouseUsername: string =
  process.env["CLICKHOUSE_USER"] || "default";

export const ClickhousePassword: string =
  process.env["CLICKHOUSE_PASSWORD"] || "password";

export const ClickhouseDatabase: string =
  process.env["CLICKHOUSE_DATABASE"] || "oneuptime";

export const ClickhouseTlsCa: string | undefined =
  process.env["CLICKHOUSE_TLS_CA"] || undefined;

export const ClickhouseTlsCert: string | undefined =
  process.env["CLICKHOUSE_TLS_CERT"] || undefined;

export const ClickhouseTlsKey: string | undefined =
  process.env["CLICKHOUSE_TLS_KEY"] || undefined;

export const ClickHouseIsHostHttps: boolean =
  process.env["CLICKHOUSE_IS_HOST_HTTPS"] === "true";

export const ShouldClickhouseSslEnable: boolean = Boolean(
  ClickhouseTlsCa || (ClickhouseTlsCert && ClickhouseTlsKey),
);

export const MaxClickhouseConnections: number = parseInt(
  process.env["CLICKHOUSE_MAX_OPEN_CONNECTIONS"] || "100",
  10,
);

/*
 * Ingest pool size. Falls back to MaxClickhouseConnections so single-knob
 * setups still work; override only when the ingest pool needs to be sized
 * independently from the query pool.
 */
export const MaxClickhouseIngestConnections: number = parseInt(
  process.env["CLICKHOUSE_INGEST_MAX_OPEN_CONNECTIONS"] ||
    String(MaxClickhouseConnections),
  10,
);

/*
 * Cluster name. The analytics schema ALWAYS runs as a sharded + replicated
 * cluster (Distributed tables over local ReplicatedMergeTree, `ON CLUSTER
 * '<name>'`); a single node is just a 1-shard/1-replica cluster backed by an
 * embedded Keeper. The name must match the cluster defined in the ClickHouse
 * config / ClickHouseInstallation; it defaults to 'oneuptime' (what the bundled
 * StatefulSet config and the Altinity operator both create).
 *
 * NOTE: the live, test-toggleable readers live in
 * Common/Server/Utils/AnalyticsDatabase/ClusterConfig.ts (which reads
 * process.env directly). These consts mirror the same keys/defaults and exist
 * so the env surface is discoverable here alongside the other CLICKHOUSE_* vars.
 */
export const ClickhouseClusterName: string =
  process.env["CLICKHOUSE_CLUSTER_NAME"] || "oneuptime";

/*
 * Optional GLOBAL override of the Distributed sharding-key expression. Empty by
 * default, which means each model's own `shardingKey` is used (e.g.
 * cityHash64(traceId) for spans, the series tuple for metrics). Set this to
 * force one expression across all tables.
 */
export const ClickhouseShardingKeyOverride: string =
  process.env["CLICKHOUSE_SHARDING_KEY"] || "";

/*
 * How long migration / schema-sync ON CLUSTER DDL waits for every host to
 * report completion before giving up on confirmation (the statement itself
 * stays queued and still executes on every host in the background). Default
 * 180 — the ClickHouse server default. Raise this on clusters whose DDL queue
 * drains slowly; the migration pool's socket-idle ceiling scales with it (see
 * ClickhouseConfig.ts). 0 returns immediately (async); a negative value
 * removes the server-side wait limit but the client still gives up at the
 * migration pool's socket-idle ceiling (30-minute floor), so prefer a finite
 * value. Mirrors the live reader getDistributedDdlTaskTimeoutSeconds() in
 * ClusterConfig.ts, which is the single source of parsing truth.
 */
export const ClickhouseDistributedDdlTaskTimeoutSeconds: number =
  getDistributedDdlTaskTimeoutSeconds();

export const GitSha: string = process.env["GIT_SHA"] || "unknown";

export const AppVersion: string = process.env["APP_VERSION"] || "unknown";

export const LogLevel: ConfigLogLevel =
  (process.env["LOG_LEVEL"] as ConfigLogLevel) || ConfigLogLevel.INFO;

export const HttpProtocol: Protocol =
  process.env["HTTP_PROTOCOL"] === "https" ? Protocol.HTTPS : Protocol.HTTP;

export const Host: string = process.env["HOST"] || "";

/*
 * How many reverse proxies that WE control sit in front of this process and
 * append to X-Forwarded-For.
 *
 * X-Forwarded-For is caller-supplied on its left-hand end: every proxy appends
 * the address it accepted the connection from, and our Nginx uses
 * `$proxy_add_x_forwarded_for` (Nginx/default.conf.template), which keeps
 * whatever the caller sent and adds to it. Only entries that one of our own
 * proxies wrote mean anything, and those are at the RIGHT-hand end. This
 * number says how far in from the right the real client sits, so IP
 * allowlists and IP-keyed rate limits read an entry a caller cannot choose.
 *
 * 1 is correct for every topology this repo ships -- Docker Compose and the
 * Helm chart both put exactly one Nginx (the `ingress` gateway) in front of
 * the app, and the Kubernetes Service in front of that is L4 and does not
 * touch the header.
 *
 * RAISE IT if you have added HTTP proxies of your own: a CDN or WAF that
 * appends to X-Forwarded-For (Cloudflare, an AWS ALB, an external
 * ingress-nginx) makes this 2, and each further appending hop adds one. Set it
 * too low and you attribute requests to your own proxy; set it too high and
 * you read an entry the caller controls.
 *
 * 0 ignores X-Forwarded-For entirely and uses only the TCP peer address --
 * correct when the app is exposed directly with no proxy in front.
 */
export const TrustedProxyHops: number = ((): number => {
  const rawValue: string | undefined = process.env["TRUSTED_PROXY_HOPS"];

  if (rawValue === undefined || rawValue.trim() === "") {
    return 1;
  }

  const parsedValue: number = Number(rawValue.trim());

  /*
   * Anything that is not a whole, non-negative, finite count is a
   * misconfiguration. Fall back to the shipped topology rather than to 0:
   * 0 would silently attribute every request to the gateway's own address,
   * which does not fail closed so much as make allowlists useless.
   */
  if (
    !Number.isFinite(parsedValue) ||
    !Number.isInteger(parsedValue) ||
    parsedValue < 0
  ) {
    return 1;
  }

  return parsedValue;
})();

export const ProvisionSsl: boolean = process.env["PROVISION_SSL"] === "true";

export const CaptchaEnabled: boolean =
  process.env["CAPTCHA_ENABLED"] === "true";

export const CaptchaSecretKey: string = process.env["CAPTCHA_SECRET_KEY"] || "";

export const CaptchaSiteKey: string = process.env["CAPTCHA_SITE_KEY"] || "";

export const WorkflowScriptTimeoutInMS: number = process.env[
  "WORKFLOW_SCRIPT_TIMEOUT_IN_MS"
]
  ? parseInt(process.env["WORKFLOW_SCRIPT_TIMEOUT_IN_MS"].toString())
  : 5000;

export const WorkflowTimeoutInMs: number = process.env["WORKFLOW_TIMEOUT_IN_MS"]
  ? parseInt(process.env["WORKFLOW_TIMEOUT_IN_MS"].toString())
  : 120000;

export const AllowedActiveMonitorCountInFreePlan: number = process.env[
  "ALLOWED_ACTIVE_MONITOR_COUNT_IN_FREE_PLAN"
]
  ? parseInt(
      process.env["ALLOWED_ACTIVE_MONITOR_COUNT_IN_FREE_PLAN"].toString(),
    )
  : 10;

export const AllowedStatusPageCountInFreePlan: number = process.env[
  "ALLOWED_STATUS_PAGE_COUNT_IN_FREE_PLAN"
]
  ? parseInt(process.env["ALLOWED_STATUS_PAGE_COUNT_IN_FREE_PLAN"].toString())
  : 1;

export const AllowedSubscribersCountInFreePlan: number = process.env[
  "ALLOWED_SUBSCRIBERS_COUNT_IN_FREE_PLAN"
]
  ? parseInt(process.env["ALLOWED_SUBSCRIBERS_COUNT_IN_FREE_PLAN"].toString())
  : 100;

export const NotificationSlackWebhookOnCreateUser: string =
  process.env["NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_USER"] || "";

export const NotificationSlackWebhookOnCreateProject: string =
  process.env["NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_PROJECT"] || "";

// notification delete project
export const NotificationSlackWebhookOnDeleteProject: string =
  process.env["NOTIFICATION_SLACK_WEBHOOK_ON_DELETED_PROJECT"] || "";

// notification subscripton update.
export const NotificationSlackWebhookOnSubscriptionUpdate: string =
  process.env["NOTIFICATION_SLACK_WEBHOOK_ON_SUBSCRIPTION_UPDATE"] || "";

export const AdminDashboardClientURL: URL = new URL(
  HttpProtocol,
  Host,
  new Route(AdminDashboardRoute.toString()),
);

export const AppApiClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  new Route(AppApiRoute.toString()),
);

export const StatusPageApiClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  new Route(StatusPageApiRoute.toString()),
);

/*
 *Internal URL for server-to-server communication (uses internal Docker hostname)
 *Note: The internal path is /api/status-page (not /status-page-api) because
 * /status-page-api is the external route that Nginx rewrites to /api/status-page
 */
export const StatusPageApiInternalUrl: URL = URL.fromString(
  AppApiClientUrl.toString(),
).addRoute(new Route("/status-page"));

/*
 *Internal URL for server-to-server communication with the Dashboard API.
 *Note: The internal path is /api/dashboard (not /public-dashboard-api) because
 * /public-dashboard-api is the external route that Nginx rewrites to /api/dashboard
 */
export const DashboardApiInternalUrl: URL = URL.fromString(
  AppApiClientUrl.toString(),
).addRoute(new Route("/dashboard"));

export const DashboardClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  new Route(DashboardRoute.toString()),
);

export const AccountsClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  new Route(AccountsRoute.toString()),
);

export const HomeClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  new Route(HomeRoute.toString()),
);

export const DocsClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  new Route(DocsRoute.toString()),
);

export const IpWhitelist: string = process.env["IP_WHITELIST"] || "";

export const DisableTelemetry: boolean =
  process.env["DISABLE_TELEMETRY"] === "true";

/*
 * Master switch for fault classification (code-fault / user-error /
 * expected-denial / infrastructure). When false, ErrorClassResolver reports
 * CodeFault for everything, so every thrown value is recorded as an exception
 * event, marked ERROR and logged at ERROR — exactly the pre-classification
 * behaviour.
 *
 * Default ON. It exists so a regression in classification is a config flip on
 * a running fleet rather than a redeploy, which matters because this runs on
 * the universal error path of every decorated method in the product.
 */
export const TelemetryErrorClassEnabled: boolean =
  process.env["TELEMETRY_ERROR_CLASS_ENABLED"] !== "false";

/*
 * Opt out of the daily "is a newer OneUptime released?" check against the
 * GitHub API. Deliberately separate from DISABLE_TELEMETRY, which turns off
 * the OpenTelemetry SDK and says nothing about outbound calls.
 */
export const DisableUpdateCheck: boolean =
  process.env["DISABLE_UPDATE_CHECK"] === "true";

/*
 * On-call calendar feeds: the public, token-in-URL .ics endpoints that Google
 * Calendar / Outlook / Apple Calendar poll for on-call shifts
 * (/api/on-call-calendar/{user,schedule,project}/<token>/...).
 *
 * Kill switch. When true every feed route answers 503 with Retry-After: 3600
 * so calendar clients back off for an hour and keep the copy they already
 * have, instead of dropping the calendar the way a 404 would make them.
 * Nothing about the feeds is deleted; flip it back and they resume.
 */
export const DisableOnCallCalendarFeed: boolean =
  process.env["DISABLE_ON_CALL_CALENDAR_FEED"] === "true";

/*
 * Fixed-window rate limits for those same feed routes. Two counters, either of
 * which can reject: per token + client address, and per client address alone
 * (the ceiling that survives a caller rotating tokens). The defaults are sized
 * for calendar clients, which poll on the order of once an hour -- Apple is the
 * most eager at every five minutes -- with a lot of headroom for a team's
 * clients behind one office address. The limiter fails OPEN when Redis is
 * unreachable: it is load control, not the only thing guarding the token.
 */
export const OnCallCalendarFeedRateLimitWindowSeconds: number =
  parsePositiveIntegerFromEnv(
    "ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS",
    60,
  );

export const OnCallCalendarFeedRateLimitPerTokenPerWindow: number =
  parsePositiveIntegerFromEnv(
    "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW",
    60,
  );

export const OnCallCalendarFeedRateLimitPerIpPerWindow: number =
  parsePositiveIntegerFromEnv(
    "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW",
    3000,
  );

/*
 * Source map ingestion and resolution limits.
 *
 * These were fixed constants, sized on the assumption that "a build rarely
 * emits more than a few dozen chunks with maps". That assumption does not
 * survive route-level code splitting: a Nuxt/Vite/Next app with a hundred
 * routes emits hundreds of chunk .map files per release, and the maps that
 * did not fit simply never resolved. They are operator knobs now, and the
 * Helm chart exposes each one.
 *
 * The division of labour matters, because it is what makes raising the
 * ceiling safe:
 *
 *   - SourceMapMaxMapsPerRelease is purely a WRITE gate. An upload past it is
 *     rejected with a 400 that names the limit. It is no longer the
 *     resolver's read limit, so raising it can never turn stored maps into
 *     maps that store fine and then silently never resolve.
 *   - SourceMapMaxBytesPerResolve is what bounds the READ path. Resolution
 *     loads whole maps into memory, so a byte budget -- not a row count -- is
 *     the invariant that actually protects the process.
 */

/*
 * Distinct bundles one (project, service, release) may hold.
 *
 * Clamped to LIMIT_MAX because the gate reads the release's existing bundle
 * paths with LIMIT_MAX; a configured value above that could not be enforced
 * and would be a lie.
 */
export const SourceMapMaxMapsPerRelease: number = parseClampedIntegerFromEnv(
  "SOURCE_MAP_MAX_MAPS_PER_RELEASE",
  1000,
  LIMIT_MAX,
);

/*
 * How long uploaded maps are kept. A map is only useful while exceptions from
 * its release are still within telemetry retention, and the default
 * comfortably exceeds it.
 */
export const SourceMapRetentionInDays: number = parsePositiveIntegerFromEnv(
  "SOURCE_MAP_RETENTION_DAYS",
  90,
);

/*
 * Hard ceiling on ONE map, enforced on the raw upload and again on the
 * decoded string.
 *
 * The ceiling is MAX_MULTIPART_FILE_BYTES from
 * Common/Server/Middleware/MultipartFormData.ts, repeated as a literal
 * because that module pulls in multer and express and has no business being
 * imported by config. The two are pinned to each other by
 * Common/Tests/Server/Utils/Telemetry/SourceMapLimits.test.ts. Configuring
 * past it would not raise anything: multer aborts the request first, turning
 * the 400 this ceiling is meant to give into a confusing 413.
 */
export const SourceMapMaxFileSizeInBytes: number = parseClampedIntegerFromEnv(
  "SOURCE_MAP_MAX_FILE_SIZE_BYTES",
  50 * 1024 * 1024,
  50 * 1024 * 1024,
);

/*
 * Source map files accepted in ONE upload request.
 *
 * Separate from the per-release ceiling: a release may hold far more maps
 * than any single request may carry, and CI splits the upload. Clamped to
 * MAX_MULTIPART_FILES, which is the shared middleware default and runs
 * BEFORE authentication on every route that mounts it -- so this knob only
 * ever narrows the source map route, never widens the pre-auth surface that
 * Pyroscope and inbound email sit behind.
 */
export const SourceMapMaxFilesPerRequest: number = parseClampedIntegerFromEnv(
  "SOURCE_MAP_MAX_FILES_PER_REQUEST",
  50,
  50,
);

/*
 * Total map bytes one resolve request may pull into memory.
 *
 * This is the bound that used to be implied by the per-release count, and it
 * is a much tighter one: resolution materialises whole maps, each up to
 * SourceMapMaxFileSizeInBytes, and the set it loads is chosen by a
 * caller-supplied frames array. Maps that do not fit the budget are skipped
 * in match-quality order and REPORTED on the response, so a skip is visible
 * rather than looking like "no map was uploaded".
 *
 * 512 MiB is roughly ten maps at the per-file ceiling, or every map of a
 * realistically sized release many times over.
 */
export const SourceMapMaxBytesPerResolve: number = parsePositiveIntegerFromEnv(
  "SOURCE_MAP_MAX_BYTES_PER_RESOLVE",
  512 * 1024 * 1024,
);

export const EnableProfiling: boolean =
  process.env["ENABLE_PROFILING"] === "true";

export const IsEnterpriseEdition: boolean =
  process.env["IS_ENTERPRISE_EDITION"] === "true";

export const AverageSpanRowSizeInBytes: number = parsePositiveNumberFromEnv(
  "AVERAGE_SPAN_ROW_SIZE_IN_BYTES",
  1024,
);

export const AverageLogRowSizeInBytes: number = parsePositiveNumberFromEnv(
  "AVERAGE_LOG_ROW_SIZE_IN_BYTES",
  1024,
);

export const AverageMetricRowSizeInBytes: number = parsePositiveNumberFromEnv(
  "AVERAGE_METRIC_ROW_SIZE_IN_BYTES",
  1024,
);

export const AverageExceptionRowSizeInBytes: number =
  parsePositiveNumberFromEnv("AVERAGE_EXCEPTION_ROW_SIZE_IN_BYTES", 1024);

export const AverageProfileRowSizeInBytes: number = parsePositiveNumberFromEnv(
  "AVERAGE_PROFILE_ROW_SIZE_IN_BYTES",
  1024,
);

/*
 * Fallback only, and effectively dead code: session-replay usage is metered
 * from the exact payloadBytes stamped on each session header, never from an
 * average. Kept so the metered-product lookup stays exhaustive. Sized as a
 * plausible error-triggered session (~48 KB) rather than a row, since replay
 * meters per session.
 */
export const AverageSessionReplaySessionSizeInBytes: number =
  parsePositiveNumberFromEnv(
    "AVERAGE_SESSION_REPLAY_SESSION_SIZE_IN_BYTES",
    49152,
  );

export const AverageProfileSampleRowSizeInBytes: number =
  parsePositiveNumberFromEnv("AVERAGE_PROFILE_SAMPLE_ROW_SIZE_IN_BYTES", 512);

/*
 * Security events are wider than log rows (typed entity columns plus a
 * fully flattened source payload), so the fallback average is 2 KiB.
 */
export const AverageSecurityEventRowSizeInBytes: number =
  parsePositiveNumberFromEnv("AVERAGE_SECURITY_EVENT_ROW_SIZE_IN_BYTES", 2048);

export const SlackAppClientId: string | null =
  process.env["SLACK_APP_CLIENT_ID"] || null;
export const SlackAppClientSecret: string | null =
  process.env["SLACK_APP_CLIENT_SECRET"] || null;
export const SlackAppSigningSecret: string | null =
  process.env["SLACK_APP_SIGNING_SECRET"] || null;

// Microsoft Teams Configuration
export const MicrosoftTeamsAppClientId: string | null =
  process.env["MICROSOFT_TEAMS_APP_CLIENT_ID"] || null;
export const MicrosoftTeamsAppClientSecret: string | null =
  process.env["MICROSOFT_TEAMS_APP_CLIENT_SECRET"] || null;
export const MicrosoftTeamsAppTenantId: string | null =
  process.env["MICROSOFT_TEAMS_APP_TENANT_ID"] || null;

// GitHub App Configuration
export const GitHubAppId: string | null = process.env["GITHUB_APP_ID"] || null;
export const GitHubAppName: string | null =
  process.env["GITHUB_APP_NAME"] || null;
export const GitHubAppClientId: string | null =
  process.env["GITHUB_APP_CLIENT_ID"] || null;
export const GitHubAppClientSecret: string | null =
  process.env["GITHUB_APP_CLIENT_SECRET"] || null;

type DecodePrivateKeyFunction = (key: string | undefined) => string | null;

// Helper function to decode base64 private key if needed
const decodePrivateKey: DecodePrivateKeyFunction = (
  key: string | undefined,
): string | null => {
  if (!key) {
    return null;
  }

  // If it starts with "-----BEGIN", it's already in PEM format
  if (key.trim().startsWith("-----BEGIN")) {
    return key;
  }

  // Otherwise, assume it's base64 encoded and decode it
  try {
    const decoded: string = Buffer.from(key, "base64").toString("utf-8");
    // Verify it's a valid PEM key after decoding
    if (decoded.trim().startsWith("-----BEGIN")) {
      return decoded;
    }
    // If decoding doesn't produce a valid PEM, return original value
    return key;
  } catch {
    // If decoding fails, return the original value
    return key;
  }
};

export const GitHubAppPrivateKey: string | null = decodePrivateKey(
  process.env["GITHUB_APP_PRIVATE_KEY"],
);
export const GitHubAppWebhookSecret: string | null =
  process.env["GITHUB_APP_WEBHOOK_SECRET"] || null;

// VAPID Configuration for Web Push Notifications
export const VapidPublicKey: string | undefined =
  process.env["VAPID_PUBLIC_KEY"] || undefined;

export const VapidPrivateKey: string | undefined =
  process.env["VAPID_PRIVATE_KEY"] || undefined;

export const VapidSubject: string =
  process.env["VAPID_SUBJECT"] || "mailto:support@oneuptime.com";

export const ExpoAccessToken: string | undefined =
  process.env["EXPO_ACCESS_TOKEN"] || undefined;

export const PushNotificationRelayUrl: string =
  process.env["PUSH_NOTIFICATION_RELAY_URL"] ||
  "https://oneuptime.com/api/notification/push-relay/send";

export const EnterpriseLicenseValidationUrl: URL = URL.fromString(
  "https://oneuptime.com/api/enterprise-license/validate",
);

export const EnterpriseLicenseUserCountReportUrl: URL = URL.fromString(
  "https://oneuptime.com/api/enterprise-license/report-user-count",
);

/*
 * GitHub's "latest release" endpoint. It already excludes drafts and
 * prereleases, so whatever it returns is a version an administrator can
 * safely be told to upgrade to.
 *
 * Overridable so an installation with no route to github.com can point the
 * check at an internal mirror instead of turning it off entirely. The mirror
 * must answer with GitHub's release shape (tag_name, html_url, published_at).
 */
export const LatestReleaseCheckUrl: URL = URL.fromString(
  process.env["LATEST_RELEASE_CHECK_URL"] ||
    "https://api.github.com/repos/OneUptime/oneuptime/releases/latest",
);

// Inbound Email Configuration for Incoming Email Monitor
export enum InboundEmailProviderType {
  SendGrid = "SendGrid",
}

export const InboundEmailProvider: InboundEmailProviderType =
  (process.env["INBOUND_EMAIL_PROVIDER"] as InboundEmailProviderType) ||
  InboundEmailProviderType.SendGrid;

export const InboundEmailDomain: string | undefined =
  process.env["INBOUND_EMAIL_DOMAIN"] || undefined;

export const InboundEmailWebhookSecret: string | undefined =
  process.env["INBOUND_EMAIL_WEBHOOK_SECRET"] || undefined;
