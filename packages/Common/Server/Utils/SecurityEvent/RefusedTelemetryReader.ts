import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import Redis from "../../Infrastructure/Redis";
import SecurityLogSourceService from "../../Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "../../Services/SecurityTelemetrySourceService";
import logger from "../Logger";
import TelemetryIngestionBudgetStatusReader from "../Telemetry/TelemetryIngestionBudgetStatusReader";
import SecurityLogSource from "../../../Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "../../../Models/DatabaseModels/SecurityTelemetrySource";
import { JSONObject } from "../../../Types/JSON";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import { SecurityTelemetrySourceKind } from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import { TelemetryIngestionBudgetStatus } from "../../../Types/Telemetry/TelemetryIngestionBudget";
import {
  RefusedTelemetry,
  RefusedTelemetryRecord,
  RefusedTelemetrySignal,
  foldRefusedTelemetry,
  pruneRefusedTelemetry,
  readRefusedTelemetryRecord,
} from "../../../Utils/SecurityEvent/RefusedTelemetry";

/*
 * WHAT A BUDGET OR A RATE REFUSED OF THE TELEMETRY SECURITY EVENTS READS
 * (#10431), read from the budgets' own counters.
 *
 * The scans ("Your logs", the Traces source) call observe() once a turn:
 * it reads the project's budget counters today, through the same reader
 * the Usage page and the explorers' banner use
 * (TelemetryIngestionBudgetStatusReader), and folds them into what the
 * source knew (Utils/SecurityEvent/RefusedTelemetry), which the scan keeps
 * on its result. The setup status and a retrohunt read what the sources
 * kept and fold the live counters in again, so what they say is as of the
 * moment they are asked, not of the last scan.
 *
 * What it costs: the budgets are read as the ingest gate reads them (its
 * in-process cache), then the project's keys and team or label budgets
 * (two small reads) and one Valkey round trip for the counters - once per
 * project per CACHE_TTL_MS however many of its sources ask. Nothing at all
 * while Valkey is not connected: there are no counters to read then, and
 * the ingest gate admits everything uncounted (it fails open), so nothing
 * is being refused either.
 *
 * Never throws: a read that fails is no read, and the stretches stay as
 * they were - one that was going on still goes on.
 */

// One read of a project's counters serves its sources for this long.
export const REFUSED_TELEMETRY_STATUS_CACHE_TTL_MS: number = 20 * 1000;

const STATUS_CACHE_MAX_ENTRIES: number = 10_000;

const FAILED_READ_LOG_INTERVAL_MS: number = 60 * 1000;

// A source of the project, as the readers here need it.
export interface RefusedTelemetrySource {
  signal: RefusedTelemetrySignal;
  lastScanResult: JSONObject | null | undefined;
}

export default class RefusedTelemetryReader {
  private static statuses: InMemoryTTLCache<TelemetryIngestionBudgetStatus> =
    new InMemoryTTLCache(STATUS_CACHE_MAX_ENTRIES);

  private static failedReadLastLoggedAt: number = Number.NEGATIVE_INFINITY;

