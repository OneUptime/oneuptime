import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";

/*
 * A cloud resource's sections say which of its key metrics it did not
 * report in the list's range (#9569): each section's heading counts them,
 * folded away, and opens to what the page draws of them; a section none of
 * whose key metrics reported is its heading alone, where it falls; nothing
 * of it is a row, counted or paged. A search or filter that narrows the
 * list says nothing of gaps, as every other metric would read as missing.
 */

const mockListProps: Array<Record<string, unknown>> = [];
let mockMetricNames: Array<string> = [];

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (
      props: Record<string, unknown> & {
        items: Array<{ name: string }>;
        renderRow: (
          metric: { name: string },
          index: number,
        ) => React.ReactElement | null;
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
            const row: React.ReactElement | null = props.renderRow(item, index);
            return (
              <React.Fragment key={item.name}>
                {heading ? <li data-testid="list-heading">{heading}</li> : null}
                {row}
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
import {
  METRIC_ROW_GROUP_GAP_CONTENT_TEST_ID,
  METRIC_ROW_GROUP_GAP_TOGGLE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRowGroupHeading";
import {
  GetMetricRowGroup,
  GetMetricRowGroupGaps,
  MetricRowGroupGap,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricRowScope";
import {
  getCloudMonitoredResourceRowGroup,
  getCloudMonitoredResourceRowGroupGaps,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudMonitoredResourceScope";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudResourceKeyMetric,
  getCloudKeyMetricsOfResource,
} from "../../../Types/Cloud/CloudUnreportedKeyMetrics";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "21075038-d9f1-4d3a-b878-f64ae861f7be",
);
const SCOPE: Record<string, string> = {
  "azuremonitor.resource_id":
    "/subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.Web/sites/shop",
};
const SOURCE: { cloudProvider: string; cloudResourceType: string } = {
  cloudProvider: CloudProvider.Azure,
  cloudResourceType: "Microsoft.Web/sites",
};
const APP_SERVICE: GetMetricRowGroup =
  getCloudMonitoredResourceRowGroup(SOURCE)!;
const APP_SERVICE_GAPS: GetMetricRowGroupGaps =
  getCloudMonitoredResourceRowGroupGaps(SOURCE)!;

// What an App Service reported: requests, its 5xx, CPU time and memory.
const REPORTED: Array<string> = [
  "azure_requests_total",
  "azure_http5xx_total",
  "azure_cputime_total",
  "azure_memoryworkingset_average",
  "app.metric.00",
];

// The App Service's key metrics of a section, by key, in order.
function keysOf(groupKey: string): Array<string> {
  return getCloudKeyMetricsOfResource({
    provider: CloudProvider.Azure,
    type: "Microsoft.Web/sites",
  })
    .filter((metric: CloudResourceKeyMetric): boolean => {
      return metric.group === groupKey;
    })
    .map((metric: CloudResourceKeyMetric): string => {
      return metric.key;
    });
}

function renderGap(gap: MetricRowGroupGap): React.ReactElement {
  return <p data-testid="gap-keys">{gap.keys.join(", ")}</p>;
}

type ViewerProps = React.ComponentProps<typeof MetricsViewer>;

async function renderViewer(props: Partial<ViewerProps> = {}): Promise<void> {
  mockMetricNames = REPORTED;
  await act(async () => {
    render(
      <MetricsViewer
        attributeFilters={SCOPE}
        getRowGroup={APP_SERVICE}
        getRowGroupGaps={APP_SERVICE_GAPS}
        renderRowGroupGap={renderGap}
        disableUrlSync={true}
        {...props}
      />,
    );
  });
  await waitFor(() => {
    expect(screen.getAllByTestId("metric-row").length).toBeGreaterThan(0);
  });
}

// The list top down: a heading as "# Traffic (3)", a row as its metric's name.
function listed(): Array<string> {
  return Array.from(screen.getByTestId("metric-list").children).map(
    (child: Element): string => {
      if (child.getAttribute("data-testid") !== "list-heading") {
        return child.textContent || "";
      }

      const title: string =
        child.querySelector("h3")?.textContent || child.textContent || "";
      const toggle: Element | null = child.querySelector(
        `[data-testid="${METRIC_ROW_GROUP_GAP_TOGGLE_TEST_ID}"]`,
      );

      return toggle ? `# ${title} (${toggle.textContent})` : `# ${title}`;
    },
  );
}

function lastListProps(): Record<string, unknown> {
  expect(mockListProps.length).toBeGreaterThan(0);
  return mockListProps[mockListProps.length - 1]!;
}

beforeEach(() => {
  mockListProps.length = 0;
  mockMetricNames = [];
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a section's key metrics not reported", () => {
  test("each section's heading counts them; a section none of whose reported is its heading alone, where it falls", async () => {
    await renderViewer();

    const count: (groupKey: string, reported: number) => string = (
      groupKey: string,
      reported: number,
    ): string => {
      return `${keysOf(groupKey).length - reported} not reported`;
    };

    expect(listed()).toEqual([
      /*
       * No Availability and no Storage: its health check comes every five
       * minutes and its file system every six hours, and the list's last
       * hour - read by a connection that may wait the longest between
       * reads - may hold neither's newest point, so neither is counted as
       * not reported (#10026).
       */
      `# Traffic (${count("traffic", 1)})`,
      "azure_requests_total",
      `# Errors (${count("errors", 1)})`,
      "azure_http5xx_total",
      // Nothing of Latency reported: its heading alone, in its place.
      `# Latency (${count("latency", 0)})`,
      `# Compute (${count("compute", 1)})`,
      "azure_cputime_total",
      `# Memory (${count("memory", 1)})`,
      "azure_memoryworkingset_average",
      `# Network (${count("network", 0)})`,
      `# Connections (${count("connections", 0)})`,
      `# Backlog (${count("backlog", 0)})`,
      "# Other",
      "app.metric.00",
    ]);
  });

  test("they are no rows: the list counts and pages the metrics it found", async () => {
    await renderViewer();

    expect(lastListProps()["totalCount"]).toBe(REPORTED.length);
    expect(screen.getAllByTestId("metric-row")).toHaveLength(REPORTED.length);
  });

  test("a section opens to what the page says of them, and folds again", async () => {
    await renderViewer();

    const traffic: Element = Array.from(
      screen.getAllByTestId("list-heading"),
    ).find((heading: Element): boolean => {
      return heading.querySelector("h3")?.textContent === "Traffic";
    })!;
    const toggle: HTMLElement = traffic.querySelector(
      `[data-testid="${METRIC_ROW_GROUP_GAP_TOGGLE_TEST_ID}"]`,
    ) as HTMLElement;

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId(METRIC_ROW_GROUP_GAP_CONTENT_TEST_ID),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("gap-keys").textContent).toBe(
      keysOf("traffic")
        .filter((key: string): boolean => {
          return key !== "requests";
        })
        .join(", "),
    );
    // Only the opened section's, and the toggle says which it opens.
    const content: Array<HTMLElement> = screen.getAllByTestId(
      METRIC_ROW_GROUP_GAP_CONTENT_TEST_ID,
    );
    expect(content).toHaveLength(1);
    expect(content[0]!.id).not.toBe("");
    expect(toggle).toHaveAttribute("aria-controls", content[0]!.id);
    expect(traffic.contains(content[0]!)).toBe(true);

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(screen.queryByTestId("gap-keys")).toBeNull();
  });

  test("a search that narrows the list says nothing of them", async () => {
    await renderViewer();

    await act(async () => {
      (lastListProps()["onSearchChange"] as (value: string) => void)(
        "name:azure",
      );
    });
    await act(async () => {
      (lastListProps()["onSearchSubmit"] as () => void)();
    });

    await waitFor(() => {
      expect(
        screen.queryAllByTestId(METRIC_ROW_GROUP_GAP_TOGGLE_TEST_ID),
      ).toHaveLength(0);
    });
    expect(listed()).not.toContain("# Latency");
  });

  test("a list without gaps reads as it did", async () => {
    await renderViewer({
      getRowGroupGaps: undefined,
      renderRowGroupGap: undefined,
    });

    expect(listed()).toEqual([
      "# Traffic",
      "azure_requests_total",
      "# Errors",
      "azure_http5xx_total",
      "# Compute",
      "azure_cputime_total",
      "# Memory",
      "azure_memoryworkingset_average",
      "# Other",
      "app.metric.00",
    ]);
  });

  test("a count with nothing to open it with is not drawn", async () => {
    await renderViewer({ renderRowGroupGap: undefined });

    expect(
      screen.queryAllByTestId(METRIC_ROW_GROUP_GAP_TOGGLE_TEST_ID),
    ).toHaveLength(0);
  });
});
