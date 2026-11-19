import { withoutStreamedMetrics } from "../../../../Server/Utils/CloudConnection/CloudStreamedMetrics";
import {
  CLOUD_STREAM_ACTIVE_WINDOW_MS,
  CloudStreamMetricSource,
} from "../../../../Types/CloudConnection/CloudStream";
import {
  AwsStreamCoverage,
  getAwsStreamCoverage,
} from "../../../../Types/CloudConnection/CloudStreamStack";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A read of an AWS connection leaves out of what it writes each key metric
 * a stream writes in its place: one the stream's stack carries, of an
 * account, Region and namespace it delivered lately - and only those.
 * Another account's, another Region's and another namespace's are written
 * as before, so is a daily metric no stream carries, and so is a key
 * metric added since the stack's template: a stack made from template 1
 * does not carry it. What the read is handed is never changed: its
 * readings still read all of it.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const ACCOUNT: string = "123456789012";

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
// Added since streams began: carried from template 2 on.
const CREDITS: string = "amazonaws.com/AWS/EC2/CPUCreditBalance";
const EBS: string = "amazonaws.com/AWS/EC2/EBSReadBytes";
const RDS: string = "amazonaws.com/AWS/RDS/CPUUtilization";
const S3: string = "amazonaws.com/AWS/S3/BucketSizeBytes";

const PAYLOAD: JSONObject = {
  resourceMetrics: [
    resource({
      accountId: ACCOUNT,
      region: "us-east-1",
      metrics: [
        gauge(EC2, [point("AWS/EC2", 10), point("AWS/EC2", 20)]),
        gauge(CREDITS, [point("AWS/EC2", 144)]),
        gauge(EBS, [point("AWS/EC2", 2048), point("AWS/EC2", 4096)]),
        gauge(RDS, [point("AWS/RDS")]),
        gauge(S3, [point("AWS/S3")]),
      ],
    }),
    resource({
      accountId: ACCOUNT,
      region: "eu-west-1",
      metrics: [gauge(EC2, [point("AWS/EC2")])],
    }),
  ],
} as unknown as JSONObject;

// What a stream summary says delivered lately, as the pull runner reads it.
function coverage(
  sources: Array<
    Partial<CloudStreamMetricSource> & { namespaces: Array<string> }
  >,
): AwsStreamCoverage {
  return getAwsStreamCoverage({
    summary: {
      metricSources: sources.map(
        (
          source: Partial<CloudStreamMetricSource> & {
            namespaces: Array<string>;
          },
        ): CloudStreamMetricSource => {
          return {
            accountId: ACCOUNT,
            region: "us-east-1",
            lastAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
            ...source,
          };
        },
      ),
      logSources: [],
    },
    now: NOW,
  });
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
  /*
   * A stack made before stacks said their template, or set up another way,
   * is held to template 1: it carries CPUUtilization, never CPUCreditBalance
   * or EBSReadBytes, added since - so the read keeps writing those, and
   * nothing is lost while the stack is not updated.
   */
  test("of a stack of template 1: loses what it carries, in its account, Region and namespace only, and keeps what was added since", () => {
    const before: string = JSON.stringify(PAYLOAD);
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: PAYLOAD,
        streamedKeys: new Set<string>(),
        awsCoverage: coverage([{ namespaces: ["AWS/EC2"] }]),
      });

    expect(namesOf(result.payload)).toEqual([
      `us-east-1 ${CREDITS} x1`,
      `us-east-1 ${EBS} x2`,
      `us-east-1 ${RDS} x1`,
      `us-east-1 ${S3} x1`,
      `eu-west-1 ${EC2} x1`,
    ]);
    expect(result.leftOut).toBe(2);
    // The read's own payload is unchanged: its readings read all of it.
    expect(JSON.stringify(PAYLOAD)).toBe(before);
  });

  test("of a stack of template 2: loses every key metric of the namespace a stream writes, the ones added since streams began too", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: PAYLOAD,
        streamedKeys: new Set<string>(),
        awsCoverage: coverage([
          { namespaces: ["AWS/EC2"], templateVersion: 2, everyMetric: false },
        ]),
      });

    expect(namesOf(result.payload)).toEqual([
      `us-east-1 ${RDS} x1`,
      `us-east-1 ${S3} x1`,
      `eu-west-1 ${EC2} x1`,
    ]);
    expect(result.leftOut).toBe(5);
  });

  test("of a stack of every metric: loses every key metric a stream can carry, but a daily one", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: PAYLOAD,
        streamedKeys: new Set<string>(),
        awsCoverage: coverage([
          {
            namespaces: ["AWS/EC2", "AWS/RDS", "AWS/S3"],
            templateVersion: 2,
            everyMetric: true,
          },
        ]),
      });

    // S3's daily storage never comes through a stream: the read writes it.
    expect(namesOf(result.payload)).toEqual([
      `us-east-1 ${S3} x1`,
      `eu-west-1 ${EC2} x1`,
    ]);
    expect(result.leftOut).toBe(6);
  });

  test("keeps a namespace no stream delivered lately, whatever its stack carries", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: PAYLOAD,
        streamedKeys: new Set<string>(),
        awsCoverage: coverage([
          { namespaces: ["AWS/RDS"], templateVersion: 2, everyMetric: false },
        ]),
      });

    expect(namesOf(result.payload)).toContain(`us-east-1 ${EC2} x2`);
    expect(namesOf(result.payload)).toContain(`us-east-1 ${CREDITS} x1`);
    expect(result.leftOut).toBe(1);
  });

  test("keeps everything once the stream has gone quiet", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: PAYLOAD,
        streamedKeys: new Set<string>(),
        awsCoverage: coverage([
          {
            namespaces: ["AWS/EC2"],
            templateVersion: 2,
            everyMetric: false,
            lastAt: new Date(
              NOW.getTime() - CLOUD_STREAM_ACTIVE_WINDOW_MS - 1000,
            ).toISOString(),
          },
        ]),
      });

    expect(result.payload).toBe(PAYLOAD);
    expect(result.leftOut).toBe(0);
  });

  test("is nothing to write once every datapoint is a stream's, whatever the namespace's case", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: {
          resourceMetrics: [
            resource({
              accountId: ACCOUNT,
              region: "us-east-1",
              metrics: [gauge(EC2, [point("AWS/EC2"), point("AWS/EC2")])],
            }),
          ],
        } as unknown as JSONObject,
        streamedKeys: new Set<string>(),
        awsCoverage: coverage([{ namespaces: ["aws/ec2"] }]),
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
          streamedKeys: new Set<string>(),
          awsCoverage: coverage([{ namespaces: ["AWS/EC2"] }]),
        });
      }).not.toThrow();
    }
  });
});
