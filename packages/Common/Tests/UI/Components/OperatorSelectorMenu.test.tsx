import OperatorSelector from "../../../UI/Components/Filters/OperatorSelector";
import FilterOperator, {
  FilterOperatorLabel,
} from "../../../UI/Components/Filters/Types/FilterOperator";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The filter form lives inside the modal body, which is a scroll container
 * (`overflow-y-auto`). An absolutely positioned menu is clipped by it, so the
 * options were invisible. The menu is portalled to document.body instead —
 * these tests pin that down, plus the fixed-position geometry that portalling
 * forces the component to compute by hand.
 *
 * jsdom hands back all-zero rects, so every geometry test stubs
 * getBoundingClientRect on BOTH the trigger button and its `relative
 * inline-block` wrapper. The wrapper is `inline-block` around the button, so in
 * a real browser the two rects are identical — stubbing both means these tests
 * assert "the menu is placed against the control" rather than "the menu is
 * placed against whichever node the component happens to measure today".
 *
 * Geometry constants mirrored from the component:
 *   MENU_MAX_HEIGHT 240, MENU_MIN_HEIGHT 120, MENU_WIDTH 224,
 *   MENU_GAP 4, VIEWPORT_MARGIN 8, z-index 60.
 */

const OPTIONS: Array<FilterOperator> = [
  FilterOperator.Contains,
  FilterOperator.DoesNotContain,
  FilterOperator.EqualTo,
];

const DEFAULT_VIEWPORT_WIDTH: number = 1024;
const DEFAULT_VIEWPORT_HEIGHT: number = 768;

const MENU_TEST_ID: string = "operator-selector-menu";

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

type StubRectFunction = (element: HTMLElement, values: RectValues) => void;

/*
 * Stubs the measured rect on one element only — no prototype spy to leak into
 * the next test.
 */
const stubRect: StubRectFunction = (
  element: HTMLElement,
  values: RectValues,
): void => {
  element.getBoundingClientRect = (): DOMRect => {
    return makeRect(values);
  };
};

interface RectCounter {
  count: number;
}

type StubCountingRectFunction = (
  elements: Array<HTMLElement>,
  values: RectValues,
  counter: RectCounter,
) => void;

/*
 * Same as stubRect, but records how many times the component measured. Used to
 * prove the scroll/resize listeners are actually gone (rather than just that
 * nothing rendered, which is true whether or not they leaked).
 */
const stubCountingRect: StubCountingRectFunction = (
  elements: Array<HTMLElement>,
  values: RectValues,
  counter: RectCounter,
): void => {
  for (const element of elements) {
    element.getBoundingClientRect = (): DOMRect => {
      counter.count = counter.count + 1;
      return makeRect(values);
    };
  }
};

type SetViewportFunction = (width: number, height: number) => void;

const setViewport: SetViewportFunction = (
  width: number,
  height: number,
): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
};

type SetPageScrollFunction = (scrollY: number) => void;

const setPageScroll: SetPageScrollFunction = (scrollY: number): void => {
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    writable: true,
    value: scrollY,
  });
  Object.defineProperty(window, "pageYOffset", {
    configurable: true,
    writable: true,
    value: scrollY,
  });
};

interface RenderedSelector {
  scrollContainer: HTMLElement;
  trigger: HTMLElement;
  // The component's `relative inline-block` wrapper.
  positionedParent: HTMLElement;
  unmount: () => void;
}

type RenderInScrollContainerFunction = (
  onChange: (value: FilterOperator) => void,
) => RenderedSelector;

const renderInScrollContainer: RenderInScrollContainerFunction = (
  onChange: (value: FilterOperator) => void,
): RenderedSelector => {
  const scrollContainer: HTMLDivElement = document.createElement("div");
  scrollContainer.style.overflowY = "auto";
  scrollContainer.style.height = "160px";
  document.body.appendChild(scrollContainer);

  const view: ReturnType<typeof render> = render(
    <OperatorSelector
      value={FilterOperator.Contains}
      options={OPTIONS}
      onChange={onChange}
    />,
    { container: scrollContainer },
  );

  const trigger: HTMLElement = screen.getByRole("button", {
    name: FilterOperatorLabel[FilterOperator.Contains],
  });

  return {
    scrollContainer: scrollContainer,
    trigger: trigger,
    positionedParent: trigger.parentElement as HTMLElement,
    unmount: view.unmount,
  };
};

