import { describe, expect, test } from "@jest/globals";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import {
  CustomFieldProbe,
  DeliverableSettingsProbe,
  IncomingCallProbe,
  OnCallShiftAlertProbe,
  SetupChecklist,
  SetupChecklistInput,
  SetupHeadlineStatus,
  SetupSection,
  SetupStep,
  SetupStepImportance,
  SetupStepStatus,
  WorkspaceProbe,
  buildSetupChecklist,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/ChecklistModel";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import {
  ReadinessCoverageCellWire,
  ReadinessMethodWire,
  ReadinessStatusValue,
  ResponderSourceValue,
  UserReadinessWire,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ReadinessTypes";

/*
 * WHAT THIS FILE STANDS GUARD OVER.
 *
 * The checklist's whole value is that it tells somebody the truth about their
 * own notification setup. Every way it could lie is cheap to introduce and
 * expensive to notice in production, because the reader has no second source -
 * if the page says "Done", they stop looking. The failures below are the ones
 * that would produce a page that looks fine and is wrong:
 *
 *   - crediting work that does not exist. A project with no alert severities
 *     has no alert cells, and counting "no gaps" as "you set this up" both
 *     flatters the reader and hides the moment an admin adds the first
 *     severity and the step silently becomes a real gap.
 *   - counting a step the reader cannot do. A verified method on a channel the
 *     project switched off is not their failure and not their fix; a progress
 *     bar that can never reach the end is a progress bar people stop reading.
 *   - turning "we could not check" into "you have not done it". Every probe can
 *     fail independently, and an unknown probe must produce NO step rather than
 *     a task the reader cannot complete because it was never real.
 *   - stating a consequence without knowing the fallback switch. "Those pages
 *     still reach you" and "those pages are dropped" are both plausible
 *     sentences and only one is true; guessing the reassuring one costs a page.
 *   - letting optional work mask required work. Connecting Slack must never
 *     move somebody towards "ready" while nothing can page them.
 *
 * The model is pure, so all of this is testable without a browser, a server or
 * a clock - which is the reason it was written as a separate module at all.
 */

const SEVERITY_ONE: string = "11111111-1111-4111-8111-111111111111";
const SEVERITY_TWO: string = "22222222-2222-4222-8222-222222222222";
const SEVERITY_THREE: string = "33333333-3333-4333-8333-333333333333";
const SEVERITY_FOUR: string = "44444444-4444-4444-8444-444444444444";

type MakeCellFunction = (params: {
  ruleType: NotificationRuleType;
  severityId: string;
  severityName: string;
  hasRule?: boolean | undefined;
  isOptOut?: boolean | undefined;
}) => ReadinessCoverageCellWire;

const makeCell: MakeCellFunction = (params: {
  ruleType: NotificationRuleType;
  severityId: string;
  severityName: string;
  hasRule?: boolean | undefined;
  isOptOut?: boolean | undefined;
}): ReadinessCoverageCellWire => {
  return {
    ruleType: params.ruleType,
    severityId: params.severityId,
    severityName: params.severityName,
    hasRule: params.hasRule ?? true,
    isOptOut: params.isOptOut ?? false,
  };
};

type MakeMethodFunction = (
  methodType: string,
  isVerified: boolean,
) => ReadinessMethodWire;

const makeMethod: MakeMethodFunction = (
  methodType: string,
  isVerified: boolean,
): ReadinessMethodWire => {
  return {
    methodId: `method-${methodType}`,
    methodType: methodType,
    maskedIdentifier: "•••",
    isVerified: isVerified,
  };
};

/*
 * Full coverage across all four rule types and two severities of each kind.
 * Tests that want a gap punch a hole in this rather than building a payload
 * from nothing, so the thing under test is the hole and not the fixture.
 */
type FullCoverageFunction = () => Array<ReadinessCoverageCellWire>;

const fullCoverage: FullCoverageFunction =
  (): Array<ReadinessCoverageCellWire> => {
    return [
      makeCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: SEVERITY_ONE,
        severityName: "Sev1",
      }),
      makeCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: SEVERITY_TWO,
        severityName: "Sev2",
      }),
      makeCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        severityId: SEVERITY_ONE,
        severityName: "Sev1",
      }),
      makeCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        severityId: SEVERITY_TWO,
        severityName: "Sev2",
      }),
      makeCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityId: SEVERITY_THREE,
        severityName: "Warning",
      }),
      makeCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityId: SEVERITY_FOUR,
        severityName: "Critical",
      }),
      makeCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
        severityId: SEVERITY_THREE,
        severityName: "Warning",
      }),
      makeCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
        severityId: SEVERITY_FOUR,
        severityName: "Critical",
      }),
    ];
  };

