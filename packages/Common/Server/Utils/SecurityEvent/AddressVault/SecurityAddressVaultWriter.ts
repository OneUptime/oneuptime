import OneUptimeDate from "../../../../Types/Date";
import IP from "../../../../Types/IP/IP";
import { JSONObject } from "../../../../Types/JSON";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import { SCRUB_HASH_TOKEN_PATTERN } from "../../../../Types/Telemetry/ScrubHashTokenFormat";
import InMemoryTTLCache from "../../../Infrastructure/InMemoryTTLCache";
import SecurityAddressVaultService, {
  SecurityAddressVaultEntry,
  SecurityAddressVaultService as SecurityAddressVaultServiceClass,
} from "../../../Services/SecurityAddressVaultService";
import logger from "../../Logger";
import AppMetrics from "../../Telemetry/AppMetrics";
import { ScrubHashedAddressRecorder } from "../../Telemetry/ScrubAction";
import TelemetryFanInWriter, {
  FanInSubmitResult,
} from "../../Telemetry/TelemetryFanInWriter";
import SecurityEventsReadTelemetry, {
  SecurityEventsReadSignal,
} from "../SecurityEventsReadTelemetry";

/*
 * INGEST'S HALF OF SECURITY EVENTS' ADDRESS VAULT (#10395).
 *
 * When an IP Address scrub rule with the Hash action hides an address in
 * logs or traces Security Events reads, the batch keeps the token the rule
 * left and the address behind it (SecurityAddressVaultBatch, told by the
 * scrub engines through ScrubAction.applyAndRecord), and writes them to the
 * vault once, after the batch's records. Security Events' scans then look
 * the tokens up (SecurityAddressVaultLookup.ts), so an event names the
 * address an attack came from while the logs and traces hold only tokens.
 *
 * A batch keeps nothing unless both hold, the cheap one first:
 *
 *   - one of the project's enabled rules of the batch's kind is an IP
 *     Address rule that hashes: Redact and Mask leave nothing to look up,
 *     and a hash of any other value is never resolvable;
 *   - Security Events reads the project's logs, or its traces
 *     (SecurityEventsReadTelemetry, cached a minute as scrub rules are).
 *
 * FAIL TOWARD PRIVACY: whatever happens here, the record is stored with
 * the token. A batch that cannot start keeps nothing; a write that fails
 * is logged and counted (AppMetrics.getAddressVaultWriteCounter), never
 * retried and never thrown; and it is never awaited, so it cannot fail or
 * delay the batch. Security Events then says a scrub rule hid the address
 * (#10397) rather than naming it.
 *
 * Writes go through the telemetry fan-in writer, as every other ingest
 * write does, so many batches' addresses are one insert. An address this
 * process wrote in the last VAULT_REWRITE_INTERVAL_MS is not written again
 * - a busy client's address is one row a quarter of an hour, not one a
 * batch - so a row's lastSeenAt is at most that far behind.
 */

// The most addresses one batch keeps: past it, the rest are not kept.
export const MAX_VAULT_ENTRIES_PER_BATCH: number = 10_000;

// How long an address this process wrote is not written again.
export const VAULT_REWRITE_INTERVAL_MS: number = 15 * 60 * 1000;

// The most addresses this process remembers writing.
export const MAX_REMEMBERED_VAULT_WRITES: number = 200_000;

/*
 * The most writes in flight in this process at once: past it, a batch's
 * addresses are skipped (and counted), so a vault ClickHouse is slow to
 * take can never pile memory up behind it.
 */
export const MAX_VAULT_WRITES_IN_FLIGHT: number = 64;

export enum SecurityAddressVaultWriteOutcome {
  Written = "written",
  Failed = "failed",
  Skipped = "skipped",
}

// The scrub rules a batch runs, as far as the vault asks about them.
export interface SecurityAddressVaultScrubRule {
  rule: {
    patternType?: string | undefined;
    scrubAction?: string | undefined;
  };
}

