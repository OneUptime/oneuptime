import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import Dictionary from "Common/Types/Dictionary";
import { getCloudAlertTemplate } from "Common/Types/Monitor/CloudAlertTemplates";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A METRICS MONITOR THAT READS ITS WHOLE WINDOW AS ONE VALUE
 * (MonitorStepMetricMonitor.aggregatesWholeWindow): a cloud resource's
 * failed share, a count's total (CloudAlertTemplates).
 *
 * The worker reads each of its queries with AggregationInterval.Total - one
 * row for the window - stamps every row at the window's end so the formula
 * joins them, and reads an ungrouped count with no point as a total of zero
 * (MetricWholeWindow). Every other Metrics monitor is read a minute at a
 * time, as before.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import { monitorMetric } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const RESOURCE_ID: string = "6f1c4f2a-0c1e-4a43-9a3b-2c1d6c1a7b10";

const LAMBDA_ATTRIBUTES: Dictionary<string> = {
  Namespace: "AWS/Lambda",
  "Dimensions.FunctionName": "checkout-worker",
};

const ALB_ATTRIBUTES: Dictionary<string> = {
  Namespace: "AWS/ApplicationELB",
  "Dimensions.LoadBalancer": "app/web/0123456789abcdef",
};

const EC2_ATTRIBUTES: Dictionary<string> = {
  Namespace: "AWS/EC2",
  "Dimensions.InstanceId": "i-0abc123def",
};

interface ReadCall {
  query: { name: string; attributes?: Dictionary<unknown> };
  aggregationInterval?: AggregationInterval | undefined;
  startTimestamp: Date;
  endTimestamp: Date;
}

const aggregateBy: jest.Mock = MetricService.aggregateBy as unknown as jest.Mock;

function stepFor(
  templateId: string,
  attributes: Dictionary<string>,
): MonitorStep {
  return getCloudAlertTemplate(templateId)!.getMonitorStep({
    cloudResourceId: RESOURCE_ID,
    telemetryAttributes: attributes,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "checkout-worker",
  });
}

// What the store answers each metric: its rows, as it stamps them.
function answer(rowsByMetric: Dictionary<Array<AggregatedModel>>): void {
  aggregateBy.mockImplementation(((args: ReadCall) => {
    return Promise.resolve({
      data: rowsByMetric[args.query.name] || [],
    } as AggregatedResult);
  }) as never);
}

async function read(step: MonitorStep): Promise<MetricMonitorResponse> {
  return await monitorMetric({
    monitorStep: step,
    monitorId: ObjectID.generate(),
    projectId: ObjectID.generate(),
  });
}

function calls(): Array<ReadCall> {
  return aggregateBy.mock.calls.map((call: Array<unknown>): ReadCall => {
    return call[0] as ReadCall;
  });
}

describe("a Metrics monitor that reads its whole window", () => {
  beforeEach(() => {
    aggregateBy.mockReset().mockResolvedValue({ data: [] } as never);
    (MetricService.findBy as unknown as jest.Mock)
      .mockReset()
      .mockResolvedValue([] as never);
    (MetricTypeService.findBy as unknown as jest.Mock)
      .mockReset()
      .mockResolvedValue([] as never);
  });

  test("reads every query as one total for the window, over the window", async () => {
    const response: MetricMonitorResponse = await read(
      stepFor("cloud-aws-lambda-errors", LAMBDA_ATTRIBUTES),
    );

    expect(calls()).toHaveLength(2);

    for (const call of calls()) {
      expect(call.aggregationInterval).toBe(AggregationInterval.Total);
      expect(call.query.attributes).toEqual(LAMBDA_ATTRIBUTES);
      expect(call.endTimestamp).toEqual(
        response.startAndEndDate!.endValue as Date,
      );
      // Thirty minutes: an AWS template's window.
      expect(call.endTimestamp.getTime() - call.startTimestamp.getTime()).toBe(
        30 * 60 * 1000,
      );
    }

    expect(
      calls().map((call: ReadCall): string => {
        return call.query.name;
      }),
    ).toEqual([
      "amazonaws.com/aws/lambda/errors",
      "amazonaws.com/aws/lambda/invocations",
    ]);
  });

  test("stamps each total at the window's end, so the share joins them", async () => {
    answer({
      "amazonaws.com/aws/lambda/errors": [
        // The store stamps a total with the earliest point it folded.
        { timestamp: new Date("2026-11-02T12:10:00.000Z"), value: 20 },
      ],
      "amazonaws.com/aws/lambda/invocations": [
        { timestamp: new Date("2026-11-02T12:05:00.000Z"), value: 400 },
      ],
    });

    const response: MetricMonitorResponse = await read(
      stepFor("cloud-aws-lambda-errors", LAMBDA_ATTRIBUTES),
    );
    const windowEnd: Date = response.startAndEndDate!.endValue as Date;
    const [errors, invocations, share] = response.metricResult!;

    expect(errors!.data).toEqual([{ timestamp: windowEnd, value: 20 }]);
    expect(invocations!.data).toEqual([{ timestamp: windowEnd, value: 400 }]);
    expect(share!.data).toHaveLength(1);
    expect(share!.data[0]!.value).toBe(5);
  });

  test("a count with no point is a total of zero, so two counts still add up", async () => {
    answer({
      "amazonaws.com/aws/applicationelb/httpcode_target_5xx_count": [
        { timestamp: new Date("2026-11-02T12:10:00.000Z"), value: 30 },
      ],
      // The balancer itself failed nothing: CloudWatch wrote no point.
      "amazonaws.com/aws/applicationelb/requestcount": [
        { timestamp: new Date("2026-11-02T12:05:00.000Z"), value: 300 },
      ],
    });

    const response: MetricMonitorResponse = await read(
      stepFor("cloud-aws-alb-server-errors", ALB_ATTRIBUTES),
    );
    const windowEnd: Date = response.startAndEndDate!.endValue as Date;
    const [targetErrors, balancerErrors, requests, share] =
      response.metricResult!;

    expect(targetErrors!.data).toEqual([{ timestamp: windowEnd, value: 30 }]);
    expect(balancerErrors!.data).toEqual([{ timestamp: windowEnd, value: 0 }]);
    expect(requests!.data).toEqual([{ timestamp: windowEnd, value: 300 }]);
    expect(share!.data.map((row: AggregatedModel): number => {
      return row.value;
    })).toEqual([10]);
  });

  test("every other Metrics monitor is read a minute at a time, as before", async () => {
    const rows: Array<AggregatedModel> = [
      { timestamp: new Date("2026-11-02T12:05:00.000Z"), value: 95 },
      { timestamp: new Date("2026-11-02T12:10:00.000Z"), value: 97 },
    ];

    answer({ "amazonaws.com/aws/ec2/cpuutilization": rows });

    const response: MetricMonitorResponse = await read(
      stepFor("cloud-aws-ec2-high-cpu", EC2_ATTRIBUTES),
    );

    expect(calls()).toHaveLength(1);
    expect(calls()[0]!.aggregationInterval).toBeUndefined();
    expect(response.metricResult![0]!.data).toEqual(rows);
  });

  test("an empty level read whole stays empty: no reading is not zero", async () => {
    const step: MonitorStep = stepFor("cloud-aws-ec2-high-cpu", EC2_ATTRIBUTES);
    step.data!.metricMonitor!.aggregatesWholeWindow = true;

    const response: MetricMonitorResponse = await read(step);

    expect(calls()[0]!.aggregationInterval).toBe(AggregationInterval.Total);
    expect(response.metricResult![0]!.data).toEqual([]);
  });
});