type MakeReadinessFunction = (params?: {
  status?: ReadinessStatusValue | undefined;
  methods?: Array<ReadinessMethodWire> | undefined;
  coverage?: Array<ReadinessCoverageCellWire> | undefined;
  reachedVia?: Array<ResponderSourceValue> | undefined;
}) => UserReadinessWire;

const makeReadiness: MakeReadinessFunction = (params?: {
  status?: ReadinessStatusValue | undefined;
  methods?: Array<ReadinessMethodWire> | undefined;
  coverage?: Array<ReadinessCoverageCellWire> | undefined;
  reachedVia?: Array<ResponderSourceValue> | undefined;
}): UserReadinessWire => {
  return {
    userId: "99999999-9999-4999-8999-999999999999",
    userName: "Ada Lovelace",
    userEmail: "ada@example.com",
    status: params?.status ?? "Ready",
    methods: params?.methods ?? [makeMethod("Email", true)],
    coverage: params?.coverage ?? fullCoverage(),
    reasons: [],
    reachedVia: params?.reachedVia ?? ["Team"],
    /*
     * The teams that page this responder. Empty here because nothing in this
     * checklist reads them - it asks whether the signed-in user's own setup is
     * complete, not which door pages reach them through.
     */
    teams: [],
  };
};

const KNOWN_SHIFT_ALERTS: OnCallShiftAlertProbe = {
  isKnown: true,
  hasAnyChannelEnabled: true,
};

const KNOWN_DELIVERABLE: DeliverableSettingsProbe = {
  isKnown: true,
  undeliverableChannels: [],
};

const KNOWN_NO_INCOMING_CALL: IncomingCallProbe = {
  isKnown: true,
  hasPolicyInProject: false,
  hasVerifiedNumber: false,
};

const KNOWN_NO_WORKSPACE: WorkspaceProbe = {
  isKnown: true,
  isConnectedForProject: false,
  isConnectedForUser: false,
};

const KNOWN_NO_CUSTOM_FIELDS: CustomFieldProbe = {
  isKnown: true,
  fieldCount: 0,
  filledFieldCount: 0,
};

type MakeInputFunction = (
  overrides?: Partial<SetupChecklistInput> | undefined,
) => SetupChecklistInput;

const makeInput: MakeInputFunction = (
  overrides?: Partial<SetupChecklistInput> | undefined,
): SetupChecklistInput => {
  return {
    readiness: makeReadiness(),
    isFallbackEnabled: true,
    isFallbackKnown: true,
    onCallShiftAlerts: KNOWN_SHIFT_ALERTS,
    deliverableSettings: KNOWN_DELIVERABLE,
    incomingCall: KNOWN_NO_INCOMING_CALL,
    slack: KNOWN_NO_WORKSPACE,
    microsoftTeams: KNOWN_NO_WORKSPACE,
    customFields: KNOWN_NO_CUSTOM_FIELDS,
    ...overrides,
  };
};

type AllStepsFunction = (checklist: SetupChecklist) => Array<SetupStep>;

const allSteps: AllStepsFunction = (
  checklist: SetupChecklist,
): Array<SetupStep> => {
  return checklist.sections.flatMap(
    (section: SetupSection): Array<SetupStep> => {
      return section.steps;
    },
  );
};

type FindStepFunction = (
  checklist: SetupChecklist,
  key: string,
) => SetupStep | undefined;

const findStep: FindStepFunction = (
  checklist: SetupChecklist,
  key: string,
): SetupStep | undefined => {
  return allSteps(checklist).find((step: SetupStep): boolean => {
    return step.key === key;
  });
};

type StepKeysFunction = (checklist: SetupChecklist) => Array<string>;

const stepKeys: StepKeysFunction = (
  checklist: SetupChecklist,
): Array<string> => {
  return allSteps(checklist).map((step: SetupStep): string => {
    return step.key;
  });
};

