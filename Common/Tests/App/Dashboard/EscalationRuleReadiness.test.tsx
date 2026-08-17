import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE READINESS WARNING, WHERE IT LIVES NOW.
 *
 * It used to be a red block in the footer of the add/edit escalation rule modal,
 * describing whoever the admin had just picked. It is now a LABEL on the
 * escalation level itself, with the detail behind a click, and that move changes
 * what is worth testing:
 *
 *   - the warning has to survive the modal being closed, because whether a
 *     responder can be paged is a property of their account and not of a form
 *     that is open for eight seconds;
 *   - it has to attribute a person to the LEVEL that reaches them, including
 *     through a team or a schedule, which is how responders are usually added;
 *   - it must stay QUIET for the amber state on a normal project, because those
 *     pages still arrive - and must go amber the moment the project's fallback
 *     is off, because then they do not;
 *   - it must be honest about what it has not checked rather than rendering the
 *     same nothing a healthy level renders;
 *   - and the reminder it offers must report what the SERVER said happened,
 *     never that a request was made.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the consts above are still in their temporal dead zone when the
 * factory body runs. Dereferencing them lazily, at call time, is what works.
 */
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import EscalationRules from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules";
import {
  ResponderGroupRef,
  ResponderGroupResolution,
  ResponderGroupResolutions,
  ResponderIssue,
  ResponderRef,
  ResponderVia,
  RuleReadinessDetails,
  RuleReadinessLabel,
  RuleReadinessReport,
  RuleWarningLevel,
  SetupReminderStatus,
  SetupReminderStatuses,
  buildRuleReadinessReport,
  describeResponderVia,
  fetchScheduleUsers,
  fetchTeamMembers,
  getResponderGroupKey,
  getResponderGroupName,
  getRuleWarningLabel,
  getRuleWarningLevel,
  readSetupReminderStatuses,
  requestSetupReminders,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRuleReadiness";
import {
  ReadinessIndex,
  ReadinessSummaryWire,
  buildReadinessIndex,
  parseReadinessSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ReadinessTypes";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const USER_ALEX: string = "aaaaaaaa-1111-4111-8111-111111111111";
const USER_SAM: string = "bbbbbbbb-2222-4222-8222-222222222222";
const USER_JO: string = "cccccccc-3333-4333-8333-333333333333";

const PROJECT_ID: ObjectID = new ObjectID(
  "dddddddd-4444-4444-8444-444444444444",
);
const POLICY_ID: ObjectID = new ObjectID(
  "77777777-9999-4999-8999-999999999999",
);

const RULE_ONE_ID: ObjectID = new ObjectID(
  "88888888-1010-4010-8010-101010101010",
);
const RULE_TWO_ID: ObjectID = new ObjectID(
  "99999999-2020-4020-8020-202020202020",
);

const TEAM_ID: string = "12121212-3030-4030-8030-303030303030";
const SCHEDULE_ID: string = "23232323-4040-4040-8040-404040404040";

type OkResponseFunction = (data: JSONObject) => HTTPResponse<JSONObject>;

const okResponse: OkResponseFunction = (
  data: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

afterEach(() => {
  cleanup();
  getMock.mockReset();
  postMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockReset();
  getCommonHeadersMock.mockReset();
  deleteItemMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

/*
 * ---------------------------------------------------------------------------
 * FIXTURES
 * ---------------------------------------------------------------------------
 *
 * The readiness rows are built through the real parser rather than as literals,
 * so a change to the payload shape breaks these fixtures the same way it would
 * break the browser.
 */
interface UserRow {
  userId: string;
  userName: string;
  status: string;
  methods?: Array<JSONObject> | undefined;
  coverage?: Array<JSONObject> | undefined;
}

type SummaryFunction = (params: {
  users: Array<UserRow>;
  isFallbackEnabled?: boolean | undefined;
}) => ReadinessSummaryWire;

const summaryOf: SummaryFunction = (params: {
  users: Array<UserRow>;
  isFallbackEnabled?: boolean | undefined;
}): ReadinessSummaryWire => {
  return parseReadinessSummary({
    projectId: PROJECT_ID.toString(),
    onCallDutyPolicyId: POLICY_ID.toString(),
    isFallbackEnabled: params.isFallbackEnabled !== false,
    isTruncated: false,
    users: params.users.map((user: UserRow): JSONObject => {
      return {
        userId: user.userId,
        userName: user.userName,
        userEmail: `${user.userName.split(" ")[0]!.toLowerCase()}@example.com`,
        status: user.status,
        methods: user.methods || [],
        coverage: user.coverage || [],
        reasons: [],
        reachedVia: [],
      };
    }),
  } as JSONObject);
};

type IndexFunction = (users: Array<UserRow>) => ReadinessIndex;

const indexOf: IndexFunction = (users: Array<UserRow>): ReadinessIndex => {
  return buildReadinessIndex(summaryOf({ users: users }));
};

const ALEX_UNREACHABLE: UserRow = {
  userId: USER_ALEX,
  userName: "Alex Chen",
  status: "NotReachable",
};

const SAM_READY: UserRow = {
  userId: USER_SAM,
  userName: "Sam Doe",
  status: "Ready",
};

const JO_PARTIAL: UserRow = {
  userId: USER_JO,
  userName: "Jo Park",
  status: "PartiallyReady",
  methods: [
    {
      methodType: "Email",
      maskedIdentifier: "j•••@example.com",
      isVerified: true,
    },
  ],
  coverage: [
    {
      ruleType: "When incident on-call policy is executed",
      severityId: "eeeeeeee-5555-4555-8555-555555555555",
      severityName: "Sev1",
      hasRule: false,
      isOptOut: false,
    },
  ],
};

type ResolvedGroupFunction = (params: {
  kind: "team" | "schedule";
  id: string;
  label: string;
  members: Array<ResponderRef>;
}) => ResponderGroupResolutions;

const resolvedGroup: ResolvedGroupFunction = (params: {
  kind: "team" | "schedule";
  id: string;
  label: string;
  members: Array<ResponderRef>;
}): ResponderGroupResolutions => {
  const key: string = getResponderGroupKey(params.kind, params.id);

  return {
    [key]: {
      key: key,
      kind: params.kind,
      id: params.id,
      label: params.label,
      state: "resolved",
      members: params.members,
    } as ResponderGroupResolution,
  };
};

const TEAM_REF: ResponderGroupRef = {
  kind: "team",
  id: TEAM_ID,
  label: "Payments",
};

const SCHEDULE_REF: ResponderGroupRef = {
  kind: "schedule",
  id: SCHEDULE_ID,
  label: "Weekends",
};

const FALLBACK_ON: { isFallbackEnabled: boolean } = { isFallbackEnabled: true };
const FALLBACK_OFF: { isFallbackEnabled: boolean } = {
  isFallbackEnabled: false,
};

const NO_REMINDERS: SetupReminderStatuses = {};

/*
 * ---------------------------------------------------------------------------
 * WHO A LEVEL REACHES
 * ---------------------------------------------------------------------------
 */
describe("Escalation level readiness: who the level reaches", () => {
  test("a directly named unreachable responder is reported", () => {
    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [{ userId: USER_ALEX, label: "Alex Chen" }],
      groups: [],
      resolutions: {},
      index: indexOf([ALEX_UNREACHABLE]),
      isTruncated: false,
    });

    expect(report.unreachable).toHaveLength(1);
    expect(report.unreachable[0]!.name).toBe("Alex Chen");
    expect(report.responderCount).toBe(1);
    expect(report.checkedCount).toBe(1);
  });

  test("a ready responder produces nothing at all", () => {
    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [{ userId: USER_SAM, label: "Sam Doe" }],
      groups: [],
      resolutions: {},
      index: indexOf([SAM_READY]),
      isTruncated: false,
    });

    expect(report.unreachable).toHaveLength(0);
    expect(report.gaps).toHaveLength(0);
    expect(report.unchecked).toHaveLength(0);
    expect(report.responderCount).toBe(1);
  });

  /*
   * The path responders are usually added by. A guard that only looked at
   * directly-named users was silent exactly when it mattered most.
   */
  test("somebody reached through a team is attributed to the team", () => {
    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [],
      groups: [TEAM_REF],
      resolutions: resolvedGroup({
        kind: "team",
        id: TEAM_ID,
        label: "Payments",
        members: [{ userId: USER_ALEX, label: "Alex Chen" }],
      }),
      index: indexOf([ALEX_UNREACHABLE]),
      isTruncated: false,
    });

    expect(report.unreachable).toHaveLength(1);
    expect(report.unreachable[0]!.via).toEqual([
      { kind: "team", label: "Payments" },
    ]);
  });

  test("somebody on a schedule's roster is attributed to the schedule", () => {
    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [],
      groups: [SCHEDULE_REF],
      resolutions: resolvedGroup({
        kind: "schedule",
        id: SCHEDULE_ID,
        label: "Weekends",
        members: [{ userId: USER_ALEX, label: "Alex Chen" }],
      }),
      index: indexOf([ALEX_UNREACHABLE]),
      isTruncated: false,
    });

    expect(report.unreachable[0]!.via).toEqual([
      { kind: "schedule", label: "Weekends" },
    ]);
  });

  /*
   * One person, every door. An admin who removes somebody from a team and finds
   * them still being paged through a schedule has been failed by a surface that
   * named only the first route it found.
   */
  test("a responder reached twice is reported once, carrying both routes", () => {
    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [{ userId: USER_ALEX, label: "Alex Chen" }],
      groups: [TEAM_REF],
      resolutions: resolvedGroup({
        kind: "team",
        id: TEAM_ID,
        label: "Payments",
        members: [{ userId: USER_ALEX, label: "Alex Chen" }],
      }),
      index: indexOf([ALEX_UNREACHABLE]),
      isTruncated: false,
    });

    expect(report.unreachable).toHaveLength(1);
    expect(report.responderCount).toBe(1);
    expect(report.unreachable[0]!.via).toEqual([
      { kind: "direct", label: "" },
      { kind: "team", label: "Payments" },
    ]);
  });

  test("the same person on three schedule layers is one responder", () => {
    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [],
      groups: [SCHEDULE_REF],
      resolutions: resolvedGroup({
        kind: "schedule",
        id: SCHEDULE_ID,
        label: "Weekends",
        members: [
          { userId: USER_ALEX, label: "Alex Chen" },
          { userId: USER_ALEX, label: "Alex Chen" },
          { userId: USER_ALEX, label: "Alex Chen" },
        ],
      }),
      index: indexOf([ALEX_UNREACHABLE]),
      isTruncated: false,
    });

    expect(report.unreachable).toHaveLength(1);
    expect(report.responderCount).toBe(1);
  });

  test("several unreachable responders are listed by name, alphabetically", () => {
    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [
        { userId: USER_SAM, label: "Sam Doe" },
        { userId: USER_ALEX, label: "Alex Chen" },
      ],
      groups: [],
      resolutions: {},
      index: indexOf([
        ALEX_UNREACHABLE,
        { ...SAM_READY, status: "NotReachable" },
      ]),
      isTruncated: false,
    });

    expect(
      report.unreachable.map((issue: ResponderIssue): string => {
        return issue.name;
      }),
    ).toEqual(["Alex Chen", "Sam Doe"]);
  });

  /*
   * The readiness row's own name wins: a person renamed since the join row was
   * written should be talked about by their current name.
   */
  test("the readiness row's name is preferred over the join row's", () => {
    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [{ userId: USER_ALEX, label: "Stale Name" }],
      groups: [],
      resolutions: {},
      index: indexOf([ALEX_UNREACHABLE]),
      isTruncated: false,
    });

    expect(report.unreachable[0]!.name).toBe("Alex Chen");
  });

  test("a responder with no id is not a responder", () => {
    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [{ userId: "", label: "Nobody" }],
      groups: [],
      resolutions: {},
      index: indexOf([ALEX_UNREACHABLE]),
      isTruncated: false,
    });

    expect(report.responderCount).toBe(0);
  });
});

