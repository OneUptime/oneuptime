import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import SecurityBlockCloudWaf from "../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import CloudConnectionService from "../../Services/CloudConnectionService";
import SecurityBlockCloudWafService from "../../Services/SecurityBlockCloudWafService";
import QueryHelper from "../../Types/Database/QueryHelper";
import AzureArm from "../CloudConnection/Azure/AzureArm";
import AzureCloudConnector from "../CloudConnection/Azure/AzureCloudConnector";
import AzureWafPolicyBlocklist, {
  AzureWafHeld,
  AzureWafState,
  AzureWafWriteResult,
} from "../CloudConnection/Azure/AzureWafBlocklist";
import {
  CloudConnectionSettings,
  CloudConnectorCallOptions,
} from "../CloudConnection/CloudConnectorTypes";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import logger from "../Logger";
import {
  readCloudWafClientAddress,
  recordCloudWafState,
} from "./AwsWafBlockDestination";
import SecurityBlockDestination, {
  SecurityBlockCapacity,
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockSupport,
  SecurityBlockWriteResult,
} from "./SecurityBlockDestination";
import { SecurityBlockDestinationSource } from "./SecurityBlockDestinations";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AzureWafPolicyKind,
  AzureWafPolicyRef,
  getAzureWafDestinationName,
  parseAzureWafPolicyId,
  readAzureWafRuleDetails,
  toAzureWafAddress,
  toAzureWafRuleDetailsJson,
} from "../../../Types/CloudConnection/AzureWafBlocklist";
import { getCloudWafProjectSuffix } from "../../../Types/CloudConnection/CloudWafRuleSlots";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  CLOUD_WAF_REASONS,
  cloudWafReason,
} from "../../../Types/SecurityBlocklist/CloudWafReasons";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  SecurityBlockReason,
  fillSecurityBlockReason,
} from "../../../Types/SecurityBlocklist/SecurityBlockReason";

/*
 * THE BLOCKLIST ENFORCED IN AN AZURE WAF POLICY (#10348): one destination
 * an Application Gateway or Front Door WAF policy a project picked
 * (SecurityBlockCloudWaf), named "Azure WAF (prod-waf)", written through its
 * Azure cloud connection's app.
 *
 *   prepare()   OneUptime's rules written again when the person changed
 *               where the policy reads the client's address.
 *   readBack()  the policy read: what OneUptime's rules hold, in force,
 *               Pending while Azure applies the policy (Front Door's
 *               provisioning), or not in force and why - a rule turned off,
 *               changed or deleted by hand, a policy turned off, in
 *               Detection mode or attached to nothing.
 *   update()    what a pass removes and adds, in one write of the policy
 *               (AzureWafPolicyBlocklist.change: the ETag, the retry on 412).
 *   capacity()  the addresses OneUptime's rules hold and may still hold
 *               here: its ten rules' share of the policy's hundred.
 *
 * Azure WAF cannot challenge (Front Door Premium's JavaScript challenge is
 * not held here yet): a person's challenge is not applied, with why; an
 * automatic response policy's challenge reaches it as a block (#10350).
 * Application Gateway matches IPv4 only.
 */

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

export interface AzureWafBlockDestinationData {
  row: SecurityBlockCloudWaf;
  policy: AzureWafPolicyRef;
  keeper: AzureWafPolicyBlocklist;
  now?: (() => Date) | undefined;
}

