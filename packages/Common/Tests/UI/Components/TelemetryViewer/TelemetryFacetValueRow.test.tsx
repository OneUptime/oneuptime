import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import TelemetryFacetValueRow, {
  FACET_COUNT_COLUMN_CLASS,
  FACET_VALUE_COUNT_TEST_ID,
  FACET_VALUE_ROW_TEST_ID,
  TelemetryFacetValueRowProps,
} from "../../../../UI/Components/TelemetryViewer/components/TelemetryFacetValueRow";
import { FacetValueState } from "../../../../UI/Components/TelemetryViewer/FacetSelection";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * One value in a telemetry facet sidebar. Logs, Traces, Metrics, Exceptions
 * and Security Events all draw this row (the Logs sidebar's copy of it is
 * gone), so what is pinned here is what every explorer does:
 *
 *   - it is a checkbox: a click on a value that is not filtering includes
 *     it, and a click on a checked one takes it off - the bug was that the
 *     row always asked to include, so a checked value stayed checked;
 *   - an excluded value is the checkbox's third state, and a click clears
 *     it too;
 *   - the exclude button is there only where the explorer can exclude, and
 *     says whether the value is excluded;
 *   - a value the page itself filters on is shown, and left alone;
 *   - the row spends its width on the value's name: the count is shortened
 *     (2.4M) in a column of one width, and the exclude button lies over the
 *     count rather than keeping a column of its own. The report's own
 *     screenshot showed a checked service cut to "one..." beside a
 *     "2,417,585" and the exclude button.
 */

interface Handlers {
  onInclude: MockFunction;
  onClear: MockFunction;
  onExclude: MockFunction;
}

function handlers(): Handlers {
  return {
    onInclude: getJestMockFunction(),
    onClear: getJestMockFunction(),
    onExclude: getJestMockFunction(),
  };
}

function mount(
  overrides: Partial<TelemetryFacetValueRowProps>,
  calls: Handlers = handlers(),
  options: { withExclude?: boolean } = {},
): RenderResult {
  return render(
    <TelemetryFacetValueRow
      value="h-1"
      displayValue="web-1"
      count={12}
      maxCount={24}
      onInclude={calls.onInclude as any}
      onClear={calls.onClear as any}
      onExclude={
        options.withExclude === false ? undefined : (calls.onExclude as any)
      }
      {...overrides}
    />,
  );
}

function rowCheckbox(): HTMLElement {
  return screen.getByRole("checkbox");
}

function excludeButton(): HTMLElement {
  return screen.getByRole("button", { name: "Exclude web-1" });
}

function count(): HTMLElement {
  return screen.getByTestId(FACET_VALUE_COUNT_TEST_ID);
}

function row(): HTMLElement {
  return screen.getByTestId(FACET_VALUE_ROW_TEST_ID);
}

function classesOf(classText: string): Array<string> {
  return classText.split(" ").filter((token: string): boolean => {
    return token.length > 0;
  });
}

// `invisible` on its own: hidden at rest, not only while the row is hovered.
const INVISIBLE_AT_REST: RegExp = /(^|\s)invisible(\s|$)/;

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a value that is not filtering", () => {
  test("is an unchecked checkbox that offers to filter to it", () => {
    mount({});

    const checkbox: HTMLElement = rowCheckbox();
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    expect(checkbox).not.toHaveAttribute("aria-disabled");
    expect(checkbox).toHaveAttribute("title", "Filter to web-1");
    expect(checkbox).toHaveAccessibleName("web-1");
    expect(screen.getByTestId(FACET_VALUE_ROW_TEST_ID)).toHaveAttribute(
      "data-state",
      FacetValueState.None,
    );
  });

  test("a click includes it, and nothing else", () => {
    const calls: Handlers = handlers();
    mount({}, calls);

    fireEvent.click(rowCheckbox());

    expect(calls.onInclude.mock.calls).toEqual([["h-1"]]);
    expect(calls.onClear).not.toHaveBeenCalled();
    expect(calls.onExclude).not.toHaveBeenCalled();
  });

  test("its exclude button excludes it, without the click reaching the row", () => {
    const calls: Handlers = handlers();
    mount({}, calls);

    expect(excludeButton()).toHaveAttribute("aria-pressed", "false");
    expect(excludeButton()).toHaveAttribute("title", "Exclude web-1");

    fireEvent.click(excludeButton());

    expect(calls.onExclude.mock.calls).toEqual([["h-1"]]);
    expect(calls.onInclude).not.toHaveBeenCalled();
    expect(calls.onClear).not.toHaveBeenCalled();
  });

  test("the exclude button shows on hover only, in the class the foreign-.hidden guard ships", () => {
    mount({});

    expect(excludeButton().className).toBe(
      "flex h-5 w-5 items-center justify-center rounded text-[10px] text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 group-[:not(:hover)]:hidden",
    );
    expect(screen.getByTestId(FACET_VALUE_ROW_TEST_ID)).toHaveClass("group");
  });

  test("a resource with nothing in the range is muted", () => {
    mount({ count: 0 });

    expect(screen.getByText("web-1")).toHaveClass("text-gray-400");
    // Faded, not a lighter grey: the dark theme brightens gray-300.
    expect(screen.getByText("0")).toHaveClass("text-gray-400", "opacity-60");
    expect(screen.getByText("0")).not.toHaveClass("text-gray-300");
  });

  test("names an empty value '(empty)' and falls back to the raw value", () => {
    const first: RenderResult = mount({ value: "", displayValue: undefined });
    expect(rowCheckbox()).toHaveAccessibleName("(empty)");
    first.unmount();

    mount({ value: "raw-id", displayValue: undefined });
    expect(rowCheckbox()).toHaveAccessibleName("raw-id");
  });
});

