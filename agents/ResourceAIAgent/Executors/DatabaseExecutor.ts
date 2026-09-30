import fs from "fs";
import {
  DATABASE_SERVER_ADDRESS_ENV,
  DATABASE_SERVER_PORT_ENV,
  DATABASE_SYSTEM_ENV,
  parseTcpPort,
  resolveDatabaseServerEndpoint,
} from "../Config";
import PrepareGuard, { GuardResult, refusalPrefix } from "./PrepareGuard";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  ResourceCommandRequest,
  ResourceExecutor,
  ResourcePostureProbe,
} from "./ResourceExecutor";
import {
  describeKill,
  formatResourceOutput,
  redactOutput,
  replaceNulCharacters,
} from "./SpawnSandbox";
import {
  DatabaseConnectOptions,
  DatabaseDriverFactory,
  MongoConnection,
  NODE_DATABASE_DRIVERS,
  RedisConnection,
  SqlConnection,
} from "./Database/DatabaseDrivers";
import { OutputFormat, renderSections } from "./Database/DatabaseOutput";
import {
  AI_DATABASE_CA_FILE_ENV,
  DATABASE_TLS_INSECURE_ENV,
  DATABASE_TLS_INSECURE_SKIP_VERIFY_ENV,
  DEFAULT_MONGO_AUTH_SOURCE,
  DEFAULT_POSTGRES_DATABASE,
  DatabaseSettings,
  DatabaseSettingsResult,
  DatabaseTlsMode,
  resolveDatabaseSettings,
} from "./Database/DatabaseSettings";
import {
  DATABASE_AI_AGENT_APPLICATION_NAME,
  DiagnosticOutcome,
  DiagnosticRun,
  EngineProbe,
  errorCode,
  errorMessage,
} from "./Database/DiagnosticTypes";
import {
  describeMongoError,
  probeMongo,
  runMongoDiagnostic,
} from "./Database/MongoDiagnostics";
import {
  describeMySqlError,
  probeMySql,
  runMySqlDiagnostic,
} from "./Database/MySqlDiagnostics";
import {
  describePostgresError,
  probePostgres,
  runPostgresDiagnostic,
} from "./Database/PostgresDiagnostics";
import {
  describeRedisError,
  probeRedis,
  runRedisDiagnostic,
} from "./Database/RedisDiagnostics";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import {
  MAX_RESOURCE_AGENT_OUTPUT_BYTES,
  ResourceCommandTier,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  DATABASE_PROGRAM,
  DatabaseCommandParse,
  DatabaseEngine,
  ParsedDatabaseCommand,
  getDatabaseEngineRefusal,
  parseDatabaseCommand,
} from "../Common/Utils/AiRemediation/Resource/DatabaseDiagnosticCatalog";

/*
 * The executor for database servers. There is no `db` binary: a command
 * OneUptime AI composed from the typed diagnostic catalog —
 *
 *   db sessions --state active --limit 20
 *   db long-queries --min-seconds 30
 *   db cancel-query 4242
 *
 * — is read by the policy copy's parseDatabaseCommand (the SAME parse that
 * tiered it, so the words are never read twice) into one catalog
 * operation, which the engine's diagnostics module (Database/<Engine>
 * Diagnostics.ts) runs as the statements or commands it owns, through the
 * engine's Node driver, never text the model wrote. See ResourceExecutor
 * for the contract every executor keeps; what this one adds:
 *
 *   - prepare() runs PrepareGuard first, then reads the argv into its
 *     catalog operation, refuses it when the catalog ranks it above the
 *     tier the guard allowed (a write only ever runs as a write), reads the
 *     connection settings (DatabaseSettings: DATABASE_SYSTEM,
 *     DATABASE_ENDPOINT, the login, TLS), and refuses what this engine
 *     cannot run (getDatabaseEngineRefusal). An engine the catalog has no
 *     operations for (SQL Server, Oracle, Elasticsearch, Memcached) is
 *     refused as "not supported for AI diagnostics yet". Nothing connects
 *     before run().
 *   - One connection per command, closed afterwards; a connect timeout; and
 *     the command's whole budget as a hard limit — on expiry the connection
 *     is dropped, and each statement also carries a server-side time limit
 *     that ends before the budget does. Reads run read-only (a READ ONLY
 *     transaction, a read-only session, read commands only).
 *   - The two writes never touch the agent's own session: each module looks
 *     up its own connection id first and refuses it, along with sessions
 *     that are not there or are not a client's.
 *   - Output is an aligned table (query text last and normalized), redacted
 *     with the policy copy's redactor (which masks SQL literals, Redis AUTH
 *     and credential settings) and capped at
 *     MAX_RESOURCE_AGENT_OUTPUT_BYTES. The login's password never appears in
 *     output, errors, logs or the posture.
 *
 * How a failure reads on the server (the run-state rules): a command that
 * never reached the database (a refusal, a bad setting, a failed connect,
 * a write stopped before its KILL) has no exit code and no output — "never
 * ran". An error answer from the server has exit code 1; a command that
 * outlived its budget is "Killed (timeout ...)": both read as "ran", so a
 * write that may have landed is never forgotten or repeated.
 */

