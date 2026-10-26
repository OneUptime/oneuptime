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
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnector,
  CloudConnectorTransport,
  CloudInventoryAccount,
  CloudInventoryResult,
  CloudReadBudget,
} from "./CloudConnectorTypes";

/*
 * WHAT A READ DOES BESIDES READING METRICS.
 *
 * A cloud connection's read (CloudConnectionPullRunner) reads metrics every
 * time. On a slower beat, and each with a budget of its own so it never
 * starves the metrics, it also:
 *
 *   - lists every resource of the connection's accounts (the inventory,
 *     every CLOUD_INVENTORY_INTERVAL_MS), keeping their tags, properties,
 *     relationships and endpoints;
 *   - keeps the connection's cloud accounts (CloudAccount): one row for
 *     each account it reaches, with the name its cloud gives it and its
 *     resources counted.
 *
 * Each lane's failure is a warning on the read, never its failure - except
 * a credential that is refused, which fails the read the way the metrics
 * would.
 */

// How often the inventory lists every resource.
export const CLOUD_INVENTORY_INTERVAL_MS: number = 30 * 60 * 1000;
export const CLOUD_INVENTORY_MAX_REQUESTS: number = 1500;
export const CLOUD_INVENTORY_MAX_DURATION_MS: number = 3 * 60 * 1000;
/*
 * A lane starts only with at least this long left before the read's
 * deadline; with less, it stays due and runs on the next read.
 */
export const CLOUD_LANE_MIN_TIME_MS: number = 20 * 1000;

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

export interface CloudInventoryLaneOutcome {
  // Whether the inventory ran on this read.
  ran: boolean;
  warnings: Array<string>;
  accounts: Array<CloudInventoryAccount>;
  synced?: CloudConnectionSyncResult | undefined;
}

function isOlderThan(iso: string | undefined, ageMs: number, now: Date): boolean {
  const time: number = iso ? Date.parse(iso) : NaN;
  return !Number.isFinite(time) || now.getTime() - time >= ageMs;
}

function isRefusedCredential(error: unknown): boolean {
  return (
    error instanceof LlmProviderError &&
    error.kind === CloudConnectionFailureKind.Authentication
  );
}

export default class CloudConnectionLanes {
  public static isInventoryDue(
    state: CloudConnectionPullState,
    now: Date,
  ): boolean {
    return isOlderThan(state.inventoryListedAt, CLOUD_INVENTORY_INTERVAL_MS, now);
  }

  /*
   * Lists the connection's accounts when the inventory is due, and keeps
   * what it found. The state's inventoryListedAt moves on whether or not
   * the listing finished: an account too large to list within one budget
   * is listed again in full next time rather than every minute.
   */
  public static async runInventory(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    connector: CloudConnector;
    settings: CloudConnectionSettings;
    state: CloudConnectionPullState;
    transport: CloudConnectorTransport;
    now: Date;
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
      return { ran: false, warnings: [], accounts: [] };
    }

    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: CLOUD_INVENTORY_MAX_REQUESTS,
      maxDurationMs: durationMs,
    });

    let inventory: CloudInventoryResult;

    try {
      inventory = await data.connector.readInventory(data.settings, {
        transport: data.transport,
        now: () => {
          return data.now;
        },
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
      };
    }

    const synced: CloudConnectionSyncResult =
      await CloudConnectionResourceSync.syncInventory({
        projectId: data.projectId,
        connectionId: data.connectionId,
        items: inventory.items,
        completelyListed: inventory.complete ? inventory.completelyListed : [],
        listedAt: data.now,
      });

    data.state.inventoryListedAt = data.now.toISOString();

    const warnings: Array<string> = [...inventory.warnings];

    if (!inventory.complete) {
      warnings.push(
        "The inventory stopped at its limit for this read: what it listed is kept, and it lists the rest next time.",
      );
    }

    return {
      ran: true,
      warnings,
      accounts: inventory.accounts,
      synced,
    };
  }

  /*
   * The connection's accounts, kept: each found or created, named after
   * what its cloud calls it when the inventory said, and its resources
   * counted when they may have changed. Never throws: an account that
   * cannot be kept is logged.
   */
  public static async keepAccounts(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    provider: CloudProvider;
    accountIds: Array<string>;
    named: Array<CloudInventoryAccount>;
    inventoryListedAt?: Date | undefined;
    recount: boolean;
  }): Promise<void> {
    try {
      const names: Map<string, string> = new Map();

      for (const account of data.named) {
        if (account.name) {
          names.set(account.accountId.toLowerCase(), account.name);
        }
      }

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
            };
          }),
          inventoryListedAt: data.inventoryListedAt,
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
