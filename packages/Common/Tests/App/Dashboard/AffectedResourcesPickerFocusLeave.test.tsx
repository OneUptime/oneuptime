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
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { FunctionComponent, ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The results list of the Affected Resources picker closes when keyboard
 * focus leaves the picker, and so does the menu of an EntityDropdown.
 *
 * On an alert's Affected Resources Edit modal the Monitor dropdown sits right
 * above the picker, and both open a `fixed` popup at the same z-index. Neither
 * used to close when focus left it, so a keyboard user who tabbed from the
 * Monitor dropdown, through its options, into the picker's search input (which
 * opens the picker's list on focus) had the Monitor menu still open, on top of
 * the picker's list.
 *
 * Focus moving inside the picker - its chips, its input, the list's tabs, rows
 * and buttons - keeps the list open: the list is a DOM child of the picker.
 * Focus going nowhere in particular (a blur with no element to go to) keeps it
 * open as well; presses have their own outside-press handling.
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

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
    },
  };
});

import AffectedResourcesPicker, {
  AffectedResourcesPayload,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import {
  DropdownOption,
  DropdownValue,
} from "../../../UI/Components/Dropdown/Dropdown";
import EntityDropdown from "../../../UI/Components/EntityDropdown/EntityDropdown";
import Modal from "../../../UI/Components/Modal/Modal";

type UserEventController = ReturnType<typeof userEvent.setup>;

type ModelClass = { new (): BaseModel };

interface FakeRow {
  _id: string;
  name: string;
}

interface GetListArgs {
  modelType: ModelClass;
  limit: number;
}

interface GetListResult {
  data: Array<BaseModel>;
  count: number;
  skip: number;
  limit: number;
}

const MONITOR_ID: string = "00000000-0000-4000-8000-000000000001";
const MONITOR_NAME: string = "Checkout API";
const SECOND_MONITOR_ID: string = "00000000-0000-4000-8000-000000000002";
const SECOND_MONITOR_NAME: string = "Orders DB";
const LABEL_ID: string = "00000000-0000-4000-8000-0000000000aa";
const LABEL_NAME: string = "Production";

// Every list request answers with the rows seeded for its model type.
let rowsByModel: Map<ModelClass, Array<FakeRow>> = new Map();

const fakeGetList: (args: GetListArgs) => Promise<GetListResult> = async (
  args: GetListArgs,
): Promise<GetListResult> => {
  const rows: Array<FakeRow> = rowsByModel.get(args.modelType) || [];
  const data: Array<BaseModel> = rows
    .slice(0, args.limit)
    .map((row: FakeRow): BaseModel => {
      const model: BaseModel = new args.modelType();
      model._id = row._id;
      (model as unknown as { name: string }).name = row.name;
      return model;
    });
  return { data, count: data.length, skip: 0, limit: args.limit };
};

// The picker's search input. Its placeholder names the one type it offers.
const getPickerInput: () => HTMLInputElement = (): HTMLInputElement => {
  return screen.getByPlaceholderText("Search monitor...") as HTMLInputElement;
};

const queryPickerList: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId("affected-resources-dropdown");
};

const getPickerList: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("affected-resources-dropdown");
};

const getPreviousField: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("textbox", { name: "Previous field" });
};

const getNextField: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("textbox", { name: "Next field" });
};

interface HarnessProps {
  onPayload?: ((payload: AffectedResourcesPayload) => void) | undefined;
}

/*
 * The picker keeps no selection of its own: the page's form does. This holds
 * the monitors the way that form would, as bare IDs, so a pick renders a
 * chip above the input.
 */
const PickerHarness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const [monitors, setMonitors] = useState<Array<string>>([]);

  return (
    <AffectedResourcesPicker
      monitors={monitors as unknown as Array<Monitor>}
      resourceTypes={["Monitor"]}
      onChange={(payload: AffectedResourcesPayload): void => {
        props.onPayload?.(payload);
        setMonitors(payload.monitors || []);
      }}
    />
  );
};

// A form with a field on either side of the picker.
const renderPickerBetweenFields: () => MockFunction = (): MockFunction => {
  const onPayload: MockFunction = getJestMockFunction();

  render(
    <div>
      <input aria-label="Previous field" />
      <PickerHarness
        onPayload={(payload: AffectedResourcesPayload): void => {
          onPayload(payload);
        }}
      />
      <input aria-label="Next field" />
    </div>,
  );

  return onPayload;
};

