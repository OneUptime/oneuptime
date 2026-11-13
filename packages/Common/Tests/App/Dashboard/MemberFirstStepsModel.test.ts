import { describe, expect, test } from "@jest/globals";
import {
  EMAIL_METHOD_TYPE,
  MEMBER_FIRST_STEPS_COPY,
  MemberFirstSteps,
  MemberFirstStepsInput,
  MemberStep,
  MemberStepTile,
  OnCallState,
  PUSH_METHOD_TYPE,
  ReachState,
  buildMemberFirstSteps,
  getOnCallAnswer,
  getOpenStepCount,
  getReachState,
  isOnlyEmail,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/MemberFirstSteps/MemberFirstStepsModel";
import {
  SetupChecklist,
  SetupHeadlineStatus,
  buildSetupChecklist,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/ChecklistModel";
import {
  ReadinessMethodWire,
  ResponderSourceValue,
  UserReadinessWire,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ReadinessTypes";
import {
  UpcomingShiftSpan,
  buildUpcomingShiftSpans,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftSpans";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import { MaterializedShiftJson } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import { FeedClock } from "../../../UI/Components/Feed/FeedTime";

/*
 * AN INVITED MEMBER'S FIRST STEPS ON HOME (issue #6807), as rules: what
 * "can OneUptime reach me" and "when am I on call" say for every state the
 * person's checklist and shifts can be in, which step is next, and when the
 * card is done. The card's own drawing is in MemberFirstSteps.test.tsx.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

// A Wednesday, 15:00 UTC.
const NOW: Date = new Date("2026-10-14T15:00:00.000Z");

const CLOCK: FeedClock = {
  timezone: "UTC",
  language: "en",
  use12HourClock: false,
  now: NOW,
};

const SEVERITY: string = "11111111-1111-4111-8111-111111111111";

function at(offset: number): string {
  return new Date(NOW.getTime() + offset).toISOString();
}

function method(methodType: string, isVerified: boolean): ReadinessMethodWire {
  return {
    methodId: `method-${methodType}`,
    methodType: methodType,
    maskedIdentifier: "•••",
    isVerified: isVerified,
  };
}

function readiness(data?: {
  status?: UserReadinessWire["status"] | undefined;
  methods?: Array<ReadinessMethodWire> | undefined;
  reachedVia?: Array<ResponderSourceValue> | undefined;
  hasRule?: boolean | undefined;
}): UserReadinessWire {
  return {
    userId: "99999999-9999-4999-8999-999999999999",
    userName: "Grace Hopper",
    userEmail: "grace@example.com",
    status: data?.status ?? "Ready",
    methods: data?.methods ?? [method(EMAIL_METHOD_TYPE, true)],
    coverage: [
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    ].map((ruleType: NotificationRuleType) => {
      return {
        ruleType: ruleType,
        severityId: SEVERITY,
        severityName: "Sev1",
        hasRule: data?.hasRule ?? true,
        isOptOut: false,
      };
    }),
    reasons: [],
    reachedVia: data?.reachedVia ?? [],
    teams: [],
  };
}

// The personal checklist, built by its own rules from a readiness answer.
function checklistFor(data?: Parameters<typeof readiness>[0]): SetupChecklist {
  return buildSetupChecklist({
    readiness: readiness(data),
    isFallbackEnabled: true,
    isFallbackKnown: true,
    onCallShiftAlerts: { isKnown: true, hasAnyChannelEnabled: true },
    deliverableSettings: { isKnown: true, undeliverableChannels: [] },
    incomingCall: {
      isKnown: true,
      hasPolicyInProject: false,
      hasVerifiedNumber: false,
    },
    slack: {
      isKnown: true,
      isConnectedForProject: false,
      isConnectedForUser: false,
    },
    microsoftTeams: {
      isKnown: true,
      isConnectedForProject: false,
      isConnectedForUser: false,
    },
    customFields: { isKnown: true, fieldCount: 0, filledFieldCount: 0 },
  });
}

function shift(
  overrides: Partial<MaterializedShiftJson> & { shiftKey: string },
): MaterializedShiftJson {
  return {
    contentHash: "hash",
    projectId: "0d600000-0000-4000-8000-000000000001",
    scheduleId: "0d600000-0000-4000-8000-000000000011",
    scheduleName: "Primary",
    scheduleTimezone: "UTC",
    userId: "99999999-9999-4999-8999-999999999999",
    userName: "Grace Hopper",
    start: at(DAY),
    end: at(DAY + 8 * HOUR),
    coverageSeconds: 8 * 3600,
    layerId: "layer-1",
    layerName: "Layer 1",
    policies: [],
    isPast: false,
    lastModifiedAt: "2026-10-01T00:00:00.000Z",
    shiftConfigVersion: 1,
    ...overrides,
  };
}

function spansOf(
  shifts: Array<MaterializedShiftJson>,
): Array<UpcomingShiftSpan> {
  return buildUpcomingShiftSpans(
    shifts,
    NOW,
    new Date(NOW.getTime() + 30 * DAY),
  );
}

function input(
  overrides?: Partial<MemberFirstStepsInput>,
): MemberFirstStepsInput {
  return {
    checklist: checklistFor(),
    isChecklistLoading: false,
    spans: [],
    isShiftsLoading: false,
    canSendEmail: true,
    hasAcknowledgedTestPage: false,
    clock: CLOCK,
    ...overrides,
  };
}

function tile(steps: MemberFirstSteps, step: MemberStep): MemberStepTile {
  const found: MemberStepTile | undefined = steps.tiles.find(
    (candidate: MemberStepTile): boolean => {
      return candidate.step === step;
    },
  );

  if (!found) {
    throw new Error(`No ${step} tile`);
  }

  return found;
}

function stepsOf(steps: MemberFirstSteps): Array<string> {
  return steps.tiles.map((candidate: MemberStepTile): string => {
    return `${candidate.step}${candidate.isDone ? ":done" : ""}${candidate.isNext ? ":next" : ""}`;
  });
}

describe("can OneUptime reach me", () => {
  test("only email counts as only email", () => {
    expect(isOnlyEmail([])).toBe(false);
    expect(isOnlyEmail([EMAIL_METHOD_TYPE])).toBe(true);
    expect(isOnlyEmail([EMAIL_METHOD_TYPE, "SMS"])).toBe(false);
    expect(isOnlyEmail([PUSH_METHOD_TYPE])).toBe(false);
  });

  test("the checklist's open essential steps are counted", () => {
    expect(getOpenStepCount(checklistFor())).toBe(0);
    expect(
      getOpenStepCount(checklistFor({ methods: [method("SMS", false)] })),
    ).toBeGreaterThan(0);
  });

  test("loading, then unknown when the checklist could not be read", () => {
    expect(
      getReachState({
        checklist: null,
        isChecklistLoading: true,
        canSendEmail: true,
        hasShifts: false,
      }),
    ).toBe(ReachState.Loading);
    expect(
      getReachState({
        checklist: null,
        isChecklistLoading: false,
        canSendEmail: true,
        hasShifts: false,
      }),
    ).toBe(ReachState.Unknown);
  });

  test("a member with only email, not on call, can be reached", () => {
    expect(
      getReachState({
        checklist: checklistFor(),
        isChecklistLoading: false,
        canSendEmail: true,
        hasShifts: false,
      }),
    ).toBe(ReachState.Ready);
  });

  test("a member with only email on a policy is told so (#1809)", () => {
    expect(
      getReachState({
        checklist: checklistFor({ reachedVia: ["Team"] }),
        isChecklistLoading: false,
        canSendEmail: true,
        hasShifts: false,
      }),
    ).toBe(ReachState.OnlyEmail);
  });

  test("a shift is enough to count as on call, whatever readiness says", () => {
    expect(
      getReachState({
        checklist: checklistFor(),
        isChecklistLoading: false,
        canSendEmail: true,
        hasShifts: true,
      }),
    ).toBe(ReachState.OnlyEmail);
  });

  test("a phone or the app beside email is not only email", () => {
    for (const other of ["SMS", "Call", PUSH_METHOD_TYPE]) {
      expect(
        getReachState({
          checklist: checklistFor({
            reachedVia: ["Team"],
            methods: [method(EMAIL_METHOD_TYPE, true), method(other, true)],
          }),
          isChecklistLoading: false,
          canSendEmail: true,
          hasShifts: true,
        }),
      ).toBe(ReachState.Ready);
    }
  });

  test("a server that cannot send email, to someone with only email, reaches nobody", () => {
    expect(
      getReachState({
        checklist: checklistFor(),
        isChecklistLoading: false,
        canSendEmail: false,
        hasShifts: false,
      }),
    ).toBe(ReachState.EmailCannotReach);
  });

  test("open steps come before only email", () => {
    expect(
      getReachState({
        checklist: checklistFor({ reachedVia: ["Team"], hasRule: false }),
        isChecklistLoading: false,
        canSendEmail: true,
        hasShifts: true,
      }),
    ).toBe(ReachState.OpenSteps);
  });

  test("a red headline is open even with nothing counted left", () => {
    const checklist: SetupChecklist = {
      ...checklistFor(),
      headlineStatus: SetupHeadlineStatus.NotReachable,
    };

    expect(getOpenStepCount(checklist)).toBe(0);
    expect(
      getReachState({
        checklist: checklist,
        isChecklistLoading: false,
        canSendEmail: true,
        hasShifts: false,
      }),
    ).toBe(ReachState.OpenSteps);
  });
});

describe("when am I on call", () => {
  test("loading while the shifts are on their way", () => {
    expect(
      getOnCallAnswer({
        spans: null,
        isShiftsLoading: true,
        isOnCallResponder: false,
      }).state,
    ).toBe(OnCallState.Loading);
  });

  test("a shift that started and has not ended is now", () => {
    const spans: Array<UpcomingShiftSpan> = spansOf([
      shift({ shiftKey: "now", start: at(-HOUR), end: at(3 * HOUR) }),
      shift({ shiftKey: "later", start: at(2 * DAY), end: at(2 * DAY + HOUR) }),
    ]);

    const answer: ReturnType<typeof getOnCallAnswer> = getOnCallAnswer({
      spans: spans,
      isShiftsLoading: false,
      isOnCallResponder: true,
    });

    expect(answer.state).toBe(OnCallState.OnCallNow);
    expect(answer.span?.key).toBe("now");
  });

  test("otherwise the first shift ahead is next", () => {
    const answer: ReturnType<typeof getOnCallAnswer> = getOnCallAnswer({
      spans: spansOf([
        shift({ shiftKey: "tomorrow", start: at(DAY), end: at(DAY + HOUR) }),
      ]),
      isShiftsLoading: false,
      isOnCallResponder: null,
    });

    expect(answer.state).toBe(OnCallState.NextShift);
    expect(answer.span?.key).toBe("tomorrow");
  });

  test("on a policy with no shift: directly, through a team, or a schedule further out", () => {
    expect(
      getOnCallAnswer({
        spans: [],
        isShiftsLoading: false,
        isOnCallResponder: true,
      }).state,
    ).toBe(OnCallState.OnPolicy);
    // The shifts could not be read, but the checklist says a policy reaches them.
    expect(
      getOnCallAnswer({
        spans: null,
        isShiftsLoading: false,
        isOnCallResponder: true,
      }).state,
    ).toBe(OnCallState.OnPolicy);
  });

  test("not on call only when both reads say so", () => {
    expect(
      getOnCallAnswer({
        spans: [],
        isShiftsLoading: false,
        isOnCallResponder: false,
      }).state,
    ).toBe(OnCallState.NotOnCall);
    // The shifts failed: no claim.
    expect(
      getOnCallAnswer({
        spans: null,
        isShiftsLoading: false,
        isOnCallResponder: false,
      }).state,
    ).toBe(OnCallState.Unknown);
    // The checklist is unknown: no claim either.
    expect(
      getOnCallAnswer({
        spans: [],
        isShiftsLoading: false,
        isOnCallResponder: null,
      }).state,
    ).toBe(OnCallState.Unknown);
  });
});

describe("the card's tiles", () => {
  test("a new member, set up, not on call: reached, then the test page is next", () => {
    const steps: MemberFirstSteps = buildMemberFirstSteps(input());

    expect(stepsOf(steps)).toEqual([
      "on_call",
      "reach:done",
      "mobile_app",
      "test_page:next",
    ]);
    expect(tile(steps, MemberStep.OnCall).title).toBe(
      MEMBER_FIRST_STEPS_COPY.notOnCall,
    );
    expect(tile(steps, MemberStep.OnCall).pageMap).toBeUndefined();
    expect(steps.openCount).toBe(1);
    expect(steps.isFinished).toBe(false);
  });

  test("reaching the person is next while it is not done, and leads to the checklist", () => {
    const steps: MemberFirstSteps = buildMemberFirstSteps(
      input({ checklist: checklistFor({ methods: [method("SMS", false)] }) }),
    );
    const reach: MemberStepTile = tile(steps, MemberStep.Reach);

    expect(stepsOf(steps)).toEqual([
      "on_call",
      "reach:next",
      "mobile_app",
      "test_page",
    ]);
    expect(reach.title).toBe(MEMBER_FIRST_STEPS_COPY.reachTitle);
    expect(reach.pageMap).toBe(PageMap.USER_SETTINGS_SETUP);
    expect(reach.countLine?.template).toBe(MEMBER_FIRST_STEPS_COPY.stepsLeft);
    expect(reach.countLine?.count).toBe(
      getOpenStepCount(checklistFor({ methods: [method("SMS", false)] })),
    );
    expect(reach.description).toBe(
      checklistFor({ methods: [method("SMS", false)] }).headline,
    );
    expect(steps.openCount).toBe(2);
  });

  test("only email on call leads to Notification Methods", () => {
    const reach: MemberStepTile = tile(
      buildMemberFirstSteps(
        input({ checklist: checklistFor({ reachedVia: ["Team"] }) }),
      ),
      MemberStep.Reach,
    );

    expect(reach.title).toBe(MEMBER_FIRST_STEPS_COPY.onlyEmailTitle);
    expect(reach.description).toBe(
      MEMBER_FIRST_STEPS_COPY.onlyEmailDescription,
    );
    expect(reach.pageMap).toBe(PageMap.USER_SETTINGS_NOTIFICATION_METHODS);
    expect(reach.isDone).toBe(false);
    expect(reach.isNext).toBe(true);
  });

  test("a server without email says so, for only email and beside other methods", () => {
    const cannot: MemberStepTile = tile(
      buildMemberFirstSteps(input({ canSendEmail: false })),
      MemberStep.Reach,
    );

    expect(cannot.title).toBe(MEMBER_FIRST_STEPS_COPY.emailCannotReachTitle);
    expect(cannot.pageMap).toBe(PageMap.USER_SETTINGS_NOTIFICATION_METHODS);

    const beside: MemberStepTile = tile(
      buildMemberFirstSteps(
        input({
          canSendEmail: false,
          checklist: checklistFor({
            methods: [method(EMAIL_METHOD_TYPE, true), method("SMS", true)],
          }),
        }),
      ),
      MemberStep.Reach,
    );

    expect(beside.isDone).toBe(true);
    expect(beside.description).toBe(
      MEMBER_FIRST_STEPS_COPY.reachedWithoutEmail,
    );
  });

  test("an unknown checklist asks the person to open it, and claims nothing", () => {
    const steps: MemberFirstSteps = buildMemberFirstSteps(
      input({ checklist: null, isChecklistLoading: false }),
    );

    expect(tile(steps, MemberStep.Reach).description).toBe(
      MEMBER_FIRST_STEPS_COPY.reachUnknown,
    );
    expect(tile(steps, MemberStep.Reach).isDone).toBe(false);
    // Not on call is a claim the checklist must back: no on-call tile.
    expect(stepsOf(steps)).toEqual(["reach:next", "mobile_app", "test_page"]);
  });

  test("while the checklist loads, its tile is grey lines and nothing is next", () => {
    const steps: MemberFirstSteps = buildMemberFirstSteps(
      input({ checklist: null, isChecklistLoading: true }),
    );

    expect(tile(steps, MemberStep.Reach).isLoading).toBe(true);
    expect(tile(steps, MemberStep.Reach).isNext).toBe(false);
    expect(tile(steps, MemberStep.TestPage).isNext).toBe(false);
    expect(steps.isSettling).toBe(true);
  });

  test("the mobile app is done once a push device is registered, and never next", () => {
    const steps: MemberFirstSteps = buildMemberFirstSteps(
      input({
        checklist: checklistFor({
          methods: [
            method(EMAIL_METHOD_TYPE, true),
            method(PUSH_METHOD_TYPE, true),
          ],
        }),
      }),
    );

    expect(tile(steps, MemberStep.MobileApp).isDone).toBe(true);
    expect(tile(steps, MemberStep.MobileApp).isNext).toBe(false);
  });

  test("reached and a test page acknowledged: finished", () => {
    const steps: MemberFirstSteps = buildMemberFirstSteps(
      input({ hasAcknowledgedTestPage: true }),
    );

    expect(stepsOf(steps)).toEqual([
      "on_call",
      "reach:done",
      "mobile_app",
      "test_page:done",
    ]);
    expect(steps.openCount).toBe(0);
    expect(steps.isFinished).toBe(true);
  });

  test("a test page alone does not finish it while the person cannot be reached", () => {
    const steps: MemberFirstSteps = buildMemberFirstSteps(
      input({
        hasAcknowledgedTestPage: true,
        checklist: checklistFor({ reachedVia: ["Team"] }),
      }),
    );

    expect(steps.isFinished).toBe(false);
    expect(steps.openCount).toBe(1);
    expect(tile(steps, MemberStep.Reach).isNext).toBe(true);
  });
});

describe("the on-call tile's words", () => {
  test("on call now: until when, and on which schedule", () => {
    const onCall: MemberStepTile = tile(
      buildMemberFirstSteps(
        input({
          spans: spansOf([
            shift({ shiftKey: "now", start: at(-HOUR), end: at(3 * HOUR) }),
          ]),
        }),
      ),
      MemberStep.OnCall,
    );

    expect(onCall.title).toBe(MEMBER_FIRST_STEPS_COPY.onCallNow);
    expect(onCall.description).toBe(MEMBER_FIRST_STEPS_COPY.onCallUntil);
    // Ends today: the time alone.
    expect(onCall.descriptionValues).toEqual({
      schedule: "Primary",
      time: "18:00",
    });
    expect(onCall.pageMap).toBe(PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED);
    expect(onCall.isInformation).toBe(true);
    expect(onCall.isDone).toBe(false);
  });

  test("a shift still going at the end of the window says until at least", () => {
    const onCall: MemberStepTile = tile(
      buildMemberFirstSteps(
        input({
          spans: spansOf(
            Array.from({ length: 31 }, (_: unknown, index: number) => {
              return shift({
                shiftKey: `turn-${index}`,
                start: at(-HOUR + index * DAY),
                end: at(-HOUR + (index + 1) * DAY),
              });
            }),
          ),
        }),
      ),
      MemberStep.OnCall,
    );

    expect(onCall.title).toBe(MEMBER_FIRST_STEPS_COPY.onCallNow);
    expect(onCall.description).toBe(MEMBER_FIRST_STEPS_COPY.onCallUntilAtLeast);
  });

  test("the next shift tomorrow is named by its day", () => {
    const onCall: MemberStepTile = tile(
      buildMemberFirstSteps(
        input({
          spans: spansOf([
            shift({
              shiftKey: "tomorrow",
              start: "2026-10-15T09:00:00.000Z",
              end: "2026-10-15T17:00:00.000Z",
            }),
          ]),
        }),
      ),
      MemberStep.OnCall,
    );

    expect(onCall.title).toBe(MEMBER_FIRST_STEPS_COPY.nextShiftDay);
    expect(onCall.titleValues).toEqual({ day: "Tomorrow", time: "09:00" });
    expect(onCall.descriptionValues).toEqual({
      schedule: "Primary",
      time: "17:00",
    });
  });

  test("within the week by its weekday, later by its date", () => {
    const tuesday: MemberStepTile = tile(
      buildMemberFirstSteps(
        input({
          spans: spansOf([
            shift({
              shiftKey: "tuesday",
              start: "2026-10-20T09:00:00.000Z",
              end: "2026-10-20T17:00:00.000Z",
            }),
          ]),
        }),
      ),
      MemberStep.OnCall,
    );

    expect(tuesday.titleValues).toEqual({ day: "Tuesday", time: "09:00" });

    const later: MemberStepTile = tile(
      buildMemberFirstSteps(
        input({
          spans: spansOf([
            shift({
              shiftKey: "later",
              start: "2026-10-27T09:00:00.000Z",
              end: "2026-10-28T09:00:00.000Z",
            }),
          ]),
        }),
      ),
      MemberStep.OnCall,
    );

    expect(later.title).toBe(MEMBER_FIRST_STEPS_COPY.nextShiftDate);
    expect(later.titleValues?.["dateTime"]).toContain("Oct 27");
    // Ends on another day: the day as well.
    expect(later.descriptionValues?.["time"]).toContain("Oct 28");
  });

  test("on a policy with no shifts", () => {
    const onCall: MemberStepTile = tile(
      buildMemberFirstSteps(
        input({ checklist: checklistFor({ reachedVia: ["Direct"] }) }),
      ),
      MemberStep.OnCall,
    );

    expect(onCall.title).toBe(MEMBER_FIRST_STEPS_COPY.onPolicy);
    expect(onCall.pageMap).toBe(PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED);
  });

  test("while the shifts load, grey lines that lead nowhere", () => {
    const onCall: MemberStepTile = tile(
      buildMemberFirstSteps(input({ spans: null, isShiftsLoading: true })),
      MemberStep.OnCall,
    );

    expect(onCall.isLoading).toBe(true);
    expect(onCall.pageMap).toBeUndefined();
  });
});
