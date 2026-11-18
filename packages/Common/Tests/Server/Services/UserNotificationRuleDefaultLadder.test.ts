import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationRuleService, {
  NotificationMethodDescriptor,
} from "../../../Server/Services/UserNotificationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../Models/DatabaseModels/Project";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import Model from "../../../Models/DatabaseModels/UserNotificationRule";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONArray } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE PROJECT'S DEFAULT LADDER, AS MEMBERS VERIFY METHODS AND JOIN (#7449).
 *
 * UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod
 * gives a verified method its on-call rules. With no default, every card
 * pages it at once (UserNotificationRuleDefaultCreation pins that). With
 * one (Project.defaultPagingLadder):
 *
 *   - a channel the default names gets a rule at each of its waits, in
 *     every card of the four on-call kinds - push with its sound and
 *     repeat;
 *   - a channel it leaves out gets no on-call rules; the two shift rules
 *     stay;
 *   - a custom channel is never filtered, and the default is not even read
 *     for one;
 *   - nothing is rewritten: a card that has a rule for the method keeps it;
 *   - a default that cannot be read never stops a verification: every card
 *     pages at once, as before.
 *
 * And a member who joins (addDefaultNotificationRuleForUser) has their
 * email go the same way; setting a default (ProjectService) writes no
 * rule of anybody's.
 *
 * Nothing touches Postgres: the severities, the project, the custom
 * channels and the rule service's own reads and writes are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const INCIDENT_SEV_1: ObjectID = new ObjectID(
  "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const INCIDENT_SEV_2: ObjectID = new ObjectID(
  "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const ALERT_SEV_1: ObjectID = new ObjectID(
  "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

const METHOD_ID: ObjectID = new ObjectID(
  "ccccccc1-cccc-4ccc-8ccc-cccccccccccc",
);
const CUSTOM_CHANNEL_ID: ObjectID = new ObjectID(
  "ccccccc9-cccc-4ccc-8ccc-cccccccccccc",
);
const EMAIL_ID: ObjectID = new ObjectID("ddddddd1-dddd-4ddd-8ddd-dddddddddddd");

// Two incident severities and one alert severity: 2 + 1 + 1 + 2 cards.
const CARD_COUNT: number = 6;

const ON_CALL_RULE_TYPES: Array<NotificationRuleType> = [
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  NotificationRuleType.ON_CALL_EXECUTED_ALERT,
  NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
];

const SHIFT_RULE_TYPES: Array<NotificationRuleType> = [
  NotificationRuleType.WHEN_USER_GOES_ON_CALL,
  NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
];

