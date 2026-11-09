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
 * Issue #6266: a metric view read for some services - the explorer opened
 * from a Metrics monitor limited to them - makes, through "Create monitor
 * from this view", a monitor limited to those services. A Metrics monitor
 * keeps its services on its step and reads every query for them, never a
 * query's own, so the services go onto the step and off the queries.
 *
 * The Create page is real; its form and the step editor are stand-ins that
 * record the initial values (as in MessageQueueMonitorLinkMonitorCreate).
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

import MonitorCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Create";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import UiAnalytics from "../../../UI/Utils/Analytics";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { MetricExplorerUrlParam } from "../../../Utils/Metrics/MetricExplorerUrl";
import MetricQueryServices from "../../../Utils/Metrics/MetricQueryServices";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const API: string = "44444444-4444-4444-8444-444444444444";
const CHECKOUT: string = "55555555-5555-4555-8555-555555555555";

async function createFromView(
  queries: Array<Record<string, unknown>>,
): Promise<MonitorStep> {
  const params: Record<string, string> = {
    [MetricExplorerUrlParam.MetricQueries]: JSON.stringify(queries),
  };
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

  const steps: MonitorSteps = MonitorSteps.fromJSON(
    capturedForm!.initialValues["monitorSteps"] as JSONObject,
  );
  return steps.data!.monitorStepsInstanceArray[0]!;
}

function queriesOf(step: MonitorStep): Array<MetricQueryConfigData> {
  return step.data!.metricMonitor!.metricViewConfig.queryConfigs;
}

function stepServicesOf(step: MonitorStep): Array<string> {
  return MetricQueryServices.normalize(
    step.data!.metricMonitor!.telemetryServiceIds,
  );
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

describe("Create monitor from a view read for some services", () => {
  test("makes a monitor limited to those services, its queries without them", async () => {
    const step: MonitorStep = await createFromView([
      {
        metricName: "http.server.duration",
        variable: "a",
        attributes: { "http.route": "/pay" },
        serviceIds: [API, CHECKOUT],
      },
    ]);

    expect(stepServicesOf(step)).toEqual([API, CHECKOUT]);
    expect(queriesOf(step)).toHaveLength(1);
    expect(MetricQueryServices.getServiceIds(queriesOf(step)[0])).toEqual([]);
    expect(queriesOf(step)[0]!.metricQueryData.filterData.attributes).toEqual({
      "http.route": "/pay",
    });
  });

  test("queries read for other services each: the monitor reads all of them", async () => {
    const step: MonitorStep = await createFromView([
      { metricName: "http.server.duration", variable: "a", serviceIds: [API] },
      {
        metricName: "http.server.requests",
        variable: "b",
        serviceIds: [CHECKOUT, API],
      },
    ]);

    expect(stepServicesOf(step)).toEqual([API, CHECKOUT]);
    for (const query of queriesOf(step)) {
      expect(MetricQueryServices.getServiceIds(query)).toEqual([]);
    }
  });

  test("a view read for every service makes a monitor that reads every service, as before", async () => {
    const step: MonitorStep = await createFromView([
      { metricName: "http.server.duration", variable: "a" },
    ]);

    expect(step.data!.metricMonitor!.telemetryServiceIds).toBeUndefined();
  });
});

describe("taking a view's services for a monitor's step", () => {
  test("all of them once, and the queries without them; what is not a query stays", () => {
    const query: (services?: Array<string>) => MetricQueryConfigData = (
      services?: Array<string>,
    ): MetricQueryConfigData => {
      return {
        metricQueryData: {
          filterData: {
            metricName: "m",
            ...(services ? { telemetryServiceIds: services } : {}),
          } as never,
        },
      };
    };

    const taken: {
      queryConfigs: Array<MetricQueryConfigData>;
      serviceIds: Array<string>;
    } = MetricQueryServices.takeServiceIds([
      query([API]),
      query(),
      null as never,
      query([CHECKOUT, API]),
    ]);

    expect(taken.serviceIds).toEqual([API, CHECKOUT]);
    expect(taken.queryConfigs[2]).toBeNull();
    for (const index of [0, 1, 3]) {
      expect(
        Object.keys(taken.queryConfigs[index]!.metricQueryData.filterData),
      ).not.toContain("telemetryServiceIds");
    }
    expect(MetricQueryServices.takeServiceIds([]).serviceIds).toEqual([]);
  });
});
