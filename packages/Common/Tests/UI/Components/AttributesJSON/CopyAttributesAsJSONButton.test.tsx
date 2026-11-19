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
import React, { ReactElement } from "react";
import CopyAttributesAsJSONButton from "../../../../UI/Components/AttributesJSON/CopyAttributesAsJSONButton";
import { LAYERED_POPOVER_CLASS_NAME } from "../../../../UI/Components/Tooltip/LayeredPopover";
import useComponentOutsideClick from "../../../../UI/Types/UseComponentOutsideClick";
import {
  ATTRIBUTES_JSON_FORMAT_PREFERENCE,
  resetPreferencesForTesting,
} from "../../../../UI/Components/AttributesJSON/AttributesJSONPreferences";
import Clipboard from "../../../../UI/Utils/Clipboard";

/*
 * "Copy JSON" on an attribute section. The main half copies in the viewer's
 * chosen shape; the caret picks flat or nested (copying straight away and
 * remembering the choice). Values keep their types, the button only says
 * "Copied" when the clipboard took the text, and the keys that detail
 * panels bind on the document (Escape, Enter) stay inside the control.
 *
 * The picker is drawn on the page's body (LayeredPopover), never inside the
 * box the button is in: an expanded log row in a list that scrolls sideways
 * and a span panel's scrolling body cut its foot off (#9861).
 */

type CopyMock = ReturnType<typeof jest.fn<(text: string) => Promise<boolean>>>;

const ATTRIBUTES: Record<string, unknown> = {
  "http.request.method": "GET",
  "http.response.status_code": 200,
  "error.handled": false,
  "enduser.roles": ["admin", "billing"],
};

let copyMock: CopyMock;

function mockClipboard(result: boolean = true): CopyMock {
  copyMock = jest.fn<(text: string) => Promise<boolean>>(
    async (): Promise<boolean> => {
      return result;
    },
  );
  jest
    .spyOn(Clipboard, "copyToClipboard")
    .mockImplementation(
      copyMock as unknown as typeof Clipboard.copyToClipboard,
    );
  return copyMock;
}

function copiedJSON(callIndex: number = 0): unknown {
  const call: Array<unknown> | undefined = copyMock.mock.calls[callIndex] as
    | Array<unknown>
    | undefined;
  expect(call).toBeDefined();
  return JSON.parse(call![0] as string);
}

function mainButton(): HTMLElement {
  return screen.getByRole("button", { name: /Copy JSON|Copied|Copy failed/ });
}

