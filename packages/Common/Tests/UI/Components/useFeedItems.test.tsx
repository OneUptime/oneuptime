import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";

/*
 * Start next to the API ceiling so this regression reaches the boundary in a
 * single click instead of issuing a thousand requests. The production values
 * remain 10 and 10,000; only this test module's default page size is enlarged.
 */
jest.mock("../../../Types/Database/LimitMax", () => {
  return {
    __esModule: true,
    default: 10000,
    DEFAULT_LIMIT: 9995,
    LIMIT_INFINITY: 999999999,
    LIMIT_PER_PROJECT: 10000,
  };
});

import { Blue500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import useFeedItems, {
  FeedPage,
} from "../../../UI/Components/Feed/useFeedItems";
import { FeedItemProps } from "../../../UI/Components/Feed/FeedItem";

interface TestFeedModel {
  id: string;
}

interface HarnessProps {
  getItems: (limit: number) => Promise<FeedPage<TestFeedModel>>;
}

const Harness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const { feedItems, hasMore, isLoadingMore, loadMore } =
    useFeedItems<TestFeedModel>({
      resourceKey: "resource",
      getItems: props.getItems,
      mapItems: (items: Array<TestFeedModel>): Array<FeedItemProps> => {
        return items.map((item: TestFeedModel): FeedItemProps => {
          return {
            key: item.id,
            textInMarkdown: item.id,
            itemDateTime: new Date("2026-09-11T12:00:00.000Z"),
            icon: IconProp.Activity,
            color: Blue500,
          };
        });
      },
    });

  return (
    <div>
      {feedItems.map((item: FeedItemProps): React.ReactElement => {
        return <span key={item.key}>{item.textInMarkdown}</span>;
      })}
      {hasMore && (
        <button disabled={isLoadingMore} onClick={loadMore}>
          More
        </button>
      )}
    </div>
  );
};

afterEach(() => {
  cleanup();
});

describe("useFeedItems request limit", () => {
  test("stops at the API's 10,000-row ceiling", async () => {
    const requestedLimits: Array<number> = [];
    const getItems: HarnessProps["getItems"] = async (
      limit: number,
    ): Promise<FeedPage<TestFeedModel>> => {
      requestedLimits.push(limit);
      return {
        data: [{ id: `limit-${limit}` }],
        count: 10001,
      };
    };

    render(<Harness getItems={getItems} />);

    const moreButton: HTMLElement = await screen.findByRole("button", {
      name: "More",
    });
    expect(requestedLimits).toEqual([9995]);
    fireEvent.click(moreButton);

    await waitFor(() => {
      expect(requestedLimits).toEqual([9995, 10000]);
      expect(screen.getByText("limit-10000")).toBeVisible();
      expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    });
  });
});