export default class AzureWafBlockDestination
  implements SecurityBlockDestination
{
  public readonly key: string;
  public readonly lockKey: string;
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.AzureWaf;
  public readonly name: string;
  public readonly connectionId: ObjectID | null;
  // Azure WAF blocks only (#10350): a challenge is refused, with why.
  public readonly canChallenge: boolean = false;

  private readonly data: AzureWafBlockDestinationData;
  // The state the last read found, for capacity() and readBack() of one pass.
  private state: AzureWafState | null = null;

  public constructor(data: AzureWafBlockDestinationData) {
    this.data = data;
    this.key = AzureWafBlockDestination.getKey(data.row);
    this.lockKey = AzureWafBlockDestination.getLockKey({
      projectId: data.row.projectId?.toString() || "",
      policy: data.policy,
    });
    this.name = getAzureWafDestinationName(data.row.name || data.policy.name);
    this.connectionId = data.row.cloudConnectionId || null;
  }

  // A policy's destination key: the row's, so each pick has its own enforcement rows.
  public static getKey(row: Pick<SecurityBlockCloudWaf, "id">): string {
    return `AzureWaf:${row.id?.toString() || ""}`;
  }

  // One writer of a policy at a time: a pass, a Check Again, a Put It Back, a Remove.
  public static getLockKey(data: {
    projectId: string;
    policy: AzureWafPolicyRef;
  }): string {
    return `AzureWaf:${data.projectId}:${data.policy.id.toLowerCase()}`;
  }

  private now(): Date {
    return this.data.now ? this.data.now() : OneUptimeDate.getCurrentDate();
  }

  public async prepare(): Promise<void> {
    await this.data.keeper.rewriteIfNeeded();
  }

  public supports(entry: {
    indicatorType: SecurityBlockIndicatorType;
    action: SecurityBlockAction;
    value: string;
  }): SecurityBlockSupport {
    const reason: SecurityBlockReason | null = this.whyNot(entry);

    return reason
      ? {
          isSupported: false,
          reason: fillSecurityBlockReason(reason),
          reasonSentence: reason,
        }
      : { isSupported: true };
  }

  private whyNot(entry: {
    action: SecurityBlockAction;
    value: string;
  }): SecurityBlockReason | null {
    if (entry.action === SecurityBlockAction.Challenge) {
      return cloudWafReason(CLOUD_WAF_REASONS.cannotChallenge, {
        product: "Azure WAF",
      });
    }

    if (!toAzureWafAddress(AzureWafPolicyKind.FrontDoor, entry.value)) {
      return cloudWafReason(CLOUD_WAF_REASONS.notAnAddress, {
        product: "Azure WAF",
      });
    }

    if (!toAzureWafAddress(this.data.policy.kind, entry.value)) {
      return cloudWafReason(CLOUD_WAF_REASONS.ipv4Only, { value: entry.value });
    }

    return null;
  }

  private async readState(force: boolean): Promise<AzureWafState> {
    if (!this.state || force) {
      this.state = await this.data.keeper.readState(force);
    }

    return this.state;
  }

  public async capacity(): Promise<SecurityBlockCapacity> {
    const state: AzureWafState = await this.readState(false);

    return {
      limit: state.capacity,
      fullReason: fillSecurityBlockReason(state.fullReason),
      fullSentence: state.fullReason,
    };
  }

  public async readBack(): Promise<Array<SecurityBlockHeldItem>> {
    // The pass's first read is capacity()'s; after a write, a fresh one.
    const state: AzureWafState = await this.readState(this.state === null);

    this.state = null;
    await this.record(state);

    return state.held.map((item: AzureWafHeld): SecurityBlockHeldItem => {
      return {
        value: item.value,
        action: SecurityBlockAction.Block,
        providerRef: item.rule,
        ...(item.isPropagating ? { isPropagating: true } : {}),
        ...(item.notInForce
          ? {
              notInForceReason: fillSecurityBlockReason(item.notInForce),
              notInForceSentence: item.notInForce,
            }
          : {}),
      };
    });
  }

  public async apply(
    entries: Array<SecurityBlockEntry>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    return (await this.update({ add: entries, remove: [] })).applied;
  }

  public async remove(
    items: Array<SecurityBlockHeldItem>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    return (await this.update({ add: [], remove: items })).removed;
  }

  public async update(changes: {
    add: Array<SecurityBlockEntry>;
    remove: Array<SecurityBlockHeldItem>;
  }): Promise<{
    applied: Array<SecurityBlockWriteResult>;
    removed: Array<SecurityBlockWriteResult>;
  }> {
    const refused: Array<SecurityBlockWriteResult> = [];
    const add: Array<string> = [];

    for (const entry of changes.add) {
      const reason: SecurityBlockReason | null = this.whyNot(entry);

      if (reason) {
        refused.push({
          value: entry.value,
          action: entry.action,
          isDone: false,
          error: fillSecurityBlockReason(reason),
          errorSentence: reason,
        });
      } else {
        add.push(entry.value);
      }
    }

    const written: {
      added: Array<AzureWafWriteResult>;
      removed: Array<AzureWafWriteResult>;
    } = await this.data.keeper.change({
      add,
      remove: changes.remove.map((item: SecurityBlockHeldItem): string => {
        return item.value;
      }),
    });

    this.state = null;

    const toResult: (
      result: AzureWafWriteResult,
    ) => SecurityBlockWriteResult = (
      result: AzureWafWriteResult,
    ): SecurityBlockWriteResult => {
      return {
        value: result.value,
        action: SecurityBlockAction.Block,
        isDone: result.isDone,
        ...(result.rule ? { providerRef: result.rule } : {}),
        ...(result.reason
          ? {
              error: fillSecurityBlockReason(result.reason),
              errorSentence: result.reason,
            }
          : {}),
      };
    };

    return {
      applied: [...written.added.map(toResult), ...refused],
      removed: written.removed.map(toResult),
    };
  }

  // Where the policy stands, on its row: the page's, and kept as OneUptime last wrote it.
  private async record(state: AzureWafState): Promise<void> {
    try {
      await recordAzureWafState({
        row: this.data.row,
        state,
        now: this.now(),
      });
    } catch (error) {
      logger.warn(
        `AzureWafBlockDestination: could not record where ${this.name} stands. ${errorText(error)}`,
      );
    }
  }
}

