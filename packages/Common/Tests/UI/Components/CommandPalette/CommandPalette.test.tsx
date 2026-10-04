import CommandPalette, {
  ComponentProps,
} from "../../../../UI/Components/CommandPalette/CommandPalette";
import { PaletteCommand } from "../../../../UI/Components/CommandPalette/Types";
import { resetPageScrollLockForTesting } from "../../../../UI/Utils/PageScrollLock";
import IconProp from "../../../../Types/Icon/IconProp";
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
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const RECENTS_KEY: string = "test-palette-recents";

/*
 * The panel mounts closed and opens on the next animation frame, so anything
 * asserting the settled look has to let that frame run first (Modal's
 * entrance pattern).
 */
type FlushEntranceFrameFunction = () => Promise<void>;

const flushEntranceFrame: FlushEntranceFrameFunction =
  async (): Promise<void> => {
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  };

type MakeCommandFunction = (
  overrides: Partial<PaletteCommand> &
    Pick<PaletteCommand, "id" | "title" | "category">,
) => PaletteCommand;

const makeCommand: MakeCommandFunction = (
  overrides: Partial<PaletteCommand> &
    Pick<PaletteCommand, "id" | "title" | "category">,
): PaletteCommand => {
  return {
    onSelect: (): void => {},
    ...overrides,
  };
};

type RenderPaletteFunction = (
  overrides?: Partial<ComponentProps>,
) => ReturnType<typeof render>;

const defaultCommands: Array<PaletteCommand> = [
  makeCommand({
    id: "go-home",
    title: "Home",
    description: "Project overview",
    icon: IconProp.Home,
    iconColor: "indigo",
    category: "Essentials",
  }),
  makeCommand({
    id: "go-monitors",
    title: "Monitors",
    description: "Uptime checks",
    icon: IconProp.AltGlobe,
    iconColor: "green",
    category: "Observability",
    keywords: ["uptime", "checks"],
    shortcut: ["G", "M"],
  }),
  makeCommand({
    id: "declare-incident",
    title: "Declare Incident",
    category: "Actions",
  }),
];

const renderPalette: RenderPaletteFunction = (
  overrides?: Partial<ComponentProps>,
): ReturnType<typeof render> => {
  const props: ComponentProps = {
    commands: defaultCommands,
    isOpen: true,
    onClose: (): void => {},
    ...overrides,
  };
  return render(<CommandPalette {...props} />);
};

