import DatabaseService from "./DatabaseService";
import MonitorService from "./MonitorService";
import NetworkDeviceLabelRuleEngineService from "./NetworkDeviceLabelRuleEngineService";
import NetworkDeviceOwnerRuleEngineService from "./NetworkDeviceOwnerRuleEngineService";
import NetworkSiteAssignmentRuleService from "./NetworkSiteAssignmentRuleService";
import NetworkSiteService from "./NetworkSiteService";
import Model from "../../Models/DatabaseModels/NetworkDevice";
import Monitor from "../../Models/DatabaseModels/Monitor";
import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import NetworkSiteAssignmentRule from "../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import Query from "../Types/Database/Query";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import CidrMatchUtil from "../../Utils/NetworkSite/CidrMatchUtil";
import { SiteAssignmentRuleRunResult } from "../../Types/NetworkAutomation/RuleRunResult";
import { NetworkDeviceMonitoringMethodUtil } from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import { EntityManager } from "typeorm";

/*
 * Columns a NetworkSiteAssignmentRule's hostname pattern is matched against.
 * A write to any of them can change which rule wins for the device, so
 * onUpdateSuccess re-evaluates the rules. `sysName` matters most in practice:
 * a discovery import stores the responding IP in `hostname` and only the SNMP
 * walk fills `sysName` in later, so a device's real identity usually lands
 * AFTER creation.
 */
const SITE_RULE_IDENTITY_COLUMNS: Array<string> = [
  "hostname",
  "name",
  "sysName",
];

/*
 * Both spellings of "the device's site" in a write payload - see
 * RelationIdUtil for why a hook has to watch for both.
 */
const SITE_KEYS: Array<string> = ["siteId", "site"];

/*
 * Null, undefined and "  Core-SW " all mean the same thing to a
 * case-insensitive wildcard match, so compare identity values normalised -
 * otherwise a no-op rewrite of sysName on every SNMP walk would look like a
 * change and re-run the rules for the whole fleet every polling cycle.
 */
function normalizeIdentityValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim().toLowerCase();
}

// True when the payload sets the device's site, under either spelling.
function isSiteWrite(dataKeys: Array<string>): boolean {
  return RelationIdUtil.isWritten(dataKeys, SITE_KEYS);
}

/*
 * The site a payload moves the device to, or null when it clears the site (or
 * carries no resolvable id).
 */
function readSiteIdFromData(data: Record<string, unknown>): ObjectID | null {
  return RelationIdUtil.read(data, SITE_KEYS);
}

// Both spellings of "the monitor that reports this device's health".
const MONITOR_KEYS: Array<string> = ["monitorId", "monitor"];

function readMonitorIdFromData(data: Record<string, unknown>): ObjectID | null {
  return RelationIdUtil.read(data, MONITOR_KEYS);
}

/*
 * How many devices a single manual "Run now" of an assignment rule walks.
 * The automatic path only ever sees one device at a time, so this cap is the
 * only thing standing between a rule run and a full-fleet table scan inside
 * one HTTP request. Runs that hit it report isTruncated so the caller can say
 * "run it again" rather than quietly leave half the estate unassigned.
 */
export const MAX_DEVICES_PER_RULE_RUN: number = LIMIT_PER_PROJECT;

// Devices are read in pages so a large estate never lands in memory at once.
const RULE_RUN_PAGE_SIZE: number = 1000;

/*
 * The identity a rule is matched against. The hostname column holds an IP
 * address or a DNS name depending on how the device got here, so it is passed
 * as both — ipInCidr rejects non-IP strings safely. Mirrors the single-device
 * path in applySiteAssignmentRulesToDevice; both must stay in step or a
 * manual run would disagree with what discovery does.
 */
