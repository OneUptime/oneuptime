import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "POLICY AT A GLANCE" WITH A LEVEL THAT HAS NOBODY TO PAGE.
 *
 * A run passes a level with no responders at once (OnCallEmptyLevel), so the
 * policy overview's summary says so: its warning about such levels says
 * they are skipped without waiting, where it said they "will notify no one
 * when reached", and its time to the final level leaves their waits out -
 * the policy never waits them. A level whose only responder is a schedule
 * with nobody on call right now keeps its wait: somebody may be on call
 * when it is reached. A policy with no responders at all is told in one
 * sentence: a run of it passes every level at once and stops without
 * repeating, so there is no ladder to tell.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0c100000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import OnCallPolicySummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicySummary";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "0c100000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "0c100000-0000-4000-8000-000000000002",
);

interface Level {
  wait: number;
  notifies: "team" | "uncovered schedule" | "nobody";
}

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

async function renderSummary(levels: Array<Level>): Promise<void> {
  const ids: Array<string> = levels.map((): string => {
    return ObjectID.generate().toString();
  });

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === OnCallDutyPolicyEscalationRule) {
      return list(
        levels.map((level: Level, index: number) => {
          const rule: OnCallDutyPolicyEscalationRule =
            new OnCallDutyPolicyEscalationRule();
          rule._id = ids[index]!;
          rule.escalateAfterInMinutes = level.wait;
          rule.order = index + 1;
          return rule;
        }),
      );
    }

    if (params.modelType === OnCallDutyPolicyEscalationRuleTeam) {
      return list(
        levels
          .map((level: Level, index: number) => {
            return { level, id: ids[index]! };
          })
          .filter((entry: { level: Level }): boolean => {
            return entry.level.notifies === "team";
          })
          .map((entry: { id: string }) => {
            const team: Team = new Team();
            team._id = ObjectID.generate().toString();
            team.name = "Payments";

            const join: OnCallDutyPolicyEscalationRuleTeam =
              new OnCallDutyPolicyEscalationRuleTeam();
            join._id = ObjectID.generate().toString();
            join.onCallDutyPolicyEscalationRuleId = new ObjectID(entry.id);
            join.team = team;
            return join;
          }),
      );
    }

    if (params.modelType === OnCallDutyPolicyEscalationRuleSchedule) {
      return list(
        levels
          .map((level: Level, index: number) => {
            return { level, id: ids[index]! };
          })
          .filter((entry: { level: Level }): boolean => {
            return entry.level.notifies === "uncovered schedule";
          })
          .map((entry: { id: string }) => {
            const schedule: OnCallDutyPolicySchedule =
              new OnCallDutyPolicySchedule();
            schedule._id = ObjectID.generate().toString();
            schedule.name = "Nights";

            const join: OnCallDutyPolicyEscalationRuleSchedule =
              new OnCallDutyPolicyEscalationRuleSchedule();
            join._id = ObjectID.generate().toString();
            join.onCallDutyPolicyEscalationRuleId = new ObjectID(entry.id);
            join.onCallDutyPolicySchedule = schedule;
            return join;
          }),
      );
    }

    return list([]);
  });

  getItemMock.mockResolvedValue({
    repeatPolicyIfNoOneAcknowledges: false,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
  } as never);

  render(
    <OnCallPolicySummary
      onCallDutyPolicyId={POLICY_ID}
      projectId={PROJECT_ID}
    />,
  );

  await screen.findByText("Who gets paged");
}

// What the "To final level" metric says.
function toFinalLevel(): string {
  return (
    screen.getByText("To final level").parentElement?.nextElementSibling
      ?.textContent || ""
  );
}

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  jest.restoreAllMocks();
});

describe("a level with no responders before the final one", () => {
  test("the maintainer's policy: Level 1 empty, so the final level is engaged at once", async () => {
    await renderSummary([
      { wait: 4, notifies: "nobody" },
      { wait: 30, notifies: "team" },
    ]);

    expect(toFinalLevel()).toBe("Instant");
    expect(
      screen.getByText((_content: string, element: Element | null): boolean => {
        return (
          element?.tagName === "P" &&
          (element.textContent || "").includes(
            "every remaining level is engaged right away",
          )
        );
      }),
    ).toBeInTheDocument();
  });

  test("its wait is left out of the time to the final level: 5 minutes, not 15", async () => {
    await renderSummary([
      { wait: 5, notifies: "team" },
      { wait: 10, notifies: "nobody" },
      { wait: 15, notifies: "team" },
    ]);

    expect(toFinalLevel()).toBe("5 min");
    expect(
      screen.getByText((_content: string, element: Element | null): boolean => {
        return (
          element?.tagName === "P" &&
          (element.textContent || "").includes(
            "climbs to the final level after 5 min",
          )
        );
      }),
    ).toBeInTheDocument();
  });

  test("the warning says the level is skipped without waiting - not that it notifies nobody when reached", async () => {
    await renderSummary([
      { wait: 5, notifies: "team" },
      { wait: 10, notifies: "nobody" },
      { wait: 15, notifies: "team" },
    ]);

    const warning: HTMLElement = screen.getByTestId(
      "policy-summary-levels-skipped",
    );

    expect(warning).toHaveTextContent(
      "1 level along the way has no responders, so it is skipped without waiting.",
    );
    expect(warning.textContent).not.toContain("will notify no one");
  });

  test("two such levels: said once, for both", async () => {
    await renderSummary([
      { wait: 5, notifies: "nobody" },
      { wait: 10, notifies: "nobody" },
      { wait: 15, notifies: "team" },
    ]);

    expect(
      screen.getByTestId("policy-summary-levels-skipped"),
    ).toHaveTextContent(
      "2 levels along the way have no responders, so they are skipped without waiting.",
    );
    expect(toFinalLevel()).toBe("Instant");
  });
});

