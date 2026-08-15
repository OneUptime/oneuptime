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
import FindOneByID from "../../../Server/Types/Database/FindOneByID";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
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
import Exception from "../../../Types/Exception/Exception";
import Name from "../../../Types/Name";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Phase 3 opens UserNotificationRule to project administrators so that somebody
 * other than the owner can repair a broken on-call configuration. Every test in
 * this file exists because opening that door, done carelessly, converts a
 * support feature into a paging-hijack primitive.
 *
 * The shape of the attack is worth stating once, because it is what every
 * assertion below is really about. A rule row has TWO halves that nothing in
 * the ORM, the permission layer or any screen ever compares:
 *
 *     userId          -> whose on-call pages select this row
 *     user<X>Id       -> which address the page is delivered to
 *
 * Set the first to the victim and the second to something the attacker
 * controls, and the victim's pages arrive at the attacker's endpoint. The
 * victim's rules page still says they are covered. The on-call log still says a
 * page went out. Nothing anywhere reports a problem — the page simply reaches
 * the wrong human, during the incident where it mattered.
 *
 * So the tests here are adversarial by construction. The happy paths are
 * present only to prove the guards do not simply reject everything (a guard
 * that blocks legitimate repair gets deleted by the next engineer, and then
 * there is no guard at all); the weight is on the inputs an attacker would
 * actually send:
 *
 *   R1  a target user id from ANOTHER project, presented by a caller who is a
 *       legitimate administrator of THIS one.
 *   R3  a method FK pointing at somebody else's row — on create, on update, in
 *       the FK slot, in the relation slot, and on all seven channels, because
 *       a guard covering six of seven covers none.
 *   R3  on update specifically: a body that LIES about the rule's owner, to
 *       check that the owner is re-read from the database rather than believed.
 *   R6  an audit trail and an owner notification keyed on the server-resolved
 *       actor versus the PERSISTED owner, never on anything in the body.
 *   D-i-D a row that is already hijacked, to check it is inert at delivery time
 *       even though no write path should have produced it.
 *
 * No database is touched: every service the guards consult is a jest.spyOn
 * stub, and the protected hooks are reached through a structural cast, the same
 * way the neighbouring characterisation tests reach theirs.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "1111aaaa-1111-4111-8111-111111111111",
);
const ADMIN_USER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const VICTIM_USER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OUTSIDER_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const METHOD_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const RULE_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const TEAM_MEMBER_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const LOG_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const TIMELINE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

/*
 * The seven channels, each with the FK column a rule carries it in, the
 * relation slot that is the same write spelled differently, the service the
 * guard must consult, and the word the rejection message has to contain.
 *
 * Driving every ownership test off this one table is the point: the guard's
 * only real failure mode is forgetting a channel, and a table-driven test
 * cannot forget one without the count assertion below noticing.
 */
interface ChannelFixture {
  idColumn: string;
  relationColumn: string;
  label: string;
  service: { findOneById: (...args: Array<never>) => unknown };
  relationProperty: string;
}

const CHANNELS: Array<ChannelFixture> = [
  {
    idColumn: "userEmailId",
    relationColumn: "userEmail",
    label: "Email",
    service: UserEmailService as unknown as ChannelFixture["service"],
    relationProperty: "userEmail",
  },
  {
    idColumn: "userSmsId",
    relationColumn: "userSms",
    label: "SMS",
    service: UserSmsService as unknown as ChannelFixture["service"],
    relationProperty: "userSms",
  },
  {
    idColumn: "userCallId",
    relationColumn: "userCall",
    label: "Call",
    service: UserCallService as unknown as ChannelFixture["service"],
    relationProperty: "userCall",
  },
  {
    idColumn: "userWhatsAppId",
    relationColumn: "userWhatsApp",
    label: "WhatsApp",
    service: UserWhatsAppService as unknown as ChannelFixture["service"],
    relationProperty: "userWhatsApp",
  },
  {
    idColumn: "userTelegramId",
    relationColumn: "userTelegram",
    label: "Telegram",
    service: UserTelegramService as unknown as ChannelFixture["service"],
    relationProperty: "userTelegram",
  },
  {
    idColumn: "userPushId",
    relationColumn: "userPush",
    label: "Push",
    service: UserPushService as unknown as ChannelFixture["service"],
    relationProperty: "userPush",
  },
  {
    idColumn: "userWebhookId",
    relationColumn: "userWebhook",
    label: "Webhook",
    service: UserWebhookService as unknown as ChannelFixture["service"],
    relationProperty: "userWebhook",
  },
];

/*
 * The four hooks under test are protected. They are ordinary prototype methods
 * at runtime; TypeScript just will not let a test name them, so they are
 * reached through a structural cast.
 */
interface RuleServiceHooks {
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
}

function hooks(): RuleServiceHooks {
  return UserNotificationRuleService as unknown as RuleServiceHooks;
}

interface DeliveryHalf {
  deliverNotificationForRule: (
    notificationRuleItem: UserNotificationRule,
    options: ExecuteNotificationRuleOptions,
  ) => Promise<boolean>;
}

function deliveryHalf(): DeliveryHalf {
  return UserNotificationRuleService as unknown as DeliveryHalf;
}

