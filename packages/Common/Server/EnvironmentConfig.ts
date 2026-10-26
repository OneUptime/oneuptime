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
  "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
  "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY",
  "DISABLE_TELEMETRY",
  "SLACK_APP_CLIENT_ID",
  "MICROSOFT_TEAMS_APP_CLIENT_ID",
  /*
   * Public OAuth client ids: the Video Calls page offers the one-click
   * Connect for a provider whose app this server has.
   */
  "ZOOM_APP_CLIENT_ID",
  "GOOGLE_MEET_APP_CLIENT_ID",
  "MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_NAME",
  // Public client id: the sign-in page offers Sign in with Microsoft when it is set.
  "MICROSOFT_SIGN_IN_CLIENT_ID",
  "CAPTCHA_ENABLED",
  "CAPTCHA_SITE_KEY",
  "INBOUND_EMAIL_DOMAIN",
];

/*
 * These values are credentials (or may contain credentials) for backend
 * exporters. Keep this denylist even though none of them is in the allowlist:
 * it makes the security boundary explicit and ensures that a future broad
 * prefix or an accidental allowlist addition cannot publish them in env.js.
 *
 * Browser telemetry has its own deliberately public endpoint and Browser
 * ingestion key above. Browser keys are origin-bound, surface-limited and
 * rate-limited by TelemetryIngest; a Server key is none of those things.
 */
const FRONTEND_ENV_DENY_LIST: ReadonlySet<string> = new Set<string>([
  "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
  "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
]);

/*
 * PUBLIC_ is an intentional escape hatch for browser-readable settings, but it
 * must not turn a renamed OTLP header variable into an escape hatch for an
 * arbitrary bearer token. Cover the OpenTelemetry-standard OTEL spelling, the
 * historical OneUptime OPENTELEMETRY spelling, generic headers and every
 * signal-specific/future extension ending in _HEADERS. Endpoint and dedicated
 * Browser-key names remain unaffected.
 */
const FRONTEND_OTLP_HEADERS_PATTERN: RegExp =
  /^PUBLIC_(?:OTEL|OPENTELEMETRY)_EXPORTER_OTLP(?:_[A-Z0-9]+)*_HEADERS$/i;

const FRONTEND_ENV_ALLOW_PREFIXES: Array<string> = [
  "SUBSCRIPTION_PLAN_",
  "PUBLIC_",
];

/*
 * Whether this installation issues free (Let's Encrypt) certificates for its
 * custom domains: only with a Let's Encrypt account key. Self-hosted
 * installations that end TLS at their own proxy often have none, and there
 * a custom domain's HTTPS is the proxy's (or a certificate its owner
 * uploads) - so the Dashboard must not say "Issuing a free certificate"
 * about a verified domain for ever. The browser is told only whether there
 * is a key, as "true" or "false"; the key itself never leaves the server.
 */
export const CUSTOM_DOMAIN_FREE_CERTIFICATES_VARIABLE: string =
  "CUSTOM_DOMAIN_FREE_CERTIFICATES";

export const issuesFreeCustomDomainCertificates: () => boolean =
  (): boolean => {
    return Boolean((process.env["LETS_ENCRYPT_ACCOUNT_KEY"] || "").trim());
  };

