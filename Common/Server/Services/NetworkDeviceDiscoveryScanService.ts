import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import ProbeService from "./ProbeService";
import Probe from "../../Models/DatabaseModels/Probe";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import ScanTargetUtil from "../../Utils/NetworkDiscovery/ScanTargetUtil";
import ScanNameUtil from "../../Utils/NetworkDiscovery/ScanNameUtil";
import { getNextScanAt } from "../../Utils/NetworkDiscovery/RescanIntervalUtil";

/*
 * The two spellings a many-to-one reference reaches a hook under: the
 * dashboard posts the relation object, server callers write the FK column.
 * See RelationIdUtil.
 */
const PROBE_RELATION_KEYS: Array<string> = ["probeId", "probe"];

/*
 * The columns that decide what the probe sweeps, and what it sweeps with.
 * Changing any of them means the results already on the row describe a sweep
 * that no longer exists — which is what onUpdateSuccess below acts on.
 *
 * `probe` is folded into `probeId` by RelationIdUtil rather than listed here,
 * because the same reference arrives under either name.
 */
const SWEEP_COLUMNS: Array<string> = [
  "cidr",
  "probeId",
  "snmpVersion",
  "snmpCommunityString",
  "snmpPort",
  "snmpV3SecurityLevel",
  "snmpV3Username",
  "snmpV3AuthProtocol",
  "snmpV3AuthKey",
  "snmpV3PrivProtocol",
  "snmpV3PrivKey",
];

/*
 * The numeric columns a form can hand back as an empty string.
 *
 * A Number field posts its value as text (Common/UI/Components/Forms/Fields/
 * FormField.tsx sets it straight from the input), so an operator who clears
 * the box sends "" — and "" into an integer column is a Postgres error, i.e. a
 * 500 where the operator simply meant "leave this unset". Clearing a box was
 * hard to do before these fields were editable, because a create form starts
 * them empty; an edit form starts them filled.
 */
const NULLABLE_NUMBER_COLUMNS: Array<string> = [
  "snmpPort",
  "rescanIntervalInMinutes",
];

/*
 * The columns that decide WHEN the scan runs again, and nothing else. They
 * never retire a result — they only re-derive nextScanAt.
 */
const SCHEDULE_COLUMNS: Array<string> = [
  "isRecurring",
  "rescanIntervalInMinutes",
];

/*
 * Everything a finished run left on the row. Written together, as one
 * statement, to put the scan back in the state a brand-new one is created in:
 * queued, with nothing to show yet.
 *
 * This is the same reset the requeue worker performs on a recurring scan that
 * is due (Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts) with
 * one deliberate difference: the results ARE cleared here. The worker keeps
 * them because a recurring scan re-runs the SAME sweep, so last run's
 * inventory is still the best answer available until the next one lands. A
 * scan whose target or credentials just changed has no such excuse — its
 * hosts came from somewhere the scan no longer points at.
 */
const RETIRE_RUN_PAYLOAD: Record<string, unknown> = {
  status: "Pending",
  /*
   * Not cleared but replaced, because the row has some explaining to do: the
   * operator saved a settings change and the scan's results vanished. The
   * scans list renders this sentence in the results cell of a scan that has
   * not reported (Dashboard Components/NetworkDevice/DiscoveryScanOutcome),
   * which is exactly where the missing results used to be. The claim endpoint
   * clears it the moment a probe picks the scan up.
   */
  statusMessage:
    "Settings changed, so this scan is queued to run again. The hosts the previous run found have been cleared - they described settings this scan no longer has.",
  startedAt: null,
  completedAt: null,
  nextScanAt: null,
  discoveredDevices: null,
  scannedHostCount: null,
  respondedHostCount: null,
  autoImportProcessedAt: null,
};

/*
 * The one thing onUpdateSuccess cannot work out for itself, because answering
 * it needs the values the update has already overwritten: did this save
 * actually change what the probe sweeps?
 *
 * Everything else it needs — the schedule, the run state — it re-reads from
 * the row afterwards rather than predicting from the payload. Predicting would
 * mean trusting the request's types (a number field posted as "60", a toggle
 * posted as "false"), and a schedule mis-read as "no cadence" silently
 * unschedules a recurring scan.
 */
