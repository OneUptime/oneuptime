import { describe, expect, test } from "@jest/globals";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { getAzureStoredMetricName } from "../../../Types/Cloud/CloudKeyMetrics";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import MetricQueryCloudAggregation, {
  MetricQueryAggregationRestore,
  MetricQueryRead,
} from "../../../Utils/Metrics/MetricQueryCloudAggregation";

/*
 * WHAT A METRIC QUERY OF A CLOUD RESOURCE ADDS UP TO
 * (Utils/Metrics/MetricQueryCloudAggregation).
 *
 * A Service Bus or Event Hubs namespace's metrics arrive once per queue,
 * topic and event hub since #6415, so the average of a namespace's metric
 * is the average queue and its own number is their Sum: a count's over any
 * interval, an amount held's (messages waiting) only by the minute - the
 * catalog (CloudResourceMetricAggregation) its Metrics tab reads. Held
 * here, for every other reader of a query: which resource a query reads,
 * the intervals a monitor reads it in, the aggregation that follows a
 * query when what it reads changes, the default a monitor written without
 * one takes, and what the data migration moves a stored monitor to.
 */

const SUBSCRIPTION: string = "3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b";

function azureId(type: string, name: string): string {
  return `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/${type}/${name}`;
}

const SERVICE_BUS: string = azureId("Microsoft.ServiceBus/namespaces", "shop");
const EVENT_HUBS: string = azureId(
  "Microsoft.EventHub/namespaces",
  "telemetry",
);
const VIRTUAL_MACHINE: string = azureId(
  "Microsoft.Compute/virtualMachines",
  "web-01",
);
// A queue of the namespace, named by its own id: no namespace.
const QUEUE: string = `${SERVICE_BUS}/queues/orders`;

const RESOURCE_ID_KEY: string = "azuremonitor.resource_id";

// A count per period, an amount held, a latency, and another resource's.
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
const CAPTURE_BACKLOG: string = getAzureStoredMetricName(
  "CaptureBacklog",
  "average",
);
const VM_CPU: string = getAzureStoredMetricName("Percentage CPU", "average");

const ALL_INTERVALS: Array<AggregationInterval> = Object.values(
  AggregationInterval,
) as Array<AggregationInterval>;

function onResource(resourceId: string): JSONObject {
  return { [RESOURCE_ID_KEY]: resourceId };
}

function query(data: {
  metricName: string;
  attributes?: unknown;
  aggregationType?: unknown;
  variable?: string | undefined;
  groupByAttributeKeys?: Array<string> | undefined;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: data.variable ?? "a",
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName,
        attributes: data.attributes === undefined ? {} : data.attributes,
        aggregateBy: {},
        ...(data.aggregationType === undefined
          ? {}
          : { aggegationType: data.aggregationType }),
      },
      ...(data.groupByAttributeKeys
        ? { groupByAttributeKeys: data.groupByAttributeKeys }
        : {}),
    },
  } as unknown as MetricQueryConfigData;
}

function metricMonitor(
  queries: Array<MetricQueryConfigData>,
  data: {
    rollingTime?: RollingTime | undefined;
    aggregatesWholeWindow?: boolean | undefined;
  } = {},
): MonitorStepMetricMonitor {
  return {
    metricViewConfig: { queryConfigs: queries, formulaConfigs: [] },
    rollingTime: data.rollingTime ?? RollingTime.Past1Minute,
    ...(data.aggregatesWholeWindow ? { aggregatesWholeWindow: true } : {}),
  };
}

function aggregationOf(query: MetricQueryConfigData | undefined): unknown {
  return (
    query?.metricQueryData.filterData as unknown as Record<string, unknown>
  )["aggegationType"];
}

function aggregationsOf(monitor: MonitorStepMetricMonitor): Array<unknown> {
  return monitor.metricViewConfig.queryConfigs.map(aggregationOf);
}

function read(
  metricName: unknown,
  attributes: unknown,
  aggregationInterval: AggregationInterval,
): MetricQueryRead {
  return { metricName, attributes, aggregationInterval };
}

function metricStep(monitor: MonitorStepMetricMonitor): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "shop namespace",
    monitorType: MonitorType.Metrics,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });

  step.setMetricMonitor(monitor);

  return step;
}

function stepsOf(steps: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray(steps);
  monitorSteps.setDefaultMonitorStatusId(ObjectID.generate());

  return monitorSteps;
}

// Monitor steps as the database holds them, and hands them back.
function storedJSON(monitorSteps: MonitorSteps): JSONObject {
  return JSON.parse(JSON.stringify(monitorSteps.toJSON())) as JSONObject;
}

