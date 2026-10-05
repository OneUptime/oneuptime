import React from "react";
import MarkdownEditor from "../../../UI/Components/Markdown.tsx/MarkdownEditor";
import { TemplateVariableGroups } from "../../../Types/Template/TemplateVariable";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";

/*
 * "We have a markdown editor and forms, but the form is not wide, so the
 * controls of the markdown editor show in two lines." - the maintainer.
 *
 * Forms with the editor now open wide (FormModalWidth), and the toolbar
 * keeps one line wherever it is anyway: the buttons that do not fit go, from
 * the end, under its More formatting button, which offers them in the same
 * order with the same words and runs them where the cursor was. These render
 * the real editor with jsdom's missing layout filled in: the toolbar's line
 * is given a width, the Markdown / Visual switch and Insert variable are
 * given theirs, and the ResizeObserver can be told the line has changed.
 */

const EVERY_BUTTON: Array<string> = [
  "Bold (Ctrl+B)",
  "Italic (Ctrl+I)",
  "Underline",
  "Strikethrough",
  "Heading 1",
  "Heading 2",
  "Heading 3",
  "Bullet List",
  "Numbered List",
  "Task List",
  "Indent (Tab)",
  "Outdent (Shift+Tab)",
  "Link",
  "Upload Image",
  "Code",
  "Table",
  "Horizontal Rule",
  "Quote",
  "Code Block",
];

const MODE_TOGGLE_PX: number = 84;
const INSERT_VARIABLE_PX: number = 140;

const GROUPS: TemplateVariableGroups = [
  {
    title: "Incident",
    variables: [
      { name: "incident.title", description: "Title" },
      { name: "incident.number", description: "Incident Number" },
    ],
  },
];

/*
 * The layout jsdom does not have. The width of the toolbar's line, as the
 * test sets it; the switch and the Insert variable button as wide as they
 * are in Chromium at the Dashboard's font.
 */
let lineWidth: number = 0;

const originalClientWidth: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
const originalOffsetWidth: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
const originalResizeObserver: unknown = (
  window as unknown as { ResizeObserver?: unknown }
).ResizeObserver;
const originalRequestAnimationFrame: typeof window.requestAnimationFrame =
  window.requestAnimationFrame;

class FakeResizeObserver {
  public static instances: Array<FakeResizeObserver> = [];
  public observed: Array<Element> = [];

  public constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }

  public observe(element: Element): void {
    this.observed.push(element);
  }

  public unobserve(): void {}

  public disconnect(): void {
    this.observed = [];
    FakeResizeObserver.instances = FakeResizeObserver.instances.filter(
      (instance: FakeResizeObserver): boolean => {
        return instance !== this;
      },
    );
  }

  public notify(): void {
    this.callback();
  }
}

const installLayout: (width: number) => void = (width: number): void => {
  lineWidth = width;

  Object.defineProperty(Element.prototype, "clientWidth", {
    configurable: true,
    get(this: Element): number {
      return this.getAttribute("data-testid") === "markdown-editor-toolbar-line"
        ? lineWidth
        : 0;
    },
  });

  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement): number {
      if (
        this.tagName === "BUTTON" &&
        (this.getAttribute("title") || "").startsWith("Switch to")
      ) {
        return MODE_TOGGLE_PX;
      }

      if (
        this.classList.contains("ml-auto") &&
        this.querySelector("[data-testid='markdown-editor-insert-variable']")
      ) {
        return INSERT_VARIABLE_PX;
      }

      return 0;
    },
  });
};

// The line is resized: the observer reports it, and a frame later it is fitted.
const resizeLineTo: (width: number) => void = (width: number): void => {
  lineWidth = width;

  act(() => {
    for (const observer of [...FakeResizeObserver.instances]) {
      observer.notify();
    }
  });
};

beforeEach(() => {
  FakeResizeObserver.instances = [];
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;
  window.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
    callback(0);
    return 0;
  }) as typeof window.requestAnimationFrame;
});

afterEach(() => {
  cleanup();

  if (originalClientWidth) {
    Object.defineProperty(
      Element.prototype,
      "clientWidth",
      originalClientWidth,
    );
  }

  if (originalOffsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      originalOffsetWidth,
    );
  }

  (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
    originalResizeObserver;
  window.requestAnimationFrame = originalRequestAnimationFrame;
  delete (document as unknown as { execCommand?: unknown }).execCommand;
  window.getSelection()?.removeAllRanges();
  jest.restoreAllMocks();
});

const toolbar: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("markdown-editor-toolbar");
};

const toolbarLine: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("markdown-editor-toolbar-line");
};

// The titles of the buttons on the toolbar's line, in order.
const lineTitles: () => Array<string> = (): Array<string> => {
  return Array.from(toolbarLine().querySelectorAll("button")).map(
    (button: Element): string => {
      return button.getAttribute("title") || "";
    },
  );
};