describe("a checked value", () => {
  test("is a checked checkbox that offers to remove the filter", () => {
    mount({ state: FacetValueState.Included });

    const checkbox: HTMLElement = rowCheckbox();
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(checkbox).toHaveAttribute("title", "Remove filter: web-1");
    expect(checkbox).toHaveClass("bg-indigo-50");
    expect(checkbox).toHaveClass("hover:bg-indigo-100");
    expect(screen.getByText("web-1")).toHaveClass("text-indigo-700");
    expect(screen.getByTestId(FACET_VALUE_ROW_TEST_ID)).toHaveAttribute(
      "data-state",
      FacetValueState.Included,
    );
  });

  test("REGRESSION: a click takes the filter off instead of including it again", () => {
    const calls: Handlers = handlers();
    mount({ state: FacetValueState.Included }, calls);

    fireEvent.click(rowCheckbox());

    expect(calls.onClear.mock.calls).toEqual([["h-1"]]);
    expect(calls.onInclude).not.toHaveBeenCalled();
  });

  test("its exclude button swaps the include for an exclude", () => {
    const calls: Handlers = handlers();
    mount({ state: FacetValueState.Included }, calls);

    expect(excludeButton()).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(excludeButton());

    expect(calls.onExclude.mock.calls).toEqual([["h-1"]]);
    expect(calls.onClear).not.toHaveBeenCalled();
  });

  test("a zero count still reads as checked", () => {
    mount({ state: FacetValueState.Included, count: 0 });

    expect(screen.getByText("web-1")).toHaveClass("text-indigo-700");
    expect(screen.getByText("0")).toHaveClass("text-indigo-600");
  });
});

describe("an excluded value", () => {
  test("is the checkbox's mixed state, says 'Excluded', and is struck through in red", () => {
    mount({ state: FacetValueState.Excluded, count: 0 });

    const checkbox: HTMLElement = rowCheckbox();
    expect(checkbox).toHaveAttribute("aria-checked", "mixed");
    expect(checkbox).toHaveAttribute("title", "Remove exclusion: web-1");
    expect(checkbox).toHaveAccessibleName("web-1 Excluded");
    expect(within(checkbox).getByText("Excluded")).toHaveClass("sr-only");
    expect(checkbox).toHaveClass("bg-red-50");
    expect(screen.getByText("web-1")).toHaveClass(
      "line-through",
      "text-red-700",
    );
    expect(screen.getByTestId(FACET_VALUE_ROW_TEST_ID)).toHaveAttribute(
      "data-state",
      FacetValueState.Excluded,
    );
  });

  test("a click takes the exclusion off", () => {
    const calls: Handlers = handlers();
    mount({ state: FacetValueState.Excluded }, calls);

    fireEvent.click(rowCheckbox());

    expect(calls.onClear.mock.calls).toEqual([["h-1"]]);
    expect(calls.onInclude).not.toHaveBeenCalled();
    expect(calls.onExclude).not.toHaveBeenCalled();
  });

  test("its exclude button is pressed, always on screen, and takes the exclusion off", () => {
    const calls: Handlers = handlers();
    mount({ state: FacetValueState.Excluded }, calls);

    const button: HTMLElement = excludeButton();
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("title", "Remove exclusion: web-1");
    // Not hidden off hover: the reader has to see what is leaving rows out.
    expect(button.className).not.toContain(":hidden");
    expect(button).toHaveClass("bg-red-50", "text-red-600");

    fireEvent.click(button);

    expect(calls.onClear.mock.calls).toEqual([["h-1"]]);
    expect(calls.onExclude).not.toHaveBeenCalled();
    expect(calls.onInclude).not.toHaveBeenCalled();
  });
});

