import DatabaseConfig from "../DatabaseConfig";
import ProjectReferencesService from "./ProjectReferencesService";
import ProjectService from "./ProjectService";
import SecurityCaseFeedService from "./SecurityCaseFeedService";
import TeamService from "./TeamService";
import UserService from "./UserService";
import Model from "../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../Models/DatabaseModels/SecurityCaseFeed";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import SecurityPlaybookLauncher from "../Utils/SecurityPlaybook/SecurityPlaybookLauncher";
import SecurityCaseSourceAlerts from "../Utils/SecurityCase/SecurityCaseSourceAlerts";
import SecurityCaseNotifications, {
  isSetupTestCase,
} from "../Utils/SecurityCase/SecurityCaseNotifications";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "../Utils/SecurityCase/SecurityCaseValues";
import SecurityCasePriority from "../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../Models/DatabaseModels/SecurityCaseStatus";
import {
  Blue500,
  Gray500,
  Green500,
  Orange500,
  Purple500,
} from "../../Types/BrandColors";
import URL from "../../Types/API/URL";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import SecurityCaseStage from "../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict, {
  isSecurityCaseVerdict,
} from "../../Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource from "../../Types/SecurityCase/SecurityDetectionSource";
import {
  SecurityEntity,
  mergeSecurityEntities,
} from "../../Types/SecurityCase/SecurityEntity";
import SecurityPlaybookTrigger from "../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import {
  resolveMitreTacticId,
  resolveMitreTechniqueId,
} from "../../Types/SecurityEvent/MitreAttack";
import { formatSecurityCaseNumber } from "../../Types/SecurityCase/SecurityCaseNumber";
import {
  assigneeChangedMarkdown,
  caseOpenedByPersonMarkdown,
  priorityChangedMarkdown,
  statusChangedMarkdown,
} from "../../Utils/SecurityCase/SecurityCaseMarkdown";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import PartialEntity from "../../Types/Database/PartialEntity";
import SecurityCasePriorities from "../../Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses, {
  SecurityCaseStatusChange,
} from "../../Utils/SecurityCase/SecurityCaseStatuses";

/*
 * Request-scoped choices the case hooks read (CreateBy / UpdateBy
 * miscDataProps):
 *
 *  - openedByDetection: the detection ingest opened the case and attaches
 *    its first detection right after, so the ingest - not the create hook -
 *    starts the Case Opened playbooks, once the case has the detection their
 *    conditions read.
 *  - playbookName: a playbook step made the change; the feed says so.
 */
export const SECURITY_CASE_OPENED_BY_DETECTION_KEY: string =
  "openedByDetection";
export const SECURITY_CASE_PLAYBOOK_NAME_KEY: string = "playbookName";

/*
 * The case's two references, as a write can name them: a form writes the
 * relation ({ assignedToUser: { _id } }), a server caller the ID column. The
 * hooks fold the relation into the ID column before they read it.
 */
const ASSIGNEE_KEYS: Array<string> = ["assignedToUserId", "assignedToUser"];
const ASSIGNED_TEAM_KEYS: Array<string> = [
  "assignedToTeamId",
  "assignedToTeam",
];
// The case's status and priority: one of the project's own, by either spelling.
const STATUS_KEYS: Array<string> = ["securityCaseStatusId", "securityCaseStatus"];
const PRIORITY_KEYS: Array<string> = [
  "securityCasePriorityId",
  "securityCasePriority",
];

/*
 * A reference cleared through its relation ({ assignedToUser: null }) is
 * cleared in its ID column too, so a hook that reads the ID column sees the
 * clear.
 */
function clearIdColumnsClearedByRelation(data: JSONObject): void {
  for (const [idColumn, relation] of [ASSIGNEE_KEYS, ASSIGNED_TEAM_KEYS]) {
    if (
      idColumn &&
      relation &&
      data[relation] === null &&
      data[idColumn] === undefined
    ) {
      data[idColumn] = null;
    }
  }
}

// The case columns whose change the update hooks look at.
interface CaseStateBeforeUpdate {
  id: string;
  projectId: ObjectID | undefined;
  statusId: string | undefined;
  priorityId: string | undefined;
  verdict: SecurityCaseVerdict | undefined;
  assignedToUserId: string | undefined;
  assignedToTeamId: string | undefined;
  acknowledgedAt: Date | undefined;
  containedAt: Date | undefined;
}

