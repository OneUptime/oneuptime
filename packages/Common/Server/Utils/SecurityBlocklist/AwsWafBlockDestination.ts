import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import SecurityBlockCloudWaf from "../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import CloudConnectionService from "../../Services/CloudConnectionService";
import SecurityBlockCloudWafService from "../../Services/SecurityBlockCloudWafService";
import QueryHelper from "../../Types/Database/QueryHelper";
import AwsWafBlocklistGroup, {
  AwsWafRuleState,
  AwsWafSetAddition,
  AwsWafSetWriteResult,
} from "../CloudConnection/Aws/AwsWafBlocklist";
import { AwsWafCallOptions } from "../CloudConnection/Aws/AwsWaf";
import { CloudConnectionSettings } from "../CloudConnection/CloudConnectorTypes";
import logger from "../Logger";
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
  AWS_WAF_IP_SET_MAX_ADDRESSES,
  AwsWafArn,
  AwsWafBlocklistSetSpec,
  getAwsWafAddressFamily,
  getAwsWafBlocklistSetFor,
  parseAwsWafArn,
  toAwsWafAddress,
} from "../../../Types/CloudConnection/AwsWafBlocklist";
import {
  WAF_BLOCKLIST_FIELD_KEY,
  doesCloudConnectionWafBlocklistAddRule,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import { getAwsExternalIdForProject } from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PartialEntity from "../../../Types/Database/PartialEntity";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
  SECURITY_BLOCK_CLOUD_WAF_MESSAGE_MAX_LENGTH,
  SecurityBlockClientAddress,
  SecurityBlockCloudWafStatus,
  isSecurityBlockClientAddress,
} from "../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";

/*
 * THE BLOCKLIST ENFORCED IN AN AWS WAF WEB ACL (#10344): one destination a
 * web ACL a project picked (SecurityBlockCloudWaf), named "AWS WAF
 * (prod-alb)", written through its AWS cloud connection.
 *
 *   readBack()  the web ACL read (GetWebACL): which of OneUptime's four IP
 *               sets its rules enforce, reading the client's address as it
 *               is set to; then each set read (GetIPSet). What an enforced
 *               set holds is held. A set no rule enforces holds nothing yet
 *               - for a web ACL whose rule OneUptime adds, its blocks are
 *               added again, which adds the rule back (drift); for one its
 *               team keeps in code, its entries are held but not in force
 *               (isPropagating): Pending, the web ACL waiting for its rule.
 *   update()    what a pass removes and adds, one read-change-write a set
 *               (AwsWafBlocklistGroup.changeSet: the lock token, the retry
 *               when it went stale, the set's 10,000); then, when OneUptime
 *               adds its rule, the rule placed or rewritten. A block written
 *               to the sets of a web ACL whose rule could not be placed is
 *               not applied there, and says why.
 *   capacity()  the IP sets' limit: 10,000 addresses each, one IP version
 *               and action a set. A full set answers each entry it could
 *               not take, so the oldest blocks keep their place.
 *
 * The web ACLs of one account, scope and Region share the sets, so they
 * share a lock key (one writer of a set) and a group (one sign-in and one
 * list a pass). Each read records where the web ACL stands on its row:
 * Enforcing, Waiting for your rule, No free priority or Failed - what the
 * Blocklist page shows beside it.
 */

// How stale a row's "checked" may get before a read that changed nothing writes it again.
export const AWS_WAF_STATUS_REFRESH_IN_MS: number = 5 * 60 * 1000;

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

// The client address a row is set to read: its own, else the source address.
export function readCloudWafClientAddress(
  row: Pick<SecurityBlockCloudWaf, "clientAddress">,
): SecurityBlockClientAddress {
  return isSecurityBlockClientAddress(row.clientAddress)
    ? row.clientAddress
    : SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS;
}

/*
 * What a row keeps of where its web ACL stands: the sets' ARNs and the
 * rules' names and priorities a team adds in code, and the metric whose
 * sampled requests are a block's evidence.
 */
export function getCloudWafRuleDetails(data: {
  state: AwsWafRuleState;
  group: AwsWafBlocklistGroup;
  addsRule: boolean;
}): JSONObject {
  return {
    addsRule: data.addsRule,
    ruleNames: {
      block: data.group.ruleNames.block,
      challenge: data.group.ruleNames.challenge,
    },
    setArns: { ...data.state.setArns },
    priorities: {
      block: data.state.priorities.block,
      challenge: data.state.priorities.challenge,
    },
    sampledMetricNames: { ...data.state.sampledMetricNames },
  };
}

