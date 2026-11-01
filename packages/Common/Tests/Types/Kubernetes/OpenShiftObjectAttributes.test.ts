import { JSONObject } from "../../../Types/JSON";
import {
  OPENSHIFT_STATUS_RESOURCE_TYPES,
  OpenShiftObjectAttribute,
  getOpenShiftStatusLogAttributes,
  isOpenShiftStatusLogRecord,
} from "../../../Types/Kubernetes/OpenShiftObjectAttributes";
import KubernetesEventAttribute from "../../../Types/Kubernetes/KubernetesEvent";
import {
  PlainValue,
  toOtlpAnyValue,
} from "../../Helpers/KubernetesEventRecords";
import { describe, expect, test } from "@jest/globals";

/*
 * Ingest stamps the log record of a pulled ClusterOperator or ClusterVersion
 * with the attributes the OpenShift alert templates filter on: the object,
 * one word for its state, its conditions' statuses and its versions. These
 * pin the keys (stored in customers' logs and monitors: never renamed), what
 * each object is stamped with, and that nothing else is stamped.
 */

function asKvList(object: PlainValue): JSONObject {
  return toOtlpAnyValue(object)["kvlistValue"] as JSONObject;
}

function stamp(
  resourceName: string,
  object: PlainValue,
): Record<string, string> {
  return getOpenShiftStatusLogAttributes({
    attributes: { "k8s.resource.name": resourceName },
    objectKvList: asKvList(object),
  });
}

function operator(
  name: string,
  statuses: Record<string, string>,
  versions: Array<{ name: string; version: string }> = [
    { name: "operator", version: "4.18.12" },
  ],
): PlainValue {
  return {
    apiVersion: "config.openshift.io/v1",
    kind: "ClusterOperator",
    metadata: { name: name },
    status: {
      conditions: Object.keys(statuses).map((type: string) => {
        return { type: type, status: statuses[type]!, reason: "AsExpected" };
      }),
      versions: versions,
    },
  };
}

describe("the attribute keys", () => {
  test("are the ones monitors filter on, never renamed", () => {
    expect({ ...OpenShiftObjectAttribute }).toEqual({
      ResourceName: "k8s.resource.name",
      ObjectKind: "k8s.object.kind",
      ObjectName: "k8s.object.name",
      State: "openshift.state",
      Available: "openshift.condition.available",
      Degraded: "openshift.condition.degraded",
      Progressing: "openshift.condition.progressing",
      Upgradeable: "openshift.condition.upgradeable",
      Failing: "openshift.condition.failing",
      CurrentVersion: "openshift.version.current",
      DesiredVersion: "openshift.version.desired",
    });
  });

  test("name the object the way Kubernetes Event records do", () => {
    expect(OpenShiftObjectAttribute.ResourceName).toBe(
      KubernetesEventAttribute.ResourceName,
    );
    expect(OpenShiftObjectAttribute.ObjectKind).toBe(
      KubernetesEventAttribute.ObjectKind,
    );
    expect(OpenShiftObjectAttribute.ObjectName).toBe(
      KubernetesEventAttribute.ObjectName,
    );
  });
});

describe("isOpenShiftStatusLogRecord", () => {
  test.each(["clusteroperators", "clusterversions", " ClusterOperators "])(
    "is true for a %j record",
    (resourceName: string) => {
      expect(
        isOpenShiftStatusLogRecord({ "k8s.resource.name": resourceName }),
      ).toBe(true);
    },
  );

  test.each([
    "events",
    "pods",
    "routes",
    "deploymentconfigs",
    "",
    "constructor",
  ])("is false for a %j record", (resourceName: string) => {
    expect(
      isOpenShiftStatusLogRecord({ "k8s.resource.name": resourceName }),
    ).toBe(false);
  });

  test("is false without attributes, or with a resource name that is not text", () => {
    expect(isOpenShiftStatusLogRecord(null)).toBe(false);
    expect(isOpenShiftStatusLogRecord(undefined)).toBe(false);
    expect(isOpenShiftStatusLogRecord({})).toBe(false);
    expect(isOpenShiftStatusLogRecord({ "k8s.resource.name": 7 })).toBe(false);
  });

  test("covers the two kinds it stamps", () => {
    expect(OPENSHIFT_STATUS_RESOURCE_TYPES).toEqual([
      "clusteroperators",
      "clusterversions",
    ]);
  });
});

