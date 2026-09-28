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
  waitFor,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Edit modal of an incident's, alert's or scheduled maintenance's
 * Affected Resources card. The picker's results panel used to be an
 * `absolute` child of the picker, inside Modal's `overflow-y-auto` body. An
 * absolutely positioned child counts towards its scroll container's
 * scrollable area but not towards its height, so opening the list grew the
 * modal a scrollbar and hid the lower half of the results until the user
 * scrolled the modal.
 *
 * The panel is now `position: fixed`, placed by measuring the search input -
 * the way EntityDropdown places its menu - and it is still a DOM child of the
 * picker, so the picker's outside-press check, Modal's Tab trap and Modal's
 * backdrop containment check all still see it as inside.
 *
 * Two dismissal bugs lived next to it and are pinned here too: Escape to
 * close the list also closed the modal, and a press on the backdrop to close
 * the list also closed the modal - either way taking the unsaved edits.
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
  DropdownAnchorRect,
  DropdownPosition,
  getDropdownPosition,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DROPDOWN_MENU_Z_INDEX from "../../../UI/Components/Dropdown/DropdownMenuZIndex";
import Modal from "../../../UI/Components/Modal/Modal";
import { wasPressConsumedByAnAnchoredPopup } from "../../../UI/Types/LayeredDismissal";

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

// The height one row of chips adds above the input, in the fake layout.
const CHIP_ROW_HEIGHT_PX: number = 30;
const INPUT_HEIGHT_PX: number = 38;

/*
 * A stand-in for the API: every list request answers with the rows seeded for
 * its model type (the Labels tab asks for Label, which has none).
 */
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

/*
 * Resize and scroll only schedule a measurement for the next animation frame.
 * Frames are queued here and run on demand, so a test decides exactly when
 * the panel catches up with the input.
 */
let nextFrameId: number = 0;
let pendingFrames: Map<number, FrameRequestCallback> = new Map();

const flushFrames: () => void = (): void => {
  act(() => {
    const callbacks: Array<FrameRequestCallback> = Array.from(
      pendingFrames.values(),
    );
    pendingFrames = new Map();
    for (const callback of callbacks) {
      callback(0);
    }
  });
};

const originalInnerWidth: number = window.innerWidth;
const originalInnerHeight: number = window.innerHeight;

const setViewport: (width: number, height: number) => void = (
  width: number,
  height: number,
): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
};

const makeRect: (
  left: number,
  top: number,
  width: number,
  height: number,
) => DOMRect = (
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect => {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: (): Record<string, never> => {
      return {};
    },
  } as DOMRect;
};

const getInput: () => HTMLInputElement = (): HTMLInputElement => {
  return screen.getByRole("combobox") as HTMLInputElement;
};

const getDropdown: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("affected-resources-dropdown");
};

const queryDropdown: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId("affected-resources-dropdown");
};

/*
 * Every call reads the rect through `rectFor`, so a test can move the input
 * between measurements - which is exactly what scrolling or a new chip row
 * does in a browser.
 */
type RectProvider = () => DOMRect;

const measureInputWith: (rectFor: RectProvider) => MockFunction = (
  rectFor: RectProvider,
): MockFunction => {
  const measure: MockFunction = getJestMockFunction();
  measure.mockImplementation((): DOMRect => {
    return rectFor();
  });
  jest
    .spyOn(getInput(), "getBoundingClientRect")
    .mockImplementation((): DOMRect => {
      return measure() as DOMRect;
    });
  return measure;
};

// A real pointer press: Modal watches both ends of it.
const press: (element: Element) => void = (element: Element): void => {
  fireEvent.mouseDown(element);
  fireEvent.mouseUp(element);
  fireEvent.click(element);
};

// The layer a user presses around the panel; the tinted sheet is inert.
const getBackdropLayer: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("modal").parentElement!;
};

