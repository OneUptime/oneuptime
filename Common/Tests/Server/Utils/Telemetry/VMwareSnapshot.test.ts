import {
  scanVMwareSnapshots,
  getVMwareSourceIdentifier,
  validateVMwareIdentifier,
  VMwareSourceSnapshot,
  VMwareResourceSnapshot,
} from "../../../../Server/Utils/Telemetry/VMwareSnapshot";
import { JSONArray, JSONObject } from "../../../../Types/JSON";

const NOW: Date = new Date("2026-09-07T12:00:00.000Z");
const PREFIX: string = "oneuptime.vmware.";
function resource(
  attributes: JSONObject,
  metrics: JSONObject,
  time: Date = NOW,
): JSONObject {
  return {
    resource: {
      attributes: Object.entries(attributes).map(
        ([key, value]: [string, unknown]) => ({
          key: `${PREFIX}${key}`,
          value:
            typeof value === "boolean"
              ? { boolValue: value }
              : typeof value === "number"
                ? { doubleValue: value }
                : { stringValue: value },
        }),
      ),
    },
    scopeMetrics: [
      {
        metrics: Object.entries(metrics).map(
          ([name, value]: [string, unknown]) => ({
            name: name.startsWith("vcenter.") ? name : `${PREFIX}${name}`,
            gauge: {
              dataPoints: [
                { asDouble: value, timeUnixNano: String(time.getTime() * 1e6) },
              ],
            },
          }),
        ),
      },
    ],
  } as JSONObject;
}
function vm(overrides: JSONObject = {}): JSONObject {
  return {
    "source.id": "prod",
    "source.name": "Production",
    "source.kind": "vcenter",
    "source.collection_interval_seconds": 60,
    "resource.type": "vm",
    "resource.id": "uuid-1",
    "resource.name": "api",
    "resource.observed": true,
    ...overrides,
  };
}
function scan(input: JSONArray): Array<VMwareSourceSnapshot> {
  return scanVMwareSnapshots(input, NOW);
}