describe("setup checklist - reaching you at all", () => {
  test("asks for a notification method when the user has none", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "NotReachable",
          methods: [],
        }),
      }),
    );

    const step: SetupStep | undefined = findStep(checklist, "add-method");

    expect(step).toBeDefined();
    expect(step!.status).toBe(SetupStepStatus.Incomplete);
    expect(step!.importance).toBe(SetupStepImportance.Required);
    expect(step!.pageMap).toBe(PageMap.USER_SETTINGS_NOTIFICATION_METHODS);
    expect(step!.detail).toBe(
      "You have no notification methods on this project.",
    );
  });

  /*
   * "Add a method" and "verify your methods" are one action for somebody with
   * nothing at all. Showing both makes the list look twice as long as the work
   * and puts a task on screen that cannot be started.
   */
  test("does not ask to verify methods when there are no methods to verify", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "NotReachable",
          methods: [],
        }),
      }),
    );

    expect(stepKeys(checklist)).not.toContain("verify-methods");
  });

  test("asks to verify once a method exists but is unverified", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "NotReachable",
          methods: [makeMethod("SMS", false)],
        }),
      }),
    );

    const addStep: SetupStep | undefined = findStep(checklist, "add-method");
    const verifyStep: SetupStep | undefined = findStep(
      checklist,
      "verify-methods",
    );

    expect(addStep!.status).toBe(SetupStepStatus.Complete);
    expect(verifyStep!.status).toBe(SetupStepStatus.Incomplete);
    expect(verifyStep!.detail).toBe(
      "1 method is still waiting to be verified.",
    );
  });

  test("counts several unverified methods in the plural", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "PartiallyReady",
          methods: [
            makeMethod("Email", true),
            makeMethod("SMS", false),
            makeMethod("Call", false),
          ],
        }),
      }),
    );

    expect(findStep(checklist, "verify-methods")!.detail).toBe(
      "2 methods are still waiting to be verified.",
    );
  });

  /*
   * The trap this whole step exists for. All four paid channels default to OFF
   * on a project, so somebody who verifies only SMS sees a green tick on their
   * methods page and is reported NotReachable - and the fix is an admin's, not
   * theirs.
   */
  test("marks a verified-but-switched-off channel as blocked, with no link", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "NotReachable",
          methods: [makeMethod("SMS", true)],
        }),
      }),
    );

    const step: SetupStep | undefined = findStep(checklist, "channels-enabled");

    expect(step!.status).toBe(SetupStepStatus.Blocked);
    expect(step!.pageMap).toBeUndefined();
    expect(step!.actionTitle).toBe(
      "Ask a project admin to enable this channel",
    );
    expect(step!.detail).toContain("Ask a project admin to enable it");
  });

  /*
   * The number that reconciles a full progress bar with a red headline. Without
   * it somebody whose only verified method is on a switched-off channel reads
   * "N of N essential steps done" directly under "Nothing can reach you yet".
   */
  test("reports blocked steps separately from the progress counts", () => {
    const blocked: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "NotReachable",
          methods: [makeMethod("SMS", true)],
        }),
      }),
    );

    expect(blocked.blockedCount).toBe(1);
    expect(blocked.completedCount).toBe(blocked.totalCount);
    expect(blocked.headlineStatus).toBe(SetupHeadlineStatus.NotReachable);

    const healthy: SetupChecklist = buildSetupChecklist(makeInput());

    expect(healthy.blockedCount).toBe(0);
  });

  test("a blocked channel step is not counted towards progress", () => {
    const blocked: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "NotReachable",
          methods: [makeMethod("SMS", true)],
        }),
      }),
    );

    const counted: Array<SetupStep> = allSteps(blocked).filter(
      (step: SetupStep): boolean => {
        return (
          step.importance !== SetupStepImportance.Optional &&
          (step.status === SetupStepStatus.Complete ||
            step.status === SetupStepStatus.Incomplete)
        );
      },
    );

    expect(blocked.totalCount).toBe(counted.length);
    expect(
      counted.some((step: SetupStep): boolean => {
        return step.key === "channels-enabled";
      }),
    ).toBe(false);
  });

  test("the channel step is complete, and links onward, when nothing is switched off", () => {
    const checklist: SetupChecklist = buildSetupChecklist(makeInput());
    const step: SetupStep | undefined = findStep(checklist, "channels-enabled");

    expect(step!.status).toBe(SetupStepStatus.Complete);
    expect(step!.pageMap).toBe(PageMap.USER_SETTINGS_NOTIFICATION_METHODS);
  });

  /*
   * A user whose only method is an unverified one has nothing usable, so there
   * is no channel to be switched off yet and the step would be asking about
   * something that does not exist.
   */
  test("omits the channel step entirely when no method is verified", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "NotReachable",
          methods: [makeMethod("Email", false)],
        }),
      }),
    );

    expect(stepKeys(checklist)).not.toContain("channels-enabled");
  });
});