/*
 * Writes where a web ACL stands on its row - when it changed, the last
 * check is more than AWS_WAF_STATUS_REFRESH_IN_MS old, or a person asked
 * (isForced) - and on the row the caller holds.
 */
export async function recordCloudWafState(data: {
  row: SecurityBlockCloudWaf;
  status: SecurityBlockCloudWafStatus;
  message: string;
  details: JSONObject;
  now: Date;
  isForced?: boolean | undefined;
}): Promise<void> {
  const { row } = data;
  const message: string = data.message.slice(
    0,
    SECURITY_BLOCK_CLOUD_WAF_MESSAGE_MAX_LENGTH,
  );
  const isChanged: boolean =
    row.status !== data.status ||
    (row.statusMessage || "") !== message ||
    JSON.stringify(row.ruleDetails || {}) !== JSON.stringify(data.details);
  const isStale: boolean =
    !row.checkedAt ||
    data.now.getTime() - new Date(row.checkedAt).getTime() >=
      AWS_WAF_STATUS_REFRESH_IN_MS;

  if ((!isChanged && !isStale && !data.isForced) || !row.id) {
    return;
  }

  await SecurityBlockCloudWafService.updateColumnsByIdWithoutHooks({
    id: row.id,
    data: {
      status: data.status,
      statusMessage: message || null,
      ruleDetails: data.details,
      checkedAt: data.now,
    } as unknown as PartialEntity<SecurityBlockCloudWaf>,
  });

  row.status = data.status;
  row.statusMessage = message;
  row.ruleDetails = data.details;
  row.checkedAt = data.now;
}

export interface AwsWafBlockDestinationData {
  row: SecurityBlockCloudWaf;
  webAcl: AwsWafArn;
  group: AwsWafBlocklistGroup;
  // Whether OneUptime adds its rule itself: the connection's "rule" choice.
  addsRule: boolean;
  lockKey: string;
  now?: (() => Date) | undefined;
}

