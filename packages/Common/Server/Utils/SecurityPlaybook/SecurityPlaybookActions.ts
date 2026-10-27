import Incident from "../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseNote from "../../../Models/DatabaseModels/SecurityCaseNote";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import { WorkflowRoute } from "../../../ServiceRoute";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import {
  SecurityEntity,
  SecurityEntityType,
  mergeSecurityEntities,
} from "../../../Types/SecurityCase/SecurityEntity";
import OcsfSeverity, {
  ocsfSeverityFromId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  AddCaseLabelsConfig,
  AddCaseNoteConfig,
  AssignCaseConfig,
  CheckThreatIntelConfig,
  DeclareIncidentConfig,
  DefenderIsolationType,
  EmailPeopleConfig,
  LookUpEntityActivityConfig,
  PageOnCallConfig,
  PostToChannelConfig,
  RunWorkflowConfig,
  SecurityPlaybookStep,
  SendWebhookConfig,
  SetCasePriorityConfig,
  SetCaseStatusConfig,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { SecurityPlaybookTarget } from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WorkspaceMessageBlock } from "../../../Types/Workspace/WorkspaceMessagePayload";
import API from "../../../Utils/API";
import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import {
  SecurityCaseTemplateValues,
  incidentDeclaredFromCaseMarkdown,
  incidentDeclaredMarkdown,
  renderSecurityCaseTemplate,
  securityCaseSummaryMarkdown,
} from "../../../Utils/SecurityCase/SecurityCaseMarkdown";
import SecurityCasePriorities from "../../../Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "../../../Utils/SecurityCase/SecurityCaseStatuses";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "../SecurityCase/SecurityCaseValues";
import { WorkflowHostname } from "../../EnvironmentConfig";
import IncidentFeedService from "../../Services/IncidentFeedService";
import IncidentService from "../../Services/IncidentService";
import MailService from "../../Services/MailService";
import OnCallPageService, {
  OnCallPageResult,
} from "../../Services/OnCallPageService";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import SecurityCaseNoteService from "../../Services/SecurityCaseNoteService";
import SecurityCaseService, {
  SECURITY_CASE_PLAYBOOK_NAME_KEY,
} from "../../Services/SecurityCaseService";
import SecurityEventConnectionService from "../../Services/SecurityEventConnectionService";
import SecurityEventService, {
  ObservableActivity,
} from "../../Services/SecurityEventService";
import SecurityProtectedEntityService from "../../Services/SecurityProtectedEntityService";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";
import ThreatIntelIndicatorService, {
  ActiveIndicator,
} from "../../Services/ThreatIntelIndicatorService";
import UserService from "../../Services/UserService";
import WebhookService from "../../Services/WebhookService";
import WorkflowService from "../../Services/WorkflowService";
import Markdown, { MarkdownContentType } from "../../Types/Markdown";
import RuleRecordScope from "../Rules/RuleRecordScope";
import ProjectScopedReferenceValidator from "../Database/ProjectScopedReferenceValidator";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Includes from "../../../Types/BaseDatabase/Includes";
import WorkspaceUtil from "../Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../Workspace/WorkspaceBase";
import SecurityPlaybookContainment from "./SecurityPlaybookContainment";
import SecurityPlaybookResponseSteps from "./SecurityPlaybookResponseSteps";
import logger from "../Logger";
import { loadSecurityConnections } from "../SecurityEvent/Connections/ConnectionsLoader";
import type { SecurityConnectedRecord } from "../SecurityEvent/Connections/SecurityConnectedRecords";
import SecurityPlaybookTargets from "./SecurityPlaybookTargets";
import PartialEntity from "../../../Types/Database/PartialEntity";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { UnreadableReferenceException } from "../Database/ProjectScopedReferenceRefusal";

export interface PlaybookStepContext {
  projectId: ObjectID;
  runId: ObjectID;
  playbookName: string;
  step: SecurityPlaybookStep;
  stepNumber: number;
  // The case as it is right before the step runs.
  securityCase: SecurityCase;
  triggeredByUserId?: ObjectID | undefined;
  /*
   * For a step that acts on users or hosts: the targets it picked, as the
   * approver left them. Picked here when the run has none yet.
   */
  targets?: Array<SecurityPlaybookTarget> | undefined;
}

export interface PlaybookStepOutcome {
  status:
    | SecurityPlaybookStepStatus.Succeeded
    | SecurityPlaybookStepStatus.Failed
    | SecurityPlaybookStepStatus.Skipped;
  // What the step did, in a sentence or two.
  summary: MarkdownText;
  // Detail behind the summary, shown when its feed entry is expanded.
  detailsInMarkdown?: MarkdownText | undefined;
  error?: string | undefined;
  threatIntelMatched?: boolean | undefined;
  // The step wrote its own feed entry (a change of the case already says itself).
  hasWrittenOwnFeed?: boolean | undefined;
  feedEventType?: SecurityCaseFeedEventType | undefined;
  // For a step that acts on users or hosts: each target, and what became of it.
  targets?: Array<SecurityPlaybookTarget> | undefined;
}

const ROOT: { isRoot: true } = { isRoot: true };

// The most entities a containment or lookup step acts on in one run.
export const PLAYBOOK_STEP_ENTITY_LIMIT: number = 10;

