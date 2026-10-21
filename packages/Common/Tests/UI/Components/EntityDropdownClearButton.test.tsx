import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../../Types/JSON";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import EntityDropdown, {
  EntityDropdownProps,
} from "../../../UI/Components/EntityDropdown/EntityDropdown";
import FormField from "../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import {
  describeNestedControls,
  findNestedControls,
} from "../../Helpers/NestedControls";
import {
  afterAll,
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
 * A closed single-select shows its value as a button, with a Clear button
 * next to it. The Clear button used to be drawn inside the value button:
 *
 *   - a button inside a button is invalid HTML, and React said so on every
 *     render ("validateDOMNesting: <button> cannot appear as a descendant of
 *     <button>") - since the Invite User dialog preselects the members team,
 *     on every invite;
 *   - a screen reader reads a button's content as part of that button, so
 *     the Clear button was not there for it at all.
 *
 * Now they are two buttons side by side in one box that looks as before, and
 * the keyboard gets Backspace and Delete on the value too. These tests hold
 * the shape (nothing nested, in any state), the look (the box draws the
 * border and the hover, the value keeps the Clear button's place) and what a
 * clear does (it hands null, and focus lands in the search input with the
 * menu closed, instead of dropping to the page).
 */

const getListMock: MockFunction = getJestMockFunction();

/*
 * Every console.error of this file, from its first render on. React reports a
 * nesting once per kind for the life of the module, so a check that only
 * listened during its own render would miss one an earlier test triggered.
 */
const consoleErrors: Array<string> = [];
// eslint-disable-next-line no-console
const originalConsoleError: typeof console.error = console.error;
// eslint-disable-next-line no-console
console.error = (...args: Array<unknown>): void => {
  consoleErrors.push(args.map(String).join(" "));
  originalConsoleError(...args);
};

afterAll(() => {
  // eslint-disable-next-line no-console
  console.error = originalConsoleError;
});

const nestingWarnings: () => Array<string> = (): Array<string> => {
  return consoleErrors.filter((message: string): boolean => {
    return (
      message.includes("validateDOMNesting") ||
      message.includes("cannot appear as a descendant of")
    );
  });
};

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

const TEAM_OPTIONS: Array<DropdownOption> = [
  { value: "members", label: "Members" },
  { value: "admins", label: "Admins" },
];

const LABEL_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

interface Harness {
  onChange: MockFunction;
  view: RenderResult;
}

/*
 * The dropdown between two fields, named by a label element as FormField
 * names it.
 */
const renderDropdown: (props?: Partial<EntityDropdownProps>) => Harness = (
  props?: Partial<EntityDropdownProps>,
): Harness => {
  const onChange: MockFunction = getJestMockFunction();

  const view: RenderResult = render(
    <div>
      <input aria-label="Previous field" />
      <span id="team-label">Team</span>
      <EntityDropdown
        ariaLabelledby="team-label"
        options={TEAM_OPTIONS}
        value="members"
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
  return screen.getByRole("button", { name: "Team" });
};

const getClearButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: "Clear selection" });
};

const getCombobox: () => HTMLInputElement = (): HTMLInputElement => {
  return screen.getByRole("combobox", { name: "Team" }) as HTMLInputElement;
};

const queryMenu: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId("entity-dropdown-menu");
};

// The classes of an element, as a set, to read a look decision from.
const classesOf: (element: Element) => Array<string> = (
  element: Element,
): Array<string> => {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
};

