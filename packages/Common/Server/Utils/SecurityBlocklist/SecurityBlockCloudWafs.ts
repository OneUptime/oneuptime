import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import SecurityBlockCloudWaf from "../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import CloudConnectionService from "../../Services/CloudConnectionService";
import CloudResourceService from "../../Services/CloudResourceService";
import SecurityBlockCloudWafService from "../../Services/SecurityBlockCloudWafService";
import SecurityBlockEnforcementService from "../../Services/SecurityBlockEnforcementService";
import AwsWafBlocklistGroup, {
  AwsWafRuleState,
} from "../CloudConnection/Aws/AwsWafBlocklist";
import AzureWafPolicyBlocklist, {
  AzureWafState,
} from "../CloudConnection/Azure/AzureWafBlocklist";
import {
  CloudConnectionSettings,
  readCloudSetting,
} from "../CloudConnection/CloudConnectorTypes";
import CloudArmorPolicyBlocklist, {
  CloudArmorState,
} from "../CloudConnection/Gcp/CloudArmorBlocklist";
import GcpCloudConnector from "../CloudConnection/Gcp/GcpCloudConnector";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import {
  AwsWafBlockDestinationSource,
  getCloudWafRuleDetails,
  readCloudWafClientAddress,
  recordCloudWafState,
} from "./AwsWafBlockDestination";
import AzureWafBlockDestination, {
  buildAzureWafKeeper,
  recordAzureWafState,
} from "./AzureWafBlockDestination";
import CloudArmorBlockDestination, {
  buildCloudArmorKeeper,
  recordCloudArmorState,
} from "./CloudArmorBlockDestination";
import {
  SECURITY_BLOCKLIST_LOCK_NAMESPACE,
  SECURITY_BLOCKLIST_LOCK_TIMEOUT_IN_MS,
} from "./SecurityBlocklistReconciler";
import SecurityBlocklistJobs from "./SecurityBlocklistJobs";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AwsWafArn,
  getAwsWafBlocklistRuleNames,
  getAwsWafBlocklistSets,
  parseAwsWafArn,
} from "../../../Types/CloudConnection/AwsWafBlocklist";
import {
  AzureWafPolicyRef,
  AzureWafRecordedRule,
  getAzureWafPolicyAccessCommand,
  parseAzureWafPolicyId,
  readAzureWafRuleDetails,
} from "../../../Types/CloudConnection/AzureWafBlocklist";
import {
  CloudArmorBlocklistMode,
  CloudArmorPolicyRef,
  CloudArmorRecordedRule,
  CloudArmorRuleDetails,
  getCloudArmorAddressGroupNames,
  getCloudArmorPolicyAccessCommand,
  parseCloudArmorPolicyId,
  readCloudArmorRuleDetails,
} from "../../../Types/CloudConnection/CloudArmorBlocklist";
import {
  WAF_BLOCKLIST_FIELD_KEY,
  doesCloudConnectionWafBlocklistAddRule,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import { getAwsExternalIdForProject } from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { getCloudWafProjectSuffix } from "../../../Types/CloudConnection/CloudWafRuleSlots";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import PartialEntity from "../../../Types/Database/PartialEntity";
import {
  SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
  SecurityBlockCloudWafLeftItem,
  SecurityBlockCloudWafLeftKind,
  SecurityBlockCloudWafStatus,
} from "../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { SecurityBlockEnforcementState } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import SecurityBlockEnforcement from "../../../Models/DatabaseModels/SecurityBlockEnforcement";
import {
  SecurityBlockReason,
  fillSecurityBlockReason,
} from "../../../Types/SecurityBlocklist/SecurityBlockReason";

/*
 * SETTING UP AND TAKING DOWN A CLOUD WAF THAT ENFORCES THE BLOCKLIST
 * (#10344, #10348, #10349), outside the reconciler's passes:
 *
 *   check()        what Check Again does, and the page does as soon as a
 *                  WAF is picked: an AWS WAF web ACL's IP sets made and its
 *                  rule placed or looked for; an Azure WAF policy read and
 *                  OneUptime's rules written again if they read the wrong
 *                  address; a Cloud Armor policy's way of holding the list
 *                  picked (address groups or rules) and set up - and where
 *                  it stands recorded on its row. A pass of the reconciler
 *                  does the same as blocks come and go, but only for a
 *                  project with blocks: this is how a WAF is ready before
 *                  the first block.
 *   putBack()      Put It Back (Azure WAF, Cloud Armor): every rule of
 *                  OneUptime's someone turned off, changed or deleted by
 *                  hand written again, and the blocks it held tried again
 *                  at once.
 *   remove()       what Remove does: OneUptime's rules taken out of the WAF,
 *                  and what it shares with the project's other WAFs of the
 *                  same account and place (AWS WAF's IP sets, Cloud Armor's
 *                  address groups) deleted once nothing else uses it - then
 *                  the row. When that cannot be done (the connection may no
 *                  longer write it), it says so and removes nothing; the
 *                  person may then remove the WAF from OneUptime alone
 *                  (keepInCloud), and is told what stays in the cloud,
 *                  still blocking what it holds, for them to delete.
 *   checkAccess()  what the Add dialog asks of an Azure WAF or Cloud Armor
 *                  policy before it is added: whether the connection may
 *                  read and write it, asked without writing anything, with
 *                  the exact lines that grant what it lacks.
 *
 * Each takes the lock the reconciler takes for the WAF, so it and a pass
 * never write the same policy at once.
 */

// How long a check or a removal waits for a pass that holds the lock.
export const CLOUD_WAF_LOCK_WAIT_IN_MS: number = 30 * 1000;

export interface SecurityBlockCloudWafRemoval {
  // What OneUptime left in the cloud, for the person to delete.
  leftInCloud: Array<SecurityBlockCloudWafLeftItem>;
}

// Whether the connection may read and write a policy, and how to grant what it lacks.
export interface SecurityBlockCloudWafAccess {
  checks: Array<{ permission: string; isGranted: boolean }>;
  isGranted: boolean;
  // The exact lines that grant what the policy takes, for Cloud Shell.
  command: string;
  // Where the lines are run.
  shell: "azure" | "gcp";
}

interface AwsWafTarget {
  row: SecurityBlockCloudWaf;
  connection: CloudConnection;
  webAcl: AwsWafArn;
  group: AwsWafBlocklistGroup;
  addsRule: boolean;
  lockKey: string;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

// A failure's reason, when it carries one (an Azure WAF or Cloud Armor error).
function reasonOf(error: unknown): SecurityBlockReason | null {
  const reason: unknown =
    error && typeof error === "object"
      ? (error as { reason?: unknown }).reason
      : null;

  return reason && typeof reason === "object" && "template" in reason
    ? (reason as SecurityBlockReason)
    : null;
}

export default class SecurityBlockCloudWafs {
  // For tests: whether checks and removals take the reconciler's lock (Valkey).
  private static isLocking: boolean = true;

  public static setLockingForTests(isLocking: boolean): void {
    this.isLocking = isLocking;
  }

  private static async withLock<T>(
    key: string,
    run: () => Promise<T>,
  ): Promise<T> {
    if (!this.isLocking) {
      return await run();
    }

    let lock: SemaphoreMutex;

    try {
      lock = await Semaphore.lock({
        key,
        namespace: SECURITY_BLOCKLIST_LOCK_NAMESPACE,
        lockTimeout: SECURITY_BLOCKLIST_LOCK_TIMEOUT_IN_MS,
        acquireTimeout: CLOUD_WAF_LOCK_WAIT_IN_MS,
        retryInterval: 1000,
        refreshInterval: 0,
      });
    } catch (error) {
      logger.warn(
        `SecurityBlockCloudWafs: could not take the lock of ${key}. ${errorText(error)}`,
      );
      throw new BadDataException(
        "OneUptime is writing this WAF right now. Try again in a minute.",
      );
    }

    try {
      return await run();
    } finally {
      try {
        await Semaphore.release(lock);
      } catch (error) {
        logger.warn(
          `SecurityBlockCloudWafs: could not give back the lock of ${key}; it runs out by itself. ${errorText(error)}`,
        );
      }
    }
  }

  // The row the caller names, of their project; or why not.
  private static async readRow(data: {
    projectId: ObjectID;
    cloudWafId: ObjectID;
  }): Promise<SecurityBlockCloudWaf> {
    const row: SecurityBlockCloudWaf | null =
      await SecurityBlockCloudWafService.findOneBy({
        query: { _id: data.cloudWafId, projectId: data.projectId },
        select: {
          _id: true,
          projectId: true,
          cloudConnectionId: true,
          cloudProvider: true,
          wafId: true,
          name: true,
          region: true,
          clientAddress: true,
          status: true,
          statusMessage: true,
          statusReason: true,
          ruleDetails: true,
          checkedAt: true,
        },
        props: { isRoot: true },
      });

    if (!row?.id) {
      throw new BadDataException("This WAF no longer enforces your blocklist.");
    }

    return row;
  }

  private static async readConnection(data: {
    projectId: ObjectID;
    row: SecurityBlockCloudWaf;
  }): Promise<CloudConnection> {
    const connection: CloudConnection | null = data.row.cloudConnectionId
      ? await CloudConnectionService.findOneBy({
          query: { _id: data.row.cloudConnectionId, projectId: data.projectId },
          select: {
            _id: true,
            projectId: true,
            provider: true,
            config: true,
            secrets: true,
          },
          props: { isRoot: true },
        })
      : null;

    if (!connection?.id) {
      throw new BadDataException(
        `The cloud connection of ${data.row.name || "this WAF"} is gone.`,
      );
    }

    return connection;
  }

  // An AWS WAF row, its connection and the web ACL it names, ready to write; or why not.
  private static async readAwsTarget(data: {
    projectId: ObjectID;
    row: SecurityBlockCloudWaf;
  }): Promise<AwsWafTarget> {
    const { row } = data;
    const webAcl: AwsWafArn | null = parseAwsWafArn(row.wafId);

    if (!webAcl) {
      throw new BadDataException(
        `OneUptime cannot read ${row.name || "this WAF"}: pick it again from the list.`,
      );
    }

    const connection: CloudConnection = await this.readConnection(data);
    const settings: CloudConnectionSettings =
      await CloudConnectionService.getConnectorSettings(connection);
    const lockKey: string = AwsWafBlocklistGroup.getLockKey({
      projectId: data.projectId.toString(),
      accountId: webAcl.accountId,
      region: webAcl.region,
      scope: webAcl.scope,
    });

    return {
      row,
      connection,
      webAcl,
      lockKey,
      addsRule: doesCloudConnectionWafBlocklistAddRule(
        (connection.config || {})[WAF_BLOCKLIST_FIELD_KEY],
      ),
      group: new AwsWafBlocklistGroup({
        settings,
        connectionId: connection.id!,
        externalId: getAwsExternalIdForProject(data.projectId.toString()),
        accountId: webAcl.accountId,
        region: webAcl.region,
        scope: webAcl.scope,
        options: AwsWafBlockDestinationSource.getCallOptions(),
      }),
    };
  }

  private static async readAzureTarget(data: {
    projectId: ObjectID;
    row: SecurityBlockCloudWaf;
  }): Promise<{
    policy: AzureWafPolicyRef;
    keeper: AzureWafPolicyBlocklist;
    lockKey: string;
  }> {
    const policy: AzureWafPolicyRef | null = parseAzureWafPolicyId(
      data.row.wafId,
    );

    if (!policy) {
      throw new BadDataException(
        `OneUptime cannot read ${data.row.name || "this WAF"}: pick it again from the list.`,
      );
    }

    const connection: CloudConnection = await this.readConnection(data);

    return {
      policy,
      keeper: buildAzureWafKeeper({
        row: data.row,
        policy,
        settings: await CloudConnectionService.getConnectorSettings(connection),
      }),
      lockKey: AzureWafBlockDestination.getLockKey({
        projectId: data.projectId.toString(),
        policy,
      }),
    };
  }

  private static async readCloudArmorTarget(data: {
    projectId: ObjectID;
    row: SecurityBlockCloudWaf;
  }): Promise<{
    policy: CloudArmorPolicyRef;
    keeper: CloudArmorPolicyBlocklist;
    lockKey: string;
  }> {
    const policy: CloudArmorPolicyRef | null = parseCloudArmorPolicyId(
      data.row.wafId,
    );

    if (!policy) {
      throw new BadDataException(
        `OneUptime cannot read ${data.row.name || "this WAF"}: pick it again from the list.`,
      );
    }

    const connection: CloudConnection = await this.readConnection(data);

    return {
      policy,
      keeper: buildCloudArmorKeeper({
        row: data.row,
        policy,
        settings: await CloudConnectionService.getConnectorSettings(connection),
      }),
      lockKey: CloudArmorBlockDestination.getLockKey({
        projectId: data.projectId.toString(),
        policy,
      }),
    };
  }

  /*
   * Sets the WAF up and says where it stands. Never throws for what the
   * cloud answered: that is the WAF's status. The project's blocklist is
   * reconciled at once after, so its blocks reach the WAF.
   */
  @CaptureSpan()
  public static async check(data: {
    projectId: ObjectID;
    cloudWafId: ObjectID;
  }): Promise<SecurityBlockCloudWaf> {
    const row: SecurityBlockCloudWaf = await this.readRow(data);

    if (row.cloudProvider === CloudProvider.Azure) {
      await this.checkAzure({ projectId: data.projectId, row });
    } else if (row.cloudProvider === CloudProvider.GCP) {
      await this.checkCloudArmor({ projectId: data.projectId, row });
    } else if (row.cloudProvider === CloudProvider.AWS) {
      await this.checkAws({ projectId: data.projectId, row });
    } else {
      throw new BadDataException(
        `OneUptime cannot read ${row.name || "this WAF"}: pick it again from the list.`,
      );
    }

    await SecurityBlocklistJobs.queueReconcile(data.projectId);

    return row;
  }

  private static async checkAws(data: {
    projectId: ObjectID;
    row: SecurityBlockCloudWaf;
  }): Promise<void> {
    const target: AwsWafTarget = await this.readAwsTarget(data);
    const { row, group, webAcl, addsRule } = target;

    const state: AwsWafRuleState = await this.withLock(
      target.lockKey,
      async (): Promise<AwsWafRuleState> => {
        try {
          if (addsRule) {
            return await group.ensureRules({
              webAcl,
              clientAddress: readCloudWafClientAddress(row),
            });
          }

          await group.ensureSets();

          return await group.readRuleState({
            webAcl,
            clientAddress: readCloudWafClientAddress(row),
            addsRule: false,
          });
        } catch (error) {
          return {
            status: SecurityBlockCloudWafStatus.Failed,
            message: `OneUptime could not set up ${webAcl.name}: ${errorText(error)}`,
            enforcedSetKeys: [],
            priorities: { block: null, challenge: null },
            setArns: {},
            sampledMetricNames: {},
          };
        }
      },
    );

    await recordCloudWafState({
      row,
      status: state.status,
      message: state.message,
      details: getCloudWafRuleDetails({ state, group, addsRule }),
      now: OneUptimeDate.getCurrentDate(),
      isForced: true,
    });
  }

  // A cloud's failure, recorded on the row as its status: why, in both forms.
  private static async recordFailure(data: {
    row: SecurityBlockCloudWaf;
    error: unknown;
  }): Promise<void> {
    const reason: SecurityBlockReason | null = reasonOf(data.error);

    await recordCloudWafState({
      row: data.row,
      status: SecurityBlockCloudWafStatus.Failed,
      message: reason ? fillSecurityBlockReason(reason) : errorText(data.error),
      reason,
      details: (data.row.ruleDetails || {}) as JSONObject,
      now: OneUptimeDate.getCurrentDate(),
      isForced: true,
    });
  }

  private static async checkAzure(data: {
    projectId: ObjectID;
    row: SecurityBlockCloudWaf;
  }): Promise<void> {
    const target: {
      keeper: AzureWafPolicyBlocklist;
      lockKey: string;
    } = await this.readAzureTarget(data);

    await this.withLock(target.lockKey, async (): Promise<void> => {
      try {
        await target.keeper.rewriteIfNeeded();

        const state: AzureWafState = await target.keeper.readState(true);

        await recordAzureWafState({
          row: data.row,
          state,
          now: OneUptimeDate.getCurrentDate(),
          isForced: true,
        });
      } catch (error) {
        await this.recordFailure({ row: data.row, error });
      }
    });
  }

  private static async checkCloudArmor(data: {
    projectId: ObjectID;
    row: SecurityBlockCloudWaf;
  }): Promise<void> {
    const target: {
      keeper: CloudArmorPolicyBlocklist;
      lockKey: string;
    } = await this.readCloudArmorTarget(data);

    await this.withLock(target.lockKey, async (): Promise<void> => {
      try {
        const state: CloudArmorState = await target.keeper.setUp();

        await recordCloudArmorState({
          row: data.row,
          state,
          now: OneUptimeDate.getCurrentDate(),
          isForced: true,
        });
      } catch (error) {
        await this.recordFailure({ row: data.row, error });
      }
    });
  }

  /*
   * Put It Back: OneUptime's rules someone turned off, changed or deleted
   * by hand written again, and the blocks the WAF turned down meanwhile
   * tried again at once. Throws what the cloud answered: the person asked,
   * and is told.
   */
  @CaptureSpan()
  public static async putBack(data: {
    projectId: ObjectID;
    cloudWafId: ObjectID;
  }): Promise<SecurityBlockCloudWaf> {
    const row: SecurityBlockCloudWaf = await this.readRow(data);
    let destinationKey: string = "";

    if (row.cloudProvider === CloudProvider.Azure) {
      const target: {
        keeper: AzureWafPolicyBlocklist;
        lockKey: string;
      } = await this.readAzureTarget({ projectId: data.projectId, row });

      destinationKey = AzureWafBlockDestination.getKey(row);

      await this.withLock(target.lockKey, async (): Promise<void> => {
        try {
          await recordAzureWafState({
            row,
            state: await target.keeper.putBack(),
            now: OneUptimeDate.getCurrentDate(),
            isForced: true,
          });
        } catch (error) {
          throw new BadDataException(
            `OneUptime could not put its rules back in ${row.name || "the policy"}: ${errorText(error)}`,
          );
        }
      });
    } else if (row.cloudProvider === CloudProvider.GCP) {
      const target: {
        keeper: CloudArmorPolicyBlocklist;
        lockKey: string;
      } = await this.readCloudArmorTarget({ projectId: data.projectId, row });

      destinationKey = CloudArmorBlockDestination.getKey(row);

      await this.withLock(target.lockKey, async (): Promise<void> => {
        try {
          await recordCloudArmorState({
            row,
            state: await target.keeper.putBack(),
            now: OneUptimeDate.getCurrentDate(),
            isForced: true,
          });
        } catch (error) {
          throw new BadDataException(
            `OneUptime could not put its rules back in ${row.name || "the policy"}: ${errorText(error)}`,
          );
        }
      });
    } else {
      throw new BadDataException(
        "Put It Back is for an Azure WAF or Cloud Armor policy: an AWS WAF web ACL puts OneUptime's rule back itself.",
      );
    }

    // The blocks the WAF turned down while it was changed by hand are tried again now, not after their wait.
    await SecurityBlockEnforcementService.updateBy({
      query: {
        projectId: data.projectId,
        destinationKey,
        state: SecurityBlockEnforcementState.Failed,
      },
      data: {
        retryAt: null,
        failedAttempts: 0,
      } as unknown as PartialEntity<SecurityBlockEnforcement>,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    await SecurityBlocklistJobs.queueReconcile(data.projectId);

    return row;
  }

  /*
   * Takes OneUptime out of the WAF, then removes it. With keepInCloud,
   * removes it from OneUptime alone, and names what stays in the cloud.
   */
  @CaptureSpan()
  public static async remove(data: {
    projectId: ObjectID;
    cloudWafId: ObjectID;
    keepInCloud: boolean;
  }): Promise<SecurityBlockCloudWafRemoval> {
    const row: SecurityBlockCloudWaf = await this.readRow(data);
    let leftInCloud: Array<SecurityBlockCloudWafLeftItem> = [];

    if (row.cloudProvider === CloudProvider.Azure) {
      leftInCloud = await this.removeAzure({ ...data, row });
    } else if (row.cloudProvider === CloudProvider.GCP) {
      leftInCloud = await this.removeCloudArmor({ ...data, row });
    } else {
      leftInCloud = await this.removeAws({ ...data, row });
    }

    await SecurityBlockCloudWafService.deleteOneBy({
      query: { _id: row.id!, projectId: data.projectId },
      props: { isRoot: true },
    });

    await SecurityBlocklistJobs.queueReconcile(data.projectId);

    return { leftInCloud };
  }

  private static async removeAws(data: {
    projectId: ObjectID;
    row: SecurityBlockCloudWaf;
    keepInCloud: boolean;
  }): Promise<Array<SecurityBlockCloudWafLeftItem>> {
    const target: AwsWafTarget = await this.readAwsTarget(data);
    const { group, webAcl } = target;

    if (data.keepInCloud) {
      return this.whatStaysInAws({
        target,
        // The sets stay OneUptime's while another web ACL uses them: never the person's to delete.
        isSetsInUse: await this.isSetsInUseElsewhere(target),
      });
    }

    return await this.withLock(
      target.lockKey,
      async (): Promise<Array<SecurityBlockCloudWafLeftItem>> => {
        try {
          if (target.addsRule) {
            await group.removeRules(webAcl);
          }

          if (await this.isSetsInUseElsewhere(target)) {
            return [];
          }

          return (await group.emptyAndDeleteSets()).map(
            (name: string): SecurityBlockCloudWafLeftItem => {
              return { kind: SecurityBlockCloudWafLeftKind.IpSet, name };
            },
          );
        } catch (error) {
          throw new BadDataException(
            `OneUptime could not take its rule and IP sets out of ${webAcl.name}: ${errorText(error)} Try again, or remove it from OneUptime only and delete them in AWS WAF yourself.`,
          );
        }
      },
    );
  }

  private static async removeAzure(data: {
    projectId: ObjectID;
    row: SecurityBlockCloudWaf;
    keepInCloud: boolean;
  }): Promise<Array<SecurityBlockCloudWafLeftItem>> {
    const name: string = data.row.name || "";

    if (data.keepInCloud) {
      return (readAzureWafRuleDetails(data.row.ruleDetails)?.rules || []).map(
        (rule: AzureWafRecordedRule): SecurityBlockCloudWafLeftItem => {
          return {
            kind: SecurityBlockCloudWafLeftKind.Rule,
            name: rule.name,
            webAcl: name,
          };
        },
      );
    }

    const target: {
      keeper: AzureWafPolicyBlocklist;
      lockKey: string;
    } = await this.readAzureTarget(data);

    return await this.withLock(
      target.lockKey,
      async (): Promise<Array<SecurityBlockCloudWafLeftItem>> => {
        try {
          await target.keeper.removeAll();
          return [];
        } catch (error) {
          throw new BadDataException(
            `OneUptime could not take its rules out of ${name}: ${errorText(error)} Try again, or remove it from OneUptime only and delete them in Azure yourself.`,
          );
        }
      },
    );
  }

  private static async removeCloudArmor(data: {
    projectId: ObjectID;
    row: SecurityBlockCloudWaf;
    keepInCloud: boolean;
  }): Promise<Array<SecurityBlockCloudWafLeftItem>> {
    const name: string = data.row.name || "";
    const details: CloudArmorRuleDetails | null = readCloudArmorRuleDetails(
      data.row.ruleDetails,
    );
    const policy: CloudArmorPolicyRef | null = parseCloudArmorPolicyId(
      data.row.wafId,
    );
    const isGroups: boolean =
      details?.mode === CloudArmorBlocklistMode.AddressGroups;
    const isGroupsInUse: boolean =
      isGroups && policy
        ? await this.isAddressGroupsInUseElsewhere({
            row: data.row,
            policy,
          })
        : false;
    const groupItems: () => Array<SecurityBlockCloudWafLeftItem> = () => {
      if (!isGroups || isGroupsInUse) {
        return [];
      }

      const names: { ipv4: string; ipv6: string } =
        getCloudArmorAddressGroupNames(
          getCloudWafProjectSuffix(data.projectId.toString()),
        );

      return [names.ipv4, names.ipv6].map(
        (group: string): SecurityBlockCloudWafLeftItem => {
          return {
            kind: SecurityBlockCloudWafLeftKind.AddressGroup,
            name: group,
          };
        },
      );
    };

    if (data.keepInCloud) {
      return [
        ...(details?.rules || []).map(
          (rule: CloudArmorRecordedRule): SecurityBlockCloudWafLeftItem => {
            return {
              kind: SecurityBlockCloudWafLeftKind.PriorityRule,
              name: `priority ${rule.priority}`,
              webAcl: name,
              priority: rule.priority,
            };
          },
        ),
        ...(details?.groupRulePriority !== null &&
        details?.groupRulePriority !== undefined
          ? [
              {
                kind: SecurityBlockCloudWafLeftKind.PriorityRule,
                name: `priority ${details.groupRulePriority}`,
                webAcl: name,
                priority: details.groupRulePriority,
              },
            ]
          : []),
        ...groupItems(),
      ];
    }

    const target: {
      keeper: CloudArmorPolicyBlocklist;
      lockKey: string;
    } = await this.readCloudArmorTarget(data);

    return await this.withLock(
      target.lockKey,
      async (): Promise<Array<SecurityBlockCloudWafLeftItem>> => {
        try {
          await target.keeper.removeAll();

          if (!isGroups || isGroupsInUse) {
            return [];
          }

          return (await target.keeper.removeGroups()).map(
            (group: string): SecurityBlockCloudWafLeftItem => {
              return {
                kind: SecurityBlockCloudWafLeftKind.AddressGroup,
                name: group,
              };
            },
          );
        } catch (error) {
          throw new BadDataException(
            `OneUptime could not take its rules out of ${name}: ${errorText(error)} Try again, or remove it from OneUptime only and delete them in Cloud Armor yourself.`,
          );
        }
      },
    );
  }

  // Whether another policy of the project's Google Cloud project holds the blocklist in its address groups.
  private static async isAddressGroupsInUseElsewhere(data: {
    row: SecurityBlockCloudWaf;
    policy: CloudArmorPolicyRef;
  }): Promise<boolean> {
    return (
      await SecurityBlockCloudWafService.findForProject(data.row.projectId!)
    ).some((other: SecurityBlockCloudWaf): boolean => {
      const otherPolicy: CloudArmorPolicyRef | null = parseCloudArmorPolicyId(
        other.wafId,
      );

      return (
        other.id?.toString() !== data.row.id?.toString() &&
        other.cloudProvider === CloudProvider.GCP &&
        otherPolicy?.project === data.policy.project &&
        readCloudArmorRuleDetails(other.ruleDetails)?.mode ===
          CloudArmorBlocklistMode.AddressGroups
      );
    });
  }

  // Whether another web ACL of the project in the account, scope and Region uses the sets.
  private static async isSetsInUseElsewhere(
    target: AwsWafTarget,
  ): Promise<boolean> {
    return (
      await SecurityBlockCloudWafService.findForProject(target.row.projectId!)
    ).some((other: SecurityBlockCloudWaf): boolean => {
      const otherAcl: AwsWafArn | null = parseAwsWafArn(other.wafId);

      return (
        other.id?.toString() !== target.row.id?.toString() &&
        Boolean(otherAcl) &&
        otherAcl!.accountId === target.webAcl.accountId &&
        otherAcl!.region === target.webAcl.region &&
        otherAcl!.scope === target.webAcl.scope
      );
    });
  }

  // What OneUptime keeps in AWS WAF for a web ACL, for a person who takes it out by hand.
  private static whatStaysInAws(data: {
    target: AwsWafTarget;
    isSetsInUse: boolean;
  }): Array<SecurityBlockCloudWafLeftItem> {
    const { target } = data;
    const externalId: string = getAwsExternalIdForProject(
      target.row.projectId!.toString(),
    );
    const names: { block: string; challenge: string } =
      getAwsWafBlocklistRuleNames(externalId);

    return [
      ...(target.addsRule
        ? [names.block, names.challenge].map(
            (name: string): SecurityBlockCloudWafLeftItem => {
              return {
                kind: SecurityBlockCloudWafLeftKind.Rule,
                name,
                webAcl: target.webAcl.name,
              };
            },
          )
        : []),
      ...(data.isSetsInUse
        ? []
        : getAwsWafBlocklistSets(externalId).map(
            (set: { name: string }): SecurityBlockCloudWafLeftItem => {
              return {
                kind: SecurityBlockCloudWafLeftKind.IpSet,
                name: set.name,
              };
            },
          )),
    ];
  }

  /*
   * Whether the connection may read and write an Azure WAF or Cloud Armor
   * policy of the project's inventory, asked without writing anything, and
   * the exact lines that grant it. The inventory row is the project's own,
   * of a connection of its cloud.
   */
  @CaptureSpan()
  public static async checkAccess(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
  }): Promise<SecurityBlockCloudWafAccess> {
    const resource: CloudResource | null = await CloudResourceService.findOneBy(
      {
        query: {
          _id: data.cloudResourceId,
          projectId: data.projectId,
          isArchived: false,
        },
        select: {
          _id: true,
          name: true,
          cloudProvider: true,
          providerResourceId: true,
          cloudConnectionId: true,
        },
        props: { isRoot: true },
      },
    );

    if (!resource?.id || !resource.cloudConnectionId) {
      throw new BadDataException(
        "That policy is not in your cloud inventory any more. Pick another.",
      );
    }

    const connection: CloudConnection | null =
      await CloudConnectionService.findOneBy({
        query: { _id: resource.cloudConnectionId, projectId: data.projectId },
        select: {
          _id: true,
          projectId: true,
          provider: true,
          config: true,
          secrets: true,
        },
        props: { isRoot: true },
      });

    if (!connection?.id) {
      throw new BadDataException(
        "That policy's cloud connection is gone. Pick a policy of a connected account.",
      );
    }

    const settings: CloudConnectionSettings =
      await CloudConnectionService.getConnectorSettings(connection);
    // A row as it would be made, for the keeper: the project, the policy's name, the default address.
    const row: SecurityBlockCloudWaf = new SecurityBlockCloudWaf();

    row.projectId = data.projectId;
    row.name = resource.name || "";
    row.clientAddress = SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS;

    let checks: Array<{ permission: string; isGranted: boolean }>;
    let command: string;
    let shell: "azure" | "gcp";

    try {
      if (connection.provider === CloudProvider.Azure) {
        const policy: AzureWafPolicyRef | null = parseAzureWafPolicyId(
          resource.providerResourceId,
        );

        if (!policy) {
          throw new BadDataException(
            "That resource is not an Azure WAF policy. Pick a policy from the list.",
          );
        }

        checks = await buildAzureWafKeeper({
          row,
          policy,
          settings,
        }).checkAccess();
        command = getAzureWafPolicyAccessCommand({
          clientId: readCloudSetting(settings.config, "clientId"),
          policy,
        });
        shell = "azure";
      } else if (connection.provider === CloudProvider.GCP) {
        const policy: CloudArmorPolicyRef | null = parseCloudArmorPolicyId(
          resource.providerResourceId,
        );

        if (!policy) {
          throw new BadDataException(
            "That resource is not a Cloud Armor security policy. Pick a policy from the list.",
          );
        }

        checks = await buildCloudArmorKeeper({
          row,
          policy,
          settings,
        }).checkAccess();
        command = getCloudArmorPolicyAccessCommand({
          serviceAccountEmail: GcpCloudConnector.readKey(
            readCloudSetting(settings.secrets, "serviceAccountJson"),
          ).clientEmail,
          policy,
        });
        shell = "gcp";
      } else {
        throw new BadDataException(
          "Only Azure WAF and Cloud Armor policies are checked here: an AWS WAF web ACL takes its connection's setup command.",
        );
      }
    } catch (error) {
      if (error instanceof BadDataException) {
        throw error;
      }

      throw new BadDataException(
        `OneUptime could not ask your cloud what the connection may do, so it turned nothing on: ${errorText(error)} Try again in a minute.`,
      );
    }

    return {
      checks,
      isGranted: checks.every(
        (check: { permission: string; isGranted: boolean }): boolean => {
          return check.isGranted;
        },
      ),
      command,
      shell,
    };
  }
}
