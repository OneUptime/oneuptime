import DatabaseConfig from "../../../Server/DatabaseConfig";
import AuditLogService from "../../../Server/Services/AuditLogService";
import MailService from "../../../Server/Services/MailService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationRuleAdminService from "../../../Server/Services/UserNotificationRuleAdminService";
import UserNotificationRuleService, {
  ExecuteNotificationRuleOptions,
} from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserService from "../../../Server/Services/UserService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING, AND WHY IT IS WRITTEN THE WAY IT IS
 *
 * A UserNotificationRule row is two halves that no screen, no ORM relation and
 * no permission rule ever compares against each other:
 *
 *     userId        -> whose on-call page selects this row
 *     user<X>Id     -> which address that page is delivered to
 *
 * For as long as every notification model was CurrentUser-only, the two halves
 * could not disagree: a caller could only ever name their own id in both. This
 * phase deliberately lets a project administrator write a row whose userId is
 * somebody else's, because an admin who cannot see or repair a responder's
 * broken notification setup cannot actually fix the outage-shaped problem this
 * epic is about. The moment that is true, "userId = Bob, userWebhookId = the
 * admin's own webhook" becomes an input somebody can send. It routes every one
 * of Bob's pages to an endpoint the sender controls, and it is invisible from
 * both ends: Bob's rules page still lists a rule, the on-call log still records
 * a delivered notification, and the page simply reaches the wrong human during
 * the incident where it mattered.
 *
 * The permission layer structurally cannot catch that. It reasons about tables
 * and columns; this is a relationship between two VALUES in one row. So the
 * invariants live in the service hooks, and this file is their adversarial
 * test: it sends the requests an attacker would send rather than the ones a
 * dashboard would.
 *
 *   R1  the rule's owner must be on the acting project's roster, because
 *       holding an administrative permission is a claim about ONE project and
 *       a user id is global.
 *   R3  a rule's method FK must point at a method row owned by the rule's own
 *       user - on create, on update, through the FK column and through the
 *       relation slot, on every one of the seven channels, and on update with
 *       the owner re-read from the DATABASE because the body is written by the
 *       party under suspicion.
 *   R6  the audit line and the owner's warning email are keyed on the actor the
 *       SERVER resolved against the owner the row was PERSISTED with; never on
 *       anything the request said, and never at the cost of the write itself.
 *   D-i-D a row that is already mismatched - written before these guards
 *       existed, or by internal code running as root - must be inert at
 *       delivery time rather than quietly obeyed.
 *
 * Every happy path here earns its place by proving a guard does not simply
 * refuse everything. A guard that blocks legitimate repair is deleted by the
 * next engineer who needs to repair something, and then there is no guard.
 *
 * No database is involved: each service the guards consult is a jest.spyOn
 * stub, and the hooks - which are protected, and are ordinary prototype methods
 * at runtime - are reached through a structural cast.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaa1111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "bbbb1111-1111-4111-8111-111111111111",
);
const ADMIN_USER_ID: ObjectID = new ObjectID(
  "aaaa2222-2222-4222-8222-222222222222",
);
const VICTIM_USER_ID: ObjectID = new ObjectID(
  "aaaa3333-3333-4333-8333-333333333333",
);
const STRANGER_USER_ID: ObjectID = new ObjectID(
  "aaaa4444-4444-4444-8444-444444444444",
);
const VICTIM_METHOD_ID: ObjectID = new ObjectID(
  "aaaa5555-5555-4555-8555-555555555555",
);
const ADMIN_METHOD_ID: ObjectID = new ObjectID(
  "aaaa6666-6666-4666-8666-666666666666",
);
const RULE_ID: ObjectID = new ObjectID("aaaa7777-7777-4777-8777-777777777777");
const SECOND_RULE_ID: ObjectID = new ObjectID(
  "aaaa8888-8888-4888-8888-888888888888",
);
const TEAM_MEMBER_ID: ObjectID = new ObjectID(
  "aaaa9999-9999-4999-8999-999999999999",
);
const ON_CALL_LOG_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "aaaabbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaacccc-cccc-4ccc-8ccc-cccccccccccc",
);

const ADMIN_EMAIL: string = "ada.admin@example.test";
const VICTIM_EMAIL: string = "vic.responder@example.test";

/*
 * The seven channels, each named by the FK column that carries it, the relation
 * slot that is the same write spelled differently, the service the guard has to
 * consult for that channel's owner, and the word that must appear in the
 * refusal so an operator can tell WHICH method was wrong.
 *
 * Everything about method ownership is driven off this table on purpose. The
 * one realistic way for the guard to be wrong is to cover six channels and
 * forget the seventh, and an attacker choosing between seven doors will always
 * choose the unlocked one - so a per-channel loop is the only shape of test
 * that means anything here.
 */
interface MethodServiceLike {
  findOneById: (...args: Array<never>) => unknown;
}

interface ChannelFixture {
  idColumn: string;
  relationColumn: string;
  label: string;
  service: MethodServiceLike;
}

const CHANNELS: Array<ChannelFixture> = [
  {
    idColumn: "userEmailId",
    relationColumn: "userEmail",
    label: "Email",
    service: UserEmailService as unknown as MethodServiceLike,
  },
  {
    idColumn: "userSmsId",
    relationColumn: "userSms",
    label: "SMS",
    service: UserSmsService as unknown as MethodServiceLike,
  },
  {
    idColumn: "userCallId",
    relationColumn: "userCall",
    label: "Call",
    service: UserCallService as unknown as MethodServiceLike,
  },
  {
    idColumn: "userWhatsAppId",
    relationColumn: "userWhatsApp",
    label: "WhatsApp",
    service: UserWhatsAppService as unknown as MethodServiceLike,
  },
  {
    idColumn: "userTelegramId",
    relationColumn: "userTelegram",
    label: "Telegram",
    service: UserTelegramService as unknown as MethodServiceLike,
  },
  {
    idColumn: "userPushId",
    relationColumn: "userPush",
    label: "Push",
    service: UserPushService as unknown as MethodServiceLike,
  },
  {
    idColumn: "userWebhookId",
    relationColumn: "userWebhook",
    label: "Webhook",
    service: UserWebhookService as unknown as MethodServiceLike,
  },
];

/*
 * The four write hooks and the private delivery half, named through a
 * structural cast. TypeScript forbids a test naming a protected member; the
 * runtime does not care, and testing these through `create()` / `updateBy()`
 * instead would drag in the entire ORM for no extra assurance about the one
 * comparison under test.
 */
interface RuleServiceInternals {
  onBeforeCreate: (
    createBy: CreateBy<UserNotificationRule>,
  ) => Promise<OnCreate<UserNotificationRule>>;
  onCreateSuccess: (
    onCreate: OnCreate<UserNotificationRule>,
    createdItem: UserNotificationRule,
  ) => Promise<UserNotificationRule>;
  onBeforeUpdate: (
    updateBy: UpdateBy<UserNotificationRule>,
  ) => Promise<OnUpdate<UserNotificationRule>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<UserNotificationRule>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<UserNotificationRule>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<UserNotificationRule>,
  ) => Promise<OnDelete<UserNotificationRule>>;
  onDeleteSuccess: (
    onDelete: OnDelete<UserNotificationRule>,
    deletedItemIds: Array<ObjectID>,
  ) => Promise<OnDelete<UserNotificationRule>>;
  deliverNotificationForRule: (
    notificationRuleItem: UserNotificationRule,
    options: ExecuteNotificationRuleOptions,
  ) => Promise<boolean>;
}

function ruleService(): RuleServiceInternals {
  return UserNotificationRuleService as unknown as RuleServiceInternals;
}

/*
 * A member session: a real actor id and a real tenant, exactly like the API
 * builds. It carries no ROLE permission, which makes it the ordinary-member
 * case - Permission.CurrentUser is auto-granted to every authenticated caller
 * and is the only thing letting this session through the model's write lists.
 */
function adminProps(
  overrides: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    userId: ADMIN_USER_ID,
    tenantId: PROJECT_ID,
    ...overrides,
  };
}

/*
 * A session that holds a genuine ProjectAdmin row on this project, which is
 * what a real administrator's session looks like once the API has resolved
 * their team memberships.
 *
 * The distinction from adminProps above is exactly the distinction
 * TenantPermission.isAccessGrantedOnlyByCurrentUser draws, and the whole
 * feature turns on it: a session holding only auto-granted permissions is
 * confined to its own rows, while one holding a role permission that appears in
 * the model's list is not - which is what lets an administrator see and repair
 * somebody else's paging in the first place.
 */
function projectAdminProps(
  overrides: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    userId: ADMIN_USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectAdmin,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
    ...overrides,
  };
}

/*
 * A create payload as the hook receives it: a real model instance, not a
 * literal, because the guard reads relation slots as well as FK columns and the
 * hook ahead of it reads the model's own accessors.
 */
function createPayload(data: {
  ownerUserId?: ObjectID | undefined;
  props?: DatabaseCommonInteractionProps | undefined;
  columns?: Record<string, unknown> | undefined;
  isOptOut?: boolean | undefined;
}): CreateBy<UserNotificationRule> {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.projectId = PROJECT_ID;
  rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
  rule.notifyAfterMinutes = 0;

  if (data.ownerUserId) {
    rule.userId = data.ownerUserId;
  }

  if (data.isOptOut) {
    rule.isOptOut = true;
  }

  Object.assign(rule, data.columns || {});

  return {
    data: rule,
    props: data.props || adminProps(),
  };
}

function updatePayload(data: {
  patch: Record<string, unknown>;
  query?: Record<string, unknown> | undefined;
  props?: DatabaseCommonInteractionProps | undefined;
}): UpdateBy<UserNotificationRule> {
  return {
    query: (data.query || {
      _id: RULE_ID.toString(),
    }) as unknown as UpdateBy<UserNotificationRule>["query"],
    data: data.patch as unknown as UpdateBy<UserNotificationRule>["data"],
    props: data.props || adminProps(),
    limit: 10,
    skip: 0,
  };
}

function deletePayload(
  data: {
    query?: Record<string, unknown> | undefined;
    props?: DatabaseCommonInteractionProps | undefined;
  } = {},
): DeleteBy<UserNotificationRule> {
  return {
    query: (data.query || {
      _id: RULE_ID.toString(),
    }) as unknown as DeleteBy<UserNotificationRule>["query"],
    props: data.props || adminProps(),
    limit: 10,
    skip: 0,
  };
}

/* The query the guard actually read the affected rows with. */
function guardReadQuery(findBySpy: jest.SpyInstance): Record<string, unknown> {
  return (
    findBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
    }
  ).query;
}

/*
 * A rule as the database has it. Deliberately built as a plain shape rather
 * than a model instance: these stand in for rows read back out of Postgres, and
 * making them structurally different from the payloads above keeps "which of
 * these two did the guard actually read" an honest question.
 */
function persistedRule(
  overrides: Record<string, unknown> = {},
): UserNotificationRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    projectId: PROJECT_ID,
    userId: VICTIM_USER_ID,
    ...overrides,
  } as unknown as UserNotificationRule;
}

