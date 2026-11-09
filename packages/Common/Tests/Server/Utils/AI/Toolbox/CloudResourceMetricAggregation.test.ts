import "../../../TestingUtils/Init";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import CloudResourceService from "../../../../../Server/Services/CloudResourceService";
import MetricService from "../../../../../Server/Services/MetricService";
import AggregateBy from "../../../../../Server/Types/AnalyticsDatabase/AggregateBy";
import { chooseCloudResourceMetricAggregation } from "../../../../../Server/Utils/AI/Toolbox/CloudResourceMetricAggregation";
import { QueryMetricsTool } from "../../../../../Server/Utils/AI/Toolbox/MetricTools";
import { QueryResourceTelemetryTool } from "../../../../../Server/Utils/AI/Toolbox/ResourceTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { AIResourceType } from "../../../../../Types/AI/AIResourceContext";
import AggregatedModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../../Types/BaseDatabase/AggregationType";
import { getAzureStoredMetricName } from "../../../../../Types/Cloud/CloudKeyMetrics";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "../../../../../Types/Cloud/CloudResourceKind";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * ONEUPTIME AI READS A NAMESPACE'S TOTAL (#6460).
 *
 * query_metrics and query_resource_telemetry read with the average where
 * the model names no aggregation. A Service Bus or Event Hubs namespace's
 * metrics arrive once per queue, topic and event hub (#6415), so their
 * average is the average queue, while the namespace's own number - the
 * one its Metrics tab shows - is their Sum: a count's over any interval,
 * an amount held's while the read is made by the minute. So a read whose
 * attributes name such a namespace takes the catalog's aggregation, and the
 * model is told what it read wherever the two differ: an average it asked
 * for, and an amount held read in longer intervals, which no aggregation of
 * one read adds up.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6b1f0a3c-2d4e-4f5a-9b6c-7d8e9f0a1b2c",
);
const CLOUD_RESOURCE_ID: ObjectID = new ObjectID(
  "9e5f6a7b-8c9d-4e0f-8a1b-3c4d5e6f7a8b",
);

const ROOT_RUN: ToolContext = {
  projectId: PROJECT_ID,
  props: { isRoot: true, tenantId: PROJECT_ID },
};

const SHOP: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.ServiceBus/namespaces/shop";
const WEB_01: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/web-01";

const ON_SHOP: Record<string, string> = { "azuremonitor.resource_id": SHOP };

const MESSAGES_IN: string = getAzureStoredMetricName(
  "IncomingMessages",
  "total",
);
const MESSAGES_WAITING: string = getAzureStoredMetricName(
  "ActiveMessages",
  "average",
);
const SEND_LATENCY: string = getAzureStoredMetricName(
  "ServerSendLatency",
  "average",
);
const VM_CPU: string = getAzureStoredMetricName("Percentage CPU", "average");

const END: string = "2026-11-09T12:00:00.000Z";

// The window's start, so many minutes before END.
function minutesBefore(minutes: number): string {
  return new Date(new Date(END).getTime() - minutes * 60000).toISOString();
}

const SUM_NOTE: string = `Read with Sum: the Service Bus Namespace "shop" reports ${MESSAGES_IN} once per queue, topic and event hub, and their Sum is its own total, the number its Metrics tab shows (their Avg would be the average queue).`;

let aggregate: SpyInstance<typeof MetricService.aggregateBy>;
let requests: Array<AggregateBy<Metric>>;