const expectNothingNested: (root: Element) => void = (root: Element): void => {
  expect(describeNestedControls(findNestedControls(root))).toEqual([]);
};

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType?: unknown } = (args[0] || {}) as {
      modelType?: unknown;
    };

    if (request.modelType === Label) {
      return Promise.resolve({
        data: [{ _id: LABEL_ID, name: "Production" }],
        count: 1,
      });
    }

    return Promise.resolve({ data: [], count: 0 });
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a closed single-select's value and its Clear button", () => {
  test("are two buttons side by side in one box, the value first", () => {
    renderDropdown();

    const valueButton: HTMLElement = getValueButton();
    const clearButton: HTMLElement = getClearButton();
    const box: HTMLElement = screen.getByTestId("entity-dropdown-value");

    expect(valueButton.contains(clearButton)).toBe(false);
    expect(clearButton.contains(valueButton)).toBe(false);
    expect(valueButton.parentElement).toBe(box);
    expect(clearButton.parentElement).toBe(box);
    // The value first: Tab reaches it, then Clear.
    expect(
      valueButton.compareDocumentPosition(clearButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expectNothingNested(box);
  });

  test("render without React's nesting warning", () => {
    renderDropdown();

    expect(getValueButton()).toBeInTheDocument();
    expect(nestingWarnings()).toEqual([]);
  });

  /*
   * The look of the one button it used to be: the box draws the border, the
   * fill and the hover, so pointing at the Clear button lights the border as
   * pointing at the value does; the value button lies over the box's border
   * (its -1px margin and clear border), so its text and focus outline sit
   * where they did; and it keeps an empty place, the Clear button's size,
   * where the Clear button is laid.
   */
  test("look as the one button did: the box draws the border and the hover", () => {
    renderDropdown();

    const box: HTMLElement = screen.getByTestId("entity-dropdown-value");
    const valueButton: HTMLElement = getValueButton();
    const clearButton: HTMLElement = getClearButton();

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
    expect(classesOf(valueButton)).toEqual(
      expect.arrayContaining([
        "-m-px",
        "w-[calc(100%+2px)]",
        "border",
        "border-transparent",
        "rounded-lg",
        "px-3",
        "py-2",
      ]),
    );
    // The hover belongs to the box alone, around both buttons.
    expect(classesOf(valueButton)).not.toContain("hover:border-indigo-300");
    expect(classesOf(valueButton)).not.toContain("border-gray-300");

    const place: HTMLElement = screen.getByTestId(
      "entity-dropdown-clear-place",
    );
    expect(valueButton.contains(place)).toBe(true);
    expect(place).toHaveAttribute("aria-hidden", "true");
    expect(classesOf(place)).toEqual(
      expect.arrayContaining(["box-content", "h-3.5", "w-3.5", "p-0.5"]),
    );
    // Laid over that place: the value button's px-3, chevron w-4 and gap-1.
    expect(classesOf(clearButton)).toEqual(
      expect.arrayContaining([
        "absolute",
        "right-8",
        "top-1/2",
        "-translate-y-1/2",
        "p-0.5",
        "text-gray-400",
        "hover:bg-gray-100",
        "hover:text-red-500",
      ]),
    );
  });

  test("an error turns the box's border red, and nothing else draws one", () => {
    renderDropdown({ error: "Team is required" });

    const box: HTMLElement = screen.getByTestId("entity-dropdown-value");

    expect(classesOf(box)).toContain("border-red-400");
    expect(classesOf(box)).not.toContain("hover:border-indigo-300");
    expect(classesOf(getValueButton())).toContain("border-transparent");
  });

  test("named by the field's label, the value button describes what is picked", () => {
    renderDropdown();

    expect(getValueButton()).toHaveAccessibleName("Team");
    expect(getValueButton()).toHaveAccessibleDescription("Members");
    expect(getClearButton()).toHaveAccessibleName("Clear selection");
  });

  test("with no label element, the value names the button, without Clear in it", () => {
    renderDropdown({ ariaLabelledby: undefined, ariaLabel: "Team" });

    const valueButton: HTMLElement = screen.getByRole("button", {
      name: "Members",
    });

    expect(valueButton).toHaveAccessibleName("Members");
    expect(valueButton).not.toHaveAttribute("aria-describedby");
    expect(within(valueButton).queryByRole("button")).toBeNull();
  });

  test("the Clear button hands null, and focus lands in the search input with the menu closed", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: Harness = renderDropdown();

    await user.click(getClearButton());

    expect(harness.onChange).toHaveBeenCalledTimes(1);
    expect(harness.onChange).toHaveBeenCalledWith(null, {
      selectedOptions: [],
      previousOptions: [{ value: "members", label: "Members" }],
    });
    expect(screen.queryByTestId("entity-dropdown-value")).toBeNull();
    expect(getCombobox()).toHaveFocus();
    expect(getCombobox()).toHaveAttribute("aria-expanded", "false");
    expect(queryMenu()).toBeNull();
  });

  test("Tab reaches the value, then Clear, then the next field", async () => {
    const user: UserEventController = userEvent.setup();
    renderDropdown();

    await user.tab();
    expect(
      screen.getByRole("textbox", { name: "Previous field" }),
    ).toHaveFocus();
    await user.tab();
    expect(getValueButton()).toHaveFocus();
    await user.tab();
    expect(getClearButton()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Next field" })).toHaveFocus();
    expect(queryMenu()).toBeNull();
  });

  test.each(["{Enter}", " "])(
    "%p on the Clear button clears, and focus stays in the field",
    async (key: string) => {
      const user: UserEventController = userEvent.setup();
      const harness: Harness = renderDropdown();

      act(() => {
        getClearButton().focus();
      });
      await user.keyboard(key);

      expect(harness.onChange).toHaveBeenCalledWith(null, {
        selectedOptions: [],
        previousOptions: [{ value: "members", label: "Members" }],
      });
      expect(getCombobox()).toHaveFocus();
      expect(queryMenu()).toBeNull();
    },
  );

  test.each(["{Backspace}", "{Delete}"])(
    "%p on the value clears it, as in a text field",
    async (key: string) => {
      const user: UserEventController = userEvent.setup();
      const harness: Harness = renderDropdown();

      act(() => {
        getValueButton().focus();
      });
      await user.keyboard(key);

      expect(harness.onChange).toHaveBeenCalledTimes(1);
      expect(harness.onChange).toHaveBeenCalledWith(null, {
        selectedOptions: [],
        previousOptions: [{ value: "members", label: "Members" }],
      });
      expect(getCombobox()).toHaveFocus();
      expect(getCombobox()).toHaveAttribute("aria-expanded", "false");
      expect(queryMenu()).toBeNull();
    },
  );

  test("Backspace and Delete are claimed, so nothing else acts on them", () => {
    renderDropdown();

    expect(fireEvent.keyDown(getValueButton(), { key: "Delete" })).toBe(false);
  });

  test.each(["a", "ArrowDown", "Tab", "Escape"])(
    "%p on the value leaves it picked",
    (key: string) => {
      const harness: Harness = renderDropdown();

      fireEvent.keyDown(getValueButton(), { key: key });

      expect(harness.onChange).not.toHaveBeenCalled();
      expect(getValueButton()).toBeInTheDocument();
    },
  );

  test("after a clear, typing searches, and Tab moves on to the next field", async () => {
    const user: UserEventController = userEvent.setup();
    renderDropdown();

    act(() => {
      getValueButton().focus();
    });
    await user.keyboard("{Delete}");
    expect(queryMenu()).toBeNull();

    await user.keyboard("adm");
    expect(getCombobox()).toHaveValue("adm");
    expect(queryMenu()).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Admins" })).toBeInTheDocument();

    // Escape closes the menu; with nothing open, Tab leaves the field.
    await user.keyboard("{Escape}");
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Next field" })).toHaveFocus();
  });

  test("a press on the value still opens the menu, ready to type", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: Harness = renderDropdown();

    await user.click(screen.getByText("Members"));

    expect(queryMenu()).toBeInTheDocument();
    expect(getCombobox()).toHaveFocus();
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  test("a disabled field shows its value with no Clear button, and keeps it on Backspace or Delete", () => {
    const harness: Harness = renderDropdown({ disabled: true });

    expect(screen.queryByRole("button", { name: "Clear selection" })).toBe(
      null,
    );
    expect(screen.queryByTestId("entity-dropdown-clear-place")).toBeNull();
    expect(getValueButton()).toBeDisabled();
    expect(classesOf(screen.getByTestId("entity-dropdown-value"))).toContain(
      "bg-gray-100",
    );

    fireEvent.keyDown(getValueButton(), { key: "Backspace" });
    fireEvent.keyDown(getValueButton(), { key: "Delete" });

    expect(harness.onChange).not.toHaveBeenCalled();
    expect(getValueButton()).toBeInTheDocument();
  });
});

/*
 * A pick closes a single-select's menu, which swaps the search input (or the
 * option that had focus) for the value button. Focus used to drop to the
 * page with them; from the keyboard it now follows to the value button, as
 * it does on Escape. A pointer pick leaves focus alone, so no focus ring
 * appears around the field after a click.
 */
describe("after a pick from the keyboard, focus stays in the field", () => {
  test("Enter on the highlighted option: the value button has focus, then Tab reaches Clear and the next field", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: Harness = renderDropdown({ value: null });

    await user.click(getCombobox());
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(harness.onChange).toHaveBeenCalledWith("admins", {
      selectedOptions: [{ value: "admins", label: "Admins" }],
      previousOptions: [],
    });
    expect(queryMenu()).toBeNull();
    expect(getValueButton()).toHaveFocus();
    expect(getValueButton()).toHaveAccessibleDescription("Admins");

    await user.tab();
    expect(getClearButton()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Next field" })).toHaveFocus();
  });

  test("Enter on an option reached with Tab: the value button has focus", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: Harness = renderDropdown();

    await user.click(getValueButton());
    expect(getCombobox()).toHaveFocus();
    // The input's Clear button, then the options.
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("option", { name: "Admins" })).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(harness.onChange).toHaveBeenCalledWith("admins", expect.anything());
    expect(queryMenu()).toBeNull();
    expect(getValueButton()).toHaveFocus();
  });

  test("a pointer pick leaves focus alone", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: Harness = renderDropdown({ value: null });

    await user.click(getCombobox());
    await user.click(screen.getByRole("option", { name: "Admins" }));

    expect(harness.onChange).toHaveBeenCalledWith("admins", expect.anything());
    expect(queryMenu()).toBeNull();
    expect(getValueButton()).not.toHaveFocus();
  });

  test("a multi-select keeps focus in its search input, with the menu open", async () => {
    const user: UserEventController = userEvent.setup();
    renderDropdown({ isMultiSelect: true, value: [] });

    await user.click(getCombobox());
    await user.keyboard("{ArrowDown}{Enter}");

    expect(getCombobox()).toHaveFocus();
    expect(queryMenu()).toBeInTheDocument();
  });
});

