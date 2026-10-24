import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { BrowserRouter } from "react-router-dom";
import TracePerformanceSuggestion from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TracePerformanceSuggestion";
import {
  PerformanceFindingWords,
  getPerformanceFindingWords,
  getShownSpanIds,
  getShownSpanSearch,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TracePerformanceSuggestionCopy";
import {
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../Types/AI/CodeFixTaskContext";
import Route from "../../../Types/API/Route";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import { TracePerformanceFixSuggestion } from "../../../Utils/Suggestions/TracePerformanceFixSuggestion";

/*
 * The finding strip on the trace page: "Fix performance with AI" with what
 * it found, in plain words. Which traces get it is decided on the server
 * (and held by TracePerformanceFixSuggestion.test.ts); these tests hold how
 * each finding is worded and what each offer draws - the fix, a quiet
 * link to connect a repository, a link to the fix on its way - and that nothing
 * is drawn for None.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

function finding(
  overrides: Partial<PerformanceFinding> = {},
): PerformanceFinding {
  return {
    findingType: PerformanceFindingType.NPlusOneQuery,
    headline: "",
    evidence: "",
    spanCount: 14,
    combinedDurationMs: 840,
    traceDurationMs: 1600,
    percentOfTrace: 52.5,
    normalizedSpanName: "SELECT products WHERE id = {n}",
    parentSpanName: "POST /api/v1/checkout",
    normalizedDbStatement: "SELECT * FROM products WHERE id = ?",
    dbSystem: "postgresql",
    implicatedSpans: [
      { spanId: "q0", name: "SELECT products WHERE id = $1", durationMs: 60 },
      { spanId: "q1", name: "SELECT products WHERE id = $1", durationMs: 60 },
    ],
    ...overrides,
  };
}

function suggestion(
  offer: SuggestionOffer,
  overrides: Partial<PerformanceFinding> = {},
): TracePerformanceFixSuggestion {
  return {
    offer,
    finding: finding(overrides),
    findingCount: 1,
    aiRunId: offer === SuggestionOffer.InProgress ? "run-1" : null,
  };
}

const TASK_ROUTE: Route = new Route("/dashboard/p/code/tasks/run-1");
const CODE_ROUTE: Route = new Route("/dashboard/p/code");

interface Rendered {
  onFix: Mock<() => void>;
  onShowSpans: Mock<() => void>;
}

function renderStrip(props: {
  suggestion: TracePerformanceFixSuggestion;
  taskRoute?: Route | null;
  isCreating?: boolean;
  error?: string | null;
  withShowSpans?: boolean;
}): Rendered {
  const onFix: Mock<() => void> = jest.fn<() => void>();
  const onShowSpans: Mock<() => void> = jest.fn<() => void>();

  render(
    <BrowserRouter>
      <TracePerformanceSuggestion
        suggestion={props.suggestion}
        taskRoute={props.taskRoute ?? null}
        connectRepositoryRoute={CODE_ROUTE}
        isCreating={props.isCreating ?? false}
        error={props.error ?? null}
        onFix={onFix as unknown as () => void}
        onShowSpans={
          props.withShowSpans === false
            ? undefined
            : (onShowSpans as unknown as () => void)
        }
      />
    </BrowserRouter>,
  );

  return { onFix, onShowSpans };
}

afterEach(() => {
  cleanup();
});

describe("the words for each finding", () => {
  test("the same database query, again and again: says so, counts it, names where", () => {
    const words: PerformanceFindingWords =
      getPerformanceFindingWords(finding());

    expect(words.headline).toEqual({
      one: "The same database query ran {{count}} time in {{parent}}",
      other: "The same database query ran {{count}} times in {{parent}}",
    });
    expect(words.count).toBe(14);
    expect(words.parent).toBe("POST /api/v1/checkout");
    expect(words.query).toBe("SELECT * FROM products WHERE id = ?");
    expect(words.detail).toBe(
      "Together they take {{duration}} of this {{total}} request.",
    );
  });

  test("a repeated query whose parent is not loaded leaves the parent out", () => {
    expect(
      getPerformanceFindingWords(finding({ parentSpanName: undefined }))
        .headline,
    ).toEqual({
      one: "The same database query ran {{count}} time",
      other: "The same database query ran {{count}} times",
    });
  });

  test("a repeated call that is not database work is named by its operation", () => {
    const words: PerformanceFindingWords = getPerformanceFindingWords(
      finding({
        dbSystem: undefined,
        normalizedDbStatement: undefined,
        normalizedSpanName: "GET /users/{n}",
        implicatedSpans: [
          { spanId: "a", name: "GET /users/1", durationMs: 30 },
          { spanId: "b", name: "GET /users/2", durationMs: 30 },
        ],
      }),
    );

    expect(words.headline).toEqual({
      one: "{{operation}} ran {{count}} time in {{parent}}",
      other: "{{operation}} ran {{count}} times in {{parent}}",
    });
    expect(words.operation).toBe("GET /users/{n}");
    expect(words.query).toBe("");
  });

  test("a repeated call with no parent", () => {
    expect(
      getPerformanceFindingWords(
        finding({
          dbSystem: undefined,
          normalizedDbStatement: undefined,
          parentSpanName: undefined,
        }),
      ).headline,
    ).toEqual({
      one: "{{operation}} ran {{count}} time",
      other: "{{operation}} ran {{count}} times",
    });
  });

  test("database calls one after another, and other calls one after another", () => {
    const queries: PerformanceFindingWords = getPerformanceFindingWords(
      finding({
        findingType: PerformanceFindingType.SequentialSiblings,
        spanCount: 12,
      }),
    );

    expect(queries.headline).toEqual({
      one: "{{count}} database call ran one after another in {{parent}}",
      other: "{{count}} database calls ran one after another in {{parent}}",
    });
    expect(queries.detail).toBe(
      "Together they take {{duration}} of this {{total}} request, and they could run at the same time.",
    );

    const calls: PerformanceFindingWords = getPerformanceFindingWords(
      finding({
        findingType: PerformanceFindingType.SequentialSiblings,
        dbSystem: undefined,
        normalizedDbStatement: undefined,
      }),
    );

    expect(calls.headline).toEqual({
      one: "{{count}} call to {{operation}} ran one after another in {{parent}}",
      other:
        "{{count}} calls to {{operation}} ran one after another in {{parent}}",
    });
  });

  test("one slow query, and one slow call", () => {
    const query: PerformanceFindingWords = getPerformanceFindingWords(
      finding({
        findingType: PerformanceFindingType.DominantSpan,
        spanCount: 1,
        normalizedDbStatement: "SELECT * FROM invoices WHERE account_id = ?",
      }),
    );

    expect(query.headline).toBe("One database query took most of this request");
    expect(query.query).toBe("SELECT * FROM invoices WHERE account_id = ?");
    expect(query.detail).toBe(
      "It takes {{duration}} of this {{total}} request on its own.",
    );

    const call: PerformanceFindingWords = getPerformanceFindingWords(
      finding({
        findingType: PerformanceFindingType.DominantSpan,
        dbSystem: undefined,
        normalizedDbStatement: undefined,
        implicatedSpans: [
          { spanId: "x", name: "POST /api/v1/import", durationMs: 2400 },
        ],
      }),
    );

    expect(call.headline).toBe("{{operation}} took most of this request");
    expect(call.operation).toBe("POST /api/v1/import");
  });

  test("a database finding with no statement shows the operation as the query", () => {
    expect(
      getPerformanceFindingWords(finding({ normalizedDbStatement: undefined }))
        .query,
    ).toBe("SELECT products WHERE id = $1");
  });
});

describe("the spans 'Show them' reveals", () => {
  test("the implicated spans the page has loaded, in order", () => {
    const loaded: Set<string> = new Set(["q1"]);

    expect(
      getShownSpanIds(finding(), (spanId: string) => {
        return loaded.has(spanId);
      }),
    ).toEqual(["q1"]);
    expect(
      getShownSpanIds(finding(), () => {
        return true;
      }),
    ).toEqual(["q0", "q1"]);
  });

  test("searches their shared name, so every one of them stays in view", () => {
    expect(getShownSpanSearch(finding())).toBe("SELECT products WHERE id = $1");
  });

  test("sets no search when their names differ, or for one slow call", () => {
    expect(
      getShownSpanSearch(
        finding({
          implicatedSpans: [
            { spanId: "a", name: "GET /users/1", durationMs: 30 },
            { spanId: "b", name: "GET /users/2", durationMs: 30 },
          ],
        }),
      ),
    ).toBe("");
    expect(
      getShownSpanSearch(
        finding({ findingType: PerformanceFindingType.DominantSpan }),
      ),
    ).toBe("");
    expect(getShownSpanSearch(finding({ implicatedSpans: [] }))).toBe("");
  });
});

describe("what each offer draws", () => {
  test("None draws nothing at all", () => {
    const { container } = render(
      <BrowserRouter>
        <TracePerformanceSuggestion
          suggestion={{
            offer: SuggestionOffer.None,
            finding: null,
            findingCount: 0,
            aiRunId: null,
          }}
          taskRoute={null}
          connectRepositoryRoute={CODE_ROUTE}
          isCreating={false}
          error={null}
          onFix={() => {}}
        />
      </BrowserRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("Act: the finding in plain words, what it costs, and the fix", () => {
    const { onFix } = renderStrip({
      suggestion: suggestion(SuggestionOffer.Act),
    });

    expect(screen.getByTestId("trace-performance-suggestion")).toHaveAttribute(
      "data-offer",
      "Act",
    );
    expect(screen.getByTestId("trace-performance-finding")).toHaveTextContent(
      "The same database query ran 14 times in POST /api/v1/checkout",
    );
    // The span name stands out from the sentence around it.
    expect(screen.getByText("POST /api/v1/checkout")).toHaveClass(
      "font-semibold",
    );
    expect(screen.getByTestId("trace-performance-query")).toHaveAttribute(
      "title",
      "SELECT * FROM products WHERE id = ?",
    );
    expect(screen.getByTestId("trace-performance-detail")).toHaveTextContent(
      "Together they take 840 ms of this 1.6 s request.",
    );

    fireEvent.click(screen.getByTestId("trace-fix-performance"));
    expect(onFix).toHaveBeenCalledTimes(1);
  });

  test("Act while the click is on its way: the button shows it is working", () => {
    renderStrip({
      suggestion: suggestion(SuggestionOffer.Act),
      isCreating: true,
    });

    expect(screen.getByTestId("trace-fix-performance")).toBeDisabled();
  });

  test("Act after the fix started: the button gives way to a link to it", () => {
    renderStrip({
      suggestion: suggestion(SuggestionOffer.Act),
      taskRoute: TASK_ROUTE,
    });

    expect(screen.queryByTestId("trace-fix-performance")).toBeNull();
    expect(
      screen.getByTestId("trace-fix-performance-progress"),
    ).toHaveTextContent("OneUptime AI is working on a fix. View task progress");
    expect(
      screen.getByText("View task progress").closest("a")!.getAttribute("href"),
    ).toBe("/dashboard/p/code/tasks/run-1");
  });

  test("SetUp: the finding, and a quiet link to connect a repository - no button", () => {
    renderStrip({ suggestion: suggestion(SuggestionOffer.SetUp) });

    expect(screen.queryByTestId("trace-fix-performance")).toBeNull();
    const link: HTMLElement = screen.getByTestId(
      "trace-fix-performance-connect",
    );
    expect(link).toHaveTextContent("Connect a repository to fix this with AI");
    expect(link.closest("a")!.getAttribute("href")).toBe("/dashboard/p/code");
  });

  test("InProgress: a link to the fix already on its way - no button", () => {
    renderStrip({
      suggestion: suggestion(SuggestionOffer.InProgress),
      taskRoute: TASK_ROUTE,
    });

    expect(screen.queryByTestId("trace-fix-performance")).toBeNull();
    expect(
      screen.getByTestId("trace-fix-performance-progress"),
    ).toHaveTextContent("OneUptime AI is working on a fix.");
  });

  test("a refusal reads as the reason the fix did not start", () => {
    renderStrip({
      suggestion: suggestion(SuggestionOffer.Act),
      error: "A performance fix task is already queued or running.",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not start the fix: A performance fix task is already queued or running.",
    );
  });

  test("'Show them' for several spans, 'Show it' for one, and none without a handler", () => {
    const { onShowSpans } = renderStrip({
      suggestion: suggestion(SuggestionOffer.Act),
    });

    fireEvent.click(screen.getByTestId("trace-performance-show-spans"));
    expect(onShowSpans).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("trace-performance-show-spans"),
    ).toHaveTextContent("Show them");
    cleanup();

    renderStrip({
      suggestion: suggestion(SuggestionOffer.Act, {
        findingType: PerformanceFindingType.DominantSpan,
        implicatedSpans: [{ spanId: "q0", name: "SELECT 1", durationMs: 900 }],
      }),
    });
    expect(
      screen.getByTestId("trace-performance-show-spans"),
    ).toHaveTextContent("Show it");
    cleanup();

    renderStrip({
      suggestion: suggestion(SuggestionOffer.Act),
      withShowSpans: false,
    });
    expect(screen.queryByTestId("trace-performance-show-spans")).toBeNull();
  });

  /*
   * jsdom draws no layout, so these hold the classes the offline browser
   * suite (packages/E2E/TraceDetail) measures: the next step lines up with
   * the words (2rem: the clock and its gap) except a phone's fix button,
   * which spans the strip as the header's own buttons do, and sits beside
   * the words only from lg up.
   */
  test("the next step lines up with the words; only the fix button spans the strip on a phone", () => {
    const classesOf: (offer: SuggestionOffer, taskRoute?: Route) => string[] = (
      offer: SuggestionOffer,
      taskRoute?: Route,
    ): string[] => {
      renderStrip({
        suggestion: suggestion(offer),
        taskRoute: taskRoute ?? null,
      });
      const classes: string[] = screen
        .getByTestId("trace-performance-action")
        .className.split(" ");
      cleanup();
      return classes;
    };

    const fix: string[] = classesOf(SuggestionOffer.Act);
    expect(fix).toEqual(expect.arrayContaining(["sm:pl-8", "lg:pl-0"]));
    expect(fix).not.toContain("pl-8");

    for (const words of [
      classesOf(SuggestionOffer.SetUp),
      classesOf(SuggestionOffer.InProgress, TASK_ROUTE),
      classesOf(SuggestionOffer.Act, TASK_ROUTE),
    ]) {
      expect(words).toEqual(expect.arrayContaining(["pl-8", "lg:pl-0"]));
    }

    renderStrip({ suggestion: suggestion(SuggestionOffer.Act) });
    expect(screen.getByTestId("trace-performance-suggestion")).toHaveClass(
      "flex-col",
      "lg:flex-row",
    );
  });

  test("the query shows on up to two lines, and whole on hover", () => {
    renderStrip({ suggestion: suggestion(SuggestionOffer.Act) });

    const query: HTMLElement = screen.getByTestId("trace-performance-query");
    expect(query).toHaveClass("line-clamp-2");
    expect(query).not.toHaveClass("truncate");
    expect(query).toHaveAttribute(
      "title",
      "SELECT * FROM products WHERE id = ?",
    );
  });

  test("while AI works on the fix: a live status with a dot, and the link to it in one piece where there is room", () => {
    renderStrip({
      suggestion: suggestion(SuggestionOffer.InProgress),
      taskRoute: TASK_ROUTE,
    });

    const progress: HTMLElement = screen.getByTestId(
      "trace-fix-performance-progress",
    );
    // Said by a screen reader when it takes the pressed button's place.
    expect(progress).toHaveAttribute("role", "status");
    const dot: Element | null = progress.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot!.querySelector(".motion-safe\\:animate-ping")).not.toBeNull();
    const link: HTMLElement = screen
      .getByText("View task progress")
      .closest("a")!;
    expect(link).toHaveClass("sm:whitespace-nowrap");
    // A phone may wrap it: its longest translations would run out of the strip.
    expect(link).not.toHaveClass("whitespace-nowrap");
  });

  test("one slow call names the call in the headline", () => {
    renderStrip({
      suggestion: suggestion(SuggestionOffer.Act, {
        findingType: PerformanceFindingType.DominantSpan,
        spanCount: 1,
        combinedDurationMs: 2100,
        traceDurationMs: 2400,
        dbSystem: undefined,
        normalizedDbStatement: undefined,
        implicatedSpans: [
          { spanId: "x", name: "POST /api/v1/import", durationMs: 2100 },
        ],
      }),
    });

    expect(screen.getByTestId("trace-performance-finding")).toHaveTextContent(
      "POST /api/v1/import took most of this request",
    );
    expect(screen.queryByTestId("trace-performance-query")).toBeNull();
    expect(screen.getByTestId("trace-performance-detail")).toHaveTextContent(
      "It takes 2.1 s of this 2.4 s request on its own.",
    );
  });
});