describe("getCloudResource", () => {
  test("names a Service Bus namespace by its own id", () => {
    expect(
      MetricQueryCloudAggregation.getCloudResource(onResource(SERVICE_BUS)),
    ).toEqual({
      provider: CloudProvider.Azure,
      type: "Microsoft.ServiceBus/namespaces",
      name: "shop",
    });
  });

  test("names an Event Hubs namespace, among other attributes", () => {
    expect(
      MetricQueryCloudAggregation.getCloudResource({
        ...onResource(EVENT_HUBS),
        metadata_entityname: "clicks",
      }),
    ).toEqual({
      provider: CloudProvider.Azure,
      type: "Microsoft.EventHub/namespaces",
      name: "telemetry",
    });
  });

  test("spells the type as the catalog does, in whatever case Azure wrote it", () => {
    expect(
      MetricQueryCloudAggregation.getCloudResource(
        onResource(
          azureId("Microsoft.ServiceBus/Namespaces", "shop").toLowerCase(),
        ),
      )?.type,
    ).toBe("Microsoft.ServiceBus/namespaces");
  });

  test("a queue's own id names the queue, not its namespace", () => {
    expect(
      MetricQueryCloudAggregation.getCloudResource(onResource(QUEUE)),
    ).toEqual({
      provider: CloudProvider.Azure,
      type: "Microsoft.ServiceBus/namespaces/queues",
      name: "shop/orders",
    });
  });

  test.each([
    ["no attributes", {}],
    ["nothing at all", undefined],
    ["null", null],
    ["a list of attributes", [onResource(SERVICE_BUS)]],
    ["the id in a list", { [RESOURCE_ID_KEY]: [SERVICE_BUS] }],
    [
      "the id as a search",
      { [RESOURCE_ID_KEY]: { _type: "Search", value: "shop" } },
    ],
    ["an empty id", { [RESOURCE_ID_KEY]: "" }],
    ["a blank id", { [RESOURCE_ID_KEY]: "   " }],
    ["a number", { [RESOURCE_ID_KEY]: 7 }],
    ["text that is no id", { [RESOURCE_ID_KEY]: "shop" }],
    [
      "a CloudWatch resource",
      {
        "resource.cloud.provider": "aws",
        "Dimensions.QueueName": "orders",
      },
    ],
  ])("names none for %s", (_label: string, attributes: unknown) => {
    expect(
      MetricQueryCloudAggregation.getCloudResource(attributes),
    ).toBeUndefined();
  });
});

describe("getCatalogAggregation and getDefaultAggregation", () => {
  test.each(ALL_INTERVALS)(
    "a namespace's count is its Sum, in %s intervals",
    (interval: AggregationInterval) => {
      for (const resourceId of [SERVICE_BUS, EVENT_HUBS]) {
        const countRead: MetricQueryRead = read(
          MESSAGES_IN,
          onResource(resourceId),
          interval,
        );

        expect(
          MetricQueryCloudAggregation.getCatalogAggregation(countRead),
        ).toBe(AggregationType.Sum);
        expect(
          MetricQueryCloudAggregation.getDefaultAggregation(countRead),
        ).toBe(AggregationType.Sum);
      }
    },
  );

  test("an amount held is the namespace's Sum by the minute", () => {
    expect(
      MetricQueryCloudAggregation.getDefaultAggregation(
        read(
          MESSAGES_WAITING,
          onResource(SERVICE_BUS),
          AggregationInterval.Minute,
        ),
      ),
    ).toBe(AggregationType.Sum);
    expect(
      MetricQueryCloudAggregation.getDefaultAggregation(
        read(
          CAPTURE_BACKLOG,
          onResource(EVENT_HUBS),
          AggregationInterval.Minute,
        ),
      ),
    ).toBe(AggregationType.Sum);
  });

  test.each(
    ALL_INTERVALS.filter((interval: AggregationInterval): boolean => {
      return interval !== AggregationInterval.Minute;
    }),
  )(
    "an amount held keeps the average in %s intervals, which hold several minutes of each queue",
    (interval: AggregationInterval) => {
      const amountRead: MetricQueryRead = read(
        MESSAGES_WAITING,
        onResource(SERVICE_BUS),
        interval,
      );

      expect(
        MetricQueryCloudAggregation.getCatalogAggregation(amountRead),
      ).toBeUndefined();
      expect(
        MetricQueryCloudAggregation.getDefaultAggregation(amountRead),
      ).toBe(AggregationType.Avg);
    },
  );

  test.each([
    ["a namespace's latency", SEND_LATENCY, onResource(SERVICE_BUS)],
    ["a virtual machine's CPU", VM_CPU, onResource(VIRTUAL_MACHINE)],
    ["a queue's own messages in", MESSAGES_IN, onResource(QUEUE)],
    ["messages in with no resource named", MESSAGES_IN, {}],
    ["no metric name", undefined, onResource(SERVICE_BUS)],
    ["a metric name that is no text", 12, onResource(SERVICE_BUS)],
  ])(
    "%s keeps the average",
    (_label: string, metricName: unknown, attributes: unknown) => {
      const otherRead: MetricQueryRead = read(
        metricName,
        attributes,
        AggregationInterval.Minute,
      );

      expect(
        MetricQueryCloudAggregation.getCatalogAggregation(otherRead),
      ).toBeUndefined();
      expect(MetricQueryCloudAggregation.getDefaultAggregation(otherRead)).toBe(
        AggregationType.Avg,
      );
    },
  );
});

