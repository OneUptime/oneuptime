import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ExceptionSegmentedControl, {
  ComponentProps,
  SegmentedControlOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSegmentedControl";

/*
 * The joined-button radio group used for the exception trend window, the
 * stack trace view and the Correlate search mode. Pinned here:
 *
 *  - what it renders (labels, hints, titles, test ids, active/disabled
 *    looks) and its radio semantics;
 *  - the roving tab stop: only the checked option is in the tab order, or
 *    the first enabled option when nothing enabled is checked;
 *  - clicks select an unchecked, enabled option and nothing else;
 *  - the radio group keys: ArrowRight/ArrowDown and ArrowLeft/ArrowUp move
 *    (wrapping), Home/End jump, disabled options are skipped, focus follows
 *    the move, onChange fires only for a new value, handled keys have their
 *    default prevented and every other key is left alone.
 */

type TrendWindow = "1h" | "24h" | "7d" | "30d";

const LABEL: string = "Trend window";
const TEST_ID: string = "trend-window";

const OPTIONS: Array<SegmentedControlOption<TrendWindow>> = [
  { value: "1h", label: "1H" },
  { value: "24h", label: "24H", hint: "12" },
  { value: "7d", label: "7D", title: "Last 7 days" },
  { value: "30d", label: "30D", hint: "140" },
];

const VALUES: Array<TrendWindow> = ["1h", "24h", "7d", "30d"];

// 24h and 30d are disabled, so only 1h and 7d can be reached.
const WITH_DISABLED: Array<SegmentedControlOption<TrendWindow>> = [
  { value: "1h", label: "1H" },
  { value: "24h", label: "24H", isDisabled: true, title: "No data" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D", isDisabled: true },
];

// The first option is disabled.
const FIRST_DISABLED: Array<SegmentedControlOption<TrendWindow>> = [
  { value: "1h", label: "1H", isDisabled: true },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D", isDisabled: true },
];

const ALL_DISABLED: Array<SegmentedControlOption<TrendWindow>> = OPTIONS.map(
  (
    option: SegmentedControlOption<TrendWindow>,
  ): SegmentedControlOption<TrendWindow> => {
    return { ...option, isDisabled: true };
  },
);

// Without 1h, a value of "1h" leaves nothing checked.
const WITHOUT_1H: Array<SegmentedControlOption<TrendWindow>> = OPTIONS.slice(1);

const HANDLED_KEYS: Array<string> = [
  "ArrowRight",
  "ArrowDown",
  "ArrowLeft",
  "ArrowUp",
  "Home",
  "End",
];

const UNHANDLED_KEYS: Array<string> = [
  "Enter",
  " ",
  "Tab",
  "Escape",
  "PageDown",
  "PageUp",
  "Backspace",
  "a",
  "1",
  "Shift",
];

interface RenderedControl {
  onChange: MockFunction;
  result: RenderResult;
  rerenderWith: (overrides: Partial<ComponentProps<TrendWindow>>) => void;
}

function renderControl(
  overrides: Partial<ComponentProps<TrendWindow>> = {},
): RenderedControl {
  const onChange: MockFunction = getJestMockFunction();
  const baseProps: ComponentProps<TrendWindow> = {
    label: LABEL,
    options: OPTIONS,
    value: "24h",
    onChange: onChange as (value: TrendWindow) => void,
    testId: TEST_ID,
  };

  const result: RenderResult = render(
    <ExceptionSegmentedControl {...baseProps} {...overrides} />,
  );

  return {
    onChange: onChange,
    result: result,
    rerenderWith: (next: Partial<ComponentProps<TrendWindow>>): void => {
      result.rerender(
        <ExceptionSegmentedControl {...baseProps} {...overrides} {...next} />,
      );
    },
  };
}

interface HarnessProps {
  options: ReadonlyArray<SegmentedControlOption<TrendWindow>>;
  initialValue: TrendWindow;
  onChange: (value: TrendWindow) => void;
}

// A parent that owns the value, as every real caller does.
const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const [value, setValue] = useState<TrendWindow>(props.initialValue);

  return (
    <ExceptionSegmentedControl
      label={LABEL}
      options={props.options}
      value={value}
      testId={TEST_ID}
      onChange={(next: TrendWindow) => {
        props.onChange(next);
        setValue(next);
      }}
    />
  );
};

function renderHarness(
  initialValue: TrendWindow,
  options: ReadonlyArray<SegmentedControlOption<TrendWindow>> = OPTIONS,
): MockFunction {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <Harness
      options={options}
      initialValue={initialValue}
      onChange={onChange as (value: TrendWindow) => void}
    />,
  );

  return onChange;
}

