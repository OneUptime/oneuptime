import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import { toStoredBoolean } from "../../../Types/Database/BooleanColumnValue";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import PartialEntity from "../../../Types/Database/PartialEntity";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  SLO_RECORD_OUTPUT_OWNER_USER_COLUMNS,
  SLO_RECORD_OUTPUT_RELATION_COLUMNS,
  SLO_RECORD_OUTPUT_TEMPLATE_COLUMNS,
  SloRecordOutputOptionFlag,
  SloRecordOutputOptionFlagDefaults,
  SloRecordOutputProjectScopedRelationColumn,
  SloRecordOutputRelationColumn,
  getSloRecordOwnerUsersNotInProjectErrorPrefix,
} from "../../../Utils/Slo/SloRecordOutputColumns";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import UpdateBy from "../../Types/Database/UpdateBy";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
  resolveReferenceId,
} from "../Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../Database/RelationIdUtil";
import logger, { LogAttributes } from "../Logger";
import SloRecordReferenceValidator from "./SloRecordReferenceValidator";
import CaptureSpan from "../Telemetry/CaptureSpan";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import DatabaseService from "../../Services/DatabaseService";
import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import IncidentStateService from "../../Services/IncidentStateService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import LabelService from "../../Services/LabelService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";

/*
 * WHAT AN SLO RAISES ALERTS AND INCIDENTS FROM.
 *
 * Two things on an SLO raise and resolve Alerts and Incidents: a burn rate
 * rule (ServiceLevelObjectiveBurnRateRuleService) and a tier of its error
 * budget policy (ServiceLevelObjectiveErrorBudgetPolicyTierService). Both
 * carry the same output settings, column for column - the two output flags,
 * the severities, the on-call lists, the templates, the private and
 * auto-resolve switches, the labels and the owners - and both mark what they
 * open with a fingerprint of their own. This is everything the two services
 * do the same way with those settings, so a check added for one is a check
 * for both:
 *
 *   - validating them: the SLO, severities, on-call policies, labels and
 *     owner teams must belong to the project and owner users must be its
 *     members, templates are held to their limits and flags to real
 *     booleans;
 *   - resolving what a source has open, found by its fingerprint, and
 *     forgetting that it has anything open.
 *
 * The code here was the burn rate rule service's own; its comments still say
 * "rule", and read for a tier just the same. Each service names the source in
 * its errors (SloRecordSource.subject) and says how its option flags default.
 */

/*
 * Ids compare case-insensitively: ObjectID keeps whatever case it was handed,
 * while Postgres renders a uuid lower-cased (ProjectScopedReferenceValidator
 * explains the same trap).
 */
type NormalizeIdFunction = (id: string) => string;

const normalizeId: NormalizeIdFunction = (id: string): string => {
  return id.trim().toLowerCase();
};

// The two severities a source may name, as readSeverityIds reads them.
interface SeverityIds {
  alertSeverityId: ObjectID | undefined;
  incidentSeverityId: ObjectID | undefined;
}

// The columns every source carries that these helpers read by name.
export interface SloRecordSourceRow {
  projectId?: ObjectID | undefined;
  serviceLevelObjectiveId?: ObjectID | undefined;
}

// The service a source's rows live in, and how its errors name the source.
export interface SloRecordSource<
  TModel extends DatabaseBaseModel & SloRecordSourceRow,
> {
  service: DatabaseService<TModel>;
  // How errors name the source: "SLO burn rate rule".
  subject: string;
  // What each option flag is written as when a create leaves it out.
  optionFlagDefaults: SloRecordOutputOptionFlagDefaults;
}

/*
 * Composition rather than a base class, on purpose: the services these
 * helpers use sit in an import loop with the burn rate rule service
 * (AlertService -> LabelService -> ... -> ServiceLevelObjectiveService), so
 * whichever of them loads first could find a base class still undefined at
 * `extends`. A service builds its helper the first time a hook needs it,
 * long after every module has loaded.
 */
export default class SloRecordSourceSettings<
  TModel extends DatabaseBaseModel & SloRecordSourceRow,
