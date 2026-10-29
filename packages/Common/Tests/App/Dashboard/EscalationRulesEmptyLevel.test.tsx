import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A LEVEL WITH NOBODY TO PAGE, ON THE POLICY'S ESCALATION RULES PAGE.
 *
 * A run passes a level that pages nobody at once, without waiting out its
 * "Escalate after" (Types/OnCallDutyPolicy/OnCallEmptyLevel). The page says
 * what a run will do, so it says that too:
 *
 *   - the level's card says "Skipped at once" where the others say
 *     "Escalates after 30 min", as the summary does, and its notice asks
 *     for responders;
 *   - the step from it to the next level says the next level is paged at
 *     once, not "If unacknowledged after 10 min" - a wait that never comes;
 *   - the escalation summary marks it "Skipped at once", and its wait is
 *     not counted towards when the levels after it are paged, nor towards
 *     "To final level";
 *   - with no level able to page anybody, the summary's ladder ends saying
 *     the policy pages nobody - not that it repeats, since a pass that
 *     paged nobody is never repeated.
 *
 * A level whose only schedule has nobody on call right now is not one of
 * them: somebody may be on call by the time it is reached, so it keeps its
 * wait everywhere, as before.
 */

const getMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
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

import EscalationRules, {
  NO_RESPONDERS_NOTICE,
  PAGED_AT_ONCE_CONNECTOR,
  countRuleResponders,
  emptyRuleMembers,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules";
import EscalationSummary, {
  EscalationLevelSummary,
  PAGES_NOBODY_ENDING,
  SKIPPED_LEVEL_TIMING,
  isSkippedLevel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationSummary";
import { ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME } from "../../../UI/Components/Icon/Icon";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

jest.setTimeout(30000);

const PROJECT_ID: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000002",
);
const RULE_1: ObjectID = new ObjectID("e1000000-0000-4000-8000-000000000011");
const RULE_2: ObjectID = new ObjectID("e1000000-0000-4000-8000-000000000012");
const RULE_3: ObjectID = new ObjectID("e1000000-0000-4000-8000-000000000013");
const ALEX: string = "e1000000-0000-4000-8000-0000000000a1";
const SCHEDULE: string = "e1000000-0000-4000-8000-0000000005c1";

interface Level {
  id: ObjectID;
  escalateAfterInMinutes: number;
  // Who it notifies: Alex, a schedule with nobody on call now, or nobody.
  notifies: "alex" | "uncovered schedule" | "nobody";
}

afterEach(() => {
  cleanup();
  getMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockReset();
  getCommonHeadersMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

function list(data: Array<unknown>): JSONObject {
  return { data: data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

// A policy with these levels, read as the page reads it.
function serve(levels: Array<Level>): void {
  getCommonHeadersMock.mockReturnValue({});
  getItemMock.mockResolvedValue({
    repeatPolicyIfNoOneAcknowledges: false,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
  } as never);

  getListMock.mockImplementation((params: any): Promise<any> => {
    const select: Record<string, unknown> = params.select || {};

    if (select["escalateAfterInMinutes"]) {
      return Promise.resolve(
        list(
          levels.map((level: Level, index: number) => {
            return {
              id: level.id,
              _id: level.id.toString(),
              escalateAfterInMinutes: level.escalateAfterInMinutes,
              order: index + 1,
            };
          }),
        ),
      );
    }

    if (select["user"]) {
      return Promise.resolve(
        list(
          levels
            .filter((level: Level): boolean => {
              return level.notifies === "alex";
            })
            .map((level: Level) => {
              return {
                id: ObjectID.generate(),
                onCallDutyPolicyEscalationRuleId: level.id,
                user: { id: new ObjectID(ALEX), name: "Alex Chen" },
              };
            }),
        ),
      );
    }

    if (select["onCallDutyPolicySchedule"]) {
      return Promise.resolve(
        list(
          levels
            .filter((level: Level): boolean => {
              return level.notifies === "uncovered schedule";
            })
            .map((level: Level) => {
              return {
                id: ObjectID.generate(),
                onCallDutyPolicyEscalationRuleId: level.id,
                pageNextInRotation: false,
                onCallDutyPolicySchedule: {
                  id: new ObjectID(SCHEDULE),
                  name: "Payments primary",
                  // Nobody on call in it right now.
                  currentUserIdOnRoster: null,
                },
              };
            }),
        ),
      );
    }

    return Promise.resolve(list([]));
  });

  getMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        projectId: PROJECT_ID.toString(),
        onCallDutyPolicyId: POLICY_ID.toString(),
        isFallbackEnabled: true,
        isTruncated: false,
        totalCount: 0,
        hasMore: false,
        users: [],
      },
      {},
    ) as never,
  );
}

async function renderPage(levels: Array<Level>): Promise<Array<HTMLElement>> {
  serve(levels);

  render(
    <EscalationRules onCallDutyPolicyId={POLICY_ID} projectId={PROJECT_ID} />,
  );

  await waitFor(() => {
    expect(screen.getAllByTestId("escalation-rule-card")).toHaveLength(
      levels.length,
    );
  });

  return screen.getAllByTestId("escalation-rule-card");
}

// What the summary's "To final level" tile says.
function toFinalLevel(): string {
  return (
    screen.getByText("To final level").previousElementSibling?.textContent || ""
  );
}

// Each level's timing pill in the summary, in order.
function summaryTimings(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-testid="escalation-summary-level-timing"], [data-testid="escalation-summary-level-skipped"]',
    ),
  ).map((pill: HTMLElement): string => {
    const isSkipped: boolean =
      pill.getAttribute("data-testid") === "escalation-summary-level-skipped";

    return `${isSkipped ? "skipped: " : ""}${(pill.textContent || "").trim()}`;
  });
}

