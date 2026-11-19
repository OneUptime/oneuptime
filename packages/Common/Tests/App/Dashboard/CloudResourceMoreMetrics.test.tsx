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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A cloud resource's More Metrics (#9563): what its cloud publishes beyond
 * its key metrics, listed only when asked; what was added first, with
 * Remove; Add opening a dialog that says what each choice costs before it
 * is made; what cannot be added saying why; and Add and Remove only for
 * whoever may change what a connection reads.
 */

type MockedFn = ReturnType<typeof jest.fn>;

const mockList: MockedFn = jest.fn();
const mockAdd: MockedFn = jest.fn();
const mockRemove: MockedFn = jest.fn();
const mockReaders: MockedFn = jest.fn();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudResourceMetricsApi",
  () => {
    return {
      __esModule: true,
      listCloudResourcePublishedMetrics: (...args: Array<unknown>) => {
        return mockList(...args);
      },
      addCloudResourceMetric: (...args: Array<unknown>) => {
        return mockAdd(...args);
      },
      removeCloudResourceMetric: (...args: Array<unknown>) => {
        return mockRemove(...args);
      },
      findCloudResourceMetricReaders: (...args: Array<unknown>) => {
        return mockReaders(...args);
      },
      explainCloudResourceUnreportedKeyMetrics: () => {
        return Promise.resolve([]);
      },
    };
  },
);

const mockToasts: Array<{ kind: string; title: string }> = [];

jest.mock("../../../UI/Utils/Toast", () => {
  return {
    __esModule: true,
    default: {
      success: (title: string) => {
        mockToasts.push({ kind: "success", title });
        return "toast";
      },
      error: (title: string) => {
        mockToasts.push({ kind: "error", title });
        return "toast";
      },
    },
  };
});

import CloudResourceMoreMetrics, {
  CLOUD_MORE_METRICS_ROW_TEST_ID,
  CLOUD_MORE_METRICS_SEARCH_FROM,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudResourceMoreMetrics";
import { CLOUD_ADD_METRIC_MODAL_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudAddMetricModal";
import { getCloudAddedMetricCostWords } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudAddedMetricWords";
import { drawCloudTemplate } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionWords";
import {
  CloudAddedMetric,
  CloudAddedMetricScope,
} from "../../../Types/Cloud/CloudAddedMetrics";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudPublishedMetricBlock,
  CloudPublishedMetricStatus,
  CloudPublishedMetricsListing,
} from "../../../Types/Cloud/CloudPublishedMetrics";
import ObjectID from "../../../Types/ObjectID";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import { CLOUD_REMOVE_METRIC_MODAL_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudRemoveMetricModal";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import {
  CloudAddedMetricReaderKind,
  CloudAddedMetricReaders,
} from "../../../Types/Cloud/CloudAddedMetricReaders";

const RESOURCE: ObjectID = new ObjectID("5f8b9c1e-2222-4222-8222-222222222222");

function listing(
  overrides: Partial<CloudPublishedMetricsListing> = {},
): CloudPublishedMetricsListing {
  return {
    provider: CloudProvider.Azure,
    resourceType: "Microsoft.Web/sites",
    metrics: [
      {
        name: "Http3xx",
        unit: "Count",
        aggregation: "Total",
        grain: "PT1M",
        status: CloudPublishedMetricStatus.Added,
        addedKey: "resource|microsoft.web/sites|row||http3xx",
        addedScope: CloudAddedMetricScope.Resource,
      },
      {
        name: "AverageMemoryWorkingSet",
        displayName: "Average memory working set",
        description: "The average memory the app used.",
        unit: "Bytes",
        aggregation: "Average",
        grain: "PT1M",
        status: CloudPublishedMetricStatus.Available,
      },
      {
        name: "InstanceSplit",
        unit: "Count",
        aggregation: "Average",
        status: CloudPublishedMetricStatus.Available,
        block: CloudPublishedMetricBlock.NeedsDimension,
      },
      {
        name: "Requests",
        unit: "Count",
        aggregation: "Total",
        status: CloudPublishedMetricStatus.Key,
      },
    ],
    resourcesOfType: 186,
    readIntervalInMinutes: 5,
    azureMetricsInCall: 18,
    addedForResource: 1,
    canEdit: true,
    ...overrides,
  };
}

async function renderCard(
  onAddedMetricsChange?: (metrics: Array<CloudAddedMetric>) => void,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <CloudResourceMoreMetrics
          cloudResourceId={RESOURCE}
          provider={CloudProvider.Azure}
          resourceType="Microsoft.Web/sites"
          onAddedMetricsChange={onAddedMetricsChange}
        />
      </MemoryRouter>,
    );
  });
}

