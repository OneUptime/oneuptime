import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import CloudResourceInstanceService from "Common/Server/Services/CloudResourceInstanceService";
import { AttributeType } from "Common/Server/Utils/Telemetry/Telemetry";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The cloud snapshot fold: one batch of OTLP datapoints for a managed
 * cloud environment collapses into one CPU percent + memory bytes pair per
 * running instance, which the flush mirrors onto CloudResourceInstance.
 *
 * Pinned here:
 *
 *   - the unit conversions per metric name — the awsecscontainermetrics
 *     receiver's *.cpu.utilized is ALREADY a percent (never multiplied by
 *     100, whatever the unit string), *.memory.utilized is megabytes,
 *     *.memory.usage is bytes, and the docker_stats-style
 *     container.cpu.utilization keeps its ratio-unless-"%" rule;
 *   - task-level (ecs.task.*) points beat container-level points for the
 *     same instance in either arrival order — a task has several
 *     containers and they all resolve to the same task id;
 *   - among same-rank points the newer timestamp wins;
 *   - the instance name is resolved through the shared fallback chain over
 *     the `resource.`-prefixed attribute map, so it agrees with the row the
 *     resource-attribute walk created;
 *   - the flush writes once per instance and swallows a failing write.
 *
 * bufferCloudResourceSnapshotMetric and flushCloudResourceSnapshotBuffer
 * are private statics, driven through the record-cast idiom the sibling
 * suites use.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_RESOURCE_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_CLOUD_RESOURCE_ID: string = "55555555-5555-4555-8555-555555555555";

const TASK_ARN: string =
  "arn:aws:ecs:us-east-1:123456789012:task/my-cluster/1a2b3c4d5e6f7a8b9c0d";
const TASK_ID: string = "1a2b3c4d5e6f7a8b9c0d";

// 2023-11-14T22:13:20.000Z — an arbitrary fixed scrape instant.
const BASE_MS: number = 1700000000000;

const MEGABYTE: number = 1024 * 1024;

/* eslint-disable @typescript-eslint/no-explicit-any */
const service: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/*
 * Structural mirror of the service's private buffer entry. Kept local so
 * the assertions read as the contract rather than as an implementation
 * import.
 */
type Sample = { value: number; rank: number; observedAt: Date };
type Entry = {
  instanceName: string;
  cpu: Sample | null;
  memory: Sample | null;
};
type SnapshotBuffer = Map<string, Map<string, Entry>>;

function toNano(ms: number): string {
  return `${ms}000000`;
}

function point(data: {
  value?: number | string | undefined;
  atMs?: number;
  asDouble?: boolean;
}): JSONObject {
  const datapoint: JSONObject = {
    timeUnixNano: toNano(data.atMs ?? BASE_MS),
    attributes: [],
  };
  if (data.value !== undefined) {
    if (data.asDouble) {
      datapoint["asDouble"] = data.value;
    } else {
      datapoint["asInt"] = data.value;
    }
  }
  return datapoint;
}

/*
 * The merged metric attribute map carries resource attributes under a
 * `resource.` prefix (TelemetryUtil.getAttributes with prefixKeysWithString
 * "resource"); build exactly that shape.
 */
function resourceAttrs(
  values: Record<string, string>,
): Dictionary<AttributeType | Array<AttributeType>> {
  const attrs: Dictionary<AttributeType | Array<AttributeType>> = {};
  for (const [key, value] of Object.entries(values)) {
    attrs[`resource.${key}`] = value;
  }
  return attrs;
}

const ECS_TASK_ATTRS: Dictionary<AttributeType | Array<AttributeType>> =
  resourceAttrs({ "aws.ecs.task.arn": TASK_ARN });

function feed(data: {
  buffer: SnapshotBuffer;
  metricName: string;
  unit?: string | undefined;
  datapoint: JSONObject;
  attrs?: Dictionary<AttributeType | Array<AttributeType>>;
  cloudResourceIdStr?: string;
}): void {
  service["bufferCloudResourceSnapshotMetric"]({
    cloudResourceIdStr: data.cloudResourceIdStr ?? CLOUD_RESOURCE_ID,
    metricName: data.metricName,
    metricUnit: data.unit,
    datapoint: data.datapoint,
    metricAttributes: data.attrs ?? ECS_TASK_ATTRS,
    buffer: data.buffer,
  });
}

function entry(
  buffer: SnapshotBuffer,
  instanceName: string = TASK_ID,
  cloudResourceIdStr: string = CLOUD_RESOURCE_ID,
): Entry {
  const perResource: Map<string, Entry> | undefined =
    buffer.get(cloudResourceIdStr);
  expect(perResource).toBeDefined();
  const found: Entry | undefined = perResource!.get(instanceName);
  expect(found).toBeDefined();
  return found!;
}