describe("no control is drawn inside another, in any state of the dropdown", () => {
  test("a closed single-select with nothing picked", () => {
    const harness: Harness = renderDropdown({ value: null });

    expectNothingNested(harness.view.container);
  });

  test("a single-select open on its value", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: Harness = renderDropdown();

    await user.click(getValueButton());
    expect(queryMenu()).toBeInTheDocument();
    // The search input's own Clear button is beside the input too.
    expect(getClearButton()).toBeInTheDocument();

    expectNothingNested(harness.view.container);
  });

  test("a multi-select with chips, closed and open", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: Harness = renderDropdown({
      isMultiSelect: true,
      value: ["members", "admins"],
    });

    expectNothingNested(harness.view.container);

    await user.click(getCombobox());
    expect(queryMenu()).toBeInTheDocument();

    expectNothingNested(harness.view.container);
  });

  test("the Labels tab of a labelled entity", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: Harness = renderDropdown({
      isMultiSelect: true,
      modelType: Monitor,
      labelField: "name",
      valueField: "_id",
      enableLabelsTab: true,
      options: [],
      value: [],
    });

    await user.click(getCombobox());
    await user.click(screen.getByRole("tab", { name: /Labels/ }));
    await screen.findByRole("option", { name: "Production" });

    expectNothingNested(harness.view.container);
  });
});