async function list(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /List Metrics/ }));
  });
  await waitFor(() => {
    expect(screen.getAllByTestId(CLOUD_MORE_METRICS_ROW_TEST_ID).length).toBe(
      4,
    );
  });
}

const MONITOR_ID: string = "5f8b9c1e-9999-4999-8999-000000000001";
const DASHBOARD_ID: string = "5f8b9c1e-9999-4999-8999-000000000002";
const SLO_ID: string = "5f8b9c1e-9999-4999-8999-000000000003";
const NO_READERS: CloudAddedMetricReaders = {
  readers: [],
  hidden: 0,
  isCapped: false,
};
const READERS: CloudAddedMetricReaders = {
  readers: [
    {
      kind: CloudAddedMetricReaderKind.Monitor,
      id: MONITOR_ID,
      name: "Shop memory",
      widgets: [],
    },
    {
      kind: CloudAddedMetricReaderKind.Dashboard,
      id: DASHBOARD_ID,
      name: "Web apps",
      widgets: ["Memory by instance", ""],
    },
    {
      kind: CloudAddedMetricReaderKind.Slo,
      id: SLO_ID,
      name: "Shop availability",
      widgets: [],
    },
  ],
  hidden: 1,
  isCapped: false,
};

function rowOf(name: string): HTMLElement {
  return screen
    .getAllByTestId(CLOUD_MORE_METRICS_ROW_TEST_ID)
    .find((row: HTMLElement): boolean => {
      return (row.textContent || "").includes(name);
    })!;
}

beforeEach(() => {
  mockList.mockReset();
  mockAdd.mockReset();
  mockRemove.mockReset();
  mockReaders.mockReset();
  mockReaders.mockImplementation(() => {
    return Promise.resolve(NO_READERS);
  });
  mockToasts.length = 0;
  mockList.mockImplementation(() => {
    return Promise.resolve(listing());
  });
});

afterEach(() => {
  cleanup();
});

