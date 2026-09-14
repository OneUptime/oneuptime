import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { Blue500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import Feed from "../../../UI/Components/Feed/Feed";
import { FeedItemProps } from "../../../UI/Components/Feed/FeedItem";

interface MockFeedItemProps {
  textInMarkdown: string;
  isLastItem: boolean;
}

jest.mock("../../../UI/Components/Feed/FeedItem", () => {
  return {
    __esModule: true,
    default: (props: MockFeedItemProps): React.ReactElement => {
      return React.createElement(
        "li",
        {
          "data-testid": "feed-item",
          "data-is-last-item": props.isLastItem.toString(),
        },
        props.textInMarkdown,
      );
    },
  };
});

afterEach(() => {
  cleanup();
});

function makeItem(label: string, itemDateTime: Date): FeedItemProps {
  return {
    key: label,
    textInMarkdown: label,
    itemDateTime,
    icon: IconProp.Activity,
    color: Blue500,
  };
}

function getRenderedLabels(): Array<string> {
  return screen.getAllByTestId("feed-item").map((item: HTMLElement) => {
    return item.textContent || "";
  });
}

describe("Feed", () => {
  test("renders every supplied item in the supplied order without mutating the array", () => {
    const items: Array<FeedItemProps> = [
      makeItem("middle", new Date("2026-09-10T12:00:00.000Z")),
      makeItem("oldest", new Date("2026-09-09T12:00:00.000Z")),
      makeItem("newest", new Date("2026-09-11T12:00:00.000Z")),
    ];
    const originalItems: Array<FeedItemProps> = [...items];

    render(<Feed items={items} noItemsMessage="No activity" />);

    expect(getRenderedLabels()).toEqual(["middle", "oldest", "newest"]);
    expect(items).toEqual(originalItems);
    expect(items[0]).toBe(originalItems[0]);
    expect(items[1]).toBe(originalItems[1]);
    expect(items[2]).toBe(originalItems[2]);
  });

  test.each<[string, boolean | undefined]>([
    ["omitted", undefined],
    ["false", false],
  ])(
    "does not render More when hasMore is %s",
    (_label: string, hasMore: boolean | undefined) => {
      render(
        <Feed
          items={[makeItem("activity", new Date("2026-09-11T12:00:00.000Z"))]}
          noItemsMessage="No activity"
          hasMore={hasMore}
        />,
      );

      expect(
        screen.queryByRole("button", { name: "More" }),
      ).not.toBeInTheDocument();
    },
  );

  test("renders an exact More button after the final feed item", () => {
    render(
      <Feed
        items={[
          makeItem("first", new Date("2026-09-11T12:00:00.000Z")),
          makeItem("second", new Date("2026-09-10T12:00:00.000Z")),
        ]}
        noItemsMessage="No activity"
        hasMore={true}
        onMore={() => {}}
      />,
    );

    const list: HTMLElement = screen.getByRole("list");
    const button: HTMLElement = screen.getByRole("button", { name: "More" });
    const finalItem: HTMLElement = screen.getAllByTestId("feed-item")[1]!;

    expect(button).toHaveTextContent(/^More$/);
    expect(
      list.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      finalItem.compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  test("calls onMore once for each click", () => {
    const onMore: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();

    render(
      <Feed
        items={[makeItem("activity", new Date("2026-09-11T12:00:00.000Z"))]}
        noItemsMessage="No activity"
        hasMore={true}
        onMore={onMore}
      />,
    );

    const moreButton: HTMLElement = screen.getByRole("button", {
      name: "More",
    });
    fireEvent.click(moreButton);
    fireEvent.click(moreButton);

    expect(onMore).toHaveBeenCalledTimes(2);
  });

  test("disables More while loading and keeps every existing item visible", () => {
    const onMore: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();
    const items: Array<FeedItemProps> = [
      makeItem("first", new Date("2026-09-11T12:00:00.000Z")),
      makeItem("second", new Date("2026-09-10T12:00:00.000Z")),
    ];

    render(
      <Feed
        items={items}
        noItemsMessage="No activity"
        hasMore={true}
        onMore={onMore}
        isLoadingMore={true}
      />,
    );

    const moreButton: HTMLElement = screen.getByRole("button", {
      name: "More",
    });
    expect(moreButton).toBeDisabled();
    expect(moreButton).toHaveAttribute("aria-disabled", "true");
    expect(getRenderedLabels()).toEqual(["first", "second"]);

    fireEvent.click(moreButton);

    expect(onMore).not.toHaveBeenCalled();
    expect(getRenderedLabels()).toEqual(["first", "second"]);
  });

  test("removes More when a rerender reports that no further items remain", () => {
    const items: Array<FeedItemProps> = [
      makeItem("first", new Date("2026-09-11T12:00:00.000Z")),
      makeItem("second", new Date("2026-09-10T12:00:00.000Z")),
    ];
    const { rerender } = render(
      <Feed
        items={items}
        noItemsMessage="No activity"
        hasMore={true}
        onMore={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "More" })).toBeVisible();

    rerender(
      <Feed
        items={items}
        noItemsMessage="No activity"
        hasMore={false}
        onMore={() => {}}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "More" }),
    ).not.toBeInTheDocument();
    expect(getRenderedLabels()).toEqual(["first", "second"]);
  });

  test("retains the empty state when there are no items", () => {
    render(<Feed items={[]} noItemsMessage="Nothing has happened yet" />);

    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("Nothing has happened yet")).toBeVisible();
    expect(screen.queryAllByTestId("feed-item")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "More" }),
    ).not.toBeInTheDocument();
  });

  test("marks only the final rendered item as the last connector item", () => {
    const first: FeedItemProps = makeItem(
      "first",
      new Date("2026-09-11T12:00:00.000Z"),
    );
    const second: FeedItemProps = makeItem(
      "second",
      new Date("2026-09-10T12:00:00.000Z"),
    );
    const third: FeedItemProps = makeItem(
      "third",
      new Date("2026-09-09T12:00:00.000Z"),
    );
    const { rerender } = render(
      <Feed items={[first, second]} noItemsMessage="No activity" />,
    );

    let renderedItems: Array<HTMLElement> = screen.getAllByTestId("feed-item");
    expect(renderedItems[0]).toHaveAttribute("data-is-last-item", "false");
    expect(renderedItems[1]).toHaveAttribute("data-is-last-item", "true");

    rerender(
      <Feed items={[first, second, third]} noItemsMessage="No activity" />,
    );

    renderedItems = screen.getAllByTestId("feed-item");
    expect(renderedItems[0]).toHaveAttribute("data-is-last-item", "false");
    expect(renderedItems[1]).toHaveAttribute("data-is-last-item", "false");
    expect(renderedItems[2]).toHaveAttribute("data-is-last-item", "true");
  });
});
