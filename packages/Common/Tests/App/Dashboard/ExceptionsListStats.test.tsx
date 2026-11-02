/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The exceptions list's affected users and trend charts, on the real
 * ExceptionsViewer with TelemetryViewer captured and the data layer mocked:
 * once a page of rows is in, ONE request asks for all of their numbers over
 * the range the rows were read for, and each row is drawn with its own. A
 * page with no rows asks nothing, and a failed request leaves the rows as
 * they were.
 */

let viewerProps: any = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProps = props;
      return null;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
      updateById: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return {};
    },
  };
});

import ExceptionsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import ObjectID from "../../../Types/ObjectID";
import { emptyExceptionTrend } from "../../../Types/Telemetry/ExceptionListStats";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const NOW: Date = new Date("2026-10-30T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ME: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

const E1: string = "50000000-0000-4000-8000-000000000001";
const E2: string = "50000000-0000-4000-8000-000000000002";
const E3: string = "50000000-0000-4000-8000-000000000003";

const STATS_ROUTE: string = "/telemetry-exception/list-stats";

function exception(id: string): TelemetryException {
  const row: TelemetryException = new TelemetryException();
  row._id = id;
  row.exceptionType = "TypeError";
  row.message = `failed ${id}`;
  row.occuranceCount = 5;
  row.fingerprint = `fp-${id}`;
  return row;
}

let rows: Array<TelemetryException>;
let statsAnswer: (body: Record<string, unknown>) => Promise<unknown>;

interface PostCall {
  url: string;
  data: Record<string, unknown>;
}

function posts(): Array<PostCall> {
  return postMock.mock.calls.map((call: Array<any>): PostCall => {
    return { url: call[0].url.toString(), data: call[0].data };
  });
}

function statsPosts(): Array<PostCall> {
  return posts().filter((post: PostCall): boolean => {
    return post.url.endsWith(STATS_ROUTE);
  });
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 10; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function open(): Promise<void> {
  window.history.replaceState({}, "", "/dashboard/project/exceptions");
  await act(async () => {
    render(<ExceptionsViewer />);
  });
  await settle();
}

// The row the viewer hands TelemetryViewer for one exception, drawn on its own.
async function drawRow(row: TelemetryException): Promise<void> {
  cleanup();
  await act(async () => {
    render(viewerProps.renderRow(row));
  });
}

function trendWith(bar: number, count: number): Array<number> {
  const trend: Array<number> = emptyExceptionTrend();
  trend[bar] = count;
  return trend;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  viewerProps = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(ME);

  rows = [exception(E1), exception(E2)];
  statsAnswer = async (body: Record<string, unknown>) => {
    return {
      data: {
        stats: (body["telemetryExceptionIds"] as Array<string>).map(
          (id: string, index: number) => {
            return {
              telemetryExceptionId: id,
              affectedUsers: index === 0 ? 3 : 0,
              trend: trendWith(index, 7),
            };
          },
        ),
        bucketSizeInSeconds: 3600,
        startTime: body["startTime"],
        endTime: body["endTime"],
      },
    };
  };

  getListMock.mockReset();
  countMock.mockReset();
  postMock.mockReset();
  analyticsGetListMock.mockReset();

  getListMock.mockImplementation(async (args: any) => {
    if (args.modelType === TelemetryException) {
      return { data: rows, count: rows.length };
    }
    return { data: [], count: 0 };
  });
  countMock.mockImplementation(async () => {
    return 0;
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  postMock.mockImplementation(async (args: any) => {
    if (args.url.toString().endsWith(STATS_ROUTE)) {
      return statsAnswer(args.data);
    }
    return { data: { facets: {}, buckets: [], attributes: [] } };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("the page's numbers", () => {
  test("one request for every row on the page, over the range the rows were read for", async () => {
    await open();

    expect(statsPosts()).toHaveLength(1);
    expect(statsPosts()[0]!.data).toEqual({
      telemetryExceptionIds: [E1, E2],
      // The list's default range: the past day.
      startTime: "2026-10-29T12:00:00.000Z",
      endTime: "2026-10-30T12:00:00.000Z",
    });
  });

  test("each row is drawn with its own numbers", async () => {
    await open();

    await drawRow(rows[0]!);
    expect(screen.getByTestId("exception-row-users")).toHaveTextContent(
      "3 users",
    );
    expect(screen.getByTestId("exception-row-trend")).toHaveAttribute(
      "aria-label",
      "7 events in this time range",
    );

    // The second affected nobody it could name: no users, still its chart.
    await drawRow(rows[1]!);
    expect(screen.queryByTestId("exception-row-users")).toBeNull();
    expect(screen.getByTestId("exception-row-trend")).toBeInTheDocument();
  });

  test("an empty page asks nothing", async () => {
    rows = [];

    await open();

    expect(statsPosts()).toHaveLength(0);
  });

  test("a failed request leaves the rows as they were", async () => {
    statsAnswer = async () => {
      throw new Error("ClickHouse is down");
    };

    await open();

    expect(statsPosts()).toHaveLength(1);
    await drawRow(rows[0]!);
    expect(screen.queryByTestId("exception-row-users")).toBeNull();
    expect(screen.queryByTestId("exception-row-trend")).toBeNull();
    expect(screen.queryByTestId("exception-row-trend-loading")).toBeNull();
    // The row itself is still there.
    expect(screen.getAllByRole("button")[0]).toHaveTextContent("TypeError");
  });

  test("while the request is out, each row holds its chart's place", async () => {
    statsAnswer = () => {
      return new Promise(() => {
        // Never answers.
      });
    };

    await open();

    await drawRow(rows[0]!);
    expect(
      screen.getByTestId("exception-row-trend-loading"),
    ).toBeInTheDocument();
  });

  test("a new page of rows asks again, for its own rows only", async () => {
    await open();

    rows = [exception(E3)];
    await act(async () => {
      viewerProps.onPageChange(2);
    });
    await settle();

    expect(statsPosts()).toHaveLength(2);
    expect(statsPosts()[1]!.data["telemetryExceptionIds"]).toEqual([E3]);
  });

  test("refreshing the list asks again, once", async () => {
    await open();

    await act(async () => {
      viewerProps.onRefresh();
    });
    await settle();

    expect(statsPosts()).toHaveLength(2);
  });
});
