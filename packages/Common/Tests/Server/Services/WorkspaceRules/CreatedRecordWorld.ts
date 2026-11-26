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
import AlertWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/Alert";
import IncidentWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/Incident";
import URL from "../../../../Types/API/URL";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { StartingStage } from "../../../../Utils/StartingStage";
import WorkspaceRuleWorld, {
  ALERT_ID,
  CREATED_STATE_ID,
  INCIDENT_ID,
  PROJECT_ID,
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
      miscDataProps: this.ownersAsMiscData(options.ownersPicked),
    };

    CreatedNotificationHold.willAddOwners(createBy, OwnersAddedBy.Create);

    if (options.callerAdds) {
      CreatedNotificationHold.willAddOwners(createBy, OwnersAddedBy.Caller);
    }

    const onCreate: OnCreate<Alert> = {
      createBy: createBy,
      carryForward: {
        startingStage: options.startingStage || StartingStage.Open,
        // Taken in onBeforeCreate, before the alert is written.
        feedStartsAt: this.tick(),
      },
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
      miscDataProps: this.ownersAsMiscData(options.ownersPicked),
    };

    CreatedNotificationHold.willAddOwners(createBy, OwnersAddedBy.Create);

    if (options.callerAdds) {
      CreatedNotificationHold.willAddOwners(createBy, OwnersAddedBy.Caller);
    }

    const onCreate: OnCreate<Incident> = {
      createBy: createBy,
      carryForward: {
        startingStage: options.startingStage || StartingStage.Open,
        alertIdsToLink: options.declaredFromAlerts ? [DECLARED_ALERT_ID] : [],
        acknowledgedAlertStateId: null,
        alertIdsToAcknowledge: [],
        declaredByAlertIncidentRuleName: null,
        carryOverAlertOwners: Boolean(options.declaredFromAlerts),
        // Taken in onBeforeCreate, before the incident is written.
        feedStartsAt: this.tick(),
      },
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
  }

  private label(id: ObjectID): Label {
    const label: Label = new Label();
    label._id = id.toString();
    label.id = id;
    label.name = sameId(id, DATABASE_LABEL) ? "database" : "other";
    return label;
  }

  private ownersAsMiscData(
    owners: Owners | undefined,
  ): Record<string, Array<ObjectID>> | undefined {
    if (!owners) {
      return undefined;
    }

    return {
      ...(owners.users ? { ownerUsers: owners.users } : {}),
      ...(owners.teams ? { ownerTeams: owners.teams } : {}),
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
