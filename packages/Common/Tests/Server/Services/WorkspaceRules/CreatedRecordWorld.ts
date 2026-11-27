import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertFeed, {
  AlertFeedEventType,
} from "../../../../Models/DatabaseModels/AlertFeed";
import AlertOwnerTeam from "../../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../../Models/DatabaseModels/AlertOwnerUser";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../../Models/DatabaseModels/IncidentFeed";
import IncidentOwnerTeam from "../../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../../Models/DatabaseModels/IncidentOwnerUser";
import Label from "../../../../Models/DatabaseModels/Label";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import WorkspaceNotificationRule from "../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertGroupingEngineService from "../../../../Server/Services/AlertGroupingEngineService";
import AlertIncidentRuleEngineService from "../../../../Server/Services/AlertIncidentRuleEngineService";
import AlertLabelRuleEngineService from "../../../../Server/Services/AlertLabelRuleEngineService";
import AlertOnCallRuleEngineService from "../../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOwnerRuleEngineService from "../../../../Server/Services/AlertOwnerRuleEngineService";
import AlertOwnerTeamService from "../../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../../Server/Services/AlertOwnerUserService";
import AlertPrivacyRuleEngineService from "../../../../Server/Services/AlertPrivacyRuleEngineService";
import AlertService from "../../../../Server/Services/AlertService";
import AutoRemediationRuleEngineService from "../../../../Server/Services/AutoRemediationRuleEngineService";
import IncidentAlertService from "../../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentGroupingEngineService from "../../../../Server/Services/IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "../../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentOwnerTeamService from "../../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../../Server/Services/IncidentOwnerUserService";
import IncidentPrivacyRuleEngineService from "../../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../../Server/Services/IncidentSlaService";
import RunbookRuleEngineService from "../../../../Server/Services/RunbookRuleEngineService";
import TeamService from "../../../../Server/Services/TeamService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../../Server/Types/Database/Hooks";
import AiFirstResponder from "../../../../Server/Utils/AI/FirstResponder/AiFirstResponder";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import IncidentFollowUpCheck from "../../../../Server/Utils/AI/SRE/IncidentFollowUpCheck";
import LinkedAffectedResources from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import CreatedNotificationHold, {
  OwnersAddedBy,
} from "../../../../Server/Utils/Notification/CreatedNotificationHold";
import ProductAnalytics from "../../../../Server/Utils/ProductAnalytics";
import VideoCallRuleExecutor from "../../../../Server/Utils/VideoCall/VideoCallRuleExecutor";
import WorkspaceCreatedMessageFirst from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst";
import { WorkspaceRecord } from "../../../../Server/Utils/Workspace/WorkspaceRecordPeople";
import AlertWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/Alert";
import IncidentWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/Incident";
import URL from "../../../../Types/API/URL";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { StartingStage } from "../../../../Utils/StartingStage";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOwnerTeam from "../../../../Models/DatabaseModels/AlertEpisodeOwnerTeam";
import AlertEpisodeOwnerUser from "../../../../Models/DatabaseModels/AlertEpisodeOwnerUser";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import { IncidentEpisodeFeedEventType } from "../../../../Models/DatabaseModels/IncidentEpisodeFeed";
import { AlertEpisodeFeedEventType } from "../../../../Models/DatabaseModels/AlertEpisodeFeed";
import IncidentEpisodeOwnerTeam from "../../../../Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeOwnerUser from "../../../../Models/DatabaseModels/IncidentEpisodeOwnerUser";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { MonitorFeedEventType } from "../../../../Models/DatabaseModels/MonitorFeed";
import MonitorOwnerTeam from "../../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyOwnerTeam from "../../../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import { ScheduledMaintenanceFeedEventType } from "../../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import ScheduledMaintenanceOwnerTeam from "../../../../Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "../../../../Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import AlertEpisodeFeedService from "../../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeLabelRuleEngineService from "../../../../Server/Services/AlertEpisodeLabelRuleEngineService";
import AlertEpisodeMemberService from "../../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeOnCallRuleEngineService from "../../../../Server/Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeOwnerRuleEngineService from "../../../../Server/Services/AlertEpisodeOwnerRuleEngineService";
import AlertEpisodeOwnerTeamService from "../../../../Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "../../../../Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodePrivacyRuleEngineService from "../../../../Server/Services/AlertEpisodePrivacyRuleEngineService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeFeedService from "../../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeLabelRuleEngineService from "../../../../Server/Services/IncidentEpisodeLabelRuleEngineService";
import IncidentEpisodeMemberService from "../../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeOnCallRuleEngineService from "../../../../Server/Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeOwnerRuleEngineService from "../../../../Server/Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentEpisodeOwnerTeamService from "../../../../Server/Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "../../../../Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodePrivacyRuleEngineService from "../../../../Server/Services/IncidentEpisodePrivacyRuleEngineService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import MonitorFeedService from "../../../../Server/Services/MonitorFeedService";
import MonitorLabelRuleEngineService from "../../../../Server/Services/MonitorLabelRuleEngineService";
import MonitorOwnerRuleEngineService from "../../../../Server/Services/MonitorOwnerRuleEngineService";
import MonitorOwnerTeamService from "../../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../../Server/Services/MonitorService";
import OnCallDutyPolicyFeedService from "../../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyLabelRuleEngineService from "../../../../Server/Services/OnCallDutyPolicyLabelRuleEngineService";
import OnCallDutyPolicyOwnerRuleEngineService from "../../../../Server/Services/OnCallDutyPolicyOwnerRuleEngineService";
import OnCallDutyPolicyOwnerTeamService from "../../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ProjectMilestoneService from "../../../../Server/Services/ProjectMilestoneService";
import ScheduledMaintenanceFeedService from "../../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceLabelRuleEngineService from "../../../../Server/Services/ScheduledMaintenanceLabelRuleEngineService";
import ScheduledMaintenanceOwnerRuleEngineService from "../../../../Server/Services/ScheduledMaintenanceOwnerRuleEngineService";
import ScheduledMaintenanceOwnerTeamService from "../../../../Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "../../../../Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import StatusPageMonitorRuleEngineService from "../../../../Server/Services/StatusPageMonitorRuleEngineService";
import { ActiveMonitoringMeteredPlan } from "../../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import MonitorFirstMeasured from "../../../../Server/Utils/Monitor/MonitorFirstMeasured";
import OpenStackMaintenanceReach from "../../../../Server/Utils/OpenStack/OpenStackMaintenanceReach";
import OpenStackMonitorDependencies from "../../../../Server/Utils/OpenStack/OpenStackMonitorDependencies";
import OpenStackProjectNotices from "../../../../Server/Utils/OpenStack/OpenStackProjectNotices";
import OwnerRuleAssignment from "../../../../Server/Utils/Rules/OwnerRuleAssignment";
import AlertEpisodeWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/AlertEpisode";
import IncidentEpisodeWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/IncidentEpisode";
import MonitorWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/Monitor";
import OnCallDutyPolicyWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/OnCallDutyPolicy";
import ScheduledMaintenanceWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/ScheduledMaintenance";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../../../Server/Types/Database/Permissions/TablePermission";
import RequiredUniqueNames from "../../../../Server/Utils/Database/RequiredUniqueNames";
import PublishedImages from "../../../../Server/Utils/File/PublishedImages";
import ProjectUsageCache from "../../../../Server/Utils/ProjectProducts/ProjectUsageCache";
import RuleSetCache from "../../../../Server/Utils/Rules/RuleSetCache";
import WorkflowListeners from "../../../../Server/Utils/Workflow/WorkflowListeners";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import WorkspaceRuleWorld, {
  ALERT_ID,
  CREATED_STATE_ID,
  INCIDENT_EPISODE_ID,
  INCIDENT_ID,
  PROJECT_ID,
  SCHEDULED_MAINTENANCE_ID,
  TEAM_ID,
  TEAM_USER,
} from "./WorkspaceRuleWorld";
import { jest } from "@jest/globals";

/*
 * A NEW ALERT OR INCIDENT, CREATED THROUGH ITS SERVICE'S REAL CREATE CHAIN,
 * WITH THE PROJECT'S NOTIFICATION RULES MATCHED, ITS CHANNELS OPENED AND ITS
 * MESSAGES POSTED BY THE REAL CODE (#11146, #10911).
 *
 * WorkspaceRuleWorld - the real rule matching, channel creation, invites
 * and messages against a fake Slack - and on top of it:
 *
 *   - the real AlertService and IncidentService onCreateSuccess chains, the
 *     steps that do not touch Slack stood in: the owner rules add the
 *     owners a test names, the label rules the labels, and paging is
 *     recorded where it happens ("paging", in `events`);
 *   - the alert's and the incident's owner tables and labels, in memory,
 *     read by the rules' Owner and Labels conditions as the database
 *     would answer them, and written as an owner row is: the row, then its
 *     service's own hook, which writes "Added team Platform to the Alert as
 *     the owner" and posts it;
 *   - each record's feed rows, with the time each is filed at, as its feed
 *     lists them;
 *   - a clock that moves a millisecond each time it is read, so every entry
 *     is filed at a moment of its own.
 *
 * And the same for the other kinds of record a rule posts about as it is
 * created (#11188): an incident episode (IE-3), an alert episode (AE-4), a
 * maintenance event (SM-5), a monitor (Checkout API) and an on-call policy
 * (Platform on-call) - each through its service's real onCreateSuccess,
 * with its owner tables, labels, channels and feed in memory, and the
 * steps of its chain that do not touch Slack stood in.
 */

export const PLATFORM_TEAM: ObjectID = TEAM_ID;
// The one member of the Platform team, as Slack knows them.
export const PLATFORM_MEMBER_SLACK_ID: string = "U0TEAM";

export const DATABASE_LABEL: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000071",
);

// The alert an incident is declared from: ALT-6, XYZ Monitor Y down.
export const DECLARED_ALERT_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000081",
);

// An existing Slack channel the project's rules post to.
export const EXISTING_CHANNEL: { id: string; name: string } = {
  id: "C0EXIST",
  name: "platform-alerts",
};

const SEVERITY_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000033",
);

export interface FeedRow {
  type: string;
  markdown: string;
  postedAt: Date;
}

export interface Owners {
  users?: Array<ObjectID> | undefined;
  teams?: Array<ObjectID> | undefined;
}

