import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Infrastructure/Semaphore";
import SecurityEventConnectionService from "../../../../Services/SecurityEventConnectionService";
import logger from "../../../Logger";
import SecurityBlockDestination, {
  SECURITY_BLOCKLIST_LOCK_NAMESPACE,
  SecurityBlockCapacity,
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockSupport,
  SecurityBlockWriteResult,
} from "../../../SecurityBlocklist/SecurityBlockDestination";
import { SecurityBlockDestinationSource } from "../../../SecurityBlocklist/SecurityBlockDestinations";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  CLOUDFLARE_BLOCK_LIST_NAMES,
  CLOUDFLARE_PLAN_LIMITS,
  CloudflareActionStatus,
  CloudflareBlockingMechanism,
  CloudflareBlockingSettings,
  CloudflareBlockingStatus,
  CloudflareZoneStatus,
  getCloudflareAccessRuleValueProblem,
  getCloudflareActionStatus,
  getCloudflareListValueProblem,
  isCloudflareBlockingRemovalPending,
  isCloudflareBlockingSetupPending,
  readCloudflareBlockingFailure,
  readCloudflareBlockingSettings,
  readCloudflareBlockingStatus,
} from "../../../../../Types/SecurityBlocklist/CloudflareBlocking";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
} from "../../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  SecurityAddressProtection,
  findProtectionAmong,
} from "../../../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../../../Utils/NetworkTraffic/NetworkAddressBlock";
import SecurityProtectedAddresses from "../../../SecurityBlocklist/SecurityProtectedAddresses";
import { ConnectorTransport, SecurityConnectorSettings } from "../Types";
import CloudflareBlocking, { CloudflareSleep } from "./CloudflareBlocking";
import CloudflareClient from "./CloudflareClient";
import CloudflareConnector from "./CloudflareConnector";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";

/*
 * A CLOUDFLARE CONNECTION WITH BLOCKING ON, AS A PLACE THAT ENFORCES THE
 * BLOCKLIST (#10343): the reconciler drives it through the destination
 * interface (SecurityBlockDestination), and it does each thing through
 * CloudflareBlocking, which calls Cloudflare through the connection's own
 * client.
 *
 *   - Its key is the connection's: the block's chip says Cloudflare (with
 *     the connection's name when the project has two), and one enforcement
 *     row a block is enough, whatever zones blocking is on in.
 *   - Its lock is the Cloudflare account's: Cloudflare allows one pending
 *     bulk operation per account, so two connections of one account never
 *     write at once.
 *   - prepare() sets blocking up when it was turned on or put back, and
 *     checks it every few minutes otherwise; the status it finds is kept on
 *     the connection (blockingStatus) for the connection's page.
 *   - A block a zone's rule does not enforce is held but not in force there,
 *     and says why ("Your rule in example.com was turned off: blocks there
 *     are not enforced"), which the reconciler writes on the block and its
 *     case.
 *
 * The source finds a project's Cloudflare connections with blocking on, the
 * projects that have work beyond their blocks, and takes OneUptime's lists
 * and rules away from a connection whose blocking was turned off when the
 * person asked it to (settle).
 */

// How often a setup is read again for drift: every few minutes.
export const CLOUDFLARE_BLOCKING_CHECK_INTERVAL_IN_MS: number = 3 * 60 * 1000;

// How long after a setup or check failed it is tried again, unless the person asks again sooner.
export const CLOUDFLARE_BLOCKING_RETRY_IN_MS: number = 5 * 60 * 1000;

// How long one pass may spend taking IP Access Rules away: the rest are taken on later passes.
export const CLOUDFLARE_REMOVAL_BUDGET_IN_MS: number = 60 * 1000;

const ROOT: { isRoot: true } = { isRoot: true };

// What a connection's row is read for.
const CONNECTION_SELECT: {
  _id: true;
  projectId: true;
  name: true;
  provider: true;
  config: true;
  secrets: true;
  alertingOnly: true;
  blockingSettings: true;
  blockingStatus: true;
} = {
  _id: true,
  projectId: true,
  name: true,
  provider: true,
  config: true,
  secrets: true,
  alertingOnly: true,
  blockingSettings: true,
  blockingStatus: true,
};

