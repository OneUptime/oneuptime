import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import SecurityTelemetrySource from "../../../Models/DatabaseModels/SecurityTelemetrySource";
import {
  CLOUD_COSTS_INTERVAL_MS,
  CLOUD_SAVINGS_INTERVAL_MS,
  CloudAccountCostSummary,
  CloudAccountSavingsSummary,
  CloudCostState,
  CloudResourceCostsStatus,
  CloudSavingKind,
  getCloudCostResourceKey,
  getCloudCostWindow,
  readCloudAccountCostSummary,
  readCloudAccountSavingsSummary,
  summarizeCloudAccountSavings,
} from "../../../Types/Cloud/CloudCost";
import { CloudCommitmentSummary } from "../../../Types/Cloud/CloudCommitments";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  RESOURCE_COSTS_FIELD_KEY,
  isCloudConnectionResourceCostsOn,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../Types/CloudConnection/CloudConnectionTest";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudAuditSecurityEvents, {
  CloudAuditStoreOutcome,
} from "../SecurityEvent/CloudAudit/CloudAuditSecurityEvents";
import LlmProviderError from "../LlmObservability/LlmProviderError";
import logger from "../Logger";
import CloudBudgetEvaluator from "./CloudBudgetEvaluator";
import CloudCostWriter, { CloudCostWriteResult } from "./CloudCostWriter";
import CloudSavingsWriter, {
  CloudSavingsWriteResult,
} from "./CloudSavingsWriter";
import CloudRightSizingWriter, {
  CloudRightSizingWriteResult,
} from "./CloudRightSizingWriter";
import CloudConnectionResourceSync, {
  CloudConnectionSyncResult,
} from "./CloudConnectionResourceSync";
import {
  CloudChange,
  CloudCompleteListing,
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnector,
  CloudConnectorTransport,
  CloudChangesResult,
  CloudCostAccountOutcome,
  CloudCostRecord,
  CloudCostsResult,
  CloudInventoryAccount,
  CloudInventoryResult,
  CloudReadBudget,
  CloudSavingsResult,
  readCloudSetting,
} from "./CloudConnectorTypes";
import CloudChangeRecorder, {
  CloudChangeRecordOutcome,
} from "./CloudChangeRecorder";
import {
  CloudChangeWindowSnapshot,
  forgetStalePlaces,
  restoreChangeWindow,
  snapshotChangeWindow,
} from "./CloudChangeWindow";

/*
 * WHAT A READ DOES BESIDES READING METRICS.
 *
 * A cloud connection's read (CloudConnectionPullRunner) reads metrics every
 * time. On a slower beat, and each with a budget of its own so it never
 * starves the metrics, it also:
 *
 *   - lists every resource of the connection's accounts (the inventory,
 *     every CLOUD_INVENTORY_INTERVAL_MS), keeping their tags, properties,
 *     relationships and endpoints - and, while a first listing still has
 *     resources to add, again on the next read, a minute later, until all
 *     of them are there;
 *   - reads what changed in the accounts since the last read, and the
 *     provider's health events about them, and keeps them as change events
 *     (CloudChangeRecorder) - every read, after the inventory, so a change
 *     to a resource the inventory just listed is tied to it. Changes that
 *     cannot be written are read again next time: the cursors go back.
 *     While the project's Security Events read its cloud audit logs, the
 *     same read keeps every audit record it brought in as a security event
 *     too (SecurityEvent/CloudAudit/CloudAuditSecurityEvents), and records
 *     that cannot be stored are read again the same way;
 *   - keeps the connection's cloud accounts (CloudAccount): one row for
 *     each account it reaches, with the name its cloud gives it, when it
 *     was last listed in full, and its resources counted.
 *
 * Each lane's failure is a warning on the read, never its failure - except
 * a credential that is refused, which fails the read the way the metrics
 * would.
 */

// How often the inventory lists every resource.
export const CLOUD_INVENTORY_INTERVAL_MS: number = 30 * 60 * 1000;
/*
 * How soon a listing that has resources left to add lists again: on the
 * next read (a read that adds less than it found carries on within a
 * minute), so a first listing of thousands of resources is done in
 * minutes rather than in half-hours.
 */
export const CLOUD_INVENTORY_CONTINUE_MS: number = 60 * 1000;
export const CLOUD_INVENTORY_MAX_REQUESTS: number = 1500;
export const CLOUD_INVENTORY_MAX_DURATION_MS: number = 3 * 60 * 1000;
// What reading the accounts' changes and health events may take, each read.
export const CLOUD_CHANGES_MAX_REQUESTS: number = 300;
export const CLOUD_CHANGES_MAX_DURATION_MS: number = 90 * 1000;
/*
 * A lane starts only with at least this long left before the read's
 * deadline; with less, it stays due and runs on the next read.
 */
export const CLOUD_LANE_MIN_TIME_MS: number = 20 * 1000;

export const CHANGES_NOT_SAVED_WARNING: string =
  "Some changes could not be saved this time: they are read again on the next read.";

export const AUDIT_RECORDS_NOT_SAVED_WARNING: string =
  "The audit logs could not be kept as security events this time: they are read again on the next read.";

/*
 * What reading the accounts' costs may take, each time it is due: a few
 * pages of each cloud's billing per account (AWS Cost Explorer charges for
 * every request, $0.01 each).
 */
export const CLOUD_COSTS_MAX_REQUESTS: number = 60;
export const CLOUD_COSTS_MAX_DURATION_MS: number = 120 * 1000;
// What reading the ways to spend less may take, once a day.
export const CLOUD_SAVINGS_MAX_REQUESTS: number = 300;
export const CLOUD_SAVINGS_MAX_DURATION_MS: number = 120 * 1000;
/*
 * After a read of costs or savings that failed as a whole, it is tried
 * again this soon rather than after its whole interval.
 */
