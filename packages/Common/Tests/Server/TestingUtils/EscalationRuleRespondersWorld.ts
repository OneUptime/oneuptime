import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import EscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import EscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import EscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import EscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyLabelRuleEngineService from "../../../Server/Services/OnCallDutyPolicyLabelRuleEngineService";
import OnCallDutyPolicyOwnerRuleEngineService from "../../../Server/Services/OnCallDutyPolicyOwnerRuleEngineService";
import OnCallDutyPolicyOwnerTeamService from "../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import OnDutyPoliciesCache from "../../../Server/Utils/OnCall/OnDutyPoliciesCache";
import ProjectMembership, {
  ProjectUserPair,
} from "../../../Server/Utils/TeamMember/ProjectMembership";
import OnCallDutyPolicyWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/OnCallDutyPolicy";
import URL from "../../../Types/API/URL";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "./InMemoryRepository";
import { stubProjectDirectory } from "./ProjectDirectory";

/*
 * AN ESCALATION RULE, ITS TEAMS, ITS PEOPLE AND ITS SCHEDULE, IN MEMORY
 * (#10970).
 *
 * A policy, "Payments on-call", with one level, "Level 1", and what it can
 * page: Platform - Ana and Bo, and Ivy, who was invited and has not joined -
 * Payments - Ana and Cy - and the Primary schedule, with whoever a test puts
 * on call in it. Every table the escalation rule services read and write is
 * held in memory - the rule's rows, the memberships, the on-call time logs -
 * and the real services, their hooks and EscalationRuleReach run over them.
 * A table in memory joins nothing, so every hook reads its row as stored,
 * without the relations a Postgres read joins: the ids from the row's own
 * columns (the names in the feed are empty here).
 *
 * Only what leaves the server is recorded instead: the messages people are
 * sent (`told`), the policy's feed (`feed`), and every error logged
 * (`errors`). The time logs are written by the real service, without the
 * hooks waiting for them: `settle()` waits for every one.
 *
 * Used by EscalationRuleRespondersAddedAndTakenOff (the services) and
 * EscalationRuleRespondersOverHttp (the Dashboard's and the API's requests).
 * Not a test file itself.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "10970000-0000-4000-8000-000000000001",
);
export const POLICY_ID: string = "10970000-0000-4000-8000-0000000000a1";
export const RULE_ID: string = "10970000-0000-4000-8000-0000000000b1";
export const PLATFORM: string = "10970000-0000-4000-8000-0000000000c1";
export const PAYMENTS: string = "10970000-0000-4000-8000-0000000000c2";
export const PRIMARY: string = "10970000-0000-4000-8000-0000000000d1";
export const ANA: string = "10970000-0000-4000-8000-0000000000e1";
export const BO: string = "10970000-0000-4000-8000-0000000000e2";
export const CY: string = "10970000-0000-4000-8000-0000000000e3";
export const IVY: string = "10970000-0000-4000-8000-0000000000e4";

export const NAMES: Record<string, string> = {
  [PLATFORM]: "Platform",
  [PAYMENTS]: "Payments",
  [PRIMARY]: "Primary",
  [ANA]: "Ana",
  [BO]: "Bo",
  [CY]: "Cy",
  [IVY]: "Ivy",
};

export interface WorldMembership {
  teamId: string;
  userId: string;
  accepted: boolean;
}

// Ana is in both teams; Ivy was invited to Platform and has not joined.
export const MEMBERSHIPS: Array<WorldMembership> = [
  { teamId: PLATFORM, userId: ANA, accepted: true },
  { teamId: PLATFORM, userId: BO, accepted: true },
  { teamId: PLATFORM, userId: IVY, accepted: false },
  { teamId: PAYMENTS, userId: ANA, accepted: true },
  { teamId: PAYMENTS, userId: CY, accepted: true },
];

export const ADDED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY;
export const REMOVED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY;

/*
 * A message a person was sent: to whom, which, and the policy and the rule
 * it names for their notification rules (null where it names none).
 */
export interface ToldMessage {
  userId: string;
  eventType: NotificationSettingEventType;
  policyId: string | null;
  ruleId: string | null;
}

// An entry of the policy's feed: the policy it was filed on, and its words.
export interface FeedEntry {
  policyId: string;
  markdown: string;
}

// The level a time log is read against: the world's own unless named.
export interface LogLevel {
  policyId: string;
  ruleId: string;
}

export const id: (value: unknown) => string = (value: unknown): string => {
  return String(value).toLowerCase();
};