// How long a connection may take to open (the command's budget caps it too).
export const DEFAULT_CONNECT_TIMEOUT_MS: number = 10_000;

/*
 * The posture probe's connect timeout and its whole budget: inside the
 * agent's own probe timeout (Posture's DEFAULT_PROBE_TIMEOUT_MS, 15 s), so
 * the probe ends with its own reason.
 */
export const POSTURE_CONNECT_TIMEOUT_MS: number = 6_000;
export const POSTURE_TIMEOUT_MS: number = 10_000;

// Each statement's server-side limit ends this long before the command's budget.
export const STATEMENT_TIMEOUT_HEADROOM_MS: number = 1_000;
export const MIN_STATEMENT_TIMEOUT_MS: number = 1_000;
// A statement never waits longer than this for a lock.
export const MAX_LOCK_TIMEOUT_MS: number = 5_000;
// A write looks at its target again after this long.
export const WRITE_SETTLE_MS: number = 500;
// The largest CA bundle read from ONEUPTIME_AI_DATABASE_CA_FILE.
export const MAX_CA_FILE_BYTES: number = 1024 * 1024;

// A password shorter than this is not scrubbed from messages (it would mangle them).
const MIN_SCRUBBED_SECRET_LENGTH: number = 4;
const SCRUBBED_SECRET: string = "[redacted]";

const TIER_RANK: Readonly<Record<string, number>> = {
  [ResourceCommandTier.Read]: 0,
  [ResourceCommandTier.SafeWrite]: 1,
  [ResourceCommandTier.RiskyWrite]: 2,
};

// Certificate problems Node reports when verification fails.
const TLS_VERIFY_ERROR_CODES: ReadonlyArray<string> = [
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
];

// Addresses that, inside the agent's container, are the container itself.
const LOOPBACK_HOST_PATTERN: RegExp =
  /^(?:localhost|127(?:\.\d{1,3}){3}|::1|0\.0\.0\.0)$/i;

// Driver messages, by what they mean for an operator.
const REDIS_DATABASE_NUMBER_PATTERN: RegExp = /^(?:0|[1-9][0-9]{0,4})$/;
const PG_HBA_NEEDS_TLS_PATTERN: RegExp =
  /no pg_hba\.conf entry.*(?:SSL off|no encryption)/i;
const CONNECTION_REFUSED_PATTERN: RegExp = /ECONNREFUSED/;
const NAME_NOT_RESOLVED_PATTERN: RegExp = /ENOTFOUND|EAI_AGAIN/;
const NO_ROUTE_PATTERN: RegExp = /EHOSTUNREACH|ENETUNREACH/;
const UNTRUSTED_CERTIFICATE_PATTERN: RegExp =
  /self[- ]signed certificate|unable to verify the first certificate|unable to get (?:local )?issuer certificate|certificate has expired|Hostname\/IP does not match/i;
const TLS_MISMATCH_PATTERN: RegExp =
  /does not support SSL|wrong version number|packet length too long|ssl3_get_record/i;
const TIMEOUT_PATTERN: RegExp = /timed? ?out|timeout/i;
const CONNECTION_CLOSED_PATTERN: RegExp =
  /ECONNRESET|terminated unexpectedly|Connection is closed|socket hang up/i;

/*
 * Test seams, never set by the agent (ExecutorFactory constructs every
 * executor with its options alone).
 */
export interface DatabaseExecutorInternals {
  drivers?: DatabaseDriverFactory | undefined;
  // Waits before a write looks at its target again.
  sleep?: ((ms: number) => Promise<void>) | undefined;
  settleMs?: number | undefined;
  connectTimeoutMs?: number | undefined;
  postureConnectTimeoutMs?: number | undefined;
  postureTimeoutMs?: number | undefined;
}

