import SavedViewsDropdown, {
  SavedViewsDropdownProps,
} from "../../../UI/Components/TelemetryViewer/components/SavedViewsDropdown";
import { SavedViewOption } from "../../../UI/Components/TelemetryViewer/types";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE SAVED VIEWS DROPDOWN, NAMED BY ITS HOST.
 *
 * Security Events' Hunts list is the telemetry explorers' saved views
 * dropdown, so it looks and works as Traces' and Metrics' do; what it keeps
 * is hunts, so its host names it: the trigger, the panel, the empty list,
 * the footer's save and the search box take the host's words. The save can
 * be locked, saying why under it (nothing on screen to save, a role that
 * may not); a row can carry a short detail (a hunt's schedule); the
 * trigger can keep its own name while a hunt is ticked (the hunt's page
 * names it in its header); and the host hears the panel open, to read its
 * list afresh. A host that names nothing gets the views it always had.
 */

const HUNTS: Array<SavedViewOption> = [
  { id: "h1", name: "Admin sign-ins outside the office", detail: "Every Hour" },
  { id: "h2", name: "Encoded PowerShell", detail: "Every Day" },
  { id: "h3", name: "Threat intel matches" },
];

const LABELS: SavedViewsDropdownProps["labels"] = {
  trigger: "Hunts",
  panel: "Hunts",
  empty: "No hunts yet.",
  create: "+ Save as Hunt",
  search: "Search hunts...",
};

function draw(overrides: Partial<SavedViewsDropdownProps> = {}): RenderResult {
  const props: SavedViewsDropdownProps = {
    savedViews: HUNTS,
    selectedSavedViewId: null,
    onSelect: jest.fn(),
    onCreate: jest.fn(),
    labels: LABELS,
    dataTestId: "security-events-hunts-menu",
    ...overrides,
  };

  return render(<SavedViewsDropdown {...props} />);
}

function trigger(): HTMLElement {
  return within(screen.getByTestId("security-events-hunts-menu")).getAllByRole(
    "button",
  )[0]!;
}

function open(): HTMLElement {
  fireEvent.click(trigger());
  return screen.getByRole("dialog");
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the host's words", () => {
  test("name the trigger, with the count, and the panel", () => {
    draw();

    expect(trigger()).toHaveTextContent(/^Hunts3$/);
    expect(open()).toHaveAttribute("aria-label", "Hunts");
  });

  test("name the footer's save and the empty list", () => {
    draw({ savedViews: [] });

    const panel: HTMLElement = open();

    expect(within(panel).getByText("No hunts yet.")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "+ Save as Hunt" }),
    ).toBeEnabled();
    expect(within(panel).queryByText("No saved views yet.")).toBeNull();
  });

  /*
   * What a host shows while there is nothing to list - its "Loading…", or
   * what went wrong with a way to try again - in place of the empty words.
   */
  test("give way to the host's own empty content", () => {
    const retry: ReturnType<typeof jest.fn> = jest.fn();

    draw({
      savedViews: [],
      emptyContent: (
        <div role="alert">
          <p>Hunts could not be loaded.</p>
          <button type="button" onClick={retry}>
            Try again
          </button>
        </div>
      ),
    });

    const panel: HTMLElement = open();

    expect(within(panel).getByRole("alert")).toHaveTextContent(
      "Hunts could not be loaded.",
    );
    expect(within(panel).queryByText("No hunts yet.")).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    cleanup();

    // A list to show is shown, whatever the host would say about none.
    draw({ emptyContent: <p>Loading hunts…</p> });
    expect(within(open()).queryByText("Loading hunts…")).toBeNull();
  });

  test("name the search box a long list grows", () => {
    draw({
      savedViews: Array.from(
        { length: 12 },
        (_: unknown, index: number): SavedViewOption => {
          return { id: `h${index}`, name: `Hunt ${index}` };
        },
      ),
    });

    expect(
      within(open()).getByRole("textbox", { name: "Search hunts..." }),
    ).toBeInTheDocument();
  });

  test("left out, read as views, as they always did", () => {
    draw({ labels: undefined, savedViews: [] });

    const panel: HTMLElement = open();

    expect(trigger()).toHaveTextContent(/^Saved Views/);
    expect(panel).toHaveAttribute("aria-label", "Saved views");
    expect(within(panel).getByText("No saved views yet.")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "+ Save Current View" }),
    ).toBeInTheDocument();
  });
});