describe("getMetricMonitorReadInterval", () => {
  test.each([
    [RollingTime.Past1Minute, AggregationInterval.Minute],
    [RollingTime.Past15Minutes, AggregationInterval.Minute],
    [RollingTime.Past1Hour, AggregationInterval.Minute],
    [RollingTime.Past3Hours, AggregationInterval.Minute],
    [RollingTime.Past6Hours, AggregationInterval.FiveMinutes],
    [RollingTime.Past12Hours, AggregationInterval.FiveMinutes],
    [RollingTime.Past1Hours, AggregationInterval.FifteenMinutes],
    [RollingTime.Past2Days, AggregationInterval.ThirtyMinutes],
    [RollingTime.Past7Days, AggregationInterval.Hour],
  ])(
    "a window of %s is read in %s intervals, as the worker reads it",
    (rollingTime: RollingTime, interval: AggregationInterval) => {
      expect(
        MetricQueryCloudAggregation.getMetricMonitorReadInterval(
          metricMonitor([], { rollingTime }),
        ),
      ).toBe(interval);
    },
  );

  test("a step that reads its window whole reads it as one interval, however long", () => {
    for (const rollingTime of [
      RollingTime.Past15Minutes,
      RollingTime.Past2Days,
    ]) {
      expect(
        MetricQueryCloudAggregation.getMetricMonitorReadInterval(
          metricMonitor([], { rollingTime, aggregatesWholeWindow: true }),
        ),
      ).toBe(AggregationInterval.Total);
    }
  });

  test.each([
    ["no window", { metricViewConfig: { queryConfigs: [] } }],
    ["a window the product has no name for", { rollingTime: "Past forever" }],
    ["no step", undefined],
    ["null", null],
  ])("%s reads the worker's minute", (_label: string, monitor: unknown) => {
    expect(
      MetricQueryCloudAggregation.getMetricMonitorReadInterval(monitor),
    ).toBe(AggregationInterval.Minute);
  });
});

describe("getFollowedAggregation", () => {
  const MINUTE: AggregationInterval = AggregationInterval.Minute;

  test("the average of messages in follows to Sum once the filter names the namespace", () => {
    for (const unset of [AggregationType.Avg, undefined, null, ""]) {
      expect(
        MetricQueryCloudAggregation.getFollowedAggregation({
          aggregationType: unset,
          before: read(MESSAGES_IN, {}, MINUTE),
          after: read(MESSAGES_IN, onResource(SERVICE_BUS), MINUTE),
        }),
      ).toBe(AggregationType.Sum);
    }
  });

  test("a namespace's Sum follows back to the average once the metric is its latency", () => {
    expect(
      MetricQueryCloudAggregation.getFollowedAggregation({
        aggregationType: AggregationType.Sum,
        before: read(MESSAGES_IN, onResource(SERVICE_BUS), MINUTE),
        after: read(SEND_LATENCY, onResource(SERVICE_BUS), MINUTE),
      }),
    ).toBe(AggregationType.Avg);
  });

  test("messages waiting go back to the average past a minute, and to Sum within it", () => {
    expect(
      MetricQueryCloudAggregation.getFollowedAggregation({
        aggregationType: AggregationType.Sum,
        before: read(MESSAGES_WAITING, onResource(SERVICE_BUS), MINUTE),
        after: read(
          MESSAGES_WAITING,
          onResource(SERVICE_BUS),
          AggregationInterval.FiveMinutes,
        ),
      }),
    ).toBe(AggregationType.Avg);
    expect(
      MetricQueryCloudAggregation.getFollowedAggregation({
        aggregationType: AggregationType.Avg,
        before: read(
          MESSAGES_WAITING,
          onResource(SERVICE_BUS),
          AggregationInterval.FiveMinutes,
        ),
        after: read(MESSAGES_WAITING, onResource(SERVICE_BUS), MINUTE),
      }),
    ).toBe(AggregationType.Sum);
  });

  test.each([
    AggregationType.Max,
    AggregationType.Min,
    AggregationType.Count,
    AggregationType.P95,
    AggregationType.P99,
  ])("a %s someone picked stays", (picked: AggregationType) => {
    expect(
      MetricQueryCloudAggregation.getFollowedAggregation({
        aggregationType: picked,
        before: read(MESSAGES_IN, {}, MINUTE),
        after: read(MESSAGES_IN, onResource(SERVICE_BUS), MINUTE),
      }),
    ).toBe(picked);
  });

  test("a Sum picked on a metric that does not add up stays, wherever the query goes", () => {
    expect(
      MetricQueryCloudAggregation.getFollowedAggregation({
        aggregationType: AggregationType.Sum,
        before: read(VM_CPU, onResource(VIRTUAL_MACHINE), MINUTE),
        after: read(SEND_LATENCY, onResource(SERVICE_BUS), MINUTE),
      }),
    ).toBe(AggregationType.Sum);
  });

  test("an average someone kept on a namespace's count, where Sum was the default, stays", () => {
    expect(
      MetricQueryCloudAggregation.getFollowedAggregation({
        aggregationType: AggregationType.Avg,
        before: read(MESSAGES_IN, onResource(SERVICE_BUS), MINUTE),
        after: read(MESSAGES_IN, onResource(EVENT_HUBS), MINUTE),
      }),
    ).toBe(AggregationType.Avg);
  });

  test("an aggregation the product does not know is no answer", () => {
    expect(
      MetricQueryCloudAggregation.getFollowedAggregation({
        aggregationType: "Median",
        before: read(MESSAGES_IN, {}, MINUTE),
        after: read(MESSAGES_IN, onResource(SERVICE_BUS), MINUTE),
      }),
    ).toBeUndefined();
  });
});