// How the destinations reach Cloudflare: the SSRF-guarded fetch, or a test's fake.
export interface CloudflareDestinationOptions {
  transport?: ConnectorTransport | undefined;
  baseUrl?: string | undefined;
  now?: (() => Date) | undefined;
  sleep?: CloudflareSleep | undefined;
  requestTimeoutInMs?: number | undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

function timeOf(value: string | undefined): number {
  const time: number = value ? new Date(value).getTime() : Number.NaN;

  return Number.isFinite(time) ? time : 0;
}

/*
 * What OneUptime found, kept on the connection as OneUptime: the column is
 * written by nobody else. Through a plain view of the data, as a JSON
 * column's typed partial is too deep for TypeScript to check.
 */
async function writeBlockingStatus(
  connectionId: ObjectID,
  status: JSONObject | null,
): Promise<void> {
  await SecurityEventConnectionService.updateOneById({
    id: connectionId,
    data: { blockingStatus: status as never },
    props: ROOT,
  });
}

// The account a connection blocks in, and the lock its writes take: one per Cloudflare account.
export function getCloudflareLockKey(accountId: string): string {
  return `Cloudflare:account:${accountId}`;
}

export class CloudflareBlockDestination implements SecurityBlockDestination {
  public readonly key: string;
  public readonly lockKey: string;
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.Cloudflare;
  public readonly name: string;
  public readonly connectionId: ObjectID;

  private settings: CloudflareBlockingSettings;
  private status: CloudflareBlockingStatus | null;
  private written: string;
  private blocking: CloudflareBlocking | null;
  // Why the connection's settings cannot be used, when they cannot.
  private broken: string | null;
  // When the first setup failed, before there was any status to keep.
  private failedAt: string | undefined;
  private projectId: ObjectID;
  private now: () => Date;

  public constructor(data: {
    connectionId: ObjectID;
    projectId: ObjectID;
    name: string;
    settings: CloudflareBlockingSettings;
    status: CloudflareBlockingStatus | null;
    // When a setup that left no status failed (the stored status's errorAt).
    failedAt?: string | undefined;
    connectorSettings: SecurityConnectorSettings;
    options?: CloudflareDestinationOptions | undefined;
  }) {
    this.connectionId = data.connectionId;
    this.key = `Cloudflare:${data.connectionId.toString()}`;
    this.name = data.name;
    this.settings = data.settings;
    this.status = data.status;
    this.failedAt = data.failedAt;
    this.projectId = data.projectId;
    this.written = JSON.stringify(data.status || null);
    this.now =
      data.options?.now ||
      ((): Date => {
        return new Date();
      });

    let accountId: string = "";

    try {
      const parsed: {
        apiToken: string;
        accountId: string;
        zoneIds: Array<string>;
      } = CloudflareConnector.parseSettings(data.connectorSettings, {
        requireAccount: true,
      });

      accountId = parsed.accountId;
      this.blocking = new CloudflareBlocking({
        client: new CloudflareClient({
          apiToken: parsed.apiToken,
          transport:
            data.options?.transport ||
            ((
              request: DataSourceHttpRequest,
            ): Promise<DataSourceHttpResponse> => {
              return DataSourceHttpFetch.fetch(request);
            }),
          requestTimeoutInMs: data.options?.requestTimeoutInMs || 30 * 1000,
          ...(data.options?.baseUrl ? { baseUrl: data.options.baseUrl } : {}),
          ...(data.options?.sleep ? { sleep: data.options.sleep } : {}),
          ...(data.options?.now
            ? {
                now: (): number => {
                  return data.options!.now!().getTime();
                },
              }
            : {}),
        }),
        scope: {
          projectId: data.projectId.toString(),
          accountId: parsed.accountId,
          readZoneIds: parsed.zoneIds,
          blockZoneIds: data.settings.zoneIds,
        },
        now: this.now,
        ...(data.options?.sleep ? { sleep: data.options.sleep } : {}),
      });
      this.broken = null;
    } catch (error) {
      this.blocking = null;
      this.broken = `The connection's settings cannot be used: ${errorText(error)}`;
    }

    // A connection whose settings cannot be read locks by itself, and fails each pass saying why.
    this.lockKey = accountId
      ? getCloudflareLockKey(accountId)
      : `Cloudflare:${data.connectionId.toString()}`;
  }