// A command every check allowed, with what run() needs.
interface DatabaseCall {
  resourceType: AiResourceType;
  displayCommand: string;
  tier: ResourceCommandTier;
  command: ParsedDatabaseCommand;
  settings: DatabaseSettings;
  timeoutInMs: number;
}

// One open connection, whatever the engine.
interface OpenConnection {
  run: (run: DiagnosticRun) => Promise<DiagnosticOutcome>;
  probe: () => Promise<EngineProbe>;
  close: () => Promise<void>;
  destroy: () => void;
}

class DeadlineExpired extends Error {
  public constructor() {
    super("The time budget ran out.");
  }
}

function noop(): void {
  // Deliberately empty: the outcome is already decided.
}

function realSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

/*
 * The promise's answer, or DeadlineExpired after `ms`. The promise keeps
 * running (a driver call cannot be recalled); `onLate` receives what it
 * resolves to after the deadline, so a connection that opens too late is
 * still closed.
 */
function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  onLate?: (value: T) => void,
): Promise<T> {
  return new Promise<T>(
    (resolve: (value: T) => void, reject: (err: unknown) => void): void => {
      let expired: boolean = false;
      const timer: ReturnType<typeof setTimeout> = setTimeout(
        (): void => {
          expired = true;
          reject(new DeadlineExpired());
        },
        Math.max(1, Math.floor(ms)),
      );

      promise.then(
        (value: T): void => {
          if (expired) {
            onLate?.(value);
            return;
          }

          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown): void => {
          if (expired) {
            return;
          }

          clearTimeout(timer);
          reject(err);
        },
      );
    },
  );
}

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOST_PATTERN.test(host);
}

/*
 * Why this engine cannot take the command's arguments, beyond what the
 * catalog checks: a Redis database is a number, and MongoDB measures one
 * database's collections at a time.
 */
export function describeEngineArgumentProblem(
  engine: DatabaseEngine,
  command: ParsedDatabaseCommand,
): string | null {
  const database: unknown = command.flags["database"];

  if (
    engine === DatabaseEngine.Redis &&
    typeof database === "string" &&
    !REDIS_DATABASE_NUMBER_PATTERN.test(database)
  ) {
    return `on Redis --database is a database number (0, 1, ...), not "${database}"`;
  }

  if (
    engine === DatabaseEngine.MongoDB &&
    command.operation.name === "table-sizes" &&
    typeof database !== "string"
  ) {
    return "on MongoDB db table-sizes needs --database NAME (db database-sizes lists the databases)";
  }

  return null;
}

// No answer at all while connecting.
function describeSilence(
  settings: DatabaseSettings,
  connectTimeoutMs: number,
): string {
  const loopbackHint: string = isLoopbackHost(settings.host)
    ? ` Inside the agent's container ${settings.host} is the container itself: use host.docker.internal:${settings.port}, or run the agent with network_mode: host like the collector.`
    : "";
  const tlsHint: string =
    settings.tls === DatabaseTlsMode.Off
      ? ""
      : ` The agent speaks TLS (${DATABASE_TLS_INSECURE_ENV}=false); a server that does not may never answer it — set ${DATABASE_TLS_INSECURE_ENV}=true if it has no TLS.`;

  return `no answer from ${settings.endpoint} within ${connectTimeoutMs} ms: the server is unreachable from the agent (a firewall, the network or the address in ${settings.endpointSource}) or overloaded.${tlsHint}${loopbackHint}`;
}