describe("listing what the resource publishes", () => {
  test("nothing is asked of its cloud until List Metrics is pressed", async () => {
    await renderCard();

    expect(mockList).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "OneUptime asks the resource's cloud only when you list them, and listing costs nothing.",
      ),
    ).toBeInTheDocument();

    await list();

    expect(mockList).toHaveBeenCalledTimes(1);
    expect((mockList.mock.calls[0]![0] as ObjectID).toString()).toBe(
      RESOURCE.toString(),
    );
    expect(
      screen.getByRole("button", { name: /List Again/ }),
    ).toBeInTheDocument();
  });

  test("each metric in its cloud's words, with what the connection does with it", async () => {
    await renderCard();
    await list();

    const added: HTMLElement = rowOf("Http3xx");
    expect(within(added).getByText("Added")).toBeInTheDocument();
    expect(
      within(added).getByRole("button", { name: /Remove/ }),
    ).toBeInTheDocument();

    const memory: HTMLElement = rowOf("Average memory working set");
    expect(
      within(memory).getByText("AverageMemoryWorkingSet"),
    ).toBeInTheDocument();
    expect(
      within(memory).getByText("The average memory the app used."),
    ).toBeInTheDocument();
    expect(within(memory).getByText("Bytes")).toBeInTheDocument();
    expect(
      within(memory).getByRole("button", { name: /Add/ }),
    ).toBeInTheDocument();

    const blocked: HTMLElement = rowOf("InstanceSplit");
    expect(
      within(blocked).getByText(
        "Its cloud reads it only split by one of its dimensions.",
      ),
    ).toBeInTheDocument();
    expect(within(blocked).queryByRole("button")).toBeNull();

    const key: HTMLElement = rowOf("Requests");
    expect(within(key).getByText("Key metric")).toBeInTheDocument();
    expect(within(key).queryByRole("button")).toBeNull();

    expect(
      screen.getByText("1 of 10 added metrics is read for this resource."),
    ).toBeInTheDocument();
  });

  test("whoever may not change what the connection reads sees the list, and who can", async () => {
    mockList.mockImplementation(() => {
      return Promise.resolve(listing({ canEdit: false }));
    });
    await renderCard();
    await list();

    expect(
      screen.queryAllByRole("button", { name: /^(Add|Remove)$/ }),
    ).toHaveLength(0);
    expect(
      screen.getByText(
        "Project Owners and Project Admins can add and remove metrics.",
      ),
    ).toBeInTheDocument();
  });

  test("a long list can be searched by name, name in words or description", async () => {
    const many: CloudPublishedMetricsListing = listing({
      metrics: Array.from(
        { length: CLOUD_MORE_METRICS_SEARCH_FROM + 2 },
        (_: unknown, index: number) => {
          return {
            name: `Metric${index}`,
            unit: "",
            aggregation: "Average",
            status: CloudPublishedMetricStatus.Available,
            ...(index === 3 ? { description: "Swap space in use" } : {}),
          };
        },
      ),
    });
    mockList.mockImplementation(() => {
      return Promise.resolve(many);
    });
    await renderCard();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /List Metrics/ }));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("cloud-more-metrics-search"),
      ).toBeInTheDocument();
    });

    // A search, never work to keep: a new version's reload does not wait on it.
    expect(screen.getByTestId("cloud-more-metrics-search")).toHaveAttribute(
      "data-unsaved-changes-ignore",
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId("cloud-more-metrics-search"), {
        target: { value: "swap" },
      });
    });

    expect(
      screen
        .getAllByTestId(CLOUD_MORE_METRICS_ROW_TEST_ID)
        .map((row: HTMLElement): string => {
          return row.textContent || "";
        }),
    ).toEqual([expect.stringContaining("Metric3")]);

    await act(async () => {
      fireEvent.change(screen.getByTestId("cloud-more-metrics-search"), {
        target: { value: "nothing like it" },
      });
    });

    expect(
      screen.getByText("No metrics match this search."),
    ).toBeInTheDocument();
  });

  test("a listing that fails says why, in the server's words", async () => {
    mockList.mockImplementation(() => {
      return Promise.reject(
        new Error(
          "No cloud connection reads this resource, so OneUptime cannot ask its cloud what it publishes.",
        ),
      );
    });
    await renderCard();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /List Metrics/ }));
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "No cloud connection reads this resource, so OneUptime cannot ask its cloud what it publishes.",
        ),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryAllByTestId(CLOUD_MORE_METRICS_ROW_TEST_ID),
    ).toHaveLength(0);
  });
});