export interface CreateOptions {
  // Picked on the create form, a workflow's step or the API (misc data).
  ownersPicked?: Owners | undefined;
  // Its creator, made its owner as the create returns (autoOwnerOnCreate).
  creator?: ObjectID | undefined;
  // The owners the code that made it adds once the create has returned.
  callerAdds?: Owners | undefined;
  startingStage?: StartingStage | undefined;
  // An incident: the alerts it is declared from.
  declaredFromAlerts?: boolean | undefined;
  // An episode: created with an incident (an alert) in it, INC-42 (ALT-6).
  withMembers?: boolean | undefined;
}

// The kinds of record besides alerts and incidents created here (#11188).
export type RecordKind =
  | "incidentEpisode"
  | "alertEpisode"
  | "scheduledMaintenance"
  | "monitor"
  | "onCallPolicy";

// AE-4, the alert episode.
export const ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000006",
);

// The monitor Checkout API.
export const MONITOR_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000007",
);

// The on-call policy Platform on-call.
export const ON_CALL_POLICY_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000008",
);

const MONITOR_STATUS_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000091",
);

// What the database holds of one record of those kinds, and its feed.
export interface KindRecord {
  ownerUsers: Array<ObjectID>;
  ownerTeams: Array<ObjectID>;
  labels: Array<ObjectID>;
  // null: its own channel setup has not run.
  channels: Array<NotificationRuleWorkspaceChannel> | null;
  feedRows: Array<FeedRow>;
}

type AnyService = Record<string, (...args: Array<unknown>) => Promise<unknown>>;

// Where a kind of record keeps its owners, and the column that names it.
interface OwnerTables {
  recordId: ObjectID;
  column: string;
  ownerUserModel: new () => BaseModel;
  ownerTeamModel: new () => BaseModel;
  ownerUserService: AnyService;
  ownerTeamService: AnyService;
}

function asService(service: unknown): AnyService {
  return service as AnyService;
}

function ownerTablesOf(kind: RecordKind): OwnerTables {
  switch (kind) {
    case "incidentEpisode":
      return {
        recordId: INCIDENT_EPISODE_ID,
        column: "incidentEpisodeId",
        ownerUserModel: IncidentEpisodeOwnerUser,
        ownerTeamModel: IncidentEpisodeOwnerTeam,
        ownerUserService: asService(IncidentEpisodeOwnerUserService),
        ownerTeamService: asService(IncidentEpisodeOwnerTeamService),
      };
    case "alertEpisode":
      return {
        recordId: ALERT_EPISODE_ID,
        column: "alertEpisodeId",
        ownerUserModel: AlertEpisodeOwnerUser,
        ownerTeamModel: AlertEpisodeOwnerTeam,
        ownerUserService: asService(AlertEpisodeOwnerUserService),
        ownerTeamService: asService(AlertEpisodeOwnerTeamService),
      };
    case "scheduledMaintenance":
      return {
        recordId: SCHEDULED_MAINTENANCE_ID,
        column: "scheduledMaintenanceId",
        ownerUserModel: ScheduledMaintenanceOwnerUser,
        ownerTeamModel: ScheduledMaintenanceOwnerTeam,
        ownerUserService: asService(ScheduledMaintenanceOwnerUserService),
        ownerTeamService: asService(ScheduledMaintenanceOwnerTeamService),
      };
    case "monitor":
      return {
        recordId: MONITOR_ID,
        column: "monitorId",
        ownerUserModel: MonitorOwnerUser,
        ownerTeamModel: MonitorOwnerTeam,
        ownerUserService: asService(MonitorOwnerUserService),
        ownerTeamService: asService(MonitorOwnerTeamService),
      };
    case "onCallPolicy":
      return {
        recordId: ON_CALL_POLICY_ID,
        column: "onCallDutyPolicyId",
        ownerUserModel: OnCallDutyPolicyOwnerUser,
        ownerTeamModel: OnCallDutyPolicyOwnerTeam,
        ownerUserService: asService(OnCallDutyPolicyOwnerUserService),
        ownerTeamService: asService(OnCallDutyPolicyOwnerTeamService),
      };
  }
}

const RECORD_KINDS: ReadonlyArray<RecordKind> = [
  "incidentEpisode",
  "alertEpisode",
  "scheduledMaintenance",
  "monitor",
  "onCallPolicy",
];

/*
 * Every kind of record created here, alerts and incidents with the rest:
 * every kind whose create posts a Created message.
 */
export type CreatedKind = "alert" | "incident" | RecordKind;

export const CREATED_KINDS: ReadonlyArray<CreatedKind> = [
  "alert",
  "incident",
  ...RECORD_KINDS,
];

/*
 * A person whose role lets them create records of `modelType` only as
 * their own: a member of the project whose every permission to create one
 * is scoped to Owned, as an Owned-scope custom role gives it
 * (DatabaseService.createReliesOnOwnership).
 */
export function ownedScopeCreator(
  modelType: { new (): BaseModel },
  userId: ObjectID,
): DatabaseCommonInteractionProps {
  const permissions: Array<UserPermission> = TablePermission.getTablePermission(
    modelType,
    DatabaseRequestType.Create,
  )
    .filter((permission: Permission): boolean => {
      return PermissionHelper.isScopeApplicable(permission);
    })
    .map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.Owned,
      };
    });

  return {
    userId: userId,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions,
      },
    },
  } as DatabaseCommonInteractionProps;
}

export interface OwnedCreateOptions {
  // Picked on the create form, a workflow's step or the API (misc data).
  ownersPicked?: Owners | undefined;
  // The creator's owner row is not written, and they do not own the record.
  ownerRowFails?: boolean | undefined;
}

// What a create by a person whose role creates only what they own did.
export interface OwnedCreate {
  // What the create was made with: the person, their create scoped to Owned.
  props: DatabaseCommonInteractionProps;
  /*
   * Whether DatabaseService read the create as one that relies on its
   * creator owning the record (createReliesOnOwnership): its own reading of
   * the props, not one a test stood in.
   */
  reliesOnOwnership: boolean;
  // The record, as its messages name it.
  record: WorkspaceRecord;
  // What the create failed with, when it did.
  error: Error | null;
  /*
   * What the create did, in order: "insert", the creator's "owner row",
   * the "create hook", the record "taken out" again - each marked "(held)"
   * when the record's messages were held as it happened.
   */
  steps: Array<string>;
}

// What a create of one kind runs through: its service, its record, its owners.
interface CreateOf {
  service: unknown;
  record: WorkspaceRecord;
  recordId: ObjectID;
  model: () => BaseModel;
  ownerUserService: AnyService;
  ownerUsers: () => Array<ObjectID>;
  addOwners: (owners: Owners) => Promise<void>;
}

function emptyRecord(): KindRecord {
  return {
    ownerUsers: [],
    ownerTeams: [],
    labels: [],
    channels: null,
    feedRows: [],
  };
}

function sameId(a: ObjectID, b: ObjectID): boolean {
  return a.toString().toLowerCase() === b.toString().toLowerCase();
}

type HookFunction = (...args: Array<unknown>) => Promise<unknown>;

function hookOf(service: unknown, name: string): HookFunction {
  const hooks: Record<string, HookFunction> = service as Record<
    string,
    HookFunction
  >;
  return hooks[name]!.bind(service);
}

export default class CreatedRecordWorld extends WorkspaceRuleWorld {
  public alertOwnerUsers: Array<ObjectID> = [];
  public alertOwnerTeams: Array<ObjectID> = [];
  public alertLabels: Array<ObjectID> = [];
  public incidentLabels: Array<ObjectID> = [];

  // What the project's owner rules add, and its label rules attach.
  public ownerRulesAdd: Owners = {};
  public labelRulesAttach: Array<ObjectID> = [];

  // The owners of the alert an incident is declared from.
  public declaredAlertOwners: Owners = {};

  public alertFeedRows: Array<FeedRow> = [];
  public incidentFeedRows: Array<FeedRow> = [];

  // Called as each chain reaches its first state: what happens meanwhile.
  public onFirstState: (() => Promise<void>) | null = null;

  // The records of the other kinds, as the database holds them now.
  public records: Record<RecordKind, KindRecord> = {
    incidentEpisode: emptyRecord(),
    alertEpisode: emptyRecord(),
    scheduledMaintenance: emptyRecord(),
    monitor: emptyRecord(),
    onCallPolicy: emptyRecord(),
  };

  // When those records were created: just now, so they are being set up.
  private recordsCreatedAt: Date = new Date();

  private clock: number = Date.parse("2026-11-24T11:30:00.000Z");

  private chainEnded: () => void = (): void => {
    // replaced as each create starts
  };

  // The clock as it reads now: a millisecond later than the last read.
  public tick(): Date {
    this.clock += 1;
    return new Date(this.clock);
  }

  public override incidentModel(): Incident {
    const incident: Incident = super.incidentModel();

    incident.labels = this.incidentLabels.map((id: ObjectID): Label => {
      return this.label(id);
    });

    return incident;
  }

  // ALT-7 as the database holds it now.
  public alertModel(): Alert {
    const alert: Alert = new Alert();
    alert.id = ALERT_ID;
    alert._id = ALERT_ID.toString();
    alert.projectId = PROJECT_ID;
    alert.title = "API latency is high";
    alert.description = "p99 is above two seconds.";
    alert.alertNumber = 7;
    alert.alertNumberWithPrefix = "ALT-7";
    alert.isPrivate = false;
    alert.createdAt = this.incident.createdAt;
    alert.currentAlertStateId = CREATED_STATE_ID;

    const state: AlertState = new AlertState();
    state._id = CREATED_STATE_ID.toString();
    state.id = CREATED_STATE_ID;
    state.name = "Identified";
    alert.currentAlertState = state;

    const severity: AlertSeverity = new AlertSeverity();
    severity._id = SEVERITY_ID.toString();
    severity.id = SEVERITY_ID;
    severity.name = "High";
    alert.alertSeverity = severity;

    alert.labels = this.alertLabels.map((id: ObjectID): Label => {
      return this.label(id);
    });

    if (this.alert.channels !== null) {
      alert.postUpdatesToWorkspaceChannels = this.alert.channels;
    }

    return alert;
  }

  // The feed rows, in the order a feed lists them: by the time each is filed.
  public feedInOrder(rows: Array<FeedRow>): Array<FeedRow> {
    return [...rows].sort((a: FeedRow, b: FeedRow): number => {
      return a.postedAt.getTime() - b.postedAt.getTime();
    });
  }

  // What was posted to a channel, in order, each message as one string.
  public postsIn(channelId: string): Array<string> {
    return this.slackMessagesIn(channelId);
  }