export default class AwsWafBlockDestination
  implements SecurityBlockDestination
{
  public readonly key: string;
  public readonly lockKey: string;
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.AwsWaf;
  public readonly name: string;
  public readonly connectionId: ObjectID | null;

  private readonly data: AwsWafBlockDestinationData;

  public constructor(data: AwsWafBlockDestinationData) {
    this.data = data;
    this.key = AwsWafBlockDestination.getKey(data.row);
    this.lockKey = data.lockKey;
    this.name = `AWS WAF (${data.row.name || data.webAcl.name})`;
    this.connectionId = data.row.cloudConnectionId || null;
  }

  // A web ACL's destination key: the row's, so each pick has its own enforcement rows.
  public static getKey(row: Pick<SecurityBlockCloudWaf, "id">): string {
    return `AwsWaf:${row.id?.toString() || ""}`;
  }

  private now(): Date {
    return this.data.now ? this.data.now() : OneUptimeDate.getCurrentDate();
  }

  private get clientAddress(): SecurityBlockClientAddress {
    return readCloudWafClientAddress(this.data.row);
  }

  public supports(entry: {
    indicatorType: SecurityBlockIndicatorType;
    action: SecurityBlockAction;
    value: string;
  }): SecurityBlockSupport {
    if (!toAwsWafAddress(entry.value)) {
      return {
        isSupported: false,
        reason: "AWS WAF holds IPv4 and IPv6 addresses and ranges only",
      };
    }

    return { isSupported: true };
  }

  public async capacity(): Promise<SecurityBlockCapacity> {
    return {
      limit: AWS_WAF_IP_SET_MAX_ADDRESSES * this.data.group.specs.length,
      fullReason: `the AWS WAF IP sets are full (${AWS_WAF_IP_SET_MAX_ADDRESSES.toLocaleString("en-US")} addresses each)`,
    };
  }

  public async readBack(): Promise<Array<SecurityBlockHeldItem>> {
    const { group, webAcl, addsRule } = this.data;
    const state: AwsWafRuleState = await group.readRuleState({
      webAcl,
      clientAddress: this.clientAddress,
      addsRule,
    });

    /*
     * A web ACL whose rule OneUptime adds is said to stand where its next
     * write leaves it: a missing rule is put back by this pass.
     */
    if (!addsRule || state.status === SecurityBlockCloudWafStatus.Enforcing) {
      await this.record(state);
    }

    const held: Array<SecurityBlockHeldItem> = [];

    for (const spec of group.specs) {
      const set: Awaited<ReturnType<AwsWafBlocklistGroup["readSet"]>> =
        await group.readSet(spec.key);

      if (!set) {
        continue;
      }

      const isEnforced: boolean = state.enforcedSetKeys.includes(spec.key);

      // Added again, which puts OneUptime's rule back.
      if (!isEnforced && addsRule) {
        continue;
      }

      for (const value of AwsWafBlocklistGroup.valuesOf(set)) {
        held.push({
          value,
          action: spec.action,
          providerRef: spec.name,
          ...(isEnforced ? {} : { isPropagating: true }),
        });
      }
    }

    return held;
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
    const { group } = this.data;
    const bySet: Map<
      string,
      { add: Array<AwsWafSetAddition>; remove: Array<string> }
    > = new Map();
    const actionOfSet: Map<string, SecurityBlockAction> = new Map();
    let applied: Array<SecurityBlockWriteResult> = [];
    const removed: Array<SecurityBlockWriteResult> = [];

    const setOf: (
      value: string,
      action: SecurityBlockAction,
    ) => AwsWafBlocklistSetSpec | undefined = (
      value: string,
      action: SecurityBlockAction,
    ): AwsWafBlocklistSetSpec | undefined => {
      const family: 4 | 6 | null = getAwsWafAddressFamily(value);

      return family
        ? getAwsWafBlocklistSetFor(group.specs, action, family)
        : undefined;
    };

    const changeOf: (spec: AwsWafBlocklistSetSpec) => {
      add: Array<AwsWafSetAddition>;
      remove: Array<string>;
    } = (spec: AwsWafBlocklistSetSpec) => {
      const existing:
        | { add: Array<AwsWafSetAddition>; remove: Array<string> }
        | undefined = bySet.get(spec.key);

      if (existing) {
        return existing;
      }

      const created: { add: Array<AwsWafSetAddition>; remove: Array<string> } =
        { add: [], remove: [] };

      bySet.set(spec.key, created);
      actionOfSet.set(spec.key, spec.action);

      return created;
    };

    for (const item of changes.remove) {
      const spec: AwsWafBlocklistSetSpec | undefined = setOf(
        item.value,
        item.action,
      );

      if (!spec) {
        removed.push({
          value: item.value,
          action: item.action,
          isDone: true,
        });
        continue;
      }

      changeOf(spec).remove.push(item.value);
    }

    for (const entry of changes.add) {
      const spec: AwsWafBlocklistSetSpec | undefined = setOf(
        entry.value,
        entry.action,
      );
      const cidr: string | null = toAwsWafAddress(entry.value);

      if (!spec || !cidr) {
        applied.push({
          value: entry.value,
          action: entry.action,
          isDone: false,
          error: "AWS WAF holds IPv4 and IPv6 addresses and ranges only",
        });
        continue;
      }

      changeOf(spec).add.push({ value: entry.value, cidr });
    }

    // One write a set: its removals and its additions together.
    for (const [key, change] of bySet) {
      const action: SecurityBlockAction = actionOfSet.get(key)!;
      const spec: AwsWafBlocklistSetSpec = group.getSpec(key)!;
      const written: {
        added: Array<AwsWafSetWriteResult>;
        removed: Array<AwsWafSetWriteResult>;
      } = await group.changeSet(key, change);
      const toResult: (
        result: AwsWafSetWriteResult,
      ) => SecurityBlockWriteResult = (
        result: AwsWafSetWriteResult,
      ): SecurityBlockWriteResult => {
        return {
          value: result.value,
          action,
          isDone: result.isDone,
          ...(result.isDone ? { providerRef: spec.name } : {}),
          ...(result.error ? { error: result.error } : {}),
        };
      };

      applied.push(...written.added.map(toResult));
      removed.push(...written.removed.map(toResult));
    }

    const isAnyAdded: boolean = applied.some(
      (result: SecurityBlockWriteResult): boolean => {
        return result.isDone;
      },
    );

    /*
     * A web ACL kept in code: all four sets made, so the rule its team adds
     * - which references each - can be written, with every ARN, before a
     * block of each kind exists.
     */
    if (!this.data.addsRule && isAnyAdded) {
      try {
        await group.ensureSets();
      } catch (error) {
        logger.warn(
          `AwsWafBlockDestination: could not make every IP set of ${this.name}. ${errorText(error)}`,
        );
      }
    }

    // OneUptime's rule, when it adds it, once something was added to the sets.
    if (this.data.addsRule && isAnyAdded) {
      let state: AwsWafRuleState;

      try {
        state = await group.ensureRules({
          webAcl: this.data.webAcl,
          clientAddress: this.clientAddress,
        });
      } catch (error) {
        state = {
          status: SecurityBlockCloudWafStatus.Failed,
          message: `OneUptime could not add its rules to ${this.data.webAcl.name}: ${errorText(error)}`,
          enforcedSetKeys: [],
          priorities: { block: null, challenge: null },
          setArns: {},
          sampledMetricNames: {},
        };
      }

      await this.record(state);

      if (state.status !== SecurityBlockCloudWafStatus.Enforcing) {
        // In the sets, which this web ACL's rules do not block: not applied here.
        applied = applied.map(
          (result: SecurityBlockWriteResult): SecurityBlockWriteResult => {
            return result.isDone
              ? {
                  value: result.value,
                  action: result.action,
                  isDone: false,
                  error: state.message,
                }
              : result;
          },
        );
      }
    }

    return { applied, removed };
  }

  private async record(state: AwsWafRuleState): Promise<void> {
    try {
      await recordCloudWafState({
        row: this.data.row,
        status: state.status,
        message: state.message,
        details: getCloudWafRuleDetails({
          state,
          group: this.data.group,
          addsRule: this.data.addsRule,
        }),
        now: this.now(),
      });
    } catch (error) {
      // Where the web ACL stands is the page's: the blocks' own rows are what count.
      logger.warn(
        `AwsWafBlockDestination: could not record where ${this.name} stands. ${errorText(error)}`,
      );
    }
  }
}