// Settings problems and connection failures in an operator's words.
export function describeConnectionError(
  err: unknown,
  settings: DatabaseSettings,
  connectTimeoutMs: number,
): string {
  const code: string | null = errorCode(err);
  const message: string = errorMessage(err);
  const loopbackHint: string = isLoopbackHost(settings.host)
    ? ` Inside the agent's container ${settings.host} is the container itself: use host.docker.internal:${settings.port}, or run the agent with network_mode: host like the collector.`
    : "";

  if (PG_HBA_NEEDS_TLS_PATTERN.test(message)) {
    return `the server only accepts this login over TLS (${message}). Set ${DATABASE_TLS_INSECURE_ENV}=false.`;
  }

  const engineDetail: string | null = describeEngineError(err, settings);

  if (engineDetail) {
    return engineDetail;
  }

  if (code === "ECONNREFUSED" || CONNECTION_REFUSED_PATTERN.test(message)) {
    return `nothing accepts connections at ${settings.endpoint} (${settings.endpointSource}). Check the address, that the server is up, and that it listens on an address the agent's container can reach.${loopbackHint}`;
  }

  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    NAME_NOT_RESOLVED_PATTERN.test(message)
  ) {
    return `the host "${settings.host}" does not resolve from the agent's container. Check ${settings.endpointSource}.`;
  }

  if (
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    NO_ROUTE_PATTERN.test(message)
  ) {
    return `there is no network route from the agent's container to ${settings.endpoint}.${loopbackHint}`;
  }

  if (
    (code && TLS_VERIFY_ERROR_CODES.includes(code)) ||
    UNTRUSTED_CERTIFICATE_PATTERN.test(message)
  ) {
    return `the server's TLS certificate is not trusted (${message}). Set ${AI_DATABASE_CA_FILE_ENV} to the CA bundle that signed it, or ${DATABASE_TLS_INSECURE_SKIP_VERIFY_ENV}=true to accept it without verification.`;
  }

  if (
    code === "EPROTO" ||
    code === "ERR_SSL_WRONG_VERSION_NUMBER" ||
    code === "HANDSHAKE_NO_SSL_SUPPORT" ||
    TLS_MISMATCH_PATTERN.test(message)
  ) {
    return settings.tls === DatabaseTlsMode.Off
      ? `the connection failed at the protocol level (${message}); the server may require TLS. Set ${DATABASE_TLS_INSECURE_ENV}=false.`
      : `the server does not speak TLS on this port (${message}). Set ${DATABASE_TLS_INSECURE_ENV}=true, or turn TLS on in the server.`;
  }

  if (
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    TIMEOUT_PATTERN.test(message)
  ) {
    return describeSilence(settings, connectTimeoutMs);
  }

  if (
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    CONNECTION_CLOSED_PATTERN.test(message)
  ) {
    return `the connection to ${settings.endpoint} was closed (${message}). A TLS mismatch (${DATABASE_TLS_INSECURE_ENV}), a proxy in between, or the server's own connection limits can do this.`;
  }

  return message || "the driver gave no reason";
}

// The engine module's reading of a driver error, or null.
function describeEngineError(
  err: unknown,
  settings: DatabaseSettings,
): string | null {
  switch (settings.engine) {
    case DatabaseEngine.PostgreSQL:
      return describePostgresError(err, {
        username: settings.username,
        credentialSource: settings.credentialSource,
        database: settings.database || DEFAULT_POSTGRES_DATABASE,
      });
    case DatabaseEngine.MySQL:
      return describeMySqlError(err, {
        username: settings.username,
        credentialSource: settings.credentialSource,
      });
    case DatabaseEngine.Redis:
      return describeRedisError(err, {
        username: settings.username,
        credentialSource: settings.credentialSource,
        serverName: settings.serverName,
      });
    case DatabaseEngine.MongoDB:
      return describeMongoError(err, {
        username: settings.username,
        credentialSource: settings.credentialSource,
      });
    default:
      return null;
  }
}

export default class DatabaseExecutor implements ResourceExecutor {
  private readonly drivers: DatabaseDriverFactory;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly settleMs: number;
  private readonly connectTimeoutMs: number;
  private readonly postureConnectTimeoutMs: number;
  private readonly postureTimeoutMs: number;

  public constructor(
    private readonly options: ExecutorOptions,
    internals: DatabaseExecutorInternals = {},
  ) {
    this.drivers = internals.drivers || NODE_DATABASE_DRIVERS;
    this.sleep = internals.sleep || realSleep;
    this.settleMs = internals.settleMs ?? WRITE_SETTLE_MS;
    this.connectTimeoutMs =
      internals.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.postureConnectTimeoutMs =
      internals.postureConnectTimeoutMs ?? POSTURE_CONNECT_TIMEOUT_MS;
    this.postureTimeoutMs = internals.postureTimeoutMs ?? POSTURE_TIMEOUT_MS;
  }

