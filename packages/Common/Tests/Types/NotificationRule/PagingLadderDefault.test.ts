import { describe, expect, test } from "@jest/globals";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  PagingLadderStep,
  normalizePagingLadderSteps,
} from "../../../Types/NotificationRule/PagingLadder";
import {
  MAX_PAGING_LADDER_DEFAULT_STEPS,
  PAGING_LADDER_APPLY_DEFAULT_ROUTE,
  PAGING_LADDER_DEFAULT_CHANNELS,
  PAGING_LADDER_DEFAULT_SKIPPED_MESSAGE,
  PHONE_PAGING_CHANNELS,
  PagingLadderDefaultMemberResult,
  PagingLadderDefaultOutcome,
  PagingLadderDefaultStep,
  PagingLadderFromDefault,
  describePagingLadderDefaultResult,
  getChannelsOfPagingLadderSteps,
  getPagingLadderDefaultChannels,
  getPagingLadderDefaultProblem,
  getPagingLadderDefaultStart,
  getPagingLadderDefaultStepsForChannel,
  getPagingLadderFromDefault,
  isMissingRequiredPhoneMethod,
  isSamePagingLadder,
  readPagingLadderDefault,
  readPagingLadderDefaultMemberResults,
  toPagingLadderDefaultJSON,
  toPagingLadderDefaultStep,
  toPagingLadderStepOfChannel,
} from "../../../Types/NotificationRule/PagingLadderDefault";

/*
 * The project's default ladder (#7449, #7450): a ladder by channel, read
 * and checked here, mapped to each member's verified methods when an admin
 * applies it, and the project's ask for a phone method.
 */

const EMAIL: string = "aaaaaaaa-0000-4000-8000-000000000001";
const SMS: string = "aaaaaaaa-0000-4000-8000-000000000002";
const SMS_2: string = "aaaaaaaa-0000-4000-8000-000000000012";
const CALL: string = "aaaaaaaa-0000-4000-8000-000000000003";
const PUSH: string = "aaaaaaaa-0000-4000-8000-000000000004";
const WHATSAPP: string = "aaaaaaaa-0000-4000-8000-000000000005";
const CUSTOM_CHANNEL: string = "aaaaaaaa-0000-4000-8000-000000000006";