describe("a value the page itself filters on", () => {
  test("shows set and locked, and a click changes nothing", () => {
    const calls: Handlers = handlers();
    mount({ state: FacetValueState.Included, isLocked: true }, calls);

    const checkbox: HTMLElement = rowCheckbox();
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(checkbox).toHaveAttribute("aria-disabled", "true");
    expect(checkbox).toHaveAttribute("title", "Set by this page: web-1");
    expect(checkbox).toHaveClass("cursor-default");

    fireEvent.click(checkbox);

    expect(calls.onInclude).not.toHaveBeenCalled();
    expect(calls.onClear).not.toHaveBeenCalled();
  });

  test("has no exclude button, and its count stays in view under the pointer", () => {
    mount({ state: FacetValueState.Included, isLocked: true });

    expect(screen.queryByRole("button", { name: "Exclude web-1" })).toBeNull();
    // Only the checkbox and the count: nothing is laid over the count.
    expect(row().children).toHaveLength(2);
    expect(count().className).not.toContain("invisible");
    expect(count()).toHaveClass("font-medium", "text-gray-500");
  });

  test("a lock on a value that is not filtering means nothing", () => {
    const calls: Handlers = handlers();
    mount({ isLocked: true }, calls);

    expect(rowCheckbox()).not.toHaveAttribute("aria-disabled");

    fireEvent.click(rowCheckbox());

    expect(calls.onInclude.mock.calls).toEqual([["h-1"]]);
  });
});

describe("an explorer that cannot exclude", () => {
  test.each([
    [FacetValueState.None],
    [FacetValueState.Included],
    [FacetValueState.Excluded],
  ])(
    "draws no exclude button on a %s value, and keeps no room for one",
    (state: FacetValueState) => {
      mount({ state: state }, handlers(), { withExclude: false });

      expect(screen.queryAllByRole("button")).toEqual([]);
      // Only the checkbox and the count: the counts line up at the edge.
      expect(screen.getByTestId(FACET_VALUE_ROW_TEST_ID).children).toHaveLength(
        2,
      );
    },
  );

  test("an excluded value still clears from its row", () => {
    const calls: Handlers = handlers();
    mount({ state: FacetValueState.Excluded }, calls, { withExclude: false });

    fireEvent.click(rowCheckbox());

    expect(calls.onClear.mock.calls).toEqual([["h-1"]]);
  });
});

describe("the count column", () => {
  test("is one width for every row, so the bars and counts of a section line up", () => {
    const first: RenderResult = mount({ count: 2417585, maxCount: 2417585 });
    expect(count()).toHaveClass(...classesOf(FACET_COUNT_COLUMN_CLASS));
    // A fixed width, never a minimum that a long count could stretch.
    expect(classesOf(FACET_COUNT_COLUMN_CLASS)).toEqual(
      expect.arrayContaining(["w-7", "flex-none", "text-right"]),
    );
    expect(FACET_COUNT_COLUMN_CLASS).not.toContain("min-w");
    first.unmount();

    const second: RenderResult = mount({ count: 0 });
    expect(count()).toHaveClass(...classesOf(FACET_COUNT_COLUMN_CLASS));
    second.unmount();

    // The dash of a count that was not taken sits in the same column.
    mount({ isCountUnknown: true });
    expect(screen.getByTestId("facet-count-unknown")).toHaveClass(
      ...classesOf(FACET_COUNT_COLUMN_CLASS),
    );
  });

  test("REGRESSION: a count of a million or more is shortened, the full count kept for a screen reader and on hover", () => {
    mount({ count: 2417585, maxCount: 2417585 });

    // "2,417,585" took the room the name needed ("one..." in the report).
    expect(within(count()).getByText("2.4M")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(count()).getByText("2,417,585")).toHaveClass("sr-only");
    expect(count()).toHaveAttribute("title", "2,417,585");
    expect(count()).toHaveTextContent("2.4M2,417,585");
  });

  test.each([
    [1204, "1.2K", "1,204"],
    [38811, "39K", "38,811"],
    [120345, "120K", "120,345"],
    [999500, "1M", "999,500"],
  ])(
    "%d reads %s, and %s in full",
    (value: number, shortened: string, full: string) => {
      mount({ count: value, maxCount: value });

      expect(within(count()).getByText(shortened)).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(within(count()).getByText(full)).toHaveClass("sr-only");
      expect(count()).toHaveAttribute("title", full);
    },
  );

  test("a count under a thousand is written in the chart's digits whatever the browser's locale, like the shortened ones beside it", () => {
    // A browser whose locale writes numbers in digits of its own.
    jest
      .spyOn(Number.prototype, "toLocaleString")
      .mockReturnValue("LOCAL-DIGITS");

    mount({ count: 999, maxCount: 999 });

    expect(count()).toHaveTextContent(/^999$/);
  });

  test("a count under a thousand is written out once, with nothing to add on hover", () => {
    mount({ count: 999, maxCount: 999 });

    expect(count()).toHaveTextContent(/^999$/);
    expect(count()).not.toHaveAttribute("title");
    expect(count().querySelector("[aria-hidden]")).toBeNull();
    expect(count().querySelector(".sr-only")).toBeNull();
  });

  test("a count the time limit stopped is a dash read as 'Not counted'", () => {
    mount({ isCountUnknown: true });

    expect(screen.getByTestId("facet-count-unknown")).toHaveTextContent(
      "—Not counted",
    );
    expect(screen.queryByText("12")).toBeNull();
  });
});

