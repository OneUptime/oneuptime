import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

import FeedContent, {
  FeedSkeleton,
} from "../../../UI/Components/Feed/FeedContent";
import { UseFeedItemsResult } from "../../../UI/Components/Feed/useFeedItems";
import {
  FEED_ENTRY_GRID_CLASS_NAME,
  FeedItemProps,
} from "../../../UI/Components/Feed/FeedItem";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import { Blue500 } from "../../../Types/BrandColors";

/*
 * What every feed card shows under its header: the skeleton until the feed
 * of the resource on screen has loaded, an error with a way to try again,
 * the timeline - kept on screen while it refreshes - and More's own error.
 */

type RefreshMock = ReturnType<typeof jest.fn<() => Promise<void>>>;

const ITEM: FeedItemProps = {
  key: "one",
  textInMarkdown: "Owners were notified.",
  itemDateTime: new Date("2026-10-13T07:25:00.000Z"),
  icon: IconProp.Bell,
  color: Blue500,
};

const feed: (overrides?: Partial<UseFeedItemsResult>) => UseFeedItemsResult = (
  overrides?: Partial<UseFeedItemsResult>,
): UseFeedItemsResult => {
  return {
    feedItems: [ITEM],
    isLoading: false,
    isLoadingMore: false,
    error: undefined,
    loadMoreError: undefined,
    hasMore: false,
    isCurrentFeedLoaded: true,
    setError: jest.fn(),
    refresh: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    loadMore: jest.fn(),
    ...overrides,
  } as UseFeedItemsResult;
};

afterEach(() => {
  cleanup();
});

describe("FeedContent", () => {
  test("shows the skeleton until the feed on screen has loaded", () => {
    render(
      <FeedContent
        feed={feed({ isCurrentFeedLoaded: false, feedItems: [] })}
        noItemsMessage="Nothing yet."
      />,
    );

    const skeleton: HTMLElement = screen.getByTestId("feed-skeleton");

    expect(skeleton).toHaveAttribute("role", "status");
    expect(skeleton).toHaveTextContent("Loading the feed");
    expect(screen.queryByTestId("feed-entry")).not.toBeInTheDocument();
  });

  test("keeps the entries on screen while the feed refreshes", () => {
    render(
      <FeedContent
        feed={feed({ isLoading: true })}
        noItemsMessage="Nothing yet."
      />,
    );

    expect(screen.queryByTestId("feed-skeleton")).not.toBeInTheDocument();
    expect(screen.getByTestId("feed-entry")).toHaveTextContent(
      "Owners were notified.",
    );
  });

  test("an error says what went wrong and offers to read the feed again", () => {
    const refresh: RefreshMock = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);

    render(
      <FeedContent
        feed={feed({ error: "The server could not be reached.", refresh })}
        noItemsMessage="Nothing yet."
      />,
    );

    expect(
      screen.getByText("The server could not be reached."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("feed-entry")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("a refresh that fails again is not an unhandled rejection", async () => {
    const refresh: RefreshMock = jest
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("still down"));

    render(
      <FeedContent
        feed={feed({ error: "Down.", refresh })}
        noItemsMessage="Nothing yet."
      />,
    );

    fireEvent.click(screen.getByTestId("refresh-button"));
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("an empty feed shows its message", () => {
    render(
      <FeedContent
        feed={feed({ feedItems: [] })}
        noItemsMessage="Nothing has happened to this incident yet."
      />,
    );

    expect(screen.getByTestId("feed-empty")).toHaveTextContent(
      "Nothing has happened to this incident yet.",
    );
  });

  test("More is worded for the reader's order and loads the next page", () => {
    const loadMore: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();

    render(
      <FeedContent
        feed={feed({ hasMore: true, loadMore })}
        noItemsMessage="Nothing yet."
        sortOrder={SortOrder.Ascending}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show newer events" }));

    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  test("More's own error shows under the entries, which stay", () => {
    render(
      <FeedContent
        feed={feed({ loadMoreError: "Could not load more." })}
        noItemsMessage="Nothing yet."
      />,
    );

    expect(screen.getByText("Could not load more.")).toBeInTheDocument();
    expect(screen.getByTestId("feed-entry")).toBeInTheDocument();
  });

  test("the skeleton has the timeline's shape: rows of time, icon and text", () => {
    render(<FeedSkeleton />);

    const skeleton: HTMLElement = screen.getByTestId("feed-skeleton");

    expect(skeleton.querySelectorAll(".rounded-full").length).toBe(3);
  });

  test("the skeleton's rows have the entries' own columns, so the feed does not shift when it lands", () => {
    const { container } = render(<FeedSkeleton />);
    const rowClasses: Array<string> = Array.from(
      container.querySelectorAll('[aria-hidden="true"] > .grid'),
    ).map((row: Element) => {
      return row.className;
    });

    expect(rowClasses).toHaveLength(3);
    for (const className of rowClasses) {
      for (const columnClass of FEED_ENTRY_GRID_CLASS_NAME.split(" ")) {
        expect(className.split(" ")).toContain(columnClass);
      }
    }
  });

  test("the time column is wide enough for the longest 'N min. ago' a Dashboard language writes", () => {
    /*
     * "for 24 min siden" (Norwegian) and "24 min. geleden" (Dutch) are 95px
     * in the Dashboard's Inter at 12px; at 5.5rem (88px) they ran into the
     * rail.
     */
    expect(FEED_ENTRY_GRID_CLASS_NAME).toContain(
      "sm:grid-cols-[6.25rem_1.75rem_minmax(0,1fr)]",
    );
  });
});