const formattingTitles: () => Array<string> = (): Array<string> => {
  return lineTitles().filter((title: string): boolean => {
    return (
      title !== "More formatting" &&
      !title.startsWith("Switch to") &&
      title !== "Insert variable"
    );
  });
};

const moreButton: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId("markdown-editor-more-formatting");
};

const openMoreMenu: () => HTMLElement = (): HTMLElement => {
  const button: HTMLElement | null = moreButton();

  if (!button) {
    throw new Error("the toolbar has no More formatting button");
  }

  fireEvent.mouseDown(button);
  fireEvent.click(button);

  return screen.getByRole("menu");
};

const menuItemTexts: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return item.querySelector(".font-medium")?.textContent || "";
    });
};

const editableOf: () => HTMLElement = (): HTMLElement => {
  return document.querySelector('[contenteditable="true"]') as HTMLElement;
};

const lastChange: (onChange: jest.Mock) => string = (
  onChange: jest.Mock,
): string => {
  const calls: Array<Array<unknown>> = onChange.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? "");
};

// The caret at the end of the editor's first text node holding `text`.
const placeCaretAfter: (text: string) => void = (text: string): void => {
  const editable: HTMLElement = editableOf();

  act(() => {
    editable.focus();
  });

  const walker: TreeWalker = document.createTreeWalker(
    editable,
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null = walker.nextNode();

  while (node && !(node.textContent || "").includes(text)) {
    node = walker.nextNode();
  }

  if (!node) {
    throw new Error(`no text "${text}" in the editor`);
  }

  const range: Range = document.createRange();
  range.setStart(node, (node.textContent || "").indexOf(text) + text.length);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  // React does not see the browser's selectionchange in jsdom on its own.
  document.dispatchEvent(new Event("selectionchange"));
};

describe("the Markdown editor's toolbar where nothing can be measured", () => {
  test("has every formatting button on its line, in order, and no More formatting", () => {
    render(<MarkdownEditor initialValue="" />);

    expect(formattingTitles()).toEqual(EVERY_BUTTON);
    expect(moreButton()).toBeNull();
    expect(
      screen.getByRole("button", { name: "Markdown" }),
    ).toBeInTheDocument();
  });

  test("never wraps: one line that clips, whose width never widens the form", () => {
    render(<MarkdownEditor initialValue="" />);

    expect(toolbarLine().className).not.toContain("flex-wrap");
    expect(toolbar().innerHTML).not.toContain("flex-wrap");
    expect(toolbarLine()).toHaveClass("flex");
    expect(toolbar()).toHaveClass("overflow-hidden");
    expect(toolbar().getAttribute("style") || "").toContain(
      "contain: inline-size",
    );
  });

  test("draws every formatting button as the same 32px square the fitting counts on", () => {
    render(<MarkdownEditor initialValue="" />);

    for (const title of EVERY_BUTTON) {
      const button: HTMLElement = screen.getByTitle(title);
      expect(button).toHaveClass("h-8");
      expect(button).toHaveClass("w-8");
      expect(button).toHaveClass("shrink-0");
    }
  });

  test("draws Strikethrough and Horizontal Rule as different marks", () => {
    render(<MarkdownEditor initialValue="" />);

    const strikethrough: string = screen.getByTitle("Strikethrough").innerHTML;
    const horizontalRule: string =
      screen.getByTitle("Horizontal Rule").innerHTML;

    expect(strikethrough).not.toEqual(horizontalRule);
  });

  test("fits nothing away on a line it measures as 0px wide", () => {
    installLayout(0);
    render(<MarkdownEditor initialValue="" templateVariables={GROUPS} />);

    expect(formattingTitles()).toEqual(EVERY_BUTTON);
    expect(moreButton()).toBeNull();
  });
});

describe("the Markdown editor's toolbar on a line too short for every button", () => {
  test("keeps the first buttons and the switch, and puts the rest under More formatting", () => {
    installLayout(540);
    render(<MarkdownEditor initialValue="" />);

    expect(formattingTitles()).toEqual(EVERY_BUTTON.slice(0, 11));
    expect(moreButton()).not.toBeNull();
    // The menu button right after the last button, before the switch.
    expect(lineTitles()).toEqual([
      ...EVERY_BUTTON.slice(0, 11),
      "More formatting",
      "Switch to markdown source",
    ]);

    const menu: HTMLElement = openMoreMenu();

    expect(menuItemTexts(menu)).toEqual([
      "Outdent",
      "Link",
      "Upload Image",
      "Code",
      "Table",
      "Horizontal Rule",
      "Quote",
      "Code Block",
    ]);
  });

  test("names its More formatting button and opens a menu outside the toolbar", () => {
    installLayout(540);
    render(<MarkdownEditor initialValue="" />);

    const button: HTMLElement = moreButton() as HTMLElement;

    expect(button).toHaveAttribute("aria-label", "More formatting");
    expect(button).toHaveAttribute("title", "More formatting");
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveClass("h-8");
    expect(button).toHaveClass("w-8");

    const menu: HTMLElement = openMoreMenu();

    expect(button).toHaveAttribute("aria-expanded", "true");
    // Portalled: a dialog's scrolling body cannot clip it.
    expect(toolbar().contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  test("divides the menu's items into the toolbar's groups", () => {
    installLayout(540);
    render(<MarkdownEditor initialValue="" />);

    const menu: HTMLElement = openMoreMenu();
    const rows: Array<string> = Array.from(menu.children).map(
      (child: Element): string => {
        if (child.getAttribute("role") === "separator") {
          return "---";
        }

        return child.querySelector(".font-medium")?.textContent || "";
      },
    );

    expect(rows).toEqual([
      "Outdent",
      "---",
      "Link",
      "Upload Image",
      "Code",
      "---",
      "Table",
      "Horizontal Rule",
      "Quote",
      "Code Block",
    ]);
  });

  test("shows a button's key beside its menu item, and a mark for those without an icon", () => {
    installLayout(380);
    render(<MarkdownEditor initialValue="" />);

    const menu: HTMLElement = openMoreMenu();
    const outdent: HTMLElement = within(menu).getByRole("menuitem", {
      name: /Outdent/,
    });

    expect(outdent).toHaveTextContent("Shift+Tab");

    const heading: HTMLElement = within(menu).getByRole("menuitem", {
      name: /Heading 3/,
    });
    expect(
      within(heading).getByTestId("more-menu-item-mark"),
    ).toHaveTextContent("H3");

    const codeBlock: HTMLElement = within(menu).getByRole("menuitem", {
      name: /Code Block/,
    });
    expect(
      within(codeBlock).getByTestId("more-menu-item-mark"),
    ).toHaveTextContent("{}");
  });

  test("a menu item does what its button does, in the markdown source", () => {
    const onChange: jest.Mock = jest.fn();
    installLayout(540);
    render(<MarkdownEditor initialValue="" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    const textarea: HTMLTextAreaElement = screen.getByRole(
      "textbox",
    ) as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 0);

    const menu: HTMLElement = openMoreMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Table/ }));

    expect(lastChange(onChange)).toContain(
      "| Header 1 | Header 2 | Header 3 |",
    );
    // The menu closes once an item is picked.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("a menu item goes where the visual editor's cursor was, though the menu took the focus", () => {
    const onChange: jest.Mock = jest.fn();
    installLayout(540);
    render(<MarkdownEditor initialValue="hello world" onChange={onChange} />);

    // Mid-line: anywhere else the block would land at the end instead.
    placeCaretAfter("hello");
    const menu: HTMLElement = openMoreMenu();

    // The menu's first item has the focus now, and the selection is gone.
    window.getSelection()?.removeAllRanges();

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: /^Code Block/ }),
    );

    expect(lastChange(onChange)).toBe("hello\n\n```\ncode block\n```\n\nworld");
    expect(document.activeElement).toBe(editableOf());
  });

  test("its button does the same at the same cursor, for comparison", () => {
    const onChange: jest.Mock = jest.fn();
    installLayout(2000);
    render(<MarkdownEditor initialValue="hello world" onChange={onChange} />);

    placeCaretAfter("hello");
    fireEvent.mouseDown(screen.getByTitle("Code Block"));
    fireEvent.click(screen.getByTitle("Code Block"));

    expect(lastChange(onChange)).toBe("hello\n\n```\ncode block\n```\n\nworld");
  });

  test("keeps the editor's focus while More formatting is pressed", () => {
    installLayout(540);
    render(<MarkdownEditor initialValue="hello" />);

    const pressed: boolean = fireEvent.mouseDown(moreButton() as HTMLElement);

    // A prevented mousedown: the focus and the selection stay in the editor.
    expect(pressed).toBe(false);
  });

  test("Escape closes the menu and hands the focus back to More formatting", () => {
    installLayout(540);
    render(<MarkdownEditor initialValue="" />);

    const menu: HTMLElement = openMoreMenu();
    fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0]!, {
      key: "Escape",
    });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(moreButton());
  });

  test("leaves no Image item when the field cannot upload images", () => {
    installLayout(540);
    render(<MarkdownEditor initialValue="" allowImageUpload={false} />);

    const menu: HTMLElement = openMoreMenu();

    expect(menuItemTexts(menu)).not.toContain("Upload Image");
    expect(screen.queryByTitle("Upload Image")).toBeNull();
  });
});