describe("the exclude button lies over the count", () => {
  test("rather than keeping a column of its own, so the name keeps that width", () => {
    mount({});

    // The checkbox, the count, and the layer the exclude button sits in.
    expect(row().children).toHaveLength(3);
    expect(row()).toHaveClass("relative", "group", "group/row");

    const layer: HTMLElement = row().lastElementChild as HTMLElement;
    expect(layer).toHaveClass("absolute", "inset-y-0", "right-0");
    expect(within(layer).getByRole("button")).toBe(excludeButton());
  });

  test("the count steps aside while the row is hovered, when the button shows", () => {
    mount({ count: 1302, maxCount: 38811 });

    expect(count()).toHaveClass("group-hover/row:invisible");
    expect(count().className).not.toMatch(INVISIBLE_AT_REST);
  });

  test("an excluded value's pressed button stands where its count was, for good", () => {
    mount({ state: FacetValueState.Excluded, count: 0 });

    expect(count()).toHaveClass("invisible");
    expect(count()).not.toHaveClass("group-hover/row:invisible");
    expect(excludeButton()).toHaveAttribute("aria-pressed", "true");
  });

  test("a dash in place of a count steps aside the same way", () => {
    mount({ isCountUnknown: true });

    expect(screen.getByTestId("facet-count-unknown")).toHaveClass(
      "group-hover/row:invisible",
    );
  });

  test.each([
    [FacetValueState.None],
    [FacetValueState.Included],
    [FacetValueState.Excluded],
  ])(
    "without an exclude button the count of a %s value never steps aside",
    (state: FacetValueState) => {
      mount({ state: state }, handlers(), { withExclude: false });

      expect(count().className).not.toContain("invisible");
    },
  );
});

describe("focus", () => {
  test("the checkbox shows the explorers' indigo ring for the keyboard, not the browser's outline", () => {
    mount({});

    expect(rowCheckbox()).toHaveClass(
      "focus:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
    );
  });

  test("the pressed exclude button, which the keyboard reaches, shows a ring of its red", () => {
    mount({ state: FacetValueState.Excluded });

    expect(excludeButton()).toHaveClass(
      "focus:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-red-500",
    );
  });
});

describe("the keyboard", () => {
  test("Space and Enter on a checked value take it off; on an unchecked one, include it", async () => {
    const user: UserEvent = userEvent.setup();
    const calls: Handlers = handlers();
    const view: RenderResult = mount(
      { state: FacetValueState.Included },
      calls,
    );

    rowCheckbox().focus();
    await user.keyboard(" ");
    await user.keyboard("{Enter}");

    expect(calls.onClear.mock.calls).toEqual([["h-1"], ["h-1"]]);
    expect(calls.onInclude).not.toHaveBeenCalled();

    view.rerender(
      <TelemetryFacetValueRow
        value="h-1"
        displayValue="web-1"
        count={12}
        maxCount={24}
        onInclude={calls.onInclude as any}
        onClear={calls.onClear as any}
        onExclude={calls.onExclude as any}
      />,
    );

    rowCheckbox().focus();
    await user.keyboard("{Enter}");

    expect(calls.onInclude.mock.calls).toEqual([["h-1"]]);
  });

  test("Tab reaches the row before its exclude button, and Space on that excludes", async () => {
    const user: UserEvent = userEvent.setup();
    const calls: Handlers = handlers();
    mount({ state: FacetValueState.Excluded }, calls);

    await user.tab();
    expect(rowCheckbox()).toHaveFocus();

    await user.tab();
    expect(excludeButton()).toHaveFocus();

    await user.keyboard(" ");

    expect(calls.onClear.mock.calls).toEqual([["h-1"]]);
  });
});