function toRuleMatchTarget(device: Model): {
  ip: string | undefined;
  hostname: string | undefined;
  sysName: string | undefined;
  name: string | undefined;
} {
  return {
    ip: device.hostname,
    hostname: device.hostname,
    sysName: device.sysName,
    name: device.name,
  };
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The FK behind siteId only requires the NetworkSite row to exist, not that
   * it belongs to the device's project. Without this check a tenant can point
   * a device at another project's site and make onUpdateSuccess drive rollup
   * writes there under root props. Mirrors the parentSiteId guard in
   * NetworkSiteService.onBeforeCreate.
   */
  private async assertSiteBelongsToProject(data: {
    siteId: ObjectID;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      return;
    }

    const site: NetworkSite | null = await NetworkSiteService.findOneById({
      id: data.siteId,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!site) {
      throw new BadDataException("Network site not found.");
    }

    if (
      site.projectId &&
      site.projectId.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException(
        "Network site must belong to the same project.",
      );
    }
  }

  /*
   * onBeforeUpdate runs before DatabaseService permission-checks the query,
   * so reading the raw client query as root would hand the hook rows from
   * other projects. Re-apply the caller's tenant here.
   */
  private scopeQueryToCallerTenant(
    query: Query<Model>,
    props: DatabaseCommonInteractionProps,
  ): Query<Model> {
    if (props.isRoot || !props.tenantId) {
      return query;
    }

    return {
      ...query,
      projectId: props.tenantId,
    };
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * Read both spellings: the dashboard posts the `site` relation, not the
     * `siteId` column, so guarding only `siteId` let a UI-created device
     * point at another project's site.
     */
    const siteId: ObjectID | null = readSiteIdFromData(
      createBy.data as unknown as Record<string, unknown>,
    );

    if (siteId) {
      await this.assertSiteBelongsToProject({
        siteId: siteId,
        projectId: createBy.data.projectId,
      });
    }

    if (
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        createBy.data.monitoringMethod,
      )
    ) {
      const monitorId: ObjectID | null = readMonitorIdFromData(
        createBy.data as unknown as Record<string, unknown>,
      );

      /*
       * The monitor is NOT required here, though the create form asks for
       * one. Discovery import is why: a subnet sweep finds ping-only hosts
       * in bulk and there is no monitor to bind them to yet. Such a device
       * is still worth recording — it belongs to a site, carries labels, and
       * appears on the topology map — and its status reads "pending", which
       * is exactly true until somebody points a monitor at it.
       */
      if (monitorId) {
        await this.assertMonitorBelongsToProject({
          monitorId: monitorId,
          projectId: createBy.data.projectId,
        });
      }

      /*
       * Not a preference: a monitor-backed device has no probe and no
       * credentials, so leaving polling on would queue a walk that can only
       * ever fail. claimDevicesForPolling refuses these rows too — this is
       * the half that keeps the column honest for anything reading it.
       */
      createBy.data.isPollingEnabled = false;
    }

    return { createBy, carryForward: null };
  }

  /*
   * The FK behind monitorId only requires the Monitor row to exist, not that
   * it belongs to the device's project — the same hole assertSiteBelongsToProject
   * closes for sites. Without this a tenant could bind a device to another
   * project's monitor and read its status through the device.
   */
  @CaptureSpan()
  private async assertMonitorBelongsToProject(data: {
    monitorId: ObjectID;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException("Project ID is required.");
    }

    const monitor: Monitor | null = await MonitorService.findOneBy({
      query: {
        _id: data.monitorId,
        projectId: data.projectId,
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (!monitor) {
      throw new BadDataException("Monitor not found.");
    }
  }

  /*
   * Owner/label rules fire whenever a device is created — manually or via
   * subnet discovery import. Applied out-of-band: rule failures must never
   * fail device creation. Site auto-assignment rides the same chain: a
   * device created without a site is matched against the project's
   * NetworkSiteAssignmentRules, and a device created directly into a site
   * refreshes that site's rollup.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
            createdItem,
          );
        })
        .then(async () => {
          await NetworkDeviceOwnerRuleEngineService.applyRulesToNetworkDevice(
            createdItem,
          );
        })
        .then(async () => {
          /*
           * `site` (relation) or `siteId` (column) - a device created from
           * the dashboard carries only the former.
           */
          const createdSiteId: ObjectID | null =
            createdItem.siteId || createdItem.site?.id || null;

          if (createdSiteId) {
            await NetworkSiteService.recomputeRollupForSiteAndAncestors(
              createdSiteId,
            );
          } else {
            await this.applySiteAssignmentRulesToDevice(createdItem.id!);
          }
        })
        .then(async () => {
          /*
           * A device created monitor-backed adopts its monitor's CURRENT
           * status right away rather than waiting for that monitor's next
           * status CHANGE. Skipped for SNMP devices, which are judged by
           * their own walk.
           */
          if (
            NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
              createdItem.monitoringMethod,
            )
          ) {
            await this.refreshStampedMonitorStatus({
              deviceId: createdItem.id!,
              clearWhenNotMonitorBacked: false,
            });
          }
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying network device rules in NetworkDeviceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              networkDeviceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }

  /*
   * Capture the previous state of every matched device when an update
   * touches siteId (so onUpdateSuccess can refresh the OLD site's rollup as
   * well as the new one) or touches one of the columns site assignment rules
   * match on (so onUpdateSuccess can tell a real rename from the identical
   * sysName the SNMP walk rewrites on every poll).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const dataKeys: Array<string> = Object.keys(updateBy.data || {});

    /*
     * Switching a device to monitor-backed turns polling off with it. The
     * two are one decision, not two: a device with no probe and no
     * credentials cannot be walked, so leaving the flag on would queue a
     * walk per interval that can only fail and then paint the device down.
     */
    const isMethodWrite: boolean = dataKeys.includes("monitoringMethod");
    /*
     * An update payload is a QueryDeepPartialEntity, so a column can hold a
     * raw value OR a SQL-expression function. Only a plain string is a
     * method we can reason about; anything else falls through to the SNMP
     * default, which changes nothing.
     */
    const writtenMethod: unknown = (
      updateBy.data as unknown as Record<string, unknown>
    )["monitoringMethod"];
    const becomesMonitorBacked: boolean =
      isMethodWrite &&
      typeof writtenMethod === "string" &&
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(writtenMethod);

    if (becomesMonitorBacked) {
      updateBy.data.isPollingEnabled = false;
    }

    /*
     * Turning polling back ON is the other direction, and it has to be
     * refused rather than quietly ignored: claimDevicesForPolling skips
     * monitor-backed rows whatever this column says, so a device left with
     * the flag on would read "polling enabled" in the UI forever while
     * nothing ever polled it. Only checked when the payload actually asks
     * for it, so the ordinary update path costs no extra query.
     */
    if (
      !becomesMonitorBacked &&
      dataKeys.includes("isPollingEnabled") &&
      updateBy.data.isPollingEnabled === true
    ) {
      const targets: Array<Model> = await this.findBy({
        query: this.scopeQueryToCallerTenant(updateBy.query, updateBy.props),
        select: {
          _id: true,
          monitoringMethod: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const isTargetMonitorBacked: boolean = targets.some((target: Model) => {
        return NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
          target.monitoringMethod,
        );
      });

      // Unless the same write is moving it back to SNMP, which is allowed.
      if (isTargetMonitorBacked && !(isMethodWrite && !becomesMonitorBacked)) {
        throw new BadDataException(
          "This device is monitor-backed, so there is nothing to poll — it has no probe and no SNMP credentials. Switch its monitoring method to SNMP first.",
        );
      }
    }

    const isSiteChange: boolean = isSiteWrite(dataKeys);
    const isIdentityChange: boolean = SITE_RULE_IDENTITY_COLUMNS.some(
      (column: string) => {
        return dataKeys.includes(column);
      },
    );

    if (!isSiteChange && !isIdentityChange) {
      return { updateBy, carryForward: null };
    }

    const previousDevices: Array<Model> = await this.findBy({
      query: this.scopeQueryToCallerTenant(updateBy.query, updateBy.props),
      select: {
        _id: true,
        projectId: true,
        siteId: true,
        hostname: true,
        name: true,
        sysName: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const newSiteId: ObjectID | null = readSiteIdFromData(
      updateBy.data as unknown as Record<string, unknown>,
    );

    if (newSiteId) {
      const checkedProjectIds: Set<string> = new Set();

      for (const previousDevice of previousDevices) {
        if (
          !previousDevice.projectId ||
          checkedProjectIds.has(previousDevice.projectId.toString())
        ) {
          continue;
        }
        checkedProjectIds.add(previousDevice.projectId.toString());

        await this.assertSiteBelongsToProject({
          siteId: newSiteId,
          projectId: previousDevice.projectId,
        });
      }
    }

    return {
      updateBy,
      carryForward: {
        previousDevices: previousDevices,
      },
    };
  }

  /*
   * Re-derives one device's stamped `currentMonitorStatusId` from its
   * binding, and refreshes its site chain if the stamp moved.
   *
   * The stamp is what every monitor-backed surface reads — the device list
   * pill, the site rollup, the topology node — and until this existed the
   * ONLY thing that ever wrote it was
   * `NetworkSiteService.onMonitorStatusChanged`, which fires on a monitor's
   * next status CHANGE. Bind a device to a Ping monitor that is already Up
   * and staying Up and nothing writes the stamp at all, so the device sits
   * on "Pending" until the monitor happens to go down — which is
   * OneUptime/oneuptime#3392. Binding is itself an event that decides the
   * device's status, so it stamps here.
   *
   * `clearWhenNotMonitorBacked` is for the write that moves a device OFF
   * monitor-backed: the ping monitor's verdict must not outlive the binding
   * (DeviceHealthStateUtil lets a stamped status beat reachability, so a
   * stale one would poison the site rollup of a device that is now walked).
   * It is deliberately NOT set when a write only touches the monitor
   * binding of an SNMP device, because an SNMP device's stamp comes from
   * the Network Device monitor that watches it, and that binding lives in
   * the monitor's step data rather than in this column.
   */
  @CaptureSpan()
  public async refreshStampedMonitorStatus(data: {
    deviceId: ObjectID;
    clearWhenNotMonitorBacked: boolean;
  }): Promise<void> {
    const device: Model | null = await this.findOneById({
      id: data.deviceId,
      select: {
        _id: true,
        projectId: true,
        siteId: true,
        monitoringMethod: true,
        monitorId: true,
        currentMonitorStatusId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!device || !device.projectId) {
      return;
    }

    const isMonitorBacked: boolean =
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        device.monitoringMethod,
      );

    if (!isMonitorBacked && !data.clearWhenNotMonitorBacked) {
      return;
    }

    let monitorStatusId: ObjectID | null = null;

    if (isMonitorBacked && device.monitorId) {
      /*
       * Scoped to the device's project on the read as well as on the write
       * path in onBeforeCreate/onBeforeUpdate: a monitor from another
       * tenant must never be able to stamp a status here.
       */
      const monitor: Monitor | null = await MonitorService.findOneBy({
        query: {
          _id: device.monitorId,
          projectId: device.projectId,
        },
        select: {
          _id: true,
          currentMonitorStatusId: true,
        },
        props: {
          isRoot: true,
        },
      });

      monitorStatusId = monitor?.currentMonitorStatusId || null;
    }

    const currentStampId: string | null =
      device.currentMonitorStatusId?.toString() || null;
    const nextStampId: string | null = monitorStatusId?.toString() || null;

    if (currentStampId === nextStampId) {
      return;
    }

    await this.updateColumnsByIdWithoutHooks({
      id: data.deviceId,
      data: {
        currentMonitorStatusId: monitorStatusId,
      },
    });

    if (device.siteId) {
      await NetworkSiteService.recomputeRollupForSiteAndAncestors(
        device.siteId,
      );
    }
  }

  /*
   * Site maintenance after device updates. Resilient by design: a rollup
   * or rule-engine failure must never fail the device update itself.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Re-stamp before the site maintenance below, and in its own try: the
     * two are independent, and a rollup failure must not cost the device
     * its status (nor the other way round).
     */
    try {
      const dataKeys: Array<string> = Object.keys(onUpdate.updateBy.data || {});
      const isMethodWrite: boolean = dataKeys.includes("monitoringMethod");
      const isMonitorWrite: boolean = RelationIdUtil.isWritten(
        dataKeys,
        MONITOR_KEYS,
      );

      if (isMethodWrite || isMonitorWrite) {
        for (const deviceId of updatedItemIds) {
          await this.refreshStampedMonitorStatus({
            deviceId: deviceId,
            clearWhenNotMonitorBacked: isMethodWrite,
          });
        }
      }
    } catch (error) {
      logger.error(
        `Error in NetworkDeviceService.onUpdateSuccess monitor status refresh: ${error}`,
      );
    }

    try {
      const dataKeys: Array<string> = Object.keys(onUpdate.updateBy.data || {});

      if (isSiteWrite(dataKeys)) {
        // Manual or rule-driven site change: refresh old + new site chains.
        const affectedSiteIds: Map<string, ObjectID> = new Map();

        const previousDevices: Array<Model> =
          (onUpdate.carryForward?.previousDevices as Array<Model>) || [];

        /*
         * onUpdateSuccess runs even when the permission-scoped UPDATE matched
         * nothing, so only devices the UPDATE actually touched may drive
         * rollup writes.
         */
        const updatedIds: Set<string> = new Set(
          updatedItemIds.map((id: ObjectID) => {
            return id.toString();
          }),
        );

        for (const previousDevice of previousDevices) {
          if (
            !previousDevice.id ||
            !updatedIds.has(previousDevice.id.toString())
          ) {
            continue;
          }

          if (previousDevice.siteId) {
            affectedSiteIds.set(
              previousDevice.siteId.toString(),
              previousDevice.siteId,
            );
          }
        }

        const newSiteId: ObjectID | null = readSiteIdFromData(
          onUpdate.updateBy.data as unknown as Record<string, unknown>,
        );
        if (newSiteId && updatedItemIds.length > 0) {
          affectedSiteIds.set(newSiteId.toString(), newSiteId);
        }

        for (const siteId of affectedSiteIds.values()) {
          await NetworkSiteService.recomputeRollupForSiteAndAncestors(siteId);
        }
      } else if (
        SITE_RULE_IDENTITY_COLUMNS.some((column: string) => {
          return dataKeys.includes(column);
        })
      ) {
        /*
         * The device's address or name changed, so subnet/hostname rules may
         * now resolve differently — re-evaluate each updated device whose
         * identity actually moved (or that has no site yet).
         */
        const previousDevicesById: Map<string, Model> = new Map();

        const previousDevices: Array<Model> =
          (onUpdate.carryForward?.previousDevices as Array<Model>) || [];

        for (const previousDevice of previousDevices) {
          if (previousDevice.id) {
            previousDevicesById.set(
              previousDevice.id.toString(),
              previousDevice,
            );
          }
        }

        for (const deviceId of updatedItemIds) {
          const previousDevice: Model | undefined = previousDevicesById.get(
            deviceId.toString(),
          );

          if (
            previousDevice &&
            !this.shouldReapplySiteAssignmentRules(
              previousDevice,
              onUpdate.updateBy.data as Record<string, unknown>,
            )
          ) {
            continue;
          }

          await this.applySiteAssignmentRulesToDevice(deviceId);
        }
      }
    } catch (error) {
      logger.error(
        `Error in NetworkDeviceService.onUpdateSuccess site maintenance: ${error}`,
      );
    }

    return onUpdate;
  }

  /*
   * True when an update that touched an identity column is worth re-running
   * the assignment rules for.
   *
   * A device with no site is always re-evaluated: rules are usually written
   * (or corrected) after the devices were imported, and the SNMP walk is the
   * only thing that ever touches such a device again — without this, a
   * matching rule would never reach it. Assigning a site to a device that has
   * none cannot undo a human's choice.
   *
   * A device that already sits in a site is only re-evaluated when its
   * identity really changed, so the sysName the walk rewrites verbatim every
   * polling cycle does not keep dragging a manually placed device back to
   * whatever a rule prefers.
   */
  private shouldReapplySiteAssignmentRules(
    previousDevice: Model,
    data: Record<string, unknown>,
  ): boolean {
    if (!previousDevice.siteId) {
      return true;
    }

    const dataKeys: Array<string> = Object.keys(data || {});

    return SITE_RULE_IDENTITY_COLUMNS.some((column: string) => {
      if (!dataKeys.includes(column)) {
        return false;
      }

      return (
        normalizeIdentityValue(data[column]) !==
        normalizeIdentityValue((previousDevice as any)[column])
      );
    });
  }

  /*
   * Matches one device against the project's NetworkSiteAssignmentRules
   * (highest priority wins) and assigns the winning site. The assignment
   * goes through updateOneById so onUpdateSuccess refreshes the rollups of
   * both the old and the new site.
   */
  @CaptureSpan()
  public async applySiteAssignmentRulesToDevice(
    deviceId: ObjectID,
  ): Promise<void> {
    const device: Model | null = await this.findOneById({
      id: deviceId,
      select: {
        _id: true,
        projectId: true,
        siteId: true,
        hostname: true,
        sysName: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!device || !device.id || !device.projectId) {
      return;
    }

    const rules: Array<NetworkSiteAssignmentRule> =
      await NetworkSiteAssignmentRuleService.findBy({
        query: {
          projectId: device.projectId,
        },
        select: {
          _id: true,
          siteId: true,
          subnetCidr: true,
          hostnamePattern: true,
          priority: true,
          createdAt: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    if (rules.length === 0) {
      return;
    }

    /*
     * `name` is matched on as well as `hostname` because a discovery import
     * puts the responding IP in `hostname` and the device's real identity in
     * `name`, so a hostname pattern that only ever saw `hostname` could not
     * match anything a user recognises. See toRuleMatchTarget.
     */
    const winner: NetworkSiteAssignmentRule | null = CidrMatchUtil.pickRule(
      rules,
      toRuleMatchTarget(device),
    );

    if (!winner || !winner.siteId) {
      return;
    }

    if (
      device.siteId &&
      device.siteId.toString() === winner.siteId.toString()
    ) {
      return;
    }

    await this.updateOneById({
      id: device.id,
      data: {
        siteId: winner.siteId,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Runs ONE assignment rule against the devices that already exist, which is
   * the half the automatic path cannot do: rules only ever fire on create, on
   * an identity change, or on the next poll of a device that has no site, so
   * a rule written after the estate was imported would never reach it
   * (OneUptime/oneuptime#3191).
   *
   * Two rules of the automatic path are kept deliberately:
   *
   *   - priority still decides. A device this rule matches but a
   *     higher-priority rule also matches is REPORTED, not moved: running one
   *     rule must never quietly do another rule's work, or the button would
   *     produce a placement no rule alone explains.
   *   - a device already in a site is left alone unless the caller explicitly
   *     asks otherwise. Nothing records whether a site was chosen by a human
   *     or by a rule, so overwriting is the caller's decision to make, with
   *     the warning that goes with it — and it is not needed for the case the
   *     button exists for, since a device imported before the rule existed
   *     has no site at all.
   */
  @CaptureSpan()
  public async applySiteAssignmentRuleToExistingDevices(data: {
    ruleId: ObjectID;
    projectId: ObjectID;
    reassignDevicesAlreadyInASite: boolean;
  }): Promise<SiteAssignmentRuleRunResult> {
    /*
     * Every rule in the project, not just the one being run — pickRule needs
     * the whole set to answer "does something outrank this rule here?".
     * Loading them by project is also what scopes the run to the tenant: a
     * rule id from another project simply is not in this list.
     */
    const rules: Array<NetworkSiteAssignmentRule> =
      await NetworkSiteAssignmentRuleService.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
          siteId: true,
          subnetCidr: true,
          hostnamePattern: true,
          priority: true,
          createdAt: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const rule: NetworkSiteAssignmentRule | undefined = rules.find(
      (candidate: NetworkSiteAssignmentRule) => {
        return candidate._id?.toString() === data.ruleId.toString();
      },
    );

    if (!rule) {
      throw new BadDataException("Assignment rule not found.");
    }

    if (!rule.siteId) {
      throw new BadDataException(
        "This assignment rule has no site to assign devices to.",
      );
    }

    const ruleSiteId: ObjectID = rule.siteId;

    const result: SiteAssignmentRuleRunResult = {
      devicesEvaluated: 0,
      devicesMatched: 0,
      devicesAssigned: 0,
      devicesAlreadyInRuleSite: 0,
      devicesSkippedAlreadyInAnotherSite: 0,
      devicesClaimedByHigherPriorityRule: 0,
      devicesFailed: 0,
      isTruncated: false,
    };

    let skip: number = 0;

    for (;;) {
      const devices: Array<Model> = await this.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
          siteId: true,
          hostname: true,
          sysName: true,
          name: true,
        },
        /*
         * Sorted by id so paging stays stable while the run writes to the
         * very rows it is paging over. Assigning a site never changes an id,
         * so no device can be skipped or seen twice.
         */
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: RULE_RUN_PAGE_SIZE,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      if (devices.length === 0) {
        break;
      }

      for (const device of devices) {
        result.devicesEvaluated++;

        const target: ReturnType<typeof toRuleMatchTarget> =
          toRuleMatchTarget(device);

        if (!CidrMatchUtil.ruleMatches(rule, target)) {
          continue;
        }

        result.devicesMatched++;

        if (device.siteId?.toString() === ruleSiteId.toString()) {
          result.devicesAlreadyInRuleSite++;
          continue;
        }

        if (device.siteId && !data.reassignDevicesAlreadyInASite) {
          result.devicesSkippedAlreadyInAnotherSite++;
          continue;
        }

        const winner: NetworkSiteAssignmentRule | null = CidrMatchUtil.pickRule(
          rules,
          target,
        );

        if (winner?._id?.toString() !== rule._id?.toString()) {
          result.devicesClaimedByHigherPriorityRule++;
          continue;
        }

        /*
         * Counted as a failure rather than skipped silently: every matched
         * device has to land in exactly one bucket, or the summary the
         * operator reads would not add up.
         */
        if (!device.id) {
          result.devicesFailed++;
          continue;
        }

        /*
         * Through updateOneById, not a bulk UPDATE: onUpdateSuccess is what
         * refreshes the rollups of the site the device left and the site it
         * joined, and a raw write would leave both stale.
         */
        try {
          await this.updateOneById({
            id: device.id,
            data: {
              siteId: ruleSiteId,
            },
            props: {
              isRoot: true,
            },
          });

          result.devicesAssigned++;
        } catch (error) {
          // One unhappy device must not abandon the rest of the estate.
          result.devicesFailed++;
          logger.error(
            `Error assigning site from assignment rule ${data.ruleId.toString()} to device ${device.id.toString()}: ${error}`,
            {
              projectId: data.projectId.toString(),
              networkDeviceId: device.id.toString(),
            } as LogAttributes,
          );
        }
      }

      skip += devices.length;

      if (devices.length < RULE_RUN_PAGE_SIZE) {
        break;
      }

      if (skip >= MAX_DEVICES_PER_RULE_RUN) {
        /*
         * A full last page does not prove there is an eleventh thousand of
         * devices — an estate of exactly the cap would report a truncation
         * that never happened, and the UI would tell the user to run it
         * again forever. One row is enough to settle it.
         */
        const nextDevice: Array<Model> = await this.findBy({
          query: {
            projectId: data.projectId,
          },
          select: {
            _id: true,
          },
          sort: {
            _id: SortOrder.Ascending,
          },
          limit: 1,
          skip: skip,
          props: {
            isRoot: true,
          },
        });

        result.isTruncated = nextDevice.length > 0;
        break;
      }
    }

    return result;
  }

  /*
   * Atomically claims the devices this probe should poll now and advances
   * each device's nextPollAt by its own polling interval — the device-owned
   * twin of MonitorProbeService.claimMonitorProbesForProbing. FOR UPDATE
   * SKIP LOCKED keeps horizontally-scaled probe ingest instances from
   * handing the same device to two pollers.
   *
   * Suspended projects are skipped for the same reason monitor claiming
   * skips them; archived devices keep polling on purpose ("archived devices
   * keep collecting telemetry").
   */
  @CaptureSpan()
  public async claimDevicesForPolling(data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<ObjectID>> {
    const currentDate: Date = OneUptimeDate.getCurrentDate();

    const claimedIds: Array<ObjectID> = await this.executeTransaction(
      async (transactionalEntityManager: EntityManager) => {
        const selectQuery: string = `
        SELECT nd."_id", nd."pollingIntervalInMinutes"
        FROM "NetworkDevice" nd
        INNER JOIN "Project" p ON nd."projectId" = p."_id"
        WHERE nd."probeId" = $1
          AND nd."isPollingEnabled" = true
          AND nd."deletedAt" IS NULL
          AND nd."hostname" IS NOT NULL
          -- A monitor-backed device has no credentials to walk with. NULL is
          -- every device created before the column existed: those are SNMP.
          AND (nd."monitoringMethod" IS NULL OR nd."monitoringMethod" <> 'Monitor')
          AND (nd."nextPollAt" IS NULL OR nd."nextPollAt" <= $2)
          AND p."deletedAt" IS NULL
          AND (p."paymentProviderSubscriptionStatus" IS NULL
               OR p."paymentProviderSubscriptionStatus" IN ('active', 'trialing'))
          AND (p."paymentProviderMeteredSubscriptionStatus" IS NULL
               OR p."paymentProviderMeteredSubscriptionStatus" IN ('active', 'trialing'))
        ORDER BY nd."nextPollAt" ASC NULLS FIRST
        LIMIT $3
        FOR UPDATE OF nd SKIP LOCKED
      `;

        const selectedRows: Array<{
          _id: string;
          pollingIntervalInMinutes: number | null;
        }> = await transactionalEntityManager.query(selectQuery, [
          data.probeId.toString(),
          currentDate,
          data.limit,
        ]);

        if (selectedRows.length === 0) {
          return [];
        }

        const ids: Array<string> = [];
        const caseFragments: Array<string> = [];
        const parameters: Array<string | Date> = [];
        let parameterIndex: number = 1;

        for (const row of selectedRows) {
          /*
           * Guard the interval: NULL falls back to the 5-minute default,
           * and anything below 1 minute is clamped — a walk can take tens
           * of seconds, so sub-minute schedules would only stack up.
           */
          const intervalInMinutes: number = Math.max(
            row.pollingIntervalInMinutes || 5,
            1,
          );

          const nextPollAt: Date = OneUptimeDate.addRemoveMinutes(
            currentDate,
            intervalInMinutes,
          );

          ids.push(row._id);
          /*
           * ::timestamptz, not ::timestamp. node-postgres serialises a Date
           * parameter as local wall-clock digits plus an explicit offset; a
           * ::timestamp cast throws the offset away and the timestamptz
           * column then re-reads those digits in the Postgres session's
           * timezone. The claim query above compares nextPollAt without a
           * cast (correctly, as timestamptz), so writing it as timestamp
           * skews every schedule by the difference between the app's UTC
           * offset and the database session timezone — devices then get
           * re-polled on every cron tick, or not for hours.
           */
          caseFragments.push(
            `WHEN $${parameterIndex} THEN $${parameterIndex + 1}::timestamptz`,
          );
          parameters.push(row._id, nextPollAt);
          parameterIndex += 2;
        }

        const idPlaceholders: Array<string> = ids.map(
          (_id: string, index: number) => {
            return `$${parameterIndex + index}`;
          },
        );
        parameters.push(...ids);

        const updateQuery: string = `
        UPDATE "NetworkDevice"
        SET "nextPollAt" = CASE "_id" ${caseFragments.join(" ")} END
        WHERE "_id" IN (${idPlaceholders.join(", ")})
      `;

        await transactionalEntityManager.query(updateQuery, parameters);

        return ids.map((id: string) => {
          return new ObjectID(id);
        });
      },
    );

    return claimedIds;
  }
}

export default new Service();