describe("adding one", () => {
  test("the dialog says what each choice costs, this resource first, and adds it for the choice", async () => {
    const changed: Array<Array<CloudAddedMetric>> = [];
    const added: Array<CloudAddedMetric> = [];
    mockAdd.mockImplementation(() => {
      return Promise.resolve(added);
    });
    await renderCard((metrics: Array<CloudAddedMetric>) => {
      changed.push(metrics);
    });
    await list();

    await act(async () => {
      fireEvent.click(
        within(rowOf("Average memory working set")).getByRole("button", {
          name: /Add/,
        }),
      );
    });

    const dialog: HTMLElement = screen.getByTestId(
      CLOUD_ADD_METRIC_MODAL_TEST_ID,
    );
    // Its minute call carries 18 metrics: one more rides in it.
    expect(
      within(dialog).getAllByText(
        "No extra cost: it is read in the call that already reads the key metrics.",
      ),
    ).toHaveLength(2);
    // Each choice's label is its title, then what it costs.
    const thisResource: HTMLElement = within(dialog).getByRole("radio", {
      name: /^This resource/,
    });
    const everyOne: HTMLElement = within(dialog).getByRole("radio", {
      name: /^Every App Service or Function App this connection reads \(186\)/,
    });
    expect(thisResource).toBeChecked();
    expect(everyOne).not.toBeChecked();
    // Azure needs no statistic.
    expect(within(dialog).queryByText("Statistic")).toBeNull();

    await act(async () => {
      fireEvent.click(everyOne);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Metric/ }));
    });

    await waitFor(() => {
      expect(mockAdd).toHaveBeenCalledTimes(1);
    });
    expect(mockAdd.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        name: "AverageMemoryWorkingSet",
        scope: CloudAddedMetricScope.Type,
        aggregation: undefined,
      }),
    );
    await waitFor(() => {
      expect(changed).toEqual([added]);
    });
    expect(mockToasts).toEqual([
      {
        kind: "success",
        title: "Average memory working set is read from the next read.",
      },
    ]);
    // The list is read again, to show it added.
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  test("an AWS metric is added with the statistic picked, its name's likely one first", async () => {
    mockList.mockImplementation(() => {
      return Promise.resolve(
        listing({
          provider: CloudProvider.AWS,
          resourceType: "AWS::RDS::DBInstance",
          azureMetricsInCall: undefined,
          resourcesOfType: 4,
          metrics: [
            {
              name: "SwapUsage",
              namespace: "AWS/RDS",
              unit: "",
              aggregation: "Average",
              dimensions: [{ name: "DBInstanceIdentifier", value: "orders" }],
              status: CloudPublishedMetricStatus.Available,
            },
          ],
        }),
      );
    });
    mockAdd.mockImplementation(() => {
      return Promise.resolve([]);
    });
    await act(async () => {
      render(
        <CloudResourceMoreMetrics
          cloudResourceId={RESOURCE}
          provider={CloudProvider.AWS}
          resourceType="AWS::RDS::DBInstance"
        />,
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /List Metrics/ }));
    });
    await waitFor(() => {
      expect(
        screen.getAllByTestId(CLOUD_MORE_METRICS_ROW_TEST_ID),
      ).toHaveLength(1);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    });

    const dialog: HTMLElement = screen.getByTestId(
      CLOUD_ADD_METRIC_MODAL_TEST_ID,
    );

    expect(within(dialog).getByText("Statistic")).toBeInTheDocument();
    // AWS bills each metric read: 8,640 a month for one resource, 34,560 for four.
    expect(
      within(dialog).getByText(
        "8,640 more metrics read from CloudWatch a month: about $0.09, at $0.01 per 1,000.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "34,560 more metrics read from CloudWatch a month: about $0.35, at $0.01 per 1,000.",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Metric/ }));
    });

    await waitFor(() => {
      expect(mockAdd).toHaveBeenCalledTimes(1);
    });
    expect(mockAdd.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        name: "SwapUsage",
        namespace: "AWS/RDS",
        scope: CloudAddedMetricScope.Resource,
        aggregation: "Average",
      }),
    );
  });

  test("a refused addition stays in the dialog and says why", async () => {
    mockAdd.mockImplementation(() => {
      return Promise.reject(
        new Error(
          "This resource already has 10 added metrics read for it. Remove one to add another.",
        ),
      );
    });
    await renderCard();
    await list();

    await act(async () => {
      fireEvent.click(
        within(rowOf("Average memory working set")).getByRole("button", {
          name: /Add/,
        }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Metric/ }));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/already has 10 added metrics read for it/),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId(CLOUD_ADD_METRIC_MODAL_TEST_ID),
    ).toBeInTheDocument();
  });
});

