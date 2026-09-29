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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A metric row opens the explorer (METRIC_VIEW) carrying the list's
 * attribute scope — but the explorer charts by attributes only, so a list
 * scoped by entity keys alone (a Database page: its endpoints' and members'
 * keys) would open a project-wide chart of the metric. Such a host either
 * takes the click itself (`onMetricClick`) or turns the drill-down off
 * (`disableMetricDrillDown`). Pinned here: the real MetricsViewer's row
 * wiring with the data loading replaced, and the real MetricRow's two forms.
 */

const rowProps: Array<{ onClick?: (() => void) | undefined }> = [];

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: {
      renderRow: (metric: { name: string }) => React.ReactElement;
    }) => {
      return props.renderRow({ name: "db.client.operation.duration" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow",
  () => {
    return {
      __esModule: true,
      default: (props: { onClick?: (() => void) | undefined }) => {
        rowProps.push(props);
        return props.onClick ? (
          <button onClick={props.onClick}>Open metric</button>
        ) : (
          <div>Plain metric</div>
        );
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
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
        return Promise.resolve({ data: [] });
      },
      aggregate: () => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: () => {
        return Promise.resolve({ data: { facets: {} } });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        fetchSparklineAggregates: () => {
          return Promise.resolve(new Map());
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return {};
    },
  };
});

import MetricsViewer, {
  getMetricRowClickHandler,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer";
import { MetricRowProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-0000-4000-8000-000000000001",
);
const DATABASE_KEYS: Array<string> = ["0a1b2c3d4e5f6071", "8a9b0c1d2e3f4051"];

// The module is mocked for the viewer tests above; the row tests need the real one.
const MetricRow: React.FunctionComponent<MetricRowProps> = (
  jest.requireActual(
    "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow",
  ) as { default: React.FunctionComponent<MetricRowProps> }
).default;

let navigateSpy: ReturnType<typeof jest.spyOn>;

type ViewerProps = React.ComponentProps<typeof MetricsViewer>;

async function renderViewer(props: ViewerProps): Promise<void> {
  await act(async () => {
    render(<MetricsViewer {...props} disableUrlSync={true} />);
  });
}

beforeEach(() => {
  rowProps.length = 0;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("getMetricRowClickHandler", () => {
  const METRIC: MetricType = {
    name: "db.client.connection.count",
  } as MetricType;

  test("by default a click navigates with the metric", () => {
    const navigate: MockFunction = getJestMockFunction();
    const handler: (() => void) | undefined = getMetricRowClickHandler({
      metric: METRIC,
      navigate,
    });

    expect(handler).toBeDefined();
    handler!();
    expect(navigate).toHaveBeenCalledWith(METRIC);
  });

  test("a disabled drill-down has no handler at all", () => {
    const navigate: MockFunction = getJestMockFunction();

    expect(
      getMetricRowClickHandler({
        metric: METRIC,
        disableMetricDrillDown: true,
        navigate,
      }),
    ).toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("an explicit false keeps the default navigation", () => {
    const navigate: MockFunction = getJestMockFunction();
    getMetricRowClickHandler({
      metric: METRIC,
      disableMetricDrillDown: false,
      navigate,
    })!();

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  test("the host's handler replaces navigation", () => {
    const navigate: MockFunction = getJestMockFunction();
    const onMetricClick: MockFunction = getJestMockFunction();

    getMetricRowClickHandler({
      metric: METRIC,
      onMetricClick,
      navigate,
    })!();

    expect(onMetricClick).toHaveBeenCalledWith(METRIC);
    expect(navigate).not.toHaveBeenCalled();
  });

  test("the host's handler wins over a disabled drill-down", () => {
    const navigate: MockFunction = getJestMockFunction();
    const onMetricClick: MockFunction = getJestMockFunction();

    getMetricRowClickHandler({
      metric: METRIC,
      onMetricClick,
      disableMetricDrillDown: true,
      navigate,
    })!();

    expect(onMetricClick).toHaveBeenCalledWith(METRIC);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("MetricsViewer row drill-down", () => {
  test("without either prop a row still opens the explorer (unchanged default)", async () => {
    await renderViewer({ entityKeysFilter: DATABASE_KEYS });

    fireEvent.click(screen.getByRole("button", { name: "Open metric" }));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  test("disableMetricDrillDown renders plain rows that never navigate", async () => {
    await renderViewer({
      entityKeysFilter: DATABASE_KEYS,
      disableMetricDrillDown: true,
    });

    expect(screen.getByText("Plain metric")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open metric" }),
    ).not.toBeInTheDocument();
    expect(rowProps.length).toBeGreaterThan(0);
    for (const props of rowProps) {
      expect(props.onClick).toBeUndefined();
    }
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("onMetricClick receives the clicked metric and the explorer is not opened", async () => {
    const onMetricClick: MockFunction = getJestMockFunction();

    await renderViewer({ entityKeysFilter: DATABASE_KEYS, onMetricClick });

    fireEvent.click(screen.getByRole("button", { name: "Open metric" }));

    expect(onMetricClick).toHaveBeenCalledTimes(1);
    expect((onMetricClick.mock.calls[0]![0] as MetricType).name).toBe(
      "db.client.operation.duration",
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe("MetricRow", () => {
  const METRIC: MetricType = {
    name: "postgresql.backends",
    description: "Number of backends",
  } as MetricType;

  test("with a handler it is a button offering Explore", () => {
    const onClick: MockFunction = getJestMockFunction();
    render(<MetricRow metric={METRIC} onClick={onClick} />);

    const row: HTMLElement = screen.getByTestId("metric-row");
    expect(row.tagName).toBe("BUTTON");
    expect(screen.getByText("Explore")).toBeInTheDocument();

    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("without a handler it is a plain entry: no button, no Explore affordance", () => {
    render(<MetricRow metric={METRIC} />);

    const row: HTMLElement = screen.getByTestId("metric-row");
    expect(row.tagName).toBe("DIV");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Explore")).not.toBeInTheDocument();
    // The metric itself still reads the same.
    expect(screen.getByText("postgresql.backends")).toBeInTheDocument();
    expect(screen.getByText("Number of backends")).toBeInTheDocument();
  });
});
