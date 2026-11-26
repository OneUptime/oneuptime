import { describe, expect, test } from "@jest/globals";
import StorageArrayProbeMetrics, {
  STORAGE_ARRAY_NAME_ATTRIBUTE,
  STORAGE_SYSTEM_ATTRIBUTE,
  StorageArrayProbeMetricsPayload,
} from "../../../../Server/Utils/StorageArray/StorageArrayProbeMetrics";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import POWERMAX_PROBE_COLLECTOR from "../../../../Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxProbeCollector";
import { POWERMAX_SYMMETRIX_ID_ATTRIBUTE } from "../../../../Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxSeries";

/*
 * A probe's collection made ready for the metrics ingest (#11004): the
 * server, not the probe, says which array each resource is. Each gets
 * storage.system from the connection and storage.array.name from the
 * array's row in OneUptime, found by its Symmetrix ID - so an array renamed
 * in OneUptime stays the same array, and a probe can never name another
 * array, platform or project's resource.
 */

function attribute(key: string, value: string): JSONObject {
  return { key, value: { stringValue: value } };
}

function resource(
  attributes: Array<JSONObject>,
  datapoints: number = 1,
): JSONObject {
  return {
    resource: { attributes },
    scopeMetrics: [
      {
        scope: { name: "oneuptime-probe/storage-array", version: "1" },
        metrics: [
          {
            name: "powermax_array_info",
            gauge: {
              dataPoints: Array.from({ length: datapoints }, () => {
                return { asDouble: 1, timeUnixNano: "1", attributes: [] };
              }),
            },
          },
        ],
      },
    ],
  };
}

function attributesOf(entry: JSONObject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of (entry["resource"] as JSONObject)[
    "attributes"
  ] as Array<JSONObject>) {
    out[String(item["key"])] = String(
      (item["value"] as JSONObject)["stringValue"],
    );
  }
  return out;
}