export const CLOUD_COSTS_RETRY_MS: number = 60 * 60 * 1000;

/*
 * How long an account's last read of costs is remembered
 * (costAccountsReadAt): one not read for this long has left the
 * connection, and is read in full again if it comes back.
 */
export const CLOUD_COST_ACCOUNT_MEMORY_MS: number = 45 * 24 * 60 * 60 * 1000;

/*
 * Which reading of the costs this is (CloudConnectionPullState.costsVersion).
 * 2: each cost keeps its tags. A connection whose costs were read by an
 * older one reads them as far back as a first read does, once, so the
 * days already kept take their tags too.
 */
export const CLOUD_COSTS_READ_VERSION: number = 2;

/*
 * The costs given the tags OneUptime holds for the resources they are
 * billed to (its inventory's), where the cloud's billing gave them none of
 * its own - a Google Cloud billing export's labels are its own.
 */
export function tagCloudCostRecords(data: {
  records: Array<CloudCostRecord>;
  provider: string;
  resources: Array<{
    providerResourceId: string;
    cloudTags: Record<string, string>;
  }>;
}): Array<CloudCostRecord> {
  const tagsByKey: Map<string, Record<string, string>> = new Map();

  for (const resource of data.resources) {
    const key: string = getCloudCostResourceKey(
      data.provider,
      resource.providerResourceId,
    );

    if (key && Object.keys(resource.cloudTags || {}).length > 0) {
      tagsByKey.set(key, resource.cloudTags);
    }
  }

  return data.records.map((record: CloudCostRecord): CloudCostRecord => {
    if (
      !record.resourceId ||
      (record.tags && Object.keys(record.tags).length > 0)
    ) {
      return record;
    }

    const tags: Record<string, string> | undefined = tagsByKey.get(
      record.resourceId,
    );

    return tags ? { ...record, tags } : record;
  });
}

/*
 * How long a lane may run: its own limit, or what is left before the
 * read's deadline when that is sooner - 0 when too little is left to start.
 */
export function getLaneDurationMs(data: {
  maxDurationMs: number;
  deadlineMs: number;
  nowMs: number;
}): number {
  const left: number = data.deadlineMs - data.nowMs;

  if (left < CLOUD_LANE_MIN_TIME_MS) {
    return 0;
  }

  return Math.min(data.maxDurationMs, left);
}

export interface CloudChangesLaneOutcome {
  ran: boolean;
  warnings: Array<string>;
  // Change events written.
  recorded: number;
  // Security events the audit records made, while Cloud audit logs are on.
  securityEventsStored?: number | undefined;
}

export interface CloudCostsLaneOutcome {
  ran: boolean;
  warnings: Array<string>;
  // Cost rows written: only series whose figure changed.
  rowsWritten: number;
  // Accounts whose costs were read.
  accountsRead: number;
}

export interface CloudSavingsLaneOutcome {
  ran: boolean;
  warnings: Array<string>;
  // Recommendations the accounts read now have.
  recommendations: number;
  // Right-sizings OneUptime worked out itself, kept beside them.
  rightSized?: number | undefined;
}

export interface CloudInventoryLaneOutcome {
  // Whether the inventory ran on this read.
  ran: boolean;
  warnings: Array<string>;
  accounts: Array<CloudInventoryAccount>;
  // The accounts it listed in full: their Last Listed At moves on.
  listedInFull: Array<string>;
  synced?: CloudConnectionSyncResult | undefined;
}

function isOlderThan(
  iso: string | undefined,
  ageMs: number,
  now: Date,
): boolean {
  const time: number = iso ? Date.parse(iso) : NaN;
  return !Number.isFinite(time) || now.getTime() - time >= ageMs;
}

function isRefusedCredential(error: unknown): boolean {
  return (
    error instanceof LlmProviderError &&
    error.kind === CloudConnectionFailureKind.Authentication
  );
}

/*
 * The accounts a listing read in full: every type it lists, everywhere it
 * lists them. An AWS account whose Regions were listed one by one is in
 * full when every Region it was read in is.
 */
export function getAccountsListedInFull(
  inventory: CloudInventoryResult,
): Array<string> {
  if (!inventory.complete) {
    return [];
  }

  const listed: Set<string> = new Set<string>();

  for (const entry of inventory.completelyListed) {
    listed.add(entry.accountId.toLowerCase());
  }

  return inventory.accounts
    .map((account: CloudInventoryAccount): string => {
      return account.accountId;
    })
    .filter((accountId: string): boolean => {
      return listed.has(accountId.toLowerCase());
    });
}

export default class CloudConnectionLanes {
  public static isInventoryDue(
    state: CloudConnectionPullState,
    now: Date,
  ): boolean {
    return isOlderThan(
      state.inventoryListedAt,
      CLOUD_INVENTORY_INTERVAL_MS,
      now,
    );
  }