describe("Escalation level readiness: what it admits to not knowing", () => {
  /*
   * A group whose membership could not be read is the case that used to render
   * identically to a group full of reachable people.
   */
  test("a team that could not be read is named rather than skipped", () => {
    const key: string = getResponderGroupKey("team", TEAM_ID);

    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [],
      groups: [TEAM_REF],
      resolutions: {
        [key]: {
          key: key,
          kind: "team",
          id: TEAM_ID,
          label: "Payments",
          state: "unavailable",
          members: [],
        },
      },
      index: indexOf([ALEX_UNREACHABLE]),
      isTruncated: false,
    });

    expect(report.unreadableGroups).toEqual([TEAM_REF]);
    expect(report.isResolving).toBe(false);
  });

  test("a group still being expanded is reported as in flight, not as a problem", () => {
    const key: string = getResponderGroupKey("team", TEAM_ID);

    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [],
      groups: [TEAM_REF],
      resolutions: {
        [key]: {
          key: key,
          kind: "team",
          id: TEAM_ID,
          label: "Payments",
          state: "resolving",
          members: [],
        },
      },
      index: indexOf([ALEX_UNREACHABLE]),
      isTruncated: false,
    });

    expect(report.isResolving).toBe(true);
    expect(report.unreadableGroups).toHaveLength(0);
    expect(getRuleWarningLevel(report, FALLBACK_ON)).toBe("none");
  });

  test("a group nothing is known about yet is in flight too", () => {
    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [],
      groups: [TEAM_REF],
      resolutions: {},
      index: indexOf([ALEX_UNREACHABLE]),
      isTruncated: false,
    });

    expect(report.isResolving).toBe(true);
  });

  /*
   * A responder with no readiness row on a COMPLETE answer is somebody the
   * server did not resolve onto this policy. Inventing a warning out of that
   * would put a permanent grey badge on levels that are fine.
   */
  test("a responder missing from a complete answer is not accused", () => {
    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [{ userId: USER_SAM, label: "Sam Doe" }],
      groups: [],
      resolutions: {},
      index: indexOf([ALEX_UNREACHABLE]),
      isTruncated: false,
    });

    expect(report.unchecked).toHaveLength(0);
    expect(getRuleWarningLevel(report, FALLBACK_ON)).toBe("none");
  });

  /*
   * The same absence on a TRUNCATED answer means the opposite: nobody looked.
   */
  test("a responder missing from a truncated answer is reported as unchecked", () => {
    const report: RuleReadinessReport = buildRuleReadinessReport({
      directUsers: [{ userId: USER_SAM, label: "Sam Doe" }],
      groups: [],
      resolutions: {},
      index: indexOf([ALEX_UNREACHABLE]),
      isTruncated: true,
    });

    expect(report.unchecked).toHaveLength(1);
    expect(report.unchecked[0]!.name).toBe("Sam Doe");
    expect(getRuleWarningLevel(report, FALLBACK_ON)).toBe("unknown");
  });
});

/*
 * ---------------------------------------------------------------------------
 * HOW LOUD THE LABEL IS ALLOWED TO BE
 * ---------------------------------------------------------------------------
 */