/*
 * Whether any of a batch's rules hashes IP addresses: an IP Address rule
 * whose action is Hash. A rule saved with no action redacts.
 */
export function hashesIpAddresses(
  rules: ReadonlyArray<SecurityAddressVaultScrubRule>,
): boolean {
  return rules.some((compiled: SecurityAddressVaultScrubRule): boolean => {
    return (
      compiled.rule.patternType === LogScrubPatternType.IPAddress &&
      compiled.rule.scrubAction === LogScrubAction.Hash
    );
  });
}

// Addresses this process wrote lately, by project and token.
const recentlyWritten: InMemoryTTLCache<true> = new InMemoryTTLCache<true>(
  MAX_REMEMBERED_VAULT_WRITES,
);

const inFlight: Set<Promise<void>> = new Set<Promise<void>>();

function rememberedKey(projectId: ObjectID, token: string): string {
  return `${projectId.toString()}:${token}`;
}

function count(
  signal: SecurityEventsReadSignal,
  outcome: SecurityAddressVaultWriteOutcome,
  addresses: number,
): void {
  if (addresses <= 0) {
    return;
  }

  try {
    AppMetrics.getAddressVaultWriteCounter().add(addresses, {
      [AppMetrics.ADDRESS_VAULT_SIGNAL_ATTRIBUTE]: signal,
      [AppMetrics.ADDRESS_VAULT_OUTCOME_ATTRIBUTE]: outcome,
    });
  } catch {
    // A metric is never worth an error of its own.
  }
}

/*
 * The addresses one ingest batch's IP Address Hash rules hid, by token,
 * kept for the vault: one project's, of one kind of record.
 */
export class SecurityAddressVaultBatch implements ScrubHashedAddressRecorder {
  public readonly projectId: ObjectID;
  public readonly signal: SecurityEventsReadSignal;
  private readonly entries: Map<string, string> = new Map<string, string>();
  private wasWritten: boolean = false;

  public constructor(data: {
    projectId: ObjectID;
    signal: SecurityEventsReadSignal;
  }) {
    this.projectId = data.projectId;
    this.signal = data.signal;
  }

  /*
   * A token a Hash rule made and the address behind it, once a token. Not
   * a token a Hash rule makes today (a rule with no project redacts), not
   * an IP address, or past the batch's bound: not kept.
   */
  public recordHashedAddress(data: { token: string; address: string }): void {
    if (this.entries.has(data.token)) {
      return;
    }

    if (
      this.entries.size >= MAX_VAULT_ENTRIES_PER_BATCH ||
      !SCRUB_HASH_TOKEN_PATTERN.test(data.token) ||
      !IP.isIP(data.address)
    ) {
      return;
    }

    this.entries.set(data.token, data.address);
  }

  public get size(): number {
    return this.entries.size;
  }

  public getEntries(): Array<SecurityAddressVaultEntry> {
    return Array.from(this.entries.entries()).map(
      ([token, address]: [string, string]): SecurityAddressVaultEntry => {
        return { token, address };
      },
    );
  }

  /*
   * Hands the batch's addresses to the vault: call it once, after the
   * batch's records are stored. Never throws and never waits - the write
   * runs on its own (SecurityAddressVaultWriter.whenIdle waits for it).
   */
  public write(): void {
    if (this.wasWritten) {
      return;
    }

    this.wasWritten = true;
    SecurityAddressVaultWriter.write(this);
  }
}