export default class EscalationRuleRespondersWorld {
  public policies!: InMemoryTable;
  public rules!: InMemoryTable;
  public ruleUsers!: InMemoryTable;
  public ruleTeams!: InMemoryTable;
  public ruleSchedules!: InMemoryTable;
  public memberships!: InMemoryTable;
  public timeLogs!: InMemoryTable;

  public readonly errors: Array<string> = [];
  public readonly told: Array<ToldMessage> = [];
  public readonly feed: Array<FeedEntry> = [];

  // Whoever is on call in the Primary schedule now.
  public onCall: string | null = null;

  // What the hooks set off without waiting: the time logs started and ended.
  private readonly background: Array<Promise<unknown>> = [];
  private readonly tablesByModel: Map<unknown, InMemoryTable> = new Map<
    unknown,
    InMemoryTable
  >();
  private clock: number = 0;

  public install(): void {
    this.installLogger();

    stubProjectDirectory({});

    this.policies = this.inMemory(OnCallDutyPolicyService, [
      {
        _id: POLICY_ID,
        projectId: PROJECT_ID.toString(),
        name: "Payments on-call",
      },
    ]);
    this.rules = this.inMemory(EscalationRuleService, [
      {
        _id: RULE_ID,
        projectId: PROJECT_ID.toString(),
        onCallDutyPolicyId: POLICY_ID,
        name: "Level 1",
        order: 1,
        escalateAfterInMinutes: 30,
      },
    ]);
    this.ruleUsers = this.inMemory(EscalationRuleUserService, []);
    this.ruleTeams = this.inMemory(EscalationRuleTeamService, []);
    this.ruleSchedules = this.inMemory(EscalationRuleScheduleService, []);

    for (const table of [
      this.rules,
      this.ruleUsers,
      this.ruleTeams,
      this.ruleSchedules,
    ]) {
      this.stampsCreatedAt(table);
    }

    this.inMemory(IncidentOnCallRuleService, []);
    this.inMemory(AlertOnCallRuleService, []);
    this.inMemory(OnCallDutyPolicyOwnerUserService, []);
    this.inMemory(OnCallDutyPolicyOwnerTeamService, []);
    this.inMemory(TeamService, [
      { _id: PLATFORM, projectId: PROJECT_ID.toString(), name: "Platform" },
      { _id: PAYMENTS, projectId: PROJECT_ID.toString(), name: "Payments" },
    ]);
    this.inMemory(OnCallDutyPolicyScheduleService, [
      { _id: PRIMARY, projectId: PROJECT_ID.toString(), name: "Primary" },
    ]);
    this.memberships = this.inMemory(
      TeamMemberService,
      MEMBERSHIPS.map((membership: WorldMembership): StoredRow => {
        return {
          _id: ObjectID.generate().toString(),
          projectId: PROJECT_ID.toString(),
          teamId: membership.teamId,
          userId: membership.userId,
          hasAcceptedInvitation: membership.accepted,
        };
      }),
    );
    this.inMemory(
      UserService,
      [ANA, BO, CY, IVY].map((userId: string): StoredRow => {
        return {
          _id: userId,
          name: NAMES[userId],
          email: `${NAMES[userId]!.toLowerCase()}@acme.example`,
        };
      }),
    );
    // No Slack, Microsoft Teams or Mattermost connected: the lines are for none.
    this.inMemory(WorkspaceProjectAuthTokenService, []);
    // The time logs themselves, started and ended by the real service.
    this.timeLogs = this.inMemory(OnCallDutyPolicyTimeLogService, []);

    this.installRepositoriesMadeOnTheSpot();
    this.installMembershipReads();
    this.installTimeLogWaits();
    this.installWhatLeavesTheServer();
    this.installSchedule();
  }

  // Every time log the hooks set off, and any those set off, written.
  public async settle(): Promise<void> {
    while (this.background.length > 0) {
      await Promise.allSettled(
        this.background.splice(0, this.background.length),
      );
    }
  }

  // Forgets the messages sent so far.
  public forgetTold(): void {
    this.told.length = 0;
  }

  // The id of the rule's row naming `value` in `column`, or null.
  public rowOf(
    table: InMemoryTable,
    column: string,
    value: string,
  ): string | null {
    const row: StoredRow | undefined = table.rows.find(
      (each: StoredRow): boolean => {
        return id(each[column]) === id(value);
      },
    );

    return row ? String(row["_id"]) : null;
  }