function memberProps(
  overrides: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    userId: ADMIN_USER_ID,
    tenantId: PROJECT_ID,
    ...overrides,
  };
}

/*
 * A create payload as the API hands it to the hook: a real model instance,
 * because the guard reads relation slots as well as FK columns and an object
 * literal would not carry the model's own accessors.
 */
function createBy(data: {
  userId?: ObjectID | undefined;
  props?: DatabaseCommonInteractionProps | undefined;
  channels?: Record<string, unknown> | undefined;
  isOptOut?: boolean | undefined;
}): CreateBy<UserNotificationRule> {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.projectId = PROJECT_ID;
  rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
  rule.notifyAfterMinutes = 0;

  if (data.userId) {
    rule.userId = data.userId;
  }

  if (data.isOptOut) {
    rule.isOptOut = true;
  }

  Object.assign(rule, data.channels || {});

  return {
    data: rule,
    props: data.props || memberProps(),
  };
}

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
 * The owner notification is fire-and-forget by design - recordAdminRuleChange
 * hands it a promise with a .catch and does not wait, so that a slow or broken
 * mail server can never surface as a failed write. That makes "was the mail
 * sent" a question about a promise chain the caller deliberately did not await,
 * so the assertions have to let the microtask queue drain first. A macrotask
 * boundary is the only reliable way to do that.
 */
