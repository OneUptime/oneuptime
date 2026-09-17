import DatabaseService, { EntityManager } from "./DatabaseService";
import Model from "../../Models/DatabaseModels/NetworkDeviceDiagnostic";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "./NetworkDeviceService";
import ProbeService from "./ProbeService";
import { OnCreate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import BadDataException from "../../Types/Exception/BadDataException";
import ColumnLength from "../../Types/Database/ColumnLength";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { NetworkDeviceDiagnosticTypeUtil } from "../../Types/NetworkDevice/NetworkDeviceDiagnosticType";
import {
  NetworkDeviceDiagnosticStatus,
  isNetworkDeviceDiagnosticSettled,
} from "../../Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import {
  NETWORK_DEVICE_DIAGNOSTIC_CLAIM_WINDOW_IN_MINUTES,
  NETWORK_DEVICE_DIAGNOSTIC_RETENTION_IN_DAYS,
  NetworkDeviceDiagnosticReport,
} from "../../Types/NetworkDevice/NetworkDeviceDiagnosticResult";

/*
 * The two spellings a many-to-one reference reaches a hook under: the
 * dashboard posts the relation object, server callers write the FK column.
 * See RelationIdUtil, and NetworkDevicePollingTenancy.test.ts for the guard
 * that was skipped when only one spelling was read.
 */
const NETWORK_DEVICE_RELATION_KEYS: Array<string> = [
  "networkDeviceId",
  "networkDevice",
];
const PROBE_RELATION_KEYS: Array<string> = ["probeId", "probe"];
const PROJECT_RELATION_KEYS: Array<string> = ["projectId", "project"];

/*
 * What a finished (or failed) run writes. Cleared on create so a row can
 * never START with a result: the probe's raw-SQL report is the only writer
 * of these, and the dashboard reads a Completed status as "there is a
 * result to render".
 */
const RESULT_COLUMNS: Array<string> = [
  "statusMessage",
  "pingResult",
  "traceRouteResult",
  "startedAt",
  "completedAt",
];

/*
 * Rows affected by a raw UPDATE, read defensively.
 *
 * For an UPDATE the postgres driver hands TypeORM's `manager.query` back
 * `[rows, rowCount]` rather than a bare row array. The statements below add
 * `RETURNING "_id"`, so a driver that returns the bare array instead still
 * yields one row per updated diagnostic and the count is right either way.
 * Anything unrecognisable reads as zero: a report that may not have landed
 * must never be acknowledged as one that did.
 */
