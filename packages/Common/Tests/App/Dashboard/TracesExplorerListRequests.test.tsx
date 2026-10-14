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
import { act, cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4709, on the traces explorer: one read of the span list, the chart
 * and the facets per page load and per real change.
 *
 * The explorer's own state never re-read on load, but its list query and
 * its chart / facet request were keyed on the host's scope props by
 * identity - and hosts hand those over anew on every render: a service page
 * reads its id from the URL in the render (a new ObjectID each time), the
 * Host / Kubernetes / Docker pages pass `attributeFilters={{...}}` and
 * `entityScope={{...}}` inline, an incident page re-reads its stored span
 * query on every background refresh. Each such render read the list, the
 * chart and the facets again, the same scope over the same window.
 *
 * The real TracesViewer runs with TelemetryViewer captured and the data
 * layer mocked.
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
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsCountMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
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
      count: (...args: Array<any>) => {
        return analyticsCountMock(...args);
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

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return {};
    },
  };
});

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import Span from "../../../Models/AnalyticsModels/Span";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SERVICE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
  skip: number;
  limit: number;
}

function spanReads(): Array<ListArgs> {
  return analyticsGetListMock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === Span;
    });
}

function postsTo(path: string): number {
  return postMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return String((call[0] as { url: unknown }).url).endsWith(path);
  }).length;
}

function readCounts(): string {
  return JSON.stringify({
    spans: spanReads().length,
    histogram: postsTo("/telemetry/traces/histogram"),
    facets: postsTo("/telemetry/traces/facets"),
    counts: analyticsCountMock.mock.calls.length,
  });
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 8; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function mount(element: React.ReactElement): Promise<RenderResult> {
  let result: RenderResult | null = null;
  await act(async () => {
    result = render(element);
  });
  await settle();
  return result!;
}

// Renders `make()` again and again, as a page that re-renders does.
async function rerenderEqual(
  view: RenderResult,
  make: () => React.ReactElement,
): Promise<void> {
  for (let index: number = 0; index < 3; index++) {
    await act(async () => {
      view.rerender(make());
    });
    await settle();
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  viewerProps = null;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsCountMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation(async (args: unknown) => {
    const skip: number = Number((args as ListArgs).skip || 0);
    const span: Span = new Span();
    span.name = "GET /orders";
    return { data: [span], count: skip + 2, hasMore: true };
  });
  analyticsCountMock.mockImplementation(async () => {
    return 4000;
  });
  postMock.mockImplementation(async () => {
    return { data: { buckets: [], facets: {}, attributes: [] } };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("a page load reads everything once (#4709)", () => {
  test("a reload with a relative range and a page: one list read for that page, one chart, one facet read, one count", async () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard/project/traces?range=Past%201%20Day&page=2",
    );

    await mount(<TracesViewer />);

    expect(spanReads()).toHaveLength(1);
    expect(spanReads()[0]!.skip).toBe(spanReads()[0]!.limit);
    expect(postsTo("/telemetry/traces/histogram")).toBe(1);
    expect(postsTo("/telemetry/traces/facets")).toBe(1);
    expect(analyticsCountMock).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(window.location.search).get("page")).toBe("2");
  });
});

describe("an embedding page re-rendering with an equal scope reads nothing again", () => {
  test("REGRESSION: a service page's id, a new ObjectID on every render", async () => {
    const servicePage: () => React.ReactElement = (): React.ReactElement => {
      return (
        <TracesViewer
          primaryEntityId={new ObjectID(SERVICE_ID)}
          disableUrlSync={true}
        />
      );
    };

    const view: RenderResult = await mount(servicePage());
    expect(spanReads()).toHaveLength(1);
    const before: string = readCounts();

    await rerenderEqual(view, servicePage);

    expect(readCounts()).toBe(before);
  });

  test("REGRESSION: a resource page's inline attribute filters, entity keys and entity scope", async () => {
    const hostPage: () => React.ReactElement = (): React.ReactElement => {
      return (
        <TracesViewer
          attributeFilters={{ "resource.host.name": "web-01" }}
          entityKeysFilter={["host-key-1"]}
          entityScope={{
            entityKeys: ["host-key-1"],
            attributeKey: "resource.host.name",
            attributeValue: "web-01",
          }}
          disableUrlSync={true}
        />
      );
    };

    const view: RenderResult = await mount(hostPage());
    expect(spanReads()).toHaveLength(1);
    const before: string = readCounts();

    await rerenderEqual(view, hostPage);

    expect(readCounts()).toBe(before);
  });

  test("REGRESSION: an incident's stored span query, re-read on a background refresh", async () => {
    const incidentPage: () => React.ReactElement = (): React.ReactElement => {
      return (
        <TracesViewer
          spanQuery={
            {
              name: "POST /checkout",
              startTime: new InBetween<Date>(
                new Date("2026-09-20T08:00:00.000Z"),
                new Date("2026-09-20T09:30:00.000Z"),
              ),
            } as any
          }
          limit={10}
        />
      );
    };

    const view: RenderResult = await mount(incidentPage());
    expect(spanReads()).toHaveLength(1);
    const before: string = readCounts();

    await rerenderEqual(view, incidentPage);

    expect(readCounts()).toBe(before);
  });

  test("REGRESSION: an exception page's span scope", async () => {
    const exceptionPage: () => React.ReactElement = (): React.ReactElement => {
      return (
        <TracesViewer
          exceptionScope={{
            fingerprint: "fp-checkout-timeout",
            primaryEntityId: SERVICE_ID,
          }}
          disableUrlSync={true}
        />
      );
    };

    const view: RenderResult = await mount(exceptionPage());
    expect(spanReads()).toHaveLength(1);
    const before: string = readCounts();

    await rerenderEqual(view, exceptionPage);

    expect(readCounts()).toBe(before);
  });
});

describe("a real change reads once", () => {
  test("a new host scope: one list read, one chart, one facet read, for it", async () => {
    const servicePage: (id: string) => React.ReactElement = (
      id: string,
    ): React.ReactElement => {
      return (
        <TracesViewer
          primaryEntityId={new ObjectID(id)}
          disableUrlSync={true}
        />
      );
    };

    const view: RenderResult = await mount(servicePage(SERVICE_ID));

    await act(async () => {
      view.rerender(servicePage(OTHER_SERVICE_ID));
    });
    await settle();

    expect(spanReads()).toHaveLength(2);
    expect(spanReads()[1]!.query["primaryEntityId"]).toEqual(
      new ObjectID(OTHER_SERVICE_ID),
    );
    expect(postsTo("/telemetry/traces/histogram")).toBe(2);
    expect(postsTo("/telemetry/traces/facets")).toBe(2);
  });

  test("a new range: one read each", async () => {
    await mount(<TracesViewer disableUrlSync={true} />);

    await act(async () => {
      viewerProps.onTimeRangeChange({ range: TimeRange.PAST_ONE_WEEK });
    });
    await settle();

    expect(spanReads()).toHaveLength(2);
    expect(postsTo("/telemetry/traces/histogram")).toBe(2);
    expect(postsTo("/telemetry/traces/facets")).toBe(2);
  });

  test("paging: one list read, and the chart and facets stay", async () => {
    await mount(<TracesViewer disableUrlSync={true} />);

    await act(async () => {
      viewerProps.onPageChange(2);
    });
    await settle();

    expect(spanReads()).toHaveLength(2);
    expect(postsTo("/telemetry/traces/histogram")).toBe(1);
    expect(postsTo("/telemetry/traces/facets")).toBe(1);
  });
});
