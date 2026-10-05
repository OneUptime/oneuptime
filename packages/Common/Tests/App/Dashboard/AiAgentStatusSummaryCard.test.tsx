import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import AiAgentStatusSummaryCard, {
  AI_AGENT_STATUS_SUMMARY_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentStatusSummaryCard";
import {
  AI_AGENT_VERSION_DETAIL,
  AiAgentStatusSummary,
  getAiAgentConnectionBadge,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentStatusSummary";
import Route from "../../../Types/API/Route";

/*
 * The Overview's "AI agent" card, drawn from a summary: three rows —
 * Connection, Investigation and Fixes — like the AI agent page's "What AI
 * may do", the Needs attention headline when there is one, and the link to
 * the AI agent page, which is there whatever the card could read. Loading
 * shows a loader; a summary it could not read says so, never an error.
 */

const ROUTE: Route = new Route("/dashboard/p1/docker/h1/ai/agent");
const DESCRIPTION: string =
  "Whether OneUptime AI can reach this Docker host, and what it may do there.";

function makeSummary(
  overrides: Partial<AiAgentStatusSummary> = {},
): AiAgentStatusSummary {
  return {
    connection: getAiAgentConnectionBadge("connected"),
    connectionSentence: "The Docker AI agent is connected.",
    connectionDetails: [
      "last seen a minute ago",
      AI_AGENT_VERSION_DETAIL,
      "Read-only",
    ],
    investigation: { text: "On", tone: "on" },
    investigationSentence:
      "AI may run read-only docker commands on this Docker host: ps, inspect, logs, stats, events. They never change anything.",
    fixes: { text: "Ask for approval", tone: "on" },
    fixesSentence:
      "AI proposes fixes. A person approves each one before it runs.",
    attention: null,
    ...overrides,
  };
}

function renderCard(props: {
  summary: AiAgentStatusSummary | null;
  isLoading?: boolean;
  versionElement?: React.ReactElement | undefined;
}): void {
  render(
    <AiAgentStatusSummaryCard
      description={DESCRIPTION}
      agentPageRoute={ROUTE}
      summary={props.summary}
      isLoading={props.isLoading ?? false}
      versionElement={props.versionElement}
    />,
  );
}

// What the callers hand in: the shared AgentVersion, here a stand-in.
const AGENT_VERSION: React.ReactElement = (
  <span data-testid="the-agent-version">14.1.0</span>
);

function card(): HTMLElement {
  return screen.getByTestId(AI_AGENT_STATUS_SUMMARY_TEST_ID);
}

function row(name: "connection" | "investigation" | "fixes"): HTMLElement {
  return screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-${name}`);
}

function badge(name: "connection" | "investigation" | "fixes"): HTMLElement {
  return screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-${name}-badge`);
}

function sentence(name: "connection" | "investigation" | "fixes"): string {
  return (
    screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-${name}-value`)
      .textContent || ""
  );
}

afterEach(() => {
  cleanup();
});

describe("the card's frame", () => {
  test("is titled AI agent, with the AI agent page's subtitle", () => {
    renderCard({ summary: makeSummary() });

    expect(
      within(card()).getByRole("heading", { name: "AI agent" }),
    ).toBeInTheDocument();
    expect(within(card()).getByText(DESCRIPTION)).toBeInTheDocument();
  });

  test("links to the AI agent page, where all of it is changed", () => {
    renderCard({ summary: makeSummary() });

    const link: HTMLElement = within(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-open`),
    ).getByRole("link", { name: "Open the AI agent page" });

    expect(link).toHaveAttribute("href", ROUTE.toString());
  });

  test.each<[string, AiAgentStatusSummary | null, boolean]>([
    ["while loading", null, true],
    ["when the status could not be read", null, false],
  ])(
    "keeps the link %s",
    (
      _when: string,
      summary: AiAgentStatusSummary | null,
      isLoading: boolean,
    ) => {
      renderCard({ summary, isLoading });

      expect(
        screen.getByRole("link", { name: "Open the AI agent page" }),
      ).toHaveAttribute("href", ROUTE.toString());
    },
  );
});

describe("while the status loads", () => {
  test("shows a loader and none of the rows", () => {
    renderCard({ summary: makeSummary(), isLoading: true });

    expect(within(card()).getByTestId("component-loader")).toBeInTheDocument();
    expect(
      screen.queryByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection`),
    ).not.toBeInTheDocument();
  });
});

describe("a status the card could not read", () => {
  test("says so and where to look — never an error", () => {
    renderCard({ summary: null });

    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-unavailable`),
    ).toHaveTextContent(
      "The AI agent's status could not be loaded. Open the AI agent page to see it.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection`),
    ).not.toBeInTheDocument();
  });
});