const THE_MAINTAINERS_POLICY: Array<Level> = [
  { id: RULE_1, escalateAfterInMinutes: 4, notifies: "nobody" },
  { id: RULE_2, escalateAfterInMinutes: 30, notifies: "alex" },
];

describe("the maintainer's policy: Level 1 has no responders", () => {
  test("Level 1's card says it has no responders, and asks for them", async () => {
    const cards: Array<HTMLElement> = await renderPage(THE_MAINTAINERS_POLICY);

    expect(
      within(cards[0]!).getByTestId("escalation-rule-no-responders"),
    ).toHaveTextContent(NO_RESPONDERS_NOTICE);
    expect(NO_RESPONDERS_NOTICE).toBe(
      "No responders assigned. Edit this rule to add responders.",
    );
    expect(
      within(cards[1]!).queryByTestId("escalation-rule-no-responders"),
    ).not.toBeInTheDocument();
  });

  /*
   * REGRESSION (UI review): Level 1's header said "Escalates after 4 min"
   * right above "skipped without waiting" and the step saying Level 2 is
   * paged at once. Its header says what the summary says of it.
   */
  test("Level 1's header says it is skipped at once - not that it escalates after 4 minutes", async () => {
    const cards: Array<HTMLElement> = await renderPage(THE_MAINTAINERS_POLICY);
    const header: HTMLElement = within(cards[0]!).getByTestId(
      "escalation-rule-card-header",
    );

    expect(
      within(header).getByTestId("escalation-rule-skipped-at-once"),
    ).toHaveTextContent(SKIPPED_LEVEL_TIMING);
    expect(
      within(header).queryByTestId("escalation-rule-escalates-after"),
    ).not.toBeInTheDocument();
    expect(header).not.toHaveTextContent("Escalates after");
    // Said once, in the header: the notice under it keeps to the fix.
    expect(cards[0]!.textContent?.split(SKIPPED_LEVEL_TIMING)).toHaveLength(2);
  });

  test("Level 2 pages somebody: its header keeps its wait", async () => {
    const cards: Array<HTMLElement> = await renderPage(THE_MAINTAINERS_POLICY);

    expect(
      within(cards[1]!).getByTestId("escalation-rule-escalates-after"),
    ).toHaveTextContent("Escalates after 30 min");
    expect(
      within(cards[1]!).queryByTestId("escalation-rule-skipped-at-once"),
    ).not.toBeInTheDocument();
  });

  test("on a page read right to left, its arrows point the way the words run", async () => {
    const cards: Array<HTMLElement> = await renderPage(THE_MAINTAINERS_POLICY);

    for (const arrowHolder of [
      within(cards[0]!).getByTestId("escalation-rule-skipped-at-once"),
      screen.getByTestId("escalation-rule-connector-at-once"),
      screen.getByTestId("escalation-summary-level-skipped"),
    ]) {
      expect(arrowHolder.querySelector("svg")).toHaveClass(
        ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME,
      );
    }

    // A wait's clock has no way to point.
    expect(
      within(cards[1]!)
        .getByTestId("escalation-rule-escalates-after")
        .querySelector("svg"),
    ).not.toHaveClass(ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME);
  });

  test("the step to Level 2 says Level 2 is paged at once - not after 4 minutes", async () => {
    await renderPage(THE_MAINTAINERS_POLICY);

    const atOnce: HTMLElement = screen.getByTestId(
      "escalation-rule-connector-at-once",
    );

    expect(atOnce).toHaveTextContent(PAGED_AT_ONCE_CONNECTOR);
    expect(PAGED_AT_ONCE_CONNECTOR).toBe(
      "Nobody to page here, so the next level is paged at once",
    );
    expect(atOnce).not.toHaveTextContent("If unacknowledged");
    expect(
      screen.queryByTestId("escalation-rule-connector"),
    ).not.toBeInTheDocument();
  });

  test("the summary marks Level 1 skipped, and Level 2 paged immediately", async () => {
    await renderPage(THE_MAINTAINERS_POLICY);

    expect(summaryTimings()).toEqual([
      `skipped: ${SKIPPED_LEVEL_TIMING}`,
      "Immediately",
    ]);
    expect(SKIPPED_LEVEL_TIMING).toBe("Skipped at once");
    // Level 1's 4 minutes are never waited: the final level comes at once.
    expect(toFinalLevel()).toBe("Instant");
  });
});

