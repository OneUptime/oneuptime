import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { getTableColumn } from "../../../Types/Database/TableColumn";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import {
  NO_NOTIFICATION_REPEAT,
  REPEAT_EVERY_MINUTES_OPTIONS,
} from "../../../Types/NotificationRule/NotificationRepeat";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";

/*
 * Which rules may repeat until acknowledged, and with which intervals.
 *
 * A push sent again every few minutes is the point of the option; a phone
 * call or a text sent again every minute costs the project money and a phone
 * number its reputation, and an opt-out row pages nobody at all. So a rule
 * that repeats must page a push device - when it is created, and after every
 * update, which can move a repeating rule off its device as easily as it can
 * turn repeating on.
 *
 * And only an interval the On-Call Rules page offers is stored. The worker
 * reads anything else as "do not repeat", so a typo would be accepted without
 * complaint and the responder who asked for a phone that keeps ringing would
 * get one push.
 *
 * Driven through the rule service's own hooks, with the reads they make
 * answered as the neighbouring guard tests answer them (AdminRuleEditGuards):
 * the project directory, the method rows, and the rule rows an update writes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "bbbb1111-1111-4111-8111-111111111111",
);
const OWNER_USER_ID: ObjectID = new ObjectID(
  "bbbb2222-2222-4222-8222-222222222222",
);
const ADMIN_USER_ID: ObjectID = new ObjectID(
  "bbbb3333-3333-4333-8333-333333333333",
);
const RULE_ID: ObjectID = new ObjectID("bbbb4444-4444-4444-8444-444444444444");
const SECOND_RULE_ID: ObjectID = new ObjectID(
  "bbbb5555-5555-4555-8555-555555555555",
);
const PUSH_ID: ObjectID = new ObjectID("bbbb6666-6666-4666-8666-666666666666");
const OTHER_PUSH_ID: ObjectID = new ObjectID(
  "bbbb7777-7777-4777-8777-777777777777",
);
const METHOD_ID: ObjectID = new ObjectID(
  "bbbb8888-8888-4888-8888-888888888888",
);
const TEAM_MEMBER_ID: ObjectID = new ObjectID(
  "bbbb9999-9999-4999-8999-999999999999",
);

const UNKNOWN_INTERVAL_MESSAGE: string =
  "Repeat every minutes must be one of: 0, 1, 2, 3, 5, 10, 15, 30.";
const PUSH_ONLY_MESSAGE: string =
  "Only push notification rules can repeat until acknowledged.";

// Every interval a rule can be stored with, "do not repeat" included.
const STORABLE_INTERVALS: Array<number> = [
  NO_NOTIFICATION_REPEAT,
  ...REPEAT_EVERY_MINUTES_OPTIONS,
];

// Values an API caller can send that are not intervals the page offers.
const UNKNOWN_INTERVALS: Array<[string, unknown]> = [
  ["a number as text", "5"],
  ["an interval the page does not offer", 4],
  ["an hour", 60],
  ["a negative interval", -1],
  ["a fraction of a minute", 2.5],
  ["NaN", NaN],
  ["null, which the column cannot hold", null],
  ["a boolean", true],
  ["an object", { minutes: 5 }],
];

interface MethodServiceLike {
  findOneById: (...args: Array<never>) => unknown;
}

interface ChannelFixture {
  idColumn: string;
  relationColumn: string;
  label: string;
  service: MethodServiceLike;
}

// Every channel a rule can page on that is not a push device.
const NOT_PUSH_CHANNELS: Array<ChannelFixture> = [
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
    idColumn: "userSlackId",
    relationColumn: "userSlack",
    label: "Slack",
    service: UserSlackService as unknown as MethodServiceLike,
  },
  {
    idColumn: "userMicrosoftTeamsId",
    relationColumn: "userMicrosoftTeams",
    label: "Microsoft Teams",
    service: UserMicrosoftTeamsService as unknown as MethodServiceLike,
  },
  {
    idColumn: "userWebhookId",
    relationColumn: "userWebhook",
    label: "Webhook",
    service: UserWebhookService as unknown as MethodServiceLike,
  },
];

const ALL_METHOD_SERVICES: Array<MethodServiceLike> = [
  ...NOT_PUSH_CHANNELS.map((channel: ChannelFixture): MethodServiceLike => {
    return channel.service;
  }),
  UserPushService as unknown as MethodServiceLike,
];

/*
 * The hooks under test, reached through a structural cast: they are
 * protected, and ordinary prototype methods at runtime.
 */
