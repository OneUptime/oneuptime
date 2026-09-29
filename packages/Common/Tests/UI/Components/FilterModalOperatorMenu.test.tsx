import FiltersForm from "../../../UI/Components/Filters/FiltersForm";
import Filter from "../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../UI/Components/Filters/Types/FilterData";
import Modal, { ModalWidth } from "../../../UI/Components/Modal/Modal";
import FieldType from "../../../UI/Components/Types/FieldType";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import Search from "../../../Types/BaseDatabase/Search";
import GenericObject from "../../../Types/GenericObject";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The reported bug: the operator button ("contains", "equals", ...) in the
 * "Filter <Resource>" modal opened a menu that was clipped to a sliver,
 * because the menu lived inside the modal body — and the modal body is a
 * scroll container (`overflow-y-auto overscroll-contain`).
 *
 * These tests exercise the exact composition the user hit: a real Modal
 * wrapping a real FiltersForm, the way FilterViewer wires them together. The
 * unit-level menu behaviour is covered elsewhere; what is proved here is that
 * the fix survives the composition — the menu and every one of its options
 * escape the scroll container, the fixed geometry is a real box stacked above
 * the modal shell, picking an operator flows back through the form, and the
 * keys the menu owns (Escape, Tab) close the menu instead of leaking into the
 * modal's own document-level handlers.
 */

type LogRow = GenericObject & {
  client?: string;
  durationMs?: number;
};

const FILTERS: Array<Filter<LogRow>> = [
  {
    key: "client",
    title: "Client",
    type: FieldType.Text,
  },
  {
    key: "durationMs",
    title: "Duration",
    type: FieldType.Number,
  },
] as unknown as Array<Filter<LogRow>>;

const TEXT_OPERATOR_LABELS: Array<string> = [
  "contains",
  "does not contain",
  "equals",
  "does not equal",
  "starts with",
  "ends with",
  "is empty",
  "is not empty",
];

const MENU_TEST_ID: string = "operator-selector-menu";

/*
 * Geometry the component computes, mirrored here so the expected pixel values
 * below are traceable: MENU_MAX_HEIGHT 240, MENU_MIN_HEIGHT 120,
 * MENU_WIDTH 224, MENU_GAP 4, VIEWPORT_MARGIN 8.
 */
const VIEWPORT_WIDTH: number = 1024;
const VIEWPORT_HEIGHT: number = 768;

/*
 * Modal.tsx renders its shell inside `relative z-50` / `fixed inset-0 z-50`.
 * The menu is a sibling of that shell in document.body, so it only paints on
 * top if it outranks that stacking context.
 */
const MODAL_SHELL_Z_INDEX: number = 50;

interface RectValues {
  top: number;
  left: number;
  width: number;
  height: number;
}

type MakeRectFunction = (values: RectValues) => DOMRect;

const makeRect: MakeRectFunction = (values: RectValues): DOMRect => {
  return {
    x: values.left,
    y: values.top,
    top: values.top,
    left: values.left,
    width: values.width,
    height: values.height,
    bottom: values.top + values.height,
    right: values.left + values.width,
    toJSON: (): RectValues => {
      return values;
    },
  };
};

type SetViewportFunction = (width: number, height: number) => void;

const setViewport: SetViewportFunction = (
  width: number,
  height: number,
): void => {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: height,
    writable: true,
    configurable: true,
  });
};

interface HarnessProps {
  initialFilterData: FilterData<LogRow>;
  onFilterChanged: (filterData: FilterData<LogRow>) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/*
 * Mirrors FilterViewer: the modal owns a working copy of the filter data and
 * feeds it straight back into the form, so every operator change round-trips
 * through a real re-render (OperatorSelector is a controlled component).
 */
const FilterModalHarness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const [filterData, setFilterData] = React.useState<FilterData<LogRow>>(
    props.initialFilterData,
  );

  return (
    <Modal
      modalWidth={ModalWidth.Large}
      title="Filter Logs"
      description="Narrow down logs by one or more criteria below."
      submitButtonText="Apply Filters"
      onClose={props.onClose}
      onSubmit={props.onSubmit}
    >
      <FiltersForm<LogRow>
        id="logs-filter"
        showFilter={true}
        filterData={filterData}
        filters={FILTERS}
        onFilterChanged={(next: FilterData<LogRow>) => {
          setFilterData(next);
          props.onFilterChanged(next);
        }}
      />
    </Modal>
  );
};

