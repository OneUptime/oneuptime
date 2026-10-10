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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import LlmIssueBadge from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmIssueBadge";
import LlmConversationRow, {
  getConversationDotClassName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationRow";
import LlmSummaryTiles from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmSummaryTiles";
import {
  LLM_HEALTHY_DOT_CLASS_NAME,
  LLM_ISSUE_STYLES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationCopy";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import {
  LlmConversationKeyKind,
  emptyIssueCounts,
} from "../../../Types/Telemetry/LlmConversationApi";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  PROJECT_ID,
  TRACE_ID,
  listItem,
  summary,
} from "./LlmConversationFixtures";

/*
 * The parts of the conversation list a reader scans: a row per
 * conversation (what was asked, by whom, in which app, what went wrong) and
 * the five numbers above the list. What each shows, and what it leaves out
 * when there is nothing to say, is pinned here.
 */

const ROUTE: Route = new Route(
  `/dashboard/${PROJECT_ID}/llm/conversations/c%3Achat-1`,
);
const APP_ID: string = "6f1e2d3c-4b5a-4968-8776-655443322110";

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("LlmIssueBadge", () => {
  test("names the problem", () => {
    render(<LlmIssueBadge issue={LlmAnswerIssue.CutOff} />);

    const badge: HTMLElement = screen.getByTestId(
      `llm-issue-badge-${LlmAnswerIssue.CutOff}`,
    );

    expect(badge).toHaveTextContent("Cut off");
    expect(badge).toHaveAttribute("data-issue", LlmAnswerIssue.CutOff);
    expect(badge.className).toContain(
      LLM_ISSUE_STYLES[LlmAnswerIssue.CutOff].badgeClassName,
    );
  });

  test("with a count, says how many in the singular or the plural", () => {
    const { rerender } = render(
      <LlmIssueBadge issue={LlmAnswerIssue.Refused} count={1} />,
    );

    expect(screen.getByTestId("llm-issue-badge-refused")).toHaveTextContent(
      "1 refusal",
    );

    rerender(<LlmIssueBadge issue={LlmAnswerIssue.Refused} count={3} />);

    expect(screen.getByTestId("llm-issue-badge-refused")).toHaveTextContent(
      "3 refusals",
    );
  });

  test("a test id of its own when asked", () => {
    render(
      <LlmIssueBadge
        issue={LlmAnswerIssue.Failed}
        dataTestId="answer-failed"
      />,
    );

    expect(screen.getByTestId("answer-failed")).toHaveTextContent("Failed");
  });
});

describe("getConversationDotClassName", () => {
  test("a conversation with no problem is healthy", () => {
    expect(getConversationDotClassName(listItem())).toBe(
      LLM_HEALTHY_DOT_CLASS_NAME,
    );
  });

  test("the worst problem decides the colour: a failure outranks a refusal", () => {
    expect(
      getConversationDotClassName(
        listItem({
          issueCounts: {
            ...emptyIssueCounts(),
            [LlmAnswerIssue.Refused]: 3,
            [LlmAnswerIssue.Failed]: 1,
          },
        }),
      ),
    ).toBe(LLM_ISSUE_STYLES[LlmAnswerIssue.Failed].dotClassName);
    expect(
      getConversationDotClassName(
        listItem({
          issueCounts: { ...emptyIssueCounts(), [LlmAnswerIssue.Flagged]: 2 },
        }),
      ),
    ).toBe(LLM_ISSUE_STYLES[LlmAnswerIssue.Flagged].dotClassName);
  });
});