describe("the save", () => {
  test("saves what is on screen, and closes the panel", () => {
    const onCreate: ReturnType<typeof jest.fn> = jest.fn();
    draw({ onCreate });

    fireEvent.click(
      within(open()).getByRole("button", { name: "+ Save as Hunt" }),
    );

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("locked says why, under it, and does nothing", () => {
    const onCreate: ReturnType<typeof jest.fn> = jest.fn();
    draw({
      onCreate,
      createDisabledReason:
        "Type a search or pick a filter first: a hunt saves the search on screen.",
    });

    const panel: HTMLElement = open();
    const save: HTMLElement = within(panel).getByRole("button", {
      name: "+ Save as Hunt",
    });

    expect(save).toBeDisabled();
    expect(
      within(panel).getByText(
        "Type a search or pick a filter first: a hunt saves the search on screen.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(save);

    expect(onCreate).not.toHaveBeenCalled();
    // Still open: the reason stays to be read.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("the rows", () => {
  test("carry their detail after the name; a row without one shows only its name", () => {
    draw();

    const panel: HTMLElement = open();
    const row: HTMLElement = within(panel).getByRole("button", {
      name: "Encoded PowerShell",
    });

    expect(row).toHaveTextContent("Encoded PowerShellEvery Day");
    expect(
      within(panel).getByRole("button", { name: "Threat intel matches" }),
    ).toHaveTextContent(/^Threat intel matches$/);
  });

  /*
   * Beside its name, a detail left a 288px panel room for "Admin sign-ins
   * outside t..." only: under it, the name has the row's width.
   */
  test("say their detail under the name, which keeps the row's width", () => {
    draw();

    const panel: HTMLElement = open();
    const name: HTMLElement = within(panel).getByText(
      "Admin sign-ins outside the office",
    );
    const detail: HTMLElement = within(panel).getByText("Every Hour");

    // One column: the name over its detail.
    expect(name.parentElement).toBe(detail.parentElement);
    expect(name.parentElement).toHaveClass("flex-col", "min-w-0", "flex-1");
    expect(name).toHaveClass("truncate", "max-w-full", "self-start");
    expect(detail).toHaveClass("truncate");
  });

  // An English name on a Persian page is cut at its own end, not its start.
  test("draw each name in an isolate that reads the way it is written", () => {
    draw({
      savedViews: [...HUNTS, { id: "h4", name: "شکار ورودهای مدیر" }],
    });

    const panel: HTMLElement = open();
    const english: HTMLElement = within(panel).getByText(
      "Threat intel matches",
    );
    const persian: HTMLElement = within(panel).getByText("شکار ورودهای مدیر");

    expect(english.tagName).toBe("BDI");
    expect(english).toHaveAttribute("dir", "ltr");
    expect(persian.tagName).toBe("BDI");
    expect(persian).toHaveAttribute("dir", "rtl");
  });

  test("give a long name whole on hover", () => {
    draw();

    expect(
      within(open()).getByTitle("Admin sign-ins outside the office"),
    ).toBeInTheDocument();
  });

  test("a default view still says default, not its detail", () => {
    draw({
      labels: undefined,
      savedViews: [
        { id: "v1", name: "Errors", isDefault: true, detail: "ignored" },
      ],
    });

    const panel: HTMLElement = open();

    expect(within(panel).getByText("default")).toBeInTheDocument();
    expect(within(panel).queryByText("ignored")).toBeNull();
  });

  test("choosing one opens it", () => {
    const onSelect: ReturnType<typeof jest.fn> = jest.fn();
    draw({ onSelect });

    fireEvent.click(
      within(open()).getByRole("button", { name: "Threat intel matches" }),
    );

    expect(onSelect).toHaveBeenCalledWith("h3");
  });
});

describe("the trigger", () => {
  test("names the ticked one, unless its host names it elsewhere", () => {
    draw({ selectedSavedViewId: "h2" });
    expect(trigger()).toHaveTextContent(/^Encoded PowerShell3$/);
    cleanup();

    draw({ selectedSavedViewId: "h2", showSelectedNameInTrigger: false });
    expect(trigger()).toHaveTextContent(/^Hunts3$/);

    // Still ticked in the list.
    expect(
      within(open()).getByRole("button", { name: "Encoded PowerShell" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("draws the host's icon, a bookmark unless named", () => {
    const { container: own } = draw({
      showTriggerIcon: true,
      triggerIcon: IconProp.ViewfinderCircle,
    });
    const ownPaths: string = own.querySelector("svg")!.innerHTML;
    cleanup();

    const { container: plain } = draw({ showTriggerIcon: true });
    const plainPaths: string = plain.querySelector("svg")!.innerHTML;

    expect(ownPaths).not.toBe(plainPaths);
  });

  // A host still reading its list, or that could not, has nothing to count: "0" would say none.
  test("leaves the count out when its host says so", () => {
    draw({ showCount: false });

    expect(trigger()).toHaveTextContent(/^Hunts$/);
    cleanup();

    draw({ showCount: true });
    expect(trigger()).toHaveTextContent(/^Hunts3$/);
  });

  test("tells its host the panel opens, each time, and not as it closes", () => {
    const onOpen: ReturnType<typeof jest.fn> = jest.fn();
    draw({ onOpen });

    fireEvent.click(trigger());
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger());
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger());
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

/*
 * THE PANEL OPENS ON THE SCREEN. Beside the side menu at 768px the
 * explorer's toolbar wraps and leaves the trigger last on its row, and
 * the 288px panel, opened from the trigger's start, ran past the screen's
 * edge and scrolled the page sideways. It opens from the trigger's end
 * when its start has no room - measured as it is styled (w-72), never as
 * it first measures: the Dashboard's Tailwind runtime writes the w-72 rule
 * after the panel is in the page, and it measured its longest name.
 */
describe("the panel's place", () => {
  const originalInnerWidth: number = window.innerWidth;

  function placeTrigger(box: {
    left: number;
    right: number;
    viewportWidth: number;
  }): void {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: box.viewportWidth,
    });
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: box.left,
      right: box.right,
      x: box.left,
      width: box.right - box.left,
      top: 0,
      bottom: 30,
      y: 0,
      height: 30,
      toJSON: (): Record<string, never> => {
        return {};
      },
    } as DOMRect);
    // Measured before its width applies, the panel is as wide as its longest name.
    jest
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockReturnValue(670);
  }

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
  });

  test("opens from the trigger's start while there is room", () => {
    placeTrigger({ left: 712, right: 831, viewportWidth: 1280 });
    draw();

    const panel: HTMLElement = open();

    expect(panel).toHaveAttribute("data-align", "left");
    expect(panel).toHaveClass("left-0");
    expect(panel).not.toHaveClass("right-0");
  });

  test("opens from the trigger's end when its start would run off the screen", () => {
    placeTrigger({ left: 625, right: 744, viewportWidth: 768 });
    draw();

    const panel: HTMLElement = open();

    expect(panel).toHaveAttribute("data-align", "right");
    expect(panel).toHaveClass("right-0");
    // And never wider than a phone's screen.
    expect(panel).toHaveClass("w-72", "max-w-[calc(100vw-1rem)]");
  });

  test("keeps the side a host names", () => {
    placeTrigger({ left: 625, right: 744, viewportWidth: 768 });
    draw({ dropdownAlignment: "left" });
    expect(open()).toHaveAttribute("data-align", "left");
    cleanup();

    placeTrigger({ left: 16, right: 135, viewportWidth: 390 });
    draw({ dropdownAlignment: "right" });
    expect(open()).toHaveAttribute("data-align", "right");
  });

  /*
   * A phone's window grows with whatever runs past its screen: the panel,
   * first drawn from the trigger's start before its width applied, made
   * innerWidth 900 on a 390px phone - room enough by that - and it stayed
   * off the screen, the page scrolling sideways under it. The page's own
   * width (the root element's) does not grow.
   */
  test("on a phone, opens by the page's width, not a window grown past the screen", () => {
    placeTrigger({ left: 211, right: 353, viewportWidth: 900 });
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 390,
    });

    try {
      draw();
      expect(open()).toHaveAttribute("data-align", "right");
    } finally {
      Reflect.deleteProperty(document.documentElement, "clientWidth");
    }
  });
});

/*
 * THE TRIGGER'S SIZE. A chip in an explorer's toolbar of chips; in a card's
 * header, as tall as its buttons and its time range (38px, 42px on a
 * phone), where a chip stood 30px among them.
 */
describe("the trigger's size", () => {
  test("a chip unless the host says otherwise", () => {
    draw();

    expect(trigger()).toHaveClass("px-2.5", "py-1.5", "text-xs");
    expect(trigger()).not.toHaveClass("text-sm");
  });

  test("a header's control in a header", () => {
    draw({ triggerSize: "header", showTriggerIcon: true });

    expect(trigger()).toHaveClass(
      "px-3",
      "py-2.5",
      "md:py-2",
      "text-sm",
      "border-gray-300",
    );
    expect(trigger()).not.toHaveClass("py-1.5", "text-xs");
  });
});

/*
 * A ROW'S ACTIONS. Kept beside the name, see-through until the row was
 * hovered, they took its width all the same - "Sign-up to fi..." in a
 * German panel - showed nothing to a keyboard's focus, and nothing at all
 * on a touch screen, whose taps still hit them. Where the pointer can
 * hover they are now out of the layout until the row is hovered or
 * focused; on a touch screen they take a line under the name.
 */
describe("a row's actions", () => {
  test("shown while the row is hovered or focused; under the name on a touch screen", () => {
    draw({
      selectedSavedViewId: "h3",
      onEdit: jest.fn(),
      onDelete: jest.fn(),
      onUpdateCurrent: jest.fn(),
    });

    const panel: HTMLElement = open();
    const row: HTMLElement = within(panel)
      .getByRole("button", { name: "Threat intel matches" })
      .closest("div.group") as HTMLElement;
    const actions: HTMLElement = within(row).getByRole("button", {
      name: "Update",
    }).parentElement as HTMLElement;

    expect(actions).not.toHaveClass("opacity-0");
    expect(actions).toHaveClass(
      "[@media(hover:hover)]:group-[:not(:hover):not(:focus-within)]:hidden",
      "[@media(hover:none)]:basis-full",
    );
    expect(row).toHaveClass("[@media(hover:none)]:flex-wrap");

    // Tab from the name reaches them, in order.
    expect(
      within(row)
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return button.getAttribute("aria-label") || button.textContent || "";
        }),
    ).toEqual(["Threat intel matches", "Update", "Edit", "Delete"]);
  });
});
