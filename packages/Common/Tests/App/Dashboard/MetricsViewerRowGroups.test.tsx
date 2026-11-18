import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

/*
 * The metric list in sections (MetricsViewer getRowGroup): a cloud
 * resource's key metrics read under Traffic, Errors, Latency and the rest,
 * most telling first, and its other metrics after them under "Other".
 *
 * An App Service sends the five metrics the issue named (#9505), and its
 * apps fifty more, all of whose names sort before "azure_". Read in name
 * order, the first page was fifty of the apps' metrics and the resource's
 * own landed on page 2. A list scoped to a resource pages through its names
 * in section order instead, so page 1 starts with what matters; a list
 * with no sections reads exactly as before.
 */

const mockListProps: Array<Record<string, unknown>> = [];
let mockMetricNames: Array<string> = [];
// The names each read of the metric list asked for, and its page.
const mockListRequests: Array<{
  names: Array<string> | null;
  limit: number;
  skip: number;
}> = [];

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (
      props: Record<string, unknown> & {
        items: Array<{ name: string }>;
        renderRow: (
          metric: { name: string },
          index: number,
        ) => React.ReactElement;
        renderGroupHeading?: (
          metric: { name: string },
          index: number,
        ) => React.ReactElement | null;
      },
    ) => {
      mockListProps.push(props);
      return (
        <ol data-testid="metric-list">
          {props.items.map((item: { name: string }, index: number) => {
            const heading: React.ReactElement | null = props.renderGroupHeading
              ? props.renderGroupHeading(item, index)
              : null;
            return (
              <React.Fragment key={item.name}>
                {heading ? <li data-testid="list-heading">{heading}</li> : null}
                {props.renderRow(item, index)}
              </React.Fragment>
            );
          })}
        </ol>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>) => {
        return (
          <li data-testid="metric-row">
            {(props["metric"] as { name: string }).name}
          </li>
        );
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      // As the API does: the names asked, by name, one page of them.
      getList: (request: {
        modelType: { name: string };
        query: Record<string, unknown>;
        limit: number;
        skip: number;
      }) => {
        if (request.modelType.name !== "MetricType") {
          return Promise.resolve({ data: [], count: 0 });
        }
        const nameQuery: { values?: Array<unknown> } | undefined = request
          .query["name"] as { values?: Array<unknown> } | undefined;
        const asked: Array<string> | null =
          nameQuery && Array.isArray(nameQuery.values)
            ? nameQuery.values.map((value: unknown) => {
                return String(value);
              })
            : null;
        mockListRequests.push({
          names: asked,
          limit: request.limit,
          skip: request.skip,
        });
        const matching: Array<string> = mockMetricNames
          .filter((name: string) => {
            return asked === null || asked.includes(name);
          })
          .sort();
        return Promise.resolve({
          data: matching
            .slice(request.skip, request.skip + request.limit)
            .map((name: string) => {
              return { name: name };
            }),
          count: matching.length,
        });
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
      // The names the resource's attributes match.
      getList: () => {
        return Promise.resolve({
          data: mockMetricNames.map((name: string) => {
            return { name: name };
          }),
        });
      },
      aggregate: () => {
        return Promise.resolve({ data: [] });
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: () => {
        return Promise.resolve({ data: { attributes: [], facets: {} } });
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

import MetricsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer";
import { GetMetricRowGroup } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricRowScope";
import { getCloudMonitoredResourceRowGroup } from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudMonitoredResourceScope";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "21075038-d9f1-4d3a-b878-f64ae861f7be",
);
const SCOPE: Record<string, string> = {
  "azuremonitor.resource_id":
    "/subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.Web/sites/shop",
};

// An App Service's sections, as its Overview and Metrics tab build them.
const APP_SERVICE: GetMetricRowGroup = getCloudMonitoredResourceRowGroup({
  cloudProvider: CloudProvider.Azure,
  cloudResourceType: "Microsoft.Web/sites",
})!;

// The five metrics the issue named, as Azure's are stored.
const KEY_METRICS: Array<string> = [
  "azure_cputime_total",
  "azure_http4xx_total",
  "azure_http5xx_total",
  "azure_memoryworkingset_average",
  "azure_requests_total",
];

// Fifty of the apps' own, each before "azure_" by name.
const APP_METRICS: Array<string> = Array.from(
  { length: 50 },
  (_value: unknown, index: number): string => {
    return `app.metric.${String(index).padStart(2, "0")}`;
  },
);

type ViewerProps = React.ComponentProps<typeof MetricsViewer>;

async function renderViewer(
  props: ViewerProps,
  names: Array<string>,
): Promise<void> {
  mockMetricNames = names;
  await act(async () => {
    render(<MetricsViewer {...props} disableUrlSync={true} />);
  });
  await waitFor(() => {
    expect(screen.getAllByTestId("metric-row").length).toBeGreaterThan(0);
  });
}

// The list top down: a heading as "# Traffic", a row as its metric's name.
function listed(): Array<string> {
  return Array.from(screen.getByTestId("metric-list").children).map(
    (child: Element): string => {
      return child.getAttribute("data-testid") === "list-heading"
        ? `# ${child.textContent}`
        : child.textContent || "";
    },
  );
}

function lastListProps(): Record<string, unknown> {
  expect(mockListProps.length).toBeGreaterThan(0);
  return mockListProps[mockListProps.length - 1]!;
}

beforeEach(() => {
  mockListProps.length = 0;
  mockListRequests.length = 0;
  mockMetricNames = [];
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a resource's list in sections", () => {
  test("page 1 starts with the resource's key metrics, each section under its heading, then its other metrics under Other", async () => {
    await renderViewer({ attributeFilters: SCOPE, getRowGroup: APP_SERVICE }, [
      ...APP_METRICS,
      ...KEY_METRICS,
    ]);

    expect(listed()).toEqual([
      "# Traffic",
      "azure_requests_total",
      "# Errors",
      "azure_http5xx_total",
      "azure_http4xx_total",
      "# Compute",
      "azure_cputime_total",
      "# Memory",
      "azure_memoryworkingset_average",
      "# Other",
      ...APP_METRICS.slice(0, 45),
    ]);

    // One read of the page's own fifty names, the most telling first.
    expect(mockListRequests[mockListRequests.length - 1]).toEqual({
      names: [
        "azure_requests_total",
        "azure_http5xx_total",
        "azure_http4xx_total",
        "azure_cputime_total",
        "azure_memoryworkingset_average",
        ...APP_METRICS.slice(0, 45),
      ],
      limit: 50,
      skip: 0,
    });
    expect(lastListProps()["totalCount"]).toBe(55);
  });

  test("page 2 carries on where page 1 stopped, a plain list when none of its metrics is in a section", async () => {
    await renderViewer({ attributeFilters: SCOPE, getRowGroup: APP_SERVICE }, [
      ...APP_METRICS,
      ...KEY_METRICS,
    ]);

    await act(async () => {
      (lastListProps()["onPageChange"] as (page: number) => void)(2);
    });

    await waitFor(() => {
      expect(listed()).toEqual(APP_METRICS.slice(45));
    });
    expect(mockListRequests[mockListRequests.length - 1]).toEqual({
      names: APP_METRICS.slice(45),
      limit: 5,
      skip: 0,
    });
    expect(lastListProps()["totalCount"]).toBe(55);
  });

  test("a list not scoped to a resource's names orders each page by section", async () => {
    await renderViewer({ getRowGroup: APP_SERVICE }, [
      "azure_requests_total",
      "app.metric.00",
      "azure_http5xx_total",
      "azure_httpresponsetime_average",
    ]);

    expect(listed()).toEqual([
      "# Traffic",
      "azure_requests_total",
      "# Errors",
      "azure_http5xx_total",
      "# Latency",
      "azure_httpresponsetime_average",
      "# Other",
      "app.metric.00",
    ]);
    // Read by name, a page at a time, as before.
    expect(mockListRequests[mockListRequests.length - 1]).toEqual({
      names: null,
      limit: 50,
      skip: 0,
    });
  });
});

describe("a list with no sections", () => {
  test("reads a page by name, with no headings, as it always did", async () => {
    await renderViewer({ attributeFilters: SCOPE }, [
      ...APP_METRICS,
      ...KEY_METRICS,
    ]);

    expect(listed()).toEqual(APP_METRICS);
    expect(screen.queryAllByTestId("list-heading")).toHaveLength(0);
    expect(lastListProps()["renderGroupHeading"]).toBeUndefined();

    const request: {
      names: Array<string> | null;
      limit: number;
      skip: number;
    } = mockListRequests[mockListRequests.length - 1]!;
    expect([...(request.names || [])].sort()).toEqual(
      [...APP_METRICS, ...KEY_METRICS].sort(),
    );
    expect(request.limit).toBe(50);
    expect(request.skip).toBe(0);
    expect(lastListProps()["totalCount"]).toBe(55);
  });

  test("a resource of a provider with no key metrics reads as a plain list", async () => {
    await renderViewer(
      {
        attributeFilters: SCOPE,
        getRowGroup: getCloudMonitoredResourceRowGroup({
          cloudProvider: "oracle",
          cloudResourceType: "oci_compute_instance",
        }),
      },
      ["b.metric", "a.metric"],
    );

    expect(listed()).toEqual(["a.metric", "b.metric"]);
    expect(screen.queryAllByTestId("list-heading")).toHaveLength(0);
  });
});