  /*
   * Owners added to ALT-7, as AlertService.addOwners adds them: each row
   * written, then its service's own hook - the "owner added" entry, its
   * post, and the owner's invites to the alert's channels.
   */
  public async addAlertOwners(owners: Owners): Promise<void> {
    for (const userId of owners.users || []) {
      if (
        this.alertOwnerUsers.some((id: ObjectID): boolean => {
          return sameId(id, userId);
        })
      ) {
        continue;
      }

      this.alertOwnerUsers.push(userId);

      const row: AlertOwnerUser = new AlertOwnerUser();
      row.projectId = PROJECT_ID;
      row.alertId = ALERT_ID;
      row.userId = userId;

      await AlertOwnerUserService.onCreateSuccess(
        {
          createBy: { data: row, props: { isRoot: true } },
          carryForward: null,
        },
        row,
      );
    }

    for (const teamId of owners.teams || []) {
      if (
        this.alertOwnerTeams.some((id: ObjectID): boolean => {
          return sameId(id, teamId);
        })
      ) {
        continue;
      }

      this.alertOwnerTeams.push(teamId);

      const row: AlertOwnerTeam = new AlertOwnerTeam();
      row.projectId = PROJECT_ID;
      row.alertId = ALERT_ID;
      row.teamId = teamId;

      await AlertOwnerTeamService.onCreateSuccess(
        {
          createBy: { data: row, props: { isRoot: true } },
          carryForward: null,
        },
        row,
      );
    }
  }

  // The same for INC-42.
  public async addIncidentOwners(owners: Owners): Promise<void> {
    for (const userId of owners.users || []) {
      if (
        this.incidentOwnerUsers.some((id: ObjectID): boolean => {
          return sameId(id, userId);
        })
      ) {
        continue;
      }

      this.incidentOwnerUsers.push(userId);

      const row: IncidentOwnerUser = new IncidentOwnerUser();
      row.projectId = PROJECT_ID;
      row.incidentId = INCIDENT_ID;
      row.userId = userId;

      await IncidentOwnerUserService.onCreateSuccess(
        {
          createBy: { data: row, props: { isRoot: true } },
          carryForward: null,
        },
        row,
      );
    }

    for (const teamId of owners.teams || []) {
      if (
        this.incidentOwnerTeams.some((id: ObjectID): boolean => {
          return sameId(id, teamId);
        })
      ) {
        continue;
      }

      this.incidentOwnerTeams.push(teamId);

      const row: IncidentOwnerTeam = new IncidentOwnerTeam();
      row.projectId = PROJECT_ID;
      row.incidentId = INCIDENT_ID;
      row.teamId = teamId;

      await IncidentOwnerTeamService.onCreateSuccess(
        {
          createBy: { data: row, props: { isRoot: true } },
          carryForward: null,
        },
        row,
      );
    }
  }

  /*
   * ALT-7 is created, as AlertService.create creates it: its create chain
   * (onCreateSuccess) runs, the create returns and makes its creator its
   * owner, and the code that made it adds its owners. Settles once the
   * chain has run to its end and everything it set off has.
   */
  public async createAlert(options: CreateOptions = {}): Promise<void> {
    const ended: Promise<void> = new Promise<void>((resolve: () => void) => {
      this.chainEnded = resolve;
    });

    const createBy: CreateBy<Alert> = {
      data: this.alertModel(),
      props: { isRoot: true },
      ...this.ownersAsMiscData(options.ownersPicked),
    };

    CreatedNotificationHold.willAddOwners(createBy, OwnersAddedBy.Create);

    if (options.callerAdds) {
      CreatedNotificationHold.willAddOwners(createBy, OwnersAddedBy.Caller);
    }

    const onCreate: OnCreate<Alert> = {
      createBy: createBy,
      carryForward: this.carryForwardOf("alert", options),
    };

    await hookOf(AlertService, "onCreateSuccess")(onCreate, this.alertModel());

    // The create returns: its creator is made its owner.
    if (options.creator) {
      await this.addAlertOwners({ users: [options.creator] });
    }

    await CreatedNotificationHold.ownersAreIn(createBy, OwnersAddedBy.Create);

    // The code that made it - a monitor - adds its criteria's owners.
    if (options.callerAdds) {
      await this.addAlertOwners(options.callerAdds);
      await CreatedNotificationHold.ownersAreIn(createBy, OwnersAddedBy.Caller);
    }

    await ended;
    await this.settle();
  }

  // INC-42 is created, as IncidentService.create creates it.
  public async createIncident(options: CreateOptions = {}): Promise<void> {
    const ended: Promise<void> = new Promise<void>((resolve: () => void) => {
      this.chainEnded = resolve;
    });

    const createBy: CreateBy<Incident> = {
      data: this.incidentModel(),
      props: { isRoot: true },
      ...this.ownersAsMiscData(options.ownersPicked),
    };

    CreatedNotificationHold.willAddOwners(createBy, OwnersAddedBy.Create);

    if (options.callerAdds) {
      CreatedNotificationHold.willAddOwners(createBy, OwnersAddedBy.Caller);
    }

    const onCreate: OnCreate<Incident> = {
      createBy: createBy,
      carryForward: this.carryForwardOf("incident", options),
    };

    await hookOf(IncidentService, "onCreateSuccess")(
      onCreate,
      this.incidentModel(),
    );

    if (options.creator) {
      await this.addIncidentOwners({ users: [options.creator] });
    }

    await CreatedNotificationHold.ownersAreIn(createBy, OwnersAddedBy.Create);

    if (options.callerAdds) {
      await this.addIncidentOwners(options.callerAdds);
      await CreatedNotificationHold.ownersAreIn(createBy, OwnersAddedBy.Caller);
    }

    await ended;
    await this.settle();
  }