async function flush(buffer: SnapshotBuffer): Promise<void> {
  await service["flushCloudResourceSnapshotBuffer"]({
    projectId: PROJECT_ID,
    buffer,
  });
}

let recordInstance: jest.SpiedFunction<
  typeof CloudResourceInstanceService.recordInstance
>;

beforeEach(() => {
  recordInstance = jest
    .spyOn(CloudResourceInstanceService, "recordInstance")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("cloud snapshot unit conversions", () => {
  test.each<[string, string | undefined, number, number]>([
    ["ecs.task.cpu.utilized", "Percent", 37.5, 37.5],
    // The unit is deliberately not consulted for *.cpu.utilized.
    ["ecs.task.cpu.utilized", "1", 37.5, 37.5],
    ["ecs.task.cpu.utilized", undefined, 12, 12],
    ["container.cpu.utilized", "Percent", 12.25, 12.25],
    ["container.cpu.utilized", "1", 0.75, 0.75],
    // docker_stats: a [0, 1] ratio unless the unit says "%".
    ["container.cpu.utilization", "1", 0.5, 50],
    ["container.cpu.utilization", undefined, 0.25, 25],
    ["container.cpu.utilization", "%", 42, 42],
  ])(
    "%s (unit %s) %p → cpu %p",
    (
      metricName: string,
      unit: string | undefined,
      raw: number,
      expected: number,
    ) => {
      const buffer: SnapshotBuffer = new Map();

      feed({
        buffer,
        metricName,
        unit,
        datapoint: point({ value: raw, asDouble: true }),
      });

      expect(entry(buffer).cpu!.value).toBeCloseTo(expected, 9);
      expect(entry(buffer).memory).toBeNull();
    },
  );

  test.each<[string, string | undefined, number, number]>([
    ["ecs.task.memory.utilized", "Megabytes", 512, 512 * MEGABYTE],
    ["ecs.task.memory.utilized", "1", 1.5, Math.trunc(1.5 * MEGABYTE)],
    ["container.memory.utilized", "Megabytes", 256, 256 * MEGABYTE],
    ["ecs.task.memory.usage", "Bytes", 123456789, 123456789],
    ["container.memory.usage", "By", 1000, 1000],
    ["container.memory.usage.total", "By", 2048.9, 2048],
  ])(
    "%s (unit %s) %p → memory %p bytes",
    (
      metricName: string,
      unit: string | undefined,
      raw: number,
      expected: number,
    ) => {
      const buffer: SnapshotBuffer = new Map();

      feed({
        buffer,
        metricName,
        unit,
        datapoint: point({ value: raw, asDouble: true }),
      });

      expect(entry(buffer).memory!.value).toBe(expected);
      expect(entry(buffer).cpu).toBeNull();
    },
  );

  test("megabytes → bytes is truncated, never rounded up", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.memory.utilized",
      unit: "Megabytes",
      datapoint: point({ value: 0.0000001, asDouble: true }),
    });

    expect(entry(buffer).memory!.value).toBe(0);
    expect(Number.isInteger(entry(buffer).memory!.value)).toBe(true);
  });

  test("a negative memory reading clamps to zero", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "container.memory.usage.total",
      unit: "By",
      datapoint: point({ value: -5 }),
    });

    expect(entry(buffer).memory!.value).toBe(0);
  });

  test("asInt is read when asDouble is absent", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.memory.usage",
      unit: "Bytes",
      datapoint: point({ value: 4096 }),
    });

    expect(entry(buffer).memory!.value).toBe(4096);
  });

  test("a string-encoded asInt (OTLP JSON int64) is parsed", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.memory.usage",
      unit: "Bytes",
      datapoint: point({ value: "9007199254740" }),
    });

    expect(entry(buffer).memory!.value).toBe(9007199254740);
  });

  test("one instance accumulates both cpu and memory from separate metrics", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 20.5, asDouble: true }),
    });
    feed({
      buffer,
      metricName: "ecs.task.memory.utilized",
      unit: "Megabytes",
      datapoint: point({ value: 100 }),
    });

    expect(entry(buffer).cpu!.value).toBe(20.5);
    expect(entry(buffer).memory!.value).toBe(100 * MEGABYTE);
    expect(buffer.get(CLOUD_RESOURCE_ID)!.size).toBe(1);
  });
});