export const getFrontendEnvVars: () => JSONObject = (): JSONObject => {
  const frontendEnv: JSONObject = {};

  for (const key of Object.keys(process.env)) {
    if (
      FRONTEND_ENV_DENY_LIST.has(key) ||
      FRONTEND_OTLP_HEADERS_PATTERN.test(key)
    ) {
      continue;
    }

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

  // Derived, never copied: whether there is a key, not the key.
  frontendEnv[CUSTOM_DOMAIN_FREE_CERTIFICATES_VARIABLE] =
    issuesFreeCustomDomainCertificates() ? "true" : "false";

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

/*
 * parsePositiveIntegerFromEnv for settings where "0" is a real choice (it
 * switches the behaviour off) rather than a misconfiguration. Anything else
 * that is not a whole number of at least 0 still falls back to the default:
 * parseInt would read "15m" as 15 and "abc" as NaN, which compares false
 * against every bound and so never runs out.
 */
const parseNonNegativeIntegerFromEnv: (
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
    parsedValue < 0
  ) {
    return fallback;
  }

  return parsedValue;
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
 * How long (ms) a statement of a SCHEMA migration may wait for a lock before
 * the migration gives up, rolls back and is tried again
 * (Postgres/SchemaMigrationRunner.ts).
 *
 * DDL needs strong table locks (ALTER TABLE takes ACCESS EXCLUSIVE), and a DDL
 * statement waiting in a table's lock queue blocks every query that arrives on
 * that table after it - reads included - until it gets the lock or gives up.
 * Without this bound a migration queued behind one long transaction on
 * "Monitor" parked every probe result, heartbeat and ingest lookup for as long
 * as that transaction lived. With it, that queue lasts this long at most, and
 * the runner tries again in the gaps.
 *
 * Kept BELOW DATABASE_LOCK_TIMEOUT_MS (3 s): an app query queued behind a
 * migration's lock request then outlives the request, so it is delayed rather
 * than failed with its own lock_timeout.
 *
 * Only the schema-migration connection gets this. 0 lets migration statements
 * wait as long as it takes, as they did before.
 */
export const PostgresMigrationLockTimeoutMs: number = parseInt(
  process.env["DATABASE_MIGRATION_LOCK_TIMEOUT_MS"] || "2000",
  10,
);

/*
 * How long (ms) the schema-migration runner keeps retrying ONE migration that
 * keeps running out of DATABASE_MIGRATION_LOCK_TIMEOUT_MS before it fails the
 * run, with the lock error. Counted per migration: a run that applies several
 * migrations gives each its own window. 0 never retries.
 */
export const PostgresMigrationLockRetryTimeoutMs: number = parseInt(
  process.env["DATABASE_MIGRATION_LOCK_RETRY_TIMEOUT_MS"] ||
    String(10 * 60 * 1000),
  10,
);

/*
 * How long (ms) a process that does NOT apply the schema migrations itself
 * (RUN_DATABASE_MIGRATIONS_ON_BOOT=false: the runtime pods, when the migrate
 * Job owns them) waits at boot for the migrations its code knows to be
 * applied (Postgres/SchemaMigrationWait.ts).
 *
 * The migrate Job runs asynchronously by default (migrate.hook=false), so the
 * new pods of a release start while it is still migrating. Code running on
 * the older schema fails every query that touches what the missing
 * migrations add: in 14.0.13 every monitor query filtered on
 * Monitor."isArchived" before AddArchiveToMoreResources had committed, and no
 * monitor was processed until it did. connect() holds the boot instead: the
 * pod is not started, so not ready, and the old pods keep serving.
 *
 * When this runs out connect() fails and the process exits, to be restarted
 * and wait again: it never starts on the older schema. Keep it below the
 * startup probe window (17 minutes in the Helm chart), so the pod gives up
 * with an explicit error instead of being killed by the probe.
 *
 * 0 does not wait: the process logs which migrations are missing and starts
 * on the schema it finds, as it did before this setting existed.
 */
export const PostgresMigrationWaitTimeoutMs: number =
  parseNonNegativeIntegerFromEnv(
    "DATABASE_MIGRATION_WAIT_TIMEOUT_MS",
    15 * 60 * 1000,
  );

/*
 * The app's client-side query timeout (ms). Belt-and-braces for the
 * server-side statement_timeout - fires even if the connection has gone
 * silent or the server-side timeout doesn't kick in (behind a pooler that
 * drops the statement_timeout the app asks for, with none set on the role).
 * A statement still running when it fires is cancelled on the database, and
 * its connection closed rather than handed to another request
 * (Infrastructure/Postgres/CancelOnTimeoutClient); the caller then waits a
 * little longer for the database's answer to the cancel
 * (CANCEL_ANSWER_WAIT_IN_MS).
 *
 * Deliberately LONGER than statement_timeout. These two used to be equal, and
 * because the client timer starts before the packet even reaches the backend,
 * the client always won by a round trip - so the app never observed Postgres's
 * real SQLSTATE, and node-postgres' own timeout only ABANDONED the query: the
 * backend kept running and kept its place in the lock queue. Letting the
 * server win means contention is cancelled server-side, with its own answer;
 * the client's cancel is for where the server enforces no timeout. Keep
 * PgBouncer's query_wait_timeout below it (HelmChart/Docs/Postgres.md): a
 * statement still queued in the pooler cannot be cancelled.
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
 * pg-pool connection lifetime (ms). A connection older than this is closed
 * and replaced: right away when it is idle, otherwise as soon as the query or
 * transaction using it gives it back - never in the middle of one. Without
 * it, the connections a busy process opens at boot stay open for as long as
 * the process lives, and that hides its queries from anything that only
 * sees a connection being opened:
 *
 *   - The Kubernetes agent's eBPF instrumentation ties a Node.js query to the
 *     request that ran it through the socket the query goes out on, and it
 *     learns a socket only when it sees it opened. A pod started while the
 *     agent was still attaching to others (a rollout), or running when the
 *     agent restarts, had its pool open before the agent could see it: every
 *     query on it lands under whichever request most recently began - on a
 *     pod busy with telemetry ingest, nearly always one of those - and the
 *     request that ran it shows no database calls at all.
 *   - A new PgBouncer or Postgres replica behind DATABASE_HOST only ever gets
 *     the connections opened after it came up.
 *
 * Replacing a connection costs one new connection to PgBouncer or Postgres,
 * once per connection per lifetime. Set to 0 to keep connections for as long
 * as they stay healthy.
 */
export const PostgresConnectionMaxLifetimeMs: number = parseInt(
  process.env["DATABASE_CONNECTION_MAX_LIFETIME_MS"] || "600000",
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
 * it (that would take down an existing install on upgrade, and changing the
 * key would make those columns unreadable), but the boot log says so loudly;
 * see EncryptionSecretWarning and StartServer.init.
 *
 * Tokens are another matter: a token signed with a public key is a session
 * anybody can mint. So when this is true nothing is signed with
 * ENCRYPTION_SECRET at all - TokenSigningKey signs with a random key the
 * installation keeps for itself in Postgres instead.
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
  ? 'ENCRYPTION_SECRET is unset or still one of the placeholder values shipped in this repository ("secret", or the "please-change-this-to-random-value" that config.example.env sets). Every encrypted database column (integration tokens, SMTP credentials, on-call calendar feed tokens) is protected only by a key that is public in the OneUptime repository. Set ENCRYPTION_SECRET to a long random value in config.env (or the Helm chart) before storing anything sensitive. Note that changing it later makes values encrypted with the old key unreadable. Sign-in and other tokens are not signed with it: until it is set, OneUptime signs them with a random key it generated for this installation and keeps in the database.'
  : null;

export const OpenSourceDeploymentWebhookUrl: string =
  process.env["OPEN_SOURCE_DEPLOYMENT_WEBHOOK_URL"] || "";

export const AirtableApiKey: string = process.env["AIRTABLE_API_KEY"] || "";

export const AirtableBaseId: string = process.env["AIRTABLE_BASE_ID"] || "";

/*
 * A SHARED SECRET THIS REPOSITORY SHIPS
 *
 * The values a key OneUptime's own components share can be left at by an
 * installation that never set it, all of them public in this repository:
 *
 *   - unset or blank;
 *   - "secret", which the code used to fall back to;
 *   - any placeholder config.example.env sets. Every one contains
 *     "please-change-this" ("please-change-this-to-random-value",
 *     "probe-1-please-change-this-to-random-value", ...), and the README's
 *     Docker Compose install copies that file as it is.
 *
 * Whitespace around the value is ignored, as compose and shells keep it. The
 * comparison is case-sensitive: these are the exact values anybody would try
 * first, and any other weak value is the operator's own choice.
 *
 * Such a value is never accepted as proof that a caller is one of
 * OneUptime's own components, whichever key it is. ENCRYPTION_SECRET keeps
 * its own, older rule above (IsEncryptionSecretInsecure), because which of
 * its values count decides which key every sign-in token is checked with.
 */
export const ShippedSecretFallback: string = "secret";

export const ShippedSecretPlaceholderMark: string = "please-change-this";

export function isShippedSecretValue(
  value: string | null | undefined,
): boolean {
  if (typeof value !== "string") {
    return true;
  }

  const trimmed: string = value.trim();

  return (
    trimmed === "" ||
    trimmed === ShippedSecretFallback ||
    trimmed.includes(ShippedSecretPlaceholderMark)
  );
}

/*
 * THE CLUSTER KEY (ONEUPTIME_SECRET)
 *
 * OneUptime's own services prove to each other that a call comes from one of
 * them by presenting this key: the app and worker processes when one asks
 * another to send an email, an SMS, a call, a WhatsApp or Telegram message
 * or a webhook, to run a workflow or to write telemetry
 * (ClusterKeyAuthorization). The routes that take it are reachable through
 * the ingress like any other. No Runner holds it: every Runner proves who
 * it is with its own id and key.
 *
 * ClusterKey is the value exactly as the operator set it, read only by
 * ClusterKeyAuthorization, and only when it is not one this repository ships
 * (IsClusterKeyShipped). There is no fallback: an installation that left it
 * unset or at a placeholder has its services use a key of the installation's
 * own instead, and refuses the public value from any caller.
 */
export const ClusterKey: ObjectID = new ObjectID(
  process.env["ONEUPTIME_SECRET"] || "",
);

/*
 * Whether ONEUPTIME_SECRET is set at all: on a Runner, that its deployment
 * (from an earlier release) marks it as the shared Runner by giving it one.
 */
export const HasClusterKey: boolean = Boolean(process.env["ONEUPTIME_SECRET"]);

export const IsClusterKeyShipped: boolean = isShippedSecretValue(
  process.env["ONEUPTIME_SECRET"],
);

/*
 * Said once at boot by the app (App/Index.ts) when ONEUPTIME_SECRET is unset
 * or a shipped value, or null. The Runner says its own.
 */
export const ClusterKeyWarning: string | null = IsClusterKeyShipped
  ? 'ONEUPTIME_SECRET is unset or still a value shipped in the OneUptime repository ("secret", or a "please-change-this-to-random-value" placeholder from config.example.env). OneUptime refuses that value from any caller. Its own services call each other with a key this installation derives for itself instead, so nothing needs changing for them. Anything else that calls OneUptime with ONEUPTIME_SECRET needs a long random value: npm start and npm run update put one in config.env for Docker Compose; with Helm, set oneuptimeSecret to one.'
  : null;

export const EnableQueueDashboard: boolean =
  process.env["ENABLE_QUEUE_DASHBOARD"] === "true";

export const QueueDashboardSecret: string =
  process.env["QUEUE_DASHBOARD_SECRET"] || "";

/*
 * THE GLOBAL-PROBE REGISTRATION KEY (REGISTER_PROBE_KEY)
 *
 * A global probe belongs to no project and runs the monitors of every
 * project on the installation. REGISTER_PROBE_KEY is what a probe presents to
 * become one (Telemetry/API/ProbeIngest/Register). It is the installation's
 * own secret: the value exactly as the operator set it, and there is no
 * fallback. An installation that left it unset or at a value this repository
 * ships (EnvironmentConfig.isShippedSecretValue) registers no global probe at
 * all: a value public in the repository proves nothing.
 *
 * REGISTER_PROBE_KEY is a secret OneUptime's own containers share and that
 * nothing stored depends on, so Docker Compose gives it a random value at
 * install (Scripts/Install/ReplacePlaceholderSecrets.js) and the Helm chart
 * generates one; a probe's own key (PROBE_KEY / GLOBAL_PROBE_n_KEY) is held to
 * the same bar by ProbeService.verifyProbeKey.
 */
export const RegisterProbeKey: ObjectID = new ObjectID(
  process.env["REGISTER_PROBE_KEY"] || "",
);

// Whether REGISTER_PROBE_KEY is set at all (whether this probe auto-registers as global).
export const HasRegisterProbeKey: boolean = Boolean(
  process.env["REGISTER_PROBE_KEY"],
);

/*
 * True when REGISTER_PROBE_KEY is unset or a value this repository ships, so
 * global-probe registration is refused from every caller. Read by the
 * registration route, never as a fallback identity.
 */
export const IsRegisterProbeKeyShipped: boolean = isShippedSecretValue(
  process.env["REGISTER_PROBE_KEY"],
);

/*
 * Said once at boot by the app (App/Index.ts) when REGISTER_PROBE_KEY is
 * unset or a value this repository ships, or null: every global probe's
 * registration is refused until it is the installation's own, and the probe
 * says so only in its own log.
 */
export const RegisterProbeKeyWarning: string | null = IsRegisterProbeKeyShipped
  ? 'REGISTER_PROBE_KEY is unset or still a value shipped in the OneUptime repository ("secret", or a "please-change-this-to-random-value" placeholder from config.example.env). OneUptime refuses that value, so no probe can register as a global probe until REGISTER_PROBE_KEY is a long random value, the same on the app and on every global probe. npm start and npm run update put one in config.env for Docker Compose; with Helm, leave registerProbeKey empty to have the chart generate one, or set it to one.'
  : null;

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

/*
 * The cache and queue tier runs Valkey -- the BSD-licensed fork of Redis 7.2 --
 * so its settings are named VALKEY_*. Any Redis-protocol server works here,
 * including real Redis, which is why the in-code names below stay `Redis*`:
 * they describe the protocol, not the vendor.
 *
 * The REDIS_* names these shipped under are still read, so an existing
 * config.env or values.yaml keeps working untouched. They are DEPRECATED, not
 * removed; VALKEY_* wins when both are set. Nothing here may start requiring
 * the new name -- a self-hoster who never edits config.env must keep running.
 *
 * `||` here is load-bearing and must not be "modernised" to `??`. Compose
 * materialises an unset variable as an EMPTY STRING, and docker-compose.base.yml
 * lists every VALKEY_* name, so the new name is always *defined* inside our
 * containers. Under `??` an empty VALKEY_PASSWORD would beat the operator's real
 * REDIS_PASSWORD and the app would silently fall through to the literal default
 * below.
 */
export function getCacheEnvVar(suffix: string): string | undefined {
  return (
    process.env[`VALKEY_${suffix}`] ||
    process.env[`REDIS_${suffix}`] ||
    undefined
  );
}

/*
 * The cache does not require a password.
 *
 * The default hostname stays "redis" even though the compose service is now
 * `valkey`. This default is only reached when NEITHER variable is set, which
 * never happens in our own compose or Helm -- both always set them. What it does
 * cover is hand-written Kubernetes manifests, a bare `docker run`, and third
 * party compose files, where the Service has been called `redis` for years.
 * Compose is unaffected either way: its valkey service answers to `redis` too.
 */
export const RedisHostname: string = getCacheEnvVar("HOST") || "redis";
export const RedisPort: Port = new Port(getCacheEnvVar("PORT") || "6379");
export const RedisDb: number = Number(getCacheEnvVar("DB")) || 0;
export const RedisUsername: string = getCacheEnvVar("USERNAME") || "default";
export const RedisPassword: string = getCacheEnvVar("PASSWORD") || "password";

export const RedisTlsCa: string | undefined = getCacheEnvVar("TLS_CA");

export const RedisTlsCert: string | undefined = getCacheEnvVar("TLS_CERT");

export const RedisTlsKey: string | undefined = getCacheEnvVar("TLS_KEY");

export const RedisTlsSentinelMode: boolean =
  getCacheEnvVar("TLS_SENTINEL_MODE") === "true";

export const ShouldRedisTlsEnable: boolean = Boolean(
  RedisTlsCa || (RedisTlsCert && RedisTlsKey),
);

export const RedisIPFamily: number = getCacheEnvVar("IP_FAMILY")
  ? Number(getCacheEnvVar("IP_FAMILY"))
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
 * Whether ingress traffic reaches this process: the agents', collectors',
 * probes' and heartbeat senders' requests. Default true - the single App
 * container of docker-compose, and the Helm chart's app pods, take it. The
 * Helm chart's worker pods run the same image with no ingress in front of
 * them and set it to "false", so they never vouch that OneUptime was
 * receiving (InstanceReceivingHeartbeat): if every app pod is down while the
 * workers keep running, that time is still recorded as time OneUptime was
 * not receiving, and nobody's hosts are marked down for it.
 */
export const ReceivesIngressTraffic: boolean =
  process.env["RECEIVES_INGRESS_TRAFFIC"] !== "false";

/*
 * When "false", this process does NOT run schema or data migrations on boot.
 * Set on runtime pods (app/worker/nginx) when a dedicated one-shot migrate Job
 * (App/Migrate.ts) owns migrations instead, so the fleet's many replicas never
 * run them — which keeps boot DDL off pooled connections and, since the data
 * migration runner no longer takes an advisory lock, is also what keeps two
 * replicas from running the same migration concurrently.
 *
 * Such a process still does not start on a schema older than its code: it
 * waits, in PostgresDatabase.connect(), for the schema migrations it knows to
 * be applied (DATABASE_MIGRATION_WAIT_TIMEOUT_MS).
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

/*
 * THE DATASTORE PASSWORDS
 *
 * config.example.env ships DATABASE_PASSWORD, CLICKHOUSE_PASSWORD and
 * VALKEY_PASSWORD as placeholders, which are public in this repository. With
 * Docker Compose, npm start gives the bundled ClickHouse and Valkey random
 * passwords on any start, and the bundled PostgreSQL one before it creates
 * its database (Scripts/Install). An installation started another way, or
 * whose database was created with the placeholder, keeps it until an
 * operator changes it, which the app cannot do for a datastore. So the app
 * says, once at boot (App/Index.ts), which of them still holds a value this
 * repository ships. A blank password is an operator's own choice (a cache
 * without a password), so only a value that is not blank counts.
 */
export const ChangeDatabasePasswordDocsUrl: string =
  "https://oneuptime.com/docs/installation/docker-compose#change-the-database-password";

export const ShippedDatastorePasswordSettings: Array<string> = (
  [
    ["DATABASE_PASSWORD", process.env["DATABASE_PASSWORD"]],
    ["CLICKHOUSE_PASSWORD", process.env["CLICKHOUSE_PASSWORD"]],
    // VALKEY_PASSWORD, or the REDIS_PASSWORD it was called before.
    ["VALKEY_PASSWORD", getCacheEnvVar("PASSWORD")],
  ] as Array<[string, string | undefined]>
)
  .filter((setting: [string, string | undefined]): boolean => {
    const value: string | undefined = setting[1];

    return (
      typeof value === "string" &&
      value.trim() !== "" &&
      isShippedSecretValue(value)
    );
  })
  .map((setting: [string, string | undefined]): string => {
    return setting[0];
  });

// What the app says about `settings`, or null when there are none.
export function describeShippedDatastorePasswords(
  settings: Array<string>,
): string | null {
  if (settings.length === 0) {
    return null;
  }

  const named: string =
    settings.length === 1
      ? settings[0]!
      : `${settings.slice(0, -1).join(", ")} and ${settings[settings.length - 1]}`;

  return `${named} still ${settings.length === 1 ? "holds" : "hold"} a value shipped in the OneUptime repository ("secret", or a "please-change-this-to-random-value" placeholder from config.example.env), which is public. With Docker Compose, npm start and npm run update give the bundled ClickHouse and Valkey a random password, and ${ChangeDatabasePasswordDocsUrl} shows how to change PostgreSQL's. A datastore OneUptime does not run needs a long random password of its own, set here and on the datastore.`;
}

export const DatastorePasswordWarning: string | null =
  describeShippedDatastorePasswords(ShippedDatastorePasswordSettings);

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

// One year: what browsers and security scanners expect of an HTTPS-only site.
export const DEFAULT_HSTS_MAX_AGE_SECONDS: number = 365 * 24 * 60 * 60;

// A number of seconds as the header writes it: plain digits, nothing else.
const HSTS_MAX_AGE_DIGITS: RegExp = /^\d+$/;

/*
 * How long a browser keeps to HTTPS for this installation's own address
 * (HOST) once it has reached it over HTTPS: the max-age of the
 * Strict-Transport-Security header that an installation with
 * HTTP_PROTOCOL=https sends (Server/Utils/RequestTransport.ts).
 *
 * One year unless HSTS_MAX_AGE_SECONDS says otherwise. 0 is the way back: it
 * tells every browser that visits over HTTPS to forget the rule, for when the
 * address has to answer over plain HTTP again. Anything that is not a whole,
 * non-negative number of seconds keeps the default, so a typo never turns
 * the protection off.
 *
 * That means plain digits, and a number small enough to be written back as
 * digits. "1e3" or "+600" is a typo here, and a value past
 * Number.MAX_SAFE_INTEGER (a few zeros too many) would come out of the
 * header as "max-age=3.1536e+22", which browsers do not read as a max-age:
 * they ignore the whole header, and the protection is off.
 */
export const parseHstsMaxAgeSeconds: (
  rawValue: string | undefined,
) => number = (rawValue: string | undefined): number => {
  const trimmedValue: string = rawValue?.trim() || "";

  if (!HSTS_MAX_AGE_DIGITS.test(trimmedValue)) {
    return DEFAULT_HSTS_MAX_AGE_SECONDS;
  }

  const parsedValue: number = Number(trimmedValue);

  if (!Number.isSafeInteger(parsedValue)) {
    return DEFAULT_HSTS_MAX_AGE_SECONDS;
  }

  return parsedValue;
};

export const HstsMaxAgeSeconds: number = parseHstsMaxAgeSeconds(
  process.env["HSTS_MAX_AGE_SECONDS"],
);

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

/*
 * Feedback people give an answer from OneUptime AI in a chat - a 👍 or a 👎
 * in Microsoft Teams, and what they wrote - reported to the operator.
 */
export const NotificationSlackWebhookOnAiFeedback: string =
  process.env["NOTIFICATION_SLACK_WEBHOOK_ON_AI_FEEDBACK"] || "";

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
 * The App's own API at its internal address, for the requests the App makes
 * to itself: plain HTTP to SERVER_APP_HOSTNAME:APP_PORT, the address Nginx
 * proxies /api to, as the App's other server-to-server calls make them
 * (MailService, the MCP server's tools, ...).
 *
 * Never the public address, HTTP_PROTOCOL + HOST: a request sent there leaves
 * the App and comes back in through Nginx, which works only where the App can
 * reach the address people use. With HOST=localhost - a local install, and the
 * e2e stack - that is the App container itself, where nothing listens on port
 * 80, so every request failed with "connect ECONNREFUSED 127.0.0.1:80"; split
 * DNS, egress rules or a self-signed certificate break it the same way.
 */
const AppApiInternalUrl: URL = new URL(
  Protocol.HTTP,
  AppApiHostname,
  new Route(AppApiRoute.toString()),
);

/*
 * The status page API, for the servers that render a status page: what the
 * page is (/seo - its title, description, search engine indexing and theme,
 * which its HTML is sent in before any script runs), and its RSS feed and
 * llms.txt. The internal path is /api/status-page (not /status-page-api)
 * because /status-page-api is the external route that Nginx rewrites to
 * /api/status-page.
 */
export const StatusPageApiInternalUrl: URL = URL.fromString(
  AppApiInternalUrl.toString(),
).addRoute(new Route("/status-page"));

/*
 * The public dashboard API, for the servers that render a public dashboard.
 * The internal path is /api/dashboard (not /public-dashboard-api) because
 * /public-dashboard-api is the external route that Nginx rewrites to
 * /api/dashboard.
 */
export const DashboardApiInternalUrl: URL = URL.fromString(
  AppApiInternalUrl.toString(),
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
 * OAuth sign-in for the MCP server: the authorization server under
 * /mcp/oauth, its discovery documents under /.well-known, and the consent
 * screen at /accounts/mcp-authorize, which together let an MCP client connect
 * by having a project member sign in instead of being handed an API key.
 *
 * Kill switch. When true none of that is served and an OAuth access token is
 * refused wherever it is presented, so the MCP server behaves exactly as it
 * did before OAuth existed: API keys only. Nothing is deleted - the grants
 * people made are still there when it is flipped back.
 */
export const DisableMcpOAuth: boolean =
  process.env["DISABLE_MCP_OAUTH"] === "true";

/*
 * A client may identify itself with a Client ID Metadata Document: its client
 * id is an https URL, and this server fetches that URL to learn the client's
 * name and redirect URIs. That is an outbound request to wherever the client
 * says, so it only works on an instance that can reach the internet.
 *
 * Set this on an instance that cannot. The authorization server then stops
 * advertising the feature and clients fall back to registering themselves
 * (Dynamic Client Registration), which needs no outbound request at all.
 */
export const DisableMcpOAuthClientIdMetadataDocuments: boolean =
  process.env["DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS"] === "true";

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

/*
 * Which edition this process should run (ONEUPTIME_EDITION):
 *   auto        (default) load the enterprise module from ee/ when it is present
 *   community   never load it, even when ee/ is present
 *   enterprise  it MUST load; a missing or broken ee/ stops the boot (the
 *               Enterprise image sets this, so a broken image never silently
 *               runs as the Community Edition)
 *
 * The effective edition is EnterpriseEdition.isLoaded(), decided at boot by
 * packages/App/Utils/EnterpriseLoader.ts. IS_ENTERPRISE_EDITION above turns
 * nothing on: it only says the Enterprise Edition is expected (see
 * isEnterpriseEditionRequested below), and the boot stops when it is expected
 * but the enterprise module did not load.
 */
export type OneUptimeEditionSetting = "auto" | "community" | "enterprise";

export const ONEUPTIME_EDITION_SETTINGS: ReadonlyArray<OneUptimeEditionSetting> =
  ["auto", "community", "enterprise"];

// Unset or blank reads as "auto"; an unrecognised value is null.
export const parseOneUptimeEdition: (
  rawValue: string | undefined,
) => OneUptimeEditionSetting | null = (
  rawValue: string | undefined,
): OneUptimeEditionSetting | null => {
  const value: string = (rawValue || "").trim().toLowerCase();

  if (!value) {
    return "auto";
  }

  return (
    ONEUPTIME_EDITION_SETTINGS.find(
      (setting: OneUptimeEditionSetting): boolean => {
        return setting === value;
      },
    ) || null
  );
};

/*
 * Null when ONEUPTIME_EDITION holds something unrecognised: the loader refuses
 * to boot rather than guess which edition a typo meant.
 */
export const OneUptimeEdition: OneUptimeEditionSetting | null =
  parseOneUptimeEdition(process.env["ONEUPTIME_EDITION"]);

/*
 * Whether this install asks for the Enterprise Edition: IS_ENTERPRISE_EDITION
 * is exactly "true", unless ONEUPTIME_EDITION=community explicitly chooses the
 * Community Edition. The Enterprise image bakes IS_ENTERPRISE_EDITION=true, and
 * ONEUPTIME_EDITION=community is the documented way to run that image as the
 * Community Edition, so that combination is a deliberate choice, not a
 * mismatch.
 *
 * This is the one definition behind both the App's boot guard
 * (packages/App/Utils/EnterpriseLoader.ts: requested but not loaded stops the
 * boot) and the frontends' ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED notice
 * (Server/Utils/FrontendEnvironment.ts), so the two never disagree. It takes
 * the environment as an argument, so a caller can read it when it needs to.
 */
export const isEnterpriseEditionRequested: (
  environment: Record<string, string | undefined>,
) => boolean = (environment: Record<string, string | undefined>): boolean => {
  return (
    environment["IS_ENTERPRISE_EDITION"] === "true" &&
    parseOneUptimeEdition(environment["ONEUPTIME_EDITION"]) !== "community"
  );
};

export const IsEnterpriseEditionRequested: boolean =
  isEnterpriseEditionRequested(process.env);

/*
 * Overrides where the loader looks for the ee/ directory (tests and fixtures).
 * Unset: the repo layout <root>/ee, then the container layout /usr/src/ee.
 */
export const OneUptimeEnterpriseDirectory: string | undefined =
  process.env["ONEUPTIME_EE_DIR"]?.trim() || undefined;

/*
 * The hosted oneuptime.com (billing enabled) must run the Enterprise image:
 * on the Community image paid SCIM and audit logging would silently stop, and
 * the license server self-hosted customers activate against would be gone. The
 * boot refuses that combination unless this development escape hatch is set.
 */
export const AllowBillingWithoutEnterprise: boolean =
  process.env["ALLOW_BILLING_WITHOUT_ENTERPRISE"] === "true";

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

/*
 * The apps behind the one-click Connect of a video call provider
 * (VideoCallAuthMethod.OAuth): someone signs in to Zoom, Google or Microsoft
 * and allows this app to create meetings as that account. A provider whose
 * client id and secret are both set is offered as one click on the Video
 * Calls page; without them, a project connects its own app instead.
 *
 * The Teams meetings app is its own registration, not the Teams bot's
 * (MICROSOFT_TEAMS_APP_CLIENT_ID): it asks a person for delegated meeting
 * permissions, which the bot's admin consent does not cover, and a
 * deployment that sets up the bot must not start sending people to a
 * sign-in its registration has no redirect URI for.
 *
 * ZOOM_APP_WEBHOOK_SECRET_TOKEN verifies the events Zoom sends when someone
 * removes the app from their Zoom account (/api/video-call-oauth/zoom/events).
 */
export const ZoomAppClientId: string | null =
  process.env["ZOOM_APP_CLIENT_ID"] || null;
export const ZoomAppClientSecret: string | null =
  process.env["ZOOM_APP_CLIENT_SECRET"] || null;
export const ZoomAppWebhookSecretToken: string | null =
  process.env["ZOOM_APP_WEBHOOK_SECRET_TOKEN"] || null;

export const GoogleMeetAppClientId: string | null =
  process.env["GOOGLE_MEET_APP_CLIENT_ID"] || null;
export const GoogleMeetAppClientSecret: string | null =
  process.env["GOOGLE_MEET_APP_CLIENT_SECRET"] || null;

export const MicrosoftTeamsMeetingsAppClientId: string | null =
  process.env["MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_ID"] || null;
export const MicrosoftTeamsMeetingsAppClientSecret: string | null =
  process.env["MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_SECRET"] || null;

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

/*
 * Cloud marketplaces - selling OneUptime Cloud on AWS Marketplace, Microsoft
 * Marketplace (Azure) and Google Cloud Marketplace. Used only where billing is
 * enabled (OneUptime Cloud); a marketplace whose settings are not all present
 * is simply not offered. What each value is, and where it comes from in each
 * marketplace's seller portal, is in
 * Server/Utils/Marketplace/RELEASING.md.
 *
 * AWS: an IAM user of the seller account allowed ResolveCustomer,
 * BatchMeterUsage, GetEntitlements and DescribeAgreement; the product code of
 * the SaaS listing; and the secret the EventBridge API destination sends with
 * every event (/api/marketplace/aws/events).
 */
export const AwsMarketplaceAccessKeyId: string | null =
  process.env["AWS_MARKETPLACE_ACCESS_KEY_ID"] || null;
export const AwsMarketplaceSecretAccessKey: string | null =
  process.env["AWS_MARKETPLACE_SECRET_ACCESS_KEY"] || null;
export const AwsMarketplaceProductCode: string | null =
  process.env["AWS_MARKETPLACE_PRODUCT_CODE"] || null;
export const AwsMarketplaceEventsSecret: string | null =
  process.env["AWS_MARKETPLACE_EVENTS_SECRET"] || null;

/*
 * Azure: the single-tenant Microsoft Entra app registered in the offer's
 * Technical configuration. It calls the SaaS fulfillment and metering APIs,
 * and the webhook's bearer token is issued for it.
 */
export const AzureMarketplaceTenantId: string | null =
  process.env["AZURE_MARKETPLACE_TENANT_ID"] || null;
export const AzureMarketplaceClientId: string | null =
  process.env["AZURE_MARKETPLACE_CLIENT_ID"] || null;
export const AzureMarketplaceClientSecret: string | null =
  process.env["AZURE_MARKETPLACE_CLIENT_SECRET"] || null;

/*
 * Google Cloud: the partner (provider) ID from Producer Portal, the JSON key
 * of the service account linked there for the Procurement API, Pub/Sub and
 * Service Control (raw JSON or base64), and the Service Control service and
 * metric usage is reported to. The sign-up token's audience is the domain the
 * product is listed under (the host, unless set); the Pub/Sub push
 * subscription signs each delivery as the named service account, for the
 * named audience (the push endpoint's URL, unless set).
 */
export const GoogleCloudMarketplaceProviderId: string | null =
  process.env["GOOGLE_CLOUD_MARKETPLACE_PROVIDER_ID"] || null;
export const GoogleCloudMarketplaceServiceAccountKey: string | null =
  process.env["GOOGLE_CLOUD_MARKETPLACE_SERVICE_ACCOUNT_KEY"] || null;
export const GoogleCloudMarketplaceServiceName: string | null =
  process.env["GOOGLE_CLOUD_MARKETPLACE_SERVICE_NAME"] || null;
export const GoogleCloudMarketplaceUsageMetric: string | null =
  process.env["GOOGLE_CLOUD_MARKETPLACE_USAGE_METRIC"] || null;
export const GoogleCloudMarketplaceSignupAudience: string | null =
  process.env["GOOGLE_CLOUD_MARKETPLACE_SIGNUP_AUDIENCE"] || null;
export const GoogleCloudMarketplacePubSubServiceAccountEmail: string | null =
  process.env["GOOGLE_CLOUD_MARKETPLACE_PUBSUB_SERVICE_ACCOUNT_EMAIL"] || null;
export const GoogleCloudMarketplacePubSubAudience: string | null =
  process.env["GOOGLE_CLOUD_MARKETPLACE_PUBSUB_AUDIENCE"] || null;

/*
 * Vercel Marketplace: OneUptime as a native integration
 * (ee/Server/CloudMarketplace/Vercel, VERCEL_RELEASING.md). The integration's
 * client ID (oac_...) is the audience of every token Vercel signs for
 * OneUptime; its client secret signs webhooks and drain deliveries and
 * exchanges sign-in codes.
 */
export const VercelMarketplaceClientId: string | null =
  process.env["VERCEL_MARKETPLACE_CLIENT_ID"] || null;
export const VercelMarketplaceClientSecret: string | null =
  process.env["VERCEL_MARKETPLACE_CLIENT_SECRET"] || null;

/*
 * Sign in with Microsoft: a multi-tenant Microsoft Entra app (work, school
 * and personal Microsoft accounts) that lets anyone sign in to OneUptime with
 * their Microsoft account. Microsoft Marketplace requires it of a SaaS offer
 * sold through Microsoft: the buyer must be able to sign in with the account
 * they bought with. The client id is public (the sign-in page shows the
 * button when it is set); the secret is not.
 */
export const MicrosoftSignInClientId: string | null =
  process.env["MICROSOFT_SIGN_IN_CLIENT_ID"] || null;
export const MicrosoftSignInClientSecret: string | null =
  process.env["MICROSOFT_SIGN_IN_CLIENT_SECRET"] || null;

// VAPID Configuration for Web Push Notifications
export const VapidPublicKey: string | undefined =
  process.env["VAPID_PUBLIC_KEY"] || undefined;

/*
 * Read trimmed: on Kubernetes the key can come from a Secret the operator
 * manages (the chart's vapid.existingSecret), and a Secret created from a file
 * keeps the file's last newline. web-push refuses a key with anything around
 * it, which failed every web push.
 */
export const VapidPrivateKey: string | undefined =
  process.env["VAPID_PRIVATE_KEY"]?.trim() || undefined;

export const VapidSubject: string =
  process.env["VAPID_SUBJECT"] || "mailto:support@oneuptime.com";

export const ExpoAccessToken: string | undefined =
  process.env["EXPO_ACCESS_TOKEN"] || undefined;

export const PushNotificationRelayUrl: string =
  process.env["PUSH_NOTIFICATION_RELAY_URL"] ||
  "https://oneuptime.com/api/notification/push-relay/send";

/*
 * Whether this server relays mobile pushes for other OneUptime servers: the
 * push relay (App/FeatureSet/Notification/API/PushRelay.ts), which sends
 * what another server asks it to with this server's EXPO_ACCESS_TOKEN, and
 * reads those pushes' receipts.
 *
 * OneUptime's cloud is the relay a self-hosted server sends through by
 * default (PUSH_NOTIFICATION_RELAY_URL), so where BILLING_ENABLED is true it
 * is on unless PUSH_NOTIFICATION_RELAY_SERVER_ENABLED says otherwise.
 * Anywhere else it is off unless set to exactly "true": an EXPO_ACCESS_TOKEN
 * set for a server's own pushes does not make it a relay for others.
 *
 * Empty or unset: on only where BILLING_ENABLED is true. "true": on.
 * Anything else: off - a value that is not "true" never turns a relay on.
 */
export const readPushNotificationRelayServerEnabled: (data: {
  value: string | undefined;
  isBillingEnabled: boolean;
}) => boolean = (data: {
  value: string | undefined;
  isBillingEnabled: boolean;
}): boolean => {
  const value: string = (data.value || "").trim();

  if (!value) {
    return data.isBillingEnabled;
  }

  return value === "true";
};

export const PushNotificationRelayServerEnabled: boolean =
  readPushNotificationRelayServerEnabled({
    value: process.env["PUSH_NOTIFICATION_RELAY_SERVER_ENABLED"],
    isBillingEnabled: IsBillingEnabled,
  });

export const DEFAULT_ENTERPRISE_LICENSE_SERVER_URL: string =
  "https://oneuptime.com";

const TRAILING_SLASHES_PATTERN: RegExp = /\/+$/;

/*
 * The license server self-hosted Enterprise installs activate against and
 * report seat usage to. Overridable for a staging license server or an
 * internal relay. The license key travels in these requests, so plain http is
 * accepted only when `allowInsecure` (development and test environments);
 * anything else unusable - empty, unparseable, another scheme, or http in
 * production - falls back to the default rather than sending the key in the
 * clear.
 */
export const resolveEnterpriseLicenseServerUrl: (
  rawValue: string | undefined,
  allowInsecure: boolean,
) => string = (
  rawValue: string | undefined,
  allowInsecure: boolean,
): string => {
  const value: string = (rawValue || "")
    .trim()
    .replace(TRAILING_SLASHES_PATTERN, "");

  if (!value) {
    return DEFAULT_ENTERPRISE_LICENSE_SERVER_URL;
  }

  const lowerCasedValue: string = value.toLowerCase();
  const isHttps: boolean = lowerCasedValue.startsWith("https://");
  const isHttp: boolean = lowerCasedValue.startsWith("http://");

  if (!isHttps && !(isHttp && allowInsecure)) {
    return DEFAULT_ENTERPRISE_LICENSE_SERVER_URL;
  }

  try {
    URL.fromString(value);
  } catch {
    return DEFAULT_ENTERPRISE_LICENSE_SERVER_URL;
  }

  return value;
};

const enterpriseLicenseServerUrlValue: string =
  resolveEnterpriseLicenseServerUrl(
    process.env["ENTERPRISE_LICENSE_SERVER_URL"],
    IsDevelopment || IsTest,
  );

export const EnterpriseLicenseServerUrl: URL = URL.fromString(
  enterpriseLicenseServerUrlValue,
);

export const EnterpriseLicenseValidationUrl: URL = URL.fromString(
  `${enterpriseLicenseServerUrlValue}/api/enterprise-license/validate`,
);

export const EnterpriseLicenseUserCountReportUrl: URL = URL.fromString(
  `${enterpriseLicenseServerUrlValue}/api/enterprise-license/report-user-count`,
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

/*
 * THE INBOUND EMAIL WEBHOOK SECRET (INBOUND_EMAIL_WEBHOOK_SECRET)
 *
 * The mail provider delivers every email sent to the inbound domain by
 * posting it to /incoming-email/sendgrid/<secret>, an address anybody can
 * reach. What is delivered there becomes an Incoming Email monitor's or a
 * workflow's email: it opens and resolves incidents and alerts and starts
 * workflows. The last part of that address is the one thing that tells the
 * provider's deliveries from anybody else's, so a delivery is taken only
 * when it ends with this installation's own secret.
 *
 * InboundEmailWebhookSecret is the value as the operator set it, whitespace
 * around it ignored, or undefined when there is none the installation may
 * use: unset or blank, a value this repository ships (isShippedSecretValue),
 * or a placeholder the setup guide prints (PublishedInboundEmailWebhookSecrets,
 * whatever its case). Without one, every delivery is refused, as nothing
 * could tell the provider's from anybody else's: the webhook answers 503,
 * which the provider retries for up to three days, so the mail sent while an
 * operator sets the secret arrives once it is set.
 */
export const PublishedInboundEmailWebhookSecrets: ReadonlyArray<string> = [
  "your_secret",
  "your-secret",
  "replace-with-a-strong-random-secret",
];

export function getUsableInboundEmailWebhookSecret(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== "string" || isShippedSecretValue(value)) {
    return undefined;
  }

  const trimmed: string = value.trim();

  if (PublishedInboundEmailWebhookSecrets.includes(trimmed.toLowerCase())) {
    return undefined;
  }

  return trimmed;
}

export const InboundEmailWebhookSecret: string | undefined =
  getUsableInboundEmailWebhookSecret(
    process.env["INBOUND_EMAIL_WEBHOOK_SECRET"],
  );

export const InboundEmailSetupDocsUrl: string =
  "https://oneuptime.com/docs/self-hosted/sendgrid-inbound-email#configure-oneuptime";

/*
 * Said once at boot by the app (App/Index.ts) when incoming email is on
 * (INBOUND_EMAIL_DOMAIN) and there is no secret it may use, or null: every
 * delivery is refused until there is, and the provider says so to no one.
 * Names the setting and what to set it to, never a value.
 */
export const InboundEmailWebhookSecretWarning: string | null =
  InboundEmailDomain && !InboundEmailWebhookSecret
    ? `INBOUND_EMAIL_DOMAIN is set, but INBOUND_EMAIL_WEBHOOK_SECRET is unset, blank or a placeholder from the OneUptime repository or its docs, so nothing proves an email was delivered by SendGrid. OneUptime refuses every email delivered to the inbound domain until it is set (with 503, which SendGrid retries for up to three days), and none reaches an Incoming Email monitor or a workflow. If the Destination URL in SendGrid's Inbound Parse settings already ends with a long random value of your own, set INBOUND_EMAIL_WEBHOOK_SECRET to that value. Otherwise change that URL first, to end with a new long random value (https://<your OneUptime host>/incoming-email/sendgrid/<the new value>), and then set INBOUND_EMAIL_WEBHOOK_SECRET to the same value, so that SendGrid retries the emails sent in between instead of having them refused for a wrong secret. With Docker Compose, set it in config.env and run npm start; with Helm, set inboundEmail.webhookSecret and upgrade the release. See ${InboundEmailSetupDocsUrl}.`
    : null;