describe("an empty level between two that page", () => {
  const levels: Array<Level> = [
    { id: RULE_1, escalateAfterInMinutes: 5, notifies: "alex" },
    { id: RULE_2, escalateAfterInMinutes: 10, notifies: "nobody" },
    { id: RULE_3, escalateAfterInMinutes: 15, notifies: "alex" },
  ];

  test("the step after the first level waits its 5 minutes; the step after the empty one does not wait", async () => {
    await renderPage(levels);

    expect(screen.getByTestId("escalation-rule-connector")).toHaveTextContent(
      "If unacknowledged after 5 min, escalate to the next level",
    );
    expect(
      screen.getByTestId("escalation-rule-connector-at-once"),
    ).toHaveTextContent(PAGED_AT_ONCE_CONNECTOR);
  });

  test("the third level is paged after 5 minutes - the empty level's 10 are not counted", async () => {
    await renderPage(levels);

    expect(summaryTimings()).toEqual([
      "Immediately",
      `skipped: ${SKIPPED_LEVEL_TIMING}`,
      "After 5 min",
    ]);
    expect(toFinalLevel()).toBe("5 min");
  });
});

describe("a level whose schedule has nobody on call right now", () => {
  const levels: Array<Level> = [
    { id: RULE_1, escalateAfterInMinutes: 5, notifies: "uncovered schedule" },
    { id: RULE_2, escalateAfterInMinutes: 10, notifies: "alex" },
  ];

  test("keeps its wait: somebody may be on call when it is reached", async () => {
    const cards: Array<HTMLElement> = await renderPage(levels);

    expect(
      within(cards[0]!).getByTestId("escalation-rule-escalates-after"),
    ).toHaveTextContent("Escalates after 5 min");
    expect(
      within(cards[0]!).queryByTestId("escalation-rule-skipped-at-once"),
    ).not.toBeInTheDocument();

    expect(screen.getByTestId("escalation-rule-connector")).toHaveTextContent(
      "If unacknowledged after 5 min, escalate to the next level",
    );
    expect(
      screen.queryByTestId("escalation-rule-connector-at-once"),
    ).not.toBeInTheDocument();
    expect(
      within(cards[0]!).queryByTestId("escalation-rule-no-responders"),
    ).not.toBeInTheDocument();
    expect(summaryTimings()).toEqual(["Immediately", "After 5 min"]);
    expect(toFinalLevel()).toBe("5 min");
  });
});

