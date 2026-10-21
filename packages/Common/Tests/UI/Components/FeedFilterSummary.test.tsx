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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import FeedFilterSummary from "../../../UI/Components/Feed/FeedFilterSummary";
import {
  DEFAULT_FEED_OPTIONS,
  FEED_APPLIED_FILTERS_CHIP_LIMIT,
  FeedEventTypeOption,
  FeedOptions,
} from "../../../UI/Components/Feed/FeedOptions";
import { getGlyphOfIcon, getGlyphOfSvg } from "./MenuItemIcons";

/*
 * The box over a filtered feed: with the filter behind the ⋯ menu, this is
 * what tells the reader the feed is narrowed - and to what - so a filtered
 * feed is never mistaken for one with missing events. It is the box a
 * filtered table shows (AppliedFilters).
 */

type VoidMock = ReturnType<typeof jest.fn<() => void>>;

const EVENT_TYPE_OPTIONS: Array<FeedEventTypeOption> = [
  { value: "IncidentCreated", label: "Incident Created", icon: IconProp.Alert },
  { value: "PrivateNote", label: "Private Note", icon: IconProp.Lock },
  { value: "PublicNote", label: "Public Note", icon: IconProp.Announcement },
  { value: "OwnerUserAdded", label: "User Added as Owner" },
];

// Twelve event types, enough to pass the chip limit.
const MANY_EVENT_TYPE_OPTIONS: Array<FeedEventTypeOption> = Array.from(
  { length: 12 },
  (_value: unknown, index: number): FeedEventTypeOption => {
    const letter: string = String.fromCharCode(65 + index);

    return {
      value: `Type${letter}`,
      label: `Type ${letter}`,
      icon: IconProp.Circle,
    };
  },
);

interface RenderedSummary {
  onEditFilters: VoidMock;
  onClearFilters: VoidMock;
}

const renderSummary: (
  value: FeedOptions,
  eventTypeOptions?: Array<FeedEventTypeOption>,
) => RenderedSummary = (
  value: FeedOptions,
  eventTypeOptions: Array<FeedEventTypeOption> = EVENT_TYPE_OPTIONS,
): RenderedSummary => {
  const onEditFilters: VoidMock = jest.fn<() => void>();
  const onClearFilters: VoidMock = jest.fn<() => void>();

  render(
    <FeedFilterSummary
      value={value}
      eventTypeOptions={eventTypeOptions}
      onEditFilters={onEditFilters}
      onClearFilters={onClearFilters}
    />,
  );

  return { onEditFilters, onClearFilters };
};

const getChipTexts: () => Array<string> = (): Array<string> => {
  return Array.from(
    screen
      .getByTestId("feed-filter-summary")
      .querySelectorAll<HTMLElement>(".rounded-full"),
  ).map((chip: HTMLElement): string => {
    return (chip.textContent || "").trim();
  });
};

afterEach(() => {
  cleanup();
});