  /*
   * Lists the connection's accounts when the inventory is due, and keeps
   * what it found. The state's inventoryListedAt moves on whether or not
   * the listing finished: an account too large to list within one budget
   * is listed again in full next time rather than every minute. A listing
   * that found more resources than one read adds lists again on the next
   * read instead, until every one of them is there.
   */
  public static async runInventory(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    connector: CloudConnector;
    settings: CloudConnectionSettings;
    state: CloudConnectionPullState;
    transport: CloudConnectorTransport;
    // When the read started: whether the lane is due, and what it records.
    now: Date;
    // The clock requests are signed with; `now` and no further when absent.
    clock?: (() => Date) | undefined;
    // When the read must be over (epoch ms): the lane gets what is left.
    deadlineMs: number;
    sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  }): Promise<CloudInventoryLaneOutcome> {
    const durationMs: number = getLaneDurationMs({
      maxDurationMs: CLOUD_INVENTORY_MAX_DURATION_MS,
      deadlineMs: data.deadlineMs,
      nowMs: Date.now(),
    });

    if (
      !data.connector.readInventory ||
      !CloudConnectionLanes.isInventoryDue(data.state, data.now) ||
      durationMs <= 0
    ) {
      return { ran: false, warnings: [], accounts: [], listedInFull: [] };
    }

    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: CLOUD_INVENTORY_MAX_REQUESTS,
      maxDurationMs: durationMs,
    });

    let inventory: CloudInventoryResult;

    try {
      inventory = await data.connector.readInventory(data.settings, {
        transport: data.transport,
        now:
          data.clock ||
          ((): Date => {
            return data.now;
          }),
        sleep: data.sleep,
        state: data.state,
        connectionId: data.connectionId.toString(),
        budget,
      });
    } catch (error) {
      if (isRefusedCredential(error)) {
        throw error;
      }

      data.state.inventoryListedAt = data.now.toISOString();

      return {
        ran: true,
        warnings: [
          `Could not list the account's resources: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
        accounts: [],
        listedInFull: [],
      };
    }

    /*
     * What was listed to its last page holds even when the listing as a
     * whole stopped part way: each entry names only the types and Regions
     * that got there, so the rest keep what they hold.
     */
    const completelyListed: Array<CloudCompleteListing> =
      inventory.completelyListed;

    const synced: CloudConnectionSyncResult =
      await CloudConnectionResourceSync.syncInventory({
        projectId: data.projectId,
        connectionId: data.connectionId,
        items: inventory.items,
        completelyListed,
        listedAt: data.now,
      });

    // Resources left to add: the next read lists again, a minute from now.
    data.state.inventoryListedAt = synced.hasMore
      ? new Date(
          data.now.getTime() -
            CLOUD_INVENTORY_INTERVAL_MS +
            CLOUD_INVENTORY_CONTINUE_MS,
        ).toISOString()
      : data.now.toISOString();

    const warnings: Array<string> = [...inventory.warnings];

    if (!inventory.complete) {
      warnings.push(
        "The inventory stopped at its limit for this read: what it listed is kept, and it lists the rest next time.",
      );
    }

    if (synced.hasMore) {
      warnings.push(
        "The accounts have more resources than one read adds: the next read adds the rest.",
      );
    }

    return {
      ran: true,
      warnings,
      accounts: inventory.accounts,
      listedInFull: getAccountsListedInFull(inventory),
      synced,
    };
  }

  /*
   * What changed in the connection's accounts since the last read, kept as
   * change events. The connector moves the state's cursors on as it reads;
   * when what it brought in cannot all be written, or the read fails part
   * way, the cursors go back, and the next read reads that stretch again.
   */
  public static async runChanges(data: {
    projectId: ObjectID;
    provider: CloudProvider;
    connectionId: ObjectID;
    connector: CloudConnector;
    settings: CloudConnectionSettings;
    state: CloudConnectionPullState;
    transport: CloudConnectorTransport;
    now: Date;
    clock?: (() => Date) | undefined;
    deadlineMs: number;
    sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  }): Promise<CloudChangesLaneOutcome> {
    const durationMs: number = getLaneDurationMs({
      maxDurationMs: CLOUD_CHANGES_MAX_DURATION_MS,
      deadlineMs: data.deadlineMs,
      nowMs: Date.now(),
    });

    if (!data.connector.readChanges || durationMs <= 0) {
      return { ran: false, warnings: [], recorded: 0 };
    }

    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: CLOUD_CHANGES_MAX_REQUESTS,
      maxDurationMs: durationMs,
    });
    const snapshot: CloudChangeWindowSnapshot = snapshotChangeWindow(
      data.state,
    );
    // Security Events' Cloud audit logs: whether this read keeps its records.
    const auditSource: SecurityTelemetrySource | null =
      await CloudAuditSecurityEvents.findEnabledSource(data.projectId);

    try {
      const result: CloudChangesResult = await data.connector.readChanges(
        data.settings,
        {
          transport: data.transport,
          now:
            data.clock ||
            ((): Date => {
              return data.now;
            }),
          sleep: data.sleep,
          state: data.state,
          connectionId: data.connectionId.toString(),
          budget,
          keepAuditRecords: auditSource !== null,
        },
      );

      const outcome: CloudChangeRecordOutcome =
        await CloudChangeRecorder.record({
          projectId: data.projectId,
          provider: data.provider,
          changes: result.changes,
        });
      const warnings: Array<string> = [...result.warnings];

      if (outcome.unwritten.length > 0) {
        restoreChangeWindow({
          state: data.state,
          snapshot,
          unwrittenEventIds: outcome.unwritten.map(
            (change: CloudChange): string => {
              return change.eventId;
            },
          ),
        });
        warnings.push(CHANGES_NOT_SAVED_WARNING);
      }

      let securityEventsStored: number | undefined = undefined;

      if (auditSource) {
        try {
          const stored: CloudAuditStoreOutcome =
            await CloudAuditSecurityEvents.store({
              projectId: data.projectId,
              provider: data.provider,
              connectionId: data.connectionId,
              source: auditSource,
              records: result.auditRecords || [],
              // Stamped as they are stored, so a scheduled rule reads them.
              now: OneUptimeDate.getCurrentDate(),
            });

          securityEventsStored = stored.eventsFound;
        } catch (error) {
          /*
           * Read the same stretch again: the changes written stay seen and
           * are not written twice, and the records stored are found stored.
           */
          restoreChangeWindow({
            state: data.state,
            snapshot,
            unwrittenEventIds: [],
          });
          warnings.push(
            `${AUDIT_RECORDS_NOT_SAVED_WARNING} ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      forgetStalePlaces(data.state, data.now);

      return {
        ran: true,
        warnings,
        recorded: outcome.recorded,
        ...(securityEventsStored !== undefined ? { securityEventsStored } : {}),
      };
    } catch (error) {
      // Nothing this read brought in was written: it is read again.
      restoreChangeWindow({ state: data.state, snapshot });

      if (isRefusedCredential(error)) {
        throw error;
      }

      return {
        ran: true,
        warnings: [
          `Could not read what changed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
        recorded: 0,
      };
    }
  }

  /*
   * Whether the costs are read on this read: every account's, twelve hours
   * after the last whole read; else the accounts the last read put off, once
   * the time they may be read has come.
   */
  public static isCostsDue(
    state: CloudConnectionPullState,
    now: Date,
  ): boolean {
    return (
      CloudConnectionLanes.isWholeCostsReadDue(state, now) ||
      CloudConnectionLanes.isPendingCostsDue(state, now)
    );
  }

  // Every account's costs: twelve hours after the last whole read.
  public static isWholeCostsReadDue(
    state: CloudConnectionPullState,
    now: Date,
  ): boolean {
    return isOlderThan(state.costsReadAt, CLOUD_COSTS_INTERVAL_MS, now);
  }

  // The accounts the last read put off, from the time they may be read.
  public static isPendingCostsDue(
    state: CloudConnectionPullState,
    now: Date,
  ): boolean {
    const pending: CloudConnectionPullState["costsPending"] =
      state.costsPending;

    if (!pending || pending.accounts.length === 0) {
      return false;
    }

    const at: number = Date.parse(pending.at);

    return !Number.isFinite(at) || at <= now.getTime();
  }

  /*
   * Whether a read of costs goes back as far as a first read: never read,
   * or read by an older reading of the costs (CLOUD_COSTS_READ_VERSION).
   */
  public static isFirstCostsRead(state: CloudConnectionPullState): boolean {
    return (
      !state.costsReadAt || (state.costsVersion || 1) < CLOUD_COSTS_READ_VERSION
    );
  }

  public static isSavingsDue(
    state: CloudConnectionPullState,
    now: Date,
  ): boolean {
    return isOlderThan(state.savingsReadAt, CLOUD_SAVINGS_INTERVAL_MS, now);
  }

  /*
   * The project's accounts of this cloud, by their id in it (lower case):
   * what a cost or a recommendation is kept under.
   */
  public static async loadAccountRows(data: {
    projectId: ObjectID;
    provider: CloudProvider;
  }): Promise<Map<string, CloudAccount>> {
    const accounts: Array<CloudAccount> = await CloudAccountService.findBy({
      query: { projectId: data.projectId, provider: data.provider },
      select: {
        _id: true,
        accountId: true,
        costSummary: true,
        savingsSummary: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
    const rows: Map<string, CloudAccount> = new Map();

    for (const account of accounts) {
      if (account.id && account.accountId) {
        rows.set(account.accountId.trim().toLowerCase(), account);
      }
    }

    return rows;
  }

  private static toRowIds(
    rows: Map<string, CloudAccount>,
  ): Map<string, ObjectID> {
    const ids: Map<string, ObjectID> = new Map();

    for (const [accountId, row] of rows) {
      if (row.id) {
        ids.set(accountId, row.id);
      }
    }

    return ids;
  }

  private static readAccounts(
    outcomes: Array<CloudCostAccountOutcome>,
  ): Set<string> {
    return new Set<string>(
      outcomes
        .filter((outcome: CloudCostAccountOutcome): boolean => {
          return outcome.state === CloudCostState.Reading;
        })
        .map((outcome: CloudCostAccountOutcome): string => {
          return outcome.accountId.trim().toLowerCase();
        }),
    );
  }

  /*
   * The accounts a read wrote, by the days each was read over: an account's
   * own first read covers more days than the read was asked for, and each
   * group is brought in line over its own days - never over another's, which
   * would take back the days it did not read.
   */
  public static groupCostAccountsByWindow(data: {
    outcomes: Array<CloudCostAccountOutcome>;
    window: { start: Date; end: Date };
  }): Array<{ window: { start: Date; end: Date }; accounts: Set<string> }> {
    const groups: Map<
      string,
      { window: { start: Date; end: Date }; accounts: Set<string> }
    > = new Map();

    for (const outcome of data.outcomes) {
      if (outcome.state !== CloudCostState.Reading) {
        continue;
      }

      const window: { start: Date; end: Date } = outcome.window || data.window;
      const key: string = `${window.start.getTime()}|${window.end.getTime()}`;
      const group: {
        window: { start: Date; end: Date };
        accounts: Set<string>;
      } = groups.get(key) || { window, accounts: new Set<string>() };

      group.accounts.add(outcome.accountId.trim().toLowerCase());
      groups.set(key, group);
    }

    return Array.from(groups.values());
  }

  /*
   * When a queued account's costs are read: at the connection's first read
   * from the time it may be read (its reads come every readIntervalMs from
   * now), or at that time when the interval is not known.
   */
  public static getQueuedCostsReadAt(data: {
    retryAt: string | undefined;
    now: Date;
    readIntervalMs?: number | undefined;
  }): string {
    const retryAt: number = Date.parse(data.retryAt || "");
    const from: number = Number.isFinite(retryAt)
      ? Math.max(retryAt, data.now.getTime())
      : data.now.getTime();
    const interval: number = data.readIntervalMs || 0;

    if (interval <= 0) {
      return new Date(from).toISOString();
    }

    const reads: number = Math.max(
      1,
      Math.ceil((from - data.now.getTime()) / interval),
    );

    return new Date(data.now.getTime() + reads * interval).toISOString();
  }

  /*
   * What a read of costs got to, kept on the connection once its costs are
   * written: when each account it read was read, and the accounts it put
   * off with the earliest time one may be read (costsPending) - none left,
   * none pending. An account not read for CLOUD_COST_ACCOUNT_MEMORY_MS is
   * forgotten: it has left the connection.
   */
  public static keepCostProgress(data: {
    state: CloudConnectionPullState;
    outcomes: Array<CloudCostAccountOutcome>;
    now: Date;
  }): void {
    const readAt: Record<string, string> = {};

    for (const [accountId, at] of Object.entries(
      data.state.costAccountsReadAt || {},
    )) {
      if (!isOlderThan(at, CLOUD_COST_ACCOUNT_MEMORY_MS, data.now)) {
        readAt[accountId] = at;
      }
    }

    for (const outcome of data.outcomes) {
      if (outcome.state === CloudCostState.Reading) {
        readAt[outcome.accountId.trim().toLowerCase()] = data.now.toISOString();
      }
    }

    if (Object.keys(readAt).length > 0) {
      data.state.costAccountsReadAt = readAt;
    } else {
      delete data.state.costAccountsReadAt;
    }

    const queued: Array<CloudCostAccountOutcome> = data.outcomes.filter(
      (outcome: CloudCostAccountOutcome): boolean => {
        return outcome.state === CloudCostState.Queued;
      },
    );

    if (queued.length === 0) {
      delete data.state.costsPending;
      return;
    }

    const times: Array<number> = queued
      .map((outcome: CloudCostAccountOutcome): number => {
        return Date.parse(outcome.retryAt || "");
      })
      .filter((time: number): boolean => {
        return Number.isFinite(time);
      });

    data.state.costsPending = {
      accounts: queued.map((outcome: CloudCostAccountOutcome): string => {
        return outcome.accountId.trim().toLowerCase();
      }),
      at: new Date(
        times.length > 0 ? Math.min(...times) : data.now.getTime(),
      ).toISOString(),
    };
  }

  /*
   * A read that carried on with the accounts put off and failed as a whole
   * is tried again within CLOUD_COSTS_RETRY_MS, as a whole read is: the
   * accounts stay pending, and the twelve-hour beat stays as it was.
   */
  private static retryPendingSoon(
    state: CloudConnectionPullState,
    now: Date,
  ): void {
    if (state.costsPending) {
      state.costsPending = {
        ...state.costsPending,
        at: new Date(now.getTime() + CLOUD_COSTS_RETRY_MS).toISOString(),
      };
    }
  }

  /*
   * What the connection's accounts cost, when it is due: read from the
   * cloud's billing, kept exactly (CloudCostWriter), each account's summary
   * written, and the project's budgets checked against it. A first read
   * goes back further than the ones after it (getCloudCostWindow), and so
   * does an account's own first read, for a cloud read account by account.
   * An account whose costs could not be read keeps the figures it had, and
   * its summary says why. One its cloud's rate limit put off (queued) keeps
   * its figures and is read at the first read from when it may be - the
   * read carries on with it there, and the next whole read is still twelve
   * hours after this one; until it has figures, its summary says when. A
   * refused credential fails the read; any other failure is a warning,
   * tried again within the hour.
   */
  public static async runCosts(data: {
    projectId: ObjectID;
    provider: CloudProvider;
    connectionId: ObjectID;
    connector: CloudConnector;
    settings: CloudConnectionSettings;
    state: CloudConnectionPullState;
    transport: CloudConnectorTransport;
    now: Date;
    clock?: (() => Date) | undefined;
    deadlineMs: number;
    sleep?: ((milliseconds: number) => Promise<void>) | undefined;
    // How often the connection is read: when a queued account is read next.
    readIntervalMs?: number | undefined;
  }): Promise<CloudCostsLaneOutcome> {
    const durationMs: number = getLaneDurationMs({
      maxDurationMs: CLOUD_COSTS_MAX_DURATION_MS,
      deadlineMs: data.deadlineMs,
      nowMs: Date.now(),
    });

    if (
      !data.connector.readCosts ||
      !CloudConnectionLanes.isCostsDue(data.state, data.now) ||
      durationMs <= 0
    ) {
      return { ran: false, warnings: [], rowsWritten: 0, accountsRead: 0 };
    }

    // Every account's, or only the ones the last read put off.
    const isWholeRead: boolean = CloudConnectionLanes.isWholeCostsReadDue(
      data.state,
      data.now,
    );
    const pendingAccounts: Array<string> | undefined = isWholeRead
      ? undefined
      : data.state.costsPending?.accounts;
    let window: { start: Date; end: Date } = getCloudCostWindow({
      now: data.now,
      isFirstRead: CloudConnectionLanes.isFirstCostsRead(data.state),
    });

    let read: CloudCostsResult;
    let linked: Awaited<
      ReturnType<typeof CloudConnectionResourceSync.loadLinked>
    > = [];

    try {
      // A cost given by resource but not by Region takes its resource's.
      linked = await CloudConnectionResourceSync.loadLinked({
        projectId: data.projectId,
        connectionId: data.connectionId,
      });

      read = await data.connector.readCosts(data.settings, {
        knownResources: CloudConnectionResourceSync.toKnownResources(linked),
        transport: data.transport,
        now:
          data.clock ||
          ((): Date => {
            return data.now;
          }),
        sleep: data.sleep,
        state: data.state,
        connectionId: data.connectionId.toString(),
        budget: new CloudReadBudget({
          maxRequests: CLOUD_COSTS_MAX_REQUESTS,
          maxDurationMs: durationMs,
        }),
        start: window.start,
        end: window.end,
        firstReadWindow: getCloudCostWindow({
          now: data.now,
          isFirstRead: true,
        }),
        ...(pendingAccounts ? { accounts: pendingAccounts } : {}),
      });
    } catch (error) {
      if (isRefusedCredential(error)) {
        throw error;
      }

      if (isWholeRead) {
        CloudConnectionLanes.retrySoon(data.state, "costsReadAt", data.now);
      } else {
        CloudConnectionLanes.retryPendingSoon(data.state, data.now);
      }

      return {
        ran: true,
        warnings: [
          "Could not read the accounts' costs: " +
            (error instanceof Error ? error.message : String(error)),
        ],
        rowsWritten: 0,
        accountsRead: 0,
      };
    }

    const warnings: Array<string> = [...read.warnings];
    let rowsWritten: number = 0;
    let accountsRead: number = 0;

    /*
     * A connector that read further back than asked (AWS's first read of
     * costs per resource) covers more days: the writer brings those in line.
     */
    if (
      read.window &&
      read.window.start.getTime() < window.start.getTime() &&
      read.window.end.getTime() === window.end.getTime()
    ) {
      window = { start: read.window.start, end: read.window.end };
    }

    // Whether the connection reads costs per resource (AWS's setting).
    const isResourceCostsOn: boolean =
      data.provider === CloudProvider.AWS &&
      isCloudConnectionResourceCostsOn(
        readCloudSetting(data.settings.config, RESOURCE_COSTS_FIELD_KEY),
      );
    const resourceStatuses: Map<string, CloudResourceCostsStatus> = new Map();

    for (const outcome of read.resourceCosts || []) {
      resourceStatuses.set(
        outcome.accountId.trim().toLowerCase(),
        outcome.message
          ? { state: outcome.state, message: outcome.message }
          : { state: outcome.state },
      );
    }

    try {
      const rows: Map<string, CloudAccount> =
        await CloudConnectionLanes.loadAccountRows({
          projectId: data.projectId,
          provider: data.provider,
        });
      const readAccounts: Set<string> = CloudConnectionLanes.readAccounts(
        read.accounts,
      );
      // Each cost with its resource's tags, where its billing named none.
      const records: Array<CloudCostRecord> = tagCloudCostRecords({
        records: read.records,
        provider: data.provider,
        resources: linked,
      });

      // Each account's days brought in line: an account's first read over its own.
      for (const group of CloudConnectionLanes.groupCostAccountsByWindow({
        outcomes: read.accounts,
        window,
      })) {
        const written: CloudCostWriteResult = await CloudCostWriter.write({
          target: {
            projectId: data.projectId,
            connectionId: data.connectionId,
            provider: data.provider,
            accountRows: CloudConnectionLanes.toRowIds(rows),
          },
          window: group.window,
          records,
          accountsRead: group.accounts,
          now: data.now,
        });

        rowsWritten += written.rowsWritten;
      }

      // Each account's summary: its figures, or why they could not be read.
      const summaries: Map<string, CloudAccountCostSummary> =
        await CloudCostWriter.summarize({
          projectId: data.projectId,
          cloudAccountIds: Array.from(readAccounts)
            .map((accountId: string): string => {
              return rows.get(accountId)?.id?.toString() || "";
            })
            .filter((id: string): boolean => {
              return id.length > 0;
            }),
          now: data.now,
        });

      for (const outcome of read.accounts) {
        const row: CloudAccount | undefined = rows.get(
          outcome.accountId.trim().toLowerCase(),
        );

        if (!row?.id) {
          continue;
        }

        let summary: CloudAccountCostSummary | undefined;
        const previous: CloudAccountCostSummary | null =
          readCloudAccountCostSummary(row.costSummary);

        if (outcome.state === CloudCostState.Reading) {
          summary = summaries.get(row.id.toString());
          accountsRead++;
        } else if (
          outcome.state === CloudCostState.Queued &&
          previous?.state === CloudCostState.Reading
        ) {
          // Its figures still hold, and still count, while its next read waits.
          continue;
        } else {
          summary = {
            ...(previous || {
              currency: "USD",
              monthToDate: 0,
              lastMonth: 0,
              monthFullDays: 0,
              lastMonthToDate: 0,
              projectedMonth: 0,
              last30Days: 0,
              topServices: [],
              readAt: data.now.toISOString(),
            }),
            state: outcome.state,
            message: outcome.message,
            nextReadAt:
              outcome.state === CloudCostState.Queued
                ? CloudConnectionLanes.getQueuedCostsReadAt({
                    retryAt: outcome.retryAt,
                    now: data.now,
                    readIntervalMs: data.readIntervalMs,
                  })
                : undefined,
          };
        }

        if (!summary) {
          continue;
        }

        /*
         * Whether its costs per resource could be read: this read's word,
         * else - read once a day - the last one's, while the setting is on.
         */
        const resources: CloudResourceCostsStatus | undefined =
          resourceStatuses.get(outcome.accountId.trim().toLowerCase()) ||
          (isResourceCostsOn
            ? readCloudAccountCostSummary(row.costSummary)?.resources
            : undefined);

        // Left out when the setting is off: nothing to say of resources.
        summary = { ...summary, resources };

        await CloudAccountService.updateOneById({
          id: row.id,
          data: {
            costSummary: summary as unknown as JSONObject,
          } as never,
          props: { isRoot: true, ignoreHooks: true },
        });
      }
    } catch (error) {
      warnings.push(
        "Could not keep the accounts' costs: " +
          (error instanceof Error ? error.message : String(error)),
      );

      if (isWholeRead) {
        CloudConnectionLanes.retrySoon(data.state, "costsReadAt", data.now);
      } else {
        CloudConnectionLanes.retryPendingSoon(data.state, data.now);
      }

      return { ran: true, warnings, rowsWritten, accountsRead };
    }

    // What the read got to, now that its costs are kept.
    CloudConnectionLanes.keepCostProgress({
      state: data.state,
      outcomes: read.accounts,
      now: data.now,
    });

    if (isWholeRead) {
      data.state.costsReadAt = data.now.toISOString();
      data.state.costsVersion = CLOUD_COSTS_READ_VERSION;
    }

    // The costs per resource read, now kept: read again a day later.
    if (read.resourceCostsReadAt) {
      data.state.resourceCostsReadAt = read.resourceCostsReadAt;
    }

    // The project's budgets, against what its accounts cost now.
    try {
      await CloudBudgetEvaluator.evaluateProject(data.projectId);
    } catch (error) {
      logger.error(
        "Cloud connection " +
          data.connectionId.toString() +
          ": the project's budgets could not be checked: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }

    return { ran: true, warnings, rowsWritten, accountsRead };
  }

  /*
   * The ways to spend less in the connection's accounts, once a day: read
   * from the cloud's recommender and kept in step with it
   * (CloudSavingsWriter). An account that could not be read keeps what it
   * has.
   */
  public static async runSavings(data: {
    projectId: ObjectID;
    provider: CloudProvider;
    connectionId: ObjectID;
    connector: CloudConnector;
    settings: CloudConnectionSettings;
    state: CloudConnectionPullState;
    transport: CloudConnectorTransport;
    now: Date;
    clock?: (() => Date) | undefined;
    deadlineMs: number;
    sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  }): Promise<CloudSavingsLaneOutcome> {
    const durationMs: number = getLaneDurationMs({
      maxDurationMs: CLOUD_SAVINGS_MAX_DURATION_MS,
      deadlineMs: data.deadlineMs,
      nowMs: Date.now(),
    });

    if (
      !data.connector.readSavings ||
      !CloudConnectionLanes.isSavingsDue(data.state, data.now) ||
      durationMs <= 0
    ) {
      return { ran: false, warnings: [], recommendations: 0 };
    }

    let read: CloudSavingsResult;

    try {
      // Where a recommender that answers per place is asked: the resources held.
      const linked: Awaited<
        ReturnType<typeof CloudConnectionResourceSync.loadLinked>
      > = await CloudConnectionResourceSync.loadLinked({
        projectId: data.projectId,
        connectionId: data.connectionId,
      });

      read = await data.connector.readSavings(data.settings, {
        knownResources: CloudConnectionResourceSync.toKnownResources(linked),
        transport: data.transport,
        now:
          data.clock ||
          ((): Date => {
            return data.now;
          }),
        sleep: data.sleep,
        state: data.state,
        connectionId: data.connectionId.toString(),
        budget: new CloudReadBudget({
          maxRequests: CLOUD_SAVINGS_MAX_REQUESTS,
          maxDurationMs: durationMs,
        }),
      });
    } catch (error) {
      if (isRefusedCredential(error)) {
        throw error;
      }

      CloudConnectionLanes.retrySoon(data.state, "savingsReadAt", data.now);

      return {
        ran: true,
        warnings: [
          "Could not read the ways to spend less: " +
            (error instanceof Error ? error.message : String(error)),
        ],
        recommendations: 0,
      };
    }

    const warnings: Array<string> = [...read.warnings];

    try {
      const rows: Map<string, CloudAccount> =
        await CloudConnectionLanes.loadAccountRows({
          projectId: data.projectId,
          provider: data.provider,
        });

      const written: CloudSavingsWriteResult = await CloudSavingsWriter.write({
        projectId: data.projectId,
        provider: data.provider,
        accountRows: CloudConnectionLanes.toRowIds(rows),
        accountsRead: CloudConnectionLanes.readAccounts(read.accounts),
        recommendations: read.recommendations,
        now: data.now,
      });

      /*
       * OneUptime's own right-sizing, from its readings of the CPU and
       * memory of what no recommender speaks for: after the recommender,
       * so a resource it now covers is left to it. Never throws.
       */
      const rightSizing: CloudRightSizingWriteResult =
        await CloudRightSizingWriter.run({
          projectId: data.projectId,
          connectionId: data.connectionId,
          provider: data.provider,
          accountRows: CloudConnectionLanes.toRowIds(rows),
          now: data.now,
        });

      /*
       * Each account's summary, from every way to spend less it now holds:
       * its recommender's and OneUptime's own. One whose recommender could
       * not be read keeps what it had - its rows stay - with why.
       */
      const stored: Map<
        string,
        Array<{
          monthlySavings: number;
          currency: string;
          kind: CloudSavingKind;
        }>
      > = await CloudSavingsWriter.loadSavingsByAccount({
        projectId: data.projectId,
        cloudAccountIds: read.accounts
          .map((outcome: CloudCostAccountOutcome): ObjectID | null => {
            return rows.get(outcome.accountId.trim().toLowerCase())?.id || null;
          })
          .filter((id: ObjectID | null): boolean => {
            return Boolean(id);
          }) as Array<ObjectID>,
      });

      // Each account's commitments, as this read found them.
      const commitments: Map<string, CloudCommitmentSummary> = new Map();

      for (const entry of read.commitments || []) {
        commitments.set(entry.accountId.trim().toLowerCase(), entry.summary);
      }

      for (const outcome of read.accounts) {
        const accountKey: string = outcome.accountId.trim().toLowerCase();
        const row: CloudAccount | undefined = rows.get(accountKey);

        if (!row?.id) {
          continue;
        }

        const figures: CloudAccountSavingsSummary =
          summarizeCloudAccountSavings({
            savings: stored.get(row.id.toString()) || [],
            now: data.now,
          });
        const kept: CloudCommitmentSummary | undefined =
          CloudConnectionLanes.keepCommitments({
            read: commitments.get(accountKey),
            previous: readCloudAccountSavingsSummary(row.savingsSummary)
              ?.commitments,
          });
        const withCommitments: CloudAccountSavingsSummary = kept
          ? { ...figures, commitments: kept }
          : figures;
        const summary: CloudAccountSavingsSummary =
          outcome.state === CloudCostState.Reading
            ? withCommitments
            : {
                ...withCommitments,
                state: outcome.state,
                message: outcome.message,
              };

        await CloudAccountService.updateOneById({
          id: row.id,
          data: {
            savingsSummary: summary as unknown as JSONObject,
          } as never,
          props: { isRoot: true, ignoreHooks: true },
        });
      }

      data.state.savingsReadAt = data.now.toISOString();

      return {
        ran: true,
        warnings,
        recommendations: written.created + written.updated,
        rightSized: rightSizing.kept,
      };
    } catch (error) {
      warnings.push(
        "Could not keep the ways to spend less: " +
          (error instanceof Error ? error.message : String(error)),
      );
      CloudConnectionLanes.retrySoon(data.state, "savingsReadAt", data.now);

      return { ran: true, warnings, recommendations: 0 };
    }
  }

  /*
   * An account's commitments after a read: what the read found - or, when
   * it could not read them, the figures it had, saying why they are not
   * new - or, with nothing read for the account this time (an organization's
   * member, whose are its management account's), what it had.
   */
  public static keepCommitments(data: {
    read: CloudCommitmentSummary | undefined;
    previous: CloudCommitmentSummary | undefined;
  }): CloudCommitmentSummary | undefined {
    if (!data.read) {
      return data.previous;
    }

    if (
      data.read.state === CloudCostState.Reading ||
      !data.previous ||
      data.previous.kinds.length === 0
    ) {
      return data.read;
    }

    return {
      ...data.previous,
      state: data.read.state,
      message: data.read.message,
    };
  }

  /*
   * A lane that failed as a whole is due again within CLOUD_COSTS_RETRY_MS,
   * not after its whole interval: its mark is set back by the rest. A first
   * read of costs that failed stays a first read, so it goes back as far
   * when it is tried again - the next read, a minute or more later.
   */
  private static retrySoon(
    state: CloudConnectionPullState,
    key: "costsReadAt" | "savingsReadAt",
    now: Date,
  ): void {
    const interval: number =
      key === "costsReadAt"
        ? CLOUD_COSTS_INTERVAL_MS
        : CLOUD_SAVINGS_INTERVAL_MS;

    /*
     * A connection's very first read that failed stays one: it goes back as
     * far when tried again. One read by an older reading of the costs is
     * tried again within the hour, as any other, and still reads as far
     * back when it is (its costsVersion is not moved on).
     */
    if (!state[key] && key === "costsReadAt") {
      return;
    }

    state[key] = new Date(
      now.getTime() - interval + CLOUD_COSTS_RETRY_MS,
    ).toISOString();
  }

  /*
   * The connection's accounts, kept: each found or created, named after
   * what its cloud calls it when the inventory said, marked listed in full
   * when the inventory listed it to its last page, and its resources
   * counted when they may have changed. Never throws: an account that
   * cannot be kept is logged.
   */
  public static async keepAccounts(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    provider: CloudProvider;
    accountIds: Array<string>;
    named: Array<CloudInventoryAccount>;
    // The accounts the inventory listed in full on this read, and when.
    listedInFull?: Array<string> | undefined;
    listedAt?: Date | undefined;
    recount: boolean;
  }): Promise<void> {
    try {
      const names: Map<string, string> = new Map();

      for (const account of data.named) {
        if (account.name) {
          names.set(account.accountId.toLowerCase(), account.name);
        }
      }

      const listedInFull: Set<string> = new Set<string>(
        (data.listedInFull || []).map((accountId: string): string => {
          return accountId.trim().toLowerCase();
        }),
      );

      const accountIds: Array<string> = Array.from(
        new Set(
          [
            ...data.accountIds,
            ...data.named.map((account: CloudInventoryAccount): string => {
              return account.accountId;
            }),
          ]
            .map((id: string): string => {
              return id.trim();
            })
            .filter((id: string): boolean => {
              return id.length > 0;
            }),
        ),
      );

      const rows: Array<CloudAccount> =
        await CloudAccountService.recordAccountsSeen({
          projectId: data.projectId,
          connectionId: data.connectionId,
          provider: data.provider,
          accounts: accountIds.map((accountId: string) => {
            return {
              accountId,
              name: names.get(accountId.toLowerCase()),
              listedInFullAt:
                data.listedAt && listedInFull.has(accountId.toLowerCase())
                  ? data.listedAt
                  : undefined,
            };
          }),
        });

      if (!data.recount) {
        return;
      }

      for (const row of rows) {
        if (row.id && row.accountId) {
          await CloudAccountService.refreshSummary({
            id: row.id,
            projectId: data.projectId,
            provider: data.provider,
            accountId: row.accountId,
          });
        }
      }
    } catch (error) {
      logger.error(
        `Cloud connection ${data.connectionId.toString()}: its accounts could not be kept: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
