import Modal from "../../../UI/Components/Modal/Modal";
import SideOver, {
  ComponentProps,
  SideOverSize,
} from "../../../UI/Components/SideOver/SideOver";
/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
import "@testing-library/jest-dom";
import { resetPageScrollLockForTesting } from "../../../UI/Utils/PageScrollLock";
import {
  fireEvent,
  render,
  RenderResult,
  screen,
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
 * SideOver is the app's right-hand drawer. Most of what is pinned below comes
 * straight out of issue #3134: the panel used to sit at z-10 inside whatever
 * container rendered it, so a network map's zoom toolbar (z-20) painted on top
 * of an open device panel, and the page kept its own scrollbar live down the
 * panel's right edge. The layering is now structural — a portal out of the
 * caller's DOM plus one deliberate z-index — so it is worth asserting the
 * structure rather than just the classes.
 */

/*
 * The de-facto layering ladder of this app, pinned here because nothing else
 * writes it down in one place. SideOver has to clear every tier of page chrome
 * and stay under every app-wide overlay; both halves are load-bearing.
 */
const SIDE_OVER_Z_INDEX: number = 30;
const PAGE_CHROME_Z_INDEXES: Array<number> = [
  10 /* MasterPage sticky header */, 20 /* topology + logs viewer toolbars */,
];
const OVERLAY_Z_INDEXES_ABOVE_SIDE_OVER: Array<number> = [
  40 /* Toast, AIChatPanel */, 50 /* Modal */, 60 /* portalled dropdowns */,
];

type ZIndexOfFunction = (element: HTMLElement) => number | null;

const zIndexOf: ZIndexOfFunction = (element: HTMLElement): number | null => {
  const match: RegExpMatchArray | null = element.className.match(
    /(?:^|\s)z-(\d+)(?:\s|$)/,
  );

  return match && match[1] !== undefined ? Number(match[1]) : null;
};

type SetFullscreenElementFunction = (element: Element | null) => void;

/*
 * jsdom implements no Fullscreen API at all, so both the property and the
 * event it is announced with have to be faked. The panel follows
 * document.fullscreenElement because only the fullscreen element's own subtree
 * reaches the browser's top layer.
 */
const setFullscreenElement: SetFullscreenElementFunction = (
  element: Element | null,
): void => {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: element,
  });
  fireEvent(document, new Event("fullscreenchange"));
};

