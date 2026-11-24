import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import { SCRUB_HASH_TOKEN_PATTERN } from "../../../../Types/Telemetry/ScrubHashTokenFormat";
import InMemoryTTLCache from "../../../Infrastructure/InMemoryTTLCache";
import SecurityUserVaultService, {
  SecurityUserVaultEntry,
  SecurityUserVaultService as SecurityUserVaultServiceClass,
  isUserVaultUser,
} from "../../../Services/SecurityUserVaultService";
import logger from "../../Logger";
import AppMetrics from "../../Telemetry/AppMetrics";
import { ScrubHashedUserRecorder } from "../../Telemetry/ScrubAction";
import TelemetryFanInWriter, {
  FanInSubmitResult,
} from "../../Telemetry/TelemetryFanInWriter";
import SecurityEventsReadTelemetry, {
  SecurityEventsReadSignal,
} from "../SecurityEventsReadTelemetry";
import {
  HashedUserPair,
  readHashedUserPair,
  readHashedUsersOfLogLine,
  readLogRowHashTokens,
} from "./HashedUserPairs";

/*
 * INGEST'S HALF OF SECURITY EVENTS' USER VAULT (#10632) - the address
 * vault's twin (AddressVault/SecurityAddressVaultWriter.ts), for users.
 *
 * When a Hash scrub rule hides a user where Security Events reads one, in
 * logs or traces Security Events reads, the batch keeps the token the rule
 * left and the user behind it (SecurityUserVaultBatch, told by the scrub
 * engines what they changed: ScrubAction's ScrubHashedUserRecorder), and
 * writes them to the vault once, after the batch's records. Security
 * Events' scans then look the tokens up (SecurityUserVaultLookup.ts), so a
 * case about a hashed account names it, and a playbook can act on it,
 * while the logs and traces hold only tokens.
 *
 * Where a user is read, and so where one is kept (HashedUserPairs):
 *
 *   - a span's enduser.id and user.id, and an AI call's user (llmUserId);
 *   - a log line's users, as Security Events' log parsers read them: a
 *     cloud audit log's principal, a sign-in's account, a firewall's user.
 *
 * A user is kept only when its token is worked out of it again with the
 * project's key, so nothing but what a Hash rule really hashed, where
 * Security Events reads a user, is ever kept.
 *
 * A batch keeps nothing unless both hold, the cheap one first:
 *
 *   - one of the project's enabled rules of the batch's kind hashes, and
 *     by a pattern that can hide a user: an Email rule, a Named Attributes
 *     rule on enduser.id, a custom pattern - any but IP Address, whose
 *     tokens the address vault keeps. Redact and Mask leave nothing to
 *     look up;
 *   - Security Events reads the project's logs, or its traces
 *     (SecurityEventsReadTelemetry, cached a minute as scrub rules are).
 *
 * BOUNDED. A batch keeps at most MAX_USER_VAULT_ENTRIES_PER_BATCH users,
 * reads at most MAX_USER_VAULT_LOG_LINES_PER_BATCH lines again (a line
 * whose tokens the batch, or this process lately, already kept is not read
 * again), never keeps a user longer than MAX_USER_VAULT_USER_LENGTH, and
 * the vault forgets a user 30 days after it was last seen.
 *
 * FAIL TOWARD PRIVACY: whatever happens here, the record is stored with
 * the token. A batch that cannot start keeps nothing; a write that fails
 * is logged and counted (AppMetrics.getUserVaultWriteCounter), never
 * retried and never thrown; and it is never awaited, so it cannot fail or
 * delay the batch. Security Events then says a scrub rule hid the user
 * (#10435) rather than naming them.
 *
 * Writes go through the telemetry fan-in writer, as every other ingest
 * write does. A user this process wrote in the last
 * USER_VAULT_REWRITE_INTERVAL_MS is not written again, so a row's
 * lastSeenAt is at most that far behind.
 */

// The most users one batch keeps: past it, the rest are not kept.
export const MAX_USER_VAULT_ENTRIES_PER_BATCH: number = 10_000;

/*
 * The most log lines of one batch read again for their users: past it, the
 * rest are not, and their events say a scrub rule hid the user.
 */
export const MAX_USER_VAULT_LOG_LINES_PER_BATCH: number = 2_000;

// How long a user this process wrote is not written again.
export const USER_VAULT_REWRITE_INTERVAL_MS: number = 15 * 60 * 1000;

// The most users this process remembers writing.
export const MAX_REMEMBERED_USER_VAULT_WRITES: number = 200_000;

/*
 * The most writes in flight in this process at once: past it, a batch's
 * users are skipped (and counted), so a vault ClickHouse is slow to take
 * can never pile memory up behind it.
 */
export const MAX_USER_VAULT_WRITES_IN_FLIGHT: number = 64;