  public getStatus(): CloudflareBlockingStatus | null {
    return this.status;
  }

  // A setup asked for, or a check due - not while one that failed waits its retry, unless asked again since.
  public hasWorkOfItsOwn(now: Date): boolean {
    if (isCloudflareBlockingSetupPending(this.settings, this.status)) {
      const failedAt: number = timeOf(this.status?.errorAt || this.failedAt);

      return (
        !failedAt ||
        timeOf(this.settings.setupRequestedAt) > failedAt ||
        now.getTime() - failedAt >= CLOUDFLARE_BLOCKING_RETRY_IN_MS
      );
    }

    if (!this.status) {
      return true;
    }

    return (
      now.getTime() - timeOf(this.status.checkedAt) >=
      CLOUDFLARE_BLOCKING_CHECK_INTERVAL_IN_MS
    );
  }

  public async prepare(): Promise<void> {
    if (!this.blocking) {
      throw new Error(
        this.broken || "The connection's settings cannot be used.",
      );
    }

    const now: Date = this.now();
    const setUp: boolean =
      !this.status ||
      isCloudflareBlockingSetupPending(this.settings, this.status);
    const isDue: boolean =
      setUp ||
      now.getTime() - timeOf(this.status?.checkedAt) >=
        CLOUDFLARE_BLOCKING_CHECK_INTERVAL_IN_MS;

    if (!isDue) {
      return;
    }

    try {
      this.status = setUp
        ? await this.blocking.setUp({
            previous: this.status,
            zoneIds: this.settings.setupZoneIds,
            requestedAt: this.settings.setupRequestedAt,
          })
        : await this.blocking.check(this.status);
    } catch (error) {
      // What failed, kept for the connection's page; the status found before stands.
      if (this.status) {
        this.status = {
          ...this.status,
          error: errorText(error),
          errorAt: now.toISOString(),
        };
        await this.writeStatus();
      } else {
        await this.writeFailure(errorText(error), now);
      }

      throw error;
    }

    await this.keepUnprotectedSkipAddresses();
    await this.writeStatus();
  }

  /*
   * The zones' skip-rule addresses that no Protected Entity of the project
   * holds yet: the connection offers to protect those, and stops offering
   * an address once it is. When the list cannot be read, every one is
   * offered still.
   */
  private async keepUnprotectedSkipAddresses(): Promise<void> {
    const status: CloudflareBlockingStatus | null = this.status;

    if (
      !status ||
      !status.zones.some((zone: CloudflareZoneStatus): boolean => {
        return Boolean(zone.skipAddresses?.length);
      })
    ) {
      return;
    }

    let protections: Array<SecurityAddressProtection>;

    try {
      protections = (
        await SecurityProtectedAddresses.readProtectedEntities(
          this.projectId,
          ROOT,
        )
      ).protections;
    } catch {
      return;
    }

    this.status = {
      ...status,
      zones: status.zones.map(
        (zone: CloudflareZoneStatus): CloudflareZoneStatus => {
          const kept: Array<string> = (zone.skipAddresses || []).filter(
            (value: string): boolean => {
              const block: NetworkAddressBlock | null =
                NetworkAddressBlockUtil.parse(value);

              return !block || !findProtectionAmong({ block, protections });
            },
          );
          const withoutSkip: CloudflareZoneStatus = { ...zone };
          delete withoutSkip.skipAddresses;

          return kept.length > 0
            ? { ...withoutSkip, skipAddresses: kept }
            : withoutSkip;
        },
      ),
    };
  }

