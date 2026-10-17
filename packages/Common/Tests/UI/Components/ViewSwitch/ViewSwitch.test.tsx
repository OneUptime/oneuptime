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
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import ViewSwitch, {
  VIEW_SWITCH_ACTIVE_CLASS_NAME,
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
    const onChange: jest.Mock<(value: View) => void> = jest.fn();

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

    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
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