  // Who was told `eventType`, by name, once for each time they were.
  public toldThat(eventType: NotificationSettingEventType): Array<string> {
    return this.told
      .filter((each: ToldMessage): boolean => {
        return each.eventType === eventType;
      })
      .map((each: ToldMessage): string => {
        return NAMES[each.userId] || each.userId;
      })
      .sort();
  }

  // The time logs still open, as they read: "Ana: team Platform".
  public openLogs(level?: LogLevel): Array<string> {
    return this.logs(false, level);
  }

  // The time logs ended.
  public endedLogs(level?: LogLevel): Array<string> {
    return this.logs(true, level);
  }

  /*
   * A time log as it reads: whose, and through what. One on another level
   * than `level` says which, so a test that expects the level's own sees it.
   */
  private logOf(row: StoredRow, level: LogLevel): string {
    const who: string = NAMES[id(row["userId"])] || String(row["userId"]);

    let path: string = "named";

    if (row["teamId"]) {
      path = `team ${NAMES[id(row["teamId"])] || String(row["teamId"])}`;
    } else if (row["onCallDutyPolicyScheduleId"]) {
      path = `on call in ${
        NAMES[id(row["onCallDutyPolicyScheduleId"])] ||
        String(row["onCallDutyPolicyScheduleId"])
      }`;
    }

    const isOnLevel: boolean =
      id(row["onCallDutyPolicyId"]) === id(level.policyId) &&
      id(row["onCallDutyPolicyEscalationRuleId"]) === id(level.ruleId) &&
      id(row["projectId"]) === id(PROJECT_ID);

    return isOnLevel
      ? `${who}: ${path}`
      : `${who}: ${path} (policy ${String(row["onCallDutyPolicyId"])}, rule ${String(row["onCallDutyPolicyEscalationRuleId"])})`;
  }

  private logs(ended: boolean, level?: LogLevel): Array<string> {
    const onLevel: LogLevel = level || { policyId: POLICY_ID, ruleId: RULE_ID };

    return this.timeLogs.rows
      .filter((row: StoredRow): boolean => {
        return Boolean(row["endsAt"]) === ended;
      })
      .map((row: StoredRow): string => {
        return this.logOf(row, onLevel);
      })
      .sort();
  }

  private inMemory<TBaseModel extends BaseModel>(
    service: DatabaseService<TBaseModel>,
    rows: Array<StoredRow>,
  ): InMemoryTable {
    const table: InMemoryTable = useInMemoryTable(service, rows);
    this.tablesByModel.set(service.modelType, table);
    return table;
  }

  /*
   * Postgres stamps a new row's createdAt (a column default); a table in
   * memory does not. The rule's rows are told apart by it - which of two
   * paths came first - so each new row is stamped a second after the last,
   * as rows saved one after another are.
   */
  private stampsCreatedAt(table: InMemoryTable): void {
    const save: (entity: StoredRow) => Promise<unknown> = table.repository.save
      .getMockImplementation() as (entity: StoredRow) => Promise<unknown>;

    table.repository.save.mockImplementation((async (
      entity: StoredRow,
    ): Promise<unknown> => {
      if (!entity["createdAt"]) {
        this.clock += 1000;
        entity["createdAt"] = new Date(Date.UTC(2026, 10, 24, 9) + this.clock);
      }

      return await save(entity);
    }) as never);
  }

