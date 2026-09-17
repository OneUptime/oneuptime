import AutocompleteTextInput, {
  SUGGESTIONS_MENU_MAX_HEIGHT_IN_PX,
  SUGGESTIONS_MENU_Z_INDEX,
} from "../../../UI/Components/AutocompleteTextInput/AutocompleteTextInput";
import Modal from "../../../UI/Components/Modal/Modal";
/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const INPUT_TEST_ID: string = "attribute-key";
const MENU_TEST_ID: string = `${INPUT_TEST_ID}-suggestions`;

const SUGGESTIONS: Array<string> = [
  "k8s.cluster.name",
  "k8s.namespace.name",
  "service.name",
];

const ORIGINAL_INNER_WIDTH: number = window.innerWidth;
const ORIGINAL_INNER_HEIGHT: number = window.innerHeight;
const originalGetBoundingClientRect: () => DOMRect =
  Element.prototype.getBoundingClientRect;

/*
 * jsdom performs no layout, so every rect comes back zero-sized. These helpers
 * let a test describe where the input sits inside a viewport of a given size,
 * which is the only input the positioning logic reads.
 */
function setViewportSize(width: number, height: number): void {
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
}

/*
 * The component measures its wrapper div, so the stub answers for whichever
 * element directly wraps the input under test and defers everything else to
 * jsdom.
 */
function stubTriggerRect(rect: {
  top: number;
  left: number;
  width: number;
  height: number;
}): void {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const input: Element | null = this.querySelector(
      `[data-testid="${INPUT_TEST_ID}"]`,
    );

    if (input && input.parentElement === this) {
      return {
        top: rect.top,
        bottom: rect.top + rect.height,
        left: rect.left,
        right: rect.left + rect.width,
        width: rect.width,
        height: rect.height,
        x: rect.left,
        y: rect.top,
        toJSON: (): Record<string, unknown> => {
          return {};
        },
      } as DOMRect;
    }

    return originalGetBoundingClientRect.call(this);
  };
}

function renderInput(
  overrides: Partial<React.ComponentProps<typeof AutocompleteTextInput>> = {},
): void {
  render(
    <AutocompleteTextInput
      dataTestId={INPUT_TEST_ID}
      suggestions={SUGGESTIONS}
      {...overrides}
    />,
  );
}

/*
 * The real defect: the "Filter <Resource>" modal body is a scroll container
 * (`overflow-y-auto` in Modal.tsx), so an absolutely positioned menu was
 * clipped to it. Rendering through the actual Modal keeps that regression
 * honest rather than approximating it with a hand-rolled wrapper.
 */
function renderInputInsideModal(): void {
  render(
    <Modal title="Filter Logs">
      <AutocompleteTextInput
        dataTestId={INPUT_TEST_ID}
        suggestions={SUGGESTIONS}
      />
    </Modal>,
  );
}

function getInput(): HTMLElement {
  return screen.getByTestId(INPUT_TEST_ID);
}

function getMenu(): HTMLElement {
  return screen.getByTestId(MENU_TEST_ID);
}

function openMenu(): HTMLElement {
  fireEvent.focus(getInput());
  return getMenu();
}

function getOptions(): Array<HTMLElement> {
  return screen.getAllByRole("option");
}