describe("Escalation level readiness: the label's volume", () => {
  type ReportFunction = (
    overrides: Partial<RuleReadinessReport>,
  ) => RuleReadinessReport;

  const reportWith: ReportFunction = (
    overrides: Partial<RuleReadinessReport>,
  ): RuleReadinessReport => {
    return {
      unreachable: [],
      gaps: [],
      unchecked: [],
      unreadableGroups: [],
      isResolving: false,
      responderCount: 3,
      checkedCount: 3,
      ...overrides,
    };
  };

  const issue: (name: string) => ResponderIssue = (
    name: string,
  ): ResponderIssue => {
    return {
      userId: USER_ALEX,
      name: name,
      kind: "unreachable",
      readiness: null,
      via: [],
    };
  };

  test("a healthy level says nothing", () => {
    expect(getRuleWarningLevel(reportWith({}), FALLBACK_ON)).toBe("none");
    expect(getRuleWarningLabel(reportWith({}), FALLBACK_ON)).toBe("");
  });

  test("somebody who cannot be paged is critical", () => {
    const report: RuleReadinessReport = reportWith({
      unreachable: [issue("Alex Chen")],
    });

    expect(getRuleWarningLevel(report, FALLBACK_ON)).toBe("critical");
    expect(getRuleWarningLabel(report, FALLBACK_ON)).toBe(
      "1 person can't be paged",
    );
  });

  test("the count is people, and it is pluralised", () => {
    const report: RuleReadinessReport = reportWith({
      unreachable: [issue("Alex Chen"), issue("Sam Doe")],
    });

    expect(getRuleWarningLabel(report, FALLBACK_ON)).toBe(
      "2 people can't be paged",
    );
  });

  /*
   * The alarm-fatigue property, asserted rather than assumed. On a project with
   * the fallback on - the default - a PartiallyReady responder's pages still
   * arrive, and most responders on a project with many severities are amber. A
   * label that fires for them fires on almost every level of almost every
   * policy.
   */
  test("rule gaps are silent while the project's fallback is on", () => {
    const report: RuleReadinessReport = reportWith({
      gaps: [issue("Jo Park")],
    });

    expect(getRuleWarningLevel(report, FALLBACK_ON)).toBe("none");
  });

  /*
   * And the reverse mistake, which is the expensive one: with the fallback off
   * those same gaps are dropped pages.
   */
  test("rule gaps are a warning the moment the fallback is off", () => {
    const report: RuleReadinessReport = reportWith({
      gaps: [issue("Jo Park")],
    });

    expect(getRuleWarningLevel(report, FALLBACK_OFF)).toBe("warning");
    expect(getRuleWarningLabel(report, FALLBACK_OFF)).toBe(
      "1 person loses pages",
    );
  });

  test("cannot-be-paged outranks both gaps and unknowns", () => {
    const report: RuleReadinessReport = reportWith({
      unreachable: [issue("Alex Chen")],
      gaps: [issue("Jo Park")],
      unchecked: [issue("Sam Doe")],
    });

    expect(getRuleWarningLevel(report, FALLBACK_OFF)).toBe("critical");
  });

  test("an unreadable team is an unknown, counted with unchecked people", () => {
    const report: RuleReadinessReport = reportWith({
      unchecked: [issue("Sam Doe")],
      unreadableGroups: [TEAM_REF],
    });

    expect(getRuleWarningLevel(report, FALLBACK_ON)).toBe("unknown");
    expect(getRuleWarningLabel(report, FALLBACK_ON)).toBe(
      "2 responders not checked",
    );
  });

  test("one unknown is singular", () => {
    const report: RuleReadinessReport = reportWith({
      unreadableGroups: [TEAM_REF],
    });

    expect(getRuleWarningLabel(report, FALLBACK_ON)).toBe(
      "1 responder not checked",
    );
  });
});

