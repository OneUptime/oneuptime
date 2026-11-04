import { describe, expect, test } from "@jest/globals";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import OpenStackProbeMetrics, {
  OpenStackProbeMetricsPayload,
} from "../../../../Server/Utils/OpenStack/OpenStackProbeMetrics";

/*
 * A probe's collection, made ready for the ingest the agent's data goes through. The server
 * says which cloud it is, not the probe, so a probe can never write into another cloud, and
 * nothing a probe sends makes it look like the agent.
 */

function resource(
  attributes: Array<JSONObject>,
  metrics: Array<JSONObject> = [],
): JSONObject {
  return {
    resource: { attributes: attributes },
    scopeMetrics: [{ scope: { name: "x" }, metrics: metrics }],
  };
}

function attribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function prepare(resourceMetrics: unknown): OpenStackProbeMetricsPayload {
  return OpenStackProbeMetrics.prepare({
    resourceMetrics: resourceMetrics,
    cloudName: "Lab",
  });
}

function attributesOf(payload: OpenStackProbeMetricsPayload): JSONArray {
  return ((payload.resourceMetrics[0] as JSONObject)["resource"] as JSONObject)[
    "attributes"
  ] as JSONArray;
}

describe("which cloud it is", () => {
  test("every resource gets this cloud's name, which is what ingest routes it by", () => {
    const payload: OpenStackProbeMetricsPayload = prepare([
      resource([]),
      resource([]),
    ]);

    expect(payload.resourceCount).toBe(2);

    for (const entry of payload.resourceMetrics) {
      expect(
        ((entry as JSONObject)["resource"] as JSONObject)["attributes"],
      ).toEqual([attribute("openstack.cloud.name", "Lab")]);
    }
  });

  test("a probe naming another cloud is not believed", () => {
    expect(
      attributesOf(
        prepare([resource([attribute("openstack.cloud.name", "Other")])]),
      ),
    ).toEqual([attribute("openstack.cloud.name", "Lab")]);
  });

  test.each([
    ["service.name", "registers a phantom Service"],
    ["service.instance.id", "registers a phantom Service"],
    ["oneuptime.agent.version", "claims to be the agent"],
    ["oneuptime.anything", "tags labels"],
  ])("%s is dropped: a probe never %s", (key: string) => {
    expect(attributesOf(prepare([resource([attribute(key, "x")])]))).toEqual([
      attribute("openstack.cloud.name", "Lab"),
    ]);
  });

  test("anything else it put on a resource stays", () => {
    expect(
      attributesOf(prepare([resource([attribute("custom.thing", "x")])])),
    ).toEqual([
      attribute("custom.thing", "x"),
      attribute("openstack.cloud.name", "Lab"),
    ]);
  });
});

describe("what is not the shape the ingest expects", () => {
  test.each([
    ["nothing", undefined],
    ["null", null],
    ["text", "metrics"],
    ["an object", { resource: {} }],
  ])("%s becomes nothing", (_name: string, value: unknown) => {
    expect(prepare(value)).toEqual({
      resourceMetrics: [],
      resourceCount: 0,
      datapointCount: 0,
    });
  });

  test("a cloud with no name has nothing to send under", () => {
    expect(
      OpenStackProbeMetrics.prepare({
        resourceMetrics: [resource([])],
        cloudName: "   ",
      }).resourceMetrics,
    ).toEqual([]);
  });

  test.each([
    ["not an object", 7],
    ["null", null],
    ["a list", []],
    ["with no scopes", { resource: { attributes: [] } }],
    ["with scopes that are not a list", { scopeMetrics: {} }],
  ])(
    "an entry %s is dropped, and the rest kept",
    (_name: string, entry: unknown) => {
      expect(prepare([entry, resource([])]).resourceCount).toBe(1);
    },
  );

  test("an entry with no resource still gets the cloud's name", () => {
    expect(attributesOf(prepare([{ scopeMetrics: [] }]))).toEqual([
      attribute("openstack.cloud.name", "Lab"),
    ]);
  });

  test("attributes that are not attributes are dropped", () => {
    expect(
      attributesOf(
        prepare([
          {
            resource: { attributes: [7, null, { key: 1 }, { value: "x" }] },
            scopeMetrics: [],
          },
        ]),
      ),
    ).toEqual([attribute("openstack.cloud.name", "Lab")]);
  });
});

describe("how much it is", () => {
  test("gauges and sums are counted, by datapoint", () => {
    const payload: OpenStackProbeMetricsPayload = prepare([
      resource(
        [],
        [
          { name: "a", gauge: { dataPoints: [{}, {}] } },
          { name: "b", sum: { dataPoints: [{}] } },
        ],
      ),
      resource([], [{ name: "c", gauge: { dataPoints: [{}] } }]),
    ]);

    expect(payload.datapointCount).toBe(4);
  });

  test("what cannot be counted is not, and does not stop the rest", () => {
    expect(
      prepare([
        {
          scopeMetrics: [
            7,
            { metrics: "no" },
            {
              metrics: [
                7,
                { gauge: 7 },
                { gauge: { dataPoints: "no" } },
                { gauge: { dataPoints: [{}] } },
              ],
            },
          ],
        },
      ]).datapointCount,
    ).toBe(1);
  });

  test("the datapoints themselves are passed on untouched", () => {
    const metrics: Array<JSONObject> = [
      {
        name: "openstack_nova_up",
        gauge: {
          dataPoints: [
            {
              asDouble: 1,
              attributes: [attribute("openstack.region.name", "RegionOne")],
            },
          ],
        },
      },
    ];

    expect(
      (prepare([resource([], metrics)]).resourceMetrics[0] as JSONObject)[
        "scopeMetrics"
      ],
    ).toEqual([{ scope: { name: "x" }, metrics: metrics }]);
  });
});