// A policy's state written on its row: its status, why in both forms, and OneUptime's record of its rules.
export async function recordAzureWafState(data: {
  row: SecurityBlockCloudWaf;
  state: AzureWafState;
  now: Date;
  isForced?: boolean | undefined;
}): Promise<void> {
  await recordCloudWafState({
    row: data.row,
    status: data.state.status,
    message: data.state.reason
      ? fillSecurityBlockReason(data.state.reason)
      : "",
    reason: data.state.reason,
    details: toAzureWafRuleDetailsJson(data.state.details),
    now: data.now,
    isForced: data.isForced,
  });
}

// For tests: how the keepers call Azure (a fake transport, a clock, no waiting).
export interface AzureWafCallOptions {
  transport: CloudConnectorCallOptions["transport"];
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  now?: (() => Date) | undefined;
}

let callOptions: AzureWafCallOptions | undefined = undefined;

export function setAzureWafCallOptionsForTests(
  options: AzureWafCallOptions | undefined,
): void {
  callOptions = options;
}

// The keeper of a row's policy, signed in as its connection's app.
export function buildAzureWafKeeper(data: {
  row: SecurityBlockCloudWaf;
  policy: AzureWafPolicyRef;
  settings: CloudConnectionSettings;
}): AzureWafPolicyBlocklist {
  const options: CloudConnectorCallOptions = {
    transport:
      callOptions?.transport ||
      DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
    ...(callOptions?.sleep ? { sleep: callOptions.sleep } : {}),
  };
  const arm: AzureArm = new AzureCloudConnector().arm(data.settings, options);

  return new AzureWafPolicyBlocklist({
    arm,
    policy: data.policy,
    displayName: data.row.name || data.policy.name,
    projectSuffix: getCloudWafProjectSuffix(data.row.projectId!.toString()),
    clientAddress: readCloudWafClientAddress(data.row),
    details: readAzureWafRuleDetails(data.row.ruleDetails),
  });
}

/*
 * Every Azure WAF policy the project picked, a destination each. A row
 * whose connection is gone - it goes with it - or whose id OneUptime cannot
 * read is left out, and said in the log.
 */
export class AzureWafBlockDestinationSource
  implements SecurityBlockDestinationSource
{
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.AzureWaf;

  public async findForProject(
    projectId: ObjectID,
  ): Promise<Array<SecurityBlockDestination>> {
    const rows: Array<SecurityBlockCloudWaf> = (
      await SecurityBlockCloudWafService.findForProject(projectId)
    ).filter((row: SecurityBlockCloudWaf): boolean => {
      return row.cloudProvider === CloudProvider.Azure;
    });

    if (rows.length === 0) {
      return [];
    }

    const connections: Array<CloudConnection> = await findRowConnections(
      projectId,
      rows,
    );
    const destinations: Array<SecurityBlockDestination> = [];

    for (const row of rows) {
      const connection: CloudConnection | undefined = connections.find(
        (candidate: CloudConnection): boolean => {
          return candidate.id?.toString() === row.cloudConnectionId?.toString();
        },
      );
      const policy: AzureWafPolicyRef | null = parseAzureWafPolicyId(row.wafId);

      if (!connection?.id || !policy) {
        logger.warn(
          `AzureWafBlockDestinationSource: WAF policy ${row.id?.toString() || ""} of project ${projectId.toString()} has no connection or no id OneUptime reads; it enforces nothing until it is picked again.`,
        );
        continue;
      }

      const settings: CloudConnectionSettings =
        await CloudConnectionService.getConnectorSettings(connection);

      destinations.push(
        new AzureWafBlockDestination({
          row,
          policy,
          keeper: buildAzureWafKeeper({ row, policy, settings }),
          now: callOptions?.now,
        }),
      );
    }

    return destinations;
  }
}

// The connections the rows are written through, read once for all of them.
export async function findRowConnections(
  projectId: ObjectID,
  rows: Array<SecurityBlockCloudWaf>,
): Promise<Array<CloudConnection>> {
  const connectionIds: Array<ObjectID> = Array.from(
    new Map(
      rows
        .filter((row: SecurityBlockCloudWaf): boolean => {
          return Boolean(row.cloudConnectionId);
        })
        .map((row: SecurityBlockCloudWaf): [string, ObjectID] => {
          return [row.cloudConnectionId!.toString(), row.cloudConnectionId!];
        }),
    ).values(),
  );

  if (connectionIds.length === 0) {
    return [];
  }

  return await CloudConnectionService.findBy({
    query: { projectId, _id: QueryHelper.any(connectionIds) },
    select: {
      _id: true,
      projectId: true,
      provider: true,
      config: true,
      secrets: true,
    },
    skip: 0,
    limit: connectionIds.length,
    props: { isRoot: true },
  });
}
