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
const mockKeep: MockedFn = jest.fn();

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
      keepCloudResourceMetricFor: (...args: Array<unknown>) => {
        return mockKeep(...args);
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
  isAddedSplitLearnedFromEveryValue,
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
import { getEmptyMetricOutputReaders } from "../../../Types/Metrics/MetricOutputReaders";
import ObjectID from "../../../Types/ObjectID";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import { CLOUD_REMOVE_METRIC_MODAL_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/ResourceMetrics/CloudRemoveMetricModal";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import {
  CloudAddedMetricKeepBlock,
  CloudAddedMetricReaderKind,
  CloudAddedMetricReaders,
} from "../../../Types/Cloud/CloudAddedMetricReaders";
import { getMetricRecordingRulesRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/RecordingRule/RecordingRulesRoute";

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
const RULE_ID: string = "5f8b9c1e-9999-4999-8999-000000000004";
const NO_READERS: CloudAddedMetricReaders = {
  readers: [],
  hidden: 0,
  uncheckedKinds: [],
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
      // A widget of a kind the catalog does not know, and no title.
      widgets: [
        { id: "", title: "Memory by instance", type: "Chart" },
        { id: "", title: "", type: "" },
      ],
    },
    {
      kind: CloudAddedMetricReaderKind.Slo,
      id: SLO_ID,
      name: "Shop availability",
      widgets: [],
    },
    {
      kind: CloudAddedMetricReaderKind.RecordingRule,
      id: RULE_ID,
      name: "Shop memory rate",
      widgets: [],
      outputMetricName: "shop_memory_rate",
    },
  ],
  hidden: 1,
  uncheckedKinds: [],
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
  mockKeep.mockReset();
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
      await within(dialog).findByText(
        "No monitor, dashboard, SLO or recording rule reads it.",
      ),
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
        "5 monitors, dashboards, SLOs and recording rules read it. Once it is removed, they get no new data.",
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
    // A recording rule has no page: its list, filtered to the metric it writes.
    expect(
      within(dialog).getByRole("link", { name: "Shop memory rate" }),
    ).toHaveAttribute(
      "href",
      getMetricRecordingRulesRoute("shop_memory_rate").toString(),
    );
    expect(
      within(dialog).getByTestId("cloud-remove-metric-readers-recordingRule"),
    ).toHaveTextContent("Recording Rules");
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

  test("a type's addition says removing it stops it for every resource of the type, and records that could not be checked that they may read it", async () => {
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
      return Promise.resolve({
        ...READERS,
        uncheckedKinds: [CloudAddedMetricReaderKind.Dashboard],
      });
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
        "Some monitors, dashboards, SLOs or recording rules could not be checked just now and may read it.",
      ),
    ).toBeInTheDocument();
  });

  test("none found, but some records not checked: nothing is said to read none of it, and removing it is still a choice", async () => {
    mockReaders.mockImplementation(() => {
      return Promise.resolve({
        ...NO_READERS,
        uncheckedKinds: [
          CloudAddedMetricReaderKind.Monitor,
          CloudAddedMetricReaderKind.Slo,
        ],
      });
    });
    await renderCard();
    await list();

    const dialog: HTMLElement = await openRemove();

    expect(
      await within(dialog).findByTestId("cloud-remove-metric-unchecked"),
    ).toHaveTextContent(
      "Some monitors, dashboards, SLOs or recording rules could not be checked just now and may read it.",
    );
    expect(
      within(dialog).queryByTestId("cloud-remove-metric-no-readers"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Remove Anyway/ }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Keep Metric/ }),
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
    await screen.findByText(
      "No monitor, dashboard, SLO or recording rule reads it.",
    );

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

  /*
   * #10076: Google Cloud bills every series a call returns, so a split is
   * asked for each resource's busiest values alone, learned every hour: the
   * dialog says so before it is added, with what it costs at most - its
   * reads and the hour's learning, ten series a resource each.
   */
  test("a Google Cloud split says only the busiest values are asked for, and what that costs at most", async () => {
    const listed: CloudPublishedMetricsListing = listing({
      provider: CloudProvider.GCP,
      resourceType: "gce_instance",
      resourcesOfType: 12,
    });

    delete listed.azureMetricsInCall;
    listed.metrics[1] = {
      name: "agent.googleapis.com/processes/cpu_time",
      displayName: "Process CPU time",
      unit: "us/s",
      aggregation: "ALIGN_RATE",
      status: CloudPublishedMetricStatus.Available,
      splits: [{ name: "command" }, { name: "owner" }],
    };
    mockList.mockImplementation(() => {
      return Promise.resolve(listed);
    });
    mockAdd.mockImplementation(() => {
      return Promise.resolve([]);
    });
    await renderCard();
    await list();
    await act(async () => {
      fireEvent.click(
        within(rowOf("Process CPU time")).getByRole("button", {
          name: /Add/,
        }),
      );
    });

    const dialog: HTMLElement = screen.getByTestId(
      CLOUD_ADD_METRIC_MODAL_TEST_ID,
    );

    expect(
      within(dialog).getByTestId("cloud-add-metric-split-help"),
    ).toHaveTextContent(
      "A series for each of the 10 busiest values on each resource, checked every hour, so Google Cloud bills those alone.",
    );
    // Whole, a series a read.
    expect(
      within(dialog).getByText(
        "8,640 more time series read a month: free within the first 1,000,000 a month, then about $0.01.",
      ),
    ).toBeInTheDocument();

    // Split by command: at most its busiest 10 a read, and the hour's learning.
    const combobox: HTMLElement = within(dialog).getByLabelText("Split by");

    fireEvent.keyDown(combobox, { key: "ArrowDown", code: 40, keyCode: 40 });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "command" }));
    });

    expect(
      within(dialog).getByText(
        "Up to 93,600 more time series read a month: free within the first 1,000,000 a month, then up to $0.05.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Up to 1,123,200 more time series read a month: free within the first 1,000,000 a month, then up to $0.56.",
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
        name: "agent.googleapis.com/processes/cpu_time",
        splitBy: "command",
      }),
    );
  });

  /*
   * #10164: a split its connection's reads found PromQL cannot rank is
   * learned each hour from a list of every value: the dialog says so under
   * the picker once it is picked, and counts the learning's every value -
   * what the list returned of a resource - in what it costs.
   */
  test("a Google Cloud split PromQL cannot rank says its hour reads every value, and costs them", async () => {
    const listed: CloudPublishedMetricsListing = listing({
      provider: CloudProvider.GCP,
      resourceType: "gce_instance",
      resourcesOfType: 12,
    });

    delete listed.azureMetricsInCall;
    listed.metrics[1] = {
      name: "agent.googleapis.com/processes/cpu_time",
      displayName: "Process CPU time",
      unit: "us/s",
      aggregation: "ALIGN_RATE",
      status: CloudPublishedMetricStatus.Available,
      splits: [
        {
          name: "command",
          isLearnedFromEveryValue: true,
          learnedValuesPerResource: 40,
        },
        { name: "owner" },
      ],
    };
    mockList.mockImplementation(() => {
      return Promise.resolve(listed);
    });
    await renderCard();
    await list();
    await act(async () => {
      fireEvent.click(
        within(rowOf("Process CPU time")).getByRole("button", {
          name: /Add/,
        }),
      );
    });

    const dialog: HTMLElement = screen.getByTestId(
      CLOUD_ADD_METRIC_MODAL_TEST_ID,
    );

    // Not split yet: nothing of it.
    expect(
      within(dialog).queryByTestId("cloud-add-metric-split-every-value"),
    ).toBeNull();

    const combobox: HTMLElement = within(dialog).getByLabelText("Split by");

    fireEvent.keyDown(combobox, { key: "ArrowDown", code: 40, keyCode: 40 });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "command" }));
    });

    expect(
      within(dialog).getByTestId("cloud-add-metric-split-every-value"),
    ).toHaveTextContent(
      "Google Cloud cannot rank this metric's values, so finding the busiest each hour reads every value, and Google Cloud bills them all.",
    );
    // Its reads, 10 a resource; its hour's learning, the 40 its list returned.
    expect(
      within(dialog).getByText(
        "Up to 115,200 more time series read a month: free within the first 1,000,000 a month, then up to $0.06.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Up to 1,382,400 more time series read a month: free within the first 1,000,000 a month, then up to $0.69.",
      ),
    ).toBeInTheDocument();

    // Another label, which PromQL ranks: as #10076's.
    fireEvent.keyDown(combobox, { key: "ArrowDown", code: 40, keyCode: 40 });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "owner" }));
    });

    expect(
      within(dialog).queryByTestId("cloud-add-metric-split-every-value"),
    ).toBeNull();
    expect(
      within(dialog).getByText(
        "Up to 93,600 more time series read a month: free within the first 1,000,000 a month, then up to $0.05.",
      ),
    ).toBeInTheDocument();
  });

  test("an added split PromQL cannot rank says so on its row; one it ranks does not", async () => {
    const listed: CloudPublishedMetricsListing = listing({
      provider: CloudProvider.GCP,
      resourceType: "gce_instance",
      resourcesOfType: 12,
    });

    delete listed.azureMetricsInCall;
    listed.metrics[1] = {
      name: "agent.googleapis.com/processes/cpu_time",
      displayName: "Process CPU time",
      unit: "us/s",
      aggregation: "ALIGN_RATE",
      status: CloudPublishedMetricStatus.Added,
      addedSplitBy: "command",
      splits: [
        { name: "command", isLearnedFromEveryValue: true },
        { name: "owner" },
      ],
    };
    listed.metrics[2] = {
      name: "agent.googleapis.com/processes/rss_usage",
      displayName: "Process memory",
      unit: "By",
      aggregation: "ALIGN_MEAN",
      status: CloudPublishedMetricStatus.Added,
      addedSplitBy: "owner",
      splits: [
        { name: "command", isLearnedFromEveryValue: true },
        { name: "owner" },
      ],
    };
    mockList.mockImplementation(() => {
      return Promise.resolve(listed);
    });
    await renderCard();
    await list();

    expect(
      within(rowOf("Process CPU time")).getByTestId(
        "cloud-more-metrics-split-every-value",
      ),
    ).toHaveTextContent("Google Cloud cannot rank this metric's values");
    expect(
      within(rowOf("Process memory")).queryByTestId(
        "cloud-more-metrics-split-every-value",
      ),
    ).toBeNull();
    expect(
      isAddedSplitLearnedFromEveryValue({
        addedSplitBy: undefined,
        splits: [],
      }),
    ).toBe(false);
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

/*
 * #10078: a metric added for every resource of its type is often read of a
 * few of them alone. Remove then offers a clear choice: keep it for the
 * resources its readers read - named, the rest costing nothing - or remove
 * it for every one. Not offered while a reader reads it of every resource,
 * which is marked and said, nor past the connection's cap, which is said.
 */
describe("keeping a type's metric for the resources its readers read", () => {
  const SHOP: string = "5f8b9c1e-3333-4333-8333-000000000001";
  const CART: string = "5f8b9c1e-3333-4333-8333-000000000002";
  const TYPE_KEY: string = "type|microsoft.web/sites|||http3xx";

  function typeWideListing(): CloudPublishedMetricsListing {
    const listed: CloudPublishedMetricsListing = listing();

    listed.metrics[0] = {
      ...listed.metrics[0]!,
      addedKey: TYPE_KEY,
      addedScope: CloudAddedMetricScope.Type,
    };

    return listed;
  }

  function readersWith(
    overrides: Partial<CloudAddedMetricReaders> = {},
  ): CloudAddedMetricReaders {
    return {
      readers: [
        {
          kind: CloudAddedMetricReaderKind.Monitor,
          id: MONITOR_ID,
          name: "Shop 3xx",
          widgets: [],
        },
        {
          kind: CloudAddedMetricReaderKind.Dashboard,
          id: DASHBOARD_ID,
          name: "Web apps",
          widgets: [{ id: "", title: "", type: "Chart" }],
        },
      ],
      hidden: 0,
      uncheckedKinds: [],
      hiddenByKind: {},
      keepFor: {
        resources: [
          { id: SHOP, name: "shop" },
          { id: CART, name: "cart" },
        ],
      },
      ...overrides,
    };
  }

  async function openRemove(): Promise<HTMLElement> {
    await act(async () => {
      fireEvent.click(
        within(rowOf("Http3xx")).getByRole("button", { name: /Remove/ }),
      );
    });

    return await screen.findByTestId(CLOUD_REMOVE_METRIC_MODAL_TEST_ID);
  }

  beforeEach(() => {
    mockList.mockImplementation(() => {
      return Promise.resolve(typeWideListing());
    });
  });

  test("keeping it for them is the choice it opens on: they are named, and Keep for These Resources keeps it for them, says so, and lists again", async () => {
    const changed: Array<Array<CloudAddedMetric>> = [];

    mockReaders.mockImplementation(() => {
      return Promise.resolve(readersWith());
    });
    mockKeep.mockImplementation(() => {
      return Promise.resolve([]);
    });
    await renderCard((metrics: Array<CloudAddedMetric>) => {
      changed.push(metrics);
    });
    await list();

    const dialog: HTMLElement = await openRemove();
    const choice: HTMLElement = await within(dialog).findByTestId(
      "cloud-remove-metric-keep-for",
    );
    const keep: HTMLElement = within(choice).getByRole("radio", {
      name: /Keep it for the 2 resources its readers read/,
    });

    expect(keep).toBeChecked();
    expect(choice).toHaveTextContent(
      "It stops being read, and billed, for the other 184.",
    );
    expect(
      within(choice).getByTestId("cloud-remove-metric-kept-resources"),
    ).toHaveTextContent("shop, cart");
    expect(
      within(choice).getByRole("radio", {
        name: /Remove it for every App Service or Function App/,
      }),
    ).not.toBeChecked();
    // Keeping all of it is Cancel: nothing changes.
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Keep Metric/ }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Keep for These Resources/ }),
      );
    });

    await waitFor(() => {
      expect(mockKeep).toHaveBeenCalledTimes(1);
    });
    expect(mockKeep.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        key: TYPE_KEY,
        cloudResourceIds: [SHOP, CART],
      }),
    );
    expect(mockRemove).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(changed).toEqual([[]]);
    });
    expect(mockToasts[0]).toEqual({
      kind: "success",
      title: "Http3xx is now read only for the resources its readers read.",
    });
    expect(
      screen.queryByTestId(CLOUD_REMOVE_METRIC_MODAL_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("choosing to remove it for every one removes it, by Remove Anyway", async () => {
    mockReaders.mockImplementation(() => {
      return Promise.resolve(readersWith());
    });
    mockRemove.mockImplementation(() => {
      return Promise.resolve([]);
    });
    await renderCard();
    await list();

    const dialog: HTMLElement = await openRemove();

    await act(async () => {
      fireEvent.click(
        await within(dialog).findByRole("radio", {
          name: /Remove it for every App Service or Function App/,
        }),
      );
    });

    expect(
      within(dialog).queryByTestId("cloud-remove-metric-kept-resources"),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove Anyway/ }));
    });

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledTimes(1);
    });
    expect(mockKeep).not.toHaveBeenCalled();
    expect(mockToasts[0]!.title).toBe("Http3xx is no longer read.");
  });

  test("a reader of every resource is marked, and the dialog says why it can only be kept for all or removed", async () => {
    const readers: CloudAddedMetricReaders = readersWith({
      keepFor: {
        resources: [{ id: SHOP, name: "shop" }],
        blockedBy: CloudAddedMetricKeepBlock.EveryResource,
      },
    });

    readers.readers[1] = { ...readers.readers[1]!, readsEveryResource: true };
    mockReaders.mockImplementation(() => {
      return Promise.resolve(readers);
    });
    await renderCard();
    await list();

    const dialog: HTMLElement = await openRemove();

    expect(
      await within(dialog).findByTestId(
        "cloud-remove-metric-readers-dashboard-note",
      ),
    ).toHaveTextContent("Reads it of every App Service or Function App");
    expect(
      within(dialog).getByTestId("cloud-remove-metric-not-kept"),
    ).toHaveTextContent(
      "It can't be kept for only the resources its readers read: one of them reads it of every App Service or Function App.",
    );
    expect(
      within(dialog).queryByTestId("cloud-remove-metric-keep-for"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Keep Metric/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Remove Anyway/ }),
    ).toBeInTheDocument();
  });

  test("one the person cannot open that reads it of every resource is said so, never named", async () => {
    mockReaders.mockImplementation(() => {
      return Promise.resolve(
        readersWith({
          hidden: 1,
          hiddenByKind: { [CloudAddedMetricReaderKind.Slo]: 1 },
          keepFor: {
            resources: [{ id: SHOP, name: "shop" }],
            blockedBy: CloudAddedMetricKeepBlock.EveryResource,
          },
        }),
      );
    });
    await renderCard();
    await list();

    const dialog: HTMLElement = await openRemove();

    expect(
      await within(dialog).findByTestId("cloud-remove-metric-not-kept"),
    ).toHaveTextContent(
      "It can't be kept for only the resources its readers read: a record you can't see reads it of every App Service or Function App.",
    );
    expect(
      within(dialog).getByTestId("cloud-remove-metric-readers-slo-hidden"),
    ).toHaveTextContent("1 SLO you can't see");
  });

  test("past the connection's cap of added metrics, it says so, with the cap", async () => {
    mockReaders.mockImplementation(() => {
      return Promise.resolve(
        readersWith({
          keepFor: {
            resources: [
              { id: SHOP, name: "shop" },
              { id: CART, name: "cart" },
            ],
            blockedBy: CloudAddedMetricKeepBlock.ConnectionFull,
          },
        }),
      );
    });
    await renderCard();
    await list();

    const dialog: HTMLElement = await openRemove();

    expect(
      await within(dialog).findByTestId("cloud-remove-metric-not-kept"),
    ).toHaveTextContent(
      "It can't be kept for only the 2 resources its readers read: this connection would read more than 50 added metrics. Remove another added metric first.",
    );
    expect(
      within(dialog).queryByTestId("cloud-remove-metric-keep-for"),
    ).toBeNull();
  });

  test("records that could not be checked, or readers of every resource there is: no choice, as keeping it for them saves nothing", async () => {
    mockReaders.mockImplementation(() => {
      return Promise.resolve(
        readersWith({
          uncheckedKinds: [CloudAddedMetricReaderKind.Slo],
          keepFor: {
            resources: [{ id: SHOP, name: "shop" }],
            blockedBy: CloudAddedMetricKeepBlock.Unchecked,
          },
        }),
      );
    });
    await renderCard();
    await list();

    let dialog: HTMLElement = await openRemove();

    await within(dialog).findByTestId("cloud-remove-metric-unchecked");
    expect(
      within(dialog).queryByTestId("cloud-remove-metric-keep-for"),
    ).toBeNull();
    expect(
      within(dialog).queryByTestId("cloud-remove-metric-not-kept"),
    ).toBeNull();

    // Every one of the type read: nothing to save.
    cleanup();
    mockList.mockImplementation(() => {
      const listed: CloudPublishedMetricsListing = typeWideListing();

      listed.resourcesOfType = 2;

      return Promise.resolve(listed);
    });
    mockReaders.mockImplementation(() => {
      return Promise.resolve(readersWith());
    });
    await renderCard();
    await list();
    dialog = await openRemove();

    await within(dialog).findByText("Shop 3xx");
    expect(
      within(dialog).queryByTestId("cloud-remove-metric-keep-for"),
    ).toBeNull();
  });

  test("keeping it that fails says so in the dialog, and keeps it open", async () => {
    mockReaders.mockImplementation(() => {
      return Promise.resolve(readersWith());
    });
    mockKeep.mockImplementation(() => {
      return Promise.reject(new Error("Not kept: try again."));
    });
    await renderCard();
    await list();
    await openRemove();
    await screen.findByTestId("cloud-remove-metric-keep-for");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Keep for These Resources/ }),
      );
    });

    expect(await screen.findByText(/Not kept: try again/)).toBeInTheDocument();
    expect(
      screen.getByTestId(CLOUD_REMOVE_METRIC_MODAL_TEST_ID),
    ).toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

