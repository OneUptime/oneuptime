import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { getJestSpyOn } from "../../Spy";

/*
 * Issue #6460: a monitor created from a metric view of a Service Bus or
 * Event Hubs namespace reads what the view read, in the monitor's own
 * intervals. The namespace's metrics arrive once per queue, so its number
 * is their Sum - a count's at any interval, messages waiting's by the
 * minute (CloudResourceMetricAggregation). A view longer than 3 hours reads
 * messages waiting as the average of its queues, in 5-minute intervals; the
 * monitor made from it has the rolling window nearest the view, and where
 * that window is read by the minute (3 hours or less) the query takes the
 * namespace's Sum. A picked aggregation stays.
 *
 * The Create page is real; its form and the step editor are stand-ins that
 * record the initial values (as in MonitorCreateFromServiceScopedView).
 */

type CapturedFormProps = {
  initialValues: Record<string, unknown>;
};

let capturedForm: CapturedFormProps | null = null;

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Forms/ModelForm",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: (props: CapturedFormProps): React.ReactElement => {
      capturedForm = props;
      return <div data-testid="model-form" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="monitor-steps" />;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<Record<string, unknown>>> => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (): Promise<unknown> => {
        return Promise.resolve({
          doNotAddGlobalProbesByDefaultOnNewMonitors: false,
        });
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

import MonitorCreate, {
  getMetricViewMonitorQueryConfigs,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Create";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import UiAnalytics from "../../../UI/Utils/Analytics";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { MetricExplorerUrlParam } from "../../../Utils/Metrics/MetricExplorerUrl";

const PROJECT_ID: ObjectID = new ObjectID(
  "6b1f0a3c-2d4e-4f5a-9b6c-7d8e9f0a1b2c",
);
const SHOP: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.ServiceBus/namespaces/shop";
const WEB_01: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/web-01";

const MESSAGES_IN: string = "azure_incomingmessages_total";
const MESSAGES_WAITING: string = "azure_activemessages_average";
const VM_CPU: string = "azure_percentage_cpu_average";

const VIEW_END: Date = new Date("2026-11-09T12:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;

function viewOf(minutes: number): { startTime: string; endTime: string } {
  return {
    startTime: new Date(VIEW_END.getTime() - minutes * MINUTE_MS).toISOString(),
    endTime: VIEW_END.toISOString(),
  };
}

interface Created {
  aggregations: Array<unknown>;
  rollingTime: RollingTime | undefined;
}

async function createFromView(data: {
  queries: Array<Record<string, unknown>>;
  minutes?: number | undefined;
}): Promise<Created> {
  const params: Record<string, string> = {
    [MetricExplorerUrlParam.MetricQueries]: JSON.stringify(data.queries),
  };

  if (data.minutes !== undefined) {
    const window: { startTime: string; endTime: string } = viewOf(data.minutes);
    params[MetricExplorerUrlParam.StartTime] = window.startTime;
    params[MetricExplorerUrlParam.EndTime] = window.endTime;
  }

  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((paramName: string): string | null => {
      return params[paramName] || null;
    });

  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <MonitorCreate
        pageRoute={new Route("/dashboard/monitors/create")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedForm).not.toBeNull();
    expect(capturedForm!.initialValues["monitorSteps"]).toBeDefined();
  });

  const step: MonitorStep = MonitorSteps.fromJSON(
    capturedForm!.initialValues["monitorSteps"] as JSONObject,
  ).data!.monitorStepsInstanceArray[0]!;

  return {
    aggregations: step.data!.metricMonitor!.metricViewConfig.queryConfigs.map(
      (query: MetricQueryConfigData): unknown => {
        return query.metricQueryData.filterData.aggegationType;
      },
    ),
    rollingTime: step.data!.metricMonitor!.rollingTime,
  };
}

function onShop(
  metricName: string,
  aggregationType: MetricsAggregationType,
  variable: string = "a",
): Record<string, unknown> {
  return {
    metricName,
    variable,
    attributes: { "azuremonitor.resource_id": SHOP },
    aggregationType,
  };
}

beforeEach(() => {
  capturedForm = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(
    (): void => {},
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Create monitor from a view of a namespace", () => {
  test("messages waiting summed over an hour make a monitor of an hour that sums them", async () => {
    expect(
      await createFromView({
        queries: [onShop(MESSAGES_WAITING, MetricsAggregationType.Sum)],
        minutes: 60,
      }),
    ).toEqual({
      aggregations: [MetricsAggregationType.Sum],
      rollingTime: RollingTime.Past1Hour,
    });
  });

  test("their average over 4 hours makes a monitor of 3 hours, read by the minute, that sums them", async () => {
    expect(
      await createFromView({
        queries: [
          onShop(MESSAGES_WAITING, MetricsAggregationType.Avg),
          onShop(MESSAGES_IN, MetricsAggregationType.Sum, "b"),
        ],
        minutes: 4 * 60,
      }),
    ).toEqual({
      aggregations: [MetricsAggregationType.Sum, MetricsAggregationType.Sum],
      rollingTime: RollingTime.Past3Hours,
    });
  });

  test("over 6 hours, read in 5-minute intervals, messages waiting stay the average and messages in their Sum", async () => {
    expect(
      await createFromView({
        queries: [
          onShop(MESSAGES_WAITING, MetricsAggregationType.Avg),
          onShop(MESSAGES_IN, MetricsAggregationType.Sum, "b"),
        ],
        minutes: 6 * 60,
      }),
    ).toEqual({
      aggregations: [MetricsAggregationType.Avg, MetricsAggregationType.Sum],
      rollingTime: RollingTime.Past6Hours,
    });
  });

  test("an aggregation picked in the view stays, and another resource's metric keeps its own", async () => {
    expect(
      await createFromView({
        queries: [
          onShop(MESSAGES_WAITING, MetricsAggregationType.Max),
          {
            metricName: VM_CPU,
            variable: "b",
            attributes: { "azuremonitor.resource_id": WEB_01 },
            aggregationType: MetricsAggregationType.Avg,
          },
        ],
        minutes: 4 * 60,
      }),
    ).toEqual({
      aggregations: [MetricsAggregationType.Max, MetricsAggregationType.Avg],
      rollingTime: RollingTime.Past3Hours,
    });
  });

  test("a link with no window was made from the explorer's default hour", async () => {
    expect(
      await createFromView({
        queries: [onShop(MESSAGES_WAITING, MetricsAggregationType.Sum)],
      }),
    ).toEqual({
      aggregations: [MetricsAggregationType.Sum],
      rollingTime: RollingTime.Past1Hour,
    });
  });
});

describe("getMetricViewMonitorQueryConfigs", () => {
  function waiting(
    aggregationType: MetricsAggregationType,
  ): MetricQueryConfigData {
    return {
      metricAliasData: {
        metricVariable: "a",
        title: undefined,
        description: undefined,
        legend: undefined,
        legendUnit: undefined,
      },
      metricQueryData: {
        filterData: {
          metricName: MESSAGES_WAITING,
          attributes: { "azuremonitor.resource_id": SHOP },
          aggegationType: aggregationType,
          aggregateBy: {},
        },
      },
    };
  }

  function window(minutes: number): InBetween<Date> {
    return new InBetween<Date>(
      new Date(VIEW_END.getTime() - minutes * MINUTE_MS),
      VIEW_END,
    );
  }

  test("the same intervals hand the very queries back", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      waiting(MetricsAggregationType.Avg),
    ];

    expect(
      getMetricViewMonitorQueryConfigs({
        queryConfigs,
        viewWindow: window(60),
        rollingTime: RollingTime.Past1Hour,
      }),
    ).toBe(queryConfigs);
  });

  test("a monitor read in longer intervals than its view takes their default", () => {
    expect(
      getMetricViewMonitorQueryConfigs({
        queryConfigs: [waiting(MetricsAggregationType.Sum)],
        viewWindow: window(60),
        rollingTime: RollingTime.Past12Hours,
      })[0]!.metricQueryData.filterData.aggegationType,
    ).toBe(MetricsAggregationType.Avg);
  });

  test("no window is the explorer's default hour, read by the minute", () => {
    /*
     * Sum is the hour's default for messages waiting, so it follows the
     * monitor's 5-minute intervals to the average; a view read in 5-minute
     * intervals would have had it picked, and kept it.
     */
    expect(
      getMetricViewMonitorQueryConfigs({
        queryConfigs: [waiting(MetricsAggregationType.Sum)],
        viewWindow: null,
        rollingTime: RollingTime.Past6Hours,
      })[0]!.metricQueryData.filterData.aggegationType,
    ).toBe(MetricsAggregationType.Avg);
    expect(
      getMetricViewMonitorQueryConfigs({
        queryConfigs: [waiting(MetricsAggregationType.Sum)],
        viewWindow: window(6 * 60),
        rollingTime: RollingTime.Past6Hours,
      })[0]!.metricQueryData.filterData.aggegationType,
    ).toBe(MetricsAggregationType.Sum);
  });
});
