import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudConnectionFailureKind } from "../../../Types/CloudConnection/CloudConnectionTest";
import ObjectID from "../../../Types/ObjectID";
import CloudAccountService from "../../Services/CloudAccountService";
import LlmProviderError from "../LlmObservability/LlmProviderError";
import logger from "../Logger";
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
  CloudInventoryAccount,
  CloudInventoryResult,
  CloudReadBudget,
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
 *     cannot be written are read again next time: the cursors go back;
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

      forgetStalePlaces(data.state, data.now);

      return { ran: true, warnings, recorded: outcome.recorded };
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