describe("removing one", () => {
  async function openRemove(name: string = "Http3xx"): Promise<HTMLElement> {
    await act(async () => {
      fireEvent.click(
        within(rowOf(name)).getByRole("button", { name: /Remove/ }),
      );
    });

    return await screen.findByTestId(CLOUD_REMOVE_METRIC_MODAL_TEST_ID);
  }

  function viewRoute(page: PageMap, id: string): string {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: new ObjectID(id),
    }).toString();
  }

  test("Remove asks first, and with nothing reading it, removes it at once, says so, and lists again", async () => {
    const changed: Array<Array<CloudAddedMetric>> = [];
    mockRemove.mockImplementation(() => {
      return Promise.resolve([]);
    });
    await renderCard((metrics: Array<CloudAddedMetric>) => {
      changed.push(metrics);
    });
    await list();

    const dialog: HTMLElement = await openRemove();

    // Asked before anything is removed.
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockReaders.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        key: "resource|microsoft.web/sites|row||http3xx",
      }),
    );
    expect(
      await within(dialog).findByText("No monitor, dashboard or SLO reads it."),
    ).toBeInTheDocument();
    expect(screen.getByText("Remove Http3xx?")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Keep Metric/ }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove Metric/ }));
    });

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledTimes(1);
    });
    expect(mockRemove.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        key: "resource|microsoft.web/sites|row||http3xx",
      }),
    );
    await waitFor(() => {
      expect(changed).toEqual([[]]);
    });
    expect(mockToasts[0]).toEqual({
      kind: "success",
      title: "Http3xx is no longer read.",
    });
    expect(
      screen.queryByTestId(CLOUD_REMOVE_METRIC_MODAL_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("what reads it is named, each a link, and the person removes it anyway or keeps it", async () => {
    mockReaders.mockImplementation(() => {
      return Promise.resolve(READERS);
    });
    await renderCard();
    await list();

    const dialog: HTMLElement = await openRemove();

    expect(
      await within(dialog).findByText(
        "4 monitors, dashboards and SLOs read it. Once it is removed, they get no new data.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "Shop memory" }),
    ).toHaveAttribute("href", viewRoute(PageMap.MONITOR_VIEW, MONITOR_ID));
    expect(
      within(dialog).getByRole("link", { name: "Web apps" }),
    ).toHaveAttribute("href", viewRoute(PageMap.DASHBOARD_VIEW, DASHBOARD_ID));
    expect(
      within(dialog).getByRole("link", { name: "Shop availability" }),
    ).toHaveAttribute("href", viewRoute(PageMap.SLO_VIEW, SLO_ID));
    // The dashboard's widgets that read it, an untitled one in words.
    expect(within(dialog).getByText("Memory by instance")).toBeInTheDocument();
    expect(within(dialog).getByText("Untitled widget")).toBeInTheDocument();
    expect(
      within(dialog).getByText("1 more reads it that your role cannot open."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "What it stored stays until its retention ends, and you can add it again from this list.",
      ),
    ).toBeInTheDocument();

    // Keep: nothing is removed.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Keep Metric/ }));
    });

    expect(mockRemove).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId(CLOUD_REMOVE_METRIC_MODAL_TEST_ID),
    ).not.toBeInTheDocument();

    // Remove Anyway: removed.
    mockRemove.mockImplementation(() => {
      return Promise.resolve([]);
    });
    await openRemove();
    await screen.findByText("Shop memory");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove Anyway/ }));
    });
    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledTimes(1);
    });
  });

  test("Remove waits for the answer before it can be pressed", async () => {
    let answer: (readers: CloudAddedMetricReaders) => void = () => {};
    mockReaders.mockImplementation(() => {
      return new Promise<CloudAddedMetricReaders>(
        (resolve: (readers: CloudAddedMetricReaders) => void) => {
          answer = resolve;
        },
      );
    });
    await renderCard();
    await list();
    await openRemove();

    expect(
      screen.getByRole("button", { name: /Remove Metric/ }),
    ).toBeDisabled();

    await act(async () => {
      answer(NO_READERS);
    });

    expect(
      screen.getByRole("button", { name: /Remove Metric/ }),
    ).not.toBeDisabled();
  });

  test("a type's addition says removing it stops it for every resource of the type, and a capped answer that there may be more", async () => {
    mockList.mockImplementation(() => {
      const listed: CloudPublishedMetricsListing = listing();

      listed.metrics[0] = {
        ...listed.metrics[0]!,
        addedKey: "type|microsoft.web/sites|||http3xx",
        addedScope: CloudAddedMetricScope.Type,
      };

      return Promise.resolve(listed);
    });
    mockReaders.mockImplementation(() => {
      return Promise.resolve({ ...READERS, isCapped: true });
    });
    await renderCard();
    await list();

    const dialog: HTMLElement = await openRemove();

    expect(
      within(dialog).getByText(
        "It is read for every App Service or Function App this connection reads (186), so removing it stops it for all of them.",
      ),
    ).toBeInTheDocument();
    expect(
      await within(dialog).findByText(
        "There may be more: only the first 500 monitors, dashboards and SLOs that name it were checked.",
      ),
    ).toBeInTheDocument();
  });

  test("a lookup that fails says so, can be tried again, and still lets the person remove it", async () => {
    mockReaders.mockImplementation(() => {
      return Promise.reject(new Error("The lookup failed."));
    });
    mockRemove.mockImplementation(() => {
      return Promise.resolve([]);
    });
    await renderCard();
    await list();

    const dialog: HTMLElement = await openRemove();

    expect(
      await within(dialog).findByText(/The lookup failed/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Remove Metric/ }),
    ).not.toBeDisabled();

    mockReaders.mockImplementation(() => {
      return Promise.resolve(READERS);
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Refresh/ }));
    });

    expect(await within(dialog).findByText("Shop memory")).toBeInTheDocument();
  });

  test("a removal that fails says so in the dialog, and keeps it open", async () => {
    mockRemove.mockImplementation(() => {
      return Promise.reject(new Error("Not removed: try again."));
    });
    await renderCard();
    await list();
    await openRemove();
    await screen.findByText("No monitor, dashboard or SLO reads it.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove Metric/ }));
    });

    expect(
      await screen.findByText(/Not removed: try again/),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(CLOUD_REMOVE_METRIC_MODAL_TEST_ID),
    ).toBeInTheDocument();
  });
});