beforeEach(() => {
  requests = [];
  aggregate = jest
    .spyOn(MetricService, "aggregateBy")
    .mockImplementation(
      async (request: AggregateBy<Metric>): Promise<AggregatedResult> => {
        requests.push(request);
        return {
          data: [
            {
              timestamp: new Date(END),
              value: request.aggregationType === AggregationType.Count ? 3 : 60,
            } as AggregatedModel,
          ],
        };
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("chooseCloudResourceMetricAggregation", () => {
  test("a namespace's count, no aggregation named: Sum, and why", () => {
    expect(
      chooseCloudResourceMetricAggregation({
        requested: undefined,
        metricName: MESSAGES_IN,
        attributes: ON_SHOP,
        aggregationInterval: AggregationInterval.Hour,
      }),
    ).toEqual({ aggregationType: AggregationType.Sum, explanation: SUM_NOTE });
  });

  test("messages waiting, read by the minute: Sum", () => {
    expect(
      chooseCloudResourceMetricAggregation({
        requested: undefined,
        metricName: MESSAGES_WAITING,
        attributes: ON_SHOP,
        aggregationInterval: AggregationInterval.Minute,
      }).aggregationType,
    ).toBe(AggregationType.Sum);
  });

  test("a Sum the model asked for needs no word", () => {
    expect(
      chooseCloudResourceMetricAggregation({
        requested: AggregationType.Sum,
        metricName: MESSAGES_IN,
        attributes: ON_SHOP,
        aggregationInterval: AggregationInterval.Minute,
      }),
    ).toEqual({ aggregationType: AggregationType.Sum, explanation: "" });
  });

  test("an average the model asked for is read, and it is told what it is", () => {
    expect(
      chooseCloudResourceMetricAggregation({
        requested: AggregationType.Avg,
        metricName: MESSAGES_IN,
        attributes: ON_SHOP,
        aggregationInterval: AggregationInterval.Minute,
      }),
    ).toEqual({
      aggregationType: AggregationType.Avg,
      explanation: `Avg is the average of the Service Bus Namespace "shop"'s queues, topics and event hubs, each a series of its own, not the Service Bus Namespace "shop"'s own number: its total, the number its Metrics tab shows, is their Sum - read it with aggregationType Sum.`,
    });
  });

  test("a Max the model asked for is read, and it is told it is taken over the queues", () => {
    expect(
      chooseCloudResourceMetricAggregation({
        requested: AggregationType.Max,
        metricName: MESSAGES_IN,
        attributes: ON_SHOP,
        aggregationInterval: AggregationInterval.Minute,
      }),
    ).toEqual({
      aggregationType: AggregationType.Max,
      explanation: `Max is taken over the Service Bus Namespace "shop"'s queues, topics and event hubs, each a series of its own; the Service Bus Namespace "shop"'s own total, the number its Metrics tab shows, is their Sum.`,
    });
  });

  test("messages waiting in 15-minute intervals keep the average, and the model is told how to read the total", () => {
    expect(
      chooseCloudResourceMetricAggregation({
        requested: undefined,
        metricName: MESSAGES_WAITING,
        attributes: ON_SHOP,
        aggregationInterval: AggregationInterval.FifteenMinutes,
      }),
    ).toEqual({
      aggregationType: AggregationType.Avg,
      explanation: `Avg of the Service Bus Namespace "shop"'s queues, topics and event hubs: ${MESSAGES_WAITING} adds up across them only a minute at a time, and this read's FifteenMinutes intervals hold several minutes of each. For the Service Bus Namespace "shop"'s total, read a window short enough to be read by the minute, with aggregationType Sum.`,
    });
  });

  test("messages waiting read whole with Sum are no amount the namespace held, and the model is told so", () => {
    expect(
      chooseCloudResourceMetricAggregation({
        requested: AggregationType.Sum,
        metricName: MESSAGES_WAITING,
        attributes: ON_SHOP,
        aggregationInterval: AggregationInterval.Total,
      }),
    ).toEqual({
      aggregationType: AggregationType.Sum,
      explanation: `A Sum over the whole window adds up several minutes of every one of the Service Bus Namespace "shop"'s queues, topics and event hubs: no amount the Service Bus Namespace "shop" ever held. Its total is the Sum of a read made by the minute: a shorter window, read as a trend.`,
    });
  });

  test.each([
    ["a namespace's latency", SEND_LATENCY, ON_SHOP],
    ["a virtual machine's CPU", VM_CPU, { "azuremonitor.resource_id": WEB_01 }],
    ["messages in with no resource named", MESSAGES_IN, undefined],
  ])(
    "%s reads as it always did",
    (
      _label: string,
      metricName: string,
      attributes: Record<string, string> | undefined,
    ) => {
      for (const requested of [undefined, AggregationType.P95]) {
        expect(
          chooseCloudResourceMetricAggregation({
            requested,
            metricName,
            attributes,
            aggregationInterval: AggregationInterval.Minute,
          }),
        ).toEqual({
          aggregationType: requested || AggregationType.Avg,
          explanation: "",
        });
      }
    },
  );
});

describe("query_metrics", () => {
  test("messages in of a namespace over a day: read with Sum, and the model is told why", async () => {
    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      {
        metricName: MESSAGES_IN,
        attributes: ON_SHOP,
        startTime: minutesBefore(24 * 60),
        endTime: END,
      },
      ROOT_RUN,
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.aggregationType).toBe(AggregationType.Sum);
    expect(result.dataForLlm).toContain(SUM_NOTE);
    expect(result.citationLabel).toContain(`Sum(${MESSAGES_IN})`);
    expect(result.widget?.title).toBe(`Sum of ${MESSAGES_IN}`);
  });

  test("messages waiting over the past hour, read by the minute: Sum", async () => {
    await QueryMetricsTool.execute(
      {
        metricName: MESSAGES_WAITING,
        attributes: ON_SHOP,
        startTime: minutesBefore(60),
        endTime: END,
      },
      ROOT_RUN,
    );

    expect(requests[0]!.aggregationType).toBe(AggregationType.Sum);
  });

  test("messages waiting over the default day: the average, and how to read the total", async () => {
    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      { metricName: MESSAGES_WAITING, attributes: ON_SHOP },
      ROOT_RUN,
    );

    expect(requests[0]!.aggregationType).toBe(AggregationType.Avg);
    expect(result.dataForLlm).toContain(
      'For the Service Bus Namespace "shop"\'s total, read a window short enough to be read by the minute, with aggregationType Sum.',
    );
  });

  test("the average the model asked for is read, and it is told what it is", async () => {
    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      {
        metricName: MESSAGES_IN,
        attributes: ON_SHOP,
        aggregationType: "Avg",
        startTime: minutesBefore(60),
        endTime: END,
      },
      ROOT_RUN,
    );

    expect(requests[0]!.aggregationType).toBe(AggregationType.Avg);
    expect(result.dataForLlm).toContain("read it with aggregationType Sum.");
  });

  test("a grouped read is judged by its own buckets: half an hour of minutes sums, an hour of 5-minute buckets does not", async () => {
    await QueryMetricsTool.execute(
      {
        metricName: MESSAGES_WAITING,
        attributes: ON_SHOP,
        groupBy: ["metadata_entityname"],
        startTime: minutesBefore(30),
        endTime: END,
      },
      ROOT_RUN,
    );

    expect(requests[0]!.aggregationInterval).toBe(AggregationInterval.Minute);
    expect(requests[0]!.aggregationType).toBe(AggregationType.Sum);

    requests = [];

    await QueryMetricsTool.execute(
      {
        metricName: MESSAGES_WAITING,
        attributes: ON_SHOP,
        groupBy: ["metadata_entityname"],
        startTime: minutesBefore(60),
        endTime: END,
      },
      ROOT_RUN,
    );

    expect(requests[0]!.aggregationInterval).toBe(
      AggregationInterval.FiveMinutes,
    );
    expect(requests[0]!.aggregationType).toBe(AggregationType.Avg);
  });

  test("a metric no resource adds up reads with the average and no word, as before", async () => {
    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      {
        metricName: VM_CPU,
        attributes: { "azuremonitor.resource_id": WEB_01 },
        startTime: minutesBefore(60),
        endTime: END,
      },
      ROOT_RUN,
    );

    expect(requests[0]!.aggregationType).toBe(AggregationType.Avg);
    expect(result.dataForLlm).not.toContain("queues, topics and event hubs");
  });

  test("an aggregation it does not know is still refused", async () => {
    await expect(
      QueryMetricsTool.execute(
        {
          metricName: MESSAGES_IN,
          attributes: ON_SHOP,
          aggregationType: "Median",
        },
        ROOT_RUN,
      ),
    ).rejects.toThrow("Invalid aggregationType: Median");
    expect(aggregate).not.toHaveBeenCalled();
  });

  test("its aggregationType says what the default is", () => {
    const properties: JSONObject = (
      QueryMetricsTool.inputSchema as { properties: JSONObject }
    ).properties;

    expect(
      (properties["aggregationType"] as JSONObject)["description"],
    ).toContain("Sum where attributes name a cloud resource");
  });
});