interface ScanUpdatePlan {
  isSweepChanged: boolean;
  /*
   * Whether the save asked about the schedule at all. Only a save that did
   * gets its next run re-derived — so an edit that leaves the recurrence boxes
   * alone cannot move a scan the stale-scan reaper had made due immediately.
   */
  isScheduleWritten: boolean;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Validate the scan target at write time, with the same parser the probe
   * expands it with (Common/Utils/NetworkDiscovery/ScanTargetUtil).
   *
   * Without this, a typo'd target is accepted, sits Pending until a probe
   * claims it, and only surfaces minutes later as a Failed scan with the
   * parser's complaint buried in statusMessage. Octet-range notation makes
   * that far likelier than CIDR did — a reversed range ("10.22-16.0.1-20") or
   * an out-of-range octet is easy to type and impossible to spot by eye — so
   * the feedback belongs on the form, not on a scan result.
   *
   * The size ceiling is checked here too: an oversized target is rejected the
   * moment it is entered rather than after a probe has been handed a sweep it
   * refuses to run.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    this.validateScanTarget(createBy.data.cidr);

    /*
     * The name is normalized as well as validated — collapsed onto one line,
     * trimmed, and a blank one dropped entirely — so the column holds either a
     * name or nothing. An empty string stored here would read as a name to
     * every `scan.name ?` in the product and render as a blank line above the
     * scan target. See ScanNameUtil.
     */
    this.validateScanName(createBy.data.name);

    /*
     * Written through a cast because `exactOptionalPropertyTypes` forbids
     * assigning `undefined` to an optional property — and dropping a blank
     * name is exactly that assignment. Undefined rather than null: a model
     * instance starts with every column undefined, so this leaves the row in
     * the state a scan created without a name would already have been in.
     */
    (createBy.data as unknown as Record<string, unknown>)["name"] =
      ScanNameUtil.normalize(createBy.data.name) ?? undefined;

    this.nullEmptyNumbers(
      createBy.data as unknown as Record<string, unknown>,
      Object.keys(createBy.data || {}),
    );

    await this.validateProbeIsUsable({
      data: createBy.data as unknown as Record<string, unknown>,
      dataKeys: Object.keys(createBy.data || {}),
      projectId: createBy.data.projectId || createBy.props.tenantId,
    });