> {
  private source: SloRecordSource<TModel>;

  public constructor(source: SloRecordSource<TModel>) {
    this.source = source;
  }

  /*
   * Resolve all open Alerts carrying this fingerprint by appending a resolved
   * AlertStateTimeline row. Mirrors MonitorAlert.resolveOpenAlert mechanics,
   * including tolerating the benign same-state concurrency race.
   */
  @CaptureSpan()
  public async resolveOpenAlertsByFingerprint(data: {
    fingerprint: string;
    projectId: ObjectID;
    rootCause: string;
    // "SLO burn rate rule <id>", for the logs.
    sourceDescription: string;
  }): Promise<void> {
    const openAlerts: Array<Alert> = await AlertService.findBy({
      query: {
        projectId: data.projectId,
        seriesFingerprint: data.fingerprint,
        // Open: above the project's resolved state (Common/Utils/ResolvedState).
        currentAlertStateId: QueryHelper.any(
          await AlertStateService.getUnresolvedAlertStateIds(data.projectId),
        ),
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
     * open" — the worker stamps the source resolved, and its Paused /
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
        alertStateTimeline.rootCause = data.rootCause;

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
          `Error resolving open alert ${openAlert.id?.toString()} for ${data.sourceDescription}: ${err}`,
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
   * The Incident twin of resolveOpenAlertsByFingerprint. Same shape,
   * different table. Kept as its own method because the two are resolved
   * independently — turning an output off must close that output's record
   * and leave the other alone.
   */
  @CaptureSpan()
  public async resolveOpenIncidentsByFingerprint(data: {
    fingerprint: string;
    projectId: ObjectID;
    rootCause: string;
    sourceDescription: string;
  }): Promise<void> {
    const openIncidents: Array<Incident> = await IncidentService.findBy({
      query: {
        projectId: data.projectId,
        seriesFingerprint: data.fingerprint,
        // Open: above the project's resolved state (Common/Utils/ResolvedState).
        currentIncidentStateId: QueryHelper.any(
          await IncidentStateService.getUnresolvedIncidentStateIds(
            data.projectId,
          ),
        ),
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

    // Per-record isolation, but not per-record silence - see the alert twin.
    let firstError: unknown = null;

    for (const openIncident of openIncidents) {
      try {
        const incidentStateTimeline: IncidentStateTimeline =
          new IncidentStateTimeline();
        incidentStateTimeline.incidentId = openIncident.id!;
        incidentStateTimeline.incidentStateId = resolvedStateId;
        incidentStateTimeline.projectId = openIncident.projectId!;
        incidentStateTimeline.rootCause = data.rootCause;

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
          `Error resolving open incident ${openIncident.id?.toString()} for ${data.sourceDescription}: ${err}`,
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
   * Forget that the source has an output open, WITHOUT stamping a resolve.
   *
   * The source's four lifecycle columns are what the evaluation worker reads
   * to decide whether an output is already open, so a path that closes the
   * record but leaves `lastAlertCreatedAt` / `lastIncidentCreatedAt` set tells
   * the next tick "there is already an alert open" when there is not — and
   * the worker then refuses to declare anything for the rest of the burn (or
   * the rest of the tier). That is how "turn Create Alert off to stop the
   * noise, then turn it back on" used to silence a live 14.4x fast burn.
   *
   * Clearing the CREATED column rather than stamping the RESOLVED one is the
   * whole point. Stamping a resolve would open a burn rate rule's re-fire
   * suppression window, so re-enabling it mid-outage would go quiet anyway.
   * Nothing recovered here; an administrator ended the lifecycle, and the
   * honest record of that is "nothing is open", not "it just resolved".
   *
   * Hookless on purpose. These are worker-owned columns that no workflow can
   * meaningfully trigger on, and the caller is often onUpdateSuccess — a
   * hooked write from inside an update hook re-enters the whole pipeline to
   * write two nullable timestamps.
   */
  @CaptureSpan()
  public async clearOpenOutputState(data: {
    id: ObjectID;
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

    await this.source.service.updateColumnsByIdWithoutHooks({
      id: data.id,
      data: columns as unknown as PartialEntity<TModel>,
    });
  }

  /*
   * The severities a payload names. Each arrives as its id column or as the
   * relation - the dashboard posts the relation, and TypeORM writes either to
   * the same column - so both are read, and two that disagree are refused
   * rather than one of them checked and the other saved.
   */
  public readSeverityIds(data: Dictionary<unknown>): SeverityIds {
    return {
      alertSeverityId:
        RelationIdUtil.readConsistent(
          data,
          ["alertSeverityId", "alertSeverity"],
          "alert severity",
        ) || undefined,
      incidentSeverityId:
        RelationIdUtil.readConsistent(
          data,
          ["incidentSeverityId", "incidentSeverity"],
          "incident severity",
        ) || undefined,
    };
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
  public async validateSeverityReferences(data: {
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
      subject: this.source.subject,
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
   * The SLO is create-only for people (its column's update list is empty),
   * but a root write skips that list, so moving a rule to another SLO is
   * checked exactly as creating it there: pinned to each project the update
   * touches, a foreign SLO answered like a missing one.
   */
  public async validateServiceLevelObjectiveOnUpdate(
    updateBy: UpdateBy<TModel>,
  ): Promise<void> {
    const data: Dictionary<unknown> = (updateBy.data ||
      {}) as unknown as Dictionary<unknown>;

    const serviceLevelObjectives: Array<unknown> = [
      data["serviceLevelObjectiveId"],
      data["serviceLevelObjective"],
    ];

    if (
      SloRecordReferenceValidator.getReferencedIds(serviceLevelObjectives)
        .length === 0
    ) {
      return;
    }

    const projectIds: Array<ObjectID> =
      await this.source.service.findProjectsToCheckUpdateIn(updateBy);

    for (const projectId of projectIds) {
      await SloRecordReferenceValidator.validateServiceLevelObjectivesBelongToProject(
        {
          projectId: projectId,
          serviceLevelObjectives: serviceLevelObjectives,
          subject: this.source.subject,
        },
      );
    }
  }

  /*
   * The update twin. A root or API update does not always carry a tenantId, so
   * fall back to the projects of the rows the query actually matches — the
   * shape ScheduledMaintenanceService uses for the same problem.
   */
  public async validateSeverityReferencesOnUpdate(
    updateBy: UpdateBy<TModel>,
  ): Promise<void> {
    const severityIds: SeverityIds = this.readSeverityIds(
      (updateBy.data || {}) as unknown as Dictionary<unknown>,
    );
    const alertSeverityId: ObjectID | undefined = severityIds.alertSeverityId;
    const incidentSeverityId: ObjectID | undefined =
      severityIds.incidentSeverityId;

    if (!alertSeverityId && !incidentSeverityId) {
      return;
    }

    const projectIds: Array<ObjectID> =
      await this.source.service.findProjectsToCheckUpdateIn(updateBy);

    for (const projectId of projectIds) {
      await this.validateSeverityReferences({
        projectId: projectId,
        alertSeverityId: alertSeverityId,
        incidentSeverityId: incidentSeverityId,
      });
    }
  }

  /*
   * Coerce the five option flags. `applyDefaults` is the create path, where a
   * flag the payload never mentions is written as its default; on update an
   * absent flag stays absent.
   *
   * An explicit null is not "absent", though. All five are NOT NULL columns,
   * so writing null would fail the update with a raw constraint error - it is
   * read the way the create path reads it, as the column default.
   */
  public normalizeOptionFlags(
    data: Dictionary<unknown>,
    options: { applyDefaults: boolean },
  ): void {
    const flags: Array<SloRecordOutputOptionFlag> = Object.keys(
      this.source.optionFlagDefaults,
    ) as Array<SloRecordOutputOptionFlag>;

    for (const flag of flags) {
      const value: unknown = data[flag];

      if (!options.applyDefaults && value === undefined) {
        continue;
      }

      data[flag] = this.normalizeBooleanInput(
        value,
        this.source.optionFlagDefaults[flag],
      );
    }
  }

  /*
   * Titles, descriptions and remediation notes. A blank template is stored as
   * NULL: the worker treats blank and absent the same (it falls back to the
   * built-in text), and NULL keeps the table and the edit form honest about
   * which rules have a template at all. Content is never trimmed - leading
   * whitespace is meaningful in markdown.
   */
  public normalizeTemplates(data: Dictionary<unknown>): void {
    for (const template of SLO_RECORD_OUTPUT_TEMPLATE_COLUMNS) {
      const value: unknown = data[template.column];

      if (value === undefined || value === null) {
        continue;
      }

      if (typeof value !== "string") {
        throw new BadDataException(`${template.title} must be text.`);
      }

      if (value.trim() === "") {
        data[template.column] = null;
        continue;
      }

      if (value.length > template.maxLength) {
        throw new BadDataException(
          `${template.title} must be ${template.maxLength} characters or fewer. It is ${value.length} characters long.`,
        );
      }
    }
  }

  /*
   * Labels, owner teams and on-call policies are project-scoped rows joined to
   * the rule by plain many-to-many tables, so nothing stopped an API caller
   * attaching another project's team - and the worker would then copy it onto
   * every alert this rule opens, handing that team another project's page.
   * The on-call lists were never validated either; they are the same hazard
   * with an escalation attached, so they are checked here too.
   *
   * `storedIds` is the update path's inheritance: ids a rule already holds are
   * carried forward unchecked (the dashboard re-submits whole lists on every
   * save), and only what the write INTRODUCES is validated - the rule
   * MonitorStepsProjectValidator follows for the same reason.
   */
  public async validateRoutingReferences(data: {
    projectId: ObjectID | undefined;
    payload: Dictionary<unknown>;
    storedIds: Dictionary<Set<string>> | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      // Same reasoning as validateSeverityReferences: nothing to compare to.
      return;
    }

    const references: Array<ProjectScopedReference> = [];

    for (const relation of this.getProjectScopedRelations()) {
      const ids: Array<string> = this.getIntroducedRelationIds(
        data.payload[relation.column],
        data.storedIds?.[relation.column],
      );

      for (const id of ids) {
        references.push({
          modelName: relation.modelName,
          id: id,
          service: relation.service,
        });
      }
    }

    if (references.length > 0) {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: data.projectId,
        subject: this.source.subject,
        references: references,
      });
    }

    const ownerUserIds: Array<string> = [];

    for (const column of SLO_RECORD_OUTPUT_OWNER_USER_COLUMNS) {
      ownerUserIds.push(
        ...this.getIntroducedRelationIds(
          data.payload[column],
          data.storedIds?.[column],
        ),
      );
    }

    await this.validateOwnerUsersAreProjectMembers({
      projectId: data.projectId,
      userIds: ownerUserIds,
    });
  }

  /*
   * The update twin. One read serves both halves: it names the projects the
   * update touches (when the caller carries no tenant) and what each matched
   * rule already stores, and it only happens when the payload carries a list.
   */
  public async validateRoutingReferencesOnUpdate(
    updateBy: UpdateBy<TModel>,
  ): Promise<void> {
    const payload: Dictionary<unknown> =
      updateBy.data as unknown as Dictionary<unknown>;

    const columnsInPayload: Array<SloRecordOutputRelationColumn> =
      SLO_RECORD_OUTPUT_RELATION_COLUMNS.filter(
        (column: SloRecordOutputRelationColumn): boolean => {
          return payload[column] !== undefined && payload[column] !== null;
        },
      );

    if (columnsInPayload.length === 0) {
      return;
    }

    const select: Dictionary<unknown> = {
      _id: true,
      projectId: true,
    };

    for (const column of columnsInPayload) {
      select[column] = {
        _id: true,
      };
    }

    const rules: Array<TModel> =
      await this.source.service.findRowsAndHoldUpdateToThem(
        updateBy,
        select as unknown as Select<TModel>,
      );

    /*
     * The request's project for a teammate, whose update is kept to it; the
     * project of each rule written for OneUptime and a master admin.
     */
    for (const projectId of this.source.service.getProjectsToCheckRowsIn(
      updateBy.props,
      rules,
    )) {
      const storedIds: Dictionary<Set<string>> = {};

      for (const column of columnsInPayload) {
        const idsForColumn: Set<string> = new Set<string>();

        for (const rule of rules) {
          if (
            rule.projectId &&
            rule.projectId.toString() !== projectId.toString()
          ) {
            continue;
          }

          const stored: Array<DatabaseBaseModel> =
            (rule.getValue(column) as unknown as
              | Array<DatabaseBaseModel>
              | undefined) || [];

          for (const related of stored) {
            const relatedId: string | undefined =
              resolveReferenceId(related)?.toString();

            if (relatedId) {
              idsForColumn.add(normalizeId(relatedId));
            }
          }
        }

        storedIds[column] = idsForColumn;
      }

      await this.validateRoutingReferences({
        projectId: projectId,
        payload: payload,
        storedIds: storedIds,
      });
    }
  }

  /*
   * User is a global model with no tenant column, so the reference validator
   * could only confirm a user EXISTS - any account on the instance would pass.
   * Owners are notified with the record's title and a link to it, so naming a
   * stranger as an owner would tell them about another project's alert.
   *
   * Team membership is what "in this project" means, and it is exactly the set
   * the dashboard's owner picker offers (ProjectUser lists TeamMember rows).
   * Pending invitations count for that reason: refusing a user the picker just
   * offered would fail a save nobody could explain.
   *
   * The error echoes the ids the caller sent and never a name or email -
   * resolving an id from outside the project into a person would leak it.
   */
  private async validateOwnerUsersAreProjectMembers(data: {
    projectId: ObjectID;
    userIds: Array<string>;
  }): Promise<void> {
    const requestedById: Map<string, string> = new Map<string, string>();

    for (const userId of data.userIds) {
      const key: string = normalizeId(userId);

      if (key && !requestedById.has(key)) {
        requestedById.set(key, userId);
      }
    }

    if (requestedById.size === 0) {
      return;
    }

    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
        userId: QueryHelper.any(Array.from(requestedById.values())),
      },
      select: {
        userId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const memberIds: Set<string> = new Set<string>();

    for (const membership of memberships) {
      if (membership.userId) {
        memberIds.add(normalizeId(membership.userId.toString()));
      }
    }

    const nonMembers: Array<string> = [];

    for (const [key, userId] of requestedById) {
      if (!memberIds.has(key)) {
        nonMembers.push(userId);
      }
    }

    if (nonMembers.length === 0) {
      return;
    }

    throw new BadDataException(
      `${getSloRecordOwnerUsersNotInProjectErrorPrefix(this.source.subject)} ${nonMembers
        .map((userId: string): string => {
          return `"${userId}"`;
        })
        .join(", ")}. Please pick users from this project and try again.`,
    );
  }

  /*
   * The ids a many-to-many payload introduces. The same list reaches a hook as
   * entity stubs, `{ _id }` objects, ObjectIDs or bare uuid strings depending
   * on the caller, which resolveReferenceId already reads; anything it cannot
   * read is not an id and is left for the write itself to reject.
   */
  private getIntroducedRelationIds(
    value: unknown,
    storedIds: Set<string> | undefined,
  ): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    const items: Array<unknown> = Array.isArray(value) ? value : [value];
    const seen: Set<string> = new Set<string>();
    const ids: Array<string> = [];

    for (const item of items) {
      const id: string = resolveReferenceId(item)?.toString().trim() || "";

      if (!id) {
        continue;
      }

      const key: string = normalizeId(id);

      if (seen.has(key) || storedIds?.has(key)) {
        continue;
      }

      seen.add(key);
      ids.push(id);
    }

    return ids;
  }

  /*
   * Built per call rather than at module load: these services sit in an import
   * graph that loops back to this one, and a module-level table would capture
   * whichever of them had not finished loading yet as undefined.
   */
  private getProjectScopedRelations(): Array<{
    column: SloRecordOutputProjectScopedRelationColumn;
    modelName: string;
    service: DatabaseService<DatabaseBaseModel>;
  }> {
    const onCallDutyPolicyService: DatabaseService<DatabaseBaseModel> =
      OnCallDutyPolicyService as unknown as DatabaseService<DatabaseBaseModel>;
    const labelService: DatabaseService<DatabaseBaseModel> =
      LabelService as unknown as DatabaseService<DatabaseBaseModel>;
    const teamService: DatabaseService<DatabaseBaseModel> =
      TeamService as unknown as DatabaseService<DatabaseBaseModel>;

    return [
      {
        column: "onCallDutyPolicies",
        modelName: "On-Call Policy",
        service: onCallDutyPolicyService,
      },
      {
        column: "incidentOnCallDutyPolicies",
        modelName: "On-Call Policy",
        service: onCallDutyPolicyService,
      },
      {
        column: "alertLabels",
        modelName: "Label",
        service: labelService,
      },
      {
        column: "incidentLabels",
        modelName: "Label",
        service: labelService,
      },
      {
        column: "alertOwnerTeams",
        modelName: "Team",
        service: teamService,
      },
      {
        column: "incidentOwnerTeams",
        modelName: "Team",
        service: teamService,
      },
    ];
  }

  /*
   * A flag as the rule holds it: the boolean the database stores for what
   * was written (toStoredBoolean), or the default when nothing was - absent,
   * or null, which these NOT NULL columns cannot hold. DatabaseService
   * already turns a write's Boolean columns into those booleans before any
   * hook runs, and refuses a value the database would refuse - a blank, say
   * - so `"false"` from the API arrives here as false; a row read back is
   * read the same way. A rule that declares nothing is never mistaken for
   * one that declares both.
   */
  public normalizeBooleanInput(value: unknown, defaultValue: boolean): boolean {
    const stored: unknown = toStoredBoolean(value);

    return typeof stored === "boolean" ? stored : defaultValue;
  }

  /*
   * Coerce an API-supplied numeric column to a number. HTML number inputs hand
   * Formik strings and neither ModelForm nor BaseModel.fromJSON coerces
   * Number/Decimal columns, so "1440" reaches these hooks as a string — and
   * `"1440" <= "60"` is a lexicographic comparison that is true. Anything that
   * is not a finite numeric string or number becomes NaN, which every caller
   * below rejects. Mirrors GlobalConfigService.normalizePercent.
   */
  public normalizeNumericInput(value: unknown): number {
    if (typeof value === "string") {
      const trimmed: string = value.trim();
      return trimmed === "" ? Number.NaN : Number(trimmed);
    }

    if (typeof value === "number") {
      return value;
    }

    return Number.NaN;
  }
}
