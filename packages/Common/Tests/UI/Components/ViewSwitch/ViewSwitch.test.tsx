import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import ViewSwitch, {
  VIEW_SWITCH_ACTIVE_CLASS_NAME,
  VIEW_SWITCH_CLASS_NAME,
  VIEW_SWITCH_FILL_CLASS_NAME,
  VIEW_SWITCH_FILL_OPTION_CLASS_NAME,
  ViewSwitchOption,
} from "../../../../UI/Components/ViewSwitch/ViewSwitch";
import RememberedView, {
  useRememberedView,
} from "../../../../UI/Components/ViewSwitch/RememberedView";
import IconProp from "../../../../Types/Icon/IconProp";

/*
 * The List | Calendar switch of the scheduled maintenance events, and the
 * choice it remembers: a group of buttons a screen reader names, the chosen
 * one pressed; the choice kept in the browser, read back on the next visit,
 * shared by every copy of the switch on the page, and kept for the session
 * when the browser will not store it.
 */

type View = "list" | "calendar";

/*
 * Storage's string index signature makes @jest/globals type a spy on
 * Storage.prototype as never; spy through its two methods instead.
 */
interface StorageMethods {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const STORAGE_METHODS: StorageMethods =
  Storage.prototype as unknown as StorageMethods;

const OPTIONS: ReadonlyArray<ViewSwitchOption<View>> = [
  { value: "list", label: "List", icon: IconProp.List },
  { value: "calendar", label: "Calendar", icon: IconProp.Calendar },
];

const STORAGE_KEY: string = "oneuptime.test-remembered-view";

function remembered(): RememberedView<View> {
  return new RememberedView<View>({
    storageKey: STORAGE_KEY,
    values: ["list", "calendar"],
    defaultValue: "list",
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("ViewSwitch on a phone", () => {
  /*
   * The role picker's Whole project | One area heads a dialog: on a phone it
   * fills the row, each option an equal share, as a phone's own segmented
   * controls do; from sm up it hugs its options again. A switch in a
   * toolbar keeps its own width everywhere.
   */
  test("can fill the row on a phone, its options sharing it equally", () => {
    render(
      <ViewSwitch
        options={OPTIONS}
        value="list"
        onChange={(): void => {}}
        ariaLabel="Show the events as"
        dataTestId="switch"
        fillWidthOnPhone={true}
      />,
    );

    const group: HTMLElement = screen.getByTestId("switch");

    expect(group.className).toBe(VIEW_SWITCH_FILL_CLASS_NAME);
    expect(VIEW_SWITCH_FILL_CLASS_NAME).toContain("w-full");
    expect(VIEW_SWITCH_FILL_CLASS_NAME).toContain("sm:w-auto");
    expect(VIEW_SWITCH_FILL_CLASS_NAME).toContain("sm:inline-flex");

    for (const option of ["list", "calendar"]) {
      expect(screen.getByTestId(`switch-${option}`).className).toContain(
        VIEW_SWITCH_FILL_OPTION_CLASS_NAME,
      );
    }
    expect(VIEW_SWITCH_FILL_OPTION_CLASS_NAME).toBe(
      "flex-1 justify-center sm:flex-none",
    );
  });

  test("keeps its own width when not asked to fill the row", () => {
    render(
      <ViewSwitch
        options={OPTIONS}
        value="list"
        onChange={(): void => {}}
        ariaLabel="Show the events as"
        dataTestId="switch"
      />,
    );

    expect(screen.getByTestId("switch").className).toBe(VIEW_SWITCH_CLASS_NAME);
    expect(screen.getByTestId("switch-list").className).not.toContain("flex-1");
  });

  test("filling the row, it looks the same: the same track and the same raised option", () => {
    // Only the width changes: the track colour and padding stay.
    expect(VIEW_SWITCH_FILL_CLASS_NAME).toContain(
      "rounded-lg bg-gray-100 p-0.5",
    );
    expect(VIEW_SWITCH_CLASS_NAME).toContain("rounded-lg bg-gray-100 p-0.5");
  });
});

describe("ViewSwitch", () => {
  test("is a named group of buttons, the chosen one pressed and raised", () => {
    render(
      <ViewSwitch
        options={OPTIONS}
        value="calendar"
        onChange={() => {}}
        ariaLabel="Show the events as"
        dataTestId="switch"
      />,
    );

    const group: HTMLElement = screen.getByRole("group", {
      name: "Show the events as",
    });

    expect(group).toHaveAttribute("data-testid", "switch");
    expect(screen.getByTestId("switch-calendar")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("switch-list")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("switch-calendar").className).toContain(
      VIEW_SWITCH_ACTIVE_CLASS_NAME,
    );
    expect(screen.getByTestId("switch-list")).toHaveTextContent("List");
  });

  test("pressing another view asks for it; pressing the chosen one does nothing", () => {
    const onChange: Mock<(value: View) => void> =
      jest.fn<(value: View) => void>();

    render(
      <ViewSwitch
        options={OPTIONS}
        value="list"
        onChange={onChange}
        ariaLabel="Show the events as"
        dataTestId="switch"
      />,
    );

    fireEvent.click(screen.getByTestId("switch-list"));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("switch-calendar"));
    expect(onChange).toHaveBeenCalledWith("calendar");
  });

  /*
   * The role picker's Whole project | One area while its search lists roles
   * from both: neither answer is on screen, so neither is pressed, and
   * pressing either one - the one shown before the search too - asks for it.
   */
  test("with no view on screen, none is pressed, and pressing any asks for it", () => {
    const onChange: Mock<(value: View) => void> =
      jest.fn<(value: View) => void>();

    render(
      <ViewSwitch
        options={OPTIONS}
        value={null}
        onChange={onChange}
        ariaLabel="Show the events as"
        dataTestId="switch"
      />,
    );

    for (const option of ["list", "calendar"]) {
      const button: HTMLElement = screen.getByTestId(`switch-${option}`);

      expect(button).toHaveAttribute("aria-pressed", "false");
      expect(button.className).not.toContain(VIEW_SWITCH_ACTIVE_CLASS_NAME);
    }

    fireEvent.click(screen.getByTestId("switch-list"));
    expect(onChange).toHaveBeenLastCalledWith("list");

    fireEvent.click(screen.getByTestId("switch-calendar"));
    expect(onChange).toHaveBeenLastCalledWith("calendar");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  test("options without an icon are words alone: Month | Week | Day in a calendar's toolbar", () => {
    type Range = "month" | "week" | "day";

    const ranges: ReadonlyArray<ViewSwitchOption<Range>> = [
      { value: "month", label: "Month" },
      { value: "week", label: "Week" },
      { value: "day", label: "Day" },
    ];

    render(
      <ViewSwitch<Range>
        options={ranges}
        value="week"
        onChange={() => {}}
        ariaLabel="Calendar range"
        dataTestId="range"
      />,
    );

    const group: HTMLElement = screen.getByRole("group", {
      name: "Calendar range",
    });

    expect(group.querySelectorAll("svg")).toHaveLength(0);
    expect(screen.getByTestId("range-week")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("range-week").className).toContain(
      VIEW_SWITCH_ACTIVE_CLASS_NAME,
    );
    expect(screen.getByTestId("range-day")).toHaveTextContent("Day");

    // The icons of the options that have one are still drawn.
    cleanup();
    render(
      <ViewSwitch
        options={OPTIONS}
        value="list"
        onChange={() => {}}
        ariaLabel="Show the events as"
        dataTestId="switch"
      />,
    );

    expect(
      screen.getByTestId("switch-list").querySelectorAll("svg"),
    ).toHaveLength(1);
  });
});

describe("RememberedView", () => {
  test("opens on the default before anything was chosen", () => {
    expect(remembered().read()).toBe("list");
  });

  test("a choice is read back by the next page that asks", () => {
    remembered().write("calendar");

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("calendar");
    expect(remembered().read()).toBe("calendar");
  });

  test("a stored value that is not one of the views reads as the default", () => {
    window.localStorage.setItem(STORAGE_KEY, "timeline");

    expect(remembered().read()).toBe("list");
  });

  test("a browser that will not store it keeps the choice for the session", () => {
    const view: RememberedView<View> = remembered();

    jest.spyOn(STORAGE_METHODS, "setItem").mockImplementation((): never => {
      throw new Error("QuotaExceededError");
    });
    jest.spyOn(STORAGE_METHODS, "getItem").mockImplementation((): never => {
      throw new Error("SecurityError");
    });

    expect(() => {
      view.write("calendar");
    }).not.toThrow();
    expect(view.read()).toBe("calendar");

    view.resetForTesting();

    expect(view.read()).toBe("list");
  });
});

describe("useRememberedView", () => {
  const view: RememberedView<View> = remembered();

  function Switch(props: { testId: string }): ReactElement {
    const [value, setValue] = useRememberedView(view);

    return (
      <ViewSwitch
        options={OPTIONS}
        value={value}
        onChange={setValue}
        ariaLabel="Show the events as"
        dataTestId={props.testId}
      />
    );
  }

  test("every copy of the switch on the page follows a choice made in one", () => {
    render(
      <>
        <Switch testId="first" />
        <Switch testId="second" />
      </>,
    );

    expect(screen.getByTestId("second-list")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    act(() => {
      fireEvent.click(screen.getByTestId("first-calendar"));
    });

    expect(screen.getByTestId("first-calendar")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("second-calendar")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("calendar");
  });

  test("a page opened later opens on the remembered view", () => {
    window.localStorage.setItem(STORAGE_KEY, "calendar");

    render(<Switch testId="later" />);

    expect(screen.getByTestId("later-calendar")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
