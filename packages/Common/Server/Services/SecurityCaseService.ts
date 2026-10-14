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
import SecurityCasePriority, {
  isSecurityCasePriority,
} from "../../Types/SecurityCase/SecurityCasePriority";
import SecurityCaseStatus, {
  isSecurityCaseStatus,
} from "../../Types/SecurityCase/SecurityCaseStatus";
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

// The case columns whose change the update hooks look at.
interface CaseStateBeforeUpdate {
  id: string;
  projectId: ObjectID | undefined;
  status: SecurityCaseStatus | undefined;
  priority: SecurityCasePriority | undefined;
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

    if (data["priority"] !== undefined && data["priority"] !== null) {
      if (!isSecurityCasePriority(data["priority"])) {
        throw new BadDataException(
          "Priority must be Critical, High, Medium, Low or Informational.",
        );
      }
    }

    if (data["status"] !== undefined && data["status"] !== null) {
      if (!isSecurityCaseStatus(data["status"])) {
        throw new BadDataException(
          "Status must be New, Investigating, Contained or Closed.",
        );
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

    data.priority = data.priority || SecurityCasePriority.Medium;
    data.status = data.status || SecurityCaseStatus.New;

    // A person opening a case is its source; the detection ingest names its own.
    if (!data.source && !createBy.props.isRoot) {
      data.source = SecurityDetectionSource.Manual;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    if (data.status !== SecurityCaseStatus.New || data.assignedToUserId) {
      data.acknowledgedAt = now;
    }

    if (data.status === SecurityCaseStatus.Contained) {
      data.containedAt = now;
    }

    if (data.status === SecurityCaseStatus.Closed) {
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

    const watchesState: boolean =
      data["status"] !== undefined ||
      data["priority"] !== undefined ||
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
        status: true,
        priority: true,
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
        status: row.status,
        priority: row.priority,
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
        await this.recordChanges({
          old,
          data,
          caseId: updatedId,
          projectId: old.projectId,
          userId,
          playbookName,
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
   * gets there, and never moved by a later change.
   */
  private async recordChanges(input: {
    old: CaseStateBeforeUpdate;
    data: JSONObject;
    caseId: ObjectID;
    projectId: ObjectID;
    userId: ObjectID | undefined;
    playbookName: string | undefined;
  }): Promise<void> {
    const { old, data, caseId, projectId, userId, playbookName } = input;
    const now: Date = OneUptimeDate.getCurrentDate();
    // Dates and ids as themselves: the hook-free write runs them through the columns' transformers.
    const stamps: Record<string, unknown> = {};

    const newStatus: SecurityCaseStatus | undefined = isSecurityCaseStatus(
      data["status"],
    )
      ? data["status"]
      : undefined;

    if (newStatus && newStatus !== old.status) {
      let verdict: string | undefined = undefined;

      /*
       * Who closed it and when are OneUptime's to write, after the update:
       * the permission layer holds a person's update to the columns they
       * may write, which these are not. Reopening clears the close and its
       * verdict - an open case has neither.
       */
      if (newStatus === SecurityCaseStatus.Closed) {
        verdict = isSecurityCaseVerdict(data["verdict"])
          ? data["verdict"]
          : old.verdict || SecurityCaseVerdict.Undetermined;

        stamps["verdict"] = verdict;
        stamps["closedAt"] = now;
        stamps["closedByUserId"] = userId || null;
      } else if (old.status === SecurityCaseStatus.Closed) {
        stamps["verdict"] = null;
        stamps["closedAt"] = null;
        stamps["closedByUserId"] = null;
      }

      if (newStatus !== SecurityCaseStatus.New && !old.acknowledgedAt) {
        stamps["acknowledgedAt"] = now;
      }

      if (newStatus === SecurityCaseStatus.Contained && !old.containedAt) {
        stamps["containedAt"] = now;
      }

      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId,
        securityCaseId: caseId,
        feedInfoInMarkdown: statusChangedMarkdown({
          from: old.status || SecurityCaseStatus.New,
          to: newStatus,
          verdict,
          playbookName,
        }).toString(),
        moreInformationInMarkdown:
          newStatus === SecurityCaseStatus.Closed &&
          typeof data["closingNote"] === "string"
            ? data["closingNote"]
            : undefined,
        eventType: SecurityCaseFeedEventType.StatusChanged,
        displayColor:
          newStatus === SecurityCaseStatus.Closed ? Green500 : Purple500,
        userId,
      });
    }

    const newPriority: SecurityCasePriority | undefined =
      isSecurityCasePriority(data["priority"]) ? data["priority"] : undefined;

    if (newPriority && newPriority !== old.priority) {
      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId,
        securityCaseId: caseId,
        feedInfoInMarkdown: priorityChangedMarkdown({
          from: old.priority || SecurityCasePriority.Medium,
          to: newPriority,
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