describe("LlmConversationRow", () => {
  function renderRow(
    data: Parameters<typeof listItem>[0] = {},
    names: Map<string, string> = new Map<string, string>(),
  ): HTMLElement {
    render(
      <MemoryRouter>
        <LlmConversationRow
          conversation={listItem(data)}
          route={ROUTE}
          serviceNames={names}
        />
      </MemoryRouter>,
    );

    return screen.getByTestId("llm-conversation-row");
  }

  test("the whole row opens the conversation", () => {
    const row: HTMLElement = renderRow();

    expect(row.closest("a")).toHaveAttribute("href", ROUTE.toString());
    expect(row).toHaveAttribute("data-key", "c:chat-1");
  });

  test("leads with what the person asked", () => {
    renderRow({ title: "Where should I go in May?" });

    expect(screen.getByTestId("llm-conversation-row-title")).toHaveTextContent(
      "Where should I go in May?",
    );
  });

  test("a very long question is cut, not wrapped over the page", () => {
    renderRow({ title: "x".repeat(400) });

    expect(
      Array.from(
        screen.getByTestId("llm-conversation-row-title").textContent || "",
      ).length,
    ).toBeLessThanOrEqual(160);
  });

  test("without a recorded question, the conversation id, or the request's trace", () => {
    renderRow({ title: "", conversationId: "chat-77" });

    expect(screen.getByTestId("llm-conversation-row-title")).toHaveTextContent(
      "Conversation chat-77",
    );

    cleanup();

    renderRow({
      title: "",
      key: `t:${TRACE_ID}`,
      kind: LlmConversationKeyKind.Request,
      conversationId: "",
    });

    expect(screen.getByTestId("llm-conversation-row-title")).toHaveTextContent(
      `Request ${TRACE_ID.slice(0, 8)}`,
    );
  });

  test("who asked, in which app, which model, how many answers, how long, what it cost", () => {
    renderRow(
      {
        people: ["ada@example.com", "bob@example.com"],
        serviceIds: [APP_ID],
        models: ["gpt-4o", "gpt-4o-mini"],
        answerCount: 2,
        durationMs: 63_000,
        costUsd: 0.0021,
      },
      new Map<string, string>([[APP_ID, "Support bot"]]),
    );

    const facts: HTMLElement = screen.getByTestId("llm-conversation-row-facts");
    const fact: (key: string) => string | null = (
      key: string,
    ): string | null => {
      return facts.querySelector(`[data-fact="${key}"]`)?.textContent || null;
    };

    expect(fact("person")).toBe("ada@example.com");
    expect(fact("app")).toBe("Support bot");
    expect(fact("models")).toBe("gpt-4o, gpt-4o-mini");
    expect(fact("answers")).toBe("2 answers");
    expect(fact("duration")).toBe("1m 03s");
    expect(fact("cost")).toBe("$0.0021");
  });

  test("leaves out what it does not know, rather than showing blanks", () => {
    renderRow({
      people: [],
      serviceIds: [APP_ID],
      models: [],
      answerCount: 1,
      durationMs: 0,
      costUsd: 0,
    });

    const facts: HTMLElement = screen.getByTestId("llm-conversation-row-facts");

    expect(
      Array.from(facts.querySelectorAll("[data-fact]")).map(
        (element: Element): string | null => {
          return element.getAttribute("data-fact");
        },
      ),
    ).toEqual(["answers"]);
    expect(facts).toHaveTextContent("1 answer");
  });

  test("names each problem with a count", () => {
    renderRow({
      issueCounts: {
        ...emptyIssueCounts(),
        [LlmAnswerIssue.Refused]: 2,
        [LlmAnswerIssue.CutOff]: 1,
      },
    });

    expect(screen.getByTestId("llm-issue-badge-refused")).toHaveTextContent(
      "2 refusals",
    );
    expect(screen.getByTestId("llm-issue-badge-cut_off")).toHaveTextContent(
      "1 cut-off answer",
    );
    expect(
      screen.queryByTestId("llm-issue-badge-failed"),
    ).not.toBeInTheDocument();
  });

  test("an unreadable start date shows no age rather than 'Invalid date'", () => {
    renderRow({ startedAt: "not a date" });

    expect(screen.getByTestId("llm-conversation-row")).not.toHaveTextContent(
      /invalid/i,
    );
  });

  test("nothing in the row is a control inside the link", () => {
    renderRow({
      issueCounts: { ...emptyIssueCounts(), [LlmAnswerIssue.Failed]: 1 },
    });

    expect(
      screen
        .getByTestId("llm-conversation-row")
        .querySelectorAll("button, a, input, select"),
    ).toHaveLength(0);
  });
});