describe("setup checklist - paging rules", () => {
  test("one step per rule type, each pointing at its own page", () => {
    const checklist: SetupChecklist = buildSetupChecklist(makeInput());

    expect(findStep(checklist, "incident-rules")!.pageMap).toBe(
      PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES,
    );
    expect(findStep(checklist, "incident-episode-rules")!.pageMap).toBe(
      PageMap.USER_SETTINGS_INCIDENT_EPISODE_ON_CALL_RULES,
    );
    expect(findStep(checklist, "alert-rules")!.pageMap).toBe(
      PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES,
    );
    expect(findStep(checklist, "alert-episode-rules")!.pageMap).toBe(
      PageMap.USER_SETTINGS_ALERT_EPISODE_ON_CALL_RULES,
    );
  });

  test("a rule type with full coverage is complete and says nothing more", () => {
    const checklist: SetupChecklist = buildSetupChecklist(makeInput());
    const step: SetupStep | undefined = findStep(checklist, "incident-rules");

    expect(step!.status).toBe(SetupStepStatus.Complete);
    expect(step!.detail).toBe("");
  });

  test("names the severities that have no rule", () => {
    const coverage: Array<ReadinessCoverageCellWire> = fullCoverage().map(
      (cell: ReadinessCoverageCellWire): ReadinessCoverageCellWire => {
        if (
          cell.ruleType === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT &&
          cell.severityName === "Sev2"
        ) {
          return { ...cell, hasRule: false };
        }

        return cell;
      },
    );

    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "PartiallyReady",
          coverage: coverage,
        }),
      }),
    );

    const step: SetupStep | undefined = findStep(checklist, "incident-rules");

    expect(step!.status).toBe(SetupStepStatus.Incomplete);
    expect(step!.detail).toBe("Sev2 has no rule.");
  });

  test("joins two missing severities with 'and', and uses the plural verb", () => {
    const coverage: Array<ReadinessCoverageCellWire> = fullCoverage().map(
      (cell: ReadinessCoverageCellWire): ReadinessCoverageCellWire => {
        if (cell.ruleType === NotificationRuleType.ON_CALL_EXECUTED_ALERT) {
          return { ...cell, hasRule: false };
        }

        return cell;
      },
    );

    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "PartiallyReady",
          coverage: coverage,
        }),
      }),
    );

    expect(findStep(checklist, "alert-rules")!.detail).toBe(
      "Warning and Critical have no rule.",
    );
  });

  /*
   * A project can carry sixteen severities. Naming all of them produces a line
   * longer than the tile it sits in, and a line nobody finishes reading says
   * less than a count does.
   */
  test("stops naming severities after three and counts the rest", () => {
    const many: Array<ReadinessCoverageCellWire> = [
      "Sev1",
      "Sev2",
      "Sev3",
      "Sev4",
      "Sev5",
    ].map((name: string, index: number): ReadinessCoverageCellWire => {
      return makeCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: `severity-${index}`,
        severityName: name,
        hasRule: false,
      });
    });

    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "PartiallyReady",
          coverage: many,
        }),
      }),
    );

    expect(findStep(checklist, "incident-rules")!.detail).toBe(
      "Sev1, Sev2, Sev3 and 2 more have no rule.",
    );
  });

  /*
   * An opted-out cell is deliberate silence, which readiness treats as covered.
   * The checklist must agree, or it will nag somebody about a choice they made
   * on purpose.
   */
  test("treats an opted-out severity as covered rather than as a gap", () => {
    const coverage: Array<ReadinessCoverageCellWire> = fullCoverage().map(
      (cell: ReadinessCoverageCellWire): ReadinessCoverageCellWire => {
        if (
          cell.ruleType === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT &&
          cell.severityName === "Sev1"
        ) {
          return { ...cell, hasRule: false, isOptOut: true };
        }

        return cell;
      },
    );

    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({ coverage: coverage }),
      }),
    );

    expect(findStep(checklist, "incident-rules")!.status).toBe(
      SetupStepStatus.Complete,
    );
  });

  /*
   * The flattery bug. No cells means the project has no severities of that
   * kind, so there is no work and nothing to congratulate - and calling it
   * "Done" would turn into a silent gap the day an admin creates the first one.
   */
  test("a rule type with no severities at all is not applicable, never complete", () => {
    const incidentOnly: Array<ReadinessCoverageCellWire> =
      fullCoverage().filter((cell: ReadinessCoverageCellWire): boolean => {
        return (
          cell.ruleType === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT ||
          cell.ruleType ===
            NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE
        );
      });

    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({ coverage: incidentOnly }),
      }),
    );

    const alertStep: SetupStep | undefined = findStep(checklist, "alert-rules");

    expect(alertStep!.status).toBe(SetupStepStatus.NotApplicable);
    expect(alertStep!.detail).toBe("This project has no alert severities yet.");
  });

  test("a not-applicable rule type is excluded from the progress total", () => {
    const incidentOnly: Array<ReadinessCoverageCellWire> =
      fullCoverage().filter((cell: ReadinessCoverageCellWire): boolean => {
        return cell.ruleType === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
      });

    const withAlerts: SetupChecklist = buildSetupChecklist(makeInput());
    const withoutAlerts: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({ coverage: incidentOnly }),
      }),
    );

    // three rule types dropped out of the count, and nothing else changed.
    expect(withoutAlerts.totalCount).toBe(withAlerts.totalCount - 3);
  });

  test("counts a cell with no severity name rather than naming nothing", () => {
    const unnamed: Array<ReadinessCoverageCellWire> = [
      {
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        hasRule: false,
        isOptOut: false,
      },
      {
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        hasRule: false,
        isOptOut: false,
      },
    ];

    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "PartiallyReady",
          coverage: unnamed,
        }),
      }),
    );

    expect(findStep(checklist, "incident-rules")!.detail).toBe(
      "2 severities have no rule.",
    );
  });
});