  public supports(entry: {
    indicatorType: SecurityBlockIndicatorType;
    action: SecurityBlockAction;
    value: string;
  }): SecurityBlockSupport {
    if (
      entry.indicatorType !== SecurityBlockIndicatorType.IpAddress &&
      entry.indicatorType !== SecurityBlockIndicatorType.IpRange
    ) {
      return {
        isSupported: false,
        reason: "Cloudflare blocks IP addresses and ranges only",
      };
    }

    const action: CloudflareActionStatus | null = getCloudflareActionStatus(
      this.status,
      entry.action,
    );

    if (!action) {
      return {
        isSupported: false,
        reason: "blocking at Cloudflare is not set up yet",
      };
    }

    if (!action.isInPlace) {
      return {
        isSupported: false,
        reason: `${CLOUDFLARE_BLOCK_LIST_NAMES[entry.action]} was deleted in Cloudflare: select Put It Back on the Cloudflare connection`,
      };
    }

    const problem: string | null =
      action.choice.mechanism === CloudflareBlockingMechanism.AccessRules
        ? getCloudflareAccessRuleValueProblem(entry.value)
        : getCloudflareListValueProblem(entry.value);

    return problem
      ? { isSupported: false, reason: problem }
      : { isSupported: true };
  }

  public async capacity(): Promise<SecurityBlockCapacity> {
    const limit: number | null = this.status?.usage.limit ?? null;

    if (limit === null) {
      return { limit: null };
    }

    const usesAccessRules: boolean = Boolean(
      this.status?.actions.some((action: CloudflareActionStatus): boolean => {
        return (
          action.choice.mechanism === CloudflareBlockingMechanism.AccessRules
        );
      }),
    );

    const planItems: number = this.status
      ? CLOUDFLARE_PLAN_LIMITS[this.status.plan].listItems
      : limit;

    return {
      limit,
      fullReason: usesAccessRules
        ? `Cloudflare's IP Access Rules are full (${limit.toLocaleString("en-US")})`
        : `Cloudflare's lists are full: your plan holds ${planItems.toLocaleString("en-US")} list items, and your own lists use ${(planItems - limit).toLocaleString("en-US")}`,
    };
  }

  public async apply(
    entries: Array<SecurityBlockEntry>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    return await this.ready().add(entries, this.status!);
  }

  public async remove(
    items: Array<SecurityBlockHeldItem>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    return await this.ready().remove(items, this.status!);
  }

  public async readBack(): Promise<Array<SecurityBlockHeldItem>> {
    const held: Array<SecurityBlockHeldItem> = await this.ready().readHeld(
      this.status!,
    );

    // How many OneUptime holds, for the connection's page: "1,204 of 10,000".
    if (this.status && this.status.usage.items !== held.length) {
      this.status = {
        ...this.status,
        usage: { ...this.status.usage, items: held.length },
      };
      await this.writeStatus();
    }

    return held;
  }

  // Everything OneUptime added for the project, taken away (CloudflareBlocking.tearDown).
  public async tearDown(
    budgetInMs: number,
  ): Promise<{ isDone: boolean; left: number; keptLists: Array<string> }> {
    if (!this.blocking) {
      throw new Error(
        this.broken || "The connection's settings cannot be used.",
      );
    }

    return await this.blocking.tearDown({
      previous: this.status,
      budgetInMs,
    });
  }

  private ready(): CloudflareBlocking {
    if (!this.blocking || !this.status) {
      throw new Error(
        this.broken || "Blocking at Cloudflare is not set up yet.",
      );
    }

    return this.blocking;
  }

  // The status on the connection, when it changed.
  private async writeStatus(): Promise<void> {
    const text: string = JSON.stringify(this.status || null);

    if (text === this.written) {
      return;
    }

    await writeBlockingStatus(
      this.connectionId,
      (this.status || null) as unknown as JSONObject | null,
    );
    this.written = text;
  }