/*
 * #9808: a metric with dimensions can be added split by one - a series per
 * value, at most 10 a resource - and each choice's cost counts every
 * series; one its cloud reads only split offers no "Don't split".
 */
describe("adding one split by a dimension", () => {
  function withSplits(
    overrides: Partial<CloudPublishedMetricsListing["metrics"][number]>,
  ): CloudPublishedMetricsListing {
    const listed: CloudPublishedMetricsListing = listing();

    listed.metrics[1] = { ...listed.metrics[1]!, ...overrides };

    return listed;
  }

  async function openAdd(): Promise<HTMLElement> {
    await act(async () => {
      fireEvent.click(
        within(rowOf("Average memory working set")).getByRole("button", {
          name: /Add/,
        }),
      );
    });

    return screen.getByTestId(CLOUD_ADD_METRIC_MODAL_TEST_ID);
  }

  test("one its cloud reads only split is added split by its first dimension, and its cost is a call of its own", async () => {
    mockList.mockImplementation(() => {
      return Promise.resolve(
        withSplits({
          splits: [{ name: "Instance" }, { name: "ApiName" }],
          isSplitRequired: true,
        }),
      );
    });
    mockAdd.mockImplementation(() => {
      return Promise.resolve([]);
    });
    await renderCard();
    await list();

    const dialog: HTMLElement = await openAdd();

    expect(within(dialog).getByText("Split by")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Its cloud reads it only split. A series for each value, up to 10 for each resource, to chart and alert on.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Instance")).toBeInTheDocument();
    expect(within(dialog).queryByText("Don't split")).toBeNull();
    // Split, it never rides in the key metrics' call.
    expect(
      within(dialog).queryByText(
        "No extra cost: it is read in the call that already reads the key metrics.",
      ),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Metric/ }));
    });

    await waitFor(() => {
      expect(mockAdd).toHaveBeenCalledTimes(1);
    });
    expect(mockAdd.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        name: "AverageMemoryWorkingSet",
        splitBy: "Instance",
      }),
    );
  });

  test("one that can be split is added whole unless a dimension is picked", async () => {
    mockList.mockImplementation(() => {
      return Promise.resolve(withSplits({ splits: [{ name: "Instance" }] }));
    });
    mockAdd.mockImplementation(() => {
      return Promise.resolve([]);
    });
    await renderCard();
    await list();

    const dialog: HTMLElement = await openAdd();

    expect(within(dialog).getByText("Don't split")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "A series for each value, up to 10 for each resource, to chart and alert on.",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Metric/ }));
    });

    await waitFor(() => {
      expect(mockAdd).toHaveBeenCalledTimes(1);
    });
    expect(
      (mockAdd.mock.calls[0]![0] as { splitBy?: string }).splitBy,
    ).toBeUndefined();
  });

  test("a metric with no dimension asks nothing of splits", async () => {
    await renderCard();
    await list();

    const dialog: HTMLElement = await openAdd();

    expect(within(dialog).queryByText("Split by")).toBeNull();
  });

  test("an addition split says by what; one its cloud reads only split says so before it is added", async () => {
    const listed: CloudPublishedMetricsListing = listing();

    listed.metrics[0] = { ...listed.metrics[0]!, addedSplitBy: "Instance" };
    listed.metrics[1] = {
      ...listed.metrics[1]!,
      splits: [{ name: "Instance" }],
      isSplitRequired: true,
    };
    mockList.mockImplementation(() => {
      return Promise.resolve(listed);
    });
    await renderCard();
    await list();

    expect(
      within(rowOf("Http3xx")).getByText(
        "Split by Instance, a series for each value",
      ),
    ).toBeInTheDocument();
    expect(
      within(rowOf("Average memory working set")).getByText(
        "Its cloud reads it only split by one of its dimensions.",
      ),
    ).toBeInTheDocument();
  });

  test("an AWS metric split counts each value's metric read in its cost", () => {
    expect(
      drawCloudTemplate(
        getGlobalTranslator(),
        getCloudAddedMetricCostWords({
          provider: CloudProvider.AWS,
          resources: 1,
          readIntervalInMinutes: 5,
          isSplit: true,
          seriesPerResource: 3,
        }),
      ),
    ).toBe(
      "25,920 more metrics read from CloudWatch a month: about $0.26, at $0.01 per 1,000.",
    );
  });
});