describe("FeedFilterSummary", () => {
  test.each<[string, FeedOptions]>([
    ["newest first", DEFAULT_FEED_OPTIONS],
    ["oldest first", { sortOrder: SortOrder.Ascending, eventTypes: [] }],
  ])(
    "shows nothing while the feed shows every event type (%s)",
    (_label: string, value: FeedOptions) => {
      const { container } = render(
        <FeedFilterSummary
          value={value}
          eventTypeOptions={EVENT_TYPE_OPTIONS}
          onEditFilters={jest.fn<() => void>()}
          onClearFilters={jest.fn<() => void>()}
        />,
      );

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId("feed-filter-summary")).toBeNull();
    },
  );

  test("says how many of the feed's event types it shows, with a chip for each", () => {
    renderSummary({
      sortOrder: SortOrder.Descending,
      eventTypes: ["PublicNote", "IncidentCreated"],
    });

    const box: HTMLElement = screen.getByTestId("feed-filter-summary");

    expect(within(box).getByText("Showing 2 of 4 event types")).toBeVisible();
    // Alphabetical, as the checklist lists them - not in the order ticked.
    expect(getChipTexts()).toEqual(["Incident Created", "Public Note"]);
  });

  test("gives each chip the icon its event type's items carry, and none to a type without one", () => {
    renderSummary({
      sortOrder: SortOrder.Descending,
      eventTypes: ["PrivateNote", "OwnerUserAdded"],
    });

    const privateNote: HTMLElement = screen.getByTestId(
      "feed-filter-chip-PrivateNote",
    );
    const owner: HTMLElement = screen.getByTestId(
      "feed-filter-chip-OwnerUserAdded",
    );

    expect(getGlyphOfSvg(privateNote.querySelector("svg"))).toBe(
      getGlyphOfIcon(IconProp.Lock),
    );
    expect(owner.querySelector("svg")).toBeNull();
    expect(owner).toHaveTextContent(/^User Added as Owner$/);
  });

  test("offers Edit Filters and Clear Filters, and each does only its own job", () => {
    const { onEditFilters, onClearFilters } = renderSummary({
      sortOrder: SortOrder.Descending,
      eventTypes: ["PublicNote"],
    });

    const box: HTMLElement = screen.getByTestId("feed-filter-summary");

    fireEvent.click(within(box).getByRole("button", { name: "Edit Filters" }));

    expect(onEditFilters).toHaveBeenCalledTimes(1);
    expect(onClearFilters).not.toHaveBeenCalled();

    fireEvent.click(within(box).getByRole("button", { name: "Clear Filters" }));

    expect(onClearFilters).toHaveBeenCalledTimes(1);
    expect(onEditFilters).toHaveBeenCalledTimes(1);
  });

  test("folds the chips past the limit into one 'and N more' chip", () => {
    renderSummary(
      {
        sortOrder: SortOrder.Descending,
        eventTypes: MANY_EVENT_TYPE_OPTIONS.slice(0, 11).map(
          (option: FeedEventTypeOption): string => {
            return option.value;
          },
        ),
      },
      MANY_EVENT_TYPE_OPTIONS,
    );

    expect(FEED_APPLIED_FILTERS_CHIP_LIMIT).toBe(8);
    expect(screen.getByText("Showing 11 of 12 event types")).toBeVisible();
    expect(getChipTexts()).toEqual([
      "Type A",
      "Type B",
      "Type C",
      "Type D",
      "Type E",
      "Type F",
      "Type G",
      "Type H",
      "and 3 more",
    ]);
    expect(screen.getByTestId("feed-filter-chip-more")).toHaveTextContent(
      /^and 3 more$/,
    );
  });

  test("shows every chip up to the limit, with no 'more' chip", () => {
    renderSummary(
      {
        sortOrder: SortOrder.Descending,
        eventTypes: MANY_EVENT_TYPE_OPTIONS.slice(
          0,
          FEED_APPLIED_FILTERS_CHIP_LIMIT,
        ).map((option: FeedEventTypeOption): string => {
          return option.value;
        }),
      },
      MANY_EVENT_TYPE_OPTIONS,
    );

    expect(getChipTexts()).toHaveLength(FEED_APPLIED_FILTERS_CHIP_LIMIT);
    expect(screen.queryByTestId("feed-filter-chip-more")).toBeNull();
  });

  test("leaves out an event type the feed does not have", () => {
    renderSummary({
      sortOrder: SortOrder.Descending,
      eventTypes: ["Gone", "PublicNote"],
    });

    expect(screen.getByText("Showing 1 of 4 event types")).toBeVisible();
    expect(getChipTexts()).toEqual(["Public Note"]);
  });

  test("is the box a filtered table shows: the same frame, chips and buttons", () => {
    renderSummary({
      sortOrder: SortOrder.Descending,
      eventTypes: ["PublicNote"],
    });

    const box: HTMLElement = screen.getByTestId("feed-filter-summary");

    expect(box).toHaveClass(
      "bg-gray-50",
      "rounded-xl",
      "p-4",
      "border",
      "border-gray-200",
    );
    expect(box.querySelector(".rounded-full")).toHaveClass(
      "bg-white",
      "border-gray-200",
      "shadow-sm",
    );
  });

  describe("in German", () => {
    const german: i18n = createInstance();

    const GERMAN_TRANSLATIONS: Record<string, string> = {
      "Showing {{selected}} of {{total}} event types":
        "{{selected}} von {{total}} Ereignistypen werden angezeigt",
      "and {{remaining}} more": "und {{remaining}} weitere",
      "Edit Filters": "Filter bearbeiten",
      "Clear Filters": "Filter löschen",
      "Type A": "Zusatztyp A",
      "Public Note": "Öffentliche Notiz",
      "Incident Created": "Vorfall erstellt",
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

    test("words the box in German and orders the chips by their German names", () => {
      render(
        <I18nextProvider i18n={german}>
          <FeedFilterSummary
            value={{
              sortOrder: SortOrder.Descending,
              eventTypes: ["PublicNote", "IncidentCreated"],
            }}
            eventTypeOptions={EVENT_TYPE_OPTIONS}
            onEditFilters={jest.fn<() => void>()}
            onClearFilters={jest.fn<() => void>()}
          />
        </I18nextProvider>,
      );

      expect(
        screen.getByText("2 von 4 Ereignistypen werden angezeigt"),
      ).toBeVisible();
      expect(getChipTexts()).toEqual(["Öffentliche Notiz", "Vorfall erstellt"]);
      expect(
        screen.getByRole("button", { name: "Filter bearbeiten" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Filter löschen" }),
      ).toBeVisible();
    });

    test("folds the rest into the German 'and N more'", () => {
      render(
        <I18nextProvider i18n={german}>
          <FeedFilterSummary
            value={{
              sortOrder: SortOrder.Descending,
              eventTypes: MANY_EVENT_TYPE_OPTIONS.map(
                (option: FeedEventTypeOption): string => {
                  return option.value;
                },
              ),
            }}
            eventTypeOptions={MANY_EVENT_TYPE_OPTIONS}
            onEditFilters={jest.fn<() => void>()}
            onClearFilters={jest.fn<() => void>()}
          />
        </I18nextProvider>,
      );

      const chips: Array<string> = getChipTexts();

      expect(chips).toHaveLength(FEED_APPLIED_FILTERS_CHIP_LIMIT + 1);
      expect(chips[chips.length - 1]).toBe("und 4 weitere");
      // "Type A" reads "Zusatztyp A" in this test's German, so it sorts last and is folded away.
      expect(chips).not.toContain("Zusatztyp A");
      expect(chips[0]).toBe("Type B");
    });
  });
});
