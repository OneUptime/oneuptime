import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import EntityDropdown, {
  EntityDropdownProps,
} from "../../../UI/Components/EntityDropdown/EntityDropdown";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

/*
 * EntityDropdown's menu closes when keyboard focus leaves the dropdown.
 *
 * It used to close only on a press outside or on Escape. A keyboard user who
 * tabbed out of it - from the input, or on past the last option - left the
 * menu open over the next field, and when that field opened a popup of its
 * own (the Affected Resources picker below an alert's Monitor dropdown), the
 * two sat on top of each other.
 *
 * What must NOT close it: focus moving inside the dropdown (the input, the
 * chips, the menu's tabs, options and buttons - the menu is a DOM child of the
 * dropdown), and focus going nowhere in particular (the window losing focus,
 * a blur with no relatedTarget), which is what a press on something that
 * takes no focus looks like too.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

type UserEventController = ReturnType<typeof userEvent.setup>;

interface GetListRequest {
  modelType?: unknown;
  query?: { labels?: unknown } | undefined;
}

const TEAM_OPTIONS: Array<DropdownOption> = [
  { value: "members", label: "Members" },
  { value: "admins", label: "Admins" },
];

const LABEL_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LABEL_NAME: string = "Production";
const MONITOR_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MONITOR_NAME: string = "Checkout API";

const getCombobox: () => HTMLInputElement = (): HTMLInputElement => {
  return screen.getByRole("combobox", { name: "Team" }) as HTMLInputElement;
};

const queryMenu: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId("entity-dropdown-menu");
};

const getPreviousField: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("textbox", { name: "Previous field" });
};

const getNextField: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("textbox", { name: "Next field" });
};

// A form with a field on either side of the dropdown.
const renderBetweenFields: (props?: Partial<EntityDropdownProps>) => void = (
  props?: Partial<EntityDropdownProps>,
): void => {
  render(
    <div>
      <input aria-label="Previous field" />
      <EntityDropdown ariaLabel="Team" options={TEAM_OPTIONS} {...props} />
      <input aria-label="Next field" />
    </div>,
  );
};

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: GetListRequest = (args[0] || {}) as GetListRequest;

    if (request.modelType === Label) {
      return Promise.resolve({
        data: [{ _id: LABEL_ID, name: LABEL_NAME }],
        count: 1,
      });
    }

    // The Labels tab's expansion is the only monitor list that asks by label.
    if (request.query?.labels) {
      return Promise.resolve({
        data: [{ _id: MONITOR_ID, name: MONITOR_NAME }],
        count: 1,
      });
    }

    // The plain option search behind the Results tab.
    return Promise.resolve({ data: [], count: 0 });
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("EntityDropdown closes its menu when keyboard focus leaves it", () => {
  test("Tab from the input walks the options with the menu open, and past the last one closes it", async () => {
    const user: UserEventController = userEvent.setup();
    const onBlur: MockFunction = getJestMockFunction();
    renderBetweenFields({ onBlur });

    await user.click(getCombobox());
    expect(queryMenu()).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("option", { name: "Members" })).toHaveFocus();
    expect(queryMenu()).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("option", { name: "Admins" })).toHaveFocus();
    expect(queryMenu()).toBeInTheDocument();

    await user.tab();
    expect(getNextField()).toHaveFocus();
    expect(queryMenu()).toBeNull();
    expect(getCombobox()).toHaveAttribute("aria-expanded", "false");
    // The form still hears the blur it marks the field touched on.
    expect(onBlur).toHaveBeenCalled();
  });

  test("Shift+Tab from the input onto the previous field closes it", async () => {
    const user: UserEventController = userEvent.setup();
    renderBetweenFields();

    await user.click(getCombobox());
    expect(queryMenu()).toBeInTheDocument();

    await user.tab({ shift: true });

    expect(getPreviousField()).toHaveFocus();
    expect(queryMenu()).toBeNull();
  });

  test("focus moved straight onto another field closes it", async () => {
    const user: UserEventController = userEvent.setup();
    renderBetweenFields();

    await user.click(getCombobox());
    expect(queryMenu()).toBeInTheDocument();

    act(() => {
      getNextField().focus();
    });

    expect(queryMenu()).toBeNull();
  });

  test("focus going nowhere in particular leaves it open", async () => {
    const user: UserEventController = userEvent.setup();
    renderBetweenFields();

    await user.click(getCombobox());
    expect(queryMenu()).toBeInTheDocument();

    // The window losing focus: a blur with no element to go to.
    fireEvent.blur(getCombobox());
    fireEvent.blur(getCombobox(), { relatedTarget: null });
    expect(queryMenu()).toBeInTheDocument();

    /*
     * Focus dropped to the page itself. A browser reports no relatedTarget
     * for that; jsdom reports the document.
     */
    act(() => {
      getCombobox().blur();
    });
    expect(document.activeElement).toBe(document.body);
    expect(queryMenu()).toBeInTheDocument();
  });

  test("a mouse pick still lands, and closes a single-select menu", async () => {
    const user: UserEventController = userEvent.setup();
    const onChange: MockFunction = getJestMockFunction();
    renderBetweenFields({ onChange });

    await user.click(getCombobox());
    await user.click(screen.getByRole("option", { name: "Admins" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("admins");
    expect(queryMenu()).toBeNull();
  });

  test("Enter on an option reached with Tab still picks it", async () => {
    const user: UserEventController = userEvent.setup();
    const onChange: MockFunction = getJestMockFunction();
    renderBetweenFields({ onChange });

    await user.click(getCombobox());
    await user.tab();
    await user.tab();
    expect(screen.getByRole("option", { name: "Admins" })).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("admins");
    expect(queryMenu()).toBeNull();
  });

  test("Escape in the input still closes it, and is claimed", async () => {
    const user: UserEventController = userEvent.setup();
    renderBetweenFields();

    await user.click(getCombobox());

    expect(fireEvent.keyDown(getCombobox(), { key: "Escape" })).toBe(false);
    expect(queryMenu()).toBeNull();
  });

  test("a disabled dropdown opens no menu to close", async () => {
    const user: UserEventController = userEvent.setup();
    renderBetweenFields({ disabled: true });

    await user.tab();
    expect(getPreviousField()).toHaveFocus();
    await user.tab();

    expect(getNextField()).toHaveFocus();
    expect(queryMenu()).toBeNull();
  });
});

describe("a single-select dropdown showing its value", () => {
  test("pressing the value opens the menu with focus in the search input, so tabbing out closes it", async () => {
    const user: UserEventController = userEvent.setup();
    const onChange: MockFunction = getJestMockFunction();
    renderBetweenFields({ value: "members", onChange });

    // Previous field, then the value.
    await user.tab();
    await user.tab();
    const valueButton: HTMLElement = screen.getByRole("button", {
      name: /Members/,
    });
    expect(valueButton).toHaveFocus();
    expect(queryMenu()).toBeNull();

    await user.keyboard("{Enter}");

    /*
     * The button gives way to the search input as the menu opens. Focus used
     * to go down with the button, so typing searched nothing and focus could
     * never leave the dropdown to close the menu.
     */
    expect(queryMenu()).toBeInTheDocument();
    expect(getCombobox()).toHaveFocus();

    await user.keyboard("adm");
    expect(getCombobox()).toHaveValue("adm");
    expect(screen.queryByRole("option", { name: "Members" })).toBeNull();
    expect(screen.getByRole("option", { name: "Admins" })).toBeInTheDocument();

    // The input, its Clear button, then the one matching option.
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Clear selection" }),
    ).toHaveFocus();
    expect(queryMenu()).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("option", { name: "Admins" })).toHaveFocus();
    expect(queryMenu()).toBeInTheDocument();

    await user.tab();
    expect(getNextField()).toHaveFocus();
    expect(queryMenu()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a mouse press on the value opens the menu ready to type", async () => {
    const user: UserEventController = userEvent.setup();
    renderBetweenFields({ value: "members" });

    await user.click(screen.getByRole("button", { name: /Members/ }));

    expect(queryMenu()).toBeInTheDocument();
    expect(getCombobox()).toHaveFocus();

    await user.keyboard("adm");
    expect(getCombobox()).toHaveValue("adm");
  });
});

