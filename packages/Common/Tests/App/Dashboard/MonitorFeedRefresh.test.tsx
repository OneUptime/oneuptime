import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The monitor feed as the overview uses it ("Recent activity"). The page
 * bumps refreshToken when it knows the feed changed (a status change, a
 * saved edit, a manual refresh), and the feed must re-read without blanking:
 * the old items stay on screen until the new page arrives. A different
 * monitor, on the other hand, must never show the previous monitor's items.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

// Keep the test about feed state, not markdown rendering.
jest.mock("../../../UI/Components/Feed/Feed", () => {
  return {
    __esModule: true,
    default: (props: {
      items: Array<{ key: string; textInMarkdown: string }>;
    }): ReactElement => {
      const ReactModule: typeof React = jest.requireActual(
        "react",
      ) as typeof React;

      return ReactModule.createElement(
        "div",
        { "data-testid": "rendered-feed" },
        props.items.map(
          (item: { key: string; textInMarkdown: string }): ReactElement => {
            return ReactModule.createElement(
              "div",
              { key: item.key },
              item.textInMarkdown,
            );
          },
        ),
      );
    },
  };
});

import MonitorFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorFeed";
import MonitorFeed from "../../../Models/DatabaseModels/MonitorFeed";
import { DEFAULT_LIMIT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";

const MONITOR_A: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_B: string = "22222222-2222-4222-8222-222222222222";
const POSTED_AT: Date = new Date("2026-09-21T11:00:00.000Z");

interface ListResult<T> {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>((done: (value: T) => void) => {
    resolve = done;
  });

  return { promise: promise, resolve: resolve };
}

function feedItem(text: string): MonitorFeed {
  const item: MonitorFeed = new MonitorFeed();
  item.id = ObjectID.generate();
  item.feedInfoInMarkdown = text;
  item.postedAt = POSTED_AT;
  item.createdAt = POSTED_AT;
  return item;
}

function listResult(texts: Array<string>): ListResult<MonitorFeed> {
  return {
    data: texts.map(feedItem),
    count: texts.length,
    skip: 0,
    limit: DEFAULT_LIMIT,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function feedElement(data: {
  monitorId: string;
  refreshToken?: number | undefined;
  title?: string | undefined;
  description?: string | undefined;
}): ReactElement {
  return (
    <MonitorFeedElement
      monitorId={new ObjectID(data.monitorId)}
      refreshToken={data.refreshToken}
      title={data.title}
      description={data.description}
    />
  );
}

afterEach(() => {
  cleanup();
  getListMock.mockReset();
});

describe("MonitorFeedElement refresh", () => {
  test("a refreshToken bump refetches without replacing the items with a loader", async () => {
    const refetch: Deferred<ListResult<MonitorFeed>> =
      deferred<ListResult<MonitorFeed>>();

    getListMock
      .mockResolvedValueOnce(listResult(["Monitor created"]) as never)
      .mockReturnValueOnce(refetch.promise as never);

    const view: RenderResult = render(
      feedElement({ monitorId: MONITOR_A, refreshToken: 0 }),
    );

    // The first load has nothing to show yet, so it shows the loader.
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    await flush();

    expect(screen.getByText("Monitor created")).toBeInTheDocument();
    expect(screen.queryByTestId("component-loader")).toBeNull();

    view.rerender(feedElement({ monitorId: MONITOR_A, refreshToken: 1 }));
    await flush();

    // The re-read is in flight: the old items stay, with no loader over them.
    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Monitor created")).toBeInTheDocument();
    expect(screen.queryByTestId("component-loader")).toBeNull();

    await act(async () => {
      refetch.resolve(
        listResult(["Status changed to Offline", "Monitor created"]),
      );
      await refetch.promise;
    });
    await flush();

    expect(screen.getByText("Status changed to Offline")).toBeInTheDocument();
    expect(screen.queryByTestId("component-loader")).toBeNull();
  });

  test("the same token does not refetch", async () => {
    getListMock.mockResolvedValue(listResult(["Monitor created"]) as never);

    const view: RenderResult = render(
      feedElement({ monitorId: MONITOR_A, refreshToken: 4 }),
    );
    await flush();

    view.rerender(feedElement({ monitorId: MONITOR_A, refreshToken: 4 }));
    await flush();

    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("another monitor shows the loader, never the previous monitor's items", async () => {
    const monitorB: Deferred<ListResult<MonitorFeed>> =
      deferred<ListResult<MonitorFeed>>();

    getListMock
      .mockResolvedValueOnce(listResult(["A happened"]) as never)
      .mockReturnValueOnce(monitorB.promise as never);

    const view: RenderResult = render(feedElement({ monitorId: MONITOR_A }));
    await flush();
    expect(screen.getByText("A happened")).toBeInTheDocument();

    view.rerender(feedElement({ monitorId: MONITOR_B }));
    await flush();

    expect(screen.queryByText("A happened")).toBeNull();
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();

    await act(async () => {
      monitorB.resolve(listResult(["B happened"]));
      await monitorB.promise;
    });
    await flush();

    expect(screen.getByText("B happened")).toBeInTheDocument();
  });

  test("the title and description can be overridden", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    render(
      feedElement({
        monitorId: MONITOR_A,
        title: "Recent activity",
        description:
          "Everything that has happened to this monitor, newest first.",
      }),
    );
    await flush();

    expect(
      screen.getByRole("heading", { name: "Recent activity" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Everything that has happened to this monitor, newest first.",
    );
    expect(screen.queryByText("Monitor Feed")).toBeNull();
  });

  test("without overrides it keeps its own title and description", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    render(feedElement({ monitorId: MONITOR_A }));
    await flush();

    expect(
      screen.getByRole("heading", { name: "Monitor Feed" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "This is the timeline and feed for this monitor.",
    );
  });

  test("still reads the newest activity first for this monitor", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    render(feedElement({ monitorId: MONITOR_A }));
    await flush();

    const request: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      skip: number;
      limit: number;
    } = getListMock.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      skip: number;
      limit: number;
    };

    expect(String(request.query["monitorId"])).toBe(MONITOR_A);
    expect(request.sort).toEqual({ postedAt: "DESC" });
    expect(request.skip).toBe(0);
    expect(request.limit).toBe(DEFAULT_LIMIT);
  });
});