describe("a ClusterOperator's record", () => {
  test("a healthy operator: its name, Available, and every condition it reports", () => {
    expect(
      stamp(
        "clusteroperators",
        operator("authentication", {
          Available: "True",
          Progressing: "False",
          Degraded: "False",
          Upgradeable: "True",
        }),
      ),
    ).toEqual({
      "k8s.object.kind": "ClusterOperator",
      "k8s.object.name": "authentication",
      "openshift.state": "Available",
      "openshift.condition.available": "True",
      "openshift.condition.progressing": "False",
      "openshift.condition.degraded": "False",
      "openshift.condition.upgradeable": "True",
      "openshift.version.current": "4.18.12",
    });
  });

  test("a degraded operator says so, which the degraded template filters on", () => {
    const attributes: Record<string, string> = stamp(
      "clusteroperators",
      operator("ingress", { Available: "True", Degraded: "True" }),
    );

    expect(attributes["openshift.state"]).toBe("Degraded");
    expect(attributes["openshift.condition.degraded"]).toBe("True");
  });

  test("an unavailable operator says so, which the unavailable template filters on", () => {
    const attributes: Record<string, string> = stamp(
      "clusteroperators",
      operator("console", { Available: "False", Degraded: "False" }),
    );

    expect(attributes["openshift.state"]).toBe("Unavailable");
    expect(attributes["openshift.condition.available"]).toBe("False");
  });

  test("a condition it does not report is not stamped, not as an empty value", () => {
    const attributes: Record<string, string> = stamp(
      "clusteroperators",
      operator("dns", { Available: "True" }),
    );

    expect(attributes).not.toHaveProperty("openshift.condition.degraded");
    expect(attributes).not.toHaveProperty("openshift.condition.upgradeable");
    for (const value of Object.values(attributes)) {
      expect(value).not.toBe("");
    }
  });

  test("its own version is the operator's, not an operand's", () => {
    const attributes: Record<string, string> = stamp(
      "clusteroperators",
      operator("kube-apiserver", { Available: "True" }, [
        { name: "raw-internal", version: "4.18.12" },
        { name: "kube-apiserver", version: "1.31.6" },
        { name: "operator", version: "4.18.12" },
      ]),
    );

    expect(attributes["openshift.version.current"]).toBe("4.18.12");
  });

  test("an operator without an operator version stamps none", () => {
    const attributes: Record<string, string> = stamp(
      "clusteroperators",
      operator("insights", { Available: "True" }, []),
    );

    expect(attributes).not.toHaveProperty("openshift.version.current");
  });
});

describe("a ClusterVersion's record", () => {
  function clusterVersion(statuses: Record<string, string>): PlainValue {
    return {
      kind: "ClusterVersion",
      metadata: { name: "version" },
      spec: { channel: "stable-4.18" },
      status: {
        desired: { version: "4.18.13" },
        history: [
          { version: "4.18.13", state: "Partial" },
          { version: "4.18.12", state: "Completed" },
        ],
        conditions: Object.keys(statuses).map((type: string) => {
          return { type: type, status: statuses[type]! };
        }),
      },
    };
  }

  test("an update under way: Updating, the version it runs and the one it moves to", () => {
    expect(
      stamp(
        "clusterversions",
        clusterVersion({
          Available: "True",
          Failing: "False",
          Progressing: "True",
        }),
      ),
    ).toEqual({
      "k8s.object.kind": "ClusterVersion",
      "k8s.object.name": "version",
      "openshift.state": "Updating",
      "openshift.condition.available": "True",
      "openshift.condition.failing": "False",
      "openshift.condition.progressing": "True",
      "openshift.version.current": "4.18.12",
      "openshift.version.desired": "4.18.13",
    });
  });

  test("a failing update says so, which the upgrade template filters on", () => {
    const attributes: Record<string, string> = stamp(
      "clusterversions",
      clusterVersion({
        Available: "True",
        Failing: "True",
        Progressing: "True",
      }),
    );

    expect(attributes["openshift.state"]).toBe("Failing");
    expect(attributes["openshift.condition.failing"]).toBe("True");
  });

  test("a ClusterVersion is never stamped as degraded: it has no such condition", () => {
    const attributes: Record<string, string> = stamp(
      "clusterversions",
      clusterVersion({ Available: "True", Degraded: "True" }),
    );

    expect(attributes).not.toHaveProperty("openshift.condition.degraded");
  });
});

describe("what gets no attributes", () => {
  test("a record of another resource type, even one that parses", () => {
    for (const resourceName of [
      "routes",
      "deploymentconfigs",
      "pods",
      "events",
    ]) {
      expect(
        stamp(resourceName, operator("authentication", { Available: "True" })),
      ).toEqual({});
    }
  });

  test("a record without an object", () => {
    expect(
      getOpenShiftStatusLogAttributes({
        attributes: { "k8s.resource.name": "clusteroperators" },
        objectKvList: null,
      }),
    ).toEqual({});
  });

  test("an object that does not parse, or has no name", () => {
    expect(stamp("clusteroperators", { kind: "ClusterOperator" })).toEqual({});
    expect(
      stamp("clusteroperators", { kind: "ClusterOperator", metadata: {} }),
    ).toEqual({});
    expect(
      getOpenShiftStatusLogAttributes({
        attributes: { "k8s.resource.name": "clusterversions" },
        objectKvList: { values: "garbage" } as unknown as JSONObject,
      }),
    ).toEqual({});
  });

  test("a record without attributes", () => {
    expect(
      getOpenShiftStatusLogAttributes({
        attributes: null,
        objectKvList: asKvList(operator("dns", { Available: "True" })),
      }),
    ).toEqual({});
  });
});