describe("setup checklist - staying informed", () => {
  test("asks a responder on a schedule to switch on the shift notification", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({ reachedVia: ["Schedule"] }),
        onCallShiftAlerts: { isKnown: true, hasAnyChannelEnabled: false },
      }),
    );

    const step: SetupStep | undefined = findStep(
      checklist,
      "on-call-shift-alerts",
    );

    expect(step!.status).toBe(SetupStepStatus.Incomplete);
    expect(step!.importance).toBe(SetupStepImportance.Recommended);
    expect(step!.pageMap).toBe(PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS);
  });

  /*
   * A switch about an event that will never fire is not a task. Somebody on no
   * policy has no shifts to be told about.
   */
  test("omits the shift notification step for somebody who is not on call", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({ reachedVia: [] }),
        onCallShiftAlerts: { isKnown: true, hasAnyChannelEnabled: false },
      }),
    );

    expect(stepKeys(checklist)).not.toContain("on-call-shift-alerts");
  });

  /*
   * The event is emitted when a SCHEDULE's roster rotates. A responder attached
   * directly, through a team or by an override has no roster, so the switch
   * governs something that cannot happen to them.
   */
  test("omits the shift notification step for a responder with no schedule", () => {
    ["Direct", "Team", "Override"].forEach((source: string): void => {
      const checklist: SetupChecklist = buildSetupChecklist(
        makeInput({
          readiness: makeReadiness({
            reachedVia: [source as ResponderSourceValue],
          }),
          onCallShiftAlerts: { isKnown: true, hasAnyChannelEnabled: false },
        }),
      );

      expect(stepKeys(checklist)).not.toContain("on-call-shift-alerts");
    });
  });

  test("shows it for somebody reached through both a team and a schedule", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({ reachedVia: ["Team", "Schedule"] }),
        onCallShiftAlerts: { isKnown: true, hasAnyChannelEnabled: false },
      }),
    );

    expect(stepKeys(checklist)).toContain("on-call-shift-alerts");
  });

  test("names the channels that are switched on but cannot deliver", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        deliverableSettings: {
          isKnown: true,
          undeliverableChannels: ["SMS", "Call"],
        },
      }),
    );

    const step: SetupStep | undefined = findStep(
      checklist,
      "deliverable-settings",
    );

    expect(step!.status).toBe(SetupStepStatus.Incomplete);
    expect(step!.detail).toBe(
      "You switched on SMS and Call, but have no verified method there, so those updates are not sent.",
    );
    expect(step!.pageMap).toBe(PageMap.USER_SETTINGS_NOTIFICATION_METHODS);
  });

  test("is complete when every switched-on channel has a verified method", () => {
    const checklist: SetupChecklist = buildSetupChecklist(makeInput());

    expect(findStep(checklist, "deliverable-settings")!.status).toBe(
      SetupStepStatus.Complete,
    );
  });
});

describe("setup checklist - a probe that could not be read", () => {
  /*
   * The single rule these four cases pin: an unknown probe produces NO step.
   * The alternative - defaulting to "not done" - invents a task the reader
   * cannot finish, and defaulting to "done" hides one they should.
   */
  test("an unreadable notification-settings probe drops both of its steps", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        onCallShiftAlerts: { isKnown: false, hasAnyChannelEnabled: false },
        deliverableSettings: { isKnown: false, undeliverableChannels: [] },
      }),
    );

    expect(stepKeys(checklist)).not.toContain("on-call-shift-alerts");
    expect(stepKeys(checklist)).not.toContain("deliverable-settings");
  });

  test("an unreadable incoming-call probe drops its step", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        incomingCall: {
          isKnown: false,
          hasPolicyInProject: true,
          hasVerifiedNumber: false,
        },
      }),
    );

    expect(stepKeys(checklist)).not.toContain("incoming-call-number");
  });

  test("an unreadable workspace probe drops its step", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        slack: {
          isKnown: false,
          isConnectedForProject: true,
          isConnectedForUser: false,
        },
      }),
    );

    expect(stepKeys(checklist)).not.toContain("slack");
  });

  test("an unreadable custom-field probe drops its step", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        customFields: { isKnown: false, fieldCount: 4, filledFieldCount: 0 },
      }),
    );

    expect(stepKeys(checklist)).not.toContain("custom-fields");
  });
});