function readAffectedRowCount(result: unknown): number {
  if (!Array.isArray(result)) {
    return 0;
  }

  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[1];
  }

  return result.length;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    /*
     * Transient data, like MonitorTest rows: the answer matters for the
     * minutes somebody is looking at it.
     */
    this.hardDeleteItemsOlderThanInDays(
      "createdAt",
      NETWORK_DEVICE_DIAGNOSTIC_RETENTION_IN_DAYS,
    );
  }

  /*
   * Fill in everything the probe needs from the device, and refuse anything
   * the probe could not run.
   *
   * The dashboard posts only a device and a type. The hostname is copied
   * here rather than joined at claim time so the probe is handed the address
   * the operator was looking at; the probe defaults to the device's assigned
   * one. Both lookups are made as root and scoped by hand, because this hook
   * runs BEFORE the create's permission check — reading the device with the
   * caller's tenant is what stops a diagnostic in project A from being run
   * against a device in project B by guessing its id.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    const networkDeviceId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      NETWORK_DEVICE_RELATION_KEYS,
      "Network Device",
    );

    if (!networkDeviceId) {
      throw new BadDataException(
        "Network Device is required to run a diagnostic.",
      );
    }

    if (
      !NetworkDeviceDiagnosticTypeUtil.isValid(createBy.data.diagnosticType)
    ) {
      throw new BadDataException(
        `Diagnostic type must be one of: ${NetworkDeviceDiagnosticTypeUtil.getAllTypes().join(", ")}.`,
      );
    }

    /*
     * DatabaseService._onBeforeCreate has already copied props.tenantId into
     * data.projectId before this hook runs, and create() stamps it again
     * afterwards; a root/service caller may pass neither, so read the column
     * first and fall back to props.tenantId. The relation spelling
     * (data.project) is what a client can still point elsewhere, so it is
     * checked here — readConsistent refuses a relation that disagrees with
     * the stamped column — and cleared below.
     */
    const callerProjectId: ObjectID | undefined =
      RelationIdUtil.readConsistent(data, PROJECT_RELATION_KEYS, "Project") ||
      createBy.props.tenantId ||
      undefined;

    const device: NetworkDevice | null = await NetworkDeviceService.findOneById(
      {
        id: networkDeviceId,
        select: {
          _id: true,
          projectId: true,
          hostname: true,
          probeId: true,
          isArchived: true,
        },
        props: { isRoot: true },
      },
    );

    /*
     * A device in another project answers exactly as a device that does not
     * exist: the error must not confirm that the guessed id is real.
     */
    if (
      !device ||
      (callerProjectId &&
        device.projectId &&
        device.projectId.toString() !== callerProjectId.toString())
    ) {
      throw new BadDataException("Network Device not found.");
    }

    if (device.isArchived) {
      throw new BadDataException(
        "This device is archived. Restore it to run diagnostics.",
      );
    }

    const hostname: string = (device.hostname || "").trim();

    if (!hostname) {
      throw new BadDataException(
        "This device has no hostname or IP address to reach.",
      );
    }

    const projectId: ObjectID | undefined = device.projectId || callerProjectId;

    const explicitProbeId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      PROBE_RELATION_KEYS,
      "Probe",
    );

    const probeId: ObjectID | null = explicitProbeId || device.probeId || null;

    if (!probeId) {
      throw new BadDataException(
        "This device has no probe assigned. Assign one under Device → Settings and try again.",
      );
    }

    /*
     * The device's own probe was checked when it was assigned
     * (NetworkDeviceService). A probe the CALLER named arrives from the
     * browser and would read the device's hostname, so it gets the same
     * tenancy check here — failing closed when there is no project to check
     * against, which a NOT NULL projectId makes unreachable in practice.
     */
    if (explicitProbeId) {
      const isAttachable: boolean = projectId
        ? await ProbeService.isProbeAttachableToProject({
            probeId: explicitProbeId,
            projectId: projectId,
          })
        : false;

      if (!isAttachable) {
        throw new BadDataException(
          "Probe not found or it does not belong to this project.",
        );
      }
    }

    if (!createBy.data.projectId && projectId) {
      createBy.data.projectId = projectId;
    }

    /*
     * The relation spelling goes now that the checked id sits in the FK
     * column (which create() stamps with the tenant again). TypeORM derives
     * the join column from the relation when both are set, so leaving a
     * `project` object behind would let it, not the column this hook
     * validated, decide which project the row lands in.
     */
    data["project"] = undefined;

    createBy.data.networkDeviceId = networkDeviceId;
    createBy.data.hostname = hostname;
    createBy.data.probeId = probeId;
    createBy.data.status = NetworkDeviceDiagnosticStatus.Pending;

    /*
     * A caller that posted `probe: null` meant "no preference", and the
     * device's probe was chosen above. The relation object has to go, not
     * just the FK: TypeORM derives the join column from the relation when
     * both are set, and null there would persist as NULL over the probeId
     * this hook just chose.
     */
    if (data["probe"] === null) {
      data["probe"] = undefined;
    }

    /*
     * `undefined` rather than null, through a cast because
     * exactOptionalPropertyTypes forbids the assignment: an undefined column
     * is simply not written, which leaves the row in the state a brand-new
     * model instance already has — and is what ColumnPermission skips, so a
     * client that posted a result column is corrected rather than refused.
     */
    for (const column of RESULT_COLUMNS) {
      data[column] = undefined;
    }

    return { createBy, carryForward: null };
  }

  /*
   * Atomically claims this probe's Pending diagnostics, oldest first, and
   * marks them In Progress. FOR UPDATE SKIP LOCKED so concurrent replicas of
   * the same probe never run the same diagnostic — the shape
   * MonitorTestService.claimMonitorTestsForProbing uses.
   *
   * Rows older than the claim window are left alone: whoever asked for them
   * has long since stopped waiting (the dashboard gives up after two
   * minutes), so running them would spend the probe's time on an answer
   * nobody reads. Retention deletes them later.
   */
  @CaptureSpan()
  public async claimPendingForProbe(data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<ObjectID>> {
    const claimWindowStart: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -NETWORK_DEVICE_DIAGNOSTIC_CLAIM_WINDOW_IN_MINUTES,
    );

    return await this.executeTransaction(
      async (transactionalEntityManager: EntityManager) => {
        const selectQuery: string = `
          SELECT d."_id"
          FROM "NetworkDeviceDiagnostic" d
          WHERE d."probeId" = $1
            AND d."status" = $4
            AND d."createdAt" >= $3
            AND d."deletedAt" IS NULL
          ORDER BY d."createdAt" ASC
          LIMIT $2
          FOR UPDATE OF d SKIP LOCKED
        `;

        const selectedRows: Array<{ _id: string }> =
          await transactionalEntityManager.query(selectQuery, [
            data.probeId.toString(),
            data.limit,
            claimWindowStart,
            NetworkDeviceDiagnosticStatus.Pending,
          ]);

        if (!Array.isArray(selectedRows) || selectedRows.length === 0) {
          return [];
        }

        const ids: Array<string> = selectedRows.map((row: { _id: string }) => {
          return row._id;
        });

        const updateQuery: string = `
          UPDATE "NetworkDeviceDiagnostic"
          SET "status" = $2,
              "startedAt" = now(),
              "updatedAt" = now()
          WHERE "_id" = ANY($1::uuid[])
        `;

        await transactionalEntityManager.query(updateQuery, [
          ids,
          NetworkDeviceDiagnosticStatus.InProgress,
        ]);

        return ids.map((id: string) => {
          return new ObjectID(id);
        });
      },
    );
  }

  /*
   * Store what the probe reported for one diagnostic.
   *
   * One parameterized UPDATE, keyed on the row's id AND the reporting probe:
   * the probe id comes from the authenticated request, never the body, so a
   * probe can only ever settle diagnostics that were handed to it. A row
   * that is already Completed is never overwritten — a late duplicate must
   * not replace the result the dashboard has already rendered — but a Failed
   * one may be, so a probe that failed and then managed a run can correct
   * itself.
   *
   * Returns whether a row was updated. False means the id is unknown, was
   * claimed by a different probe, or is already Completed; the ingest route
   * turns that into a 400 rather than a silent 200.
   */
  @CaptureSpan()
  public async recordReport(data: {
    probeId: ObjectID;
    report: NetworkDeviceDiagnosticReport;
  }): Promise<boolean> {
    const report: NetworkDeviceDiagnosticReport = data.report;

    if (!report || !report.networkDeviceDiagnosticId) {
      throw new BadDataException("networkDeviceDiagnosticId is required.");
    }

    if (!isNetworkDeviceDiagnosticSettled(report.status)) {
      throw new BadDataException(
        `A diagnostic report must be "${NetworkDeviceDiagnosticStatus.Completed}" or "${NetworkDeviceDiagnosticStatus.Failed}", not "${String(report.status)}".`,
      );
    }

    return await this.executeTransaction(
      async (transactionalEntityManager: EntityManager) => {
        const updateQuery: string = `
          UPDATE "NetworkDeviceDiagnostic"
          SET "status" = $3,
              "statusMessage" = $4,
              "pingResult" = $5::jsonb,
              "traceRouteResult" = $6::jsonb,
              "completedAt" = now(),
              "updatedAt" = now()
          WHERE "_id" = $1
            AND "probeId" = $2
            AND "deletedAt" IS NULL
            AND "status" <> $7
          RETURNING "_id"
        `;

        const result: unknown = await transactionalEntityManager.query(
          updateQuery,
          [
            report.networkDeviceDiagnosticId.toString(),
            data.probeId.toString(),
            report.status,
            /*
             * Raw SQL bypasses DatabaseService.checkMaxLengthOfFields, and
             * Postgres rejects a value longer than the varchar column — which
             * would leave the row In Progress forever. Cut the probe's text
             * to the column's declared length instead.
             */
            report.statusMessage
              ? report.statusMessage.substring(0, ColumnLength.LongText)
              : null,
            report.pingResult ? JSON.stringify(report.pingResult) : null,
            report.traceRouteResult
              ? JSON.stringify(report.traceRouteResult)
              : null,
            NetworkDeviceDiagnosticStatus.Completed,
          ],
        );

        return readAffectedRowCount(result) > 0;
      },
    );
  }
}

export default new Service();
