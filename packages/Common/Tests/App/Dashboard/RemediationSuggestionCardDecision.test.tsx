import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";

// Only rendered when "Show reasoning" is opened; keep the lazy import out.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import RemediationStep from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * The Remediation step of an incident's or alert's AI card (block 43), now
 * that the engine writes down what it did with every signal:
 *
 * - a signal nothing was proposed for still shows the step, saying why -
 *   the Remediation card used to hide itself, so "fixes are off on that
 *   cluster", "this incident is linked to no cluster" and "no rule
 *   matched" all read the same: nothing at all;
 * - an older signal, with neither a decision nor a suggestion, says
 *   OneUptime AI has not tried to fix it - the step is always there;
 * - the decision is read beside the suggestions, for the same subject, and
 *   a failed read of it never hides the suggestions;
 * - while remediation waits for the AI investigation, the step says so and
 *   keeps reading until the evaluation lands;
 * - the step's pill says where fixing stands, whatever the step holds.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000003",
);
const ALERT_ID: ObjectID = new ObjectID("0193c0de-3333-4aaa-8bbb-000000000004");
const MONITOR_ID: string = "0193c0de-4444-4aaa-8bbb-000000000004";

interface Served {
  suggestions: Array<AutoRemediationSuggestion>;
  decisions: Array<JSONObject> | Error;
}

let getListSpy: ReturnType<typeof jest.spyOn>;

function serve(served: Served): void {
  getListSpy.mockImplementation((async (data: {
    modelType: { new (): unknown };
  }): Promise<
    ListResult<AutoRemediationDecision | AutoRemediationSuggestion>
  > => {
    if (data.modelType === AutoRemediationDecision) {
      if (served.decisions instanceof Error) {
        throw served.decisions;
      }

      const rows: Array<AutoRemediationDecision> = served.decisions.map(
        (row: JSONObject) => {
          return Object.assign(new AutoRemediationDecision(), row);
        },
      );
      return { data: rows, count: rows.length, skip: 0, limit: 5 };
    }

    return {
      data: served.suggestions,
      count: served.suggestions.length,
      skip: 0,
      limit: 10,
    };
  }) as never);
}

function suggestion(): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: "0193c0de-6666-4aaa-8bbb-000000000006",
    status: AutoRemediationSuggestionStatus.Suggested,
    ruleNameSnapshot: "Restart checkout",
    runbookNameSnapshot: "Restart the checkout pods",
    createdAt: new Date("2026-10-05T10:00:00Z"),
  });
}

// The step's status pill, beside its title.
function statusPill(): HTMLElement {
  return screen.getByLabelText("Remediation status");
}

function evaluatedDecision(entries: Array<JSONObject>): JSONObject {
  return {
    stage: "Evaluated",
    createdAt: new Date("2026-10-05T10:00:00Z"),
    entries,
  };
}