describe("the rules a level is counted by", () => {
  test("a rule's responders are the people, teams and schedules still there", () => {
    const user: OnCallDutyPolicyEscalationRuleUser =
      new OnCallDutyPolicyEscalationRuleUser();
    user.user = { name: "Alex" } as never;
    const goneUser: OnCallDutyPolicyEscalationRuleUser =
      new OnCallDutyPolicyEscalationRuleUser();
    const team: OnCallDutyPolicyEscalationRuleTeam =
      new OnCallDutyPolicyEscalationRuleTeam();
    team.team = { name: "Platform" } as never;
    const schedule: OnCallDutyPolicyEscalationRuleSchedule =
      new OnCallDutyPolicyEscalationRuleSchedule();
    schedule.onCallDutyPolicySchedule = { name: "Primary" } as never;

    expect(countRuleResponders(emptyRuleMembers())).toBe(0);
    expect(
      countRuleResponders({
        userJoins: [goneUser],
        teamJoins: [],
        scheduleJoins: [],
      }),
    ).toBe(0);
    expect(
      countRuleResponders({
        userJoins: [user, goneUser],
        teamJoins: [team],
        scheduleJoins: [schedule],
      }),
    ).toBe(3);
  });

  test("a summary level is skipped when it has no responders - and only then", () => {
    const level: (
      responders: EscalationLevelSummary["responders"],
    ) => EscalationLevelSummary = (
      responders: EscalationLevelSummary["responders"],
    ): EscalationLevelSummary => {
      return { name: "Level 1", escalateAfterInMinutes: 30, responders };
    };

    expect(isSkippedLevel(level([]))).toBe(true);
    expect(
      isSkippedLevel(
        level([{ label: "Primary", type: "schedule", isUncovered: true }]),
      ),
    ).toBe(false);
    expect(isSkippedLevel(level([{ label: "Alex", type: "user" }]))).toBe(
      false,
    );
  });
});

describe("the escalation summary on its own", () => {
  test("every level empty: each is skipped, and the final level comes at once", () => {
    render(
      <EscalationSummary
        levels={[
          { name: "Level 1", escalateAfterInMinutes: 30, responders: [] },
          { name: "Level 2", escalateAfterInMinutes: 30, responders: [] },
        ]}
        repeatEnabled={false}
        repeatCount={0}
      />,
    );

    expect(
      screen.getAllByTestId("escalation-summary-level-skipped"),
    ).toHaveLength(2);
    expect(toFinalLevel()).toBe("Instant");
  });

  /*
   * REGRESSION (UI review): with every level empty the ladder ended "If
   * still unacknowledged, the entire policy repeats up to 2 more times" -
   * but a pass that paged nobody is never repeated, and a run of such a
   * policy stops at once. Nor is anybody paged again after acknowledging,
   * as nobody is paged at all.
   */
  test("every level empty: the ladder ends saying the policy pages nobody - no repeats, no page again", () => {
    render(
      <EscalationSummary
        levels={[
          { name: "Level 1", escalateAfterInMinutes: 30, responders: [] },
          { name: "Level 2", escalateAfterInMinutes: 30, responders: [] },
        ]}
        repeatEnabled={true}
        repeatCount={2}
        acknowledgementTimeoutInMinutes={30}
      />,
    );

    expect(
      screen.getByTestId("escalation-summary-pages-nobody"),
    ).toHaveTextContent(PAGES_NOBODY_ENDING);
    expect(PAGES_NOBODY_ENDING).toBe(
      "This policy will not page anyone when it is triggered.",
    );
    expect(document.body).not.toHaveTextContent("repeats");
    expect(
      screen.queryByTestId("escalation-summary-page-again"),
    ).not.toBeInTheDocument();
  });

  test("one level that pages somebody: the ladder ends as it always has", () => {
    render(
      <EscalationSummary
        levels={[
          { name: "Level 1", escalateAfterInMinutes: 30, responders: [] },
          {
            name: "Level 2",
            escalateAfterInMinutes: 30,
            responders: [{ label: "Alex", type: "user" }],
          },
        ]}
        repeatEnabled={true}
        repeatCount={2}
        acknowledgementTimeoutInMinutes={30}
      />,
    );

    expect(
      screen.queryByTestId("escalation-summary-pages-nobody"),
    ).not.toBeInTheDocument();
    expect(document.body).toHaveTextContent(
      "If still unacknowledged, the entire policy repeats up to 2 more times, then stops.",
    );
    expect(
      screen.getByTestId("escalation-summary-page-again"),
    ).toBeInTheDocument();
  });

  test("a skipped level still says it has no responders, beside its pill", () => {
    render(
      <EscalationSummary
        levels={[
          { name: "Level 1", escalateAfterInMinutes: 30, responders: [] },
          {
            name: "Level 2",
            escalateAfterInMinutes: 30,
            responders: [{ label: "Alex", type: "user" }],
          },
        ]}
        repeatEnabled={false}
        repeatCount={0}
      />,
    );

    expect(screen.getByText("No responders")).toBeInTheDocument();
    expect(
      screen.getByTestId("escalation-summary-level-skipped"),
    ).toHaveTextContent("Skipped at once");
  });
});
