import { describe, expect, test } from "@jest/globals";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import VMwareProbeMetrics, {
  VMwareProbeMetricsPayload,
} from "../../../../Server/Utils/VMware/VMwareProbeMetrics";

/*
 * A probe's collection, made ready for the ingest the VMware agent's data
 * goes through: the server - never the probe - says which vCenter it is.
 */

function resource(
  attributes: Array<[string, string]>,
  dataPoints: number = 1,
): JSONObject {
  return {
    resource: {
      attributes: attributes.map(([key, value]: [string, string]) => {
        return { key: key, value: { stringValue: value } };
      }),
    },
    scopeMetrics: [
      {
        scope: { name: "oneuptime-probe-vmware", version: "1" },
        metrics: [
          {
            name: "vcenter.host.cpu.usage",
            unit: "MHz",
            sum: {
              dataPoints: Array.from({ length: dataPoints }, () => {
                return { asInt: "5", timeUnixNano: "1" };
              }),
              aggregationTemporality: 2,
            },
          },
          {
            name: "vcenter.host.cpu.utilization",
            unit: "%",
            gauge: { dataPoints: [{ asDouble: 12.5, timeUnixNano: "1" }] },
          },
        ],
      },
    ],
  };
}

function attributesOf(entry: JSONObject): Record<string, string> {
  const map: Record<string, string> = {};

  for (const attribute of (entry["resource"] as JSONObject)[
    "attributes"
  ] as Array<JSONObject>) {
    map[attribute["key"] as string] = (attribute["value"] as JSONObject)[
      "stringValue"
    ] as string;
  }

  return map;
}

describe("VMwareProbeMetrics.prepare", () => {
  test("names every resource's vCenter, keeping the vSphere identity as the probe sent it", () => {
    const payload: VMwareProbeMetricsPayload = VMwareProbeMetrics.prepare({
      resourceMetrics: [
        resource([
          ["vcenter.datacenter.name", "DC1"],
          ["vcenter.host.name", "esx-01"],
        ]),
      ],
      vcenterName: "Production vCenter",
    });

    expect(payload.resourceCount).toBe(1);
    expect(payload.datapointCount).toBe(2);
    expect(
      ((payload.resourceMetrics[0] as JSONObject)["resource"] as JSONObject)[
        "attributes"
      ],
    ).toEqual([
      { key: "vcenter.datacenter.name", value: { stringValue: "DC1" } },
      { key: "vcenter.host.name", value: { stringValue: "esx-01" } },
      {
        key: "vmware.vcenter.name",
        value: { stringValue: "Production vCenter" },
      },
    ]);
  });

  test("a probe never names another vCenter, registers a Service, claims to be the agent or tags labels", () => {
    const payload: VMwareProbeMetricsPayload = VMwareProbeMetrics.prepare({
      resourceMetrics: [
        resource([
          ["vmware.vcenter.name", "Someone else's vCenter"],
          ["service.name", "phantom"],
          ["service.namespace", "x"],
          ["oneuptime.agent.version", "9.9.9"],
          ["oneuptime.label.team", "spoofed"],
          ["vcenter.host.name", "esx-01"],
        ]),
      ],
      vcenterName: "Production vCenter",
    });

    expect(attributesOf(payload.resourceMetrics[0] as JSONObject)).toEqual({
      "vcenter.host.name": "esx-01",
      "vmware.vcenter.name": "Production vCenter",
    });
  });

  test("keeps the metrics as they came, and counts datapoints of sums and gauges", () => {
    const sent: JSONObject = resource([["vcenter.host.name", "esx-01"]], 3);
    const payload: VMwareProbeMetricsPayload = VMwareProbeMetrics.prepare({
      resourceMetrics: [sent, resource([["vcenter.host.name", "esx-02"]])],
      vcenterName: "vc",
    });

    expect((payload.resourceMetrics[0] as JSONObject)["scopeMetrics"]).toBe(
      sent["scopeMetrics"],
    );
    expect(payload.datapointCount).toBe(4 + 2);
  });

  test("anything that is not an OTLP resource is dropped", () => {
    const payload: VMwareProbeMetricsPayload = VMwareProbeMetrics.prepare({
      resourceMetrics: [
        null,
        "text",
        7,
        [],
        { resource: { attributes: [] } },
        { scopeMetrics: "not an array" },
        { resource: "x", scopeMetrics: [] },
        {
          resource: { attributes: [{ key: 7 }, "x", null] },
          scopeMetrics: [{ metrics: [null, { name: "m", sum: "x" }] }, 5],
        },
      ] as unknown as JSONArray,
      vcenterName: "vc",
    });

    // The two entries with scopeMetrics arrays are kept - with only the name added.
    expect(payload.resourceCount).toBe(2);
    expect(payload.datapointCount).toBe(0);
    for (const entry of payload.resourceMetrics as Array<JSONObject>) {
      expect(attributesOf(entry)).toEqual({ "vmware.vcenter.name": "vc" });
    }
  });

  test("no resources, or no vCenter name, is nothing to ingest", () => {
    expect(
      VMwareProbeMetrics.prepare({ resourceMetrics: "x", vcenterName: "vc" }),
    ).toEqual({ resourceMetrics: [], resourceCount: 0, datapointCount: 0 });
    expect(
      VMwareProbeMetrics.prepare({
        resourceMetrics: [resource([["vcenter.host.name", "esx-01"]])],
        vcenterName: "  ",
      }),
    ).toEqual({ resourceMetrics: [], resourceCount: 0, datapointCount: 0 });
  });
});