type GetMenuFunction = () => HTMLElement;

const getMenu: GetMenuFunction = (): HTMLElement => {
  return screen.getByTestId(MENU_TEST_ID);
};

type QueryPortalledMenusFunction = () => Array<Element>;

const queryPortalledMenus: QueryPortalledMenusFunction = (): Array<Element> => {
  return Array.from(
    document.body.querySelectorAll(`[data-testid="${MENU_TEST_ID}"]`),
  );
};

type StubControlRectFunction = (
  rendered: RenderedSelector,
  rect: RectValues,
) => void;

const stubControlRect: StubControlRectFunction = (
  rendered: RenderedSelector,
  rect: RectValues,
): void => {
  stubRect(rendered.trigger, rect);
  stubRect(rendered.positionedParent, rect);
};

type OpenWithRectFunction = (
  rendered: RenderedSelector,
  rect: RectValues,
) => HTMLElement;

const openWithRect: OpenWithRectFunction = (
  rendered: RenderedSelector,
  rect: RectValues,
): HTMLElement => {
  stubControlRect(rendered, rect);
  fireEvent.click(rendered.trigger);
  return getMenu();
};

interface ListenerCall {
  handler: unknown;
  capture: unknown;
}

type FindListenerCallsFunction = (
  spy: ReturnType<typeof jest.spyOn>,
  eventName: string,
) => Array<ListenerCall>;

/*
 * addEventListener/removeEventListener must agree on BOTH the handler identity
 * and the capture flag, otherwise the DOM never actually detaches the
 * listener — so the assertions look at args 1 and 2, not just the event name.
 */
const findListenerCalls: FindListenerCallsFunction = (
  spy: ReturnType<typeof jest.spyOn>,
  eventName: string,
): Array<ListenerCall> => {
  const calls: Array<Array<unknown>> = spy.mock.calls as unknown as Array<
    Array<unknown>
  >;

  return calls
    .filter((call: Array<unknown>): boolean => {
      return call[0] === eventName;
    })
    .map((call: Array<unknown>): ListenerCall => {
      return { handler: call[1], capture: call[2] };
    });
};

type AppendOutsideInputFunction = () => HTMLInputElement;

const appendOutsideInput: AppendOutsideInputFunction = (): HTMLInputElement => {
  const input: HTMLInputElement = document.createElement("input");
  input.setAttribute("data-testid", "outside-input");
  document.body.appendChild(input);
  return input;
};