/*
 * Every web ACL the project picked, a destination each, with the web ACLs
 * of one account, scope and Region sharing a group. A row whose connection
 * is gone - it goes with it - or whose web ACL OneUptime cannot read is
 * left out, and said in the log.
 */
export class AwsWafBlockDestinationSource
  implements SecurityBlockDestinationSource
{
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.AwsWaf;

  // For tests: how the groups call AWS (a fake transport, a clock, no waiting).
  private static callOptions: AwsWafCallOptions | undefined = undefined;
  private static now: (() => Date) | undefined = undefined;

  public static setCallOptionsForTests(
    options: AwsWafCallOptions | undefined,
  ): void {
    this.callOptions = options;
    this.now = options?.now;
  }

  public static getCallOptions(): AwsWafCallOptions | undefined {
    return this.callOptions;
  }

  public async findForProject(
    projectId: ObjectID,
  ): Promise<Array<SecurityBlockDestination>> {
    const rows: Array<SecurityBlockCloudWaf> = (
      await SecurityBlockCloudWafService.findForProject(projectId)
    ).filter((row: SecurityBlockCloudWaf): boolean => {
      return row.cloudProvider === CloudProvider.AWS;
    });

    if (rows.length === 0) {
      return [];
    }

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
    const connections: Array<CloudConnection> =
      await CloudConnectionService.findBy({
        query: {
          projectId,
          _id: QueryHelper.any(connectionIds),
        },
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
    const externalId: string = getAwsExternalIdForProject(projectId.toString());
    const groups: Map<string, AwsWafBlocklistGroup> = new Map();
    const destinations: Array<SecurityBlockDestination> = [];

    for (const row of rows) {
      const connection: CloudConnection | undefined = connections.find(
        (candidate: CloudConnection): boolean => {
          return (
            candidate.id?.toString() === row.cloudConnectionId?.toString()
          );
        },
      );
      const webAcl: AwsWafArn | null = parseAwsWafArn(row.wafId);

      if (!connection?.id || !webAcl || webAcl.resourceType !== "webacl") {
        logger.warn(
          `AwsWafBlockDestinationSource: web ACL ${row.id?.toString() || ""} of project ${projectId.toString()} has no connection or no ARN OneUptime reads; it enforces nothing until it is picked again.`,
        );
        continue;
      }

      const lockKey: string = AwsWafBlocklistGroup.getLockKey({
        projectId: projectId.toString(),
        accountId: webAcl.accountId,
        region: webAcl.region,
        scope: webAcl.scope,
      });
      const groupKey: string = `${connection.id.toString()}|${lockKey}`;
      let group: AwsWafBlocklistGroup | undefined = groups.get(groupKey);

      if (!group) {
        const settings: CloudConnectionSettings =
          await CloudConnectionService.getConnectorSettings(connection);

        group = new AwsWafBlocklistGroup({
          settings,
          connectionId: connection.id,
          externalId,
          accountId: webAcl.accountId,
          region: webAcl.region,
          scope: webAcl.scope,
          options: AwsWafBlockDestinationSource.callOptions,
        });
        groups.set(groupKey, group);
      }

      destinations.push(
        new AwsWafBlockDestination({
          row,
          webAcl,
          group,
          addsRule: doesCloudConnectionWafBlocklistAddRule(
            (connection.config || {})[WAF_BLOCKLIST_FIELD_KEY],
          ),
          lockKey,
          now: AwsWafBlockDestinationSource.now,
        }),
      );
    }

    return destinations;
  }
}