/*
 * The form's own wiring: what the Invite User dialog draws with the members
 * team picked for it.
 */
describe("a form's entity dropdown with a value picked", () => {
  interface TeamForm extends JSONObject {
    team?: string;
  }

  test("draws no control inside another and no nesting warning, and clears to null", async () => {
    const user: UserEventController = userEvent.setup();
    const setFieldValue: MockFunction = getJestMockFunction();

    const field: Field<TeamForm> = {
      title: "Team",
      field: { team: true },
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownModal: {
        type: Monitor,
        labelField: "name",
        valueField: "_id",
      },
      dropdownOptions: TEAM_OPTIONS,
      required: false,
      placeholder: "Select Team",
    } as Field<TeamForm>;

    const view: RenderResult = render(
      <FormField<TeamForm>
        field={field}
        fieldName="team"
        index={0}
        isDisabled={false}
        error=""
        touched={false}
        currentValues={{ team: "members" } as FormValues<TeamForm>}
        setFieldTouched={() => {}}
        setFieldValue={setFieldValue}
      />,
    );

    expectNothingNested(view.container);
    expect(nestingWarnings()).toEqual([]);

    const valueButton: HTMLElement = screen.getByRole("button", {
      name: /^Team/,
    });
    expect(valueButton).toHaveAccessibleDescription("Members");

    await user.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(setFieldValue).toHaveBeenCalledWith("team", null);
  });
});