describe("setup checklist - optional steps", () => {
  test("shows the incoming call step only when the project routes inbound calls", () => {
    const without: SetupChecklist = buildSetupChecklist(makeInput());

    expect(stepKeys(without)).not.toContain("incoming-call-number");

    const withPolicy: SetupChecklist = buildSetupChecklist(
      makeInput({
        incomingCall: {
          isKnown: true,
          hasPolicyInProject: true,
          hasVerifiedNumber: false,
        },
      }),
    );

    const step: SetupStep | undefined = findStep(
      withPolicy,
      "incoming-call-number",
    );

    expect(step!.status).toBe(SetupStepStatus.Incomplete);
    expect(step!.importance).toBe(SetupStepImportance.Optional);
    expect(step!.pageMap).toBe(
      PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS,
    );
  });

  /*
   * Asking somebody to connect a workspace their project has never connected
   * is a task with no possible completion - the Connect button on that page
   * cannot even build its OAuth link.
   */
  test("shows a workspace step only when the project connected that workspace", () => {
    const notConnected: SetupChecklist = buildSetupChecklist(makeInput());

    expect(stepKeys(notConnected)).not.toContain("slack");
    expect(stepKeys(notConnected)).not.toContain("microsoft-teams");

    const connected: SetupChecklist = buildSetupChecklist(
      makeInput({
        slack: {
          isKnown: true,
          isConnectedForProject: true,
          isConnectedForUser: false,
        },
        microsoftTeams: {
          isKnown: true,
          isConnectedForProject: true,
          isConnectedForUser: true,
        },
      }),
    );

    expect(findStep(connected, "slack")!.status).toBe(
      SetupStepStatus.Incomplete,
    );
    expect(findStep(connected, "microsoft-teams")!.status).toBe(
      SetupStepStatus.Complete,
    );
  });

  test("shows the custom fields step only when the project defines fields", () => {
    const none: SetupChecklist = buildSetupChecklist(makeInput());

    expect(stepKeys(none)).not.toContain("custom-fields");

    const partial: SetupChecklist = buildSetupChecklist(
      makeInput({
        customFields: { isKnown: true, fieldCount: 3, filledFieldCount: 2 },
      }),
    );

    const step: SetupStep | undefined = findStep(partial, "custom-fields");

    expect(step!.status).toBe(SetupStepStatus.Incomplete);
    expect(step!.detail).toBe("1 field is still empty.");
  });

  test("custom fields are complete when every field has a value", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        customFields: { isKnown: true, fieldCount: 3, filledFieldCount: 3 },
      }),
    );

    expect(findStep(checklist, "custom-fields")!.status).toBe(
      SetupStepStatus.Complete,
    );
    expect(findStep(checklist, "custom-fields")!.detail).toBe("");
  });

  /*
   * The one that keeps the progress bar meaningful: an optional integration
   * must never move somebody towards "ready" while nothing can page them.
   */
  test("optional steps never change the progress numbers", () => {
    const baseline: SetupChecklist = buildSetupChecklist(makeInput());

    const withOptional: SetupChecklist = buildSetupChecklist(
      makeInput({
        slack: {
          isKnown: true,
          isConnectedForProject: true,
          isConnectedForUser: true,
        },
        customFields: { isKnown: true, fieldCount: 2, filledFieldCount: 0 },
        incomingCall: {
          isKnown: true,
          hasPolicyInProject: true,
          hasVerifiedNumber: false,
        },
      }),
    );

    expect(withOptional.totalCount).toBe(baseline.totalCount);
    expect(withOptional.completedCount).toBe(baseline.completedCount);
  });

  test("the optional section disappears when it would be empty", () => {
    const checklist: SetupChecklist = buildSetupChecklist(makeInput());

    expect(
      checklist.sections.some((section: SetupSection): boolean => {
        return section.key === "optional";
      }),
    ).toBe(false);
  });
});