  private installLogger(): void {
    for (const silenced of ["debug", "info", "warn"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    // Every error is kept: a hook that fails after the write logs one.
    getJestSpyOn(logger, "error").mockImplementation((error: unknown): void => {
      this.errors.push(String(error));
    });
  }

  // A service made on the spot for a table reads the same table in memory.
  private installRepositoriesMadeOnTheSpot(): void {
    const getRepository: () => unknown =
      DatabaseService.prototype.getRepository;
    const tablesByModel: Map<unknown, InMemoryTable> = this.tablesByModel;

    getJestSpyOn(DatabaseService.prototype, "getRepository").mockImplementation(
      function (this: DatabaseService<BaseModel>): unknown {
        const table: InMemoryTable | undefined = tablesByModel.get(
          this.modelType,
        );

        return table ? table.repository : getRepository.call(this);
      },
    );
  }

  /*
   * Who of a batch is a member of their project, which Postgres answers
   * with a statement of its own: here, from the memberships in memory.
   */
  private installMembershipReads(): void {
    getJestSpyOn(ProjectMembership, "getMemberKeys").mockImplementation(
      (async (pairs: Array<ProjectUserPair>): Promise<Set<string>> => {
        const keys: Set<string> = new Set<string>();

        for (const pair of pairs) {
          const isMember: boolean = this.memberships.rows.some(
            (row: StoredRow): boolean => {
              return (
                row["hasAcceptedInvitation"] === true &&
                id(row["userId"]) === id(pair.userId) &&
                id(row["projectId"]) === id(pair.projectId)
              );
            },
          );

          if (isMember) {
            keys.add(ProjectMembership.getKey(pair.projectId, pair.userId));
          }
        }

        return keys;
      }) as never,
    );
  }

  // The time logs are written without the hooks waiting: each is kept to wait for.
  private installTimeLogWaits(): void {
    for (const method of ["startTimeLogForUser", "endTimeLogForUser"]) {
      const write: (data: unknown) => Promise<unknown> = (
        OnCallDutyPolicyTimeLogService as unknown as Record<
          string,
          (data: unknown) => Promise<unknown>
        >
      )[method]!.bind(OnCallDutyPolicyTimeLogService);

      getJestSpyOn(OnCallDutyPolicyTimeLogService, method).mockImplementation(
        ((data: unknown): Promise<unknown> => {
          const written: Promise<unknown> = write(data);
          this.background.push(written);
          return written;
        }) as never,
      );
    }
  }

  private installWhatLeavesTheServer(): void {
    // Whom a message would go to.
    getJestSpyOn(
      UserNotificationSettingService,
      "sendUserNotification",
    ).mockImplementation((async (data: {
      userId: ObjectID;
      eventType: NotificationSettingEventType;
      onCallPolicyId?: ObjectID | undefined;
      onCallPolicyEscalationRuleId?: ObjectID | undefined;
    }): Promise<void> => {
      this.told.push({
        userId: id(data.userId),
        eventType: data.eventType,
        policyId: data.onCallPolicyId ? id(data.onCallPolicyId) : null,
        ruleId: data.onCallPolicyEscalationRuleId
          ? id(data.onCallPolicyEscalationRuleId)
          : null,
      });
    }) as never);

    // What the policy's feed, and its channels, hear.
    getJestSpyOn(
      OnCallDutyPolicyFeedService,
      "createOnCallDutyPolicyFeedItem",
    ).mockImplementation((async (item: {
      onCallDutyPolicyId: ObjectID;
      feedInfoInMarkdown: string;
    }): Promise<void> => {
      this.feed.push({
        policyId: id(item.onCallDutyPolicyId),
        markdown: item.feedInfoInMarkdown,
      });
    }) as never);

    // What a write sets off elsewhere.
    getJestSpyOn(
      OnCallDutyPolicyWorkspaceMessages,
      "createChannelsAndInviteUsersToChannels",
    ).mockResolvedValue(null);
    getJestSpyOn(
      OnCallDutyPolicyWorkspaceMessages,
      "getOnCallDutyPolicyCreateMessageBlocks",
    ).mockResolvedValue([]);
    getJestSpyOn(
      OnCallDutyPolicyLabelRuleEngineService,
      "applyRulesToOnCallDutyPolicy",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      OnCallDutyPolicyOwnerRuleEngineService,
      "applyRulesToOnCallDutyPolicy",
    ).mockResolvedValue(undefined);
    getJestSpyOn(UserService, "getUserMarkdownString").mockImplementation(
      (async (data: { userId: ObjectID }) => {
        return FeedMarkdown.asMarkdown(NAMES[id(data.userId)] || "");
      }) as never,
    );
    getJestSpyOn(
      OnCallDutyPolicyService,
      "getOnCallDutyPolicyLinkInDashboard",
    ).mockResolvedValue(URL.fromString("https://oneuptime.example/policy"));
    getJestSpyOn(
      DatabaseService.prototype,
      "onTriggerWorkflow",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      DatabaseService.prototype,
      "onTriggerRealtime",
    ).mockResolvedValue(undefined);
    getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(undefined);
    getJestSpyOn(OnDutyPoliciesCache, "forgetProjects").mockResolvedValue(
      undefined,
    );
  }

  // The schedule: its roster, its feeds, and who is on call in it now.
  private installSchedule(): void {
    getJestSpyOn(
      OnCallDutyPolicyScheduleService,
      "refreshCurrentUserIdAndHandoffTimeInSchedule",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      OnCallDutyPolicyScheduleService,
      "propagateShiftConfigChange",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      OnCallDutyPolicyScheduleService,
      "getCurrentUserIdInSchedule",
    ).mockImplementation((async (): Promise<ObjectID | null> => {
      return this.onCall ? new ObjectID(this.onCall) : null;
    }) as never);
  }
}
