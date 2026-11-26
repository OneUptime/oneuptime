import {
  DATABASE_SERVER_ADDRESS_ENV,
  DATABASE_SERVER_PORT_ENV,
  parseTcpPort,
} from "../Config";
import {
  DatabaseDriverFactory,
  NODE_DATABASE_DRIVERS,
} from "../Executors/Database/DatabaseDrivers";
import IngestClient, { IngestResponse } from "../IngestClient";
import { AgentLogger } from "../Logger";
import { AgentIdentity, AgentSession } from "../Registration";
import { waitAtMost } from "../Sleep";
import { INGEST_PATH } from "../IngestClient";
import {
  DATABASE_AGENT_POLL_INTERVAL_IN_MS,
  DATABASE_AGENT_RESULT_ROUTE,
  DATABASE_AGENT_WORK_ROUTE,
  DatabaseAgentReport,
  DatabaseAgentWork,
  readDatabaseAgentWorkList,
} from "../Common/Utils/DataObservability/DatabaseAgent/DatabaseAgentWork";
import {
  DataObservabilitySettings,
  resolveDataObservabilitySettings,
} from "./DataObservabilitySettings";
import { collectDatabase } from "./DataObservabilityReader";

/*
 * THE DATABASE AGENT'S HALF OF DATA OBSERVABILITY (#11148), EVERY MINUTE.
 *
 *   1. ask OneUptime for work: the databases of this agent's server that are
 *      due, claimed for it - what to read, never how, never a login;
 *   2. read each with this agent's own logins and its own statements
 *      (DataObservabilityReader);
 *   3. report what was read - catalog facts and one number per check - or
 *      why it could not be read.
 *
 * Only while its owner turned it on (ONEUPTIME_DATA_OBSERVABILITY=true): an
 * agent that is off asks for nothing. Every database handed out is
 * answered, so its page says why it was not read. One round runs at a time;
 * a server older than this conversation answers 404, said once in the log
 * and asked again every five minutes. Never throws.
 */

// How long a server without this conversation is left before it is asked again.
export const API_MISSING_RETRY_MS: number = 5 * 60_000;

// A report of thousands of tables may take a while to send.
export const REPORT_TIMEOUT_MS: number = 2 * 60_000;

// The first round, a little after start-up, once registration has settled.
export const FIRST_ROUND_DELAY_MS: number = 15_000;

export interface DataObservabilityCollectorOptions {
  env: NodeJS.ProcessEnv;
  client: IngestClient;
  session: AgentSession;
  logger: AgentLogger;
  // Test seams.
  drivers?: DatabaseDriverFactory | undefined;
  pollIntervalMs?: number | undefined;
  firstRoundDelayMs?: number | undefined;
  now?: (() => Date) | undefined;
}

export default class DataObservabilityCollector {
  public readonly settings: DataObservabilitySettings;
  private readonly drivers: DatabaseDriverFactory;
  private readonly pollIntervalMs: number;
  private readonly firstRoundDelayMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: Promise<void> | null = null;
  private stopped: boolean = false;
  private apiMissingUntil: number = 0;
  private hasSaidApiMissing: boolean = false;

  public constructor(private readonly options: DataObservabilityCollectorOptions) {
    this.settings = resolveDataObservabilitySettings(options.env);
    this.drivers = options.drivers || NODE_DATABASE_DRIVERS;
    this.pollIntervalMs =
      options.pollIntervalMs ?? DATABASE_AGENT_POLL_INTERVAL_IN_MS;
    this.firstRoundDelayMs = options.firstRoundDelayMs ?? FIRST_ROUND_DELAY_MS;
  }

  public isEnabled(): boolean {
    return this.settings.isOn;
  }

  public start(): void {
    if (!this.isEnabled()) {
      return;
    }

    this.options.logger.info(
      "Reading this database server's databases for Data Observability when OneUptime asks",
      {
        engine: this.settings.engine,
        catalogLogin: this.settings.catalogLogin?.source,
        checksLogin: this.settings.runsChecks
          ? this.settings.checksLogin?.source
          : "checks off",
        customSql: this.settings.runsCustomSql ? "allowed" : "off",
      },
    );
    this.schedule(this.firstRoundDelayMs);
  }