/*
 * #10107: Remove lists what reads the metric as Drop This Metric does, by
 * the one shared list: each kind's own line, the first five of a kind and
 * then a count, a dashboard's untitled widget by its kind, and the ones
 * the person cannot open counted with their kind.
 */
describe("Remove lists what reads it as Drop This Metric does", () => {
  async function openRemove(): Promise<HTMLElement> {
    await act(async () => {
      fireEvent.click(
        within(rowOf("Http3xx")).getByRole("button", { name: /Remove/ }),
      );
    });

    return await screen.findByTestId(CLOUD_REMOVE_METRIC_MODAL_TEST_ID);
  }

  test("each kind with its line; the first five, then a count; widgets by title or kind; hidden ones with their kind", async () => {
    const monitors: Array<CloudAddedMetricReaders["readers"][number]> =
      Array.from({ length: 7 }, (_: unknown, index: number) => {
        return {
          kind: CloudAddedMetricReaderKind.Monitor,
          id: `5f8b9c1e-9999-4999-8999-1000000000${String(index).padStart(2, "0")}`,
          name: `Monitor ${index}`,
          widgets: [],
        };
      });

    mockReaders.mockImplementation(() => {
      return Promise.resolve({
        readers: [
          ...monitors,
          {
            kind: CloudAddedMetricReaderKind.Dashboard,
            id: DASHBOARD_ID,
            name: "Web apps",
            widgets: [
              { title: "", type: "Gauge" },
              { title: "Memory by instance", type: "Chart" },
            ],
          },
        ],
        hidden: 3,
        uncheckedKinds: [],
        hiddenByKind: {
          [CloudAddedMetricReaderKind.Monitor]: 1,
          [CloudAddedMetricReaderKind.Slo]: 2,
        },
      });
    });
    await renderCard();
    await list();

    const dialog: HTMLElement = await openRemove();
    const shown: HTMLElement = await within(dialog).findByTestId(
      "cloud-remove-metric-readers-monitor",
    );

    expect(shown).toHaveTextContent(
      "They get no new data from it, so they can no longer alert on its values.",
    );
    expect(within(shown).getAllByRole("link")).toHaveLength(5);
    expect(shown).toHaveTextContent("and 2 more");
    expect(
      within(dialog).getByTestId("cloud-remove-metric-readers-monitor-hidden"),
    ).toHaveTextContent("and 1 more you can't see");
    expect(
      within(dialog).getByTestId("cloud-remove-metric-readers-dashboard"),
    ).toHaveTextContent(
      "The widgets named under each show no new data from it.",
    );
    expect(
      within(dialog).getByTestId("cloud-remove-metric-widgets"),
    ).toHaveTextContent("Gauge, Memory by instance");
    expect(
      within(dialog).getByTestId("cloud-remove-metric-readers-slo-hidden"),
    ).toHaveTextContent("2 SLOs you can't see");
    expect(
      within(dialog).getByTestId("cloud-remove-metric-readers-slo"),
    ).toHaveTextContent(
      "They count no new events from it, so their error budgets no longer include it.",
    );
    // Counted kind by kind: never again as a total.
    expect(dialog).not.toHaveTextContent("your role cannot open");
    expect(
      within(dialog).getByText(
        "11 monitors, dashboards, SLOs and recording rules read it. Once it is removed, they get no new data.",
      ),
    ).toBeInTheDocument();
  });
});

