import CountBy from "../Types/Database/CountBy";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import ModelPermission from "../Types/Database/Permissions/Index";
import DatabaseService from "./DatabaseService";
import AlertFeedService from "./AlertFeedService";
import AlertOwnerTeamService from "./AlertOwnerTeamService";
import AlertOwnerUserService from "./AlertOwnerUserService";
import AlertService from "./AlertService";
import AlertStateService from "./AlertStateService";
import IncidentFeedService from "./IncidentFeedService";
import IncidentService from "./IncidentService";
import IncidentStateService from "./IncidentStateService";
import ProjectService from "./ProjectService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import { applyAlertRelatedRecordPrivacyFilter } from "../Utils/Alert/AlertPrivacyFilter";
import { applyIncidentRelatedRecordPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
import AlertStateChangeAuthorization from "../Utils/Alert/AlertStateChangeAuthorization";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import ProjectScopedReferenceValidator from "../Utils/Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/IncidentAlert";
import Alert from "../../Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import AlertOwnerTeam from "../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../Models/DatabaseModels/AlertOwnerUser";
import AlertState from "../../Models/DatabaseModels/AlertState";
import Incident from "../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import Project from "../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Gray500, Yellow500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import {
  INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY,
  INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
  MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
} from "../../Types/Incident/IncidentAlertLink";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";

/*
 * Which of the two opt-in project switches apply to an incident's state.
 * Only the switches the incident's state has reached are true: an incident
 * that is merely acknowledged never resolves its alerts, whatever the
 * resolve switch says.
 */
export interface LinkedAlertStateTargets {
  acknowledge: boolean;
  resolve: boolean;
  // The incident has reached (or passed) its project's Resolved state.
  incidentReachedResolved: boolean;
}

/*
 * The decision half of the linked-alert state sync, shared by the cascade
 * (an incident changes state) and the link-time sync (an alert is linked to
 * an incident that is already acknowledged or resolved).
 *
 * States are compared by `order`, never by the isAcknowledgedState /
 * isResolvedState flags: projects add custom states (say "Monitoring") between
 * Acknowledged and Resolved, and an incident sitting in one of those has
 * still been acknowledged. An incident project without an Acknowledged (or
 * Resolved) state simply never triggers that half.
 */
export function getLinkedAlertStateTargets(data: {
  incidentStateOrder: number;
  acknowledgedIncidentStateOrder: number | undefined;
  resolvedIncidentStateOrder: number | undefined;
  acknowledgeSwitch: boolean;
  resolveSwitch: boolean;
}): LinkedAlertStateTargets {
  const reachedAcknowledged: boolean =
    data.acknowledgedIncidentStateOrder !== undefined &&
    data.incidentStateOrder >= data.acknowledgedIncidentStateOrder;

  const reachedResolved: boolean =
    data.resolvedIncidentStateOrder !== undefined &&
    data.incidentStateOrder >= data.resolvedIncidentStateOrder;

  return {
    acknowledge: data.acknowledgeSwitch && reachedAcknowledged,
    resolve: data.resolveSwitch && reachedResolved,
    incidentReachedResolved: reachedResolved,
  };
}

/*
 * The alert state one linked alert should move to, or null to leave it alone.
 *
 * Resolve wins when it applies and the alert is not held back by another
 * linked incident that is still open; acknowledge is the fallback, so an
 * alert that cannot be resolved yet is at least acknowledged (which is what
 * stops its paging). An alert is never moved backwards and never "moved" to
 * where it already is: anything at or past the target is left untouched.
 */
export function chooseLinkedAlertTargetState<
  TState extends { order?: number | undefined },
>(data: {
  alertStateOrder: number;
  acknowledgedAlertState: TState | undefined;
  resolvedAlertState: TState | undefined;
  isBlockedFromResolve: boolean;
}): TState | null {
  const resolvedOrder: number | undefined = data.resolvedAlertState?.order;

  if (
    data.resolvedAlertState &&
    resolvedOrder !== undefined &&
    !data.isBlockedFromResolve &&
    data.alertStateOrder < resolvedOrder
  ) {
    return data.resolvedAlertState;
  }

  const acknowledgedOrder: number | undefined =
    data.acknowledgedAlertState?.order;

  if (
    data.acknowledgedAlertState &&
    acknowledgedOrder !== undefined &&
    data.alertStateOrder < acknowledgedOrder
  ) {
    return data.acknowledgedAlertState;
  }

  return null;
}

export interface LinkAlertsToIncidentResult {
  linkedAlertIds: Array<ObjectID>;
  alreadyLinkedAlertIds: Array<ObjectID>;
  failed: Array<{ alertId: ObjectID; message: string }>;
}

export interface AcknowledgeDeclaredAlertsResult {
  acknowledgedAlertIds: Array<ObjectID>;
  // Already acknowledged, resolved or in a later state: left as they were.
  alreadyAcknowledgedAlertIds: Array<ObjectID>;
  /*
   * Linked alerts the project's linked-alert sync moves on its own (the
   * incident was declared straight into a state its switches act on).
   */
  leftToLinkedAlertSyncAlertIds: Array<ObjectID>;
  failed: Array<{ alertId: ObjectID; message: string }>;
}

/*
 * What validateAcknowledgeAlertsForNewIncident settled for a declaration
 * that asked to acknowledge its alerts: the project's Acknowledged state,
 * and the alerts not acknowledged yet - the ones the caller was checked for,
 * and the only ones acknowledgeAlertsDeclaredWithIncident may write.
 */
export interface AlertsToAcknowledgeOnDeclare {
  acknowledgedAlertStateId: ObjectID;
  alertIdsToAcknowledge: Array<ObjectID>;
}

/*
 * Alerts acknowledged at once when an incident is declared from many. Each
 * acknowledgement is a full state change (and waits on its Slack / Microsoft
 * Teams post), so one at a time could leave the last of 50 alerts escalating
 * for minutes. Distinct alerts never share a timeline lock.
 */
const DECLARED_ALERT_ACKNOWLEDGE_CONCURRENCY: number = 5;

/*
 * The "why" on an alert acknowledged because an incident was declared from
 * it. It goes to the alert's feed, the alert's Slack / Microsoft Teams
 * channels and its owners' notifications - places that must not name a
 * private incident - so a private incident is not named at all.
 */
export function getDeclaredAlertAcknowledgementCause(data: {
  incidentNumber: string;
  isIncidentPrivate: boolean;
}): string {
  if (data.isIncidentPrivate) {
    return "Acknowledged because a private incident was declared from this alert.";
  }

  return `Acknowledged because ${withNumber("Incident", data.incidentNumber)} was declared from this alert.`;
}

/*
 * miscDataProps key on an IncidentAlert create: the link is one of the links
 * written while an incident is being declared from alerts. The incident then
 * gets one "Declared from N alerts" entry (see
 * createDeclaredFromAlertsFeedItem) instead of an "Alert Linked" entry - and
 * a Slack / Microsoft Teams post - per alert. Honoured for root callers only:
 * miscDataProps is part of the public create API, and an API client must not
 * be able to link an alert without the incident's audit entry.
 */
export const INCIDENT_ALERT_DECLARED_WITH_INCIDENT_KEY: string =
  "declaredWithIncident";

// One alert, as the incident-side entries describe it.
export interface LinkedAlertMention {
  // "Alert ALT-3" / "Alert #3".
  label: string;
  // The alert's page in the dashboard.
  link: string;
  title: string | undefined;
  isPrivate: boolean;
}

/*
 * "**[Alert #3](link)**: <title>", or "**[Alert #3](link)** (private alert)"
 * for a private alert: its number and link are kept so the entry still says
 * what happened, but its title is never written where people who cannot see
 * the alert read it (the incident's feed and Slack / Microsoft Teams posts).
 */
function describeLinkedRecord(data: {
  label: string;
  link: string;
  title: string | undefined;
  isPrivate: boolean;
  privateNoun: string;
}): { subject: string; titleSuffix: string } {
  const subject: string = `**[${data.label}](${data.link})**`;

  if (data.isPrivate) {
    return {
      subject: `${subject} (private ${data.privateNoun})`,
      titleSuffix: "",
    };
  }

  return { subject: subject, titleSuffix: `: ${data.title || "No title"}` };
}

/*
 * The one incident feed entry for an incident declared from alerts, listing
 * the alerts in the order given. Private alerts are listed without their
 * titles.
 */
export function getDeclaredFromAlertsMarkdown(
  alerts: Array<LinkedAlertMention>,
): string {
  const lines: Array<string> = alerts.map(
    (alert: LinkedAlertMention): string => {
      const described: { subject: string; titleSuffix: string } =
        describeLinkedRecord({
          label: alert.label,
          link: alert.link,
          title: alert.title,
          isPrivate: alert.isPrivate,
          privateNoun: "alert",
        });

      return `- ${described.subject}${described.titleSuffix}`;
    },
  );

  const noun: string = alerts.length === 1 ? "alert" : "alerts";

  return `🔗 Declared from ${alerts.length} ${noun}:\n\n${lines.join("\n")}`;
}

interface LinkedAlertSwitches {
  acknowledge: boolean;
  resolve: boolean;
}

/*
 * Everything the per-alert decision needs, read once per incident state
 * change rather than once per alert.
 */
interface LinkedAlertStatePlan {
  acknowledgedAlertState: AlertState | undefined;
  resolvedAlertState: AlertState | undefined;
  incidentReachedResolved: boolean;
  resolvedIncidentStateOrder: number | undefined;
  alertStateOrderById: Map<string, number>;
  incidentStateOrderById: Map<string, number>;
}

// A link row as the delete hooks carry it from before to after the delete.
interface CarriedLink {
  id: string;
  incidentId: ObjectID;
  alertId: ObjectID;
  projectId: ObjectID;
}

function normalizeId(id: ObjectID | string): string {
  return id.toString().trim().toLowerCase();
}

// Distinct ids, in order, with the missing ones left out.
function uniqueIds(ids: Array<ObjectID | undefined | null>): Array<ObjectID> {
  const seen: Set<string> = new Set();
  const result: Array<ObjectID> = [];

  for (const id of ids) {
    if (!id) {
      continue;
    }

    const key: string = normalizeId(id);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(new ObjectID(key));
  }

  return result;
}

function formatNumber(
  numberWithPrefix: string | undefined | null,
  number: number | undefined | null,
): string {
  if (numberWithPrefix) {
    return numberWithPrefix;
  }

  if (number !== undefined && number !== null) {
    return `#${number}`;
  }

  return "";
}

function withNumber(label: string, number: string): string {
  return number ? `${label} ${number}` : label;
}

const NOT_VISIBLE_ALERTS_MESSAGE: string =
  "One or more of the selected alerts do not exist in this project, or you do not have access to them.";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * A link row reveals both of its ends, so it is only visible to a user who
   * can see the private incident AND the private alert. The two filters write
   * different keys (incidentId / alertId) and compose. Relation joins
   * (`select: { alert: { title } }`) do not run AlertService.onBeforeFind,
   * so these are the only thing keeping a private alert's title out of an
   * incident's "Linked Alerts" list, and the other way round.
   */
  private applyPrivacyFilters<T>(
    query: T,
    props: DatabaseCommonInteractionProps,
  ): T {
    return applyAlertRelatedRecordPrivacyFilter(
      applyIncidentRelatedRecordPrivacyFilter(query, props),
      props,
    );
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = this.applyPrivacyFilters(findBy.query, findBy.props);
    return { findBy, carryForward: null };
  }

  /*
   * A pair that is already linked answers with the same message however the
   * duplicate is caught. @UniqueColumnsTogether catches it before the insert
   * with INCIDENT_ALERT_ALREADY_LINKED_MESSAGE; when two requests race past
   * that check, the unique index rejects the second insert, and the generic
   * translation ("A Incident Alert with the same Incident Id, Alert Id,
   * Project Id already exists...") would reach the dashboard, which counts a
   * link as done only by this message. The exception stays tagged as a unique
   * violation, so linkAlertsToIncident still counts it as already linked.
   *
   * IncidentAlert has no other unique index. A unique violation reported
   * against another table (nothing on the create path writes one today) keeps
   * the generic translation. Synchronous and `never`-returning, like the
   * method it overrides.
   */
  protected override getException(error: Exception): never {
    if (
      PostgresErrorTranslator.isUniqueViolation(error) &&
      this.isOwnTableOrUnknown(error)
    ) {
      throw PostgresErrorTranslator.createUniqueViolationException(
        INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
      );
    }

    return super.getException(error);
  }

  /*
   * True when a Postgres error names this table, or names none (an exception
   * that was already translated carries no driver details).
   */
  private isOwnTableOrUnknown(error: unknown): boolean {
    const direct: { table?: unknown } = error as { table?: unknown };
    const driverError: { table?: unknown } | undefined = (
      error as { driverError?: { table?: unknown } }
    ).driverError;

    const table: unknown =
      typeof direct.table === "string" ? direct.table : driverError?.table;

    if (typeof table !== "string" || table.length === 0) {
      return true;
    }

    return table === this.getModel().tableName;
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = this.applyPrivacyFilters(countBy.query, countBy.props);
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    updateBy.query = this.applyPrivacyFilters(updateBy.query, updateBy.props);
    return { updateBy, carryForward: null };
  }

  /*
   * Both ends must exist in the link's project, and a user may only link what
   * they can see. The foreign keys only require the rows to exist somewhere,
   * and @CanAccessIfCanReadOn is not applied on create, so without this a
   * member could link another project's alert, or a private incident they
   * cannot open. The duplicate check is left to @UniqueColumnsTogether and the
   * unique index, which are race free.
   *
   * This hook runs before DatabaseService checks the caller's create
   * permission, so every refusal is worded so it reveals nothing about
   * records the caller cannot see.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    // A reference arrives as `incidentId` or as `incident: { _id }`.
    const incidentId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      ["incidentId", "incident"],
      "incident",
    );

    const alertId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      ["alertId", "alert"],
      "alert",
    );

    if (!incidentId) {
      throw new BadDataException(
        "Please select the incident to link the alert to.",
      );
    }

    if (!alertId) {
      throw new BadDataException("Please select the alert to link.");
    }

    const projectId: ObjectID | null =
      createBy.props.tenantId ||
      RelationIdUtil.readConsistent(data, ["projectId", "project"], "project");

    if (!projectId) {
      throw new BadDataException(
        "projectId is required to link an alert to an incident.",
      );
    }

    createBy.data.projectId = projectId;
    createBy.data.incidentId = incidentId;
    createBy.data.alertId = alertId;

    if (!createBy.props.isRoot) {
      /*
       * Read both ends as the caller, so privacy, label and owner scoping
       * apply exactly as they do on the incident and alert pages. A caller
       * without read access at all gets the same answer as one asking for
       * a record that does not exist.
       */
      const incident: Incident | null = await this.findVisible(() => {
        return IncidentService.findOneById({
          id: incidentId,
          select: { _id: true, projectId: true },
          props: createBy.props,
        });
      });

      if (
        !incident ||
        normalizeId(incident.projectId || "") !== normalizeId(projectId)
      ) {
        throw new BadDataException(
          "The incident to link does not exist in this project, or you do not have access to it.",
        );
      }

      const alert: Alert | null = await this.findVisible(() => {
        return AlertService.findOneById({
          id: alertId,
          select: { _id: true, projectId: true },
          props: createBy.props,
        });
      });

      if (
        !alert ||
        normalizeId(alert.projectId || "") !== normalizeId(projectId)
      ) {
        throw new BadDataException(
          "The alert to link does not exist in this project, or you do not have access to it.",
        );
      }

      /*
       * "Linked by" is whoever made the request. sanitizeCreateOrUpdate
       * stamps it for a user; an API key has no user, and must not be able
       * to name somebody else as the one who linked the alert.
       */
      if (createBy.props.userId) {
        createBy.data.createdByUserId = createBy.props.userId;
      } else {
        delete createBy.data.createdByUserId;
      }

      delete createBy.data.createdByUser;
    }

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: projectId,
      subject: "incident alert link",
      references: [
        {
          modelName: "Incident",
          id: incidentId,
          service: IncidentService,
        },
        {
          modelName: "Alert",
          id: alertId,
          service: AlertService,
        },
      ],
    });

    return { createBy, carryForward: null };
  }

  /*
   * Runs a read made with the caller's props. A refusal from the permission
   * layer (no read access to the table, a label the caller cannot see) is
   * reported exactly like a record that does not exist, so the answer never
   * reveals which it was. Anything else - a lapsed session, an unpaid
   * project, the database being unavailable - is not about the record and is
   * passed on as it is.
   */
  @CaptureSpan()
  private async findVisible<T>(
    read: () => Promise<T | null>,
  ): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof BadDataException
      ) {
        logger.debug(
          `IncidentAlertService: a record to link is not readable by the caller: ${error.message}`,
        );
        return null;
      }

      throw error;
    }
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const incidentId: ObjectID | undefined = createdItem.incidentId;
    const alertId: ObjectID | undefined = createdItem.alertId;

    if (!projectId || !incidentId || !alertId) {
      return createdItem;
    }

    const actorUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    /*
     * A link written while its incident is being declared from alerts leaves
     * the incident's side to that incident's single "Declared from N alerts"
     * entry. Root only - see INCIDENT_ALERT_DECLARED_WITH_INCIDENT_KEY.
     */
    const isDeclaredWithIncident: boolean =
      onCreate.createBy.props.isRoot === true &&
      onCreate.createBy.miscDataProps?.[
        INCIDENT_ALERT_DECLARED_WITH_INCIDENT_KEY
      ] === true;

    try {
      await this.createLinkFeedItems({
        link: {
          id: createdItem.id?.toString() || "",
          projectId: projectId,
          incidentId: incidentId,
          alertId: alertId,
        },
        isLinked: true,
        actorUserId: actorUserId,
        writeIncidentEntry: !isDeclaredWithIncident,
      });
    } catch (error) {
      logger.error(
        `IncidentAlertService.onCreateSuccess could not write the link feed items: ${error}`,
        {
          projectId: projectId.toString(),
          incidentId: incidentId.toString(),
          alertId: alertId.toString(),
        } as LogAttributes,
      );
    }

    /*
     * Linking an alert to an incident that is already acknowledged or
     * resolved brings the alert along, when the project asks for it.
     * Fire-and-forget: it never fails, or slows down, the link.
     */
    this.syncAlertWithLinkedIncidentState({
      projectId: projectId,
      incidentId: incidentId,
      alertId: alertId,
    }).catch((error: Error) => {
      logger.error(
        `IncidentAlertService could not sync a newly linked alert with its incident: ${error}`,
        {
          projectId: projectId.toString(),
          incidentId: incidentId.toString(),
          alertId: alertId.toString(),
        } as LogAttributes,
      );
    });

    return createdItem;
  }

  /*
   * Carries the rows about to be deleted to onDeleteSuccess, which reports
   * only the ones that were actually deleted: the permission check that runs
   * after this hook can still narrow the delete. The read is not capped at
   * the delete's own limit because that limit applies to the narrowed query,
   * whose rows need not be among the first rows of this one.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = this.applyPrivacyFilters(deleteBy.query, deleteBy.props);

    const carriedQuery: Query<Model> = { ...deleteBy.query };

    if (deleteBy.props.tenantId && !carriedQuery.projectId) {
      carriedQuery.projectId = deleteBy.props.tenantId;
    }

    const linksToDelete: Array<Model> = await this.findBy({
      query: carriedQuery,
      select: {
        _id: true,
        incidentId: true,
        alertId: true,
        projectId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const carried: Array<CarriedLink> = [];

    for (const link of linksToDelete) {
      if (!link._id || !link.incidentId || !link.alertId || !link.projectId) {
        continue;
      }

      carried.push({
        id: link._id.toString(),
        incidentId: link.incidentId,
        alertId: link.alertId,
        projectId: link.projectId,
      });
    }

    return { deleteBy, carryForward: carried };
  }

  @CaptureSpan()
  public override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const carried: Array<CarriedLink> = Array.isArray(onDelete.carryForward)
      ? (onDelete.carryForward as Array<CarriedLink>)
      : [];

    const deletedIds: Set<string> = new Set(
      (itemIdsBeforeDelete || []).map((id: ObjectID) => {
        return normalizeId(id);
      }),
    );

    const actorUserId: ObjectID | undefined =
      onDelete.deleteBy.deletedByUser?.id || onDelete.deleteBy.props.userId;

    for (const link of carried) {
      if (!deletedIds.has(normalizeId(link.id))) {
        continue;
      }

      try {
        await this.createLinkFeedItems({
          link: link,
          isLinked: false,
          actorUserId: actorUserId,
          writeIncidentEntry: true,
        });
      } catch (error) {
        logger.error(
          `IncidentAlertService.onDeleteSuccess could not write the unlink feed items: ${error}`,
          {
            projectId: link.projectId.toString(),
            incidentId: link.incidentId.toString(),
            alertId: link.alertId.toString(),
          } as LogAttributes,
        );
      }
    }

    return onDelete;
  }

  /*
   * One entry on each side. Only the incident's entry is posted to Slack /
   * Microsoft Teams: the incident's channels are where responders follow the
   * incident, and posting the alert's entry as well would announce every link
   * twice.
   *
   * Each entry is read by its own side's audience: the incident's feed and
   * channels by whoever can see the incident, the alert's feed by whoever
   * can see the alert. So a private end's title never goes into the other
   * side's entry - not even when both ends are private, because two private
   * records can have different owners. Its number and link are kept (opening
   * the link is subject to the record's own privacy), which is what
   * applyPrivacyFilters promises for the link rows themselves.
   */
  @CaptureSpan()
  private async createLinkFeedItems(data: {
    link: CarriedLink;
    isLinked: boolean;
    actorUserId: ObjectID | undefined;
    // False for a link written while its incident is declared from alerts.
    writeIncidentEntry: boolean;
  }): Promise<void> {
    const { link, isLinked, actorUserId } = data;

    const incident: Incident | null = await IncidentService.findOneById({
      id: link.incidentId,
      select: {
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        title: true,
        isPrivate: true,
      },
      props: {
        isRoot: true,
      },
    });

    const alert: Alert | null = await AlertService.findOneById({
      id: link.alertId,
      select: {
        alertNumber: true,
        alertNumberWithPrefix: true,
        title: true,
        isPrivate: true,
      },
      props: {
        isRoot: true,
      },
    });

    const incidentLabel: string = withNumber(
      "Incident",
      formatNumber(
        incident?.incidentNumberWithPrefix,
        incident?.incidentNumber,
      ),
    );
    const alertLabel: string = withNumber(
      "Alert",
      formatNumber(alert?.alertNumberWithPrefix, alert?.alertNumber),
    );

    const incidentLink: string = (
      await IncidentService.getIncidentLinkInDashboard(
        link.projectId,
        link.incidentId,
      )
    ).toString();
    const alertLink: string = (
      await AlertService.getAlertLinkInDashboard(link.projectId, link.alertId)
    ).toString();

    const alertMention: { subject: string; titleSuffix: string } =
      describeLinkedRecord({
        label: alertLabel,
        link: alertLink,
        title: alert?.title,
        isPrivate: alert?.isPrivate === true,
        privateNoun: "alert",
      });

    const incidentMention: { subject: string; titleSuffix: string } =
      describeLinkedRecord({
        label: incidentLabel,
        link: incidentLink,
        title: incident?.title,
        isPrivate: incident?.isPrivate === true,
        privateNoun: "incident",
      });

    const incidentSubject: string = `**[${incidentLabel}](${incidentLink})**`;

    if (data.writeIncidentEntry) {
      await IncidentFeedService.createIncidentFeedItem({
        incidentId: link.incidentId,
        projectId: link.projectId,
        incidentFeedEventType: isLinked
          ? IncidentFeedEventType.AlertLinked
          : IncidentFeedEventType.AlertUnlinked,
        displayColor: isLinked ? Yellow500 : Gray500,
        feedInfoInMarkdown: isLinked
          ? `🔗 Linked ${alertMention.subject} to ${incidentSubject}${alertMention.titleSuffix}`
          : `Unlinked ${alertMention.subject} from ${incidentSubject}${alertMention.titleSuffix}`,
        userId: actorUserId,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          notifyUserId: actorUserId,
        },
      });
    }

    await AlertFeedService.createAlertFeedItem({
      alertId: link.alertId,
      projectId: link.projectId,
      alertFeedEventType: isLinked
        ? AlertFeedEventType.LinkedToIncident
        : AlertFeedEventType.UnlinkedFromIncident,
      displayColor: isLinked ? Yellow500 : Gray500,
      feedInfoInMarkdown: isLinked
        ? `🔗 Linked to ${incidentMention.subject}${incidentMention.titleSuffix}`
        : `Unlinked from ${incidentMention.subject}${incidentMention.titleSuffix}`,
      userId: actorUserId,
    });
  }

  /*
   * The single incident feed entry for an incident declared from alerts,
   * posted to its Slack / Microsoft Teams channels. The links themselves are
   * written without incident-side entries (INCIDENT_ALERT_DECLARED_WITH_
   * INCIDENT_KEY), so the incident's channels get one message instead of one
   * per alert. IncidentService calls this from its create chain once the
   * "Incident Created" entry is out, which is also when the incident's own
   * channels exist. Nothing is written when none of the alerts can be found.
   */
  @CaptureSpan()
  public async createDeclaredFromAlertsFeedItem(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    alertIds: Array<ObjectID>;
    actorUserId: ObjectID | undefined;
  }): Promise<void> {
    const markdown: string | null = await this.buildDeclaredFromAlertsMarkdown({
      projectId: data.projectId,
      alertIds: data.alertIds,
    });

    if (!markdown) {
      return;
    }

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: data.incidentId,
      projectId: data.projectId,
      incidentFeedEventType: IncidentFeedEventType.AlertLinked,
      displayColor: Yellow500,
      feedInfoInMarkdown: markdown,
      userId: data.actorUserId,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId: data.actorUserId,
      },
    });
  }

  /*
   * The markdown for createDeclaredFromAlertsFeedItem: the project's alerts
   * among `alertIds`, in that order, each with its number and dashboard
   * link, and its title unless it is private. Read as root; null when none of
   * the alerts exists (any more).
   */
  @CaptureSpan()
  public async buildDeclaredFromAlertsMarkdown(data: {
    projectId: ObjectID;
    alertIds: Array<ObjectID>;
  }): Promise<string | null> {
    if (data.alertIds.length === 0) {
      return null;
    }

    const alerts: Array<Alert> = await AlertService.findBy({
      query: {
        _id: QueryHelper.any(data.alertIds),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        title: true,
        isPrivate: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const alertById: Map<string, Alert> = new Map();

    for (const alert of alerts) {
      if (alert._id) {
        alertById.set(normalizeId(alert._id), alert);
      }
    }

    const mentions: Array<LinkedAlertMention> = [];
    const seen: Set<string> = new Set();

    for (const alertId of data.alertIds) {
      const key: string = normalizeId(alertId);
      const alert: Alert | undefined = alertById.get(key);

      if (!alert || seen.has(key)) {
        continue;
      }

      seen.add(key);

      mentions.push({
        label: withNumber(
          "Alert",
          formatNumber(alert.alertNumberWithPrefix, alert.alertNumber),
        ),
        link: (
          await AlertService.getAlertLinkInDashboard(
            data.projectId,
            new ObjectID(key),
          )
        ).toString(),
        title: alert.title,
        isPrivate: alert.isPrivate === true,
      });
    }

    if (mentions.length === 0) {
      return null;
    }

    return getDeclaredFromAlertsMarkdown(mentions);
  }

  /*
   * Declaring a PRIVATE incident from alerts: the people who work those
   * alerts become its owners too. A private incident is visible only to its
   * owners (and project admins), and a private alert only to its owners, so
   * without this the owners of the private alert an incident was declared
   * from - the only non-admins who could see that alert - could not see the
   * incident. The declaring user is already made an owner by
   * DatabaseService.autoOwnerOnCreate. Owners are added as root, without
   * notifying them (they were notified about their alerts), and owners the
   * incident already has are skipped.
   */
  @CaptureSpan()
  public async copyAlertOwnersToIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    alertIds: Array<ObjectID>;
  }): Promise<{ userIds: Array<ObjectID>; teamIds: Array<ObjectID> }> {
    if (data.alertIds.length === 0) {
      return { userIds: [], teamIds: [] };
    }

    const ownerUsers: Array<AlertOwnerUser> =
      await AlertOwnerUserService.findBy({
        query: {
          alertId: QueryHelper.any(data.alertIds),
          projectId: data.projectId,
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

    const ownerTeams: Array<AlertOwnerTeam> =
      await AlertOwnerTeamService.findBy({
        query: {
          alertId: QueryHelper.any(data.alertIds),
          projectId: data.projectId,
        },
        select: {
          teamId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const userIds: Array<ObjectID> = uniqueIds(
      ownerUsers.map((owner: AlertOwnerUser): ObjectID | undefined => {
        return owner.userId;
      }),
    );

    const teamIds: Array<ObjectID> = uniqueIds(
      ownerTeams.map((owner: AlertOwnerTeam): ObjectID | undefined => {
        return owner.teamId;
      }),
    );

    if (userIds.length === 0 && teamIds.length === 0) {
      return { userIds, teamIds };
    }

    await IncidentService.addOwners(
      data.projectId,
      data.incidentId,
      userIds,
      teamIds,
      false,
      {
        isRoot: true,
      },
    );

    return { userIds, teamIds };
  }

  /*
   * Declaring an incident from alerts (miscDataProps.alertIdsToLink on an
   * Incident create). Runs in IncidentService.onBeforeCreate, BEFORE the
   * incident number is taken and before anything is written, so a bad id
   * neither burns an incident number nor leaves an incident behind with
   * half of its alerts. Returns the ids deduplicated and normalised, ready
   * for linkAlertsToIncident once the incident exists.
   */
  @CaptureSpan()
  public async validateAlertIdsForNewIncident(data: {
    projectId: ObjectID | undefined;
    alertIds: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<ObjectID>> {
    if (!Array.isArray(data.alertIds)) {
      throw new BadDataException(
        `${INCIDENT_ALERT_IDS_TO_LINK_KEY} must be an array of alert ids.`,
      );
    }

    const alertIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set();

    for (const value of data.alertIds as Array<unknown>) {
      let id: string | null = null;

      if (typeof value === "string") {
        id = value.trim();
      } else if (value instanceof ObjectID) {
        id = value.toString().trim();
      }

      if (!id || !ObjectID.isValidUUID(id)) {
        throw new BadDataException(
          `${INCIDENT_ALERT_IDS_TO_LINK_KEY} must only contain alert ids.`,
        );
      }

      const key: string = normalizeId(id);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      alertIds.push(new ObjectID(key));
    }

    if (alertIds.length === 0) {
      throw new BadDataException(
        "Please select at least one alert to link to the incident.",
      );
    }

    if (alertIds.length > MAX_ALERTS_PER_INCIDENT_LINK_ACTION) {
      throw new BadDataException(
        `You can link at most ${MAX_ALERTS_PER_INCIDENT_LINK_ACTION} alerts to an incident at a time. ${alertIds.length} were selected.`,
      );
    }

    if (!data.projectId) {
      throw new BadDataException(
        "projectId is required to link alerts to an incident.",
      );
    }

    const projectId: ObjectID = data.projectId;

    if (!data.props.isRoot) {
      /*
       * The links are written as root once the incident exists (see
       * IncidentService.onCreateSuccess), so this is where the caller's own
       * right to link alerts is checked.
       */
      const probe: Model = new Model();
      probe.projectId = projectId;
      probe.incidentId = ObjectID.generate();
      probe.alertId = alertIds[0]!;

      try {
        ModelPermission.checkCreatePermissions(Model, probe, data.props);
      } catch (error) {
        // A lapsed session or an unpaid project keeps its own answer.
        if (
          error instanceof NotAuthorizedException ||
          error instanceof BadDataException
        ) {
          throw new BadDataException(
            "You do not have permission to link alerts to incidents in this project.",
          );
        }

        throw error;
      }
    }

    /*
     * A user reads the alerts as themselves, so an alert they cannot open
     * (a private alert, a label they are not allowed to see) cannot be
     * pulled into their incident.
     */
    const alerts: Array<Alert> | null = await this.findVisible(() => {
      return AlertService.findBy({
        query: {
          _id: QueryHelper.any(alertIds),
          projectId: projectId,
        },
        select: {
          _id: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: data.props.isRoot ? { isRoot: true } : data.props,
      });
    });

    const foundIds: Set<string> = new Set(
      (alerts || []).map((alert: Alert) => {
        return normalizeId(alert._id || "");
      }),
    );

    const missing: Array<ObjectID> = alertIds.filter((id: ObjectID) => {
      return !foundIds.has(normalizeId(id));
    });

    if (missing.length > 0) {
      throw new BadDataException(NOT_VISIBLE_ALERTS_MESSAGE);
    }

    return alertIds;
  }

  /*
   * Links each alert to the incident, one at a time. An alert that is already
   * linked counts as done, not as a failure; any other failure is reported per
   * alert and never stops the rest.
   *
   * `declaredWithIncident` marks links written while the incident is being
   * declared from these alerts: they get no incident-side feed entry of their
   * own (see INCIDENT_ALERT_DECLARED_WITH_INCIDENT_KEY, root callers only).
   */
  @CaptureSpan()
  public async linkAlertsToIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    alertIds: Array<ObjectID>;
    createdByUserId?: ObjectID | undefined;
    declaredWithIncident?: boolean | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<LinkAlertsToIncidentResult> {
    const result: LinkAlertsToIncidentResult = {
      linkedAlertIds: [],
      alreadyLinkedAlertIds: [],
      failed: [],
    };

    for (const alertId of data.alertIds) {
      const link: Model = new Model();
      link.projectId = data.projectId;
      link.incidentId = data.incidentId;
      link.alertId = alertId;

      if (data.createdByUserId) {
        link.createdByUserId = data.createdByUserId;
      }

      try {
        await this.create({
          data: link,
          props: data.props,
          ...(data.declaredWithIncident
            ? {
                miscDataProps: {
                  [INCIDENT_ALERT_DECLARED_WITH_INCIDENT_KEY]: true,
                },
              }
            : {}),
        });
        result.linkedAlertIds.push(alertId);
      } catch (error) {
        if (PostgresErrorTranslator.isUniqueViolation(error)) {
          result.alreadyLinkedAlertIds.push(alertId);
          continue;
        }

        const message: string =
          error instanceof Error ? error.message : String(error);

        result.failed.push({ alertId: alertId, message: message });

        logger.error(
          `IncidentAlertService could not link alert ${alertId.toString()} to incident ${data.incidentId.toString()}: ${message}`,
          {
            projectId: data.projectId.toString(),
            incidentId: data.incidentId.toString(),
            alertId: alertId.toString(),
          } as LogAttributes,
        );
      }
    }

    return result;
  }

  /*
   * Reads miscDataProps[INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY] on an
   * incident create: whether to acknowledge the alerts the incident is
   * declared from once they are linked, and which. Null when not asked to
   * (absent, null or false). Otherwise the project's Acknowledged alert
   * state and the alerts that are not acknowledged yet - the only ones that
   * will be written, and so the only ones the caller must be allowed to
   * change: an alert that is already acknowledged or resolved is left alone,
   * so being unable to change it must not refuse the declaration.
   *
   * Called from IncidentService's onBeforeCreate after the alert ids were
   * validated - before the incident number is taken - so an impossible
   * request is refused instead of the incident being declared while its
   * alerts keep paging: the project has no Acknowledged alert state, or the
   * caller may not change the state of every alert that would be
   * acknowledged (see AlertStateChangeAuthorization; the acknowledgements
   * themselves are written as root, for exactly these alerts).
   */
  @CaptureSpan()
  public async validateAcknowledgeAlertsForNewIncident(data: {
    projectId: ObjectID | undefined;
    acknowledgeAlerts: unknown;
    alertIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<AlertsToAcknowledgeOnDeclare | null> {
    if (
      data.acknowledgeAlerts === undefined ||
      data.acknowledgeAlerts === null ||
      data.acknowledgeAlerts === false
    ) {
      return null;
    }

    if (data.acknowledgeAlerts !== true) {
      throw new BadDataException(
        `${INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY} must be true or false.`,
      );
    }

    if (data.alertIds.length === 0) {
      throw new BadDataException(
        `${INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY} only applies when the incident is declared from alerts: send the alert ids in ${INCIDENT_ALERT_IDS_TO_LINK_KEY}.`,
      );
    }

    if (!data.projectId) {
      throw new BadDataException(
        "projectId is required to acknowledge alerts.",
      );
    }

    const projectId: ObjectID = data.projectId;

    const acknowledgedState: AlertState | null =
      await AlertStateService.findOneBy({
        query: {
          projectId: projectId,
          isAcknowledgedState: true,
        },
        select: {
          _id: true,
          order: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      !acknowledgedState ||
      !acknowledgedState._id ||
      acknowledgedState.order === undefined ||
      acknowledgedState.order === null
    ) {
      throw new BadDataException(
        "This project has no Acknowledged alert state, so the alerts cannot be acknowledged. Declare the incident without acknowledging them, or add an Acknowledged state in the alert settings.",
      );
    }

    const acknowledgedOrder: number = acknowledgedState.order;

    const alerts: Array<Alert> = await AlertService.findBy({
      query: {
        _id: QueryHelper.any(data.alertIds),
        projectId: projectId,
      },
      select: {
        _id: true,
        currentAlertState: {
          order: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const stateOrderByAlertId: Map<string, number | undefined> = new Map();

    for (const alert of alerts) {
      if (alert._id) {
        stateOrderByAlertId.set(
          normalizeId(alert._id),
          alert.currentAlertState?.order ?? undefined,
        );
      }
    }

    // Same rule as acknowledgeAlertsDeclaredWithIncident: by order.
    const alertIdsToAcknowledge: Array<ObjectID> = data.alertIds.filter(
      (alertId: ObjectID): boolean => {
        const key: string = normalizeId(alertId);

        if (!stateOrderByAlertId.has(key)) {
          return false;
        }

        const order: number | undefined = stateOrderByAlertId.get(key);

        return order === undefined || order < acknowledgedOrder;
      },
    );

    if (
      alertIdsToAcknowledge.length > 0 &&
      !data.props.isRoot &&
      !data.props.isMasterAdmin
    ) {
      try {
        await AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId: projectId,
          alertIds: alertIdsToAcknowledge,
          props: data.props,
        });
      } catch (error) {
        // A lapsed session or an unpaid project keeps its own answer.
        if (
          error instanceof NotAuthorizedException ||
          error instanceof BadDataException
        ) {
          throw new BadDataException(
            "You do not have permission to acknowledge one or more of these alerts. Declare the incident without acknowledging them, or ask a project admin for permission.",
          );
        }

        throw error;
      }
    }

    return {
      acknowledgedAlertStateId: new ObjectID(acknowledgedState._id.toString()),
      alertIdsToAcknowledge: alertIdsToAcknowledge,
    };
  }

  /*
   * Acknowledges the alerts an incident was just declared from, when the
   * declaration asked for it (INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY). An
   * alert's own on-call escalation and its per-user notifications stop once
   * the alert is acknowledged (the workers check at their next run), so this
   * is what makes declaring an incident stop the alerts paging.
   *
   * Written as root - the caller's right to change the state of every one of
   * these alerts was checked before the incident was created - and credited
   * to the declaring user, as if they had pressed Acknowledge on each alert
   * themselves: the alert's owners are told, and the alert's feed says who
   * and why. A private incident is not named in that "why", because the
   * alert's feed entry is posted to the alert's Slack / Microsoft Teams
   * channels and its owners' notifications.
   *
   * Left as they are:
   * - alerts already acknowledged, resolved or in any later state - nothing
   *   is ever moved backwards;
   * - linked alerts the project's linked-alert sync is about to move anyway
   *   (the incident was declared straight into an acknowledged or resolved
   *   state with the project switches on): one writer per alert, so the two
   *   never race on its timeline.
   *
   * IncidentService runs this after the links are written and does not wait
   * for it. It never throws: one alert failing never stops the others.
   */
  @CaptureSpan()
  public async acknowledgeAlertsDeclaredWithIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    alertIds: Array<ObjectID>;
    // The alerts whose link to the incident exists (the sync runs on those).
    linkedAlertIds: Array<ObjectID>;
    acknowledgedByUserId: ObjectID | undefined;
  }): Promise<AcknowledgeDeclaredAlertsResult> {
    const result: AcknowledgeDeclaredAlertsResult = {
      acknowledgedAlertIds: [],
      alreadyAcknowledgedAlertIds: [],
      leftToLinkedAlertSyncAlertIds: [],
      failed: [],
    };

    const alertIds: Array<ObjectID> = uniqueIds(data.alertIds);

    if (alertIds.length === 0) {
      return result;
    }

    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
      incidentId: data.incidentId.toString(),
    } as LogAttributes;

    try {
      const acknowledgedState: AlertState | null =
        await AlertStateService.findOneBy({
          query: {
            projectId: data.projectId,
            isAcknowledgedState: true,
          },
          select: {
            _id: true,
            order: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (
        !acknowledgedState ||
        !acknowledgedState._id ||
        acknowledgedState.order === undefined ||
        acknowledgedState.order === null
      ) {
        const message: string =
          "This project has no Acknowledged alert state, so the alerts could not be acknowledged.";

        logger.error(`IncidentAlertService: ${message}`, logAttributes);

        for (const alertId of alertIds) {
          result.failed.push({ alertId: alertId, message: message });
        }

        return result;
      }

      const acknowledgedStateId: ObjectID = new ObjectID(
        acknowledgedState._id.toString(),
      );
      const acknowledgedOrder: number = acknowledgedState.order;

      const incident: Incident | null = await IncidentService.findOneById({
        id: data.incidentId,
        select: {
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          isPrivate: true,
          currentIncidentStateId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const rootCause: string = getDeclaredAlertAcknowledgementCause({
        incidentNumber: formatNumber(
          incident?.incidentNumberWithPrefix,
          incident?.incidentNumber,
        ),
        isIncidentPrivate: incident?.isPrivate === true,
      });

      const alerts: Array<Alert> = await AlertService.findBy({
        query: {
          _id: QueryHelper.any(alertIds),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          currentAlertStateId: true,
          currentAlertState: {
            order: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const alertById: Map<string, Alert> = new Map();

      for (const alert of alerts) {
        if (alert._id) {
          alertById.set(normalizeId(alert._id), alert);
        }
      }

      const ownedBySync: Set<string> =
        await this.getLinkedAlertsTheSyncWillMove({
          projectId: data.projectId,
          incidentId: data.incidentId,
          incidentStateId: incident?.currentIncidentStateId || undefined,
          linkedAlerts: uniqueIds(data.linkedAlertIds)
            .map((alertId: ObjectID): Alert | undefined => {
              return alertById.get(normalizeId(alertId));
            })
            .filter((alert: Alert | undefined): boolean => {
              return Boolean(alert);
            }) as Array<Alert>,
        });

      const alertIdsToWrite: Array<ObjectID> = [];

      for (const alertId of alertIds) {
        const key: string = normalizeId(alertId);
        const alert: Alert | undefined = alertById.get(key);

        if (!alert) {
          result.failed.push({
            alertId: alertId,
            message: "The alert could not be found in this project.",
          });
          continue;
        }

        const stateOrder: number | undefined =
          alert.currentAlertState?.order ?? undefined;

        if (stateOrder !== undefined && stateOrder >= acknowledgedOrder) {
          result.alreadyAcknowledgedAlertIds.push(alertId);
          continue;
        }

        if (ownedBySync.has(key)) {
          result.leftToLinkedAlertSyncAlertIds.push(alertId);
          continue;
        }

        alertIdsToWrite.push(alertId);
      }

      for (
        let index: number = 0;
        index < alertIdsToWrite.length;
        index += DECLARED_ALERT_ACKNOWLEDGE_CONCURRENCY
      ) {
        const batch: Array<ObjectID> = alertIdsToWrite.slice(
          index,
          index + DECLARED_ALERT_ACKNOWLEDGE_CONCURRENCY,
        );

        const outcomes: Array<string | null> = await Promise.all(
          batch.map((alertId: ObjectID): Promise<string | null> => {
            return this.acknowledgeDeclaredAlert({
              projectId: data.projectId,
              alertId: alertId,
              acknowledgedStateId: acknowledgedStateId,
              acknowledgedOrder: acknowledgedOrder,
              rootCause: rootCause,
              acknowledgedByUserId: data.acknowledgedByUserId,
            });
          }),
        );

        batch.forEach((alertId: ObjectID, batchIndex: number) => {
          const failure: string | null = outcomes[batchIndex] ?? null;

          if (failure === null) {
            result.acknowledgedAlertIds.push(alertId);
            return;
          }

          result.failed.push({ alertId: alertId, message: failure });

          logger.error(
            `IncidentAlertService could not acknowledge alert ${alertId.toString()} for the incident it was declared with: ${failure}`,
            {
              ...logAttributes,
              alertId: alertId.toString(),
            } as LogAttributes,
          );
        });
      }
    } catch (error) {
      logger.error(
        `IncidentAlertService could not acknowledge the alerts an incident was declared from: ${error}`,
        logAttributes,
      );

      const settled: Set<string> = new Set(
        [
          ...result.acknowledgedAlertIds,
          ...result.alreadyAcknowledgedAlertIds,
          ...result.leftToLinkedAlertSyncAlertIds,
          ...result.failed.map((failure: { alertId: ObjectID }) => {
            return failure.alertId;
          }),
        ].map((alertId: ObjectID): string => {
          return normalizeId(alertId);
        }),
      );

      for (const alertId of alertIds) {
        if (!settled.has(normalizeId(alertId))) {
          result.failed.push({
            alertId: alertId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return result;
  }

  /*
   * The linked alerts the project's linked-alert sync (and the incident
   * state cascade) will move by themselves, because the incident is already
   * in a state their switches act on: the same plan, the same per-alert
   * choice. Empty when both switches are off - the default - or the incident
   * is before Acknowledged, which is the usual declaration.
   */
  @CaptureSpan()
  private async getLinkedAlertsTheSyncWillMove(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    incidentStateId: ObjectID | undefined;
    linkedAlerts: Array<Alert>;
  }): Promise<Set<string>> {
    const willMove: Set<string> = new Set();

    if (!data.incidentStateId || data.linkedAlerts.length === 0) {
      return willMove;
    }

    const switches: LinkedAlertSwitches | null =
      await this.getLinkedAlertSwitches(data.projectId);

    if (!switches) {
      return willMove;
    }

    const plan: LinkedAlertStatePlan | null =
      await this.buildLinkedAlertStatePlan({
        projectId: data.projectId,
        incidentStateId: data.incidentStateId,
        switches: switches,
      });

    if (!plan) {
      return willMove;
    }

    const blockedFromResolve: Set<string> = plan.resolvedAlertState
      ? await this.getAlertsHeldOpenByAnotherIncident({
          plan: plan,
          projectId: data.projectId,
          incidentId: data.incidentId,
          alerts: data.linkedAlerts,
        })
      : new Set();

    for (const alert of data.linkedAlerts) {
      const alertId: string = alert._id ? normalizeId(alert._id) : "";

      const alertStateOrder: number | undefined = alert.currentAlertStateId
        ? plan.alertStateOrderById.get(normalizeId(alert.currentAlertStateId))
        : undefined;

      if (!alertId || alertStateOrder === undefined) {
        continue;
      }

      const target: AlertState | null = chooseLinkedAlertTargetState({
        alertStateOrder: alertStateOrder,
        acknowledgedAlertState: plan.acknowledgedAlertState,
        resolvedAlertState: plan.resolvedAlertState,
        isBlockedFromResolve: blockedFromResolve.has(alertId),
      });

      if (target) {
        willMove.add(alertId);
      }
    }

    return willMove;
  }

  /*
   * Acknowledges one declared alert. Null when the alert ended up
   * acknowledged (or past it), otherwise why not. Never throws.
   *
   * The outcome is read back from the alert rather than taken from the
   * write: the write may be refused because somebody acknowledged or
   * resolved the alert in the meantime (the outcome asked for), and a write
   * that "succeeded" only counts if the alert's current state moved.
   */
  @CaptureSpan()
  private async acknowledgeDeclaredAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    acknowledgedStateId: ObjectID;
    acknowledgedOrder: number;
    rootCause: string;
    acknowledgedByUserId: ObjectID | undefined;
  }): Promise<string | null> {
    let failure: string = "The alert's state did not change to Acknowledged.";

    try {
      await AlertService.changeAlertState({
        projectId: data.projectId,
        alertId: data.alertId,
        alertStateId: data.acknowledgedStateId,
        notifyOwners: true,
        rootCause: data.rootCause,
        stateChangeLog: undefined,
        createdByUserId: data.acknowledgedByUserId,
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    try {
      const alert: Alert | null = await AlertService.findOneBy({
        query: {
          _id: data.alertId,
          projectId: data.projectId,
        },
        select: {
          currentAlertState: {
            order: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      const order: number | undefined =
        alert?.currentAlertState?.order ?? undefined;

      if (order !== undefined && order >= data.acknowledgedOrder) {
        return null;
      }
    } catch {
      // The alert cannot be read back, so it cannot be counted as done.
    }

    return failure;
  }

  /*
   * An incident changed state: bring its linked alerts along, when the
   * project has opted in. Called fire-and-forget from
   * IncidentStateTimelineService.onCreateSuccess for the incident's CURRENT
   * state only. Never throws; every failure is logged, and one alert failing
   * does not stop the others.
   */
  @CaptureSpan()
  public async cascadeIncidentStateToLinkedAlerts(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    incidentStateId: ObjectID;
  }): Promise<void> {
    try {
      const switches: LinkedAlertSwitches | null =
        await this.getLinkedAlertSwitches(data.projectId);

      if (!switches) {
        return;
      }

      const plan: LinkedAlertStatePlan | null =
        await this.buildLinkedAlertStatePlan({
          projectId: data.projectId,
          incidentStateId: data.incidentStateId,
          switches: switches,
        });

      if (!plan) {
        return;
      }

      const links: Array<Model> = await this.findBy({
        query: {
          incidentId: data.incidentId,
          projectId: data.projectId,
        },
        select: {
          alertId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const alertIds: Array<ObjectID> = [];

      for (const link of links) {
        if (link.alertId) {
          alertIds.push(link.alertId);
        }
      }

      if (alertIds.length === 0) {
        return;
      }

      const incident: Incident | null = await IncidentService.findOneById({
        id: data.incidentId,
        select: {
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!incident) {
        return;
      }

      await this.applyLinkedAlertStatePlan({
        plan: plan,
        projectId: data.projectId,
        incidentId: data.incidentId,
        incidentNumber: formatNumber(
          incident.incidentNumberWithPrefix,
          incident.incidentNumber,
        ),
        alertIds: alertIds,
      });
    } catch (error) {
      logger.error(
        `IncidentAlertService could not carry an incident state change over to its linked alerts: ${error}`,
        {
          projectId: data.projectId.toString(),
          incidentId: data.incidentId.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * The link-time half: an alert was just linked to an incident that may
   * already be acknowledged or resolved. Same rules as the cascade, applied to
   * the one alert. An incident declared from alerts usually starts in its
   * created state, which calls for nothing; one declared straight into an
   * acknowledged or resolved state brings its alerts along here (and
   * acknowledgeAlertsDeclaredWithIncident leaves those alerts to this).
   * Never throws.
   */
  @CaptureSpan()
  public async syncAlertWithLinkedIncidentState(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    alertId: ObjectID;
  }): Promise<void> {
    try {
      const switches: LinkedAlertSwitches | null =
        await this.getLinkedAlertSwitches(data.projectId);

      if (!switches) {
        return;
      }

      const incident: Incident | null = await IncidentService.findOneById({
        id: data.incidentId,
        select: {
          currentIncidentStateId: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!incident || !incident.currentIncidentStateId) {
        return;
      }

      const plan: LinkedAlertStatePlan | null =
        await this.buildLinkedAlertStatePlan({
          projectId: data.projectId,
          incidentStateId: incident.currentIncidentStateId,
          switches: switches,
        });

      if (!plan) {
        return;
      }

      await this.applyLinkedAlertStatePlan({
        plan: plan,
        projectId: data.projectId,
        incidentId: data.incidentId,
        incidentNumber: formatNumber(
          incident.incidentNumberWithPrefix,
          incident.incidentNumber,
        ),
        alertIds: [data.alertId],
      });
    } catch (error) {
      logger.error(
        `IncidentAlertService could not sync a linked alert with its incident's state: ${error}`,
        {
          projectId: data.projectId.toString(),
          incidentId: data.incidentId.toString(),
          alertId: data.alertId.toString(),
        } as LogAttributes,
      );
    }
  }

  // Null when both project switches are off (the default).
  @CaptureSpan()
  private async getLinkedAlertSwitches(
    projectId: ObjectID,
  ): Promise<LinkedAlertSwitches | null> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        acknowledgeLinkedAlertsWhenIncidentAcknowledged: true,
        resolveLinkedAlertsWhenIncidentResolved: true,
      },
      props: {
        isRoot: true,
      },
    });

    const switches: LinkedAlertSwitches = {
      acknowledge:
        project?.acknowledgeLinkedAlertsWhenIncidentAcknowledged === true,
      resolve: project?.resolveLinkedAlertsWhenIncidentResolved === true,
    };

    if (!switches.acknowledge && !switches.resolve) {
      return null;
    }

    return switches;
  }

  // Null when the incident's state calls for nothing.
  @CaptureSpan()
  private async buildLinkedAlertStatePlan(data: {
    projectId: ObjectID;
    incidentStateId: ObjectID;
    switches: LinkedAlertSwitches;
  }): Promise<LinkedAlertStatePlan | null> {
    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
    } as LogAttributes;

    const incidentStates: Array<IncidentState> =
      await IncidentStateService.getAllIncidentStates({
        projectId: data.projectId,
        props: {
          isRoot: true,
        },
      });

    const incidentStateOrderById: Map<string, number> = new Map();

    for (const state of incidentStates) {
      if (state._id && state.order !== undefined && state.order !== null) {
        incidentStateOrderById.set(normalizeId(state._id), state.order);
      }
    }

    const incidentStateOrder: number | undefined = incidentStateOrderById.get(
      normalizeId(data.incidentStateId),
    );

    if (incidentStateOrder === undefined) {
      logger.error(
        `IncidentAlertService: incident state ${data.incidentStateId.toString()} was not found in its project, linked alerts were left as they are.`,
        logAttributes,
      );
      return null;
    }

    const acknowledgedIncidentState: IncidentState | undefined =
      incidentStates.find((state: IncidentState) => {
        return state.isAcknowledgedState;
      });
    const resolvedIncidentState: IncidentState | undefined =
      incidentStates.find((state: IncidentState) => {
        return state.isResolvedState;
      });

    const targets: LinkedAlertStateTargets = getLinkedAlertStateTargets({
      incidentStateOrder: incidentStateOrder,
      acknowledgedIncidentStateOrder: acknowledgedIncidentState?.order,
      resolvedIncidentStateOrder: resolvedIncidentState?.order,
      acknowledgeSwitch: data.switches.acknowledge,
      resolveSwitch: data.switches.resolve,
    });

    if (!targets.acknowledge && !targets.resolve) {
      return null;
    }

    const alertStates: Array<AlertState> =
      await AlertStateService.getAllAlertStates({
        projectId: data.projectId,
        props: {
          isRoot: true,
        },
      });

    const alertStateOrderById: Map<string, number> = new Map();

    for (const state of alertStates) {
      if (state._id && state.order !== undefined && state.order !== null) {
        alertStateOrderById.set(normalizeId(state._id), state.order);
      }
    }

    let acknowledgedAlertState: AlertState | undefined = undefined;
    let resolvedAlertState: AlertState | undefined = undefined;

    if (targets.acknowledge) {
      acknowledgedAlertState = alertStates.find((state: AlertState) => {
        return state.isAcknowledgedState;
      });

      if (!acknowledgedAlertState) {
        logger.error(
          "IncidentAlertService: the project has no Acknowledged alert state, so linked alerts could not be acknowledged.",
          logAttributes,
        );
      }
    }

    if (targets.resolve) {
      resolvedAlertState = alertStates.find((state: AlertState) => {
        return state.isResolvedState;
      });

      if (!resolvedAlertState) {
        logger.error(
          "IncidentAlertService: the project has no Resolved alert state, so linked alerts could not be resolved.",
          logAttributes,
        );
      }
    }

    if (!acknowledgedAlertState && !resolvedAlertState) {
      return null;
    }

    return {
      acknowledgedAlertState: acknowledgedAlertState,
      resolvedAlertState: resolvedAlertState,
      incidentReachedResolved: targets.incidentReachedResolved,
      resolvedIncidentStateOrder: resolvedIncidentState?.order,
      alertStateOrderById: alertStateOrderById,
      incidentStateOrderById: incidentStateOrderById,
    };
  }

  @CaptureSpan()
  private async applyLinkedAlertStatePlan(data: {
    plan: LinkedAlertStatePlan;
    projectId: ObjectID;
    incidentId: ObjectID;
    incidentNumber: string;
    alertIds: Array<ObjectID>;
  }): Promise<void> {
    const { plan, projectId, incidentId } = data;

    const alerts: Array<Alert> = await AlertService.findBy({
      query: {
        _id: QueryHelper.any(data.alertIds),
        projectId: projectId,
      },
      select: {
        _id: true,
        currentAlertStateId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const blockedFromResolve: Set<string> = plan.resolvedAlertState
      ? await this.getAlertsHeldOpenByAnotherIncident({
          plan: plan,
          projectId: projectId,
          incidentId: incidentId,
          alerts: alerts,
        })
      : new Set();

    const incidentLabel: string = withNumber("Incident", data.incidentNumber);

    for (const alert of alerts) {
      const alertId: string = alert._id?.toString() || "";

      const alertStateOrder: number | undefined = alert.currentAlertStateId
        ? plan.alertStateOrderById.get(normalizeId(alert.currentAlertStateId))
        : undefined;

      if (!alertId || alertStateOrder === undefined) {
        logger.error(
          `IncidentAlertService: the current state of linked alert ${alertId} is unknown, so it was left as it is.`,
          {
            projectId: projectId.toString(),
            incidentId: incidentId.toString(),
            alertId: alertId,
          } as LogAttributes,
        );
        continue;
      }

      const target: AlertState | null = chooseLinkedAlertTargetState({
        alertStateOrder: alertStateOrder,
        acknowledgedAlertState: plan.acknowledgedAlertState,
        resolvedAlertState: plan.resolvedAlertState,
        isBlockedFromResolve: blockedFromResolve.has(normalizeId(alertId)),
      });

      if (!target || !target._id) {
        continue;
      }

      const isResolving: boolean = target === plan.resolvedAlertState;

      const rootCause: string = isResolving
        ? `Resolved because linked ${incidentLabel} was resolved.`
        : `Acknowledged because linked ${incidentLabel} was ${
            plan.incidentReachedResolved ? "resolved" : "acknowledged"
          }.`;

      try {
        await AlertService.changeAlertState({
          projectId: projectId,
          alertId: new ObjectID(alertId),
          alertStateId: new ObjectID(target._id.toString()),
          notifyOwners: false,
          rootCause: rootCause,
          stateChangeLog: undefined,
          props: {
            isRoot: true,
          },
        });
      } catch (error) {
        logger.error(
          `IncidentAlertService could not change the state of linked alert ${alertId}: ${error}`,
          {
            projectId: projectId.toString(),
            incidentId: incidentId.toString(),
            alertId: alertId,
          } as LogAttributes,
        );
      }
    }
  }

  /*
   * An alert linked to several incidents is resolved only once none of them
   * is still open: resolving one incident must not close an alert another
   * open incident is still tracking. Only alerts that would otherwise be
   * resolved are looked up.
   */
  @CaptureSpan()
  private async getAlertsHeldOpenByAnotherIncident(data: {
    plan: LinkedAlertStatePlan;
    projectId: ObjectID;
    incidentId: ObjectID;
    alerts: Array<Alert>;
  }): Promise<Set<string>> {
    const held: Set<string> = new Set();
    const resolvedAlertStateOrder: number | undefined =
      data.plan.resolvedAlertState?.order;

    if (resolvedAlertStateOrder === undefined) {
      return held;
    }

    const candidateIds: Array<string> = [];

    for (const alert of data.alerts) {
      const order: number | undefined = alert.currentAlertStateId
        ? data.plan.alertStateOrderById.get(
            normalizeId(alert.currentAlertStateId),
          )
        : undefined;

      if (alert._id && order !== undefined && order < resolvedAlertStateOrder) {
        candidateIds.push(normalizeId(alert._id));
      }
    }

    if (candidateIds.length === 0) {
      return held;
    }

    const otherLinks: Array<Model> = await this.findBy({
      query: {
        alertId: QueryHelper.any(candidateIds),
        projectId: data.projectId,
      },
      select: {
        alertId: true,
        incidentId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const thisIncidentId: string = normalizeId(data.incidentId);
    const otherIncidentIdsByAlert: Map<string, Array<string>> = new Map();
    const otherIncidentIds: Set<string> = new Set();

    for (const link of otherLinks) {
      if (!link.alertId || !link.incidentId) {
        continue;
      }

      const incidentId: string = normalizeId(link.incidentId);

      if (incidentId === thisIncidentId) {
        continue;
      }

      const alertId: string = normalizeId(link.alertId);
      const incidentIds: Array<string> =
        otherIncidentIdsByAlert.get(alertId) || [];
      incidentIds.push(incidentId);
      otherIncidentIdsByAlert.set(alertId, incidentIds);
      otherIncidentIds.add(incidentId);
    }

    if (otherIncidentIds.size === 0) {
      return held;
    }

    const otherIncidents: Array<Incident> = await IncidentService.findBy({
      query: {
        _id: QueryHelper.any(Array.from(otherIncidentIds)),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        currentIncidentStateId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const openIncidentIds: Set<string> = new Set();

    for (const incident of otherIncidents) {
      if (!incident._id) {
        continue;
      }

      const order: number | undefined = incident.currentIncidentStateId
        ? data.plan.incidentStateOrderById.get(
            normalizeId(incident.currentIncidentStateId),
          )
        : undefined;

      /*
       * An incident whose state cannot be placed is treated as open: leaving
       * an alert unresolved is recoverable, resolving it too early is not.
       */
      const isResolved: boolean =
        order !== undefined &&
        data.plan.resolvedIncidentStateOrder !== undefined &&
        order >= data.plan.resolvedIncidentStateOrder;

      if (!isResolved) {
        openIncidentIds.add(normalizeId(incident._id));
      }
    }

    for (const [alertId, incidentIds] of otherIncidentIdsByAlert) {
      if (
        incidentIds.some((incidentId: string) => {
          return openIncidentIds.has(incidentId);
        })
      ) {
        held.add(alertId);
      }
    }

    return held;
  }
}

export default new Service();