describe("StorageArrayProbeMetrics.prepare", () => {
  test("names each array as OneUptime does, by its Symmetrix ID, and says its platform", () => {
    const payload: StorageArrayProbeMetricsPayload =
      StorageArrayProbeMetrics.prepare({
        resourceMetrics: [
          resource(
            [attribute(POWERMAX_SYMMETRIX_ID_ATTRIBUTE, "000220200269")],
            3,
          ),
          resource([
            attribute(POWERMAX_SYMMETRIX_ID_ATTRIBUTE, "000297900330"),
          ]),
        ],
        collector: POWERMAX_PROBE_COLLECTOR,
        namesByIdentifier: new Map([["000220200269", "PowerMax DC1"]]),
      });

    expect(payload.resourceCount).toBe(2);
    expect(payload.datapointCount).toBe(4);
    expect(payload.arrayIdentifiers).toEqual(["000220200269", "000297900330"]);
    expect(attributesOf(payload.resourceMetrics[0] as JSONObject)).toEqual({
      [POWERMAX_SYMMETRIX_ID_ATTRIBUTE]: "000220200269",
      // Renamed in OneUptime: still the same array.
      [STORAGE_ARRAY_NAME_ATTRIBUTE]: "PowerMax DC1",
      [STORAGE_SYSTEM_ATTRIBUTE]: "dell.powermax",
    });
    // No row yet: named after its identifier, under which ingest makes one.
    expect(
      attributesOf(payload.resourceMetrics[1] as JSONObject)[
        STORAGE_ARRAY_NAME_ATTRIBUTE
      ],
    ).toBe("000297900330");
  });

  test("whatever a probe put under the array's name, platform, service.* or oneuptime.* is dropped", () => {
    const payload: StorageArrayProbeMetricsPayload =
      StorageArrayProbeMetrics.prepare({
        resourceMetrics: [
          resource([
            attribute(POWERMAX_SYMMETRIX_ID_ATTRIBUTE, "000220200269"),
            attribute(STORAGE_ARRAY_NAME_ATTRIBUTE, "someone else's array"),
            attribute(STORAGE_SYSTEM_ATTRIBUTE, "purestorage.flasharray"),
            attribute("service.name", "spoof"),
            attribute("oneuptime.project.id", "another project"),
            attribute("dell.powermax.model", "PowerMax_8500"),
          ]),
        ],
        collector: POWERMAX_PROBE_COLLECTOR,
        namesByIdentifier: new Map(),
      });

    expect(attributesOf(payload.resourceMetrics[0] as JSONObject)).toEqual({
      [POWERMAX_SYMMETRIX_ID_ATTRIBUTE]: "000220200269",
      "dell.powermax.model": "PowerMax_8500",
      [STORAGE_ARRAY_NAME_ATTRIBUTE]: "000220200269",
      [STORAGE_SYSTEM_ATTRIBUTE]: "dell.powermax",
    });
  });

  test("a resource without a well-formed identifier is dropped whole, and anything not a resource", () => {
    const payload: StorageArrayProbeMetricsPayload =
      StorageArrayProbeMetrics.prepare({
        resourceMetrics: [
          resource([]),
          resource([attribute(POWERMAX_SYMMETRIX_ID_ATTRIBUTE, "")]),
          resource([
            attribute(POWERMAX_SYMMETRIX_ID_ATTRIBUTE, "../../etc/passwd"),
          ]),
          resource([
            attribute(POWERMAX_SYMMETRIX_ID_ATTRIBUTE, "x".repeat(65)),
          ]),
          { resource: { attributes: [] } },
          "garbage",
          null,
          resource([
            attribute(POWERMAX_SYMMETRIX_ID_ATTRIBUTE, " 000220200269 "),
          ]),
        ] as unknown as JSONArray,
        collector: POWERMAX_PROBE_COLLECTOR,
        namesByIdentifier: new Map(),
      });

    expect(payload.arrayIdentifiers).toEqual(["000220200269"]);
    expect(payload.resourceCount).toBe(1);
  });

  test("a payload that is no list is nothing", () => {
    for (const resourceMetrics of [undefined, null, {}, "x"]) {
      expect(
        StorageArrayProbeMetrics.prepare({
          resourceMetrics,
          collector: POWERMAX_PROBE_COLLECTOR,
          namesByIdentifier: new Map(),
        }),
      ).toEqual({
        resourceMetrics: [],
        resourceCount: 0,
        datapointCount: 0,
        arrayIdentifiers: [],
      });
    }
  });

  test("an array sent twice is one identifier", () => {
    const payload: StorageArrayProbeMetricsPayload =
      StorageArrayProbeMetrics.prepare({
        resourceMetrics: [
          resource([
            attribute(POWERMAX_SYMMETRIX_ID_ATTRIBUTE, "000220200269"),
          ]),
          resource([
            attribute(POWERMAX_SYMMETRIX_ID_ATTRIBUTE, "000220200269"),
          ]),
        ],
        collector: POWERMAX_PROBE_COLLECTOR,
        namesByIdentifier: new Map(),
      });
    expect(payload.arrayIdentifiers).toEqual(["000220200269"]);
    expect(payload.resourceCount).toBe(2);
  });
});

describe("StorageArrayProbeMetrics.getArrayIdentifiers", () => {
  test("lists the well-formed identifiers once, in order", () => {
    expect(
      StorageArrayProbeMetrics.getArrayIdentifiers({
        resourceMetrics: [
          resource([
            attribute(POWERMAX_SYMMETRIX_ID_ATTRIBUTE, "000297900330"),
          ]),
          resource([attribute("other", "000220200269")]),
          resource([
            attribute(POWERMAX_SYMMETRIX_ID_ATTRIBUTE, "000220200269"),
          ]),
          resource([
            attribute(POWERMAX_SYMMETRIX_ID_ATTRIBUTE, "000297900330"),
          ]),
        ],
        collector: POWERMAX_PROBE_COLLECTOR,
      }),
    ).toEqual(["000297900330", "000220200269"]);
    expect(
      StorageArrayProbeMetrics.getArrayIdentifiers({
        resourceMetrics: "nope",
        collector: POWERMAX_PROBE_COLLECTOR,
      }),
    ).toEqual([]);
  });
});
