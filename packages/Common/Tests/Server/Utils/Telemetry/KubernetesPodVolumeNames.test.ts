import {
  KUBERNETES_POD_VOLUME_ATTRIBUTE_NAMES,
  KUBERNETES_POD_VOLUME_METRIC_NAMES,
  fileKubernetesPodVolumeUnderReceiverNames,
} from "../../../../Server/Utils/Telemetry/KubernetesPodVolumeNames";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A pod's volume as semantic conventions name it (#10055), filed under the
 * names OneUptime reads: semantic-conventions#4272 renamed k8s.volume.name and
 * k8s.volume.type to k8s.pod.volume.name and k8s.pod.volume.type, and names
 * the series k8s.pod.volume.*; the kubelet receiver is to follow, and may send
 * both names for a while.
 */

const SCOPE: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/kubeletstatsreceiver";
const TIME: string = "1794996000000000000";

function attribute(key: string, value: string): JSONObject {
  return { key, value: { stringValue: value } };
}

function gauge(name: string, value: number, unit: string = "By"): JSONObject {
  return {
    name,
    unit,
    gauge: { dataPoints: [{ timeUnixNano: TIME, asInt: String(value) }] },
  };
}

// An up-down counter, as semantic conventions define the volume series.
function upDownCounter(
  name: string,
  value: number,
  unit: string = "By",
): JSONObject {
  return {
    name,
    unit,
    sum: {
      aggregationTemporality: 2,
      isMonotonic: false,
      dataPoints: [
        {
          startTimeUnixNano: "1794995000000000000",
          timeUnixNano: TIME,
          asInt: String(value),
        },
      ],
    },
  };
}

function resource(
  attributes: Array<[string, string]>,
  ...scopes: Array<Array<JSONObject>>
): JSONObject {
  return {
    resource: {
      attributes: [
        attribute("k8s.namespace.name", "web"),
        attribute("k8s.pod.name", "web-0"),
        ...attributes.map(([key, value]: [string, string]): JSONObject => {
          return attribute(key, value);
        }),
      ],
    },
    scopeMetrics: scopes.map((metrics: Array<JSONObject>): JSONObject => {
      return { scope: { name: SCOPE }, metrics };
    }),
  };
}

function attributesOf(resourceMetric: JSONObject): Record<string, string> {
  const pairs: Array<[string, string]> = (
    (resourceMetric["resource"] as JSONObject)["attributes"] as JSONArray
  ).map((entry: unknown): [string, string] => {
    const item: JSONObject = entry as JSONObject;
    return [
      item["key"] as string,
      (item["value"] as JSONObject)["stringValue"] as string,
    ];
  });
  return Object.fromEntries(pairs);
}

function keysOf(resourceMetric: JSONObject): Array<string> {
  return (
    (resourceMetric["resource"] as JSONObject)["attributes"] as JSONArray
  ).map((entry: unknown): string => {
    return (entry as JSONObject)["key"] as string;
  });
}

function metricsOf(resourceMetric: JSONObject): Array<JSONObject> {
  return (resourceMetric["scopeMetrics"] as JSONArray).flatMap(
    (scope: unknown): Array<JSONObject> => {
      return (scope as JSONObject)["metrics"] as Array<JSONObject>;
    },
  );
}

function namesOf(resourceMetric: JSONObject): Array<string> {
  return metricsOf(resourceMetric).map((metric: JSONObject): string => {
    return metric["name"] as string;
  });
}

const RECEIVER_READINGS: Array<JSONObject> = [
  gauge("k8s.volume.available", 4096),
  gauge("k8s.volume.capacity", 10240),
  gauge("k8s.volume.inodes", 1000, "1"),
  gauge("k8s.volume.inodes.free", 900, "1"),
  gauge("k8s.volume.inodes.used", 100, "1"),
];