describe("setup checklist - the headline", () => {
  test("is red when nothing can reach the user", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({ status: "NotReachable", methods: [] }),
      }),
    );

    expect(checklist.headlineStatus).toBe(SetupHeadlineStatus.NotReachable);
    expect(checklist.headline).toBe("Nothing can reach you yet");
  });

  /*
   * Unreachable outranks "not on call". Somebody added to a policy tomorrow is
   * unreachable from that moment, and this is the only screen that would have
   * warned them today.
   */
  test("says unreachable even for somebody who is not on call yet", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "NotReachable",
          methods: [],
          reachedVia: [],
        }),
      }),
    );

    expect(checklist.headlineStatus).toBe(SetupHeadlineStatus.NotReachable);
  });

  test("is amber when there are rule gaps", () => {
    const coverage: Array<ReadinessCoverageCellWire> = fullCoverage().map(
      (cell: ReadinessCoverageCellWire): ReadinessCoverageCellWire => {
        return cell.severityName === "Sev1"
          ? { ...cell, hasRule: false }
          : cell;
      },
    );

    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "PartiallyReady",
          coverage: coverage,
        }),
      }),
    );

    expect(checklist.headlineStatus).toBe(SetupHeadlineStatus.NeedsSetup);
  });

  test("is green, and silent, for a ready responder", () => {
    const checklist: SetupChecklist = buildSetupChecklist(makeInput());

    expect(checklist.headlineStatus).toBe(SetupHeadlineStatus.Ready);
    expect(checklist.headlineConsequence).toBe("");
  });

  test("distinguishes a set-up user who is not on any policy", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({ reachedVia: [] }),
      }),
    );

    expect(checklist.headlineStatus).toBe(SetupHeadlineStatus.NotOnCall);
    expect(checklist.isOnCallResponder).toBe(false);
    expect(checklist.headlineConsequence).toBe("");
  });

  /*
   * The headline speaks for the whole list. Readiness can be Ready while a
   * counted step is still outstanding, and "You are all set" printed above a row
   * the reader still has to do is a contradiction they will notice immediately.
   */
  test("is not green while a counted step is still outstanding", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        deliverableSettings: {
          isKnown: true,
          undeliverableChannels: ["SMS"],
        },
      }),
    );

    expect(checklist.completedCount).toBeLessThan(checklist.totalCount);
    expect(checklist.headlineStatus).toBe(SetupHeadlineStatus.NeedsSetup);
    expect(checklist.headline).not.toBe("You are all set");
  });

  /*
   * Every branch of the consequence sentence ends in what happens to "pages
   * routed to you". No pages are routed to somebody no policy reaches, so the
   * sentence would describe something that cannot currently happen.
   */
  test("says nothing about consequences to somebody who is not on call", () => {
    const coverage: Array<ReadinessCoverageCellWire> = fullCoverage().map(
      (cell: ReadinessCoverageCellWire): ReadinessCoverageCellWire => {
        return cell.severityName === "Sev1"
          ? { ...cell, hasRule: false }
          : cell;
      },
    );

    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "PartiallyReady",
          coverage: coverage,
          reachedVia: [],
        }),
      }),
    );

    expect(checklist.headlineStatus).toBe(SetupHeadlineStatus.NeedsSetup);
    expect(checklist.headlineConsequence).toBe("");
    // the gap is still named on the step itself.
    expect(findStep(checklist, "incident-rules")!.detail).toBe(
      "Sev1 has no rule.",
    );
  });

  /*
   * getSelfAddressedConsequence returns a CLAUSE meant to complete "...but ",
   * which is how the reminder email uses it. Printed here it has to be a
   * sentence.
   */
  test("renders the consequence as a sentence, not a lowercase fragment", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({ status: "NotReachable", methods: [] }),
      }),
    );

    expect(checklist.headlineConsequence.length).toBeGreaterThan(0);
    expect(checklist.headlineConsequence.charAt(0)).toBe(
      checklist.headlineConsequence.charAt(0).toUpperCase(),
    );
    expect(checklist.headlineConsequence).toMatch(/^[A-Z]/);
  });

  test("says pages are dropped when the project has no fallback", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        isFallbackEnabled: false,
        readiness: makeReadiness({ status: "NotReachable", methods: [] }),
      }),
    );

    expect(checklist.headlineConsequence).toContain("being dropped");
  });

  /*
   * The sentence has exactly two forms - "still reach you" and "are dropped" -
   * and there is no third that is true either way. If the project's fallback
   * switch could not be read, the checklist says neither.
   */
  test("says nothing about consequences when the fallback switch is unknown", () => {
    const coverage: Array<ReadinessCoverageCellWire> = fullCoverage().map(
      (cell: ReadinessCoverageCellWire): ReadinessCoverageCellWire => {
        return cell.severityName === "Sev1"
          ? { ...cell, hasRule: false }
          : cell;
      },
    );

    const known: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "PartiallyReady",
          coverage: coverage,
        }),
      }),
    );

    const unknown: SetupChecklist = buildSetupChecklist(
      makeInput({
        isFallbackKnown: false,
        readiness: makeReadiness({
          status: "PartiallyReady",
          coverage: coverage,
        }),
      }),
    );

    expect(known.headlineConsequence).not.toBe("");
    expect(unknown.headlineConsequence).toBe("");
    // the steps themselves still name every gap.
    expect(findStep(unknown, "incident-rules")!.detail).toBe(
      "Sev1 has no rule.",
    );
  });
});