interface RuleServiceInternals {
  onBeforeCreate: (
    createBy: CreateBy<UserNotificationRule>,
  ) => Promise<OnCreate<UserNotificationRule>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<UserNotificationRule>,
  ) => Promise<OnUpdate<UserNotificationRule>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<UserNotificationRule>,
  ) => Promise<unknown>;
}

function ruleService(): RuleServiceInternals {
  return UserNotificationRuleService as unknown as RuleServiceInternals;
}

// The responder editing their own rules, as the dashboard's session is.
function ownerProps(): DatabaseCommonInteractionProps {
  return {
    userId: OWNER_USER_ID,
    tenantId: PROJECT_ID,
  };
}

// A project administrator repairing somebody else's paging.
function projectAdminProps(): DatabaseCommonInteractionProps {
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
  };
}

// Internal code: a worker, a seeder, a migration.
function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true };
}

function createPayload(data: {
  columns: Record<string, unknown>;
  props?: DatabaseCommonInteractionProps | undefined;
}): CreateBy<UserNotificationRule> {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule.projectId = PROJECT_ID;
  rule.userId = OWNER_USER_ID;
  rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
  rule.notifyAfterMinutes = 0;

  Object.assign(rule, data.columns);

  return {
    data: rule,
    props: data.props || ownerProps(),
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
    props: data.props || ownerProps(),
    limit: 10,
    skip: 0,
  };
}

/*
 * A rule as the database has it: a plain shape, as rows read back out of
 * Postgres are, rather than a model instance like the payloads above.
 */
function storedRule(
  overrides: Record<string, unknown> = {},
): UserNotificationRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    projectId: PROJECT_ID,
    userId: OWNER_USER_ID,
    notifyAfterMinutes: 0,
    repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
    ...overrides,
  } as unknown as UserNotificationRule;
}

/*
 * A write the hook refuses: refused as bad data (a 400 the caller can act on,
 * not a 500), with exactly this message.
 */
async function expectRefusal(
  write: Promise<unknown>,
  message: string,
): Promise<void> {
  let refusal: unknown = undefined;

  try {
    await write;
  } catch (err) {
    refusal = err;
  }

  expect(refusal).toBeInstanceOf(BadDataException);
  expect((refusal as Error).message).toBe(message);
}

interface Stubs {
  directory: ProjectDirectoryStub;
  ruleFindBy: jest.SpyInstance;
  teamMemberFindOneBy: jest.SpyInstance;
  methodFindOneById: Array<jest.SpyInstance>;
}