describe("AutocompleteTextInput suggestion menu", () => {
  beforeEach(() => {
    setViewportSize(1440, 900);
    stubTriggerRect({ top: 200, left: 300, width: 240, height: 36 });
  });

  afterEach(() => {
    cleanup();
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    setViewportSize(ORIGINAL_INNER_WIDTH, ORIGINAL_INNER_HEIGHT);
  });

  describe("escaping clipping ancestors", () => {
    test("portals the menu to document.body instead of the input wrapper", () => {
      renderInput();

      const menu: HTMLElement = openMenu();

      expect(menu.parentElement).toBe(document.body);
      expect(getInput().parentElement?.contains(menu)).toBe(false);
    });

    test("renders outside the modal's scrolling body", () => {
      /*
       * Regression: with `absolute` positioning the list was painted inside
       * `modal-content`, whose `overflow-y-auto` cropped it to a sliver when the
       * filter row sat in the lower half of a scrolled modal.
       */
      renderInputInsideModal();

      const menu: HTMLElement = openMenu();
      const modalBody: HTMLElement = screen.getByTestId("modal-content");

      expect(modalBody).toHaveClass("overflow-y-auto");
      expect(modalBody.contains(menu)).toBe(false);
      expect(screen.getByTestId("modal").contains(menu)).toBe(false);
      expect(menu.parentElement).toBe(document.body);
    });

    test("is fixed positioned so no ancestor's overflow can clip it", () => {
      renderInput();

      const menu: HTMLElement = openMenu();

      expect(menu.style.position).toBe("fixed");
      expect(menu.className).not.toContain("absolute");
    });

    test("draws above modal surfaces at the shared dropdown z-index", () => {
      renderInput();

      // Modal surfaces are z-50; react-select portals its menu at 60 too.
      expect(SUGGESTIONS_MENU_Z_INDEX).toBe(60);
      expect(openMenu().style.zIndex).toBe(String(SUGGESTIONS_MENU_Z_INDEX));
    });

    test("removes the portalled menu from the document once closed", () => {
      renderInput();
      openMenu();

      fireEvent.mouseDown(document.body);

      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    });
  });

  describe("positioning", () => {
    test("anchors below the input and matches its width", () => {
      renderInput();

      const menu: HTMLElement = openMenu();

      // 200 top + 36 height + 4px offset.
      expect(menu.style.top).toBe("240px");
      expect(menu.style.left).toBe("300px");
      expect(menu.style.width).toBe("240px");
      expect(menu.getAttribute("data-placement")).toBe("below");
    });

    test("caps its height at the max-h-56 the menu used to carry as a class", () => {
      renderInput();

      expect(SUGGESTIONS_MENU_MAX_HEIGHT_IN_PX).toBe(224);
      expect(openMenu().style.maxHeight).toBe(
        `${SUGGESTIONS_MENU_MAX_HEIGHT_IN_PX}px`,
      );
    });

    test("flips above the input when there is no room below", () => {
      // 60px of room below the input, 796px above it.
      stubTriggerRect({ top: 800, left: 300, width: 240, height: 36 });
      renderInput();

      const menu: HTMLElement = openMenu();

      expect(menu.getAttribute("data-placement")).toBe("above");
      expect(menu.style.maxHeight).toBe("224px");
      // 800 top - 4 offset - 224 height.
      expect(menu.style.top).toBe("572px");
    });

    test("shrinks to the space available when flipped up", () => {
      // 300px above the input: 300 - 4 offset - 8 padding = 288, capped at 224.
      stubTriggerRect({ top: 300, left: 300, width: 240, height: 36 });
      setViewportSize(1440, 400);
      renderInput();

      const menu: HTMLElement = openMenu();

      expect(menu.getAttribute("data-placement")).toBe("above");
      expect(menu.style.maxHeight).toBe("224px");
      // 300 - 4 offset - 224 height.
      expect(menu.style.top).toBe("72px");
    });

    test("shrinks rather than overflowing when neither side has full room", () => {
      setViewportSize(1440, 300);
      stubTriggerRect({ top: 100, left: 300, width: 240, height: 36 });
      renderInput();

      const menu: HTMLElement = openMenu();

      // 300 - 136 bottom - 4 offset - 8 padding = 152px of usable space below.
      expect(menu.getAttribute("data-placement")).toBe("below");
      expect(menu.style.maxHeight).toBe("152px");
    });

    test("clamps to the viewport when the input sits near the right edge", () => {
      setViewportSize(1000, 900);
      stubTriggerRect({ top: 200, left: 900, width: 240, height: 36 });
      renderInput();

      const menu: HTMLElement = openMenu();

      // 1000 viewport - 240 width - 8 padding.
      expect(menu.style.left).toBe("752px");
    });

    test("never positions the menu off the left edge", () => {
      stubTriggerRect({ top: 200, left: -50, width: 240, height: 36 });
      renderInput();

      expect(openMenu().style.left).toBe("8px");
    });

    test("narrows the menu on a viewport smaller than the input", () => {
      setViewportSize(320, 900);
      stubTriggerRect({ top: 200, left: 0, width: 400, height: 36 });
      renderInput();

      const menu: HTMLElement = openMenu();

      // 320 viewport minus 8px of padding on each side.
      expect(menu.style.width).toBe("304px");
      expect(menu.style.left).toBe("8px");
    });

    test("repositions when an ancestor scroll container scrolls", () => {
      renderInput();

      expect(openMenu().style.top).toBe("240px");

      /*
       * Scrolling the modal body does not bubble to window, which is why the
       * listener has to be registered in the capture phase.
       */
      act(() => {
        stubTriggerRect({ top: 120, left: 300, width: 240, height: 36 });
        document.body.dispatchEvent(new Event("scroll", { bubbles: false }));
      });

      expect(getMenu().style.top).toBe("160px");
    });

    test("repositions when the window is resized", () => {
      renderInput();

      expect(openMenu().style.left).toBe("300px");

      act(() => {
        setViewportSize(500, 900);
        window.dispatchEvent(new Event("resize"));
      });

      // 500 viewport - 240 width - 8 padding.
      expect(getMenu().style.left).toBe("252px");
    });

    test("stops listening for layout changes once the menu closes", () => {
      const removedEvents: Array<string> = [];
      const originalRemoveEventListener: typeof window.removeEventListener =
        window.removeEventListener.bind(window);

      window.removeEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ): void => {
        removedEvents.push(type);
        originalRemoveEventListener(type, listener, options);
      }) as typeof window.removeEventListener;

      try {
        renderInput();
        openMenu();
        fireEvent.mouseDown(document.body);

        expect(removedEvents).toContain("scroll");
        expect(removedEvents).toContain("resize");
      } finally {
        window.removeEventListener = originalRemoveEventListener;
      }
    });

    test("ignores layout events fired after the menu closed", () => {
      renderInput();
      openMenu();
      fireEvent.mouseDown(document.body);

      act(() => {
        setViewportSize(400, 400);
        window.dispatchEvent(new Event("resize"));
        document.body.dispatchEvent(new Event("scroll"));
      });

      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    });
  });

  describe("portal-aware outside click", () => {
    test("keeps the menu open while pressing a suggestion in the portal", () => {
      renderInput();
      const menu: HTMLElement = openMenu();

      /*
       * The menu is no longer a descendant of the component's wrapper, so a
       * container-only `contains()` check would treat this as an outside click
       * and unmount the option before its click handler ever ran.
       */
      fireEvent.mouseDown(getOptions()[0]!);

      expect(screen.queryByTestId(MENU_TEST_ID)).toBe(menu);
    });

    test("selects a suggestion clicked inside the portal", () => {
      const onChange: (value: string) => void = jest.fn();
      renderInput({ onChange: onChange });
      openMenu();

      fireEvent.mouseDown(getOptions()[1]!);
      fireEvent.click(getOptions()[1]!);

      expect(onChange).toHaveBeenCalledWith("k8s.namespace.name");
      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
      expect(getInput()).toHaveValue("k8s.namespace.name");
    });

    test("closes when clicking elsewhere in the modal", () => {
      renderInputInsideModal();
      openMenu();

      fireEvent.mouseDown(screen.getByTestId("modal-title"));

      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    });

    test("stays open when clicking the input itself", () => {
      renderInput();
      openMenu();

      fireEvent.mouseDown(getInput());

      expect(screen.queryByTestId(MENU_TEST_ID)).not.toBeNull();
    });
  });

  describe("keyboard contract outside the modal focus trap", () => {
    test("keeps focus on the input so Modal's trap still owns Tab", () => {
      renderInputInsideModal();
      const input: HTMLElement = getInput();
      openMenu();

      /*
       * Modal builds its focus trap from `modalRef.current.querySelectorAll`,
       * so portalled options can never be part of it. Holding them out of the
       * tab order keeps Tab cycling the modal's own controls.
       */
      getOptions().forEach((option: HTMLElement) => {
        expect(option).toHaveAttribute("tabindex", "-1");
      });
      expect(screen.getByTestId("modal").contains(input)).toBe(true);
    });

    test("moves the highlight down with ArrowDown", () => {
      renderInput();
      const input: HTMLElement = getInput();
      openMenu();

      fireEvent.keyDown(input, { key: "ArrowDown" });

      expect(getOptions()[0]).toHaveAttribute("aria-selected", "true");
      expect(input).toHaveAttribute(
        "aria-activedescendant",
        getOptions()[0]!.id,
      );
    });

    test("wraps the highlight to the last option with ArrowUp", () => {
      renderInput();
      openMenu();

      fireEvent.keyDown(getInput(), { key: "ArrowUp" });

      expect(getOptions()[SUGGESTIONS.length - 1]).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    test("picks the highlighted option with Enter", () => {
      const onChange: (value: string) => void = jest.fn();
      renderInput({ onChange: onChange });
      const input: HTMLElement = getInput();
      openMenu();

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onChange).toHaveBeenCalledWith("k8s.namespace.name");
      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
    });

    test("closes the menu on Escape without closing the modal", () => {
      /*
       * Modal listens for Escape on the document and bails on
       * `event.defaultPrevented`, so the menu must mark the key as handled.
       * Otherwise one Escape would take the whole filter dialog down with it.
       */
      const onClose: () => void = jest.fn();
      render(
        <Modal title="Filter Logs" onClose={onClose}>
          <AutocompleteTextInput
            dataTestId={INPUT_TEST_ID}
            suggestions={SUGGESTIONS}
          />
        </Modal>,
      );
      openMenu();

      fireEvent.keyDown(getInput(), { key: "Escape" });

      expect(screen.queryByTestId(MENU_TEST_ID)).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });

    test("leaves Escape to the modal once the menu is closed", () => {
      const onClose: () => void = jest.fn();
      render(
        <Modal title="Filter Logs" onClose={onClose}>
          <AutocompleteTextInput
            dataTestId={INPUT_TEST_ID}
            suggestions={SUGGESTIONS}
          />
        </Modal>,
      );
      openMenu();

      // First Escape is swallowed by the menu, the second reaches the dialog.
      fireEvent.keyDown(getInput(), { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.keyDown(getInput(), { key: "Escape" });

      expect(onClose).toHaveBeenCalled();
    });

    test("points aria-controls at the portalled listbox", () => {
      renderInput();

      const menu: HTMLElement = openMenu();

      expect(getInput()).toHaveAttribute("aria-controls", menu.id);
      expect(getInput()).toHaveAttribute("aria-expanded", "true");
    });
  });

  describe("loading and filtering", () => {
    test("portals the loading row when suggestions are still being fetched", () => {
      renderInput({
        suggestions: [],
        isLoadingSuggestions: true,
        loadingMessage: "Loading attributes...",
      });

      const menu: HTMLElement = openMenu();

      expect(menu.parentElement).toBe(document.body);
      expect(menu).toHaveTextContent("Loading attributes...");
    });

    test("keeps the menu anchored as typing narrows the list", () => {
      renderInput();
      const input: HTMLElement = getInput();
      openMenu();

      fireEvent.change(input, { target: { value: "k8s" } });

      expect(getOptions()).toHaveLength(2);
      expect(getMenu().style.top).toBe("240px");
    });
  });
});