describe("setup checklist - shape and progress", () => {
  test("a fully set-up responder has every counted step complete", () => {
    const checklist: SetupChecklist = buildSetupChecklist(makeInput());

    expect(checklist.completedCount).toBe(checklist.totalCount);
    expect(checklist.totalCount).toBeGreaterThan(0);
  });

  test("progress never exceeds the total", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({ status: "NotReachable", methods: [] }),
        slack: {
          isKnown: true,
          isConnectedForProject: true,
          isConnectedForUser: true,
        },
      }),
    );

    expect(checklist.completedCount).toBeLessThanOrEqual(checklist.totalCount);
  });

  test("reachability comes before paging, which comes before the optional tail", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        slack: {
          isKnown: true,
          isConnectedForProject: true,
          isConnectedForUser: false,
        },
      }),
    );

    expect(
      checklist.sections.map((section: SetupSection): string => {
        return section.key;
      }),
    ).toEqual(["reachability", "paging", "awareness", "optional"]);
  });

  test("every step carries a title, a description and an action", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        incomingCall: {
          isKnown: true,
          hasPolicyInProject: true,
          hasVerifiedNumber: false,
        },
        slack: {
          isKnown: true,
          isConnectedForProject: true,
          isConnectedForUser: false,
        },
        microsoftTeams: {
          isKnown: true,
          isConnectedForProject: true,
          isConnectedForUser: false,
        },
        customFields: { isKnown: true, fieldCount: 1, filledFieldCount: 0 },
      }),
    );

    allSteps(checklist).forEach((step: SetupStep): void => {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(0);
      expect(step.actionTitle.length).toBeGreaterThan(0);
    });
  });

  test("step keys are unique, so the rendered rows cannot collide", () => {
    const checklist: SetupChecklist = buildSetupChecklist(
      makeInput({
        incomingCall: {
          isKnown: true,
          hasPolicyInProject: true,
          hasVerifiedNumber: false,
        },
        slack: {
          isKnown: true,
          isConnectedForProject: true,
          isConnectedForUser: false,
        },
        microsoftTeams: {
          isKnown: true,
          isConnectedForProject: true,
          isConnectedForUser: false,
        },
        customFields: { isKnown: true, fieldCount: 1, filledFieldCount: 0 },
      }),
    );

    const keys: Array<string> = stepKeys(checklist);

    expect(new Set<string>(keys).size).toBe(keys.length);
  });

  /*
   * Completion is not a stored flag and must not behave like one: adding a
   * severity, deleting a method or an admin switching a channel off can all
   * turn a finished step back into an outstanding one.
   */
  test("a step goes back to outstanding when the underlying state regresses", () => {
    const before: SetupChecklist = buildSetupChecklist(makeInput());

    expect(findStep(before, "incident-rules")!.status).toBe(
      SetupStepStatus.Complete,
    );

    const withNewSeverity: Array<ReadinessCoverageCellWire> = [
      ...fullCoverage(),
      makeCell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: "brand-new",
        severityName: "Sev3",
        hasRule: false,
      }),
    ];

    const after: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({
          status: "PartiallyReady",
          coverage: withNewSeverity,
        }),
      }),
    );

    expect(findStep(after, "incident-rules")!.status).toBe(
      SetupStepStatus.Incomplete,
    );
    expect(after.completedCount).toBeLessThan(before.completedCount);
  });

  /*
   * The paging section explains itself differently depending on whether the
   * reader is on call, because "you are on call" is the fact that makes the
   * four rule pages urgent rather than hypothetical.
   */
  test("the paging section tells a responder they are on call", () => {
    const responder: SetupChecklist = buildSetupChecklist(makeInput());
    const notResponder: SetupChecklist = buildSetupChecklist(
      makeInput({
        readiness: makeReadiness({ reachedVia: [] }),
      }),
    );

    const pagingOf: (checklist: SetupChecklist) => SetupSection = (
      checklist: SetupChecklist,
    ): SetupSection => {
      return checklist.sections.find((section: SetupSection): boolean => {
        return section.key === "paging";
      })!;
    };

    expect(pagingOf(responder).description).toContain("You are on call");
    expect(pagingOf(notResponder).description).toContain("not on an on-call");
  });
});
