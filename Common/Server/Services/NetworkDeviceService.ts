import DatabaseService from "./DatabaseService";
import NetworkDeviceLabelRuleEngineService from "./NetworkDeviceLabelRuleEngineService";
import NetworkDeviceOwnerRuleEngineService from "./NetworkDeviceOwnerRuleEngineService";
import NetworkSiteAssignmentRuleService from "./NetworkSiteAssignmentRuleService";
import NetworkSiteService from "./NetworkSiteService";
import Model from "../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import NetworkSiteAssignmentRule from "../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import Query from "../Types/Database/Query";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import CidrMatchUtil from "../../Utils/NetworkSite/CidrMatchUtil";
import { EntityManager } from "typeorm";

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
    if (createBy.data.siteId) {
      await this.assertSiteBelongsToProject({
        siteId: createBy.data.siteId,
        projectId: createBy.data.projectId,
      });
    }

    return { createBy, carryForward: null };
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
          if (createdItem.siteId) {
            await NetworkSiteService.recomputeRollupForSiteAndAncestors(
              createdItem.siteId,
            );
          } else {
            await this.applySiteAssignmentRulesToDevice(createdItem.id!);
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
   * Capture the previous site of every matched device when an update
   * touches siteId, so onUpdateSuccess can refresh the OLD site's rollup
   * as well as the new one.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const dataKeys: Array<string> = Object.keys(updateBy.data || {});

    if (!dataKeys.includes("siteId")) {
      return { updateBy, carryForward: null };
    }

    const previousDevices: Array<Model> = await this.findBy({
      query: this.scopeQueryToCallerTenant(updateBy.query, updateBy.props),
      select: {
        _id: true,
        projectId: true,
        siteId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const newSiteIdValue: unknown = (updateBy.data as any)["siteId"];

    if (newSiteIdValue) {
      const newSiteId: ObjectID = new ObjectID(newSiteIdValue.toString());
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
   * Site maintenance after device updates. Resilient by design: a rollup
   * or rule-engine failure must never fail the device update itself.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    try {
      const dataKeys: Array<string> = Object.keys(onUpdate.updateBy.data || {});

      if (dataKeys.includes("siteId")) {
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

        const newSiteIdValue: unknown = (onUpdate.updateBy.data as any)[
          "siteId"
        ];
        if (newSiteIdValue && updatedItemIds.length > 0) {
          const newSiteId: ObjectID = new ObjectID(newSiteIdValue.toString());
          affectedSiteIds.set(newSiteId.toString(), newSiteId);
        }

        for (const siteId of affectedSiteIds.values()) {
          await NetworkSiteService.recomputeRollupForSiteAndAncestors(siteId);
        }
      } else if (dataKeys.includes("hostname")) {
        /*
         * The device's address changed, so subnet/hostname rules may now
         * resolve differently — re-evaluate each updated device.
         */
        for (const deviceId of updatedItemIds) {
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
     * The device's hostname column stores an IP address or a DNS name; pass
     * it as both — ipInCidr safely rejects non-IP strings.
     */
    const winner: NetworkSiteAssignmentRule | null = CidrMatchUtil.pickRule(
      rules,
      {
        ip: device.hostname,
        hostname: device.hostname,
        sysName: device.sysName,
      },
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
          caseFragments.push(
            `WHEN $${parameterIndex} THEN $${parameterIndex + 1}::timestamp`,
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
