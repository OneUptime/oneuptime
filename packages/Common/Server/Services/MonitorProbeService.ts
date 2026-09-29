import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService, { EntityManager } from "./DatabaseService";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import MonitorProbe from "../../Models/DatabaseModels/MonitorProbe";
import Monitor from "../../Models/DatabaseModels/Monitor";
import QueryHelper from "../Types/Database/QueryHelper";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import MonitorService from "./MonitorService";
import ProbeService from "./ProbeService";
import { MonitorTypeHelper } from "../../Types/Monitor/MonitorType";
import CronTab from "../Utils/CronTab";
import logger, { EXTERNAL_FAULT, LogAttributes } from "../Utils/Logger";
import { SubscriptionStatusUtil } from "../../Types/Billing/SubscriptionStatus";
import MonitoringIntervalValidator from "../Utils/Monitor/MonitoringIntervalValidator";

export class Service extends DatabaseService<MonitorProbe> {
  public constructor() {
    super(MonitorProbe);
  }

  /**
   * The next time a monitor with this interval is due, or `fallback`.
   *
   * Exported on the class (and covered directly by tests) because both
   * scheduling paths — the batch claim query and the single-monitor refresh
   * after an edit — have to agree about what a stored interval means. They
   * did not before: the claim query swallowed a parse failure silently and
   * fell back to one minute, so a monitor asking for five minutes was probed
   * four times more often than requested, indefinitely and invisibly.
   *
   * Order is load-bearing. cron-parser gets the RAW value first, so the
   * thousands of rows that were always valid take a byte-identical path and
   * anything the parser understands but our grammar does not ("@hourly") is
   * still honoured. Only when that fails do we try to read the value as a
   * human cadence ("5m", "Every 5 minutes"), which is what makes those rows
   * schedule correctly on deploy — before the data migration has run, and
   * for any row that later arrives through a hook-free write or a restore.
   */
  public static resolveNextPingAt(data: {
    monitoringInterval: string | null | undefined;
    fallback: Date;
    onUnreadable?: (() => void) | undefined;
  }): Date {
    if (!data.monitoringInterval) {
      return data.fallback;
    }

    try {
      return CronTab.getNextExecutionTime(data.monitoringInterval);
    } catch {
      // Not a cron expression. Try to read it as a human cadence instead.
    }

    const normalizedCron: string | null =
      MonitoringIntervalValidator.normalizeForRead(data.monitoringInterval);

    if (normalizedCron) {
      try {
        return CronTab.getNextExecutionTime(normalizedCron);
      } catch {
        // Normalizer produced something cron-parser rejects. Report it.
      }
    }

    if (data.onUnreadable) {
      data.onUnreadable();
    }

    return data.fallback;
  }