describe("a level whose schedule has nobody on call right now", () => {
  test("keeps its wait: somebody may be on call by the time it is reached", async () => {
    await renderSummary([
      { wait: 5, notifies: "uncovered schedule" },
      { wait: 15, notifies: "team" },
    ]);

    expect(toFinalLevel()).toBe("5 min");
    expect(
      screen.queryByTestId("policy-summary-levels-skipped"),
    ).not.toBeInTheDocument();
  });
});

describe("a policy whose every level pages somebody", () => {
  test("the time to the final level is every wait before it, as before", async () => {
    await renderSummary([
      { wait: 5, notifies: "team" },
      { wait: 10, notifies: "team" },
      { wait: 15, notifies: "team" },
    ]);

    expect(toFinalLevel()).toBe("15 min");
    expect(
      screen.queryByTestId("policy-summary-levels-skipped"),
    ).not.toBeInTheDocument();
  });
});

/*
 * REGRESSION (UI review): a policy with no responders at all read "When
 * this policy is triggered, it works through 2 escalation levels, but no
 * responders are assigned yet. The first level is notified immediately; if
 * no one acknowledges, every remaining level is engaged right away. If it
 * is still unacknowledged, the whole policy repeats up to 2 more times
 * before stopping." - a run that never happens: with nobody to page, a run
 * passes every level at once and stops, and a pass that paged nobody is
 * never repeated (OnCallEmptyLevel).
 */
describe("a policy with no responders at all", () => {
  async function renderEmptyPolicy(): Promise<HTMLElement> {
    getListMock.mockImplementation(async (params: any): Promise<any> => {
      if (params.modelType === OnCallDutyPolicyEscalationRule) {
        return list(
          [4, 30].map((wait: number, index: number) => {
            const rule: OnCallDutyPolicyEscalationRule =
              new OnCallDutyPolicyEscalationRule();
            rule._id = ObjectID.generate().toString();
            rule.escalateAfterInMinutes = wait;
            rule.order = index + 1;
            return rule;
          }),
        );
      }

      return list([]);
    });

    getItemMock.mockResolvedValue({
      repeatPolicyIfNoOneAcknowledges: true,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 2,
      acknowledgementTimeoutInMinutes: 30,
    } as never);

    render(
      <OnCallPolicySummary
        onCallDutyPolicyId={POLICY_ID}
        projectId={PROJECT_ID}
      />,
    );

    return await screen.findByTestId("policy-summary-no-responders");
  }

  test("its narrative is the one sentence that is true: no timing, no repeats, no paging again", async () => {
    await renderEmptyPolicy();

    const narrative: HTMLElement = screen.getByTestId(
      "policy-summary-narrative",
    );

    expect(narrative.textContent?.trim()).toBe(
      "When this policy is triggered, it works through 2 escalation levels, but no responders are assigned yet.",
    );
    expect(narrative).not.toHaveTextContent("notified immediately");
    expect(narrative).not.toHaveTextContent("repeats");
    expect(narrative).not.toHaveTextContent("acknowledged");
  });

  test("the notice under it says the policy pages nobody, and where to fix it", async () => {
    const notice: HTMLElement = await renderEmptyPolicy();

    expect(notice).toHaveTextContent(
      "This policy will not page anyone when it is triggered.",
    );
    expect(
      screen.getByTestId("policy-summary-escalation-rules-button"),
    ).toBeInTheDocument();
  });

  test("a policy with somebody to page still tells its whole ladder", async () => {
    await renderSummary([
      { wait: 4, notifies: "nobody" },
      { wait: 30, notifies: "team" },
    ]);

    const narrative: HTMLElement = screen.getByTestId(
      "policy-summary-narrative",
    );

    expect(narrative).toHaveTextContent(
      "When this policy is triggered, it works through 2 escalation levels and can page up to 1 responder.",
    );
    expect(narrative).toHaveTextContent(
      "The first level is notified immediately",
    );
    expect(narrative).toHaveTextContent(
      "If it is still unacknowledged after the final level, escalation stops.",
    );
  });
});
