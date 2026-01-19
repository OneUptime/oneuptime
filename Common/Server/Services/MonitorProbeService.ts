import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import MonitorProbe from "../../Models/DatabaseModels/MonitorProbe";
import QueryHelper from "../Types/Database/QueryHelper";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import MonitorService from "./MonitorService";
import CronTab from "../Utils/CronTab";
import logger from "../Utils/Logger";
import PostgresAppInstance from "../Infrastructure/PostgresDatabase";
import { DataSource, EntityManager } from "typeorm";

export class Service extends DatabaseService<MonitorProbe> {
  public constructor() {
    super(MonitorProbe);
  }

  public async updateNextPingAtForMonitor(data: {
    monitorId: ObjectID;
  }): Promise<void> {
    const monitorProbes: Array<MonitorProbe> = await this.findBy({
      query: {
        monitorId: data.monitorId,
      },
      select: {
        nextPingAt: true,
        probeId: true,
        monitor: {
          monitoringInterval: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const monitorProbe of monitorProbes) {
      if (!monitorProbe.probeId) {
        continue;
      }

      let nextPing: Date = OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        1,
      );

      try {
        nextPing = CronTab.getNextExecutionTime(
          monitorProbe?.monitor?.monitoringInterval as string,
        );
      } catch (err) {
        logger.error(err);
      }

      if (nextPing && monitorProbe.id) {
        await this.updateOneById({
          id: monitorProbe.id,
          data: {
            nextPingAt: nextPing,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  /**
   * Atomically claims monitor probes for a specific probe instance.
   * Uses PostgreSQL's FOR UPDATE SKIP LOCKED to prevent multiple probe instances
   * from picking up the same monitors simultaneously.
   *
   * @param data - Object containing probeId, limit, and nextPingAt
   * @returns Array of claimed MonitorProbe IDs
   */
  public async claimMonitorProbesForProbing(data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<ObjectID>> {
    const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new BadDataException("Database connection not available");
    }

    const currentDate: Date = OneUptimeDate.getCurrentDate();

    /*
     * Use a transaction with FOR UPDATE SKIP LOCKED to atomically claim monitors
     * This prevents multiple probe instances from picking up the same monitors
     */
    const claimedIds: Array<ObjectID> = await dataSource.transaction(
      async (transactionalEntityManager: EntityManager) => {
        /*
         * First, select and lock the monitor probes that need to be processed
         * FOR UPDATE SKIP LOCKED ensures that:
         * 1. Rows are locked for this transaction
         * 2. Rows already locked by other transactions are skipped
         */
        const selectQuery: string = `
        SELECT mp."_id"
        FROM "MonitorProbe" mp
        INNER JOIN "Monitor" m ON mp."monitorId" = m."_id"
        INNER JOIN "Project" p ON mp."projectId" = p."_id"
        WHERE mp."probeId" = $1
          AND mp."isEnabled" = true
          AND mp."deletedAt" IS NULL
          AND (mp."nextPingAt" IS NULL OR mp."nextPingAt" <= $2)
          AND m."disableActiveMonitoring" = false
          AND m."disableActiveMonitoringBecauseOfManualIncident" = false
          AND m."disableActiveMonitoringBecauseOfScheduledMaintenanceEvent" = false
          AND m."deletedAt" IS NULL
          AND p."deletedAt" IS NULL
          AND (p."paymentProviderSubscriptionStatus" IS NULL
               OR p."paymentProviderSubscriptionStatus" IN ('active', 'trialing'))
          AND (p."paymentProviderMeteredSubscriptionStatus" IS NULL
               OR p."paymentProviderMeteredSubscriptionStatus" IN ('active', 'trialing'))
        ORDER BY mp."nextPingAt" ASC NULLS FIRST
        LIMIT $3
        FOR UPDATE OF mp SKIP LOCKED
      `;

        const selectedRows: Array<{ _id: string }> =
          await transactionalEntityManager.query(selectQuery, [
            data.probeId.toString(),
            currentDate,
            data.limit,
          ]);

        if (selectedRows.length === 0) {
          return [];
        }

        const ids: Array<string> = selectedRows.map((row: { _id: string }) => {
          return row._id;
        });

        /*
         * Update the claimed monitors to set nextPingAt to 1 minute from now
         * This is a temporary value; the actual nextPingAt will be calculated
         * based on the monitor's interval after the probe fetches the full details
         */
        const tempNextPingAt: Date = OneUptimeDate.addRemoveMinutes(
          currentDate,
          1,
        );

        const updateQuery: string = `
        UPDATE "MonitorProbe"
        SET "lastPingAt" = $1, "nextPingAt" = $2
        WHERE "_id" = ANY($3::uuid[])
      `;

        await transactionalEntityManager.query(updateQuery, [
          currentDate,
          tempNextPingAt,
          ids,
        ]);

        return ids.map((id: string) => {
          return new ObjectID(id);
        });
      },
    );

    return claimedIds;
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<MonitorProbe>,
  ): Promise<OnCreate<MonitorProbe>> {
    if (
      (createBy.data.monitorId || createBy.data.monitor) &&
      (createBy.data.probeId || createBy.data.probe)
    ) {
      const monitorProbe: MonitorProbe | null = await this.findOneBy({
        query: {
          monitorId: createBy.data.monitorId! || createBy.data.monitor?.id,
          probeId: createBy.data.probeId! || createBy.data.probe?.id,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (monitorProbe) {
        throw new BadDataException("Probe is already added to this monitor.");
      }
    }

    if (!createBy.data.nextPingAt) {
      createBy.data.nextPingAt = OneUptimeDate.getCurrentDate();
    }

    if (!createBy.data.lastPingAt) {
      createBy.data.lastPingAt = OneUptimeDate.getCurrentDate();
    }

    return { createBy, carryForward: null };
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<MonitorProbe>,
    createdItem: MonitorProbe,
  ): Promise<MonitorProbe> {
    if (createdItem.probeId) {
      await MonitorService.refreshProbeStatus(createdItem.probeId);
    }

    return Promise.resolve(createdItem);
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<MonitorProbe>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<MonitorProbe>> {
    // if isEnabled is updated, refresh the probe status
    if (onUpdate.updateBy.data.isEnabled !== undefined) {
      const monitorProbes: Array<MonitorProbe> = await this.findBy({
        query: {
          _id: QueryHelper.any(updatedItemIds),
        },
        select: {
          monitorId: true,
          probeId: true,
          nextPingAt: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const monitorProbe of monitorProbes) {
        if (!monitorProbe.probeId) {
          continue;
        }

        await MonitorService.refreshProbeStatus(monitorProbe.probeId);
      }
    }

    return onUpdate;
  }
}

export default new Service();
