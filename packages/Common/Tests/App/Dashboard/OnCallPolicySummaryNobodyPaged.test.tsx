import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A POLICY THAT PAGES NOBODY SAYS SO, AND OFFERS THE WAY OUT.
 *
 * The policy overview's summary has two "nobody is paged" states: no
 * escalation rules at all, and rules with nobody in them. Both used to send
 * the reader to an "Escalation tab" by name - a tab the side menu calls
 * Escalation Rules. Each now says what is wrong in one sentence and has a
 * button to the policy's Escalation Rules page, where the first rule (or
 * the missing responders) is added. A policy that pages somebody shows
 * neither.
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
            return "0c000000-0000-4000-8000-000000000001";
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
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import Team from "../../../Models/DatabaseModels/Team";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000002",
);
const RULE_ID: string = "0c000000-0000-4000-8000-000000000003";
const TEAM_ID: string = "0c000000-0000-4000-8000-000000000004";

const NO_RULES_SENTENCE: string =
  "This policy has no escalation rules yet, so triggering it will not page anyone.";
const NO_RESPONDERS_TITLE: string = "No responders are assigned";
const NO_RESPONDERS_SENTENCE: string =
  "This policy will not page anyone when it is triggered.";
const BUTTON_TEXT: string = "Go to Escalation Rules";

let navigateCalls: Array<string>;

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

interface Fixture {
  rules: number;
  teamOnFirstRule: boolean;
}

// The rows ModelAPI.getList hands back: models, as it builds them.
function serve(fixture: Fixture): void {
  getListMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === OnCallDutyPolicyEscalationRule) {
      return list(
        Array.from({ length: fixture.rules }, (_: unknown, index: number) => {
          const rule: OnCallDutyPolicyEscalationRule =
            new OnCallDutyPolicyEscalationRule();
          rule._id = index === 0 ? RULE_ID : ObjectID.generate().toString();
          rule.escalateAfterInMinutes = 30;
          rule.order = index + 1;
          return rule;
        }),
      );
    }

    if (
      params.modelType === OnCallDutyPolicyEscalationRuleTeam &&
      fixture.teamOnFirstRule
    ) {
      const team: Team = new Team();
      team._id = TEAM_ID;
      team.name = "Payments";

      const join: OnCallDutyPolicyEscalationRuleTeam =
        new OnCallDutyPolicyEscalationRuleTeam();
      join._id = ObjectID.generate().toString();
      join.onCallDutyPolicyEscalationRuleId = new ObjectID(RULE_ID);
      join.team = team;

      return list([join]);
    }

    return list([]);
  });

  getItemMock.mockResolvedValue({
    repeatPolicyIfNoOneAcknowledges: false,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
  } as never);
}

async function renderSummary(fixture: Fixture): Promise<void> {
  serve(fixture);

  render(
    <OnCallPolicySummary
      onCallDutyPolicyId={POLICY_ID}
      projectId={PROJECT_ID}
    />,
  );

  await screen.findByText("Policy at a glance");
}

function escalationRulesRoute(): string {
  return (RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION] as Route)
    .toString()
    .replace(":projectId", PROJECT_ID.toString())
    .replace(":id", POLICY_ID.toString());
}

beforeEach(() => {
  navigateCalls = [];

  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (route: unknown): void => {
      navigateCalls.push(String(route));
    },
  );
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  jest.restoreAllMocks();
});

describe("a policy with no escalation rules", () => {
  test("says nobody will be paged, and nothing about an Escalation tab", async () => {
    await renderSummary({ rules: 0, teamOnFirstRule: false });

    const state: HTMLElement = await screen.findByTestId(
      "policy-summary-no-rules",
    );

    expect(state).toHaveTextContent(NO_RULES_SENTENCE);
    expect(state.textContent).not.toContain("tab");
  });

  test("offers the way to its Escalation Rules page", async () => {
    await renderSummary({ rules: 0, teamOnFirstRule: false });

    const state: HTMLElement = await screen.findByTestId(
      "policy-summary-no-rules",
    );

    fireEvent.click(within(state).getByRole("button", { name: BUTTON_TEXT }));

    expect(navigateCalls).toEqual([escalationRulesRoute()]);
    expect(navigateCalls[0]).toBe(
      `/dashboard/${PROJECT_ID.toString()}/on-call-duty/policies/${POLICY_ID.toString()}/escalation`,
    );
  });
});

describe("a policy whose rules have nobody in them", () => {
  test("says nobody will be paged and offers the same way", async () => {
    await renderSummary({ rules: 2, teamOnFirstRule: false });

    const state: HTMLElement = await screen.findByTestId(
      "policy-summary-no-responders",
    );

    expect(state).toHaveTextContent(NO_RESPONDERS_TITLE);
    expect(state).toHaveTextContent(NO_RESPONDERS_SENTENCE);
    expect(state.textContent).not.toContain("Escalation tab");

    fireEvent.click(within(state).getByRole("button", { name: BUTTON_TEXT }));

    expect(navigateCalls).toEqual([escalationRulesRoute()]);
  });
});

describe("a policy that pages somebody", () => {
  test("shows neither state, nor the button", async () => {
    await renderSummary({ rules: 1, teamOnFirstRule: true });

    await screen.findByText("Payments");

    expect(screen.queryByTestId("policy-summary-no-rules")).toBeNull();
    expect(screen.queryByTestId("policy-summary-no-responders")).toBeNull();
    expect(screen.queryByRole("button", { name: BUTTON_TEXT })).toBeNull();
  });
});

describe("the summary's source", () => {
  const SOURCE: string = fs.readFileSync(
    path.join(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicySummary.tsx",
    ),
    "utf8",
  );

  test("no longer sends readers to an Escalation tab", () => {
    expect(SOURCE).not.toMatch(/Escalation tab/);
    expect(SOURCE).not.toMatch(/>\s*Escalation\s*</);
  });

  test("looks its sentences up whole", () => {
    // Formatting aside: prettier may break a call over lines.
    const flat: string = SOURCE.replace(/\s+/g, " ").replace(/\( /g, "(");

    for (const sentence of [
      NO_RULES_SENTENCE,
      NO_RESPONDERS_TITLE,
      NO_RESPONDERS_SENTENCE,
    ]) {
      expect(flat).toContain(`translator.translateText("${sentence}"`);
    }

    // The button translates its own title.
    expect(SOURCE).toContain(`title="${BUTTON_TEXT}"`);
  });
});