  public async stop(graceMs: number): Promise<boolean> {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    return waitAtMost(this.current, graceMs);
  }

  private schedule(delayMs: number): void {
    if (this.stopped || this.timer) {
      return;
    }

    this.timer = setTimeout((): void => {
      this.timer = null;
      void this.tick().then((): void => {
        this.schedule(this.pollIntervalMs);
      });
    }, delayMs);
    this.timer.unref?.();
  }

  // One round: ask, read, report. Public for tests; never throws.
  public tick(): Promise<void> {
    if (this.current) {
      return this.current;
    }

    this.current = this.round()
      .catch((err: unknown): void => {
        this.options.logger.error("A Data Observability round failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally((): void => {
        this.current = null;
      });

    return this.current;
  }

  private async round(): Promise<void> {
    if (!this.isEnabled() || this.stopped || Date.now() < this.apiMissingUntil) {
      return;
    }

    const identity: AgentIdentity | null = this.options.session.getIdentity();

    if (!identity) {
      return;
    }

    const answer: IngestResponse = await this.options.client.post(
      DATABASE_AGENT_WORK_ROUTE,
      { agentId: identity.agentId, agentKey: identity.agentKey },
    );

    if (answer.kind === "api_missing") {
      this.apiMissingUntil = Date.now() + API_MISSING_RETRY_MS;

      if (!this.hasSaidApiMissing) {
        this.hasSaidApiMissing = true;
        this.options.logger.warn(
          `This OneUptime server hands out no Data Observability work at ${INGEST_PATH}${DATABASE_AGENT_WORK_ROUTE}: upgrade it to this agent's version. Asking again every five minutes.`,
        );
      }

      return;
    }

    if (answer.kind !== "ok") {
      this.options.logger.debug(
        `Could not ask OneUptime for Data Observability work: ${answer.message}`,
      );
      return;
    }

    this.hasSaidApiMissing = false;

    for (const work of readDatabaseAgentWorkList(answer.body)) {
      if (this.stopped) {
        return;
      }

      const report: DatabaseAgentReport = await this.collect(work);

      await this.report(identity, report);
    }
  }

  // Reads one database, as handed out. Public for tests; never throws.
  public collect(work: DatabaseAgentWork): Promise<DatabaseAgentReport> {
    return collectDatabase({
      work,
      settings: this.settings,
      drivers: this.drivers,
      target: this.readTarget(),
      now: this.options.now,
    });
  }

  private async report(
    identity: AgentIdentity,
    report: DatabaseAgentReport,
  ): Promise<void> {
    const answer: IngestResponse = await this.options.client.post(
      DATABASE_AGENT_RESULT_ROUTE,
      {
        agentId: identity.agentId,
        agentKey: identity.agentKey,
        ...(report as unknown as Record<string, unknown>),
      },
      { timeoutMs: REPORT_TIMEOUT_MS },
    );

    if (answer.kind !== "ok") {
      this.options.logger.warn(
        `OneUptime did not accept the Data Observability collection of database ${report.dataStoreId}: ${answer.message}`,
      );
    }
  }

  /*
   * The database as the applications that use it name it - the identity
   * the collector stamps (DATABASE_SERVER_ADDRESS, _PORT) - so their spans
   * are tied to its tables; else the endpoint the agent reads.
   */
  private readTarget(): { host: string | null; port: number | null } {
    const address: string = (
      this.options.env[DATABASE_SERVER_ADDRESS_ENV] || ""
    ).trim();
    const port: number | null = parseTcpPort(
      (this.options.env[DATABASE_SERVER_PORT_ENV] || "").trim(),
    );

    return {
      host: address || this.settings.database?.host || null,
      port: port ?? this.settings.database?.port ?? null,
    };
  }
}
