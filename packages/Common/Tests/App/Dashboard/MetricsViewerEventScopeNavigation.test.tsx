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
import MetricsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer";
import MetricExplorerUrl, {
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import { buildQueryConfigsFromSerializedQueries } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricConfigReconstruct";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import ObjectID from "../../../Types/ObjectID";
import Includes from "../../../Types/BaseDatabase/Includes";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * Render the real list's row navigation with the data-loading and table
 * chrome replaced. These boundaries do not participate in URL generation.
 */
jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: {
      renderRow: (metric: MetricType) => React.ReactElement;
    }) => {
      return props.renderRow({ name: "cpu.usage" } as MetricType);
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow",
  () => {
    return {
      __esModule: true,
      default: (props: { onClick: () => void }) => {
        return <button onClick={props.onClick}>Open metric</button>;
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

const FIRST_ID: ObjectID = new ObjectID("11111111-0000-4000-8000-000000000001");
const SECOND_ID: ObjectID = new ObjectID(
  "22222222-0000-4000-8000-000000000002",
);
let navigateSpy: ReturnType<typeof jest.spyOn>;

type ViewerProps = React.ComponentProps<typeof MetricsViewer>;

async function openMetric(props: ViewerProps): Promise<MetricQueryConfigData> {
  await act(async () => {
    render(<MetricsViewer {...props} disableUrlSync={true} />);
  });
  fireEvent.click(screen.getByRole("button", { name: "Open metric" }));
  const url: globalThis.URL = new globalThis.URL(
    navigateSpy.mock.calls[0]![0]!.toString(),
  );
  const queries: Array<SerializedMetricQuery> =
    MetricExplorerUrl.parseMetricQueriesParam(
      url.searchParams.get("metricQueries")!,
    );
  expect(queries).toHaveLength(1);
  return buildQueryConfigsFromSerializedQueries(queries)[0]!;
}

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(FIRST_ID);
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("metric-list resource scope on row navigation", () => {
  test("RUM's polymorphic entity id remains RUM when its metric has no attribute filter", async () => {
    const query: MetricQueryConfigData = await openMetric({
      serviceIds: [FIRST_ID],
      scopeEntityType: ServiceType.RealUserMonitor,
    });
    expect(query.eventScope?.["primaryEntityType"]).toBe(
      ServiceType.RealUserMonitor,
    );
    expect((query.eventScope?.["primaryEntityId"] as Includes).values).toEqual([
      FIRST_ID.toString(),
    ]);
    expect(query.metricQueryData.filterData.attributes).toEqual({});
  });

  test("service scope retains every selected service id", async () => {
    const query: MetricQueryConfigData = await openMetric({
      serviceIds: [FIRST_ID, SECOND_ID],
    });
    expect(query.eventScope?.["primaryEntityType"]).toBe(
      ServiceType.OpenTelemetry,
    );
    expect((query.eventScope?.["primaryEntityId"] as Includes).values).toEqual([
      FIRST_ID.toString(),
      SECOND_ID.toString(),
    ]);
  });

  test("Inventory's opaque entity membership survives navigation", async () => {
    const query: MetricQueryConfigData = await openMetric({
      entityKeysFilter: ["inventory-entity"],
    });
    expect((query.eventScope?.["entityKeys"] as Includes).values).toEqual([
      "inventory-entity",
    ]);
    expect(query.metricQueryData.filterData.attributes).toEqual({});
  });

  test.each<Record<string, string>>([
    { "resource.host.name": "Web-01" },
    { "resource.service.name": "Checkout" },
    {
      "resource.k8s.cluster.name": "Prod",
      "resource.k8s.namespace.name": "Apps",
      "resource.k8s.pod.name": "Checkout-1",
    },
  ])(
    "Inventory's natural identity %p survives without losing its original case",
    async (searchAttributes: Record<string, string>) => {
      const query: MetricQueryConfigData = await openMetric({
        entityKeysFilter: ["inventory-entity"],
        entityKeyDisplays: {
          "inventory-entity": {
            displayKey: "Resource",
            displayValue: "Example",
            searchAttributes,
          },
        },
      });
      expect(query.eventScope).toEqual(searchAttributes);
      expect(query.metricQueryData.filterData.attributes).toEqual({});
    },
  );

  test("multiple inventory memberships remain bounded when one natural identity cannot represent them", async () => {
    const query: MetricQueryConfigData = await openMetric({
      entityKeysFilter: ["entity-a", "entity-b"],
      entityKeyDisplays: {
        "entity-a": {
          displayKey: "Host",
          displayValue: "Web-01",
          searchAttributes: { "resource.host.name": "Web-01" },
        },
      },
    });
    expect((query.eventScope?.["entityKeys"] as Includes).values).toEqual([
      "entity-a",
      "entity-b",
    ]);
  });

  test("legacy membership scopes survive without becoming synthetic attribute filters", async () => {
    const query: MetricQueryConfigData = await openMetric({
      entityScope: {
        entityKeys: ["host-entity"],
        attributeKey: "resource.host.name",
        attributeValue: "web-01",
      },
      attributeFilters: { "resource.host.name": "web-01" },
    });
    expect(query.eventScope).toEqual({ "resource.host.name": "web-01" });
    expect(query.metricQueryData.filterData.attributes).toEqual({
      "resource.host.name": "web-01",
    });
  });

  test("ordinary attribute-scoped charts retain their existing scope", async () => {
    const query: MetricQueryConfigData = await openMetric({
      attributeFilters: { "resource.k8s.cluster.name": "prod" },
    });
    expect(query.eventScope).toBeUndefined();
    expect(query.metricQueryData.filterData.attributes).toEqual({
      "resource.k8s.cluster.name": "prod",
    });
  });
});
