import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A POLICY THAT PAGES AGAIN SAYS SO WHERE IT IS SUMMED UP (issue #5123, UI
 * review).
 *
 * The acknowledgement timeout waits, folded, under More settings at the
 * bottom of a policy's Escalation Rules page - the maintainer asked for it
 * hidden. But once somebody turns it on, it pages people: so the two places
 * a policy is read in a few seconds - the Escalation summary at the top of
 * that page, and Policy at a glance on the policy's Overview - end by
 * saying "If it is acknowledged but not resolved within 30 min, it pages
 * again, up to 5 times." A policy that does not page again reads exactly as
 * it always did.
 */

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
            return "0c000000-0000-4000-8000-0000000000a1";
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

import EscalationSummary, {
  EscalationLevelSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationSummary";
import OnCallPolicySummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicySummary";
import AcknowledgementTimeoutPolicySentence, {
  ACKNOWLEDGEMENT_TIMEOUT_POLICY_SENTENCE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/AcknowledgementTimeout/AcknowledgementTimeoutPolicySentence";
import {
  ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
  AcknowledgementTimeoutCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/AcknowledgementTimeout/AcknowledgementTimeout";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import Team from "../../../Models/DatabaseModels/Team";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const SENTENCE_30: string =
  "If it is acknowledged but not resolved within 30 min, it pages again, up to 5 times.";

const LEVELS: Array<EscalationLevelSummary> = [
  {
    name: "Level 1",
    escalateAfterInMinutes: 15,
    responders: [{ label: "Payments", type: "team" }],
  },
  {
    name: "Level 2",
    escalateAfterInMinutes: 30,
    responders: [{ label: "Dana Kim", type: "user" }],
  },
];

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
});

function sentence(): HTMLElement | null {
  return screen.queryByTestId(ACKNOWLEDGEMENT_TIMEOUT_POLICY_SENTENCE_TEST_ID);
}

describe("the sentence", () => {
  test("says the timeout and the cap, both in bold, as the summaries draw their numbers", () => {
    render(<AcknowledgementTimeoutPolicySentence duration="30 min" />);

    const element: HTMLElement = sentence()!;

    expect(element).toHaveTextContent(SENTENCE_30);

    const boldNodes: Array<Element> = Array.from(
      element.querySelectorAll(".font-semibold"),
    );

    expect(
      boldNodes.map((node: Element): string => {
        return node.textContent || "";
      }),
    ).toEqual(["30 min", "up to 5 times"]);

    // Each stays whole on a phone: "up to 5" / "times" broke across lines.
    for (const node of boldNodes) {
      expect(node).toHaveClass("whitespace-nowrap");
    }
  });

  test("the cap is the rule's, in words of its own", () => {
    expect(ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN).toBe(5);
    expect(AcknowledgementTimeoutCopy.policySentence).toBe(
      "If it is acknowledged but not resolved within {{duration}}, it pages again, {{times}}.",
    );
    /*
     * Not the shared "{{count}} times", which some languages word as a count
     * of occurrences ("Случаев: 5") - wrong after "up to".
     */
    expect(AcknowledgementTimeoutCopy.policySentenceTimes).toEqual({
      one: "up to {{count}} time",
      other: "up to {{count}} times",
    });
  });
});

describe("the Escalation summary at the top of the Escalation Rules page", () => {
  test.each([
    [30, SENTENCE_30],
    [
      90,
      "If it is acknowledged but not resolved within 1 hr 30 min, it pages again, up to 5 times.",
    ],
    [
      60,
      "If it is acknowledged but not resolved within 1 hr, it pages again, up to 5 times.",
    ],
    [
      1440,
      "If it is acknowledged but not resolved within 24 hrs, it pages again, up to 5 times.",
    ],
  ])(
    "ends with what happens after an acknowledgement, while it pages again after %s minutes",
    (minutes: number, expected: string) => {
      render(
        <EscalationSummary
          levels={LEVELS}
          repeatEnabled={false}
          repeatCount={0}
          acknowledgementTimeoutInMinutes={minutes}
        />,
      );

      const row: HTMLElement = screen.getByTestId(
        "escalation-summary-page-again",
      );

      expect(
        within(row).getByTestId(
          ACKNOWLEDGEMENT_TIMEOUT_POLICY_SENTENCE_TEST_ID,
        ),
      ).toHaveTextContent(expected);
    },
  );

  test("the row comes after the last step, as a branch of its own: no step leads to it", () => {
    render(
      <EscalationSummary
        levels={LEVELS}
        repeatEnabled={false}
        repeatCount={0}
        acknowledgementTimeoutInMinutes={30}
      />,
    );

    const stop: HTMLElement = screen.getByText(
      "If no one acknowledges after the final level, escalation stops here.",
    );
    const row: HTMLElement = screen.getByTestId(
      "escalation-summary-page-again",
    );

    expect(
      stop.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    /*
     * Set apart by a gap and a rule above it, not joined to the steps by a
     * connector: the gap is an element of its own, since the list's
     * space-y-0 would zero a margin on the row.
     */
    expect(row).toHaveClass("border-t");
    expect(row).not.toHaveClass("mt-3");

    const gap: Element | null = row.previousElementSibling;

    expect(gap).toHaveClass("h-3");
    expect(gap).toHaveAttribute("aria-hidden", "true");
    expect(gap?.previousElementSibling?.tagName).toBe("LI");
    expect(gap?.previousElementSibling).toHaveTextContent(
      "If no one acknowledges after the final level, escalation stops here.",
    );
  });

  test.each([[null], [undefined], [0]])(
    "a policy that does not page again (%s) reads as it always did",
    (minutes: number | null | undefined) => {
      render(
        <EscalationSummary
          levels={LEVELS}
          repeatEnabled={true}
          repeatCount={2}
          acknowledgementTimeoutInMinutes={minutes}
        />,
      );

      expect(screen.queryByTestId("escalation-summary-page-again")).toBeNull();
      expect(sentence()).toBeNull();
    },
  );
});

describe("Policy at a glance on the policy's Overview", () => {
  const POLICY_ID: ObjectID = new ObjectID(
    "0c000000-0000-4000-8000-0000000000a2",
  );
  const PROJECT_ID: ObjectID = new ObjectID(
    "0c000000-0000-4000-8000-0000000000a1",
  );
  const RULE_ID: string = "0c000000-0000-4000-8000-0000000000a3";

  let policySelects: Array<JSONObject>;

  function list(data: Array<unknown>): JSONObject {
    return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
  }

  function serve(policy: JSONObject): void {
    getListMock.mockImplementation(async (params: any): Promise<any> => {
      if (params.modelType === OnCallDutyPolicyEscalationRule) {
        const rule: OnCallDutyPolicyEscalationRule =
          new OnCallDutyPolicyEscalationRule();
        rule._id = RULE_ID;
        rule.escalateAfterInMinutes = 30;
        rule.order = 1;
        return list([rule]);
      }

      if (params.modelType === OnCallDutyPolicyEscalationRuleTeam) {
        const team: Team = new Team();
        team._id = "0c000000-0000-4000-8000-0000000000a4";
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

    getItemMock.mockImplementation(async (params: any): Promise<any> => {
      policySelects.push(params.select as JSONObject);
      return {
        repeatPolicyIfNoOneAcknowledges: false,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
        ...policy,
      };
    });
  }

  beforeEach(() => {
    policySelects = [];
  });

  async function renderGlance(policy: JSONObject): Promise<HTMLElement> {
    serve(policy);

    render(
      <OnCallPolicySummary
        onCallDutyPolicyId={POLICY_ID}
        projectId={PROJECT_ID}
      />,
    );

    await screen.findByText("Payments");

    return screen.getByText(/When this policy is triggered/).closest("p")!;
  }

  test("reads the timeout with the repeat", async () => {
    await renderGlance({ acknowledgementTimeoutInMinutes: 30 });

    expect(policySelects).toHaveLength(1);
    expect(policySelects[0]).toEqual(
      expect.objectContaining({
        repeatPolicyIfNoOneAcknowledges: true,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
        acknowledgementTimeoutInMinutes: true,
      }),
    );
  });

  test("its narrative ends with what happens after an acknowledgement, while the policy pages again", async () => {
    const narrative: HTMLElement = await renderGlance({
      acknowledgementTimeoutInMinutes: 30,
    });

    expect(narrative.textContent!.trim().endsWith(SENTENCE_30)).toBe(true);
    // One sentence after another, never run together.
    expect(narrative.textContent).toContain(
      "escalation stops. If it is acknowledged",
    );
  });

  test("a policy that does not page again reads as it always did", async () => {
    const narrative: HTMLElement = await renderGlance({
      acknowledgementTimeoutInMinutes: null,
    });

    expect(sentence()).toBeNull();
    expect(
      narrative
        .textContent!.trim()
        .endsWith(
          "If it is still unacknowledged after the final level, escalation stops.",
        ),
    ).toBe(true);
  });

  test("a stored number out of range reads as the worker reads it", async () => {
    const narrative: HTMLElement = await renderGlance({
      acknowledgementTimeoutInMinutes: 2,
    });

    // Under the floor of 5 minutes, it is 5 minutes.
    expect(narrative).toHaveTextContent(
      "If it is acknowledged but not resolved within 5 min, it pages again, up to 5 times.",
    );
  });
});
