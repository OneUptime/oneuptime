import { describe, expect, test } from "@jest/globals";
import {
  GET_READY_TEXT,
  GetReadyInput,
  GetReadyStep,
  GetReadyStepState,
  GetReadyStepView,
  GetReadySteps,
  NotificationPermissionState,
  buildGetReadySteps,
} from "./getReady";

/*
 * THE APP'S FIRST STEPS (#7041), as rules: which steps there are, in what
 * order, which is done, which is next, and when the person is ready.
 */

const input: (overrides?: Partial<GetReadyInput>) => GetReadyInput = (
  overrides?: Partial<GetReadyInput>,
): GetReadyInput => {
  return {
    platform: "ios",
    notifications: NotificationPermissionState.NotAsked,
    criticalAlerts: {
      isChecking: false,
      isSupported: true,
      isEnabled: false,
      isOffInPhoneSettings: false,
    },
    testPage: { isAcknowledged: false },
    ...overrides,
  };
};

const stateOf: (
  steps: GetReadySteps,
  step: GetReadyStep,
) => GetReadyStepView = (
  steps: GetReadySteps,
  step: GetReadyStep,
): GetReadyStepView => {
  return steps.steps.find((view: GetReadyStepView): boolean => {
    return view.step === step;
  })!;
};

const nextOf: (steps: GetReadySteps) => Array<GetReadyStep> = (
  steps: GetReadySteps,
): Array<GetReadyStep> => {
  return steps.steps
    .filter((view: GetReadyStepView): boolean => {
      return view.isNext;
    })
    .map((view: GetReadyStepView): GetReadyStep => {
      return view.step;
    });
};

describe("the steps", () => {
  test("are three, in the order that decides whether a page wakes the person", () => {
    expect(
      buildGetReadySteps(input()).steps.map((view: GetReadyStepView) => {
        return view.step;
      }),
    ).toEqual([
      GetReadyStep.Notifications,
      GetReadyStep.CriticalAlerts,
      GetReadyStep.TestPage,
    ]);
  });

  test("a new install: nothing done, notifications next", () => {
    const steps: GetReadySteps = buildGetReadySteps(input());

    expect(steps.doneCount).toBe(0);
    expect(steps.totalCount).toBe(3);
    expect(steps.isFinished).toBe(false);
    expect(nextOf(steps)).toEqual([GetReadyStep.Notifications]);
  });

  test("an iPhone allows critical alerts; Android rings through Do Not Disturb", () => {
    expect(
      stateOf(buildGetReadySteps(input()), GetReadyStep.CriticalAlerts).title,
    ).toBe("Allow critical alerts");
    expect(
      stateOf(
        buildGetReadySteps(input({ platform: "android" })),
        GetReadyStep.CriticalAlerts,
      ).title,
    ).toBe("Ring through Do Not Disturb");
    expect(
      stateOf(
        buildGetReadySteps(input({ platform: "android" })),
        GetReadyStep.CriticalAlerts,
      ).description,
    ).toBe(GET_READY_TEXT.criticalDescriptionAndroid);
  });
});

describe("each step's state", () => {
  test("notifications: allowed is done, refused for good is off in the phone's settings, not asked is to do", () => {
    const cases: Array<[NotificationPermissionState, GetReadyStepState]> = [
      [NotificationPermissionState.Granted, GetReadyStepState.Done],
      [
        NotificationPermissionState.Denied,
        GetReadyStepState.OffInPhoneSettings,
      ],
      [NotificationPermissionState.NotAsked, GetReadyStepState.ToDo],
      [NotificationPermissionState.Unavailable, GetReadyStepState.Unavailable],
      [NotificationPermissionState.Checking, GetReadyStepState.Checking],
    ];

    for (const [permission, expected] of cases) {
      expect({
        permission,
        state: stateOf(
          buildGetReadySteps(input({ notifications: permission })),
          GetReadyStep.Notifications,
        ).state,
      }).toEqual({ permission, state: expected });
    }
  });

  test("critical alerts: on is done, turned off in the phone's settings says so, not supported is not counted", () => {
    const critical: (
      criticalAlerts: GetReadyInput["criticalAlerts"],
    ) => GetReadyStepState = (
      criticalAlerts: GetReadyInput["criticalAlerts"],
    ): GetReadyStepState => {
      return stateOf(
        buildGetReadySteps(input({ criticalAlerts })),
        GetReadyStep.CriticalAlerts,
      ).state;
    };

    expect(
      critical({
        isChecking: false,
        isSupported: true,
        isEnabled: true,
        isOffInPhoneSettings: false,
      }),
    ).toBe(GetReadyStepState.Done);
    expect(
      critical({
        isChecking: false,
        isSupported: true,
        isEnabled: false,
        isOffInPhoneSettings: true,
      }),
    ).toBe(GetReadyStepState.OffInPhoneSettings);
    expect(
      critical({
        isChecking: false,
        isSupported: true,
        isEnabled: false,
        isOffInPhoneSettings: false,
      }),
    ).toBe(GetReadyStepState.ToDo);
    expect(
      critical({
        isChecking: false,
        isSupported: false,
        isEnabled: false,
        isOffInPhoneSettings: false,
      }),
    ).toBe(GetReadyStepState.Unavailable);
    expect(
      critical({
        isChecking: true,
        isSupported: false,
        isEnabled: false,
        isOffInPhoneSettings: false,
      }),
    ).toBe(GetReadyStepState.Checking);
  });

  test("the test page: done only once a test page was acknowledged", () => {
    expect(
      stateOf(buildGetReadySteps(input()), GetReadyStep.TestPage).state,
    ).toBe(GetReadyStepState.ToDo);
    expect(
      stateOf(
        buildGetReadySteps(input({ testPage: { isAcknowledged: true } })),
        GetReadyStep.TestPage,
      ).state,
    ).toBe(GetReadyStepState.Done);
  });
});