  public async pruneStaleLastMonitoringLogEntries(data: {
    monitorId: ObjectID;
    validMonitorStepIds: Array<string>;
  }): Promise<void> {
    const validIdSet: Set<string> = new Set(data.validMonitorStepIds);

    const monitorProbes: Array<MonitorProbe> = await this.findBy({
      query: {
        monitorId: data.monitorId,
      },
      select: {
        _id: true,
        lastMonitoringLog: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const monitorProbe of monitorProbes) {
      if (!monitorProbe.id || !monitorProbe.lastMonitoringLog) {
        continue;
      }

      const existingLog: Record<string, unknown> =
        monitorProbe.lastMonitoringLog as unknown as Record<string, unknown>;
      const existingKeys: Array<string> = Object.keys(existingLog);
      const prunedLog: Record<string, unknown> = {};
      let removedAny: boolean = false;

      for (const key of existingKeys) {
        if (validIdSet.has(key)) {
          prunedLog[key] = existingLog[key];
        } else {
          removedAny = true;
        }
      }

      if (!removedAny) {
        continue;
      }

      await this.updateOneById({
        id: monitorProbe.id,
        data: {
          lastMonitoringLog: prunedLog as any,
        },
        props: {
          isRoot: true,
        },
      });
    }
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

      /*
       * The falsy guard matters: a Manual monitor (and every other row with
       * no interval) reaches here with undefined, and the old unguarded call
       * handed that straight to cron-parser, which threw and logged an error
       * for a perfectly ordinary row on every single interval edit.
       */
      const nextPing: Date = Service.resolveNextPingAt({
        monitoringInterval: monitorProbe?.monitor?.monitoringInterval,
        fallback: OneUptimeDate.addRemoveMinutes(
          OneUptimeDate.getCurrentDate(),
          1,
        ),
        onUnreadable: () => {
          logger.error(
            `updateNextPingAtForMonitor: monitoringInterval "${monitorProbe?.monitor?.monitoringInterval}" cannot be read as a schedule; falling back to a 1-minute cadence.`,
            {
              ...EXTERNAL_FAULT,
              monitorId: data.monitorId?.toString(),
            } as LogAttributes,
          );
        },
      });

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
    const currentDate: Date = OneUptimeDate.getCurrentDate();

    /*
     * Use a transaction with FOR UPDATE SKIP LOCKED to atomically claim monitors
     * This prevents multiple probe instances from picking up the same monitors
     */
    const claimedIds: Array<ObjectID> = await this.executeTransaction(
      async (transactionalEntityManager: EntityManager) => {
        /*
         * Select and lock the monitor probes that need to be processed,
         * including the monitoringInterval so we can compute the real nextPingAt
         * in a single UPDATE (avoiding a second round-trip).
         * FOR UPDATE SKIP LOCKED ensures that:
         * 1. Rows are locked for this transaction
         * 2. Rows already locked by other transactions are skipped
         *
         * The subscription predicate admits a project with no subscription
         * (NULL) or one whose status is in
         * SubscriptionStatusUtil.getActiveSubscriptionStatuses(), bound as $4
         * rather than spelled out here. This SQL used to carry its own
         * hand-written active / trialing list, which left out past_due: a
         * project stopped being probed the moment ONE autopay attempt failed
         * - including while an India e-mandate card debit was merely still
         * processing - even though Stripe keeps retrying a past_due invoice
         * and the dashboard still called the project active. Paying
         * customers' monitoring was silently switched off. Monitoring now
         * stops only when the subscription is truly inactive (unpaid,
         * canceled, incomplete, incomplete_expired, expired, paused).
         */
        const activeSubscriptionStatuses: Array<string> =
          SubscriptionStatusUtil.getActiveSubscriptionStatuses();

        const selectQuery: string = `
        SELECT mp."_id", m."monitoringInterval"
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
               OR p."paymentProviderSubscriptionStatus" = ANY($4::text[]))
          AND (p."paymentProviderMeteredSubscriptionStatus" IS NULL
               OR p."paymentProviderMeteredSubscriptionStatus" = ANY($4::text[]))
        ORDER BY mp."nextPingAt" ASC NULLS FIRST
        LIMIT $3
        FOR UPDATE OF mp SKIP LOCKED
      `;

        const selectedRows: Array<{
          _id: string;
          monitoringInterval: string | null;
        }> = await transactionalEntityManager.query(selectQuery, [
          data.probeId.toString(),
          currentDate,
          data.limit,
          activeSubscriptionStatuses,
        ]);

        if (selectedRows.length === 0) {
          return [];
        }

        // Compute the real nextPingAt per monitor and batch-update in one query
        const defaultNextPing: Date = OneUptimeDate.addRemoveMinutes(
          currentDate,
          1,
        );

        const ids: Array<string> = [];
        const nextPingDates: Array<Date> = [];
        const caseFragments: Array<string> = [];

        /*
         * Rows whose interval neither cron-parser nor the normalizer could
         * read. Collected and logged ONCE per batch below rather than per
         * row: this loop runs for every claimed monitor, every minute, on
         * every probe-ingest instance, so a per-row log line would flood.
         */
        const unreadableIntervals: Array<{
          monitorProbeId: string;
          monitoringInterval: string;
        }> = [];

        for (let i: number = 0; i < selectedRows.length; i++) {
          const row: { _id: string; monitoringInterval: string | null } =
            selectedRows[i]!;
          ids.push(row._id);

          let nextPing: Date = defaultNextPing;
          if (row.monitoringInterval) {
            nextPing = Service.resolveNextPingAt({
              monitoringInterval: row.monitoringInterval,
              fallback: defaultNextPing,
              onUnreadable: () => {
                unreadableIntervals.push({
                  monitorProbeId: row._id,
                  monitoringInterval: row.monitoringInterval as string,
                });
              },
            });
          }

          nextPingDates.push(nextPing);
          caseFragments.push(
            `WHEN '${row._id}'::uuid THEN $${i + 3}::timestamptz`,
          );
        }

        /*
         * One aggregated line per batch, at error level with EXTERNAL_FAULT.
         *
         * Not debug: LOG_LEVEL=ERROR is what ships, so a debug or warn line
         * here is deleted from stdout on exactly the installs where an
         * operator would go looking. This condition used to be swallowed by
         * a bare `catch {}`, which is why a monitor storing "5m" was probed
         * every minute instead of every five for as long as the row existed,
         * with nothing anywhere to grep for. EXTERNAL_FAULT marks it as
         * tenant data rather than our own failure, so it does not page us.
         */
        if (unreadableIntervals.length > 0) {
          logger.error(
            `claimMonitorProbesForProbing: ${unreadableIntervals.length} monitor(s) have a monitoringInterval that cannot be read as a schedule and are falling back to a 1-minute cadence. Fix the stored value - "*/5 * * * *" means every 5 minutes. Offenders: ${JSON.stringify(
              unreadableIntervals.slice(0, 20),
            )}`,
            EXTERNAL_FAULT,
          );
        }

        const updateQuery: string = `
        UPDATE "MonitorProbe"
        SET "lastPingAt" = $1,
            "nextPingAt" = CASE "_id" ${caseFragments.join(" ")} END
        WHERE "_id" = ANY($2::uuid[])
      `;

        await transactionalEntityManager.query(updateQuery, [
          currentDate,
          ids,
          ...nextPingDates,
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

    /*
     * The probe id on a create comes straight from the browser (the
     * Monitor > Probes table posts it), so it has to be checked against the
     * tenant exactly like the monitor-create path does - otherwise another
     * project's probe can be attached to this monitor.
     */
    const probeId: ObjectID | undefined | null =
      createBy.data.probeId || createBy.data.probe?.id;
    const projectId: ObjectID | undefined | null =
      createBy.data.projectId || createBy.data.project?.id;

    if (probeId && projectId) {
      const isProbeAttachable: boolean =
        await ProbeService.isProbeAttachableToProject({
          probeId: probeId,
          projectId: projectId,
        });

      if (!isProbeAttachable) {
        throw new BadDataException(
          "Probe not found or it does not belong to this project.",
        );
      }
    }

    // Check if the monitor type supports probes
    const monitorId: ObjectID | undefined | null =
      createBy.data.monitorId || createBy.data.monitor?.id;

    if (monitorId) {
      const monitor: Monitor | null = await MonitorService.findOneById({
        id: monitorId,
        select: {
          monitorType: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (
        monitor?.monitorType &&
        !MonitorTypeHelper.isProbableMonitor(monitor.monitorType)
      ) {
        throw new BadDataException(
          "Probes cannot be added to this monitor type.",
        );
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
    /*
     * Refresh only the monitor this probe was just added to. Do NOT call
     * refreshProbeStatus(probeId) here: a global/shared probe can be attached
     * to thousands of monitors, and refreshing every one of them on a single
     * create storms the database and can 500 the request.
     */
    if (createdItem.monitorId) {
      await this.refreshMonitorStatusSafely(createdItem.monitorId);
    }

    return Promise.resolve(createdItem);
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<MonitorProbe>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<MonitorProbe>> {
    // if isEnabled is updated, refresh the status of the affected monitors.
    if (onUpdate.updateBy.data.isEnabled !== undefined) {
      const monitorProbes: Array<MonitorProbe> = await this.findBy({
        query: {
          _id: QueryHelper.any(updatedItemIds),
        },
        select: {
          monitorId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const monitorProbe of monitorProbes) {
        if (!monitorProbe.monitorId) {
          continue;
        }

        /*
         * Refresh only the monitor whose probe row changed. Do NOT call
         * refreshProbeStatus(probeId) here: a global/shared probe can be
         * attached to thousands of monitors, and refreshing all of them on a
         * single enable/disable toggle storms the database and 500s the
         * request (the row itself is already saved by this point).
         */
        await this.refreshMonitorStatusSafely(monitorProbe.monitorId);
      }
    }

    return onUpdate;
  }

  /*
   * Removing a probe from a monitor changes the same aggregate that adding one
   * or toggling isEnabled changes - Monitor.isNoProbeEnabledOnThisMonitor and
   * isAllProbesDisconnectedFromThisMonitor. Without these hooks, deleting the
   * last probe left the monitor claiming it was still being watched: no
   * "Probes Not Enabled" banner and no owner notification, even though nothing
   * was monitoring it any more.
   *
   * The monitorIds have to be read before the delete, because after it the
   * rows are gone.
   */
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<MonitorProbe>,
  ): Promise<OnDelete<MonitorProbe>> {
    const itemsToDelete: Array<MonitorProbe> = await this.findBy({
      query: deleteBy.query,
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      select: {
        monitorId: true,
      },
      props: {
        isRoot: true,
      },
    });

    return {
      deleteBy,
      carryForward: {
        monitorIds: itemsToDelete
          .map((item: MonitorProbe) => {
            return item.monitorId;
          })
          .filter((monitorId: ObjectID | undefined) => {
            return Boolean(monitorId);
          }) as Array<ObjectID>,
      },
    };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<MonitorProbe>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<MonitorProbe>> {
    const monitorIds: Array<ObjectID> =
      (onDelete.carryForward?.monitorIds as Array<ObjectID>) || [];

    const refreshedMonitorIds: Set<string> = new Set();

    for (const monitorId of monitorIds) {
      // A bulk delete can touch the same monitor many times over.
      if (refreshedMonitorIds.has(monitorId.toString())) {
        continue;
      }

      refreshedMonitorIds.add(monitorId.toString());

      await this.refreshMonitorStatusSafely(monitorId);
    }

    return onDelete;
  }

  /*
   * Refresh a single monitor's aggregate probe status without letting a
   * failure bubble up. These refreshes run in post-commit hooks
   * (onCreateSuccess / onUpdateSuccess / onDeleteSuccess) after the
   * MonitorProbe row is already persisted, so a status-refresh error must not
   * turn a successful save into a 500 for the user — log it instead.
   */
  private async refreshMonitorStatusSafely(monitorId: ObjectID): Promise<void> {
    try {
      await MonitorService.refreshMonitorProbeStatus(monitorId);
    } catch (err) {
      logger.error(err);
    }
  }
}

export default new Service();