describe("VMware telemetry snapshot contract", () => {
  it("folds a fleet into one source and merges same-scrape metrics", () => {
    const sources: Array<VMwareSourceSnapshot> = scan([
      resource(
        { "source.id": "prod", "source.kind": "vcenter" },
        { "source.up": 1, "source.inventory.complete": 1 },
      ),
      resource(vm(), { "resource.state": 1, "vm.cpu.utilization": 0 }),
      resource(vm(), { "vm.memory.utilization": 40 }),
      resource(vm({ "resource.id": "uuid-2" }), { "resource.state": 2 }),
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.resources).toHaveLength(2);
    expect(sources[0]!.lastSuccessfulCollectionAt).toEqual(NOW);
    expect(sources[0]!.resources[0]!.metrics).toEqual({
      [`${PREFIX}resource.state`]: 1,
      [`${PREFIX}vm.cpu.utilization`]: 0,
      [`${PREFIX}vm.memory.utilization`]: 40,
    });
  });
  it("separates sources with duplicate names/IDs and separates resource types", () => {
    const sources: Array<VMwareSourceSnapshot> = scan([
      resource(vm(), { "resource.state": 1 }),
      resource(vm({ "source.id": "secondary" }), { "resource.state": 3 }),
      resource(vm({ "resource.type": "host" }), { "resource.state": 2 }),
    ]);
    expect(sources).toHaveLength(2);
    expect(sources[0]!.resources).toHaveLength(2);
    expect(sources[1]!.resources[0]!.metrics[`${PREFIX}resource.state`]).toBe(
      3,
    );
  });
  it("keeps identity during rename and migration", () => {
    const before: Date = new Date(NOW.getTime() - 60000);
    const source: VMwareSourceSnapshot = scan([
      resource(vm({ "parent.id": "host-1" }), { "resource.state": 1 }, before),
      resource(vm({ "resource.name": "new-name", "parent.id": "host-2" }), {
        "resource.state": 1,
      }),
    ])[0]!;
    expect(source.resources).toHaveLength(1);
    expect(source.resources[0]!.resourceIdentifier).toBe("uuid-1");
    expect(source.resources[0]!.name).toBe("new-name");
    expect(source.resources[0]!.metadata[`${PREFIX}parent.id`]).toBe("host-2");
  });
  it("clears obsolete metrics on newer unknown reports and preserves actual last-seen", () => {
    const before: Date = new Date(NOW.getTime() - 60000);
    const snapshot: VMwareResourceSnapshot = scan([
      resource(vm(), { "resource.state": 1, "vm.cpu.utilization": 70 }, before),
      resource(vm({ "resource.observed": false }), {
        "resource.state": 0,
        "resource.observed": 0,
      }),
      resource(vm(), { "vm.cpu.utilization": 99 }, before),
    ])[0]!.resources[0]!;
    expect(snapshot.metrics).toEqual({
      [`${PREFIX}resource.state`]: 0,
      [`${PREFIX}resource.observed`]: 0,
    });
    expect(snapshot.lastSeenAt).toEqual(before);
    expect(snapshot.lastReportedAt).toEqual(NOW);
  });
  it.each([
    [0, 0],
    [1, 0],
    [0, 1],
  ])(
    "does not call incomplete/failed collection successful (%s,%s)",
    (up: number, complete: number) => {
      expect(
        scan([
          resource(
            { "source.id": "prod" },
            { "source.up": up, "source.inventory.complete": complete },
          ),
        ])[0]!.lastSuccessfulCollectionAt,
      ).toBeNull();
    },
  );
  it("requires source health from the same collection", () => {
    expect(
      scan([
        resource(
          { "source.id": "prod" },
          { "source.up": 1 },
          new Date(NOW.getTime() - 60000),
        ),
        resource({ "source.id": "prod" }, { "source.inventory.complete": 1 }),
      ])[0]!.lastSuccessfulCollectionAt,
    ).toBeNull();
  });
  it("routes stock metrics without claiming successful inventory or creating VM rows", () => {
    const source: VMwareSourceSnapshot = scan([
      resource({ "source.id": "prod" }, { "vcenter.vm.cpu.usage": 12 }),
    ])[0]!;
    expect(source.resources).toEqual([]);
    expect(source.lastCollectionAt).toBeNull();
    expect(source.lastSuccessfulCollectionAt).toBeNull();
    expect(source.metrics).toEqual({});
  });
  it("records interval only when bounded and valid", () => {
    expect(
      scan([resource(vm(), { "resource.state": 1 })])[0]!
        .collectionIntervalSeconds,
    ).toBe(60);
    expect(
      scan([
        resource(vm({ "source.collection_interval_seconds": -1 }), {
          "resource.state": 1,
        }),
      ])[0]!.collectionIntervalSeconds,
    ).toBeNull();
  });
  it.each(["", " ", " prod", "x".repeat(501)])(
    "rejects invalid identity without trimming/collision: %s",
    (id: string) => {
      expect(() => validateVMwareIdentifier(id)).toThrow();
    },
  );
  it("does not truncate distinct valid IDs", () => {
    const ids: Array<string> = ["a".repeat(499) + "1", "a".repeat(499) + "2"];
    expect(
      scan(
        ids.map((id: string) =>
          resource(vm({ "resource.id": id }), { "resource.state": 1 }),
        ),
      )[0]!.resources,
    ).toHaveLength(2);
  });
  it("ignores malformed/unrelated metrics and invalid timestamps", () => {
    expect(
      scan([
        null,
        {},
        resource({}, { "source.up": 1 }),
        resource(vm(), { "resource.state": "not-a-number" }),
        resource(
          vm(),
          { "resource.state": 1 },
          new Date(NOW.getTime() + 600000),
        ),
      ] as JSONArray),
    ).toEqual([]);
    expect(getVMwareSourceIdentifier(undefined)).toBeNull();
  });
  it("does not fabricate objects without a valid type/ID", () => {
    expect(
      scan([
        resource(
          { "source.id": "prod", "resource.type": "vm" },
          { "resource.state": 1 },
        ),
        resource(vm({ "resource.type": "unknown" }), { "resource.state": 1 }),
      ])[0]!.resources,
    ).toEqual([]);
  });
});

it("retains the last successful collection when a later scrape fails in the same export batch", () => {
  const before: Date = new Date(NOW.getTime() - 60000);
  const result: VMwareSourceSnapshot = scan([
    resource(
      { "source.id": "prod" },
      { "source.up": 0, "source.inventory.complete": 0 },
    ),
    resource(
      { "source.id": "prod" },
      { "source.up": 1, "source.inventory.complete": 1 },
      before,
    ),
  ])[0]!;
  expect(result.lastSuccessfulCollectionAt).toEqual(before);
  expect(result.lastCollectionAt).toEqual(NOW);
  expect(result.metrics[`${PREFIX}source.up`]).toBe(0);
});
it("rejects excessive source cardinality instead of silently dropping inventory", () => {
  expect(() =>
    scan(
      Array.from({ length: 101 }, (_: unknown, i: number) =>
        resource({ "source.id": `source-${i}` }, { "source.up": 1 }),
      ),
    ),
  ).toThrow("Too many VMware sources");
});

it("preserves actual last-seen even when an older observed report arrives after an unknown report", () => {
  const before: Date = new Date(NOW.getTime() - 60000);
  const result: VMwareResourceSnapshot = scan([
    resource(vm({ "resource.observed": false }), { "resource.state": 0 }),
    resource(vm(), { "resource.state": 1, "vm.cpu.utilization": 40 }, before),
  ])[0]!.resources[0]!;
  expect(result.lastSeenAt).toEqual(before);
  expect(result.metrics).toEqual({ [`${PREFIX}resource.state`]: 0 });
});

it("fills newest companion source metadata when stock metrics arrive first", () => {
  const result: VMwareSourceSnapshot = scan([
    resource({ "source.id": "prod" }, { "vcenter.vm.cpu.usage": 50 }),
    resource(
      {
        "source.id": "prod",
        "source.kind": "vcenter",
        "source.collection_interval_seconds": 600,
      },
      { "source.up": 1, "source.inventory.complete": 1 },
    ),
    resource(
      {
        "source.id": "prod",
        "source.kind": "esxi",
        "source.collection_interval_seconds": 60,
      },
      { "source.up": 1 },
      new Date(NOW.getTime() - 60000),
    ),
    resource({ "source.id": "prod" }, { "vcenter.vm.cpu.usage": 55 }),
  ])[0]!;
  expect(result.kind).toBe("vcenter");
  expect(result.collectionIntervalSeconds).toBe(600);
  expect(result.lastSuccessfulCollectionAt).toEqual(NOW);
});