function group(): HTMLElement {
  return screen.getByRole("radiogroup", { name: LABEL });
}

function radio(value: TrendWindow): HTMLElement {
  return screen.getByTestId(`${TEST_ID}-${value}`);
}

function tabIndexes(): Array<string | null> {
  return screen.getAllByRole("radio").map((element: HTMLElement) => {
    return element.getAttribute("tabindex");
  });
}

function checkedValues(): Array<string> {
  return VALUES.filter((value: TrendWindow): boolean => {
    return radio(value).getAttribute("aria-checked") === "true";
  });
}

/*
 * Presses a key where a keyboard user would: on the focused element when
 * that is inside the group, otherwise on the group itself. Returns whether
 * the default action is still allowed.
 */
function press(key: string): boolean {
  const active: Element | null = document.activeElement;
  const target: Element = active && group().contains(active) ? active : group();

  return fireEvent.keyDown(target, { key: key });
}

afterEach(() => {
  cleanup();
});

describe("ExceptionSegmentedControl rendering", () => {
  test("is a labelled radio group of joined buttons", () => {
    renderControl();

    const radioGroup: HTMLElement = group();

    expect(radioGroup.tagName).toBe("DIV");
    expect(radioGroup).toHaveAttribute("role", "radiogroup");
    expect(radioGroup).toHaveAttribute("aria-label", LABEL);
    expect(radioGroup).toHaveAttribute("data-testid", TEST_ID);
    expect(radioGroup).toHaveClass(
      "inline-flex",
      "rounded-lg",
      "bg-gray-100",
      "p-0.5",
    );
    // The group itself is not a tab stop.
    expect(radioGroup).not.toHaveAttribute("tabindex");
  });

  test("renders one radio button per option, in order", () => {
    renderControl();

    const radios: Array<HTMLElement> = screen.getAllByRole("radio");

    expect(radios).toHaveLength(OPTIONS.length);
    expect(
      radios.map((element: HTMLElement): string | null => {
        return element.getAttribute("data-testid");
      }),
    ).toEqual(
      VALUES.map((value: TrendWindow): string => {
        return `${TEST_ID}-${value}`;
      }),
    );

    for (const element of radios) {
      expect(element.tagName).toBe("BUTTON");
      expect(element).toHaveAttribute("type", "button");
      expect(element.parentElement).toBe(group());
    }
  });

  test("names each radio by its label and hint", () => {
    renderControl();

    expect(screen.getByRole("radio", { name: "1H" })).toBe(radio("1h"));
    expect(screen.getByRole("radio", { name: /^24H\s*12$/ })).toBe(
      radio("24h"),
    );
    expect(screen.getByRole("radio", { name: /^30D\s*140$/ })).toBe(
      radio("30d"),
    );
    expect(radio("1h")).toHaveTextContent(/^1H$/);
  });

  test("shows a hint after the label in a muted numeric span", () => {
    renderControl({ value: "24h" });

    const activeHint: HTMLElement = radio("24h").querySelector(
      "span",
    ) as HTMLElement;
    const inactiveHint: HTMLElement = radio("30d").querySelector(
      "span",
    ) as HTMLElement;

    expect(activeHint).toHaveTextContent(/^12$/);
    expect(activeHint).toHaveClass("tabular-nums", "text-gray-500");
    expect(radio("24h").lastElementChild).toBe(activeHint);
    expect(inactiveHint).toHaveTextContent(/^140$/);
    expect(inactiveHint).toHaveClass("tabular-nums", "text-gray-400");
  });

  test("renders no hint span for an option without a hint", () => {
    renderControl();

    expect(radio("1h").querySelector("span")).toBeNull();
    expect(radio("7d").querySelector("span")).toBeNull();
  });

  test("passes an option's title through", () => {
    renderControl();

    expect(radio("7d")).toHaveAttribute("title", "Last 7 days");
    expect(radio("1h")).not.toHaveAttribute("title");
  });

  test("marks only the current value as checked", () => {
    for (const value of VALUES) {
      renderControl({ value: value });

      for (const other of VALUES) {
        expect(radio(other)).toHaveAttribute(
          "aria-checked",
          other === value ? "true" : "false",
        );
      }
      expect(screen.getByRole("radio", { checked: true })).toBe(radio(value));

      cleanup();
    }
  });

  test("styles the checked, unchecked and disabled options apart", () => {
    renderControl({ options: WITH_DISABLED, value: "1h" });

    expect(radio("1h")).toHaveClass(
      "bg-white",
      "text-gray-900",
      "shadow-sm",
      "ring-1",
      "ring-gray-200",
    );
    expect(radio("7d")).toHaveClass("text-gray-600", "hover:text-gray-900");
    expect(radio("7d")).not.toHaveClass("bg-white");
    expect(radio("24h")).toHaveClass("cursor-not-allowed", "text-gray-300");
    expect(radio("24h")).not.toHaveClass("hover:text-gray-900");

    for (const value of VALUES) {
      expect(radio(value)).toHaveClass(
        "focus:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-indigo-500",
      );
    }
  });

  test("disables only the disabled options", () => {
    renderControl({ options: WITH_DISABLED, value: "1h" });

    expect(radio("1h")).toBeEnabled();
    expect(radio("24h")).toBeDisabled();
    expect(radio("24h")).toHaveAttribute("title", "No data");
    expect(radio("7d")).toBeEnabled();
    expect(radio("30d")).toBeDisabled();
  });

  test("leaves out every test id when none is given", () => {
    const { result } = renderControl({ testId: undefined });

    expect(group()).not.toHaveAttribute("data-testid");
    expect(result.container.querySelectorAll("[data-testid]")).toHaveLength(0);
    expect(screen.getAllByRole("radio")).toHaveLength(OPTIONS.length);
  });

  test("renders an empty group for no options", () => {
    renderControl({ options: [] });

    expect(group()).toBeEmptyDOMElement();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });
});