  // A first setup that failed: no status to keep but what failed.
  private async writeFailure(error: string, now: Date): Promise<void> {
    await writeBlockingStatus(this.connectionId, {
      error,
      errorAt: now.toISOString(),
    });
  }
}

/*
 * The project's Cloudflare connections, read as OneUptime: their settings,
 * credentials and blocking. Blocking is read from its own column, never the
 * connection's polling switch, which only pauses polling.
 */
async function findCloudflareConnections(
  projectId: ObjectID,
): Promise<Array<SecurityEventConnection>> {
  return await SecurityEventConnectionService.findBy({
    query: {
      projectId,
      provider: SecurityEventConnectorProvider.Cloudflare,
    },
    select: CONNECTION_SELECT,
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: ROOT,
  });
}

export default class CloudflareBlockDestinations {
  private static options: CloudflareDestinationOptions = {};

  // For tests: how the destinations reach Cloudflare, and the clock and sleep they keep.
  public static setOptionsForTests(
    options: CloudflareDestinationOptions | null,
  ): void {
    this.options = options || {};
  }

  // How the blocking routes' checks reach Cloudflare: as the destinations do.
  public static getOptionsForChecks(): CloudflareDestinationOptions {
    return this.options;
  }

  // A destination per Cloudflare connection of the project with blocking on.
  public static async findForProject(
    projectId: ObjectID,
  ): Promise<Array<CloudflareBlockDestination>> {
    const connections: Array<SecurityEventConnection> = (
      await findCloudflareConnections(projectId)
    ).filter((connection: SecurityEventConnection): boolean => {
      return readCloudflareBlockingSettings(connection.blockingSettings)
        .isEnabled;
    });

    const destinations: Array<CloudflareBlockDestination> = [];

    for (const connection of connections) {
      destinations.push(
        new CloudflareBlockDestination({
          connectionId: connection.id!,
          projectId,
          // "Cloudflare", or with its connection's name when the project blocks through two.
          name:
            connections.length === 1
              ? "Cloudflare"
              : `Cloudflare (${(connection.name || "").slice(0, 60)})`,
          settings: readCloudflareBlockingSettings(connection.blockingSettings),
          status: readCloudflareBlockingStatus(connection.blockingStatus),
          failedAt: readCloudflareBlockingFailure(connection.blockingStatus)
            ?.errorAt,
          connectorSettings:
            await SecurityEventConnectionService.getConnectorSettings(
              connection,
            ),
          options: this.options,
        }),
      );
    }

    return destinations;
  }

