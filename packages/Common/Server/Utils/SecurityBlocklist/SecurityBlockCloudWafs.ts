import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import SecurityBlockCloudWaf from "../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import CloudConnectionService from "../../Services/CloudConnectionService";
import SecurityBlockCloudWafService from "../../Services/SecurityBlockCloudWafService";
import AwsWafBlocklistGroup, {
  AwsWafRuleState,
} from "../CloudConnection/Aws/AwsWafBlocklist";
import { CloudConnectionSettings } from "../CloudConnection/CloudConnectorTypes";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import {
  AwsWafBlockDestinationSource,
  getCloudWafRuleDetails,
  readCloudWafClientAddress,
  recordCloudWafState,
} from "./AwsWafBlockDestination";
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
  WAF_BLOCKLIST_FIELD_KEY,
  doesCloudConnectionWafBlocklistAddRule,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import { getAwsExternalIdForProject } from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockCloudWafLeftItem,
  SecurityBlockCloudWafLeftKind,
  SecurityBlockCloudWafStatus,
} from "../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";

/*
 * SETTING UP AND TAKING DOWN A CLOUD WAF THAT ENFORCES THE BLOCKLIST
 * (#10344), outside the reconciler's passes:
 *
 *   check()   what Check Again does, and the page does as soon as a web ACL
 *             is picked: OneUptime's IP sets made where they are not, its
 *             rule placed - when OneUptime adds it - or looked for in a web
 *             ACL kept in code, and where the web ACL stands recorded on
 *             its row. A pass of the reconciler does the same as blocks
 *             come and go, but only for a project with blocks: this is how
 *             a web ACL is ready, and its rule shown with its sets' ARNs,
 *             before the first block.
 *   remove()  what Remove does: OneUptime's rule taken out of the web ACL,
 *             and its IP sets there emptied and deleted once no other web
 *             ACL of the project uses them - then the row. When that
 *             cannot be done (the connection's role may no longer write
 *             it), it says so and removes nothing; the person may then
 *             remove the web ACL from OneUptime alone (keepInCloud), and
 *             is told what stays in AWS WAF, still blocking what its sets
 *             hold, for them to delete.
 *
 * Each takes the lock the reconciler takes for the web ACL's sets, so it
 * and a pass never write them at once.
 */

// How long a check or a removal waits for a pass that holds the lock.
export const CLOUD_WAF_LOCK_WAIT_IN_MS: number = 30 * 1000;

export interface SecurityBlockCloudWafRemoval {
  // What OneUptime left in the cloud, for the person to delete.
  leftInCloud: Array<SecurityBlockCloudWafLeftItem>;
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
        "OneUptime is writing these IP sets right now. Try again in a minute.",
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

  // The row, its connection and the web ACL it names, ready to write; or why not.
  private static async readTarget(data: {
    projectId: ObjectID;
    cloudWafId: ObjectID;
  }): Promise<AwsWafTarget> {
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
          ruleDetails: true,
          checkedAt: true,
        },
        props: { isRoot: true },
      });

    if (!row?.id) {
      throw new BadDataException(
        "This web ACL no longer enforces your blocklist.",
      );
    }

    const webAcl: AwsWafArn | null = parseAwsWafArn(row.wafId);

    if (row.cloudProvider !== CloudProvider.AWS || !webAcl) {
      throw new BadDataException(
        `OneUptime cannot read ${row.name || "this WAF"}: pick it again from the list.`,
      );
    }

    const connection: CloudConnection | null = row.cloudConnectionId
      ? await CloudConnectionService.findOneBy({
          query: { _id: row.cloudConnectionId, projectId: data.projectId },
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
        `The cloud connection of ${row.name || "this web ACL"} is gone.`,
      );
    }

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
        connectionId: connection.id,
        externalId: getAwsExternalIdForProject(data.projectId.toString()),
        accountId: webAcl.accountId,
        region: webAcl.region,
        scope: webAcl.scope,
        options: AwsWafBlockDestinationSource.getCallOptions(),
      }),
    };
  }

  /*
   * Sets the web ACL up and says where it stands: OneUptime's IP sets made
   * where they are not, and its rule placed (when OneUptime adds it) or
   * looked for (when its team adds it in code). Never throws for what AWS
   * answered: that is the web ACL's status. The project's blocklist is
   * reconciled at once after, so its blocks reach the sets.
   */
  @CaptureSpan()
  public static async check(data: {
    projectId: ObjectID;
    cloudWafId: ObjectID;
  }): Promise<SecurityBlockCloudWaf> {
    const target: AwsWafTarget = await this.readTarget(data);
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

    await SecurityBlocklistJobs.queueReconcile(data.projectId);

    return row;
  }

  /*
   * Takes OneUptime out of the web ACL, then removes it: its rule taken
   * out (when OneUptime added it), and its IP sets emptied and deleted once
   * no other web ACL of the project in the account, scope and Region uses
   * them - a set a rule of the team's still references is left, empty, and
   * named. With keepInCloud, removes it from OneUptime alone, and names
   * what stays in AWS WAF.
   */
  @CaptureSpan()
  public static async remove(data: {
    projectId: ObjectID;
    cloudWafId: ObjectID;
    keepInCloud: boolean;
  }): Promise<SecurityBlockCloudWafRemoval> {
    const target: AwsWafTarget = await this.readTarget(data);
    const { row, group, webAcl } = target;
    let leftInCloud: Array<SecurityBlockCloudWafLeftItem> = [];

    if (data.keepInCloud) {
      leftInCloud = this.whatStaysInCloud({
        target,
        // The sets stay OneUptime's while another web ACL uses them: never the person's to delete.
        isSetsInUse: await this.isSetsInUseElsewhere(target),
      });
    } else {
      leftInCloud = await this.withLock(
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

    await SecurityBlockCloudWafService.deleteOneBy({
      query: { _id: row.id!, projectId: data.projectId },
      props: { isRoot: true },
    });

    await SecurityBlocklistJobs.queueReconcile(data.projectId);

    return { leftInCloud };
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
  private static whatStaysInCloud(data: {
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
}