describe("the three rows", () => {
  test("are Connection, Investigation and Fixes, in that order", () => {
    renderCard({ summary: makeSummary() });

    const titles: Array<string> = within(card())
      .getAllByRole("heading", { level: 3 })
      .map((heading: HTMLElement): string => {
        return heading.textContent || "";
      });

    expect(titles).toEqual(["Connection", "Investigation", "Fixes"]);
  });

  test("say where each stands, in a badge of its tone", () => {
    renderCard({ summary: makeSummary() });

    expect(badge("connection")).toHaveTextContent("Connected");
    expect(badge("connection")).toHaveAttribute("data-tone", "on");
    expect(badge("investigation")).toHaveTextContent("On");
    expect(badge("investigation")).toHaveAttribute("data-tone", "on");
    expect(badge("fixes")).toHaveTextContent("Ask for approval");
    expect(badge("fixes")).toHaveAttribute("data-tone", "on");
  });

  test("each with its sentence", () => {
    renderCard({ summary: makeSummary() });

    expect(sentence("connection")).toBe("The Docker AI agent is connected.");
    expect(sentence("investigation")).toBe(makeSummary().investigationSentence);
    expect(sentence("fixes")).toBe(makeSummary().fixesSentence);
  });

  test("the agent's meta line under the Connection row, joined like the AI agent page's, the version drawn where the summary keeps it", () => {
    renderCard({ summary: makeSummary(), versionElement: AGENT_VERSION });

    const details: HTMLElement = screen.getByTestId(
      `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-details`,
    );

    expect(details).toHaveTextContent(
      "last seen a minute ago · agent 14.1.0 · Read-only",
    );
    expect(row("connection")).toContainElement(details);
    // The caller's element itself, in its place.
    const version: HTMLElement = within(details).getByTestId(
      `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-agent-version`,
    );
    expect(version).toContainElement(screen.getByTestId("the-agent-version"));
    expect(details.textContent).not.toContain(AI_AGENT_VERSION_DETAIL);
    // A div: AgentVersion's upgrade dialog cannot sit inside a <p>.
    expect(details.tagName).toBe("DIV");
  });

  test("no version to draw: its place is left out, with no stray separator", () => {
    renderCard({ summary: makeSummary() });

    const details: HTMLElement = screen.getByTestId(
      `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-details`,
    );

    expect(details.textContent).toBe("last seen a minute ago · Read-only");
    expect(
      screen.queryByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-agent-version`),
    ).not.toBeInTheDocument();
  });

  test("only the version's place: no meta line without a version to draw", () => {
    renderCard({
      summary: makeSummary({ connectionDetails: [AI_AGENT_VERSION_DETAIL] }),
    });

    expect(
      screen.queryByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-details`,
      ),
    ).not.toBeInTheDocument();
  });

  test("no meta line before an agent ever registered", () => {
    renderCard({
      summary: makeSummary({
        connection: getAiAgentConnectionBadge("not_installed"),
        connectionSentence: "The Docker AI agent is not installed yet.",
        connectionDetails: [],
      }),
    });

    expect(
      screen.queryByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-details`,
      ),
    ).not.toBeInTheDocument();
    expect(badge("connection")).toHaveTextContent("Not installed");
    expect(badge("connection")).toHaveAttribute("data-tone", "off");
  });

  test("an offline agent's badge is red", () => {
    renderCard({
      summary: makeSummary({
        connection: getAiAgentConnectionBadge("offline"),
      }),
    });

    expect(badge("connection")).toHaveTextContent("Offline");
    expect(badge("connection")).toHaveAttribute("data-tone", "danger");
    expect(badge("connection").className).toContain("bg-red-50");
  });

  test.each<[string, "off" | "on" | "automatic" | "bypass"]>([
    ["Off", "off"],
    ["Ask for approval", "on"],
    ["Automatic", "automatic"],
    ["Bypass approval", "bypass"],
  ])(
    "fixes %s in the %s tone",
    (text: string, tone: "off" | "on" | "automatic" | "bypass") => {
      renderCard({ summary: makeSummary({ fixes: { text, tone } }) });

      expect(badge("fixes")).toHaveTextContent(text);
      expect(badge("fixes")).toHaveAttribute("data-tone", tone);
    },
  );

  test("investigation off reads Off in grey", () => {
    renderCard({
      summary: makeSummary({ investigation: { text: "Off", tone: "off" } }),
    });

    expect(badge("investigation")).toHaveTextContent("Off");
    expect(badge("investigation")).toHaveAttribute("data-tone", "off");
  });
});

describe("Needs attention", () => {
  test("shows the headline above the rows when there is one", () => {
    renderCard({
      summary: makeSummary({
        attention: "OneUptime AI can't investigate this Docker host",
      }),
    });

    const attention: HTMLElement = screen.getByTestId(
      `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-attention`,
    );

    expect(attention).toHaveTextContent("Needs attention");
    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-attention-title`),
    ).toHaveTextContent("OneUptime AI can't investigate this Docker host");
    expect(
      attention.compareDocumentPosition(row("connection")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("is not there when nothing needs attention", () => {
    renderCard({ summary: makeSummary() });

    expect(
      screen.queryByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-attention`),
    ).not.toBeInTheDocument();
  });
});

describe("what the card offers", () => {
  // Read-only: changes happen on the AI agent page, under its permissions.
  test("has no control but the link", () => {
    renderCard({ summary: makeSummary() });

    expect(within(card()).queryAllByRole("button")).toHaveLength(0);
    expect(within(card()).getAllByRole("link")).toHaveLength(1);
  });
});