function flushAsync(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

/* A method row as its service hands it back: id plus the owner column. */
function methodOwnedBy(ownerUserId: ObjectID): unknown {
  return {
    id: METHOD_ID,
    _id: METHOD_ID.toString(),
    userId: ownerUserId,
  };
}

function executeOptions(): ExecuteNotificationRuleOptions {
  return {
    projectId: PROJECT_ID,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: INCIDENT_ID,
    onCallPolicyId: undefined,
    userNotificationLogId: LOG_ID,
  };
}

interface Stubs {
  teamMemberFind: jest.SpyInstance;
  ruleFind: jest.SpyInstance;
  ruleFindOneById: jest.SpyInstance;
  deliver: jest.SpyInstance;
  claim: jest.SpyInstance;
  timelineCreate: jest.SpyInstance;
  mail: jest.SpyInstance;
  userFind: jest.SpyInstance;
  projectFind: jest.SpyInstance;
  dashboardUrl: jest.SpyInstance;
  auditCreate: jest.SpyInstance;
  auditUpdate: jest.SpyInstance;
  methodFinds: Map<string, jest.SpyInstance>;
}

describe("UserNotificationRule administrative write guards", () => {
  let stubs: Stubs;
  let timelineRows: Array<UserOnCallLogTimeline>;

  beforeEach(() => {
    timelineRows = [];

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    const methodFinds: Map<string, jest.SpyInstance> = new Map<
      string,
      jest.SpyInstance
    >();

    for (const channel of CHANNELS) {
      /*
       * Default: every method row belongs to the victim. Tests that care make
       * the one channel they are about disagree, so a guard that consults the
       * WRONG service still fails the test rather than accidentally passing.
       */
      methodFinds.set(
        channel.idColumn,
        jest
          .spyOn(channel.service, "findOneById")
          .mockResolvedValue(methodOwnedBy(VICTIM_USER_ID) as never),
      );
    }

    stubs = {
      teamMemberFind: jest
        .spyOn(TeamMemberService, "findOneBy")
        .mockResolvedValue({
          id: TEAM_MEMBER_ID,
          _id: TEAM_MEMBER_ID.toString(),
        } as unknown as TeamMember as never),
      ruleFind: jest
        .spyOn(UserNotificationRuleService, "findBy")
        .mockResolvedValue([persistedRule()] as never),
      ruleFindOneById: jest
        .spyOn(UserNotificationRuleService, "findOneById")
        .mockResolvedValue(null as never),
      deliver: jest
        .spyOn(deliveryHalf(), "deliverNotificationForRule")
        .mockResolvedValue(true as never),
      claim: jest
        .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
        .mockResolvedValue(true as never),
      timelineCreate: jest
        .spyOn(UserOnCallLogTimelineService, "create")
        .mockImplementation(
          (
            createByArg: CreateBy<UserOnCallLogTimeline>,
          ): Promise<UserOnCallLogTimeline> => {
            timelineRows.push(createByArg.data);

            return Promise.resolve({
              id: TIMELINE_ID,
            } as unknown as UserOnCallLogTimeline);
          },
        ) as unknown as jest.SpyInstance,
      mail: jest
        .spyOn(MailService, "sendMail")
        .mockResolvedValue(undefined as never),
      userFind: jest
        .spyOn(UserService, "findOneById")
        .mockImplementation(
          (findBy: FindOneByID<User>): Promise<User | null> => {
            const id: ObjectID = findBy.id;

            return Promise.resolve({
              id: id,
              _id: id.toString(),
              name: new Name(
                id.toString() === ADMIN_USER_ID.toString()
                  ? "Ada Admin"
                  : "Vic",
              ),
              email: new Email(
                id.toString() === ADMIN_USER_ID.toString()
                  ? "ada@example.com"
                  : "vic@example.com",
              ),
            } as unknown as User);
          },
        ) as unknown as jest.SpyInstance,
      projectFind: jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
        id: PROJECT_ID,
        name: "Acme",
      } as unknown as Project as never),
      dashboardUrl: jest
        .spyOn(DatabaseConfig, "getDashboardUrl")
        .mockResolvedValue(URL.fromString("https://oneuptime.test") as never),
      auditCreate: jest
        .spyOn(AuditLogService, "recordCreate")
        .mockResolvedValue(undefined as never),
      auditUpdate: jest
        .spyOn(AuditLogService, "recordUpdate")
        .mockResolvedValue(undefined as never),
      methodFinds: methodFinds,
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * ---------------------------------------------------------------------
   * R1 - the target of an on-behalf-of write must be in THIS project.
   * ---------------------------------------------------------------------
   */
  describe("R1 - the rule's owner must be a member of the acting project", () => {
    test("a user id from another project is refused even though the caller is a real admin here", async () => {
      /*
       * The whole attack in one call. The caller genuinely holds an
       * administrative permission on PROJECT_ID, so the permission layer waves
       * them through; the id they name belongs to a user of a project they have
       * nothing to do with. Only a roster check can tell the two apart, and the
       * roster query is what returns nothing here.
       */
      stubs.teamMemberFind.mockResolvedValue(null as never);

      await expect(
        hooks().onBeforeCreate(
          createBy({
            userId: OUTSIDER_USER_ID,
            channels: { userEmailId: METHOD_ID },
          }),
        ),
      ).rejects.toThrow(
        `Cannot create a notification rule for user ${OUTSIDER_USER_ID.toString()} because they are not a member of this project.`,
      );
    });

    test("the roster is queried for the acting tenant, with root props and an accepted invitation", async () => {
      await hooks().onBeforeCreate(
        createBy({
          userId: VICTIM_USER_ID,
          channels: { userEmailId: METHOD_ID },
        }),
      );

      const query: {
        query: {
          userId: ObjectID;
          projectId: ObjectID;
          hasAcceptedInvitation: boolean;
        };
        props: { isRoot: boolean };
      } = stubs.teamMemberFind.mock.calls[0]![0] as {
        query: {
          userId: ObjectID;
          projectId: ObjectID;
          hasAcceptedInvitation: boolean;
        };
        props: { isRoot: boolean };
      };

      expect(query.query.userId.toString()).toBe(VICTIM_USER_ID.toString());
      /*
       * props.tenantId, NOT a projectId out of the body. A body-supplied
       * project is the attacker naming the roster they want to be checked
       * against, which is the same as no check.
       */
      expect(query.query.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(query.query.hasAcceptedInvitation).toBe(true);
      /*
       * isRoot, because the question is about the database's state. Asking it
       * through the caller's own scope would let a caller who cannot READ the
       * roster get "no rows" back and, under any lenient reading, pass.
       */
      expect(query.props.isRoot).toBe(true);
    });

    test("a request with no tenant scope cannot write for another user at all", async () => {
      await expect(
        hooks().onBeforeCreate(
          createBy({
            userId: VICTIM_USER_ID,
            props: memberProps({ tenantId: undefined }),
            channels: { userEmailId: METHOD_ID },
          }),
        ),
      ).rejects.toThrow(
        "A project is required to create a notification rule for another user.",
      );

      expect(stubs.teamMemberFind).not.toHaveBeenCalled();
    });

    test("a tenant id from a DIFFERENT project scopes the roster query to that project, not to the rule's projectId", async () => {
      /*
       * The rule body says projectId = PROJECT_ID while the session is scoped
       * to OTHER_PROJECT_ID. Membership must be judged by the session, so the
       * query has to name OTHER_PROJECT_ID.
       */
      stubs.teamMemberFind.mockResolvedValue(null as never);

      await expect(
        hooks().onBeforeCreate(
          createBy({
            userId: VICTIM_USER_ID,
            props: memberProps({ tenantId: OTHER_PROJECT_ID }),
            channels: { userEmailId: METHOD_ID },
          }),
        ),
      ).rejects.toThrow("are not a member of this project");

      const query: { query: { projectId: ObjectID } } = stubs.teamMemberFind
        .mock.calls[0]![0] as { query: { projectId: ObjectID } };

      expect(query.query.projectId.toString()).toBe(
        OTHER_PROJECT_ID.toString(),
      );
    });

    test("a self-write does not consult the roster - a member configuring themselves is not an admin action", async () => {
      stubs.methodFinds
        .get("userEmailId")!
        .mockResolvedValue(methodOwnedBy(ADMIN_USER_ID) as never);

      await hooks().onBeforeCreate(
        createBy({
          userId: ADMIN_USER_ID,
          channels: { userEmailId: METHOD_ID },
        }),
      );

      expect(stubs.teamMemberFind).not.toHaveBeenCalled();
    });

    test("an omitted ownership column is a self-write, because CreatePermission stamps it after this hook runs", async () => {
      /*
       * Reading data.userId alone here would see `undefined` on every ordinary
       * self-service create - the value is stamped later - and would send every
       * one of them through the on-behalf-of branch.
       */
      stubs.methodFinds
        .get("userEmailId")!
        .mockResolvedValue(methodOwnedBy(ADMIN_USER_ID) as never);

      await hooks().onBeforeCreate(
        createBy({
          channels: { userEmailId: METHOD_ID },
        }),
      );

      expect(stubs.teamMemberFind).not.toHaveBeenCalled();
      /*
       * ...but the method it names is still checked, against the actor as the
       * implied owner.
       */
      expect(stubs.methodFinds.get("userEmailId")).toHaveBeenCalled();
    });

    test("an opt-out row for another user is still roster-checked - it has no method, but it still silences somebody", async () => {
      stubs.teamMemberFind.mockResolvedValue(null as never);

      await expect(
        hooks().onBeforeCreate(
          createBy({
            userId: OUTSIDER_USER_ID,
            isOptOut: true,
          }),
        ),
      ).rejects.toThrow("are not a member of this project");
    });

    test("an actor-less caller writing for a named user is treated as on-behalf-of, not as a self-write", async () => {
      /*
       * An API key has no user identity. If the widened create list ever admits
       * one, "actor equals owner" is trivially false and must NOT be read as
       * "nobody else involved, carry on".
       */
      stubs.teamMemberFind.mockResolvedValue(null as never);

      await expect(
        hooks().onBeforeCreate(
          createBy({
            userId: VICTIM_USER_ID,
            props: { tenantId: PROJECT_ID },
            channels: { userEmailId: METHOD_ID },
          }),
        ),
      ).rejects.toThrow("are not a member of this project");
    });

    test("a rule with neither an owner nor an actor is refused rather than written unowned", async () => {
      await expect(
        hooks().onBeforeCreate(
          createBy({
            props: { tenantId: PROJECT_ID },
            channels: { userEmailId: METHOD_ID },
          }),
        ),
      ).rejects.toThrow("A notification rule must belong to a user.");
    });

    test("root writes skip both guards - internal seeding builds both halves from one userId", async () => {
      await hooks().onBeforeCreate(
        createBy({
          userId: VICTIM_USER_ID,
          props: { isRoot: true },
          channels: { userEmailId: METHOD_ID },
        }),
      );

      expect(stubs.teamMemberFind).not.toHaveBeenCalled();
      expect(stubs.methodFinds.get("userEmailId")).not.toHaveBeenCalled();
    });
  });

  /*
   * ---------------------------------------------------------------------
   * R3 on create - the method a rule names must belong to the rule's owner.
   * ---------------------------------------------------------------------
   */
  describe("R3 on create - method ownership, all seven channels", () => {
    test.each(
      CHANNELS.map((channel: ChannelFixture): [string, ChannelFixture] => {
        return [channel.label, channel];
      }),
    )(
      "%s: a rule for the victim may not point at a method owned by the admin",
      async (_label: string, channel: ChannelFixture) => {
        /*
         * THE hijack. userId names the victim so the victim's pages select the
         * row; the method FK names something the admin controls so the pages
         * arrive there instead.
         */
        stubs.methodFinds
          .get(channel.idColumn)!
          .mockResolvedValue(methodOwnedBy(ADMIN_USER_ID) as never);

        await expect(
          hooks().onBeforeCreate(
            createBy({
              userId: VICTIM_USER_ID,
              channels: { [channel.idColumn]: METHOD_ID },
            }),
          ),
        ).rejects.toThrow(
          `The ${channel.label} notification method referenced by this rule belongs to a different user.`,
        );
      },
    );

    test.each(
      CHANNELS.map((channel: ChannelFixture): [string, ChannelFixture] => {
        return [channel.label, channel];
      }),
    )(
      "%s: the same rule is accepted when the method belongs to the rule's owner",
      async (_label: string, channel: ChannelFixture) => {
        await expect(
          hooks().onBeforeCreate(
            createBy({
              userId: VICTIM_USER_ID,
              channels: { [channel.idColumn]: METHOD_ID },
            }),
          ),
        ).resolves.toBeDefined();

        expect(stubs.methodFinds.get(channel.idColumn)).toHaveBeenCalled();
      },
    );

    test.each(
      CHANNELS.map((channel: ChannelFixture): [string, ChannelFixture] => {
        return [channel.label, channel];
      }),
    )(
      "%s: the relation slot is the same write spelled differently and is caught too",
      async (_label: string, channel: ChannelFixture) => {
        stubs.methodFinds
          .get(channel.idColumn)!
          .mockResolvedValue(methodOwnedBy(ADMIN_USER_ID) as never);

        await expect(
          hooks().onBeforeCreate(
            createBy({
              userId: VICTIM_USER_ID,
              channels: {
                [channel.relationColumn]: { _id: METHOD_ID.toString() },
              },
            }),
          ),
        ).rejects.toThrow(
          `The ${channel.label} notification method referenced by this rule belongs to a different user.`,
        );
      },
    );

    test("the guard covers exactly the seven notification method columns the model has", () => {
      /*
       * The count is the assertion. An eighth channel added to the model
       * without an entry in the guard's table is a channel with no ownership
       * check at all, and the attacker only needs one.
       */
      const covered: Array<string> =
        UserNotificationRuleAdminService.getNotificationMethodIdColumns();

      expect(covered.sort()).toEqual(
        CHANNELS.map((channel: ChannelFixture): string => {
          return channel.idColumn;
        }).sort(),
      );
    });

    test("a method row that does not exist is refused, not ignored", async () => {
      /*
       * "Not found" and "not yours" are the same answer: in both cases the
       * caller named a row they have no business naming. A guard that compares
       * `undefined` against `undefined` opens on exactly the input it exists to
       * reject.
       */
      stubs.methodFinds.get("userEmailId")!.mockResolvedValue(null as never);

      await expect(
        hooks().onBeforeCreate(
          createBy({
            userId: VICTIM_USER_ID,
            channels: { userEmailId: METHOD_ID },
          }),
        ),
      ).rejects.toThrow(
        "The Email notification method referenced by this rule does not exist.",
      );
    });

    test("a method row with no owner at all is refused", async () => {
      stubs.methodFinds
        .get("userEmailId")!
        .mockResolvedValue({ id: METHOD_ID } as never);

      await expect(
        hooks().onBeforeCreate(
          createBy({
            userId: VICTIM_USER_ID,
            channels: { userEmailId: METHOD_ID },
          }),
        ),
      ).rejects.toThrow(
        "The Email notification method referenced by this rule does not exist.",
      );
    });

    test("the mirror hijack is refused too: my own rule may not point at your address", async () => {
      /*
       * userId = me, userEmailId = yours. This does not steal my pages, it
       * COPIES them to you - and it needed no widened permission, so it was
       * writable long before this phase. The guard runs on self-writes for
       * exactly this reason.
       */
      stubs.methodFinds
        .get("userEmailId")!
        .mockResolvedValue(methodOwnedBy(VICTIM_USER_ID) as never);

      await expect(
        hooks().onBeforeCreate(
          createBy({
            userId: ADMIN_USER_ID,
            channels: { userEmailId: METHOD_ID },
          }),
        ),
      ).rejects.toThrow(
        "The Email notification method referenced by this rule belongs to a different user.",
      );
    });

    test("the method's owner is read with root props, so the caller's own scope cannot shape the answer", async () => {
      await hooks().onBeforeCreate(
        createBy({
          userId: VICTIM_USER_ID,
          channels: { userEmailId: METHOD_ID },
        }),
      );

      const call: { id: ObjectID; props: { isRoot: boolean } } =
        stubs.methodFinds.get("userEmailId")!.mock.calls[0]![0] as {
          id: ObjectID;
          props: { isRoot: boolean };
        };

      expect(call.id.toString()).toBe(METHOD_ID.toString());
      expect(call.props.isRoot).toBe(true);
    });

    test("a rule naming several methods is refused when any one of them is foreign", async () => {
      stubs.methodFinds
        .get("userWebhookId")!
        .mockResolvedValue(methodOwnedBy(ADMIN_USER_ID) as never);

      await expect(
        hooks().onBeforeCreate(
          createBy({
            userId: VICTIM_USER_ID,
            channels: {
              userEmailId: METHOD_ID,
              userWebhookId: METHOD_ID,
            },
          }),
        ),
      ).rejects.toThrow("Webhook notification method");
    });
  });

  /*
   * ---------------------------------------------------------------------
   * R3 on update - the owner is re-read from the database, never believed.
   * ---------------------------------------------------------------------
   */
  describe("R3 on update - the rule's owner comes from the database", () => {
    test("a body that claims the rule is the caller's own does not stop the guard", async () => {
      /*
       * The highest-value assertion in this file. The attacker sends
       * `{ userId: <me>, userWebhookId: <my webhook> }` against a row that
       * actually belongs to the victim. Believing the body would make the two
       * halves agree and the guard would pass; re-reading the row makes them
       * disagree and it fails.
       */
      stubs.ruleFind.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
      ] as never);
      stubs.methodFinds
        .get("userWebhookId")!
        .mockResolvedValue(methodOwnedBy(ADMIN_USER_ID) as never);

      await expect(
        hooks().onBeforeUpdate({
          query: { _id: RULE_ID.toString() },
          data: {
            userId: ADMIN_USER_ID,
            userWebhookId: METHOD_ID,
          },
          limit: 1,
          skip: 0,
          props: memberProps(),
        } as unknown as UpdateBy<UserNotificationRule>),
      ).rejects.toThrow(
        "The Webhook notification method referenced by this rule belongs to a different user.",
      );
    });

    test.each(
      CHANNELS.map((channel: ChannelFixture): [string, ChannelFixture] => {
        return [channel.label, channel];
      }),
    )(
      "%s: repointing a victim's rule at the admin's own method is refused",
      async (_label: string, channel: ChannelFixture) => {
        stubs.methodFinds
          .get(channel.idColumn)!
          .mockResolvedValue(methodOwnedBy(ADMIN_USER_ID) as never);

        await expect(
          hooks().onBeforeUpdate({
            query: { _id: RULE_ID.toString() },
            data: { [channel.idColumn]: METHOD_ID },
            limit: 1,
            skip: 0,
            props: memberProps(),
          } as unknown as UpdateBy<UserNotificationRule>),
        ).rejects.toThrow(
          `The ${channel.label} notification method referenced by this rule belongs to a different user.`,
        );
      },
    );

    test("repointing at a method the rule's owner actually owns is allowed - admins must be able to repair", async () => {
      await expect(
        hooks().onBeforeUpdate({
          query: { _id: RULE_ID.toString() },
          data: { userEmailId: METHOD_ID },
          limit: 1,
          skip: 0,
          props: memberProps(),
        } as unknown as UpdateBy<UserNotificationRule>),
      ).resolves.toBeDefined();
    });

    test("the affected rows are read with root props, so a caller who cannot see a row cannot edit it unchecked", async () => {
      await hooks().onBeforeUpdate({
        query: { _id: RULE_ID.toString() },
        data: { userEmailId: METHOD_ID },
        limit: 1,
        skip: 0,
        props: memberProps(),
      } as unknown as UpdateBy<UserNotificationRule>);

      const call: { props: { isRoot: boolean }; select: { userId: boolean } } =
        stubs.ruleFind.mock.calls[0]![0] as {
          props: { isRoot: boolean };
          select: { userId: boolean };
        };

      expect(call.props.isRoot).toBe(true);
      expect(call.select.userId).toBe(true);
    });

    test("every distinct owner in a multi-row update is validated, not just the first", async () => {
      /*
       * One request, two rules, two different owners, one method. The method
       * can belong to at most one of them, so the update must be refused - and
       * it is only refused if the loop keeps going past the row that passed.
       */
      stubs.ruleFind.mockResolvedValue([
        persistedRule({ userId: VICTIM_USER_ID }),
        persistedRule({ userId: OUTSIDER_USER_ID }),
      ] as never);

      await expect(
        hooks().onBeforeUpdate({
          query: { ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT },
          data: { userEmailId: METHOD_ID },
          limit: 10,
          skip: 0,
          props: memberProps(),
        } as unknown as UpdateBy<UserNotificationRule>),
      ).rejects.toThrow("belongs to a different user");
    });

    test("an update naming no method at all skips the ownership lookups entirely", async () => {
      await hooks().onBeforeUpdate({
        query: { _id: RULE_ID.toString() },
        data: { notifyAfterMinutes: 5 },
        limit: 1,
        skip: 0,
        props: memberProps(),
      } as unknown as UpdateBy<UserNotificationRule>);

      for (const channel of CHANNELS) {
        expect(stubs.methodFinds.get(channel.idColumn)).not.toHaveBeenCalled();
      }
    });
  });

  /*
   * ---------------------------------------------------------------------
   * R6 - audit and notify, keyed on the server's actor vs the persisted owner.
   * ---------------------------------------------------------------------
   */
  describe("R6 - audit trail and owner notification", () => {
    test("creating a rule for somebody else audits the actor against the PERSISTED owner", async () => {
      const onCreate: OnCreate<UserNotificationRule> = {
        createBy: createBy({ userId: VICTIM_USER_ID }),
        carryForward: null,
      };

      await hooks().onCreateSuccess(
        onCreate,
        persistedRule({ userId: VICTIM_USER_ID }),
      );

      expect(stubs.auditCreate).toHaveBeenCalledTimes(1);

      const logged: string = (
        logger.info as unknown as jest.SpyInstance
      ).mock.calls
        .flat()
        .map((value: unknown): string => {
          return JSON.stringify(value);
        })
        .join(" ");

      expect(logged).toContain(VICTIM_USER_ID.toString());
      expect(logged).toContain(ADMIN_USER_ID.toString());
    });

    test("the owner compared against is the row that was written, not the one the body asked for", async () => {
      /*
       * The body claims the rule is the admin's own; the row that was actually
       * persisted belongs to the victim. Reading the body would conclude "self
       * write, nothing to report" and the victim would never hear that their
       * paging changed - which is precisely the notification an attacker most
       * wants suppressed.
       */
      const onCreate: OnCreate<UserNotificationRule> = {
        createBy: createBy({ userId: ADMIN_USER_ID }),
        carryForward: null,
      };

      await hooks().onCreateSuccess(
        onCreate,
        persistedRule({ userId: VICTIM_USER_ID }),
      );

      await flushAsync();

      expect(stubs.auditCreate).toHaveBeenCalledTimes(1);
      expect(stubs.mail).toHaveBeenCalledTimes(1);
    });

    test("the owner is emailed, and the mail names the actor by address", async () => {
      await hooks().onCreateSuccess(
        {
          createBy: createBy({ userId: VICTIM_USER_ID }),
          carryForward: null,
        },
        persistedRule({ userId: VICTIM_USER_ID }),
      );

      await flushAsync();

      expect(stubs.mail).toHaveBeenCalledTimes(1);

      const mailArg: { toEmail: Email; vars: { message: string } } = stubs.mail
        .mock.calls[0]![0] as { toEmail: Email; vars: { message: string } };

      expect(mailArg.toEmail.toString()).toBe("vic@example.com");
      /*
       * Display names are user-editable and not unique, so "Ada changed your
       * rules" is not something the reader can act on. An address is.
       */
      expect(mailArg.vars.message).toContain("ada@example.com");
    });

    test("a self-write is neither audited nor announced", async () => {
      await hooks().onCreateSuccess(
        {
          createBy: createBy({ userId: ADMIN_USER_ID }),
          carryForward: null,
        },
        persistedRule({ userId: ADMIN_USER_ID }),
      );

      await flushAsync();

      expect(stubs.auditCreate).not.toHaveBeenCalled();
      expect(stubs.mail).not.toHaveBeenCalled();
    });

    test("a failing mail cannot break the write - the row is already committed", async () => {
      stubs.mail.mockRejectedValue(new Error("smtp is down") as never);

      await expect(
        hooks().onCreateSuccess(
          {
            createBy: createBy({ userId: VICTIM_USER_ID }),
            carryForward: null,
          },
          persistedRule({ userId: VICTIM_USER_ID }),
        ),
      ).resolves.toBeDefined();

      await flushAsync();
    });

    test("a failing audit sink cannot break the write either", async () => {
      stubs.auditCreate.mockRejectedValue(
        new Error("clickhouse is down") as never,
      );

      await expect(
        hooks().onCreateSuccess(
          {
            createBy: createBy({ userId: VICTIM_USER_ID }),
            carryForward: null,
          },
          persistedRule({ userId: VICTIM_USER_ID }),
        ),
      ).resolves.toBeDefined();
    });

    test("updating somebody else's rule audits it against the owner as the DATABASE had it", async () => {
      const before: UserNotificationRule = persistedRule({
        userId: VICTIM_USER_ID,
      });

      await hooks().onUpdateSuccess(
        {
          updateBy: {
            query: { _id: RULE_ID.toString() },
            data: { userId: ADMIN_USER_ID, notifyAfterMinutes: 5 },
            limit: 1,
            skip: 0,
            props: memberProps(),
          },
          carryForward: { affectedRules: [before] },
        } as unknown as OnUpdate<UserNotificationRule>,
        [RULE_ID],
      );

      expect(stubs.auditUpdate).toHaveBeenCalledTimes(1);

      const auditArg: { before: UserNotificationRule; itemId: ObjectID } = stubs
        .auditUpdate.mock.calls[0]![0] as {
        before: UserNotificationRule;
        itemId: ObjectID;
      };

      expect(auditArg.before.userId?.toString()).toBe(
        VICTIM_USER_ID.toString(),
      );
      expect(auditArg.itemId.toString()).toBe(RULE_ID.toString());
    });

    test("one request touching many of one person's rules audits each but mails them once", async () => {
      /*
       * Twenty copies of "an admin changed your rules" is how a warning becomes
       * a filter rule. The audit stays per row because that is what an
       * investigator reconstructs from.
       */
      await hooks().onUpdateSuccess(
        {
          updateBy: {
            query: { userId: VICTIM_USER_ID },
            data: { notifyAfterMinutes: 5 },
            limit: 10,
            skip: 0,
            props: memberProps(),
          },
          carryForward: {
            affectedRules: [
              persistedRule({ userId: VICTIM_USER_ID }),
              persistedRule({ userId: VICTIM_USER_ID }),
              persistedRule({ userId: VICTIM_USER_ID }),
            ],
          },
        } as unknown as OnUpdate<UserNotificationRule>,
        [RULE_ID],
      );

      await flushAsync();

      expect(stubs.auditUpdate).toHaveBeenCalledTimes(3);
      expect(stubs.mail).toHaveBeenCalledTimes(1);
    });

    test("two owners in one update each get their own notification", async () => {
      await hooks().onUpdateSuccess(
        {
          updateBy: {
            query: {},
            data: { notifyAfterMinutes: 5 },
            limit: 10,
            skip: 0,
            props: memberProps(),
          },
          carryForward: {
            affectedRules: [
              persistedRule({ userId: VICTIM_USER_ID }),
              persistedRule({ userId: OUTSIDER_USER_ID }),
            ],
          },
        } as unknown as OnUpdate<UserNotificationRule>,
        [RULE_ID],
      );

      await flushAsync();

      expect(stubs.mail).toHaveBeenCalledTimes(2);
    });

    test("a rule the actor owns is skipped even when other rules in the same update are not", async () => {
      await hooks().onUpdateSuccess(
        {
          updateBy: {
            query: {},
            data: { notifyAfterMinutes: 5 },
            limit: 10,
            skip: 0,
            props: memberProps(),
          },
          carryForward: {
            affectedRules: [
              persistedRule({ userId: ADMIN_USER_ID }),
              persistedRule({ userId: VICTIM_USER_ID }),
            ],
          },
        } as unknown as OnUpdate<UserNotificationRule>,
        [RULE_ID],
      );

      await flushAsync();

      expect(stubs.auditUpdate).toHaveBeenCalledTimes(1);
      expect(stubs.mail).toHaveBeenCalledTimes(1);
    });

    test("an actor-less write (root, internal jobs) reports nothing", async () => {
      await hooks().onUpdateSuccess(
        {
          updateBy: {
            query: {},
            data: { notifyAfterMinutes: 5 },
            limit: 10,
            skip: 0,
            props: { isRoot: true },
          },
          carryForward: {
            affectedRules: [persistedRule({ userId: VICTIM_USER_ID })],
          },
        } as unknown as OnUpdate<UserNotificationRule>,
        [RULE_ID],
      );

      await flushAsync();

      expect(stubs.auditUpdate).not.toHaveBeenCalled();
      expect(stubs.mail).not.toHaveBeenCalled();
    });
  });

  /*
   * ---------------------------------------------------------------------
   * Defence in depth - a hijacked row is inert at delivery time.
   * ---------------------------------------------------------------------
   */
  describe("delivery refuses a rule whose method belongs to somebody else", () => {
    test("the rule load asks every method relation for its owner", async () => {
      stubs.ruleFindOneById.mockResolvedValue(
        persistedRule({ userId: VICTIM_USER_ID }) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      const select: Record<string, { userId?: boolean }> = (
        stubs.ruleFindOneById.mock.calls[0]![0] as {
          select: Record<string, { userId?: boolean }>;
        }
      ).select;

      for (const channel of CHANNELS) {
        expect(select[channel.relationProperty]?.userId).toBe(true);
      }
    });

    test.each(
      CHANNELS.map((channel: ChannelFixture): [string, ChannelFixture] => {
        return [channel.label, channel];
      }),
    )(
      "%s: a rule whose method belongs to another user sends nothing",
      async (_label: string, channel: ChannelFixture) => {
        stubs.ruleFindOneById.mockResolvedValue(
          persistedRule({
            userId: VICTIM_USER_ID,
            [channel.relationProperty]: {
              id: METHOD_ID,
              userId: ADMIN_USER_ID,
            },
          } as Partial<UserNotificationRule>) as never,
        );

        await UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        );

        expect(stubs.deliver).not.toHaveBeenCalled();

        expect(timelineRows).toHaveLength(1);
        expect(timelineRows[0]!.status).toBe(UserNotificationStatus.Error);
        expect(timelineRows[0]!.statusMessage).toContain(channel.label);
        expect(timelineRows[0]!.statusMessage).toContain(
          "belongs to a different user",
        );
        /*
         * The timeline row is stamped with the RULE's owner - the person whose
         * page was refused - so it appears on the log they will be looking at.
         */
        expect(timelineRows[0]!.userId?.toString()).toBe(
          VICTIM_USER_ID.toString(),
        );
      },
    );

    test("one foreign method poisons the whole rule, including its honest channels", async () => {
      /*
       * A row with a foreign FK on it is not a row with one bad field; it is a
       * row somebody wrote to redirect a page. Delivering its other channels
       * would let it keep working well enough to escape notice.
       */
      stubs.ruleFindOneById.mockResolvedValue(
        persistedRule({
          userId: VICTIM_USER_ID,
          userEmail: { id: METHOD_ID, userId: VICTIM_USER_ID },
          userWebhook: { id: METHOD_ID, userId: ADMIN_USER_ID },
        } as unknown as Partial<UserNotificationRule>) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(stubs.deliver).not.toHaveBeenCalled();
      expect(timelineRows[0]!.statusMessage).toContain("Webhook");
    });

    test("a rule whose methods all belong to its owner is delivered normally", async () => {
      stubs.ruleFindOneById.mockResolvedValue(
        persistedRule({
          userId: VICTIM_USER_ID,
          userEmail: { id: METHOD_ID, userId: VICTIM_USER_ID },
        } as unknown as Partial<UserNotificationRule>) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(stubs.deliver).toHaveBeenCalledTimes(1);
      expect(timelineRows).toHaveLength(0);
    });

    test("an unloaded owner column is NOT read as a mismatch - unknown must never drop a page", async () => {
      /*
       * The single most dangerous way to get this check wrong. `undefined`
       * means the column was not selected, not that it disagrees; treating the
       * two the same would turn a security guard into a page-dropping machine
       * on every caller that does not select userId - the exact failure this
       * whole epic exists to eliminate.
       */
      stubs.ruleFindOneById.mockResolvedValue(
        persistedRule({
          userId: VICTIM_USER_ID,
          userEmail: { id: METHOD_ID },
        } as unknown as Partial<UserNotificationRule>) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(stubs.deliver).toHaveBeenCalledTimes(1);
      expect(timelineRows).toHaveLength(0);
    });

    test("a rule with no owner at all is still delivered - there is nothing to compare it against", async () => {
      stubs.ruleFindOneById.mockResolvedValue(
        persistedRule({
          userId: undefined,
          userEmail: { id: METHOD_ID, userId: ADMIN_USER_ID },
        } as unknown as Partial<UserNotificationRule>) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        executeOptions(),
      );

      expect(stubs.deliver).toHaveBeenCalledTimes(1);
    });

    test("the claim is still taken first, and a missing rule still throws", async () => {
      stubs.ruleFindOneById.mockResolvedValue(null as never);

      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(
          RULE_ID,
          executeOptions(),
        ),
      ).rejects.toThrow(Exception);

      expect(stubs.claim).toHaveBeenCalledTimes(1);
    });
  });
});