describe("withFollowedAggregation: the query editor", () => {
  const MINUTE: AggregationInterval = AggregationInterval.Minute;

  test("picking messages in on the namespace, the aggregation untouched, reads its Sum", () => {
    const previous: MetricQueryConfigData = query({
      metricName: SEND_LATENCY,
      attributes: onResource(SERVICE_BUS),
      aggregationType: AggregationType.Avg,
    });
    const next: MetricQueryConfigData = query({
      metricName: MESSAGES_IN,
      attributes: onResource(SERVICE_BUS),
      aggregationType: AggregationType.Avg,
    });
    const followed: MetricQueryConfigData =
      MetricQueryCloudAggregation.withFollowedAggregation({
        previous,
        next,
        aggregationInterval: MINUTE,
      });

    expect(aggregationOf(followed)).toBe(AggregationType.Sum);
    // A copy: what the editor handed over is as it was.
    expect(aggregationOf(next)).toBe(AggregationType.Avg);
    expect(followed.metricAliasData).toEqual(next.metricAliasData);
    expect(followed.metricQueryData.filterData.metricName).toBe(MESSAGES_IN);
  });

  test("filtering messages in to the namespace reads its Sum", () => {
    expect(
      aggregationOf(
        MetricQueryCloudAggregation.withFollowedAggregation({
          previous: query({ metricName: MESSAGES_IN }),
          next: query({
            metricName: MESSAGES_IN,
            attributes: onResource(SERVICE_BUS),
          }),
          aggregationInterval: MINUTE,
        }),
      ),
    ).toBe(AggregationType.Sum);
  });

  test("messages waiting on a chart of 5-minute intervals keep the average", () => {
    const next: MetricQueryConfigData = query({
      metricName: MESSAGES_WAITING,
      attributes: onResource(SERVICE_BUS),
      aggregationType: AggregationType.Avg,
    });

    expect(
      MetricQueryCloudAggregation.withFollowedAggregation({
        previous: query({
          metricName: SEND_LATENCY,
          attributes: onResource(SERVICE_BUS),
          aggregationType: AggregationType.Avg,
        }),
        next,
        aggregationInterval: AggregationInterval.FiveMinutes,
      }),
    ).toBe(next);
  });

  test("an edit of the aggregation itself is the reader's pick", () => {
    const next: MetricQueryConfigData = query({
      metricName: MESSAGES_IN,
      attributes: onResource(SERVICE_BUS),
      aggregationType: AggregationType.Avg,
    });

    expect(
      MetricQueryCloudAggregation.withFollowedAggregation({
        previous: query({
          metricName: MESSAGES_IN,
          attributes: onResource(SERVICE_BUS),
          aggregationType: AggregationType.Sum,
        }),
        next,
        aggregationInterval: MINUTE,
      }),
    ).toBe(next);
  });

  test("a metric and an aggregation changed in one edit keep the aggregation picked", () => {
    const next: MetricQueryConfigData = query({
      metricName: MESSAGES_IN,
      attributes: onResource(SERVICE_BUS),
      aggregationType: AggregationType.Max,
    });

    expect(
      MetricQueryCloudAggregation.withFollowedAggregation({
        previous: query({
          metricName: SEND_LATENCY,
          attributes: onResource(SERVICE_BUS),
        }),
        next,
        aggregationInterval: MINUTE,
      }),
    ).toBe(next);
  });

  test("an edit of anything else leaves the query as it is", () => {
    const previous: MetricQueryConfigData = query({
      metricName: MESSAGES_IN,
      attributes: onResource(SERVICE_BUS),
      aggregationType: AggregationType.Avg,
    });
    const next: MetricQueryConfigData = {
      ...previous,
      metricAliasData: {
        ...previous.metricAliasData!,
        title: "Orders in",
      },
    };

    expect(
      MetricQueryCloudAggregation.withFollowedAggregation({
        previous,
        next,
        aggregationInterval: MINUTE,
      }),
    ).toBe(next);
  });

  test("a new query, or a chart with no intervals yet, is left as it is", () => {
    const next: MetricQueryConfigData = query({
      metricName: MESSAGES_IN,
      attributes: onResource(SERVICE_BUS),
    });

    expect(
      MetricQueryCloudAggregation.withFollowedAggregation({
        previous: undefined,
        next,
        aggregationInterval: MINUTE,
      }),
    ).toBe(next);
    expect(
      MetricQueryCloudAggregation.withFollowedAggregation({
        previous: query({ metricName: MESSAGES_IN }),
        next,
        aggregationInterval: undefined,
      }),
    ).toBe(next);
  });
});