    return { createBy, carryForward: null };
  }

  /*
   * Everything that has to be true of an update before it is allowed to land,
   * plus the reading of the row that onUpdateSuccess needs and can no longer
   * take once the write has happened.
   *
   * Two classes of writer arrive here. The form, editing a scan's settings —
   * which is what this hook mostly exists for now (OneUptime issue #3444) —
   * and the server's own root writers: the probe-ingest endpoints, the
   * recurring-scan worker, migrations. The root writers carry only run-state
   * columns and take the cheap exit below without paying for a read.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Record<string, unknown> = (updateBy.data ||
      {}) as unknown as Record<string, unknown>;
    const dataKeys: Array<string> = Object.keys(data);

    if (dataKeys.includes("cidr")) {
      this.validateScanTarget(data["cidr"]);
    }

    /*
     * The name IS user-updatable — renaming a scan is the whole point of
     * letting it be named — so this path is the one the form actually takes,
     * not just a guard against root writers.
     *
     * Cleared with null rather than left as "": the form sends back an empty
     * box as an empty string, and the operator who emptied it meant "this scan
     * has no name", which is what NULL says. `undefined` would not do — the
     * key is present in the update, and an undefined value is a column TypeORM
     * would try to write.
     */
    if (dataKeys.includes("name")) {
      this.validateScanName(data["name"]);
      data["name"] = ScanNameUtil.normalize(data["name"]);
    }

    this.nullEmptyNumbers(data, dataKeys);

    const isSweepWritten: boolean =
      RelationIdUtil.isWritten(dataKeys, PROBE_RELATION_KEYS) ||
      SWEEP_COLUMNS.some((column: string) => {
        return dataKeys.includes(column);
      });

    const isScheduleWritten: boolean = SCHEDULE_COLUMNS.some(
      (column: string) => {
        return dataKeys.includes(column);
      },
    );

    /*
     * THE CHEAP EXIT, and it is load-bearing rather than an optimisation.
     *
     * Every server-side writer of this model touches run state only — the
     * claim writes status/startedAt/statusMessage, the result ingest writes
     * the results, the requeue worker and the stale-scan reaper write status
     * and timestamps, the unclaimed-diagnosis pass writes statusMessage. None
     * of them carries a sweep or schedule column, so none of them reads a row
     * here, and none can trip the reconciliation below into retiring the very
     * result it is in the middle of storing.
     *
     * `updateBy` is also handed back as the SAME object, which is what
     * Common/Tests/Server/Services/DiscoveryScanClaimHookFreeSafety.test.ts
     * pins: the claim's hook-free write is only safe while this hook is a
     * pass-through for the claim's payload.
     */
    if (!isSweepWritten && !isScheduleWritten) {
      return { updateBy, carryForward: null };
    }

    /*
     * Scoped by hand, because this hook runs BEFORE
     * ModelPermission.checkUpdateQueryPermissions and BaseAPI hands the
     * service a bare `{_id}` query — so reading with the caller's own query as
     * root, unscoped, would answer "does this id exist, and what are its
     * credentials" for every project on the instance. Same shape as
     * MonitorService.onBeforeUpdate.
     */
    const scans: Array<Model> = await this.findBy({
      query:
        !updateBy.props.isRoot && updateBy.props.tenantId
          ? { ...updateBy.query, projectId: updateBy.props.tenantId }
          : updateBy.query,
      select: {
        _id: true,
        projectId: true,
        cidr: true,
        probeId: true,
        snmpVersion: true,
        snmpCommunityString: true,
        snmpPort: true,
        snmpV3SecurityLevel: true,
        snmpV3Username: true,
        snmpV3AuthProtocol: true,
        snmpV3AuthKey: true,
        snmpV3PrivProtocol: true,
        snmpV3PrivKey: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    const plans: Record<string, ScanUpdatePlan> = {};

    for (const scan of scans) {
      const scanId: string | undefined = scan._id?.toString();

      if (!scanId) {
        continue;
      }

      /*
       * Checked per matched scan, because the answer depends on which project
       * the scan belongs to — and read from the row rather than from the
       * caller's tenant, so a root writer is held to the same rule.
       */
      await this.validateProbeIsUsable({
        data: data,
        dataKeys: dataKeys,
        projectId: scan.projectId,
      });

      plans[scanId] = {
        isSweepChanged: isSweepWritten
          ? this.hasSweepChanged(scan, data, dataKeys)
          : false,
        isScheduleWritten: isScheduleWritten,
      };
    }

    return { updateBy, carryForward: plans };
  }

  /*
   * Put the row back into a state that describes itself honestly.
   *
   * Two things can be wrong the moment a settings edit lands, and neither can
   * be fixed in the update itself: the columns that would fix them
   * (status, nextScanAt, the result columns) grant no update permission to
   * anybody, and ModelPermission checks the payload AFTER onBeforeUpdate has
   * run — so a payload carrying them would be refused for the very user doing
   * the editing. They are written here instead, as root, through the same
   * hook-free single-statement path the probe's claim uses.
   *
   *   1. A changed target, probe or credential leaves the row advertising
   *      hosts from a sweep that is no longer the sweep this scan describes:
   *      "12 of 254 hosts" beside a range it never visited, a Review Results
   *      dialog offering them for import under the new credentials, and an
   *      auto-import worker willing to create devices from them. The run is
   *      retired and the scan re-queued, so the probe simply sweeps again.
   *
   *   2. nextScanAt is derived state that only the result-ingest endpoint used
   *      to write. Turning recurrence ON for a scan that had already finished
   *      therefore scheduled nothing at all — the column stayed NULL, and the
   *      requeue worker's `nextScanAt <= now` is never true of NULL — so the
   *      list said "Every 60 min" over a scan that would never run again.
   *      Shortening the interval had the same shape of bug: the new cadence
   *      only took effect one full old cadence later.
   *
   * A known and deliberate gap: this is a second statement, so between the two
   * writes the row briefly holds the new settings with the old run state. Two
   * things can go wrong inside that window, both of them one database round
   * trip wide. A probe result landing there is stamped onto the new settings;
   * closing that needs the probe to echo a run identity back, which is a probe
   * protocol change. And if this write itself fails while the settings write
   * succeeded, the row keeps the new settings with the old results until the
   * next edit that actually changes something — the operator sees the error,
   * but re-saving the same values will not repair it, because by then nothing
   * has changed.
   *
   * Doing it FIRST instead, in onBeforeUpdate, would be worse rather than
   * better: that hook runs before the row-level gate as well, so a caller
   * whose update is about to be refused would have retired the scan on the way
   * through.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const plans: Record<string, ScanUpdatePlan> | null =
      (onUpdate.carryForward as Record<string, ScanUpdatePlan> | null) || null;

    if (!plans) {
      return onUpdate;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    for (const itemId of updatedItemIds) {
      const plan: ScanUpdatePlan | undefined = plans[itemId.toString()];

      if (!plan) {
        continue;
      }

      /*
       * Nothing to do at all: the save named a setting but changed none of
       * them, and never mentioned the schedule.
       */
      if (!plan.isSweepChanged && !plan.isScheduleWritten) {
        continue;
      }

      /*
       * The row as it stands now that the update has landed. Read rather than
       * predicted from the payload: the schedule columns are what the next run
       * is derived from, and reading them back means the derivation sees the
       * values the DATABASE holds — properly typed — instead of whatever
       * shape the request happened to send them in.
       */
      const scan: Model | null = await this.findOneById({
        id: itemId,
        select: {
          status: true,
          isRecurring: true,
          rescanIntervalInMinutes: true,
          completedAt: true,
          nextScanAt: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      // Hard-deleted between the write and this read. Nothing to reconcile.
      if (!scan) {
        continue;
      }

      const reconcile: Record<string, unknown> = plan.isSweepChanged
        ? { ...RETIRE_RUN_PAYLOAD }
        : {};

      /*
       * For a retired run the state to derive from is the queued one written
       * just above, not the finished one the row still shows.
       */
      const nextScanAt: Date | null = getNextScanAt(
        {
          isRecurring: scan.isRecurring,
          rescanIntervalInMinutes: scan.rescanIntervalInMinutes,
          status: plan.isSweepChanged ? "Pending" : scan.status,
          completedAt: plan.isSweepChanged ? null : scan.completedAt,
        },
        now,
      );

      if (!this.isSameMoment(nextScanAt, scan.nextScanAt)) {
        reconcile["nextScanAt"] = nextScanAt;
      }

      if (Object.keys(reconcile).length === 0) {
        continue;
      }

      await this.updateColumnsByIdWithoutHooks({
        id: itemId,
        // Cast: the model's JSON column makes DeepPartial recursion blow up.
        data: reconcile as unknown as QueryDeepPartialEntity<Model>,
      });
    }

    return onUpdate;
  }

  /*
   * Whether this update actually changes what the probe would sweep.
   *
   * VALUE comparison, never key presence: ModelForm posts every field it
   * declares on every save, dirty or not, so an operator who opened Edit and
   * pressed Save without typing sends the whole sweep back verbatim. Keyed on
   * presence, that would retire a good result set on every no-op save.
   */
  private hasSweepChanged(
    scan: Model,
    data: Record<string, unknown>,
    dataKeys: Array<string>,
  ): boolean {
    if (RelationIdUtil.isWritten(dataKeys, PROBE_RELATION_KEYS)) {
      const probeId: ObjectID | null = RelationIdUtil.read(
        data,
        PROBE_RELATION_KEYS,
      );

      if (probeId?.toString() !== scan.probeId?.toString()) {
        return true;
      }
    }

    for (const column of SWEEP_COLUMNS) {
      if (column === "probeId" || !dataKeys.includes(column)) {
        continue;
      }

      if (
        this.normalizeSweepValue(data[column]) !==
        this.normalizeSweepValue(
          (scan as unknown as Record<string, unknown>)[column],
        )
      ) {
        return true;
      }
    }

    return false;
  }

  /*
   * The probe a scan is pointed at has to be one this project may actually use
   * — its own, or a global one.
   *
   * The scan is dispatched by probe id alone: the claim endpoint hands a
   * Pending scan to whichever probe authenticates as that id, with no project
   * check of its own, and the results are written back onto this row. So a
   * scan pointing at ANOTHER project's probe is a scan that makes that
   * project's probe sweep its own network and report the hosts it finds into
   * this one. The ids are not guessable and the probe list is tenant-scoped,
   * so this is a lock rather than a repair — but it is the lock that has to
   * exist now that the column can be re-pointed after creation, and it is
   * applied on create for the same reason.
   *
   * A probe with no project is a global probe and is available to everyone.
   */
  private async validateProbeIsUsable(input: {
    data: Record<string, unknown>;
    dataKeys: Array<string>;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    if (!RelationIdUtil.isWritten(input.dataKeys, PROBE_RELATION_KEYS)) {
      return;
    }

    /*
     * readConsistent, not read: a payload that points the FK column and the
     * relation object at two different probes must be refused rather than
     * validated against whichever one TypeORM happens to persist.
     */
    const probeId: ObjectID | null = RelationIdUtil.readConsistent(
      input.data,
      PROBE_RELATION_KEYS,
      "Probe",
    );

    /*
     * probeId is NOT NULL, so a payload that names the probe and resolves to
     * nothing is an operator clearing the box. Without this it reaches
     * Postgres as a constraint violation — a 500 where the truthful answer is
     * a 400 with a sentence in it.
     */
    if (!probeId) {
      throw new BadDataException(
        "A discovery scan needs a probe to run it. Pick the probe that can reach this address range.",
      );
    }

    // Nothing to compare against; the write itself is still tenant-checked.
    if (!input.projectId) {
      return;
    }

    const probe: Probe | null = await ProbeService.findOneById({
      id: probeId,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!probe) {
      throw new BadDataException(
        "That probe could not be found. Pick a probe that can reach this address range.",
      );
    }

    if (
      probe.projectId &&
      probe.projectId.toString() !== input.projectId.toString()
    ) {
      throw new BadDataException(
        "That probe belongs to another project. Pick one of this project's probes, or a global probe.",
      );
    }
  }

  /*
   * An emptied number box means "unset", not "the empty string".
   *
   * Written in place, like the name normalization above, so the value the rest
   * of the pipeline sees is the value that will be stored.
   */
  private nullEmptyNumbers(
    data: Record<string, unknown>,
    dataKeys: Array<string>,
  ): void {
    for (const column of NULLABLE_NUMBER_COLUMNS) {
      if (!dataKeys.includes(column)) {
        continue;
      }

      const value: unknown = data[column];

      if (typeof value === "string" && value.trim() === "") {
        data[column] = null;
      }
    }
  }

  /*
   * A sweep column's value as a comparable string.
   *
   * An empty box and an unset column are the SAME setting and must compare
   * equal, or a V3 scan — whose community string is NULL in the database and
   * "" in the form — would read as changed on the first save and retire its
   * own results. Numbers are compared as numbers so the port arriving as the
   * string "161" from a form field does not read as a change either.
   */
  private normalizeSweepValue(value: unknown): string {
    if (value === undefined || value === null || value === "") {
      return "";
    }

    if (typeof value === "number") {
      return String(value);
    }

    if (typeof value === "string") {
      return value.trim();
    }

    return String(value);
  }

  /*
   * Two nullable timestamps, compared by the instant they name. The stored
   * value comes back from Postgres and the derived one is built here, so a
   * strict equality between the two objects is never true even when the moment
   * is identical, and every no-op save would write the column again.
   */
  private isSameMoment(
    left: Date | null | undefined,
    right: Date | null | undefined,
  ): boolean {
    if (!left || !right) {
      return !left && !right;
    }

    return (
      OneUptimeDate.fromString(left).getTime() ===
      OneUptimeDate.fromString(right).getTime()
    );
  }

  /*
   * The value is passed through UNTOUCHED. It arrives straight from the
   * request JSON — BaseAPI assigns ShortText columns verbatim, and this hook
   * runs before the model's type and length checks — so it may be a number,
   * an object or an array, not just a string. ScanTargetUtil already type-
   * guards and trims internally; normalizing here (the obvious
   * `(target || "").trim()`) would instead throw a TypeError on any truthy
   * non-string and turn an intended 400 into a 500.
   */
  private validateScanTarget(target: unknown): void {
    const validationError: string | null = ScanTargetUtil.getValidationError(
      target as string,
    );

    if (validationError) {
      throw new BadDataException(validationError);
    }
  }

  /*
   * Same contract as validateScanTarget above: the value is passed through
   * untouched, because it arrives straight from the request JSON and may be a
   * number, an object or an array rather than a string. ScanNameUtil type-
   * guards internally and reports a non-string as such.
   *
   * An ABSENT or blank name is not an error — the column is optional, and a
   * scan with no name reads as it always did, by its target.
   */
  private validateScanName(name: unknown): void {
    const validationError: string | null =
      ScanNameUtil.getValidationError(name);

    if (validationError) {
      throw new BadDataException(validationError);
    }
  }
}

export default new Service();