export enum SecurityUserVaultWriteOutcome {
  Written = "written",
  Failed = "failed",
  Skipped = "skipped",
}

// The scrub rules a batch runs, as far as the vault asks about them.
export interface SecurityUserVaultScrubRule {
  rule: {
    patternType?: string | undefined;
    scrubAction?: string | undefined;
  };
}

/*
 * Whether any of a batch's rules hashes by a pattern that can hide a user:
 * any but IP Address, whose tokens are an address's (the address vault's).
 */
export function hashesUsers(
  rules: ReadonlyArray<SecurityUserVaultScrubRule>,
): boolean {
  return rules.some((compiled: SecurityUserVaultScrubRule): boolean => {
    return (
      compiled.rule.scrubAction === LogScrubAction.Hash &&
      compiled.rule.patternType !== LogScrubPatternType.IPAddress
    );
  });
}

// Users this process wrote lately, by project and token.
const recentlyWritten: InMemoryTTLCache<true> = new InMemoryTTLCache<true>(
  MAX_REMEMBERED_USER_VAULT_WRITES,
);

const inFlight: Set<Promise<void>> = new Set<Promise<void>>();

function rememberedKey(projectId: ObjectID, token: string): string {
  return `${projectId.toString()}:${token}`;
}

function count(
  signal: SecurityEventsReadSignal,
  outcome: SecurityUserVaultWriteOutcome,
  users: number,
): void {
  if (users <= 0) {
    return;
  }

  try {
    AppMetrics.getUserVaultWriteCounter().add(users, {
      [AppMetrics.ADDRESS_VAULT_SIGNAL_ATTRIBUTE]: signal,
      [AppMetrics.USER_VAULT_OUTCOME_ATTRIBUTE]: outcome,
    });
  } catch {
    // A metric is never worth an error of its own.
  }
}

/*
 * The users one ingest batch's Hash rules hid where Security Events reads
 * a user, by token, kept for the vault: one project's, of one kind of
 * record.
 */
export class SecurityUserVaultBatch implements ScrubHashedUserRecorder {
  public readonly projectId: ObjectID;
  public readonly signal: SecurityEventsReadSignal;
  private readonly entries: Map<string, string> = new Map<string, string>();
  // The tokens of each line read again, as one sorted text: bounded by the lines read.
  private readonly tokenSetsRead: Set<string> = new Set<string>();
  private logLinesRead: number = 0;
  private wasWritten: boolean = false;

  public constructor(data: {
    projectId: ObjectID;
    signal: SecurityEventsReadSignal;
  }) {
    this.projectId = data.projectId;
    this.signal = data.signal;
  }

  public get size(): number {
    return this.entries.size;
  }

  // How many log lines this batch read again for their users.
  public get logLinesReadAgain(): number {
    return this.logLinesRead;
  }

  /*
   * A token a Hash rule made and the user behind it, once a token. Not a
   * token a Hash rule makes today, no user (isUserVaultUser), or past the
   * batch's bound: not kept.
   */
  public recordHashedUser(pair: HashedUserPair): void {
    if (this.entries.has(pair.token)) {
      return;
    }

    if (
      this.entries.size >= MAX_USER_VAULT_ENTRIES_PER_BATCH ||
      !SCRUB_HASH_TOKEN_PATTERN.test(pair.token) ||
      !isUserVaultUser(pair.user)
    ) {
      return;
    }

    this.entries.set(pair.token, pair.user);
  }

  // A span's user field the rules changed: its token's user, when one is worked out.
  public recordScrubbedUserValue(data: {
    before: string;
    after: string;
  }): void {
    if (this.entries.size >= MAX_USER_VAULT_ENTRIES_PER_BATCH) {
      return;
    }

    const pair: HashedUserPair | null = readHashedUserPair({
      projectId: this.projectId,
      before: data.before,
      after: data.after,
    });

    if (pair) {
      this.recordHashedUser(pair);
    }
  }

  /*
   * A log line the rules changed: the users its tokens stand for, where
   * Security Events' log parsers read a user - unless every token it holds
   * is a user this batch, or this process lately, already kept; or the
   * batch already read a line of exactly these tokens (the same record
   * again: a cloud audit log hashes its resource's emails as well as its
   * principal); or it read as many lines again as it may.
   */
  public recordScrubbedLogLine(data: {
    bodyBefore: string;
    attributesBefore: JSONObject;
    logRow: JSONObject;
  }): void {
    if (
      this.entries.size >= MAX_USER_VAULT_ENTRIES_PER_BATCH ||
      this.logLinesRead >= MAX_USER_VAULT_LOG_LINES_PER_BATCH
    ) {
      return;
    }

    const tokens: Array<string> = readLogRowHashTokens(data.logRow);

    if (
      tokens.length === 0 ||
      tokens.every((token: string): boolean => {
        return (
          this.entries.has(token) ||
          recentlyWritten.has(rememberedKey(this.projectId, token))
        );
      })
    ) {
      return;
    }

    const tokenSet: string = [...tokens].sort().join(",");

    if (this.tokenSetsRead.has(tokenSet)) {
      return;
    }

    this.tokenSetsRead.add(tokenSet);
    this.logLinesRead++;

    for (const pair of readHashedUsersOfLogLine({
      projectId: this.projectId,
      bodyBefore: data.bodyBefore,
      attributesBefore: data.attributesBefore,
      logRow: data.logRow,
    })) {
      this.recordHashedUser(pair);
    }
  }