beforeEach(() => {
  rowsByModel = new Map();
  rowsByModel.set(Monitor, [
    { _id: MONITOR_ID, name: MONITOR_NAME },
    { _id: SECOND_MONITOR_ID, name: SECOND_MONITOR_NAME },
  ]);
  rowsByModel.set(Label, [{ _id: LABEL_ID, name: LABEL_NAME }]);
  getListMock.mockReset();
  getListMock.mockImplementation((...args: Array<unknown>) => {
    return fakeGetList(args[0] as GetListArgs);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the picker's results list closes when keyboard focus leaves the picker", () => {
  test("Tab walks the list's tabs and rows with it open, and past the last row closes it", async () => {
    const user: UserEventController = userEvent.setup();
    renderPickerBetweenFields();

    await user.click(getPickerInput());
    await screen.findByRole("option", { name: MONITOR_NAME });

    await user.tab();
    expect(screen.getByRole("tab", { name: /Resources/ })).toHaveFocus();
    expect(queryPickerList()).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("tab", { name: /Labels/ })).toHaveFocus();
    expect(queryPickerList()).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("option", { name: MONITOR_NAME })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("option", { name: SECOND_MONITOR_NAME }),
    ).toHaveFocus();
    expect(queryPickerList()).toBeInTheDocument();

    await user.tab();
    expect(getNextField()).toHaveFocus();
    expect(queryPickerList()).toBeNull();
    expect(getPickerInput()).toHaveAttribute("aria-expanded", "false");
  });

  test("Shift+Tab onto a chip keeps it open; on past the chip to the previous field closes it", async () => {
    const user: UserEventController = userEvent.setup();
    renderPickerBetweenFields();

    await user.click(getPickerInput());
    await user.click(await screen.findByRole("option", { name: MONITOR_NAME }));
    const removeChip: HTMLElement = await screen.findByRole("button", {
      name: `Remove ${MONITOR_NAME}`,
    });
    expect(getPickerInput()).toHaveFocus();
    expect(queryPickerList()).toBeInTheDocument();

    await user.tab({ shift: true });
    expect(removeChip).toHaveFocus();
    expect(queryPickerList()).toBeInTheDocument();

    await user.tab({ shift: true });
    expect(getPreviousField()).toHaveFocus();
    expect(queryPickerList()).toBeNull();
  });

  test("focus moved straight onto another field closes it", async () => {
    const user: UserEventController = userEvent.setup();
    renderPickerBetweenFields();

    await user.click(getPickerInput());
    await screen.findByRole("option", { name: MONITOR_NAME });

    act(() => {
      getNextField().focus();
    });

    expect(queryPickerList()).toBeNull();
  });

  test("focus going nowhere in particular leaves it open", async () => {
    const user: UserEventController = userEvent.setup();
    renderPickerBetweenFields();

    await user.click(getPickerInput());
    await screen.findByRole("option", { name: MONITOR_NAME });

    // The window losing focus: a blur with no element to go to.
    fireEvent.blur(getPickerInput());
    fireEvent.blur(getPickerInput(), { relatedTarget: null });
    expect(queryPickerList()).toBeInTheDocument();

    /*
     * Focus dropped to the page itself. A browser reports no relatedTarget
     * for that; jsdom reports the document.
     */
    act(() => {
      getPickerInput().blur();
    });
    expect(document.activeElement).toBe(document.body);
    expect(queryPickerList()).toBeInTheDocument();
  });

  test("a mouse pick still lands, and the list stays open for the next one", async () => {
    const user: UserEventController = userEvent.setup();
    const onPayload: MockFunction = renderPickerBetweenFields();

    await user.click(getPickerInput());
    await user.click(
      await screen.findByRole("option", { name: SECOND_MONITOR_NAME }),
    );

    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(
      (onPayload.mock.calls[0]![0] as AffectedResourcesPayload).monitors,
    ).toEqual([SECOND_MONITOR_ID]);
    await screen.findByRole("button", {
      name: `Remove ${SECOND_MONITOR_NAME}`,
    });
    expect(getPickerInput()).toHaveFocus();
    expect(queryPickerList()).toBeInTheDocument();
  });

  test("the Labels tab, its rows and its Add button reached with Tab keep it open, and Add still applies", async () => {
    const user: UserEventController = userEvent.setup();
    const onPayload: MockFunction = renderPickerBetweenFields();

    await user.click(getPickerInput());
    await screen.findByRole("option", { name: MONITOR_NAME });

    await user.tab();
    await user.tab();
    const labelsTab: HTMLElement = screen.getByRole("tab", { name: /Labels/ });
    expect(labelsTab).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(labelsTab).toHaveAttribute("aria-selected", "true");
    await screen.findByRole("option", { name: LABEL_NAME });

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Expand resources" }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("option", { name: LABEL_NAME })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("option", { name: LABEL_NAME })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(queryPickerList()).toBeInTheDocument();

    // The footer: Clear, then Add.
    await user.tab();
    expect(screen.getByRole("button", { name: "Clear" })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Add resources from 1 label" }),
    ).toHaveFocus();
    expect(queryPickerList()).toBeInTheDocument();

    await user.keyboard("{Enter}");

    await screen.findByRole("button", { name: `Remove ${MONITOR_NAME}` });
    expect(
      (
        onPayload.mock.calls[
          onPayload.mock.calls.length - 1
        ]![0] as AffectedResourcesPayload
      ).monitors,
    ).toEqual([MONITOR_ID, SECOND_MONITOR_ID]);
    // Applying closes the list, as it always has.
    expect(queryPickerList()).toBeNull();
  });

  test("Escape on a list control reached with Tab closes the list and hands focus back to the input", async () => {
    const user: UserEventController = userEvent.setup();
    renderPickerBetweenFields();

    await user.click(getPickerInput());
    await screen.findByRole("option", { name: MONITOR_NAME });
    await user.tab();
    await user.tab();
    expect(screen.getByRole("tab", { name: /Labels/ })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(queryPickerList()).toBeNull();
    expect(getPickerInput()).toHaveFocus();
    expect(getPickerInput()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("the alert's Edit modal: a Monitor dropdown above the picker", () => {
  const MONITOR_OPTIONS: Array<DropdownOption> = [
    { value: MONITOR_ID, label: MONITOR_NAME },
    { value: SECOND_MONITOR_ID, label: SECOND_MONITOR_NAME },
  ];

  interface ModalHarness {
    onClose: MockFunction;
    onMonitorChange: MockFunction;
  }

  /*
   * The alert page's Affected Resources form: a single-select Monitor
   * dropdown backed by the Monitor model, then the picker, inside the real
   * Modal (with its Tab trap and its Escape and backdrop handling).
   */
  const renderAlertEditModal: () => ModalHarness = (): ModalHarness => {
    const onClose: MockFunction = getJestMockFunction();
    const onMonitorChange: MockFunction = getJestMockFunction();

    render(
      <Modal
        title="Edit Affected Resources"
        onClose={() => {
          onClose();
        }}
        onSubmit={(): void => {}}
      >
        <div>
          <EntityDropdown
            ariaLabel="Monitor"
            modelType={Monitor}
            labelField="name"
            valueField="_id"
            options={MONITOR_OPTIONS}
            placeholder="Select Monitor"
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              onMonitorChange(value);
            }}
          />
          <PickerHarness />
        </div>
      </Modal>,
    );

    return { onClose, onMonitorChange };
  };

  const getMonitorInput: () => HTMLInputElement = (): HTMLInputElement => {
    return screen.getByRole("combobox", {
      name: "Monitor",
    }) as HTMLInputElement;
  };

  const queryMonitorMenu: () => HTMLElement | null = (): HTMLElement | null => {
    return screen.queryByTestId("entity-dropdown-menu");
  };

  // Waits for the Monitor menu's own search, so no update lands late.
  const waitForMonitorOptions: () => Promise<HTMLElement> =
    async (): Promise<HTMLElement> => {
      const menu: HTMLElement = screen.getByTestId("entity-dropdown-menu");
      await within(menu).findByRole("option", { name: SECOND_MONITOR_NAME });
      return menu;
    };

  test("tabbing from the Monitor dropdown's options into the picker leaves only the picker's list open", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderAlertEditModal();

    // The modal puts focus on its first field, which opens the Monitor menu.
    expect(getMonitorInput()).toHaveFocus();
    const monitorMenu: HTMLElement = await waitForMonitorOptions();
    expect(queryPickerList()).toBeNull();

    await user.tab();
    expect(
      within(monitorMenu).getByRole("option", { name: MONITOR_NAME }),
    ).toHaveFocus();
    await user.tab();
    expect(
      within(monitorMenu).getByRole("option", { name: SECOND_MONITOR_NAME }),
    ).toHaveFocus();
    expect(queryMonitorMenu()).toBeInTheDocument();

    // On into the picker's search input, which opens the picker's list.
    await user.tab();
    expect(getPickerInput()).toHaveFocus();
    await within(getPickerList()).findByRole("option", {
      name: MONITOR_NAME,
    });

    expect(queryMonitorMenu()).toBeNull();
    expect(getMonitorInput()).toHaveAttribute("aria-expanded", "false");
    expect(getPickerInput()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("listbox")).toEqual([getPickerList()]);
    expect(harness.onMonitorChange).not.toHaveBeenCalled();
    expect(harness.onClose).not.toHaveBeenCalled();
  });

  test("Shift+Tab from the picker back into the Monitor dropdown leaves only the Monitor menu open", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderAlertEditModal();
    await waitForMonitorOptions();

    await user.click(getPickerInput());
    await within(getPickerList()).findByRole("option", {
      name: MONITOR_NAME,
    });
    expect(queryMonitorMenu()).toBeNull();

    await user.tab({ shift: true });

    expect(getMonitorInput()).toHaveFocus();
    await waitForMonitorOptions();
    expect(queryPickerList()).toBeNull();
    expect(getPickerInput()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("listbox")).toEqual([
      screen.getByTestId("entity-dropdown-menu"),
    ]);
    expect(harness.onClose).not.toHaveBeenCalled();
  });

  test("tabbing past the picker's last row onto the modal's buttons closes the list and leaves the modal open", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderAlertEditModal();
    await waitForMonitorOptions();

    await user.click(getPickerInput());
    const list: HTMLElement = getPickerList();
    await within(list).findByRole("option", { name: MONITOR_NAME });

    // Resources, Labels, then the two monitor rows.
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(
      within(list).getByRole("option", { name: SECOND_MONITOR_NAME }),
    ).toHaveFocus();

    await user.tab();

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(queryPickerList()).toBeNull();
    expect(queryMonitorMenu()).toBeNull();
    expect(harness.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
  });

  test("Escape on a Tab-reached control closes only its own popup, in the Monitor menu as in the picker's list", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderAlertEditModal();
    const monitorMenu: HTMLElement = await waitForMonitorOptions();

    await user.tab();
    expect(
      within(monitorMenu).getByRole("option", { name: MONITOR_NAME }),
    ).toHaveFocus();

    /*
     * This Escape used to go unclaimed to the modal, which closed the whole
     * form and dropped its unsaved edits.
     */
    await user.keyboard("{Escape}");

    expect(harness.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(queryMonitorMenu()).toBeNull();
    expect(getMonitorInput()).toHaveFocus();
    expect(getMonitorInput()).toHaveAttribute("aria-expanded", "false");
    expect(harness.onMonitorChange).not.toHaveBeenCalled();

    // On into the picker, and onto the first control in its list.
    await user.tab();
    expect(getPickerInput()).toHaveFocus();
    const list: HTMLElement = getPickerList();
    await within(list).findByRole("option", { name: MONITOR_NAME });
    await user.tab();
    expect(within(list).getByRole("tab", { name: /Resources/ })).toHaveFocus();

    // The same key does the same thing there.
    await user.keyboard("{Escape}");

    expect(harness.onClose).not.toHaveBeenCalled();
    expect(queryPickerList()).toBeNull();
    expect(getPickerInput()).toHaveFocus();
    expect(queryMonitorMenu()).toBeNull();

    // Both popups shut, Escape is the modal's.
    await user.keyboard("{Escape}");
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  test("a mouse pick in the Monitor menu still lands, and the picker's list stays shut", async () => {
    const user: UserEventController = userEvent.setup();
    const harness: ModalHarness = renderAlertEditModal();
    const monitorMenu: HTMLElement = await waitForMonitorOptions();

    await user.click(
      within(monitorMenu).getByRole("option", { name: SECOND_MONITOR_NAME }),
    );

    expect(harness.onMonitorChange).toHaveBeenCalledTimes(1);
    expect(harness.onMonitorChange).toHaveBeenCalledWith(SECOND_MONITOR_ID);
    expect(queryMonitorMenu()).toBeNull();
    expect(queryPickerList()).toBeNull();
    expect(harness.onClose).not.toHaveBeenCalled();
  });
});