// "Push and SMS at once, then a call after 5 minutes."
const PUSH_SMS_THEN_CALL: Array<PagingLadderDefaultStep> = [
  { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
  { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
  { channel: OnCallPageChannel.Push, notifyAfterMinutes: 0 },
];

const step: (
  methodColumn: PagingLadderStep["methodColumn"],
  methodId: string,
  notifyAfterMinutes: number,
) => PagingLadderStep = (
  methodColumn: PagingLadderStep["methodColumn"],
  methodId: string,
  notifyAfterMinutes: number,
): PagingLadderStep => {
  return { methodColumn, methodId, notifyAfterMinutes };
};

describe("the route", () => {
  test("is the ladder's own path, beside apply", () => {
    expect(PAGING_LADDER_APPLY_DEFAULT_ROUTE).toBe(
      "/paging-ladder/apply-default",
    );
  });
});

describe("the channels a default may name", () => {
  test("every way a person is reached that is their own, never a custom channel", () => {
    expect(PAGING_LADDER_DEFAULT_CHANNELS).toContain(OnCallPageChannel.Push);
    expect(PAGING_LADDER_DEFAULT_CHANNELS).toContain(OnCallPageChannel.SMS);
    expect(PAGING_LADDER_DEFAULT_CHANNELS).toContain(OnCallPageChannel.Call);
    expect(PAGING_LADDER_DEFAULT_CHANNELS).toContain(OnCallPageChannel.Email);
    expect(PAGING_LADDER_DEFAULT_CHANNELS).not.toContain(
      OnCallPageChannel.CustomChannel,
    );
    expect(
      Object.values(OnCallPageChannel).filter(
        (channel: OnCallPageChannel): boolean => {
          return !PAGING_LADDER_DEFAULT_CHANNELS.includes(channel);
        },
      ),
    ).toEqual([OnCallPageChannel.CustomChannel]);
  });

  test("a phone method is SMS, a phone call or WhatsApp", () => {
    expect([...PHONE_PAGING_CHANNELS].sort()).toEqual(
      [
        OnCallPageChannel.SMS,
        OnCallPageChannel.Call,
        OnCallPageChannel.WhatsApp,
      ].sort(),
    );
  });
});

describe("getPagingLadderDefaultProblem", () => {
  test("no default can always be saved: nothing, null or no steps", () => {
    expect(getPagingLadderDefaultProblem(undefined)).toBeNull();
    expect(getPagingLadderDefaultProblem(null)).toBeNull();
    expect(getPagingLadderDefaultProblem([])).toBeNull();
  });

  test("a default of channels and waits can be saved", () => {
    expect(getPagingLadderDefaultProblem(PUSH_SMS_THEN_CALL)).toBeNull();
    expect(
      getPagingLadderDefaultProblem([
        {
          channel: OnCallPageChannel.Push,
          notifyAfterMinutes: 0,
          pushNotificationLevel: PushNotificationLevel.Standard,
          repeatEveryMinutes: 5,
        },
      ]),
    ).toBeNull();
  });

  test("anything but a list is refused with what to do", () => {
    for (const value of [{}, "push", 5, true]) {
      expect(getPagingLadderDefaultProblem(value)).toBe(
        "The default ladder was not sent in a way OneUptime can read. Reload the page, then save again.",
      );
    }
  });

  test("too many steps are refused", () => {
    const steps: Array<PagingLadderDefaultStep> = [];

    for (let i: number = 0; i <= MAX_PAGING_LADDER_DEFAULT_STEPS; i++) {
      steps.push({ channel: OnCallPageChannel.Email, notifyAfterMinutes: i });
    }

    expect(getPagingLadderDefaultProblem(steps)).toBe(
      `A default ladder has at most ${MAX_PAGING_LADDER_DEFAULT_STEPS} steps. Remove some, then save.`,
    );
    expect(getPagingLadderDefaultProblem(steps.slice(1))).toBeNull();
  });

  test("a step that is not an object is refused", () => {
    expect(getPagingLadderDefaultProblem([null])).toMatch(/needs a way/);
    expect(getPagingLadderDefaultProblem(["SMS"])).toMatch(/needs a way/);
    expect(getPagingLadderDefaultProblem([[]])).toMatch(/needs a way/);
  });

  test("a custom channel, or a channel OneUptime does not know, is refused", () => {
    expect(
      getPagingLadderDefaultProblem([
        {
          channel: OnCallPageChannel.CustomChannel,
          notifyAfterMinutes: 0,
        },
      ]),
    ).toMatch(/cannot use/);
    expect(
      getPagingLadderDefaultProblem([
        { channel: "Carrier pigeon", notifyAfterMinutes: 0 },
      ]),
    ).toMatch(/cannot use/);
  });

  test("a wait must be whole minutes from 0 to a day", () => {
    for (const wait of [-1, 1.5, 1441, "5", null, undefined, NaN]) {
      expect(
        getPagingLadderDefaultProblem([
          { channel: OnCallPageChannel.SMS, notifyAfterMinutes: wait },
        ]),
      ).toMatch(/whole number of minutes from 0 to 1440/);
    }

    for (const wait of [0, 5, 1440]) {
      expect(
        getPagingLadderDefaultProblem([
          { channel: OnCallPageChannel.SMS, notifyAfterMinutes: wait },
        ]),
      ).toBeNull();
    }
  });

  test("a push step's sound and repeat are the ones a rule can have", () => {
    expect(
      getPagingLadderDefaultProblem([
        {
          channel: OnCallPageChannel.Push,
          notifyAfterMinutes: 0,
          pushNotificationLevel: "Loud",
        },
      ]),
    ).toMatch(/Critical alert or a Standard notification/);
    expect(
      getPagingLadderDefaultProblem([
        {
          channel: OnCallPageChannel.Push,
          notifyAfterMinutes: 0,
          repeatEveryMinutes: 7,
        },
      ]),
    ).toMatch(/repeats every 1, 2, 3, 5, 10, 15 or 30 minutes/);
  });

  test("only a push step repeats", () => {
    expect(
      getPagingLadderDefaultProblem([
        {
          channel: OnCallPageChannel.SMS,
          notifyAfterMinutes: 0,
          repeatEveryMinutes: 5,
        },
      ]),
    ).toMatch(/Only a push step can repeat/);
    expect(
      getPagingLadderDefaultProblem([
        {
          channel: OnCallPageChannel.SMS,
          notifyAfterMinutes: 0,
          repeatEveryMinutes: 0,
        },
      ]),
    ).toBeNull();
  });
});

describe("readPagingLadderDefault", () => {
  test("nothing, or anything but a list, is no default", () => {
    expect(readPagingLadderDefault(undefined)).toEqual([]);
    expect(readPagingLadderDefault(null)).toEqual([]);
    expect(readPagingLadderDefault({ channel: "SMS" })).toEqual([]);
    expect(readPagingLadderDefault("SMS")).toEqual([]);
  });

  test("steps come in the order they page: by wait, then gentlest first", () => {
    expect(readPagingLadderDefault(PUSH_SMS_THEN_CALL)).toEqual([
      {
        channel: OnCallPageChannel.Push,
        notifyAfterMinutes: 0,
        pushNotificationLevel: PushNotificationLevel.Critical,
        repeatEveryMinutes: 0,
      },
      { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
      { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
    ]);
  });

  test("what cannot be read is left out, never guessed", () => {
    expect(
      readPagingLadderDefault([
        null,
        "SMS",
        { channel: OnCallPageChannel.CustomChannel, notifyAfterMinutes: 0 },
        { channel: "Fax", notifyAfterMinutes: 0 },
        { channel: OnCallPageChannel.SMS, notifyAfterMinutes: -5 },
        { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 5000 },
        { channel: OnCallPageChannel.SMS, notifyAfterMinutes: "5" },
        { channel: OnCallPageChannel.Email, notifyAfterMinutes: 10 },
      ]),
    ).toEqual([{ channel: OnCallPageChannel.Email, notifyAfterMinutes: 10 }]);
  });

  test("a channel at one wait is said once, the first one's push settings kept", () => {
    expect(
      readPagingLadderDefault([
        {
          channel: OnCallPageChannel.Push,
          notifyAfterMinutes: 0,
          pushNotificationLevel: PushNotificationLevel.Standard,
        },
        {
          channel: OnCallPageChannel.Push,
          notifyAfterMinutes: 0,
          pushNotificationLevel: PushNotificationLevel.Critical,
        },
        { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
        { channel: OnCallPageChannel.Call, notifyAfterMinutes: 15 },
      ]),
    ).toEqual([
      {
        channel: OnCallPageChannel.Push,
        notifyAfterMinutes: 0,
        pushNotificationLevel: PushNotificationLevel.Standard,
        repeatEveryMinutes: 0,
      },
      { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
      { channel: OnCallPageChannel.Call, notifyAfterMinutes: 15 },
    ]);
  });

  test("push settings are kept only on a push step", () => {
    expect(
      readPagingLadderDefault([
        {
          channel: OnCallPageChannel.SMS,
          notifyAfterMinutes: 0,
          pushNotificationLevel: PushNotificationLevel.Standard,
          repeatEveryMinutes: 5,
        },
      ]),
    ).toEqual([{ channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 }]);
  });

  test("at most the steps a default may hold", () => {
    const steps: Array<PagingLadderDefaultStep> = [];

    for (let i: number = 0; i < MAX_PAGING_LADDER_DEFAULT_STEPS + 5; i++) {
      steps.push({ channel: OnCallPageChannel.Email, notifyAfterMinutes: i });
    }

    expect(readPagingLadderDefault(steps)).toHaveLength(
      MAX_PAGING_LADDER_DEFAULT_STEPS,
    );
  });
});

describe("toPagingLadderDefaultJSON", () => {
  test("no steps is stored as null, which turns the default off", () => {
    expect(toPagingLadderDefaultJSON([])).toBeNull();
  });

  test("steps are stored tidied, and read back the same", () => {
    const json: unknown = toPagingLadderDefaultJSON(PUSH_SMS_THEN_CALL);

    expect(json).toEqual([
      {
        channel: OnCallPageChannel.Push,
        notifyAfterMinutes: 0,
        pushNotificationLevel: PushNotificationLevel.Critical,
        repeatEveryMinutes: 0,
      },
      { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
      { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
    ]);
    expect(readPagingLadderDefault(json)).toEqual(
      readPagingLadderDefault(PUSH_SMS_THEN_CALL),
    );
    expect(getPagingLadderDefaultProblem(json)).toBeNull();
  });
});

describe("a default step as a ladder step whose method is its channel", () => {
  test("goes there and back", () => {
    for (const defaultStep of readPagingLadderDefault(PUSH_SMS_THEN_CALL)) {
      const ladderStep: PagingLadderStep =
        toPagingLadderStepOfChannel(defaultStep);

      expect(ladderStep.methodId).toBe(defaultStep.channel);
      expect(toPagingLadderDefaultStep(ladderStep)).toEqual(defaultStep);
    }
  });

  test("a custom channel's step is no default step", () => {
    expect(
      toPagingLadderDefaultStep(
        step("customNotificationChannelId", CUSTOM_CHANNEL, 0),
      ),
    ).toBeNull();
  });
});

describe("getPagingLadderDefaultStepsForChannel", () => {
  test("the default's steps of a channel, each wait", () => {
    const defaultSteps: Array<PagingLadderDefaultStep> = [
      ...PUSH_SMS_THEN_CALL,
      { channel: OnCallPageChannel.Call, notifyAfterMinutes: 15 },
    ];

    expect(
      getPagingLadderDefaultStepsForChannel({
        defaultSteps: defaultSteps,
        channel: OnCallPageChannel.Call,
      }).map((defaultStep: PagingLadderDefaultStep): number => {
        return defaultStep.notifyAfterMinutes;
      }),
    ).toEqual([5, 15]);
  });

  test("none for a channel the default leaves out", () => {
    expect(
      getPagingLadderDefaultStepsForChannel({
        defaultSteps: PUSH_SMS_THEN_CALL,
        channel: OnCallPageChannel.Email,
      }),
    ).toEqual([]);
  });

  test("the channels a default names, each once", () => {
    expect(
      getPagingLadderDefaultChannels(
        readPagingLadderDefault([
          ...PUSH_SMS_THEN_CALL,
          { channel: OnCallPageChannel.Call, notifyAfterMinutes: 15 },
        ]),
      ),
    ).toEqual([
      OnCallPageChannel.Push,
      OnCallPageChannel.SMS,
      OnCallPageChannel.Call,
    ]);
  });
});

describe("getPagingLadderFromDefault", () => {
  test("somebody who has every channel gets exactly the default, their other steps gone", () => {
    const result: PagingLadderFromDefault = getPagingLadderFromDefault({
      defaultSteps: PUSH_SMS_THEN_CALL,
      methods: [
        { methodColumn: "userEmailId", methodId: EMAIL },
        { methodColumn: "userSmsId", methodId: SMS },
        { methodColumn: "userCallId", methodId: CALL },
        { methodColumn: "userPushId", methodId: PUSH },
      ],
      currentSteps: [
        step("userEmailId", EMAIL, 0),
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 0),
        step("userPushId", PUSH, 0),
      ],
    });

    expect(result.steps).toEqual(
      normalizePagingLadderSteps([
        step("userPushId", PUSH, 0),
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 5),
      ]),
    );
    expect(result.leftOutChannels).toEqual([]);
    expect(result.keptSteps).toEqual([]);
    expect(
      result.appliedSteps.map((applied: PagingLadderDefaultStep) => {
        return applied.channel;
      }),
    ).toEqual([
      OnCallPageChannel.Push,
      OnCallPageChannel.SMS,
      OnCallPageChannel.Call,
    ]);
  });

  test("somebody with no verified phone keeps their own steps in its place", () => {
    const result: PagingLadderFromDefault = getPagingLadderFromDefault({
      defaultSteps: PUSH_SMS_THEN_CALL,
      methods: [
        { methodColumn: "userEmailId", methodId: EMAIL },
        { methodColumn: "userPushId", methodId: PUSH },
      ],
      currentSteps: [
        step("userEmailId", EMAIL, 0),
        step("userPushId", PUSH, 10),
      ],
    });

    expect(result.leftOutChannels).toEqual([
      OnCallPageChannel.SMS,
      OnCallPageChannel.Call,
    ]);
    // Their email stays; their push takes the default's wait.
    expect(result.keptSteps).toEqual([step("userEmailId", EMAIL, 0)]);
    expect(result.steps).toEqual(
      normalizePagingLadderSteps([
        step("userEmailId", EMAIL, 0),
        step("userPushId", PUSH, 0),
      ]),
    );
    expect(getChannelsOfPagingLadderSteps(result.keptSteps)).toEqual([
      OnCallPageChannel.Email,
    ]);
  });

  test("somebody who has none of the default's channels gets nothing, and is told why", () => {
    const result: PagingLadderFromDefault = getPagingLadderFromDefault({
      defaultSteps: PUSH_SMS_THEN_CALL,
      methods: [{ methodColumn: "userEmailId", methodId: EMAIL }],
      currentSteps: [step("userEmailId", EMAIL, 0)],
    });

    expect(result.steps).toEqual([]);
    expect(result.appliedSteps).toEqual([]);
    expect(result.keptSteps).toEqual([]);
    expect(result.leftOutChannels).toEqual([
      OnCallPageChannel.Push,
      OnCallPageChannel.SMS,
      OnCallPageChannel.Call,
    ]);
  });

  test("no default: nothing to apply", () => {
    expect(
      getPagingLadderFromDefault({
        defaultSteps: [],
        methods: [{ methodColumn: "userEmailId", methodId: EMAIL }],
      }).steps,
    ).toEqual([]);
  });

  test("a step is every verified method of its channel", () => {
    const result: PagingLadderFromDefault = getPagingLadderFromDefault({
      defaultSteps: [{ channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 }],
      methods: [
        { methodColumn: "userSmsId", methodId: SMS },
        { methodColumn: "userSmsId", methodId: SMS_2 },
        // The same method twice is one.
        { methodColumn: "userSmsId", methodId: SMS },
      ],
    });

    expect(result.steps).toEqual(
      normalizePagingLadderSteps([
        step("userSmsId", SMS, 0),
        step("userSmsId", SMS_2, 0),
      ]),
    );
  });

  test("a push step carries the default's sound and repeat to every push device", () => {
    const result: PagingLadderFromDefault = getPagingLadderFromDefault({
      defaultSteps: [
        {
          channel: OnCallPageChannel.Push,
          notifyAfterMinutes: 0,
          pushNotificationLevel: PushNotificationLevel.Standard,
          repeatEveryMinutes: 5,
        },
      ],
      methods: [{ methodColumn: "userPushId", methodId: PUSH }],
    });

    expect(result.steps).toEqual([
      {
        methodColumn: "userPushId",
        methodId: PUSH,
        notifyAfterMinutes: 0,
        pushNotificationLevel: PushNotificationLevel.Standard,
        repeatEveryMinutes: 5,
      },
    ]);
  });

  test("a custom channel's steps stay, always, and a custom channel is never a method of the default", () => {
    const result: PagingLadderFromDefault = getPagingLadderFromDefault({
      defaultSteps: [{ channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 }],
      methods: [
        { methodColumn: "userSmsId", methodId: SMS },
        {
          methodColumn: "customNotificationChannelId",
          methodId: CUSTOM_CHANNEL,
        },
      ],
      currentSteps: [
        step("userEmailId", EMAIL, 0),
        step("customNotificationChannelId", CUSTOM_CHANNEL, 0),
      ],
    });

    expect(result.keptSteps).toEqual([
      step("customNotificationChannelId", CUSTOM_CHANNEL, 0),
    ]);
    expect(result.steps).toEqual(
      normalizePagingLadderSteps([
        step("userSmsId", SMS, 0),
        step("customNotificationChannelId", CUSTOM_CHANNEL, 0),
      ]),
    );
  });

  test("an own step of a method that is not verified is never kept", () => {
    const result: PagingLadderFromDefault = getPagingLadderFromDefault({
      defaultSteps: PUSH_SMS_THEN_CALL,
      methods: [{ methodColumn: "userPushId", methodId: PUSH }],
      currentSteps: [
        step("userPushId", PUSH, 0),
        // Not among their verified methods: the save would refuse it.
        step("userWhatsAppId", WHATSAPP, 0),
      ],
    });

    expect(result.keptSteps).toEqual([]);
    expect(result.steps).toEqual(
      normalizePagingLadderSteps([step("userPushId", PUSH, 0)]),
    );
  });

  test("a channel named at two waits is followed at both", () => {
    const result: PagingLadderFromDefault = getPagingLadderFromDefault({
      defaultSteps: [
        { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
        { channel: OnCallPageChannel.Call, notifyAfterMinutes: 15 },
      ],
      methods: [{ methodColumn: "userCallId", methodId: CALL }],
    });

    expect(result.steps).toEqual([
      step("userCallId", CALL, 5),
      step("userCallId", CALL, 15),
    ]);
  });
});

describe("isSamePagingLadder", () => {
  test("the same steps in any order, said any number of times, are one ladder", () => {
    expect(
      isSamePagingLadder(
        [step("userCallId", CALL, 5), step("userSmsId", SMS, 0)],
        [
          step("userSmsId", SMS, 0),
          step("userCallId", CALL, 5),
          step("userSmsId", SMS, 0),
        ],
      ),
    ).toBe(true);
    expect(isSamePagingLadder([], [])).toBe(true);
  });

  test("a push that sounds or repeats otherwise is another ladder; one left at its defaults is not", () => {
    const criticalOnce: PagingLadderStep = {
      ...step("userPushId", PUSH, 0),
      pushNotificationLevel: PushNotificationLevel.Critical,
      repeatEveryMinutes: 0,
    };

    expect(
      isSamePagingLadder([criticalOnce], [step("userPushId", PUSH, 0)]),
    ).toBe(true);
    expect(
      isSamePagingLadder(
        [criticalOnce],
        [
          {
            ...criticalOnce,
            pushNotificationLevel: PushNotificationLevel.Standard,
          },
        ],
      ),
    ).toBe(false);
    expect(
      isSamePagingLadder(
        [criticalOnce],
        [{ ...criticalOnce, repeatEveryMinutes: 5 }],
      ),
    ).toBe(false);
  });

  test("another wait or another method is another ladder", () => {
    expect(
      isSamePagingLadder(
        [step("userSmsId", SMS, 0)],
        [step("userSmsId", SMS, 5)],
      ),
    ).toBe(false);
    expect(
      isSamePagingLadder(
        [step("userSmsId", SMS, 0)],
        [step("userSmsId", SMS_2, 0)],
      ),
    ).toBe(false);
  });
});

/*
 * Start From the Project's Default, on How to Reach Me (#9445): offered only
 * when it would change somebody's steps, with the same mapping Readiness's
 * Apply Default Ladder saves.
 */
describe("getPagingLadderDefaultStart", () => {
  const EVERY_METHOD: Array<{
    methodColumn: PagingLadderStep["methodColumn"];
    methodId: string;
  }> = [
    { methodColumn: "userEmailId", methodId: EMAIL },
    { methodColumn: "userSmsId", methodId: SMS },
    { methodColumn: "userCallId", methodId: CALL },
    { methodColumn: "userPushId", methodId: PUSH },
  ];

  test("somebody whose ladder is not the default is offered it, as getPagingLadderFromDefault maps it", () => {
    const currentSteps: Array<PagingLadderStep> = [
      step("userEmailId", EMAIL, 0),
    ];

    expect(
      getPagingLadderDefaultStart({
        defaultSteps: PUSH_SMS_THEN_CALL,
        methods: EVERY_METHOD,
        currentSteps: currentSteps,
      }),
    ).toEqual(
      getPagingLadderFromDefault({
        defaultSteps: PUSH_SMS_THEN_CALL,
        methods: EVERY_METHOD,
        currentSteps: currentSteps,
      }),
    );
  });

  test("somebody whose ladder already is the default is offered nothing", () => {
    expect(
      getPagingLadderDefaultStart({
        defaultSteps: PUSH_SMS_THEN_CALL,
        methods: EVERY_METHOD,
        // In another order, push at its defaults: the same ladder.
        currentSteps: [
          step("userCallId", CALL, 5),
          step("userSmsId", SMS, 0),
          step("userPushId", PUSH, 0),
        ],
      }),
    ).toBeNull();
  });

  test("no default, or a default that cannot be read, offers nothing", () => {
    for (const defaultSteps of [
      [],
      [{ channel: "Pager" as OnCallPageChannel, notifyAfterMinutes: 0 }],
    ]) {
      expect(
        getPagingLadderDefaultStart({
          defaultSteps: defaultSteps,
          methods: EVERY_METHOD,
          currentSteps: [step("userEmailId", EMAIL, 0)],
        }),
      ).toBeNull();
    }
  });

  test("somebody who has verified none of the default's channels is offered nothing: it would leave them no step", () => {
    expect(
      getPagingLadderDefaultStart({
        defaultSteps: PUSH_SMS_THEN_CALL,
        methods: [{ methodColumn: "userEmailId", methodId: EMAIL }],
        currentSteps: [step("userEmailId", EMAIL, 0)],
      }),
    ).toBeNull();
  });

  test("a channel they have not verified is left out and named, and their own steps stay in its place", () => {
    const start: PagingLadderFromDefault | null = getPagingLadderDefaultStart({
      defaultSteps: PUSH_SMS_THEN_CALL,
      methods: [
        { methodColumn: "userEmailId", methodId: EMAIL },
        { methodColumn: "userPushId", methodId: PUSH },
      ],
      currentSteps: [step("userEmailId", EMAIL, 0)],
    });

    expect(start).not.toBeNull();
    expect(start!.leftOutChannels).toEqual([
      OnCallPageChannel.SMS,
      OnCallPageChannel.Call,
    ]);
    expect(start!.steps).toEqual(
      normalizePagingLadderSteps([
        step("userEmailId", EMAIL, 0),
        step("userPushId", PUSH, 0),
      ]),
    );
  });

  test("an empty ladder is offered the default", () => {
    expect(
      getPagingLadderDefaultStart({
        defaultSteps: PUSH_SMS_THEN_CALL,
        methods: EVERY_METHOD,
        currentSteps: [],
      })?.steps,
    ).toEqual(
      normalizePagingLadderSteps([
        step("userPushId", PUSH, 0),
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 5),
      ]),
    );
  });
});

describe("isMissingRequiredPhoneMethod", () => {
  test("never, while the project does not ask for one", () => {
    for (const isRequired of [false, null, undefined]) {
      expect(
        isMissingRequiredPhoneMethod({
          isRequired: isRequired,
          verifiedChannels: [],
        }),
      ).toBe(false);
    }
  });

  test("somebody with only email and push is missing one", () => {
    expect(
      isMissingRequiredPhoneMethod({
        isRequired: true,
        verifiedChannels: [OnCallPageChannel.Email, OnCallPageChannel.Push],
      }),
    ).toBe(true);
    expect(
      isMissingRequiredPhoneMethod({ isRequired: true, verifiedChannels: [] }),
    ).toBe(true);
  });

  test("an SMS, a phone call or a WhatsApp number is one", () => {
    for (const channel of [
      OnCallPageChannel.SMS,
      OnCallPageChannel.Call,
      OnCallPageChannel.WhatsApp,
      // Readiness writes the channel as its method type.
      "SMS",
    ]) {
      expect(
        isMissingRequiredPhoneMethod({
          isRequired: true,
          verifiedChannels: [OnCallPageChannel.Email, channel],
        }),
      ).toBe(false);
    }
  });
});

describe("describePagingLadderDefaultResult", () => {
  test("a skipped member's sentence says why", () => {
    expect(
      describePagingLadderDefaultResult({
        outcome: PagingLadderDefaultOutcome.Skipped,
        leftOutChannels: [OnCallPageChannel.SMS],
        keptChannels: [],
      }),
    ).toBe(PAGING_LADDER_DEFAULT_SKIPPED_MESSAGE);
  });

  test("an applied one names what was left out and what they keep", () => {
    expect(
      describePagingLadderDefaultResult({
        outcome: PagingLadderDefaultOutcome.Applied,
        leftOutChannels: [OnCallPageChannel.SMS, OnCallPageChannel.Call],
        keptChannels: [
          OnCallPageChannel.Email,
          OnCallPageChannel.CustomChannel,
        ],
      }),
    ).toBe(
      "Applied the default ladder to their rules for every severity. Left out SMS and phone call: they have not verified them yet. Kept their own email steps meanwhile.",
    );
    expect(
      describePagingLadderDefaultResult({
        outcome: PagingLadderDefaultOutcome.Applied,
        leftOutChannels: [],
        keptChannels: [],
      }),
    ).toBe("Applied the default ladder to their rules for every severity.");
  });
});

describe("readPagingLadderDefaultMemberResults", () => {
  test("anything but an answer with a list of results is no result", () => {
    expect(readPagingLadderDefaultMemberResults(undefined)).toEqual([]);
    expect(readPagingLadderDefaultMemberResults(null)).toEqual([]);
    expect(readPagingLadderDefaultMemberResults("results")).toEqual([]);
    expect(readPagingLadderDefaultMemberResults({})).toEqual([]);
    expect(readPagingLadderDefaultMemberResults({ results: {} })).toEqual([]);
  });

  test("each member's result is read as the API sent it", () => {
    const sent: Array<PagingLadderDefaultMemberResult> = [
      {
        userId: EMAIL,
        outcome: PagingLadderDefaultOutcome.Applied,
        appliedSteps: [
          {
            channel: OnCallPageChannel.Push,
            notifyAfterMinutes: 0,
            pushNotificationLevel: PushNotificationLevel.Standard,
            repeatEveryMinutes: 5,
          },
          { channel: OnCallPageChannel.Call, notifyAfterMinutes: 10 },
        ],
        leftOutChannels: [OnCallPageChannel.SMS],
        keptChannels: [OnCallPageChannel.Email],
        changedRuleCount: 12,
        message: "Applied the default ladder.",
      },
      {
        userId: SMS,
        outcome: PagingLadderDefaultOutcome.Skipped,
        appliedSteps: [],
        leftOutChannels: [OnCallPageChannel.Push],
        keptChannels: [],
        changedRuleCount: 0,
        message: PAGING_LADDER_DEFAULT_SKIPPED_MESSAGE,
      },
    ];

    expect(
      readPagingLadderDefaultMemberResults(
        JSON.parse(JSON.stringify({ results: sent })),
      ),
    ).toEqual(sent);
  });

  test("an outcome it does not know, or an entry that is not one, is left out", () => {
    expect(
      readPagingLadderDefaultMemberResults({
        results: [
          null,
          "applied",
          { userId: EMAIL, outcome: "maybe" },
          { userId: SMS, outcome: PagingLadderDefaultOutcome.Failed },
        ],
      }),
    ).toEqual([
      {
        userId: SMS,
        outcome: PagingLadderDefaultOutcome.Failed,
        appliedSteps: [],
        leftOutChannels: [],
        keptChannels: [],
        changedRuleCount: 0,
        message: "",
      },
    ]);
  });

  test("channels it does not know, and a count that is no number, are never guessed", () => {
    const [result] = readPagingLadderDefaultMemberResults({
      results: [
        {
          userId: CALL,
          outcome: PagingLadderDefaultOutcome.Applied,
          leftOutChannels: ["Pager", OnCallPageChannel.Call, 7],
          keptChannels: "email",
          changedRuleCount: "many",
          message: 42,
        },
      ],
    });

    expect(result?.leftOutChannels).toEqual([OnCallPageChannel.Call]);
    expect(result?.keptChannels).toEqual([]);
    expect(result?.changedRuleCount).toBe(0);
    expect(result?.message).toBe("");
  });
});