  public getEntries(): Array<SecurityUserVaultEntry> {
    return Array.from(this.entries.entries()).map(
      ([token, user]: [string, string]): SecurityUserVaultEntry => {
        return { token, user };
      },
    );
  }

  /*
   * Hands the batch's users to the vault: call it once, after the batch's
   * records are stored. Never throws and never waits - the write runs on
   * its own (SecurityUserVaultWriter.whenIdle waits for it).
   */
  public write(): void {
    if (this.wasWritten) {
      return;
    }

    this.wasWritten = true;
    SecurityUserVaultWriter.write(this);
  }
}

export default class SecurityUserVaultWriter {
  /*
   * The batch a run of ingest keeps its hashed users in, or null when none
   * of them may reach the vault: no rule of the batch hashes a user, or Security
   * Events does not read the project's logs (or traces). Never throws: a
   * question that fails keeps nothing.
   */
  public static async startBatch(data: {
    projectId: ObjectID;
    signal: SecurityEventsReadSignal;
    scrubRules: ReadonlyArray<SecurityUserVaultScrubRule>;
  }): Promise<SecurityUserVaultBatch | null> {
    try {
      if (!hashesUsers(data.scrubRules)) {
        return null;
      }

      const reads: boolean =
        await SecurityEventsReadTelemetry.readsProjectTelemetry({
          projectId: data.projectId,
          signal: data.signal,
        });

      return reads
        ? new SecurityUserVaultBatch({
            projectId: data.projectId,
            signal: data.signal,
          })
        : null;
    } catch (error) {
      logger.warn(
        `SecurityUserVaultWriter: could not start keeping hashed users for project ${data.projectId.toString()}; its records are stored with their tokens.`,
      );
      logger.warn(error);
      return null;
    }
  }

  // A batch's write, run on its own: see SecurityUserVaultBatch.write.
  public static write(batch: SecurityUserVaultBatch): void {
    try {
      const entries: Array<SecurityUserVaultEntry> = batch
        .getEntries()
        .filter((entry: SecurityUserVaultEntry): boolean => {
          return !recentlyWritten.has(
            rememberedKey(batch.projectId, entry.token),
          );
        });

      if (entries.length === 0) {
        return;
      }

      if (inFlight.size >= MAX_USER_VAULT_WRITES_IN_FLIGHT) {
        count(
          batch.signal,
          SecurityUserVaultWriteOutcome.Skipped,
          entries.length,
        );
        logger.debug(
          `SecurityUserVaultWriter: ${entries.length} hashed user(s) of project ${batch.projectId.toString()} not written; ${MAX_USER_VAULT_WRITES_IN_FLIGHT} vault writes are already in flight.`,
        );
        return;
      }

      const rows: Array<JSONObject> = SecurityUserVaultServiceClass.toRows({
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
        `SecurityUserVaultWriter: could not write the hashed users of project ${batch.projectId.toString()}; its records are stored with their tokens.`,
      );
      logger.error(error);
    }
  }

  private static async insert(data: {
    batch: SecurityUserVaultBatch;
    entries: Array<SecurityUserVaultEntry>;
    rows: Array<JSONObject>;
  }): Promise<void> {
    try {
      const submission: FanInSubmitResult = await TelemetryFanInWriter.submit(
        SecurityUserVaultService,
        data.rows,
      );

      await submission.flushed;

      for (const entry of data.entries) {
        recentlyWritten.set(
          rememberedKey(data.batch.projectId, entry.token),
          true,
          USER_VAULT_REWRITE_INTERVAL_MS,
        );
      }

      count(
        data.batch.signal,
        SecurityUserVaultWriteOutcome.Written,
        data.rows.length,
      );
    } catch (error) {
      count(
        data.batch.signal,
        SecurityUserVaultWriteOutcome.Failed,
        data.rows.length,
      );
      logger.error(
        `SecurityUserVaultWriter: the vault did not take ${data.rows.length} hashed user(s) of project ${data.batch.projectId.toString()}; their records are stored with the tokens, and Security Events will say a scrub rule hid them.`,
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

  // Forget which users were written, so a test writes what it set up.
  public static forgetWrites(): void {
    recentlyWritten.clear();
  }
}