describe("withQueriesFollowingInterval: a window changed, a view made a monitor", () => {
  function queries(): Array<MetricQueryConfigData> {
    return [
      query({
        variable: "count",
        metricName: MESSAGES_IN,
        attributes: onResource(SERVICE_BUS),
        aggregationType: AggregationType.Sum,
      }),
      query({
        variable: "waiting",
        metricName: MESSAGES_WAITING,
        attributes: onResource(SERVICE_BUS),
        aggregationType: AggregationType.Sum,
      }),
      query({
        variable: "latency",
        metricName: SEND_LATENCY,
        attributes: onResource(SERVICE_BUS),
        aggregationType: AggregationType.Avg,
      }),
      query({
        variable: "largest",
        metricName: MESSAGES_WAITING,
        attributes: onResource(SERVICE_BUS),
        aggregationType: AggregationType.Max,
      }),
      query({
        variable: "cpu",
        metricName: VM_CPU,
        attributes: onResource(VIRTUAL_MACHINE),
        aggregationType: AggregationType.Avg,
      }),
    ];
  }

  test("the same intervals change nothing", () => {
    const configs: Array<MetricQueryConfigData> = queries();

    expect(
      MetricQueryCloudAggregation.withQueriesFollowingInterval({
        queryConfigs: configs,
        from: AggregationInterval.Minute,
        to: AggregationInterval.Minute,
      }),
    ).toBe(configs);
  });

  test("past a minute only the amount held the namespace summed goes back to the average", () => {
    const configs: Array<MetricQueryConfigData> = queries();
    const followed: Array<MetricQueryConfigData> =
      MetricQueryCloudAggregation.withQueriesFollowingInterval({
        queryConfigs: configs,
        from: AggregationInterval.Minute,
        to: AggregationInterval.FiveMinutes,
      });

    expect(followed.map(aggregationOf)).toEqual([
      AggregationType.Sum,
      AggregationType.Avg,
      AggregationType.Avg,
      AggregationType.Max,
      AggregationType.Avg,
    ]);
    // The queries that keep theirs are the very same; nothing was written on.
    expect(followed[0]).toBe(configs[0]);
    expect(aggregationOf(configs[1])).toBe(AggregationType.Sum);
  });

  test("read whole, the amount held goes back to the average and the count stays summed", () => {
    expect(
      MetricQueryCloudAggregation.withQueriesFollowingInterval({
        queryConfigs: queries(),
        from: AggregationInterval.Minute,
        to: AggregationInterval.Total,
      }).map(aggregationOf),
    ).toEqual([
      AggregationType.Sum,
      AggregationType.Avg,
      AggregationType.Avg,
      AggregationType.Max,
      AggregationType.Avg,
    ]);
  });

  test("back within a minute, the average of messages waiting is summed again", () => {
    expect(
      aggregationOf(
        MetricQueryCloudAggregation.withQueriesFollowingInterval({
          queryConfigs: [
            query({
              metricName: MESSAGES_WAITING,
              attributes: onResource(SERVICE_BUS),
              aggregationType: AggregationType.Avg,
            }),
          ],
          from: AggregationInterval.FiveMinutes,
          to: AggregationInterval.Minute,
        })[0],
      ),
    ).toBe(AggregationType.Sum);
  });

  test("a query with no filter is passed along", () => {
    const bare: MetricQueryConfigData = {
      metricQueryData: {},
    } as unknown as MetricQueryConfigData;

    expect(
      MetricQueryCloudAggregation.withQueriesFollowingInterval({
        queryConfigs: [bare],
        from: AggregationInterval.Minute,
        to: AggregationInterval.Hour,
      })[0],
    ).toBe(bare);
  });
});

