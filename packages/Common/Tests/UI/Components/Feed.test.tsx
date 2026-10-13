import {
  afterEach,
  beforeEach,
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
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { Blue500, Green500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import Feed from "../../../UI/Components/Feed/Feed";
import { FeedItemProps } from "../../../UI/Components/Feed/FeedItem";
import { FeedBurstKind } from "../../../UI/Components/Feed/FeedEntryKind";

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

/*
 * An activity feed as a timeline: a heading per day with its date and zone,
 * each entry's real time (once per minute), "12 min ago" only within the
 * hour, bursts folded, and More worded for the order the reader chose. The
 * clock is fixed at 3:40 PM on Tuesday, October 13, 2026 in Singapore.
 */

const NARROW_SPACES: RegExp = /[\u202f\u00a0]/g;

const textOf: (element: HTMLElement) => string = (
  element: HTMLElement,
): string => {
  return (element.textContent || "").replace(NARROW_SPACES, " ").trim();
};

const NOW: Date = new Date("2026-10-13T07:40:00.000Z");

let nextKey: number = 0;

function makeItem(
  label: string,
  iso: string,
  extra?: Partial<FeedItemProps>,
): FeedItemProps {
  nextKey += 1;
  return {
    key: `${label}-${nextKey}`,
    textInMarkdown: label,
    itemDateTime: new Date(iso),
    icon: IconProp.Activity,
    color: Blue500,
    ...extra,
  };
}

function entryTexts(): Array<string> {
  return screen.getAllByTestId("feed-entry").map((entry: HTMLElement) => {
    return textOf(within(entry).getAllByTestId("markdown")[0]!);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  OneUptimeDate.setUserTimezone(Timezone.AsiaSingapore);
  jest.spyOn(OneUptimeDate, "getUserPrefers12HourFormat").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("Feed", () => {
  test("renders every entry in the order given, without touching the array", () => {
    const items: Array<FeedItemProps> = [
      makeItem("middle", "2026-10-13T07:00:00.000Z"),
      makeItem("oldest", "2026-10-13T06:00:00.000Z"),
      makeItem("newest", "2026-10-13T07:30:00.000Z"),
    ];
    const original: Array<FeedItemProps> = [...items];

    render(<Feed items={items} noItemsMessage="No activity" />);

    expect(entryTexts()).toEqual(["middle", "oldest", "newest"]);
    expect(items).toEqual(original);
  });

  test("one heading per day, with its full date, Today / Yesterday and the zone", () => {
    render(
      <Feed
        items={[
          makeItem("today", "2026-10-13T07:30:00.000Z"),
          makeItem("yesterday", "2026-10-12T07:30:00.000Z"),
          makeItem("last week", "2026-10-06T07:30:00.000Z"),
        ]}
        noItemsMessage="No activity"
      />,
    );

    const headings: Array<string> = screen
      .getAllByTestId("feed-day-heading")
      .map(textOf);

    expect(headings).toEqual([
      "Tuesday, October 13, 2026",
      "Monday, October 12, 2026",
      "Tuesday, October 6, 2026",
    ]);
    expect(screen.getAllByTestId("feed-day-relative").map(textOf)).toEqual([
      "Today",
      "Yesterday",
    ]);
    expect(screen.getAllByTestId("feed-day-zone").map(textOf)).toEqual([
      "GMT+08",
      "GMT+08",
      "GMT+08",
    ]);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });

  test("each day is a list of its own, labelled by its heading", () => {
    render(
      <Feed
        items={[
          makeItem("a", "2026-10-13T07:30:00.000Z"),
          makeItem("b", "2026-10-12T07:30:00.000Z"),
        ]}
        noItemsMessage="No activity"
      />,
    );

    const sections: Array<HTMLElement> = screen.getAllByTestId("feed-day");

    expect(sections).toHaveLength(2);
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(
      screen.getByRole("region", { name: "Tuesday, October 13, 2026" }),
    ).toBe(sections[0]);
  });

  test("shows each entry's real time - not 'x days ago' - once per minute", () => {
    render(
      <Feed
        items={[
          makeItem("a", "2026-10-13T07:25:30.000Z"),
          makeItem("b", "2026-10-13T07:25:05.000Z"),
          makeItem("c", "2026-10-13T07:16:00.000Z"),
          makeItem("d", "2026-10-10T02:00:00.000Z"),
        ]}
        noItemsMessage="No activity"
      />,
    );

    const times: Array<string> = screen
      .getAllByTestId("feed-entry-time")
      .map(textOf);

    expect(times[0]).toBe("3:25 PM15 min. ago");
    expect(times[1]).toBe("");
    expect(times[2]).toBe("3:16 PM24 min. ago");
    expect(times[3]).toBe("10:00 AM");
    expect(screen.queryByText(/days ago/)).not.toBeInTheDocument();
  });

  test("a time is a <time> with the exact instant", () => {
    render(
      <Feed
        items={[makeItem("a", "2026-10-13T07:25:30.000Z")]}
        noItemsMessage="No activity"
      />,
    );

    const time: HTMLElement = screen
      .getByTestId("feed-entry-time")
      .querySelector("time") as HTMLElement;

    expect(time).toHaveAttribute("dateTime", "2026-10-13T07:25:30.000Z");
  });

  test("the hint moves on with the clock, and goes once the entry is an hour old", () => {
    render(
      <Feed
        items={[makeItem("a", "2026-10-13T06:50:00.000Z")]}
        noItemsMessage="No activity"
      />,
    );

    expect(textOf(screen.getByTestId("feed-entry-relative-time"))).toBe(
      "50 min. ago",
    );

    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });

    expect(textOf(screen.getByTestId("feed-entry-relative-time"))).toBe(
      "51 min. ago",
    );

    act(() => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(
      screen.queryByTestId("feed-entry-relative-time"),
    ).not.toBeInTheDocument();
  });

  test("a feed of older entries runs no timer", () => {
    render(
      <Feed
        items={[makeItem("old", "2026-10-01T06:50:00.000Z")]}
        noItemsMessage="No activity"
      />,
    );

    expect(jest.getTimerCount()).toBe(0);
  });

  test("at midnight, Today becomes Yesterday without a reload", () => {
    jest.setSystemTime(new Date("2026-10-13T15:59:00.000Z")); // 23:59 SGT

    render(
      <Feed
        items={[makeItem("late", "2026-10-13T15:30:00.000Z")]}
        noItemsMessage="No activity"
      />,
    );

    expect(textOf(screen.getByTestId("feed-day-relative"))).toBe("Today");

    act(() => {
      jest.advanceTimersByTime(2 * 60 * 1000);
    });

    expect(textOf(screen.getByTestId("feed-day-relative"))).toBe("Yesterday");
  });

  test("the reader's own time zone decides the day and the time", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    render(
      <Feed
        items={[makeItem("a", "2026-10-13T02:00:00.000Z")]}
        noItemsMessage="No activity"
      />,
    );

    expect(textOf(screen.getByTestId("feed-day-heading"))).toBe(
      "Monday, October 12, 2026",
    );
    expect(textOf(screen.getByTestId("feed-day-zone"))).toBe("EDT");
    expect(textOf(screen.getByTestId("feed-entry-time"))).toBe("10:00 PM");
  });

  test("a 24-hour reader reads 24-hour times", () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);

    render(
      <Feed
        items={[makeItem("a", "2026-10-10T07:25:00.000Z")]}
        noItemsMessage="No activity"
      />,
    );

    expect(textOf(screen.getByTestId("feed-entry-time"))).toBe("15:25");
  });

  test("the last entry of each day draws no line on to the next", () => {
    render(
      <Feed
        items={[
          makeItem("a", "2026-10-13T07:30:00.000Z"),
          makeItem("b", "2026-10-13T06:30:00.000Z"),
          makeItem("c", "2026-10-12T07:30:00.000Z"),
        ]}
        noItemsMessage="No activity"
      />,
    );

    const entries: Array<HTMLElement> = screen.getAllByTestId("feed-entry");

    expect(within(entries[0]!).queryByTestId("feed-entry-line")).toBeTruthy();
    expect(within(entries[1]!).queryByTestId("feed-entry-line")).toBeNull();
    expect(within(entries[2]!).queryByTestId("feed-entry-line")).toBeNull();
  });

  test("an empty feed says so, with no list and no More", () => {
    render(<Feed items={[]} noItemsMessage="Nothing has happened yet." />);

    expect(screen.getByTestId("feed-empty")).toHaveTextContent(
      "Nothing has happened yet.",
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feed-more-button")).not.toBeInTheDocument();
  });

  test.each<[SortOrder | undefined, string]>([
    [SortOrder.Descending, "Show older events"],
    [SortOrder.Ascending, "Show newer events"],
    [undefined, "Show more events"],
  ])(
    "More reads for the order the reader chose: %s",
    (sortOrder: SortOrder | undefined, label: string) => {
      render(
        <Feed
          items={[makeItem("a", "2026-10-13T07:30:00.000Z")]}
          noItemsMessage="No activity"
          hasMore={true}
          onMore={() => {}}
          sortOrder={sortOrder}
        />,
      );

      expect(screen.getByRole("button", { name: label })).toBeVisible();
    },
  );

  test("More comes after the last entry and calls onMore once per click", () => {
    const onMore: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();

    render(
      <Feed
        items={[
          makeItem("a", "2026-10-13T07:30:00.000Z"),
          makeItem("b", "2026-10-12T07:30:00.000Z"),
        ]}
        noItemsMessage="No activity"
        hasMore={true}
        onMore={onMore}
        sortOrder={SortOrder.Descending}
      />,
    );

    const more: HTMLElement = screen.getByTestId("feed-more-button");
    const lastEntry: HTMLElement = screen.getAllByTestId("feed-entry")[1]!;

    expect(
      lastEntry.compareDocumentPosition(more) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.click(more);
    fireEvent.click(more);

    expect(onMore).toHaveBeenCalledTimes(2);
  });

  test("More is disabled while the next page loads, and the entries stay", () => {
    const onMore: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();

    render(
      <Feed
        items={[makeItem("a", "2026-10-13T07:30:00.000Z")]}
        noItemsMessage="No activity"
        hasMore={true}
        isLoadingMore={true}
        onMore={onMore}
      />,
    );

    const more: HTMLElement = screen.getByTestId("feed-more-button");

    expect(more).toBeDisabled();
    fireEvent.click(more);
    expect(onMore).not.toHaveBeenCalled();
    expect(entryTexts()).toEqual(["a"]);
  });

  test.each<[boolean | undefined]>([[undefined], [false]])(
    "no More when hasMore is %p",
    (hasMore: boolean | undefined) => {
      render(
        <Feed
          items={[makeItem("a", "2026-10-13T07:30:00.000Z")]}
          noItemsMessage="No activity"
          hasMore={hasMore}
        />,
      );

      expect(screen.queryByTestId("feed-more-button")).not.toBeInTheDocument();
    },
  );

  test("a burst of on-call updates folds into its first entry and unfolds on demand", () => {
    render(
      <Feed
        items={[
          makeItem("paged Nitin", "2026-10-13T07:20:00.000Z", {
            burstKind: FeedBurstKind.OnCall,
          }),
          makeItem("paged Aidil", "2026-10-13T07:20:00.000Z", {
            burstKind: FeedBurstKind.OnCall,
          }),
          makeItem("paged nobody", "2026-10-13T07:19:00.000Z", {
            burstKind: FeedBurstKind.OnCall,
          }),
          makeItem("started", "2026-10-13T07:18:00.000Z", {
            burstKind: FeedBurstKind.OnCall,
          }),
          makeItem("declared", "2026-10-13T07:10:00.000Z"),
        ]}
        noItemsMessage="No activity"
      />,
    );

    expect(entryTexts()).toEqual(["paged Nitin", "declared"]);

    const toggle: HTMLElement = screen.getByTestId("feed-burst-toggle");

    expect(toggle).toHaveTextContent("Show 3 more on-call updates");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(entryTexts()).toEqual([
      "paged Nitin",
      "paged Aidil",
      "paged nobody",
      "started",
      "declared",
    ]);
    expect(screen.getByTestId("feed-burst-toggle")).toHaveTextContent(
      "Show fewer",
    );
    expect(screen.getByTestId("feed-burst-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    fireEvent.click(screen.getByTestId("feed-burst-toggle"));

    expect(entryTexts()).toEqual(["paged Nitin", "declared"]);
  });

  test("a folded burst stays as the reader left it when the feed refreshes with the same entries", () => {
    const items: Array<FeedItemProps> = [
      makeItem("one", "2026-10-13T07:20:00.000Z", {
        burstKind: FeedBurstKind.Rule,
      }),
      makeItem("two", "2026-10-13T07:20:00.000Z", {
        burstKind: FeedBurstKind.Rule,
      }),
      makeItem("three", "2026-10-13T07:20:00.000Z", {
        burstKind: FeedBurstKind.Rule,
      }),
    ];

    const { rerender } = render(
      <Feed items={items} noItemsMessage="No activity" />,
    );

    fireEvent.click(screen.getByTestId("feed-burst-toggle"));
    expect(entryTexts()).toHaveLength(3);

    rerender(
      <Feed
        items={items.map((item: FeedItemProps) => {
          return { ...item };
        })}
        noItemsMessage="No activity"
      />,
    );

    expect(entryTexts()).toHaveLength(3);
  });

  test("each kind's colour tints its icon", () => {
    render(
      <Feed
        items={[
          makeItem("resolved", "2026-10-13T07:30:00.000Z", {
            color: Green500,
            icon: IconProp.ArrowCircleRight,
          }),
        ]}
        noItemsMessage="No activity"
      />,
    );

    expect(screen.getByTestId("feed-entry-icon")).toHaveStyle({
      backgroundColor: "#22c55e1f",
    });
  });

  test("two feeds on one page never share a heading id", () => {
    render(
      <div>
        <Feed
          items={[makeItem("a", "2026-10-13T07:30:00.000Z")]}
          noItemsMessage="No activity"
        />
        <Feed
          items={[makeItem("b", "2026-10-13T07:30:00.000Z")]}
          noItemsMessage="No activity"
        />
      </div>,
    );

    const ids: Array<string> = screen
      .getAllByTestId("feed-day-heading")
      .map((heading: HTMLElement) => {
        return heading.id;
      });

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