  public prepare(request: ResourceCommandRequest): PrepareResult {
    const guarded: GuardResult = PrepareGuard.check({
      config: this.options.config,
      request,
      protectedTargets: [],
      policy: this.options.guardPolicy,
    });

    if (guarded.refusal !== null) {
      return { refusal: guarded.refusal };
    }

    const refused: string = refusalPrefix(guarded.resourceType);

    /*
     * The operation, from the same parse that tiered the command: the guard
     * already asked the policy, so a refusal here means the two disagree
     * (which only an injected test policy can make happen).
     */
    const parse: DatabaseCommandParse = parseDatabaseCommand(
      guarded.argv.slice(),
    );

    if (!parse.ok) {
      return {
        refusal: `${refused}: its db catalog refuses "${guarded.displayCommand}": ${parse.errorMessage}.`,
      };
    }

    const command: ParsedDatabaseCommand = parse.command;

    if (
      (TIER_RANK[command.operation.tier] ?? Number.MAX_SAFE_INTEGER) >
      (TIER_RANK[guarded.tier] ?? -1)
    ) {
      return {
        refusal: `${refused}: its command policy reads "${guarded.displayCommand}" as ${guarded.tier}, but db ${command.operation.name} is ${command.operation.tier} in its catalog, so it does not run. Run the agent image version that matches your OneUptime server.`,
      };
    }

    const resolved: DatabaseSettingsResult = resolveDatabaseSettings(
      this.options.env,
    );

    if (resolved.settings === null) {
      return { refusal: `${refused}: ${resolved.problem}` };
    }

    const settings: DatabaseSettings = resolved.settings;
    const engineRefusal: string | null =
      getDatabaseEngineRefusal(command, settings.system) ||
      describeEngineArgumentProblem(settings.engine, command);

    if (engineRefusal) {
      return { refusal: `${refused}: ${engineRefusal}.` };
    }

    const call: DatabaseCall = {
      resourceType: guarded.resourceType,
      displayCommand: guarded.displayCommand,
      tier: guarded.tier,
      command,
      settings,
      timeoutInMs: guarded.timeoutInMs,
    };

    return {
      refusal: null,
      displayCommand: guarded.displayCommand,
      tier: guarded.tier,
      run: (): Promise<ExecResult> => {
        return this.run(call);
      },
    };
  }