describe("Escalation level readiness: naming where a responder came from", () => {
  test("a direct pick is described as direct", () => {
    expect(describeResponderVia([{ kind: "direct", label: "" }])).toBe(
      "Reached directly.",
    );
  });

  test("a team and a schedule are named", () => {
    expect(describeResponderVia([{ kind: "team", label: "Payments" }])).toBe(
      "Reached through the Payments team.",
    );
    expect(
      describeResponderVia([{ kind: "schedule", label: "Weekends" }]),
    ).toBe("Reached through the Weekends schedule.");
  });

  test("every route is listed, in the order they were found", () => {
    const via: Array<ResponderVia> = [
      { kind: "direct", label: "" },
      { kind: "team", label: "Payments" },
      { kind: "schedule", label: "Weekends" },
    ];

    expect(describeResponderVia(via)).toBe(
      "Reached directly, through the Payments team and through the Weekends schedule.",
    );
  });

  /*
   * Never a bare id: an admin who reads "cba1f3e2-... could not be checked"
   * learns nothing they can act on.
   */
  test("a nameless group is described by its kind rather than its id", () => {
    expect(describeResponderVia([{ kind: "team", label: "" }])).toBe(
      "Reached through the a team team.",
    );
    expect(getResponderGroupName({ kind: "team", label: "" })).toBe("a team");
    expect(getResponderGroupName({ kind: "schedule", label: "" })).toBe(
      "a schedule",
    );
    expect(getResponderGroupName({ kind: "team", label: "Payments" })).toBe(
      "Payments",
    );
  });

  test("no route at all produces no sentence", () => {
    expect(describeResponderVia([])).toBe("");
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE LABEL ITSELF
 * ---------------------------------------------------------------------------
 */
describe("The readiness label", () => {
  type LabelReportFunction = (
    overrides: Partial<RuleReadinessReport>,
  ) => RuleReadinessReport;

  const reportWith: LabelReportFunction = (
    overrides: Partial<RuleReadinessReport>,
  ): RuleReadinessReport => {
    return {
      unreachable: [],
      gaps: [],
      unchecked: [],
      unreadableGroups: [],
      isResolving: false,
      responderCount: 2,
      checkedCount: 2,
      ...overrides,
    };
  };

  const unreachableIssue: ResponderIssue = {
    userId: USER_ALEX,
    name: "Alex Chen",
    kind: "unreachable",
    readiness: null,
    via: [],
  };

  test("a healthy level renders no label at all", () => {
    const { container } = render(
      <RuleReadinessLabel
        report={reportWith({})}
        delivery={FALLBACK_ON}
        ruleName="First Responders"
        onClick={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("it states the problem and offers the way in", () => {
    render(
      <RuleReadinessLabel
        report={reportWith({ unreachable: [unreachableIssue] })}
        delivery={FALLBACK_ON}
        ruleName="First Responders"
        onClick={() => {}}
      />,
    );

    const label: HTMLElement = screen.getByTestId("rule-readiness-label");

    expect(label).toHaveTextContent("1 person can't be paged");
    expect(label).toHaveAttribute("data-warning-level", "critical");
    expect(label).toHaveAttribute(
      "aria-label",
      "1 person can't be paged on First Responders. See who, and send a setup reminder.",
    );
  });

  /*
   * A button, not a badge with a tooltip: it has to be reachable from a
   * keyboard, and the thing behind it is a list of people rather than a
   * sentence.
   */
  test("it is a real button, and clicking it opens the detail", () => {
    const onClick: MockFunction = getJestMockFunction();

    render(
      <RuleReadinessLabel
        report={reportWith({ unreachable: [unreachableIssue] })}
        delivery={FALLBACK_ON}
        ruleName="First Responders"
        onClick={onClick as unknown as () => void}
      />,
    );

    const label: HTMLElement = screen.getByTestId("rule-readiness-label");

    expect(label.tagName).toBe("BUTTON");

    fireEvent.click(label);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("an unknown renders grey rather than as an accusation", () => {
    render(
      <RuleReadinessLabel
        report={reportWith({ unreadableGroups: [TEAM_REF] })}
        delivery={FALLBACK_ON}
        ruleName="First Responders"
        onClick={() => {}}
      />,
    );

    expect(screen.getByTestId("rule-readiness-label")).toHaveAttribute(
      "data-warning-level",
      "unknown",
    );
  });

  test("the fallback-off gap renders amber", () => {
    render(
      <RuleReadinessLabel
        report={reportWith({
          gaps: [{ ...unreachableIssue, kind: "gap", name: "Jo Park" }],
        })}
        delivery={FALLBACK_OFF}
        ruleName="First Responders"
        onClick={() => {}}
      />,
    );

    expect(screen.getByTestId("rule-readiness-label")).toHaveAttribute(
      "data-warning-level",
      "warning",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE DETAIL BEHIND THE LABEL
 * ---------------------------------------------------------------------------
 */
describe("The readiness detail", () => {
  type DetailReportFunction = (
    overrides: Partial<RuleReadinessReport>,
  ) => RuleReadinessReport;

  const reportWith: DetailReportFunction = (
    overrides: Partial<RuleReadinessReport>,
  ): RuleReadinessReport => {
    return {
      unreachable: [],
      gaps: [],
      unchecked: [],
      unreadableGroups: [],
      isResolving: false,
      responderCount: 2,
      checkedCount: 2,
      ...overrides,
    };
  };

  type IssueFunction = (params: {
    userId: string;
    name: string;
    row: UserRow;
    via?: Array<ResponderVia> | undefined;
    kind?: "unreachable" | "gap" | undefined;
  }) => ResponderIssue;

  const issueFor: IssueFunction = (params: {
    userId: string;
    name: string;
    row: UserRow;
    via?: Array<ResponderVia> | undefined;
    kind?: "unreachable" | "gap" | undefined;
  }): ResponderIssue => {
    const summary: ReadinessSummaryWire = summaryOf({ users: [params.row] });

    return {
      userId: params.userId,
      name: params.name,
      kind: params.kind || "unreachable",
      readiness: summary.users[0]!,
      via: params.via || [],
    };
  };

  const ALEX_ISSUE: ResponderIssue = issueFor({
    userId: USER_ALEX,
    name: "Alex Chen",
    row: ALEX_UNREACHABLE,
  });

  type RenderDetailFunction = (params: {
    report: RuleReadinessReport;
    delivery?: { isFallbackEnabled: boolean } | undefined;
    reminders?: SetupReminderStatuses | undefined;
    onSendReminder?: ((userIds: Array<string>) => void) | undefined;
    isSendingReminders?: boolean | undefined;
  }) => void;

  const renderDetail: RenderDetailFunction = (params: {
    report: RuleReadinessReport;
    delivery?: { isFallbackEnabled: boolean } | undefined;
    reminders?: SetupReminderStatuses | undefined;
    onSendReminder?: ((userIds: Array<string>) => void) | undefined;
    isSendingReminders?: boolean | undefined;
  }): void => {
    render(
      <RuleReadinessDetails
        ruleName="First Responders"
        report={params.report}
        delivery={params.delivery || FALLBACK_ON}
        reminders={params.reminders || NO_REMINDERS}
        isSendingReminders={params.isSendingReminders === true}
        onSendReminder={params.onSendReminder || (() => {})}
        onClose={() => {}}
      />,
    );
  };

  test("it names the level and the number of people on it", () => {
    renderDetail({ report: reportWith({ unreachable: [ALEX_ISSUE] }) });

    expect(screen.getByText("First Responders")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Whether the 2 people this level notifies can actually be paged.",
      ),
    ).toBeInTheDocument();
  });

  test("an unreachable responder is named, and the consequence is stated", () => {
    renderDetail({ report: reportWith({ unreachable: [ALEX_ISSUE] }) });

    expect(
      screen.getByTestId("rule-responder-unreachable"),
    ).toBeInTheDocument();
    expect(screen.getByText("Alex Chen")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Alex Chen has no verified notification method, so every page routed to them is dropped\./,
      ),
    ).toBeInTheDocument();
  });

  /*
   * The two NotReachable branches are different problems with different fixes -
   * "they never verified anything" versus "this project switched off the only
   * channel they have" - and an admin sent to chase the wrong one wastes the
   * trip.
   */
  test("methods on switched-off channels get their own sentence", () => {
    renderDetail({
      report: reportWith({
        unreachable: [
          issueFor({
            userId: USER_ALEX,
            name: "Alex Chen",
            row: {
              ...ALEX_UNREACHABLE,
              methods: [
                {
                  methodType: "SMS",
                  maskedIdentifier: "+1 ••• ••• 4821",
                  isVerified: true,
                },
              ],
            },
          }),
        ],
      }),
    });

    expect(
      screen.getByText(/this project has those channels switched off/),
    ).toBeInTheDocument();
  });

  test("it says where a responder nobody picked came from", () => {
    renderDetail({
      report: reportWith({
        unreachable: [
          issueFor({
            userId: USER_ALEX,
            name: "Alex Chen",
            row: ALEX_UNREACHABLE,
            via: [{ kind: "team", label: "Payments" }],
          }),
        ],
      }),
    });

    expect(
      screen.getByText("Reached through the Payments team."),
    ).toBeInTheDocument();
  });

  test("it says which verified methods exist, or that none do", () => {
    renderDetail({ report: reportWith({ unreachable: [ALEX_ISSUE] }) });

    expect(
      screen.getByText("No verified notification method on their account."),
    ).toBeInTheDocument();
  });

  test("it says the fix is theirs to apply, not the admin's", () => {
    renderDetail({ report: reportWith({ unreachable: [ALEX_ISSUE] }) });

    expect(
      screen.getByText(
        /Only these people can add and verify a notification method on their own account/,
      ),
    ).toBeInTheDocument();
  });

  test("a gap responder is listed separately, with the cells they are missing", () => {
    renderDetail({
      report: reportWith({
        gaps: [
          issueFor({
            userId: USER_JO,
            name: "Jo Park",
            row: JO_PARTIAL,
            kind: "gap",
          }),
        ],
      }),
    });

    expect(screen.getByTestId("rule-responder-gap")).toBeInTheDocument();
    expect(
      screen.getByText("Paged, but not the way they asked"),
    ).toBeInTheDocument();
    expect(screen.getByText("Incident · Sev1")).toBeInTheDocument();
  });

  /*
   * The same gap, in a project that drops it. The heading has to change with the
   * fact, because "not the way they asked" over a dropped page is a lie.
   */
  test("with the fallback off, gaps are described as dropped pages", () => {
    renderDetail({
      delivery: FALLBACK_OFF,
      report: reportWith({
        gaps: [
          issueFor({
            userId: USER_JO,
            name: "Jo Park",
            row: JO_PARTIAL,
            kind: "gap",
          }),
        ],
      }),
    });

    expect(
      screen.getByText("Pages dropped - no fallback in this project"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /this project has on-call notification fallback switched off/,
      ),
    ).toBeInTheDocument();
  });

  test("a gap responder is offered no reminder, because there is nothing to remind them of", () => {
    renderDetail({
      report: reportWith({
        gaps: [
          issueFor({
            userId: USER_JO,
            name: "Jo Park",
            row: JO_PARTIAL,
            kind: "gap",
          }),
        ],
      }),
    });

    expect(screen.queryByText("Send setup reminder")).not.toBeInTheDocument();
  });

  test("an unchecked responder is named as unknown rather than as broken", () => {
    renderDetail({
      report: reportWith({
        unchecked: [
          {
            userId: USER_SAM,
            name: "Sam Doe",
            kind: "unchecked",
            readiness: null,
            via: [],
          },
        ],
      }),
    });

    expect(screen.getByTestId("rule-responder-unchecked")).toHaveTextContent(
      "does not cover Sam Doe, so they are unknown rather than ready",
    );
  });

  test("a team that could not be read says so, and says what follows from it", () => {
    renderDetail({
      report: reportWith({ unreadableGroups: [TEAM_REF] }),
    });

    expect(screen.getByTestId("rule-responder-unchecked")).toHaveTextContent(
      "We could not read who is in Payments, so nobody on that team has been checked.",
    );
  });

  test("an expansion still in flight says it is still checking", () => {
    renderDetail({ report: reportWith({ isResolving: true }) });

    expect(screen.getByTestId("rule-responder-unchecked")).toHaveTextContent(
      "Still checking who this level reaches",
    );
  });

  test("a level with nothing wrong says so rather than showing an empty modal", () => {
    renderDetail({ report: reportWith({}) });

    expect(screen.getByTestId("rule-readiness-all-clear")).toBeInTheDocument();
  });
});

describe("The readiness detail: the reminder it offers", () => {
  const issueFor: (row: UserRow, name: string) => ResponderIssue = (
    row: UserRow,
    name: string,
  ): ResponderIssue => {
    return {
      userId: row.userId,
      name: name,
      kind: "unreachable",
      readiness: summaryOf({ users: [row] }).users[0]!,
      via: [],
    };
  };

  const ALEX_ISSUE: ResponderIssue = issueFor(ALEX_UNREACHABLE, "Alex Chen");
  const SAM_ISSUE: ResponderIssue = issueFor(
    { ...SAM_READY, status: "NotReachable" },
    "Sam Doe",
  );

  type RenderFunction = (params: {
    unreachable: Array<ResponderIssue>;
    reminders?: SetupReminderStatuses | undefined;
    onSendReminder?: ((userIds: Array<string>) => void) | undefined;
  }) => void;

  const renderDetail: RenderFunction = (params: {
    unreachable: Array<ResponderIssue>;
    reminders?: SetupReminderStatuses | undefined;
    onSendReminder?: ((userIds: Array<string>) => void) | undefined;
  }): void => {
    render(
      <RuleReadinessDetails
        ruleName="First Responders"
        report={{
          unreachable: params.unreachable,
          gaps: [],
          unchecked: [],
          unreadableGroups: [],
          isResolving: false,
          responderCount: params.unreachable.length,
          checkedCount: params.unreachable.length,
        }}
        delivery={FALLBACK_ON}
        reminders={params.reminders || NO_REMINDERS}
        isSendingReminders={false}
        onSendReminder={params.onSendReminder || (() => {})}
        onClose={() => {}}
      />,
    );
  };

  test("the reminder is offered, and asks for exactly that user", () => {
    const onSendReminder: MockFunction = getJestMockFunction();

    renderDetail({
      unreachable: [ALEX_ISSUE],
      onSendReminder: onSendReminder as unknown as (
        userIds: Array<string>,
      ) => void,
    });

    fireEvent.click(screen.getByText("Send setup reminder"));

    expect(onSendReminder).toHaveBeenCalledWith([USER_ALEX]);
  });

  test("a sent reminder says who it reached, and offers no second send", () => {
    renderDetail({
      unreachable: [ALEX_ISSUE],
      reminders: { [USER_ALEX]: { state: "sent", message: "" } },
    });

    expect(screen.getByTestId("setup-reminder-sent")).toHaveTextContent(
      "Setup reminder sent to Alex Chen.",
    );
    expect(screen.queryByText("Send setup reminder")).not.toBeInTheDocument();
  });

  /*
   * The failure this control was disabled for two phases to avoid: a reminder
   * that did not go anywhere must not leave a tick behind it. A throttle is not
   * a send.
   */
  test("a skipped reminder is not reported as sent", () => {
    renderDetail({
      unreachable: [ALEX_ISSUE],
      reminders: {
        [USER_ALEX]: {
          state: "skipped",
          message: "Alex Chen was already reminded today.",
        },
      },
    });

    expect(screen.queryByTestId("setup-reminder-sent")).not.toBeInTheDocument();
    expect(screen.getByTestId("setup-reminder-not-sent")).toHaveTextContent(
      "No reminder was sent. Alex Chen was already reminded today.",
    );
    // And the fix that is always available is still offered.
    expect(screen.getByTestId("setup-reminder-not-sent")).toHaveTextContent(
      "Ask Alex Chen to finish their notification setup in User Settings.",
    );
  });

  test("a failed reminder shows the server's own words and can be retried", () => {
    renderDetail({
      unreachable: [ALEX_ISSUE],
      reminders: {
        [USER_ALEX]: { state: "failed", message: "No email address on file." },
      },
    });

    expect(screen.getByTestId("setup-reminder-not-sent")).toHaveTextContent(
      "No email address on file.",
    );
    expect(screen.getByText("Send setup reminder")).toBeInTheDocument();
  });

  /*
   * The state that exists so nobody presses the button twice. A request that
   * died on the way back is not the same as mail that never left, and telling a
   * reader it was not sent is how somebody gets reminded twice.
   */
  test("an unconfirmed reminder claims neither success nor failure", () => {
    renderDetail({
      unreachable: [ALEX_ISSUE],
      reminders: {
        [USER_ALEX]: { state: "unknown", message: "Gateway timeout." },
      },
    });

    expect(screen.queryByTestId("setup-reminder-sent")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("setup-reminder-not-sent"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("setup-reminder-unknown")).toHaveTextContent(
      "We could not confirm whether a reminder reached Alex Chen. Gateway timeout. Check with Alex before sending another.",
    );
  });

  test("the button is held while a send is in flight", () => {
    renderDetail({
      unreachable: [ALEX_ISSUE],
      reminders: { [USER_ALEX]: { state: "sending", message: "" } },
    });

    expect(screen.getByText("Sending...")).toBeInTheDocument();
  });

  /*
   * A level that reaches a whole team of unverified accounts is one click, not
   * eight.
   */
  test("two or more unreachable responders can be reminded at once", () => {
    const onSendReminder: MockFunction = getJestMockFunction();

    renderDetail({
      unreachable: [ALEX_ISSUE, SAM_ISSUE],
      onSendReminder: onSendReminder as unknown as (
        userIds: Array<string>,
      ) => void,
    });

    fireEvent.click(screen.getByText("Remind all 2"));

    expect(onSendReminder).toHaveBeenCalledWith([USER_ALEX, USER_SAM]);
  });

  test("the batch never re-sends to somebody who has already been told", () => {
    const onSendReminder: MockFunction = getJestMockFunction();

    renderDetail({
      unreachable: [ALEX_ISSUE, SAM_ISSUE],
      reminders: { [USER_ALEX]: { state: "sent", message: "" } },
      onSendReminder: onSendReminder as unknown as (
        userIds: Array<string>,
      ) => void,
    });

    /*
     * One person left to remind, so the batch control is gone entirely: the row
     * for Sam still carries their own button, and a "Remind all 1" would be a
     * second control for the same single send.
     */
    expect(screen.queryByText("Remind all 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Remind all 2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Send setup reminder"));

    expect(onSendReminder).toHaveBeenCalledWith([USER_SAM]);
  });

  test("one unreachable responder gets a row button and no batch button", () => {
    renderDetail({ unreachable: [ALEX_ISSUE] });

    expect(screen.getByText("Send setup reminder")).toBeInTheDocument();
    expect(screen.queryByText("Remind all 1")).not.toBeInTheDocument();
  });

  /*
   * A batch that vanishes the moment it is pressed looks like a control that
   * broke rather than one that is working. It stays, and the count it names does
   * not change under the reader while the send it started is in flight.
   */
  test("the batch control stays put while its own send is running", () => {
    render(
      <RuleReadinessDetails
        ruleName="First Responders"
        report={{
          unreachable: [ALEX_ISSUE, SAM_ISSUE],
          gaps: [],
          unchecked: [],
          unreadableGroups: [],
          isResolving: false,
          responderCount: 2,
          checkedCount: 2,
        }}
        delivery={FALLBACK_ON}
        reminders={{
          [USER_ALEX]: { state: "sending", message: "" },
          [USER_SAM]: { state: "sending", message: "" },
        }}
        isSendingReminders={true}
        onSendReminder={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Remind all 2")).toBeInTheDocument();
    expect(screen.getAllByText("Sending...")).toHaveLength(2);
  });
});

/*
 * ---------------------------------------------------------------------------
 * READING THE REMINDER ENDPOINT'S ANSWER
 * ---------------------------------------------------------------------------
 */
describe("Reading the reminder endpoint's answer", () => {
  test("a Sent outcome is a send", () => {
    expect(
      readSetupReminderStatuses(
        {
          sentCount: 1,
          results: [
            { userId: USER_ALEX, outcome: "Sent", message: "Emailed." },
          ],
        },
        [USER_ALEX],
      ),
    ).toEqual({ [USER_ALEX]: { state: "sent", message: "Emailed." } });
  });

  test("a throttled outcome is a skip carrying the server's explanation", () => {
    expect(
      readSetupReminderStatuses(
        {
          results: [
            {
              userId: USER_ALEX,
              outcome: "SkippedThrottled",
              message: "Already reminded in the last 24 hours.",
            },
          ],
        },
        [USER_ALEX],
      )[USER_ALEX],
    ).toEqual({
      state: "skipped",
      message: "Already reminded in the last 24 hours.",
    });
  });

  test("a failed outcome is a failure", () => {
    expect(
      readSetupReminderStatuses(
        {
          results: [
            {
              userId: USER_ALEX,
              outcome: "Failed",
              message: "Mail provider rejected the message.",
            },
          ],
        },
        [USER_ALEX],
      )[USER_ALEX]!.state,
    ).toBe("failed");
  });

  /*
   * A 200 whose results say nothing about the user we asked about is the one
   * shape that could quietly become a tick over a reminder that never left.
   */
  test("a 200 that says nothing about this user is not a send", () => {
    expect(
      readSetupReminderStatuses(
        { results: [{ userId: USER_SAM, outcome: "Sent", message: "" }] },
        [USER_ALEX],
      ),
    ).toEqual({
      [USER_ALEX]: {
        state: "unknown",
        message: "The server did not report an outcome for this reminder.",
      },
    });

    expect(readSetupReminderStatuses({}, [USER_ALEX])[USER_ALEX]!.state).toBe(
      "unknown",
    );
  });

  test("a batch answer is split per user", () => {
    const statuses: SetupReminderStatuses = readSetupReminderStatuses(
      {
        results: [
          { userId: USER_ALEX, outcome: "Sent", message: "Emailed." },
          {
            userId: USER_SAM,
            outcome: "SkippedNotAMember",
            message: "Not a member of this project.",
          },
        ],
      },
      [USER_ALEX, USER_SAM],
    );

    expect(statuses[USER_ALEX]!.state).toBe("sent");
    expect(statuses[USER_SAM]!.state).toBe("skipped");
  });

  test("an outcome this build has never heard of still reads as not-sent", () => {
    expect(
      readSetupReminderStatuses(
        {
          results: [
            {
              userId: USER_ALEX,
              outcome: "SkippedSomethingNewEntirely",
              message: "A future reason.",
            },
          ],
        },
        [USER_ALEX],
      )[USER_ALEX],
    ).toEqual({ state: "skipped", message: "A future reason." });
  });

  test("an outcome with no message still produces a true sentence", () => {
    expect(
      readSetupReminderStatuses(
        { results: [{ userId: USER_ALEX, outcome: "Failed" }] },
        [USER_ALEX],
      )[USER_ALEX]!.message,
    ).toBe('The server reported "Failed" without an explanation.');
  });

  test("a results payload that is not a list is not an answer", () => {
    expect(
      readSetupReminderStatuses({ results: "everything went fine" }, [
        USER_ALEX,
      ])[USER_ALEX]!.state,
    ).toBe("unknown");
  });
});

describe("Sending the reminder", () => {
  test("it posts the user ids to the shared reminder endpoint", async () => {
    getCommonHeadersMock.mockReturnValue({ tenantid: "a-project" });
    postMock.mockResolvedValue(
      okResponse({
        sentCount: 1,
        results: [{ userId: USER_ALEX, outcome: "Sent", message: "Emailed." }],
      }) as never,
    );

    const statuses: SetupReminderStatuses = await requestSetupReminders([
      USER_ALEX,
    ]);

    const request: any = (postMock as any).mock.calls[0][0];

    expect(request.url.toString()).toContain(
      "/on-call-readiness/send-setup-reminder",
    );
    expect(request.data).toEqual({ userIds: [USER_ALEX] });
    expect(request.headers).toEqual({ tenantid: "a-project" });
    expect(statuses[USER_ALEX]!.state).toBe("sent");
  });

  /*
   * The refusals that happen BEFORE any mail is sent - body validation, the
   * permission gate, the service's pre-flight checks - are the only failures
   * that earn the definite "no reminder was sent".
   */
  test("a refusal from the application itself is a definite failure", async () => {
    getCommonHeadersMock.mockReturnValue({});
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "Not allowed." }, {}) as never,
    );

    expect((await requestSetupReminders([USER_ALEX]))[USER_ALEX]!.state).toBe(
      "failed",
    );
  });

  /*
   * And everything else is not. A 502 or a dropped connection can happen after
   * the mail has left, and an admin told "nothing was sent" presses the button
   * again.
   */
  test("a gateway failure is unknown rather than a definite failure", async () => {
    getCommonHeadersMock.mockReturnValue({});
    postMock.mockResolvedValue(
      new HTTPErrorResponse(502, { message: "Bad gateway." }, {}) as never,
    );

    expect((await requestSetupReminders([USER_ALEX]))[USER_ALEX]!.state).toBe(
      "unknown",
    );
  });

  test("a transport failure carries the message through as unknown", async () => {
    getCommonHeadersMock.mockReturnValue({});
    postMock.mockRejectedValue(new Error("Network down") as never);

    expect((await requestSetupReminders([USER_ALEX]))[USER_ALEX]).toEqual({
      state: "unknown",
      message: "Network down",
    });
  });

  test("a failed batch reports the same outcome for every user asked about", async () => {
    getCommonHeadersMock.mockReturnValue({});
    postMock.mockRejectedValue(new Error("Network down") as never);

    const statuses: SetupReminderStatuses = await requestSetupReminders([
      USER_ALEX,
      USER_SAM,
    ]);

    expect(Object.keys(statuses).sort()).toEqual([USER_ALEX, USER_SAM].sort());
  });
});

/*
 * ---------------------------------------------------------------------------
 * EXPANDING TEAMS AND SCHEDULES
 * ---------------------------------------------------------------------------
 */
describe("Expanding the groups a level notifies", () => {
  test("a team expands to its members", async () => {
    getListMock.mockResolvedValue({
      data: [
        { user: { id: new ObjectID(USER_ALEX), name: "Alex Chen" } },
        { user: { id: new ObjectID(USER_SAM), name: "Sam Doe" } },
      ],
      count: 2,
      skip: 0,
      limit: 50,
    } as never);

    const resolution: ResponderGroupResolution = await fetchTeamMembers({
      group: TEAM_REF,
      projectId: PROJECT_ID,
    });

    expect(resolution.state).toBe("resolved");
    expect(resolution.members).toEqual([
      { userId: USER_ALEX, label: "Alex Chen" },
      { userId: USER_SAM, label: "Sam Doe" },
    ]);
  });

  /*
   * No hasAcceptedInvitation filter, mirroring TeamMemberService.getUsersInTeam:
   * somebody who never accepted their invite still gets paged, so they still
   * have to be checked.
   */
  test("the team read does not filter on invitations being accepted", async () => {
    getListMock.mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 50,
    } as never);

    await fetchTeamMembers({ group: TEAM_REF, projectId: PROJECT_ID });

    const query: any = (getListMock as any).mock.calls[0][0].query;

    expect(query.hasAcceptedInvitation).toBeUndefined();
    expect(query.teamId.toString()).toBe(TEAM_ID);
  });

  test("a schedule expands to its whole layer roster, not just today's", async () => {
    getListMock.mockResolvedValue({
      data: [
        { user: { id: new ObjectID(USER_ALEX), name: "Alex Chen" } },
        { user: { id: new ObjectID(USER_ALEX), name: "Alex Chen" } },
      ],
      count: 2,
      skip: 0,
      limit: 50,
    } as never);

    const resolution: ResponderGroupResolution = await fetchScheduleUsers({
      group: SCHEDULE_REF,
      projectId: PROJECT_ID,
    });

    const query: any = (getListMock as any).mock.calls[0][0].query;

    expect(query.onCallDutyPolicyScheduleId.toString()).toBe(SCHEDULE_ID);
    // The same person on two layers is one responder.
    expect(resolution.members).toEqual([
      { userId: USER_ALEX, label: "Alex Chen" },
    ]);
  });

  /*
   * The whole reason "unavailable" exists. A rejected read that produced an
   * empty membership would render as "everybody in that team is fine".
   */
  test("a team that cannot be read is unavailable, never empty", async () => {
    getListMock.mockRejectedValue(new Error("teams are down") as never);

    const resolution: ResponderGroupResolution = await fetchTeamMembers({
      group: TEAM_REF,
      projectId: PROJECT_ID,
    });

    expect(resolution.state).toBe("unavailable");
    expect(resolution.members).toEqual([]);
    expect(resolution.label).toBe("Payments");
  });

  test("a schedule that cannot be read is unavailable too", async () => {
    getListMock.mockRejectedValue(new Error("schedules are down") as never);

    expect(
      (
        await fetchScheduleUsers({
          group: SCHEDULE_REF,
          projectId: PROJECT_ID,
        })
      ).state,
    ).toBe("unavailable");
  });

  test("a member row with no user is dropped rather than counted as a nameless responder", async () => {
    getListMock.mockResolvedValue({
      data: [{}, { user: { id: new ObjectID(USER_ALEX), name: "Alex Chen" } }],
      count: 2,
      skip: 0,
      limit: 50,
    } as never);

    const resolution: ResponderGroupResolution = await fetchTeamMembers({
      group: TEAM_REF,
      projectId: PROJECT_ID,
    });

    expect(resolution.members).toEqual([
      { userId: USER_ALEX, label: "Alex Chen" },
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE ESCALATION PAGE, WIRED
 * ---------------------------------------------------------------------------
 *
 * The pure helpers above prove the arithmetic; this proves it is CONNECTED. A
 * label whose copy is perfect and which nothing renders has warned nobody, and
 * that failure is invisible to every test that stops at the function boundary.
 */
interface PolicyFixture {
  users?: Array<JSONObject> | undefined;
  isTruncated?: boolean | undefined;
  isFallbackEnabled?: boolean | undefined;
  teamOnRuleOne?: boolean | undefined;
  teamMembers?: Array<JSONObject> | undefined;
  teamReadFails?: boolean | undefined;
}

type MockPolicyFunction = (fixture: PolicyFixture) => void;

const mockPolicy: MockPolicyFunction = (fixture: PolicyFixture): void => {
  getCommonHeadersMock.mockReturnValue({});

  getItemMock.mockResolvedValue({
    repeatPolicyIfNoOneAcknowledges: false,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
  } as never);

  /*
   * Keyed on the SELECT rather than the model class, because the reads issue the
   * same query shape against the same policy and only their selects tell them
   * apart - which is also exactly how a reader of the component tells them
   * apart.
   */
  getListMock.mockImplementation((params: any): Promise<any> => {
    const select: Record<string, unknown> = params.select || {};
    const query: Record<string, unknown> = params.query || {};

    if (select["escalateAfterInMinutes"]) {
      return Promise.resolve({
        data: [
          {
            id: RULE_ONE_ID,
            name: "First Responders",
            escalateAfterInMinutes: 5,
            order: 1,
          },
          {
            id: RULE_TWO_ID,
            name: "Backup",
            escalateAfterInMinutes: 10,
            order: 2,
          },
        ],
        count: 2,
        skip: 0,
        limit: 50,
      });
    }

    // The team-membership expansion.
    if (query["teamId"]) {
      if (fixture.teamReadFails) {
        return Promise.reject(new Error("teams are down"));
      }

      return Promise.resolve({
        data: fixture.teamMembers || [],
        count: (fixture.teamMembers || []).length,
        skip: 0,
        limit: 50,
      });
    }

    if (query["onCallDutyPolicyScheduleId"]) {
      return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
    }

    // The rule -> user join rows.
    if (select["user"]) {
      return Promise.resolve({
        data: [
          {
            id: new ObjectID("aaaaaaaa-0001-4001-8001-000000000001"),
            onCallDutyPolicyEscalationRuleId: RULE_ONE_ID,
            user: { id: new ObjectID(USER_ALEX), name: "Alex Chen" },
          },
          {
            id: new ObjectID("aaaaaaaa-0003-4003-8003-000000000003"),
            onCallDutyPolicyEscalationRuleId: RULE_TWO_ID,
            user: { id: new ObjectID(USER_SAM), name: "Sam Doe" },
          },
        ],
        count: 2,
        skip: 0,
        limit: 50,
      });
    }

    // The rule -> team join rows.
    if (select["team"]) {
      return Promise.resolve({
        data: fixture.teamOnRuleOne
          ? [
              {
                id: new ObjectID("aaaaaaaa-0004-4004-8004-000000000004"),
                onCallDutyPolicyEscalationRuleId: RULE_ONE_ID,
                team: { id: new ObjectID(TEAM_ID), name: "Payments" },
              },
            ]
          : [],
        count: fixture.teamOnRuleOne ? 1 : 0,
        skip: 0,
        limit: 50,
      });
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
  });

  getMock.mockResolvedValue(
    okResponse({
      projectId: PROJECT_ID.toString(),
      onCallDutyPolicyId: POLICY_ID.toString(),
      isFallbackEnabled: fixture.isFallbackEnabled !== false,
      isTruncated: fixture.isTruncated === true,
      totalCount: (fixture.users || []).length,
      hasMore: false,
      users: fixture.users || [],
    }) as never,
  );
};

type ReadinessUserFunction = (params: {
  userId: string;
  userName: string;
  status: string;
}) => JSONObject;

const readinessUser: ReadinessUserFunction = (params: {
  userId: string;
  userName: string;
  status: string;
}): JSONObject => {
  return {
    userId: params.userId,
    userName: params.userName,
    userEmail: `${params.userName.split(" ")[0]!.toLowerCase()}@example.com`,
    status: params.status,
    methods: [],
    coverage: [],
    reasons: [],
    reachedVia: [],
  };
};

describe("The escalation page, wired", () => {
  test("the level that reaches an unreachable responder wears the label - and the other does not", async () => {
    mockPolicy({
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "NotReachable",
        }),
        readinessUser({
          userId: USER_SAM,
          userName: "Sam Doe",
          status: "Ready",
        }),
      ],
    });

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
    });

    // Exactly one level is accused, and it is the one Alex is on.
    expect(screen.getAllByTestId("rule-readiness-label")).toHaveLength(1);
    expect(screen.getByTestId("rule-readiness-label")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("First Responders"),
    );
    expect(screen.getByTestId("rule-readiness-label")).toHaveTextContent(
      "1 person can't be paged",
    );
  });

  test("a policy where everyone can be paged wears no label at all", async () => {
    mockPolicy({
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "Ready",
        }),
        readinessUser({
          userId: USER_SAM,
          userName: "Sam Doe",
          status: "Ready",
        }),
      ],
    });

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getAllByLabelText("Edit rule").length).toBeGreaterThan(0);
    });

    expect(
      screen.queryByTestId("rule-readiness-label"),
    ).not.toBeInTheDocument();
  });

  test("clicking the label opens the detail, and the detail names the person and the fix", async () => {
    mockPolicy({
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "NotReachable",
        }),
      ],
    });

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("rule-readiness-label"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-details")).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        /Alex Chen has no verified notification method, so every page routed to them is dropped\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Send setup reminder")).toBeInTheDocument();
  });

  /*
   * The reminder, end to end, through the real component: the click, the
   * request, and a confirmation that is only allowed to appear because the
   * SERVER said the mail went.
   */
  test("sending a reminder from the detail reports what the server said happened", async () => {
    mockPolicy({
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "NotReachable",
        }),
      ],
    });

    postMock.mockResolvedValue(
      okResponse({
        sentCount: 1,
        results: [{ userId: USER_ALEX, outcome: "Sent", message: "Emailed." }],
      }) as never,
    );

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("rule-readiness-label"));

    await waitFor(() => {
      expect(screen.getByText("Send setup reminder")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Send setup reminder"));

    await waitFor(() => {
      expect(screen.getByTestId("setup-reminder-sent")).toHaveTextContent(
        "Setup reminder sent to Alex Chen.",
      );
    });

    expect((postMock as any).mock.calls[0][0].data).toEqual({
      userIds: [USER_ALEX],
    });
  });

  test("a throttled reminder leaves no tick behind it", async () => {
    mockPolicy({
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "NotReachable",
        }),
      ],
    });

    postMock.mockResolvedValue(
      okResponse({
        results: [
          {
            userId: USER_ALEX,
            outcome: "SkippedThrottled",
            message: "Already reminded in the last 24 hours.",
          },
        ],
      }) as never,
    );

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("rule-readiness-label"));

    await waitFor(() => {
      expect(screen.getByText("Send setup reminder")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Send setup reminder"));

    await waitFor(() => {
      expect(screen.getByTestId("setup-reminder-not-sent")).toHaveTextContent(
        "Already reminded in the last 24 hours.",
      );
    });

    expect(screen.queryByTestId("setup-reminder-sent")).not.toBeInTheDocument();
  });

  /*
   * The common path: nobody picked this person, the team they are in was picked.
   */
  test("somebody reached only through a team is found, and the team is named", async () => {
    mockPolicy({
      teamOnRuleOne: true,
      teamMembers: [{ user: { id: new ObjectID(USER_JO), name: "Jo Park" } }],
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "Ready",
        }),
        readinessUser({
          userId: USER_SAM,
          userName: "Sam Doe",
          status: "Ready",
        }),
        readinessUser({
          userId: USER_JO,
          userName: "Jo Park",
          status: "NotReachable",
        }),
      ],
    });

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("rule-readiness-label"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-details")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Reached through the Payments team."),
    ).toBeInTheDocument();
  });

  test("a team whose membership cannot be read is admitted to rather than skipped", async () => {
    mockPolicy({
      teamOnRuleOne: true,
      teamReadFails: true,
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "Ready",
        }),
        readinessUser({
          userId: USER_SAM,
          userName: "Sam Doe",
          status: "Ready",
        }),
      ],
    });

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
    });

    expect(screen.getByTestId("rule-readiness-label")).toHaveAttribute(
      "data-warning-level",
      "unknown",
    );

    fireEvent.click(screen.getByTestId("rule-readiness-label"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-responder-unchecked")).toHaveTextContent(
        "We could not read who is in Payments",
      );
    });
  });

  /*
   * The move itself. The warning is no longer allowed to live in the modal: an
   * admin opening the add/edit form must not be shown a readiness block there,
   * and the readiness lookups the old block issued per keystroke must be gone
   * with it.
   */
  test("the add-rule modal carries no readiness warning", async () => {
    mockPolicy({
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "NotReachable",
        }),
      ],
    });

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Add Escalation Rule"));

    await waitFor(() => {
      expect(screen.getByText("Create Rule")).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("add-responder-warning"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "You can still add them - this is a warning, not a block.",
      ),
    ).not.toBeInTheDocument();
  });

  /*
   * One readiness answer for the whole page. Two components each calling the
   * hook is two sets of paged requests for one payload, and they can disagree
   * with each other while they settle.
   */
  test("the policy's readiness is read once for the page, not once per surface", async () => {
    mockPolicy({
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "NotReachable",
        }),
      ],
    });

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
    });

    const readinessCalls: Array<any> = (getMock as any).mock.calls.filter(
      (call: Array<any>): boolean => {
        return String(call[0].url).includes("/on-call-readiness/policy/");
      },
    );

    expect(readinessCalls).toHaveLength(1);
  });

  /*
   * The page opening is not a recompute. Several surfaces ask the same question
   * when a screen loads, and the server's 60s cache is exactly right for that.
   */
  test("the first read takes the server's cached answer", async () => {
    mockPolicy({
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "NotReachable",
        }),
      ],
    });

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
    });

    expect(String((getMock as any).mock.calls[0][0].url)).not.toContain(
      "refresh=true",
    );
  });

  /*
   * And pressing Refresh is. An admin who has just changed something and is
   * shown the answer from before the change concludes the fix did not work.
   */
  test("refreshing asks the server to recompute rather than redraw", async () => {
    mockPolicy({
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "NotReachable",
        }),
      ],
    });

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Refresh"));

    await waitFor(() => {
      const refreshed: Array<any> = (getMock as any).mock.calls.filter(
        (call: Array<any>): boolean => {
          return String(call[0].url).includes("refresh=true");
        },
      );

      expect(refreshed).toHaveLength(1);
    });
  });

  test("a truncated readiness answer marks the people it did not cover", async () => {
    mockPolicy({
      isTruncated: true,
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "Ready",
        }),
      ],
    });

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
    });

    const label: HTMLElement = screen.getByTestId("rule-readiness-label");

    expect(label).toHaveAttribute("data-warning-level", "unknown");
    expect(label).toHaveTextContent("1 responder not checked");
  });

  test("the label survives the detail being closed", async () => {
    mockPolicy({
      users: [
        readinessUser({
          userId: USER_ALEX,
          userName: "Alex Chen",
          status: "NotReachable",
        }),
      ],
    });

    render(
      <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("rule-readiness-label"));

    await waitFor(() => {
      expect(screen.getByTestId("rule-readiness-details")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Close"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("rule-readiness-details"),
      ).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("rule-readiness-label")).toBeInTheDocument();
  });
});