  public override install(): void {
    super.install();

    // Every read of the time is a moment of its own.
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
      return this.tick();
    });
    this.incident.createdAt = new Date(this.clock);

    /*
     * The project's rules, by kind of record - and in every workspace when
     * the read names none (hasRulesWithOwnerCondition).
     */
    jest
      .spyOn(WorkspaceNotificationRuleService, "findBy")
      .mockImplementation((async (data: {
        query: {
          workspaceType?: WorkspaceType;
          eventType?: NotificationRuleEventType;
        };
      }): Promise<Array<WorkspaceNotificationRule>> => {
        return this.rules.filter((rule: WorkspaceNotificationRule): boolean => {
          return (
            (!data.query.workspaceType ||
              rule.workspaceType === data.query.workspaceType) &&
            rule.eventType === data.query.eventType &&
            this.connected.includes(rule.workspaceType!)
          );
        });
      }) as never);

    // ALT-7, as it is now; its channels are stored on it.
    jest
      .spyOn(AlertService, "findOneById")
      .mockImplementation((async (): Promise<Alert> => {
        return this.alertModel();
      }) as never);
    jest.spyOn(AlertService, "updateOneById").mockImplementation((async (data: {
      data: { postUpdatesToWorkspaceChannels?: unknown };
    }): Promise<void> => {
      if ("postUpdatesToWorkspaceChannels" in data.data) {
        this.alert.channels = [
          ...((data.data.postUpdatesToWorkspaceChannels as never) || []),
        ];
        this.events.push("store:alert");
      }
    }) as never);
    jest.spyOn(AlertService, "getAlertNumber").mockResolvedValue({
      number: 7,
      numberWithPrefix: "ALT-7",
    });
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.test/dashboard/alerts/7"),
      );

    // The alerts an incident is declared from: ALT-6.
    jest.spyOn(AlertService, "findBy").mockImplementation((async (): Promise<
      Array<Alert>
    > => {
      const alert: Alert = new Alert();
      alert._id = DECLARED_ALERT_ID.toString();
      alert.id = DECLARED_ALERT_ID;
      alert.alertNumber = 6;
      alert.alertNumberWithPrefix = "ALT-6";
      alert.title = "XYZ Monitor Y down";
      alert.isPrivate = false;
      return [alert];
    }) as never);

    // Its owners, as their tables hold them and as they are invited.
    jest
      .spyOn(AlertOwnerUserService, "findAllBy")
      .mockImplementation((async (): Promise<Array<AlertOwnerUser>> => {
        return this.alertOwnerUsers.map((userId: ObjectID): AlertOwnerUser => {
          const row: AlertOwnerUser = new AlertOwnerUser();
          row.alertId = ALERT_ID;
          row.userId = userId;
          return row;
        });
      }) as never);
    jest
      .spyOn(AlertOwnerTeamService, "findAllBy")
      .mockImplementation((async (): Promise<Array<AlertOwnerTeam>> => {
        return this.alertOwnerTeams.map((teamId: ObjectID): AlertOwnerTeam => {
          const row: AlertOwnerTeam = new AlertOwnerTeam();
          row.alertId = ALERT_ID;
          row.teamId = teamId;
          return row;
        });
      }) as never);
    jest
      .spyOn(AlertService, "findOwners")
      .mockImplementation(async (): Promise<Array<User>> => {
        const owners: Array<ObjectID> = [...this.alertOwnerUsers];

        if (
          this.alertOwnerTeams.some((teamId: ObjectID): boolean => {
            return sameId(teamId, TEAM_ID);
          })
        ) {
          owners.push(TEAM_USER);
        }

        return owners.map((userId: ObjectID): User => {
          const user: User = new User();
          user.id = userId;
          user._id = userId.toString();
          return user;
        });
      });

    jest.spyOn(TeamService, "findOneById").mockImplementation((async (data: {
      id: ObjectID;
    }): Promise<Team> => {
      const team: Team = new Team();
      team.id = data.id;
      team.name = sameId(data.id, TEAM_ID) ? "Platform" : "Database";
      return team;
    }) as never);

    // The feed rows each entry writes.
    jest.spyOn(AlertFeedService, "create").mockImplementation((async (data: {
      data: AlertFeed;
    }): Promise<AlertFeed> => {
      this.alertFeedRows.push({
        type: String(data.data.alertFeedEventType),
        markdown: data.data.feedInfoInMarkdown || "",
        postedAt: data.data.postedAt!,
      });
      data.data.id = ObjectID.generate();
      return data.data;
    }) as never);

    // The incident's feed is written for real here: only its rows are kept in memory.
    jest.spyOn(IncidentFeedService, "createIncidentFeedItem").mockRestore();
    jest.spyOn(IncidentFeedService, "create").mockImplementation((async (data: {
      data: IncidentFeed;
    }): Promise<IncidentFeed> => {
      this.incidentFeedRows.push({
        type: String(data.data.incidentFeedEventType),
        markdown: data.data.feedInfoInMarkdown || "",
        postedAt: data.data.postedAt!,
      });
      this.feedItems.push(data.data.feedInfoInMarkdown || "");
      data.data.id = ObjectID.generate();
      return data.data;
    }) as never);

    // What the created entries name besides the record itself: nothing.
    jest
      .spyOn(LinkedAffectedResources, "readForAlert")
      .mockResolvedValue([] as never);
    jest
      .spyOn(LinkedAffectedResources, "readForIncident")
      .mockResolvedValue([] as never);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));
    jest
      .spyOn(AlertWorkspaceMessages, "getAlertCreateMessageBlocks")
      .mockResolvedValue([] as never);
    jest
      .spyOn(IncidentWorkspaceMessages, "getIncidentCreateMessageBlocks")
      .mockResolvedValue([] as never);

    this.standInAlertChain();
    this.standInIncidentChain();

    this.recordsCreatedAt = new Date(this.clock);
    this.scheduledMaintenance.createdAt = this.recordsCreatedAt;
    this.standInRecordKinds();
  }

  // IE-3 as the database holds it now.
  public incidentEpisodeModel(): IncidentEpisode {
    const record: KindRecord = this.records.incidentEpisode;
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.id = INCIDENT_EPISODE_ID;
    episode._id = INCIDENT_EPISODE_ID.toString();
    episode.projectId = PROJECT_ID;
    episode.title = "Payments are failing";
    episode.description = "Card payments fail at checkout.";
    episode.episodeNumber = 3;
    episode.episodeNumberWithPrefix = "IE-3";
    episode.isPrivate = false;
    episode.createdAt = this.recordsCreatedAt;
    episode.currentIncidentStateId = CREATED_STATE_ID;

    const state: IncidentState = new IncidentState();
    state._id = CREATED_STATE_ID.toString();
    state.id = CREATED_STATE_ID;
    state.name = "Identified";
    episode.currentIncidentState = state;

    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = SEVERITY_ID.toString();
    severity.id = SEVERITY_ID;
    severity.name = "Critical";
    episode.incidentSeverity = severity;

    episode.labels = this.labelsOf(record);

    if (record.channels !== null) {
      episode.postUpdatesToWorkspaceChannels = record.channels;
    }

    return episode;
  }

  // AE-4 as the database holds it now.
  public alertEpisodeModel(): AlertEpisode {
    const record: KindRecord = this.records.alertEpisode;
    const episode: AlertEpisode = new AlertEpisode();
    episode.id = ALERT_EPISODE_ID;
    episode._id = ALERT_EPISODE_ID.toString();
    episode.projectId = PROJECT_ID;
    episode.title = "Checkout alerts";
    episode.description = "Alerts of the checkout monitors.";
    episode.episodeNumber = 4;
    episode.episodeNumberWithPrefix = "AE-4";
    episode.isPrivate = false;
    episode.createdAt = this.recordsCreatedAt;
    episode.currentAlertStateId = CREATED_STATE_ID;

    const state: AlertState = new AlertState();
    state._id = CREATED_STATE_ID.toString();
    state.id = CREATED_STATE_ID;
    state.name = "Identified";
    episode.currentAlertState = state;

    const severity: AlertSeverity = new AlertSeverity();
    severity._id = SEVERITY_ID.toString();
    severity.id = SEVERITY_ID;
    severity.name = "High";
    episode.alertSeverity = severity;

    episode.labels = this.labelsOf(record);

    if (record.channels !== null) {
      episode.postUpdatesToWorkspaceChannels = record.channels;
    }

    return episode;
  }

  // SM-5 as the database holds it now, with its labels and its channels.
  public override scheduledMaintenanceModel(): ScheduledMaintenance {
    const record: KindRecord = this.records.scheduledMaintenance;
    const event: ScheduledMaintenance = super.scheduledMaintenanceModel();

    event.labels = this.labelsOf(record);

    if (record.channels !== null) {
      event.postUpdatesToWorkspaceChannels = record.channels;
    }

    return event;
  }

  // The monitor Checkout API as the database holds it now.
  public monitorModel(): Monitor {
    const record: KindRecord = this.records.monitor;
    const monitor: Monitor = new Monitor();
    monitor.id = MONITOR_ID;
    monitor._id = MONITOR_ID.toString();
    monitor.projectId = PROJECT_ID;
    monitor.name = "Checkout API";
    monitor.description = "The checkout API answers.";
    monitor.monitorType = MonitorType.Manual;
    monitor.createdAt = this.recordsCreatedAt;
    monitor.currentMonitorStatusId = MONITOR_STATUS_ID;

    const status: MonitorStatus = new MonitorStatus();
    status._id = MONITOR_STATUS_ID.toString();
    status.id = MONITOR_STATUS_ID;
    status.name = "Operational";
    monitor.currentMonitorStatus = status;

    monitor.labels = this.labelsOf(record);

    if (record.channels !== null) {
      monitor.postUpdatesToWorkspaceChannels = record.channels;
    }

    return monitor;
  }

  // The on-call policy Platform on-call as the database holds it now.
  public onCallPolicyModel(): OnCallDutyPolicy {
    const record: KindRecord = this.records.onCallPolicy;
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.id = ON_CALL_POLICY_ID;
    policy._id = ON_CALL_POLICY_ID.toString();
    policy.projectId = PROJECT_ID;
    policy.name = "Platform on-call";
    policy.description = "Who answers for the platform.";
    policy.createdAt = this.recordsCreatedAt;

    policy.labels = this.labelsOf(record);

    if (record.channels !== null) {
      policy.postUpdatesToWorkspaceChannels = record.channels;
    }

    return policy;
  }

  /*
   * Owners added to a record of one of those kinds, as its service adds
   * them: each row written, then its service's own hook - the "owner added"
   * entry, its post, and the owner's invites to the record's channels.
   */
  public async addOwnersOf(kind: RecordKind, owners: Owners): Promise<void> {
    const record: KindRecord = this.records[kind];
    const tables: OwnerTables = ownerTablesOf(kind);

    for (const userId of owners.users || []) {
      if (
        record.ownerUsers.some((id: ObjectID): boolean => {
          return sameId(id, userId);
        })
      ) {
        continue;
      }

      record.ownerUsers.push(userId);

      const row: BaseModel = this.ownerRow(tables, "userId", userId);

      await hookOf(tables.ownerUserService, "onCreateSuccess")(
        {
          createBy: { data: row, props: { isRoot: true } },
          carryForward: null,
        },
        row,
      );
    }

    for (const teamId of owners.teams || []) {
      if (
        record.ownerTeams.some((id: ObjectID): boolean => {
          return sameId(id, teamId);
        })
      ) {
        continue;
      }

      record.ownerTeams.push(teamId);

      const row: BaseModel = this.ownerRow(tables, "teamId", teamId);

      await hookOf(tables.ownerTeamService, "onCreateSuccess")(
        {
          createBy: { data: row, props: { isRoot: true } },
          carryForward: null,
        },
        row,
      );
    }
  }

  /*
   * Owners taken off a record of one of those kinds, as a delete of their
   * rows takes them off: each row deleted, then its service's own hook -
   * the "owner removed" entry and its post - with the rows the delete
   * found before it ran (onBeforeDelete's carryForward).
   */
  public async removeOwnersOf(kind: RecordKind, owners: Owners): Promise<void> {
    const record: KindRecord = this.records[kind];
    const tables: OwnerTables = ownerTablesOf(kind);

    const removed: Array<{
      service: AnyService;
      row: BaseModel;
    }> = [];

    for (const userId of owners.users || []) {
      if (
        !record.ownerUsers.some((id: ObjectID): boolean => {
          return sameId(id, userId);
        })
      ) {
        continue;
      }

      record.ownerUsers = record.ownerUsers.filter((id: ObjectID): boolean => {
        return !sameId(id, userId);
      });

      removed.push({
        service: tables.ownerUserService,
        row: this.ownerRow(tables, "userId", userId),
      });
    }

    for (const teamId of owners.teams || []) {
      if (
        !record.ownerTeams.some((id: ObjectID): boolean => {
          return sameId(id, teamId);
        })
      ) {
        continue;
      }

      record.ownerTeams = record.ownerTeams.filter((id: ObjectID): boolean => {
        return !sameId(id, teamId);
      });

      removed.push({
        service: tables.ownerTeamService,
        row: this.ownerRow(tables, "teamId", teamId),
      });
    }

    for (const each of removed) {
      await hookOf(each.service, "onDeleteSuccess")(
        {
          deleteBy: { query: {}, props: { isRoot: true } },
          carryForward: { itemsToDelete: [each.row] },
        },
        [],
      );
    }

    await this.settle();
  }

  /*
   * IE-3 is created, as IncidentEpisodeService.create creates it - by hand,
   * by the API or by a grouping rule, whose Episode Owners are added once
   * the create has returned (callerAdds).
   */
  public async createIncidentEpisode(
    options: CreateOptions = {},
  ): Promise<void> {
    if (options.withMembers) {
      // The incident it is created with, as the episode's entry names it.
      jest
        .spyOn(IncidentService, "findBy")
        .mockResolvedValue([this.incidentModel()] as never);
    }

    await this.createRecord({
      kind: "incidentEpisode",
      service: IncidentEpisodeService,
      model: (): BaseModel => {
        return this.incidentEpisodeModel();
      },
      carryForward: this.carryForwardOf("incidentEpisode", options),
      isCreatorMadeOwner: false,
      chainRunsOn: true,
      options: options,
    });
  }

  // AE-4 is created, as AlertEpisodeService.create creates it.
  public async createAlertEpisode(options: CreateOptions = {}): Promise<void> {
    await this.createRecord({
      kind: "alertEpisode",
      service: AlertEpisodeService,
      model: (): BaseModel => {
        return this.alertEpisodeModel();
      },
      carryForward: this.carryForwardOf("alertEpisode", options),
      isCreatorMadeOwner: false,
      chainRunsOn: true,
      options: options,
    });
  }

  /*
   * SM-5 is created, as ScheduledMaintenanceService.create creates it: its
   * creator is made its owner as the create returns.
   */
  public async createScheduledMaintenance(
    options: CreateOptions = {},
  ): Promise<void> {
    await this.createRecord({
      kind: "scheduledMaintenance",
      service: ScheduledMaintenanceService,
      model: (): BaseModel => {
        return this.scheduledMaintenanceModel();
      },
      carryForward: this.carryForwardOf("scheduledMaintenance", options),
      isCreatorMadeOwner: true,
      chainRunsOn: true,
      options: options,
    });
  }

  /*
   * The monitor Checkout API is created, as MonitorService.create creates
   * it: its creator is made its owner as the create returns.
   */
  public async createMonitor(options: CreateOptions = {}): Promise<void> {
    await this.createRecord({
      kind: "monitor",
      service: MonitorService,
      model: (): BaseModel => {
        return this.monitorModel();
      },
      carryForward: this.carryForwardOf("monitor", options),
      isCreatorMadeOwner: true,
      chainRunsOn: true,
      options: options,
    });
  }

  /*
   * The on-call policy Platform on-call is created, as
   * OnCallDutyPolicyService.create creates it: its hook runs its label and
   * owner rules, and its creator is made its owner as the create returns.
   * Settles once the policy has been announced - its channels opened,
   * "On-Call Policy Created" posted - and what waited for that is out: the
   * hold on its messages is let go (standInOnCallPolicyHook).
   */
  public async createOnCallPolicy(options: CreateOptions = {}): Promise<void> {
    await this.createRecord({
      kind: "onCallPolicy",
      service: OnCallDutyPolicyService,
      model: (): BaseModel => {
        return this.onCallPolicyModel();
      },
      carryForward: this.carryForwardOf("onCallPolicy", options),
      isCreatorMadeOwner: true,
      chainRunsOn: true,
      options: options,
    });
  }

  /*
   * A record of `kind` is created by `creator`, a person whose role creates
   * only what they own (#11352), through its service's real create() -
   * DatabaseService's own steps, in their own order: the INSERT, then the
   * creator made the record's owner before anything else happens to it
   * (makeCreatorOwnerOrUndo), then its create chain (onCreateSuccess) and
   * the rest. Their owner row is written as every owner row here is: the
   * row, then its service's own hook, which posts "Added Ana Lee ... as the
   * owner". What reads or writes the database around the INSERT is stood in
   * (standInCreateSteps). Settles once the create has returned or failed,
   * and the chain it set off has run to its end.
   */
  public async createAsOwnedCreator(
    kind: CreatedKind,
    creator: ObjectID,
    options: OwnedCreateOptions = {},
  ): Promise<OwnedCreate> {
    const created: CreateOf = this.createOf(kind);
    const steps: Array<string> = [];

    const ended: Promise<void> = new Promise<void>((resolve: () => void) => {
      this.chainEnded = resolve;
    });

    const data: BaseModel = created.model();
    // A create names no id of its own: its INSERT gives the record one.
    data._id = undefined;

    const props: DatabaseCommonInteractionProps = ownedScopeCreator(
      data.constructor as { new (): BaseModel },
      creator,
    );

    const createBy: CreateBy<BaseModel> = {
      data: data,
      props: props,
      ...this.ownersAsMiscData(options.ownersPicked),
    };

    this.standInCreateSteps({
      created: created,
      carryForward: this.carryForwardOf(kind, {}),
      steps: steps,
    });
    this.standInCreatorOwnerRow({
      created: created,
      steps: steps,
      fails: Boolean(options.ownerRowFails),
    });

    let error: Error | null = null;

    try {
      await (
        created.service as {
          create: (createBy: CreateBy<BaseModel>) => Promise<BaseModel>;
        }
      ).create(createBy);
    } catch (failure) {
      error = failure as Error;
    }

    if (!error) {
      await ended;
    }

    await this.settle();

    return {
      props: props,
      reliesOnOwnership: (
        created.service as {
          createReliesOnOwnership: (
            props: DatabaseCommonInteractionProps,
          ) => boolean;
        }
      ).createReliesOnOwnership(props),
      record: created.record,
      error: error,
      steps: steps,
    };
  }

  // A record of `kind` created here, as its messages name it.
  public recordOf(kind: CreatedKind): WorkspaceRecord {
    return this.createOf(kind).record;
  }

  /*
   * What a create of `kind` hands its create chain, as its onBeforeCreate
   * would (its carryForward): its first stage, the records it is made with,
   * and when its feed starts - read now, before it is written.
   */
  private carryForwardOf(
    kind: CreatedKind,
    options: CreateOptions,
  ): Record<string, unknown> {
    switch (kind) {
      case "alert":
        return {
          startingStage: options.startingStage || StartingStage.Open,
          feedStartsAt: this.tick(),
        };
      case "incident":
        return {
          startingStage: options.startingStage || StartingStage.Open,
          alertIdsToLink: options.declaredFromAlerts ? [DECLARED_ALERT_ID] : [],
          acknowledgedAlertStateId: null,
          alertIdsToAcknowledge: [],
          declaredByAlertIncidentRuleName: null,
          carryOverAlertOwners: Boolean(options.declaredFromAlerts),
          feedStartsAt: this.tick(),
        };
      case "incidentEpisode":
        return {
          startingStage: options.startingStage || StartingStage.Open,
          incidentIdsToAdd: options.withMembers ? [INCIDENT_ID] : [],
          feedStartsAt: this.tick(),
        };
      case "alertEpisode":
        return {
          startingStage: options.startingStage || StartingStage.Open,
          // ALT-6, as the alerts the world reads say.
          alertIdsToAdd: options.withMembers ? [DECLARED_ALERT_ID] : [],
          feedStartsAt: this.tick(),
        };
      case "scheduledMaintenance":
      case "monitor":
      case "onCallPolicy":
        return {
          feedStartsAt: this.tick(),
        };
    }
  }

  // The service a record of `kind` is created through, and where its owners go.
  private createOf(kind: CreatedKind): CreateOf {
    if (kind === "alert") {
      return {
        service: AlertService,
        record: { alertId: ALERT_ID },
        recordId: ALERT_ID,
        model: (): BaseModel => {
          return this.alertModel();
        },
        ownerUserService: asService(AlertOwnerUserService),
        ownerUsers: (): Array<ObjectID> => {
          return this.alertOwnerUsers;
        },
        addOwners: (owners: Owners): Promise<void> => {
          return this.addAlertOwners(owners);
        },
      };
    }

    if (kind === "incident") {
      return {
        service: IncidentService,
        record: { incidentId: INCIDENT_ID },
        recordId: INCIDENT_ID,
        model: (): BaseModel => {
          return this.incidentModel();
        },
        ownerUserService: asService(IncidentOwnerUserService),
        ownerUsers: (): Array<ObjectID> => {
          return this.incidentOwnerUsers;
        },
        addOwners: (owners: Owners): Promise<void> => {
          return this.addIncidentOwners(owners);
        },
      };
    }

    const tables: OwnerTables = ownerTablesOf(kind);
    const services: Record<RecordKind, unknown> = {
      incidentEpisode: IncidentEpisodeService,
      alertEpisode: AlertEpisodeService,
      scheduledMaintenance: ScheduledMaintenanceService,
      monitor: MonitorService,
      onCallPolicy: OnCallDutyPolicyService,
    };
    const models: Record<RecordKind, () => BaseModel> = {
      incidentEpisode: (): BaseModel => {
        return this.incidentEpisodeModel();
      },
      alertEpisode: (): BaseModel => {
        return this.alertEpisodeModel();
      },
      scheduledMaintenance: (): BaseModel => {
        return this.scheduledMaintenanceModel();
      },
      monitor: (): BaseModel => {
        return this.monitorModel();
      },
      onCallPolicy: (): BaseModel => {
        return this.onCallPolicyModel();
      },
    };
    const record: WorkspaceRecord = {};
    (record as Record<string, ObjectID>)[tables.column] = tables.recordId;

    return {
      service: services[kind],
      record: record,
      recordId: tables.recordId,
      model: models[kind],
      ownerUserService: tables.ownerUserService,
      ownerUsers: (): Array<ObjectID> => {
        return this.records[kind].ownerUsers;
      },
      addOwners: (owners: Owners): Promise<void> => {
        return this.addOwnersOf(kind, owners);
      },
    };
  }

  /*
   * What DatabaseService.create does around a record's INSERT that reads or
   * writes the database, stood in for a create here (createAsOwnedCreator):
   * the checks before and after its hooks - the caller's permissions, the
   * project's plan, the records it names, the values it holds unique, which
   * their own suites hold; its service's onBeforeCreate, which hands the
   * chain the OnCreate every create here hands it; the INSERT, which gives
   * the record its id; and what follows the INSERT besides its creator and
   * its hooks - its audit log entry, its images, the caches, its workflow
   * and its realtime event. Everything else is the create's own, in its own
   * order.
   */
  private standInCreateSteps(data: {
    created: CreateOf;
    carryForward: Record<string, unknown>;
    steps: Array<string>;
  }): void {
    const service: AnyService = asService(data.created.service);
    const record: WorkspaceRecord = data.created.record;
    const steps: Array<string> = data.steps;

    const held: () => string = (): string => {
      return WorkspaceCreatedMessageFirst.isHeld(record) ? " (held)" : "";
    };

    // The checks before its hooks, and on the record as it will be written.
    jest
      .spyOn(service, "checkCreateBeforeHooks")
      .mockResolvedValue([] as never);
    jest
      .spyOn(service, "refuseArchivedValuesOnCreate")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service, "checkCreatePermissionsOnRecord")
      .mockImplementation((async (args: {
        props: DatabaseCommonInteractionProps;
      }): Promise<DatabaseCommonInteractionProps> => {
        return args.props;
      }) as never);

    for (const check of [
      "checkTotalItemsBy",
      "prepareCustomFieldFilesOnCreate",
      "onBeforeCreateUniqueCheck",
      "checkUniqueColumnsTogether",
      "onCreatePermitted",
    ]) {
      jest.spyOn(service, check).mockResolvedValue(undefined as never);
    }

    for (const handsBack of [
      "checkForUniqueValues",
      "checkUniqueColumnBy",
      "sanitizeCreateOrUpdate",
    ]) {
      jest.spyOn(service, handsBack).mockImplementation((async (
        given: unknown,
      ): Promise<unknown> => {
        return given;
      }) as never);
    }

    jest.spyOn(service, "checkRequiredFields").mockImplementation(((
      given: unknown,
    ): unknown => {
      return given;
    }) as never);
    jest
      .spyOn(service, "planListOrderForCreate")
      .mockResolvedValue(null as never);
    jest.spyOn(service, "getCreateLimit").mockResolvedValue(null as never);
    jest
      .spyOn(RequiredUniqueNames, "holdNameOnCreate")
      .mockResolvedValue(null as never);

    // Its onBeforeCreate: what every create here hands its chain.
    jest.spyOn(service, "onBeforeCreate").mockImplementation((async (
      createBy: CreateBy<BaseModel>,
    ): Promise<OnCreate<BaseModel>> => {
      return { createBy: createBy, carryForward: data.carryForward };
    }) as never);

    // The INSERT: the row is written, with the record's own id.
    jest.spyOn(service, "getRepository").mockReturnValue({
      save: async (entity: BaseModel): Promise<BaseModel> => {
        entity._id = data.created.recordId.toString();
        steps.push(`insert${held()}`);
        return entity;
      },
    } as never);

    // What follows it besides its creator and its hooks.
    for (const after of [
      "recordCreateInAuditLog",
      "applyListOrderCreatePlan",
      "triggerWorkflowAfterWrite",
      "onTriggerRealtime",
    ]) {
      jest.spyOn(service, after).mockResolvedValue(undefined as never);
    }

    for (const cache of [
      PublishedImages,
      ProjectUsageCache,
      WorkflowListeners,
      RuleSetCache,
    ]) {
      jest
        .spyOn(asService(cache), "afterCreate")
        .mockResolvedValue(undefined as never);
    }

    // Its create hook - the real one - as it begins.
    const createHook: HookFunction = hookOf(service, "onCreateSuccess");

    jest.spyOn(service, "onCreateSuccess").mockImplementation((async (
      ...args: Array<unknown>
    ): Promise<unknown> => {
      steps.push(`create hook${held()}`);
      return await createHook(...args);
    }) as never);

    // A record taken out again, as its create undoes it.
    jest
      .spyOn(service, "hardDeleteBy")
      .mockImplementation((async (): Promise<number> => {
        steps.push(`taken out${held()}`);
        return 1;
      }) as never);
  }

  /*
   * The creator's owner row, as DatabaseService.create writes it for a
   * creator whose role creates only what they own (insertCreatorAsOwner,
   * through the owner table's own service): the row, then its service's
   * own hook, which posts "Added Ana Lee ... as the owner". Or, when it
   * `fails`, nothing: the create finds they do not own the record.
   */
  private standInCreatorOwnerRow(data: {
    created: CreateOf;
    steps: Array<string>;
    fails: boolean;
  }): void {
    const created: CreateOf = data.created;

    jest
      .spyOn(created.ownerUserService, "create")
      .mockImplementation((async (given: {
        data: BaseModel;
      }): Promise<BaseModel> => {
        data.steps.push(
          `owner row${WorkspaceCreatedMessageFirst.isHeld(created.record) ? " (held)" : ""}`,
        );

        if (data.fails) {
          throw new Error("The owner row could not be written.");
        }

        const userId: ObjectID = (given.data as unknown as { userId: ObjectID })
          .userId;

        await created.addOwners({ users: [userId] });

        given.data._id = ObjectID.generate().toString();
        return given.data;
      }) as never);

    // Whether they own it now, as the create asks once the row failed.
    jest
      .spyOn(created.ownerUserService, "findOneBy")
      .mockImplementation((async (args: {
        query: { userId?: ObjectID };
      }): Promise<BaseModel | null> => {
        const userId: ObjectID | undefined = args.query.userId;

        return userId &&
          created.ownerUsers().some((id: ObjectID): boolean => {
            return sameId(id, userId);
          })
          ? new IncidentOwnerUser()
          : null;
      }) as never);
  }

  /*
   * A record of one of those kinds is created: its create hook runs, then -
   * a moment later, as a write takes one - its creator is made its owner
   * (isCreatorMadeOwner: its create says it will, OwnersAddedBy.Create) and
   * the code that made it adds its owners (callerAdds, OwnersAddedBy.Caller).
   * Settles once the chain has run to its end (chainRunsOn) and everything
   * it set off has.
   */
  private async createRecord(data: {
    kind: RecordKind;
    service: unknown;
    model: () => BaseModel;
    carryForward: Record<string, unknown>;
    isCreatorMadeOwner: boolean;
    chainRunsOn: boolean;
    options: CreateOptions;
  }): Promise<void> {
    const ended: Promise<void> = data.chainRunsOn
      ? new Promise<void>((resolve: () => void) => {
          this.chainEnded = resolve;
        })
      : Promise.resolve();

    const createBy: CreateBy<BaseModel> = {
      data: data.model(),
      props: { isRoot: true },
      ...this.ownersAsMiscData(data.options.ownersPicked),
    };

    if (data.isCreatorMadeOwner) {
      CreatedNotificationHold.willAddOwners(createBy, OwnersAddedBy.Create);
    }

    if (data.options.callerAdds) {
      CreatedNotificationHold.willAddOwners(createBy, OwnersAddedBy.Caller);
    }

    const onCreate: OnCreate<BaseModel> = {
      createBy: createBy,
      carryForward: data.carryForward,
    };

    await hookOf(data.service, "onCreateSuccess")(onCreate, data.model());

    // The create returns; its owner rows are written a moment later.
    await this.settle();

    if (data.options.creator) {
      await this.addOwnersOf(data.kind, { users: [data.options.creator] });
    }

    if (data.isCreatorMadeOwner) {
      await CreatedNotificationHold.ownersAreIn(createBy, OwnersAddedBy.Create);
    }

    if (data.options.callerAdds) {
      await this.addOwnersOf(data.kind, data.options.callerAdds);
      await CreatedNotificationHold.ownersAreIn(createBy, OwnersAddedBy.Caller);
    }

    await ended;
    await this.settle();
  }

  private labelsOf(record: KindRecord): Array<Label> {
    return record.labels.map((id: ObjectID): Label => {
      return this.label(id);
    });
  }

  // A row of a kind's owner table, naming its record and its owner.
  private ownerRow(
    tables: OwnerTables,
    ownerColumn: "userId" | "teamId",
    ownerId: ObjectID,
  ): BaseModel {
    const row: BaseModel =
      ownerColumn === "userId"
        ? new tables.ownerUserModel()
        : new tables.ownerTeamModel();
    const fields: Record<string, unknown> = row as unknown as Record<
      string,
      unknown
    >;
    fields["projectId"] = PROJECT_ID;
    fields[tables.column] = tables.recordId;
    fields[ownerColumn] = ownerId;
    return row;
  }

  // The people who own a record: its owner users, and its owner teams' members.
  private ownersAsUsers(record: KindRecord): Array<User> {
    const owners: Array<ObjectID> = [...record.ownerUsers];

    if (
      record.ownerTeams.some((teamId: ObjectID): boolean => {
        return sameId(teamId, TEAM_ID);
      })
    ) {
      owners.push(TEAM_USER);
    }

    return owners.map((userId: ObjectID): User => {
      const user: User = new User();
      user.id = userId;
      user._id = userId.toString();
      return user;
    });
  }

  // The steps the other kinds' chains take that do not touch Slack.
  private standInRecordKinds(): void {
    // Each record, as it is now; its channels are stored on it.
    this.readsAndStores(IncidentEpisodeService, "incidentEpisode", () => {
      return this.incidentEpisodeModel();
    });
    this.readsAndStores(AlertEpisodeService, "alertEpisode", () => {
      return this.alertEpisodeModel();
    });
    this.readsAndStores(
      ScheduledMaintenanceService,
      "scheduledMaintenance",
      () => {
        return this.scheduledMaintenanceModel();
      },
    );
    this.readsAndStores(MonitorService, "monitor", () => {
      return this.monitorModel();
    });
    this.readsAndStores(OnCallDutyPolicyService, "onCallPolicy", () => {
      return this.onCallPolicyModel();
    });

    /*
     * Their owners, as their tables hold them - what a rule's Owner
     * condition reads (WorkspaceRecordOwners) and what an on-call policy's
     * channel setup reads (WorkspaceRecordPeople) - and as people to invite.
     */
    for (const kind of RECORD_KINDS) {
      const tables: OwnerTables = ownerTablesOf(kind);

      for (const method of ["findAllBy", "findBy"]) {
        jest
          .spyOn(tables.ownerUserService, method)
          .mockImplementation((async (): Promise<Array<BaseModel>> => {
            return this.records[kind].ownerUsers.map(
              (userId: ObjectID): BaseModel => {
                return this.ownerRow(tables, "userId", userId);
              },
            );
          }) as never);
        jest
          .spyOn(tables.ownerTeamService, method)
          .mockImplementation((async (): Promise<Array<BaseModel>> => {
            return this.records[kind].ownerTeams.map(
              (teamId: ObjectID): BaseModel => {
                return this.ownerRow(tables, "teamId", teamId);
              },
            );
          }) as never);
      }
    }

    for (const [service, kind] of [
      [IncidentEpisodeService, "incidentEpisode"],
      [AlertEpisodeService, "alertEpisode"],
      [ScheduledMaintenanceService, "scheduledMaintenance"],
      [MonitorService, "monitor"],
    ] as Array<[unknown, RecordKind]>) {
      jest
        .spyOn(asService(service), "findOwners")
        .mockImplementation((async (): Promise<Array<User>> => {
          return this.ownersAsUsers(this.records[kind]);
        }) as never);
    }

    // The feed rows each entry writes, with when each is filed.
    for (const [service, kind, typeColumn] of [
      [
        IncidentEpisodeFeedService,
        "incidentEpisode",
        "incidentEpisodeFeedEventType",
      ],
      [AlertEpisodeFeedService, "alertEpisode", "alertEpisodeFeedEventType"],
      [
        ScheduledMaintenanceFeedService,
        "scheduledMaintenance",
        "scheduledMaintenanceFeedEventType",
      ],
      [MonitorFeedService, "monitor", "monitorFeedEventType"],
      [
        OnCallDutyPolicyFeedService,
        "onCallPolicy",
        "onCallDutyPolicyFeedEventType",
      ],
    ] as Array<[unknown, RecordKind, string]>) {
      jest
        .spyOn(asService(service), "create")
        .mockImplementation((async (data: {
          data: BaseModel;
        }): Promise<BaseModel> => {
          const row: Record<string, unknown> = data.data as unknown as Record<
            string,
            unknown
          >;

          this.records[kind].feedRows.push({
            type: String(row[typeColumn]),
            markdown: String(row["feedInfoInMarkdown"] || ""),
            postedAt: row["postedAt"] as Date,
          });

          data.data.id = ObjectID.generate();
          return data.data;
        }) as never);
    }

    // What the created messages name besides the record itself: nothing.
    jest
      .spyOn(
        IncidentEpisodeWorkspaceMessages,
        "getIncidentEpisodeCreateMessageBlocks",
      )
      .mockResolvedValue([] as never);
    jest
      .spyOn(
        AlertEpisodeWorkspaceMessages,
        "getAlertEpisodeCreateMessageBlocks",
      )
      .mockResolvedValue([] as never);
    jest
      .spyOn(
        ScheduledMaintenanceWorkspaceMessages,
        "getScheduledMaintenanceCreateMessageBlocks",
      )
      .mockResolvedValue([] as never);
    jest
      .spyOn(MonitorWorkspaceMessages, "getMonitorCreateMessageBlocks")
      .mockResolvedValue([] as never);
    jest
      .spyOn(
        OnCallDutyPolicyWorkspaceMessages,
        "getOnCallDutyPolicyCreateMessageBlocks",
      )
      .mockResolvedValue([] as never);
    jest
      .spyOn(LinkedAffectedResources, "readForScheduledMaintenance")
      .mockResolvedValue([] as never);

    this.standInEpisodeChains();
    this.standInScheduledMaintenanceChain();
    this.standInMonitorChain();
    this.standInOnCallPolicyHook();
  }

  // A service's record, as it is now, and its channels stored on it.
  private readsAndStores(
    service: unknown,
    kind: RecordKind,
    model: () => BaseModel,
  ): void {
    jest
      .spyOn(asService(service), "findOneById")
      .mockImplementation((async (): Promise<BaseModel> => {
        return model();
      }) as never);

    jest
      .spyOn(asService(service), "updateOneById")
      .mockImplementation((async (data: {
        data: { postUpdatesToWorkspaceChannels?: unknown };
      }): Promise<void> => {
        if ("postUpdatesToWorkspaceChannels" in data.data) {
          this.records[kind].channels = [
            ...((data.data
              .postUpdatesToWorkspaceChannels as Array<NotificationRuleWorkspaceChannel>) ||
              []),
          ];
          this.events.push(`store:${kind}`);
        }
      }) as never);
  }

  // Both kinds of episode: their chains' steps that do not touch Slack.
  private standInEpisodeChains(): void {
    // The owners picked on an episode's create form, as their tables get them.
    jest
      .spyOn(OwnerRuleAssignment, "addOwnersPickedOnCreate")
      .mockImplementation((async (data: {
        resourceIdColumn: string;
        miscDataProps?: JSONObject | undefined;
      }): Promise<unknown> => {
        const kind: RecordKind =
          data.resourceIdColumn === "alertEpisodeId"
            ? "alertEpisode"
            : "incidentEpisode";
        const picked: JSONObject = data.miscDataProps || {};
        const users: Array<ObjectID> =
          (picked["ownerUsers"] as unknown as Array<ObjectID>) || [];
        const teams: Array<ObjectID> =
          (picked["ownerTeams"] as unknown as Array<ObjectID>) || [];

        await this.addOwnersOf(kind, { users: users, teams: teams });

        return { userIds: users, teamIds: teams, notAdded: [] };
      }) as never);

    for (const episode of [
      {
        kind: "incidentEpisode" as RecordKind,
        service: asService(IncidentEpisodeService),
        privacy: asService(IncidentEpisodePrivacyRuleEngineService),
        owners: asService(IncidentEpisodeOwnerRuleEngineService),
        labels: asService(IncidentEpisodeLabelRuleEngineService),
        onCall: asService(IncidentEpisodeOnCallRuleEngineService),
        firstState: async (): Promise<void> => {
          await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
            incidentEpisodeId: INCIDENT_EPISODE_ID,
            projectId: PROJECT_ID,
            incidentEpisodeFeedEventType:
              IncidentEpisodeFeedEventType.EpisodeStateChanged,
            feedInfoInMarkdown: "🔴 Changed Episode IE-3 State to Identified",
            workspaceNotification: { sendWorkspaceNotification: false },
          });
        },
      },
      {
        kind: "alertEpisode" as RecordKind,
        service: asService(AlertEpisodeService),
        privacy: asService(AlertEpisodePrivacyRuleEngineService),
        owners: asService(AlertEpisodeOwnerRuleEngineService),
        labels: asService(AlertEpisodeLabelRuleEngineService),
        onCall: asService(AlertEpisodeOnCallRuleEngineService),
        firstState: async (): Promise<void> => {
          await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
            alertEpisodeId: ALERT_EPISODE_ID,
            projectId: PROJECT_ID,
            alertEpisodeFeedEventType:
              AlertEpisodeFeedEventType.EpisodeStateChanged,
            feedInfoInMarkdown: "🔴 Changed Episode AE-4 State to Identified",
            workspaceNotification: { sendWorkspaceNotification: false },
          });
        },
      },
    ]) {
      jest
        .spyOn(episode.privacy, "applyRulesToEpisode")
        .mockResolvedValue(false as never);

      // Its first state: in its feed only, as its state timeline writes it.
      jest
        .spyOn(episode.service, "changeEpisodeState")
        .mockImplementation((async (): Promise<void> => {
          await episode.firstState();

          if (this.onFirstState) {
            await this.onFirstState();
          }
        }) as never);

      jest
        .spyOn(episode.owners, "applyRulesToEpisode")
        .mockImplementation((async (): Promise<void> => {
          await this.addOwnersOf(episode.kind, this.ownerRulesAdd);
        }) as never);

      jest
        .spyOn(episode.labels, "applyRulesToEpisode")
        .mockImplementation((async (): Promise<void> => {
          this.records[episode.kind].labels.push(...this.labelRulesAttach);
        }) as never);

      jest
        .spyOn(episode.onCall, "applyRulesToEpisode")
        .mockResolvedValue(undefined as never);

      // Its pages: the chain's last step.
      jest
        .spyOn(episode.service, "executeEpisodeOnCallDutyPoliciesAsync")
        .mockImplementation((async (): Promise<void> => {
          this.events.push("paging");
          this.chainEnded();
        }) as never);
    }

    // The members it is created with are added; the entry naming them is real.
    jest
      .spyOn(IncidentEpisodeMemberService, "addIncidentsToNewEpisode")
      .mockImplementation((async (data: {
        incidentIds: Array<ObjectID>;
      }): Promise<Array<ObjectID>> => {
        return data.incidentIds;
      }) as never);
    jest
      .spyOn(AlertEpisodeMemberService, "addAlertsToNewEpisode")
      .mockImplementation((async (data: {
        alertIds: Array<ObjectID>;
      }): Promise<Array<ObjectID>> => {
        return data.alertIds;
      }) as never);
  }

  // The maintenance event's chain: its steps that do not touch Slack.
  private standInScheduledMaintenanceChain(): void {
    const service: AnyService = asService(ScheduledMaintenanceService);

    // Its first state: in its feed only, as its state timeline writes it.
    jest
      .spyOn(service, "createScheduledMaintenanceStateTimelineAsync")
      .mockImplementation((async (): Promise<void> => {
        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
          {
            scheduledMaintenanceId: SCHEDULED_MAINTENANCE_ID,
            projectId: PROJECT_ID,
            scheduledMaintenanceFeedEventType:
              ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged,
            feedInfoInMarkdown:
              "⏳ Changed Scheduled Maintenance SM-5 State to Scheduled",
          },
        );

        if (this.onFirstState) {
          await this.onFirstState();
        }
      }) as never);

    jest.spyOn(service, "addOwners").mockImplementation((async (
      _projectId: ObjectID,
      _scheduledMaintenanceId: ObjectID,
      userIds: Array<ObjectID>,
      teamIds: Array<ObjectID>,
    ): Promise<unknown> => {
      await this.addOwnersOf("scheduledMaintenance", {
        users: userIds,
        teams: teamIds,
      });
      return { userIds: userIds, teamIds: teamIds, notAdded: [] };
    }) as never);

    jest
      .spyOn(
        asService(ScheduledMaintenanceOwnerRuleEngineService),
        "applyRulesToScheduledMaintenance",
      )
      .mockImplementation((async (): Promise<void> => {
        await this.addOwnersOf("scheduledMaintenance", this.ownerRulesAdd);
      }) as never);

    jest
      .spyOn(
        asService(ScheduledMaintenanceLabelRuleEngineService),
        "applyRulesToScheduledMaintenance",
      )
      .mockImplementation((async (): Promise<void> => {
        this.records.scheduledMaintenance.labels.push(...this.labelRulesAttach);
      }) as never);

    jest
      .spyOn(RunbookRuleEngineService, "applyRulesToScheduledMaintenance")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service, "refreshReminderSchedule")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OpenStackMaintenanceReach, "nameInFeed")
      .mockResolvedValue(undefined as never);

    // Its last step.
    jest
      .spyOn(OpenStackProjectNotices, "recordForMaintenance")
      .mockImplementation((async (): Promise<void> => {
        this.chainEnded();
      }) as never);
  }

  // The monitor's create: its steps that do not touch Slack.
  private standInMonitorChain(): void {
    const service: AnyService = asService(MonitorService);

    jest
      .spyOn(ProjectMilestoneService, "reachInBackground")
      .mockImplementation((() => {
        // no milestones in tests
      }) as never);
    jest
      .spyOn(service, "addProbesToMonitor")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OpenStackMonitorDependencies, "linkMonitor")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorFirstMeasured, "stampManualMonitorOnCreate")
      .mockResolvedValue(undefined as never);

    /*
     * Its first status: a line in its feed, posted to its channels as every
     * status change of a monitor is (MonitorStatusTimelineService).
     */
    jest
      .spyOn(service, "changeMonitorStatus")
      .mockImplementation((async (): Promise<void> => {
        await MonitorFeedService.createMonitorFeedItem({
          monitorId: MONITOR_ID,
          projectId: PROJECT_ID,
          monitorFeedEventType: MonitorFeedEventType.MonitorStatusChanged,
          feedInfoInMarkdown:
            "➡️ Changed Monitor **Checkout API State** to **Operational**",
          workspaceNotification: {
            sendWorkspaceNotification: true,
            leadWithAuthor: true,
          },
        });

        if (this.onFirstState) {
          await this.onFirstState();
        }
      }) as never);

    jest
      .spyOn(
        ActiveMonitoringMeteredPlan as unknown as AnyService,
        "reportQuantityToBillingProvider",
      )
      .mockResolvedValue(undefined as never);

    jest.spyOn(service, "addOwners").mockImplementation((async (
      _projectId: ObjectID,
      _monitorId: ObjectID,
      userIds: Array<ObjectID>,
      teamIds: Array<ObjectID>,
    ): Promise<unknown> => {
      await this.addOwnersOf("monitor", { users: userIds, teams: teamIds });
      return { userIds: userIds, teamIds: teamIds, notAdded: [] };
    }) as never);

    jest
      .spyOn(asService(MonitorLabelRuleEngineService), "applyRulesToMonitor")
      .mockImplementation((async (): Promise<void> => {
        this.records.monitor.labels.push(...this.labelRulesAttach);
      }) as never);

    jest
      .spyOn(asService(MonitorOwnerRuleEngineService), "applyRulesToMonitor")
      .mockImplementation((async (): Promise<void> => {
        await this.addOwnersOf("monitor", this.ownerRulesAdd);
      }) as never);

    jest
      .spyOn(
        asService(ServiceLevelObjectiveMonitorRuleEngineService),
        "syncSlosForMonitor",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        asService(StatusPageMonitorRuleEngineService),
        "syncRulesForMonitor",
      )
      .mockResolvedValue(undefined as never);

    // Its last step (a Manual monitor is no Probe Status monitor).
    jest
      .spyOn(service, "refreshMonitorProbeStatus")
      .mockImplementation((async (): Promise<void> => {
        this.chainEnded();
      }) as never);
  }

  // The on-call policy's create hook: its steps that do not touch Slack.
  private standInOnCallPolicyHook(): void {
    jest
      .spyOn(
        asService(OnCallDutyPolicyLabelRuleEngineService),
        "applyRulesToOnCallDutyPolicy",
      )
      .mockImplementation((async (): Promise<void> => {
        this.records.onCallPolicy.labels.push(...this.labelRulesAttach);
      }) as never);

    jest
      .spyOn(
        asService(OnCallDutyPolicyOwnerRuleEngineService),
        "applyRulesToOnCallDutyPolicy",
      )
      .mockImplementation((async (): Promise<void> => {
        await this.addOwnersOf("onCallPolicy", this.ownerRulesAdd);
      }) as never);

    /*
     * Its announcement's last step: the messages that waited for "On-Call
     * Policy Created" go out, and the hold on the policy's messages is let
     * go - whether the announcement ran to its end or stopped short.
     */
    const postHeld: (record: WorkspaceRecord) => Promise<void> =
      WorkspaceCreatedMessageFirst.postHeld.bind(WorkspaceCreatedMessageFirst);

    jest
      .spyOn(WorkspaceCreatedMessageFirst, "postHeld")
      .mockImplementation(async (record: WorkspaceRecord): Promise<void> => {
        await postHeld(record);

        if (record.onCallDutyPolicyId) {
          this.chainEnded();
        }
      });
  }

  private label(id: ObjectID): Label {
    const label: Label = new Label();
    label._id = id.toString();
    label.id = id;
    label.name = sameId(id, DATABASE_LABEL) ? "database" : "other";
    return label;
  }

  // The owners picked on the create, as its misc data hands them over.
  private ownersAsMiscData(owners: Owners | undefined): {
    miscDataProps?: JSONObject;
  } {
    if (!owners) {
      return {};
    }

    return {
      miscDataProps: {
        ...(owners.users ? { ownerUsers: owners.users } : {}),
        ...(owners.teams ? { ownerTeams: owners.teams } : {}),
      } as unknown as JSONObject,
    };
  }

  // The alert chain's steps that do not touch Slack.
  private standInAlertChain(): void {
    const service: Record<string, unknown> = AlertService as unknown as Record<
      string,
      unknown
    >;

    jest
      .spyOn(AlertPrivacyRuleEngineService, "applyRulesToAlert")
      .mockResolvedValue(false as never);

    // Its first state: in its feed only, as AlertStateTimelineService writes it.
    jest
      .spyOn(
        service as Record<string, () => Promise<void>>,
        "handleAlertStateChangeAsync",
      )
      .mockImplementation(async (): Promise<void> => {
        await AlertFeedService.createAlertFeedItem({
          alertId: ALERT_ID,
          projectId: PROJECT_ID,
          alertFeedEventType: AlertFeedEventType.AlertStateChanged,
          feedInfoInMarkdown: "🔴 Changed Alert ALT-7 State to Identified",
          workspaceNotification: { sendWorkspaceNotification: false },
        });

        if (this.onFirstState) {
          await this.onFirstState();
        }
      });

    jest.spyOn(AlertService, "addOwners").mockImplementation((async (
      _projectId: ObjectID,
      _alertId: ObjectID,
      userIds: Array<ObjectID>,
      teamIds: Array<ObjectID>,
    ): Promise<unknown> => {
      await this.addAlertOwners({ users: userIds, teams: teamIds });
      return { userIds: userIds, teamIds: teamIds, notAdded: [] };
    }) as never);

    jest
      .spyOn(AlertOwnerRuleEngineService, "applyRulesToAlert")
      .mockImplementation((async (): Promise<void> => {
        await this.addAlertOwners(this.ownerRulesAdd);
      }) as never);

    jest
      .spyOn(AlertLabelRuleEngineService, "applyRulesToAlert")
      .mockImplementation((async (): Promise<void> => {
        this.alertLabels.push(...this.labelRulesAttach);
      }) as never);

    jest
      .spyOn(AlertOnCallRuleEngineService, "hasRulesWithOwnerCondition")
      .mockResolvedValue(false as never);
    jest
      .spyOn(AlertOnCallRuleEngineService, "applyRulesToAlert")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AiFirstResponder, "onRecordCreated")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(RunbookRuleEngineService, "applyRulesToAlert")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        service as Record<string, () => Promise<void>>,
        "executeAlertOnCallDutyPoliciesAsync",
      )
      .mockImplementation(async (): Promise<void> => {
        this.events.push("paging");
      });
    jest
      .spyOn(AlertIncidentRuleEngineService, "applyRulesToAlert")
      .mockResolvedValue({ outcome: "NoRuleMatched" } as never);
    jest
      .spyOn(AlertGroupingEngineService, "processAlert")
      .mockResolvedValue({ grouped: false } as never);
    jest
      .spyOn(
        service as Record<string, () => Promise<void>>,
        "refreshReminderSchedule",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AIAlertInvestigationRunner, "investigateNewAlert")
      .mockImplementation((async (): Promise<boolean> => {
        this.chainEnded();
        return false;
      }) as never);
    jest
      .spyOn(AutoRemediationRuleEngineService, "onAlertCreated")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentFollowUpCheck, "onAlertOpened")
      .mockResolvedValue([] as never);
    jest
      .spyOn(VideoCallRuleExecutor, "startCallsForAlert")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertService, "compareAndSetColumnsByIdWithoutHooks")
      .mockResolvedValue(true as never);
  }

  // The incident chain's steps that do not touch Slack.
  private standInIncidentChain(): void {
    const service: Record<string, unknown> =
      IncidentService as unknown as Record<string, unknown>;

    jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation((() => {
      // no analytics in tests
    }) as never);

    jest
      .spyOn(IncidentPrivacyRuleEngineService, "applyRulesToIncident")
      .mockResolvedValue(false as never);

    // Its first state: in its feed only, as IncidentStateTimelineService writes it.
    jest
      .spyOn(
        service as Record<string, () => Promise<void>>,
        "handleIncidentStateChangeAsync",
      )
      .mockImplementation(async (): Promise<void> => {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID,
          incidentFeedEventType: IncidentFeedEventType.IncidentStateChanged,
          feedInfoInMarkdown: "🔴 Changed Incident INC-42 State to Identified",
          workspaceNotification: { sendWorkspaceNotification: false },
        });

        if (this.onFirstState) {
          await this.onFirstState();
        }
      });

    jest.spyOn(IncidentAlertService, "linkAlertsToIncident").mockResolvedValue({
      linkedAlertIds: [DECLARED_ALERT_ID],
      alreadyLinkedAlertIds: [],
      failed: [],
    } as never);
    jest
      .spyOn(IncidentAlertService, "copyAlertOwnersToIncident")
      .mockImplementation((async (): Promise<unknown> => {
        await this.addIncidentOwners(this.declaredAlertOwners);
        return {
          userIds: this.declaredAlertOwners.users || [],
          teamIds: this.declaredAlertOwners.teams || [],
        };
      }) as never);

    jest.spyOn(IncidentService, "addOwners").mockImplementation((async (
      _projectId: ObjectID,
      _incidentId: ObjectID,
      userIds: Array<ObjectID>,
      teamIds: Array<ObjectID>,
    ): Promise<unknown> => {
      await this.addIncidentOwners({ users: userIds, teams: teamIds });
      return { userIds: userIds, teamIds: teamIds, notAdded: [] };
    }) as never);

    jest
      .spyOn(IncidentOwnerRuleEngineService, "applyRulesToIncident")
      .mockImplementation((async (): Promise<void> => {
        await this.addIncidentOwners(this.ownerRulesAdd);
      }) as never);

    jest
      .spyOn(IncidentLabelRuleEngineService, "applyRulesToIncident")
      .mockImplementation((async (): Promise<void> => {
        this.incidentLabels.push(...this.labelRulesAttach);
      }) as never);

    for (const method of [
      "handleMonitorStatusChangeAsync",
      "disableActiveMonitoringIfManualIncident",
      "refreshReminderSchedule",
    ]) {
      jest
        .spyOn(service as Record<string, () => Promise<void>>, method)
        .mockResolvedValue(undefined as never);
    }

    jest
      .spyOn(IncidentOnCallRuleEngineService, "applyRulesToIncident")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(RunbookRuleEngineService, "applyRulesToIncident")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        service as Record<string, () => Promise<void>>,
        "executeOnCallDutyPoliciesAsync",
      )
      .mockImplementation(async (): Promise<void> => {
        this.events.push("paging");
      });
    jest
      .spyOn(IncidentGroupingEngineService, "processIncident")
      .mockResolvedValue({} as never);
    jest
      .spyOn(IncidentSlaService, "createSlaForIncident")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AIIncidentInvestigationRunner, "investigateNewIncident")
      .mockImplementation((async (): Promise<boolean> => {
        this.chainEnded();
        return false;
      }) as never);
    jest
      .spyOn(AutoRemediationRuleEngineService, "onIncidentCreated")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(VideoCallRuleExecutor, "startCallsForIncident")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "compareAndSetColumnsByIdWithoutHooks")
      .mockResolvedValue(true as never);
  }
}
