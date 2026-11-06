import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import EntityDropdown, {
  EntityDropdownProps,
} from "../../../UI/Components/EntityDropdown/EntityDropdown";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import {
  describeNestedControls,
  findNestedControls,
} from "../../Helpers/NestedControls";
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
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

/*
 * A REQUIRED SINGLE PICK HAS NO CLEAR.
 *
 * "EntityDropdown still offers Clear on a required single pick, as
 * FormField's plain Dropdown did before #5482." A picked record that must be
 * picked - a new incident's severity, a status page resource's monitor, a
 * network device monitor's device - showed a Clear button beside its value,
 * and Backspace or Delete on the value cleared it too. Either only emptied
 * the field, and the form then said it was required.
 *
 * isClearable={false} takes both away: the value opens the list, and
 * another pick takes its place. FormField passes isClearable={!required}, as
 * it does to the plain Dropdown (FormFieldDropdownClearable.test.tsx). A
 * multi-select is not affected - each chip keeps its own Remove - and a
 * dropdown that says nothing stays clearable, as before.
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

const SEVERITY_OPTIONS: Array<DropdownOption> = [
  { value: "sev-1", label: "SEV-1" },
  { value: "sev-2", label: "SEV-2" },
];

interface Harness {
  onChange: MockFunction;
  view: RenderResult;
}

// The dropdown between two fields, named by a label element as FormField names it.
const renderDropdown: (props?: Partial<EntityDropdownProps>) => Harness = (
  props?: Partial<EntityDropdownProps>,
): Harness => {
  const onChange: MockFunction = getJestMockFunction();

  const view: RenderResult = render(
    <div>
      <input aria-label="Previous field" />
      <span id="severity-label">Incident Severity</span>
      <EntityDropdown
        ariaLabelledby="severity-label"
        options={SEVERITY_OPTIONS}
        value="sev-1"
        onChange={(value: unknown, change: unknown): void => {
          onChange(value, change);
        }}
        {...props}
      />
      <input aria-label="Next field" />
    </div>,
  );

  return { onChange, view };
};

const getValueButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: "Incident Severity" });
};

const queryClearButtons: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.queryAllByRole("button", { name: "Clear selection" });
};

const classesOf: (element: Element) => Array<string> = (
  element: Element,
): Array<string> => {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
};

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0 });
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a required single pick (isClearable={false})", () => {
  test("shows what is picked, and no Clear: neither the button nor the place kept for it", () => {
    renderDropdown({ isClearable: false });

    expect(getValueButton()).toHaveAccessibleDescription("SEV-1");
    expect(queryClearButtons()).toEqual([]);
    expect(screen.queryByTestId("entity-dropdown-clear")).toBeNull();
    // The value runs on to the chevron: no empty place where Clear was laid.
    expect(screen.queryByTestId("entity-dropdown-clear-place")).toBeNull();
  });

  test("its box is the box of any pick: the border, the fill and the hover", () => {
    renderDropdown({ isClearable: false });

    const box: HTMLElement = screen.getByTestId("entity-dropdown-value");

    expect(classesOf(box)).toEqual(
      expect.arrayContaining([
        "relative",
        "rounded-lg",
        "border",
        "bg-white",
        "shadow-sm",
        "border-gray-300",
        "hover:border-indigo-300",
      ]),
    );
    expect(describeNestedControls(findNestedControls(box))).toEqual([]);
    expect(within(box).getAllByRole("button")).toEqual([getValueButton()]);
  });

  test.each(["Backspace", "Delete"])(
    "%s on the value leaves it picked, and is not claimed",
    (key: string) => {
      const harness: Harness = renderDropdown({ isClearable: false });

      // Not prevented: the key is the page's, as on any button.
      expect(fireEvent.keyDown(getValueButton(), { key: key })).toBe(true);
      expect(harness.onChange).not.toHaveBeenCalled();
      expect(getValueButton()).toHaveAccessibleDescription("SEV-1");
    },
  );

  test("Tab goes from the value straight on to the next field", async () => {
    const user: UserEventController = userEvent.setup();
    renderDropdown({ isClearable: false });

    await user.tab();
    await user.tab();
    expect(getValueButton()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Next field" })).toHaveFocus();
  });

  test("opened, its search box offers no Clear either, and another pick takes its place", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: Harness = renderDropdown({ isClearable: false });

    await user.click(getValueButton());

    expect(screen.getByTestId("entity-dropdown-menu")).toBeInTheDocument();
    expect(queryClearButtons()).toEqual([]);

    await user.click(screen.getByRole("option", { name: "SEV-2" }));

    expect(harness.onChange).toHaveBeenCalledTimes(1);
    expect(harness.onChange).toHaveBeenCalledWith("sev-2", {
      selectedOptions: [{ value: "sev-2", label: "SEV-2" }],
      previousOptions: [{ value: "sev-1", label: "SEV-1" }],
    });
  });

  test("with nothing picked yet it is the search box, with no Clear to offer", () => {
    renderDropdown({ isClearable: false, value: undefined });

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(queryClearButtons()).toEqual([]);
  });

  test("locked as well, it shows its value and offers nothing", () => {
    const harness: Harness = renderDropdown({
      isClearable: false,
      disabled: true,
    });

    expect(getValueButton()).toBeDisabled();
    expect(queryClearButtons()).toEqual([]);

    fireEvent.keyDown(getValueButton(), { key: "Delete" });

    expect(harness.onChange).not.toHaveBeenCalled();
  });
});

describe("an optional single pick keeps its Clear", () => {
  test.each([
    ["isClearable unset", undefined],
    ["isClearable={true}", true],
  ])(
    "%s: the Clear button, and its place",
    (_label: string, isClearable: boolean | undefined) => {
      renderDropdown(isClearable === undefined ? {} : { isClearable });

      expect(queryClearButtons()).toHaveLength(1);
      expect(
        screen.getByTestId("entity-dropdown-clear-place"),
      ).toBeInTheDocument();
    },
  );

  test("Delete on the value still clears it, and hands null", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: Harness = renderDropdown();

    act(() => {
      getValueButton().focus();
    });
    await user.keyboard("{Delete}");

    expect(harness.onChange).toHaveBeenCalledWith(null, {
      selectedOptions: [],
      previousOptions: [{ value: "sev-1", label: "SEV-1" }],
    });
  });

  test("opened with a value, its search box offers Clear", async () => {
    const user: UserEventController = userEvent.setup();
    renderDropdown();

    await user.click(getValueButton());

    expect(queryClearButtons()).toHaveLength(1);
  });
});

describe("a multi-select is not affected", () => {
  test("required or not, each chip keeps its own Remove", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: Harness = renderDropdown({
      isMultiSelect: true,
      isClearable: false,
      value: ["sev-1", "sev-2"],
    });

    expect(
      screen.getByRole("button", { name: "Remove SEV-1" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove SEV-2" }));

    expect(harness.onChange).toHaveBeenCalledWith(["sev-1"], {
      selectedOptions: [{ value: "sev-1", label: "SEV-1" }],
      previousOptions: [
        { value: "sev-1", label: "SEV-1" },
        { value: "sev-2", label: "SEV-2" },
      ],
    });
  });
});