describe("ExceptionSegmentedControl roving tab stop", () => {
  test.each(VALUES)(
    "only the checked option (%s) is in the tab order",
    (value: TrendWindow) => {
      renderControl({ value: value });

      for (const other of VALUES) {
        expect(radio(other)).toHaveAttribute(
          "tabindex",
          other === value ? "0" : "-1",
        );
      }
    },
  );

  test("always offers exactly one tab stop while an option is enabled", () => {
    const cases: Array<{
      options: ReadonlyArray<SegmentedControlOption<TrendWindow>>;
      value: TrendWindow;
    }> = [
      { options: OPTIONS, value: "1h" },
      { options: OPTIONS, value: "30d" },
      { options: WITH_DISABLED, value: "7d" },
      { options: WITH_DISABLED, value: "24h" },
      { options: FIRST_DISABLED, value: "1h" },
      { options: WITHOUT_1H, value: "1h" },
    ];

    for (const testCase of cases) {
      renderControl({ options: testCase.options, value: testCase.value });

      expect(
        tabIndexes().filter((tabIndex: string | null): boolean => {
          return tabIndex === "0";
        }),
      ).toHaveLength(1);
      expect(
        tabIndexes().every((tabIndex: string | null): boolean => {
          return tabIndex === "0" || tabIndex === "-1";
        }),
      ).toBe(true);

      cleanup();
    }
  });

  test("with nothing checked, the first option takes the tab stop", () => {
    renderControl({ options: WITHOUT_1H, value: "1h" });

    expect(screen.queryByRole("radio", { checked: true })).toBeNull();
    expect(tabIndexes()).toEqual(["0", "-1", "-1"]);
    expect(radio("24h")).toHaveAttribute("tabindex", "0");
  });

  test("with nothing checked and the first option disabled, the first enabled one takes it", () => {
    renderControl({
      options: FIRST_DISABLED.filter(
        (option: SegmentedControlOption<TrendWindow>): boolean => {
          return option.value !== "7d";
        },
      ),
      value: "7d",
    });

    expect(radio("1h")).toHaveAttribute("tabindex", "-1");
    expect(radio("24h")).toHaveAttribute("tabindex", "0");
    expect(radio("30d")).toHaveAttribute("tabindex", "-1");
  });

  test("a disabled checked option hands the tab stop to the first enabled one", () => {
    renderControl({ options: FIRST_DISABLED, value: "1h" });

    // Still reported as checked, but it cannot take focus.
    expect(radio("1h")).toHaveAttribute("aria-checked", "true");
    expect(radio("1h")).toHaveAttribute("tabindex", "-1");
    expect(tabIndexes()).toEqual(["-1", "0", "-1", "-1"]);
  });

  test("a checked option after a disabled one keeps the tab stop", () => {
    renderControl({ options: FIRST_DISABLED, value: "7d" });

    expect(tabIndexes()).toEqual(["-1", "-1", "0", "-1"]);
  });

  test("never puts a disabled option in the tab order", () => {
    for (const value of VALUES) {
      renderControl({ options: WITH_DISABLED, value: value });

      expect(radio("24h")).toHaveAttribute("tabindex", "-1");
      expect(radio("30d")).toHaveAttribute("tabindex", "-1");

      cleanup();
    }
  });

  test("offers no tab stop when every option is disabled", () => {
    renderControl({ options: ALL_DISABLED, value: "7d" });

    expect(tabIndexes()).toEqual(["-1", "-1", "-1", "-1"]);
  });

  test("moves the tab stop when the parent changes the value", () => {
    const { rerenderWith } = renderControl({ value: "1h" });

    expect(tabIndexes()).toEqual(["0", "-1", "-1", "-1"]);

    rerenderWith({ value: "30d" });

    expect(tabIndexes()).toEqual(["-1", "-1", "-1", "0"]);
    expect(checkedValues()).toEqual(["30d"]);
  });

  test("moves the tab stop when the checked option becomes disabled", () => {
    const { rerenderWith } = renderControl({ options: OPTIONS, value: "7d" });

    expect(tabIndexes()).toEqual(["-1", "-1", "0", "-1"]);

    rerenderWith({
      options: OPTIONS.map(
        (
          option: SegmentedControlOption<TrendWindow>,
        ): SegmentedControlOption<TrendWindow> => {
          return { ...option, isDisabled: option.value === "7d" };
        },
      ),
    });

    expect(tabIndexes()).toEqual(["0", "-1", "-1", "-1"]);
  });
});