describe("UserNotificationRuleService - repeating until acknowledged", () => {
  let stubs: Stubs;

  beforeEach(() => {
    const directory: ProjectDirectoryStub = stubProjectDirectory({});

    /*
     * Every method row in the world belongs to the rule's owner and is in
     * the project: what is under test here is the repeat, not ownership.
     */
    const methodFindOneById: Array<jest.SpyInstance> = ALL_METHOD_SERVICES.map(
      (service: MethodServiceLike): jest.SpyInstance => {
        return jest.spyOn(service, "findOneById").mockResolvedValue({
          id: METHOD_ID,
          _id: METHOD_ID.toString(),
          projectId: PROJECT_ID,
          userId: OWNER_USER_ID,
        } as never);
      },
    );

    stubs = {
      directory: directory,
      ruleFindBy: jest
        .spyOn(UserNotificationRuleService, "findBy")
        .mockResolvedValue([storedRule()] as never),
      teamMemberFindOneBy: jest
        .spyOn(TeamMemberService, "findOneBy")
        .mockResolvedValue({
          id: TEAM_MEMBER_ID,
          _id: TEAM_MEMBER_ID.toString(),
        } as unknown as TeamMember as never),
      methodFindOneById: methodFindOneById,
    };

    /*
     * The read of the rows the caller's update may write, answered as the
     * rule read is: the caller may write every row it returns.
     */
    stubRowsCallerMayWriteLikeFindBy(
      UserNotificationRuleService,
      stubs.ruleFindBy,
    );

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Nothing was read: no method row, no roster, no project record, no rule.
  function expectNothingRead(): void {
    for (const findOneById of stubs.methodFindOneById) {
      expect(findOneById).not.toHaveBeenCalled();
    }

    expect(stubs.teamMemberFindOneBy).not.toHaveBeenCalled();
    expect(stubs.directory.recordLookups).toEqual([]);
    expect(stubs.directory.memberLookups).toEqual([]);
    expect(stubs.ruleFindBy).not.toHaveBeenCalled();
  }

  describe("only an interval the On-Call Rules page offers is stored", () => {
    test("the refusal names every interval it accepts, so an API caller can correct the request", async () => {
      await expectRefusal(
        ruleService().onBeforeCreate(
          createPayload({
            columns: { userPushId: PUSH_ID, repeatEveryMinutes: 4 },
          }),
        ),
        UNKNOWN_INTERVAL_MESSAGE,
      );
    });

    test.each(UNKNOWN_INTERVALS)(
      "creating a push rule that repeats at %s is refused before anything is read",
      async (_label: string, repeatEveryMinutes: unknown) => {
        await expectRefusal(
          ruleService().onBeforeCreate(
            createPayload({
              columns: {
                userPushId: PUSH_ID,
                repeatEveryMinutes: repeatEveryMinutes,
              },
            }),
          ),
          UNKNOWN_INTERVAL_MESSAGE,
        );

        expectNothingRead();
      },
    );

    test.each(UNKNOWN_INTERVALS)(
      "changing a rule to repeat at %s is refused before any row is read",
      async (_label: string, repeatEveryMinutes: unknown) => {
        await expectRefusal(
          ruleService().onBeforeUpdate(
            updatePayload({
              patch: { repeatEveryMinutes: repeatEveryMinutes },
            }),
          ),
          UNKNOWN_INTERVAL_MESSAGE,
        );

        expectNothingRead();
      },
    );

    test("internal writes are held to the same intervals", async () => {
      await expectRefusal(
        ruleService().onBeforeCreate(
          createPayload({
            columns: { userPushId: PUSH_ID, repeatEveryMinutes: 45 },
            props: rootProps(),
          }),
        ),
        UNKNOWN_INTERVAL_MESSAGE,
      );

      await expectRefusal(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: { repeatEveryMinutes: 45 },
            props: rootProps(),
          }),
        ),
        UNKNOWN_INTERVAL_MESSAGE,
      );
    });

    test("an unknown interval is reported as such even on a rule that could not repeat anyway", async () => {
      /*
       * The value check comes first, so the caller is told what is wrong
       * with the value they sent rather than about the rule it landed on.
       */
      await expectRefusal(
        ruleService().onBeforeCreate(
          createPayload({
            columns: { userSmsId: METHOD_ID, repeatEveryMinutes: "15" },
          }),
        ),
        UNKNOWN_INTERVAL_MESSAGE,
      );
    });

    test("a known push notification level does not excuse an unknown interval", async () => {
      await expectRefusal(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: {
              pushNotificationLevel: PushNotificationLevel.Standard,
              repeatEveryMinutes: 7,
            },
          }),
        ),
        UNKNOWN_INTERVAL_MESSAGE,
      );
    });
  });

  describe("on create, only a push rule repeats", () => {
    test.each(
      STORABLE_INTERVALS.map((minutes: number): [number] => {
        return [minutes];
      }),
    )(
      "a push rule repeating every %s minutes is accepted, and stored as sent",
      async (repeatEveryMinutes: number) => {
        const result: OnCreate<UserNotificationRule> =
          await ruleService().onBeforeCreate(
            createPayload({
              columns: {
                userPushId: PUSH_ID,
                repeatEveryMinutes: repeatEveryMinutes,
              },
            }),
          );

        expect(result.createBy.data.repeatEveryMinutes).toBe(
          repeatEveryMinutes,
        );
        expect(result.createBy.data.userPushId?.toString()).toBe(
          PUSH_ID.toString(),
        );
      },
    );

    test("a rule that leaves the interval out is accepted, and the column's default does not repeat", async () => {
      const payload: CreateBy<UserNotificationRule> = createPayload({
        columns: { userSmsId: METHOD_ID },
      });

      await expect(
        ruleService().onBeforeCreate(payload),
      ).resolves.toBeDefined();

      expect(payload.data.repeatEveryMinutes).toBeUndefined();
      expect(
        getTableColumn(new UserNotificationRule(), "repeatEveryMinutes")
          .defaultValue,
      ).toBe(NO_NOTIFICATION_REPEAT);
    });

    test("a push device named through the relation is a push rule too", async () => {
      const result: OnCreate<UserNotificationRule> =
        await ruleService().onBeforeCreate(
          createPayload({
            columns: {
              userPush: { _id: PUSH_ID.toString() },
              repeatEveryMinutes: 5,
            },
          }),
        );

      expect(result.createBy.data.userPushId?.toString()).toBe(
        PUSH_ID.toString(),
      );
      expect(result.createBy.data.repeatEveryMinutes).toBe(5);
    });

    for (const channel of NOT_PUSH_CHANNELS) {
      test(`a rule paging through ${channel.label} cannot repeat, at any interval`, async () => {
        for (const repeatEveryMinutes of REPEAT_EVERY_MINUTES_OPTIONS) {
          await expectRefusal(
            ruleService().onBeforeCreate(
              createPayload({
                columns: {
                  [channel.idColumn]: METHOD_ID,
                  repeatEveryMinutes: repeatEveryMinutes,
                },
              }),
            ),
            PUSH_ONLY_MESSAGE,
          );
        }
      });

      test(`a rule naming its ${channel.label} method through the relation cannot repeat either`, async () => {
        await expectRefusal(
          ruleService().onBeforeCreate(
            createPayload({
              columns: {
                [channel.relationColumn]: { _id: METHOD_ID.toString() },
                repeatEveryMinutes: 1,
              },
            }),
          ),
          PUSH_ONLY_MESSAGE,
        );
      });

      test(`a rule paging through ${channel.label} that does not repeat is accepted, as every rule was before`, async () => {
        await expect(
          ruleService().onBeforeCreate(
            createPayload({
              columns: {
                [channel.idColumn]: METHOD_ID,
                repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
              },
            }),
          ),
        ).resolves.toBeDefined();

        await expect(
          ruleService().onBeforeCreate(
            createPayload({
              columns: { [channel.idColumn]: METHOD_ID },
            }),
          ),
        ).resolves.toBeDefined();
      });
    }

    test("an opt-out row cannot repeat - it pages nobody", async () => {
      await expectRefusal(
        ruleService().onBeforeCreate(
          createPayload({
            columns: { isOptOut: true, repeatEveryMinutes: 5 },
          }),
        ),
        PUSH_ONLY_MESSAGE,
      );

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            columns: {
              isOptOut: true,
              repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
            },
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("a rule with no method at all is told it needs one, before anything about repeating", async () => {
      await expectRefusal(
        ruleService().onBeforeCreate(
          createPayload({ columns: { repeatEveryMinutes: 5 } }),
        ),
        "Call, SMS, WhatsApp, Telegram, Slack, Microsoft Teams, Webhook, Custom Channel, Email, or Push notification is required",
      );
    });

    test("a push relation that carries no id names no device, so the rule beside it cannot repeat", async () => {
      /*
       * `userPush: {}` is the NULL the ORM would write. Read as "has a push
       * device", it would let the SMS rule it rides on text every minute.
       */
      await expectRefusal(
        ruleService().onBeforeCreate(
          createPayload({
            columns: {
              userSmsId: METHOD_ID,
              userPush: {},
              repeatEveryMinutes: 5,
            },
          }),
        ),
        PUSH_ONLY_MESSAGE,
      );
    });

    test("internal writes cannot make a rule other than a push rule repeat either", async () => {
      await expectRefusal(
        ruleService().onBeforeCreate(
          createPayload({
            columns: { userCallId: METHOD_ID, repeatEveryMinutes: 1 },
            props: rootProps(),
          }),
        ),
        PUSH_ONLY_MESSAGE,
      );

      await expect(
        ruleService().onBeforeCreate(
          createPayload({
            columns: { userPushId: PUSH_ID, repeatEveryMinutes: 1 },
            props: rootProps(),
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("an administrator may make a colleague's push rule repeat", async () => {
      const result: OnCreate<UserNotificationRule> =
        await ruleService().onBeforeCreate(
          createPayload({
            columns: { userPushId: PUSH_ID, repeatEveryMinutes: 2 },
            props: projectAdminProps(),
          }),
        );

      expect(result.createBy.data.repeatEveryMinutes).toBe(2);
      // The colleague's roster membership was checked, as for any such write.
      expect(stubs.teamMemberFindOneBy).toHaveBeenCalled();
    });
  });

  describe("on update, a rule that repeats must still page a push device", () => {
    test.each([...REPEAT_EVERY_MINUTES_OPTIONS])(
      "turning repeating on (every %i min) for a push rule is accepted, and the patch goes through as sent",
      async (repeatEveryMinutes: number) => {
        stubs.ruleFindBy.mockResolvedValue([
          storedRule({ userPushId: PUSH_ID }),
        ] as never);

        const result: OnUpdate<UserNotificationRule> =
          await ruleService().onBeforeUpdate(
            updatePayload({
              patch: { repeatEveryMinutes: repeatEveryMinutes },
            }),
          );

        expect(result.updateBy.data).toEqual({
          repeatEveryMinutes: repeatEveryMinutes,
        });
      },
    );

    test.each(
      NOT_PUSH_CHANNELS.map(
        (channel: ChannelFixture): [string, ChannelFixture] => {
          return [channel.label, channel];
        },
      ),
    )(
      "turning repeating on for a rule paging through %s is refused, at any interval",
      async (_label: string, channel: ChannelFixture) => {
        stubs.ruleFindBy.mockResolvedValue([
          storedRule({ [channel.idColumn]: METHOD_ID }),
        ] as never);

        for (const repeatEveryMinutes of REPEAT_EVERY_MINUTES_OPTIONS) {
          await expectRefusal(
            ruleService().onBeforeUpdate(
              updatePayload({
                patch: { repeatEveryMinutes: repeatEveryMinutes },
              }),
            ),
            PUSH_ONLY_MESSAGE,
          );
        }
      },
    );

    test("turning repeating on for an opt-out row is refused", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ isOptOut: true }),
      ] as never);

      await expectRefusal(
        ruleService().onBeforeUpdate(
          updatePayload({ patch: { repeatEveryMinutes: 3 } }),
        ),
        PUSH_ONLY_MESSAGE,
      );
    });

    test("turning repeating off is always accepted, whatever the rule pages", async () => {
      for (const row of [
        storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 5 }),
        storedRule({ userSmsId: METHOD_ID }),
        storedRule({ isOptOut: true }),
        // A row that repeats without a push device, written before the check.
        storedRule({ userCallId: METHOD_ID, repeatEveryMinutes: 1 }),
      ]) {
        stubs.ruleFindBy.mockResolvedValue([row] as never);

        await expect(
          ruleService().onBeforeUpdate(
            updatePayload({
              patch: { repeatEveryMinutes: NO_NOTIFICATION_REPEAT },
            }),
          ),
        ).resolves.toBeDefined();
      }
    });

    test("an internal write turning repeating off reads no rows - there is nothing to check", async () => {
      await ruleService().onBeforeUpdate(
        updatePayload({
          patch: { repeatEveryMinutes: NO_NOTIFICATION_REPEAT },
          props: rootProps(),
        }),
      );

      expect(stubs.ruleFindBy).not.toHaveBeenCalled();
    });

    test("an internal write turning repeating on reads the rows, and is refused on one that is not a push rule", async () => {
      /*
       * Whether a rule pages a phone is a fact about the row, not the patch,
       * so even a write from internal code - which skips the ownership checks
       * - has the rows read for this one.
       */
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userSmsId: METHOD_ID }),
      ] as never);

      await expectRefusal(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: { repeatEveryMinutes: 10 },
            props: rootProps(),
          }),
        ),
        PUSH_ONLY_MESSAGE,
      );

      expect(stubs.ruleFindBy).toHaveBeenCalledTimes(1);
    });

    test("moving a repeating push rule to SMS is refused - it would text the responder every few minutes", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 5 }),
      ] as never);

      await expectRefusal(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: { userPushId: null, userSmsId: METHOD_ID },
          }),
        ),
        PUSH_ONLY_MESSAGE,
      );
    });

    test("moving a repeating push rule to a call is refused for an internal write too", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 1 }),
      ] as never);

      await expectRefusal(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: { userPushId: null, userCallId: METHOD_ID },
            props: rootProps(),
          }),
        ),
        PUSH_ONLY_MESSAGE,
      );
    });

    test("moving a repeating push rule to SMS while turning repeating off is accepted", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 5 }),
      ] as never);

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: {
              userPushId: null,
              userSmsId: METHOD_ID,
              repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
            },
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("moving a repeating rule to another push device is accepted", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 5 }),
      ] as never);

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({ patch: { userPushId: OTHER_PUSH_ID } }),
        ),
      ).resolves.toBeDefined();
    });

    test("moving an SMS rule to a push device and turning repeating on in one patch is accepted", async () => {
      // The device the patch names is the one that counts, not the stored SMS.
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userSmsId: METHOD_ID }),
      ] as never);

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: {
              userSmsId: null,
              userPushId: PUSH_ID,
              repeatEveryMinutes: 15,
            },
          }),
        ),
      ).resolves.toBeDefined();
    });

    describe("the push device after the patch, in either spelling", () => {
      /*
       * A patch can name the device through the relation as well as the id
       * column, and the relation is what the ORM writes when both are there
       * (getNotificationMethodIdsAfterPatch reads every method that way). A
       * check that read only the id column would let a relation clear the
       * device of a rule that goes on repeating - on whatever it pages next.
       */
      test("a device named through the relation turns repeating on for a rule moving to push", async () => {
        stubs.ruleFindBy.mockResolvedValue([
          storedRule({ userSmsId: METHOD_ID }),
        ] as never);

        await expect(
          ruleService().onBeforeUpdate(
            updatePayload({
              patch: {
                userSmsId: null,
                userPush: { _id: PUSH_ID.toString() },
                repeatEveryMinutes: 5,
              },
            }),
          ),
        ).resolves.toBeDefined();
      });

      test("a device named through the relation also keeps an internal write's repeat", async () => {
        stubs.ruleFindBy.mockResolvedValue([
          storedRule({ userSmsId: METHOD_ID }),
        ] as never);

        await expect(
          ruleService().onBeforeUpdate(
            updatePayload({
              patch: {
                userSmsId: null,
                userPush: { _id: PUSH_ID.toString() },
                repeatEveryMinutes: 1,
              },
              props: rootProps(),
            }),
          ),
        ).resolves.toBeDefined();
      });

      test("clearing the device through the relation on a repeating push rule moving to SMS is refused", async () => {
        stubs.ruleFindBy.mockResolvedValue([
          storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 5 }),
        ] as never);

        await expectRefusal(
          ruleService().onBeforeUpdate(
            updatePayload({
              patch: { userPush: null, userSmsId: METHOD_ID },
            }),
          ),
          PUSH_ONLY_MESSAGE,
        );
      });

      test("clearing the device through the relation is refused when the rule keeps another method", async () => {
        // A row paging a phone and an email, from before the method was one.
        stubs.ruleFindBy.mockResolvedValue([
          storedRule({
            userPushId: PUSH_ID,
            userEmailId: METHOD_ID,
            repeatEveryMinutes: 5,
          }),
        ] as never);

        await expectRefusal(
          ruleService().onBeforeUpdate(
            updatePayload({ patch: { userPush: null } }),
          ),
          PUSH_ONLY_MESSAGE,
        );
      });

      test("clearing the only device through the relation is refused - the rule would page nobody", async () => {
        stubs.ruleFindBy.mockResolvedValue([
          storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 5 }),
        ] as never);

        await expectRefusal(
          ruleService().onBeforeUpdate(
            updatePayload({ patch: { userPush: null } }),
          ),
          "Call, SMS, WhatsApp, Telegram, Slack, Microsoft Teams, Webhook, Custom Channel, Email, or Push notification is required",
        );
      });

      test("clearing the device through the relation is accepted when the same patch turns repeating off", async () => {
        stubs.ruleFindBy.mockResolvedValue([
          storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 5 }),
        ] as never);

        await expect(
          ruleService().onBeforeUpdate(
            updatePayload({
              patch: {
                userPush: null,
                userSmsId: METHOD_ID,
                repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
              },
            }),
          ),
        ).resolves.toBeDefined();
      });

      test("a relation that carries no id clears the device, whatever the id column beside it says", async () => {
        /*
         * `userPush: {}` is the NULL the ORM would write, and the relation is
         * what it writes - so the device the id column names is not the one
         * the row ends up with.
         */
        stubs.ruleFindBy.mockResolvedValue([
          storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 5 }),
        ] as never);

        await expectRefusal(
          ruleService().onBeforeUpdate(
            updatePayload({
              patch: {
                userPush: {},
                userPushId: PUSH_ID,
                userSmsId: METHOD_ID,
              },
              props: rootProps(),
            }),
          ),
          PUSH_ONLY_MESSAGE,
        );
      });

      test("a relation clearing the device wins over an id column that still names one", async () => {
        stubs.ruleFindBy.mockResolvedValue([
          storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 5 }),
        ] as never);

        await expectRefusal(
          ruleService().onBeforeUpdate(
            updatePayload({
              patch: {
                userPush: null,
                userPushId: PUSH_ID,
                userSmsId: METHOD_ID,
              },
              props: rootProps(),
            }),
          ),
          PUSH_ONLY_MESSAGE,
        );
      });

      test("an id column left undefined is not written, so the stored device still counts", async () => {
        /*
         * A patch built from a model, or by spreading optional fields, carries
         * `userPushId: undefined`. The ORM writes nothing for it, so the rule
         * keeps its phone - and may repeat on it.
         */
        stubs.ruleFindBy.mockResolvedValue([
          storedRule({ userPushId: PUSH_ID }),
        ] as never);

        await expect(
          ruleService().onBeforeUpdate(
            updatePayload({
              patch: { repeatEveryMinutes: 5, userPushId: undefined },
            }),
          ),
        ).resolves.toBeDefined();
      });

      test("clearing the device through the id column, moving to SMS, is refused unless repeating goes off with it", async () => {
        stubs.ruleFindBy.mockResolvedValue([
          storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 10 }),
        ] as never);

        await expectRefusal(
          ruleService().onBeforeUpdate(
            updatePayload({
              patch: { userPushId: null, userSmsId: METHOD_ID },
            }),
          ),
          PUSH_ONLY_MESSAGE,
        );

        await expect(
          ruleService().onBeforeUpdate(
            updatePayload({
              patch: {
                userPushId: null,
                userSmsId: METHOD_ID,
                repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
              },
            }),
          ),
        ).resolves.toBeDefined();
      });
    });

    test("opting a repeating push rule out must turn repeating off in the same patch", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 5 }),
      ] as never);

      await expectRefusal(
        ruleService().onBeforeUpdate(
          updatePayload({ patch: { userPushId: null, isOptOut: true } }),
        ),
        PUSH_ONLY_MESSAGE,
      );

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: {
              userPushId: null,
              isOptOut: true,
              repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
            },
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("an update across several rules is checked against every one of them", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userPushId: PUSH_ID }),
        storedRule({
          id: SECOND_RULE_ID,
          _id: SECOND_RULE_ID.toString(),
          userSmsId: METHOD_ID,
        }),
      ] as never);

      await expectRefusal(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: { repeatEveryMinutes: 5 },
            query: { userId: OWNER_USER_ID.toString() },
          }),
        ),
        PUSH_ONLY_MESSAGE,
      );
    });

    test("an update across several push rules is accepted", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userPushId: PUSH_ID }),
        storedRule({
          id: SECOND_RULE_ID,
          _id: SECOND_RULE_ID.toString(),
          userPushId: OTHER_PUSH_ID,
        }),
      ] as never);

      const result: OnUpdate<UserNotificationRule> =
        await ruleService().onBeforeUpdate(
          updatePayload({
            patch: { repeatEveryMinutes: 5 },
            query: { userId: OWNER_USER_ID.toString() },
          }),
        );

      expect(result.carryForward.affectedRules).toHaveLength(2);
    });

    test("a patch about something else leaves a row that already repeats without a push device alone", async () => {
      /*
       * Rows written before the check are out there. Refusing every edit of
       * one would leave it unrepairable through the API that has to repair
       * it, so the check answers for what the patch changes.
       */
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userSmsId: METHOD_ID, repeatEveryMinutes: 5 }),
      ] as never);

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({ patch: { notifyAfterMinutes: 10 } }),
        ),
      ).resolves.toBeDefined();
    });

    test("a repeating push rule's level can still be changed on its own", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 5 }),
      ] as never);

      await expect(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: { pushNotificationLevel: PushNotificationLevel.Standard },
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("an administrator may change how often a colleague's push rule repeats", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 1 }),
      ] as never);

      const result: OnUpdate<UserNotificationRule> =
        await ruleService().onBeforeUpdate(
          updatePayload({
            patch: { repeatEveryMinutes: 30 },
            props: projectAdminProps(),
          }),
        );

      expect(result.updateBy.data).toEqual({ repeatEveryMinutes: 30 });
    });

    test("an administrator cannot make a colleague's SMS rule repeat", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userSmsId: METHOD_ID }),
      ] as never);

      await expectRefusal(
        ruleService().onBeforeUpdate(
          updatePayload({
            patch: { repeatEveryMinutes: 30 },
            props: projectAdminProps(),
          }),
        ),
        PUSH_ONLY_MESSAGE,
      );
    });
  });

  describe("a change to the interval is part of the audited snapshot", () => {
    /*
     * When somebody edits or deletes somebody else's rules, the rows are read
     * first and handed to the audit log as the "before" picture. Without the
     * interval in that read, an administrator who made a responder's phone
     * ring every minute would be recorded as changing it from nothing.
     */
    test("the update hook reads the interval of the rows it is about to change", async () => {
      const readSpy: jest.SpyInstance = jest
        .spyOn(
          ruleService() as unknown as Record<
            string,
            () => Promise<Array<UserNotificationRule>>
          >,
          "findRowsAndHoldUpdateToThem",
        )
        .mockResolvedValue([] as never);

      await ruleService().onBeforeUpdate(
        updatePayload({
          patch: { repeatEveryMinutes: 5 },
          props: projectAdminProps(),
        }),
      );

      expect(readSpy).toHaveBeenCalledTimes(1);

      const select: JSONObject = readSpy.mock.calls[0]![1] as JSONObject;

      expect(select["repeatEveryMinutes"]).toBe(true);
      // And what the check reads beside it: the device the rule pages.
      expect(select["userPushId"]).toBe(true);
      expect(select["pushNotificationLevel"]).toBe(true);
    });

    test("the delete hook reads the interval of the rows it is about to remove", async () => {
      const readSpy: jest.SpyInstance = jest
        .spyOn(
          ruleService() as unknown as Record<
            string,
            () => Promise<Array<UserNotificationRule>>
          >,
          "findRowsAndHoldDeleteToThem",
        )
        .mockResolvedValue([] as never);

      await ruleService().onBeforeDelete({
        query: {
          _id: RULE_ID.toString(),
        } as unknown as DeleteBy<UserNotificationRule>["query"],
        props: projectAdminProps(),
        limit: 10,
        skip: 0,
      });

      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(
        (readSpy.mock.calls[0]![1] as JSONObject)["repeatEveryMinutes"],
      ).toBe(true);
    });

    test("the rows carried forward to the audit hold the interval the database had", async () => {
      stubs.ruleFindBy.mockResolvedValue([
        storedRule({ userPushId: PUSH_ID, repeatEveryMinutes: 15 }),
      ] as never);

      const result: OnUpdate<UserNotificationRule> =
        await ruleService().onBeforeUpdate(
          updatePayload({
            patch: { repeatEveryMinutes: 2 },
            props: projectAdminProps(),
          }),
        );

      const carried: Array<UserNotificationRule> = result.carryForward
        .affectedRules as Array<UserNotificationRule>;

      expect(carried).toHaveLength(1);
      expect(carried[0]!.repeatEveryMinutes).toBe(15);
    });
  });
});