const countChips: () => number = (): number => {
  return document.querySelectorAll('button[aria-label^="Remove "]').length;
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

interface ModalHarness {
  onClose: MockFunction;
  onPayload: MockFunction;
}

const renderInModal: () => ModalHarness = (): ModalHarness => {
  const onClose: MockFunction = getJestMockFunction();
  const onPayload: MockFunction = getJestMockFunction();

  render(
    <Modal
      title="Edit Affected Resources"
      onClose={() => {
        onClose();
      }}
    >
      <PickerHarness
        onPayload={(payload: AffectedResourcesPayload): void => {
          onPayload(payload);
        }}
      />
    </Modal>,
  );

  return { onClose, onPayload };
};

// Opens the list and waits for the suggestions, so no update lands late.
const openList: () => Promise<void> = async (): Promise<void> => {
  fireEvent.focus(getInput());
  await screen.findByRole("option", { name: MONITOR_NAME });
};

beforeEach(() => {
  rowsByModel = new Map();
  rowsByModel.set(Monitor, [
    { _id: MONITOR_ID, name: MONITOR_NAME },
    { _id: SECOND_MONITOR_ID, name: SECOND_MONITOR_NAME },
  ]);
  getListMock.mockReset();
  getListMock.mockImplementation((...args: Array<unknown>) => {
    return fakeGetList(args[0] as GetListArgs);
  });

  nextFrameId = 0;
  pendingFrames = new Map();
  jest
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback: FrameRequestCallback): number => {
      nextFrameId += 1;
      pendingFrames.set(nextFrameId, callback);
      return nextFrameId;
    });
  jest
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((frameId: number): void => {
      pendingFrames.delete(frameId);
    });

  setViewport(1000, 800);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  setViewport(originalInnerWidth, originalInnerHeight);
});

describe("getDropdownPosition", () => {
  interface PlacementCase {
    name: string;
    anchor: DropdownAnchorRect;
    viewport: [number, number];
    expected: DropdownPosition;
  }

  const placementCases: Array<PlacementCase> = [
    {
      name: "opens below the input, as wide as it, at most 384px tall",
      anchor: { top: 200, bottom: 238, left: 120, width: 320 },
      viewport: [1000, 800],
      expected: {
        top: 242,
        bottom: undefined,
        left: 120,
        width: 320,
        maxHeight: 384,
      },
    },
    {
      name: "shrinks to the room below when that is still useful",
      anchor: { top: 200, bottom: 238, left: 120, width: 320 },
      viewport: [1000, 500],
      // 500 - 238 - 4 (gap) - 8 (viewport padding)
      expected: {
        top: 242,
        bottom: undefined,
        left: 120,
        width: 320,
        maxHeight: 250,
      },
    },
    {
      name: "flips above when the room below is too small and there is more above",
      anchor: { top: 520, bottom: 558, left: 120, width: 320 },
      viewport: [1000, 600],
      // bottom is measured from the viewport's bottom edge: 600 - 520 + 4
      expected: {
        top: undefined,
        bottom: 84,
        left: 120,
        width: 320,
        maxHeight: 384,
      },
    },
    {
      name: "stays below when the room above is smaller still",
      anchor: { top: 100, bottom: 138, left: 120, width: 320 },
      viewport: [1000, 300],
      // below: 300 - 138 - 12 = 150; above: 100 - 12 = 88
      expected: {
        top: 142,
        bottom: undefined,
        left: 120,
        width: 320,
        maxHeight: 150,
      },
    },
    {
      name: "flipped above, it is only as tall as the room above",
      anchor: { top: 200, bottom: 238, left: 120, width: 320 },
      viewport: [1000, 300],
      // below: 300 - 238 - 12 = 50; above: 200 - 12 = 188
      expected: {
        top: undefined,
        bottom: 104,
        left: 120,
        width: 320,
        maxHeight: 188,
      },
    },
    {
      name: "is never wider than the viewport, less its padding",
      anchor: { top: 100, bottom: 138, left: 0, width: 500 },
      viewport: [300, 800],
      expected: {
        top: 142,
        bottom: undefined,
        left: 8,
        width: 284,
        maxHeight: 384,
      },
    },
    {
      name: "is pulled back inside the viewport's right edge",
      anchor: { top: 100, bottom: 138, left: 900, width: 320 },
      viewport: [1000, 800],
      // 1000 - 8 - 320
      expected: {
        top: 142,
        bottom: undefined,
        left: 672,
        width: 320,
        maxHeight: 384,
      },
    },
    {
      name: "is pushed right of the viewport's left padding",
      anchor: { top: 100, bottom: 138, left: -40, width: 320 },
      viewport: [1000, 800],
      expected: {
        top: 142,
        bottom: undefined,
        left: 8,
        width: 320,
        maxHeight: 384,
      },
    },
  ];

  test.each(placementCases)("$name", (placementCase: PlacementCase) => {
    expect(
      getDropdownPosition(
        placementCase.anchor,
        placementCase.viewport[0],
        placementCase.viewport[1],
      ),
    ).toEqual(placementCase.expected);
  });

  test("the room below and the room above are never negative", () => {
    const position: DropdownPosition = getDropdownPosition(
      { top: -200, bottom: -162, left: 120, width: 320 },
      1000,
      800,
    );

    // Scrolled off the top: below is the only room there is.
    expect(position.top).toBe(-158);
    expect(position.bottom).toBeUndefined();
    expect(position.maxHeight).toBe(384);
    expect(
      getDropdownPosition(
        { top: 10, bottom: 790, left: 120, width: 320 },
        1000,
        800,
      ).maxHeight,
    ).toBe(0);
  });
});