describe("fillMissingAggregations: a monitor written without an aggregation", () => {
  test("a namespace's count with none reads its Sum", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor([
      query({ metricName: MESSAGES_IN, attributes: onResource(SERVICE_BUS) }),
    ]);

    expect(MetricQueryCloudAggregation.fillMissingAggregations(monitor)).toBe(
      1,
    );
    expect(aggregationsOf(monitor)).toEqual([AggregationType.Sum]);
  });

  test("an amount held is summed in a window of up to 3 hours, and left to the average past it", () => {
    const within: MonitorStepMetricMonitor = metricMonitor(
      [
        query({
          metricName: MESSAGES_WAITING,
          attributes: onResource(SERVICE_BUS),
        }),
      ],
      { rollingTime: RollingTime.Past3Hours },
    );
    const past: MonitorStepMetricMonitor = metricMonitor(
      [
        query({
          metricName: MESSAGES_WAITING,
          attributes: onResource(SERVICE_BUS),
        }),
      ],
      { rollingTime: RollingTime.Past6Hours },
    );

    expect(MetricQueryCloudAggregation.fillMissingAggregations(within)).toBe(1);
    expect(aggregationsOf(within)).toEqual([AggregationType.Sum]);
    expect(MetricQueryCloudAggregation.fillMissingAggregations(past)).toBe(0);
    expect(aggregationsOf(past)).toEqual([undefined]);
  });

  test("read whole, a count is summed and an amount held is not", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor(
      [
        query({ metricName: MESSAGES_IN, attributes: onResource(SERVICE_BUS) }),
        query({
          metricName: MESSAGES_WAITING,
          attributes: onResource(SERVICE_BUS),
          variable: "b",
        }),
      ],
      { rollingTime: RollingTime.Past15Minutes, aggregatesWholeWindow: true },
    );

    expect(MetricQueryCloudAggregation.fillMissingAggregations(monitor)).toBe(
      1,
    );
    expect(aggregationsOf(monitor)).toEqual([AggregationType.Sum, undefined]);
  });

  test("null and an empty text are no aggregation", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor([
      query({
        metricName: MESSAGES_IN,
        attributes: onResource(SERVICE_BUS),
        aggregationType: null,
      }),
      query({
        metricName: MESSAGES_IN,
        attributes: onResource(EVENT_HUBS),
        aggregationType: "",
        variable: "b",
      }),
    ]);

    expect(MetricQueryCloudAggregation.fillMissingAggregations(monitor)).toBe(
      2,
    );
    expect(aggregationsOf(monitor)).toEqual([
      AggregationType.Sum,
      AggregationType.Sum,
    ]);
  });

  test("an aggregation of its own is kept, the average included", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor([
      query({
        metricName: MESSAGES_IN,
        attributes: onResource(SERVICE_BUS),
        aggregationType: AggregationType.Avg,
      }),
      query({
        metricName: MESSAGES_WAITING,
        attributes: onResource(SERVICE_BUS),
        aggregationType: AggregationType.Max,
        variable: "b",
      }),
    ]);

    expect(MetricQueryCloudAggregation.fillMissingAggregations(monitor)).toBe(
      0,
    );
    expect(aggregationsOf(monitor)).toEqual([
      AggregationType.Avg,
      AggregationType.Max,
    ]);
  });

  test("a latency, another resource's metric and a queue's own are left to the average", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor([
      query({ metricName: SEND_LATENCY, attributes: onResource(SERVICE_BUS) }),
      query({
        metricName: VM_CPU,
        attributes: onResource(VIRTUAL_MACHINE),
        variable: "b",
      }),
      query({
        metricName: MESSAGES_IN,
        attributes: onResource(QUEUE),
        variable: "c",
      }),
    ]);

    expect(MetricQueryCloudAggregation.fillMissingAggregations(monitor)).toBe(
      0,
    );
    expect(aggregationsOf(monitor)).toEqual([undefined, undefined, undefined]);
  });

  test("a step with no queries, or none it can read, is no trouble", () => {
    for (const monitor of [
      undefined,
      null,
      {},
      { metricViewConfig: null },
      { metricViewConfig: { queryConfigs: null } },
      { metricViewConfig: { queryConfigs: [null, { metricQueryData: {} }] } },
    ]) {
      expect(MetricQueryCloudAggregation.fillMissingAggregations(monitor)).toBe(
        0,
      );
    }
  });

  test("on monitor steps as a write hands them over, every metric step is filled", () => {
    const first: MonitorStep = metricStep(
      metricMonitor([
        query({ metricName: MESSAGES_IN, attributes: onResource(SERVICE_BUS) }),
      ]),
    );
    const notMetrics: MonitorStep = metricStep(metricMonitor([]));
    notMetrics.data!.metricMonitor = undefined;
    const second: MonitorStep = metricStep(
      metricMonitor([
        query({
          metricName: MESSAGES_WAITING,
          attributes: onResource(SERVICE_BUS),
        }),
        query({
          metricName: SEND_LATENCY,
          attributes: onResource(SERVICE_BUS),
          variable: "b",
        }),
      ]),
    );
    const monitorSteps: MonitorSteps = stepsOf([first, notMetrics, second]);

    expect(
      MetricQueryCloudAggregation.fillMissingAggregationsOfSteps(monitorSteps),
    ).toBe(2);

    // What is stored, read back.
    const stored: MonitorSteps = MonitorSteps.fromJSON(
      storedJSON(monitorSteps),
    );

    expect(
      stored.data!.monitorStepsInstanceArray.map((step: MonitorStep) => {
        return step.data?.metricMonitor
          ? aggregationsOf(step.data.metricMonitor)
          : null;
      }),
    ).toEqual([[AggregationType.Sum], null, [AggregationType.Sum, undefined]]);
  });

  test("no monitor steps fill nothing", () => {
    expect(
      MetricQueryCloudAggregation.fillMissingAggregationsOfSteps(undefined),
    ).toBe(0);
    expect(
      MetricQueryCloudAggregation.fillMissingAggregationsOfSteps(null),
    ).toBe(0);
    expect(
      MetricQueryCloudAggregation.fillMissingAggregationsOfSteps({ data: {} }),
    ).toBe(0);
  });
});

