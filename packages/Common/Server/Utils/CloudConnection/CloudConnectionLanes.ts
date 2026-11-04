import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import SecurityTelemetrySource from "../../../Models/DatabaseModels/SecurityTelemetrySource";
import {
  CLOUD_COSTS_INTERVAL_MS,
  CLOUD_SAVINGS_INTERVAL_MS,
  CLOUD_COST_DEFAULT_CURRENCY,
  CloudAccountCostSummary,
  CloudAccountSavingsSummary,
  CloudCostState,
  getCloudCostWindow,
  readCloudAccountCostSummary,
  readCloudAccountSavingsSummary,
  summarizeCloudAccountSavings,
} from "../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
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
  CloudCostsResult,
  CloudInventoryAccount,
  CloudInventoryResult,
  CloudReadBudget,
  CloudSavingsResult,
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

  public static isCostsDue(
    state: CloudConnectionPullState,
    now: Date,
  ): boolean {
    return isOlderThan(state.costsReadAt, CLOUD_COSTS_INTERVAL_MS, now);
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
   * What the connection's accounts cost, when it is due: read from the
   * cloud's billing, kept exactly (CloudCostWriter), each account's summary
   * written, and the project's budgets checked against it. A first read
   * goes back further than the ones after it (getCloudCostWindow). An
   * account whose costs could not be read keeps the figures it had, and its
   * summary says why. A refused credential fails the read; any other
   * failure is a warning, tried again within the hour.
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

    const window: { start: Date; end: Date } = getCloudCostWindow({
      now: data.now,
      isFirstRead: !data.state.costsReadAt,
    });

    let read: CloudCostsResult;

    try {
      // A cost given by resource but not by Region takes its resource's.
      const linked: Awaited<
        ReturnType<typeof CloudConnectionResourceSync.loadLinked>
      > = await CloudConnectionResourceSync.loadLinked({
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
      });
    } catch (error) {
      if (isRefusedCredential(error)) {
        throw error;
      }

      CloudConnectionLanes.retrySoon(data.state, "costsReadAt", data.now);

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

    try {
      const rows: Map<string, CloudAccount> =
        await CloudConnectionLanes.loadAccountRows({
          projectId: data.projectId,
          provider: data.provider,
        });
      const readAccounts: Set<string> = CloudConnectionLanes.readAccounts(
        read.accounts,
      );

      const written: CloudCostWriteResult = await CloudCostWriter.write({
        target: {
          projectId: data.projectId,
          connectionId: data.connectionId,
          provider: data.provider,
          accountRows: CloudConnectionLanes.toRowIds(rows),
        },
        window,
        records: read.records,
        accountsRead: readAccounts,
        now: data.now,
      });

      rowsWritten = written.rowsWritten;

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

        if (outcome.state === CloudCostState.Reading) {
          summary = summaries.get(row.id.toString());
          accountsRead++;
        } else {
          const previous: CloudAccountCostSummary | null =
            readCloudAccountCostSummary(row.costSummary);
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
          };
        }

        if (!summary) {
          continue;
        }

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
      CloudConnectionLanes.retrySoon(data.state, "costsReadAt", data.now);

      return { ran: true, warnings, rowsWritten, accountsRead };
    }

    data.state.costsReadAt = data.now.toISOString();

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
       * Each account's summary: what its recommendations save now, or -
       * when they could not be read - what it had, with why.
       */
      for (const outcome of read.accounts) {
        const accountKey: string = outcome.accountId.trim().toLowerCase();
        const row: CloudAccount | undefined = rows.get(accountKey);

        if (!row?.id) {
          continue;
        }

        const previous: CloudAccountSavingsSummary | null =
          readCloudAccountSavingsSummary(row.savingsSummary);
        const summary: CloudAccountSavingsSummary =
          outcome.state === CloudCostState.Reading
            ? summarizeCloudAccountSavings({
                savings: written.savingsByAccount.get(accountKey) || [],
                now: data.now,
              })
            : {
                ...(previous || {
                  count: 0,
                  monthlySavings: 0,
                  byKind: {},
                  currency: CLOUD_COST_DEFAULT_CURRENCY,
                  readAt: data.now.toISOString(),
                }),
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