  /*
   * The projects with a Cloudflare connection whose blocking is on, or was
   * turned off with its removal not done yet: one read, by the provider's
   * index. Each such project is reconciled every minute, which costs a read
   * of its rows when it has nothing to do.
   */
  public static async findProjectIdsWithWork(
    limit: number,
  ): Promise<Array<ObjectID>> {
    const rows: unknown =
      await SecurityEventConnectionService.getRepository().manager.query(
        `SELECT DISTINCT "projectId" FROM "SecurityEventConnection"
          WHERE "provider" = $1 AND "deletedAt" IS NULL
            AND (
              "blockingSettings"->>'isEnabled' = 'true'
              OR (
                "blockingSettings"->>'removalRequestedAt' IS NOT NULL
                AND (
                  "blockingStatus"->>'removalDoneFor' IS NULL
                  OR "blockingStatus"->>'removalDoneFor' < "blockingSettings"->>'removalRequestedAt'
                )
              )
            )
          ORDER BY "projectId"
          LIMIT $2`,
        [SecurityEventConnectorProvider.Cloudflare, limit],
      );

    return (Array.isArray(rows) ? rows : [])
      .map((row: unknown): string => {
        return String(
          (row && typeof row === "object"
            ? (row as Record<string, unknown>)["projectId"]
            : "") || "",
        );
      })
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });
  }

  /*
   * Takes away what OneUptime set up for each Cloudflare connection of the
   * project whose blocking was turned off with "remove" chosen, under the
   * account's lock, within CLOUDFLARE_REMOVAL_BUDGET_IN_MS: one with many
   * IP Access Rules goes on across passes. What failed is kept on the
   * connection, and tried again after CLOUDFLARE_BLOCKING_RETRY_IN_MS.
   */
  public static async settle(projectId: ObjectID, now: Date): Promise<void> {
    for (const connection of await findCloudflareConnections(projectId)) {
      const settings: CloudflareBlockingSettings =
        readCloudflareBlockingSettings(connection.blockingSettings);
      const status: CloudflareBlockingStatus | null =
        readCloudflareBlockingStatus(connection.blockingStatus);

      if (!isCloudflareBlockingRemovalPending(settings, status)) {
        continue;
      }

      const failedAt: number = timeOf(status?.errorAt);

      if (
        failedAt > timeOf(settings.removalRequestedAt) &&
        now.getTime() - failedAt < CLOUDFLARE_BLOCKING_RETRY_IN_MS
      ) {
        continue;
      }

      await this.removeFrom({ connection, projectId, settings, status, now });
    }
  }

  private static async removeFrom(data: {
    connection: SecurityEventConnection;
    projectId: ObjectID;
    settings: CloudflareBlockingSettings;
    status: CloudflareBlockingStatus | null;
    now: Date;
  }): Promise<void> {
    const destination: CloudflareBlockDestination =
      new CloudflareBlockDestination({
        connectionId: data.connection.id!,
        projectId: data.projectId,
        name: "Cloudflare",
        settings: data.settings,
        status: data.status,
        connectorSettings:
          await SecurityEventConnectionService.getConnectorSettings(
            data.connection,
          ),
        options: this.options,
      });

    let lock: SemaphoreMutex | null = null;

    try {
      lock = await Semaphore.lock({
        key: destination.lockKey,
        namespace: SECURITY_BLOCKLIST_LOCK_NAMESPACE,
        lockTimeout: 3 * 60 * 1000,
        acquireTimeout: 1000,
        acquireAttemptsLimit: 1,
        refreshInterval: 0,
      });
    } catch {
      // A pass holds the account: the removal waits for the next one.
      return;
    }

    let next: JSONObject;

    try {
      const removal: {
        isDone: boolean;
        left: number;
        keptLists: Array<string>;
      } = await destination.tearDown(CLOUDFLARE_REMOVAL_BUDGET_IN_MS);

      next = {
        ...((data.status || {}) as unknown as JSONObject),
        ...(removal.isDone
          ? {
              removalDoneFor: data.settings.removalRequestedAt || null,
              // Nothing of OneUptime's is left: a later turn-on chooses its mechanisms afresh.
              actions: [],
              zones: [],
              usage: { items: 0, limit: null },
              checkedAt: data.now.toISOString(),
            }
          : {}),
        removalLeft: removal.left,
        ...(removal.keptLists.length
          ? {
              error: `OneUptime left ${removal.keptLists.join(" and ")} in Cloudflare: someone added addresses to it there, which OneUptime did not add. Delete it in Cloudflare when you no longer need them.`,
              errorAt: data.now.toISOString(),
            }
          : { error: null, errorAt: null }),
      };
    } catch (error) {
      logger.warn(
        `CloudflareBlockDestinations: could not take OneUptime's lists and rules away from connection ${data.connection.id?.toString()}: ${errorText(error)}`,
      );
      next = {
        ...((data.status || {}) as unknown as JSONObject),
        error: `OneUptime could not take its lists and rules away from Cloudflare yet: ${errorText(error)}`,
        errorAt: data.now.toISOString(),
      };
    } finally {
      try {
        await Semaphore.release(lock);
      } catch {
        // It runs out by itself.
      }
    }

    await writeBlockingStatus(data.connection.id!, next);
  }
}

/*
 * The source the reconciler asks for Cloudflare destinations
 * (getSecurityBlockDestinationSources).
 */
export const CLOUDFLARE_BLOCK_DESTINATION_SOURCE: SecurityBlockDestinationSource =
  {
    provider: SecurityBlockDestinationProvider.Cloudflare,
    findForProject: (
      projectId: ObjectID,
    ): Promise<Array<SecurityBlockDestination>> => {
      return CloudflareBlockDestinations.findForProject(projectId);
    },
    findProjectIdsWithWork: (limit: number): Promise<Array<ObjectID>> => {
      return CloudflareBlockDestinations.findProjectIdsWithWork(limit);
    },
    settle: (projectId: ObjectID, now: Date): Promise<void> => {
      return CloudflareBlockDestinations.settle(projectId, now);
    },
  };