function caretButton(): HTMLElement {
  return screen.getByRole("button", { name: "Choose JSON format" });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function openMenu(): Promise<HTMLElement> {
  await click(caretButton());
  return screen.getByRole("menu");
}

// The layer's element the menu is drawn in: Tippy's root.
function layerOf(menu: HTMLElement): HTMLElement {
  const layer: HTMLElement | null = menu.closest<HTMLElement>(
    `.${LAYERED_POPOVER_CLASS_NAME}`,
  );

  expect(layer).not.toBeNull();

  return layer as HTMLElement;
}

// Lets Popper place it: its first placement waits a promise.
async function placed(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  resetPreferencesForTesting();
  mockClipboard(true);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("CopyAttributesAsJSONButton", () => {
  test("renders nothing when there is nothing to copy", () => {
    const { container, rerender } = render(
      <CopyAttributesAsJSONButton attributes={undefined} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<CopyAttributesAsJSONButton attributes={{}} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<CopyAttributesAsJSONButton attributes={{ gone: undefined }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("copies flat JSON with every value's type intact by default", async () => {
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

    await click(mainButton());

    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copiedJSON()).toEqual({
      "enduser.roles": ["admin", "billing"],
      "error.handled": false,
      "http.request.method": "GET",
      "http.response.status_code": 200,
    });
    // Pretty-printed, ready to paste.
    expect(copyMock.mock.calls[0]![0]).toContain('\n  "error.handled": false');
  });

  test("says Copied for a moment, then returns to Copy JSON", async () => {
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

    await click(mainButton());

    expect(mainButton()).toHaveTextContent("Copied");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Copied 4 attributes as flat JSON",
    );

    act(() => {
      jest.advanceTimersByTime(1600);
    });

    expect(mainButton()).toHaveTextContent("Copy JSON");
  });

  test("says Copy failed, not Copied, when the clipboard refuses", async () => {
    mockClipboard(false);
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

    await click(mainButton());

    expect(mainButton()).toHaveTextContent("Copy failed");
    expect(mainButton()).not.toHaveTextContent("Copied");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Could not copy to the clipboard",
    );
  });

  test("a second copy restarts the Copied timer instead of being cut short", async () => {
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

    await click(mainButton());
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    await click(mainButton());
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mainButton()).toHaveTextContent("Copied");

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(mainButton()).toHaveTextContent("Copy JSON");
  });

  test("tells the viewer how many attributes and which shape the main button copies", () => {
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

    expect(mainButton()).toHaveAttribute(
      "title",
      "Copy 4 attributes as flat JSON",
    );
    expect(mainButton()).toHaveAttribute("data-copy-format", "flat");
  });

  test("the format menu offers flat and nested with previews of the real data", async () => {
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

    expect(caretButton()).toHaveAttribute("aria-haspopup", "menu");
    expect(caretButton()).toHaveAttribute("aria-expanded", "false");

    const menu: HTMLElement = await openMenu();

    expect(caretButton()).toHaveAttribute("aria-expanded", "true");
    expect(caretButton()).toHaveAttribute("aria-controls", menu.id);

    const items: Array<HTMLElement> =
      within(menu).getAllByRole("menuitemradio");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Flat JSON");
    expect(items[0]).toHaveTextContent("Dotted keys, exactly as recorded");
    expect(items[0]).toHaveTextContent(
      '{"enduser.roles":["admin","billing"], …}',
    );
    expect(items[1]).toHaveTextContent("Nested JSON");
    expect(items[1]).toHaveTextContent("Dots expanded into objects");
    expect(items[1]).toHaveTextContent(
      '{"enduser":{"roles":["admin","billing"]}, …}',
    );

    // The shape in use is the checked one.
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(items[1]).toHaveAttribute("aria-checked", "false");

    expect(menu).toHaveTextContent("4 attributes");
  });

  test("choosing Nested copies nested JSON straight away and closes the menu", async () => {
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

    const menu: HTMLElement = await openMenu();
    await click(within(menu).getByRole("menuitemradio", { name: /Nested/ }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copiedJSON()).toEqual({
      enduser: { roles: ["admin", "billing"] },
      error: { handled: false },
      http: { request: { method: "GET" }, response: { status_code: 200 } },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Copied 4 attributes as nested JSON",
    );
  });

  test("the chosen shape becomes the main button's default and survives a remount", async () => {
    const { unmount } = render(
      <CopyAttributesAsJSONButton attributes={ATTRIBUTES} />,
    );

    const menu: HTMLElement = await openMenu();
    await click(within(menu).getByRole("menuitemradio", { name: /Nested/ }));
    expect(
      window.localStorage.getItem(ATTRIBUTES_JSON_FORMAT_PREFERENCE.storageKey),
    ).toBe("nested");

    await click(mainButton());
    expect(copiedJSON(1)).toHaveProperty("http.request.method", "GET");

    unmount();
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

    expect(mainButton()).toHaveAttribute("data-copy-format", "nested");
  });

  test("two buttons on the same page agree on the shape", async () => {
    render(
      <div>
        <div data-testid="first">
          <CopyAttributesAsJSONButton attributes={ATTRIBUTES} />
        </div>
        <div data-testid="second">
          <CopyAttributesAsJSONButton attributes={{ "service.name": "api" }} />
        </div>
      </div>,
    );

    const first: HTMLElement = screen.getByTestId("first");
    const second: HTMLElement = screen.getByTestId("second");

    await click(
      within(first).getByRole("button", { name: "Choose JSON format" }),
    );
    // The first button's menu, the one open, drawn over the page.
    await click(
      within(screen.getByRole("menu")).getByRole("menuitemradio", {
        name: /Nested/,
      }),
    );

    expect(
      within(second).getByRole("button", { name: /Copy JSON/ }),
    ).toHaveAttribute("data-copy-format", "nested");
  });

  test("opening the menu focuses the shape in use", async () => {
    window.localStorage.setItem(
      ATTRIBUTES_JSON_FORMAT_PREFERENCE.storageKey,
      "nested",
    );
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

    const menu: HTMLElement = await openMenu();

    expect(
      within(menu).getByRole("menuitemradio", { name: /Nested/ }),
    ).toHaveFocus();
  });

  test("arrow keys, Home and End move between formats", async () => {
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

    const menu: HTMLElement = await openMenu();
    const [flat, nested] = within(menu).getAllByRole("menuitemradio") as [
      HTMLElement,
      HTMLElement,
    ];

    expect(flat).toHaveFocus();

    fireEvent.keyDown(flat, { key: "ArrowDown" });
    expect(nested).toHaveFocus();

    fireEvent.keyDown(nested, { key: "ArrowDown" });
    expect(flat).toHaveFocus();

    fireEvent.keyDown(flat, { key: "ArrowUp" });
    expect(nested).toHaveFocus();

    fireEvent.keyDown(nested, { key: "Home" });
    expect(flat).toHaveFocus();

    fireEvent.keyDown(flat, { key: "End" });
    expect(nested).toHaveFocus();
  });

  test("ArrowDown on the caret opens the menu", async () => {
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

    await act(async () => {
      fireEvent.keyDown(caretButton(), { key: "ArrowDown" });
    });

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  test("Escape closes the menu, returns focus to the caret and does not reach the page", async () => {
    const documentEscape: ReturnType<typeof jest.fn> = jest.fn();
    const listener: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        documentEscape();
      }
    };
    document.addEventListener("keydown", listener);

    try {
      render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);
      const menu: HTMLElement = await openMenu();

      await act(async () => {
        fireEvent.keyDown(within(menu).getAllByRole("menuitemradio")[0]!, {
          key: "Escape",
        });
      });

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(caretButton()).toHaveFocus();
      // A detail drawer closes on a document Escape; it must stay open.
      expect(documentEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });

  test("Escape with the menu closed is left for the page to handle", () => {
    const documentEscape: ReturnType<typeof jest.fn> = jest.fn();
    const listener: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        documentEscape();
      }
    };
    document.addEventListener("keydown", listener);

    try {
      render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);
      fireEvent.keyDown(mainButton(), { key: "Escape" });

      expect(documentEscape).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });

  test("Enter and Space on the button do not reach document shortcuts", () => {
    const documentKeys: Array<string> = [];
    const listener: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      documentKeys.push(event.key);
    };
    document.addEventListener("keydown", listener);

    try {
      render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);
      // The logs viewer toggles the focused row on a document Enter.
      fireEvent.keyDown(mainButton(), { key: "Enter" });
      fireEvent.keyDown(mainButton(), { key: " " });

      expect(documentKeys).toEqual([]);
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });

  test("Tab closes the menu, and goes on from the caret", async () => {
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);
    const menu: HTMLElement = await openMenu();

    const tab: boolean = await act(async (): Promise<boolean> => {
      return fireEvent.keyDown(within(menu).getAllByRole("menuitemradio")[0]!, {
        key: "Tab",
      });
    });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    /*
     * The menu is drawn at the end of the page: the focus is handed back to
     * the caret first, and the browser's own Tab (not prevented) moves on
     * from there - not from the end of the page.
     */
    expect(caretButton()).toHaveFocus();
    expect(tab).toBe(true);
  });

  test("Shift+Tab from a shape goes back to the caret", async () => {
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);
    const menu: HTMLElement = await openMenu();

    const shiftTab: boolean = await act(async (): Promise<boolean> => {
      return fireEvent.keyDown(within(menu).getAllByRole("menuitemradio")[0]!, {
        key: "Tab",
        shiftKey: true,
      });
    });

    expect(caretButton()).toHaveFocus();
    // Landed on the caret itself: the browser's own move is prevented.
    expect(shiftTab).toBe(false);
  });

  test("a click outside closes the menu without copying", async () => {
    render(
      <div>
        <p>Elsewhere on the page</p>
        <CopyAttributesAsJSONButton attributes={ATTRIBUTES} />
      </div>,
    );
    await openMenu();

    await act(async () => {
      fireEvent.mouseDown(screen.getByText("Elsewhere on the page"));
    });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(copyMock).not.toHaveBeenCalled();
  });

  test("a click inside the menu does not count as outside", async () => {
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);
    const menu: HTMLElement = await openMenu();

    await act(async () => {
      fireEvent.mouseDown(menu);
    });

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  test("clicks do not bubble to a clickable row behind the button", async () => {
    const rowClick: ReturnType<typeof jest.fn> = jest.fn();

    render(
      <div onClick={rowClick}>
        <CopyAttributesAsJSONButton attributes={ATTRIBUTES} />
      </div>,
    );

    await click(mainButton());
    await click(caretButton());
    await click(screen.getAllByRole("menuitemradio")[0]!);

    expect(rowClick).not.toHaveBeenCalled();
  });

  test("the caret toggles the menu closed again", async () => {
    render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

    await openMenu();
    await click(caretButton());

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(caretButton()).toHaveAttribute("aria-expanded", "false");
  });

  test("the compact variant is icon-only with an accessible name", () => {
    render(
      <CopyAttributesAsJSONButton
        attributes={ATTRIBUTES}
        compact={true}
        subject="event attributes"
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Copy event attributes as JSON",
    });
    expect(button).not.toHaveTextContent("Copy JSON");
  });

  test("uses the subject in the menu heading and a custom label", async () => {
    render(
      <CopyAttributesAsJSONButton
        attributes={ATTRIBUTES}
        subject="link attributes"
        label="JSON"
      />,
    );

    expect(screen.getByRole("button", { name: "JSON" })).toBeInTheDocument();

    const menu: HTMLElement = await openMenu();
    expect(menu).toHaveTextContent("Copy link attributes as");
  });

  test("copies the attributes it has now, not the ones it first rendered with", async () => {
    const { rerender } = render(
      <CopyAttributesAsJSONButton attributes={{ "span.id": "first" }} />,
    );
    rerender(
      <CopyAttributesAsJSONButton attributes={{ "span.id": "second" }} />,
    );

    await click(mainButton());

    expect(copiedJSON()).toEqual({ "span.id": "second" });
  });

  test("does not update after it is gone", async () => {
    let resolveCopy: ((value: boolean) => void) | undefined;
    jest.spyOn(Clipboard, "copyToClipboard").mockImplementation(() => {
      return new Promise<boolean>((resolve: (value: boolean) => void) => {
        resolveCopy = resolve;
      });
    });
    const consoleError: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { unmount } = render(
      <CopyAttributesAsJSONButton attributes={ATTRIBUTES} />,
    );
    fireEvent.click(mainButton());
    unmount();

    await act(async () => {
      resolveCopy?.(true);
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  test("puts the testid on the control and lines the menu up with either edge", async () => {
    const { rerender } = render(
      <CopyAttributesAsJSONButton
        attributes={ATTRIBUTES}
        dataTestId="copy-json"
      />,
    );

    expect(screen.getByTestId("copy-json")).toContainElement(mainButton());

    // Its end on the caret's end, by default.
    let menu: HTMLElement = await openMenu();
    await placed();
    expect(layerOf(menu)).toHaveAttribute(
      "data-popper-placement",
      "bottom-end",
    );

    await click(caretButton());
    rerender(
      <CopyAttributesAsJSONButton
        attributes={ATTRIBUTES}
        dataTestId="copy-json"
        menuAlign="left"
      />,
    );
    menu = await openMenu();
    await placed();
    expect(layerOf(menu)).toHaveAttribute(
      "data-popper-placement",
      "bottom-start",
    );
  });

  test("on a page read right to left the menu's edges follow the line", async () => {
    document.documentElement.setAttribute("dir", "rtl");

    try {
      render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);

      const menu: HTMLElement = await openMenu();
      await placed();

      // Its end on the caret's end: the left, on a line read from the right.
      expect(layerOf(menu)).toHaveAttribute(
        "data-popper-placement",
        "bottom-start",
      );
    } finally {
      document.documentElement.removeAttribute("dir");
    }
  });
});

describe("CopyAttributesAsJSONButton - its menu is never cut off by what holds it (#9861)", () => {
  /*
   * Where the Dashboard draws the button: an expanded log row, in a list
   * that scrolls sideways (which clips up and down too) inside the list's
   * card; a span's attributes, in a panel's scrolling body.
   */
  const HOLDERS: Array<[string, React.CSSProperties]> = [
    [
      "an expanded log row of a list that scrolls sideways",
      { overflowX: "auto" },
    ],
    ["the list's card, which hides what runs past it", { overflow: "hidden" }],
    ["a span panel's scrolling body", { overflowY: "auto" }],
  ];

  test.each(HOLDERS)(
    "in %s, the menu is drawn on the page's body, outside it",
    async (_name: string, style: React.CSSProperties) => {
      render(
        <div data-testid="holder" style={style}>
          <table>
            <tbody>
              <tr>
                <td colSpan={4}>
                  <CopyAttributesAsJSONButton attributes={ATTRIBUTES} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>,
      );

      const menu: HTMLElement = await openMenu();
      const layer: HTMLElement = layerOf(menu);

      expect(screen.getByTestId("holder")).not.toContainElement(menu);
      expect(layer.parentElement).toBe(document.body);
      // Still the caret's menu: placed against it, named by it.
      expect(
        (layer as HTMLElement & { _tippy?: { reference: Element } })._tippy
          ?.reference,
      ).toBe(caretButton());
      expect(caretButton()).toHaveAttribute("aria-controls", menu.id);
    },
  );

  test("a press in the menu is not a press outside a component around the button", async () => {
    // A detail panel that closes on a press outside itself.
    const Panel: () => ReactElement = (): ReactElement => {
      const { ref, isComponentVisible } = useComponentOutsideClick(true);

      return (
        <div ref={ref} data-testid="panel">
          {isComponentVisible ? (
            <CopyAttributesAsJSONButton attributes={ATTRIBUTES} />
          ) : (
            <p>Closed</p>
          )}
        </div>
      );
    };

    render(<Panel />);

    const menu: HTMLElement = await openMenu();
    const shape: HTMLElement = within(menu).getAllByRole("menuitemradio")[1]!;

    await act(async () => {
      fireEvent.mouseDown(shape);
    });
    await click(shape);

    // The shape was chosen, and the panel around the button stayed open.
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Closed")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  describe("placed against the window", () => {
    const WINDOW_WIDTH: number = 1280;
    const WINDOW_HEIGHT: number = 640;
    const MENU_WIDTH: number = 288;
    const MENU_HEIGHT: number = 223;

    let restore: Array<() => void> = [];

    const defineGetter: (
      target: HTMLElement,
      property: string,
      getter: (this: HTMLElement) => number,
    ) => void = (
      target: HTMLElement,
      property: string,
      getter: (this: HTMLElement) => number,
    ): void => {
      const original: PropertyDescriptor | undefined =
        Object.getOwnPropertyDescriptor(target, property);

      Object.defineProperty(target, property, {
        configurable: true,
        get: getter,
      });

      restore.push(() => {
        if (original) {
          Object.defineProperty(target, property, original);
        } else {
          Reflect.deleteProperty(target, property);
        }
      });
    };

    const isMenu: (element: HTMLElement) => boolean = (
      element: HTMLElement,
    ): boolean => {
      return (
        element.classList.contains(LAYERED_POPOVER_CLASS_NAME) ||
        element.getAttribute("role") === "menu"
      );
    };

    beforeEach(() => {
      restore = [];
      defineGetter(document.documentElement, "clientWidth", () => {
        return WINDOW_WIDTH;
      });
      defineGetter(document.documentElement, "clientHeight", () => {
        return WINDOW_HEIGHT;
      });
      // What Popper and the layer measure of the menu.
      for (const property of ["offsetHeight", "scrollHeight", "clientHeight"]) {
        defineGetter(HTMLElement.prototype, property, function () {
          return isMenu(this) ? MENU_HEIGHT : 0;
        });
      }
      defineGetter(HTMLElement.prototype, "offsetWidth", function () {
        return isMenu(this) ? MENU_WIDTH : 0;
      });
    });

    afterEach(() => {
      for (const undo of restore.reverse()) {
        undo();
      }
    });

    function placeCaretAt(top: number): void {
      caretButton().getBoundingClientRect = (): DOMRect => {
        return {
          x: 1150,
          y: top,
          left: 1150,
          top: top,
          right: 1170,
          bottom: top + 24,
          width: 20,
          height: 24,
          toJSON: (): string => {
            return "";
          },
        } as DOMRect;
      };
    }

    test("near the window's foot, where it has no room under the caret, it opens above it", async () => {
      render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);
      // A span panel's last event, 90px from the window's foot.
      placeCaretAt(WINDOW_HEIGHT - 90);

      const menu: HTMLElement = await openMenu();
      await placed();

      expect(layerOf(menu)).toHaveAttribute("data-popper-placement", "top-end");
    });

    test("with room under the caret, it opens under it, as it always did", async () => {
      render(<CopyAttributesAsJSONButton attributes={ATTRIBUTES} />);
      placeCaretAt(120);

      const menu: HTMLElement = await openMenu();
      await placed();

      expect(layerOf(menu)).toHaveAttribute(
        "data-popper-placement",
        "bottom-end",
      );
    });
  });
});
