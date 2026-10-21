import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The insights inbox's order and time range, driven through the real page.
 *
 * A busy project's live insights all carry the same lastSeenAt — one stamp
 * per scan — so the one order the list had answered nothing about which
 * findings are new or which keep coming back (the issue's screenshot: 1,261
 * insights, every one "12 minutes ago"). What is asserted is what reaches
 * the server and the URL, since that is what decides the rows a person
 * sees and what a shared link reproduces.
 */

interface ListRequest {
  query: Record<string, unknown>;
  sort: Record<string, unknown>;
  skip: number;
  limit: number;
}

let listRequests: Array<ListRequest> = [];
let countQueries: Array<Record<string, unknown>> = [];
let rows: Array<unknown> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (request: ListRequest): Promise<unknown> => {
        listRequests.push(request);
        return {
          data: rows.slice(request.skip, request.skip + request.limit),
          count: rows.length,
          skip: request.skip,
          limit: request.limit,
        };
      },
      count: async (request: {
        query: Record<string, unknown>;
      }): Promise<number> => {
        countQueries.push(request.query);
        return rows.length;
      },
    },
  };
});

import AIInsightsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/Insights";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";

function insightRow(index: number): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(
    `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
  insight.title = `Metric drift: metric.${index} +80% week-over-week`;
  insight.insightType = AIInsightType.MetricDrift;
  insight.severity = AIInsightSeverity.Low;
  insight.status = AIInsightStatus.ActionRequired;
  insight.occurrenceCount = index;
  insight.firstSeenAt = new Date("2026-10-01T00:00:00.000Z");
  insight.lastSeenAt = new Date("2026-10-08T11:48:00.000Z");
  return insight;
}

function setUrl(search: string): void {
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/00000000-0000-4000-8000-000000000001/ai-insights${search}`,
  );
}

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <AIInsightsPage {...({} as any)} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    return expect(
      screen.getByText("Metric drift: metric.1 +80% week-over-week"),
    ).toBeInTheDocument();
  });
}

function lastListRequest(): ListRequest {
  expect(listRequests.length).toBeGreaterThan(0);
  return listRequests[listRequests.length - 1]!;
}

function sortSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", {
    name: "Sort insights",
  }) as HTMLSelectElement;
}

function seenSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", {
    name: "Filter by when last seen",
  }) as HTMLSelectElement;
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  const before: number = listRequests.length;

  await act(async () => {
    fireEvent.change(select, { target: { value: value } });
  });

  await waitFor(() => {
    return expect(listRequests.length).toBeGreaterThan(before);
  });
}

function urlParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function lastSeenFloor(query: Record<string, unknown>): number | null {
  const filter: unknown = query["lastSeenAt"];

  if (!filter) {
    return null;
  }

  expect(filter).toBeInstanceOf(GreaterThanOrEqual);

  return new Date((filter as GreaterThanOrEqual<Date>).value as Date).getTime();
}