describe("the results panel is fixed against the search input", () => {
  test("it is laid out fixed from the input's rect, above modal surfaces", async () => {
    render(<PickerHarness />);
    measureInputWith((): DOMRect => {
      return makeRect(120, 200, 320, INPUT_HEIGHT_PX);
    });

    await openList();

    const dropdown: HTMLElement = getDropdown();

    /*
     * Not absolute, not `w-full` / `max-h-96`: those laid it out against the
     * picker, inside whatever scroll container held the picker.
     */
    expect(dropdown).toHaveClass("fixed");
    expect(dropdown).not.toHaveClass("absolute");
    expect(dropdown).not.toHaveClass("w-full");
    expect(dropdown).not.toHaveClass("max-h-96");
    expect(dropdown).toHaveAttribute("role", "listbox");
    expect(dropdown.style.top).toBe("242px");
    expect(dropdown.style.bottom).toBe("");
    expect(dropdown.style.left).toBe("120px");
    expect(dropdown.style.width).toBe("320px");
    expect(dropdown.style.maxHeight).toBe("384px");
    expect(dropdown.style.visibility).toBe("visible");
    expect(dropdown.style.zIndex).toBe(String(DROPDOWN_MENU_Z_INDEX));
  });

  test("it is still a DOM child of the picker, not portalled", async () => {
    render(<PickerHarness />);
    await openList();

    const picker: HTMLElement = getInput().parentElement!;

    expect(picker.contains(getDropdown())).toBe(true);
    expect(getDropdown().parentElement).toBe(picker);
  });

  test("it flips above an input near the bottom of the viewport", async () => {
    setViewport(1000, 600);
    render(<PickerHarness />);
    measureInputWith((): DOMRect => {
      return makeRect(120, 520, 320, INPUT_HEIGHT_PX);
    });

    await openList();

    const dropdown: HTMLElement = getDropdown();

    expect(dropdown.style.top).toBe("");
    expect(dropdown.style.bottom).toBe("84px");
    expect(dropdown.style.left).toBe("120px");
    expect(dropdown.style.maxHeight).toBe("384px");
    expect(dropdown.style.visibility).toBe("visible");
  });

  test("it is clamped to a narrow viewport", async () => {
    setViewport(300, 800);
    render(<PickerHarness />);
    measureInputWith((): DOMRect => {
      return makeRect(0, 100, 500, INPUT_HEIGHT_PX);
    });

    await openList();

    expect(getDropdown().style.left).toBe("8px");
    expect(getDropdown().style.width).toBe("284px");
  });

  test("it stays hidden until it has been measured, every time it opens", async () => {
    render(<PickerHarness />);

    /*
     * The first commit has no position yet. Read the panel's visibility at the
     * moment the input is measured: that is the frame it would otherwise be
     * painted at the viewport's top left corner.
     */
    const visibilityWhenMeasured: Array<string> = [];
    measureInputWith((): DOMRect => {
      visibilityWhenMeasured.push(
        (
          document.querySelector(
            '[data-testid="affected-resources-dropdown"]',
          ) as HTMLElement | null
        )?.style.visibility || "not rendered",
      );
      return makeRect(120, 200, 320, INPUT_HEIGHT_PX);
    });

    await openList();

    expect(visibilityWhenMeasured[0]).toBe("hidden");
    expect(getDropdown().style.visibility).toBe("visible");

    // Closing drops the old position, so reopening is hidden until measured too.
    fireEvent.keyDown(getInput(), { key: "Escape" });
    expect(queryDropdown()).toBeNull();

    visibilityWhenMeasured.length = 0;
    fireEvent.change(getInput(), { target: { value: "C" } });

    expect(visibilityWhenMeasured[0]).toBe("hidden");
    expect(getDropdown().style.visibility).toBe("visible");
    await screen.findByRole("option", { name: MONITOR_NAME });
  });

  test("it follows the input when a scroll container scrolls", async () => {
    render(
      <div data-testid="scroll-container" style={{ overflowY: "auto" }}>
        <PickerHarness />
      </div>,
    );
    let inputTop: number = 200;
    measureInputWith((): DOMRect => {
      return makeRect(120, inputTop, 320, INPUT_HEIGHT_PX);
    });

    await openList();
    expect(getDropdown().style.top).toBe("242px");

    /*
     * Scroll does not bubble, so only a capture-phase listener hears a scroll
     * container other than the page - the modal body, most importantly.
     */
    inputTop = 120;
    fireEvent.scroll(screen.getByTestId("scroll-container"));

    // Nothing moves before the frame the update was scheduled for.
    expect(getDropdown().style.top).toBe("242px");

    flushFrames();

    expect(getDropdown().style.top).toBe("162px");
  });

  test("it follows the input when the window is resized", async () => {
    render(<PickerHarness />);
    measureInputWith((): DOMRect => {
      return makeRect(120, 520, 320, INPUT_HEIGHT_PX);
    });

    await openList();
    expect(getDropdown().style.top).toBe("562px");

    // A shorter window leaves too little room below: it flips above.
    setViewport(1000, 600);
    fireEvent(window, new Event("resize"));
    flushFrames();

    expect(getDropdown().style.top).toBe("");
    expect(getDropdown().style.bottom).toBe("84px");
  });

  test("several scrolls in one frame measure once", async () => {
    render(<PickerHarness />);
    const measure: MockFunction = measureInputWith((): DOMRect => {
      return makeRect(120, 200, 320, INPUT_HEIGHT_PX);
    });

    await openList();
    measure.mockClear();

    fireEvent.scroll(document);
    fireEvent.scroll(document);
    fireEvent.scroll(document);
    flushFrames();

    expect(measure).toHaveBeenCalledTimes(1);
  });

  test("a pick that adds a chip row above the input moves the panel down with it, and removing it moves it back", async () => {
    render(<PickerHarness />);
    measureInputWith((): DOMRect => {
      return makeRect(
        120,
        200 + (countChips() > 0 ? CHIP_ROW_HEIGHT_PX : 0),
        320,
        INPUT_HEIGHT_PX,
      );
    });

    await openList();
    expect(getDropdown().style.top).toBe("242px");

    // No scroll, no resize: only the new chip moved the input.
    press(screen.getByRole("option", { name: MONITOR_NAME }));

    expect(
      await screen.findByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    ).toBeInTheDocument();
    expect(getDropdown().style.top).toBe(`${242 + CHIP_ROW_HEIGHT_PX}px`);

    // Backspace on the empty input removes the chip again.
    fireEvent.keyDown(getInput(), { key: "Backspace" });

    await waitFor(() => {
      expect(countChips()).toBe(0);
    });
    expect(getDropdown().style.top).toBe("242px");
  });

  test("switching to the Labels tab measures again", async () => {
    render(<PickerHarness />);
    let inputTop: number = 200;
    measureInputWith((): DOMRect => {
      return makeRect(120, inputTop, 320, INPUT_HEIGHT_PX);
    });

    await openList();
    expect(getDropdown().style.top).toBe("242px");

    inputTop = 260;
    press(screen.getByRole("tab", { name: /Labels/ }));

    expect(screen.getByRole("tab", { name: /Labels/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(getDropdown().style.top).toBe("302px");
    await screen.findByText(/No labels found in this project/);
  });

  test("once the list closes it stops listening for scroll and resize", async () => {
    render(<PickerHarness />);
    const measure: MockFunction = measureInputWith((): DOMRect => {
      return makeRect(120, 200, 320, INPUT_HEIGHT_PX);
    });

    await openList();
    fireEvent.keyDown(getInput(), { key: "Escape" });
    expect(queryDropdown()).toBeNull();
    measure.mockClear();

    fireEvent.scroll(document);
    fireEvent(window, new Event("resize"));
    flushFrames();

    expect(pendingFrames.size).toBe(0);
    expect(measure).not.toHaveBeenCalled();
  });

  test("a read-only picker has no input to measure and no panel", () => {
    render(
      <AffectedResourcesPicker
        monitors={[MONITOR_ID] as unknown as Array<Monitor>}
        resourceTypes={["Monitor"]}
        readOnly={true}
        onChange={(): void => {}}
      />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(queryDropdown()).toBeNull();
  });
});

describe("inside the Edit modal", () => {
  test("the panel is inside the modal's DOM, so the modal's focus trap and containment check see it", async () => {
    renderInModal();
    await openList();

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(modal.contains(getDropdown())).toBe(true);
    expect(modal.contains(screen.getByRole("tab", { name: /Labels/ }))).toBe(
      true,
    );
    // Laid out against the viewport, so the modal body's scroll area is untouched.
    expect(getDropdown()).toHaveClass("fixed");
  });

  test("the panel follows the input when the modal body scrolls", async () => {
    renderInModal();
    await openList();

    let inputTop: number = 300;
    measureInputWith((): DOMRect => {
      return makeRect(120, inputTop, 320, INPUT_HEIGHT_PX);
    });

    fireEvent.scroll(screen.getByTestId("modal-content"));
    flushFrames();
    expect(getDropdown().style.top).toBe("342px");

    inputTop = 250;
    fireEvent.scroll(screen.getByTestId("modal-content"));
    flushFrames();
    expect(getDropdown().style.top).toBe("292px");
  });

  test("picking an option inside the panel selects it and leaves the modal open", async () => {
    const harness: ModalHarness = renderInModal();
    await openList();

    press(screen.getByRole("option", { name: SECOND_MONITOR_NAME }));

    expect(harness.onPayload).toHaveBeenCalledTimes(1);
    expect(
      (harness.onPayload.mock.calls[0]![0] as AffectedResourcesPayload)
        .monitors,
    ).toEqual([SECOND_MONITOR_ID]);
    expect(
      await screen.findByRole("button", {
        name: `Remove ${SECOND_MONITOR_NAME}`,
      }),
    ).toBeInTheDocument();
    // The press was inside the picker: the list stays open for the next pick.
    expect(getDropdown()).toBeInTheDocument();
    expect(harness.onClose).not.toHaveBeenCalled();
  });

  test("the first Escape closes only the list; the modal and its unsaved edits stay", async () => {
    const harness: ModalHarness = renderInModal();
    await openList();

    // An edit the user has not saved yet.
    press(screen.getByRole("option", { name: MONITOR_NAME }));
    await screen.findByRole("button", { name: `Remove ${MONITOR_NAME}` });

    const wasNotPrevented: boolean = fireEvent.keyDown(getInput(), {
      key: "Escape",
    });

    // Handled, so Modal's document listener ignores it.
    expect(wasNotPrevented).toBe(false);
    expect(queryDropdown()).toBeNull();
    expect(harness.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    ).toBeInTheDocument();

    // With the list already closed, Escape is the modal's again.
    fireEvent.keyDown(getInput(), { key: "Escape" });

    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape from a control inside the panel closes only the list and returns focus to the input", async () => {
    const harness: ModalHarness = renderInModal();
    await openList();

    // A keyboard user who tabbed from the input onto the panel's Labels tab.
    const labelsTab: HTMLElement = screen.getByRole("tab", { name: /Labels/ });
    act(() => {
      labelsTab.focus();
    });
    expect(labelsTab).toHaveFocus();

    const wasNotPrevented: boolean = fireEvent.keyDown(labelsTab, {
      key: "Escape",
    });

    expect(wasNotPrevented).toBe(false);
    expect(queryDropdown()).toBeNull();
    expect(harness.onClose).not.toHaveBeenCalled();
    // Back on the input, and moving focus there did not reopen the list.
    expect(getInput()).toHaveFocus();
    expect(getInput()).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(getInput(), { key: "Escape" });

    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  test("a backdrop press with the list open closes only the list", async () => {
    const harness: ModalHarness = renderInModal();
    await openList();

    press(getBackdropLayer());

    expect(queryDropdown()).toBeNull();
    expect(harness.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();

    // With the list gone, the next backdrop press dismisses as usual.
    press(getBackdropLayer());

    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  test("a press elsewhere in the modal closes the list and nothing else", async () => {
    const harness: ModalHarness = renderInModal();
    await openList();

    press(screen.getByTestId("modal-title"));

    expect(queryDropdown()).toBeNull();
    expect(harness.onClose).not.toHaveBeenCalled();
  });

  test("the close button still closes the modal while the list is open", async () => {
    const harness: ModalHarness = renderInModal();
    await openList();

    press(screen.getByTestId("close-button"));

    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("pressing outside the picker", () => {
  /*
   * Records, for every press that reaches the document, whether a popup had
   * claimed it by then - what Modal's backdrop handler asks.
   */
  let afterEachCleanups: Array<() => void> = [];

  const recordClaims: () => Array<boolean> = (): Array<boolean> => {
    const claims: Array<boolean> = [];
    const listener: (event: MouseEvent) => void = (event: MouseEvent): void => {
      claims.push(wasPressConsumedByAnAnchoredPopup(event));
    };
    document.addEventListener("mousedown", listener);
    afterEachCleanups.push((): void => {
      document.removeEventListener("mousedown", listener);
    });
    return claims;
  };

  afterEach(() => {
    for (const cleanupListener of afterEachCleanups) {
      cleanupListener();
    }
    afterEachCleanups = [];
  });

  test("with the list open, the press closes it and is claimed", async () => {
    render(
      <div>
        <p data-testid="elsewhere">Elsewhere on the page</p>
        <PickerHarness />
      </div>,
    );
    const claims: Array<boolean> = recordClaims();
    await openList();

    fireEvent.mouseDown(screen.getByTestId("elsewhere"));

    expect(claims).toEqual([true]);
    expect(queryDropdown()).toBeNull();
  });

  test("with the list closed, the press is left alone", async () => {
    render(
      <div>
        <p data-testid="elsewhere">Elsewhere on the page</p>
        <PickerHarness />
      </div>,
    );
    const claims: Array<boolean> = recordClaims();

    fireEvent.mouseDown(screen.getByTestId("elsewhere"));

    await openList();
    fireEvent.keyDown(getInput(), { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("elsewhere"));

    expect(claims).toEqual([false, false]);
  });

  test("a press inside the picker is not outside: the list stays open and the press is not claimed", async () => {
    render(<PickerHarness />);
    const claims: Array<boolean> = recordClaims();
    await openList();

    fireEvent.mouseDown(getInput());
    fireEvent.mouseDown(screen.getByRole("option", { name: MONITOR_NAME }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Labels/ }));

    expect(claims).toEqual([false, false, false]);
    expect(getDropdown()).toBeInTheDocument();
  });

  test("outside a modal too, Escape is claimed only while the list is open", async () => {
    render(<PickerHarness />);
    await openList();

    expect(fireEvent.keyDown(getInput(), { key: "Escape" })).toBe(false);
    expect(queryDropdown()).toBeNull();
    expect(fireEvent.keyDown(getInput(), { key: "Escape" })).toBe(true);
  });
});