describe("a multi-select dropdown", () => {
  test("its chips, input and options are all inside: Tab among them keeps the menu open, a pick keeps it open too", async () => {
    const user: UserEventController = userEvent.setup();
    const onChange: MockFunction = getJestMockFunction();
    renderBetweenFields({
      isMultiSelect: true,
      value: ["members"],
      onChange,
    });

    await user.click(getCombobox());
    expect(queryMenu()).toBeInTheDocument();

    // Back onto the selected chip's remove button.
    await user.tab({ shift: true });
    expect(
      screen.getByRole("button", { name: "Remove Members" }),
    ).toHaveFocus();
    expect(queryMenu()).toBeInTheDocument();

    await user.tab();
    expect(getCombobox()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("option", { name: "Admins" })).toHaveFocus();
    expect(queryMenu()).toBeInTheDocument();

    // A keyboard pick hands focus back to the input and leaves the menu open.
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(["members", "admins"]);
    expect(getCombobox()).toHaveFocus();
    expect(queryMenu()).toBeInTheDocument();

    // Nothing left to offer, so the next stop is the next field.
    await user.tab();
    expect(getNextField()).toHaveFocus();
    expect(queryMenu()).toBeNull();
  });

  test("the Labels tab, its rows and its Add button reached with Tab keep the menu open, and Add still applies", async () => {
    const user: UserEventController = userEvent.setup();
    const onChange: MockFunction = getJestMockFunction();
    const onLabelsBulkAdded: MockFunction = getJestMockFunction();
    renderBetweenFields({
      isMultiSelect: true,
      modelType: Monitor,
      labelField: "name",
      valueField: "_id",
      enableLabelsTab: true,
      options: [],
      onChange,
      onLabelsBulkAdded,
    });

    await user.click(getCombobox());
    await screen.findByText("No options.");

    await user.tab();
    expect(screen.getByRole("tab", { name: /Results/ })).toHaveFocus();
    await user.tab();
    const labelsTab: HTMLElement = screen.getByRole("tab", { name: /Labels/ });
    expect(labelsTab).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(labelsTab).toHaveAttribute("aria-selected", "true");
    await screen.findByRole("option", { name: LABEL_NAME });

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Expand entries" }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("option", { name: LABEL_NAME })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("option", { name: LABEL_NAME })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(queryMenu()).toBeInTheDocument();

    // The footer: Clear, then Add.
    await user.tab();
    expect(screen.getByRole("button", { name: "Clear" })).toHaveFocus();
    await user.tab();
    const addButton: HTMLElement = screen.getByRole("button", {
      name: "Add entries from 1 label",
    });
    expect(addButton).toHaveFocus();
    expect(queryMenu()).toBeInTheDocument();

    await user.keyboard("{Enter}");

    await screen.findByRole("button", { name: `Remove ${MONITOR_NAME}` });
    expect(onChange).toHaveBeenCalledWith([MONITOR_ID]);
    expect(onLabelsBulkAdded).toHaveBeenCalledWith([
      { id: LABEL_ID, name: LABEL_NAME },
    ]);
    // Applying closes the menu, as it always has.
    expect(queryMenu()).toBeNull();
  });
});