export default class SecurityAddressVaultWriter {
  /*
   * The batch a run of ingest keeps its hashed addresses in, or null when
   * none of them may reach the vault: no rule of the batch hashes IP
   * addresses, or Security Events does not read the project's logs (or
   * traces). Never throws: a question that fails keeps nothing.
   */
  public static async startBatch(data: {
    projectId: ObjectID;
    signal: SecurityEventsReadSignal;
    scrubRules: ReadonlyArray<SecurityAddressVaultScrubRule>;
  }): Promise<SecurityAddressVaultBatch | null> {
    try {
      if (!hashesIpAddresses(data.scrubRules)) {
        return null;
      }

      const reads: boolean =
        await SecurityEventsReadTelemetry.readsProjectTelemetry({
          projectId: data.projectId,
          signal: data.signal,
        });

      return reads
        ? new SecurityAddressVaultBatch({
            projectId: data.projectId,
            signal: data.signal,
          })
        : null;
    } catch (error) {
      logger.warn(
        `SecurityAddressVaultWriter: could not start keeping hashed addresses for project ${data.projectId.toString()}; its records are stored with their tokens.`,
      );
      logger.warn(error);
      return null;
    }
  }

  // A batch's write, run on its own: see SecurityAddressVaultBatch.write.
  public static write(batch: SecurityAddressVaultBatch): void {
    try {
      const entries: Array<SecurityAddressVaultEntry> = batch
        .getEntries()
        .filter((entry: SecurityAddressVaultEntry): boolean => {
          return !recentlyWritten.has(
            rememberedKey(batch.projectId, entry.token),
          );
        });

      if (entries.length === 0) {
        return;
      }

      if (inFlight.size >= MAX_VAULT_WRITES_IN_FLIGHT) {
        count(
          batch.signal,
          SecurityAddressVaultWriteOutcome.Skipped,
          entries.length,
        );
        logger.debug(
          `SecurityAddressVaultWriter: ${entries.length} hashed address(es) of project ${batch.projectId.toString()} not written; ${MAX_VAULT_WRITES_IN_FLIGHT} vault writes are already in flight.`,
        );
        return;
      }

      const rows: Array<JSONObject> = SecurityAddressVaultServiceClass.toRows({
        projectId: batch.projectId,
        entries,
        seenAt: OneUptimeDate.getCurrentDate(),
      });

      if (rows.length === 0) {
        return;
      }

      const writing: Promise<void> = this.insert({ batch, entries, rows });

      inFlight.add(writing);

      // insert() catches its own failures; this only lets go of the write.
      writing
        .finally((): void => {
          inFlight.delete(writing);
        })
        .catch((): void => {
          inFlight.delete(writing);
        });
    } catch (error) {
      logger.error(
        `SecurityAddressVaultWriter: could not write the hashed addresses of project ${batch.projectId.toString()}; its records are stored with their tokens.`,
      );
      logger.error(error);
    }
  }

  private static async insert(data: {
    batch: SecurityAddressVaultBatch;
    entries: Array<SecurityAddressVaultEntry>;
    rows: Array<JSONObject>;
  }): Promise<void> {
    try {
      const submission: FanInSubmitResult = await TelemetryFanInWriter.submit(
        SecurityAddressVaultService,
        data.rows,
      );

      await submission.flushed;

      for (const entry of data.entries) {
        recentlyWritten.set(
          rememberedKey(data.batch.projectId, entry.token),
          true,
          VAULT_REWRITE_INTERVAL_MS,
        );
      }

      count(
        data.batch.signal,
        SecurityAddressVaultWriteOutcome.Written,
        data.rows.length,
      );
    } catch (error) {
      count(
        data.batch.signal,
        SecurityAddressVaultWriteOutcome.Failed,
        data.rows.length,
      );
      logger.error(
        `SecurityAddressVaultWriter: the vault did not take ${data.rows.length} hashed address(es) of project ${data.batch.projectId.toString()}; their records are stored with the tokens, and Security Events will say a scrub rule hid them.`,
      );
      logger.error(error);
    }
  }

  // Waits for every write in flight to settle: for tests, and a clean shutdown.
  public static async whenIdle(): Promise<void> {
    while (inFlight.size > 0) {
      await Promise.allSettled(Array.from(inFlight));
    }
  }

  // Forget which addresses were written, so a test writes what it set up.
  public static forgetWrites(): void {
    recentlyWritten.clear();
  }
}
