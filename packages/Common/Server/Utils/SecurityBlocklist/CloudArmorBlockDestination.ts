import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import SecurityBlockCloudWaf from "../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import CloudConnectionService from "../../Services/CloudConnectionService";
import SecurityBlockCloudWafService from "../../Services/SecurityBlockCloudWafService";
import CloudArmorApi from "../CloudConnection/Gcp/CloudArmorApi";
import CloudArmorPolicyBlocklist, {
  CloudArmorHeld,
  CloudArmorState,
  CloudArmorWriteResult,
} from "../CloudConnection/Gcp/CloudArmorBlocklist";
import {
  CloudConnectionSettings,
  CloudConnectorCallOptions,
  readCloudSetting,
} from "../CloudConnection/CloudConnectorTypes";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import logger from "../Logger";
import { findRowConnections } from "./AzureWafBlockDestination";
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
  CloudArmorPolicyRef,
  getCloudArmorDestinationName,
  parseCloudArmorPolicyId,
  readCloudArmorRuleDetails,
  toCloudArmorRange,
  toCloudArmorRuleDetailsJson,
} from "../../../Types/CloudConnection/CloudArmorBlocklist";
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
 * THE BLOCKLIST ENFORCED IN A GOOGLE CLOUD ARMOR SECURITY POLICY (#10349):
 * one destination a policy a project picked (SecurityBlockCloudWaf), named
 * "Cloud Armor (prod-lb)", written through its Google Cloud connection's
 * service account.
 *
 *   prepare()   the policy set up the first time - address groups or rules
 *               (CloudArmorPolicyBlocklist.setUp) - and OneUptime's rules
 *               written again when the person changed where it reads the
 *               client's address.
 *   readBack()  what OneUptime's rules or groups hold, in force or not and
 *               why: a rule set to preview, changed or deleted by hand, a
 *               group deleted by hand.
 *   update()    what a pass removes and adds: one rule method a rule that
 *               changes, or one addItems and removeItems a group.
 *   capacity()  the groups' capacity, or OneUptime's twenty rules of ten.
 *
 * The policies of one Google Cloud project share its address groups, so
 * they share a lock key: one writer of the groups at a time. Cloud Armor
 * denies only: a person's challenge is not applied, with why; an automatic
 * response policy's challenge reaches it as a block (#10350).
 */

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

export interface CloudArmorBlockDestinationData {
  row: SecurityBlockCloudWaf;
  policy: CloudArmorPolicyRef;
  keeper: CloudArmorPolicyBlocklist;
  now?: (() => Date) | undefined;
}

export default class CloudArmorBlockDestination
  implements SecurityBlockDestination
{
  public readonly key: string;
  public readonly lockKey: string;
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.CloudArmor;
  public readonly name: string;
  public readonly connectionId: ObjectID | null;
  // Cloud Armor denies only (#10350): a challenge is refused, with why.
  public readonly canChallenge: boolean = false;

  private readonly data: CloudArmorBlockDestinationData;
  private state: CloudArmorState | null = null;

  public constructor(data: CloudArmorBlockDestinationData) {
    this.data = data;
    this.key = CloudArmorBlockDestination.getKey(data.row);
    this.lockKey = CloudArmorBlockDestination.getLockKey({
      projectId: data.row.projectId?.toString() || "",
      policy: data.policy,
    });
    this.name = getCloudArmorDestinationName(data.row.name || data.policy.name);
    this.connectionId = data.row.cloudConnectionId || null;
  }

  public static getKey(row: Pick<SecurityBlockCloudWaf, "id">): string {
    return `CloudArmor:${row.id?.toString() || ""}`;
  }

  // Every policy of a Google Cloud project shares the lock: they share its address groups.
  public static getLockKey(data: {
    projectId: string;
    policy: CloudArmorPolicyRef;
  }): string {
    return `CloudArmor:${data.projectId}:${data.policy.project}`;
  }

  private now(): Date {
    return this.data.now ? this.data.now() : OneUptimeDate.getCurrentDate();
  }

  public async prepare(): Promise<void> {
    if (!readCloudArmorRuleDetails(this.data.row.ruleDetails)) {
      const state: CloudArmorState = await this.data.keeper.setUp();

      this.state = state;
      await this.record(state);
      return;
    }

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
        product: "Cloud Armor",
      });
    }

    if (!toCloudArmorRange(entry.value)) {
      return cloudWafReason(CLOUD_WAF_REASONS.notAnAddress, {
        product: "Cloud Armor",
      });
    }

    return null;
  }

  private async readState(force: boolean): Promise<CloudArmorState> {
    if (!this.state || force) {
      this.state = await this.data.keeper.readState(force);
    }

    return this.state;
  }

  public async capacity(): Promise<SecurityBlockCapacity> {
    const state: CloudArmorState = await this.readState(false);

    return {
      limit: state.capacity,
      fullReason: fillSecurityBlockReason(state.fullReason),
      fullSentence: state.fullReason,
    };
  }

  public async readBack(): Promise<Array<SecurityBlockHeldItem>> {
    const state: CloudArmorState = await this.readState(this.state === null);

    this.state = null;
    await this.record(state);

    return state.held.map((item: CloudArmorHeld): SecurityBlockHeldItem => {
      return {
        value: item.value,
        action: SecurityBlockAction.Block,
        providerRef: item.holder,
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
      added: Array<CloudArmorWriteResult>;
      removed: Array<CloudArmorWriteResult>;
    } = await this.data.keeper.change({
      add,
      remove: changes.remove.map((item: SecurityBlockHeldItem): string => {
        return item.value;
      }),
    });

    this.state = null;

    const toResult: (
      result: CloudArmorWriteResult,
    ) => SecurityBlockWriteResult = (
      result: CloudArmorWriteResult,
    ): SecurityBlockWriteResult => {
      return {
        value: result.value,
        action: SecurityBlockAction.Block,
        isDone: result.isDone,
        ...(result.holder ? { providerRef: result.holder } : {}),
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

  private async record(state: CloudArmorState): Promise<void> {
    try {
      await recordCloudArmorState({
        row: this.data.row,
        state,
        now: this.now(),
      });
    } catch (error) {
      logger.warn(
        `CloudArmorBlockDestination: could not record where ${this.name} stands. ${errorText(error)}`,
      );
    }
  }
}

// A policy's state written on its row: its status, why in both forms, and OneUptime's record of its rules.
export async function recordCloudArmorState(data: {
  row: SecurityBlockCloudWaf;
  state: CloudArmorState;
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
    details: toCloudArmorRuleDetailsJson(data.state.details),
    now: data.now,
    isForced: data.isForced,
  });
}

// For tests: how the keepers call Google Cloud (a fake transport, a clock, no waiting).
export interface CloudArmorCallOptions {
  transport: CloudConnectorCallOptions["transport"];
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  now?: (() => Date) | undefined;
}

let callOptions: CloudArmorCallOptions | undefined = undefined;

export function setCloudArmorCallOptionsForTests(
  options: CloudArmorCallOptions | undefined,
): void {
  callOptions = options;
}

// The keeper of a row's policy, signed in as its connection's service account.
export function buildCloudArmorKeeper(data: {
  row: SecurityBlockCloudWaf;
  policy: CloudArmorPolicyRef;
  settings: CloudConnectionSettings;
}): CloudArmorPolicyBlocklist {
  return new CloudArmorPolicyBlocklist({
    api: new CloudArmorApi({
      serviceAccountJson: readCloudSetting(
        data.settings.secrets,
        "serviceAccountJson",
      ),
      transport:
        callOptions?.transport ||
        DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
      sleep: callOptions?.sleep,
      now: callOptions?.now,
    }),
    policy: data.policy,
    displayName: data.row.name || data.policy.name,
    projectSuffix: getCloudWafProjectSuffix(data.row.projectId!.toString()),
    clientAddress: readCloudWafClientAddress(data.row),
    details: readCloudArmorRuleDetails(data.row.ruleDetails),
  });
}

/*
 * Every Cloud Armor policy the project picked, a destination each. A row
 * whose connection is gone or whose name OneUptime cannot read is left
 * out, and said in the log.
 */
export class CloudArmorBlockDestinationSource
  implements SecurityBlockDestinationSource
{
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.CloudArmor;

  public async findForProject(
    projectId: ObjectID,
  ): Promise<Array<SecurityBlockDestination>> {
    const rows: Array<SecurityBlockCloudWaf> = (
      await SecurityBlockCloudWafService.findForProject(projectId)
    ).filter((row: SecurityBlockCloudWaf): boolean => {
      return row.cloudProvider === CloudProvider.GCP;
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
      const policy: CloudArmorPolicyRef | null = parseCloudArmorPolicyId(
        row.wafId,
      );

      if (!connection?.id || !policy) {
        logger.warn(
          `CloudArmorBlockDestinationSource: security policy ${row.id?.toString() || ""} of project ${projectId.toString()} has no connection or no name OneUptime reads; it enforces nothing until it is picked again.`,
        );
        continue;
      }

      const settings: CloudConnectionSettings =
        await CloudConnectionService.getConnectorSettings(connection);

      destinations.push(
        new CloudArmorBlockDestination({
          row,
          policy,
          keeper: buildCloudArmorKeeper({ row, policy, settings }),
          now: callOptions?.now,
        }),
      );
    }

    return destinations;
  }
}