describe("AI insights list — order and time range", () => {
  beforeEach(() => {
    listRequests = [];
    countQueries = [];
    rows = [1, 2, 3].map(insightRow);
    setUrl("");
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("opens in the order the list always had, over all time", async () => {
    await renderPage();

    expect(lastListRequest().sort).toEqual({
      lastSeenAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
    expect(lastListRequest().query["lastSeenAt"]).toBeUndefined();
    expect(sortSelect().value).toBe("lastSeen");
    expect(seenSelect().value).toBe("All");
    // The defaults keep the URL clean.
    expect(urlParam("sort")).toBeNull();
    expect(urlParam("seen")).toBeNull();
  });

  test("sorting by detections asks the server for the most-detected first", async () => {
    await renderPage();

    await choose(sortSelect(), "detections");

    expect(lastListRequest().sort).toEqual({
      occurrenceCount: SortOrder.Descending,
      lastSeenAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
    expect(lastListRequest().skip).toBe(0);
    expect(urlParam("sort")).toBe("detections");
  });

  test("first seen and oldest last seen are offered too", async () => {
    await renderPage();

    await choose(sortSelect(), "firstSeen");
    expect(lastListRequest().sort).toEqual({
      firstSeenAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });

    await choose(sortSelect(), "lastSeenOldest");
    expect(lastListRequest().sort).toEqual({
      lastSeenAt: SortOrder.Ascending,
      _id: SortOrder.Ascending,
    });
    expect(urlParam("sort")).toBe("lastSeenOldest");
  });

  test("the order is not a filter: the status counts do not refetch for it", async () => {
    await renderPage();

    await waitFor(() => {
      return expect(countQueries.length).toBeGreaterThan(0);
    });

    const countsBefore: number = countQueries.length;

    await choose(sortSelect(), "detections");

    expect(countQueries.length).toBe(countsBefore);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  test("a time range narrows the list AND the status counts to insights seen in it", async () => {
    await renderPage();

    const startedAt: number = Date.now();

    await choose(seenSelect(), "24h");

    const floor: number | null = lastSeenFloor(lastListRequest().query);

    expect(floor).not.toBeNull();
    expect(floor!).toBeGreaterThanOrEqual(startedAt - 24 * 60 * 60 * 1000);
    expect(floor!).toBeLessThanOrEqual(Date.now() - 24 * 60 * 60 * 1000);

    await waitFor(() => {
      return expect(
        countQueries.some((query: Record<string, unknown>) => {
          return lastSeenFloor(query) !== null;
        }),
      ).toBe(true);
    });

    expect(urlParam("seen")).toBe("24h");
  });

  test("Clear drops the time range but keeps the order", async () => {
    await renderPage();

    await choose(sortSelect(), "detections");
    await choose(seenSelect(), "7d");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    });

    await waitFor(() => {
      return expect(lastListRequest().query["lastSeenAt"]).toBeUndefined();
    });

    expect(lastListRequest().sort).toEqual({
      occurrenceCount: SortOrder.Descending,
      lastSeenAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
    expect(seenSelect().value).toBe("All");
    expect(sortSelect().value).toBe("detections");
    expect(urlParam("seen")).toBeNull();
    expect(urlParam("sort")).toBe("detections");
  });

  test("a shared link reopens with its order and range applied to the first request", async () => {
    setUrl("?sort=firstSeen&seen=1h");

    await renderPage();

    expect(listRequests[0]!.sort).toEqual({
      firstSeenAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
    expect(lastSeenFloor(listRequests[0]!.query)).not.toBeNull();
    expect(sortSelect().value).toBe("firstSeen");
    expect(seenSelect().value).toBe("1h");
  });

  test("values a link does not know are ignored rather than sent", async () => {
    setUrl("?sort=severity&seen=2h");

    await renderPage();

    expect(listRequests[0]!.sort).toEqual({
      lastSeenAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
    expect(listRequests[0]!.query["lastSeenAt"]).toBeUndefined();
  });

  test("Load More keeps the chosen order", async () => {
    rows = Array.from({ length: 25 }, (_value: unknown, index: number) => {
      return insightRow(index + 1);
    });

    await renderPage();
    await choose(sortSelect(), "detections");

    const before: number = listRequests.length;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load More" }));
    });

    await waitFor(() => {
      return expect(listRequests.length).toBeGreaterThan(before);
    });

    expect(lastListRequest().skip).toBe(20);
    expect(lastListRequest().sort).toEqual({
      occurrenceCount: SortOrder.Descending,
      lastSeenAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
  });

  test("the page says where to go to be alerted on an insight", async () => {
    await renderPage();

    // One paragraph with the sentence before it, so matched as a part.
    expect(
      screen.getByText(
        /To be alerted when a finding happens again, open it and choose Create Monitor\./,
      ),
    ).toBeInTheDocument();
  });
});