describe("LlmSummaryTiles", () => {
  test("the five numbers, written the way the pages write them", () => {
    render(<LlmSummaryTiles summary={summary()} isLoading={false} />);

    expect(
      screen.getByTestId("llm-summary-conversations-value"),
    ).toHaveTextContent("120");
    expect(screen.getByTestId("llm-summary-answers-value")).toHaveTextContent(
      "300",
    );
    expect(screen.getByTestId("llm-summary-answers-hint")).toHaveTextContent(
      "340 AI calls in all",
    );
    expect(screen.getByTestId("llm-summary-problems-value")).toHaveTextContent(
      "6",
    );
    expect(screen.getByTestId("llm-summary-problems-hint")).toHaveTextContent(
      "5% of conversations",
    );
    expect(screen.getByTestId("llm-summary-cost-value")).toHaveTextContent(
      "$12.40",
    );
    expect(screen.getByTestId("llm-summary-cost-hint")).toHaveTextContent(
      "123k tokens",
    );
    expect(screen.getByTestId("llm-summary-latency-value")).toHaveTextContent(
      "2.3 s",
    );
    expect(screen.getByTestId("llm-summary-latency-hint")).toHaveTextContent(
      "Slowest 5%: 9.1 s",
    );
  });

  test("calls are mentioned only when there are more calls than answers", () => {
    render(
      <LlmSummaryTiles
        summary={summary({ callCount: 300, answerCount: 300 })}
        isLoading={false}
      />,
    );

    expect(
      screen.queryByTestId("llm-summary-answers-hint"),
    ).not.toBeInTheDocument();
  });

  test("Need attention leads to those conversations when there are any", () => {
    const onShowProblems: jest.Mock<() => void> = jest.fn<() => void>();

    render(
      <LlmSummaryTiles
        summary={summary()}
        isLoading={false}
        onShowProblems={onShowProblems}
      />,
    );

    const tile: HTMLElement = screen.getByTestId("llm-summary-problems");

    expect(tile.tagName).toBe("BUTTON");
    fireEvent.click(tile);
    expect(onShowProblems).toHaveBeenCalledTimes(1);
  });

  test("with nothing to attend to, it is not a button", () => {
    render(
      <LlmSummaryTiles
        summary={summary({ problemConversationCount: 0 })}
        isLoading={false}
        onShowProblems={jest.fn<() => void>()}
      />,
    );

    expect(screen.getByTestId("llm-summary-problems").tagName).toBe("DIV");
    expect(screen.getByTestId("llm-summary-problems-hint")).toHaveTextContent(
      "0% of conversations",
    );
  });

  test("no answer times yet reads as a dash, not 0 ms", () => {
    render(
      <LlmSummaryTiles
        summary={summary({ medianAnswerMs: null, p95AnswerMs: null })}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId("llm-summary-latency-value")).toHaveTextContent(
      "—",
    );
    expect(
      screen.queryByTestId("llm-summary-latency-hint"),
    ).not.toBeInTheDocument();
  });

  test("while loading with nothing yet, placeholders instead of zeros", () => {
    render(<LlmSummaryTiles summary={null} isLoading={true} />);

    expect(
      screen.queryByTestId("llm-summary-conversations-value"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("llm-summary-cost-value"),
    ).not.toBeInTheDocument();
  });

  test("a reload keeps the numbers on screen until the new ones arrive", () => {
    render(<LlmSummaryTiles summary={summary()} isLoading={true} />);

    expect(
      screen.getByTestId("llm-summary-conversations-value"),
    ).toHaveTextContent("120");
  });

  test("a summary that could not be read shows zeros, not a crash", () => {
    render(<LlmSummaryTiles summary={null} isLoading={false} />);

    const tiles: HTMLElement = screen.getByTestId("llm-summary-tiles");

    expect(
      within(tiles).getByTestId("llm-summary-conversations-value"),
    ).toHaveTextContent("0");
    expect(
      within(tiles).getByTestId("llm-summary-cost-value"),
    ).toHaveTextContent("$0");
  });
});