interface RenderedHarness {
  changes: Array<FilterData<LogRow>>;
  onClose: () => void;
  onSubmit: () => void;
  unmount: () => void;
}

type RenderHarnessFunction = (
  initialFilterData?: FilterData<LogRow> | undefined,
) => RenderedHarness;

const renderHarness: RenderHarnessFunction = (
  initialFilterData?: FilterData<LogRow> | undefined,
): RenderedHarness => {
  const changes: Array<FilterData<LogRow>> = [];
  const onClose: () => void = jest.fn();
  const onSubmit: () => void = jest.fn();

  const { unmount } = render(
    <FilterModalHarness
      initialFilterData={initialFilterData ?? ({} as FilterData<LogRow>)}
      onFilterChanged={(filterData: FilterData<LogRow>) => {
        changes.push(filterData);
      }}
      onClose={onClose}
      onSubmit={onSubmit}
    />,
  );

  return {
    changes: changes,
    onClose: onClose,
    onSubmit: onSubmit,
    unmount: unmount,
  };
};

type ChangedValueForFunction = (
  harness: RenderedHarness,
  index: number,
  key: string,
) => unknown;

const changedValueFor: ChangedValueForFunction = (
  harness: RenderedHarness,
  index: number,
  key: string,
): unknown => {
  // Fail readably (not with a TypeError) when onChange never fired.
  expect(harness.changes.length).toBeGreaterThan(index);

  const changed: FilterData<LogRow> = harness.changes[index]!;
  return (changed as unknown as Record<string, unknown>)[key];
};

type GetOperatorTriggersFunction = () => Array<HTMLButtonElement>;

const getOperatorTriggers: GetOperatorTriggersFunction =
  (): Array<HTMLButtonElement> => {
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'button[aria-haspopup="listbox"]',
      ),
    );
  };

type OpenMenuForRowFunction = (rowIndex: number) => HTMLElement;

const openMenuForRow: OpenMenuForRowFunction = (
  rowIndex: number,
): HTMLElement => {
  const trigger: HTMLButtonElement = getOperatorTriggers()[rowIndex]!;
  fireEvent.click(trigger);
  return screen.getByTestId(MENU_TEST_ID);
};

type WithTextValueFunction = (value: string) => FilterData<LogRow>;

const withTextValue: WithTextValueFunction = (
  value: string,
): FilterData<LogRow> => {
  return { client: new Search(value) } as unknown as FilterData<LogRow>;
};