describe("cloud snapshot precedence", () => {
  test("a task-level cpu point beats a container-level one that arrived first", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "container.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 80, asDouble: true }),
    });
    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 30, asDouble: true }),
    });

    expect(entry(buffer).cpu!.value).toBe(30);
  });

  test("a task-level cpu point is kept when a container-level one arrives later", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 30, asDouble: true }),
    });
    feed({
      buffer,
      metricName: "container.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 80, asDouble: true }),
    });
    feed({
      buffer,
      metricName: "container.cpu.utilization",
      unit: "1",
      datapoint: point({ value: 0.9, asDouble: true }),
    });

    expect(entry(buffer).cpu!.value).toBe(30);
  });

  test("a NEWER container-level point still loses to an older task-level one", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 30, atMs: BASE_MS, asDouble: true }),
    });
    feed({
      buffer,
      metricName: "container.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 80, atMs: BASE_MS + 60_000, asDouble: true }),
    });

    expect(entry(buffer).cpu!.value).toBe(30);
  });

  test("task-level memory beats container-level memory in either order", () => {
    const first: SnapshotBuffer = new Map();
    feed({
      buffer: first,
      metricName: "container.memory.usage",
      unit: "By",
      datapoint: point({ value: 999 }),
    });
    feed({
      buffer: first,
      metricName: "ecs.task.memory.utilized",
      unit: "Megabytes",
      datapoint: point({ value: 3 }),
    });
    expect(entry(first).memory!.value).toBe(3 * MEGABYTE);

    const second: SnapshotBuffer = new Map();
    feed({
      buffer: second,
      metricName: "ecs.task.memory.usage",
      unit: "Bytes",
      datapoint: point({ value: 7777 }),
    });
    feed({
      buffer: second,
      metricName: "container.memory.utilized",
      unit: "Megabytes",
      datapoint: point({ value: 512 }),
    });
    expect(entry(second).memory!.value).toBe(7777);
  });

  test("several containers of one task fold into one instance carrying the task values", () => {
    const buffer: SnapshotBuffer = new Map();
    /*
     * The awsecscontainermetrics receiver emits container-level points
     * under a resource that carries the task ARN as well; every one of them
     * resolves to the task id.
     */
    for (const container of ["app", "envoy", "otel-collector"]) {
      feed({
        buffer,
        metricName: "container.cpu.utilized",
        unit: "Percent",
        datapoint: point({ value: 10, asDouble: true }),
        attrs: resourceAttrs({
          "aws.ecs.task.arn": TASK_ARN,
          "aws.ecs.container.name": container,
          "container.id": `${container}-container-id`,
        }),
      });
    }
    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 27, asDouble: true }),
    });

    expect(buffer.get(CLOUD_RESOURCE_ID)!.size).toBe(1);
    expect(entry(buffer).cpu!.value).toBe(27);
  });

  test("rank is tracked per field — a task-level cpu point does not veto a container-level memory point", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 30, asDouble: true }),
    });
    feed({
      buffer,
      metricName: "container.memory.usage.total",
      unit: "By",
      datapoint: point({ value: 4096 }),
    });

    expect(entry(buffer).cpu!.value).toBe(30);
    expect(entry(buffer).memory!.value).toBe(4096);
  });

  test("among same-rank points the newer timestamp wins, whichever arrived first", () => {
    const newestLast: SnapshotBuffer = new Map();
    feed({
      buffer: newestLast,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 10, atMs: BASE_MS, asDouble: true }),
    });
    feed({
      buffer: newestLast,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 20, atMs: BASE_MS + 15_000, asDouble: true }),
    });
    expect(entry(newestLast).cpu!.value).toBe(20);

    const newestFirst: SnapshotBuffer = new Map();
    feed({
      buffer: newestFirst,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 20, atMs: BASE_MS + 15_000, asDouble: true }),
    });
    feed({
      buffer: newestFirst,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 10, atMs: BASE_MS, asDouble: true }),
    });
    expect(entry(newestFirst).cpu!.value).toBe(20);
  });

  test("among same-rank, same-timestamp points the last one wins", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "container.memory.usage.total",
      unit: "By",
      datapoint: point({ value: 1 }),
    });
    feed({
      buffer,
      metricName: "container.memory.usage.total",
      unit: "By",
      datapoint: point({ value: 2 }),
    });

    expect(entry(buffer).memory!.value).toBe(2);
  });

  test("the newer-timestamp rule is per field too", () => {
    const buffer: SnapshotBuffer = new Map();

    // An older memory point must not be rejected because a newer cpu point exists.
    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 30, atMs: BASE_MS + 60_000, asDouble: true }),
    });
    feed({
      buffer,
      metricName: "ecs.task.memory.usage",
      unit: "Bytes",
      datapoint: point({ value: 4096, atMs: BASE_MS }),
    });

    expect(entry(buffer).cpu!.value).toBe(30);
    expect(entry(buffer).memory!.value).toBe(4096);
  });
});