/*
 * A notification-method row as its service hands it back. It carries the SAME
 * projectId as the rule in every ownership test below, because project scoping
 * is the check a reader instinctively assumes is already covering this - and it
 * is not. Both rows being in one project is the normal case for this attack:
 * the admin and their victim are colleagues.
 */
function methodRow(data: {
  ownerUserId: ObjectID;
  methodId: ObjectID;
}): Record<string, unknown> {
  return {
    id: data.methodId,
    _id: data.methodId.toString(),
    projectId: PROJECT_ID,
    userId: data.ownerUserId,
  };
}

function executeOptions(): ExecuteNotificationRuleOptions {
  return {
    projectId: PROJECT_ID,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: INCIDENT_ID,
    onCallPolicyId: undefined,
    userNotificationLogId: ON_CALL_LOG_ID,
  };
}

/*
 * The owner's warning email is fire-and-forget by construction: the row is
 * already committed when it is sent, so recordAdminRuleChange attaches a
 * .catch and deliberately does not await it. Asserting on it therefore means
 * letting the microtask queue drain first, and a macrotask boundary is the only
 * reliable way to do that.
 */
function flushAsync(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

/* The shape of the log attributes recordAdminRuleChange stamps its trail with. */
interface AdminChangeLogAttributes {
  projectId?: string | undefined;
  userId?: string | undefined;
  actorUserId?: string | undefined;
  userNotificationRuleId?: string | undefined;
  action?: string | undefined;
}

function adminChangeLogAttributes(
  infoSpy: jest.SpyInstance,
): Array<AdminChangeLogAttributes> {
  return infoSpy.mock.calls
    .map((call: Array<unknown>): AdminChangeLogAttributes | undefined => {
      return call[1] as AdminChangeLogAttributes | undefined;
    })
    .filter((attributes: AdminChangeLogAttributes | undefined): boolean => {
      return Boolean(attributes?.actorUserId);
    }) as Array<AdminChangeLogAttributes>;
}

/* A timeline row snapshotted at create() time. */
interface TimelineSnapshot {
  status: UserNotificationStatus | undefined;
  statusMessage: string | undefined;
  userId: string | undefined;
  userNotificationRuleId: string | undefined;
  userNotificationLogId: string | undefined;
  isRoot: boolean | undefined;
}

interface Stubs {
  teamMemberFindOneBy: jest.SpyInstance;
  ruleFindBy: jest.SpyInstance;
  ruleFindOneById: jest.SpyInstance;
  deliver: jest.SpyInstance;
  claim: jest.SpyInstance;
  timelineCreate: jest.SpyInstance;
  sendMail: jest.SpyInstance;
  userFindOneById: jest.SpyInstance;
  projectFindOneById: jest.SpyInstance;
  dashboardUrl: jest.SpyInstance;
  auditRecordCreate: jest.SpyInstance;
  auditRecordUpdate: jest.SpyInstance;
  auditRecordDelete: jest.SpyInstance;
  loggerInfo: jest.SpyInstance;
  loggerError: jest.SpyInstance;
  methodFindOneById: Map<string, jest.SpyInstance>;
}

describe("Administrative notification rule edit guards", () => {
  let stubs: Stubs;
  let timelineRows: Array<TimelineSnapshot>;

  beforeEach(() => {
    timelineRows = [];

    const methodFindOneById: Map<string, jest.SpyInstance> = new Map<
      string,
      jest.SpyInstance
    >();

    for (const channel of CHANNELS) {
      /*
       * Default: every method row in the world belongs to the victim, i.e. to
       * the user the rules under test belong to. A test that cares about a
       * mismatch has to say so for its own channel, which means a guard that
       * consults the WRONG service's rows fails rather than passes by luck.
       */
      methodFindOneById.set(
        channel.idColumn,
        jest.spyOn(channel.service, "findOneById").mockResolvedValue(
          methodRow({
            ownerUserId: VICTIM_USER_ID,
            methodId: VICTIM_METHOD_ID,
          }) as never,
        ),
      );
    }

    stubs = {
      teamMemberFindOneBy: jest
        .spyOn(TeamMemberService, "findOneBy")
        .mockResolvedValue({
          id: TEAM_MEMBER_ID,
          _id: TEAM_MEMBER_ID.toString(),
        } as unknown as TeamMember as never),
      ruleFindBy: jest
        .spyOn(UserNotificationRuleService, "findBy")
        .mockResolvedValue([persistedRule()] as never),
      ruleFindOneById: jest
        .spyOn(UserNotificationRuleService, "findOneById")
        .mockResolvedValue(null as never),
      deliver: jest
        .spyOn(ruleService(), "deliverNotificationForRule")
        .mockResolvedValue(true as never),
      claim: jest
        .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
        .mockResolvedValue(true as never),
      timelineCreate: jest
        .spyOn(UserOnCallLogTimelineService, "create")
        .mockImplementation(
          (
            createBy: CreateBy<UserOnCallLogTimeline>,
          ): Promise<UserOnCallLogTimeline> => {
            timelineRows.push({
              status: createBy.data.status,
              statusMessage: createBy.data.statusMessage,
              userId: createBy.data.userId?.toString(),
              userNotificationRuleId:
                createBy.data.userNotificationRuleId?.toString(),
              userNotificationLogId:
                createBy.data.userNotificationLogId?.toString(),
              isRoot: createBy.props.isRoot,
            });

            return Promise.resolve({
              id: TIMELINE_ID,
              _id: TIMELINE_ID.toString(),
            } as unknown as UserOnCallLogTimeline);
          },
        ) as unknown as jest.SpyInstance,
      sendMail: jest
        .spyOn(MailService, "sendMail")
        .mockResolvedValue(undefined as never),
      userFindOneById: jest
        .spyOn(UserService, "findOneById")
        .mockImplementation((findBy: { id: ObjectID }): Promise<User> => {
          const isAdmin: boolean =
            findBy.id.toString() === ADMIN_USER_ID.toString();

          return Promise.resolve({
            id: findBy.id,
            _id: findBy.id.toString(),
            name: new Name(isAdmin ? "Ada Admin" : "Vic Responder"),
            email: new Email(isAdmin ? ADMIN_EMAIL : VICTIM_EMAIL),
          } as unknown as User);
        }) as unknown as jest.SpyInstance,
      projectFindOneById: jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue({
          id: PROJECT_ID,
          _id: PROJECT_ID.toString(),
          name: "Acme Ops",
        } as unknown as Project as never),
      dashboardUrl: jest
        .spyOn(DatabaseConfig, "getDashboardUrl")
        .mockResolvedValue(URL.fromString("https://oneuptime.test") as never),
      auditRecordCreate: jest
        .spyOn(AuditLogService, "recordCreate")
        .mockResolvedValue(undefined as never),
      auditRecordUpdate: jest
        .spyOn(AuditLogService, "recordUpdate")
        .mockResolvedValue(undefined as never),
      auditRecordDelete: jest
        .spyOn(AuditLogService, "recordDelete")
        .mockResolvedValue(undefined as never),
      loggerInfo: jest.spyOn(logger, "info").mockImplementation((): void => {
        return undefined;
      }),
      loggerError: jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      }),
      methodFindOneById: methodFindOneById,
    };

    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * ------------------------------------------------------------------
   * R1 - an on-behalf-of write is confined to the acting project's roster.
   * ------------------------------------------------------------------
   */
  describe("R1: the rule's owner must be a member of the acting project", () => {
    test("a project admin cannot write a rule for a user who is not on this project's roster", async () => {
      /*
       * The attack in one request. The caller is a genuine administrator of
       * PROJECT_ID - the permission layer has already waved them through, which
       * is precisely why this check has to exist below it - and the user id
       * they name belongs to a project they have nothing to do with. A user id
       * is global; an administrative permission is not.
       */
      stubs.teamMemberFindOneBy.mockResolvedValue(null as never);

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: STRANGER_USER_ID,
            columns: { userEmailId: VICTIM_METHOD_ID },
          }),
        ),
      ).rejects.toThrow(
        `Cannot create a notification rule for user ${STRANGER_USER_ID.toString()} because they are not a member of this project.`,
      );

      /*
       * And the refusal comes before any method lookup. Not a correctness
       * requirement so much as evidence that the roster check really is the
       * thing that rejected this, rather than some later guard tripping over
       * the same fixture.
       */
      expect(stubs.methodFindOneById.get("userEmailId")).not.toHaveBeenCalled();
    });

    test("a project admin CAN write a rule for a user who is on the roster", async () => {
      /*
       * The other half, and the more important one to keep passing. An admin
       * who cannot repair a colleague's notification setup is the whole problem
       * this phase exists to solve, so a guard that refuses this case has not
       * been made safe - it has been made useless, and the next engineer will
       * remove it.
       */
      const payload: CreateBy<UserNotificationRule> = createPayload({
        ownerUserId: VICTIM_USER_ID,
        columns: { userEmailId: VICTIM_METHOD_ID },
      });

      const result: OnCreate<UserNotificationRule> =
        await ruleService().onBeforeCreate(payload);

      expect(stubs.teamMemberFindOneBy).toHaveBeenCalledTimes(1);
      // The guard validates ownership; it does not quietly re-point it.
      expect(result.createBy.data.userId?.toString()).toBe(
        VICTIM_USER_ID.toString(),
      );
    });

    test("membership is asked of the session's tenant, with root props, and only counts an accepted invitation", async () => {
      await ruleService().onBeforeCreate(
        createPayload({
          ownerUserId: VICTIM_USER_ID,
          columns: { userEmailId: VICTIM_METHOD_ID },
        }),
      );

      const rosterQuery: {
        query: {
          userId: ObjectID;
          projectId: ObjectID;
          hasAcceptedInvitation: boolean;
        };
        props: { isRoot: boolean };
      } = stubs.teamMemberFindOneBy.mock.calls[0]![0] as {
        query: {
          userId: ObjectID;
          projectId: ObjectID;
          hasAcceptedInvitation: boolean;
        };
        props: { isRoot: boolean };
      };

      expect(rosterQuery.query.userId.toString()).toBe(
        VICTIM_USER_ID.toString(),
      );
      /*
       * props.tenantId, never a projectId out of the body. A body-supplied
       * project would let the caller nominate the roster they wish to be
       * checked against, which is the same as not checking.
       */
      expect(rosterQuery.query.projectId.toString()).toBe(
        PROJECT_ID.toString(),
      );
      /*
       * A pending invitation is not membership. Any admin can invite any email
       * address, so counting an unaccepted invitation would hand back most of
       * what this guard just took away.
       */
      expect(rosterQuery.query.hasAcceptedInvitation).toBe(true);
      /*
       * isRoot, because this is a question about the database's state. Asked
       * through the caller's own scope, a caller who cannot READ the roster
       * would get "no rows" and any lenient reading of that answer opens the
       * door this closes.
       */
      expect(rosterQuery.props.isRoot).toBe(true);
    });

    test("the roster consulted is the session's project, not the project named in the body", async () => {
      /*
       * The body says the rule lives in PROJECT_ID while the session is scoped
       * to OTHER_PROJECT_ID. Membership must be judged where the caller is
       * actually acting, or an admin of a throwaway project could authorise
       * themselves by writing somebody else's project id into the payload.
       */
      stubs.teamMemberFindOneBy.mockResolvedValue(null as never);

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: VICTIM_USER_ID,
            props: adminProps({ tenantId: OTHER_PROJECT_ID }),
            columns: { userEmailId: VICTIM_METHOD_ID },
          }),
        ),
      ).rejects.toThrow("are not a member of this project");

      const rosterQuery: { query: { projectId: ObjectID } } = stubs
        .teamMemberFindOneBy.mock.calls[0]![0] as {
        query: { projectId: ObjectID };
      };

      expect(rosterQuery.query.projectId.toString()).toBe(
        OTHER_PROJECT_ID.toString(),
      );
    });

    test("a session with no tenant at all cannot write for another user", async () => {
      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: VICTIM_USER_ID,
            props: adminProps({ tenantId: undefined }),
            columns: { userEmailId: VICTIM_METHOD_ID },
          }),
        ),
      ).rejects.toThrow(
        "A project is required to create a notification rule for another user.",
      );

      expect(stubs.teamMemberFindOneBy).not.toHaveBeenCalled();
    });

    test("configuring your own rules is not an administrative act and is not roster-checked", async () => {
      stubs.methodFindOneById.get("userEmailId")!.mockResolvedValue(
        methodRow({
          ownerUserId: ADMIN_USER_ID,
          methodId: ADMIN_METHOD_ID,
        }) as never,
      );

      await ruleService().onBeforeCreate(
        createPayload({
          ownerUserId: ADMIN_USER_ID,
          columns: { userEmailId: ADMIN_METHOD_ID },
        }),
      );

      expect(stubs.teamMemberFindOneBy).not.toHaveBeenCalled();
    });

    test("an omitted owner column is a self-write, because the ownership stamp happens after this hook", async () => {
      /*
       * A first-party client has no reason to echo its own user id back, so the
       * ordinary self-service create arrives with userId unset and
       * CreatePermission stamps it later. Reading data.userId alone here would
       * treat every one of those as an ownerless on-behalf-of write.
       */
      stubs.methodFindOneById.get("userEmailId")!.mockResolvedValue(
        methodRow({
          ownerUserId: ADMIN_USER_ID,
          methodId: ADMIN_METHOD_ID,
        }) as never,
      );

      await ruleService().onBeforeCreate(
        createPayload({
          columns: { userEmailId: ADMIN_METHOD_ID },
        }),
      );

      expect(stubs.teamMemberFindOneBy).not.toHaveBeenCalled();
      // ...and the method is still checked, against the actor as implied owner.
      expect(stubs.methodFindOneById.get("userEmailId")).toHaveBeenCalled();
    });

    test("an opt-out row for another user is roster-checked too - silence is also a change to their paging", async () => {
      /*
       * An opt-out rule carries no method at all, so R3 has nothing to say
       * about it. It still decides that a named human is NOT paged for a
       * severity, which is the more dangerous half of the feature, so R1 has to
       * cover it independently of whether a method is present.
       */
      stubs.teamMemberFindOneBy.mockResolvedValue(null as never);

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: STRANGER_USER_ID,
            isOptOut: true,
          }),
        ),
      ).rejects.toThrow("are not a member of this project");
    });

    test("an actor-less caller - an API key holding the permission - is still roster-checked", async () => {
      /*
       * An API key is authenticated but is nobody: props.userId is undefined.
       * That makes every write it does an on-behalf-of write by definition, and
       * it must not be able to slip past the roster because the guard could not
       * work out who it "really" is. A key scoped to one project is still only
       * a claim about that project.
       */
      stubs.teamMemberFindOneBy.mockResolvedValue(null as never);

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: STRANGER_USER_ID,
            props: { tenantId: PROJECT_ID },
            columns: { userEmailId: VICTIM_METHOD_ID },
          }),
        ),
      ).rejects.toThrow("are not a member of this project");
    });

    test("root writes are exempt - internal seeding builds both halves from one user id", async () => {
      await ruleService().onBeforeCreate(
        createPayload({
          ownerUserId: VICTIM_USER_ID,
          props: { isRoot: true },
          columns: { userEmailId: VICTIM_METHOD_ID },
        }),
      );

      expect(stubs.teamMemberFindOneBy).not.toHaveBeenCalled();
      expect(stubs.methodFindOneById.get("userEmailId")).not.toHaveBeenCalled();
    });
  });

  /*
   * ------------------------------------------------------------------
   * R3 on create - a rule may only name methods its own owner owns.
   * ------------------------------------------------------------------
   */
  describe("R3 on create: a rule's method must belong to the rule's user", () => {
    test("the guard covers exactly the notification method columns the model declares", () => {
      /*
       * Derived from the model rather than restated, so that an eighth channel
       * added to UserNotificationRule and forgotten in the guard fails HERE,
       * loudly, instead of quietly becoming the one unlocked door.
       */
      const methodIdColumnPattern: RegExp = /^user[A-Z][A-Za-z]*Id$/;

      const columnsOnModel: Array<string> = Object.keys(
        new UserNotificationRule(),
      ).filter((column: string): boolean => {
        return methodIdColumnPattern.test(column);
      });

      // If the derivation itself ever breaks, fail rather than pass vacuously.
      expect(columnsOnModel).toHaveLength(7);

      expect(
        [
          ...UserNotificationRuleAdminService.getNotificationMethodIdColumns(),
        ].sort(),
      ).toEqual([...columnsOnModel].sort());
      expect(
        [
          ...CHANNELS.map((c: ChannelFixture): string => {
            return c.idColumn;
          }),
        ].sort(),
      ).toEqual([...columnsOnModel].sort());
    });

    /*
     * forEach rather than a bare for-of: the per-channel tests close over the
     * `stubs` that beforeEach rebuilds, and a function declared directly inside
     * a loop statement capturing a reassigned binding is exactly what
     * no-loop-func exists to catch. The callback gives each channel its own
     * scope and says so.
     */
    CHANNELS.forEach((channel: ChannelFixture): void => {
      test(`${channel.label}: a rule owned by one user may not point at another user's ${channel.idColumn}, even inside one project`, async () => {
        /*
         * Both rows live in PROJECT_ID. That is the point of the fixture:
         * project scoping is the check everyone assumes already covers this,
         * and it does not - the admin and the responder they are hijacking are
         * colleagues in the same project by construction.
         */
        stubs.methodFindOneById.get(channel.idColumn)!.mockResolvedValue(
          methodRow({
            ownerUserId: ADMIN_USER_ID,
            methodId: ADMIN_METHOD_ID,
          }) as never,
        );

        await expect(
          ruleService().onBeforeCreate(
            createPayload({
              ownerUserId: VICTIM_USER_ID,
              columns: { [channel.idColumn]: ADMIN_METHOD_ID },
            }),
          ),
        ).rejects.toThrow(
          `The ${channel.label} notification method referenced by this rule belongs to a different user.`,
        );
      });

      test(`${channel.label}: the ${channel.relationColumn} relation slot is the same write and is refused the same way`, async () => {
        /*
         * The REST layer accepts a relation object as well as a bare FK, so a
         * guard that only reads the id column is bypassed by sending the other
         * spelling of the identical write.
         */
        stubs.methodFindOneById.get(channel.idColumn)!.mockResolvedValue(
          methodRow({
            ownerUserId: ADMIN_USER_ID,
            methodId: ADMIN_METHOD_ID,
          }) as never,
        );

        await expect(
          ruleService().onBeforeCreate(
            createPayload({
              ownerUserId: VICTIM_USER_ID,
              columns: {
                [channel.relationColumn]: {
                  _id: ADMIN_METHOD_ID.toString(),
                },
              },
            }),
          ),
        ).rejects.toThrow(
          `The ${channel.label} notification method referenced by this rule belongs to a different user.`,
        );
      });

      test(`${channel.label}: a rule pointing at its own owner's ${channel.idColumn} is written`, async () => {
        await ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: VICTIM_USER_ID,
            columns: { [channel.idColumn]: VICTIM_METHOD_ID },
          }),
        );

        const lookedUpId: ObjectID = stubs.methodFindOneById.get(
          channel.idColumn,
        )!.mock.calls[0]![0].id as ObjectID;

        expect(lookedUpId.toString()).toBe(VICTIM_METHOD_ID.toString());
      });
    });

    test("a method id that matches no row is refused rather than waved through", async () => {
      /*
       * "Not found" and "not yours" are the same answer here - in both cases
       * the caller named a row they have no business naming - and a guard whose
       * unknown case resolves to `undefined === undefined` opens on exactly the
       * input it was written to reject.
       */
      stubs.methodFindOneById
        .get("userWebhookId")!
        .mockResolvedValue(null as never);

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: VICTIM_USER_ID,
            columns: { userWebhookId: ADMIN_METHOD_ID },
          }),
        ),
      ).rejects.toThrow(
        "The Webhook notification method referenced by this rule does not exist.",
      );
    });

    test("the method's owner is read with root props, so the caller's own visibility cannot shape the answer", async () => {
      await ruleService().onBeforeCreate(
        createPayload({
          ownerUserId: VICTIM_USER_ID,
          columns: { userEmailId: VICTIM_METHOD_ID },
        }),
      );

      const lookup: { props: { isRoot: boolean } } =
        stubs.methodFindOneById.get("userEmailId")!.mock.calls[0]![0] as {
          props: { isRoot: boolean };
        };

      expect(lookup.props.isRoot).toBe(true);
    });

    test("the mirror hijack is refused too: my own rule may not deliver to your address", async () => {
      /*
       * userId = me, userEmailId = yours. It steals nobody's pages; it COPIES
       * mine to an address I do not own, which is how you page-bomb a colleague
       * or exfiltrate incident titles. It was writable long before this phase
       * widened anything, and it is the same comparison, so it is refused by
       * the same guard.
       */
      stubs.methodFindOneById.get("userEmailId")!.mockResolvedValue(
        methodRow({
          ownerUserId: VICTIM_USER_ID,
          methodId: VICTIM_METHOD_ID,
        }) as never,
      );

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: ADMIN_USER_ID,
            columns: { userEmailId: VICTIM_METHOD_ID },
          }),
        ),
      ).rejects.toThrow(
        "The Email notification method referenced by this rule belongs to a different user.",
      );
    });

    test("naming one method in the FK column and a DIFFERENT one in the relation slot does not smuggle the second one past the guard", async () => {
      /*
       * KNOWN FAILURE - a real bypass of R3, not a test artefact. Read this
       * before "fixing" the test.
       *
       * `userEmailId` and `userEmail` are two spellings of ONE database column,
       * and a request may carry both. collectNotificationMethodReferences
       * resolves them with `carrier[idColumn] || carrier[relationColumn]`, so
       * when both are present it validates the FK COLUMN and ignores the
       * relation.
       *
       * TypeORM resolves the same conflict the other way round. The declared
       * @Column("userEmailId") and the @JoinColumn of the userEmail relation
       * share one ColumnMetadata (RelationJoinColumnBuilder attaches
       * relationMetadata to the column the model already declares), and
       * ColumnMetadata.getEntityValue reads the RELATION first, falling back to
       * the scalar property only when the relation slot holds no object.
       *
       * So the id that is validated and the id that is written are different
       * ids, and the caller chooses both. Send the rule owner's own method in
       * userEmailId to satisfy the guard, and your own row in userEmail to be
       * persisted. Same for update: a patch carrying a relation object takes
       * DatabaseService's `hasRelationUpdates` branch and is written with
       * save(), which uses the same precedence.
       *
       * The delivery-time check in executeNotificationRuleItem is what stops
       * this being a live page-redirection - it compares the LOADED relation's
       * owner and refuses - so the blast radius today is a rule that silently
       * fails to page rather than one that pages the wrong person. That is a
       * backstop, not the guard, and R3 is the guard.
       *
       * The fix is to validate every method reference the payload carries
       * rather than the first one found: collect both spellings, and refuse a
       * payload whose two spellings disagree.
       */
      stubs.methodFindOneById
        .get("userEmailId")!
        .mockImplementation(
          (findBy: { id: ObjectID }): Promise<Record<string, unknown>> => {
            return Promise.resolve(
              methodRow({
                ownerUserId:
                  findBy.id.toString() === ADMIN_METHOD_ID.toString()
                    ? ADMIN_USER_ID
                    : VICTIM_USER_ID,
                methodId: findBy.id,
              }),
            );
          },
        );

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: VICTIM_USER_ID,
            columns: {
              // Innocent, owned by the rule's owner, and the only one checked.
              userEmailId: VICTIM_METHOD_ID,
              // The attacker's own row, and the one that reaches the database.
              userEmail: { _id: ADMIN_METHOD_ID.toString() },
            },
          }),
        ),
      ).rejects.toThrow(
        "The Email notification method referenced by this rule belongs to a different user.",
      );
    });

    test("an actor-less caller gets no benefit of the doubt about method ownership either", async () => {
      /*
       * The companion to the roster test above. An API key has no user id to
       * compare a method's owner against, so a guard that resolved the rule's
       * owner from the SESSION rather than from the payload would have nothing
       * to check and would let this through.
       */
      stubs.methodFindOneById.get("userEmailId")!.mockResolvedValue(
        methodRow({
          ownerUserId: ADMIN_USER_ID,
          methodId: ADMIN_METHOD_ID,
        }) as never,
      );

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: VICTIM_USER_ID,
            props: { tenantId: PROJECT_ID },
            columns: { userEmailId: ADMIN_METHOD_ID },
          }),
        ),
      ).rejects.toThrow(
        "The Email notification method referenced by this rule belongs to a different user.",
      );
    });

    test("a rule naming several methods is refused when any single one of them is foreign", async () => {
      stubs.methodFindOneById.get("userPushId")!.mockResolvedValue(
        methodRow({
          ownerUserId: ADMIN_USER_ID,
          methodId: ADMIN_METHOD_ID,
        }) as never,
      );

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: VICTIM_USER_ID,
            columns: {
              userEmailId: VICTIM_METHOD_ID,
              userSmsId: VICTIM_METHOD_ID,
              userPushId: ADMIN_METHOD_ID,
            },
          }),
        ),
      ).rejects.toThrow(
        "The Push notification method referenced by this rule belongs to a different user.",
      );
    });
  });

  /*
   * ------------------------------------------------------------------
   * R3 on update - the owner is whatever the DATABASE says it is.
   * ------------------------------------------------------------------
   */
  describe("R3 on update: the rule's owner is re-read from the database", () => {
    test("an admin repointing a victim's rule at the admin's own webhook is refused", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
      ] as never);
      stubs.methodFindOneById.get("userWebhookId")!.mockResolvedValue(
        methodRow({
          ownerUserId: ADMIN_USER_ID,
          methodId: ADMIN_METHOD_ID,
        }) as never,
      );

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({ patch: { userWebhookId: ADMIN_METHOD_ID } }),
        ),
      ).rejects.toThrow(
        "The Webhook notification method referenced by this rule belongs to a different user.",
      );
    });

    test("a body that CLAIMS the rule belongs to the caller does not change the answer", async () => {
      /*
       * The load-bearing test of the update path. The caller writes the body,
       * so a userId in it is a claim made by exactly the party the guard exists
       * to doubt: "this row is mine, so pointing it at my webhook is fine". The
       * database says otherwise, and the database is what decides whose pages
       * select the row.
       */
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
      ] as never);
      stubs.methodFindOneById.get("userWebhookId")!.mockResolvedValue(
        methodRow({
          ownerUserId: ADMIN_USER_ID,
          methodId: ADMIN_METHOD_ID,
        }) as never,
      );

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: {
              userId: ADMIN_USER_ID,
              userWebhookId: ADMIN_METHOD_ID,
            },
          }),
        ),
      ).rejects.toThrow(
        "The Webhook notification method referenced by this rule belongs to a different user.",
      );
    });

    test("the database's answer is authoritative in BOTH directions, so the guard is not merely refusing every mismatched body", async () => {
      /*
       * The converse of the test above, and the one that proves the mechanism
       * rather than the outcome. Here the row really IS the caller's own and
       * the body lies in the other direction, naming the victim. A guard that
       * compared the body's userId against the method's owner would refuse this
       * legitimate self-edit; one that re-reads the row allows it.
       */
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: ADMIN_USER_ID }),
      ] as never);
      stubs.methodFindOneById.get("userWebhookId")!.mockResolvedValue(
        methodRow({
          ownerUserId: ADMIN_USER_ID,
          methodId: ADMIN_METHOD_ID,
        }) as never,
      );

      const result: OnUpdate<UserNotificationRule> =
        await ruleService().onBeforeUpdate(
          updatePayload({
            patch: {
              userId: VICTIM_USER_ID,
              userWebhookId: ADMIN_METHOD_ID,
            },
          }),
        );

      expect(result.carryForward.affectedRules).toHaveLength(1);
    });

    test("an admin repointing a victim's rule at the VICTIM's own method is allowed - this is the repair the phase exists for", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
      ] as never);
      stubs.methodFindOneById.get("userSmsId")!.mockResolvedValue(
        methodRow({
          ownerUserId: VICTIM_USER_ID,
          methodId: VICTIM_METHOD_ID,
        }) as never,
      );

      const result: OnUpdate<UserNotificationRule> =
        await ruleService().onBeforeUpdate(
          updatePayload({ patch: { userSmsId: VICTIM_METHOD_ID } }),
        );

      expect(result.updateBy.data).toEqual({ userSmsId: VICTIM_METHOD_ID });
    });

    test("the relation slot is checked on update as well as the FK column", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
      ] as never);
      stubs.methodFindOneById.get("userTelegramId")!.mockResolvedValue(
        methodRow({
          ownerUserId: ADMIN_USER_ID,
          methodId: ADMIN_METHOD_ID,
        }) as never,
      );

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: {
              userTelegram: { _id: ADMIN_METHOD_ID.toString() },
            },
          }),
        ),
      ).rejects.toThrow(
        "The Telegram notification method referenced by this rule belongs to a different user.",
      );
    });

    test("the affected rows are read with root props, so a caller who cannot see a row cannot edit it unchecked", async () => {
      /*
       * Scoping this read to the caller's READ permission would be the subtlest
       * possible hole: a caller who cannot read the row gets an empty result,
       * the validation loop has nothing to iterate, and the write sails through
       * unvalidated. Read permission and write permission are different lists,
       * and it is the write one this hook answers for.
       *
       * Note the division of labour with the test below: root props remove the
       * caller's VISIBILITY from the answer, and the query narrowing removes
       * their lack of ENTITLEMENT from it. Neither substitutes for the other.
       */
      await ruleService().onBeforeUpdate(
        updatePayload({ patch: { userEmailId: VICTIM_METHOD_ID } }),
      );

      const findByArgs: {
        query: Record<string, unknown>;
        props: { isRoot: boolean; ignoreHooks: boolean };
      } = stubs.ruleFindBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        props: { isRoot: boolean; ignoreHooks: boolean };
      };

      expect(findByArgs.props.isRoot).toBe(true);
      expect(findByArgs.query["_id"]).toBe(RULE_ID.toString());
    });

    test("every distinct owner in a bulk update is validated, not just the first", async () => {
      /*
       * A query that matches rules belonging to two people is one request that
       * changes two people's paging. Validating only the first row would make
       * "match my own rule plus yours" a one-line bypass.
       */
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
        persistedRule({
          id: SECOND_RULE_ID,
          _id: SECOND_RULE_ID.toString(),
          userId: STRANGER_USER_ID,
        }),
      ] as never);
      stubs.methodFindOneById.get("userCallId")!.mockResolvedValue(
        methodRow({
          ownerUserId: VICTIM_USER_ID,
          methodId: VICTIM_METHOD_ID,
        }) as never,
      );

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({ patch: { userCallId: VICTIM_METHOD_ID } }),
        ),
      ).rejects.toThrow(
        "The Call notification method referenced by this rule belongs to a different user.",
      );
    });

    test("a patch carrying both spellings of one method column is refused when they disagree", async () => {
      /*
       * KNOWN FAILURE, and the same bypass as its create-path twin above - see
       * the long note there for the ORM precedence that makes the unvalidated
       * spelling the one that is written.
       *
       * It is repeated here because update is the verb an admin actually uses
       * to "repair" a colleague's rules, and because the update path reaches
       * the same precedence by a different road: an Entity (many-to-one)
       * column does not take DatabaseService's save() branch - only
       * EntityArray columns do - so this goes through repository.update(),
       * where UpdateQueryBuilder.createUpdateExpression maps both keys onto
       * the one shared ColumnMetadata, dedupes them, and computes the value
       * with that same relation-first getEntityValue.
       */
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
      ] as never);
      stubs.methodFindOneById
        .get("userWebhookId")!
        .mockImplementation(
          (findBy: { id: ObjectID }): Promise<Record<string, unknown>> => {
            return Promise.resolve(
              methodRow({
                ownerUserId:
                  findBy.id.toString() === ADMIN_METHOD_ID.toString()
                    ? ADMIN_USER_ID
                    : VICTIM_USER_ID,
                methodId: findBy.id,
              }),
            );
          },
        );

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: {
              userWebhookId: VICTIM_METHOD_ID,
              userWebhook: { _id: ADMIN_METHOD_ID.toString() },
            },
          }),
        ),
      ).rejects.toThrow(
        "The Webhook notification method referenced by this rule belongs to a different user.",
      );
    });

    test("an actor-less update is validated too - the guard is not gated on there being a user to blame", async () => {
      /*
       * The audit half of this phase legitimately gives up when there is no
       * actor to name, and it would be an easy mistake to give up on the
       * SECURITY half in the same breath. An API key repointing somebody's rule
       * at a foreign method is the same hijack with a less attributable caller,
       * which makes it worse rather than exempt.
       */
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
      ] as never);
      stubs.methodFindOneById.get("userWebhookId")!.mockResolvedValue(
        methodRow({
          ownerUserId: ADMIN_USER_ID,
          methodId: ADMIN_METHOD_ID,
        }) as never,
      );

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: { userWebhookId: ADMIN_METHOD_ID },
            props: { tenantId: PROJECT_ID },
          }),
        ),
      ).rejects.toThrow(
        "The Webhook notification method referenced by this rule belongs to a different user.",
      );
    });

    test("an update that names no method at all does no ownership lookups", async () => {
      await ruleService().onBeforeUpdate(
        updatePayload({ patch: { notifyAfterMinutes: 15 } }),
      );

      for (const channel of CHANNELS) {
        expect(
          stubs.methodFindOneById.get(channel.idColumn),
        ).not.toHaveBeenCalled();
      }
    });
  });

  /*
   * ------------------------------------------------------------------
   * The OWNERSHIP column has the same two spellings as every method column,
   * and it is the more dangerous of the two to get wrong: a method read from
   * the wrong spelling sends a page to the wrong address, while an owner read
   * from the wrong spelling means every check in this file - the roster check,
   * the method-ownership check, the audit line - was answered about a person
   * the row does not belong to.
   * ------------------------------------------------------------------
   */
  describe("the rule's owner may be spelled once, not twice", () => {
    test("an owner named ONLY in the user relation is the owner the roster check is asked about", async () => {
      /*
       * THE BYPASS THIS CLOSES, in one request.
       *
       * `userId` and `user` are two decorated members over one join column.
       * The guard used to resolve the owner as `data.userId || props.userId`
       * and never look at the relation, so a payload that spells the owner
       * ONLY as `user: { _id: <stranger> }` left the scalar empty, fell
       * through to the ACTOR, and was validated as an ordinary self-write -
       * no roster check, and the method check run against the wrong person -
       * while TypeORM wrote the relation's id and the row belonged to the
       * stranger.
       */
      stubs.teamMemberFindOneBy.mockResolvedValue(null as never);

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            columns: {
              user: { _id: STRANGER_USER_ID.toString() },
              userEmailId: VICTIM_METHOD_ID,
            },
          }),
        ),
      ).rejects.toThrow(
        `Cannot create a notification rule for user ${STRANGER_USER_ID.toString()} because they are not a member of this project.`,
      );
    });

    test("an owner named only in the relation is also the owner R3 compares methods against", async () => {
      /*
       * The other half of the same bypass. With the owner resolved from the
       * actor rather than from the relation, "userId = the victim, email = my
       * own" reads as a perfectly ordinary self-write and the anti-hijack
       * check has nothing to object to.
       */
      stubs.methodFindOneById.get("userEmailId")!.mockResolvedValue(
        methodRow({
          ownerUserId: ADMIN_USER_ID,
          methodId: ADMIN_METHOD_ID,
        }) as never,
      );

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            columns: {
              user: { _id: VICTIM_USER_ID.toString() },
              userEmailId: ADMIN_METHOD_ID,
            },
          }),
        ),
      ).rejects.toThrow(
        "The Email notification method referenced by this rule belongs to a different user.",
      );
    });

    test("a hydrated User entity in the relation slot is read the same way as a bare _id", async () => {
      /*
       * DatabaseService.sanitizeCreateOrUpdate turns the relation slot into a
       * real model instance before the write, so the guard must not be reading
       * a plain-object shape only. ObjectID lives on `id`; `_id` is the string
       * beneath it, and resolveReferenceId has to find the owner through
       * either.
       */
      const owner: User = new User();
      owner.id = STRANGER_USER_ID;

      stubs.teamMemberFindOneBy.mockResolvedValue(null as never);

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            columns: {
              user: owner,
              userEmailId: VICTIM_METHOD_ID,
            },
          }),
        ),
      ).rejects.toThrow(
        `Cannot create a notification rule for user ${STRANGER_USER_ID.toString()} because they are not a member of this project.`,
      );
    });

    test("two spellings naming two different users are refused rather than silently reconciled", async () => {
      /*
       * Neither half of the guard can catch this on its own: the scalar names
       * a roster member whose own method is being pointed at, so the roster
       * check and the method check both pass on the value they were shown.
       * Which user the row ends up belonging to would be decided by a TypeORM
       * precedence rule that no reader of this codebase should have to know
       * and that an upgrade is free to change - so the contradiction is
       * refused in its own right, and the correctness of the guards behind it
       * never rests on our reading of that rule.
       */
      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: VICTIM_USER_ID,
            columns: {
              user: { _id: STRANGER_USER_ID.toString() },
              userEmailId: VICTIM_METHOD_ID,
            },
          }),
        ),
      ).rejects.toThrow(
        `This notification rule names two different users: userId says ${VICTIM_USER_ID.toString()} and user says ${STRANGER_USER_ID.toString()}.`,
      );

      // And it is refused before anything is looked up on the strength of it.
      expect(stubs.teamMemberFindOneBy).not.toHaveBeenCalled();
      expect(stubs.methodFindOneById.get("userEmailId")).not.toHaveBeenCalled();
    });

    test("the same user in both spellings is not a contradiction and is accepted", async () => {
      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: VICTIM_USER_ID,
            columns: {
              user: { _id: VICTIM_USER_ID.toString() },
              userEmailId: VICTIM_METHOD_ID,
            },
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("on create the user relation is folded into userId, so the ORM is left with nothing to choose between", async () => {
      /*
       * The same discipline as CreatePermission.checkCreateOwnership, which
       * validates the `user` relation identically to the `userId` scalar and
       * then clears it. What CreatePermission cannot do is cover the
       * administrator - it returns early for a caller holding a real role
       * permission in the model's create list, which is exactly the caller
       * this phase introduced - so the fold has to happen here as well, before
       * anything downstream has to re-derive which of two sources of truth
       * actually reaches the database.
       */
      const payload: CreateBy<UserNotificationRule> = createPayload({
        props: projectAdminProps(),
        columns: {
          user: { _id: VICTIM_USER_ID.toString() },
          userEmailId: VICTIM_METHOD_ID,
        },
      });

      await ruleService().onBeforeCreate(payload);

      expect(payload.data.userId?.toString()).toBe(VICTIM_USER_ID.toString());
      expect(payload.data.user).toBeUndefined();
    });

    test("a relation slot carrying no id is the NULL the ORM would write, and the scalar stops being credited", async () => {
      /*
       * `user: {}` is an object, so TypeORM prefers it over the scalar and
       * writes NULL into the join column. A guard that kept reading the scalar
       * would validate the whole row against a user who does not own it - here
       * it would happily accept the victim's email address onto a row that
       * lands unowned. Folding reproduces the ORM's answer, the owner falls
       * back to the actor, and the method check sees the mismatch for what it
       * is.
       */
      const payload: CreateBy<UserNotificationRule> = createPayload({
        ownerUserId: VICTIM_USER_ID,
        columns: {
          user: {},
          userEmailId: VICTIM_METHOD_ID,
        },
      });

      await expect(ruleService().onBeforeCreate(payload)).rejects.toThrow(
        "The Email notification method referenced by this rule belongs to a different user.",
      );

      expect(payload.data.userId).toBeUndefined();
    });

    test("root writes are reduced too - an ambiguous row is ambiguous whoever wrote it", async () => {
      /*
       * The reduction is a statement about the payload, not a permission
       * decision, so it sits in front of the root short-circuit that exempts
       * internal writes from R1 and R3. No seeder sends both spellings; if one
       * ever starts, it should find out here rather than in the delivery log.
       */
      const payload: CreateBy<UserNotificationRule> = createPayload({
        props: { isRoot: true },
        columns: {
          user: { _id: VICTIM_USER_ID.toString() },
          userEmailId: VICTIM_METHOD_ID,
        },
      });

      await ruleService().onBeforeCreate(payload);

      expect(payload.data.userId?.toString()).toBe(VICTIM_USER_ID.toString());
      expect(payload.data.user).toBeUndefined();
      // ...and still without paying for the guards root is exempt from.
      expect(stubs.teamMemberFindOneBy).not.toHaveBeenCalled();
      expect(stubs.methodFindOneById.get("userEmailId")).not.toHaveBeenCalled();
    });
  });

  /*
   * ------------------------------------------------------------------
   * One column, one spelling - the ambiguity that made R3 bypassable is
   * refused on the way in and folded away where it safely can be.
   * ------------------------------------------------------------------
   */
  describe("a method column may be spelled once, not twice", () => {
    test("two spellings naming two different methods are refused even when BOTH belong to the rule's owner", async () => {
      /*
       * The ownership check cannot catch this one - both ids pass it - and that
       * is exactly why the ambiguity has to be refused in its own right. Which
       * address the rule ends up delivering to would otherwise be decided by a
       * TypeORM precedence rule (relation slot first, scalar as fallback) that
       * no reader of this codebase should have to know and that a TypeORM
       * upgrade is free to change.
       */
      stubs.methodFindOneById
        .get("userEmailId")!
        .mockImplementation(
          (findBy: { id: ObjectID }): Promise<Record<string, unknown>> => {
            return Promise.resolve(
              methodRow({
                ownerUserId: VICTIM_USER_ID,
                methodId: findBy.id,
              }),
            );
          },
        );

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: VICTIM_USER_ID,
            columns: {
              userEmailId: VICTIM_METHOD_ID,
              userEmail: { _id: ADMIN_METHOD_ID.toString() },
            },
          }),
        ),
      ).rejects.toThrow(
        "This notification rule names two different Email notification methods",
      );
    });

    test("the refusal names WHICH spelling carried the offending id", async () => {
      /*
       * Both spellings are one column, so "your Email method belongs to
       * somebody else" is unactionable to a caller looking at a payload whose
       * `userEmailId` is perfectly correct. Naming the slot is the difference
       * between a message that ends the investigation and one that starts it.
       */
      stubs.methodFindOneById
        .get("userEmailId")!
        .mockImplementation(
          (findBy: { id: ObjectID }): Promise<Record<string, unknown>> => {
            return Promise.resolve(
              methodRow({
                ownerUserId:
                  findBy.id.toString() === ADMIN_METHOD_ID.toString()
                    ? ADMIN_USER_ID
                    : VICTIM_USER_ID,
                methodId: findBy.id,
              }),
            );
          },
        );

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: VICTIM_USER_ID,
            columns: {
              userEmailId: VICTIM_METHOD_ID,
              userEmail: { _id: ADMIN_METHOD_ID.toString() },
            },
          }),
        ),
      ).rejects.toThrow("The offending value was sent in userEmail.");
    });

    test("the same method in both spellings is not ambiguous and is accepted", async () => {
      const payload: CreateBy<UserNotificationRule> = createPayload({
        ownerUserId: VICTIM_USER_ID,
        columns: {
          userEmailId: VICTIM_METHOD_ID,
          userEmail: { _id: VICTIM_METHOD_ID.toString() },
        },
      });

      await expect(
        ruleService().onBeforeCreate(payload),
      ).resolves.toBeDefined();
    });

    test("on create the relation slot is folded into the FK column, so the ORM is left with nothing to choose between", async () => {
      /*
       * The same discipline as CreatePermission.checkCreateOwnership, which
       * validates the `user` relation identically to the `userId` scalar and
       * then clears it. Checking both spellings closes the hijack; clearing one
       * of them is what stops a future reader having to re-derive which of two
       * agreeing sources of truth actually reaches the database.
       */
      const payload: CreateBy<UserNotificationRule> = createPayload({
        ownerUserId: VICTIM_USER_ID,
        columns: { userEmail: { _id: VICTIM_METHOD_ID.toString() } },
      });

      await ruleService().onBeforeCreate(payload);

      expect(payload.data.userEmailId?.toString()).toBe(
        VICTIM_METHOD_ID.toString(),
      );
      expect(payload.data.userEmail).toBeUndefined();
    });

    test("a relation slot carrying no id is the NULL the ORM would write, and a rule left with no method at all is refused", async () => {
      /*
       * `userEmail: {}` is an object, so TypeORM prefers it over the scalar and
       * writes NULL into the join column. Reading only the scalar would report
       * a rule that names an email; the row that lands names nothing and pages
       * nobody. Folding reproduces the ORM's answer, and the create invariant
       * then sees the rule for what it is.
       */
      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            ownerUserId: VICTIM_USER_ID,
            columns: {
              userEmailId: VICTIM_METHOD_ID,
              userEmail: {},
            },
          }),
        ),
      ).rejects.toThrow(
        "Call, SMS, WhatsApp, Telegram, Webhook, Email, or Push notification is required",
      );
    });

    test("on update the relation slot is NOT folded into the FK column - that would launder a denied column write", async () => {
      /*
       * The two spellings do not have the same access control on update: the
       * relation members are `update: []` on UserNotificationRule while the
       * `*Id` members are open to an administrator. Moving a value from the
       * former into the latter would carry it across a permission boundary,
       * past the ColumnPermission check that runs immediately after this hook.
       * On this path ambiguity is answered by refusal instead.
       */
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
      ] as never);

      const payload: UpdateBy<UserNotificationRule> = updatePayload({
        patch: { userTelegram: { _id: VICTIM_METHOD_ID.toString() } },
      });

      await ruleService().onBeforeUpdate(payload);

      const patch: Record<string, unknown> = payload.data as unknown as Record<
        string,
        unknown
      >;

      expect(patch["userTelegram"]).toEqual({
        _id: VICTIM_METHOD_ID.toString(),
      });
      expect(patch["userTelegramId"]).toBeUndefined();
    });

    test("an ambiguous patch is refused on update as well", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
      ] as never);
      stubs.methodFindOneById
        .get("userWebhookId")!
        .mockImplementation(
          (findBy: { id: ObjectID }): Promise<Record<string, unknown>> => {
            return Promise.resolve(
              methodRow({
                ownerUserId: VICTIM_USER_ID,
                methodId: findBy.id,
              }),
            );
          },
        );

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: {
              userWebhookId: VICTIM_METHOD_ID,
              userWebhook: { _id: ADMIN_METHOD_ID.toString() },
            },
          }),
        ),
      ).rejects.toThrow(
        "This notification rule names two different Webhook notification methods",
      );
    });
  });

  /*
   * ------------------------------------------------------------------
   * The guard's row set. DatabaseService runs these hooks BEFORE
   * ModelPermission narrows the query, so the narrowing has to be reproduced
   * here or the guard reasons about rows the caller cannot reach.
   * ------------------------------------------------------------------
   */
  describe("the guard reads only rows the caller is entitled to write", () => {
    test("an ordinary member's guard read is confined to their own rows", async () => {
      /*
       * Permission.CurrentUser is auto-granted to every authenticated caller,
       * so this session holds nothing else that appears in the model's update
       * list. TenantPermission would rewrite their query to `userId = me`; if
       * the hook read the raw query with root props instead, a member could
       * hand it a colleague's rule id and have the guard - and the audit trail
       * behind it - answer about somebody else's row entirely.
       */
      await ruleService().onBeforeUpdate(
        updatePayload({
          patch: { notifyAfterMinutes: 15 },
          query: { _id: RULE_ID.toString() },
        }),
      );

      expect(guardReadQuery(stubs.ruleFindBy)["userId"]).toBe(ADMIN_USER_ID);
    });

    test("a query naming another project is pulled back to the session's own project", async () => {
      await ruleService().onBeforeUpdate(
        updatePayload({
          patch: { notifyAfterMinutes: 15 },
          query: {
            _id: RULE_ID.toString(),
            projectId: OTHER_PROJECT_ID.toString(),
          },
        }),
      );

      expect(guardReadQuery(stubs.ruleFindBy)["projectId"]).toBe(PROJECT_ID);
    });

    test("an administrator is scoped to their project but NOT to their own rows - that is the repair capability", async () => {
      /*
       * The converse test, and the one that proves the narrowing is the
       * permission layer's rather than a blanket lock. A session holding a real
       * ProjectAdmin row is no longer "here purely as some logged-in user", the
       * ownership predicate does not apply to it, and reading a colleague's
       * rules is precisely what this phase exists to allow.
       */
      await ruleService().onBeforeUpdate(
        updatePayload({
          patch: { notifyAfterMinutes: 15 },
          props: projectAdminProps(),
        }),
      );

      const query: Record<string, unknown> = guardReadQuery(stubs.ruleFindBy);

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["userId"]).toBeUndefined();
    });

    test("a root write is not narrowed - it is entitled to every row, and reading fewer than the write touches is the one direction this must never be wrong in", async () => {
      await ruleService().onBeforeUpdate(
        updatePayload({
          patch: { notifyAfterMinutes: 15 },
          props: { isRoot: true, userId: ADMIN_USER_ID },
        }),
      );

      expect(guardReadQuery(stubs.ruleFindBy)).toEqual({
        _id: RULE_ID.toString(),
      });
    });

    test("the same narrowing is applied on the delete path", async () => {
      await ruleService().onBeforeDelete(
        deletePayload({
          query: {
            _id: RULE_ID.toString(),
            projectId: OTHER_PROJECT_ID.toString(),
          },
        }),
      );

      const query: Record<string, unknown> = guardReadQuery(stubs.ruleFindBy);

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["userId"]).toBe(ADMIN_USER_ID);
    });

    test("narrowing does not mutate the caller's query - the permission layer must still see what was actually asked for", async () => {
      const payload: UpdateBy<UserNotificationRule> = updatePayload({
        patch: { notifyAfterMinutes: 15 },
      });

      await ruleService().onBeforeUpdate(payload);

      expect(payload.query).toEqual({ _id: RULE_ID.toString() });
    });
  });

  /*
   * ------------------------------------------------------------------
   * The row-level invariants, which update could break until now.
   * ------------------------------------------------------------------
   */
  describe("update cannot leave a rule in a state create would have refused", () => {
    test("opting a rule out while it still carries a method is refused", async () => {
      /*
       * "Reach me here; also never reach me." Create has always refused it;
       * update reached it in one field, and the resulting row is not merely
       * untidy - the fallback treats an opt-out row as a deliberate choice to
       * stay silent, so this is a rule that suppresses paging while looking
       * like one that delivers it.
       */
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({
          userId: VICTIM_USER_ID,
          userEmailId: VICTIM_METHOD_ID,
        }),
      ] as never);

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({ patch: { isOptOut: true } }),
        ),
      ).rejects.toThrow(
        "An opt-out notification rule cannot have a notification method.",
      );
    });

    test("clearing the last method on a rule that still pages is refused", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({
          userId: VICTIM_USER_ID,
          isOptOut: false,
          userEmailId: VICTIM_METHOD_ID,
        }),
      ] as never);

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({ patch: { userEmailId: null } }),
        ),
      ).rejects.toThrow(
        "Call, SMS, WhatsApp, Telegram, Webhook, Email, or Push notification is required",
      );
    });

    test("clearing the method and opting out in the same patch is coherent and allowed", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({
          userId: VICTIM_USER_ID,
          userEmailId: VICTIM_METHOD_ID,
        }),
      ] as never);

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({ patch: { isOptOut: true, userEmailId: null } }),
        ),
      ).resolves.toBeDefined();
    });

    test("turning opt-out off while naming a method in the same patch is allowed", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID, isOptOut: true }),
      ] as never);

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: { isOptOut: false, userSmsId: VICTIM_METHOD_ID },
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("swapping one method for another leaves the rule coherent", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({
          userId: VICTIM_USER_ID,
          userEmailId: VICTIM_METHOD_ID,
        }),
      ] as never);

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: { userEmailId: null, userSmsId: VICTIM_METHOD_ID },
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("a patch that touches neither opt-out nor any method leaves an already-broken legacy row alone", async () => {
      /*
       * Rows written before these invariants existed are out there. Refusing to
       * let anyone edit the notify delay on one would make it unrepairable
       * through the API that has to repair it, so the check answers for the
       * state the PATCH produces rather than policing the row it lands on.
       */
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID, isOptOut: false }),
      ] as never);

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({ patch: { notifyAfterMinutes: 20 } }),
        ),
      ).resolves.toBeDefined();
    });

    test("the invariant is checked against EVERY affected row, not just the first", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
        persistedRule({
          id: SECOND_RULE_ID,
          _id: SECOND_RULE_ID.toString(),
          userId: VICTIM_USER_ID,
          userEmailId: VICTIM_METHOD_ID,
        }),
      ] as never);

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({ patch: { isOptOut: true } }),
        ),
      ).rejects.toThrow(
        "An opt-out notification rule cannot have a notification method.",
      );
    });
  });

  /*
   * ------------------------------------------------------------------
   * Delete - the most destructive of the three verbs, and the last one to
   * get a guard.
   * ------------------------------------------------------------------
   */
  describe("deleting somebody else's notification rules leaves a record and a warning", () => {
    test("the rows are read BEFORE the delete, with root props, because afterwards there is nothing to read", async () => {
      await ruleService().onBeforeDelete(deletePayload());

      const findByArgs: {
        query: Record<string, unknown>;
        props: { isRoot: boolean; ignoreHooks: boolean };
      } = stubs.ruleFindBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        props: { isRoot: boolean; ignoreHooks: boolean };
      };

      expect(findByArgs.props.isRoot).toBe(true);
      expect(findByArgs.query["_id"]).toBe(RULE_ID.toString());
    });

    test("the snapshot is carried forward, because the audit entry cannot be rebuilt from a row that no longer exists", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
      ] as never);

      const onDelete: OnDelete<UserNotificationRule> =
        await ruleService().onBeforeDelete(deletePayload());

      expect(onDelete.carryForward.deletedRules).toHaveLength(1);
    });

    test("an administrative delete is logged against the actor and the row's PERSISTED owner", async () => {
      await ruleService().onDeleteSuccess(
        {
          deleteBy: deletePayload(),
          carryForward: {
            deletedRules: [persistedRule({ userId: VICTIM_USER_ID })],
          },
        },
        [RULE_ID],
      );

      await flushAsync();

      const trail: Array<AdminChangeLogAttributes> = adminChangeLogAttributes(
        stubs.loggerInfo,
      );

      expect(trail).toHaveLength(1);
      expect(trail[0]!.action).toBe("Delete");
      expect(trail[0]!.actorUserId).toBe(ADMIN_USER_ID.toString());
      expect(trail[0]!.userId).toBe(VICTIM_USER_ID.toString());
      expect(trail[0]!.userNotificationRuleId).toBe(RULE_ID.toString());

      expect(stubs.auditRecordDelete).toHaveBeenCalledTimes(1);

      const auditArgs: { deletedItem: UserNotificationRule; itemId: ObjectID } =
        stubs.auditRecordDelete.mock.calls[0]![0] as {
          deletedItem: UserNotificationRule;
          itemId: ObjectID;
        };

      expect(auditArgs.itemId.toString()).toBe(RULE_ID.toString());
      expect(auditArgs.deletedItem.userId?.toString()).toBe(
        VICTIM_USER_ID.toString(),
      );
    });

    test("the owner is told, and told what it means rather than merely that it happened", async () => {
      /*
       * Deletion is the one action that can leave a responder silently
       * unreachable, so the mail says so. "An administrator changed your rules"
       * is a prompt to go and look; "you may no longer be notified when you are
       * on call" is the consequence, and it is the reason this epic exists.
       */
      await ruleService().onDeleteSuccess(
        {
          deleteBy: deletePayload(),
          carryForward: {
            deletedRules: [persistedRule({ userId: VICTIM_USER_ID })],
          },
        },
        [RULE_ID],
      );

      await flushAsync();

      expect(stubs.sendMail).toHaveBeenCalledTimes(1);

      const mail: {
        toEmail: Email;
        subject: string;
        vars: { message: string };
      } = stubs.sendMail.mock.calls[0]![0] as {
        toEmail: Email;
        subject: string;
        vars: { message: string };
      };

      expect(mail.toEmail.toString()).toBe(VICTIM_EMAIL);
      expect(mail.subject).toContain("deleted");
      expect(mail.vars.message).toContain("no longer be notified");
      expect(mail.vars.message).toContain(ADMIN_EMAIL);
    });

    test("deleting your own rules is neither audited as administrative nor announced", async () => {
      await ruleService().onDeleteSuccess(
        {
          deleteBy: deletePayload(),
          carryForward: {
            deletedRules: [persistedRule({ userId: ADMIN_USER_ID })],
          },
        },
        [RULE_ID],
      );

      await flushAsync();

      expect(stubs.sendMail).not.toHaveBeenCalled();
      expect(stubs.auditRecordDelete).not.toHaveBeenCalled();
      expect(adminChangeLogAttributes(stubs.loggerInfo)).toHaveLength(0);
    });

    test("only rows the delete actually removed are reported", async () => {
      /*
       * The hook reads every row the narrowed query matches; _deleteBy then
       * applies the caller's own skip/limit on top. A warning about a rule that
       * still exists is a false alarm, and false alarms are how the true one
       * gets ignored.
       */
      await ruleService().onDeleteSuccess(
        {
          deleteBy: deletePayload(),
          carryForward: {
            deletedRules: [
              persistedRule({ userId: VICTIM_USER_ID }),
              persistedRule({
                id: SECOND_RULE_ID,
                _id: SECOND_RULE_ID.toString(),
                userId: STRANGER_USER_ID,
              }),
            ],
          },
        },
        [RULE_ID],
      );

      await flushAsync();

      expect(stubs.sendMail).toHaveBeenCalledTimes(1);
      expect(
        (
          stubs.sendMail.mock.calls[0]![0] as { toEmail: Email }
        ).toEmail.toString(),
      ).toBe(VICTIM_EMAIL);
    });

    test("a sweep across several of one person's rules audits each row but mails them once", async () => {
      await ruleService().onDeleteSuccess(
        {
          deleteBy: deletePayload(),
          carryForward: {
            deletedRules: [
              persistedRule({ userId: VICTIM_USER_ID }),
              persistedRule({
                id: SECOND_RULE_ID,
                _id: SECOND_RULE_ID.toString(),
                userId: VICTIM_USER_ID,
              }),
            ],
          },
        },
        [RULE_ID, SECOND_RULE_ID],
      );

      await flushAsync();

      expect(stubs.auditRecordDelete).toHaveBeenCalledTimes(2);
      expect(stubs.sendMail).toHaveBeenCalledTimes(1);
    });

    test("a delete with no actor - a worker, a cascade, a migration - reads nothing and reports nothing", async () => {
      const onDelete: OnDelete<UserNotificationRule> =
        await ruleService().onBeforeDelete(
          deletePayload({ props: { isRoot: true } }),
        );

      await ruleService().onDeleteSuccess(onDelete, [RULE_ID]);

      await flushAsync();

      expect(stubs.ruleFindBy).not.toHaveBeenCalled();
      expect(stubs.sendMail).not.toHaveBeenCalled();
      expect(stubs.auditRecordDelete).not.toHaveBeenCalled();
    });

    test("a mail server that is down cannot fail a delete that already happened", async () => {
      stubs.sendMail.mockRejectedValue(new Error("smtp is down") as never);

      await expect(
        ruleService().onDeleteSuccess(
          {
            deleteBy: deletePayload(),
            carryForward: {
              deletedRules: [persistedRule({ userId: VICTIM_USER_ID })],
            },
          },
          [RULE_ID],
        ),
      ).resolves.toBeDefined();

      await flushAsync();

      expect(stubs.loggerError).toHaveBeenCalled();
    });
  });

  /*
   * ------------------------------------------------------------------
   * R6 - the trail is keyed on the server's actor and the persisted owner.
   * ------------------------------------------------------------------
   */
  describe("R6: audit and notification are keyed on props.userId versus the persisted owner", () => {
    test("creating somebody else's rule is logged against the actor and the row's PERSISTED owner", async () => {
      /*
       * The body lies about ownership in the direction that would flatter the
       * caller - it claims the row is the admin's own, which would make the
       * change unremarkable and unreported. The persisted row says otherwise,
       * and only the persisted row is consulted.
       */
      const payload: CreateBy<UserNotificationRule> = createPayload({
        ownerUserId: ADMIN_USER_ID,
        columns: { userEmailId: VICTIM_METHOD_ID },
      });

      const createdItem: UserNotificationRule = persistedRule({
        userId: VICTIM_USER_ID,
      });

      const returned: UserNotificationRule =
        await ruleService().onCreateSuccess(
          { createBy: payload, carryForward: null },
          createdItem,
        );

      await flushAsync();

      expect(returned).toBe(createdItem);

      const trail: Array<AdminChangeLogAttributes> = adminChangeLogAttributes(
        stubs.loggerInfo,
      );

      expect(trail).toHaveLength(1);
      expect(trail[0]!.actorUserId).toBe(ADMIN_USER_ID.toString());
      expect(trail[0]!.userId).toBe(VICTIM_USER_ID.toString());
      expect(trail[0]!.userNotificationRuleId).toBe(RULE_ID.toString());

      expect(stubs.auditRecordCreate).toHaveBeenCalledTimes(1);

      const auditArgs: {
        createdItem: UserNotificationRule;
        props: DatabaseCommonInteractionProps;
      } = stubs.auditRecordCreate.mock.calls[0]![0] as {
        createdItem: UserNotificationRule;
        props: DatabaseCommonInteractionProps;
      };

      expect(auditArgs.createdItem).toBe(createdItem);
      expect(auditArgs.props.userId?.toString()).toBe(ADMIN_USER_ID.toString());
    });

    test("the owner is emailed, and the mail names the actor by address rather than by display name alone", async () => {
      await ruleService().onCreateSuccess(
        {
          createBy: createPayload({
            ownerUserId: VICTIM_USER_ID,
            columns: { userEmailId: VICTIM_METHOD_ID },
          }),
          carryForward: null,
        },
        persistedRule({ userId: VICTIM_USER_ID }),
      );

      await flushAsync();

      expect(stubs.sendMail).toHaveBeenCalledTimes(1);

      const mail: { toEmail: Email; vars: { message: string } } = stubs.sendMail
        .mock.calls[0]![0] as {
        toEmail: Email;
        vars: { message: string };
      };
      const mailOptions: { userId: ObjectID } = stubs.sendMail.mock
        .calls[0]![1] as { userId: ObjectID };

      // The person whose pages changed is the one told about it.
      expect(mail.toEmail.toString()).toBe(VICTIM_EMAIL);
      expect(mailOptions.userId.toString()).toBe(VICTIM_USER_ID.toString());
      /*
       * Display names are neither unique nor trustworthy - a user can set their
       * own - so "Ada Admin changed your rules" is not something the reader can
       * act on. An address is.
       */
      expect(mail.vars.message).toContain(ADMIN_EMAIL);
    });

    test("a body naming a victim cannot fabricate a report about a row the caller actually owns", async () => {
      /*
       * The inverse forgery: the body claims the row belongs to the victim so
       * that the trail records an administrative change that never happened.
       * An audit line an attacker can author is worse than none, because it
       * reads as evidence.
       */
      await ruleService().onCreateSuccess(
        {
          createBy: createPayload({
            ownerUserId: VICTIM_USER_ID,
            columns: { userEmailId: ADMIN_METHOD_ID },
          }),
          carryForward: null,
        },
        persistedRule({ userId: ADMIN_USER_ID }),
      );

      await flushAsync();

      expect(adminChangeLogAttributes(stubs.loggerInfo)).toHaveLength(0);
      expect(stubs.auditRecordCreate).not.toHaveBeenCalled();
      expect(stubs.sendMail).not.toHaveBeenCalled();
    });

    test("a self-edit is neither audited as administrative nor announced", async () => {
      await ruleService().onUpdateSuccess(
        {
          updateBy: updatePayload({ patch: { notifyAfterMinutes: 5 } }),
          carryForward: {
            affectedRules: [persistedRule({ userId: ADMIN_USER_ID })],
          },
        },
        [RULE_ID],
      );

      await flushAsync();

      expect(stubs.sendMail).not.toHaveBeenCalled();
      expect(stubs.auditRecordUpdate).not.toHaveBeenCalled();
      expect(adminChangeLogAttributes(stubs.loggerInfo)).toHaveLength(0);
    });

    test("a mail server that is down cannot fail a write that already happened", async () => {
      /*
       * By the time any of this runs the row is committed. Surfacing an SMTP
       * failure as a failed write would tell the caller their change did not
       * happen when it did - a worse outcome than a missing warning email.
       */
      stubs.sendMail.mockRejectedValue(new Error("smtp is down") as never);

      const createdItem: UserNotificationRule = persistedRule({
        userId: VICTIM_USER_ID,
      });

      await expect(
        ruleService().onCreateSuccess(
          {
            createBy: createPayload({
              ownerUserId: VICTIM_USER_ID,
              columns: { userEmailId: VICTIM_METHOD_ID },
            }),
            carryForward: null,
          },
          createdItem,
        ),
      ).resolves.toBe(createdItem);

      await flushAsync();

      // ...and it is not swallowed silently either.
      expect(stubs.loggerError).toHaveBeenCalled();
    });

    test("an audit sink that throws cannot fail the write either", async () => {
      stubs.auditRecordCreate.mockRejectedValue(
        new Error("clickhouse unreachable") as never,
      );

      const createdItem: UserNotificationRule = persistedRule({
        userId: VICTIM_USER_ID,
      });

      await expect(
        ruleService().onCreateSuccess(
          {
            createBy: createPayload({
              ownerUserId: VICTIM_USER_ID,
              columns: { userEmailId: VICTIM_METHOD_ID },
            }),
            carryForward: null,
          },
          createdItem,
        ),
      ).resolves.toBe(createdItem);

      await flushAsync();

      /*
       * The dependable half of the trail is the log line, which is written
       * BEFORE the sink is called precisely so that a sink outage cannot erase
       * the record that this happened. Audit-log rows only exist on enterprise
       * builds with audit logging switched on for the project; the log line
       * exists everywhere.
       */
      expect(adminChangeLogAttributes(stubs.loggerInfo)).toHaveLength(1);
    });

    test("updating somebody else's rules audits each row against the owner the DATABASE had", async () => {
      await ruleService().onUpdateSuccess(
        {
          updateBy: updatePayload({ patch: { notifyAfterMinutes: 30 } }),
          carryForward: {
            affectedRules: [
              persistedRule({ userId: VICTIM_USER_ID }),
              persistedRule({
                id: SECOND_RULE_ID,
                _id: SECOND_RULE_ID.toString(),
                userId: VICTIM_USER_ID,
              }),
            ],
          },
        },
        [RULE_ID, SECOND_RULE_ID],
      );

      await flushAsync();

      const trail: Array<AdminChangeLogAttributes> = adminChangeLogAttributes(
        stubs.loggerInfo,
      );

      // One audit entry per ROW: that is what an investigator reconstructs from.
      expect(trail).toHaveLength(2);
      expect(stubs.auditRecordUpdate).toHaveBeenCalledTimes(2);

      const auditArgs: { before: UserNotificationRule; itemId: ObjectID } =
        stubs.auditRecordUpdate.mock.calls[0]![0] as {
          before: UserNotificationRule;
          itemId: ObjectID;
        };

      expect(auditArgs.itemId.toString()).toBe(RULE_ID.toString());
      expect(auditArgs.before.userId?.toString()).toBe(
        VICTIM_USER_ID.toString(),
      );

      /*
       * ...but ONE mail per person. Twenty copies of "an admin changed your
       * rules" is how a warning becomes a filter rule, and then the one that
       * mattered is never read.
       */
      expect(stubs.sendMail).toHaveBeenCalledTimes(1);
      expect(
        (
          stubs.sendMail.mock.calls[0]![0] as { toEmail: Email }
        ).toEmail.toString(),
      ).toBe(VICTIM_EMAIL);
    });

    test("in one update touching two people's rules, each person is told", async () => {
      stubs.userFindOneById.mockImplementation(
        (findBy: { id: ObjectID }): Promise<User> => {
          return Promise.resolve({
            id: findBy.id,
            _id: findBy.id.toString(),
            name: new Name("Somebody"),
            email: new Email(`${findBy.id.toString()}@example.test`),
          } as unknown as User);
        },
      );

      await ruleService().onUpdateSuccess(
        {
          updateBy: updatePayload({ patch: { notifyAfterMinutes: 30 } }),
          carryForward: {
            affectedRules: [
              persistedRule({ userId: VICTIM_USER_ID }),
              persistedRule({
                id: SECOND_RULE_ID,
                _id: SECOND_RULE_ID.toString(),
                userId: STRANGER_USER_ID,
              }),
            ],
          },
        },
        [RULE_ID, SECOND_RULE_ID],
      );

      await flushAsync();

      const recipients: Array<string> = stubs.sendMail.mock.calls.map(
        (call: Array<unknown>): string => {
          return (call[0] as { toEmail: Email }).toEmail.toString();
        },
      );

      expect(recipients.sort()).toEqual(
        [
          `${VICTIM_USER_ID.toString()}@example.test`,
          `${STRANGER_USER_ID.toString()}@example.test`,
        ].sort(),
      );
    });

    test("a write with no actor - a worker, a migration - reports nothing", async () => {
      /*
       * There is no human to name, so there is nothing to say. Reporting
       * "somebody changed your rules" for every internal seeding pass would
       * train people to ignore the message that matters.
       */
      await ruleService().onUpdateSuccess(
        {
          updateBy: updatePayload({
            patch: { notifyAfterMinutes: 5 },
            props: { isRoot: true },
          }),
          carryForward: {
            affectedRules: [persistedRule({ userId: VICTIM_USER_ID })],
          },
        },
        [RULE_ID],
      );

      await flushAsync();

      expect(stubs.sendMail).not.toHaveBeenCalled();
      expect(stubs.auditRecordUpdate).not.toHaveBeenCalled();
    });
  });

  /*
   * ------------------------------------------------------------------
   * Defence in depth - a mismatched row must be inert at delivery time.
   * ------------------------------------------------------------------
   */
  describe("delivery refuses a rule whose method belongs to somebody else", () => {
    function loadedRule(data: {
      ruleOwnerUserId: ObjectID | undefined;
      relationColumn: string;
      methodOwnerUserId: ObjectID | undefined;
    }): UserNotificationRule {
      const rule: UserNotificationRule = new UserNotificationRule();
      rule.id = RULE_ID;
      rule.projectId = PROJECT_ID;

      if (data.ruleOwnerUserId) {
        rule.userId = data.ruleOwnerUserId;
      }

      (rule as unknown as Record<string, unknown>)[data.relationColumn] = {
        _id: VICTIM_METHOD_ID.toString(),
        id: VICTIM_METHOD_ID,
        isVerified: true,
        userId: data.methodOwnerUserId,
      };

      return rule;
    }

    test("a rule whose email method belongs to another user is not delivered at all", async () => {
      stubs.ruleFindOneById.mockResolvedValue(
        loadedRule({
          ruleOwnerUserId: VICTIM_USER_ID,
          relationColumn: "userEmail",
          methodOwnerUserId: ADMIN_USER_ID,
        }) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(stubs.deliver).not.toHaveBeenCalled();
    });

    test("the refusal is recorded on the on-call log, naming the channel, so the page is not silently dropped", async () => {
      /*
       * A dropped page with no trace is the failure this whole epic exists to
       * end. The timeline row is the surface both the responder and the
       * operator read, so the mismatch has to arrive there in words that point
       * at the rule to repair.
       */
      stubs.ruleFindOneById.mockResolvedValue(
        loadedRule({
          ruleOwnerUserId: VICTIM_USER_ID,
          relationColumn: "userWebhook",
          methodOwnerUserId: ADMIN_USER_ID,
        }) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]!.status).toBe(UserNotificationStatus.Error);
      expect(timelineRows[0]!.statusMessage).toContain("Webhook");
      expect(timelineRows[0]!.statusMessage).toContain(
        "belongs to a different user",
      );
      expect(timelineRows[0]!.userId).toBe(VICTIM_USER_ID.toString());
      expect(timelineRows[0]!.userNotificationRuleId).toBe(RULE_ID.toString());
      expect(timelineRows[0]!.userNotificationLogId).toBe(
        ON_CALL_LOG_ID.toString(),
      );
      expect(timelineRows[0]!.isRoot).toBe(true);
    });

    test("one foreign method poisons the whole rule, including the channels that are honest", async () => {
      /*
       * Delivering the untainted channels would let a hijacked row keep working
       * well enough that nobody investigates. The row is not a rule with one
       * bad field; it is a row somebody wrote in order to redirect a page.
       */
      const rule: UserNotificationRule = loadedRule({
        ruleOwnerUserId: VICTIM_USER_ID,
        relationColumn: "userSms",
        methodOwnerUserId: ADMIN_USER_ID,
      });

      (rule as unknown as Record<string, unknown>)["userEmail"] = {
        _id: VICTIM_METHOD_ID.toString(),
        isVerified: true,
        email: new Email(VICTIM_EMAIL),
        userId: VICTIM_USER_ID,
      };

      stubs.ruleFindOneById.mockResolvedValue(rule as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(stubs.deliver).not.toHaveBeenCalled();
      expect(timelineRows[0]!.statusMessage).toContain("SMS");
    });

    test("a rule whose method belongs to its own owner is delivered normally", async () => {
      const rule: UserNotificationRule = loadedRule({
        ruleOwnerUserId: VICTIM_USER_ID,
        relationColumn: "userEmail",
        methodOwnerUserId: VICTIM_USER_ID,
      });

      stubs.ruleFindOneById.mockResolvedValue(rule as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(stubs.deliver).toHaveBeenCalledTimes(1);
      expect(timelineRows).toHaveLength(0);
    });

    test("a method whose owner column was never loaded is NOT read as a mismatch", async () => {
      /*
       * The most dangerous way to get this check wrong. An unselected column
       * arrives as undefined, and treating absence as disagreement would turn
       * the guard into a page-suppression machine for every caller that does
       * not select userId - which is the exact failure mode the guard was added
       * to prevent. Silence means "no evidence of a mismatch", and for a check
       * that can cancel a page that is the only safe default.
       */
      const rule: UserNotificationRule = loadedRule({
        ruleOwnerUserId: VICTIM_USER_ID,
        relationColumn: "userEmail",
        methodOwnerUserId: undefined,
      });

      stubs.ruleFindOneById.mockResolvedValue(rule as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(stubs.deliver).toHaveBeenCalledTimes(1);
      expect(timelineRows).toHaveLength(0);
    });

    test("the rule load asks every method relation for its owner", async () => {
      /*
       * The check above is only as good as the select that feeds it: drop
       * userId from one relation and that channel silently becomes
       * un-checkable, which is indistinguishable from having no guard on it.
       */
      stubs.ruleFindOneById.mockResolvedValue(
        loadedRule({
          ruleOwnerUserId: VICTIM_USER_ID,
          relationColumn: "userEmail",
          methodOwnerUserId: VICTIM_USER_ID,
        }) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      const select: Record<string, Record<string, boolean>> = (
        stubs.ruleFindOneById.mock.calls[0]![0] as {
          select: Record<string, Record<string, boolean>>;
        }
      ).select;

      expect(select["userId"]).toBe(true);

      for (const channel of CHANNELS) {
        expect(select[channel.relationColumn]!["userId"]).toBe(true);
      }
    });

    test("an unowned rule is still delivered - there is no owner to compare a method against", async () => {
      /*
       * Not an endorsement of unowned rows; simply that this guard has nothing
       * to say about them. Inventing a mismatch out of a missing owner would
       * drop pages for rows the create-path guard already refuses to write.
       */
      const rule: UserNotificationRule = loadedRule({
        ruleOwnerUserId: undefined,
        relationColumn: "userEmail",
        methodOwnerUserId: ADMIN_USER_ID,
      });

      stubs.ruleFindOneById.mockResolvedValue(rule as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(stubs.deliver).toHaveBeenCalledTimes(1);
    });

    test("the execution claim is still taken before any of this - the mismatch check must not become a second page", async () => {
      stubs.claim.mockResolvedValue(false as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(stubs.ruleFindOneById).not.toHaveBeenCalled();
      expect(stubs.deliver).not.toHaveBeenCalled();
      expect(timelineRows).toHaveLength(0);
    });
  });
});
