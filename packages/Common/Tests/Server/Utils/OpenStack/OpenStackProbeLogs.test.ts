import { describe, expect, test } from "@jest/globals";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import OpenStackProbeLogs, {
  MAX_OPENSTACK_PROBE_LOG_RECORDS,
  OpenStackProbeLogsPayload,
} from "../../../../Server/Utils/OpenStack/OpenStackProbeLogs";

/*
 * What Nova says instances went through, on its way from a probe to the log ingest. As with a
 * probe's metrics, the server and not the probe says which cloud it is of.
 */

function attribute(key: string, value: string): JSONObject {
  return { key, value: { stringValue: value } };
}

function record(body: unknown = "{}"): JSONObject {
  return {
    timeUnixNano: "1793354400000000000",
    severityNumber: 17,
    body: { stringValue: body },
  } as JSONObject;
}

function resource(
  attributes: Array<JSONObject>,
  logRecords: Array<JSONObject> = [record()],
): JSONObject {
  return {
    resource: { attributes },
    scopeLogs: [{ scope: { name: "x", version: "1" }, logRecords }],
  };
}

function prepare(resourceLogs: unknown): OpenStackProbeLogsPayload {
  return OpenStackProbeLogs.prepare({ resourceLogs, cloudName: "Lab" });
}

function attributesOf(payload: OpenStackProbeLogsPayload): Array<JSONObject> {
  const first: JSONObject = payload.resourceLogs[0] as JSONObject;

  return (first["resource"] as JSONObject)["attributes"] as Array<JSONObject>;
}

describe("which cloud it is", () => {
  test("is the server's word, whatever the probe put", () => {
    const payload: OpenStackProbeLogsPayload = prepare([
      resource([
        attribute("openstack.cloud.name", "Someone Else's"),
        attribute("openstack.region.name", "RegionOne"),
      ]),
    ]);

    expect(attributesOf(payload)).toEqual([
      attribute("openstack.region.name", "RegionOne"),
      attribute("openstack.cloud.name", "Lab"),
    ]);
  });

  test("a probe never registers a Service, nor claims to be the agent", () => {
    const keys: Array<unknown> = attributesOf(
      prepare([
        resource([
          attribute("service.name", "phantom"),
          attribute("service.instance.id", "x"),
          attribute("oneuptime.agent.version", "1"),
          attribute("oneuptime.tag", "x"),
        ]),
      ]),
    ).map((entry: JSONObject): unknown => {
      return entry["key"];
    });

    expect(keys).toEqual(["openstack.cloud.name"]);
  });

  test("no cloud's name, nothing goes", () => {
    expect(
      OpenStackProbeLogs.prepare({
        resourceLogs: [resource([])],
        cloudName: "  ",
      }),
    ).toEqual({ resourceLogs: [], recordCount: 0 });
  });
});

describe("what is kept", () => {
  test("every record whose body is text, and how many", () => {
    const payload: OpenStackProbeLogsPayload = prepare([
      resource([], [record(), record()]),
      resource([], [record()]),
    ]);

    expect(payload.recordCount).toBe(3);
    expect(payload.resourceLogs).toHaveLength(2);
  });

  test.each([
    [null],
    ["text"],
    [12],
    [{}],
    [[null, "text", 12, {}, { scopeLogs: "x" }, { scopeLogs: [null, {}] }]],
    [[{ scopeLogs: [{ logRecords: "x" }] }]],
    [[{ scopeLogs: [{ logRecords: [] }] }]],
    [
      [
        {
          scopeLogs: [
            { logRecords: [null, 1, {}, { body: "x" }, { body: {} }] },
          ],
        },
      ],
    ],
    [[{ scopeLogs: [{ logRecords: [{ body: { stringValue: 12 } }] }] }]],
  ])("nothing of %j", (resourceLogs: unknown) => {
    expect(prepare(resourceLogs)).toEqual({ resourceLogs: [], recordCount: 0 });
  });

  test("a record with no attributes of its resource still goes", () => {
    expect(
      prepare([{ scopeLogs: [{ logRecords: [record()] }] }]).recordCount,
    ).toBe(1);
  });

  test("at most so many, however many a report says", () => {
    const logRecords: JSONArray = Array.from(
      { length: MAX_OPENSTACK_PROBE_LOG_RECORDS + 50 },
      (): JSONObject => {
        return record();
      },
    );
    const payload: OpenStackProbeLogsPayload = prepare([
      resource([], logRecords as Array<JSONObject>),
      resource([], [record()]),
    ]);

    expect(payload.recordCount).toBe(MAX_OPENSTACK_PROBE_LOG_RECORDS);
    expect(payload.resourceLogs).toHaveLength(1);
  });

  test("the scope's name stays, and a scope that is not one does not", () => {
    const payload: OpenStackProbeLogsPayload = prepare([
      { scopeLogs: [{ scope: "x", logRecords: [record()] }] },
    ]);
    const scope: JSONObject = (
      (payload.resourceLogs[0] as JSONObject)["scopeLogs"] as JSONArray
    )[0] as JSONObject;

    expect(scope["scope"]).toEqual({});
  });
});