describe("cloud snapshot instance identity", () => {
  test("resolves the task id from resource.aws.ecs.task.arn", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 1, asDouble: true }),
      attrs: resourceAttrs({ "aws.ecs.task.arn": TASK_ARN }),
    });

    expect([...buffer.get(CLOUD_RESOURCE_ID)!.keys()]).toEqual([TASK_ID]);
    expect(entry(buffer).instanceName).toBe(TASK_ID);
  });

  test("resolves a Cloud Run instance from resource.faas.instance", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "container.cpu.utilization",
      unit: "1",
      datapoint: point({ value: 0.1, asDouble: true }),
      attrs: resourceAttrs({
        "faas.instance": "00bf4bf02d4b1b7e2c0e5f7d6e0a3d5b",
        "host.name": "localhost",
      }),
    });

    expect([...buffer.get(CLOUD_RESOURCE_ID)!.keys()]).toEqual([
      "00bf4bf02d4b1b7e2c0e5f7d6e0a3d5b",
    ]);
  });

  test("the task ARN wins over resource.service.instance.id — the same rule ingest applies", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 1, asDouble: true }),
      attrs: resourceAttrs({
        "service.instance.id": "sdk-instance-7",
        "aws.ecs.task.arn": TASK_ARN,
      }),
    });

    expect([...buffer.get(CLOUD_RESOURCE_ID)!.keys()]).toEqual([TASK_ID]);
  });

  test("resource.service.instance.id is used when no platform identity is present", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "container.cpu.utilization",
      unit: "1",
      datapoint: point({ value: 0.5, asDouble: true }),
      attrs: resourceAttrs({
        "service.instance.id": "sdk-instance-7",
        "container.id": "abc123",
      }),
    });

    expect([...buffer.get(CLOUD_RESOURCE_ID)!.keys()]).toEqual([
      "sdk-instance-7",
    ]);
  });

  test("falls back to resource.container.id, then resource.host.name", () => {
    const byContainer: SnapshotBuffer = new Map();
    feed({
      buffer: byContainer,
      metricName: "container.memory.usage.total",
      unit: "By",
      datapoint: point({ value: 1 }),
      attrs: resourceAttrs({
        "container.id": "abc123",
        "host.name": "replica-0",
      }),
    });
    expect([...byContainer.get(CLOUD_RESOURCE_ID)!.keys()]).toEqual(["abc123"]);

    const byHost: SnapshotBuffer = new Map();
    feed({
      buffer: byHost,
      metricName: "container.memory.usage.total",
      unit: "By",
      datapoint: point({ value: 1 }),
      attrs: resourceAttrs({ "host.name": "replica-0" }),
    });
    expect([...byHost.get(CLOUD_RESOURCE_ID)!.keys()]).toEqual(["replica-0"]);
  });

  test("only resource.-prefixed attributes identify the instance", () => {
    const buffer: SnapshotBuffer = new Map();

    /*
     * A datapoint-level attribute with the same key is not the resource's
     * identity; it must not create an instance.
     */
    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 1, asDouble: true }),
      attrs: { "aws.ecs.task.arn": TASK_ARN, "service.instance.id": "x" },
    });

    expect(buffer.size).toBe(0);
  });

  test("a blank identity attribute is skipped in favour of the next one", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 1, asDouble: true }),
      attrs: resourceAttrs({
        "service.instance.id": "   ",
        "aws.ecs.task.arn": TASK_ARN,
      }),
    });

    expect([...buffer.get(CLOUD_RESOURCE_ID)!.keys()]).toEqual([TASK_ID]);
  });

  test("distinct instances and distinct environments stay separate", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 1, asDouble: true }),
      attrs: resourceAttrs({ "aws.ecs.task.id": "task-a" }),
    });
    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 2, asDouble: true }),
      attrs: resourceAttrs({ "aws.ecs.task.id": "task-b" }),
    });
    feed({
      buffer,
      cloudResourceIdStr: OTHER_CLOUD_RESOURCE_ID,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 3, asDouble: true }),
      attrs: resourceAttrs({ "aws.ecs.task.id": "task-a" }),
    });

    expect(buffer.size).toBe(2);
    expect(entry(buffer, "task-a").cpu!.value).toBe(1);
    expect(entry(buffer, "task-b").cpu!.value).toBe(2);
    expect(entry(buffer, "task-a", OTHER_CLOUD_RESOURCE_ID).cpu!.value).toBe(3);
  });
});

