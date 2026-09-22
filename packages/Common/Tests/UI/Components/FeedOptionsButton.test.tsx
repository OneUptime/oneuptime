import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import {
  DEFAULT_FEED_OPTIONS,
  FeedEventTypeOption,
  FeedOptions,
} from "../../../UI/Components/Feed/FeedOptions";
import FeedOptionsButton, {
  FEED_EVENT_TYPE_SEARCH_THRESHOLD,
  FEED_OPTIONS_PANEL_WIDTH_PX,
  FEED_OPTIONS_VIEWPORT_GUTTER_PX,
  FeedOptionsPanelPlacement,
  getFeedOptionsPanelPlacement,
} from "../../../UI/Components/Feed/FeedOptionsButton";
import Icon from "../../../UI/Components/Icon/Icon";

/*
 * The one "Filter & Sort" control in every dashboard activity feed's header.
 * The component is controlled, so most behaviour is driven through a small
 * harness that holds the options in state the way useFeedOptions does, while
 * exact payloads are asserted against a bare onChange mock.
 */

type OnChangeMock = ReturnType<typeof jest.fn<(options: FeedOptions) => void>>;

/*
 * The button is named by its visible label alone; the state behind it (order
 * and filter) is its description, so a screen reader says each once.
 */
const TRIGGER_NAME: string = "Filter & Sort";

const PANEL_NAME: string = "Filter and sort feed";

const UNFILTERED_SUMMARY: string =
  "Showing every event type. Tick one or more to narrow the feed.";

const CUSTOMIZED_TRIGGER_CLASSES: Array<string> = [
  "border-indigo-300",
  "bg-indigo-50",
  "text-indigo-700",
];

const DEFAULT_TRIGGER_CLASSES: Array<string> = [
  "border-gray-300",
  "bg-white",
  "text-gray-700",
];

// Three entries, in checklist order; the last one has no icon.
const EVENT_TYPE_OPTIONS: Array<FeedEventTypeOption> = [
  {
    value: "IncidentCreated",
    label: "Incident Created",
    icon: IconProp.Alert,
  },
  {
    value: "IncidentStateChanged",
    label: "Incident State Changed",
    icon: IconProp.Edit,
  },
  {
    value: "OwnerUserAdded",
    label: "User Added as Owner",
  },
];

// Long enough to earn the search box.
const LONG_EVENT_TYPE_OPTIONS: Array<FeedEventTypeOption> = [
  { value: "AlertAcknowledged", label: "Alert Acknowledged" },
  { value: "AlertCreated", label: "Alert Created" },
  { value: "AlertResolved", label: "Alert Resolved" },
  { value: "IncidentCreated", label: "Incident Created" },
  { value: "IncidentResolved", label: "Incident Resolved" },
  { value: "MonitorStatusChanged", label: "Monitor Status Changed" },
  { value: "OwnerNotificationSent", label: "Owner Notification Sent" },
  {
    value: "SubscriberNotificationSent",
    label: "Subscriber Notification Sent",
  },
  { value: "OwnerTeamAdded", label: "Team Added as Owner" },
  { value: "OwnerUserAdded", label: "User Added as Owner" },
];

interface HarnessProps {
  eventTypeOptions: Array<FeedEventTypeOption>;
  initialValue?: FeedOptions | undefined;
  onChange?: ((options: FeedOptions) => void) | undefined;
}

const Harness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const [value, setValue] = React.useState<FeedOptions>(
    props.initialValue || DEFAULT_FEED_OPTIONS,
  );

  return (
    <FeedOptionsButton
      value={value}
      eventTypeOptions={props.eventTypeOptions}
      onChange={(nextValue: FeedOptions): void => {
        props.onChange?.(nextValue);
        setValue(nextValue);
      }}
    />
  );
};

const createOnChange: () => OnChangeMock = (): OnChangeMock => {
  return jest.fn<(options: FeedOptions) => void>();
};

const getTrigger: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: TRIGGER_NAME });
};

const queryPanel: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByRole("dialog", { name: PANEL_NAME });
};

const openPanel: () => HTMLElement = (): HTMLElement => {
  fireEvent.click(getTrigger());

  return screen.getByRole("dialog", { name: PANEL_NAME });
};

const getRadio: (name: string) => HTMLElement = (name: string): HTMLElement => {
  return screen.getByRole("radio", { name });
};

const getCheckbox: (name: string) => HTMLElement = (
  name: string,
): HTMLElement => {
  return screen.getByRole("checkbox", { name });
};

const getCheckboxLabels: () => Array<string> = (): Array<string> => {
  return screen.queryAllByRole("checkbox").map((checkbox: HTMLElement) => {
    return checkbox.closest("label")?.textContent || "";
  });
};

const getEventTypeSummary: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("feed-options-event-type-summary");
};

const getSearchInput: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("textbox", { name: "Search event types" });
};

const getSearchResults: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("feed-options-search-results");
};

const getLastCall: (onChange: OnChangeMock) => FeedOptions | undefined = (
  onChange: OnChangeMock,
): FeedOptions | undefined => {
  return onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
};

const getListeners: (
  spy: ReturnType<typeof jest.spyOn>,
  eventType: string,
) => Array<unknown> = (
  spy: ReturnType<typeof jest.spyOn>,
  eventType: string,
): Array<unknown> => {
  const calls: Array<Array<unknown>> = spy.mock.calls as unknown as Array<
    Array<unknown>
  >;

  return calls
    .filter((call: Array<unknown>): boolean => {
      return call[0] === eventType;
    })
    .map((call: Array<unknown>): unknown => {
      return call[1];
    });
};

// The path data of the first glyph drawn inside an element.
const getLeadingGlyphPath: (element: HTMLElement) => string = (
  element: HTMLElement,
): string => {
  return element.querySelector("svg path")?.getAttribute("d") || "";
};

/*
 * The path an Icon draws, rendered on its own, so the control's glyphs are
 * compared with the icon set rather than with a copied string.
 */
const getGlyphPath: (icon: IconProp) => string = (icon: IconProp): string => {
  const { container, unmount } = render(<Icon icon={icon} />);
  const path: string = getLeadingGlyphPath(container);

  unmount();

  return path;
};

type MakeRect = (left: number, right: number) => DOMRect;

const makeRect: MakeRect = (left: number, right: number): DOMRect => {
  return {
    left,
    right,
    x: left,
    y: 0,
    top: 0,
    bottom: 38,
    width: right - left,
    height: 38,
    toJSON: (): unknown => {
      return {};
    },
  };
};

afterEach(() => {
  cleanup();
});