// "Push and SMS at once, then a call after 5 minutes, and again after 15."
const DEFAULT_LADDER: JSONArray = [
  {
    channel: OnCallPageChannel.Push,
    notifyAfterMinutes: 0,
    pushNotificationLevel: PushNotificationLevel.Standard,
    repeatEveryMinutes: 5,
  },
  { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
  { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
  { channel: OnCallPageChannel.Call, notifyAfterMinutes: 15 },
];

let createSpy: jest.SpyInstance;
let findOneBySpy: jest.SpyInstance;
let projectSpy: jest.SpyInstance;
let customChannelsSpy: jest.SpyInstance;

function severity<T extends IncidentSeverity | AlertSeverity>(
  model: T,
  id: ObjectID,
): T {
  model.id = id;
  model._id = id.toString();
  return model;
}

function projectWith(defaultPagingLadder: unknown): Project {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  project.defaultPagingLadder = defaultPagingLadder as JSONArray;
  return project;
}

function createdRules(): Array<Model> {
  return createSpy.mock.calls.map((call: Array<unknown>): Model => {
    return (call[0] as CreateBy<Model>).data;
  });
}

function onCallRules(): Array<Model> {
  return createdRules().filter((rule: Model): boolean => {
    return ON_CALL_RULE_TYPES.includes(rule.ruleType as NotificationRuleType);
  });
}

function shiftRules(): Array<Model> {
  return createdRules().filter((rule: Model): boolean => {
    return SHIFT_RULE_TYPES.includes(rule.ruleType as NotificationRuleType);
  });
}

function waitsOf(rules: Array<Model>): Array<number> {
  return rules
    .map((rule: Model): number => {
      return rule.notifyAfterMinutes as number;
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });
}

function verify(
  notificationMethod: NotificationMethodDescriptor,
): Promise<void> {
  return UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
    {
      projectId: PROJECT_ID,
      userId: USER_ID,
      notificationMethod: notificationMethod,
    },
  );
}

beforeEach(() => {
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue([
      severity(new IncidentSeverity(), INCIDENT_SEV_1),
      severity(new IncidentSeverity(), INCIDENT_SEV_2),
    ] as never);
  jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([severity(new AlertSeverity(), ALERT_SEV_1)] as never);

  // Nothing exists yet, so every candidate rule is created.
  findOneBySpy = jest
    .spyOn(UserNotificationRuleService, "findOneBy")
    .mockResolvedValue(null as never);

  createSpy = jest
    .spyOn(UserNotificationRuleService, "create")
    .mockImplementation((createBy: CreateBy<Model>): Promise<Model> => {
      return Promise.resolve(createBy.data);
    });

  projectSpy = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(projectWith(DEFAULT_LADDER) as never);

  customChannelsSpy = jest
    .spyOn(CustomNotificationChannelService, "getChannelsPagingEveryone")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project with no default ladder", () => {
  test.each([null, undefined, [], "not a ladder", [{ channel: "Fax" }]])(
    "every card pages a newly verified method at once, as always (%p)",
    async (value: unknown) => {
      projectSpy.mockResolvedValue(projectWith(value) as never);

      await verify({ userEmailId: METHOD_ID });

      expect(onCallRules()).toHaveLength(CARD_COUNT);
      expect(waitsOf(onCallRules())).toEqual(Array(CARD_COUNT).fill(0));
      expect(shiftRules()).toHaveLength(2);
    },
  );

  test("the project is read as OneUptime, for its default alone", async () => {
    await verify({ userEmailId: METHOD_ID });

    expect(projectSpy).toHaveBeenCalledTimes(1);
    expect(projectSpy.mock.calls[0]![0]).toEqual({
      id: PROJECT_ID,
      select: { defaultPagingLadder: true },
      props: { isRoot: true },
    });
  });

  test("a project that cannot be read never stops a verification: at once, as before", async () => {
    projectSpy.mockRejectedValue(new Error("Database not connected"));

    await verify({ userSmsId: METHOD_ID });

    expect(onCallRules()).toHaveLength(CARD_COUNT);
    expect(waitsOf(onCallRules())).toEqual(Array(CARD_COUNT).fill(0));
    expect(shiftRules()).toHaveLength(2);
  });
});

describe("a channel the default names", () => {
  test("gets a rule at the default's wait in every card of the four kinds", async () => {
    await verify({ userSmsId: METHOD_ID });

    expect(onCallRules()).toHaveLength(CARD_COUNT);
    expect(waitsOf(onCallRules())).toEqual(Array(CARD_COUNT).fill(0));

    for (const rule of onCallRules()) {
      expect(rule.userSmsId?.toString()).toBe(METHOD_ID.toString());
    }
  });

  test("named at two waits, it gets a rule at each, in every card", async () => {
    await verify({ userCallId: METHOD_ID });

    expect(onCallRules()).toHaveLength(CARD_COUNT * 2);
    expect(waitsOf(onCallRules())).toEqual([
      ...Array(CARD_COUNT).fill(5),
      ...Array(CARD_COUNT).fill(15),
    ]);

    for (const ruleType of ON_CALL_RULE_TYPES) {
      const ofType: Array<Model> = onCallRules().filter(
        (rule: Model): boolean => {
          return rule.ruleType === ruleType;
        },
      );

      expect(ofType.length).toBeGreaterThan(0);
      expect(ofType.length % 2).toBe(0);
    }
  });

  test("a push step brings its sound and repeat", async () => {
    await verify({ userPushId: METHOD_ID });

    expect(onCallRules()).toHaveLength(CARD_COUNT);

    for (const rule of onCallRules()) {
      expect(rule.notifyAfterMinutes).toBe(0);
      expect(rule.pushNotificationLevel).toBe(PushNotificationLevel.Standard);
      expect(rule.repeatEveryMinutes).toBe(5);
    }
  });

  test("the shift rules are made at once, as always", async () => {
    await verify({ userCallId: METHOD_ID });

    expect(
      shiftRules().map((rule: Model): unknown => {
        return [rule.ruleType, rule.notifyAfterMinutes];
      }),
    ).toEqual([
      [NotificationRuleType.WHEN_USER_GOES_ON_CALL, 0],
      [NotificationRuleType.WHEN_USER_GOES_OFF_CALL, 0],
    ]);
  });

  test("a card that has a rule for the method keeps it: nothing is rewritten or doubled", async () => {
    // The first incident card already pages this number.
    findOneBySpy.mockImplementation(
      (findBy: { query: Record<string, unknown> }): Promise<Model | null> => {
        const query: Record<string, unknown> = findBy.query;

        if (
          query["ruleType"] ===
            NotificationRuleType.ON_CALL_EXECUTED_INCIDENT &&
          String(query["incidentSeverityId"]) === INCIDENT_SEV_1.toString()
        ) {
          return Promise.resolve(new Model());
        }

        return Promise.resolve(null);
      },
    );

    const updateSpy: jest.SpyInstance = jest.spyOn(
      UserNotificationRuleService,
      "updateOneById",
    );
    const deleteSpy: jest.SpyInstance = jest.spyOn(
      UserNotificationRuleService,
      "deleteOneById",
    );

    await verify({ userCallId: METHOD_ID });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();

    // One card fewer, at both its waits.
    expect(onCallRules()).toHaveLength((CARD_COUNT - 1) * 2);
    expect(
      onCallRules().some((rule: Model): boolean => {
        return (
          rule.ruleType === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT &&
          rule.incidentSeverityId?.toString() === INCIDENT_SEV_1.toString()
        );
      }),
    ).toBe(false);
  });
});

describe("a channel the default leaves out", () => {
  test("gets no on-call rules; the two shift rules stay", async () => {
    await verify({ userEmailId: METHOD_ID });

    expect(onCallRules()).toEqual([]);
    expect(shiftRules()).toHaveLength(2);
  });

  test("no severity is even read for it", async () => {
    await verify({ userWhatsAppId: METHOD_ID });

    expect(IncidentSeverityService.findBy).not.toHaveBeenCalled();
    expect(AlertSeverityService.findBy).not.toHaveBeenCalled();
  });
});

describe("a custom channel", () => {
  test("is never filtered by a default, and the default is not read for it", async () => {
    await verify({ customNotificationChannelId: CUSTOM_CHANNEL_ID });

    expect(projectSpy).not.toHaveBeenCalled();
    expect(onCallRules()).toHaveLength(CARD_COUNT);
    expect(waitsOf(onCallRules())).toEqual(Array(CARD_COUNT).fill(0));
  });
});

describe("a member who joins (addDefaultNotificationRuleForUser)", () => {
  beforeEach(() => {
    const email: UserEmail = new UserEmail(EMAIL_ID);
    email._id = EMAIL_ID.toString();
    email.isVerified = true;

    jest.spyOn(UserEmailService, "findOneBy").mockResolvedValue(email as never);
  });

  function join(): Promise<void> {
    return UserNotificationRuleService.addDefaultNotificationRuleForUser(
      PROJECT_ID,
      USER_ID,
      new Email("ana@example.com"),
    );
  }

  test("their email takes the default: left out, it gets no on-call rules", async () => {
    await join();

    expect(onCallRules()).toEqual([]);
    expect(shiftRules()).toHaveLength(2);
    expect(
      shiftRules().every((rule: Model): boolean => {
        return rule.userEmailId?.toString() === EMAIL_ID.toString();
      }),
    ).toBe(true);
  });

  test("named, it gets the default's wait in every card", async () => {
    projectSpy.mockResolvedValue(
      projectWith([
        { channel: OnCallPageChannel.Email, notifyAfterMinutes: 10 },
      ]) as never,
    );

    await join();

    expect(waitsOf(onCallRules())).toEqual(Array(CARD_COUNT).fill(10));
  });

  test("a custom channel that pages everyone still pages them at once", async () => {
    const channel: CustomNotificationChannel = new CustomNotificationChannel(
      CUSTOM_CHANNEL_ID,
    );
    channel.id = CUSTOM_CHANNEL_ID;
    customChannelsSpy.mockResolvedValue([channel] as never);

    await join();

    const customRules: Array<Model> = onCallRules().filter(
      (rule: Model): boolean => {
        return (
          rule.customNotificationChannelId?.toString() ===
          CUSTOM_CHANNEL_ID.toString()
        );
      },
    );

    expect(customRules).toHaveLength(CARD_COUNT);
    expect(waitsOf(customRules)).toEqual(Array(CARD_COUNT).fill(0));
    // Their email, which the default leaves out, still gets none.
    expect(onCallRules()).toHaveLength(CARD_COUNT);
  });
});

describe("setting the default (ProjectService)", () => {
  test("stores it tidied, and writes no rule of anybody's", () => {
    const updateSpy: jest.SpyInstance = jest.spyOn(
      UserNotificationRuleService,
      "updateOneById",
    );
    const deleteSpy: jest.SpyInstance = jest.spyOn(
      UserNotificationRuleService,
      "deleteOneById",
    );
    const data: { defaultPagingLadder?: unknown } = {
      defaultPagingLadder: [
        { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
        { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
        { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
      ],
    };

    ProjectService.applyDefaultPagingLadderRules(data);

    expect(data.defaultPagingLadder).toEqual([
      { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
      { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
    ]);
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  test("no steps turns it off, stored as null", () => {
    const data: { defaultPagingLadder?: unknown } = { defaultPagingLadder: [] };

    ProjectService.applyDefaultPagingLadderRules(data);

    expect(data.defaultPagingLadder).toBeNull();
  });

  test("a write that leaves it out is not judged on it", () => {
    const data: { defaultPagingLadder?: unknown } = {};

    ProjectService.applyDefaultPagingLadderRules(data);

    expect("defaultPagingLadder" in data).toBe(false);
  });

  test("one that cannot be read is refused with what to do, never stored", () => {
    const data: { defaultPagingLadder?: unknown } = {
      defaultPagingLadder: [
        { channel: OnCallPageChannel.CustomChannel, notifyAfterMinutes: 0 },
      ],
    };

    expect(() => {
      ProjectService.applyDefaultPagingLadderRules(data);
    }).toThrow(BadDataException);
    expect(() => {
      ProjectService.applyDefaultPagingLadderRules({
        defaultPagingLadder: "SMS at once",
      });
    }).toThrow(/Reload the page, then save again/);
  });
});