describe("SideOver", () => {
  const childElementText: string = "child element";
  const childElement: ReactElement = <div key={0}>{childElementText}</div>;

  const props: ComponentProps = {
    title: "title",
    description: "description",
    onClose: jest.fn(),
    onSubmit: jest.fn(),
    children: childElement,
  };

  type RenderComponentFunction = (props: ComponentProps) => RenderResult;

  const renderComponent: RenderComponentFunction = (
    props: ComponentProps,
  ): RenderResult => {
    return render(<SideOver {...props} />);
  };

  beforeEach(() => {
    resetPageScrollLockForTesting();
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  afterEach(() => {
    jest.clearAllMocks();
    setFullscreenElement(null);
    resetPageScrollLockForTesting();
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  /*
   * ------------------------------------------------------------------
   * Existing contract
   * ------------------------------------------------------------------
   */

  test("should display title", () => {
    renderComponent(props);

    const title: HTMLElement = screen.getByText(props.title);
    expect(title).toBeInTheDocument();
    expect(title).toHaveClass("text-lg font-medium text-gray-900");
  });

  test("should display description", () => {
    renderComponent(props);

    const description: HTMLElement = screen.getByText(props.description);
    expect(description).toBeInTheDocument();
    expect(description).toHaveClass("text-sm text-gray-500");
  });

  test("should close the call onClose when 'Close Panel' button is clicked", () => {
    renderComponent(props);

    const closePanelButton: HTMLElement = screen.getByText("Close panel");
    expect(closePanelButton).toBeInTheDocument();

    fireEvent.click(closePanelButton);
    expect(props.onClose).toHaveBeenCalled();
  });

  test("should render children component passed in the props", () => {
    renderComponent(props);

    expect(screen.getByText(childElementText)).toBeInTheDocument();
  });

  test("should render leftFooterElement when passed in the props", () => {
    const leftFooterElementText: string = "left element";
    const leftFooterElement: ReactElement = (
      <div key={0}>{leftFooterElementText}</div>
    );

    renderComponent({ ...props, leftFooterElement });

    expect(screen.getByText(leftFooterElementText)).toBeInTheDocument();
  });

  test("should call onClose when Close button is clicked", () => {
    renderComponent(props);

    const cancelButton: HTMLElement = screen.getByText("Close");
    expect(cancelButton).toBeInTheDocument();

    fireEvent.click(cancelButton);
    expect(props.onClose).toHaveBeenCalled();
  });

  test("should use submitButtonText value passed in the props for submit button text", () => {
    const submitButtonText: string = "Submit";

    renderComponent({ ...props, submitButtonText });

    expect(screen.getByText(submitButtonText)).toBeInTheDocument();
  });

  test("should disable Save button", () => {
    renderComponent({ ...props, submitButtonDisabled: true });

    const saveButton: HTMLElement = screen.getByText("Save");

    expect(saveButton).toBeInTheDocument();
    expect(saveButton).toBeDisabled();
  });

  test("should call onSubmit when Save button is clicked", () => {
    renderComponent(props);

    const saveButton: HTMLElement = screen.getByText("Save");
    expect(saveButton).toBeInTheDocument();

    fireEvent.click(saveButton);
    expect(props.onSubmit).toHaveBeenCalled();
  });

  /*
   * ------------------------------------------------------------------
   * Layering — issue #3134
   * ------------------------------------------------------------------
   */

  describe("layering", () => {
    test("puts the panel above page chrome and below every app-wide overlay", () => {
      renderComponent(props);

      const root: HTMLElement = screen.getByTestId("side-over");

      expect(zIndexOf(root)).toBe(SIDE_OVER_Z_INDEX);

      for (const chrome of PAGE_CHROME_Z_INDEXES) {
        expect(SIDE_OVER_Z_INDEX).toBeGreaterThan(chrome);
      }

      for (const overlay of OVERLAY_Z_INDEXES_ABOVE_SIDE_OVER) {
        expect(SIDE_OVER_Z_INDEX).toBeLessThan(overlay);
      }
    });

    test("no longer sits at z-10, which lost to the map toolbar's z-20", () => {
      renderComponent(props);

      expect(screen.getByTestId("side-over")).not.toHaveClass("z-10");
    });

    test("portals out of the caller's DOM so no ancestor can trap it in a stacking context", () => {
      const { container }: RenderResult = renderComponent(props);

      const root: HTMLElement = screen.getByTestId("side-over");

      expect(container).not.toContainElement(root);
      expect(root.parentElement).toBe(document.body);
    });

    test("escapes a z-indexed ancestor, which is how the map toolbar ended up on top of it", () => {
      /*
       * The reported reproduction, in miniature: the panel is rendered as a
       * sibling of a toolbar inside a card, and the toolbar outranks it. While
       * the panel stayed inside that subtree no z-index on it could win,
       * because the whole subtree resolved against the same ancestor.
       */
      render(
        <div className="relative" data-testid="map-card">
          <div
            className="absolute right-2 top-2 z-20"
            data-testid="map-toolbar"
          >
            zoom controls
          </div>
          <SideOver {...props} />
        </div>,
      );

      const card: HTMLElement = screen.getByTestId("map-card");
      const root: HTMLElement = screen.getByTestId("side-over");

      expect(card).toContainElement(screen.getByTestId("map-toolbar"));
      expect(card).not.toContainElement(root);
      expect(root.parentElement).toBe(document.body);
    });

    test("leaves nothing between the fixed layer and the document body except the one z-indexed root", () => {
      renderComponent(props);

      const root: HTMLElement = screen.getByTestId("side-over");
      const layer: HTMLElement = screen.getByTestId("side-over-layer");

      expect(layer.parentElement).toBe(root);

      /*
       * Every ancestor above the root must be free of anything that would
       * create a stacking context, or the root's z-30 would be resolved
       * against that ancestor instead of against the page. This is the actual
       * shape of the #3134 bug, so walk it rather than trusting the classes.
       */
      let ancestor: HTMLElement | null = root.parentElement;

      while (ancestor && ancestor !== document.documentElement) {
        expect(zIndexOf(ancestor)).toBeNull();
        expect(ancestor.className).not.toMatch(
          /(^|\s)(transform|opacity-\d+|filter|isolate|backdrop-blur)(\s|$)/,
        );
        ancestor = ancestor.parentElement;
      }
    });

    test("renders the panel layer over the whole viewport but only takes pointer events on the panel itself", () => {
      renderComponent(props);

      const layer: HTMLElement = screen.getByTestId("side-over-layer");

      expect(layer).toHaveClass("fixed", "inset-0", "pointer-events-none");
      expect(layer).toHaveClass("justify-end");
      expect(layer.firstElementChild).toHaveClass("pointer-events-auto");
    });

    test("keeps a single element in the root — the vestigial backdrop divs are gone", () => {
      renderComponent(props);

      const root: HTMLElement = screen.getByTestId("side-over");

      expect(root.children).toHaveLength(1);
      expect(root.firstElementChild).toBe(
        screen.getByTestId("side-over-layer"),
      );
    });

    test("follows the fullscreen element, because only its subtree reaches the top layer", () => {
      const fullscreenHost: HTMLDivElement = document.createElement("div");
      document.body.appendChild(fullscreenHost);

      renderComponent(props);

      expect(screen.getByTestId("side-over").parentElement).toBe(document.body);

      setFullscreenElement(fullscreenHost);

      expect(screen.getByTestId("side-over").parentElement).toBe(
        fullscreenHost,
      );

      setFullscreenElement(null);

      expect(screen.getByTestId("side-over").parentElement).toBe(document.body);

      document.body.removeChild(fullscreenHost);
    });

    test("mounts straight into the fullscreen element when one is already open", () => {
      const fullscreenHost: HTMLDivElement = document.createElement("div");
      document.body.appendChild(fullscreenHost);
      setFullscreenElement(fullscreenHost);

      renderComponent(props);

      expect(screen.getByTestId("side-over").parentElement).toBe(
        fullscreenHost,
      );

      setFullscreenElement(null);
      document.body.removeChild(fullscreenHost);
    });
  });

  /*
   * ------------------------------------------------------------------
   * Scrollbars — the other half of issue #3134
   * ------------------------------------------------------------------
   */

  describe("scrolling", () => {
    test("scrolls the body on demand instead of painting a permanent dead track", () => {
      renderComponent(props);

      const content: HTMLElement = screen.getByTestId("side-over-content");

      expect(content).toHaveClass("overflow-y-auto");
      expect(content).not.toHaveClass("overflow-y-scroll");
    });

    test("contains overscroll so wheeling past the end does not scroll the page underneath", () => {
      renderComponent(props);

      expect(screen.getByTestId("side-over-content")).toHaveClass(
        "overscroll-contain",
      );
    });

    test("sizes the panel against its container rather than 100vw, which includes the scrollbar", () => {
      renderComponent(props);

      const panel: HTMLElement | null = screen.getByTestId("side-over-layer")
        .firstElementChild as HTMLElement;

      expect(panel).toHaveClass("w-full");
      expect(panel).not.toHaveClass("w-screen");
    });

    test("hides the page scrollbar while open and puts it back on close", () => {
      document.body.style.overflow = "auto";

      const rendered: RenderResult = renderComponent(props);

      expect(document.body.style.overflow).toBe("hidden");

      rendered.unmount();

      expect(document.body.style.overflow).toBe("auto");
    });

    test("leaves the page alone when the scroll lock is disabled", () => {
      document.body.style.overflow = "auto";

      const rendered: RenderResult = renderComponent({
        ...props,
        disablePageScrollLock: true,
      });

      expect(document.body.style.overflow).toBe("auto");

      rendered.unmount();

      expect(document.body.style.overflow).toBe("auto");
    });

    test("shares one lock with Modal, so a modal closing inside a panel does not unlock the page", () => {
      document.body.style.overflow = "auto";

      const rendered: RenderResult = render(
        <SideOver {...props}>
          <div key={0}>
            <Modal title="Nested" onClose={jest.fn()}>
              <div>Nested modal content</div>
            </Modal>
          </div>
        </SideOver>,
      );

      expect(document.body.style.overflow).toBe("hidden");

      /*
       * Re-render without the modal: the panel is still open, so the page must
       * stay locked. Two private counters would restore "auto" here.
       */
      rendered.rerender(
        <SideOver {...props}>
          <div key={0} />
        </SideOver>,
      );

      expect(document.body.style.overflow).toBe("hidden");

      rendered.unmount();

      expect(document.body.style.overflow).toBe("auto");
    });

    test("keeps the page locked while a modal outlives the panel that opened it", () => {
      document.body.style.overflow = "auto";

      const panel: RenderResult = renderComponent(props);
      const modal: RenderResult = render(
        <Modal title="Standalone" onClose={jest.fn()}>
          <div>Standalone modal content</div>
        </Modal>,
      );

      expect(document.body.style.overflow).toBe("hidden");

      panel.unmount();

      expect(document.body.style.overflow).toBe("hidden");

      modal.unmount();

      expect(document.body.style.overflow).toBe("auto");
    });

    test("restores the page exactly once when two panels are open together", () => {
      document.body.style.overflow = "auto";

      const first: RenderResult = renderComponent(props);
      const second: RenderResult = renderComponent(props);

      expect(document.body.style.overflow).toBe("hidden");

      first.unmount();

      expect(document.body.style.overflow).toBe("hidden");

      second.unmount();

      expect(document.body.style.overflow).toBe("auto");
    });
  });

  /*
   * ------------------------------------------------------------------
   * Dialog semantics
   * ------------------------------------------------------------------
   */

  describe("dialog semantics", () => {
    test("does not claim to be modal, because the page behind it stays interactive", () => {
      renderComponent(props);

      const root: HTMLElement = screen.getByTestId("side-over");

      expect(root).toHaveAttribute("role", "dialog");
      expect(root).not.toHaveAttribute("aria-modal");
    });

    test("stays out of Modal's dialog stack so an open modal keeps its Escape key", () => {
      const onModalClose: () => void = jest.fn();

      /*
       * The modal is rendered FIRST and the panel portals to the end of
       * <body>, so with aria-modal="true" the panel would be the last dialog
       * in tree order and Modal would decide it was no longer topmost.
       */
      render(
        <Modal title="Settings" onClose={onModalClose}>
          <div>Modal content</div>
        </Modal>,
      );
      renderComponent(props);

      fireEvent.keyDown(document, { key: "Escape" });

      expect(onModalClose).toHaveBeenCalled();
    });

    test("labels itself with the title it actually rendered", () => {
      renderComponent(props);

      const root: HTMLElement = screen.getByTestId("side-over");
      const title: HTMLElement = screen.getByTestId("side-over-title");

      expect(title.id).toBeTruthy();
      expect(root).toHaveAttribute("aria-labelledby", title.id);
    });

    test("no longer uses a hardcoded id, so two panels do not announce the same title", () => {
      renderComponent(props);
      renderComponent({ ...props, title: "second title" });

      const [firstTitle, secondTitle] = screen.getAllByTestId(
        "side-over-title",
      ) as [HTMLElement, HTMLElement];

      expect(firstTitle.id).not.toBe("slide-over-title");
      expect(secondTitle.id).not.toBe("slide-over-title");
      expect(firstTitle.id).not.toBe(secondTitle.id);

      const [firstRoot, secondRoot] = screen.getAllByTestId("side-over") as [
        HTMLElement,
        HTMLElement,
      ];

      expect(firstRoot).toHaveAttribute("aria-labelledby", firstTitle.id);
      expect(secondRoot).toHaveAttribute("aria-labelledby", secondTitle.id);
    });

    test("wires the description into the accessible description", () => {
      renderComponent(props);

      const root: HTMLElement = screen.getByTestId("side-over");
      const description: HTMLElement = screen.getByTestId(
        "side-over-description",
      );

      expect(root).toHaveAttribute("aria-describedby", description.id);
    });

    test("names the close button so a shared focus helper can skip it", () => {
      renderComponent(props);

      const closeButton: HTMLElement = screen.getByTestId("close-button");

      expect(closeButton).toHaveAttribute("title", "Close panel");

      fireEvent.click(closeButton);

      expect(props.onClose).toHaveBeenCalled();
    });
  });

  /*
   * ------------------------------------------------------------------
   * Sizing
   * ------------------------------------------------------------------
   */

  describe("size", () => {
    type ExpectWidthClassFunction = (
      size: SideOverSize | undefined,
      widthClass: string,
    ) => void;

    const expectWidthClass: ExpectWidthClassFunction = (
      size: SideOverSize | undefined,
      widthClass: string,
    ): void => {
      const rendered: RenderResult = renderComponent(
        size === undefined ? props : { ...props, size },
      );

      const panel: HTMLElement = screen.getByTestId("side-over-layer")
        .firstElementChild as HTMLElement;

      expect(panel).toHaveClass(widthClass);

      rendered.unmount();
    };

    test("maps each size onto the width it has always had", () => {
      expectWidthClass(undefined, "max-w-2xl");
      expectWidthClass(SideOverSize.Small, "max-w-2xl");
      expectWidthClass(SideOverSize.Medium, "max-w-5xl");
      expectWidthClass(SideOverSize.Large, "max-w-7xl");
    });
  });
});
