import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import ProjectReferencesService, {
  ProjectReferenceWrite,
} from "./ProjectReferencesService";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../Models/DatabaseModels/MonitorProbe";
import { JSONObject } from "../../Types/JSON";
import MonitorRecordEvidence from "../Utils/Monitor/MonitorRecordEvidence";
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

/*
 * How many due rows claimMonitorProbesForProbing reads for each one it may
 * claim: the rows it reads are not locked, so another ingest instance
 * claiming for the same probe at the same moment may take some of them
 * first, and the rest still fill the batch.
 */
export const CLAIM_CANDIDATES_PER_MONITOR_PROBE: number = 2;

export class Service extends ProjectReferencesService<MonitorProbe> {
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

  /*
   * Atomically claims the monitor probes this probe should check now, and
   * moves each one's nextPingAt to its monitor's next scheduled run.
   * SKIP LOCKED keeps horizontally-scaled probe ingest instances (and a
   * probe running as several replicas) from handing one monitor out twice.
   *
   * Two auto-committed statements, never a transaction (OneUptime issue
   * #7194, where the network device twin of this claim did the damage). The
   * claim used to SELECT ... FOR UPDATE up to `limit` rows, work out each
   * one's next run in Node - a cron read per row - then UPDATE and COMMIT,
   * so every claimed row stayed locked across those round trips and for as
   * long as a loaded app took to get back to the connection. A probe
   * result being stored for one of those monitors (MonitorResource's
   * lastMonitoringLog write) queued behind the lock, and past lock_timeout
   * failed its whole job.
   *
   * Now: (1) the due rows are read without a lock - more of them than
   * asked for, CLAIM_CANDIDATES_PER_MONITOR_PROBE times `limit`, so a probe
   * replica racing another one for the same rows still finds rows to
   * claim; (2) each one's next run is worked out in Node, once per distinct
   * interval; (3) one statement claims up to `limit` of them - only rows
   * nobody else holds (FOR NO KEY UPDATE SKIP LOCKED, the lock its UPDATE
   * takes anyway) and that are still due when it locks them: a row another
   * instance claimed in between has a nextPingAt in the future by then and
   * is passed over. Postgres releases the locks when that statement ends,
   * whatever the app is doing.
   *
   * The subscription predicate admits a project with no subscription (NULL)
   * or one whose status is in
   * SubscriptionStatusUtil.getActiveSubscriptionStatuses(), bound as $4
   * rather than spelled out here. This SQL used to carry its own
   * hand-written active / trialing list, which left out past_due: a project
   * stopped being probed the moment ONE autopay attempt failed - including
   * while an India e-mandate card debit was merely still processing - even
   * though Stripe keeps retrying a past_due invoice and the dashboard still
   * called the project active. Paying customers' monitoring was silently
   * switched off. Monitoring now stops only when the subscription is truly
   * inactive (unpaid, canceled, incomplete, incomplete_expired, expired,
   * paused).
   *
   * A project a master admin blocked (Project.isBlocked) is not probed at
   * all until it is unblocked, as ProjectService's
   * getActiveProjectStatusQuery says for every other monitoring path.
   *
   * Returns the ids of the MonitorProbe rows it claimed.
   */
  public async claimMonitorProbesForProbing(data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<ObjectID>> {
    const currentDate: Date = OneUptimeDate.getCurrentDate();
    const activeSubscriptionStatuses: Array<string> =
      SubscriptionStatusUtil.getActiveSubscriptionStatuses();

    const candidateQuery: string = `
        SELECT mp."_id", m."monitoringInterval"
        FROM "MonitorProbe" mp
        INNER JOIN "Monitor" m ON mp."monitorId" = m."_id"
        INNER JOIN "Project" p ON mp."projectId" = p."_id"
        WHERE mp."probeId" = $1
          AND mp."isEnabled" = true
          AND mp."deletedAt" IS NULL
          AND (mp."nextPingAt" IS NULL OR mp."nextPingAt" <= $2)
          AND m."isArchived" = false
          AND m."disableActiveMonitoring" = false
          AND m."disableActiveMonitoringBecauseOfManualIncident" = false
          AND m."disableActiveMonitoringBecauseOfScheduledMaintenanceEvent" = false
          AND m."deletedAt" IS NULL
          AND p."deletedAt" IS NULL
          AND p."isBlocked" = false
          AND p."isSampleProject" = false
          AND (p."paymentProviderSubscriptionStatus" IS NULL
               OR p."paymentProviderSubscriptionStatus" = ANY($4::text[]))
          AND (p."paymentProviderMeteredSubscriptionStatus" IS NULL
               OR p."paymentProviderMeteredSubscriptionStatus" = ANY($4::text[]))
        ORDER BY mp."nextPingAt" ASC NULLS FIRST
        LIMIT $3
      `;

    const candidateRows: unknown = await this.getRepository().manager.query(
      candidateQuery,
      [
        data.probeId.toString(),
        currentDate,
        data.limit * CLAIM_CANDIDATES_PER_MONITOR_PROBE,
        activeSubscriptionStatuses,
      ],
    );

    const candidates: Array<{
      _id: string;
      monitoringInterval: string | null;
    }> = Array.isArray(candidateRows) ? candidateRows : [];

    if (candidates.length === 0) {
      return [];
    }

    const defaultNextPing: Date = OneUptimeDate.addRemoveMinutes(
      currentDate,
      1,
    );

    /*
     * One cron read per distinct interval, however many monitors share it;
     * an interval that cannot be read is remembered as such.
     */
    const nextPingByInterval: Map<string, Date | null> = new Map<
      string,
      Date | null
    >();

    /*
     * Rows whose interval neither cron-parser nor the normalizer could
     * read. Collected and logged ONCE per batch below rather than per row:
     * this runs for every claimed monitor, every minute, on every
     * probe-ingest instance, so a per-row log line would flood.
     */
    const unreadableIntervals: Array<{
      monitorProbeId: string;
      monitoringInterval: string;
    }> = [];

    const ids: Array<string> = [];
    const nextPingAts: Array<string> = [];

    for (const row of candidates) {
      let nextPing: Date = defaultNextPing;

      if (row.monitoringInterval) {
        const interval: string = row.monitoringInterval;

        if (!nextPingByInterval.has(interval)) {
          let isUnreadable: boolean = false;

          const resolved: Date = Service.resolveNextPingAt({
            monitoringInterval: interval,
            fallback: defaultNextPing,
            onUnreadable: () => {
              isUnreadable = true;
            },
          });

          nextPingByInterval.set(interval, isUnreadable ? null : resolved);
        }

        const known: Date | null | undefined = nextPingByInterval.get(interval);

        if (known) {
          nextPing = known;
        } else {
          unreadableIntervals.push({
            monitorProbeId: row._id,
            monitoringInterval: interval,
          });
        }
      }

      ids.push(row._id);
      // ISO strings: an array of them reads as timestamptz[] unambiguously.
      nextPingAts.push(nextPing.toISOString());
    }

    /*
     * One aggregated line per batch, at error level with EXTERNAL_FAULT.
     *
     * Not debug: LOG_LEVEL=ERROR is what ships, so a debug or warn line
     * here is deleted from stdout on exactly the installs where an operator
     * would go looking. This condition used to be swallowed by a bare
     * `catch {}`, which is why a monitor storing "5m" was probed every
     * minute instead of every five for as long as the row existed, with
     * nothing anywhere to grep for. EXTERNAL_FAULT marks it as tenant data
     * rather than our own failure, so it does not page us.
     */
    if (unreadableIntervals.length > 0) {
      logger.error(
        `claimMonitorProbesForProbing: ${unreadableIntervals.length} monitor(s) have a monitoringInterval that cannot be read as a schedule and are falling back to a 1-minute cadence. Fix the stored value - "*/5 * * * *" means every 5 minutes. Offenders: ${JSON.stringify(
          unreadableIntervals.slice(0, 20),
        )}`,
        EXTERNAL_FAULT,
      );
    }

    const claimQuery: string = `
        WITH "claimable" AS (
          SELECT mp."_id"
          FROM "MonitorProbe" mp
          WHERE mp."_id" = ANY($2::uuid[])
            AND mp."probeId" = $4
            AND mp."isEnabled" = true
            AND mp."deletedAt" IS NULL
            AND (mp."nextPingAt" IS NULL OR mp."nextPingAt" <= $1::timestamptz)
          ORDER BY mp."nextPingAt" ASC NULLS FIRST
          LIMIT $5
          FOR NO KEY UPDATE OF mp SKIP LOCKED
        ),
        "claimed" AS (
          UPDATE "MonitorProbe" AS mp
          SET "lastPingAt" = $1::timestamptz,
              "nextPingAt" = schedule."nextPingAt"
          FROM unnest($2::uuid[], $3::timestamptz[])
            AS schedule("id", "nextPingAt")
          WHERE mp."_id" = schedule."id"
            AND mp."_id" IN (SELECT "_id" FROM "claimable")
          RETURNING mp."_id"
        )
        SELECT "_id" FROM "claimed"
      `;

    /*
     * A SELECT of the rows the UPDATE wrote, so the answer is those rows:
     * TypeORM hands a top-level UPDATE ... RETURNING back as
     * [rows, rowCount] instead.
     */
    const claimedRows: unknown = await this.getRepository().manager.query(
      claimQuery,
      [currentDate, ids, nextPingAts, data.probeId.toString(), data.limit],
    );

    if (!Array.isArray(claimedRows)) {
      return [];
    }

    return claimedRows.map((row: { _id: string }) => {
      return new ObjectID(row._id);
    });
  }

  /*
   * On a create the probe is checked below with
   * ProbeService.isProbeAttachableToProject: the project's own probes and the
   * global ones, in one answer for an id from another project and one that
   * matches nothing. Nobody can change a monitor probe's probe (the column
   * takes no update); an update naming one gets the generic check, which
   * counts the global probes as the project's too.
   */
  protected override getRelationsCheckedByService(
    write?: ProjectReferenceWrite,
  ): Array<string> {
    return write?.kind === "update" ? [] : ["probe"];
  }

  /*
   * A probe's latest check is kept as the probe sent it: probe agreement
   * judges it again against the criteria (MonitorResource
   * .checkProbeAgreement), and a filter on the body needs the body. Everyone
   * else reads it cut as the monitor's logs are (MonitorRecordEvidence) -
   * the Probes page, the monitor's overview, the API - so every read that is
   * not OneUptime's own gets the redacted copy.
   */
  protected override async onFindSuccess(
    onFind: OnFind<MonitorProbe>,
    items: Array<MonitorProbe>,
  ): Promise<OnFind<MonitorProbe>> {
    if (!onFind.findBy.props.isRoot) {
      await this.redactLastChecksForReaders(items);
    }

    return { ...onFind, carryForward: items };
  }

  private async redactLastChecksForReaders(
    items: Array<MonitorProbe>,
  ): Promise<void> {
    const rows: Array<MonitorProbe> = items.filter(
      (item: MonitorProbe): boolean => {
        return Boolean(
          item.lastMonitoringLog &&
            typeof item.lastMonitoringLog === "object" &&
            Object.keys(item.lastMonitoringLog).length > 0,
        );
      },
    );

    if (rows.length === 0) {
      return;
    }

    // Each row's monitor: its switch and its steps decide what is shown.
    const monitorIdOfRow: Map<MonitorProbe, string> = new Map();
    const rowsWithoutMonitorId: Array<MonitorProbe> = [];

    for (const row of rows) {
      const monitorId: string | undefined =
        row.monitorId?.toString() || row.monitor?.id?.toString();

      if (monitorId) {
        monitorIdOfRow.set(row, monitorId);
      } else if (row.id) {
        rowsWithoutMonitorId.push(row);
      }
    }

    // A read that did not select the monitor's id still gets its monitor's rules.
    if (rowsWithoutMonitorId.length > 0) {
      const found: Array<MonitorProbe> = await this.findBy({
        query: {
          _id: QueryHelper.any(
            rowsWithoutMonitorId.map((row: MonitorProbe): ObjectID => {
              return row.id!;
            }),
          ),
        },
        select: {
          _id: true,
          monitorId: true,
        },
        limit: rowsWithoutMonitorId.length,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const monitorIdOfRowId: Map<string, string> = new Map();

      for (const item of found) {
        if (item.id && item.monitorId) {
          monitorIdOfRowId.set(item.id.toString(), item.monitorId.toString());
        }
      }

      for (const row of rowsWithoutMonitorId) {
        const monitorId: string | undefined = monitorIdOfRowId.get(
          row.id!.toString(),
        );

        if (monitorId) {
          monitorIdOfRow.set(row, monitorId);
        }
      }
    }

    const monitorIds: Array<string> = Array.from(
      new Set<string>(monitorIdOfRow.values()),
    );

    const monitors: Array<Monitor> =
      monitorIds.length > 0
        ? await MonitorService.findBy({
            query: {
              _id: QueryHelper.any(
                monitorIds.map((id: string): ObjectID => {
                  return new ObjectID(id);
                }),
              ),
            },
            select: {
              _id: true,
              keepResponseContent: true,
              monitorSteps: true,
            },
            limit: monitorIds.length,
            skip: 0,
            props: {
              isRoot: true,
            },
          })
        : [];

    const monitorById: Map<string, Monitor> = new Map();

    for (const monitor of monitors) {
      if (monitor.id) {
        monitorById.set(monitor.id.toString(), monitor);
      }
    }

    for (const row of rows) {
      const monitorId: string | undefined = monitorIdOfRow.get(row);

      row.lastMonitoringLog = MonitorRecordEvidence.redactLastChecks({
        lastChecks: row.lastMonitoringLog as unknown as JSONObject,
        monitor: monitorId ? monitorById.get(monitorId) : undefined,
      }) as unknown as MonitorStepProbeResponse;
    }
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<MonitorProbe>,
  ): Promise<OnCreate<MonitorProbe>> {
    await super.onBeforeCreate(createBy);

    const createData: Record<string, unknown> =
      createBy.data as unknown as Record<string, unknown>;

    /*
     * The monitor, the probe and the project, each under either of its names:
     * the two must agree (RelationIdUtil.readConsistent), so the probe
     * checked below is the probe attached.
     */
    const monitorId: ObjectID | null = RelationIdUtil.readConsistent(
      createData,
      ["monitorId", "monitor"],
      "Monitor",
    );
    const probeId: ObjectID | null = RelationIdUtil.readConsistent(
      createData,
      ["probeId", "probe"],
      "Probe",
    );
    const projectId: ObjectID | null = RelationIdUtil.readConsistent(
      createData,
      ["projectId", "project"],
      "Project",
    );

    if (monitorId && probeId) {
      const monitorProbe: MonitorProbe | null = await this.findOneBy({
        query: {
          monitorId: monitorId,
          probeId: probeId,
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
    // The rows the delete removes, and the delete held to them.
    const itemsToDelete: Array<MonitorProbe> =
      await this.findRowsAndHoldDeleteToThem(deleteBy, {
        monitorId: true,
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