describe("restoreResourceTotals: a stored monitor that read the namespace's number", () => {
  test("the average of messages in, by the minute, is moved to Sum, and says so", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor(
      [
        query({
          variable: "incoming",
          metricName: MESSAGES_IN,
          attributes: onResource(SERVICE_BUS),
          aggregationType: AggregationType.Avg,
        }),
      ],
      { rollingTime: RollingTime.Past15Minutes },
    );

    expect(MetricQueryCloudAggregation.restoreResourceTotals(monitor)).toEqual([
      {
        metricVariable: "incoming",
        metricName: MESSAGES_IN,
        resource: {
          provider: CloudProvider.Azure,
          type: "Microsoft.ServiceBus/namespaces",
          name: "shop",
        },
        from: AggregationType.Avg,
        to: AggregationType.Sum,
      },
    ]);
    expect(aggregationsOf(monitor)).toEqual([AggregationType.Sum]);
  });

  test("one stored with no aggregation, which read the average, is moved too", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor([
      query({
        metricName: CAPTURE_BACKLOG,
        attributes: onResource(EVENT_HUBS),
      }),
    ]);
    const restored: Array<MetricQueryAggregationRestore> =
      MetricQueryCloudAggregation.restoreResourceTotals(monitor);

    expect(restored).toHaveLength(1);
    expect(restored[0]?.from).toBeUndefined();
    expect(restored[0]?.to).toBe(AggregationType.Sum);
    expect(aggregationsOf(monitor)).toEqual([AggregationType.Sum]);
  });

  test("messages waiting over 3 hours, read by the minute, are moved to Sum", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor(
      [
        query({
          metricName: MESSAGES_WAITING,
          attributes: onResource(SERVICE_BUS),
          aggregationType: AggregationType.Avg,
        }),
      ],
      { rollingTime: RollingTime.Past3Hours },
    );

    expect(
      MetricQueryCloudAggregation.restoreResourceTotals(monitor),
    ).toHaveLength(1);
    expect(aggregationsOf(monitor)).toEqual([AggregationType.Sum]);
  });

  test("a step read in longer intervals has no aggregation that reads its old number, and is left", () => {
    for (const rollingTime of [
      RollingTime.Past6Hours,
      RollingTime.Past1Hours,
    ]) {
      const monitor: MonitorStepMetricMonitor = metricMonitor(
        [
          query({
            metricName: MESSAGES_IN,
            attributes: onResource(SERVICE_BUS),
            aggregationType: AggregationType.Avg,
          }),
          query({
            metricName: MESSAGES_WAITING,
            attributes: onResource(SERVICE_BUS),
            aggregationType: AggregationType.Avg,
            variable: "b",
          }),
        ],
        { rollingTime },
      );

      expect(
        MetricQueryCloudAggregation.restoreResourceTotals(monitor),
      ).toEqual([]);
      expect(aggregationsOf(monitor)).toEqual([
        AggregationType.Avg,
        AggregationType.Avg,
      ]);
    }
  });

  test("a step read whole is left", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor(
      [
        query({
          metricName: MESSAGES_IN,
          attributes: onResource(SERVICE_BUS),
          aggregationType: AggregationType.Avg,
        }),
      ],
      { rollingTime: RollingTime.Past15Minutes, aggregatesWholeWindow: true },
    );

    expect(MetricQueryCloudAggregation.restoreResourceTotals(monitor)).toEqual(
      [],
    );
    expect(aggregationsOf(monitor)).toEqual([AggregationType.Avg]);
  });

  test.each([
    AggregationType.Sum,
    AggregationType.Max,
    AggregationType.Min,
    AggregationType.Count,
    AggregationType.P50,
    AggregationType.P99,
  ])("an aggregation of its own (%s) is left", (own: AggregationType) => {
    const monitor: MonitorStepMetricMonitor = metricMonitor([
      query({
        metricName: MESSAGES_WAITING,
        attributes: onResource(SERVICE_BUS),
        aggregationType: own,
      }),
    ]);

    expect(MetricQueryCloudAggregation.restoreResourceTotals(monitor)).toEqual(
      [],
    );
    expect(aggregationsOf(monitor)).toEqual([own]);
  });

  test("a latency, another resource's metric, a queue's own and an unnamed resource are left", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor([
      query({
        metricName: SEND_LATENCY,
        attributes: onResource(SERVICE_BUS),
        aggregationType: AggregationType.Avg,
      }),
      query({
        metricName: VM_CPU,
        attributes: onResource(VIRTUAL_MACHINE),
        aggregationType: AggregationType.Avg,
        variable: "b",
      }),
      query({
        metricName: MESSAGES_IN,
        attributes: onResource(QUEUE),
        aggregationType: AggregationType.Avg,
        variable: "c",
      }),
      query({
        metricName: MESSAGES_IN,
        attributes: { [RESOURCE_ID_KEY]: [SERVICE_BUS, EVENT_HUBS] },
        aggregationType: AggregationType.Avg,
        variable: "d",
      }),
      query({
        metricName: MESSAGES_IN,
        attributes: {},
        aggregationType: AggregationType.Avg,
        variable: "e",
      }),
    ]);

    expect(MetricQueryCloudAggregation.restoreResourceTotals(monitor)).toEqual(
      [],
    );
    expect(aggregationsOf(monitor)).toEqual([
      AggregationType.Avg,
      AggregationType.Avg,
      AggregationType.Avg,
      AggregationType.Avg,
      AggregationType.Avg,
    ]);
  });

  test("of a step's queries only those the namespace adds up move; its formulas stay; a second run moves nothing", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor([
      query({
        variable: "incoming",
        metricName: MESSAGES_IN,
        attributes: onResource(SERVICE_BUS),
        aggregationType: AggregationType.Avg,
      }),
      query({
        variable: "latency",
        metricName: SEND_LATENCY,
        attributes: onResource(SERVICE_BUS),
        aggregationType: AggregationType.Avg,
      }),
      query({
        variable: "waiting",
        metricName: MESSAGES_WAITING,
        attributes: onResource(SERVICE_BUS),
      }),
    ]);
    monitor.metricViewConfig.formulaConfigs = [
      {
        metricAliasData: {
          metricVariable: "per_message",
          title: undefined,
          description: undefined,
          legend: undefined,
          legendUnit: undefined,
        },
        metricFormulaData: { metricFormula: "$waiting / $incoming" },
      },
    ];
    const formulas: string = JSON.stringify(
      monitor.metricViewConfig.formulaConfigs,
    );

    expect(
      MetricQueryCloudAggregation.restoreResourceTotals(monitor).map(
        (restore: MetricQueryAggregationRestore) => {
          return restore.metricVariable;
        },
      ),
    ).toEqual(["incoming", "waiting"]);
    expect(aggregationsOf(monitor)).toEqual([
      AggregationType.Sum,
      AggregationType.Avg,
      AggregationType.Sum,
    ]);
    expect(JSON.stringify(monitor.metricViewConfig.formulaConfigs)).toBe(
      formulas,
    );
    expect(MetricQueryCloudAggregation.restoreResourceTotals(monitor)).toEqual(
      [],
    );
  });

  test("a query grouped by queue is moved too: each queue's minute is its own Sum", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor([
      query({
        metricName: MESSAGES_WAITING,
        attributes: onResource(SERVICE_BUS),
        aggregationType: AggregationType.Avg,
        groupByAttributeKeys: ["metadata_entityname"],
      }),
    ]);

    expect(
      MetricQueryCloudAggregation.restoreResourceTotals(monitor),
    ).toHaveLength(1);
    expect(aggregationsOf(monitor)).toEqual([AggregationType.Sum]);
  });

  test("a query with no variable says so", () => {
    const monitor: MonitorStepMetricMonitor = metricMonitor([
      query({
        metricName: MESSAGES_IN,
        attributes: onResource(SERVICE_BUS),
        variable: "",
      }),
    ]);

    expect(
      MetricQueryCloudAggregation.restoreResourceTotals(monitor)[0]
        ?.metricVariable,
    ).toBeUndefined();
  });
});