describe("CommandPalette", () => {
  beforeEach(() => {
    resetPageScrollLockForTesting();
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    resetPageScrollLockForTesting();
  });

  describe("open and close", () => {
    test("renders nothing while closed", () => {
      renderPalette({ isOpen: false });

      expect(screen.queryByTestId("command-palette")).toBeNull();
    });

    test("renders the dialog, portalled to document.body, when open", () => {
      const { container } = renderPalette();

      const palette: HTMLElement = screen.getByTestId("command-palette");

      expect(palette).toBeInTheDocument();
      // Portal: the dialog lives in the body, not inside the render container.
      expect(container.contains(palette)).toBe(false);
      expect(document.body.contains(palette)).toBe(true);
    });

    test("autofocuses the search input on open", () => {
      renderPalette();

      expect(document.activeElement).toBe(
        screen.getByTestId("command-palette-input"),
      );
    });

    test("clicking the backdrop area closes; clicking the panel does not", () => {
      const onClose: jest.Mock = jest.fn();
      renderPalette({ onClose });

      const panel: HTMLElement = screen.getByTestId("command-palette-panel");

      fireEvent.click(panel);
      expect(onClose).not.toHaveBeenCalled();

      // The centring flex layer sits directly over the click-away container.
      fireEvent.click(panel.parentElement as HTMLElement);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("focus management", () => {
    /*
     * The React onKeyDown on the dialog root dies the moment focus escapes
     * the subtree, so a document-level listener (Modal's pattern) backs it
     * up — and flags the key consumed for listeners after it.
     */
    test("Escape still closes after focus has escaped to the body", () => {
      const onClose: jest.Mock = jest.fn();
      renderPalette({ onClose });

      (document.activeElement as HTMLElement).blur();
      expect(document.activeElement).toBe(document.body);

      // fireEvent returns false when a handler called preventDefault().
      expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(false);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("mousedown on non-interactive panel chrome is prevented so the input keeps focus", () => {
      renderPalette();

      const input: HTMLElement = screen.getByTestId("command-palette-input");
      expect(document.activeElement).toBe(input);

      /*
       * The hints footer is non-interactive chrome: its mousedown default
       * (focus moving to the body) is prevented, so the keyboard keeps
       * working. fireEvent returns false when preventDefault was called.
       */
      const footer: HTMLElement = screen.getByTestId("command-palette-footer");
      expect(fireEvent.mouseDown(footer)).toBe(false);
      expect(document.activeElement).toBe(input);

      // The input keeps its native caret/selection mousedown behavior…
      expect(fireEvent.mouseDown(input)).toBe(true);

      // …option rows keep their native press behavior…
      const homeRow: HTMLElement = screen.getByTestId(
        "command-palette-option-go-home",
      );
      expect(fireEvent.mouseDown(homeRow)).toBe(true);

      /*
       * …and the scroll container keeps its default: a scrollbar drag starts
       * as a mousedown on the listbox itself, and preventDefault would
       * cancel the drag.
       */
      expect(fireEvent.mouseDown(screen.getByRole("listbox"))).toBe(true);
    });

    test("returns focus to the previously focused element after close", () => {
      const trigger: HTMLButtonElement = document.createElement("button");
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const { rerender } = render(
        <CommandPalette
          commands={defaultCommands}
          isOpen={true}
          onClose={(): void => {}}
        />,
      );

      // Opening moved focus into the palette…
      expect(document.activeElement).toBe(
        screen.getByTestId("command-palette-input"),
      );

      rerender(
        <CommandPalette
          commands={defaultCommands}
          isOpen={false}
          onClose={(): void => {}}
        />,
      );

      // …and closing hands it back to the opener.
      expect(document.activeElement).toBe(trigger);

      document.body.removeChild(trigger);
    });
  });

  describe("body scroll lock", () => {
    test("locks body scrolling while open and restores it when closed", () => {
      const { rerender } = renderPalette();

      expect(document.body.style.overflow).toBe("hidden");

      rerender(
        <CommandPalette
          commands={defaultCommands}
          isOpen={false}
          onClose={(): void => {}}
        />,
      );

      expect(document.body.style.overflow).toBe("");
    });

    test("restores body scrolling when unmounted while open", () => {
      const { unmount } = renderPalette();

      expect(document.body.style.overflow).toBe("hidden");

      unmount();

      expect(document.body.style.overflow).toBe("");
    });
  });

  describe("entrance animation (Modal pattern)", () => {
    test("backdrop and panel mount closed and fade in on the next frame", async () => {
      renderPalette();

      const panel: HTMLElement = screen.getByTestId("command-palette-panel");
      const backdrop: HTMLElement = screen.getByTestId(
        "command-palette-backdrop",
      );

      expect(panel).toHaveClass("opacity-0", "scale-[0.98]");
      expect(backdrop).toHaveClass("opacity-0");

      await flushEntranceFrame();

      expect(panel).toHaveClass("opacity-100");
      expect(backdrop).toHaveClass("opacity-100");
    });

    /*
     * A scale left behind after the entrance would make the panel the
     * containing block for position:fixed descendants — the Modal invariant
     * this component copies.
     */
    test("leaves no transform on the panel once it has settled", async () => {
      renderPalette();

      await flushEntranceFrame();

      expect(screen.getByTestId("command-palette-panel").className).not.toMatch(
        /(^|\s)(sm:)?(scale|translate)-/,
      );
    });
  });

  describe("browsing (empty query)", () => {
    test("groups the catalog into category sections in first-seen order", () => {
      renderPalette();

      expect(
        screen.getByTestId("command-palette-section-essentials"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("command-palette-section-observability"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("command-palette-section-actions"),
      ).toBeInTheDocument();

      expect(
        screen.getByTestId("command-palette-option-go-home"),
      ).toHaveTextContent("Home");
      expect(
        screen.getByTestId("command-palette-option-go-monitors"),
      ).toHaveTextContent("Monitors");
    });

    test("renders descriptions and keycap shortcut hints on rows", () => {
      renderPalette();

      const monitorsRow: HTMLElement = screen.getByTestId(
        "command-palette-option-go-monitors",
      );

      expect(monitorsRow).toHaveTextContent("Uptime checks");
      // The shortcut renders as keycaps: one <kbd> per key.
      expect(monitorsRow.querySelectorAll("kbd")).toHaveLength(2);
    });
  });

  describe("filtering and highlighting", () => {
    test("typing filters the catalog and updates the live result count", () => {
      renderPalette();

      const input: HTMLElement = screen.getByTestId("command-palette-input");

      fireEvent.change(input, { target: { value: "monitors" } });

      expect(
        screen.getByTestId("command-palette-option-go-monitors"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("command-palette-option-go-home")).toBeNull();

      const resultCount: HTMLElement = screen.getByTestId(
        "command-palette-result-count",
      );
      expect(resultCount).toHaveAttribute("aria-live", "polite");
      expect(resultCount).toHaveTextContent("1 result");
    });

    test("keyword matches surface commands whose titles do not match", () => {
      renderPalette();

      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "uptime" },
      });

      expect(
        screen.getByTestId("command-palette-option-go-monitors"),
      ).toBeInTheDocument();
    });

    test("ranks title-prefix above word-start and keyword matches", () => {
      const rankedCommands: Array<PaletteCommand> = [
        makeCommand({ id: "sub-seq", title: "Man on wire", category: "E" }),
        makeCommand({
          id: "by-category",
          title: "Stats",
          category: "Monitoring",
        }),
        makeCommand({
          id: "by-keyword",
          title: "Uptime",
          category: "C",
          keywords: ["monitor"],
        }),
        makeCommand({ id: "by-word", title: "Create Monitor", category: "B" }),
        makeCommand({ id: "prefix", title: "Monitors", category: "A" }),
      ];
      renderPalette({ commands: rankedCommands });

      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "mon" },
      });

      const optionIds: Array<string | null> = screen
        .getAllByRole("option")
        .map((option: HTMLElement) => {
          return option.getAttribute("data-testid");
        });

      /*
       * "Man on wire" holds m-o-n in order and "Stats" is listed under
       * "Monitoring", but letters in order and a group's name are fallbacks
       * for when nothing else matches: here three commands do.
       */
      expect(optionIds).toEqual([
        "command-palette-option-prefix",
        "command-palette-option-by-word",
        "command-palette-option-by-keyword",
      ]);
    });

    test("a group's name lists its commands when nothing else matches", () => {
      renderPalette({
        commands: [
          makeCommand({ id: "stats", title: "Stats", category: "Monitoring" }),
          makeCommand({
            id: "uptime",
            title: "Uptime",
            category: "Monitoring",
          }),
          makeCommand({ id: "logs", title: "Logs", category: "Telemetry" }),
        ],
      });

      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "monitoring" },
      });

      expect(
        screen.getAllByRole("option").map((option: HTMLElement) => {
          return option.getAttribute("data-testid");
        }),
      ).toEqual([
        "command-palette-option-stats",
        "command-palette-option-uptime",
      ]);
    });

    test("letters in order find a command when nothing else matches", () => {
      renderPalette({
        commands: [
          makeCommand({ id: "monitors", title: "Monitors", category: "A" }),
          makeCommand({ id: "logs", title: "Logs", category: "B" }),
        ],
      });

      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "mntr" },
      });

      expect(
        screen.getAllByRole("option").map((option: HTMLElement) => {
          return option.getAttribute("data-testid");
        }),
      ).toEqual(["command-palette-option-monitors"]);
    });

    test("wraps matching runs of the title in <mark>", () => {
      renderPalette();

      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "mon" },
      });

      const row: HTMLElement = screen.getByTestId(
        "command-palette-option-go-monitors",
      );
      const marks: NodeListOf<HTMLElement> = row.querySelectorAll("mark");

      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveTextContent("Mon");
    });

    test("shows an empty state when nothing matches", () => {
      renderPalette();

      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "zzzz-no-match" },
      });

      expect(screen.getByTestId("command-palette-empty")).toHaveTextContent(
        "No results found.",
      );
      expect(screen.queryAllByRole("option")).toHaveLength(0);
    });
  });

  describe("recent commands", () => {
    test("shows a Recent section from storage on an empty query, in stored order", () => {
      window.localStorage.setItem(
        RECENTS_KEY,
        JSON.stringify(["declare-incident", "go-monitors"]),
      );
      renderPalette({ recentStorageKey: RECENTS_KEY });

      const recentSection: HTMLElement = screen.getByTestId(
        "command-palette-section-recent",
      );

      /*
       * Recent rows carry a prefixed id so they never collide with the
       * same command's row in its category section below.
       */
      const recentOptionIds: Array<string | null> = Array.from(
        recentSection.querySelectorAll('[role="option"]'),
      ).map((option: Element) => {
        return option.getAttribute("data-testid");
      });

      expect(recentOptionIds).toEqual([
        "command-palette-option-recent-declare-incident",
        "command-palette-option-recent-go-monitors",
      ]);

      // The catalog sections still list the commands themselves.
      expect(
        screen.getByTestId("command-palette-option-go-monitors"),
      ).toBeInTheDocument();
    });

    test("ignores stored ids that no longer resolve to a command", () => {
      window.localStorage.setItem(
        RECENTS_KEY,
        JSON.stringify(["deleted-command"]),
      );
      renderPalette({ recentStorageKey: RECENTS_KEY });

      expect(screen.queryByTestId("command-palette-section-recent")).toBeNull();
    });

    test("hides the Recent section while a query is active", () => {
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(["go-home"]));
      renderPalette({ recentStorageKey: RECENTS_KEY });

      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: "home" },
      });

      expect(screen.queryByTestId("command-palette-section-recent")).toBeNull();
    });

    test("selecting a command records it at the front of recents and closes", () => {
      const onSelect: jest.Mock = jest.fn();
      const onClose: jest.Mock = jest.fn();
      const commands: Array<PaletteCommand> = [
        makeCommand({
          id: "go-home",
          title: "Home",
          category: "Essentials",
        }),
        makeCommand({
          id: "go-monitors",
          title: "Monitors",
          category: "Observability",
          onSelect,
        }),
      ];
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(["go-home"]));
      renderPalette({ commands, onClose, recentStorageKey: RECENTS_KEY });

      fireEvent.click(screen.getByTestId("command-palette-option-go-monitors"));

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(window.localStorage.getItem(RECENTS_KEY) as string),
      ).toEqual(["go-monitors", "go-home"]);
    });

    test("without a recentStorageKey nothing is read or written", () => {
      renderPalette();

      fireEvent.click(screen.getByTestId("command-palette-option-go-home"));

      expect(screen.queryByTestId("command-palette-section-recent")).toBeNull();
      expect(window.localStorage.length).toBe(0);
    });
  });

  describe("pages: search-only commands with a breadcrumb", () => {
    const pageCommands: Array<PaletteCommand> = [
      makeCommand({
        id: "go-monitors",
        title: "Monitors",
        description: "Uptime checks",
        category: "Essentials",
      }),
      makeCommand({
        id: "page-api-keys",
        title: "API Keys",
        category: "Pages",
        breadcrumb: ["Project Settings", "Advanced"],
        keywords: ["access token"],
        isSearchOnly: true,
      }),
      makeCommand({
        id: "page-incident-custom-fields",
        title: "Custom Fields",
        description: "Never shown: the breadcrumb takes its place",
        category: "Pages",
        breadcrumb: ["Incidents", "Settings"],
        isSearchOnly: true,
      }),
      makeCommand({
        id: "page-alert-custom-fields",
        title: "Custom Fields",
        category: "Pages",
        breadcrumb: ["Alerts", "Settings"],
        isSearchOnly: true,
      }),
      makeCommand({
        id: "page-action-delete-project",
        title: "Delete Project",
        category: "Actions",
        breadcrumb: ["Project Settings", "Danger Zone"],
        isSearchOnly: true,
      }),
    ];

    const optionIds: () => Array<string | null> = (): Array<string | null> => {
      return screen.getAllByRole("option").map((option: HTMLElement) => {
        return option.getAttribute("data-testid");
      });
    };

    const type: (value: string) => void = (value: string): void => {
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value },
      });
    };

    test("browsing lists the catalog without the search-only pages", () => {
      renderPalette({ commands: pageCommands });

      expect(optionIds()).toEqual(["command-palette-option-go-monitors"]);
      expect(
        screen.queryByTestId("command-palette-section-pages"),
      ).not.toBeInTheDocument();
    });

    test("searching finds a page, shown with where it lives", () => {
      renderPalette({ commands: pageCommands });

      type("api keys");

      const row: HTMLElement = screen.getByTestId(
        "command-palette-option-page-api-keys",
      );
      expect(optionIds()).toEqual(["command-palette-option-page-api-keys"]);
      expect(
        screen.getByTestId("command-palette-section-pages"),
      ).toContainElement(row);

      const breadcrumb: HTMLElement = screen.getByTestId(
        "command-palette-option-page-api-keys-breadcrumb",
      );
      expect(breadcrumb).toHaveTextContent("Project Settings");
      expect(breadcrumb).toHaveTextContent("Advanced");
      // The arrow is drawn for the eye; a screen reader hears a comma.
      const arrow: HTMLElement = breadcrumb.querySelector(
        '[aria-hidden="true"]',
      ) as HTMLElement;
      expect(arrow).toHaveTextContent("›");
      expect(breadcrumb.querySelector(".sr-only")).toHaveTextContent(",");
    });

    test("two pages with one title are told apart by their breadcrumbs", () => {
      renderPalette({ commands: pageCommands });

      type("custom fields");

      expect(optionIds()).toEqual([
        "command-palette-option-page-incident-custom-fields",
        "command-palette-option-page-alert-custom-fields",
      ]);
      expect(
        screen.getByTestId(
          "command-palette-option-page-incident-custom-fields-breadcrumb",
        ),
      ).toHaveTextContent("Incidents");
      expect(
        screen.getByTestId(
          "command-palette-option-page-alert-custom-fields-breadcrumb",
        ),
      ).toHaveTextContent("Alerts");
      // The breadcrumb is shown instead of a description.
      expect(
        screen.getByTestId(
          "command-palette-option-page-incident-custom-fields",
        ),
      ).not.toHaveTextContent("Never shown");
    });

    test("the breadcrumb narrows a search: 'incident custom fields' finds one page", () => {
      renderPalette({ commands: pageCommands });

      type("incident custom fields");

      expect(optionIds()).toEqual([
        "command-palette-option-page-incident-custom-fields",
      ]);
      // The word that matched the breadcrumb is marked there.
      const marks: Array<string> = Array.from(
        screen
          .getByTestId(
            "command-palette-option-page-incident-custom-fields-breadcrumb",
          )
          .querySelectorAll("mark"),
      ).map((mark: Element): string => {
        return mark.textContent || "";
      });
      expect(marks).toEqual(["Incident"]);
    });

    test("a search-only action is found by name and sits under Actions", () => {
      renderPalette({ commands: pageCommands });

      type("delete project");

      expect(optionIds()).toEqual([
        "command-palette-option-page-action-delete-project",
      ]);
      expect(
        screen.getByTestId("command-palette-section-actions"),
      ).toContainElement(
        screen.getByTestId("command-palette-option-page-action-delete-project"),
      );
      expect(
        screen.getByTestId(
          "command-palette-option-page-action-delete-project-breadcrumb",
        ),
      ).toHaveTextContent("Danger Zone");
    });

    test("Enter opens the best match, and the page then shows under Recent", () => {
      const onSelect: jest.Mock = jest.fn();
      const commands: Array<PaletteCommand> = pageCommands.map(
        (command: PaletteCommand): PaletteCommand => {
          return command.id === "page-api-keys"
            ? { ...command, onSelect }
            : command;
        },
      );

      const { unmount } = renderPalette({
        commands,
        recentStorageKey: RECENTS_KEY,
      });

      type("keys api");
      fireEvent.keyDown(screen.getByTestId("command-palette-input"), {
        key: "Enter",
      });

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(window.localStorage.getItem(RECENTS_KEY) as string),
      ).toEqual(["page-api-keys"]);

      unmount();
      renderPalette({ commands, recentStorageKey: RECENTS_KEY });

      // Browsing: the page is not in the catalog, but it is a recent.
      const recent: HTMLElement = screen.getByTestId(
        "command-palette-section-recent",
      );
      expect(recent).toContainElement(
        screen.getByTestId("command-palette-option-recent-page-api-keys"),
      );
      expect(
        screen.getByTestId(
          "command-palette-option-recent-page-api-keys-breadcrumb",
        ),
      ).toHaveTextContent("Advanced");
      expect(
        screen.queryByTestId("command-palette-option-page-api-keys"),
      ).not.toBeInTheDocument();
    });

    test("arrow keys walk the search results across sections in order", () => {
      renderPalette({ commands: pageCommands });

      type("project");
      const input: HTMLElement = screen.getByTestId("command-palette-input");

      // Two words of the breadcrumb are not needed: one word of a title is.
      expect(optionIds()).toEqual([
        "command-palette-option-page-action-delete-project",
      ]);
      expect(input).toHaveAttribute(
        "aria-activedescendant",
        "command-palette-option-page-action-delete-project",
      );

      type("settings custom");
      expect(optionIds()).toEqual([
        "command-palette-option-page-incident-custom-fields",
        "command-palette-option-page-alert-custom-fields",
      ]);

      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(input).toHaveAttribute(
        "aria-activedescendant",
        "command-palette-option-page-alert-custom-fields",
      );
      expect(
        screen.getByTestId("command-palette-result-count"),
      ).toHaveTextContent("2 results");
    });
  });

  describe("aria contract", () => {
    test("exposes a modal dialog with a combobox driving a listbox", () => {
      renderPalette();

      const palette: HTMLElement = screen.getByTestId("command-palette");
      expect(palette).toHaveAttribute("role", "dialog");
      expect(palette).toHaveAttribute("aria-modal", "true");

      const input: HTMLElement = screen.getByTestId("command-palette-input");
      expect(input).toHaveAttribute("role", "combobox");
      expect(input).toHaveAttribute("aria-controls", "command-palette-listbox");

      const listbox: HTMLElement = screen.getByRole("listbox");
      expect(listbox).toHaveAttribute("id", "command-palette-listbox");
    });

    test("the active option is flagged with aria-selected and aria-activedescendant", () => {
      renderPalette();

      const input: HTMLElement = screen.getByTestId("command-palette-input");
      const firstOption: HTMLElement = screen.getByTestId(
        "command-palette-option-go-home",
      );

      expect(firstOption).toHaveAttribute("aria-selected", "true");
      expect(input).toHaveAttribute(
        "aria-activedescendant",
        "command-palette-option-go-home",
      );

      fireEvent.keyDown(input, { key: "ArrowDown" });

      expect(firstOption).toHaveAttribute("aria-selected", "false");
      expect(input).toHaveAttribute(
        "aria-activedescendant",
        "command-palette-option-go-monitors",
      );
    });
  });
});