  /*
   * The project's budgets and their counters today, or null when they
   * cannot be read.
   */
  public static async readBudgetStatus(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<TelemetryIngestionBudgetStatus | null> {
    if (!Redis.isConnected()) {
      return null;
    }

    const key: string = data.projectId.toString();
    const cached: TelemetryIngestionBudgetStatus | undefined =
      this.statuses.get(key);

    if (cached) {
      return cached;
    }

    try {
      const status: TelemetryIngestionBudgetStatus =
        await TelemetryIngestionBudgetStatusReader.getProjectStatus({
          projectId: data.projectId,
          now: data.now,
          readsSettingsAsIngestDoes: true,
        });

      // Counters that could not be read are asked for again next time.
      if (status.countersAvailable) {
        this.statuses.set(key, status, REFUSED_TELEMETRY_STATUS_CACHE_TTL_MS);
      }

      return status;
    } catch (err) {
      this.logFailedRead(data.projectId, err);
      return null;
    }
  }

  /*
   * A scan's turn: what the source knew (its last scan result), with the
   * counters as they are now folded in. What it returns is what the scan
   * keeps.
   */
  public static async observe(data: {
    projectId: ObjectID;
    signal: RefusedTelemetrySignal;
    lastScanResult: JSONObject | null | undefined;
    now: Date;
  }): Promise<RefusedTelemetryRecord> {
    const record: RefusedTelemetryRecord = readRefusedTelemetryRecord(
      data.lastScanResult,
    );

    try {
      const status: TelemetryIngestionBudgetStatus | null =
        await this.readBudgetStatus({
          projectId: data.projectId,
          now: data.now,
        });

      return foldRefusedTelemetry({
        record,
        status,
        signal: data.signal,
        projectId: data.projectId.toString(),
        now: data.now,
      });
    } catch (err) {
      this.logFailedRead(data.projectId, err);

      return {
        observation: record.observation,
        refusals: pruneRefusedTelemetry(record.refusals, data.now),
      };
    }
  }

  /*
   * Every stretch the given sources kept, with the counters as they are now
   * folded in - not kept: the scans keep what they fold, at their own pace.
   */
  public static async readLive(data: {
    projectId: ObjectID;
    sources: ReadonlyArray<RefusedTelemetrySource>;
    now: Date;
  }): Promise<Array<RefusedTelemetry>> {
    const refusals: Array<RefusedTelemetry> = [];

    for (const source of data.sources) {
      const record: RefusedTelemetryRecord = await this.observe({
        projectId: data.projectId,
        signal: source.signal,
        lastScanResult: source.lastScanResult,
        now: data.now,
      });

      refusals.push(...record.refusals);
    }

    return refusals;
  }

  /*
   * Every stretch the project's sources kept - "Your logs" and the Traces
   * source, on or off (what a source refused while it was on is still
   * missing from what it found then) - with the counters as they are now
   * folded in. Read as OneUptime: what a budget refused is about the
   * project's telemetry, not anything a person reads in it. Empty when the
   * sources cannot be read.
   */
  public static async readForProject(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<Array<RefusedTelemetry>> {
    try {
      const [logSource, tracesSource] = await Promise.all([
        SecurityLogSourceService.findOneBy({
          query: { projectId: data.projectId },
          select: { _id: true, lastScanResult: true },
          props: { isRoot: true },
        }),
        SecurityTelemetrySourceService.findOneBy({
          query: {
            projectId: data.projectId,
            kind: SecurityTelemetrySourceKind.Traces,
          },
          select: { _id: true, lastScanResult: true },
          props: { isRoot: true },
        }),
      ]);

      const sources: Array<RefusedTelemetrySource> = [];

      if (logSource) {
        sources.push(
          this.toSource(ProductType.Logs, logSource as SecurityLogSource),
        );
      }

      if (tracesSource) {
        sources.push(
          this.toSource(
            ProductType.Traces,
            tracesSource as SecurityTelemetrySource,
          ),
        );
      }

      return await this.readLive({
        projectId: data.projectId,
        sources,
        now: data.now,
      });
    } catch (err) {
      this.logFailedRead(data.projectId, err);
      return [];
    }
  }

  // Forget every project's counters read: tests, and nothing else.
  public static clearCache(): void {
    this.statuses.clear();
  }

  private static toSource(
    signal: RefusedTelemetrySignal,
    source: { lastScanResult?: JSONObject | undefined },
  ): RefusedTelemetrySource {
    return { signal, lastScanResult: source.lastScanResult || null };
  }

  private static logFailedRead(projectId: ObjectID, err: unknown): void {
    const now: number = Date.now();

    if (now - this.failedReadLastLoggedAt < FAILED_READ_LOG_INTERVAL_MS) {
      return;
    }

    this.failedReadLastLoggedAt = now;
    logger.warn(
      `RefusedTelemetryReader: could not read what the ingestion budgets of project ${projectId.toString()} refused; Security Events keeps what it knew`,
    );
    logger.warn(err);
  }
}