describe("FeedOptionsButton", () => {
  describe("closed state", () => {
    test("renders one collapsed dialog trigger named by its label and described by the current view", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      expect(screen.getAllByRole("button")).toHaveLength(1);

      const trigger: HTMLElement = getTrigger();
      const summary: HTMLElement = screen.getByTestId("feed-options-summary");

      expect(trigger).toHaveAccessibleName(TRIGGER_NAME);
      expect(trigger).toHaveAccessibleDescription(
        "Newest first, all event types",
      );
      expect(trigger).toHaveAttribute("title", "Newest first, all event types");
      expect(trigger).toHaveAttribute("type", "button");
      expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).not.toHaveAttribute("aria-label");
      expect(trigger).not.toHaveAttribute("aria-controls");
      expect(trigger).toHaveTextContent("Filter & Sort");
      /*
       * The description lives outside the button: text inside it would join
       * the name, and the reader would hear the state twice.
       */
      expect(summary.id).not.toBe("");
      expect(trigger).toHaveAttribute("aria-describedby", summary.id);
      expect(trigger).not.toContainElement(summary);
      expect(queryPanel()).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("feed-options-panel"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("feed-options-count"),
      ).not.toBeInTheDocument();
    });

    test("keeps its label in the accessibility tree at every width", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      const label: HTMLElement =
        within(getTrigger()).getByTestId("feed-options-label");

      expect(label).toHaveTextContent(TRIGGER_NAME);
      /*
       * Below xl the label is hidden visually, never with display:none -
       * that would drop it from the accessibility tree and leave the button
       * with no name at all on phones and tablets. jsdom applies no CSS, so
       * the class is the only place this can be seen.
       */
      expect(label).toHaveClass("sr-only");
      expect(label).not.toHaveClass("hidden");
    });

    test.each<[string, FeedOptions, string]>([
      [
        "an ascending, unfiltered view",
        { sortOrder: SortOrder.Ascending, eventTypes: [] },
        "Oldest first, all event types",
      ],
      [
        "a descending, filtered view",
        {
          sortOrder: SortOrder.Descending,
          eventTypes: ["IncidentCreated", "OwnerUserAdded"],
        },
        "Newest first, 2 of 3 event types",
      ],
      [
        "an ascending, filtered view",
        { sortOrder: SortOrder.Ascending, eventTypes: ["IncidentCreated"] },
        "Oldest first, 1 of 3 event types",
      ],
    ])(
      "summarises %s in the accessible description and tooltip, not the name",
      (_label: string, value: FeedOptions, summary: string) => {
        render(
          <FeedOptionsButton
            value={value}
            eventTypeOptions={EVENT_TYPE_OPTIONS}
            onChange={createOnChange()}
          />,
        );

        expect(getTrigger()).toHaveAccessibleName(TRIGGER_NAME);
        expect(getTrigger()).toHaveAccessibleDescription(summary);
        expect(getTrigger()).toHaveAttribute("title", summary);
      },
    );

    test("shows a count of the chosen event types, hidden from the accessible name", () => {
      render(
        <FeedOptionsButton
          value={{
            sortOrder: SortOrder.Descending,
            eventTypes: ["IncidentCreated", "IncidentStateChanged"],
          }}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      const count: HTMLElement =
        within(getTrigger()).getByTestId("feed-options-count");

      expect(count).toHaveTextContent(/^2$/);
      expect(count).toHaveAttribute("aria-hidden", "true");
      expect(getTrigger()).toHaveAccessibleName(TRIGGER_NAME);
    });

    test("does not show a count when only the sort order differs from default", () => {
      render(
        <FeedOptionsButton
          value={{ sortOrder: SortOrder.Ascending, eventTypes: [] }}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      expect(
        screen.queryByTestId("feed-options-count"),
      ).not.toBeInTheDocument();
    });
  });

  describe("default versus customized styling", () => {
    test("uses the neutral style for the default view", () => {
      render(
        <FeedOptionsButton
          value={{ sortOrder: SortOrder.Descending, eventTypes: [] }}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      const trigger: HTMLElement = getTrigger();

      expect(trigger).toHaveClass(...DEFAULT_TRIGGER_CLASSES);

      for (const className of CUSTOMIZED_TRIGGER_CLASSES) {
        expect(trigger).not.toHaveClass(className);
      }
    });

    test.each<[string, FeedOptions]>([
      [
        "the oldest-first order",
        { sortOrder: SortOrder.Ascending, eventTypes: [] },
      ],
      [
        "an event type filter",
        { sortOrder: SortOrder.Descending, eventTypes: ["OwnerUserAdded"] },
      ],
      [
        "both a changed order and a filter",
        {
          sortOrder: SortOrder.Ascending,
          eventTypes: ["IncidentCreated", "OwnerUserAdded"],
        },
      ],
    ])(
      "tints the trigger indigo for %s",
      (_label: string, value: FeedOptions) => {
        render(
          <FeedOptionsButton
            value={value}
            eventTypeOptions={EVENT_TYPE_OPTIONS}
            onChange={createOnChange()}
          />,
        );

        const trigger: HTMLElement = getTrigger();

        expect(trigger).toHaveClass(...CUSTOMIZED_TRIGGER_CLASSES);

        for (const className of DEFAULT_TRIGGER_CLASSES) {
          expect(trigger).not.toHaveClass(className);
        }
      },
    );

    test("switches between the two styles as the options change", () => {
      render(<Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />);

      openPanel();
      expect(getTrigger()).toHaveClass(...DEFAULT_TRIGGER_CLASSES);

      fireEvent.click(getRadio("Oldest first"));
      expect(getTrigger()).toHaveClass(...CUSTOMIZED_TRIGGER_CLASSES);

      fireEvent.click(getRadio("Newest first"));
      expect(getTrigger()).toHaveClass(...DEFAULT_TRIGGER_CLASSES);

      fireEvent.click(getCheckbox("Incident Created"));
      expect(getTrigger()).toHaveClass(...CUSTOMIZED_TRIGGER_CLASSES);

      fireEvent.click(getCheckbox("Incident Created"));
      expect(getTrigger()).toHaveClass(...DEFAULT_TRIGGER_CLASSES);
    });
  });

  /*
   * A reversed feed must not rely on the indigo tint alone to say so: Oldest
   * first swaps the trigger's funnel for the up-arrow sort glyph.
   */
  describe("trigger icon", () => {
    // Guards the comparisons below: two empty paths would compare equal.
    test("has two distinct, non-empty glyphs to choose between", () => {
      const funnel: string = getGlyphPath(IconProp.Filter);
      const upArrow: string = getGlyphPath(IconProp.BarsArrowUp);

      expect(funnel).not.toBe("");
      expect(upArrow).not.toBe("");
      expect(upArrow).not.toBe(funnel);
    });

    test.each<[string, FeedOptions, IconProp, IconProp]>([
      [
        "the default view",
        DEFAULT_FEED_OPTIONS,
        IconProp.Filter,
        IconProp.BarsArrowUp,
      ],
      [
        "a newest-first, filtered view",
        { sortOrder: SortOrder.Descending, eventTypes: ["IncidentCreated"] },
        IconProp.Filter,
        IconProp.BarsArrowUp,
      ],
      [
        "an oldest-first view",
        { sortOrder: SortOrder.Ascending, eventTypes: [] },
        IconProp.BarsArrowUp,
        IconProp.Filter,
      ],
      [
        "an oldest-first, filtered view",
        { sortOrder: SortOrder.Ascending, eventTypes: ["IncidentCreated"] },
        IconProp.BarsArrowUp,
        IconProp.Filter,
      ],
    ])(
      "leads with the right glyph for %s",
      (
        _label: string,
        value: FeedOptions,
        expectedIcon: IconProp,
        otherIcon: IconProp,
      ) => {
        render(
          <FeedOptionsButton
            value={value}
            eventTypeOptions={EVENT_TYPE_OPTIONS}
            onChange={createOnChange()}
          />,
        );

        const leadingGlyph: string = getLeadingGlyphPath(getTrigger());

        expect(leadingGlyph).toBe(getGlyphPath(expectedIcon));
        expect(leadingGlyph).not.toBe(getGlyphPath(otherIcon));
      },
    );

    test("shows the Oldest first radio's own glyph while that order is chosen, and the funnel again after", () => {
      render(<Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />);

      openPanel();
      fireEvent.click(getRadio("Oldest first"));

      expect(getLeadingGlyphPath(getTrigger())).toBe(
        getLeadingGlyphPath(getRadio("Oldest first")),
      );

      fireEvent.click(getRadio("Newest first"));

      expect(getLeadingGlyphPath(getTrigger())).toBe(
        getGlyphPath(IconProp.Filter),
      );
    });
  });

  describe("opening", () => {
    test("opens a named dialog that the expanded trigger controls", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      const panel: HTMLElement = openPanel();
      const trigger: HTMLElement = getTrigger();

      expect(panel).toHaveAttribute("data-testid", "feed-options-panel");
      expect(panel.id).not.toBe("");
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(trigger).toHaveAttribute("aria-controls", panel.id);
      expect(document.getElementById(panel.id)).toBe(panel);
      /*
       * Focusable, so a press on its padding keeps focus inside the control,
       * but not a tab stop of its own.
       */
      expect(panel).toHaveAttribute("tabindex", "-1");
    });

    test.each<[SortOrder, string, string]>([
      [SortOrder.Descending, "Newest first", "Oldest first"],
      [SortOrder.Ascending, "Oldest first", "Newest first"],
    ])(
      "moves focus onto the checked sort order (%s)",
      (sortOrder: SortOrder, checkedName: string, otherName: string) => {
        render(
          <FeedOptionsButton
            value={{ sortOrder, eventTypes: [] }}
            eventTypeOptions={EVENT_TYPE_OPTIONS}
            onChange={createOnChange()}
          />,
        );

        openPanel();

        expect(getRadio(checkedName)).toHaveFocus();
        expect(getRadio(checkedName)).toHaveAttribute("aria-checked", "true");
        expect(getRadio(otherName)).not.toHaveFocus();
      },
    );

    test("focuses the order chosen during the previous visit when re-opened", () => {
      render(<Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />);

      openPanel();
      fireEvent.click(getRadio("Oldest first"));
      fireEvent.keyDown(getRadio("Oldest first"), { key: "Escape" });

      expect(queryPanel()).not.toBeInTheDocument();

      openPanel();

      expect(getRadio("Oldest first")).toHaveFocus();
    });

    test("does not pull focus back to the sort order when it changes while open", () => {
      render(<Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />);

      openPanel();

      const checkbox: HTMLElement = getCheckbox("Incident Created");

      act(() => {
        checkbox.focus();
      });

      fireEvent.click(getRadio("Oldest first"));

      expect(getRadio("Oldest first")).toHaveAttribute("aria-checked", "true");
      expect(checkbox).toHaveFocus();
    });
  });

  describe("panel placement", () => {
    test("uses a 288px panel kept 16px from the viewport edges", () => {
      expect(FEED_OPTIONS_PANEL_WIDTH_PX).toBe(288);
      expect(FEED_OPTIONS_VIEWPORT_GUTTER_PX).toBe(16);
    });

    test("lines the panel's right edge up with the trigger's when there is room on the left", () => {
      const placement: FeedOptionsPanelPlacement = getFeedOptionsPanelPlacement(
        {
          triggerLeft: 900,
          triggerRight: 1000,
          viewportWidth: 1280,
        },
      );

      // left = triggerRight - width - triggerLeft = 1000 - 288 - 900.
      expect(placement).toEqual({ left: -188, width: 288 });
      expect(900 + placement.left + placement.width).toBe(1000);
    });

    test("slides a panel that would cross the left edge of a phone back to the gutter", () => {
      /*
       * A stacked card header puts the trigger at the left of a 390px
       * screen: right-aligned, the panel would start at 150 - 288 = -138.
       */
      const placement: FeedOptionsPanelPlacement = getFeedOptionsPanelPlacement(
        {
          triggerLeft: 24,
          triggerRight: 150,
          viewportWidth: 390,
        },
      );

      expect(placement).toEqual({ left: -8, width: 288 });
      expect(24 + placement.left).toBe(16);
    });

    test("slides a panel that would cross the right edge back to the gutter", () => {
      // The trigger's right edge sits inside the 16px gutter.
      const placement: FeedOptionsPanelPlacement = getFeedOptionsPanelPlacement(
        {
          triggerLeft: 300,
          triggerRight: 385,
          viewportWidth: 390,
        },
      );

      // Panel left = 390 - 16 - 288 = 86, i.e. 86 - 300 from the trigger.
      expect(placement).toEqual({ left: -214, width: 288 });
      expect(300 + placement.left + placement.width).toBe(390 - 16);
    });

    test("narrows the panel to fit a viewport under 288px plus both gutters", () => {
      const placement: FeedOptionsPanelPlacement = getFeedOptionsPanelPlacement(
        {
          triggerLeft: 20,
          triggerRight: 100,
          viewportWidth: 300,
        },
      );

      expect(placement).toEqual({ left: -4, width: 300 - 32 });
      expect(20 + placement.left).toBe(16);
      expect(20 + placement.left + placement.width).toBe(300 - 16);

      // At exactly 288 + 32 the full width still fits.
      expect(
        getFeedOptionsPanelPlacement({
          triggerLeft: 20,
          triggerRight: 100,
          viewportWidth: 320,
        }).width,
      ).toBe(288);
    });

    test.each<[number]>([[0], [20], [32]])(
      "never gives a negative width in a degenerate %ipx viewport",
      (viewportWidth: number) => {
        const placement: FeedOptionsPanelPlacement =
          getFeedOptionsPanelPlacement({
            triggerLeft: 0,
            triggerRight: 0,
            viewportWidth,
          });

        expect(placement.width).toBe(0);
        expect(Number.isFinite(placement.left)).toBe(true);
      },
    );

    test("keeps the panel inside the gutters wherever the trigger sits, and right-aligned whenever that fits", () => {
      const triggerWidth: number = 40;

      for (const viewportWidth of [320, 390, 768, 1024, 1440]) {
        for (
          let triggerLeft: number = 0;
          triggerLeft + triggerWidth <= viewportWidth;
          triggerLeft += 37
        ) {
          const triggerRight: number = triggerLeft + triggerWidth;
          const placement: FeedOptionsPanelPlacement =
            getFeedOptionsPanelPlacement({
              triggerLeft,
              triggerRight,
              viewportWidth,
            });
          const panelLeft: number = triggerLeft + placement.left;
          const panelRight: number = panelLeft + placement.width;

          expect(placement.width).toBe(288);
          expect(panelLeft).toBeGreaterThanOrEqual(16);
          expect(panelRight).toBeLessThanOrEqual(viewportWidth - 16);

          if (triggerRight - 288 >= 16 && triggerRight <= viewportWidth - 16) {
            expect(panelRight).toBe(triggerRight);
          }
        }
      }
    });

    test("places the open panel from the trigger's box and the viewport, re-places it on resize and again on re-open", () => {
      render(<Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />);

      // The trigger's wrapper is what the panel is positioned against.
      const container: HTMLElement = getTrigger().parentElement!;
      let triggerBox: { left: number; right: number } = {
        left: 24,
        right: 150,
      };
      let viewportWidth: number = 390;

      const rectSpy: SpyInstance<() => DOMRect> = jest
        .spyOn(container, "getBoundingClientRect")
        .mockImplementation((): DOMRect => {
          return makeRect(triggerBox.left, triggerBox.right);
        });
      const widthSpy: SpyInstance<() => number> = jest
        .spyOn(document.documentElement, "clientWidth", "get")
        .mockImplementation((): number => {
          return viewportWidth;
        });

      try {
        const panel: HTMLElement = openPanel();

        expect(rectSpy).toHaveBeenCalled();
        // Phone: slid right so its left edge is 16px from the screen's.
        expect(panel).toHaveStyle({ left: "-8px", width: "288px" });
        // The fallback classes would fight the measured position.
        expect(panel).not.toHaveClass("right-0");
        expect(panel).not.toHaveClass("w-72");

        // Rotated to a wide screen with the trigger now on the right.
        viewportWidth = 1280;
        triggerBox = { left: 900, right: 1000 };
        fireEvent(window, new Event("resize"));

        expect(queryPanel()).toBe(panel);
        expect(panel).toHaveStyle({ left: "-188px", width: "288px" });

        fireEvent.keyDown(getRadio("Newest first"), { key: "Escape" });
        expect(queryPanel()).not.toBeInTheDocument();

        // Re-opened on a screen narrower than the panel plus both gutters.
        viewportWidth = 300;
        triggerBox = { left: 20, right: 100 };

        const reopened: HTMLElement = openPanel();

        expect(reopened).toHaveStyle({ left: "-4px", width: "268px" });
      } finally {
        rectSpy.mockRestore();
        widthSpy.mockRestore();
      }

      // Restored, so no later test measures against this fake layout.
      expect(jest.isMockFunction(container.getBoundingClientRect)).toBe(false);
      expect(
        jest.isMockFunction(
          Object.getOwnPropertyDescriptor(
            document.documentElement,
            "clientWidth",
          )?.get,
        ),
      ).toBe(false);
    });

    test("falls back to window.innerWidth when the document reports no width", () => {
      const originalInnerWidth: number = window.innerWidth;
      const innerWidthDescriptor: PropertyDescriptor | undefined =
        Object.getOwnPropertyDescriptor(window, "innerWidth");

      render(<Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />);

      const container: HTMLElement = getTrigger().parentElement!;
      const rectSpy: SpyInstance<() => DOMRect> = jest
        .spyOn(container, "getBoundingClientRect")
        .mockImplementation((): DOMRect => {
          return makeRect(24, 150);
        });

      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: 390,
      });

      try {
        // jsdom lays nothing out, so documentElement.clientWidth is 0.
        expect(document.documentElement.clientWidth).toBe(0);

        const panel: HTMLElement = openPanel();

        expect(panel).toHaveStyle({ left: "-8px", width: "288px" });
      } finally {
        rectSpy.mockRestore();

        if (innerWidthDescriptor) {
          Object.defineProperty(window, "innerWidth", innerWidthDescriptor);
        } else {
          Reflect.deleteProperty(window, "innerWidth");
        }
      }

      expect(window.innerWidth).toBe(originalInnerWidth);
    });

    test("stops listening for resize once the panel closes", () => {
      const addSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        window,
        "addEventListener",
      );
      const removeSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        window,
        "removeEventListener",
      );

      try {
        render(<Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />);

        openPanel();

        const resizeListeners: Array<unknown> = getListeners(addSpy, "resize");

        expect(resizeListeners.length).toBeGreaterThan(0);

        fireEvent.keyDown(getRadio("Newest first"), { key: "Escape" });

        const removedListeners: Array<unknown> = getListeners(
          removeSpy,
          "resize",
        );

        for (const listener of resizeListeners) {
          expect(removedListeners).toContain(listener);
        }
      } finally {
        addSpy.mockRestore();
        removeSpy.mockRestore();
      }
    });
  });

  describe("sort order", () => {
    test("renders two radios in a group labelled by its heading, with roving tab stops", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      openPanel();

      const group: HTMLElement = screen.getByRole("radiogroup", {
        name: "Sort by time",
      });
      const radios: Array<HTMLElement> = within(group).getAllByRole("radio");

      expect(radios).toHaveLength(2);
      expect(radios[0]).toHaveAccessibleName("Newest first");
      expect(radios[1]).toHaveAccessibleName("Oldest first");
      expect(radios[0]).toHaveAttribute("aria-checked", "true");
      expect(radios[1]).toHaveAttribute("aria-checked", "false");
      expect(radios[0]).toHaveAttribute("tabindex", "0");
      expect(radios[1]).toHaveAttribute("tabindex", "-1");
      expect(
        radios.filter((radio: HTMLElement) => {
          return radio.getAttribute("aria-checked") === "true";
        }),
      ).toHaveLength(1);
    });

    /*
     * BarsArrowUp used to draw the same path as BarsArrowDown, so the two
     * orders looked identical.
     */
    test("draws a different glyph for each order", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      openPanel();

      const newestGlyph: string = getLeadingGlyphPath(getRadio("Newest first"));
      const oldestGlyph: string = getLeadingGlyphPath(getRadio("Oldest first"));

      expect(newestGlyph).not.toBe("");
      expect(oldestGlyph).not.toBe("");
      expect(oldestGlyph).not.toBe(newestGlyph);
      expect(oldestGlyph).toBe(getGlyphPath(IconProp.BarsArrowUp));
    });

    test("moves the checked state, the tab stop and the emphasis when the order changes", () => {
      render(<Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />);

      openPanel();
      fireEvent.click(getRadio("Oldest first"));

      expect(getRadio("Oldest first")).toHaveAttribute("aria-checked", "true");
      expect(getRadio("Oldest first")).toHaveAttribute("tabindex", "0");
      expect(getRadio("Newest first")).toHaveAttribute("aria-checked", "false");
      expect(getRadio("Newest first")).toHaveAttribute("tabindex", "-1");
      // The chosen order is marked by weight too, not by a pale fill alone.
      expect(getRadio("Oldest first")).toHaveClass("font-semibold");
      expect(getRadio("Newest first")).not.toHaveClass("font-semibold");
      expect(queryPanel()).toBeInTheDocument();
    });

    test("reports the new order and keeps the chosen event types", () => {
      const onChange: OnChangeMock = createOnChange();
      const value: FeedOptions = {
        sortOrder: SortOrder.Descending,
        eventTypes: ["IncidentCreated", "OwnerUserAdded"],
      };

      render(
        <FeedOptionsButton
          value={value}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={onChange}
        />,
      );

      openPanel();
      fireEvent.click(getRadio("Oldest first"));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        sortOrder: SortOrder.Ascending,
        eventTypes: ["IncidentCreated", "OwnerUserAdded"],
      });
      // The value it was given is left alone.
      expect(value).toEqual({
        sortOrder: SortOrder.Descending,
        eventTypes: ["IncidentCreated", "OwnerUserAdded"],
      });
    });

    test("reports newest-first from an ascending view", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <FeedOptionsButton
          value={{
            sortOrder: SortOrder.Ascending,
            eventTypes: ["OwnerUserAdded"],
          }}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={onChange}
        />,
      );

      openPanel();
      fireEvent.click(getRadio("Newest first"));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        sortOrder: SortOrder.Descending,
        eventTypes: ["OwnerUserAdded"],
      });
    });

    test("does not report a change when the checked order is clicked again", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={onChange}
        />,
      );

      openPanel();
      fireEvent.click(getRadio("Newest first"));

      expect(onChange).not.toHaveBeenCalled();
      expect(queryPanel()).toBeInTheDocument();
    });

    test("reports the next order from an arrow key with the exact payload", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <FeedOptionsButton
          value={{
            sortOrder: SortOrder.Descending,
            eventTypes: ["IncidentStateChanged"],
          }}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={onChange}
        />,
      );

      openPanel();

      // false: the arrow key's default (scrolling the page) is prevented.
      expect(
        fireEvent.keyDown(getRadio("Newest first"), { key: "ArrowDown" }),
      ).toBe(false);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        sortOrder: SortOrder.Ascending,
        eventTypes: ["IncidentStateChanged"],
      });
      expect(getRadio("Oldest first")).toHaveFocus();
    });

    test("moves selection and focus with every arrow key, wrapping at both ends", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <Harness eventTypeOptions={EVENT_TYPE_OPTIONS} onChange={onChange} />,
      );

      openPanel();
      expect(getRadio("Newest first")).toHaveFocus();

      const steps: Array<[string, string, string, SortOrder]> = [
        ["ArrowRight", "Newest first", "Oldest first", SortOrder.Ascending],
        ["ArrowRight", "Oldest first", "Newest first", SortOrder.Descending],
        ["ArrowLeft", "Newest first", "Oldest first", SortOrder.Ascending],
        ["ArrowUp", "Oldest first", "Newest first", SortOrder.Descending],
        ["ArrowDown", "Newest first", "Oldest first", SortOrder.Ascending],
        ["ArrowLeft", "Oldest first", "Newest first", SortOrder.Descending],
        ["ArrowUp", "Newest first", "Oldest first", SortOrder.Ascending],
        ["ArrowDown", "Oldest first", "Newest first", SortOrder.Descending],
      ];

      for (const [key, fromName, toName, sortOrder] of steps) {
        fireEvent.keyDown(getRadio(fromName), { key });

        expect(getRadio(toName)).toHaveFocus();
        expect(getRadio(toName)).toHaveAttribute("aria-checked", "true");
        expect(getRadio(toName)).toHaveAttribute("tabindex", "0");
        expect(getRadio(fromName)).toHaveAttribute("aria-checked", "false");
        expect(getRadio(fromName)).toHaveAttribute("tabindex", "-1");
        expect(getLastCall(onChange)).toEqual({ sortOrder, eventTypes: [] });
      }

      expect(onChange).toHaveBeenCalledTimes(steps.length);
      expect(queryPanel()).toBeInTheDocument();
    });

    test.each<[string]>([["Home"], ["End"], ["Tab"], ["Enter"], ["a"]])(
      "ignores the %s key on a sort radio",
      (key: string) => {
        const onChange: OnChangeMock = createOnChange();

        render(
          <Harness eventTypeOptions={EVENT_TYPE_OPTIONS} onChange={onChange} />,
        );

        openPanel();

        // true: the key's default action is left alone.
        expect(fireEvent.keyDown(getRadio("Newest first"), { key })).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
        expect(getRadio("Newest first")).toHaveFocus();
        expect(getRadio("Newest first")).toHaveAttribute(
          "aria-checked",
          "true",
        );
        expect(queryPanel()).toBeInTheDocument();
      },
    );
  });

  describe("event types", () => {
    test("renders one labelled checkbox per option, in checklist order, inside a group named by its heading", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      openPanel();

      /*
       * The group, not the list, carries the heading: a screen reader
       * announces a group's name as focus enters it from any checkbox.
       */
      const group: HTMLElement = screen.getByRole("group", {
        name: "Event types",
      });
      const list: HTMLElement = within(group).getByRole("list");

      expect(within(list).getAllByRole("checkbox")).toHaveLength(3);
      expect(getCheckboxLabels()).toEqual([
        "Incident Created",
        "Incident State Changed",
        "User Added as Owner",
      ]);

      for (const option of EVENT_TYPE_OPTIONS) {
        expect(getCheckbox(option.label)).not.toBeChecked();
      }

      expect(getEventTypeSummary()).toHaveTextContent(UNFILTERED_SUMMARY);
      // Ticking a box re-words this line; it is read out when it does.
      expect(getEventTypeSummary()).toHaveAttribute("aria-live", "polite");
      expect(
        screen.queryByRole("button", { name: "Show all" }),
      ).not.toBeInTheDocument();
    });

    test("checks exactly the event types in the value", () => {
      render(
        <FeedOptionsButton
          value={{
            sortOrder: SortOrder.Descending,
            eventTypes: ["IncidentStateChanged"],
          }}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      openPanel();

      expect(getCheckbox("Incident Created")).not.toBeChecked();
      expect(getCheckbox("Incident State Changed")).toBeChecked();
      expect(getCheckbox("User Added as Owner")).not.toBeChecked();
      expect(getEventTypeSummary()).toHaveTextContent(
        "Showing 1 of 3 event types.",
      );
    });

    test("adds a ticked event type and keeps the sort order", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <FeedOptionsButton
          value={{ sortOrder: SortOrder.Ascending, eventTypes: [] }}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={onChange}
        />,
      );

      openPanel();
      fireEvent.click(getCheckbox("User Added as Owner"));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        sortOrder: SortOrder.Ascending,
        eventTypes: ["OwnerUserAdded"],
      });
    });

    test("puts a newly ticked event type in checklist order, not click order", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <FeedOptionsButton
          value={{
            sortOrder: SortOrder.Descending,
            eventTypes: ["OwnerUserAdded"],
          }}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={onChange}
        />,
      );

      openPanel();
      fireEvent.click(getCheckbox("Incident Created"));

      expect(onChange).toHaveBeenCalledWith({
        sortOrder: SortOrder.Descending,
        eventTypes: ["IncidentCreated", "OwnerUserAdded"],
      });
    });

    test("removes an unticked event type and keeps the sort order", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <FeedOptionsButton
          value={{
            sortOrder: SortOrder.Ascending,
            eventTypes: ["IncidentCreated", "IncidentStateChanged"],
          }}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={onChange}
        />,
      );

      openPanel();
      fireEvent.click(getCheckbox("Incident Created"));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        sortOrder: SortOrder.Ascending,
        eventTypes: ["IncidentStateChanged"],
      });
    });

    /*
     * The value can name an event type the checklist no longer offers (a
     * filter chosen before the feed's event types changed). A toggle reports
     * only what the checklist has, so the stale type never reaches the API.
     */
    test.each<[string, string, Array<string>]>([
      ["ticking", "User Added as Owner", ["IncidentCreated", "OwnerUserAdded"]],
      ["unticking", "Incident Created", []],
    ])(
      "drops an event type missing from the checklist when %s another",
      (
        _label: string,
        checkboxName: string,
        expectedEventTypes: Array<string>,
      ) => {
        const onChange: OnChangeMock = createOnChange();

        render(
          <FeedOptionsButton
            value={{
              sortOrder: SortOrder.Descending,
              eventTypes: ["Gone", "IncidentCreated"],
            }}
            eventTypeOptions={EVENT_TYPE_OPTIONS}
            onChange={onChange}
          />,
        );

        openPanel();
        fireEvent.click(getCheckbox(checkboxName));

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith({
          sortOrder: SortOrder.Descending,
          eventTypes: expectedEventTypes,
        });
      },
    );

    test("ticks, counts and unticks through the controlled round trip", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <Harness eventTypeOptions={EVENT_TYPE_OPTIONS} onChange={onChange} />,
      );

      openPanel();

      // Ticked last-first; every payload still follows the checklist.
      fireEvent.click(getCheckbox("User Added as Owner"));
      expect(getLastCall(onChange)).toEqual({
        sortOrder: SortOrder.Descending,
        eventTypes: ["OwnerUserAdded"],
      });
      expect(screen.getByTestId("feed-options-count")).toHaveTextContent(/^1$/);
      expect(getEventTypeSummary()).toHaveTextContent(
        "Showing 1 of 3 event types.",
      );

      fireEvent.click(getCheckbox("Incident Created"));
      expect(getLastCall(onChange)).toEqual({
        sortOrder: SortOrder.Descending,
        eventTypes: ["IncidentCreated", "OwnerUserAdded"],
      });
      expect(screen.getByTestId("feed-options-count")).toHaveTextContent(/^2$/);
      expect(getEventTypeSummary()).toHaveTextContent(
        "Showing 2 of 3 event types.",
      );
      expect(getTrigger()).toHaveAccessibleName(TRIGGER_NAME);
      expect(getTrigger()).toHaveAccessibleDescription(
        "Newest first, 2 of 3 event types",
      );

      fireEvent.click(getCheckbox("Incident State Changed"));
      expect(getLastCall(onChange)).toEqual({
        sortOrder: SortOrder.Descending,
        eventTypes: [
          "IncidentCreated",
          "IncidentStateChanged",
          "OwnerUserAdded",
        ],
      });
      expect(screen.getByTestId("feed-options-count")).toHaveTextContent(/^3$/);

      fireEvent.click(getCheckbox("Incident Created"));
      expect(getLastCall(onChange)).toEqual({
        sortOrder: SortOrder.Descending,
        eventTypes: ["IncidentStateChanged", "OwnerUserAdded"],
      });
      expect(getCheckbox("Incident Created")).not.toBeChecked();
      expect(getCheckbox("Incident State Changed")).toBeChecked();
      expect(getCheckbox("User Added as Owner")).toBeChecked();

      fireEvent.click(getCheckbox("Incident State Changed"));
      fireEvent.click(getCheckbox("User Added as Owner"));
      expect(getLastCall(onChange)).toEqual({
        sortOrder: SortOrder.Descending,
        eventTypes: [],
      });
      expect(
        screen.queryByTestId("feed-options-count"),
      ).not.toBeInTheDocument();
      expect(getEventTypeSummary()).toHaveTextContent(UNFILTERED_SUMMARY);
      expect(getTrigger()).toHaveAccessibleDescription(
        "Newest first, all event types",
      );
      expect(onChange).toHaveBeenCalledTimes(6);
    });

    test("keeps the panel open while several boxes are ticked in one visit", () => {
      render(<Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />);

      openPanel();

      for (const option of EVENT_TYPE_OPTIONS) {
        fireEvent.click(getCheckbox(option.label));

        expect(queryPanel()).toBeInTheDocument();
        expect(getCheckbox(option.label)).toBeChecked();
      }

      expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("feed-options-count")).toHaveTextContent(/^3$/);
      expect(getEventTypeSummary()).toHaveTextContent(
        "Showing 3 of 3 event types.",
      );
    });

    test("offers Show all only while something is ticked, and it clears the filter but not the order", () => {
      const onChange: OnChangeMock = createOnChange();

      const { rerender } = render(
        <FeedOptionsButton
          value={{
            sortOrder: SortOrder.Ascending,
            eventTypes: ["IncidentCreated", "OwnerUserAdded"],
          }}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={onChange}
        />,
      );

      openPanel();
      fireEvent.click(screen.getByRole("button", { name: "Show all" }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        sortOrder: SortOrder.Ascending,
        eventTypes: [],
      });

      // The same open panel with nothing ticked: no Show all to offer.
      rerender(
        <FeedOptionsButton
          value={{ sortOrder: SortOrder.Ascending, eventTypes: [] }}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={onChange}
        />,
      );

      expect(queryPanel()).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Show all" }),
      ).not.toBeInTheDocument();
    });

    test("Show all empties the checklist and then disappears", () => {
      render(
        <Harness
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          initialValue={{
            sortOrder: SortOrder.Ascending,
            eventTypes: ["IncidentCreated", "IncidentStateChanged"],
          }}
        />,
      );

      openPanel();
      fireEvent.click(screen.getByRole("button", { name: "Show all" }));

      for (const option of EVENT_TYPE_OPTIONS) {
        expect(getCheckbox(option.label)).not.toBeChecked();
      }

      expect(
        screen.queryByRole("button", { name: "Show all" }),
      ).not.toBeInTheDocument();
      expect(getEventTypeSummary()).toHaveTextContent(UNFILTERED_SUMMARY);
      expect(getRadio("Oldest first")).toHaveAttribute("aria-checked", "true");
      expect(queryPanel()).toBeInTheDocument();
    });

    test("shows the no-event-types message for a feed with an empty checklist", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={[]}
          onChange={createOnChange()}
        />,
      );

      expect(getTrigger()).toHaveAccessibleName(TRIGGER_NAME);
      expect(getTrigger()).toHaveAccessibleDescription(
        "Newest first, all event types",
      );

      openPanel();

      expect(
        screen.getByText("This feed has no event types to filter by."),
      ).toBeVisible();
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      expect(
        screen.queryByRole("textbox", { name: "Search event types" }),
      ).not.toBeInTheDocument();
      expect(getEventTypeSummary()).toHaveTextContent(UNFILTERED_SUMMARY);
      // The sort order still works without any event types.
      expect(screen.getAllByRole("radio")).toHaveLength(2);
    });
  });

  describe("icons", () => {
    test("renders an option's icon and leaves an option without one plain", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      openPanel();

      const withIcon: HTMLElement | null =
        getCheckbox("Incident Created").closest("label");
      const withoutIcon: HTMLElement | null = getCheckbox(
        "User Added as Owner",
      ).closest("label");

      expect(withIcon).not.toBeNull();
      expect(withoutIcon).not.toBeNull();
      expect(withIcon!.querySelector("svg")).not.toBeNull();
      expect(withoutIcon!.querySelector("svg")).toBeNull();
      // The icon is decoration: the checkbox is named by its label alone.
      expect(getCheckbox("Incident Created")).toHaveAccessibleName(
        "Incident Created",
      );
      expect(getCheckbox("User Added as Owner")).toHaveAccessibleName(
        "User Added as Owner",
      );
    });
  });

  describe("reset", () => {
    test("is not offered for the default view", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      openPanel();

      expect(
        screen.queryByRole("button", { name: "Reset to default" }),
      ).not.toBeInTheDocument();
    });

    test.each<[string, FeedOptions]>([
      [
        "the order is oldest first",
        { sortOrder: SortOrder.Ascending, eventTypes: [] },
      ],
      [
        "event types are ticked",
        { sortOrder: SortOrder.Descending, eventTypes: ["IncidentCreated"] },
      ],
      [
        "both differ from default",
        {
          sortOrder: SortOrder.Ascending,
          eventTypes: ["IncidentCreated", "OwnerUserAdded"],
        },
      ],
    ])(
      "resets both the order and the filter when %s",
      (_label: string, value: FeedOptions) => {
        const onChange: OnChangeMock = createOnChange();

        render(
          <FeedOptionsButton
            value={value}
            eventTypeOptions={EVENT_TYPE_OPTIONS}
            onChange={onChange}
          />,
        );

        openPanel();
        fireEvent.click(
          screen.getByRole("button", { name: "Reset to default" }),
        );

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith({
          sortOrder: SortOrder.Descending,
          eventTypes: [],
        });
      },
    );

    test("returns the whole control to its default look and then disappears", () => {
      render(
        <Harness
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          initialValue={{
            sortOrder: SortOrder.Ascending,
            eventTypes: ["IncidentStateChanged", "OwnerUserAdded"],
          }}
        />,
      );

      openPanel();
      fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

      expect(getRadio("Newest first")).toHaveAttribute("aria-checked", "true");

      for (const option of EVENT_TYPE_OPTIONS) {
        expect(getCheckbox(option.label)).not.toBeChecked();
      }

      expect(
        screen.queryByRole("button", { name: "Reset to default" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("feed-options-count"),
      ).not.toBeInTheDocument();
      expect(getTrigger()).toHaveClass(...DEFAULT_TRIGGER_CLASSES);
      expect(getTrigger()).toHaveAccessibleDescription(
        "Newest first, all event types",
      );
      expect(getLeadingGlyphPath(getTrigger())).toBe(
        getGlyphPath(IconProp.Filter),
      );
      expect(queryPanel()).toBeInTheDocument();
    });
  });

  describe("search", () => {
    test("uses a threshold of eight event types", () => {
      expect(FEED_EVENT_TYPE_SEARCH_THRESHOLD).toBe(8);
    });

    test("is absent when the checklist is at the threshold", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS.slice(
            0,
            FEED_EVENT_TYPE_SEARCH_THRESHOLD,
          )}
          onChange={createOnChange()}
        />,
      );

      openPanel();

      expect(screen.getAllByRole("checkbox")).toHaveLength(
        FEED_EVENT_TYPE_SEARCH_THRESHOLD,
      );
      expect(
        screen.queryByRole("textbox", { name: "Search event types" }),
      ).not.toBeInTheDocument();
    });

    test("is absent for a short checklist", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      openPanel();

      expect(
        screen.queryByRole("textbox", { name: "Search event types" }),
      ).not.toBeInTheDocument();
    });

    test("appears once the checklist is longer than the threshold", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS.slice(
            0,
            FEED_EVENT_TYPE_SEARCH_THRESHOLD + 1,
          )}
          onChange={createOnChange()}
        />,
      );

      openPanel();

      const search: HTMLElement = getSearchInput();

      expect(search).toHaveValue("");
      expect(search).toHaveAttribute("placeholder", "Search event types");
      expect(screen.getAllByRole("checkbox")).toHaveLength(
        FEED_EVENT_TYPE_SEARCH_THRESHOLD + 1,
      );
    });

    test.each<[string, Array<string>]>([
      ["INCIDENT", ["Incident Created", "Incident Resolved"]],
      ["incident", ["Incident Created", "Incident Resolved"]],
      [
        "notification",
        ["Owner Notification Sent", "Subscriber Notification Sent"],
      ],
      ["as owner", ["Team Added as Owner", "User Added as Owner"]],
      ["  resolved  ", ["Alert Resolved", "Incident Resolved"]],
      ["ACKNOW", ["Alert Acknowledged"]],
    ])(
      "filters the checklist to labels containing %p, ignoring case",
      (term: string, expectedLabels: Array<string>) => {
        render(
          <FeedOptionsButton
            value={DEFAULT_FEED_OPTIONS}
            eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
            onChange={createOnChange()}
          />,
        );

        openPanel();
        fireEvent.change(getSearchInput(), { target: { value: term } });

        expect(getSearchInput()).toHaveValue(term);
        expect(getCheckboxLabels()).toEqual(expectedLabels);
      },
    );

    test("restores the whole checklist when the search is cleared", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      openPanel();
      fireEvent.change(getSearchInput(), { target: { value: "alert" } });
      expect(getCheckboxLabels()).toHaveLength(3);

      fireEvent.change(getSearchInput(), { target: { value: "   " } });
      expect(getCheckboxLabels()).toHaveLength(LONG_EVENT_TYPE_OPTIONS.length);

      fireEvent.change(getSearchInput(), { target: { value: "" } });
      expect(getCheckboxLabels()).toEqual(
        LONG_EVENT_TYPE_OPTIONS.map((option: FeedEventTypeOption) => {
          return option.label;
        }),
      );
    });

    test("matches labels, not raw event type values", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      openPanel();
      fireEvent.change(getSearchInput(), { target: { value: "OwnerUser" } });

      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    });

    test("says so when nothing matches", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      openPanel();
      fireEvent.change(getSearchInput(), { target: { value: "  zzz  " } });

      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      expect(screen.getByText('No event types match "zzz".')).toBeVisible();
      expect(
        screen.queryByText("This feed has no event types to filter by."),
      ).not.toBeInTheDocument();
    });

    /*
     * The filtered list changes silently under the search box, so the number
     * of matches is spoken from a live region. It is mounted empty with the
     * search box: a region that appears together with its first text is
     * often not announced at all.
     */
    test("announces the number of matches, and nothing while there is no search", () => {
      render(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      openPanel();

      const results: HTMLElement = getSearchResults();

      expect(results).toHaveAttribute("aria-live", "polite");
      expect(results.textContent).toBe("");

      fireEvent.change(getSearchInput(), { target: { value: "incident" } });

      expect(getCheckboxLabels()).toHaveLength(2);
      expect(getSearchResults()).toBe(results);
      expect(results).toHaveTextContent(/^Matching event types: 2$/);

      fireEvent.change(getSearchInput(), { target: { value: "   " } });

      expect(results.textContent).toBe("");

      fireEvent.change(getSearchInput(), { target: { value: "zzz" } });

      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      expect(screen.getByText('No event types match "zzz".')).toBeVisible();
      expect(results).toHaveTextContent(/^Matching event types: 0$/);

      fireEvent.change(getSearchInput(), { target: { value: "" } });

      expect(results.textContent).toBe("");
    });

    test("ticks a search result without dropping a ticked event type the search hides", () => {
      const onChange: OnChangeMock = createOnChange();

      render(
        <Harness
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          initialValue={{
            sortOrder: SortOrder.Ascending,
            eventTypes: ["OwnerUserAdded"],
          }}
          onChange={onChange}
        />,
      );

      openPanel();
      fireEvent.change(getSearchInput(), { target: { value: "incident" } });
      fireEvent.click(getCheckbox("Incident Resolved"));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        sortOrder: SortOrder.Ascending,
        eventTypes: ["IncidentResolved", "OwnerUserAdded"],
      });
      // The search stays put so the reader can keep ticking results.
      expect(getSearchInput()).toHaveValue("incident");
      expect(getCheckboxLabels()).toEqual([
        "Incident Created",
        "Incident Resolved",
      ]);
      expect(getCheckbox("Incident Resolved")).toBeChecked();
      expect(getEventTypeSummary()).toHaveTextContent(
        `Showing 2 of ${LONG_EVENT_TYPE_OPTIONS.length} event types.`,
      );
      expect(queryPanel()).toBeInTheDocument();
    });

    test.each<[string, () => void]>([
      [
        "Escape",
        (): void => {
          fireEvent.keyDown(getSearchInput(), { key: "Escape" });
        },
      ],
      [
        "a press outside",
        (): void => {
          fireEvent.mouseDown(document.body);
        },
      ],
      [
        "the trigger",
        (): void => {
          fireEvent.mouseDown(getTrigger());
          fireEvent.click(getTrigger());
        },
      ],
      [
        "focus leaving the control",
        (): void => {
          const outside: HTMLElement = screen.getByRole("button", {
            name: "Outside",
          });

          act(() => {
            outside.focus();
          });
        },
      ],
    ])(
      "clears the search text when closed by %s",
      (_label: string, dismiss: () => void) => {
        render(
          <div>
            <FeedOptionsButton
              value={DEFAULT_FEED_OPTIONS}
              eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
              onChange={createOnChange()}
            />
            <button type="button">Outside</button>
          </div>,
        );

        openPanel();

        const search: HTMLElement = getSearchInput();

        act(() => {
          search.focus();
        });
        fireEvent.change(search, { target: { value: "incident" } });
        expect(getCheckboxLabels()).toHaveLength(2);

        dismiss();
        expect(queryPanel()).not.toBeInTheDocument();

        openPanel();

        expect(getSearchInput()).toHaveValue("");
        expect(getSearchResults().textContent).toBe("");
        expect(getCheckboxLabels()).toHaveLength(
          LONG_EVENT_TYPE_OPTIONS.length,
        );
      },
    );
  });

  describe("dismissal", () => {
    const renderWithOutside: (onChange?: OnChangeMock) => void = (
      onChange?: OnChangeMock,
    ): void => {
      render(
        <div>
          <Harness eventTypeOptions={EVENT_TYPE_OPTIONS} onChange={onChange} />
          <button type="button">Outside</button>
        </div>,
      );
    };

    const getOutside: () => HTMLElement = (): HTMLElement => {
      return screen.getByRole("button", { name: "Outside" });
    };

    test("Escape closes the panel and returns focus to the trigger", () => {
      renderWithOutside();

      openPanel();
      expect(getRadio("Newest first")).toHaveFocus();

      expect(
        fireEvent.keyDown(getRadio("Newest first"), { key: "Escape" }),
      ).toBe(false);

      expect(queryPanel()).not.toBeInTheDocument();
      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
      expect(getTrigger()).not.toHaveAttribute("aria-controls");
      expect(getTrigger()).toHaveFocus();
    });

    test("Escape from a checkbox also closes and returns focus", () => {
      renderWithOutside();

      openPanel();

      const checkbox: HTMLElement = getCheckbox("Incident Created");

      act(() => {
        checkbox.focus();
      });
      fireEvent.keyDown(checkbox, { key: "Escape" });

      expect(queryPanel()).not.toBeInTheDocument();
      expect(getTrigger()).toHaveFocus();
    });

    test("Escape inside the open panel does not reach an enclosing handler, but does when closed", () => {
      const onParentKeyDown: ReturnType<
        typeof jest.fn<(event: React.KeyboardEvent) => void>
      > = jest.fn<(event: React.KeyboardEvent) => void>();

      render(
        <div onKeyDown={onParentKeyDown}>
          <FeedOptionsButton
            value={DEFAULT_FEED_OPTIONS}
            eventTypeOptions={EVENT_TYPE_OPTIONS}
            onChange={createOnChange()}
          />
        </div>,
      );

      openPanel();
      fireEvent.keyDown(getRadio("Newest first"), { key: "Escape" });

      expect(queryPanel()).not.toBeInTheDocument();
      expect(onParentKeyDown).not.toHaveBeenCalled();

      // Closed, Escape is none of this control's business.
      expect(fireEvent.keyDown(getTrigger(), { key: "Escape" })).toBe(true);
      expect(onParentKeyDown).toHaveBeenCalledTimes(1);
      expect(queryPanel()).not.toBeInTheDocument();
    });

    test("a press outside closes the panel", () => {
      renderWithOutside();

      openPanel();
      fireEvent.mouseDown(getOutside());

      expect(queryPanel()).not.toBeInTheDocument();
      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
    });

    test("a press on the page body closes the panel", () => {
      renderWithOutside();

      openPanel();
      fireEvent.mouseDown(document.body);

      expect(queryPanel()).not.toBeInTheDocument();
    });

    test("a press inside the panel keeps it open", () => {
      renderWithOutside();

      const panel: HTMLElement = openPanel();

      fireEvent.mouseDown(panel);
      expect(queryPanel()).toBeInTheDocument();

      fireEvent.mouseDown(getCheckbox("Incident State Changed"));
      expect(queryPanel()).toBeInTheDocument();

      fireEvent.mouseDown(getRadio("Oldest first"));
      expect(queryPanel()).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByText("Sort by time"));
      expect(queryPanel()).toBeInTheDocument();
    });

    /*
     * A press on the panel's padding moves focus to the panel itself (the
     * nearest focusable ancestor of the press). Were the panel not focusable,
     * focus would fall to the page body, outside the control's key handler,
     * and Escape would stop closing it.
     */
    test("a press on the panel's padding keeps it open, and Escape from there still closes it", () => {
      renderWithOutside();

      const panel: HTMLElement = openPanel();

      expect(getRadio("Newest first")).toHaveFocus();

      fireEvent.mouseDown(panel);
      act(() => {
        panel.focus();
      });

      expect(queryPanel()).toBe(panel);
      expect(panel).toHaveFocus();

      expect(fireEvent.keyDown(panel, { key: "Escape" })).toBe(false);

      expect(queryPanel()).not.toBeInTheDocument();
      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
      expect(getTrigger()).toHaveFocus();
    });

    test("a press outside while closed changes nothing", () => {
      const onChange: OnChangeMock = createOnChange();

      renderWithOutside(onChange);

      fireEvent.mouseDown(getOutside());

      expect(queryPanel()).not.toBeInTheDocument();
      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
      expect(onChange).not.toHaveBeenCalled();
    });

    test("pressing the trigger while open closes it without re-opening", () => {
      renderWithOutside();

      openPanel();

      // A real press is mousedown then click.
      fireEvent.mouseDown(getTrigger());
      fireEvent.click(getTrigger());

      expect(queryPanel()).not.toBeInTheDocument();
      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");

      fireEvent.mouseDown(getTrigger());
      fireEvent.click(getTrigger());

      expect(queryPanel()).toBeInTheDocument();
      expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
    });

    test("focus moving to an element outside closes the panel", () => {
      renderWithOutside();

      openPanel();
      fireEvent.focusOut(getRadio("Newest first"), {
        relatedTarget: getOutside(),
      });

      expect(queryPanel()).not.toBeInTheDocument();
      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
    });

    test("tabbing focus out to another control closes the panel", () => {
      renderWithOutside();

      openPanel();

      act(() => {
        getOutside().focus();
      });

      expect(queryPanel()).not.toBeInTheDocument();
      expect(getOutside()).toHaveFocus();
    });

    test("a blur with no next focus, like switching to another window, keeps it open", () => {
      renderWithOutside();

      openPanel();
      fireEvent.focusOut(getRadio("Newest first"), { relatedTarget: null });
      expect(queryPanel()).toBeInTheDocument();

      fireEvent.blur(getRadio("Newest first"));
      expect(queryPanel()).toBeInTheDocument();
    });

    test("focus moving between controls inside the panel keeps it open", () => {
      renderWithOutside();

      openPanel();

      act(() => {
        getCheckbox("Incident Created").focus();
      });
      expect(queryPanel()).toBeInTheDocument();

      act(() => {
        getRadio("Newest first").focus();
      });
      expect(queryPanel()).toBeInTheDocument();

      // Shift+Tab from the first radio lands on the trigger, still inside.
      act(() => {
        getTrigger().focus();
      });
      expect(queryPanel()).toBeInTheDocument();
    });

    test("stops listening for outside presses once unmounted", () => {
      const addSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        document,
        "addEventListener",
      );
      const removeSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        document,
        "removeEventListener",
      );

      try {
        const { unmount } = render(
          <Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />,
        );

        openPanel();

        const mouseDownListeners: Array<unknown> = getListeners(
          addSpy,
          "mousedown",
        );

        expect(mouseDownListeners.length).toBeGreaterThan(0);

        unmount();

        /*
         * removeEventListener only detaches when the handler identity matches
         * the add, so compare the functions rather than counting calls.
         */
        const removedListeners: Array<unknown> = getListeners(
          removeSpy,
          "mousedown",
        );

        for (const listener of mouseDownListeners) {
          expect(removedListeners).toContain(listener);
        }
      } finally {
        addSpy.mockRestore();
        removeSpy.mockRestore();
      }
    });
  });

  /*
   * "Reset to default" and "Show all" each remove themselves once used, so
   * the button a keyboard user just pressed vanishes. Focus must land on
   * another control inside the panel rather than fall back to the page body,
   * where Escape would never reach the control's key handler and the panel
   * could no longer be closed from the keyboard.
   */
  describe("keyboard focus after an action that removes its own button", () => {
    const pressThenEscape: (
      buttonName: string,
      expectFocusOn: () => HTMLElement,
    ) => void = (
      buttonName: string,
      expectFocusOn: () => HTMLElement,
    ): void => {
      const button: HTMLElement = screen.getByRole("button", {
        name: buttonName,
      });

      act(() => {
        button.focus();
      });
      fireEvent.click(button);

      expect(
        screen.queryByRole("button", { name: buttonName }),
      ).not.toBeInTheDocument();
      expect(queryPanel()).toBeInTheDocument();
      expect(document.activeElement).not.toBe(document.body);
      expect(expectFocusOn()).toHaveFocus();

      fireEvent.keyDown(document.activeElement || document.body, {
        key: "Escape",
      });

      expect(queryPanel()).not.toBeInTheDocument();
      expect(getTrigger()).toHaveFocus();
    };

    test("Reset to default moves focus to Newest first, where Escape still closes the panel", () => {
      render(
        <Harness
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          initialValue={{
            sortOrder: SortOrder.Ascending,
            eventTypes: ["IncidentCreated"],
          }}
        />,
      );

      openPanel();
      pressThenEscape("Reset to default", () => {
        return screen.getByRole("radio", { name: "Newest first" });
      });
    });

    test("Show all moves focus to the first event type, where Escape still closes the panel", () => {
      render(
        <Harness
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          initialValue={{
            sortOrder: SortOrder.Ascending,
            eventTypes: ["IncidentCreated", "OwnerUserAdded"],
          }}
        />,
      );

      openPanel();
      pressThenEscape("Show all", () => {
        return screen.getAllByRole("checkbox")[0]!;
      });
    });

    /*
     * With a search that hides every row there is no checkbox to land on, so
     * focus goes to the checked sort order. Oldest first is checked here, so
     * this also tells "the checked radio" apart from "the first radio".
     */
    test("Show all while the search hides every row moves focus to the checked sort order, where Escape still closes the panel", () => {
      render(
        <Harness
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          initialValue={{
            sortOrder: SortOrder.Ascending,
            eventTypes: ["AlertCreated", "OwnerUserAdded"],
          }}
        />,
      );

      openPanel();
      fireEvent.change(getSearchInput(), { target: { value: "zzz" } });
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);

      pressThenEscape("Show all", () => {
        return getRadio("Oldest first");
      });
    });
  });

  describe("two instances on one page", () => {
    test("get distinct ids and do not interfere with each other", () => {
      const firstOnChange: OnChangeMock = createOnChange();
      const secondOnChange: OnChangeMock = createOnChange();

      render(
        <div>
          <Harness
            eventTypeOptions={EVENT_TYPE_OPTIONS}
            onChange={firstOnChange}
          />
          <Harness
            eventTypeOptions={LONG_EVENT_TYPE_OPTIONS.slice(0, 2)}
            onChange={secondOnChange}
          />
        </div>,
      );

      const triggers: Array<HTMLElement> = screen.getAllByRole("button", {
        name: TRIGGER_NAME,
      });

      expect(triggers).toHaveLength(2);

      const firstTrigger: HTMLElement = triggers[0]!;
      const secondTrigger: HTMLElement = triggers[1]!;

      expect(firstTrigger.id).not.toBe("");
      expect(secondTrigger.id).not.toBe("");
      expect(firstTrigger.id).not.toBe(secondTrigger.id);
      expect(firstTrigger.getAttribute("aria-describedby")).not.toBe(
        secondTrigger.getAttribute("aria-describedby"),
      );

      // Open the first one and filter it.
      fireEvent.click(firstTrigger);

      const firstPanel: HTMLElement = screen.getByRole("dialog", {
        name: PANEL_NAME,
      });
      const firstPanelId: string = firstPanel.id;

      expect(firstTrigger).toHaveAttribute("aria-controls", firstPanelId);
      expect(secondTrigger).toHaveAttribute("aria-expanded", "false");
      expect(secondTrigger).not.toHaveAttribute("aria-controls");
      expect(
        within(firstPanel).getByRole("radiogroup", { name: "Sort by time" }),
      ).toBeInTheDocument();
      expect(
        within(firstPanel).getByRole("group", { name: "Event types" }),
      ).toBeInTheDocument();

      fireEvent.click(
        within(firstPanel).getByRole("checkbox", {
          name: "Incident Created",
        }),
      );

      expect(firstOnChange).toHaveBeenCalledTimes(1);
      expect(secondOnChange).not.toHaveBeenCalled();

      // Pressing the second trigger is a press outside the first control.
      fireEvent.mouseDown(secondTrigger);
      fireEvent.click(secondTrigger);

      const panels: Array<HTMLElement> = screen.getAllByRole("dialog", {
        name: PANEL_NAME,
      });

      expect(panels).toHaveLength(1);

      const secondPanel: HTMLElement = panels[0]!;

      expect(secondPanel.id).not.toBe("");
      expect(secondPanel.id).not.toBe(firstPanelId);
      expect(firstTrigger).toHaveAttribute("aria-expanded", "false");
      expect(firstTrigger).not.toHaveAttribute("aria-controls");
      expect(secondTrigger).toHaveAttribute("aria-expanded", "true");
      expect(secondTrigger).toHaveAttribute("aria-controls", secondPanel.id);
      expect(
        within(secondPanel).getByRole("radio", { name: "Newest first" }),
      ).toHaveFocus();
      expect(
        within(secondPanel).getByRole("radiogroup", { name: "Sort by time" }),
      ).toBeInTheDocument();
      expect(
        within(secondPanel)
          .getAllByRole("checkbox")
          .map((checkbox: HTMLElement) => {
            return checkbox.closest("label")?.textContent || "";
          }),
      ).toEqual(["Alert Acknowledged", "Alert Created"]);

      fireEvent.click(
        within(secondPanel).getByRole("radio", { name: "Oldest first" }),
      );

      expect(secondOnChange).toHaveBeenCalledTimes(1);
      expect(secondOnChange).toHaveBeenCalledWith({
        sortOrder: SortOrder.Ascending,
        eventTypes: [],
      });
      expect(firstOnChange).toHaveBeenCalledTimes(1);

      // Each trigger keeps describing only its own feed.
      expect(firstTrigger).toHaveAccessibleDescription(
        "Newest first, 1 of 3 event types",
      );
      expect(secondTrigger).toHaveAccessibleDescription(
        "Oldest first, all event types",
      );
      expect(
        within(firstTrigger).getByTestId("feed-options-count"),
      ).toHaveTextContent(/^1$/);
      expect(
        within(secondTrigger).queryByTestId("feed-options-count"),
      ).not.toBeInTheDocument();
    });

    test("focus moving into the other instance closes the first", () => {
      render(
        <div>
          <Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />
          <Harness eventTypeOptions={EVENT_TYPE_OPTIONS} />
        </div>,
      );

      const triggers: Array<HTMLElement> = screen.getAllByRole("button", {
        name: TRIGGER_NAME,
      });

      fireEvent.click(triggers[0]!);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);

      // A click without a mousedown: only the focus hand-off can close it.
      fireEvent.click(triggers[1]!);

      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(triggers[0]).toHaveAttribute("aria-expanded", "false");
      expect(triggers[1]).toHaveAttribute("aria-expanded", "true");
    });
  });

  /*
   * A real i18next instance rather than a stubbed t(): the control looks its
   * sentences up whole, relies on i18next leaving the {{placeholders}} it is
   * not given, and fills them itself afterwards. Only a real instance proves
   * that hand-off. The German values are the shipped ones, copied from
   * App/FeatureSet/Dashboard/src/Locales/de.json; the keys are the English
   * source text, exactly as those locale files key them.
   *
   * The instance reaches the component through I18nextProvider only. Adding
   * .use(initReactI18next) would install it as react-i18next's global
   * instance and quietly turn every other test in this file German.
   */
  describe("in German", () => {
    const german: i18n = createInstance();

    /*
     * Two event labels whose German order differs from the English one.
     * "Incident State Changed" is left out on purpose: a label with no
     * translation yet stays in English, and is sorted among the German ones.
     */
    const GERMAN_TRANSLATIONS: Record<string, string> = {
      "Filter & Sort": "Filtern & Sortieren",
      "Filter and sort feed": "Feed filtern und sortieren",
      "Newest first": "Neueste zuerst",
      "Oldest first": "Älteste zuerst",
      "Event types": "Ereignistypen",
      "Search event types": "Ereignistypen suchen",
      "Matching event types: {{count}}": "Passende Ereignistypen: {{count}}",
      "Showing {{selected}} of {{total}} event types.":
        "{{selected}} von {{total}} Ereignistypen werden angezeigt.",
      "{{sortOrder}}, all event types": "{{sortOrder}}, alle Ereignistypen",
      "{{sortOrder}}, {{selected}} of {{total}} event types":
        "{{sortOrder}}, {{selected}} von {{total}} Ereignistypen",
      "Incident Created": "Vorfall erstellt",
      "User Added as Owner": "Benutzer als Eigentümer hinzugefügt",
    };

    beforeAll(async () => {
      await german.init({
        lng: "de",
        resources: { de: { translation: GERMAN_TRANSLATIONS } },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });
    });

    const renderInGerman: (ui: React.ReactElement) => RenderResult = (
      ui: React.ReactElement,
    ): RenderResult => {
      return render(<I18nextProvider i18n={german}>{ui}</I18nextProvider>);
    };

    const getGermanTrigger: () => HTMLElement = (): HTMLElement => {
      return screen.getByRole("button", { name: "Filtern & Sortieren" });
    };

    const openGermanPanel: () => HTMLElement = (): HTMLElement => {
      fireEvent.click(getGermanTrigger());

      return screen.getByRole("dialog", { name: "Feed filtern und sortieren" });
    };

    test("names the trigger with the German label and describes the view in German", () => {
      renderInGerman(
        <FeedOptionsButton
          value={DEFAULT_FEED_OPTIONS}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onChange={createOnChange()}
        />,
      );

      const trigger: HTMLElement = getGermanTrigger();

      expect(trigger).toHaveAccessibleName("Filtern & Sortieren");
      expect(trigger).toHaveAccessibleDescription(
        "Neueste zuerst, alle Ereignistypen",
      );
      expect(trigger).toHaveAttribute(
        "title",
        "Neueste zuerst, alle Ereignistypen",
      );

      openGermanPanel();

      expect(
        screen.getByRole("group", { name: "Ereignistypen" }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("radio").map((radio: HTMLElement) => {
          return radio.textContent;
        }),
      ).toEqual(["Neueste zuerst", "Älteste zuerst"]);
    });

    test("fills the German sentences with the numbers as boxes are ticked", () => {
      const onChange: OnChangeMock = createOnChange();

      renderInGerman(
        <Harness eventTypeOptions={EVENT_TYPE_OPTIONS} onChange={onChange} />,
      );

      openGermanPanel();
      fireEvent.click(getCheckbox("Vorfall erstellt"));

      expect(getLastCall(onChange)).toEqual({
        sortOrder: SortOrder.Descending,
        eventTypes: ["IncidentCreated"],
      });
      expect(getEventTypeSummary()).toHaveTextContent(
        /^1 von 3 Ereignistypen werden angezeigt\.$/,
      );
      expect(getGermanTrigger()).toHaveAccessibleDescription(
        "Neueste zuerst, 1 von 3 Ereignistypen",
      );

      fireEvent.click(getRadio("Älteste zuerst"));

      expect(getGermanTrigger()).toHaveAccessibleDescription(
        "Älteste zuerst, 1 von 3 Ereignistypen",
      );
    });

    test("orders the checklist by the German labels, while payloads keep the feed's own order", () => {
      const onChange: OnChangeMock = createOnChange();

      renderInGerman(
        <Harness eventTypeOptions={EVENT_TYPE_OPTIONS} onChange={onChange} />,
      );

      openGermanPanel();

      /*
       * In English this list reads Incident Created, Incident State Changed,
       * User Added as Owner.
       */
      expect(getCheckboxLabels()).toEqual([
        "Benutzer als Eigentümer hinzugefügt",
        "Incident State Changed",
        "Vorfall erstellt",
      ]);

      /*
       * Ticked top to bottom as a German reader sees them, the request still
       * lists them in the feed's order, so it - and the reload key - is the
       * same in every language.
       */
      fireEvent.click(getCheckbox("Benutzer als Eigentümer hinzugefügt"));
      fireEvent.click(getCheckbox("Vorfall erstellt"));

      expect(getLastCall(onChange)).toEqual({
        sortOrder: SortOrder.Descending,
        eventTypes: ["IncidentCreated", "OwnerUserAdded"],
      });
    });

    test("searches the German labels the reader sees, not the English ones behind them", () => {
      const onChange: OnChangeMock = createOnChange();

      renderInGerman(
        <Harness
          eventTypeOptions={LONG_EVENT_TYPE_OPTIONS}
          onChange={onChange}
        />,
      );

      openGermanPanel();

      const search: HTMLElement = screen.getByRole("textbox", {
        name: "Ereignistypen suchen",
      });

      fireEvent.change(search, { target: { value: "EIGENTÜMER" } });

      expect(getCheckboxLabels()).toEqual([
        "Benutzer als Eigentümer hinzugefügt",
      ]);
      expect(getSearchResults()).toHaveTextContent(
        /^Passende Ereignistypen: 1$/,
      );

      fireEvent.click(getCheckbox("Benutzer als Eigentümer hinzugefügt"));

      expect(getLastCall(onChange)).toEqual({
        sortOrder: SortOrder.Descending,
        eventTypes: ["OwnerUserAdded"],
      });

      // Its English label no longer matches; the untranslated rows still do.
      fireEvent.change(search, { target: { value: "as owner" } });

      expect(getCheckboxLabels()).toEqual(["Team Added as Owner"]);
    });
  });
});
