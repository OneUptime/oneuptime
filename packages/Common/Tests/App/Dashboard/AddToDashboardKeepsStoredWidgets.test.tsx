import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";

/*
 * Issue #4571, on the metric explorer's Add to Dashboard. It reads the
 * picked dashboard's config, appends a chart and writes the config back. It
 * used to keep the stored config only when it had a top-level `components`;
 * a dashboard stored any other way - the API reference's
 * `{"_type": "DashboardViewConfig", "value": {...}}` envelope, JSON text -
 * failed that check and was replaced by an empty board plus the new chart,
 * so every widget already on it was written away.
 *
 * Now it reads the config the way the dashboard does
 * (StoredDashboardViewConfig): the widgets already there are kept, the chart
 * is appended, and the config is written back in the shape the editor saves.
 * The dashboard picker is stubbed to pick one dashboard; the rest is real.
 */

jest.setTimeout(120000);

const DASHBOARD_ID: string = "44444444-4444-4444-8444-444444444444";
const EXISTING_WIDGET_ID: string = "550e8400-e29b-41d4-a716-446655440000";

const getItemMock: jest.Mock<any> = jest.fn() as jest.Mock<any>;
const updateByIdMock: jest.Mock<any> = jest.fn() as jest.Mock<any>;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (err: Error): string => {
        return err.message;
      },
      getFriendlyErrorMessage: (err: Error): string => {
        return err.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  const objectIdModule: { default: new (id: string) => unknown } =
    jest.requireActual("../../../Types/ObjectID") as {
      default: new (id: string) => unknown;
    };

  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return new objectIdModule.default(
          "55555555-5555-4555-8555-555555555555",
        );
      },
    },
  };
});

// The dashboard picker: one button that picks the dashboard under test.
jest.mock("../../../UI/Components/ModelListModal/ModelListModal", () => {
  const reactModule: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { onSave: (items: Array<unknown>) => void }) => {
      return reactModule.createElement(
        "button",
        {
          type: "button",
          "data-testid": "pick-dashboard",
          onClick: () => {
            props.onSave([{ _id: "44444444-4444-4444-8444-444444444444" }]);
          },
        },
        "Pick",
      );
    },
  };
});

import AddToDashboardModal from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/AddToDashboardModal";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import { JSONObject } from "../../../Types/JSON";

const METRIC_NAME: string = "system.cpu.utilization";

const VIEW: MetricViewData = {
  startAndEndDate: null,
  queryConfigs: [
    {
      metricAliasData: {
        metricVariable: "a",
        title: "CPU",
        description: "",
        legend: "",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: METRIC_NAME,
          aggegationType: "Avg",
        },
      },
    },
  ],
  formulaConfigs: [],
} as unknown as MetricViewData;

const EXISTING_WIDGET: JSONObject = {
  componentId: EXISTING_WIDGET_ID,
  componentType: "Text",
  topInDashboardUnits: 0,
  leftInDashboardUnits: 0,
  widthInDashboardUnits: 6,
  heightInDashboardUnits: 2,
  arguments: { text: "Checkout service" },
};

function storeConfig(dashboardViewConfig: unknown): void {
  getItemMock.mockImplementation(() => {
    return Promise.resolve({
      name: "Checkout on-call",
      dashboardViewConfig: dashboardViewConfig,
    });
  });
}

// What Add to Dashboard wrote, as the JSON the server receives.
async function addTheChart(): Promise<JSONObject> {
  render(<AddToDashboardModal metricViewData={VIEW} onClose={() => {}} />);

  await act(async () => {
    fireEvent.click(screen.getByTestId("pick-dashboard"));
  });

  await waitFor(() => {
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });

  const call: { id: unknown; data: JSONObject } = updateByIdMock.mock
    .calls[0]![0] as { id: unknown; data: JSONObject };

  expect(String(call.id)).toBe(DASHBOARD_ID);

  return JSON.parse(
    JSON.stringify(call.data["dashboardViewConfig"]),
  ) as JSONObject;
}

function typesOf(written: JSONObject): Array<string> {
  return (written["components"] as Array<JSONObject>).map(
    (component: JSONObject) => {
      return String(component["componentType"]);
    },
  );
}

beforeEach(() => {
  updateByIdMock.mockImplementation(() => {
    return Promise.resolve();
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("Add to Dashboard keeps the widgets already on the dashboard (issue #4571)", () => {
  test("a dashboard stored as the API reference's envelope: its widget is kept, the chart appended", async () => {
    storeConfig({
      _type: "DashboardViewConfig",
      value: { components: [EXISTING_WIDGET] },
    });

    const written: JSONObject = await addTheChart();

    expect(written["value"]).toBeUndefined();
    expect(typesOf(written)).toEqual(["Text", "Chart"]);
    expect(
      JSON.stringify((written["components"] as Array<JSONObject>)[0]),
    ).toContain(EXISTING_WIDGET_ID);
    expect(JSON.stringify(written)).toContain(METRIC_NAME);
    expect(await screen.findByText("Chart Added")).toBeInTheDocument();
  });

  test("a dashboard stored as JSON text: its widget is kept", async () => {
    storeConfig(JSON.stringify({ components: [EXISTING_WIDGET] }));

    expect(typesOf(await addTheChart())).toEqual(["Text", "Chart"]);
  });

  test("a widget of a type this version does not draw is kept too", async () => {
    storeConfig({
      components: [{ ...EXISTING_WIDGET, componentType: "HostMetricChart" }],
    });

    expect(typesOf(await addTheChart())).toEqual(["HostMetricChart", "Chart"]);
  });

  test("a dashboard with no widget list gets just the chart", async () => {
    storeConfig({});

    const written: JSONObject = await addTheChart();

    expect(typesOf(written)).toEqual(["Chart"]);
    expect(written["_type"]).toBe("DashboardViewConfig");
  });

  test("the chart lands below the widgets already there, never on top of them", async () => {
    storeConfig({
      _type: "DashboardViewConfig",
      value: {
        components: [
          {
            ...EXISTING_WIDGET,
            widthInDashboardUnits: 12,
            heightInDashboardUnits: 3,
          },
        ],
      },
    });

    const [existing, chart] = (await addTheChart())[
      "components"
    ] as Array<JSONObject>;

    expect(Number(chart!["topInDashboardUnits"])).toBeGreaterThanOrEqual(
      Number(existing!["topInDashboardUnits"]) +
        Number(existing!["heightInDashboardUnits"]),
    );
  });
});