describe("what an addition costs, in words", () => {
  test("each cloud in its own unit, a choice that rides in a call at no cost", () => {
    const words: (
      data: Parameters<typeof getCloudAddedMetricCostWords>[0],
    ) => string = (
      data: Parameters<typeof getCloudAddedMetricCostWords>[0],
    ): string => {
      return drawCloudTemplate(
        getGlobalTranslator(),
        getCloudAddedMetricCostWords(data),
      );
    };

    expect(
      words({
        provider: CloudProvider.Azure,
        resources: 186,
        readIntervalInMinutes: 5,
        azureGrain: "PT1M",
        azureMetricsInCall: 20,
      }),
    ).toBe(
      "1,607,040 more Azure Monitor calls a month: free within each subscription's first 1,000,000 a month, then about $16.07.",
    );
    expect(
      words({
        provider: CloudProvider.GCP,
        resources: 1,
        readIntervalInMinutes: 5,
      }),
    ).toBe(
      "8,640 more time series read a month: free within the first 1,000,000 a month, then about $0.01.",
    );
    expect(
      words({
        provider: CloudProvider.Azure,
        resources: 1,
        readIntervalInMinutes: 5,
        azureGrain: "PT5M",
        azureHasFiveMinuteCall: true,
      }),
    ).toBe(
      "No extra cost: it is read in the call that already reads the key metrics.",
    );
  });
});