// ATT&CK ids as stored: tactics and techniques of the current matrix, upper-cased, once each.
export function normalizeMitreIds(
  value: unknown,
  kind: "tactic" | "technique",
): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: Array<string> = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed: string = item.trim().toUpperCase();

    if (!trimmed) {
      continue;
    }

    /*
     * Techniques keep their own id (a sub-technique stays T1110.003) when the
     * current matrix knows its parent; tactics are stored as ids even when
     * given by name.
     */
    const id: string | undefined =
      kind === "tactic"
        ? resolveMitreTacticId(trimmed)
        : resolveMitreTechniqueId(trimmed)
          ? trimmed
          : undefined;

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  private normalizeWrite(data: JSONObject): void {
    if (data["title"] !== undefined && data["title"] !== null) {
      const title: string = String(data["title"]).trim();

      if (!title) {
        throw new BadDataException("A case needs a title.");
      }

      data["title"] = title;
    }

    /*
     * A case always has a status and a priority: one may be changed, never
     * cleared. Which ones a project has is checked by the project reference
     * check (an id of another project's is refused) and the archived value
     * check (an archived one is never picked again).
     */
    for (const [keys, what] of [
      [STATUS_KEYS, "status"],
      [PRIORITY_KEYS, "priority"],
    ] as Array<[Array<string>, string]>) {
      for (const key of keys) {
        if (data[key] === null) {
          throw new BadDataException(
            `A case always has a ${what}: choose another one instead of clearing it.`,
          );
        }
      }
    }

    if (data["verdict"] !== undefined && data["verdict"] !== null) {
      if (!isSecurityCaseVerdict(data["verdict"])) {
        throw new BadDataException(
          "Verdict must be True Positive, Benign Positive, False Positive or Undetermined.",
        );
      }
    }

    if (data["entities"] !== undefined && data["entities"] !== null) {
      if (!Array.isArray(data["entities"])) {
        throw new BadDataException(
          "Entities must be a list of { type, value }.",
        );
      }

      data["entities"] = mergeSecurityEntities(
        data["entities"] as unknown as Array<SecurityEntity>,
      ) as unknown as JSONArray;
    }

    if (data["mitreTactics"] !== undefined && data["mitreTactics"] !== null) {
      data["mitreTactics"] = normalizeMitreIds(data["mitreTactics"], "tactic");
    }

    if (
      data["mitreTechniques"] !== undefined &&
      data["mitreTechniques"] !== null
    ) {
      data["mitreTechniques"] = normalizeMitreIds(
        data["mitreTechniques"],
        "technique",
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);
    const data: Model = createBy.data;

    if (!data.projectId) {
      throw new BadDataException("A case needs a project.");
    }

    if (!data.title) {
      throw new BadDataException("A case needs a title.");
    }

    this.normalizeWrite(data as unknown as JSONObject);

    RelationIdUtil.readIntoIdColumn(
      data as unknown as JSONObject,
      ASSIGNEE_KEYS,
      "Assignee",
    );
    RelationIdUtil.readIntoIdColumn(
      data as unknown as JSONObject,
      ASSIGNED_TEAM_KEYS,
      "Team",
    );

    const statusId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data as unknown as JSONObject,
      STATUS_KEYS,
      "Status",
    );
    const priorityId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data as unknown as JSONObject,
      PRIORITY_KEYS,
      "Priority",
    );

    /*
     * A case starts in the project's new status and, opened by a person, at
     * its medium priority (a detection opens its case at the priority of
     * its severity, which the ingest names).
     */
    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(data.projectId);

    if (!statusId) {
      RelationIdUtil.stamp(
        data as unknown as Record<string, unknown>,
        STATUS_KEYS,
        this.getIdOf(
          SecurityCaseStatuses.getStatusOfStage(
            values.statuses,
            SecurityCaseStage.New,
          ),
          "status",
        ),
      );
    }

    if (!priorityId) {
      RelationIdUtil.stamp(
        data as unknown as Record<string, unknown>,
        PRIORITY_KEYS,
        this.getIdOf(
          SecurityCasePriorities.getDefaultPriority(values.priorities),
          "priority",
        ),
      );
    }

    // A person opening a case is its source; the detection ingest names its own.
    if (!data.source && !createBy.props.isRoot) {
      data.source = SecurityDetectionSource.Manual;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    // What the status it starts in counts as: as if it had moved there.
    const created: SecurityCaseStatusChange =
      SecurityCaseStatuses.getCreatedStatusChange({
        statuses: values.statuses,
        statusId: data.securityCaseStatusId,
      });

    if (created.acknowledges || data.assignedToUserId) {
      data.acknowledgedAt = now;
    }

    if (created.contains) {
      data.containedAt = now;
    }

    if (created.closes) {
      data.closedAt = now;
      data.verdict = data.verdict || SecurityCaseVerdict.Undetermined;

      if (createBy.props.userId) {
        RelationIdUtil.stamp(
          data as unknown as Record<string, unknown>,
          ["closedByUserId", "closedByUser"],
          createBy.props.userId,
        );
      }
    } else {
      // A verdict is what a closed case turned out to be; an open one has none.
      delete data.verdict;
    }

    const counter: number =
      await ProjectService.incrementAndGetSecurityCaseCounter(data.projectId);

    data.caseNumber = counter;
    data.caseNumberWithPrefix = formatSecurityCaseNumber(counter);

    return { createBy: createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const openedByDetection: boolean =
      onCreate.createBy.miscDataProps?.[
        SECURITY_CASE_OPENED_BY_DETECTION_KEY
      ] === true;

    /*
     * Whoever's chosen priority the new case reaches is told, a moment from
     * now (SecurityCaseNotifications), and whoever it was opened assigned to.
     * The person who opened it is not told about it, and nobody is told
     * about the setup test's case.
     */
    if (
      createdItem.id &&
      createdItem.projectId &&
      !isSetupTestCase(createdItem)
    ) {
      await SecurityCaseNotifications.caseReachedPriority({
        projectId: createdItem.projectId,
        securityCaseId: createdItem.id,
        actorUserId: onCreate.createBy.props.userId,
      });

      await SecurityCaseNotifications.caseAssigned({
        projectId: createdItem.projectId,
        securityCaseId: createdItem.id,
        userId: createdItem.assignedToUserId,
        teamId: createdItem.assignedToTeamId,
        actorUserId: onCreate.createBy.props.userId,
      });
    }

    if (createdItem.id && createdItem.projectId && !openedByDetection) {
      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: createdItem.projectId,
        securityCaseId: createdItem.id,
        feedInfoInMarkdown: caseOpenedByPersonMarkdown().toString(),
        eventType: SecurityCaseFeedEventType.CaseOpened,
        displayColor: Blue500,
        userId: onCreate.createBy.props.userId,
      });

      /*
       * Not awaited past the queueing: a playbook that fails to start must
       * not fail the person's create (the launcher logs and records it).
       */
      try {
        await SecurityPlaybookLauncher.launchForCase({
          projectId: createdItem.projectId,
          securityCaseId: createdItem.id,
          trigger: SecurityPlaybookTrigger.CaseOpened,
        });
      } catch (error) {
        logger.error(
          `SecurityCaseService: could not start playbooks for case ${createdItem.id.toString()}:`,
        );
        logger.error(error);
      }
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    this.normalizeWrite(data);

    RelationIdUtil.readIntoIdColumn(data, ASSIGNEE_KEYS, "Assignee");
    RelationIdUtil.readIntoIdColumn(data, ASSIGNED_TEAM_KEYS, "Team");
    clearIdColumnsClearedByRelation(data);

    RelationIdUtil.readIntoIdColumn(data, STATUS_KEYS, "Status");
    RelationIdUtil.readIntoIdColumn(data, PRIORITY_KEYS, "Priority");

    const watchesState: boolean =
      data["securityCaseStatusId"] !== undefined ||
      data["securityCasePriorityId"] !== undefined ||
      data["assignedToUserId"] !== undefined ||
      data["assignedToTeamId"] !== undefined;

    if (!watchesState) {
      return { updateBy, carryForward: null };
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        securityCaseStatusId: true,
        securityCasePriorityId: true,
        verdict: true,
        assignedToUserId: true,
        assignedToTeamId: true,
        acknowledgedAt: true,
        containedAt: true,
      },
    );

    const before: Map<string, CaseStateBeforeUpdate> = new Map();

    for (const row of rows) {
      if (!row.id) {
        continue;
      }

      before.set(row.id.toString(), {
        id: row.id.toString(),
        projectId: row.projectId,
        statusId: row.securityCaseStatusId?.toString(),
        priorityId: row.securityCasePriorityId?.toString(),
        verdict: row.verdict,
        assignedToUserId: row.assignedToUserId?.toString(),
        assignedToTeamId: row.assignedToTeamId?.toString(),
        acknowledgedAt: row.acknowledgedAt,
        containedAt: row.containedAt,
      });
    }

    return { updateBy, carryForward: before };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const before: Map<string, CaseStateBeforeUpdate> | null =
      onUpdate.carryForward instanceof Map ? onUpdate.carryForward : null;

    if (!before) {
      return onUpdate;
    }

    const data: JSONObject = onUpdate.updateBy.data as unknown as JSONObject;
    const userId: ObjectID | undefined = onUpdate.updateBy.props.userId;
    // Each project's lists, read once for the update's cases.
    const valuesByProject: Map<string, ProjectSecurityCaseValues> = new Map();
    const playbookName: string | undefined =
      typeof onUpdate.updateBy.miscDataProps?.[
        SECURITY_CASE_PLAYBOOK_NAME_KEY
      ] === "string"
        ? (onUpdate.updateBy.miscDataProps[
            SECURITY_CASE_PLAYBOOK_NAME_KEY
          ] as string)
        : undefined;

    for (const updatedId of updatedItemIds) {
      const old: CaseStateBeforeUpdate | undefined = before.get(
        updatedId.toString(),
      );

      if (!old || !old.projectId) {
        continue;
      }

      try {
        const projectKey: string = old.projectId.toString();
        let values: ProjectSecurityCaseValues | undefined =
          valuesByProject.get(projectKey);

        if (!values) {
          values = await SecurityCaseValues.getForProject(old.projectId);
          valuesByProject.set(projectKey, values);
        }

        await this.recordChanges({
          old,
          data,
          caseId: updatedId,
          projectId: old.projectId,
          userId,
          playbookName,
          values,
        });
      } catch (error) {
        logger.error(
          `SecurityCaseService: could not record the changes to case ${updatedId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return onUpdate;
  }

  /*
   * One case's change: its feed entries, and the timestamps the overview's
   * mean times are measured to - each stamped once, the first time the case
   * gets there, and never moved by a later change. What a status counts as
   * is read off where it sits in the project's list
   * (SecurityCaseStatuses), never off its name.
   */
  private async recordChanges(input: {
    old: CaseStateBeforeUpdate;
    data: JSONObject;
    caseId: ObjectID;
    projectId: ObjectID;
    userId: ObjectID | undefined;
    playbookName: string | undefined;
    values: ProjectSecurityCaseValues;
  }): Promise<void> {
    const { old, data, caseId, projectId, userId, playbookName, values } =
      input;
    const now: Date = OneUptimeDate.getCurrentDate();
    // Dates and ids as themselves: the hook-free write runs them through the columns' transformers.
    const stamps: Record<string, unknown> = {};

    const newStatusId: string | undefined =
      data["securityCaseStatusId"]?.toString() || undefined;

    if (newStatusId && newStatusId !== old.statusId) {
      let verdict: string | undefined = undefined;
      const change: SecurityCaseStatusChange =
        SecurityCaseStatuses.getStatusChange({
          statuses: values.statuses,
          fromStatusId: old.statusId,
          toStatusId: newStatusId,
        });
      const isClosedNow: boolean = SecurityCaseStatuses.isClosed(
        values.statuses,
        newStatusId,
      );

      /*
       * Who closed it and when are OneUptime's to write, after the update:
       * the permission layer holds a person's update to the columns they
       * may write, which these are not. Reopening clears the close and its
       * verdict - an open case has neither. Moving between two statuses that
       * both close keeps the case closed, with its verdict.
       */
      if (change.closes) {
        verdict = isSecurityCaseVerdict(data["verdict"])
          ? data["verdict"]
          : old.verdict || SecurityCaseVerdict.Undetermined;

        stamps["verdict"] = verdict;
        stamps["closedAt"] = now;
        stamps["closedByUserId"] = userId || null;
      } else if (change.reopens) {
        stamps["verdict"] = null;
        stamps["closedAt"] = null;
        stamps["closedByUserId"] = null;
      } else if (isClosedNow) {
        verdict = isSecurityCaseVerdict(data["verdict"])
          ? data["verdict"]
          : old.verdict || undefined;
      }

      if (change.acknowledges && !old.acknowledgedAt) {
        stamps["acknowledgedAt"] = now;
      }

      if (change.contains && !old.containedAt) {
        stamps["containedAt"] = now;
      }

      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId,
        securityCaseId: caseId,
        feedInfoInMarkdown: statusChangedMarkdown({
          from: this.getNameOf(
            SecurityCaseStatuses.find(values.statuses, old.statusId),
          ),
          to: this.getNameOf(
            SecurityCaseStatuses.find(values.statuses, newStatusId),
          ),
          verdict,
          playbookName,
        }).toString(),
        moreInformationInMarkdown:
          change.closes && typeof data["closingNote"] === "string"
            ? data["closingNote"]
            : undefined,
        eventType: SecurityCaseFeedEventType.StatusChanged,
        displayColor: isClosedNow ? Green500 : Purple500,
        userId,
      });

      /*
       * Closed here, closed where its alerts came from: each connection
       * with "Close alerts when their case closes" on (queued, never
       * waited on - SecurityCaseSourceAlerts).
       */
      if (change.closes) {
        await SecurityCaseSourceAlerts.caseClosed({
          projectId,
          securityCaseId: caseId,
        });
      }
    }

    const newPriorityId: string | undefined =
      data["securityCasePriorityId"]?.toString() || undefined;

    if (newPriorityId && newPriorityId !== old.priorityId) {
      // Up, it may reach somebody's chosen priority now; down tells nobody.
      if (
        SecurityCasePriorities.isMoreUrgent(
          values.priorities,
          newPriorityId,
          old.priorityId,
        )
      ) {
        await SecurityCaseNotifications.caseReachedPriority({
          projectId,
          securityCaseId: caseId,
          actorUserId: userId,
        });
      }

      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId,
        securityCaseId: caseId,
        feedInfoInMarkdown: priorityChangedMarkdown({
          from: this.getNameOf(
            SecurityCasePriorities.find(values.priorities, old.priorityId),
          ),
          to: this.getNameOf(
            SecurityCasePriorities.find(values.priorities, newPriorityId),
          ),
          playbookName,
        }).toString(),
        eventType: SecurityCaseFeedEventType.PriorityChanged,
        displayColor: Orange500,
        userId,
      });
    }

    const userChanged: boolean =
      data["assignedToUserId"] !== undefined &&
      (data["assignedToUserId"]?.toString() || undefined) !==
        old.assignedToUserId;
    const teamChanged: boolean =
      data["assignedToTeamId"] !== undefined &&
      (data["assignedToTeamId"]?.toString() || undefined) !==
        old.assignedToTeamId;

    if (userChanged || teamChanged) {
      const assignedUserId: string | undefined = userChanged
        ? data["assignedToUserId"]?.toString() || undefined
        : old.assignedToUserId;
      const assignedTeamId: string | undefined = teamChanged
        ? data["assignedToTeamId"]?.toString() || undefined
        : old.assignedToTeamId;

      if (userChanged && assignedUserId && !old.acknowledgedAt) {
        stamps["acknowledgedAt"] = now;
      }

      // Told: the person it now is, or the team it moved to.
      await SecurityCaseNotifications.caseAssigned({
        projectId,
        securityCaseId: caseId,
        userId:
          userChanged && assignedUserId
            ? new ObjectID(assignedUserId)
            : undefined,
        teamId:
          teamChanged && assignedTeamId
            ? new ObjectID(assignedTeamId)
            : undefined,
        actorUserId: userId,
        playbookName,
      });

      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId,
        securityCaseId: caseId,
        feedInfoInMarkdown: assigneeChangedMarkdown({
          userName: assignedUserId
            ? await this.getUserName(new ObjectID(assignedUserId))
            : undefined,
          teamName: assignedTeamId
            ? await this.getTeamName(new ObjectID(assignedTeamId))
            : undefined,
          playbookName,
        }).toString(),
        eventType: SecurityCaseFeedEventType.AssigneeChanged,
        displayColor: Gray500,
        userId,
      });
    }

    if (Object.keys(stamps).length > 0) {
      await this.updateColumnsByIdWithoutHooks({
        id: caseId,
        data: stamps as unknown as PartialEntity<Model>,
      });
    }
  }

  // The id of the project's value a new case is given; refused when there is none.
  private getIdOf(
    value: SecurityCaseStatus | SecurityCasePriority | null,
    what: string,
  ): ObjectID {
    if (!value?.id) {
      throw new BadDataException(
        `This project has no case ${what} to open a case at. Add one under Security Events > Settings.`,
      );
    }

    return value.id;
  }

  // A status's or a priority's name, for the timeline.
  private getNameOf(
    value: SecurityCaseStatus | SecurityCasePriority | null,
  ): string {
    return value?.name || "an earlier one";
  }

  // The case's page in the Dashboard.
  public async getCaseLinkInDashboard(
    projectId: ObjectID,
    securityCaseId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/security-events/cases/${securityCaseId.toString()}`,
    );
  }

  private async getUserName(userId: ObjectID): Promise<string> {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    return user?.name?.toString() || user?.email?.toString() || "a user";
  }

  private async getTeamName(teamId: ObjectID): Promise<string> {
    const team: Team | null = await TeamService.findOneById({
      id: teamId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return team?.name || "a team";
  }
}

export default new Service();
