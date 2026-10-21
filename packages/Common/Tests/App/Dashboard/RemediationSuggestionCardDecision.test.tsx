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

import RemediationSuggestionCard from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationSuggestionCard";
import { REMEDIATION_DECISION_CARD_DESCRIPTION } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
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
 * The incident's and alert's Remediation card, now that the engine writes
 * down what it did with every signal:
 *
 * - a signal nothing was proposed for still shows the card, saying why -
 *   the card used to hide itself, so "fixes are off on that cluster", "this
 *   incident is linked to no cluster" and "no rule matched" all read the
 *   same: nothing at all;
 * - an older signal, with neither a decision nor a suggestion, still shows
 *   nothing;
 * - the decision is read beside the suggestions, for the same subject, and
 *   a failed read of it never hides the suggestions;
 * - while remediation waits for the AI investigation, the card says so and
 *   keeps reading until the evaluation lands.
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

/*
 * The status pill, where Card puts what a card offers: in the header, at
 * its right edge.
 */
function statusPill(): HTMLElement {
  return within(screen.getByTestId("card-header-actions")).getByTestId(
    "remediation-decision-status",
  );
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

describe("RemediationSuggestionCard with a recorded decision", () => {
  test("says why nothing was fixed when nothing was proposed", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });

    render(
      <RemediationSuggestionCard incidentId={INCIDENT_ID} hideIfEmpty={true} />,
    );

    const decision: HTMLElement = await screen.findByTestId(
      "remediation-decision",
    );
    expect(screen.getByText("Remediation")).toBeInTheDocument();
    expect(
      screen.getByText(REMEDIATION_DECISION_CARD_DESCRIPTION),
    ).toBeInTheDocument();
    /*
     * The card's description already says what the lines are: no heading
     * under it saying it again.
     */
    expect(
      within(decision).queryByText("What auto-remediation did"),
    ).not.toBeInTheDocument();
    expect(
      within(decision).queryByTestId("remediation-decision-heading"),
    ).not.toBeInTheDocument();

    // The header says where things stand before a sentence is read.
    expect(statusPill()).toHaveTextContent("Needs attention");
    expect(statusPill()).toHaveAttribute("data-tone", "attention");

    const lines: Array<HTMLElement> = within(decision).getAllByTestId(
      "remediation-decision-line",
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveAttribute("data-tone", "attention");
    expect(lines[0]).toHaveTextContent(
      "This incident is not linked to a Kubernetes cluster or an infrastructure resource, so OneUptime AI had nothing it could fix.",
    );
    expect(
      within(lines[0]!).getByRole("link", { name: "Link Checkout website" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`,
    );
    expect(lines[1]).toHaveAttribute("data-tone", "info");
    expect(lines[1]).toHaveTextContent(
      "No Auto Remediation Rule is set up for this kind of incident.",
    );
  });

  test("reads the decision of the card's own subject, newest first", async () => {
    serve({ suggestions: [], decisions: [LINKED_TO_NOTHING] });

    render(<RemediationSuggestionCard alertId={ALERT_ID} hideIfEmpty={true} />);
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

  test("shows nothing for an older signal with neither a decision nor a suggestion", async () => {
    serve({ suggestions: [], decisions: [] });

    const { container } = render(
      <RemediationSuggestionCard incidentId={INCIDENT_ID} hideIfEmpty={true} />,
    );

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalledTimes(2);
    });
    expect(container).toBeEmptyDOMElement();
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
      <RemediationSuggestionCard incidentId={INCIDENT_ID} hideIfEmpty={true} />,
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

    /*
     * Above fixes, the lines have a heading of their own: the card's
     * description now speaks of the fixes.
     */
    expect(
      within(decision).getByRole("heading", {
        level: 3,
        name: "What auto-remediation did",
      }),
    ).toBeVisible();
    expect(decision.firstElementChild?.getAttribute("data-testid")).toBe(
      "remediation-decision-heading",
    );
  });

  test("leaves the status to each fix's own pill once there are fixes", async () => {
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
      <RemediationSuggestionCard incidentId={INCIDENT_ID} hideIfEmpty={true} />,
    );

    await screen.findByTestId("remediation-decision");
    expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
    /*
     * The decision was written when the signal was evaluated; the fix's pill
     * follows the fix. A pill from the decision would sit above it saying
     * something older.
     */
    expect(
      screen.queryByTestId("remediation-decision-status"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });

  test.each([
    [
      "incident",
      '"Fix new incidents automatically" is off for this project, so OneUptime AI did not try to fix this incident.',
      "Incident AI settings",
      "incidents",
    ],
    [
      "alert",
      '"Fix new alerts automatically" is off for this project, so OneUptime AI did not try to fix this alert.',
      "Alert AI settings",
      "alerts",
    ],
  ])(
    "with fixing new %ss off, says no action was taken and links to the switch",
    async (signal: string, text: string, linkName: string, path: string) => {
      serve({
        suggestions: [],
        decisions: [
          evaluatedDecision([{ lane: "Project", reason: "RemediationOff" }]),
        ],
      });

      render(
        signal === "incident" ? (
          <RemediationSuggestionCard
            incidentId={INCIDENT_ID}
            hideIfEmpty={true}
          />
        ) : (
          <RemediationSuggestionCard alertId={ALERT_ID} hideIfEmpty={true} />
        ),
      );

      const line: HTMLElement = await screen.findByTestId(
        "remediation-decision-line",
      );
      expect(statusPill()).toHaveTextContent("No action taken");
      expect(statusPill()).toHaveAttribute("data-tone", "info");
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
      <RemediationSuggestionCard incidentId={INCIDENT_ID} hideIfEmpty={true} />,
    );

    await screen.findByTestId("remediation-decision");
    expect(statusPill()).toHaveTextContent("Action taken");
    expect(statusPill()).toHaveAttribute("data-tone", "acted");
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
      <RemediationSuggestionCard incidentId={INCIDENT_ID} hideIfEmpty={true} />,
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
      <RemediationSuggestionCard incidentId={INCIDENT_ID} hideIfEmpty={true} />,
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
      <RemediationSuggestionCard incidentId={INCIDENT_ID} hideIfEmpty={true} />,
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
    expect(statusPill()).toHaveTextContent("Waiting for investigation");
    expect(statusPill()).toHaveAttribute("data-tone", "waiting");
    // Its mark pulses, like an investigation that is still running.
    expect(statusPill().querySelector(".motion-safe\\:animate-ping")).not.toBe(
      null,
    );
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
    expect(statusPill()).toHaveAttribute("data-tone", "attention");
    expect(statusPill().querySelector(".motion-safe\\:animate-ping")).toBe(
      null,
    );
  });
});
