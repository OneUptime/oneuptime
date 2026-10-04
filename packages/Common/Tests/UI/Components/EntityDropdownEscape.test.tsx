import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import EntityDropdown, {
  EntityDropdownProps,
} from "../../../UI/Components/EntityDropdown/EntityDropdown";
import Modal from "../../../UI/Components/Modal/Modal";
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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

/*
 * Escape while an EntityDropdown's menu is open closes just the menu, wherever
 * focus is in the dropdown.
 *
 * Only the search input used to handle Escape. Keyboard users tab through the
 * menu's options, tabs and footer buttons (and past the Clear button and the
 * chips beside the input), and Escape on any of those went unclaimed to
 * Modal's document listener, which closed the whole form and threw away its
 * unsaved edits - on an alert's Affected Resources Edit modal, one Tab after
 * Escape in the same dropdown had only closed the menu.
 *
 * Also pinned here: with the menu already closed Escape is left for the modal,
 * and focus lands back on the field - the search input, or the value button a
 * single-select shows once it is closed - rather than on the page.
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
}

const TEAM_OPTIONS: Array<DropdownOption> = [
  { value: "members", label: "Members" },
  { value: "admins", label: "Admins" },
];

const LABEL_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LABEL_NAME: string = "Production";

const getCombobox: () => HTMLInputElement = (): HTMLInputElement => {
  return screen.getByRole("combobox", { name: "Team" }) as HTMLInputElement;
};

const queryMenu: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId("entity-dropdown-menu");
};

const getMenu: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("entity-dropdown-menu");
};

const getValueButton: (label: string) => HTMLElement = (
  label: string,
): HTMLElement => {
  return screen.getByRole("button", { name: new RegExp(`^${label}`) });
};

interface ModalHarness {
  onClose: MockFunction;
  onChange: MockFunction;
}

// The dropdown as the first field of a form in the real Modal.
const renderInModal: (props?: Partial<EntityDropdownProps>) => ModalHarness = (
  props?: Partial<EntityDropdownProps>,
): ModalHarness => {
  const onClose: MockFunction = getJestMockFunction();
  const onChange: MockFunction = getJestMockFunction();

  render(
    <Modal
      title="Edit"
      onClose={() => {
        onClose();
      }}
      onSubmit={(): void => {}}
    >
      <div>
        <EntityDropdown
          ariaLabel="Team"
          options={TEAM_OPTIONS}
          onChange={(value: unknown): void => {
            onChange(value);
          }}
          {...props}
        />
        <input aria-label="Next field" />
      </div>
    </Modal>,
  );

  return { onClose, onChange };
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

    return Promise.resolve({ data: [], count: 0 });
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Escape inside an open EntityDropdown in a modal closes only the menu", () => {
  test("on an option reached with Tab: the menu closes, the modal and its edits stay, focus returns to the input", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderInModal();

    // The modal focuses its first field, which opens the menu.
    expect(getCombobox()).toHaveFocus();
    expect(queryMenu()).toBeInTheDocument();

    await user.tab();
    expect(
      within(getMenu()).getByRole("option", { name: "Members" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(harness.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(queryMenu()).toBeNull();
    expect(getCombobox()).toHaveFocus();
    expect(getCombobox()).toHaveAttribute("aria-expanded", "false");
    expect(harness.onChange).not.toHaveBeenCalled();

    // With the menu already closed, Escape is the modal's again.
    await user.keyboard("{Escape}");
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  test("on an option of a single-select showing its value: focus returns to the value button", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderInModal({ value: "members" });

    // The value button is the modal's first field; it opens on a press.
    expect(getValueButton("Members")).toHaveFocus();
    expect(queryMenu()).toBeNull();

    await user.keyboard("{Enter}");
    expect(getCombobox()).toHaveFocus();

    // The input's Clear button, then the options.
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Clear selection" }),
    ).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(
      within(getMenu()).getByRole("option", { name: "Admins" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(harness.onClose).not.toHaveBeenCalled();
    expect(queryMenu()).toBeNull();
    /*
     * Closing swaps the search input for the value button. Focus used to go
     * down with the option to the page; it lands on the button instead.
     */
    expect(getValueButton("Members")).toHaveFocus();
    expect(harness.onChange).not.toHaveBeenCalled();

    /*
     * And Tab moves on from the field, not from the top of the modal: the
     * Clear button beside the value (never inside it), then the next field.
     */
    await user.tab();
    const clearButton: HTMLElement = screen.getByRole("button", {
      name: "Clear selection",
    });
    expect(clearButton).toHaveFocus();
    expect(getValueButton("Members").contains(clearButton)).toBe(false);
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Next field" })).toHaveFocus();
    expect(harness.onClose).not.toHaveBeenCalled();
  });

  test("on the Clear selection button beside the input: the menu closes and the value stays", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderInModal({ value: "members" });

    await user.keyboard("{Enter}");
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Clear selection" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(harness.onClose).not.toHaveBeenCalled();
    expect(queryMenu()).toBeNull();
    expect(getValueButton("Members")).toHaveFocus();
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  test("in the search input of a single-select showing its value: focus returns to the value button", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderInModal({ value: "members" });

    await user.keyboard("{Enter}");
    expect(getCombobox()).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(harness.onClose).not.toHaveBeenCalled();
    expect(queryMenu()).toBeNull();
    expect(getValueButton("Members")).toHaveFocus();

    // The value button has no menu to close, so Escape there is the modal's.
    await user.keyboard("{Escape}");
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  test("on a multi-select chip reached with Shift+Tab: the menu closes and the chip stays", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderInModal({
      isMultiSelect: true,
      value: ["members"],
    });

    // The modal focuses the chip's remove button; open from the input.
    await user.click(getCombobox());
    expect(queryMenu()).toBeInTheDocument();

    await user.tab({ shift: true });
    expect(
      screen.getByRole("button", { name: "Remove Members" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(harness.onClose).not.toHaveBeenCalled();
    expect(queryMenu()).toBeNull();
    expect(getCombobox()).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Remove Members" }),
    ).toBeInTheDocument();
    expect(harness.onChange).not.toHaveBeenCalled();
  });
});

describe("Escape on the Labels tab's controls in a modal closes only the menu", () => {
  const LABELS_PROPS: Partial<EntityDropdownProps> = {
    isMultiSelect: true,
    modelType: Monitor,
    labelField: "name",
    valueField: "_id",
    enableLabelsTab: true,
    options: [],
  };

  // The modal focuses the dropdown; Tab to the Labels tab (Results, Labels).
  const tabToLabelsTab: (
    user: UserEventController,
  ) => Promise<HTMLElement> = async (
    user: UserEventController,
  ): Promise<HTMLElement> => {
    expect(getCombobox()).toHaveFocus();
    await screen.findByText("No options.");

    await user.tab();
    await user.tab();
    const labelsTab: HTMLElement = screen.getByRole("tab", {
      name: /Labels/,
    });
    expect(labelsTab).toHaveFocus();
    return labelsTab;
  };

  // On the Labels tab, switch to it and Tab past the expander to the row.
  const tabToLabelRow: (
    user: UserEventController,
  ) => Promise<HTMLElement> = async (
    user: UserEventController,
  ): Promise<HTMLElement> => {
    await tabToLabelsTab(user);
    await user.keyboard("{Enter}");
    const labelRow: HTMLElement = await screen.findByRole("option", {
      name: LABEL_NAME,
    });

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Expand entries" }),
    ).toHaveFocus();
    await user.tab();
    expect(labelRow).toHaveFocus();
    return labelRow;
  };

  const expectOnlyTheMenuClosed: (harness: ModalHarness) => void = (
    harness: ModalHarness,
  ): void => {
    expect(harness.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(queryMenu()).toBeNull();
    expect(getCombobox()).toHaveFocus();
    expect(harness.onChange).not.toHaveBeenCalled();
  };

  test("on the Labels tab", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderInModal(LABELS_PROPS);
    await tabToLabelsTab(user);

    await user.keyboard("{Escape}");

    expectOnlyTheMenuClosed(harness);
  });

  test("on a label row", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderInModal(LABELS_PROPS);
    await tabToLabelRow(user);

    await user.keyboard("{Escape}");

    expectOnlyTheMenuClosed(harness);
  });

  test("on the footer's Add button", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderInModal(LABELS_PROPS);
    await tabToLabelRow(user);

    // Tick the label, then Clear and Add in the footer.
    await user.keyboard("{Enter}");
    await user.tab();
    expect(screen.getByRole("button", { name: "Clear" })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Add entries from 1 label" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expectOnlyTheMenuClosed(harness);
  });
});