/*
 * Why a person may not declare a case's incident when it would be linked
 * to a record they may not read: those links are what the case names, not
 * anything they picked, so they are not asked to pick others.
 */
export const DECLARED_INCIDENT_LINKS_UNREADABLE_MESSAGE: string =
  "This case names hosts, clusters or services you do not have access to, and the incident declared from it would be linked to them. Ask someone who can see them to declare it.";

function readConfig<T>(step: SecurityPlaybookStep): T {
  return step.config as unknown as T;
}

export function readCaseEntities(
  securityCase: SecurityCase,
): Array<SecurityEntity> {
  return mergeSecurityEntities(
    (securityCase.entities || []) as unknown as Array<SecurityEntity>,
  );
}

function succeeded(
  summary: MarkdownText,
  extra?: Partial<PlaybookStepOutcome>,
): PlaybookStepOutcome {
  return { status: SecurityPlaybookStepStatus.Succeeded, summary, ...extra };
}

function failed(error: string, summary?: MarkdownText): PlaybookStepOutcome {
  return {
    status: SecurityPlaybookStepStatus.Failed,
    summary: summary || FeedMarkdown.empty(),
    error,
  };
}

function skipped(summary: MarkdownText): PlaybookStepOutcome {
  return { status: SecurityPlaybookStepStatus.Skipped, summary };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

/*
 * What each playbook step does. Every step acts as OneUptime itself on the
 * case's own project: each record it names is looked up within that project
 * (a policy, a severity or a connection of another project is "not found"),
 * as the playbook service already checked when the playbook was saved.
 */
export default class SecurityPlaybookActions {
  public static async execute(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    switch (context.step.action) {
      case SecurityPlaybookActionType.AssignCase:
        return await this.assignCase(context);
      case SecurityPlaybookActionType.SetCasePriority:
        return await this.setCasePriority(context);
      case SecurityPlaybookActionType.SetCaseStatus:
        return await this.setCaseStatus(context);
      case SecurityPlaybookActionType.AddCaseNote:
        return await this.addCaseNote(context);
      case SecurityPlaybookActionType.AddCaseLabels:
        return await this.addCaseLabels(context);
      case SecurityPlaybookActionType.CheckThreatIntel:
        return await this.checkThreatIntel(context);
      case SecurityPlaybookActionType.LookUpEntityActivity:
        return await this.lookUpEntityActivity(context);
      case SecurityPlaybookActionType.EmailPeople:
        return await this.emailPeople(context);
      case SecurityPlaybookActionType.PostToSlack:
        return await this.postToChannel(context, WorkspaceType.Slack);
      case SecurityPlaybookActionType.PostToMicrosoftTeams:
        return await this.postToChannel(context, WorkspaceType.MicrosoftTeams);
      case SecurityPlaybookActionType.PageOnCall:
        return await this.pageOnCall(context);
      case SecurityPlaybookActionType.DeclareIncident:
        return await this.declareIncident(context);
      case SecurityPlaybookActionType.SendWebhook:
        return await this.sendWebhook(context);
      case SecurityPlaybookActionType.RunWorkflow:
        return await this.runWorkflow(context);
      // The steps that respond through the rest of OneUptime.
      case SecurityPlaybookActionType.PreserveEvidence:
        return await SecurityPlaybookResponseSteps.preserveEvidence(context);
      case SecurityPlaybookActionType.PostStatusPageAnnouncement:
        return await SecurityPlaybookResponseSteps.postStatusPageAnnouncement(
          context,
        );
      case SecurityPlaybookActionType.RunRunbook:
        return await SecurityPlaybookResponseSteps.runRunbook(
          context,
          await this.getTemplateValues(context),
        );
      case SecurityPlaybookActionType.FixWithAi:
        return await SecurityPlaybookResponseSteps.fixWithAi(context);
      case SecurityPlaybookActionType.SuspendOktaUser:
      case SecurityPlaybookActionType.EndOktaSessions:
      case SecurityPlaybookActionType.ContainCrowdStrikeHost:
      case SecurityPlaybookActionType.IsolateDefenderDevice:
      case SecurityPlaybookActionType.UnsuspendOktaUser:
      case SecurityPlaybookActionType.LiftCrowdStrikeContainment:
      case SecurityPlaybookActionType.ReleaseDefenderDevice:
        return await this.contain(context);
    }

    return failed(
      `"${String(context.step.action)}" is not an action a playbook can run.`,
    );
  }

  // ---------- Case ----------

  private static async updateCase(
    context: PlaybookStepContext,
    data: PartialEntity<SecurityCase>,
  ): Promise<void> {
    await SecurityCaseService.updateOneById({
      id: context.securityCase.id!,
      data: data,
      miscDataProps: {
        [SECURITY_CASE_PLAYBOOK_NAME_KEY]: context.playbookName,
      },
      props: ROOT,
    });
  }

  private static async assignCase(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: AssignCaseConfig = readConfig<AssignCaseConfig>(context.step);
    const data: PartialEntity<SecurityCase> = {};

    if (config.userId) {
      data.assignedToUserId = new ObjectID(config.userId);
    }

    if (config.teamId) {
      data.assignedToTeamId = new ObjectID(config.teamId);
    }

    /*
     * The case service's own feed entry says who it went to, naming the
     * playbook; this step adds nothing to it.
     */
    await this.updateCase(context, data);

    return succeeded(mdText`Assigned the case.`, { hasWrittenOwnFeed: true });
  }

  /*
   * The step names one of the project's priorities by id. One the project
   * no longer has fails the step, saying so, rather than leaving the case
   * where it is without a word.
   */
  private static async setCasePriority(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: SetCasePriorityConfig = readConfig<SetCasePriorityConfig>(
      context.step,
    );
    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(context.projectId);
    const priority: SecurityCasePriority | null = SecurityCasePriorities.find(
      values.priorities,
      config.priorityId,
    );

    if (!priority?.id) {
      return failed(
        "The priority this step sets is no longer one of the project's. Pick another on the playbook.",
      );
    }

    if (
      context.securityCase.securityCasePriorityId?.toString() ===
      priority.id.toString()
    ) {
      return skipped(mdText`The case is already ${priority.name || ""}.`);
    }

    await this.updateCase(context, { securityCasePriorityId: priority.id });

    return succeeded(mdText`Set the priority to **${priority.name || ""}**.`, {
      hasWrittenOwnFeed: true,
    });
  }

  private static async setCaseStatus(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: SetCaseStatusConfig = readConfig<SetCaseStatusConfig>(
      context.step,
    );
    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(context.projectId);
    const status: SecurityCaseStatus | null = SecurityCaseStatuses.find(
      values.statuses,
      config.statusId,
    );

    if (!status?.id) {
      return failed(
        "The status this step sets is no longer one of the project's. Pick another on the playbook.",
      );
    }

    if (
      context.securityCase.securityCaseStatusId?.toString() ===
      status.id.toString()
    ) {
      return skipped(mdText`The case is already ${status.name || ""}.`);
    }

    // A status that closes the case closes it with the step's verdict.
    await this.updateCase(context, {
      securityCaseStatusId: status.id,
      ...(SecurityCaseStatuses.isClosed(values.statuses, status.id)
        ? { verdict: config.verdict || SecurityCaseVerdict.Undetermined }
        : {}),
    });

    return succeeded(mdText`Set the status to **${status.name || ""}**.`, {
      hasWrittenOwnFeed: true,
    });
  }

  private static async addCaseNote(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: AddCaseNoteConfig = readConfig<AddCaseNoteConfig>(
      context.step,
    );
    const values: SecurityCaseTemplateValues =
      await this.getTemplateValues(context);

    const note: SecurityCaseNote = new SecurityCaseNote();
    note.projectId = context.projectId;
    note.securityCaseId = context.securityCase.id!;
    note.note = renderSecurityCaseTemplate(config.note, values).toString();

    // The note service puts the note on the timeline itself.
    await SecurityCaseNoteService.create({ data: note, props: ROOT });

    return succeeded(mdText`Added a note.`, { hasWrittenOwnFeed: true });
  }

  private static async addCaseLabels(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: AddCaseLabelsConfig = readConfig<AddCaseLabelsConfig>(
      context.step,
    );

    const existing: SecurityCase | null = await SecurityCaseService.findOneById(
      {
        id: context.securityCase.id!,
        select: {
          labels: {
            _id: true,
          },
        },
        props: ROOT,
      },
    );

    const existingIds: Set<string> = new Set(
      (existing?.labels || []).map((label: Label): string => {
        return label.id?.toString() || "";
      }),
    );

    const labelIds: Array<string> = await RuleRecordScope.keepIdsInProject({
      projectId: context.projectId,
      ids: config.labelIds.filter((id: string): boolean => {
        return !existingIds.has(id);
      }),
      modelType: Label,
      description: "labels of a security playbook step",
      logAttributes: {
        projectId: context.projectId.toString(),
      },
    });

    if (labelIds.length === 0) {
      return skipped(mdText`The case already has these labels.`);
    }

    await SecurityCaseService.getRepository()
      .createQueryBuilder()
      .relation(SecurityCase, "labels")
      .of(context.securityCase.id!.toString())
      .add(labelIds);

    const labels: Array<Label> = await this.findNamed<Label>(
      Label,
      context.projectId,
      labelIds,
    );

    return succeeded(
      mdText`Added the labels ${FeedMarkdown.join(
        labels.map((label: Label): MarkdownText => {
          return mdText`**${label.name || ""}**`;
        }),
      )}.`,
    );
  }

  // ---------- Investigate ----------

  private static async checkThreatIntel(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: CheckThreatIntelConfig = readConfig<CheckThreatIntelConfig>(
      context.step,
    );
    const entities: Array<SecurityEntity> = readCaseEntities(
      context.securityCase,
    );

    if (entities.length === 0) {
      return skipped(mdText`The case has no entities to look up.`);
    }

    const indicators: Array<ActiveIndicator> =
      await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
        projectId: context.projectId,
        values: entities.map((entity: SecurityEntity): string => {
          return entity.value.trim().toLowerCase();
        }),
        now: OneUptimeDate.getCurrentDate(),
      });

    if (indicators.length === 0) {
      return succeeded(
        mdText`Looked up ${String(entities.length)} entit${entities.length === 1 ? "y" : "ies"} in threat intel: none is known-bad.`,
        { feedEventType: SecurityCaseFeedEventType.ThreatIntel },
      );
    }

    // The most confident indicator for each value.
    const best: Map<string, ActiveIndicator> = new Map();

    for (const indicator of indicators) {
      const known: ActiveIndicator | undefined = best.get(
        indicator.indicatorValue,
      );

      if (!known || indicator.confidence > known.confidence) {
        best.set(indicator.indicatorValue, indicator);
      }
    }

    const matches: Array<ActiveIndicator> = Array.from(best.values());

    let priorityNote: MarkdownText = FeedMarkdown.empty();

    if (config.raisePriorityToId) {
      const priorities: Array<SecurityCasePriority> =
        await SecurityCaseValues.getPriorities(context.projectId);
      const raiseTo: SecurityCasePriority | null = SecurityCasePriorities.find(
        priorities,
        config.raisePriorityToId,
      );

      // Raised only: a case already at it, or above it, stays where it is.
      if (
        raiseTo?.id &&
        !SecurityCasePriorities.isAtLeast(
          priorities,
          context.securityCase.securityCasePriorityId,
          raiseTo.id,
        )
      ) {
        await this.updateCase(context, { securityCasePriorityId: raiseTo.id });
        priorityNote = mdText` Raised the priority to **${raiseTo.name || ""}**.`;
      }
    }

    return succeeded(
      mdText`${String(matches.length)} entit${matches.length === 1 ? "y is" : "ies are"} known-bad in threat intel: ${FeedMarkdown.join(
        matches.slice(0, 10).map((match: ActiveIndicator): MarkdownText => {
          return FeedMarkdown.code(match.indicatorValue);
        }),
      )}.${priorityNote}`,
      {
        threatIntelMatched: true,
        feedEventType: SecurityCaseFeedEventType.ThreatIntel,
        detailsInMarkdown: FeedMarkdown.bulletList(
          matches.map((match: ActiveIndicator): MarkdownText => {
            return mdText`${FeedMarkdown.code(match.indicatorValue)}: ${match.indicatorName || match.indicatorType || "indicator"}, feed **${match.feedName}**, confidence ${String(match.confidence)}`;
          }),
        ),
      },
    );
  }

  private static async lookUpEntityActivity(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: LookUpEntityActivityConfig =
      readConfig<LookUpEntityActivityConfig>(context.step);
    const entities: Array<SecurityEntity> = readCaseEntities(
      context.securityCase,
    ).slice(0, PLAYBOOK_STEP_ENTITY_LIMIT * 2);

    if (entities.length === 0) {
      return skipped(mdText`The case has no entities to look up.`);
    }

    const endTime: Date = OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveHours(
      endTime,
      -config.lookbackInHours,
    );

    const activity: Array<ObservableActivity> =
      await SecurityEventService.findObservableActivity({
        projectId: context.projectId,
        values: entities.map((entity: SecurityEntity): string => {
          return entity.value;
        }),
        startTime,
        endTime,
      });

    const rows: Array<MarkdownValue> = activity.map(
      (item: ObservableActivity): MarkdownText => {
        const worst: OcsfSeverity = ocsfSeverityFromId(item.maxSeverityId);

        return mdText`${FeedMarkdown.code(item.value)}: ${String(item.eventCount)} event${item.eventCount === 1 ? "" : "s"}, ${String(item.findingCount)} finding${item.findingCount === 1 ? "" : "s"}, worst ${worst}, last seen ${item.lastSeen ? OneUptimeDate.getDateAsFormattedString(item.lastSeen) : "never"}`;
      },
    );

    const quiet: number = entities.length - activity.length;

    return succeeded(
      mdText`Looked up ${String(entities.length)} entit${entities.length === 1 ? "y" : "ies"} over the last ${String(config.lookbackInHours)} hour${config.lookbackInHours === 1 ? "" : "s"}: ${String(activity.length)} had events${quiet > 0 ? mdText`, ${String(quiet)} had none` : FeedMarkdown.empty()}.`,
      {
        feedEventType: SecurityCaseFeedEventType.EntityActivity,
        detailsInMarkdown:
          rows.length > 0 ? FeedMarkdown.bulletList(rows) : undefined,
      },
    );
  }

  // ---------- Notify ----------

  private static async emailPeople(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: EmailPeopleConfig = readConfig<EmailPeopleConfig>(
      context.step,
    );
    const people: Map<string, User> = new Map();

    for (const user of await this.findNamed<User>(
      User,
      context.projectId,
      config.userIds,
    )) {
      if (user.email) {
        people.set(user.email.toString().toLowerCase(), user);
      }
    }

    const teams: Array<Team> = await this.findNamed<Team>(
      Team,
      context.projectId,
      config.teamIds,
    );

    if (teams.length > 0) {
      for (const user of await TeamMemberService.getUsersInTeams(
        teams.map((team: Team): ObjectID => {
          return team.id!;
        }),
        { acceptedOnly: true },
      )) {
        if (user.email) {
          people.set(user.email.toString().toLowerCase(), user);
        }
      }
    }

    if (people.size === 0) {
      return failed(
        "Nobody to email: the users and teams this step names are gone or have no members.",
      );
    }

    const values: SecurityCaseTemplateValues =
      await this.getTemplateValues(context);
    const markdown: MarkdownText = await this.getMessageMarkdown(
      context,
      config.message,
      values,
    );
    const html: string = await Markdown.convertToHTML(
      markdown.toString(),
      MarkdownContentType.Email,
    );
    const subject: string = `[${values.number}] ${values.title}`;

    const notSent: Array<string> = [];

    for (const user of people.values()) {
      try {
        await MailService.sendMail(
          {
            toEmail: new Email(user.email!.toString()),
            templateType: EmailTemplateType.SimpleMessage,
            vars: {
              subject: subject,
              message: html,
            },
            subject: subject,
            isSubjectLiteral: true,
          },
          {
            projectId: context.projectId,
            userId: user.id || undefined,
            timeoutInMs: 20000,
          },
        );
      } catch (error) {
        notSent.push(`${user.email?.toString()}: ${errorMessage(error)}`);
      }
    }

    const sent: number = people.size - notSent.length;

    if (sent === 0) {
      return failed(`No email was sent. ${notSent.join(" ")}`);
    }

    return succeeded(
      mdText`Emailed ${String(sent)} ${sent === 1 ? "person" : "people"}${notSent.length > 0 ? mdText`; ${String(notSent.length)} could not be emailed` : FeedMarkdown.empty()}.`,
      {
        feedEventType: SecurityCaseFeedEventType.Notification,
        detailsInMarkdown:
          notSent.length > 0 ? FeedMarkdown.bulletList(notSent) : undefined,
      },
    );
  }

  private static async postToChannel(
    context: PlaybookStepContext,
    workspaceType: WorkspaceType,
  ): Promise<PlaybookStepOutcome> {
    const config: PostToChannelConfig = readConfig<PostToChannelConfig>(
      context.step,
    );
    const values: SecurityCaseTemplateValues =
      await this.getTemplateValues(context);
    const markdown: MarkdownText = await this.getMessageMarkdown(
      context,
      config.message,
      values,
    );

    const blocks: Array<WorkspaceMessageBlock> =
      (
        await WorkspaceUtil.getMessageBlocksByMarkdown({
          projectId: context.projectId,
          userId: undefined,
          markdown: markdown.toString(),
        })
      ).find((item: { workspaceType: WorkspaceType }): boolean => {
        return item.workspaceType === workspaceType;
      })?.messageBlocks || [];

    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: context.projectId,
        messagePayloadsByWorkspace: [
          {
            _type: "WorkspaceMessagePayload",
            workspaceType: workspaceType,
            channelNames: [config.channelName],
            channelIds: [],
            messageBlocks: blocks,
            ...(config.microsoftTeamsTeamId
              ? { teamId: config.microsoftTeamsTeamId }
              : {}),
            text: `${values.number}: ${values.title}`,
          },
        ],
      });

    const product: string =
      workspaceType === WorkspaceType.Slack ? "Slack" : "Microsoft Teams";
    const errors: Array<string> = [];
    let threads: number = 0;

    for (const response of responses) {
      threads += (response.threads || []).length;

      for (const error of response.errors || []) {
        errors.push(`${error.channel}: ${error.error}`);
      }
    }

    if (threads === 0) {
      return failed(
        errors.length > 0
          ? errors.join(" ")
          : `Nothing was posted: the project is not connected to ${product}, or the channel #${config.channelName} was not found.`,
      );
    }

    return succeeded(
      mdText`Posted the case to ${product} channel **#${config.channelName}**.`,
      { feedEventType: SecurityCaseFeedEventType.Notification },
    );
  }

  // ---------- Escalate ----------

  private static async pageOnCall(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: PageOnCallConfig = readConfig<PageOnCallConfig>(context.step);

    const policies: Array<OnCallDutyPolicy> =
      await this.findNamed<OnCallDutyPolicy>(
        OnCallDutyPolicy,
        context.projectId,
        [config.onCallPolicyId],
      );

    if (policies.length === 0) {
      return failed("The on-call policy this step runs no longer exists.");
    }

    const values: SecurityCaseTemplateValues =
      await this.getTemplateValues(context);

    /*
     * On-call runs about an incident or an alert. A case that became an
     * incident pages about it, so the people paged land on the incident;
     * otherwise the page opens an alert that names the case and links to it.
     */
    const result: OnCallPageResult = await OnCallPageService.page({
      projectId: context.projectId,
      targets: {
        onCallDutyPolicyIds: [policies[0]!.id!],
      },
      about: context.securityCase.incidentId
        ? { incidentId: context.securityCase.incidentId }
        : {
            newAlert: {
              title: `Security case ${values.number}: ${values.title}`,
              description: (
                await this.getMessageMarkdown(context, undefined, values)
              ).toString(),
            },
          },
      props: {
        isRoot: true,
        tenantId: context.projectId,
      },
      maxWaitForRecordInMs: 0,
    });

    if (!result.isAnyonePaged) {
      return failed(result.summary || "Nobody was paged.");
    }

    return succeeded(
      mdText`Paged on-call with policy **${policies[0]!.name || ""}** (${result.record.label}).`,
      {
        feedEventType: SecurityCaseFeedEventType.Notification,
        detailsInMarkdown: FeedMarkdown.multilineText(result.summary),
      },
    );
  }

  private static async declareIncident(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: DeclareIncidentConfig = readConfig<DeclareIncidentConfig>(
      context.step,
    );

    if (context.securityCase.incidentId) {
      return skipped(mdText`An incident is already declared for this case.`);
    }

    const severities: Array<IncidentSeverity> =
      await this.findNamed<IncidentSeverity>(
        IncidentSeverity,
        context.projectId,
        [config.incidentSeverityId],
      );

    if (severities.length === 0) {
      return failed("The incident severity this step names no longer exists.");
    }

    const result: { incident: Incident; incidentNumber: string } =
      await SecurityPlaybookActions.declareIncidentForCase({
        projectId: context.projectId,
        securityCase: context.securityCase,
        incidentSeverityId: severities[0]!.id!,
        playbookName: context.playbookName,
      });

    return succeeded(mdText`Declared incident **${result.incidentNumber}**.`, {
      hasWrittenOwnFeed: true,
    });
  }

  /*
   * Declares a OneUptime incident for a case - from a playbook step or the
   * case's Declare Incident button - and links the two both ways: the case
   * keeps the incident's id and says so on its timeline, and the incident's
   * description and feed name the case.
   */
  public static async declareIncidentForCase(data: {
    projectId: ObjectID;
    securityCase: SecurityCase;
    incidentSeverityId: ObjectID;
    playbookName?: string | undefined;
    userId?: ObjectID | undefined;
    /*
     * The person declaring it from the case's page. The incident is created
     * as OneUptime, so whether they could create it themselves is asked
     * first (DatabaseService.checkCallerMayCreate): their permission to
     * create incidents - and the labels, owners and blocks it is limited
     * by - on the incident as it will be written, and their read of every
     * record it is linked to. A playbook step declares it as OneUptime.
     */
    declaredBy?: DatabaseCommonInteractionProps | undefined;
  }): Promise<{ incident: Incident; incidentNumber: string }> {
    const caseNumber: string =
      data.securityCase.caseNumberWithPrefix || "Security case";
    const caseUrl: URL = await SecurityCaseService.getCaseLinkInDashboard(
      data.projectId,
      data.securityCase.id!,
    );

    /*
     * The incident is about what the case names: the hosts, container
     * hosts, Kubernetes clusters and services the case is exactly connected
     * to (Security Connections) are linked to it, so it shows on their
     * pages, their owners' rules apply and its investigation reads them. A
     * possible connection is never linked. Enrichment: when they cannot be
     * read, the incident is declared without them.
     */
    let linked: Array<SecurityConnectedRecord> = [];
    const connections: ReturnType<typeof loadSecurityConnections> =
      loadSecurityConnections();

    try {
      linked = data.securityCase.id
        ? await connections.default.readIncidentLinks({
            projectId: data.projectId,
            securityCaseId: data.securityCase.id,
          })
        : [];
    } catch (error) {
      logger.error(
        `Security playbook: what case ${caseNumber} names could not be read; the incident is declared without them: ${error}`,
      );
    }

    const buildIncident: () => Incident = (): Incident => {
      const incident: Incident = new Incident();
      incident.projectId = data.projectId;
      incident.title = `${caseNumber}: ${data.securityCase.title || "Security case"}`;
      incident.incidentSeverityId = data.incidentSeverityId;
      incident.description =
        mdText`Declared from security case [${caseNumber}](${caseUrl.toString()}).${data.securityCase.description ? mdText`\n\n${FeedMarkdown.asMarkdown(data.securityCase.description)}` : FeedMarkdown.empty()}`.toString();

      connections.linkIncidentToConnectedRecords(incident, linked);

      return incident;
    };

    // The check changes the record it is handed, so it is handed one of its own.
    if (data.declaredBy) {
      try {
        await IncidentService.checkCallerMayCreate({
          data: buildIncident(),
          props: data.declaredBy,
        });
      } catch (error) {
        if (error instanceof UnreadableReferenceException) {
          throw new BadDataException(
            DECLARED_INCIDENT_LINKS_UNREADABLE_MESSAGE,
          );
        }

        throw error;
      }
    }

    const incident: Incident = buildIncident();

    if (data.userId) {
      incident.createdByUserId = data.userId;
    } else {
      incident.isCreatedAutomatically = true;
    }

    const created: Incident = await IncidentService.create({
      data: incident,
      props: ROOT,
    });

    const incidentNumber: string =
      created.incidentNumberWithPrefix ||
      (created.incidentNumber ? `#${created.incidentNumber}` : "the incident");

    await SecurityCaseService.updateColumnsByIdWithoutHooks({
      id: data.securityCase.id!,
      data: {
        incidentId: created.id!,
      },
    });

    const incidentUrl: URL = await IncidentService.getIncidentLinkInDashboard(
      data.projectId,
      created.id!,
    );

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.projectId,
      securityCaseId: data.securityCase.id!,
      feedInfoInMarkdown: incidentDeclaredMarkdown({
        incidentNumber,
        incidentUrl: incidentUrl.toString(),
        playbookName: data.playbookName,
      }).toString(),
      eventType: SecurityCaseFeedEventType.IncidentDeclared,
      userId: data.userId,
    });

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: created.id!,
      projectId: data.projectId,
      incidentFeedEventType: IncidentFeedEventType.IncidentUpdated,
      feedInfoInMarkdown: incidentDeclaredFromCaseMarkdown({
        caseNumber,
        caseUrl: caseUrl.toString(),
        linked,
      }).toString(),
      userId: data.userId,
    });

    return { incident: created, incidentNumber };
  }

  // ---------- Automate ----------

  private static async sendWebhook(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: SendWebhookConfig = readConfig<SendWebhookConfig>(
      context.step,
    );
    const payload: JSONObject = await this.getCasePayload(context);

    // WebhookService refuses private and internal addresses and signs the body.
    const response: unknown = await WebhookService.sendWebhook(
      {
        url: config.url,
        eventType: "security.case.playbook",
        payload,
      },
      {
        projectId: context.projectId,
      },
    );

    if (
      response &&
      typeof response === "object" &&
      "isFailure" in (response as Record<string, unknown>) &&
      (response as { isFailure: () => boolean }).isFailure()
    ) {
      return failed(`The webhook could not be sent to ${config.url}.`);
    }

    let host: string = config.url;

    try {
      host = new globalThis.URL(config.url).host;
    } catch {
      // Keep the URL as written.
    }

    return succeeded(mdText`Sent the case to the webhook at **${host}**.`);
  }

  private static async runWorkflow(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const config: RunWorkflowConfig = readConfig<RunWorkflowConfig>(
      context.step,
    );

    const workflow: Workflow | null = await WorkflowService.findOneBy({
      query: {
        _id: config.workflowId,
        projectId: context.projectId,
      },
      select: {
        _id: true,
        name: true,
        isEnabled: true,
        triggerId: true,
        webhookSecretKey: true,
      },
      props: ROOT,
    });

    if (!workflow) {
      return failed("The workflow this step runs no longer exists.");
    }

    if (!workflow.isEnabled) {
      return failed(`The workflow "${workflow.name || ""}" is disabled.`);
    }

    if (workflow.triggerId !== "webhook" || !workflow.webhookSecretKey) {
      return failed(
        `The workflow "${workflow.name || ""}" does not start with a Webhook trigger, which is how a playbook hands it the case.`,
      );
    }

    /*
     * The workflow's own webhook trigger, inside the cluster: its secret key
     * is all the trigger asks for, so the request carries the case alone.
     */
    await API.post({
      url: new URL(
        Protocol.HTTP,
        WorkflowHostname,
        new Route(
          `/${WorkflowRoute.toString()}/trigger/${workflow.webhookSecretKey}`,
        ),
      ),
      data: await this.getCasePayload(context),
    });

    return succeeded(mdText`Started the workflow **${workflow.name || ""}**.`);
  }

  // ---------- Contain ----------

  /*
   * A containment step, or its undo, on the step's targets: the attacker
   * side of the case (SecurityPlaybookTargets), as the approver left them,
   * held to the protected list as it is right now.
   */
  private static async contain(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome> {
    const definition: SecurityPlaybookActionDefinition | undefined =
      getSecurityPlaybookAction(context.step.action);

    if (!definition?.entityType) {
      return failed(`"${context.step.action}" is not a containment action.`);
    }

    const connectionId: JSONValue | undefined =
      context.step.config["connectionId"];

    const connection: SecurityEventConnection | null =
      typeof connectionId === "string"
        ? await SecurityEventConnectionService.findOneBy({
            query: {
              _id: connectionId,
              projectId: context.projectId,
            },
            select: {
              _id: true,
              name: true,
              provider: true,
              config: true,
              secrets: true,
              alertingOnly: true,
            },
            props: ROOT,
          })
        : null;

    if (!connection) {
      return failed("The connection this step acts through no longer exists.");
    }

    const targets: Array<SecurityPlaybookTarget> = context.targets
      ? SecurityPlaybookTargets.protect({
          targets: context.targets,
          rules: await SecurityProtectedEntityService.getRules({
            projectId: context.projectId,
            entityType: definition.entityType,
          }),
        })
      : await SecurityPlaybookTargets.selectTargets({
          projectId: context.projectId,
          securityCase: context.securityCase,
          entityType: definition.entityType,
        });

    return await SecurityPlaybookContainment.run({
      action: context.step.action,
      connection,
      settings:
        await SecurityEventConnectionService.getConnectorSettings(connection),
      targets,
      caseNumber: context.securityCase.caseNumberWithPrefix || "",
      isolationType:
        context.step.config["isolationType"] === DefenderIsolationType.Selective
          ? DefenderIsolationType.Selective
          : DefenderIsolationType.Full,
    });
  }

  // ---------- Shared ----------

  /*
   * The records of a model, by id, that belong to the project (a person: is
   * a member of it), with their names: what a step names may have been
   * deleted, or the person may have left, since the playbook was saved.
   */
  private static async findNamed<TModel extends DatabaseBaseModel>(
    modelType: { new (): TModel },
    projectId: ObjectID,
    ids: Array<string>,
  ): Promise<Array<TModel>> {
    const keptIds: Array<string> = await RuleRecordScope.keepIdsInProject({
      projectId,
      ids: ids.filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      }),
      modelType,
      description: "records a security playbook step names",
      logAttributes: { projectId: projectId.toString() },
    });

    if (keptIds.length === 0) {
      return [];
    }

    const isUser: boolean = new modelType() instanceof User;

    return await ProjectScopedReferenceValidator.getLookupService(
      modelType,
    ).findBy({
      query: {
        _id: new Includes(keptIds),
      } as Query<TModel>,
      select: (isUser
        ? { _id: true, name: true, email: true }
        : { _id: true, name: true }) as unknown as Select<TModel>,
      skip: 0,
      limit: keptIds.length,
      props: ROOT,
    });
  }

  public static async getTemplateValues(
    context: PlaybookStepContext,
  ): Promise<SecurityCaseTemplateValues> {
    const securityCase: SecurityCase = context.securityCase;
    const url: URL = await SecurityCaseService.getCaseLinkInDashboard(
      context.projectId,
      securityCase.id!,
    );

    let assignee: string = "Unassigned";

    if (securityCase.assignedToUserId) {
      const user: User | null = await UserService.findOneById({
        id: securityCase.assignedToUserId,
        select: { name: true, email: true },
        props: ROOT,
      });

      assignee = user?.name?.toString() || user?.email?.toString() || assignee;
    } else if (securityCase.assignedToTeamId) {
      const team: Team | null = await TeamService.findOneById({
        id: securityCase.assignedToTeamId,
        select: { name: true },
        props: ROOT,
      });

      assignee = team?.name || assignee;
    }

    // The case's priority and status as the project names them now.
    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(context.projectId);

    return {
      number: securityCase.caseNumberWithPrefix || "",
      title: securityCase.title || "",
      priority:
        SecurityCasePriorities.find(
          values.priorities,
          securityCase.securityCasePriorityId,
        )?.name || "",
      status:
        SecurityCaseStatuses.find(
          values.statuses,
          securityCase.securityCaseStatusId,
        )?.name || "",
      assignee,
      url: url.toString(),
      entities: readCaseEntities(securityCase)
        .map((entity: SecurityEntity): string => {
          return entity.value;
        })
        .join(", "),
      detections: String(securityCase.detectionCount || 0),
    };
  }

  // A person's message with the case put in, or a summary of the case.
  private static async getMessageMarkdown(
    context: PlaybookStepContext,
    template: string | undefined,
    values: SecurityCaseTemplateValues,
  ): Promise<MarkdownText> {
    if (template && template.trim()) {
      return renderSecurityCaseTemplate(template, values);
    }

    return securityCaseSummaryMarkdown({
      caseNumber: values.number,
      title: values.title,
      priority: values.priority,
      status: values.status,
      assignee: values.assignee === "Unassigned" ? undefined : values.assignee,
      detectionCount: context.securityCase.detectionCount || 0,
      entities: readCaseEntities(context.securityCase),
      mitreTactics: context.securityCase.mitreTactics || [],
      url: values.url,
    });
  }

  // The case as JSON for a webhook or a workflow: what is on it, and a link to it.
  public static async getCasePayload(
    context: PlaybookStepContext,
  ): Promise<JSONObject> {
    const securityCase: SecurityCase = context.securityCase;
    const url: URL = await SecurityCaseService.getCaseLinkInDashboard(
      context.projectId,
      securityCase.id!,
    );
    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(context.projectId);

    /*
     * The priority and status by the names the project gives them, as the
     * payload always carried them, and by id beside.
     */
    return {
      case: {
        id: securityCase.id?.toString() || "",
        number: securityCase.caseNumberWithPrefix || "",
        title: securityCase.title || "",
        description: securityCase.description || "",
        priority:
          SecurityCasePriorities.find(
            values.priorities,
            securityCase.securityCasePriorityId,
          )?.name || "",
        priorityId: securityCase.securityCasePriorityId?.toString() || "",
        status:
          SecurityCaseStatuses.find(
            values.statuses,
            securityCase.securityCaseStatusId,
          )?.name || "",
        statusId: securityCase.securityCaseStatusId?.toString() || "",
        source: securityCase.source || "",
        detectionCount: securityCase.detectionCount || 0,
        entities: readCaseEntities(securityCase).map(
          (entity: SecurityEntity): JSONObject => {
            return { type: entity.type, value: entity.value };
          },
        ),
        mitreTactics: securityCase.mitreTactics || [],
        mitreTechniques: securityCase.mitreTechniques || [],
        firstDetectedAt: securityCase.firstDetectedAt
          ? OneUptimeDate.toString(securityCase.firstDetectedAt)
          : null,
        lastDetectedAt: securityCase.lastDetectedAt
          ? OneUptimeDate.toString(securityCase.lastDetectedAt)
          : null,
        url: url.toString(),
      },
      playbook: {
        name: context.playbookName,
        runId: context.runId.toString(),
        step: context.stepNumber,
      },
      projectId: context.projectId.toString(),
    };
  }
}

// Entity types the containment steps act on, for a summary that names what was skipped.
export const CONTAINABLE_ENTITY_TYPES: ReadonlyArray<SecurityEntityType> = [
  SecurityEntityType.User,
  SecurityEntityType.Host,
];