describe("cloud snapshot skips", () => {
  test("a datapoint without a value is skipped", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({}),
    });

    expect(buffer.size).toBe(0);
  });

  test("a non-finite value is skipped", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: "NaN", asDouble: true }),
    });
    feed({
      buffer,
      metricName: "ecs.task.memory.usage",
      unit: "Bytes",
      datapoint: point({ value: "+Inf", asDouble: true }),
    });

    expect(buffer.size).toBe(0);
  });

  test("a datapoint with no identity attribute at all is skipped", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 1, asDouble: true }),
      attrs: resourceAttrs({
        "cloud.platform": "aws_ecs",
        "service.name": "checkout",
      }),
    });

    expect(buffer.size).toBe(0);
  });

  test("a metric outside the snapshot allow-list is ignored even if it reaches the fold", () => {
    const buffer: SnapshotBuffer = new Map();

    feed({
      buffer,
      metricName: "ecs.task.memory.reserved",
      unit: "Megabytes",
      datapoint: point({ value: 1024 }),
    });
    feed({
      buffer,
      metricName: "ecs.task.cpu.reserved",
      unit: "vCPU",
      datapoint: point({ value: 1 }),
    });
    feed({
      buffer,
      metricName: "container.memory.percent",
      unit: "%",
      datapoint: point({ value: 50 }),
    });

    expect(buffer.size).toBe(0);
  });

  test("an unparseable timestamp falls back to now rather than dropping the point", () => {
    const buffer: SnapshotBuffer = new Map();
    const before: number = Date.now();

    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: { asDouble: 5, timeUnixNano: "not-a-number", attributes: [] },
    });

    expect(entry(buffer).cpu!.value).toBe(5);
    expect(entry(buffer).cpu!.observedAt.getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
  });
});

describe("flushCloudResourceSnapshotBuffer", () => {
  test("writes one recordInstance per instance with the folded cpu and memory", async () => {
    const buffer: SnapshotBuffer = new Map();
    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 37.5, asDouble: true }),
      attrs: resourceAttrs({ "aws.ecs.task.id": "task-a" }),
    });
    feed({
      buffer,
      metricName: "ecs.task.memory.utilized",
      unit: "Megabytes",
      datapoint: point({ value: 512 }),
      attrs: resourceAttrs({ "aws.ecs.task.id": "task-a" }),
    });
    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 12, asDouble: true }),
      attrs: resourceAttrs({ "aws.ecs.task.id": "task-b" }),
    });

    await flush(buffer);

    expect(recordInstance).toHaveBeenCalledTimes(2);
    expect(recordInstance).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      cloudResourceId: expect.any(ObjectID),
      instanceName: "task-a",
      cpuPercent: 37.5,
      memoryBytes: 512 * MEGABYTE,
    });
    expect(recordInstance).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      cloudResourceId: expect.any(ObjectID),
      instanceName: "task-b",
      cpuPercent: 12,
      memoryBytes: undefined,
    });
    for (const call of recordInstance.mock.calls) {
      expect(
        (call[0] as { cloudResourceId: ObjectID }).cloudResourceId.toString(),
      ).toBe(CLOUD_RESOURCE_ID);
    }
  });

  test("a memory-only instance leaves cpuPercent undefined so the row keeps its last cpu", async () => {
    const buffer: SnapshotBuffer = new Map();
    feed({
      buffer,
      metricName: "container.memory.usage.total",
      unit: "By",
      datapoint: point({ value: 4096 }),
    });

    await flush(buffer);

    expect(recordInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: TASK_ID,
        cpuPercent: undefined,
        memoryBytes: 4096,
      }),
    );
  });

  test("writes nothing for an empty buffer", async () => {
    await flush(new Map());
    await flush(new Map([[CLOUD_RESOURCE_ID, new Map<string, Entry>()]]));

    expect(recordInstance).not.toHaveBeenCalled();
  });

  test("swallows a failing write and keeps flushing the other environments", async () => {
    const buffer: SnapshotBuffer = new Map();
    feed({
      buffer,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 1, asDouble: true }),
    });
    feed({
      buffer,
      cloudResourceIdStr: OTHER_CLOUD_RESOURCE_ID,
      metricName: "ecs.task.cpu.utilized",
      unit: "Percent",
      datapoint: point({ value: 2, asDouble: true }),
    });
    recordInstance.mockRejectedValueOnce(new Error("Postgres said no"));

    await expect(flush(buffer)).resolves.toBeUndefined();

    expect(recordInstance).toHaveBeenCalledTimes(2);
  });
});