describe("the Markdown editor's toolbar on a phone", () => {
  test("keeps Insert variable, with its words, and moves the switch into the menu", () => {
    installLayout(300);
    render(<MarkdownEditor initialValue="" templateVariables={GROUPS} />);

    expect(
      screen.getByTestId("markdown-editor-insert-variable"),
    ).toHaveTextContent("Insert variable");
    expect(screen.queryByRole("button", { name: "Markdown" })).toBeNull();
    expect(formattingTitles().length).toBeGreaterThan(0);

    const menu: HTMLElement = openMoreMenu();
    const items: Array<string> = menuItemTexts(menu);

    // The formatting first, then the switch after a divider of its own.
    expect(items[items.length - 1]).toBe("Switch to markdown source");
    expect(items).toContain("Code Block");
  });

  test("the switch in the menu switches the view, and then reads the other way", () => {
    installLayout(300);
    render(<MarkdownEditor initialValue="" templateVariables={GROUPS} />);

    fireEvent.click(
      within(openMoreMenu()).getByRole("menuitem", {
        name: /Switch to markdown source/,
      }),
    );

    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");

    const items: Array<string> = menuItemTexts(openMoreMenu());
    expect(items[items.length - 1]).toBe("Switch to visual editor");
  });

  test("keeps the switch on the line when there are no variables to make room for", () => {
    installLayout(328);
    render(<MarkdownEditor initialValue="" />);

    expect(
      screen.getByRole("button", { name: "Markdown" }),
    ).toBeInTheDocument();
    expect(formattingTitles().slice(0, 4)).toEqual(EVERY_BUTTON.slice(0, 4));
  });
});