const SEMCONV_READINGS: Array<JSONObject> = [
  upDownCounter("k8s.pod.volume.available", 4096),
  upDownCounter("k8s.pod.volume.capacity", 10240),
  upDownCounter("k8s.pod.volume.inode.count", 1000, "{inode}"),
  upDownCounter("k8s.pod.volume.inode.free", 900, "{inode}"),
  upDownCounter("k8s.pod.volume.inode.used", 100, "{inode}"),
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("the names it files a pod's volume under", () => {
  test("each attribute semantic conventions rename, under the receiver's name", () => {
    expect(KUBERNETES_POD_VOLUME_ATTRIBUTE_NAMES).toEqual({
      "k8s.pod.volume.name": "k8s.volume.name",
      "k8s.pod.volume.type": "k8s.volume.type",
    });
  });

  test("each series semantic conventions name, under the receiver's name and unit", () => {
    expect(KUBERNETES_POD_VOLUME_METRIC_NAMES).toEqual({
      "k8s.pod.volume.available": { name: "k8s.volume.available", unit: "By" },
      "k8s.pod.volume.capacity": { name: "k8s.volume.capacity", unit: "By" },
      "k8s.pod.volume.inode.count": { name: "k8s.volume.inodes", unit: "1" },
      "k8s.pod.volume.inode.free": {
        name: "k8s.volume.inodes.free",
        unit: "1",
      },
      "k8s.pod.volume.inode.used": {
        name: "k8s.volume.inodes.used",
        unit: "1",
      },
    });
    // k8s.pod.volume.usage has no other name, so it is no rename.
    expect(KUBERNETES_POD_VOLUME_METRIC_NAMES).not.toHaveProperty(
      "k8s.pod.volume.usage",
    );
  });
});

describe("a volume the receiver names, as collector 0.165.0 sends it", () => {
  test("goes on exactly as it came", () => {
    const sent: JSONObject = resource(
      [
        ["k8s.volume.name", "data"],
        ["k8s.volume.type", "persistentVolumeClaim"],
        ["k8s.persistentvolumeclaim.name", "data-web-0"],
      ],
      clone(RECEIVER_READINGS),
    );
    const before: string = JSON.stringify(sent);

    expect(fileKubernetesPodVolumeUnderReceiverNames(sent)).toBe(false);
    expect(JSON.stringify(sent)).toBe(before);
  });

  test("and so does a resource that is no volume's", () => {
    const node: JSONObject = resource(
      [["k8s.node.name", "node-1"]],
      [gauge("k8s.node.filesystem.available", 1)],
    );
    const before: string = JSON.stringify(node);

    expect(fileKubernetesPodVolumeUnderReceiverNames(node)).toBe(false);
    expect(JSON.stringify(node)).toBe(before);
    expect(fileKubernetesPodVolumeUnderReceiverNames(null)).toBe(false);
    expect(fileKubernetesPodVolumeUnderReceiverNames(undefined)).toBe(false);
    expect(fileKubernetesPodVolumeUnderReceiverNames({})).toBe(false);
  });
});

describe("a volume semantic conventions name", () => {
  test("takes the receiver's name and type too, and keeps its own", () => {
    const sent: JSONObject = resource(
      [
        ["k8s.pod.volume.name", "data"],
        ["k8s.pod.volume.type", "persistentVolumeClaim"],
        ["k8s.persistentvolumeclaim.name", "data-web-0"],
      ],
      clone(RECEIVER_READINGS),
    );

    expect(fileKubernetesPodVolumeUnderReceiverNames(sent)).toBe(true);
    expect(attributesOf(sent)).toEqual({
      "k8s.namespace.name": "web",
      "k8s.pod.name": "web-0",
      "k8s.pod.volume.name": "data",
      "k8s.pod.volume.type": "persistentVolumeClaim",
      "k8s.persistentvolumeclaim.name": "data-web-0",
      "k8s.volume.name": "data",
      "k8s.volume.type": "persistentVolumeClaim",
    });
    // Its readings, already under the receiver's names, are left alone.
    expect(namesOf(sent)).toEqual(
      RECEIVER_READINGS.map((metric: JSONObject): string => {
        return metric["name"] as string;
      }),
    );
  });

  test("an untyped one takes a name and no type, as the receiver would send it", () => {
    const sent: JSONObject = resource(
      [["k8s.pod.volume.name", "scratch"]],
      clone(RECEIVER_READINGS),
    );

    fileKubernetesPodVolumeUnderReceiverNames(sent);

    expect(attributesOf(sent)["k8s.volume.name"]).toBe("scratch");
    expect(keysOf(sent)).not.toContain("k8s.volume.type");
  });

  test("sent under both names that differ, takes semantic conventions' type: the pod spec's", () => {
    // A receiver that reads the PersistentVolume names the disk's type.
    const sent: JSONObject = resource(
      [
        ["k8s.volume.name", "data"],
        ["k8s.volume.type", "awsElasticBlockStore"],
        ["k8s.pod.volume.name", "data"],
        ["k8s.pod.volume.type", "persistentVolumeClaim"],
      ],
      clone(RECEIVER_READINGS),
    );

    expect(fileKubernetesPodVolumeUnderReceiverNames(sent)).toBe(true);
    expect(attributesOf(sent)["k8s.volume.type"]).toBe("persistentVolumeClaim");
    // Once each: the receiver's name is replaced, never added beside.
    expect(
      keysOf(sent).filter((key: string): boolean => {
        return key === "k8s.volume.type";
      }),
    ).toHaveLength(1);
  });

  test("sent under both names that agree, is left as it came", () => {
    const sent: JSONObject = resource(
      [
        ["k8s.volume.name", "data"],
        ["k8s.volume.type", "emptyDir"],
        ["k8s.pod.volume.name", "data"],
        ["k8s.pod.volume.type", "emptyDir"],
      ],
      clone(RECEIVER_READINGS),
    );
    const before: string = JSON.stringify(sent);

    expect(fileKubernetesPodVolumeUnderReceiverNames(sent)).toBe(false);
    expect(JSON.stringify(sent)).toBe(before);
  });

  test("an attribute of no string value names nothing", () => {
    const sent: JSONObject = resource([], clone(RECEIVER_READINGS));
    ((sent["resource"] as JSONObject)["attributes"] as Array<JSONObject>).push(
      { key: "k8s.pod.volume.name", value: { intValue: "3" } },
      { key: "k8s.pod.volume.type", value: { stringValue: "  " } },
    );

    fileKubernetesPodVolumeUnderReceiverNames(sent);

    expect(keysOf(sent)).not.toContain("k8s.volume.name");
    expect(keysOf(sent)).not.toContain("k8s.volume.type");
  });
});

describe("its readings under semantic conventions' names", () => {
  test("are stored under the receiver's, each a gauge of the same points in its unit", () => {
    const sent: JSONObject = resource(
      [
        ["k8s.pod.volume.name", "data"],
        ["k8s.pod.volume.type", "persistentVolumeClaim"],
        ["k8s.persistentvolumeclaim.name", "data-web-0"],
      ],
      clone(SEMCONV_READINGS),
    );

    expect(fileKubernetesPodVolumeUnderReceiverNames(sent)).toBe(true);
    const metrics: Array<JSONObject> = metricsOf(sent);
    expect(
      metrics.map((metric: JSONObject): string => {
        return `${metric["name"]} ${metric["unit"]}`;
      }),
    ).toEqual([
      "k8s.volume.available By",
      "k8s.volume.capacity By",
      "k8s.volume.inodes 1",
      "k8s.volume.inodes.free 1",
      "k8s.volume.inodes.used 1",
    ]);
    for (const metric of metrics) {
      expect(metric["sum"]).toBeUndefined();
      expect(
        ((metric["gauge"] as JSONObject)["dataPoints"] as JSONArray).length,
      ).toBe(1);
    }
    expect(
      ((metrics[0]!["gauge"] as JSONObject)["dataPoints"] as JSONArray)[0],
    ).toEqual({
      startTimeUnixNano: "1794995000000000000",
      timeUnixNano: TIME,
      asInt: "4096",
    });
  });

  test("sent under both names, are stored once, under the receiver's: nothing counts them twice", () => {
    const sent: JSONObject = resource(
      [
        ["k8s.volume.name", "data"],
        ["k8s.pod.volume.name", "data"],
      ],
      [...clone(RECEIVER_READINGS), ...clone(SEMCONV_READINGS)],
    );

    expect(fileKubernetesPodVolumeUnderReceiverNames(sent)).toBe(true);
    expect(namesOf(sent)).toEqual([
      "k8s.volume.available",
      "k8s.volume.capacity",
      "k8s.volume.inodes",
      "k8s.volume.inodes.free",
      "k8s.volume.inodes.used",
    ]);
    // The receiver's own points, as they came.
    expect(metricsOf(sent)).toEqual(clone(RECEIVER_READINGS));
  });

  test("and so when the two names come in different scopes of the resource", () => {
    const sent: JSONObject = resource(
      [["k8s.pod.volume.name", "data"]],
      clone(SEMCONV_READINGS),
      clone(RECEIVER_READINGS),
    );

    fileKubernetesPodVolumeUnderReceiverNames(sent);

    expect(
      ((sent["scopeMetrics"] as JSONArray)[0] as JSONObject)["metrics"],
    ).toEqual([]);
    expect(namesOf(sent)).toEqual(
      RECEIVER_READINGS.map((metric: JSONObject): string => {
        return metric["name"] as string;
      }),
    );
  });

  test("one sent twice under semantic conventions' name alone is the same reading twice too", () => {
    const sent: JSONObject = resource(
      [["k8s.pod.volume.name", "data"]],
      [
        upDownCounter("k8s.pod.volume.available", 4096),
        upDownCounter("k8s.pod.volume.available", 4096),
      ],
    );

    fileKubernetesPodVolumeUnderReceiverNames(sent);

    expect(namesOf(sent)).toEqual(["k8s.volume.available"]);
  });

  test("leave k8s.pod.volume.usage, which has no other name, and every other series, as they came", () => {
    const usage: JSONObject = upDownCounter("k8s.pod.volume.usage", 6144);
    const other: JSONObject = gauge("k8s.pod.memory.usage", 1);
    const sent: JSONObject = resource(
      [["k8s.pod.volume.name", "data"]],
      [
        clone(usage),
        upDownCounter("k8s.pod.volume.capacity", 10240),
        clone(other),
      ],
    );

    fileKubernetesPodVolumeUnderReceiverNames(sent);

    expect(metricsOf(sent)).toEqual(
      [usage, gauge("k8s.volume.capacity", 10240), other].map(
        (metric: JSONObject, index: number): JSONObject => {
          // The renamed one keeps its start time.
          if (index === 1) {
            return {
              name: "k8s.volume.capacity",
              unit: "By",
              gauge: {
                dataPoints: [
                  {
                    startTimeUnixNano: "1794995000000000000",
                    timeUnixNano: TIME,
                    asInt: "10240",
                  },
                ],
              },
            };
          }
          return metric;
        },
      ),
    );
  });

  test("are filed under the receiver's names even on a resource that names the volume no way", () => {
    const sent: JSONObject = resource([], clone(SEMCONV_READINGS));

    expect(fileKubernetesPodVolumeUnderReceiverNames(sent)).toBe(true);
    expect(namesOf(sent)[0]).toBe("k8s.volume.available");
  });

  test("a gauge under semantic conventions' name stays a gauge", () => {
    const sent: JSONObject = resource(
      [["k8s.pod.volume.name", "data"]],
      [gauge("k8s.pod.volume.available", 4096)],
    );

    fileKubernetesPodVolumeUnderReceiverNames(sent);

    expect(metricsOf(sent)).toEqual([gauge("k8s.volume.available", 4096)]);
  });
});
