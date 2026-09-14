import Alert from "../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import Model from "../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import PartialEntity from "../../Types/Database/PartialEntity";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../Utils/Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AlertService from "./AlertService";
import AlertSeverityService from "./AlertSeverityService";
import AlertStateTimelineService from "./AlertStateTimelineService";
import DatabaseService from "./DatabaseService";
import IncidentService from "./IncidentService";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentStateTimelineService from "./IncidentStateTimelineService";

const THRESHOLD_ERROR_MESSAGE: string =
  "Burn rate threshold must be greater than 0.";
const WINDOWS_REQUIRED_ERROR_MESSAGE: string =
  "Long window and short window are required for a burn rate rule.";
const WINDOWS_NOT_NUMERIC_ERROR_MESSAGE: string =
  "Long window and short window must be a number of minutes.";
export const NO_OUTPUT_ERROR_MESSAGE: string =
  "A burn rate rule must create an alert, declare an incident, or both.";

/*
 * Mirrors the column defaults on the model. Every rule that predates incident
 * support raised an alert and declared nothing, so that is what an unset
 * payload still means.
 */
const DEFAULT_SHOULD_CREATE_ALERT: boolean = true;
const DEFAULT_SHOULD_CREATE_INCIDENT: boolean = false;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Deterministic fingerprint carried on everything a burn rate rule
   * declares — the Alert it raises, the Incident it declares, or both. The
   * evaluation worker sets it as `seriesFingerprint` when the rule fires, and
   * lifecycle hooks use it to find (and resolve) those records when the rule
   * or its SLO goes away.
   *
   * One fingerprint serves both because Alert and Incident are separate
   * tables: a rule can have at most one open Alert and one open Incident, and
   * each dedupe query is already scoped to its own table.
   */
  public getBurnRateFingerprint(data: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
  }): string {
    return `slo:${data.serviceLevelObjectiveId.toString()}:burn-rule:${data.burnRateRuleId.toString()}`;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * Every numeric column can arrive as a string: the dashboard's number
     * fields hand Formik `e.target.value`, ModelForm copies it verbatim and
     * BaseModel.fromJSON does not coerce Number/Decimal columns. Comparing
     * those strings is lexicographic ("1440" <= "60" is true), so coerce
     * first, then validate, then write the number back onto the payload so
     * Postgres never sees a string either.
     */
    createBy.data.burnRateThreshold = this.validateBurnRateThreshold(
      createBy.data.burnRateThreshold,
    );

    if (
      createBy.data.longWindowInMinutes === undefined ||
      createBy.data.longWindowInMinutes === null ||
      createBy.data.shortWindowInMinutes === undefined ||
      createBy.data.shortWindowInMinutes === null
    ) {
      throw new BadDataException(WINDOWS_REQUIRED_ERROR_MESSAGE);
    }

    const windows: {
      longWindowInMinutes: number;
      shortWindowInMinutes: number;
    } = this.validateWindows({
      longWindowInMinutes: createBy.data.longWindowInMinutes,
      shortWindowInMinutes: createBy.data.shortWindowInMinutes,
    });

    createBy.data.longWindowInMinutes = windows.longWindowInMinutes;
    createBy.data.shortWindowInMinutes = windows.shortWindowInMinutes;

    if (
      createBy.data.minimumSampleCount !== undefined &&
      createBy.data.minimumSampleCount !== null
    ) {
      createBy.data.minimumSampleCount = this.validateMinimumSampleCount(
        createBy.data.minimumSampleCount,
      );
    }

    if (
      createBy.data.refireSuppressionMinutes !== undefined &&
      createBy.data.refireSuppressionMinutes !== null
    ) {
      createBy.data.refireSuppressionMinutes =
        this.validateRefireSuppressionMinutes(
          createBy.data.refireSuppressionMinutes,
        );
    }

    /*
     * What the rule declares. Both are written back explicitly — leaving them
     * off would let Postgres apply the column default, which is right for a
     * fresh create but hides the decision from the row that the update hook
     * later reads back.
     */
    const shouldCreateAlert: boolean = this.normalizeBooleanInput(
      createBy.data.shouldCreateAlert,
      DEFAULT_SHOULD_CREATE_ALERT,
    );
    const shouldCreateIncident: boolean = this.normalizeBooleanInput(
      createBy.data.shouldCreateIncident,
      DEFAULT_SHOULD_CREATE_INCIDENT,
    );

    if (!shouldCreateAlert && !shouldCreateIncident) {
      throw new BadDataException(NO_OUTPUT_ERROR_MESSAGE);
    }

    createBy.data.shouldCreateAlert = shouldCreateAlert;
    createBy.data.shouldCreateIncident = shouldCreateIncident;

    await this.validateSeverityReferences({
      projectId: createBy.data.projectId || createBy.props.tenantId,
      alertSeverityId: createBy.data.alertSeverityId,
      incidentSeverityId: createBy.data.incidentSeverityId,
    });

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // Same string-arrival path as onBeforeCreate: coerce, validate, write back.
    const newThreshold: unknown = updateBy.data.burnRateThreshold as unknown;

    if (newThreshold !== undefined && newThreshold !== null) {
      updateBy.data.burnRateThreshold =
        this.validateBurnRateThreshold(newThreshold);
    }

    if (
      updateBy.data.minimumSampleCount !== undefined &&
      updateBy.data.minimumSampleCount !== null
    ) {
      updateBy.data.minimumSampleCount = this.validateMinimumSampleCount(
        updateBy.data.minimumSampleCount as unknown,
      );
    }

    if (
      updateBy.data.refireSuppressionMinutes !== undefined &&
      updateBy.data.refireSuppressionMinutes !== null
    ) {
      updateBy.data.refireSuppressionMinutes =
        this.validateRefireSuppressionMinutes(
          updateBy.data.refireSuppressionMinutes as unknown,
        );
    }

    await this.validateOutputsOnUpdate(updateBy);

    await this.validateSeverityReferencesOnUpdate(updateBy);

    const newLongWindow: unknown = updateBy.data.longWindowInMinutes as unknown;
    const newShortWindow: unknown = updateBy.data
      .shortWindowInMinutes as unknown;

    const isLongWindowUpdated: boolean =
      newLongWindow !== undefined && newLongWindow !== null;
    const isShortWindowUpdated: boolean =
      newShortWindow !== undefined && newShortWindow !== null;

    if (isLongWindowUpdated || isShortWindowUpdated) {
      if (isLongWindowUpdated && isShortWindowUpdated) {
        const windows: {
          longWindowInMinutes: number;
          shortWindowInMinutes: number;
        } = this.validateWindows({
          longWindowInMinutes: newLongWindow,
          shortWindowInMinutes: newShortWindow,
        });

        updateBy.data.longWindowInMinutes = windows.longWindowInMinutes;
        updateBy.data.shortWindowInMinutes = windows.shortWindowInMinutes;
      } else {
        /*
         * Only one of the two windows is being updated. Coerce it up front so
         * a non-numeric value is rejected even when the query matches no rows,
         * then load the affected rules so the updated value can be validated
         * against the value that will remain on each row.
         */
        const normalizedNewWindow: number = this.normalizeNumericInput(
          isLongWindowUpdated ? newLongWindow : newShortWindow,
        );

        if (!Number.isFinite(normalizedNewWindow)) {
          throw new BadDataException(WINDOWS_NOT_NUMERIC_ERROR_MESSAGE);
        }

        const rulesToUpdate: Array<Model> = await this.findBy({
          query: updateBy.query,
          select: {
            _id: true,
            longWindowInMinutes: true,
            shortWindowInMinutes: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        for (const rule of rulesToUpdate) {
          /*
           * The persisted sibling is coerced too — rows written before numeric
           * coercion existed can still hold a string in a Decimal/Number
           * column, and validateWindows must not compare against it as text.
           */
          this.validateWindows({
            longWindowInMinutes: isLongWindowUpdated
              ? normalizedNewWindow
              : rule.longWindowInMinutes,
            shortWindowInMinutes: isShortWindowUpdated
              ? normalizedNewWindow
              : rule.shortWindowInMinutes,
          });
        }

        if (isLongWindowUpdated) {
          updateBy.data.longWindowInMinutes = normalizedNewWindow;
        } else {
          updateBy.data.shortWindowInMinutes = normalizedNewWindow;
        }
      }
    }

    return {
      updateBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * Resolve anything the rules being deleted left open — otherwise the alert
     * or incident (and its on-call escalations) stays open forever, because the
     * evaluation worker only resolves records for rules that still exist.
     */
    const itemsToDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      select: {
        _id: true,
        projectId: true,
        serviceLevelObjectiveId: true,
      },
      props: {
        isRoot: true,
      },
    });

    for (const item of itemsToDelete) {
      if (!item.id || !item.projectId || !item.serviceLevelObjectiveId) {
        continue;
      }

      try {
        await this.resolveOpenAlertsAndIncidentsForRule({
          serviceLevelObjectiveId: item.serviceLevelObjectiveId,
          burnRateRuleId: item.id,
          projectId: item.projectId,
          rootCause:
            "Auto-resolved because the SLO burn rate rule that created it was deleted.",
        });
      } catch (err) {
        logger.error(
          `Error resolving open alerts and incidents for SLO burn rate rule ${item.id?.toString()} before delete: ${err}`,
          { projectId: item.projectId?.toString() } as LogAttributes,
        );
      }
    }

    return {
      deleteBy,
      carryForward: {
        itemsToDelete: itemsToDelete,
      },
    };
  }

  /*
   * A rule stops declaring something — it is disabled, or one of its two
   * outputs is switched off — and whatever it already has open is now an
   * orphan. The evaluation worker cannot clean it up: it only loads rules
   * where `isEnabled` is true, and for an enabled rule it only resolves the
   * output it is still allowed to create. So the alert (or incident) and its
   * on-call escalation would page someone about a rule that can no longer
   * justify the page.
   *
   * Runs after the write commits, so an update that was rejected leaves the
   * open records exactly where they were.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * These three reads are strict `=== false`, and that is only sound because
     * onBeforeUpdate ran first: validateOutputsOnUpdate coerces both output
     * flags, so the string `"false"` a form or a raw API call can send has
     * already become a real boolean by the time it reaches here. If a path
     * ever reaches onUpdateSuccess without that coercion, `"false" === false`
     * is false and the orphaned record silently stays open — so the coercion
     * is load-bearing, not tidiness.
     *
     * `isEnabled` is a plain Boolean column with no coercion hook, so a
     * literal "false" string would slip past this check. That is pre-existing
     * across every model in the codebase and is not worked around here; the
     * dashboard's toggle sends a real boolean.
     */
    const isRuleDisabled: boolean =
      (onUpdate.updateBy.data.isEnabled as boolean | undefined) === false;
    const areAlertsTurnedOff: boolean =
      (onUpdate.updateBy.data.shouldCreateAlert as boolean | undefined) ===
      false;
    const areIncidentsTurnedOff: boolean =
      (onUpdate.updateBy.data.shouldCreateIncident as boolean | undefined) ===
      false;

    if (!isRuleDisabled && !areAlertsTurnedOff && !areIncidentsTurnedOff) {
      return onUpdate;
    }

    for (const updatedItemId of updatedItemIds) {
      try {
        const rule: Model | null = await this.findOneById({
          id: updatedItemId,
          select: {
            _id: true,
            projectId: true,
            serviceLevelObjectiveId: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (!rule || !rule.projectId || !rule.serviceLevelObjectiveId) {
          continue;
        }

        /*
         * The two outputs get their own try: they are independent lifecycles,
         * and an alert that fails to resolve must not take the incident's
         * resolve down with it — that is exactly how a live incident ends up
         * escalating for a rule that no longer declares incidents.
         */
        let clearAlert: boolean = false;
        let clearIncident: boolean = false;

        if (isRuleDisabled || areAlertsTurnedOff) {
          try {
            await this.resolveOpenAlertsForRule({
              serviceLevelObjectiveId: rule.serviceLevelObjectiveId,
              burnRateRuleId: updatedItemId,
              projectId: rule.projectId,
              rootCause: isRuleDisabled
                ? "Alert auto-resolved because the SLO burn rate rule that created it was disabled."
                : "Alert auto-resolved because the SLO burn rate rule that created it no longer raises alerts.",
            });
            clearAlert = true;
          } catch (err) {
            logger.error(
              `Error resolving open alerts for SLO burn rate rule ${updatedItemId.toString()} after update: ${err}`,
            );
          }
        }

        if (isRuleDisabled || areIncidentsTurnedOff) {
          try {
            await this.resolveOpenIncidentsForRule({
              serviceLevelObjectiveId: rule.serviceLevelObjectiveId,
              burnRateRuleId: updatedItemId,
              projectId: rule.projectId,
              rootCause: isRuleDisabled
                ? "Incident auto-resolved because the SLO burn rate rule that declared it was disabled."
                : "Incident auto-resolved because the SLO burn rate rule that declared it no longer declares incidents.",
            });
            clearIncident = true;
          } catch (err) {
            logger.error(
              `Error resolving open incidents for SLO burn rate rule ${updatedItemId.toString()} after update: ${err}`,
            );
          }
        }

        /*
         * Only forget the outputs that actually closed. A side that threw
         * still has its record open, and clearing its column would tell the
         * worker to declare a second one on top.
         */
        await this.clearOpenOutputStateForRule({
          burnRateRuleId: updatedItemId,
          clearAlert: clearAlert,
          clearIncident: clearIncident,
        });
      } catch (err) {
        logger.error(
          `Error resolving open alerts and incidents for SLO burn rate rule ${updatedItemId.toString()} after update: ${err}`,
        );
      }
    }

    return onUpdate;
  }

  /*
   * "A rule must declare something", enforced against the row that will
   * EXIST after the update rather than against the payload alone.
   *
   * A form that only sends the field the user touched is the common case, so
   * turning alerts off on a rule that already declares incidents has to be
   * allowed while turning them off on a rule that declares nothing else must
   * not be. Same shape as the single-window update path below: coerce the
   * incoming value, then check it against each affected row's persisted
   * sibling.
   */
  private async validateOutputsOnUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const newShouldCreateAlert: unknown = updateBy.data
      .shouldCreateAlert as unknown;
    const newShouldCreateIncident: unknown = updateBy.data
      .shouldCreateIncident as unknown;

    const isShouldCreateAlertUpdated: boolean =
      newShouldCreateAlert !== undefined && newShouldCreateAlert !== null;
    const isShouldCreateIncidentUpdated: boolean =
      newShouldCreateIncident !== undefined && newShouldCreateIncident !== null;

    if (!isShouldCreateAlertUpdated && !isShouldCreateIncidentUpdated) {
      return;
    }

    if (isShouldCreateAlertUpdated) {
      updateBy.data.shouldCreateAlert = this.normalizeBooleanInput(
        newShouldCreateAlert,
        DEFAULT_SHOULD_CREATE_ALERT,
      );
    }

    if (isShouldCreateIncidentUpdated) {
      updateBy.data.shouldCreateIncident = this.normalizeBooleanInput(
        newShouldCreateIncident,
        DEFAULT_SHOULD_CREATE_INCIDENT,
      );
    }

    const updatedShouldCreateAlert: boolean = Boolean(
      updateBy.data.shouldCreateAlert,
    );
    const updatedShouldCreateIncident: boolean = Boolean(
      updateBy.data.shouldCreateIncident,
    );

    if (isShouldCreateAlertUpdated && isShouldCreateIncidentUpdated) {
      if (!updatedShouldCreateAlert && !updatedShouldCreateIncident) {
        throw new BadDataException(NO_OUTPUT_ERROR_MESSAGE);
      }

      return;
    }

    /*
     * Only one flag is being written. Switching one ON can never leave a rule
     * with nothing, so there is nothing to read back for it.
     */
    if (
      (isShouldCreateAlertUpdated && updatedShouldCreateAlert) ||
      (isShouldCreateIncidentUpdated && updatedShouldCreateIncident)
    ) {
      return;
    }

    const rulesToUpdate: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        shouldCreateAlert: true,
        shouldCreateIncident: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const rule of rulesToUpdate) {
      const resultingShouldCreateAlert: boolean = isShouldCreateAlertUpdated
        ? updatedShouldCreateAlert
        : this.normalizeBooleanInput(
            rule.shouldCreateAlert,
            DEFAULT_SHOULD_CREATE_ALERT,
          );
      const resultingShouldCreateIncident: boolean =
        isShouldCreateIncidentUpdated
          ? updatedShouldCreateIncident
          : this.normalizeBooleanInput(
              rule.shouldCreateIncident,
              DEFAULT_SHOULD_CREATE_INCIDENT,
            );

      if (!resultingShouldCreateAlert && !resultingShouldCreateIncident) {
        throw new BadDataException(NO_OUTPUT_ERROR_MESSAGE);
      }
    }
  }

  /*
   * Resolve all open Alerts carrying this rule's fingerprint by appending a
   * resolved AlertStateTimeline row. Mirrors
   * MonitorAlert.resolveOpenAlert mechanics, including tolerating the benign
   * same-state concurrency race.
   */
  @CaptureSpan()
  public async resolveOpenAlertsForRule(data: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    const fingerprint: string = this.getBurnRateFingerprint({
      serviceLevelObjectiveId: data.serviceLevelObjectiveId,
      burnRateRuleId: data.burnRateRuleId,
    });

    const openAlerts: Array<Alert> = await AlertService.findBy({
      query: {
        projectId: data.projectId,
        seriesFingerprint: fingerprint,
        currentAlertState: {
          isResolvedState: false,
        },
      },
      select: {
        _id: true,
        projectId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    if (openAlerts.length === 0) {
      return;
    }

    const resolvedStateId: ObjectID =
      await AlertStateTimelineService.getResolvedStateIdForProject(
        data.projectId,
      );

    /*
     * Per-record isolation, but NOT per-record silence: one record that fails
     * to resolve must not stop the others, and must still reach the caller.
     * Every caller above this treats a clean return as "there is nothing left
     * open" — the worker stamps the rule resolved, and its Paused /
     * Misconfigured guard commits a status change that makes the whole attempt
     * one-shot. Swallowing a single failed state-timeline write therefore
     * strands that record, and its on-call escalation, permanently.
     *
     * The idempotent same-state race below is not a failure and is
     * deliberately not counted.
     */
    let firstError: unknown = null;

    for (const openAlert of openAlerts) {
      try {
        const alertStateTimeline: AlertStateTimeline = new AlertStateTimeline();
        alertStateTimeline.alertId = openAlert.id!;
        alertStateTimeline.alertStateId = resolvedStateId;
        alertStateTimeline.projectId = openAlert.projectId!;
        alertStateTimeline.rootCause =
          data.rootCause ||
          "Alert auto-resolved because the SLO burn rate rule that created it is no longer active.";

        try {
          await AlertStateTimelineService.create({
            data: alertStateTimeline,
            props: {
              isRoot: true,
            },
          });
        } catch (err) {
          /*
           * Idempotent concurrency race: the evaluation worker and a
           * lifecycle hook can both decide to resolve the same open alert
           * near-simultaneously. The loser's onBeforeCreate dedupe throws
           * this exact BadDataException. Treat as a no-op at debug level.
           * Mirrors MonitorAlert.resolveOpenAlert.
           */
          if (
            err instanceof BadDataException &&
            err.message === "Alert state cannot be same as previous state."
          ) {
            logger.debug(
              `${openAlert.id?.toString()} - Alert already in resolved state; skipping duplicate state timeline (concurrent race).`,
            );
          } else {
            throw err;
          }
        }
      } catch (err) {
        logger.error(
          `Error resolving open alert ${openAlert.id?.toString()} for SLO burn rate rule ${data.burnRateRuleId?.toString()}: ${err}`,
          { projectId: data.projectId?.toString() } as LogAttributes,
        );

        if (firstError === null) {
          firstError = err;
        }
      }
    }

    if (firstError !== null) {
      throw firstError;
    }
  }

  /*
   * Both severity columns are plain foreign keys with no project scoping of
   * their own, so the public CRUD API will happily persist a severity that
   * belongs to a different project. Nothing notices until the worker fires:
   * IncidentService.onBeforeCreate rejects the cross-project reference on
   * EVERY tick, the evaluation loop swallows the throw into a log line, and
   * the rule looks configured while declaring nothing forever.
   *
   * The validator also rejects an id that matches no row at all, which is the
   * other way a hand-written API call produces a rule that can never fire.
   */
  private async validateSeverityReferences(data: {
    projectId: ObjectID | undefined;
    alertSeverityId: ObjectID | undefined;
    incidentSeverityId: ObjectID | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      /*
       * No project to validate against. The tenant column is required, so the
       * write is going to fail anyway — and failing here would turn a clear
       * "projectId is required" into a confusing severity error.
       */
      return;
    }

    if (!data.alertSeverityId && !data.incidentSeverityId) {
      return;
    }

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: data.projectId,
      subject: "SLO burn rate rule",
      references: [
        {
          modelName: "Alert Severity",
          id: data.alertSeverityId,
          service: AlertSeverityService,
        },
        {
          modelName: "Incident Severity",
          id: data.incidentSeverityId,
          service: IncidentSeverityService,
        },
      ],
    });
  }

  /*
   * The update twin. A root or API update does not always carry a tenantId, so
   * fall back to the projects of the rows the query actually matches — the
   * shape ScheduledMaintenanceService uses for the same problem.
   */
  private async validateSeverityReferencesOnUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const alertSeverityId: ObjectID | undefined = updateBy.data
      .alertSeverityId as ObjectID | undefined;
    const incidentSeverityId: ObjectID | undefined = updateBy.data
      .incidentSeverityId as ObjectID | undefined;

    if (!alertSeverityId && !incidentSeverityId) {
      return;
    }

    const projectIds: Array<ObjectID> = updateBy.props.tenantId
      ? [updateBy.props.tenantId]
      : await this.getProjectIdsForUpdateQuery(updateBy);

    for (const projectId of projectIds) {
      await this.validateSeverityReferences({
        projectId: projectId,
        alertSeverityId: alertSeverityId,
        incidentSeverityId: incidentSeverityId,
      });
    }
  }

  private async getProjectIdsForUpdateQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<ObjectID>> {
    const rules: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        projectId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const projectIds: Dictionary<ObjectID> = {};

    for (const rule of rules) {
      if (rule.projectId) {
        projectIds[rule.projectId.toString()] = rule.projectId;
      }
    }

    return Object.values(projectIds);
  }

  /*
   * Forget that the rule has an output open, WITHOUT stamping a resolve.
   *
   * The rule's four lifecycle columns are what the evaluation worker reads to
   * decide whether an output is already open, so a path that closes the record
   * but leaves `lastAlertCreatedAt` / `lastIncidentCreatedAt` set tells the
   * next tick "there is already an alert open" when there is not — and the
   * worker then refuses to declare anything for the rest of the burn. That is
   * how "turn Create Alert off to stop the noise, then turn it back on" used
   * to silence a live 14.4x fast burn.
   *
   * Clearing the CREATED column rather than stamping the RESOLVED one is the
   * whole point. Stamping a resolve would open a re-fire suppression window of
   * up to the rule's long window (six hours for the seeded Slow burn), so
   * re-enabling a rule mid-outage would go quiet anyway. Nothing about the
   * burn rate recovered here; an administrator ended the lifecycle, and the
   * honest record of that is "nothing is open", not "it just resolved".
   *
   * The cost is the rule's "last fired" history: a rule whose SLO was disabled
   * once reads as never having fired. That is the right trade against silently
   * losing a page, and it is the same reset an administrator just performed.
   *
   * Hookless on purpose. These are worker-owned columns that no workflow can
   * meaningfully trigger on, and the caller is often onUpdateSuccess — a
   * hooked write from inside an update hook re-enters the whole pipeline to
   * write two nullable timestamps.
   */
  @CaptureSpan()
  public async clearOpenOutputStateForRule(data: {
    burnRateRuleId: ObjectID;
    clearAlert: boolean;
    clearIncident: boolean;
  }): Promise<void> {
    const columns: {
      lastAlertCreatedAt?: null;
      lastIncidentCreatedAt?: null;
    } = {};

    if (data.clearAlert) {
      columns.lastAlertCreatedAt = null;
    }

    if (data.clearIncident) {
      columns.lastIncidentCreatedAt = null;
    }

    if (Object.keys(columns).length === 0) {
      return;
    }

    await this.updateColumnsByIdWithoutHooks({
      id: data.burnRateRuleId,
      data: columns as unknown as PartialEntity<Model>,
    });
  }

  /*
   * The Incident twin of resolveOpenAlertsForRule. Same shape, different
   * table: find every open Incident carrying this rule's fingerprint and
   * append a resolved IncidentStateTimeline row.
   *
   * Kept as its own method rather than folded into the alert path because the
   * two are resolved independently — turning `shouldCreateIncident` off must close
   * the incident and leave the alert alone, and vice versa.
   */
  @CaptureSpan()
  public async resolveOpenIncidentsForRule(data: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    const fingerprint: string = this.getBurnRateFingerprint({
      serviceLevelObjectiveId: data.serviceLevelObjectiveId,
      burnRateRuleId: data.burnRateRuleId,
    });

    const openIncidents: Array<Incident> = await IncidentService.findBy({
      query: {
        projectId: data.projectId,
        seriesFingerprint: fingerprint,
        currentIncidentState: {
          isResolvedState: false,
        },
      },
      select: {
        _id: true,
        projectId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    if (openIncidents.length === 0) {
      return;
    }

    /*
     * Looked up once for the batch, and only once there is something to
     * resolve: it throws when the project has no resolved incident state, and
     * a project with nothing open must not be failed for a state it never
     * needed.
     */
    const resolvedStateId: ObjectID =
      await IncidentStateTimelineService.getResolvedStateIdForProject(
        data.projectId,
      );

    /*
     * Per-record isolation, but NOT per-record silence: one record that fails
     * to resolve must not stop the others, and must still reach the caller.
     * Every caller above this treats a clean return as "there is nothing left
     * open" — the worker stamps the rule resolved, and its Paused /
     * Misconfigured guard commits a status change that makes the whole attempt
     * one-shot. Swallowing a single failed state-timeline write therefore
     * strands that record, and its on-call escalation, permanently.
     *
     * The idempotent same-state race below is not a failure and is
     * deliberately not counted.
     */
    let firstError: unknown = null;

    for (const openIncident of openIncidents) {
      try {
        const incidentStateTimeline: IncidentStateTimeline =
          new IncidentStateTimeline();
        incidentStateTimeline.incidentId = openIncident.id!;
        incidentStateTimeline.incidentStateId = resolvedStateId;
        incidentStateTimeline.projectId = openIncident.projectId!;
        incidentStateTimeline.rootCause =
          data.rootCause ||
          "Incident auto-resolved because the SLO burn rate rule that declared it is no longer active.";

        try {
          await IncidentStateTimelineService.create({
            data: incidentStateTimeline,
            props: {
              isRoot: true,
            },
          });
        } catch (err) {
          /*
           * Idempotent concurrency race, exactly as on the alert path: the
           * evaluation worker and a lifecycle hook can both decide to resolve
           * the same open incident. The loser's onBeforeCreate dedupe throws
           * this exact BadDataException. Match the message so unrelated
           * BadDataExceptions (state ordering, for instance) still propagate.
           */
          if (
            err instanceof BadDataException &&
            err.message === "Incident state cannot be same as previous state."
          ) {
            logger.debug(
              `${openIncident.id?.toString()} - Incident already in resolved state; skipping duplicate state timeline (concurrent race).`,
            );
          } else {
            throw err;
          }
        }
      } catch (err) {
        logger.error(
          `Error resolving open incident ${openIncident.id?.toString()} for SLO burn rate rule ${data.burnRateRuleId?.toString()}: ${err}`,
          { projectId: data.projectId?.toString() } as LogAttributes,
        );

        if (firstError === null) {
          firstError = err;
        }
      }
    }

    if (firstError !== null) {
      throw firstError;
    }
  }

  /*
   * Close everything a rule has open, whichever of the two outputs produced
   * it. This is what every "the rule can no longer justify what it opened"
   * caller wants — the worker's recovery branch, the delete hook, and the
   * SLO-level disable/delete path — because a rule's configuration can have
   * changed since the record was opened, so "it declares incidents now" is not
   * a safe proxy for "it has no open alert".
   *
   * A failure on one side must not strand the other, so the incident pass runs
   * even when the alert pass throws, and the first error is rethrown after
   * both have run.
   */
  @CaptureSpan()
  public async resolveOpenAlertsAndIncidentsForRule(data: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    let firstError: unknown = null;

    try {
      await this.resolveOpenAlertsForRule(data);
    } catch (err) {
      firstError = err;
    }

    try {
      await this.resolveOpenIncidentsForRule(data);
    } catch (err) {
      if (firstError === null) {
        firstError = err;
      }
    }

    if (firstError !== null) {
      throw firstError;
    }
  }

  /*
   * Coerce an API-supplied boolean column. Toggles in the dashboard send real
   * booleans, but the CRUD API is public and BaseModel.fromJSON does not
   * coerce Boolean columns, so `"false"` arrives as a non-empty string — which
   * is truthy, and would quietly turn a rule that declares nothing into a rule
   * that declares both. An absent value means "leave it at the default", which
   * is what a create payload that never mentions the field intends.
   */
  private normalizeBooleanInput(
    value: unknown,
    defaultValue: boolean,
  ): boolean {
    if (value === undefined || value === null) {
      return defaultValue;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized: string = value.trim().toLowerCase();

      if (normalized === "") {
        return defaultValue;
      }

      return normalized !== "false" && normalized !== "0";
    }

    return Boolean(value);
  }

  /*
   * Coerce an API-supplied numeric column to a number. HTML number inputs hand
   * Formik strings and neither ModelForm nor BaseModel.fromJSON coerces
   * Number/Decimal columns, so "1440" reaches these hooks as a string — and
   * `"1440" <= "60"` is a lexicographic comparison that is true. Anything that
   * is not a finite numeric string or number becomes NaN, which every caller
   * below rejects. Mirrors GlobalConfigService.normalizePercent.
   */
  private normalizeNumericInput(value: unknown): number {
    if (typeof value === "string") {
      const trimmed: string = value.trim();
      return trimmed === "" ? Number.NaN : Number(trimmed);
    }

    if (typeof value === "number") {
      return value;
    }

    return Number.NaN;
  }

  private validateBurnRateThreshold(value: unknown): number {
    const burnRateThreshold: number = this.normalizeNumericInput(value);

    if (!Number.isFinite(burnRateThreshold) || burnRateThreshold <= 0) {
      throw new BadDataException(THRESHOLD_ERROR_MESSAGE);
    }

    return burnRateThreshold;
  }

  private validateMinimumSampleCount(value: unknown): number {
    const minimumSampleCount: number = this.normalizeNumericInput(value);

    if (!Number.isFinite(minimumSampleCount) || minimumSampleCount < 0) {
      throw new BadDataException(
        "Minimum sample count must be a number greater than or equal to 0.",
      );
    }

    return minimumSampleCount;
  }

  private validateRefireSuppressionMinutes(value: unknown): number {
    const refireSuppressionMinutes: number = this.normalizeNumericInput(value);

    if (
      !Number.isFinite(refireSuppressionMinutes) ||
      refireSuppressionMinutes < 0
    ) {
      throw new BadDataException(
        "Re-fire suppression must be a number of minutes greater than or equal to 0.",
      );
    }

    return refireSuppressionMinutes;
  }

  /*
   * Coerces both windows, then enforces the multi-window invariant numerically.
   * Returns the coerced pair so callers can write numbers back onto the
   * create/update payload.
   */
  private validateWindows(data: {
    longWindowInMinutes: unknown;
    shortWindowInMinutes: unknown;
  }): { longWindowInMinutes: number; shortWindowInMinutes: number } {
    const longWindowInMinutes: number = this.normalizeNumericInput(
      data.longWindowInMinutes,
    );
    const shortWindowInMinutes: number = this.normalizeNumericInput(
      data.shortWindowInMinutes,
    );

    if (
      !Number.isFinite(longWindowInMinutes) ||
      !Number.isFinite(shortWindowInMinutes)
    ) {
      throw new BadDataException(WINDOWS_NOT_NUMERIC_ERROR_MESSAGE);
    }

    if (shortWindowInMinutes <= 0) {
      throw new BadDataException(
        "Short window must be greater than 0 minutes.",
      );
    }

    if (longWindowInMinutes <= shortWindowInMinutes) {
      throw new BadDataException(
        "Long window must be greater than the short window.",
      );
    }

    return {
      longWindowInMinutes: longWindowInMinutes,
      shortWindowInMinutes: shortWindowInMinutes,
    };
  }
}

export default new Service();