describe("ExceptionSegmentedControl clicks", () => {
  test("selecting an unchecked option reports its value once", () => {
    const { onChange } = renderControl({ value: "24h" });

    fireEvent.click(radio("7d"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("7d");
  });

  test("clicking the checked option does nothing", () => {
    const { onChange } = renderControl({ value: "24h" });

    fireEvent.click(radio("24h"));

    expect(onChange).not.toHaveBeenCalled();
  });

  test("clicking a disabled option does nothing", () => {
    const { onChange } = renderControl({
      options: WITH_DISABLED,
      value: "1h",
    });

    fireEvent.click(radio("24h"));
    fireEvent.click(radio("30d"));

    expect(onChange).not.toHaveBeenCalled();
  });

  test("the value only changes when the parent passes it back", () => {
    const { onChange } = renderControl({ value: "24h" });

    fireEvent.click(radio("1h"));

    expect(onChange).toHaveBeenCalledWith("1h");
    expect(checkedValues()).toEqual(["24h"]);
  });

  test("with a parent owning the value, a click checks the option and moves the tab stop", () => {
    const onChange: MockFunction = renderHarness("24h");

    fireEvent.click(radio("30d"));

    expect(onChange).toHaveBeenCalledWith("30d");
    expect(checkedValues()).toEqual(["30d"]);
    expect(tabIndexes()).toEqual(["-1", "-1", "-1", "0"]);
  });

  test("a click does not need the keyboard handler", () => {
    const onChange: MockFunction = renderHarness("1h");

    fireEvent.click(radio("7d"));
    fireEvent.click(radio("1h"));

    expect(onChange.mock.calls).toEqual([["7d"], ["1h"]]);
  });
});

describe("ExceptionSegmentedControl keyboard", () => {
  test.each(["ArrowRight", "ArrowDown"])(
    "%s selects and focuses the next option",
    (key: string) => {
      const onChange: MockFunction = renderHarness("24h");
      radio("24h").focus();

      expect(press(key)).toBe(false);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("7d");
      expect(radio("7d")).toHaveFocus();
      expect(checkedValues()).toEqual(["7d"]);
      expect(radio("7d")).toHaveAttribute("tabindex", "0");
      expect(radio("24h")).toHaveAttribute("tabindex", "-1");
    },
  );

  test.each(["ArrowLeft", "ArrowUp"])(
    "%s selects and focuses the previous option",
    (key: string) => {
      const onChange: MockFunction = renderHarness("24h");
      radio("24h").focus();

      expect(press(key)).toBe(false);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("1h");
      expect(radio("1h")).toHaveFocus();
      expect(checkedValues()).toEqual(["1h"]);
    },
  );

  test.each(["ArrowRight", "ArrowDown"])(
    "%s wraps from the last option to the first",
    (key: string) => {
      const onChange: MockFunction = renderHarness("30d");
      radio("30d").focus();

      press(key);

      expect(onChange).toHaveBeenCalledWith("1h");
      expect(radio("1h")).toHaveFocus();
    },
  );

  test.each(["ArrowLeft", "ArrowUp"])(
    "%s wraps from the first option to the last",
    (key: string) => {
      const onChange: MockFunction = renderHarness("1h");
      radio("1h").focus();

      press(key);

      expect(onChange).toHaveBeenCalledWith("30d");
      expect(radio("30d")).toHaveFocus();
    },
  );

  test("Home selects and focuses the first option", () => {
    const onChange: MockFunction = renderHarness("7d");
    radio("7d").focus();

    expect(press("Home")).toBe(false);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("1h");
    expect(radio("1h")).toHaveFocus();
    expect(checkedValues()).toEqual(["1h"]);
  });

  test("End selects and focuses the last option", () => {
    const onChange: MockFunction = renderHarness("24h");
    radio("24h").focus();

    expect(press("End")).toBe(false);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("30d");
    expect(radio("30d")).toHaveFocus();
    expect(checkedValues()).toEqual(["30d"]);
  });

  test("ArrowRight walks every option and comes back round", () => {
    const onChange: MockFunction = renderHarness("1h");
    radio("1h").focus();

    const visited: Array<TrendWindow> = [];

    for (let step: number = 0; step < VALUES.length; step++) {
      press("ArrowRight");

      const checked: Array<string> = checkedValues();
      expect(checked).toHaveLength(1);
      visited.push(checked[0] as TrendWindow);

      // Focus, checked state and the tab stop always agree.
      expect(radio(checked[0] as TrendWindow)).toHaveFocus();
      expect(radio(checked[0] as TrendWindow)).toHaveAttribute("tabindex", "0");
    }

    expect(visited).toEqual(["24h", "7d", "30d", "1h"]);
    expect(onChange.mock.calls).toEqual([["24h"], ["7d"], ["30d"], ["1h"]]);
  });

  test("ArrowLeft walks every option backwards", () => {
    const onChange: MockFunction = renderHarness("1h");
    radio("1h").focus();

    for (let step: number = 0; step < VALUES.length; step++) {
      press("ArrowLeft");
    }

    expect(onChange.mock.calls).toEqual([["30d"], ["7d"], ["24h"], ["1h"]]);
    expect(radio("1h")).toHaveFocus();
  });

  test("mixing keys moves relative to the latest value", () => {
    const onChange: MockFunction = renderHarness("1h");
    radio("1h").focus();

    press("End");
    press("ArrowLeft");
    press("ArrowUp");
    press("ArrowDown");
    press("Home");
    press("ArrowUp");

    expect(onChange.mock.calls).toEqual([
      ["30d"],
      ["7d"],
      ["24h"],
      ["7d"],
      ["1h"],
      ["30d"],
    ]);
    expect(radio("30d")).toHaveFocus();
  });

  describe("unchanged value", () => {
    test("Home on the first option focuses it without reporting a change", () => {
      const { onChange } = renderControl({ value: "1h" });

      expect(fireEvent.keyDown(group(), { key: "Home" })).toBe(false);

      expect(onChange).not.toHaveBeenCalled();
      expect(radio("1h")).toHaveFocus();
    });

    test("End on the last option focuses it without reporting a change", () => {
      const { onChange } = renderControl({ value: "30d" });

      expect(fireEvent.keyDown(group(), { key: "End" })).toBe(false);

      expect(onChange).not.toHaveBeenCalled();
      expect(radio("30d")).toHaveFocus();
    });

    test.each(HANDLED_KEYS)(
      "%s with a single enabled option keeps it without reporting a change",
      (key: string) => {
        const { onChange } = renderControl({
          options: WITH_DISABLED.filter(
            (option: SegmentedControlOption<TrendWindow>): boolean => {
              return option.value !== "1h";
            },
          ),
          value: "7d",
        });
        radio("7d").focus();

        expect(press(key)).toBe(false);

        expect(onChange).not.toHaveBeenCalled();
        expect(radio("7d")).toHaveFocus();
      },
    );

    test("a key pressed while no radio has focus still starts from the checked option", () => {
      const { onChange } = renderControl({ value: "7d" });

      expect(document.activeElement).toBe(document.body);

      fireEvent.keyDown(group(), { key: "ArrowRight" });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("30d");
      expect(radio("30d")).toHaveFocus();
    });

    test("a key pressed on an unchecked radio still moves from the checked one", () => {
      const { onChange } = renderControl({ value: "7d" });
      // Focus can sit on an unchecked radio after a click that was ignored.
      radio("1h").focus();

      press("ArrowLeft");

      expect(onChange).toHaveBeenCalledWith("24h");
      expect(radio("24h")).toHaveFocus();
    });
  });

  describe("controlled value", () => {
    test("repeated keys move from the value the parent holds", () => {
      const { onChange } = renderControl({ value: "24h" });
      radio("24h").focus();

      press("ArrowRight");
      press("ArrowRight");

      // The parent never accepted "7d", so both presses start from "24h".
      expect(onChange.mock.calls).toEqual([["7d"], ["7d"]]);
      expect(checkedValues()).toEqual(["24h"]);
      expect(radio("7d")).toHaveFocus();
    });
  });

  describe("disabled options", () => {
    test("ArrowRight skips a disabled option", () => {
      const onChange: MockFunction = renderHarness("1h", WITH_DISABLED);
      radio("1h").focus();

      press("ArrowRight");

      expect(onChange).toHaveBeenCalledWith("7d");
      expect(radio("7d")).toHaveFocus();
      expect(radio("24h")).not.toHaveFocus();
    });

    test("ArrowRight skips a trailing disabled option when wrapping", () => {
      const onChange: MockFunction = renderHarness("7d", WITH_DISABLED);
      radio("7d").focus();

      press("ArrowDown");

      expect(onChange).toHaveBeenCalledWith("1h");
      expect(radio("1h")).toHaveFocus();
    });

    test("ArrowLeft skips disabled options, including when wrapping", () => {
      const onChange: MockFunction = renderHarness("7d", WITH_DISABLED);
      radio("7d").focus();

      press("ArrowLeft");
      expect(radio("1h")).toHaveFocus();

      press("ArrowUp");
      expect(radio("7d")).toHaveFocus();

      expect(onChange.mock.calls).toEqual([["1h"], ["7d"]]);
    });

    test("Home and End land on the first and last enabled options", () => {
      const onChange: MockFunction = renderHarness("24h", FIRST_DISABLED);
      radio("24h").focus();

      press("End");
      expect(radio("7d")).toHaveFocus();

      press("Home");
      expect(radio("24h")).toHaveFocus();

      expect(onChange.mock.calls).toEqual([["7d"], ["24h"]]);
      expect(radio("1h")).not.toHaveFocus();
      expect(radio("30d")).not.toHaveFocus();
    });

    test("a full ArrowRight cycle never visits a disabled option", () => {
      const onChange: MockFunction = renderHarness("24h", FIRST_DISABLED);
      radio("24h").focus();

      for (let step: number = 0; step < 4; step++) {
        press("ArrowRight");
        expect(document.activeElement).not.toBe(radio("1h"));
        expect(document.activeElement).not.toBe(radio("30d"));
      }

      expect(onChange.mock.calls).toEqual([["7d"], ["24h"], ["7d"], ["24h"]]);
    });

    test("focus lands on the matching button even with disabled ones in between", () => {
      const { onChange } = renderControl({
        options: WITH_DISABLED,
        value: "1h",
      });
      radio("1h").focus();

      press("End");

      // "7d" is the second enabled option but the third button.
      expect(onChange).toHaveBeenCalledWith("7d");
      expect(document.activeElement).toBe(screen.getAllByRole("radio")[2]);
    });

    test("every handled key is ignored when every option is disabled", () => {
      const { onChange } = renderControl({
        options: ALL_DISABLED,
        value: "7d",
      });

      for (const key of HANDLED_KEYS) {
        expect(fireEvent.keyDown(group(), { key: key })).toBe(true);
      }

      expect(onChange).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(document.body);
    });

    test("keys are ignored for an empty group", () => {
      const { onChange } = renderControl({ options: [] });

      for (const key of HANDLED_KEYS) {
        expect(fireEvent.keyDown(group(), { key: key })).toBe(true);
      }

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("nothing checked", () => {
    test.each([
      ["ArrowRight", "24h"],
      ["ArrowDown", "24h"],
      ["ArrowLeft", "30d"],
      ["ArrowUp", "30d"],
      ["Home", "24h"],
      ["End", "30d"],
    ])("%s selects the %s option", (key: string, expected: string) => {
      const { onChange } = renderControl({
        options: WITHOUT_1H,
        value: "1h",
      });

      expect(fireEvent.keyDown(group(), { key: key })).toBe(false);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(expected);
      expect(radio(expected as TrendWindow)).toHaveFocus();
    });

    test.each([
      ["ArrowRight", "24h"],
      ["ArrowLeft", "7d"],
      ["Home", "24h"],
      ["End", "7d"],
    ])(
      "with a disabled checked option, %s selects the %s option",
      (key: string, expected: string) => {
        const { onChange } = renderControl({
          options: FIRST_DISABLED,
          value: "1h",
        });

        press(key);

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(expected);
        expect(radio(expected as TrendWindow)).toHaveFocus();
      },
    );
  });

  describe("default action", () => {
    test.each(HANDLED_KEYS)("%s is prevented", (key: string) => {
      renderControl({ value: "24h" });
      radio("24h").focus();

      const event: KeyboardEvent = new KeyboardEvent("keydown", {
        key: key,
        bubbles: true,
        cancelable: true,
      });
      radio("24h").dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    test.each(UNHANDLED_KEYS)(
      "%s is left alone and changes nothing",
      (key: string) => {
        const { onChange } = renderControl({ value: "24h" });
        radio("24h").focus();

        const event: KeyboardEvent = new KeyboardEvent("keydown", {
          key: key,
          bubbles: true,
          cancelable: true,
        });
        radio("24h").dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
        expect(radio("24h")).toHaveFocus();
        expect(checkedValues()).toEqual(["24h"]);
      },
    );

    test.each(UNHANDLED_KEYS)(
      "%s pressed on the group does not move focus into it",
      (key: string) => {
        const { onChange } = renderControl({ value: "24h" });

        expect(fireEvent.keyDown(group(), { key: key })).toBe(true);

        expect(onChange).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(document.body);
      },
    );
  });

  test("keys pressed outside the group are not handled", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <div>
        <button type="button" data-testid="outside">
          Outside
        </button>
        <ExceptionSegmentedControl
          label={LABEL}
          options={OPTIONS}
          value="24h"
          testId={TEST_ID}
          onChange={onChange as (value: TrendWindow) => void}
        />
      </div>,
    );

    const outside: HTMLElement = screen.getByTestId("outside");
    outside.focus();

    expect(fireEvent.keyDown(outside, { key: "ArrowRight" })).toBe(true);
    expect(fireEvent.keyDown(outside, { key: "End" })).toBe(true);

    expect(onChange).not.toHaveBeenCalled();
    expect(outside).toHaveFocus();
  });

  test("two groups on one page move independently", () => {
    const first: MockFunction = getJestMockFunction();
    const second: MockFunction = getJestMockFunction();

    render(
      <div>
        <ExceptionSegmentedControl
          label="First"
          options={OPTIONS}
          value="1h"
          testId="first"
          onChange={first as (value: TrendWindow) => void}
        />
        <ExceptionSegmentedControl
          label="Second"
          options={OPTIONS}
          value="1h"
          testId="second"
          onChange={second as (value: TrendWindow) => void}
        />
      </div>,
    );

    const secondFirstOption: HTMLElement = screen.getByTestId("second-1h");
    secondFirstOption.focus();
    fireEvent.keyDown(secondFirstOption, { key: "End" });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("30d");
    expect(screen.getByTestId("second-30d")).toHaveFocus();
    expect(screen.getByTestId("first-30d")).not.toHaveFocus();
  });
});