describe("the step that is next", () => {
  test("is the first not done, and only one", () => {
    expect(
      nextOf(
        buildGetReadySteps(
          input({ notifications: NotificationPermissionState.Granted }),
        ),
      ),
    ).toEqual([GetReadyStep.CriticalAlerts]);

    expect(
      nextOf(
        buildGetReadySteps(
          input({
            notifications: NotificationPermissionState.Granted,
            criticalAlerts: {
              isChecking: false,
              isSupported: true,
              isEnabled: true,
              isOffInPhoneSettings: false,
            },
          }),
        ),
      ),
    ).toEqual([GetReadyStep.TestPage]);
  });

  test("a step turned off in the phone's settings can be next: its button opens them", () => {
    expect(
      nextOf(
        buildGetReadySteps(
          input({ notifications: NotificationPermissionState.Denied }),
        ),
      ),
    ).toEqual([GetReadyStep.Notifications]);
  });

  test("a step this phone cannot do is passed over", () => {
    expect(
      nextOf(
        buildGetReadySteps(
          input({
            notifications: NotificationPermissionState.Unavailable,
            criticalAlerts: {
              isChecking: false,
              isSupported: false,
              isEnabled: false,
              isOffInPhoneSettings: false,
            },
          }),
        ),
      ),
    ).toEqual([GetReadyStep.TestPage]);
  });

  test("nothing is next while a step before it is still being read", () => {
    expect(
      nextOf(
        buildGetReadySteps(
          input({ notifications: NotificationPermissionState.Checking }),
        ),
      ),
    ).toEqual([]);
  });
});

describe("ready", () => {
  test("once every step this phone can do is done", () => {
    const steps: GetReadySteps = buildGetReadySteps(
      input({
        notifications: NotificationPermissionState.Granted,
        criticalAlerts: {
          isChecking: false,
          isSupported: true,
          isEnabled: true,
          isOffInPhoneSettings: false,
        },
        testPage: { isAcknowledged: true },
      }),
    );

    expect(steps.isFinished).toBe(true);
    expect(steps.doneCount).toBe(3);
    expect(nextOf(steps)).toEqual([]);
  });

  test("a step this phone cannot do is not counted against it", () => {
    const steps: GetReadySteps = buildGetReadySteps(
      input({
        notifications: NotificationPermissionState.Unavailable,
        criticalAlerts: {
          isChecking: false,
          isSupported: false,
          isEnabled: false,
          isOffInPhoneSettings: false,
        },
        testPage: { isAcknowledged: true },
      }),
    );

    expect(steps.totalCount).toBe(1);
    expect(steps.isFinished).toBe(true);
  });

  test("never while a step is still being read", () => {
    expect(
      buildGetReadySteps(
        input({
          notifications: NotificationPermissionState.Checking,
          criticalAlerts: {
            isChecking: true,
            isSupported: true,
            isEnabled: false,
            isOffInPhoneSettings: false,
          },
          testPage: { isAcknowledged: true },
        }),
      ).isFinished,
    ).toBe(false);
  });
});

describe("its words", () => {
  test("every sentence ends as a sentence, and every button is in Title Case", () => {
    for (const sentence of [
      GET_READY_TEXT.intro,
      GET_READY_TEXT.notificationsDescription,
      GET_READY_TEXT.notificationsOff,
      GET_READY_TEXT.criticalDescriptionIos,
      GET_READY_TEXT.criticalDescriptionAndroid,
      GET_READY_TEXT.testPageDescription,
      GET_READY_TEXT.waiting,
      GET_READY_TEXT.noSeverity,
      GET_READY_TEXT.readyMessage,
    ]) {
      expect(sentence).toMatch(/^[A-Z].*\.$/);
    }

    for (const button of [
      GET_READY_TEXT.allowNotifications,
      GET_READY_TEXT.openSettings,
      GET_READY_TEXT.turnOnCriticalAlerts,
      GET_READY_TEXT.sendTestPage,
      GET_READY_TEXT.sendAnother,
      GET_READY_TEXT.notNow,
      GET_READY_TEXT.done,
    ]) {
      for (const word of button.split(" ")) {
        expect(word.charAt(0)).toBe(word.charAt(0).toUpperCase());
      }
    }
  });
});