describe("OperatorSelector menu", () => {
  beforeEach(() => {
    // Every test establishes its own viewport rather than inheriting one.
    setViewport(DEFAULT_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_HEIGHT);
    setPageScroll(0);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    setViewport(DEFAULT_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_HEIGHT);
    setPageScroll(0);
    document.body.innerHTML = "";
  });

  describe("portalling out of the clipping scroll container", () => {
    test("closed trigger exposes the collapsed listbox contract", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
      expect(rendered.trigger.getAttribute("aria-haspopup")).toBe("listbox");
      expect(rendered.trigger.getAttribute("aria-expanded")).toBe("false");
      // aria-controls may only point at a menu that actually exists.
      expect(rendered.trigger.hasAttribute("aria-controls")).toBe(false);
    });

    test("open menu escapes the scroll container that would clip it", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      fireEvent.click(rendered.trigger);

      const menu: HTMLElement = getMenu();

      /*
       * The trigger stays inside the clipping container; the menu must not.
       * That pairing is the whole regression: same component, two different
       * subtrees.
       */
      expect(rendered.scrollContainer.contains(rendered.trigger)).toBe(true);
      expect(rendered.scrollContainer.contains(menu)).toBe(false);
      expect(menu.parentElement).toBe(document.body);
    });

    test("menu is a direct child of document.body, with no clipping ancestor", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      fireEvent.click(rendered.trigger);

      const menu: HTMLElement = getMenu();

      /*
       * The original bug rendered the menu inside the form, so the modal body's
       * `overflow-y-auto` cropped it. Nothing between the menu and <body> may
       * be able to clip it.
       */
      expect(menu.parentElement).toBe(document.body);

      const ancestors: Array<HTMLElement> = [];
      let current: HTMLElement | null = menu.parentElement;

      while (current) {
        ancestors.push(current);
        current = current.parentElement;
      }

      expect(ancestors).not.toContain(rendered.scrollContainer);
      expect(ancestors).not.toContain(rendered.positionedParent);
    });

    test("menu is position:fixed and stacks above the modal surface", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      fireEvent.click(rendered.trigger);

      const menu: HTMLElement = getMenu();

      // `fixed` takes the menu out of the scroll container's flow entirely.
      expect(menu.classList.contains("fixed")).toBe(true);
      expect(menu.classList.contains("absolute")).toBe(false);

      // Modal surfaces use z-50, so the menu has to beat that.
      expect(menu.style.zIndex).toBe("60");
    });

    test("portalled subtree adds no tab stops at the end of document.body", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      fireEvent.click(rendered.trigger);

      /*
       * The menu is appended after the whole page. If it or its options were
       * tabbable, Tab from anywhere on the page would eventually land in a
       * detached-looking listbox — and the programmatic focus handoff the
       * portal forced this component to own would be impossible.
       */
      expect(getMenu().getAttribute("tabindex")).toBe("-1");

      const options: Array<HTMLElement> = screen.getAllByRole("option");
      expect(options).toHaveLength(OPTIONS.length);

      for (const option of options) {
        expect(option.getAttribute("tabindex")).toBe("-1");
      }
    });

    test("menu carries the listbox contract while portalled away from the trigger", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      fireEvent.click(rendered.trigger);

      const menu: HTMLElement = getMenu();

      expect(menu.getAttribute("role")).toBe("listbox");
      // The portal breaks DOM ancestry, so the label has to be wired by id.
      expect(menu.getAttribute("aria-labelledby")).toBe(rendered.trigger.id);
      expect(rendered.trigger.getAttribute("aria-controls")).toBe(menu.id);
      expect(rendered.trigger.getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("options", () => {
    test("every option renders its FilterOperatorLabel and is selectable exactly once", () => {
      const onChange: (value: FilterOperator) => void = jest.fn();
      const rendered: RenderedSelector = renderInScrollContainer(onChange);

      fireEvent.click(rendered.trigger);

      const options: Array<HTMLElement> = screen.getAllByRole("option");

      expect(
        options.map((option: HTMLElement): string | null => {
          return option.textContent;
        }),
      ).toEqual(
        OPTIONS.map((operator: FilterOperator): string => {
          return FilterOperatorLabel[operator];
        }),
      );

      fireEvent.click(
        screen.getByRole("option", {
          name: FilterOperatorLabel[FilterOperator.DoesNotContain],
        }),
      );

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(FilterOperator.DoesNotContain);
      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();

      /*
       * The component is controlled: props.value did not change, so the trigger
       * must still read "contains". A component that shadowed the value in
       * local state would break every parent that re-derives the filter row.
       */
      expect(rendered.trigger.textContent).toBe(
        FilterOperatorLabel[FilterOperator.Contains],
      );
    });

    test("the selected option is the one marked aria-selected", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      fireEvent.click(rendered.trigger);

      const options: Array<HTMLElement> = screen.getAllByRole("option");

      expect(
        options.map((option: HTMLElement): string | null => {
          return option.getAttribute("aria-selected");
        }),
      ).toEqual(["true", "false", "false"]);
    });

    test("clicking outside closes the menu without stealing focus back", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());
      const outsideInput: HTMLInputElement = appendOutsideInput();

      fireEvent.click(rendered.trigger);
      getMenu();

      outsideInput.focus();
      fireEvent.mouseDown(outsideInput);

      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
      /*
       * The click itself decides where focus lands. Restoring focus to the
       * trigger here would yank it out of whatever the user just clicked.
       */
      expect(document.activeElement).toBe(outsideInput);
      expect(document.activeElement).not.toBe(rendered.trigger);
    });

    test("clicking inside the portalled menu does not close it", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      fireEvent.click(rendered.trigger);

      const menu: HTMLElement = getMenu();
      fireEvent.mouseDown(menu);

      expect(queryPortalledMenus()).toHaveLength(1);
      expect(rendered.trigger.getAttribute("aria-expanded")).toBe("true");
    });

    test("document-level Escape closes the portalled menu even when focus drifted outside it", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());
      const outsideInput: HTMLInputElement = appendOutsideInput();

      fireEvent.click(rendered.trigger);
      getMenu();

      // Focus is no longer inside the portalled subtree.
      outsideInput.focus();
      expect(document.activeElement).toBe(outsideInput);

      const bubbledToDocument: (event: KeyboardEvent) => void = jest.fn();
      document.addEventListener("keydown", bubbledToDocument);

      fireEvent.keyDown(outsideInput, { key: "Escape" });

      document.removeEventListener("keydown", bubbledToDocument);

      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
      expect(document.activeElement).toBe(rendered.trigger);
      /*
       * Modal.tsx closes the modal from its own document Escape handler. The
       * component's capture listener must stop propagation so this Escape only
       * closes the menu.
       */
      expect(bubbledToDocument).not.toHaveBeenCalled();
    });
  });

  describe("geometry", () => {
    test("opens downwards when there is room below the trigger", () => {
      setViewport(1024, 800);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      // bottom = 136, spaceBelow = 800 - 136 - 4 = 660, far more than 120.
      const menu: HTMLElement = openWithRect(rendered, {
        top: 100,
        left: 50,
        width: 130,
        height: 36,
      });

      expect(menu.style.top).toBe("140px");
      expect(menu.style.bottom).toBe("");
      expect(menu.style.left).toBe("50px");
      expect(menu.style.maxHeight).toBe("240px");
    });

    test("a scrolled page does not shift a fixed menu (no scrollY offset)", () => {
      setViewport(1024, 800);
      setPageScroll(500);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      /*
       * getBoundingClientRect is already viewport-relative and the menu is
       * position:fixed, so adding window.scrollY — the reflex left over from
       * the absolute-positioned original — would push the menu 500px off.
       */
      const menu: HTMLElement = openWithRect(rendered, {
        top: 100,
        left: 50,
        width: 130,
        height: 36,
      });

      expect(menu.style.top).toBe("140px");
      expect(menu.style.left).toBe("50px");
    });

    test("flips upwards when the trigger sits at the bottom of the viewport", () => {
      setViewport(1024, 600);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      /*
       * bottom = 596, spaceBelow = 0 (< 120) and spaceAbove = 556, so the menu
       * has to hang above the trigger instead of off the bottom edge.
       */
      const menu: HTMLElement = openWithRect(rendered, {
        top: 560,
        left: 100,
        width: 130,
        height: 36,
      });

      expect(menu.style.bottom).toBe("44px");
      expect(menu.style.top).toBe("");
      // The flipped menu measures against spaceAbove (556), so it stays full height.
      expect(menu.style.maxHeight).toBe("240px");
    });

    test("a flipped menu is bounded by the space above, not the space below", () => {
      setViewport(1024, 260);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      /*
       * spaceBelow = 260 - 236 - 4 = 20 (< 120) and spaceAbove = 196, so it
       * flips. 196 - 8 = 188 is the binding constraint — a height computed from
       * spaceBelow would clamp to the 120px floor instead.
       */
      const menu: HTMLElement = openWithRect(rendered, {
        top: 200,
        left: 100,
        width: 130,
        height: 36,
      });

      expect(menu.style.bottom).toBe("64px");
      expect(menu.style.top).toBe("");
      expect(menu.style.maxHeight).toBe("188px");
    });

    test("stays downwards when space below is tight but space above is tighter", () => {
      setViewport(1024, 160);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      /*
       * spaceBelow = 160 - 66 - 4 = 90 (< 120) but spaceAbove = 26, so flipping
       * up would show even less. Stay down and shrink to the 120px floor.
       */
      const menu: HTMLElement = openWithRect(rendered, {
        top: 30,
        left: 20,
        width: 130,
        height: 36,
      });

      expect(menu.style.top).toBe("70px");
      expect(menu.style.bottom).toBe("");
      expect(menu.style.maxHeight).toBe("120px");
    });

    test("maxHeight shrinks with the available space and never exceeds 240", () => {
      setViewport(1024, 400);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      // spaceBelow = 400 - 196 - 4 = 200, minus the 8px viewport margin.
      const menu: HTMLElement = openWithRect(rendered, {
        top: 160,
        left: 20,
        width: 130,
        height: 36,
      });

      expect(menu.style.maxHeight).toBe("192px");
    });

    test("a trigger wider than 224px keeps its own width", () => {
      setViewport(1024, 768);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      const menu: HTMLElement = openWithRect(rendered, {
        top: 100,
        left: 50,
        width: 300,
        height: 36,
      });

      expect(menu.style.width).toBe("300px");
    });

    test("a viewport narrower than 224px + margins caps the menu width", () => {
      setViewport(200, 768);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      // min(224, 200 - 16) = 184, which still beats the 130px trigger.
      const menu: HTMLElement = openWithRect(rendered, {
        top: 100,
        left: 8,
        width: 130,
        height: 36,
      });

      expect(menu.style.width).toBe("184px");
      expect(menu.style.left).toBe("8px");
    });

    test("clamps back inside the viewport at the right edge", () => {
      setViewport(1024, 768);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      // 950 + 224 = 1174 would overflow 1024 - 8.
      const menu: HTMLElement = openWithRect(rendered, {
        top: 100,
        left: 950,
        width: 130,
        height: 36,
      });

      expect(menu.style.left).toBe("792px");
      expect(menu.style.width).toBe("224px");
    });

    test("clamps back inside the viewport at the left edge", () => {
      setViewport(1024, 768);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      // A trigger scrolled partly off the left must not drag the menu with it.
      const menu: HTMLElement = openWithRect(rendered, {
        top: 100,
        left: -40,
        width: 130,
        height: 36,
      });

      expect(menu.style.left).toBe("8px");
    });

    test("geometry is recomputed on every re-open, never reused from the last one", () => {
      setViewport(1024, 800);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      const firstMenu: HTMLElement = openWithRect(rendered, {
        top: 100,
        left: 50,
        width: 130,
        height: 36,
      });

      expect(firstMenu.style.top).toBe("140px");

      // Close, then move the trigger (a modal-body scroll while closed).
      fireEvent.click(rendered.trigger);
      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();

      const secondMenu: HTMLElement = openWithRect(rendered, {
        top: 400,
        left: 210,
        width: 130,
        height: 36,
      });

      expect(secondMenu.style.top).toBe("440px");
      expect(secondMenu.style.left).toBe("210px");
    });
  });

  describe("following the trigger", () => {
    test("repositions when the window is resized", () => {
      setViewport(1024, 800);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      const menu: HTMLElement = openWithRect(rendered, {
        top: 100,
        left: 900,
        width: 130,
        height: 36,
      });

      expect(menu.style.left).toBe("792px");

      setViewport(600, 800);
      fireEvent(window, new Event("resize"));

      // 900 + 224 now overflows 600 - 8, so it clamps to 592 - 224.
      expect(getMenu().style.left).toBe("368px");
    });

    test("a resize recomputes width and maxHeight too, not just the horizontal clamp", () => {
      setViewport(1024, 800);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      const menu: HTMLElement = openWithRect(rendered, {
        top: 100,
        left: 900,
        width: 130,
        height: 36,
      });

      expect(menu.style.left).toBe("792px");
      expect(menu.style.width).toBe("224px");
      expect(menu.style.maxHeight).toBe("240px");

      setViewport(200, 300);
      fireEvent(window, new Event("resize"));

      const repositioned: HTMLElement = getMenu();

      // width = max(130, min(224, 200 - 16)) = 184; left clamps to 192 - 184 = 8.
      expect(repositioned.style.width).toBe("184px");
      expect(repositioned.style.left).toBe("8px");
      // spaceBelow = 300 - 136 - 4 = 160, minus the 8px margin.
      expect(repositioned.style.maxHeight).toBe("152px");
    });

    test("a resize can flip an already-open menu upwards", () => {
      setViewport(1024, 800);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      const menu: HTMLElement = openWithRect(rendered, {
        top: 200,
        left: 100,
        width: 130,
        height: 36,
      });

      expect(menu.style.top).toBe("240px");
      expect(menu.style.bottom).toBe("");

      setViewport(1024, 260);
      fireEvent(window, new Event("resize"));

      const repositioned: HTMLElement = getMenu();

      expect(repositioned.style.top).toBe("");
      expect(repositioned.style.bottom).toBe("64px");
      expect(repositioned.style.maxHeight).toBe("188px");
    });

    test("repositions on a non-bubbling scroll from an ancestor scroll container", () => {
      setViewport(1024, 800);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      const menu: HTMLElement = openWithRect(rendered, {
        top: 300,
        left: 50,
        width: 130,
        height: 36,
      });

      expect(menu.style.top).toBe("340px");

      // The modal body scrolled: the trigger moved, the fixed menu must follow.
      stubControlRect(rendered, {
        top: 120,
        left: 50,
        width: 130,
        height: 36,
      });

      /*
       * `scroll` does not bubble, so only a capture-phase window listener sees
       * this. That is exactly the listener the component must register.
       */
      const scrollEvent: Event = new Event("scroll", { bubbles: false });
      fireEvent(rendered.scrollContainer, scrollEvent);

      expect(getMenu().style.top).toBe("160px");
    });

    test("repositions on a page-level scroll dispatched at window and at document", () => {
      setViewport(1024, 800);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      const menu: HTMLElement = openWithRect(rendered, {
        top: 300,
        left: 50,
        width: 130,
        height: 36,
      });

      expect(menu.style.top).toBe("340px");

      stubControlRect(rendered, {
        top: 220,
        left: 50,
        width: 130,
        height: 36,
      });
      fireEvent(window, new Event("scroll"));

      expect(getMenu().style.top).toBe("260px");

      stubControlRect(rendered, {
        top: 60,
        left: 50,
        width: 130,
        height: 36,
      });
      fireEvent(document, new Event("scroll", { bubbles: false }));

      expect(getMenu().style.top).toBe("100px");
    });

    test("stops measuring once the menu has closed", () => {
      setViewport(1024, 800);

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());
      const counter: RectCounter = { count: 0 };

      stubCountingRect(
        [rendered.trigger, rendered.positionedParent],
        { top: 300, left: 50, width: 130, height: 36 },
        counter,
      );

      fireEvent.click(rendered.trigger);
      expect(getMenu().style.top).toBe("340px");
      expect(counter.count).toBeGreaterThan(0);

      fireEvent.click(rendered.trigger);
      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();

      counter.count = 0;

      fireEvent(
        rendered.scrollContainer,
        new Event("scroll", { bubbles: false }),
      );
      fireEvent(window, new Event("scroll"));
      fireEvent(window, new Event("resize"));

      /*
       * A leaked listener would still run updateMenuPosition (and so measure)
       * even though nothing renders — that is invisible to a render assertion,
       * but not to this one.
       */
      expect(counter.count).toBe(0);
    });
  });

  describe("listener and portal lifecycle", () => {
    test("scroll and resize listeners are added on open and removed — same handler, same capture flag — on close", () => {
      const addSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        window,
        "addEventListener",
      );
      const removeSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        window,
        "removeEventListener",
      );

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      fireEvent.click(rendered.trigger);

      const scrollAdds: Array<ListenerCall> = findListenerCalls(
        addSpy,
        "scroll",
      );
      const resizeAdds: Array<ListenerCall> = findListenerCalls(
        addSpy,
        "resize",
      );

      expect(scrollAdds).toHaveLength(1);
      expect(resizeAdds).toHaveLength(1);
      // Ancestor scroll does not bubble, so the scroll listener must capture.
      expect(scrollAdds[0]?.capture).toBe(true);
      expect(findListenerCalls(removeSpy, "scroll")).toHaveLength(0);
      expect(findListenerCalls(removeSpy, "resize")).toHaveLength(0);

      fireEvent.click(rendered.trigger);

      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();

      const scrollRemoves: Array<ListenerCall> = findListenerCalls(
        removeSpy,
        "scroll",
      );
      const resizeRemoves: Array<ListenerCall> = findListenerCalls(
        removeSpy,
        "resize",
      );

      expect(scrollRemoves).toHaveLength(1);
      expect(resizeRemoves).toHaveLength(1);

      /*
       * removeEventListener only detaches when the handler identity AND the
       * capture flag match the add. Counting names alone would let a live
       * capture listener leak on every open.
       */
      expect(scrollRemoves[0]?.handler).toBe(scrollAdds[0]?.handler);
      expect(scrollRemoves[0]?.capture).toBe(true);
      expect(resizeRemoves[0]?.handler).toBe(resizeAdds[0]?.handler);
      expect(resizeRemoves[0]?.capture).toBe(resizeAdds[0]?.capture);
    });

    test("listeners are removed when the component unmounts while open", () => {
      const addSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        window,
        "addEventListener",
      );
      const removeSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        window,
        "removeEventListener",
      );

      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      fireEvent.click(rendered.trigger);

      const scrollAdds: Array<ListenerCall> = findListenerCalls(
        addSpy,
        "scroll",
      );
      const resizeAdds: Array<ListenerCall> = findListenerCalls(
        addSpy,
        "resize",
      );
      expect(scrollAdds).toHaveLength(1);
      expect(resizeAdds).toHaveLength(1);

      rendered.unmount();

      const scrollRemoves: Array<ListenerCall> = findListenerCalls(
        removeSpy,
        "scroll",
      );
      const resizeRemoves: Array<ListenerCall> = findListenerCalls(
        removeSpy,
        "resize",
      );

      expect(scrollRemoves).toHaveLength(1);
      expect(scrollRemoves[0]?.handler).toBe(scrollAdds[0]?.handler);
      expect(scrollRemoves[0]?.capture).toBe(true);
      expect(resizeRemoves).toHaveLength(1);
      expect(resizeRemoves[0]?.handler).toBe(resizeAdds[0]?.handler);
    });

    test("the portal node leaves document.body when the menu closes", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());
      const bodyChildrenBefore: number = document.body.childElementCount;

      fireEvent.click(rendered.trigger);
      expect(queryPortalledMenus()).toHaveLength(1);
      expect(document.body.childElementCount).toBe(bodyChildrenBefore + 1);

      fireEvent.mouseDown(document.body);

      expect(queryPortalledMenus()).toHaveLength(0);
      expect(document.body.childElementCount).toBe(bodyChildrenBefore);
    });

    test("repeated open/close cycles do not accumulate portal nodes", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());
      const bodyChildrenBefore: number = document.body.childElementCount;

      for (let cycle: number = 0; cycle < 3; cycle = cycle + 1) {
        fireEvent.click(rendered.trigger);
        expect(queryPortalledMenus()).toHaveLength(1);
        expect(document.body.childElementCount).toBe(bodyChildrenBefore + 1);

        fireEvent.click(rendered.trigger);
        expect(queryPortalledMenus()).toHaveLength(0);
        expect(document.body.childElementCount).toBe(bodyChildrenBefore);
      }
    });

    test("the portal node leaves document.body when the component unmounts while open", () => {
      const rendered: RenderedSelector = renderInScrollContainer(jest.fn());

      fireEvent.click(rendered.trigger);
      expect(queryPortalledMenus()).toHaveLength(1);

      rendered.unmount();

      expect(queryPortalledMenus()).toHaveLength(0);
    });
  });

  describe("two selectors on the same form", () => {
    interface RenderedPair {
      scrollContainer: HTMLElement;
      triggerA: HTMLElement;
      triggerB: HTMLElement;
      parentA: HTMLElement;
      parentB: HTMLElement;
      unmount: () => void;
    }

    type RenderPairFunction = () => RenderedPair;

    const renderPair: RenderPairFunction = (): RenderedPair => {
      const scrollContainer: HTMLDivElement = document.createElement("div");
      scrollContainer.style.overflowY = "auto";
      document.body.appendChild(scrollContainer);

      const view: ReturnType<typeof render> = render(
        <div>
          <OperatorSelector
            value={FilterOperator.Contains}
            options={OPTIONS}
            onChange={jest.fn()}
          />
          <OperatorSelector
            value={FilterOperator.EqualTo}
            options={OPTIONS}
            onChange={jest.fn()}
          />
        </div>,
        { container: scrollContainer },
      );

      const triggerA: HTMLElement = screen.getByRole("button", {
        name: FilterOperatorLabel[FilterOperator.Contains],
      });
      const triggerB: HTMLElement = screen.getByRole("button", {
        name: FilterOperatorLabel[FilterOperator.EqualTo],
      });

      return {
        scrollContainer: scrollContainer,
        triggerA: triggerA,
        triggerB: triggerB,
        parentA: triggerA.parentElement as HTMLElement,
        parentB: triggerB.parentElement as HTMLElement,
        unmount: view.unmount,
      };
    };

    type StubPairRectsFunction = (pair: RenderedPair) => void;

    const stubPairRects: StubPairRectsFunction = (pair: RenderedPair): void => {
      stubRect(pair.triggerA, { top: 100, left: 20, width: 130, height: 36 });
      stubRect(pair.parentA, { top: 100, left: 20, width: 130, height: 36 });
      stubRect(pair.triggerB, { top: 300, left: 600, width: 130, height: 36 });
      stubRect(pair.parentB, { top: 300, left: 600, width: 130, height: 36 });
    };

    type MenuForFunction = (trigger: HTMLElement) => HTMLElement;

    const menuFor: MenuForFunction = (trigger: HTMLElement): HTMLElement => {
      const menus: Array<Element> = queryPortalledMenus();

      const match: Element | undefined = menus.find(
        (menu: Element): boolean => {
          return menu.getAttribute("aria-labelledby") === trigger.id;
        },
      );

      if (!match) {
        throw new Error(`No portalled menu found for trigger ${trigger.id}`);
      }

      return match as HTMLElement;
    };

    test("a real pointer press on the second trigger closes the first menu", () => {
      setViewport(1024, 800);

      const pair: RenderedPair = renderPair();
      stubPairRects(pair);

      fireEvent.mouseDown(pair.triggerA);
      fireEvent.click(pair.triggerA);
      expect(queryPortalledMenus()).toHaveLength(1);

      /*
       * A browser fires mousedown before click, and that mousedown is what the
       * first selector's outside handler sees — so only one operator menu can
       * ever be open at a time in the real app.
       */
      fireEvent.mouseDown(pair.triggerB);
      fireEvent.click(pair.triggerB);

      const menus: Array<Element> = queryPortalledMenus();
      expect(menus).toHaveLength(1);
      expect(menus[0]).toBe(menuFor(pair.triggerB));
      expect(pair.triggerA.getAttribute("aria-expanded")).toBe("false");
      expect(pair.triggerB.getAttribute("aria-expanded")).toBe("true");
    });

    test("each menu is positioned from its own trigger", () => {
      setViewport(1024, 800);

      const pair: RenderedPair = renderPair();
      stubPairRects(pair);

      fireEvent.click(pair.triggerA);
      fireEvent.click(pair.triggerB);

      expect(queryPortalledMenus()).toHaveLength(2);

      const menuA: HTMLElement = menuFor(pair.triggerA);
      const menuB: HTMLElement = menuFor(pair.triggerB);

      expect(menuA.style.left).toBe("20px");
      expect(menuA.style.top).toBe("140px");
      expect(menuB.style.left).toBe("600px");
      expect(menuB.style.top).toBe("340px");

      // Distinct ids, so aria-controls cannot cross-wire the two listboxes.
      expect(menuA.id).not.toBe(menuB.id);
      expect(pair.triggerA.getAttribute("aria-controls")).toBe(menuA.id);
      expect(pair.triggerB.getAttribute("aria-controls")).toBe(menuB.id);
    });

    test("closing one menu leaves the other open and where it was", () => {
      setViewport(1024, 800);

      const pair: RenderedPair = renderPair();
      stubPairRects(pair);

      fireEvent.click(pair.triggerA);
      fireEvent.click(pair.triggerB);
      expect(queryPortalledMenus()).toHaveLength(2);

      fireEvent.click(pair.triggerA);

      const remaining: Array<Element> = queryPortalledMenus();
      expect(remaining).toHaveLength(1);

      const menuB: HTMLElement = menuFor(pair.triggerB);
      expect(menuB.style.left).toBe("600px");
      expect(menuB.style.top).toBe("340px");
      expect(pair.triggerA.getAttribute("aria-expanded")).toBe("false");
      expect(pair.triggerB.getAttribute("aria-expanded")).toBe("true");
    });

    test("a resize repositions both menus against their own triggers", () => {
      setViewport(1024, 800);

      const pair: RenderedPair = renderPair();

      stubRect(pair.triggerA, { top: 100, left: 20, width: 130, height: 36 });
      stubRect(pair.parentA, { top: 100, left: 20, width: 130, height: 36 });
      stubRect(pair.triggerB, { top: 300, left: 900, width: 130, height: 36 });
      stubRect(pair.parentB, { top: 300, left: 900, width: 130, height: 36 });

      fireEvent.click(pair.triggerA);
      fireEvent.click(pair.triggerB);

      expect(menuFor(pair.triggerB).style.left).toBe("792px");

      setViewport(600, 800);
      fireEvent(window, new Event("resize"));

      // A still fits where it was; B has to clamp against the new right edge.
      expect(menuFor(pair.triggerA).style.left).toBe("20px");
      expect(menuFor(pair.triggerB).style.left).toBe("368px");
    });

    test("unmounting the tree removes both portal nodes", () => {
      setViewport(1024, 800);

      const pair: RenderedPair = renderPair();
      stubPairRects(pair);

      fireEvent.click(pair.triggerA);
      fireEvent.click(pair.triggerB);
      expect(queryPortalledMenus()).toHaveLength(2);

      pair.unmount();

      expect(queryPortalledMenus()).toHaveLength(0);
    });
  });
});