  public async probePosture(): Promise<ResourcePostureProbe> {
    try {
      return await this.probe();
    } catch (err: unknown) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: this.scrubText(
          `The Database AI agent could not check its database: ${errorMessage(err)}`,
          null,
        ),
        details: this.identityDetails(),
        protectedTargets: [],
      };
    }
  }

  // Nothing is written to disk: there are no job directories to remove.
  public sweepOrphanedJobDirs(): Promise<void> {
    return Promise.resolve();
  }

  public removeAllJobDirs(): Promise<void> {
    return Promise.resolve();
  }

  // ---- Running a command -------------------------------------------------------

  private async run(call: DatabaseCall): Promise<ExecResult> {
    try {
      return await this.runCall(call);
    } catch (err: unknown) {
      /*
       * Not expected (every step below catches its own failures). The
       * database may have been reached, so say so in the output: an empty
       * output would read as "never ran".
       */
      const message: string = this.scrubText(
        `The Database AI agent failed while running "${call.displayCommand}": ${errorMessage(err)}`,
        call.settings,
      );

      return {
        success: false,
        output: formatResourceOutput({
          stdout: "",
          stderr: this.redact(call, message),
        }),
        errorMessage: this.redact(call, message),
      };
    }
  }

  private async runCall(call: DatabaseCall): Promise<ExecResult> {
    const settings: DatabaseSettings = call.settings;
    const startedAtMs: number = Date.now();
    const connectTimeoutMs: number = Math.max(
      1,
      Math.min(this.connectTimeoutMs, call.timeoutInMs),
    );
    const neverRan: (reason: string) => ExecResult = (
      reason: string,
    ): ExecResult => {
      return {
        success: false,
        output: "",
        errorMessage: this.redact(call, this.scrubText(reason, settings)),
      };
    };

    const options: DatabaseConnectOptions | string = this.buildConnectOptions(
      settings,
      call.command,
      connectTimeoutMs,
    );

    if (typeof options === "string") {
      return neverRan(`${refusalPrefix(call.resourceType)}: ${options}`);
    }

    // ---- Connect: a failure here certainly changed nothing. ----

    let connection: OpenConnection;

    try {
      connection = await withDeadline(
        this.open(settings, options),
        connectTimeoutMs,
        (late: OpenConnection): void => {
          late.destroy();
        },
      );
    } catch (err: unknown) {
      const detail: string =
        err instanceof DeadlineExpired
          ? describeSilence(settings, connectTimeoutMs)
          : describeConnectionError(err, settings, connectTimeoutMs);

      return neverRan(
        `Could not connect to the ${settings.serverName} server at ${settings.endpoint}, so "${call.displayCommand}" did not run: ${detail}`,
      );
    }

    const remainingMs: number = call.timeoutInMs - (Date.now() - startedAtMs);

    if (remainingMs <= 0) {
      connection.destroy();
      return neverRan(
        `"${call.displayCommand}" did not run: connecting to ${settings.endpoint} used its whole time budget (${call.timeoutInMs} ms).`,
      );
    }

    const statementTimeoutMs: number = Math.max(
      MIN_STATEMENT_TIMEOUT_MS,
      remainingMs - STATEMENT_TIMEOUT_HEADROOM_MS,
    );

    // ---- Run: from here on, the database may have been changed. ----

    let outcome: DiagnosticOutcome;

    try {
      outcome = await withDeadline(
        connection.run({
          command: call.command,
          settings,
          statementTimeoutMs,
          lockTimeoutMs: Math.min(MAX_LOCK_TIMEOUT_MS, statementTimeoutMs),
          settleMs: this.settleMs,
          sleep: this.sleep,
        }),
        remainingMs,
      );
    } catch (err: unknown) {
      if (err instanceof DeadlineExpired) {
        connection.destroy();

        return {
          success: false,
          output: "",
          errorMessage: describeKill({
            timeoutInMs: call.timeoutInMs,
            producedOutput: false,
            program: DATABASE_PROGRAM,
            silenceHint: `the ${settings.serverName} server did not finish "${call.displayCommand}" within its time budget: it may be overloaded, or the statement waited on a lock (the connection was dropped)`,
          }),
        };
      }

      await connection.close().catch(noop);

      const message: string = this.scrubText(
        `${settings.serverName} answered "${call.displayCommand}" with an error: ${describeConnectionError(
          err,
          settings,
          connectTimeoutMs,
        )}`,
        settings,
      );

      return {
        success: false,
        exitCode: 1,
        output: formatResourceOutput({
          stdout: "",
          stderr: this.redact(call, message),
          maxOutputBytes: MAX_RESOURCE_AGENT_OUTPUT_BYTES,
        }),
        errorMessage: this.redact(call, message),
      };
    }

    await connection.close().catch(noop);

    return this.finish(call, outcome);
  }

  // The job's result for what the diagnostics answered.
  private finish(call: DatabaseCall, outcome: DiagnosticOutcome): ExecResult {
    if (outcome.status === "notRun") {
      return {
        success: false,
        output: "",
        errorMessage: this.redact(
          call,
          this.scrubText(outcome.reason, call.settings),
        ),
      };
    }

    const format: OutputFormat =
      call.command.flags["format"] === "json" ? "json" : "table";
    const stdout: string = this.redact(
      call,
      this.scrubText(
        renderSections({
          format,
          operation: call.command.operation.name,
          engine: call.settings.engine,
          sections: outcome.sections,
        }),
        call.settings,
      ),
    );

    if (outcome.status === "ok") {
      return {
        success: true,
        exitCode: 0,
        output: formatResourceOutput({
          stdout,
          stderr: "",
          maxOutputBytes: MAX_RESOURCE_AGENT_OUTPUT_BYTES,
        }),
      };
    }

    const reason: string = this.redact(
      call,
      this.scrubText(outcome.reason, call.settings),
    );

    return {
      success: false,
      exitCode: 1,
      output: formatResourceOutput({
        stdout,
        stderr: reason,
        maxOutputBytes: MAX_RESOURCE_AGENT_OUTPUT_BYTES,
      }),
      errorMessage: reason,
    };
  }

  /*
   * The driver options for this command: the settings, the CA bundle read
   * now, and the database to connect to (PostgreSQL's table-sizes connects
   * to the --database it measures). A string when the CA cannot be read.
   */
  private buildConnectOptions(
    settings: DatabaseSettings,
    command: ParsedDatabaseCommand | null,
    connectTimeoutMs: number,
  ): DatabaseConnectOptions | string {
    let ca: string | null = null;

    if (settings.caFile && settings.tls === DatabaseTlsMode.Verify) {
      try {
        const stat: fs.Stats = fs.statSync(settings.caFile);

        if (!stat.isFile() || stat.size > MAX_CA_FILE_BYTES) {
          return `${AI_DATABASE_CA_FILE_ENV}="${settings.caFile}" is not a PEM file of at most ${MAX_CA_FILE_BYTES} bytes.`;
        }

        ca = fs.readFileSync(settings.caFile, "utf8");
      } catch (err: unknown) {
        return `${AI_DATABASE_CA_FILE_ENV}="${settings.caFile}" cannot be read (${errorMessage(
          err,
        )}). Mount the CA bundle into the agent's container at that path.`;
      }

      if (!ca.includes("-----BEGIN CERTIFICATE-----")) {
        return `${AI_DATABASE_CA_FILE_ENV}="${settings.caFile}" holds no PEM certificate.`;
      }
    }

    let database: string = "";

    if (settings.engine === DatabaseEngine.PostgreSQL) {
      const measured: unknown =
        command && command.operation.name === "table-sizes"
          ? command.flags["database"]
          : null;

      database =
        typeof measured === "string" && measured
          ? measured
          : settings.database || DEFAULT_POSTGRES_DATABASE;
    } else if (settings.engine === DatabaseEngine.MongoDB) {
      database = settings.database || DEFAULT_MONGO_AUTH_SOURCE;
    }

    return {
      host: settings.host,
      port: settings.port,
      username: settings.username,
      password: settings.password,
      database,
      tls: { mode: settings.tls, ca },
      connectTimeoutMs,
      applicationName: DATABASE_AI_AGENT_APPLICATION_NAME,
    };
  }

  // Connect through the engine's driver.
  private async open(
    settings: DatabaseSettings,
    options: DatabaseConnectOptions,
  ): Promise<OpenConnection> {
    switch (settings.engine) {
      case DatabaseEngine.PostgreSQL: {
        const sql: SqlConnection = await this.drivers.connectPostgres(options);

        return {
          run: (run: DiagnosticRun): Promise<DiagnosticOutcome> => {
            return runPostgresDiagnostic(sql, run);
          },
          probe: (): Promise<EngineProbe> => {
            return probePostgres(sql);
          },
          close: (): Promise<void> => {
            return sql.close();
          },
          destroy: (): void => {
            sql.destroy();
          },
        };
      }

      case DatabaseEngine.MySQL: {
        const sql: SqlConnection = await this.drivers.connectMySql(options);

        return {
          run: (run: DiagnosticRun): Promise<DiagnosticOutcome> => {
            return runMySqlDiagnostic(sql, run);
          },
          probe: (): Promise<EngineProbe> => {
            return probeMySql(sql);
          },
          close: (): Promise<void> => {
            return sql.close();
          },
          destroy: (): void => {
            sql.destroy();
          },
        };
      }

      case DatabaseEngine.Redis: {
        const redis: RedisConnection = await this.drivers.connectRedis(options);

        return {
          run: (run: DiagnosticRun): Promise<DiagnosticOutcome> => {
            return runRedisDiagnostic(redis, run);
          },
          probe: (): Promise<EngineProbe> => {
            return probeRedis(redis, settings.serverName);
          },
          close: (): Promise<void> => {
            return redis.close();
          },
          destroy: (): void => {
            redis.destroy();
          },
        };
      }

      case DatabaseEngine.MongoDB: {
        const mongo: MongoConnection = await this.drivers.connectMongo(options);

        return {
          run: (run: DiagnosticRun): Promise<DiagnosticOutcome> => {
            return runMongoDiagnostic(mongo, run);
          },
          probe: (): Promise<EngineProbe> => {
            return probeMongo(mongo);
          },
          close: (): Promise<void> => {
            return mongo.close();
          },
          destroy: (): void => {
            mongo.destroy();
          },
        };
      }

      default:
        throw new Error(
          `no driver for the engine "${String(settings.engine)}"`,
        );
    }
  }

  // ---- Output ----------------------------------------------------------------------

  // The login's password never leaves the agent, whatever a driver put in a message.
  private scrubText(text: string, settings: DatabaseSettings | null): string {
    let scrubbed: string = replaceNulCharacters(text);
    const password: string | null = settings
      ? settings.password
      : this.currentPassword();

    if (password && password.length >= MIN_SCRUBBED_SECRET_LENGTH) {
      scrubbed = scrubbed.split(password).join(SCRUBBED_SECRET);
    }

    return scrubbed;
  }

  private currentPassword(): string | null {
    const resolved: DatabaseSettingsResult = resolveDatabaseSettings(
      this.options.env,
    );
    return resolved.settings ? resolved.settings.password : null;
  }

  private redact(call: { resourceType: AiResourceType }, text: string): string {
    return redactOutput({
      resourceType: call.resourceType,
      program: DATABASE_PROGRAM,
      text,
    });
  }

  // ---- Posture -------------------------------------------------------------------

  // The identity facts from the configuration (they win on the server anyway).
  private identityDetails(): Record<string, string | number | boolean | null> {
    const env: NodeJS.ProcessEnv = this.options.env;
    const details: Record<string, string | number | boolean | null> = {};
    const system: unknown = env[DATABASE_SYSTEM_ENV];
    const address: unknown = env[DATABASE_SERVER_ADDRESS_ENV];
    const port: number | null = parseTcpPort(
      typeof env[DATABASE_SERVER_PORT_ENV] === "string"
        ? (env[DATABASE_SERVER_PORT_ENV] as string).trim()
        : undefined,
    );

    if (typeof system === "string" && system.trim()) {
      details["databaseSystem"] = system.trim().toLowerCase();
    }

    // The port may also be written in the address ("db.example.com:5433").
    const endpoint: { host: string; port: number | null } | null =
      typeof address === "string" && address.trim()
        ? resolveDatabaseServerEndpoint({ address, port })
        : null;

    if (endpoint) {
      details["serverAddress"] = endpoint.host;
    }

    const effectivePort: number | null = endpoint ? endpoint.port : port;

    if (effectivePort !== null) {
      details["serverPort"] = effectivePort;
    }

    return details;
  }

  /*
   * Connect with the posture's own short timeouts, ping, read the version.
   * Reachable means the server answered with this login.
   */
  private async probe(): Promise<ResourcePostureProbe> {
    const details: Record<string, string | number | boolean | null> =
      this.identityDetails();
    const unreachable: (reason: string) => ResourcePostureProbe = (
      reason: string,
    ): ResourcePostureProbe => {
      return {
        toolVersion: null,
        reachable: false,
        reachError: reason,
        details,
        protectedTargets: [],
      };
    };

    const resolved: DatabaseSettingsResult = resolveDatabaseSettings(
      this.options.env,
    );

    if (resolved.settings === null) {
      return unreachable(resolved.problem);
    }

    const settings: DatabaseSettings = resolved.settings;

    details["databaseEngine"] = settings.engine;
    details["connectionEndpoint"] = settings.endpoint;
    details["tls"] = settings.tls;
    details["databaseUser"] = settings.username || null;
    details["credentialSource"] = settings.credentialSource;
    details["agentLogin"] = settings.isAgentLogin;

    const connectTimeoutMs: number = Math.min(
      this.postureConnectTimeoutMs,
      this.postureTimeoutMs,
    );
    const options: DatabaseConnectOptions | string = this.buildConnectOptions(
      settings,
      null,
      connectTimeoutMs,
    );

    if (typeof options === "string") {
      return unreachable(options);
    }

    const startedAtMs: number = Date.now();
    let connection: OpenConnection;

    try {
      connection = await withDeadline(
        this.open(settings, options),
        connectTimeoutMs,
        (late: OpenConnection): void => {
          late.destroy();
        },
      );
    } catch (err: unknown) {
      return unreachable(
        this.scrubText(
          `Could not connect to the ${settings.serverName} server at ${settings.endpoint}: ${
            err instanceof DeadlineExpired
              ? describeSilence(settings, connectTimeoutMs)
              : describeConnectionError(err, settings, connectTimeoutMs)
          }`,
          settings,
        ),
      );
    }

    let probe: EngineProbe;

    try {
      probe = await withDeadline(
        connection.probe(),
        Math.max(1, this.postureTimeoutMs - (Date.now() - startedAtMs)),
      );
    } catch (err: unknown) {
      connection.destroy();

      return unreachable(
        this.scrubText(
          `The ${settings.serverName} server at ${settings.endpoint} accepted the connection but did not answer: ${
            err instanceof DeadlineExpired
              ? `no answer within ${this.postureTimeoutMs} ms.`
              : describeConnectionError(err, settings, connectTimeoutMs)
          }`,
          settings,
        ),
      );
    }

    await connection.close().catch(noop);

    return {
      toolVersion: probe.toolVersion,
      reachable: true,
      reachError: null,
      details: { ...details, ...probe.details },
      protectedTargets: [],
    };
  }
}