const LINKED_TO_NOTHING: JSONObject = {
  stage: "Evaluated",
  createdAt: new Date("2026-10-05T10:00:00Z"),
  entries: [
    {
      lane: "KubernetesCluster",
      reason: "ClusterNoneLinked",
      monitors: [{ id: MONITOR_ID, name: "Checkout website" }],
    },
    {
      lane: "Resource",
      reason: "ResourceNoneLinked",
      monitors: [{ id: MONITOR_ID, name: "Checkout website" }],
    },
    { lane: "Rule", reason: "NoRulesConfigured" },
  ],
};

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  getListSpy = jest.spyOn(ModelAPI, "getList");
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("RemediationStep with a recorded decision", () => {
  test("says why nothing was fixed when nothing was proposed", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });

    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );

    const decision: HTMLElement = await screen.findByTestId(
      "remediation-decision",
    );
    // Step 2 of the AI card, titled, with no card of its own around it.
    expect(
      screen.getByRole("heading", { level: 3, name: "Remediation" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("card")).not.toBeInTheDocument();
    // The step's title says what the lines are: no heading repeats it.
    expect(
      within(decision).queryByText("What auto-remediation did"),
    ).not.toBeInTheDocument();
    expect(
      within(decision).queryByTestId("remediation-decision-heading"),
    ).not.toBeInTheDocument();

    // The pill says where things stand before a sentence is read.
    expect(statusPill()).toHaveTextContent("Needs attention");
    expect(statusPill()).toHaveAttribute("data-indicator", "attention");

    const lines: Array<HTMLElement> = within(decision).getAllByTestId(
      "remediation-decision-line",
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveAttribute("data-tone", "attention");
    expect(lines[0]).toHaveTextContent(
      "This incident is not linked to a host, cluster or database, so OneUptime AI had nothing to fix.",
    );
    // What to do, under the sentence: add what it is about, and it tries again.
    expect(
      within(lines[0]!).getByTestId("remediation-decision-what-to-do"),
    ).toHaveTextContent(
      "What to do: Add the host, cluster or database it is about under Affected Resources, and OneUptime AI tries again.",
    );
    expect(
      within(lines[0]!).queryByTestId("remediation-decision-why"),
    ).not.toBeInTheDocument();
    expect(
      within(lines[0]!).getByRole("link", { name: "Link Checkout website" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`,
    );
    expect(lines[1]).toHaveAttribute("data-tone", "info");
    expect(lines[1]).toHaveTextContent(
      "No AI rule is set up for this kind of incident.",
    );
  });

  test("reads the decision of the card's own subject, newest first", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });

    render(
      <RemediationStep investigationStage="reported" alertId={ALERT_ID} />,
    );
    await screen.findByTestId("remediation-decision");

    const decisionCall: {
      query: JSONObject;
      sort: JSONObject;
      select: JSONObject;
    } = getListSpy.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          modelType: unknown;
          query: JSONObject;
          sort: JSONObject;
          select: JSONObject;
        };
      })
      .find((args: { modelType: unknown }) => {
        return args.modelType === AutoRemediationDecision;
      })!;

    expect(String(decisionCall.query["alertId"])).toBe(ALERT_ID.toString());
    expect(decisionCall.query["incidentId"]).toBeUndefined();
    expect(decisionCall.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(decisionCall.select).toEqual({
      _id: true,
      stage: true,
      entries: true,
      createdAt: true,
    });

    // The suggestions are still the card's first read.
    expect(
      (getListSpy.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(AutoRemediationSuggestion);
  });

  test("an older signal with neither a decision nor a suggestion says it was not tried", async () => {
    serve({ suggestions: [], decisions: [] });

    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );

    expect(
      await screen.findByTestId("remediation-step-not-tried"),
    ).toHaveTextContent("OneUptime AI has not tried to fix this incident.");
    expect(statusPill()).toHaveTextContent("Not tried");
    expect(statusPill()).toHaveAttribute("data-indicator", "idle");
    expect(getListSpy).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByTestId("remediation-decision"),
    ).not.toBeInTheDocument();
  });

  test("shows the decision above the suggestions it produced", async () => {
    serve({
      suggestions: [suggestion()],
      decisions: [
        {
          stage: "Evaluated",
          createdAt: new Date(),
          entries: [
            {
              lane: "Rule",
              reason: "RuleRunbookProposed",
              ruleName: "Restart checkout",
              runbookName: "Restart the checkout pods",
            },
          ],
        },
      ],
    });

    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );

    const decision: HTMLElement = await screen.findByTestId(
      "remediation-decision",
    );
    const runbook: HTMLElement = screen.getByText("Restart the checkout pods", {
      selector: "span",
    });
    expect(
      decision.compareDocumentPosition(runbook) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(decision).getByTestId("remediation-decision-line"),
    ).toHaveAttribute("data-tone", "acted");

    // The step's title heads both: no heading of their own above the lines.
    expect(
      within(decision).queryByTestId("remediation-decision-heading"),
    ).not.toBeInTheDocument();
    // The fixes come right after, as one list of their own.
    expect(
      decision.compareDocumentPosition(
        screen.getByTestId("remediation-fixes"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a fix waiting for approval is what the pill says, whatever the decision said", async () => {
    serve({
      suggestions: [suggestion()],
      decisions: [
        evaluatedDecision([
          { lane: "Project", reason: "EnableAiOff" },
          { lane: "Rule", reason: "RuleAlreadyProposed", ruleName: "Restart" },
        ]),
      ],
    });

    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );

    await screen.findByTestId("remediation-decision");
    expect(
      within(screen.getByTestId("remediation-fix")).getByText(
        "Waiting for approval",
      ),
    ).toBeInTheDocument();
    /*
     * The decision was written when the signal was evaluated; the fix
     * follows the fix. The step's pill says what needs the reader now - an
     * approval - not what the older decision found.
     */
    expect(statusPill()).toHaveTextContent("Needs your approval");
    expect(statusPill()).toHaveAttribute("data-indicator", "attention");
    expect(
      screen.queryByTestId("remediation-decision-status"),
    ).not.toBeInTheDocument();
  });

  test.each([
    [
      "incident",
      '"Fix new incidents automatically" is off for this project, so OneUptime AI did not try to fix this incident.',
      "Turn on for incidents",
      "incidents",
    ],
    [
      "alert",
      '"Fix new alerts automatically" is off for this project, so OneUptime AI did not try to fix this alert.',
      "Turn on for alerts",
      "alerts",
    ],
  ])(
    "with fixing new %ss off, says fixing is off and links to the switch",
    async (signal: string, text: string, linkName: string, path: string) => {
      serve({
        suggestions: [],
        decisions: [
          evaluatedDecision([{ lane: "Project", reason: "RemediationOff" }]),
        ],
      });

      render(
        signal === "incident" ? (
          <RemediationStep
            investigationStage="reported"
            incidentId={INCIDENT_ID}
          />
        ) : (
          <RemediationStep investigationStage="reported" alertId={ALERT_ID} />
        ),
      );

      const line: HTMLElement = await screen.findByTestId(
        "remediation-decision-line",
      );
      expect(statusPill()).toHaveTextContent("Off");
      expect(statusPill()).toHaveAttribute("data-indicator", "idle");
      expect(line).toHaveAttribute("data-tone", "info");
      expect(
        within(line).getByTestId("remediation-decision-text"),
      ).toHaveTextContent(text);

      // The arrow is drawn, not read: the link is named by its words alone.
      const link: HTMLElement = within(line).getByRole("link", {
        name: linkName,
      });
      expect(link).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID}/${path}/ai/settings`,
      );
      expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    },
  );

  test("says action was taken while the fix it started is not listed yet", async () => {
    serve({
      suggestions: [],
      decisions: [
        evaluatedDecision([
          {
            lane: "KubernetesCluster",
            reason: "ClusterRoundStarted",
            kubernetesClusterId: "0193c0de-5555-4aaa-8bbb-000000000005",
            kubernetesClusterName: "prod-east",
            remediationMode: "Automatic",
          },
          { lane: "Resource", reason: "ResourceSkippedForClusterRound" },
          { lane: "Rule", reason: "NoRulesConfigured" },
        ]),
      ],
    });

    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );

    await screen.findByTestId("remediation-decision");
    expect(statusPill()).toHaveTextContent("Fixing…");
    expect(statusPill()).toHaveAttribute("data-indicator", "live");
    expect(
      screen
        .getAllByTestId("remediation-decision-line")
        .map((line: HTMLElement) => {
          return line.getAttribute("data-tone");
        }),
    ).toEqual(["acted", "info"]);
  });

  test("shows the gap that blocks a cluster as why and what to do", async () => {
    serve({
      suggestions: [],
      decisions: [
        evaluatedDecision([
          {
            lane: "KubernetesCluster",
            reason: "ClusterNotReady",
            kubernetesClusterId: "0193c0de-5555-4aaa-8bbb-000000000005",
            kubernetesClusterName: "prod-east",
            gaps: [
              {
                code: "remediation_write_access_missing",
                title: "The AI agent is read-only",
                description: "The chart was installed without write access",
                nextStep:
                  "Upgrade the chart with aiAgent.remediation.enabled=true.",
              },
            ],
          },
        ]),
      ],
    });

    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );

    const line: HTMLElement = await screen.findByTestId(
      "remediation-decision-line",
    );
    expect(statusPill()).toHaveTextContent("Needs attention");
    expect(
      within(line).getByTestId("remediation-decision-why"),
    ).toHaveTextContent(
      "Why: The AI agent is read-only. The chart was installed without write access",
    );
    expect(
      within(line).getByTestId("remediation-decision-what-to-do"),
    ).toHaveTextContent(
      "What to do: Upgrade the chart with aiAgent.remediation.enabled=true.",
    );
    expect(
      within(line).getByRole("link", {
        name: "Open the cluster's AI agent page",
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/kubernetes/0193c0de-5555-4aaa-8bbb-000000000005/ai/agent`,
    );
  });

  test("keeps the suggestions when the decision cannot be read", async () => {
    serve({ suggestions: [suggestion()], decisions: new Error("no route") });

    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );

    expect(
      await screen.findByText("Restart the checkout pods", {
        selector: "span",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("remediation-decision"),
    ).not.toBeInTheDocument();
  });

  test("says it waits for the investigation, and reads again until the evaluation lands", async () => {
    jest.useFakeTimers();
    serve({
      suggestions: [],
      decisions: [
        {
          stage: "WaitingForInvestigation",
          createdAt: new Date(),
          entries: [],
        },
      ],
    });

    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("remediation-decision-line")).toHaveAttribute(
        "data-tone",
        "waiting",
      );
    });
    expect(screen.getByTestId("remediation-decision-line")).toHaveTextContent(
      "OneUptime AI decides how to fix this incident once the investigation is done, so it can act on the root cause.",
    );
    expect(statusPill()).toHaveTextContent("Waiting");
    expect(statusPill()).toHaveAttribute("data-indicator", "waiting");
    const readsBefore: number = getListSpy.mock.calls.length;

    serve({
      suggestions: [],
      decisions: [
        {
          stage: "WaitingForInvestigation",
          createdAt: new Date(1),
          entries: [],
        },
        {
          stage: "Evaluated",
          createdAt: new Date(2),
          entries: [{ lane: "Project", reason: "EnableAiOff" }],
        },
      ],
    });

    await act(async () => {
      jest.advanceTimersByTime(16 * 1000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(getListSpy.mock.calls.length).toBeGreaterThan(readsBefore);
      expect(screen.getByTestId("remediation-decision-line")).toHaveTextContent(
        "Enable AI is off for this project",
      );
    });
    // The pill follows: the wait is over, and what it found needs attention.
    expect(statusPill()).toHaveTextContent("Needs attention");
    expect(statusPill()).toHaveAttribute("data-indicator", "attention");
  });
});