/*
 * A described value (FacetConfig.valueDescriptionMap) - the Span Type's
 * Root spans, "Where a trace starts." - says what it is beside the row on
 * hover and keyboard focus, and to a screen reader as the row's
 * description. Rows without a sentence are exactly as before.
 */
describe("a value that says what it is", () => {
  const SENTENCE: string = "Where a trace starts.";

  // Lets Tippy's deferred work run, then says which tooltips are shown.
  async function tooltipsShown(): Promise<Array<string>> {
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 50);
      });
    });

    return screen.queryAllByRole("tooltip").map((tooltip: HTMLElement) => {
      return tooltip.textContent || "";
    });
  }

  test("a screen reader hears its sentence with its name, with no tooltip showing", () => {
    mount({ description: SENTENCE });

    expect(rowCheckbox()).toHaveAccessibleName("web-1");
    expect(rowCheckbox()).toHaveAccessibleDescription(SENTENCE);
    expect(screen.queryAllByRole("tooltip")).toEqual([]);

    const description: HTMLElement = document.getElementById(
      rowCheckbox().getAttribute("aria-describedby") || "",
    ) as HTMLElement;

    // Inside the row, never drawn on its own.
    expect(row()).toContainElement(description);
    expect(description).toHaveAttribute("hidden");
    expect(description).not.toBeVisible();
  });

  test("hovering it says its sentence, in place of the row's own hover text", async () => {
    mount({ description: SENTENCE });

    expect(rowCheckbox()).not.toHaveAttribute("title");

    fireEvent.mouseEnter(rowCheckbox());
    expect(await tooltipsShown()).toEqual([SENTENCE]);

    fireEvent.mouseLeave(rowCheckbox());
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toEqual([]);
    });
  });

  test("the keyboard's focus says it; a focus a click moved there adds nothing", async () => {
    mount({ description: SENTENCE });

    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => {
      rowCheckbox().focus();
    });
    expect(await tooltipsShown()).toEqual([SENTENCE]);

    act(() => {
      rowCheckbox().blur();
    });
    await waitFor(() => {
      expect(screen.queryAllByRole("tooltip")).toEqual([]);
    });

    fireEvent.pointerDown(rowCheckbox());
    fireEvent.mouseDown(rowCheckbox());
    act(() => {
      rowCheckbox().focus();
    });
    expect(await tooltipsShown()).toEqual([]);
  });

  test("Tippy adds no description of its own: the sentence is read once", async () => {
    mount({ description: SENTENCE });
    const describedBy: string | null =
      rowCheckbox().getAttribute("aria-describedby");

    fireEvent.mouseEnter(rowCheckbox());
    await tooltipsShown();

    expect(rowCheckbox().getAttribute("aria-describedby")).toBe(describedBy);
  });

  test("a click still does what the row does", () => {
    const calls: Handlers = handlers();
    mount({ description: SENTENCE }, calls);

    fireEvent.click(rowCheckbox());

    expect(calls.onInclude.mock.calls).toEqual([["h-1"]]);
  });

  test("a radio option says it too, and still chooses on a click", async () => {
    const calls: Handlers = handlers();
    mount(
      {
        value: "root",
        displayValue: "Root spans",
        isRadio: true,
        description: SENTENCE,
      },
      calls,
    );

    const radio: HTMLElement = screen.getByRole("radio", {
      name: "Root spans",
    });

    expect(radio).toHaveAccessibleDescription(SENTENCE);

    fireEvent.mouseEnter(radio);
    expect(await tooltipsShown()).toEqual([SENTENCE]);

    fireEvent.click(radio);
    expect(calls.onInclude.mock.calls).toEqual([["root"]]);
  });

  test("its exclude button and count are where they were", () => {
    mount({ description: SENTENCE });

    expect(excludeButton()).toBeInTheDocument();
    expect(count()).toHaveTextContent("12");
    expect(row().firstElementChild).toBe(rowCheckbox());
  });

  test.each([
    ["no sentence", undefined],
    ["an empty one", ""],
    ["a blank one", "  \n "],
  ])(
    "a row with %s is the row it always was",
    (_name: string, description: string | undefined) => {
      mount({ description: description });

      expect(rowCheckbox()).not.toHaveAttribute("aria-describedby");
      expect(rowCheckbox()).toHaveAttribute("title", "Filter to web-1");
      expect(row().querySelector("[hidden]")).toBeNull();
    },
  );
});