describe("the Markdown editor's toolbar as its line is resized", () => {
  test("brings buttons back from the menu as it widens, and puts them away as it narrows", () => {
    installLayout(540);
    render(<MarkdownEditor initialValue="" templateVariables={GROUPS} />);

    expect(moreButton()).not.toBeNull();

    resizeLineTo(1200);

    expect(formattingTitles()).toEqual(EVERY_BUTTON);
    expect(moreButton()).toBeNull();
    expect(
      screen.getByRole("button", { name: "Markdown" }),
    ).toBeInTheDocument();

    resizeLineTo(300);

    expect(moreButton()).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Markdown" })).toBeNull();
    expect(
      screen.getByTestId("markdown-editor-insert-variable"),
    ).toHaveTextContent("Insert variable");

    resizeLineTo(1200);

    expect(formattingTitles()).toEqual(EVERY_BUTTON);
    expect(
      screen.getByRole("button", { name: "Markdown" }),
    ).toBeInTheDocument();
  });

  test("watches the line, the switch and Insert variable", () => {
    installLayout(1200);
    render(<MarkdownEditor initialValue="" templateVariables={GROUPS} />);

    const observed: Array<Element> = FakeResizeObserver.instances.flatMap(
      (instance: FakeResizeObserver): Array<Element> => {
        return instance.observed;
      },
    );

    expect(observed).toContain(toolbarLine());
    expect(observed).toContain(
      screen.getByRole("button", { name: "Markdown" }),
    );
    expect(observed).toContain(
      screen.getByTestId("markdown-editor-insert-variable").parentElement,
    );
  });

  test("stops watching once the editor is gone", () => {
    installLayout(1200);
    const { unmount } = render(<MarkdownEditor initialValue="" />);

    expect(FakeResizeObserver.instances.length).toBeGreaterThan(0);

    unmount();

    expect(FakeResizeObserver.instances).toEqual([]);
  });
});

describe("the Markdown editor's toolbar in the page's language", () => {
  const german: i18n = createInstance();

  beforeAll(async () => {
    await german.init({
      lng: "de",
      resources: {
        de: {
          translation: {
            "More formatting": "Weitere Formatierungen",
            Bold: "Fett",
            Table: "Tabelle",
            "Code Block": "Codeblock",
            "Switch to markdown source": "Zur Markdown-Quelle wechseln",
          },
        },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  test("names its buttons and its menu's items in the locale's words", () => {
    installLayout(540);
    render(
      <I18nextProvider i18n={german}>
        <MarkdownEditor initialValue="" />
      </I18nextProvider>,
    );

    expect(screen.getByTitle("Fett (Ctrl+B)")).toBeInTheDocument();
    expect(moreButton()).toHaveAttribute(
      "aria-label",
      "Weitere Formatierungen",
    );
    expect(
      screen.getByTitle("Zur Markdown-Quelle wechseln"),
    ).toBeInTheDocument();

    const items: Array<string> = menuItemTexts(openMoreMenu());

    expect(items).toContain("Tabelle");
    expect(items).toContain("Codeblock");
    // A word the locale has no entry for stays English.
    expect(items).toContain("Quote");
  });
});