describe("Escape in an EntityDropdown outside a modal", () => {
  const renderAlone: (props?: Partial<EntityDropdownProps>) => void = (
    props?: Partial<EntityDropdownProps>,
  ): void => {
    render(
      <div>
        <EntityDropdown ariaLabel="Team" options={TEAM_OPTIONS} {...props} />
      </div>,
    );
  };

  test("is claimed only while the menu is open", async () => {
    const user: UserEventController = userEvent.setup();
    renderAlone();

    await user.click(getCombobox());
    await user.tab();
    const option: HTMLElement = within(getMenu()).getByRole("option", {
      name: "Members",
    });
    expect(option).toHaveFocus();

    // fireEvent returns false when the event was claimed (preventDefault).
    expect(fireEvent.keyDown(option, { key: "Escape" })).toBe(false);
    expect(queryMenu()).toBeNull();
    expect(getCombobox()).toHaveFocus();

    // The menu already closed: nothing of the dropdown's left to close.
    expect(fireEvent.keyDown(getCombobox(), { key: "Escape" })).toBe(true);
    expect(queryMenu()).toBeNull();
  });

  test("other keys on an option are left alone", async () => {
    const user: UserEventController = userEvent.setup();
    renderAlone();

    await user.click(getCombobox());
    await user.tab();
    const option: HTMLElement = within(getMenu()).getByRole("option", {
      name: "Members",
    });

    expect(fireEvent.keyDown(option, { key: "a" })).toBe(true);
    expect(fireEvent.keyDown(option, { key: "ArrowDown" })).toBe(true);
    expect(queryMenu()).toBeInTheDocument();
  });

  test("the menu reopens as before after Escape: typing in the input searches again", async () => {
    const user: UserEventController = userEvent.setup();
    renderAlone();

    await user.click(getCombobox());
    await user.tab();
    await user.keyboard("{Escape}");
    expect(queryMenu()).toBeNull();
    expect(getCombobox()).toHaveFocus();

    await user.keyboard("adm");

    expect(getCombobox()).toHaveValue("adm");
    expect(queryMenu()).toBeInTheDocument();
    expect(
      within(getMenu()).getByRole("option", { name: "Admins" }),
    ).toBeInTheDocument();
    expect(
      within(getMenu()).queryByRole("option", { name: "Members" }),
    ).toBeNull();
  });
});
