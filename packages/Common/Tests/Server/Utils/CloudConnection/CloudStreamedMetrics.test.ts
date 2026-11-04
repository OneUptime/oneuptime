import { withoutStreamedMetrics } from "../../../../Server/Utils/CloudConnection/CloudStreamedMetrics";
import { getStreamedMetricKey } from "../../../../Types/CloudConnection/CloudStream";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A read of an AWS connection leaves out of what it writes the datapoints
 * of every account, Region and namespace a stream delivers lately - and
 * only those: another account's, another Region's, another namespace's and
 * a daily metric no stream carries are written as before. What it is handed
 * is never changed: its readings still read all of it.
 */

function point(namespace: string, value: number = 1): JSONObject {
  return {
    timeUnixNano: "1792584000000000000",
    asDouble: value,
    attributes: [{ key: "Namespace", value: { stringValue: namespace } }],
  } as unknown as JSONObject;
}

function resource(data: {
  accountId: string;
  region: string;
  metrics: Array<JSONObject>;
}): JSONObject {
  return {
    resource: {
      attributes: [
        { key: "service.name", value: { stringValue: "Production AWS" } },
        { key: "cloud.account.id", value: { stringValue: data.accountId } },
        { key: "cloud.region", value: { stringValue: data.region } },
      ],
    },
    scopeMetrics: [
      { scope: { name: "oneuptime-cloud-connection" }, metrics: data.metrics },
    ],
  } as unknown as JSONObject;
}

function gauge(name: string, points: Array<JSONObject>): JSONObject {
  return {
    name,
    unit: "Percent",
    gauge: { dataPoints: points },
  } as unknown as JSONObject;
}

const EC2: string = "amazonaws.com/AWS/EC2/CPUUtilization";
const RDS: string = "amazonaws.com/AWS/RDS/CPUUtilization";
const S3: string = "amazonaws.com/AWS/S3/BucketSizeBytes";

const PAYLOAD: JSONObject = {
  resourceMetrics: [
    resource({
      accountId: "123456789012",
      region: "us-east-1",
      metrics: [
        gauge(EC2, [point("AWS/EC2", 10), point("AWS/EC2", 20)]),
        gauge(RDS, [point("AWS/RDS")]),
        gauge(S3, [point("AWS/S3")]),
      ],
    }),
    resource({
      accountId: "123456789012",
      region: "eu-west-1",
      metrics: [gauge(EC2, [point("AWS/EC2")])],
    }),
  ],
} as unknown as JSONObject;

function keys(
  entries: Array<{ accountId: string; region: string; namespace: string }>,
): Set<string> {
  return new Set<string>(entries.map(getStreamedMetricKey));
}

function namesOf(payload: JSONObject | null): Array<string> {
  if (!payload) {
    return [];
  }

  const names: Array<string> = [];

  for (const resourceMetrics of payload[
    "resourceMetrics"
  ] as Array<JSONObject>) {
    const region: string = (
      (
        (resourceMetrics["resource"] as JSONObject)[
          "attributes"
        ] as Array<JSONObject>
      )[2]!["value"] as JSONObject
    )["stringValue"] as string;

    for (const scope of resourceMetrics["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        names.push(
          `${region} ${metric["name"] as string} x${
            ((metric["gauge"] as JSONObject)["dataPoints"] as Array<JSONObject>)
              .length
          }`,
        );
      }
    }
  }

  return names;
}

describe("a read's payload while a stream delivers", () => {
  test("loses the streamed namespace's datapoints in that account and Region only", () => {
    const before: string = JSON.stringify(PAYLOAD);
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: PAYLOAD,
        streamedKeys: keys([
          {
            accountId: "123456789012",
            region: "us-east-1",
            namespace: "AWS/EC2",
          },
        ]),
      });

    expect(namesOf(result.payload)).toEqual([
      `us-east-1 ${RDS} x1`,
      `us-east-1 ${S3} x1`,
      `eu-west-1 ${EC2} x1`,
    ]);
    expect(result.leftOut).toBe(2);
    // The read's own payload is unchanged: its readings read all of it.
    expect(JSON.stringify(PAYLOAD)).toBe(before);
  });

  test("keeps a daily metric even when its namespace streams: no stream carries it", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: PAYLOAD,
        streamedKeys: keys([
          {
            accountId: "123456789012",
            region: "us-east-1",
            namespace: "AWS/S3",
          },
        ]),
      });

    expect(namesOf(result.payload)).toContain(`us-east-1 ${S3} x1`);
    expect(result.leftOut).toBe(0);
  });

  test("is nothing to write once every datapoint is a stream's", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: {
          resourceMetrics: [
            resource({
              accountId: "123456789012",
              region: "us-east-1",
              metrics: [gauge(EC2, [point("AWS/EC2"), point("AWS/EC2")])],
            }),
          ],
        } as unknown as JSONObject,
        streamedKeys: keys([
          {
            accountId: "123456789012",
            region: "us-east-1",
            namespace: "aws/ec2",
          },
        ]),
      });

    expect(result).toEqual({ payload: null, leftOut: 2 });
  });

  test("is the same payload when nothing streams", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({ payload: PAYLOAD, streamedKeys: new Set() });

    expect(result.payload).toBe(PAYLOAD);
    expect(result.leftOut).toBe(0);
  });

  test("reads a payload of any shape without throwing", () => {
    for (const payload of [
      {},
      { resourceMetrics: "x" },
      { resourceMetrics: [null, 3, { scopeMetrics: [{ metrics: [null] }] }] },
    ]) {
      expect(() => {
        withoutStreamedMetrics({
          payload: payload as unknown as JSONObject,
          streamedKeys: keys([
            { accountId: "1", region: "us-east-1", namespace: "AWS/EC2" },
          ]),
        });
      }).not.toThrow();
    }
  });
});
