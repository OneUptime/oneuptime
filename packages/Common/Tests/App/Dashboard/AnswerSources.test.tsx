import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const navigateToCitationTargetMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationTargetNav",
  () => {
    return {
      __esModule: true,
      navigateToCitationTarget: (...args: Array<unknown>) => {
        return navigateToCitationTargetMock(...args);
      },
    };
  },
);

import AnswerSources, {
  describeSourceRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationConversation/AnswerSources";
import {
  AIChatCitation,
  AIChatCitationTargetType,
} from "../../../Types/AI/AIChatTypes";

/*
 * What an answer in the AI Investigation card's conversation read: one line
 * per server-minted citation. The Ask AI panel draws its sources as bordered
 * pills; in a card that draws no boxes they are a quiet list, and a source
 * with nowhere to go is never a button that does nothing.
 */

function citation(overrides: Partial<AIChatCitation>): AIChatCitation {
  return {
    id: "C1",
    toolName: "search_logs",
    label: "Error logs, last 1h",
    queryArguments: {},
    rowCount: 40,
    ...overrides,
  };
}

function rows(): Array<HTMLElement> {
  return within(
    screen.getByTestId("investigation-conversation-sources"),
  ).getAllByRole("listitem");
}

afterEach(() => {
  cleanup();
  navigateToCitationTargetMock.mockReset();
});

describe("describeSourceRows", () => {
  test.each([
    [0, "no rows"],
    [1, "1 row"],
    [2, "2 rows"],
    [45, "45 rows"],
    [999, "999 rows"],
    [1000, "1,000 rows"],
    [1234567, "1,234,567 rows"],
  ])("%i reads '%s'", (rowCount: number, text: string) => {
    expect(describeSourceRows(rowCount)).toBe(text);
  });

  test.each([
    [-1],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [undefined as unknown as number],
    [null as unknown as number],
  ])("a count that is not one (%s) reads as no rows", (rowCount: number) => {
    expect(describeSourceRows(rowCount)).toBe("no rows");
  });

  test("groups thousands the same way in every locale", () => {
    // en-US on purpose: the label sits in English text.
    expect(describeSourceRows(10000)).toBe("10,000 rows");
  });
});

describe("AnswerSources", () => {
  test.each([[[]], [undefined as unknown as Array<AIChatCitation>]])(
    "renders nothing without citations (%j)",
    (citations: Array<AIChatCitation>) => {
      const view: ReturnType<typeof render> = render(
        <AnswerSources citations={citations} />,
      );

      expect(view.container).toBeEmptyDOMElement();
    },
  );

  test("lists each source in the order the answer cites them, under a small heading", () => {
    render(
      <AnswerSources
        citations={[
          citation({ id: "C1", label: "Error logs, last 1h", rowCount: 40 }),
          citation({ id: "C2", label: "p95 latency", rowCount: 1 }),
          citation({ id: "C3", label: "Open incidents", rowCount: 0 }),
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 4, name: "Sources" }),
    ).toHaveClass("text-xs", "font-medium", "text-gray-500");
    expect(
      rows().map((row: HTMLElement): string => {
        return row.textContent || "";
      }),
    ).toEqual([
      "C1Error logs, last 1h · 40 rows",
      "C2p95 latency · 1 row",
      "C3Open incidents · no rows",
    ]);
    expect(
      rows().map((row: HTMLElement): string | null => {
        return row.getAttribute("data-citation-id");
      }),
    ).toEqual(["C1", "C2", "C3"]);
  });

  test("a source with a page of its own is a button that opens it", () => {
    const target: AIChatCitation["target"] = {
      type: AIChatCitationTargetType.TraceView,
      params: { traceId: "abc" },
    };
    render(<AnswerSources citations={[citation({ target })]} />);

    const button: HTMLElement = within(rows()[0]!).getByRole("button");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("title", "Error logs, last 1h");
    // Says it leaves the card.
    expect(button.querySelector("svg")).not.toBeNull();

    fireEvent.click(button);

    expect(navigateToCitationTargetMock).toHaveBeenCalledTimes(1);
    expect(navigateToCitationTargetMock).toHaveBeenCalledWith(target);
  });

  test("a source with nowhere to go is a plain line, never a dead button", () => {
    render(
      <AnswerSources
        citations={[
          citation({ label: 'kubectl top pods -A on cluster "prod"' }),
        ]}
      />,
    );

    expect(within(rows()[0]!).queryByRole("button")).toBeNull();
    expect(rows()[0]!.querySelector("svg")).toBeNull();
    expect(rows()[0]!.firstElementChild).toHaveAttribute(
      "title",
      'kubectl top pods -A on cluster "prod"',
    );

    fireEvent.click(rows()[0]!);
    expect(navigateToCitationTargetMock).not.toHaveBeenCalled();
  });

  test.each([[true], [false]])(
    "a query that found nothing says so on hover (with a page: %s)",
    (hasTarget: boolean) => {
      render(
        <AnswerSources
          citations={[
            citation({
              rowCount: 0,
              ...(hasTarget
                ? { target: { type: AIChatCitationTargetType.Logs } }
                : {}),
            }),
          ]}
        />,
      );

      // Zero rows is a finding: it is how an answer proves an absence.
      expect(rows()[0]!.firstElementChild).toHaveAttribute(
        "title",
        "Error logs, last 1h — checked, found nothing",
      );
      expect(rows()[0]).toHaveTextContent("· no rows");
    },
  );

  test("a source that found nothing can still be opened", () => {
    render(
      <AnswerSources
        citations={[
          citation({
            rowCount: 0,
            target: { type: AIChatCitationTargetType.Logs },
          }),
        ]}
      />,
    );

    const button: HTMLElement = within(rows()[0]!).getByRole("button");
    expect(button).toBeEnabled();

    fireEvent.click(button);
    expect(navigateToCitationTargetMock).toHaveBeenCalledWith({
      type: AIChatCitationTargetType.Logs,
    });
  });

  test("carries the same C# mark the answer's text does", () => {
    render(
      <AnswerSources
        citations={[
          citation({ id: "C1" }),
          citation({
            id: "C12",
            target: { type: AIChatCitationTargetType.Logs },
          }),
        ]}
      />,
    );

    const marks: Array<Element> = rows().map((row: HTMLElement): Element => {
      return row.querySelector("span")!;
    });

    expect(
      marks.map((mark: Element): string => {
        return mark.textContent || "";
      }),
    ).toEqual(["C1", "C12"]);
    for (const mark of marks) {
      // The inline chip's look: gray-100 on a hairline ring, 11px semibold.
      expect(mark).toHaveClass(
        "bg-gray-100",
        "text-gray-700",
        "ring-1",
        "ring-gray-200",
        "text-[11px]",
        "font-semibold",
      );
    }
    // A linked and an unlinked source carry the identical mark.
    expect(marks[0]!.className).toBe(marks[1]!.className);
  });

  test("draws no pill, border or shadow around a source", () => {
    render(
      <AnswerSources
        citations={[
          citation({ id: "C1" }),
          citation({
            id: "C2",
            target: { type: AIChatCitationTargetType.Logs },
          }),
        ]}
      />,
    );

    const PILL_CLASS: RegExp = /(^|\s)(border|rounded-full|shadow\S*)(\s|$)/;

    expect(
      Array.from(
        screen
          .getByTestId("investigation-conversation-sources")
          .querySelectorAll("*"),
      ).filter((element: Element): boolean => {
        return PILL_CLASS.test(element.getAttribute("class") || "");
      }),
    ).toEqual([]);
  });

  test("a long label wraps instead of widening the card", () => {
    render(
      <AnswerSources
        citations={[
          citation({ label: "x".repeat(400) }),
          citation({
            id: "C2",
            label: "y".repeat(400),
            target: { type: AIChatCitationTargetType.Logs },
          }),
        ]}
      />,
    );

    for (const row of rows()) {
      const label: Element = row.querySelectorAll("span")[1]!;
      expect(label).toHaveClass("min-w-0", "break-words");
    }
  });

  test("a linked source shows its focus and reads as one row to press", () => {
    render(
      <AnswerSources
        citations={[
          citation({ target: { type: AIChatCitationTargetType.Logs } }),
        ]}
      />,
    );

    const button: HTMLElement = within(rows()[0]!).getByRole("button");

    expect(button).toHaveAccessibleName(/C1\s*Error logs, last 1h · 40 rows/);
    expect(button).toHaveClass(
      "text-left",
      "focus:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
      "hover:bg-gray-50",
    );
  });

  test("nests no block inside a paragraph or a span", () => {
    const consoleError: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      render(
        <AnswerSources
          citations={[
            citation({ id: "C1" }),
            citation({
              id: "C2",
              target: { type: AIChatCitationTargetType.Logs },
            }),
          ]}
        />,
      );

      const sources: HTMLElement = screen.getByTestId(
        "investigation-conversation-sources",
      );
      expect(sources.querySelectorAll("p div, span div")).toHaveLength(0);
      expect(
        consoleError.mock.calls.some((args: Array<unknown>): boolean => {
          return args.some((value: unknown): boolean => {
            return (
              typeof value === "string" && value.includes("validateDOMNesting")
            );
          });
        }),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});