describe("Operator menu inside the filter modal", () => {
  beforeEach(() => {
    setViewport(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  });

  afterEach(() => {
    cleanup();

    /*
     * The menu is portalled outside the React root container, so a portal that
     * failed to unmount with the tree would silently contaminate the next test
     * instead of failing here.
     */
    expect(
      document.querySelectorAll(`[data-testid="${MENU_TEST_ID}"]`),
    ).toHaveLength(0);
  });

  test("the open menu escapes the modal's scrolling body", () => {
    renderHarness(withTextValue("acme"));

    const menu: HTMLElement = openMenuForRow(0);
    const modalContent: HTMLElement = screen.getByTestId("modal-content");
    const trigger: HTMLButtonElement = getOperatorTriggers()[0]!;

    /*
     * Premise of the whole bug: the trigger sits inside the scroll container,
     * so an in-place menu would have been clipped by it. Without this the test
     * below would pass even if the form stopped living in the modal body.
     */
    expect(modalContent.className).toContain("overflow-y-auto");
    expect(modalContent.contains(trigger)).toBe(true);

    expect(modalContent.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
  });

  test("the escaped menu is a real box stacked above the modal shell", () => {
    renderHarness(withTextValue("acme"));

    const menu: HTMLElement = openMenuForRow(0);

    // Fixed positioning is what lets the portalled menu track its trigger.
    expect(menu.className).toContain("fixed");
    expect(Number(menu.style.zIndex)).toBeGreaterThan(MODAL_SHELL_Z_INDEX);

    /*
     * jsdom hands back all-zero rects, so with a 1024x768 viewport the
     * geometry is fully determined: there is room below, so the menu anchors
     * from the top at MENU_GAP, spans MENU_WIDTH, is capped at MENU_MAX_HEIGHT
     * and is nudged to VIEWPORT_MARGIN from the left edge. A collapsed box
     * ("0px") is visually the reported bug, so these are exact.
     */
    expect(menu.style.width).toBe("224px");
    expect(menu.style.maxHeight).toBe("240px");
    expect(menu.style.left).toBe("8px");
    // Exactly one of top/bottom is set — this is the "opens downwards" case.
    expect(menu.style.top).toBe("4px");
    expect(menu.style.bottom).toBe("");
  });

  test("every operator option escapes the modal's scroll container", () => {
    renderHarness(withTextValue("acme"));

    const menu: HTMLElement = openMenuForRow(0);
    const modalContent: HTMLElement = screen.getByTestId("modal-content");
    const options: Array<HTMLElement> = within(menu).getAllByRole("option");

    expect(
      options.map((option: HTMLElement) => {
        return option.textContent;
      }),
    ).toEqual(TEXT_OPERATOR_LABELS);

    // Not just the menu root: every option is outside the clipping ancestor.
    for (const option of options) {
      expect(modalContent.contains(option)).toBe(false);
    }
  });

  test("the open menu marks exactly one option selected and checks it", () => {
    renderHarness(withTextValue("acme"));

    const menu: HTMLElement = openMenuForRow(0);
    const options: Array<HTMLElement> = within(menu).getAllByRole("option");

    const selectedOptions: Array<HTMLElement> = options.filter(
      (option: HTMLElement) => {
        return option.getAttribute("aria-selected") === "true";
      },
    );

    expect(selectedOptions).toHaveLength(1);
    expect(selectedOptions[0]!.textContent).toBe("contains");
    // The selected row is the only one carrying the check icon.
    expect(selectedOptions[0]!.querySelector("svg")).not.toBeNull();
    expect(
      within(menu)
        .getByRole("option", { name: "ends with" })
        .querySelector("svg"),
    ).toBeNull();
  });

  /*
   * Portalling the menu took the options out of the modal's focus trap
   * (Modal.tsx only collects focusables inside its own dialog element), so the
   * menu has to move focus onto an option itself — nothing else can rescue a
   * keyboard user who opens the menu from inside the modal, and the trigger's
   * own key handler bails out while the menu is open.
   *
   * THIS TEST CURRENTLY FAILS, and the failure is a genuine component defect,
   * not a test defect: `openMenu` commits `isOpen` with `menuPosition === null`
   * so no options are rendered yet; the layout effect then calls
   * `setMenuPosition`, and React flushes pending passive effects before that
   * synchronous re-render — so the roving-focus effect
   * (OperatorSelector.tsx:175-181) reads `optionRefs.current[activeIndex]` as
   * null and never re-runs, because its deps [isOpen, activeIndex] did not
   * change. Focus stays on the trigger.
   */
  test("opening the menu focuses the currently selected operator", () => {
    renderHarness(withTextValue("acme"));

    const menu: HTMLElement = openMenuForRow(0);
    const selectedOption: HTMLElement = within(menu).getByRole("option", {
      name: "contains",
    });

    // Names the stake: the modal's own trap cannot supply this focus.
    expect(screen.getByTestId("modal").contains(selectedOption)).toBe(false);
    expect(selectedOption).toHaveFocus();
  });

  test("picking 'does not contain' re-encodes the value, keeps the typed text, and does not submit", () => {
    const harness: RenderedHarness = renderHarness(withTextValue("acme"));

    const menu: HTMLElement = openMenuForRow(0);
    fireEvent.click(
      within(menu).getByRole("option", { name: "does not contain" }),
    );

    // Exactly once: a double-fired onChange would double-apply the operator.
    expect(harness.changes).toHaveLength(1);

    const value: unknown = changedValueFor(harness, 0, "client");

    expect(value).toBeInstanceOf(NotContains);
    expect((value as NotContains<string>).value).toBe("acme");
    expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    expect(getOperatorTriggers()[0]).toHaveTextContent("does not contain");
    // The typed text survives the operator switch, so the input is untouched.
    expect(screen.getByPlaceholderText("Filter by Client")).toHaveValue("acme");
    expect(harness.onSubmit).not.toHaveBeenCalled();
    expect(harness.onClose).not.toHaveBeenCalled();
  });

  test("switching to 'is empty' encodes IsNull and hides the value control", () => {
    const harness: RenderedHarness = renderHarness(withTextValue("acme"));

    expect(screen.getByPlaceholderText("Filter by Client")).toBeInTheDocument();

    const menu: HTMLElement = openMenuForRow(0);
    fireEvent.click(within(menu).getByRole("option", { name: "is empty" }));

    expect(harness.changes).toHaveLength(1);

    const value: unknown = changedValueFor(harness, 0, "client");

    expect(value).toBeInstanceOf(IsNull);
    expect(screen.queryByPlaceholderText("Filter by Client")).toBeNull();
    expect(getOperatorTriggers()[0]).toHaveTextContent("is empty");
    // The other row keeps its own value control.
    expect(
      screen.getByPlaceholderText("Filter by Duration"),
    ).toBeInTheDocument();
  });

  test("picking 'is greater than' on the Duration row re-encodes the number", () => {
    const harness: RenderedHarness = renderHarness({
      client: new Search("acme"),
      durationMs: 500,
    } as unknown as FilterData<LogRow>);

    expect(getOperatorTriggers()[1]).toHaveTextContent("equals");

    const menu: HTMLElement = openMenuForRow(1);
    fireEvent.click(
      within(menu).getByRole("option", { name: "is greater than" }),
    );

    expect(harness.changes).toHaveLength(1);

    const value: unknown = changedValueFor(harness, 0, "durationMs");

    expect(value).toBeInstanceOf(GreaterThan);
    expect((value as GreaterThan<number>).value).toBe(500);
    expect(getOperatorTriggers()[1]).toHaveTextContent("is greater than");
    // The text row is untouched by the number row's operator change.
    expect(getOperatorTriggers()[0]).toHaveTextContent("contains");
  });

  test("reopening the menu shows the newly picked operator as the selected one", () => {
    renderHarness(withTextValue("acme"));

    const menu: HTMLElement = openMenuForRow(0);
    fireEvent.click(within(menu).getByRole("option", { name: "ends with" }));

    const reopened: HTMLElement = openMenuForRow(0);
    const options: Array<HTMLElement> = within(reopened).getAllByRole("option");

    const selectedOptions: Array<HTMLElement> = options.filter(
      (option: HTMLElement) => {
        return option.getAttribute("aria-selected") === "true";
      },
    );

    // The controlled `value` prop round-tripped through the harness re-render.
    expect(selectedOptions).toHaveLength(1);
    expect(selectedOptions[0]!.textContent).toBe("ends with");
    expect(selectedOptions[0]!.querySelector("svg")).not.toBeNull();
    expect(
      within(reopened)
        .getByRole("option", { name: "contains" })
        .querySelector("svg"),
    ).toBeNull();
  });

  test("Escape with an option focused closes only the menu and hands focus back to the trigger", () => {
    const harness: RenderedHarness = renderHarness(withTextValue("acme"));

    const trigger: HTMLButtonElement = getOperatorTriggers()[0]!;
    const menu: HTMLElement = openMenuForRow(0);

    // Put focus where a keyboard user would have it, so the restore is real.
    within(menu).getAllByRole("option")[2]!.focus();
    expect(trigger).not.toHaveFocus();

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    expect(harness.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Only once the menu is gone does Escape belong to the modal.
    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape still closes the menu when focus has drifted out of it", () => {
    const harness: RenderedHarness = renderHarness(withTextValue("acme"));

    openMenuForRow(0);

    /*
     * Focus is nowhere near the menu, so only the document-level safety net
     * can catch this — and it must not let the modal close instead.
     */
    fireEvent.keyDown(screen.getByTestId("modal-content"), { key: "Escape" });

    expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    expect(harness.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
  });

  test("Tab inside the menu closes it and is not re-trapped by the modal", () => {
    const harness: RenderedHarness = renderHarness(withTextValue("acme"));

    const trigger: HTMLButtonElement = getOperatorTriggers()[0]!;
    const menu: HTMLElement = openMenuForRow(0);

    within(menu).getAllByRole("option")[2]!.focus();

    fireEvent.keyDown(menu, { key: "Tab" });

    expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    expect(trigger).toHaveFocus();
    /*
     * Without the menu's Tab branch the event would reach Modal's document
     * keydown handler, which sees focus outside the dialog and slams it onto
     * the first focusable element in the modal instead.
     */
    expect(screen.getByTestId("close-button")).not.toHaveFocus();
    expect(screen.getByTestId("modal-footer-submit-button")).not.toHaveFocus();
    expect(harness.onClose).not.toHaveBeenCalled();
  });

  test("clicking into a filter input closes the menu without closing the modal or stealing focus", () => {
    const harness: RenderedHarness = renderHarness(withTextValue("acme"));

    const trigger: HTMLButtonElement = getOperatorTriggers()[0]!;
    const input: HTMLElement = screen.getByPlaceholderText("Filter by Client");

    openMenuForRow(0);

    // The most common real action: reaching past the open menu for the input.
    input.focus();
    fireEvent.mouseDown(input);

    expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    // The click decided where focus goes; the menu must not claw it back.
    expect(input).toHaveFocus();
    expect(trigger).not.toHaveFocus();
    expect(harness.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
  });

  test("clicking the trigger again closes the menu without restoring focus", () => {
    renderHarness(withTextValue("acme"));

    const trigger: HTMLButtonElement = getOperatorTriggers()[0]!;
    const input: HTMLElement = screen.getByPlaceholderText("Filter by Client");

    openMenuForRow(0);

    input.focus();
    fireEvent.click(trigger);

    expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // closeMenu(false): the click already moved focus, so nothing is restored.
    expect(input).toHaveFocus();
  });

  test("scrolling the modal body repositions the fixed menu", () => {
    renderHarness(withTextValue("acme"));

    const trigger: HTMLButtonElement = getOperatorTriggers()[0]!;
    const container: HTMLElement = trigger.parentElement as HTMLElement;

    const menu: HTMLElement = openMenuForRow(0);

    expect(menu.style.top).toBe("4px");
    expect(menu.style.left).toBe("8px");

    /*
     * The form scrolls inside modal-content, which moves the trigger. Only the
     * capture-phase window scroll listener can see that, because a scroll
     * event on an inner element does not bubble.
     */
    container.getBoundingClientRect = (): DOMRect => {
      return makeRect({ top: 100, left: 50, width: 130, height: 36 });
    };

    fireEvent.scroll(screen.getByTestId("modal-content"));

    const repositioned: HTMLElement = screen.getByTestId(MENU_TEST_ID);

    // rect.bottom (136) + MENU_GAP (4); left tracks the trigger, no clamping.
    expect(repositioned.style.top).toBe("140px");
    expect(repositioned.style.left).toBe("50px");
  });

  test("each filter row owns an independent operator menu", () => {
    renderHarness(withTextValue("acme"));

    const triggers: Array<HTMLButtonElement> = getOperatorTriggers();

    expect(triggers).toHaveLength(2);
    expect(triggers[0]).not.toHaveAttribute("aria-controls");

    const textMenu: HTMLElement = openMenuForRow(0);

    expect(textMenu).toHaveAttribute("aria-labelledby", triggers[0]!.id);
    expect(triggers[0]).toHaveAttribute("aria-controls", textMenu.id);
    expect(triggers[0]).toHaveAttribute("aria-expanded", "true");
    expect(triggers[1]).toHaveAttribute("aria-expanded", "false");
    expect(triggers[1]).not.toHaveAttribute("aria-controls");
    expect(
      within(textMenu).queryByRole("option", { name: "is greater than" }),
    ).toBeNull();

    fireEvent.keyDown(screen.getByTestId("modal-content"), { key: "Escape" });

    expect(triggers[0]).not.toHaveAttribute("aria-controls");

    const numberMenu: HTMLElement = openMenuForRow(1);

    // Only ever one listbox open across the whole form.
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    expect(numberMenu).toHaveAttribute("aria-labelledby", triggers[1]!.id);
    expect(triggers[1]).toHaveAttribute("aria-controls", numberMenu.id);
    expect(triggers[0]).toHaveAttribute("aria-expanded", "false");
    expect(triggers[1]).toHaveAttribute("aria-expanded", "true");
    expect(
      within(numberMenu).queryByRole("option", { name: "is greater than" }),
    ).not.toBeNull();
    expect(
      within(numberMenu).queryByRole("option", { name: "contains" }),
    ).toBeNull();

    fireEvent.keyDown(screen.getByTestId("modal-content"), { key: "Escape" });

    expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
  });

  test("unmounting the modal takes the portalled menu with it", () => {
    const harness: RenderedHarness = renderHarness(withTextValue("acme"));

    openMenuForRow(0);

    expect(
      document.querySelectorAll(`[data-testid="${MENU_TEST_ID}"]`),
    ).toHaveLength(1);

    harness.unmount();

    // The menu is not a descendant of the React root, so this is a real risk.
    expect(
      document.querySelectorAll(`[data-testid="${MENU_TEST_ID}"]`),
    ).toHaveLength(0);
    expect(screen.queryByTestId("modal")).toBeNull();
  });
});
