import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";

/*
 * A cloud resource's Overview lists its metrics in a Metrics card, with the
 * same list its Metrics tab shows (#6410). A Service Bus or Event Hubs
 * namespace's list reads each metric whose queues add up as their total,
 * as the tab's does, and every other resource's list reads as it did. This
 * mounts the REAL Overview with its cards replaced by recorders and reads
 * what the Metrics card hands the list.
 */

const mockViewerProps: Array<Record<string, unknown>> = [];
let mockResource: Record<string, unknown> | null = null;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      // As the API does: the row's id and the columns the page selected.
      getItem: (request: {
        select?: Record<string, unknown>;
      }): Promise<unknown> => {
        if (!mockResource) {
          return Promise.resolve(null);
        }
        const selected: Record<string, unknown> = { _id: mockResource["_id"] };
        for (const column of Object.keys(request.select || {})) {
          selected[column] = mockResource[column];
        }
        return Promise.resolve(selected);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0 });
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

function recorder(): {
  __esModule: boolean;
  default: () => ReactElement;
} {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div />;
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        mockViewerProps.push(props);
        return <div data-testid="metrics-viewer" />;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview",
  () => {
    return recorder();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return recorder();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceInventoryCards",
  () => {
    return recorder();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/ResourceSecurityCard",
  () => {
    return recorder();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/NeedsAttentionCard",
  () => {
    return recorder();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceSpendCards",
  () => {
    return recorder();
  },
);

import CloudMonitoredResourceOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/MonitoredResourceOverview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  CLOUD_RESOURCE_AVERAGED_ROW_CAPTION,
  CLOUD_RESOURCE_SUMMED_ROW_CAPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudMonitoredResourceScope";
import { GetMetricRowAggregation } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricRowScope";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "21075038-d9f1-4d3a-b878-f64ae861f7be",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "5b1c9e2a-7d3f-4a6b-8c9d-0e1f2a3b4c5d",
);

async function openOverview(
  provider: string,
  type: string,
  name: string,
): Promise<ReturnType<typeof render>> {
  mockResource = {
    _id: RESOURCE_ID.toString(),
    name: name,
    cloudResourceKind: CloudResourceKind.Resource,
    cloudProvider: provider,
    cloudResourceType: type,
    telemetryAttributes: {
      "azuremonitor.resource_id": `/subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/${type}/${name}`,
    },
  };

  let view: ReturnType<typeof render> | undefined = undefined;
  await act(async () => {
    view = render(
      <CloudMonitoredResourceOverview {...({} as PageComponentProps)} />,
    );
  });

  await waitFor(() => {
    expect(mockViewerProps.length).toBeGreaterThan(0);
  });

  return view!;
}

// What the Metrics card last handed the list.
function viewerProps(): Record<string, unknown> {
  expect(mockViewerProps.length).toBeGreaterThan(0);
  return mockViewerProps[mockViewerProps.length - 1]!;
}

beforeEach(() => {
  mockViewerProps.length = 0;
  mockResource = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(RESOURCE_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Overview's Metrics card", () => {
  test.each([
    ["Microsoft.ServiceBus/namespaces", "azure_activemessages_average"],
    ["Microsoft.EventHub/namespaces", "azure_incomingmessages_total"],
  ])(
    "on a %s resource, the list reads %s as the total of its queues, as the Metrics tab does",
    async (type: string, metricName: string) => {
      await openOverview(CloudProvider.Azure, type, "shop");
      const props: Record<string, unknown> = viewerProps();

      const getRowAggregation: GetMetricRowAggregation = props[
        "getRowAggregation"
      ] as GetMetricRowAggregation;
      expect(typeof getRowAggregation).toBe("function");
      // The card's range, the past hour, is read by the minute.
      const pastHour: InBetween<Date> = new InBetween<Date>(
        new Date("2026-11-09T11:00:00.000Z"),
        new Date("2026-11-09T12:00:00.000Z"),
      );
      expect(getRowAggregation(metricName, pastHour)).toEqual({
        aggregationType: MetricsAggregationType.Sum,
        caption: CLOUD_RESOURCE_SUMMED_ROW_CAPTION,
      });
      expect(
        getRowAggregation("azure_serversendlatency_average", pastHour),
      ).toBe(undefined);
      expect(props["defaultRowValueCaption"]).toBe(
        CLOUD_RESOURCE_AVERAGED_ROW_CAPTION,
      );
      // Embedded: the card never writes the page's URL.
      expect(props["disableUrlSync"]).toBe(true);
    },
  );

  test("a virtual machine's list reads as it did: no aggregation, no caption", async () => {
    await openOverview(
      CloudProvider.Azure,
      "Microsoft.Compute/virtualMachines",
      "web-01",
    );
    const props: Record<string, unknown> = viewerProps();

    expect(props["getRowAggregation"]).toBeUndefined();
    expect(props["defaultRowValueCaption"]).toBeUndefined();
    expect(props["attributeFilters"]).toEqual({
      "azuremonitor.resource_id":
        "/subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/web-01",
    });
  });

  /*
   * The list reads its rows again whenever getRowAggregation changes, so a
   * page that built a new one each render would read every row's aggregate
   * on each of its renders.
   */
  test("the list keeps one aggregation across the page's renders, so its rows are not read again", async () => {
    const view: ReturnType<typeof render> = await openOverview(
      CloudProvider.Azure,
      "Microsoft.ServiceBus/namespaces",
      "shop",
    );
    const rendersBefore: number = mockViewerProps.length;

    await act(async () => {
      view.rerender(
        <CloudMonitoredResourceOverview {...({} as PageComponentProps)} />,
      );
    });

    expect(mockViewerProps.length).toBeGreaterThan(rendersBefore);
    const seen: Set<unknown> = new Set(
      mockViewerProps.map((props: Record<string, unknown>) => {
        return props["getRowAggregation"];
      }),
    );
    expect(seen.size).toBe(1);
  });
});