/*
 * The one claim this surface must never make: an identifier that was masked on
 * the wire must not be reconstructed in the DOM.
 */
describe("no unmasked identifier reaches the DOM", () => {
  test("only the masked form of a method is rendered", () => {
    const issue: ResponderIssue = {
      userId: USER_ALEX,
      name: "Alex Chen",
      kind: "unreachable",
      readiness: summaryOf({
        users: [
          {
            ...ALEX_UNREACHABLE,
            methods: [
              {
                methodType: "SMS",
                maskedIdentifier: "+1 ••• ••• 4821",
                isVerified: true,
              },
            ],
          },
        ],
      }).users[0]!,
      via: [],
    };

    const { container } = render(
      <RuleReadinessDetails
        ruleName="First Responders"
        report={{
          unreachable: [issue],
          gaps: [],
          unchecked: [],
          unreadableGroups: [],
          isResolving: false,
          responderCount: 1,
          checkedCount: 1,
        }}
        delivery={FALLBACK_ON}
        reminders={NO_REMINDERS}
        isSendingReminders={false}
        onSendReminder={() => {}}
        onClose={() => {}}
      />,
    );

    expect(container.textContent).toContain("+1 ••• ••• 4821");
    /*
     * The masked identifier is the ONLY form of it on screen: the payload never
     * carries the full number, and nothing here reconstructs one.
     */
    expect(container.textContent).not.toContain("+14821");
    expect(container.textContent).toContain("SMS +1 ••• ••• 4821");
  });
});

/*
 * A report with nothing in it must resolve to "none" - the state that renders no
 * label at all. This is the default every healthy level on every policy sits in,
 * so it is the one branch whose regression would be silent.
 */
describe("the quiet default", () => {
  test("an empty report is silent", () => {
    const empty: RuleReadinessReport = {
      unreachable: [],
      gaps: [],
      unchecked: [],
      unreadableGroups: [],
      isResolving: false,
      responderCount: 0,
      checkedCount: 0,
    };

    const level: RuleWarningLevel = getRuleWarningLevel(empty, FALLBACK_ON);
    const idle: SetupReminderStatus = { state: "idle", message: "" };

    expect(level).toBe("none");
    expect(getRuleWarningLabel(empty, FALLBACK_OFF)).toBe("");
    expect(idle.state).toBe("idle");
  });
});