describe("query_resource_telemetry on a namespace's own page", () => {
  beforeEach(() => {
    jest.spyOn(CloudResourceService, "findBy").mockResolvedValue([
      {
        _id: CLOUD_RESOURCE_ID.toString(),
        name: "shop",
        cloudResourceKind: CloudResourceKind.Resource,
        cloudProvider: CloudProvider.Azure,
        cloudResourceType: "Microsoft.ServiceBus/namespaces",
        telemetryAttributes: ON_SHOP,
        isArchived: false,
        lastSeenAt: new Date(END),
      },
    ] as never);
  });

  function args(extra: JSONObject): JSONObject {
    return {
      resourceType: AIResourceType.CloudResource,
      resourceId: CLOUD_RESOURCE_ID.toString(),
      signal: "metrics",
      startTime: minutesBefore(60),
      endTime: END,
      ...extra,
    };
  }

  test("a summary of messages in is the namespace's total over the window", async () => {
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        args({ metricName: MESSAGES_IN, mode: "summary" }),
        ROOT_RUN,
      );

    expect(requests[0]!.aggregationInterval).toBe(AggregationInterval.Total);
    expect(requests[0]!.aggregationType).toBe(AggregationType.Sum);
    expect((requests[0]!.query as JSONObject)["attributes"]).toEqual(ON_SHOP);
    expect(result.dataForLlm).toContain(SUM_NOTE);
  });

  test("a summary of messages waiting keeps the average, and says how to read the total", async () => {
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        args({ metricName: MESSAGES_WAITING, mode: "summary" }),
        ROOT_RUN,
      );

    expect(requests[0]!.aggregationType).toBe(AggregationType.Avg);
    expect(result.dataForLlm).toContain("this whole-window read holds");
  });

  test("a trend of messages waiting over half an hour is read by the minute, with Sum", async () => {
    await QueryResourceTelemetryTool.execute(
      args({ metricName: MESSAGES_WAITING, startTime: minutesBefore(30) }),
      ROOT_RUN,
    );

    expect(requests[0]!.aggregationInterval).toBe(AggregationInterval.Minute);
    expect(requests[0]!.aggregationType).toBe(AggregationType.Sum);
  });

  test("a latency keeps the average with no word, and the metric names are listed as before", async () => {
    const latency: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        args({ metricName: SEND_LATENCY }),
        ROOT_RUN,
      );

    expect(requests[0]!.aggregationType).toBe(AggregationType.Avg);
    expect(latency.dataForLlm).not.toContain("queues, topics and event hubs");

    requests = [];
    await QueryResourceTelemetryTool.execute(args({}), ROOT_RUN);

    expect(requests[0]!.aggregationType).toBe(AggregationType.Count);
  });
});