describe("getStoredMetricMonitors: monitor steps as the database holds them", () => {
  test("hands over each metric step's own object, to write on", () => {
    const counting: MonitorStep = metricStep(
      metricMonitor([
        query({
          metricName: MESSAGES_IN,
          attributes: onResource(SERVICE_BUS),
          aggregationType: AggregationType.Avg,
        }),
      ]),
    );
    const notMetrics: MonitorStep = metricStep(metricMonitor([]));
    notMetrics.data!.metricMonitor = undefined;
    const waiting: MonitorStep = metricStep(
      metricMonitor(
        [
          query({
            metricName: MESSAGES_WAITING,
            attributes: onResource(SERVICE_BUS),
          }),
        ],
        { rollingTime: RollingTime.Past1Hour },
      ),
    );
    const json: JSONObject = storedJSON(
      stepsOf([counting, notMetrics, waiting]),
    );
    const metricMonitors: Array<Record<string, unknown>> =
      MetricQueryCloudAggregation.getStoredMetricMonitors(json);

    expect(metricMonitors).toHaveLength(2);

    for (const stored of metricMonitors) {
      MetricQueryCloudAggregation.restoreResourceTotals(stored);
    }

    // Written on the JSON itself: what is stored reads Sum.
    const steps: Array<MonitorStep> =
      MonitorSteps.fromJSON(json).data!.monitorStepsInstanceArray;

    expect(aggregationsOf(steps[0]!.data!.metricMonitor!)).toEqual([
      AggregationType.Sum,
    ]);
    expect(steps[1]!.data!.metricMonitor).toBeUndefined();
    expect(aggregationsOf(steps[2]!.data!.metricMonitor!)).toEqual([
      AggregationType.Sum,
    ]);
    expect(steps[2]!.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past1Hour,
    );
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["no value", { _type: "MonitorSteps" }],
    ["no steps", { _type: "MonitorSteps", value: {} }],
    [
      "steps that are no list",
      { _type: "MonitorSteps", value: { monitorStepsInstanceArray: "x" } },
    ],
    [
      "steps with no value",
      {
        _type: "MonitorSteps",
        value: { monitorStepsInstanceArray: [null, {}, { value: null }] },
      },
    ],
  ])("finds none in %s", (_label: string, json: unknown) => {
    expect(MetricQueryCloudAggregation.getStoredMetricMonitors(json)).toEqual(
      [],
    );
  });
});