/*
 * #10084 and #10085 in Remove, through the same list Drop This Metric draws:
 * a widget named opens its dashboard at it, and under a recording rule that
 * reads the metric, what reads its output metric - which no longer includes
 * the metric once it is removed - on down the chain, with what reads the
 * outputs of rules the person can't open under their count.
 */
describe("Remove names what reads a recording rule's output, and links each widget", () => {
  async function openRemove(): Promise<HTMLElement> {
    await act(async () => {
      fireEvent.click(
        within(rowOf("Http3xx")).getByRole("button", { name: /Remove/ }),
      );
    });

    return await screen.findByTestId(CLOUD_REMOVE_METRIC_MODAL_TEST_ID);
  }

  function viewRoute(page: PageMap, id: string): string {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: new ObjectID(id),
    }).toString();
  }

  test("a widget opens its dashboard at it; a rule shows what reads its output, and the hidden rules' outputs sit under their count", async () => {
    const ruleId: string = "5f8b9c1e-9999-4999-8999-0000000000a1";
    const alertId: string = "5f8b9c1e-9999-4999-8999-0000000000a2";

    mockReaders.mockImplementation(() => {
      return Promise.resolve({
        readers: [
          {
            kind: CloudAddedMetricReaderKind.Dashboard,
            id: DASHBOARD_ID,
            name: "Web apps",
            widgets: [
              { id: "chart-1", title: "Memory by instance", type: "Chart" },
              // An older answer's widget, without its id: named, not linked.
              { id: "", title: "Swap", type: "Chart" },
            ],
          },
          {
            kind: CloudAddedMetricReaderKind.RecordingRule,
            id: ruleId,
            name: "Shop memory rate",
            widgets: [],
            outputMetricName: "shop_memory_rate",
            outputReaders: {
              ...getEmptyMetricOutputReaders(),
              monitors: {
                readers: [{ id: alertId, name: "Memory rate alert" }],
                hidden: 0,
              },
            },
          },
        ],
        hidden: 1,
        uncheckedKinds: [],
        hiddenByKind: { [CloudAddedMetricReaderKind.RecordingRule]: 1 },
        hiddenOutputReaders: {
          ...getEmptyMetricOutputReaders(),
          dashboards: { readers: [], hidden: 2 },
        },
      });
    });
    await renderCard();
    await list();

    const dialog: HTMLElement = await openRemove();
    const widgets: HTMLElement = await within(dialog).findByTestId(
      "cloud-remove-metric-widgets",
    );

    expect(
      within(widgets).getByRole("link", { name: "Memory by instance" }),
    ).toHaveAttribute(
      "href",
      `${viewRoute(PageMap.DASHBOARD_VIEW, DASHBOARD_ID)}?widget=chart-1`,
    );
    expect(within(widgets).getAllByRole("link")).toHaveLength(1);
    expect(widgets).toHaveTextContent("Memory by instance, Swap");

    const output: HTMLElement = within(dialog).getByTestId(
      "cloud-remove-metric-readers-recordingRule-output",
    );

    expect(output).toHaveTextContent(
      "These read its output metric, shop_memory_rate:",
    );
    expect(
      within(output).getByRole("link", { name: "Memory rate alert" }),
    ).toHaveAttribute("href", viewRoute(PageMap.MONITOR_VIEW, alertId));

    const hidden: HTMLElement = within(dialog).getByTestId(
      "cloud-remove-metric-readers-recordingRule-hidden",
    );

    expect(hidden).toHaveTextContent("and 1 more you can't see");
    expect(hidden).toHaveTextContent(
      "These read the output metrics of the ones you can't see:",
    );
    expect(hidden).toHaveTextContent("2 dashboards you can't see");
    // Its count is of what reads the metric: what reads an output is not counted again.
    expect(
      within(dialog).getByText(
        "3 monitors, dashboards, SLOs and recording rules read it. Once it is removed, they get no new data.",
      ),
    ).toBeInTheDocument();
  });
});
