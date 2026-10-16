import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import TelemetryFacetValueRow, {
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
 *   - a value the page itself filters on is shown, and left alone.
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
    expect(screen.getByText("0")).toHaveClass("text-gray-300");
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

  test("has no exclude button", () => {
    mount({ state: FacetValueState.Included, isLocked: true });

    expect(screen.queryByRole("button", { name: "Exclude web-1" })).toBeNull();
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
  test("keeps the exclude button's place, so a hovered row's count stays in line", () => {
    mount({});

    const row: HTMLElement = screen.getByTestId(FACET_VALUE_ROW_TEST_ID);
    const slot: HTMLElement = row.lastElementChild as HTMLElement;

    expect(row.children).toHaveLength(3);
    expect(slot.tagName).toBe("SPAN");
    expect(slot).toHaveClass("h-5", "w-5", "flex-none");
    expect(slot.className).not.toContain("hidden");
    expect(within(slot).getByRole("button")).toBe(excludeButton());
  });

  test("a count the time limit stopped is a dash read as 'Not counted'", () => {
    mount({ isCountUnknown: true });

    expect(screen.getByTestId("facet-count-unknown")).toHaveTextContent(
      "—Not counted",
    );
    expect(screen.queryByText("12")).toBeNull();
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
