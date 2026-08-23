import { JSONObject } from "../../../Types/JSON";
import {
  parseCronJobObject,
  parseDeploymentObject,
  parseJobObject,
  parseNamespaceObject,
  parseNodeObject,
  parsePVCObject,
  parsePodObject,
} from "../../../Types/Kubernetes/KubernetesObjectParser";
import { describe, expect, test } from "@jest/globals";

/*
 * The parse<Kind>Object functions turn the OTLP kvlistValue an agent ships a
 * Kubernetes object in into a typed inventory record. The low-level kv helpers
 * they build on are covered by KubernetesObjectParser.test.ts; this suite
 * covers the object-level parsers themselves, which had none.
 *
 * These parsers are defensive by contract: each is wrapped in try/catch and
 * returns null on a malformed payload rather than throwing, because they run in
 * the ingest hot path over untrusted agent data. That contract — null on
 * garbage, correct decode on well-formed input, and no crash on partial input —
 * is exactly what is pinned here, alongside the numeric parseInt fallbacks and
 * the camelCase/snake_case dual encoding the wire format uses.
 */

// --- OTLP value-wrapper builders (mirror the wire encoding) ---

function kv(entries: Array<[string, JSONObject]>): JSONObject {
  return {
    values: entries.map(([key, value]: [string, JSONObject]) => {
      return { key, value };
    }),
  };
}

function str(value: string): JSONObject {
  return { stringValue: value };
}

// Wrap a kvlist as the value of a key.
function obj(kvList: JSONObject): JSONObject {
  return { kvlistValue: kvList };
}

// An array of kvlist items (e.g. containers, conditions, addresses).
function arrOfObjects(items: Array<JSONObject>): JSONObject {
  return {
    arrayValue: {
      values: items.map((item: JSONObject) => {
        return { kvlistValue: item };
      }),
    },
  };
}

// An array of strings (e.g. accessModes, command, args).
function arrOfStrings(items: Array<string>): JSONObject {
  return {
    arrayValue: {
      values: items.map((s: string) => {
        return { stringValue: s };
      }),
    },
  };
}

describe("parsePodObject", () => {
  test("returns null when metadata is absent", () => {
    expect(parsePodObject(kv([["spec", obj(kv([]))]]))).toBeNull();
  });

  test("returns null when metadata is a flat string, not a kvlist", () => {
    expect(parsePodObject(kv([["metadata", str("oops")]]))).toBeNull();
  });

  test("decodes a fully-specified pod", () => {
    const pod: JSONObject = kv([
      [
        "metadata",
        obj(
          kv([
            ["name", str("web-1")],
            ["namespace", str("prod")],
            ["uid", str("uid-123")],
            ["labels", obj(kv([["app", str("web")]]))],
          ]),
        ),
      ],
      [
        "spec",
        obj(
          kv([
            ["serviceAccountName", str("web-sa")],
            ["nodeName", str("node-a")],
            ["nodeSelector", obj(kv([["disk", str("ssd")]]))],
            [
              "containers",
              arrOfObjects([
                kv([
                  ["name", str("app")],
                  ["image", str("nginx:1.25")],
                  ["command", arrOfStrings(["nginx", "-g", "daemon off;"])],
                  [
                    "ports",
                    arrOfObjects([
                      kv([
                        ["name", str("http")],
                        ["containerPort", str("8080")],
                        ["protocol", str("TCP")],
                      ]),
                    ]),
                  ],
                ]),
              ]),
            ],
            [
              "tolerations",
              arrOfObjects([
                kv([
                  ["key", str("node.kubernetes.io/not-ready")],
                  ["operator", str("Exists")],
                  ["effect", str("NoExecute")],
                ]),
              ]),
            ],
          ]),
        ),
      ],
      [
        "status",
        obj(
          kv([
            ["phase", str("Running")],
            ["podIP", str("10.0.0.5")],
            ["hostIP", str("10.0.0.1")],
            ["qosClass", str("Burstable")],
            [
              "conditions",
              arrOfObjects([
                kv([
                  ["type", str("Ready")],
                  ["status", str("True")],
                ]),
              ]),
            ],
            [
              "containerStatuses",
              arrOfObjects([
                kv([
                  ["name", str("app")],
                  ["ready", str("true")],
                  ["restartCount", str("2")],
                  ["image", str("nginx:1.25")],
                  ["state", obj(kv([["running", obj(kv([]))]]))],
                ]),
              ]),
            ],
          ]),
        ),
      ],
    ]);

    const result: ReturnType<typeof parsePodObject> = parsePodObject(pod);
    expect(result).not.toBeNull();
    expect(result!.metadata.name).toBe("web-1");
    expect(result!.metadata.namespace).toBe("prod");
    expect(result!.metadata.labels).toEqual({ app: "web" });
    expect(result!.spec.serviceAccountName).toBe("web-sa");
    expect(result!.spec.nodeName).toBe("node-a");
    expect(result!.spec.nodeSelector).toEqual({ disk: "ssd" });
    expect(result!.spec.containers).toHaveLength(1);
    expect(result!.spec.containers[0]!.name).toBe("app");
    expect(result!.spec.containers[0]!.image).toBe("nginx:1.25");
    expect(result!.spec.containers[0]!.command).toEqual([
      "nginx",
      "-g",
      "daemon off;",
    ]);
    expect(result!.spec.containers[0]!.ports[0]!.containerPort).toBe(8080);
    expect(result!.spec.tolerations[0]!.operator).toBe("Exists");
    expect(result!.status.phase).toBe("Running");
    expect(result!.status.podIP).toBe("10.0.0.5");
    expect(result!.status.conditions[0]!.type).toBe("Ready");
    expect(result!.status.containerStatuses[0]!.ready).toBe(true);
    expect(result!.status.containerStatuses[0]!.restartCount).toBe(2);
    expect(result!.status.containerStatuses[0]!.state).toBe("running");
  });

  test("extracts a container-status waiting reason (e.g. CrashLoopBackOff)", () => {
    const pod: JSONObject = kv([
      ["metadata", obj(kv([["name", str("crasher")]]))],
      [
        "status",
        obj(
          kv([
            [
              "containerStatuses",
              arrOfObjects([
                kv([
                  ["name", str("app")],
                  ["ready", str("false")],
                  [
                    "state",
                    obj(
                      kv([
                        [
                          "waiting",
                          obj(kv([["reason", str("CrashLoopBackOff")]])),
                        ],
                      ]),
                    ),
                  ],
                ]),
              ]),
            ],
          ]),
        ),
      ],
    ]);

    const result: ReturnType<typeof parsePodObject> = parsePodObject(pod);
    expect(result!.status.containerStatuses[0]!.state).toBe("waiting");
    expect(result!.status.containerStatuses[0]!.reason).toBe(
      "CrashLoopBackOff",
    );
    expect(result!.status.containerStatuses[0]!.ready).toBe(false);
  });

  test("a metadata-only pod decodes with empty spec/status collections", () => {
    const result: ReturnType<typeof parsePodObject> = parsePodObject(
      kv([["metadata", obj(kv([["name", str("bare")]]))]]),
    );
    expect(result!.metadata.name).toBe("bare");
    expect(result!.spec.containers).toEqual([]);
    expect(result!.spec.nodeSelector).toEqual({});
    expect(result!.status.phase).toBe("");
    expect(result!.status.conditions).toEqual([]);
  });

  test("resolves an env var sourced from a secret to a redacted marker", () => {
    const pod: JSONObject = kv([
      ["metadata", obj(kv([["name", str("with-secret")]]))],
      [
        "spec",
        obj(
          kv([
            [
              "containers",
              arrOfObjects([
                kv([
                  ["name", str("app")],
                  [
                    "env",
                    arrOfObjects([
                      kv([
                        ["name", str("DB_PASSWORD")],
                        [
                          "valueFrom",
                          obj(
                            kv([
                              [
                                "secretKeyRef",
                                obj(
                                  kv([
                                    ["name", str("db-creds")],
                                    ["key", str("password")],
                                  ]),
                                ),
                              ],
                            ]),
                          ),
                        ],
                      ]),
                    ]),
                  ],
                ]),
              ]),
            ],
          ]),
        ),
      ],
    ]);

    const result: ReturnType<typeof parsePodObject> = parsePodObject(pod);
    const env: { name: string; value: string } =
      result!.spec.containers[0]!.env[0]!;
    expect(env.name).toBe("DB_PASSWORD");
    // The real secret value is never on the wire; the marker must not leak one.
    expect(env.value).toBe("<Secret: db-creds/password>");
  });
});

describe("parseNodeObject", () => {
  test("returns null without metadata", () => {
    expect(parseNodeObject(kv([]))).toBeNull();
  });

  test("decodes node info, capacity, and addresses", () => {
    const node: JSONObject = kv([
      ["metadata", obj(kv([["name", str("node-a")]]))],
      [
        "status",
        obj(
          kv([
            [
              "nodeInfo",
              obj(
                kv([
                  ["osImage", str("Ubuntu 22.04")],
                  ["kubeletVersion", str("v1.29.0")],
                  ["architecture", str("amd64")],
                ]),
              ),
            ],
            [
              "capacity",
              obj(
                kv([
                  ["cpu", str("4")],
                  ["memory", str("8Gi")],
                ]),
              ),
            ],
            ["allocatable", obj(kv([["cpu", str("3800m")]]))],
            [
              "addresses",
              arrOfObjects([
                kv([
                  ["type", str("InternalIP")],
                  ["address", str("10.0.0.1")],
                ]),
                kv([
                  ["type", str("Hostname")],
                  ["address", str("node-a")],
                ]),
              ]),
            ],
            [
              "conditions",
              arrOfObjects([
                kv([
                  ["type", str("Ready")],
                  ["status", str("True")],
                ]),
              ]),
            ],
          ]),
        ),
      ],
    ]);

    const result: ReturnType<typeof parseNodeObject> = parseNodeObject(node);
    expect(result!.metadata.name).toBe("node-a");
    expect(result!.status.nodeInfo.osImage).toBe("Ubuntu 22.04");
    expect(result!.status.nodeInfo.kubeletVersion).toBe("v1.29.0");
    expect(result!.status.capacity).toEqual({ cpu: "4", memory: "8Gi" });
    expect(result!.status.allocatable).toEqual({ cpu: "3800m" });
    expect(result!.status.addresses).toHaveLength(2);
    expect(result!.status.addresses[0]).toEqual({
      type: "InternalIP",
      address: "10.0.0.1",
    });
    expect(result!.status.conditions[0]!.status).toBe("True");
  });
});

describe("parseDeploymentObject", () => {
  test("returns null without metadata", () => {
    expect(parseDeploymentObject(kv([]))).toBeNull();
  });

  test("decodes replicas, strategy, selector, and status counters", () => {
    const dep: JSONObject = kv([
      ["metadata", obj(kv([["name", str("api")]]))],
      [
        "spec",
        obj(
          kv([
            ["replicas", str("3")],
            ["strategy", obj(kv([["type", str("RollingUpdate")]]))],
            [
              "selector",
              obj(kv([["matchLabels", obj(kv([["app", str("api")]]))]])),
            ],
          ]),
        ),
      ],
      [
        "status",
        obj(
          kv([
            ["replicas", str("3")],
            ["readyReplicas", str("2")],
            ["availableReplicas", str("2")],
            ["unavailableReplicas", str("1")],
          ]),
        ),
      ],
    ]);

    const result: ReturnType<typeof parseDeploymentObject> =
      parseDeploymentObject(dep);
    expect(result!.spec.replicas).toBe(3);
    expect(result!.spec.strategy).toBe("RollingUpdate");
    expect(result!.spec.selector).toEqual({ app: "api" });
    expect(result!.status.readyReplicas).toBe(2);
    expect(result!.status.unavailableReplicas).toBe(1);
  });

  test("non-numeric replica counts fall back to 0, never NaN", () => {
    const dep: JSONObject = kv([
      ["metadata", obj(kv([["name", str("api")]]))],
      ["spec", obj(kv([["replicas", str("not-a-number")]]))],
      ["status", obj(kv([["readyReplicas", str("")]]))],
    ]);
    const result: ReturnType<typeof parseDeploymentObject> =
      parseDeploymentObject(dep);
    expect(result!.spec.replicas).toBe(0);
    expect(result!.status.readyReplicas).toBe(0);
    expect(Number.isNaN(result!.spec.replicas)).toBe(false);
  });
});

describe("parseJobObject", () => {
  test("decodes spec counters and boolean-free status", () => {
    const job: JSONObject = kv([
      ["metadata", obj(kv([["name", str("backup")]]))],
      [
        "spec",
        obj(
          kv([
            ["completions", str("1")],
            ["parallelism", str("2")],
            ["backoffLimit", str("6")],
          ]),
        ),
      ],
      [
        "status",
        obj(
          kv([
            ["active", str("0")],
            ["succeeded", str("1")],
            ["failed", str("0")],
            ["startTime", str("2026-01-01T00:00:00Z")],
          ]),
        ),
      ],
    ]);
    const result: ReturnType<typeof parseJobObject> = parseJobObject(job);
    expect(result!.spec.completions).toBe(1);
    expect(result!.spec.parallelism).toBe(2);
    expect(result!.spec.backoffLimit).toBe(6);
    expect(result!.status.succeeded).toBe(1);
    expect(result!.status.startTime).toBe("2026-01-01T00:00:00Z");
  });

  test("a job with no spec/status yields zeroed counters", () => {
    const result: ReturnType<typeof parseJobObject> = parseJobObject(
      kv([["metadata", obj(kv([["name", str("empty")]]))]]),
    );
    expect(result!.spec.completions).toBe(0);
    expect(result!.status.active).toBe(0);
    expect(result!.status.conditions).toEqual([]);
  });
});

describe("parseCronJobObject", () => {
  test("decodes schedule and coerces suspend to a real boolean", () => {
    const cron: JSONObject = kv([
      ["metadata", obj(kv([["name", str("nightly")]]))],
      [
        "spec",
        obj(
          kv([
            ["schedule", str("0 2 * * *")],
            ["suspend", str("true")],
            ["concurrencyPolicy", str("Forbid")],
            ["successfulJobsHistoryLimit", str("3")],
          ]),
        ),
      ],
      ["status", obj(kv([["active", str("1")]]))],
    ]);
    const result: ReturnType<typeof parseCronJobObject> =
      parseCronJobObject(cron);
    expect(result!.spec.schedule).toBe("0 2 * * *");
    expect(result!.spec.suspend).toBe(true);
    expect(result!.spec.concurrencyPolicy).toBe("Forbid");
    expect(result!.spec.successfulJobsHistoryLimit).toBe(3);
    expect(result!.status.activeCount).toBe(1);
  });

  test('suspend is false for any non-"true" string', () => {
    const cron: JSONObject = kv([
      ["metadata", obj(kv([["name", str("nightly")]]))],
      ["spec", obj(kv([["suspend", str("false")]]))],
    ]);
    expect(parseCronJobObject(cron)!.spec.suspend).toBe(false);
  });
});

describe("parseNamespaceObject", () => {
  test("decodes the phase", () => {
    const ns: JSONObject = kv([
      ["metadata", obj(kv([["name", str("prod")]]))],
      ["status", obj(kv([["phase", str("Active")]]))],
    ]);
    const result: ReturnType<typeof parseNamespaceObject> =
      parseNamespaceObject(ns);
    expect(result!.metadata.name).toBe("prod");
    expect(result!.status.phase).toBe("Active");
  });

  test("returns null without metadata", () => {
    expect(parseNamespaceObject(kv([["status", obj(kv([]))]]))).toBeNull();
  });
});

describe("parsePVCObject", () => {
  test("returns null when metadata carries no name", () => {
    /*
     * PVC/PV parsers additionally reject a nameless object — a claim with no
     * name cannot be keyed into inventory, so it is dropped rather than stored
     * as a blank-named row.
     */
    const pvc: JSONObject = kv([
      ["metadata", obj(kv([["namespace", str("prod")]]))],
      ["spec", obj(kv([["storageClassName", str("gp3")]]))],
    ]);
    expect(parsePVCObject(pvc)).toBeNull();
  });

  test("decodes access modes, storage class, and requested/actual storage", () => {
    const pvc: JSONObject = kv([
      ["metadata", obj(kv([["name", str("data-0")]]))],
      [
        "spec",
        obj(
          kv([
            ["storageClassName", str("gp3")],
            ["volumeName", str("pv-abc")],
            ["accessModes", arrOfStrings(["ReadWriteOnce"])],
            [
              "resources",
              obj(kv([["requests", obj(kv([["storage", str("10Gi")]]))]])),
            ],
          ]),
        ),
      ],
      [
        "status",
        obj(
          kv([
            ["phase", str("Bound")],
            ["capacity", obj(kv([["storage", str("10Gi")]]))],
          ]),
        ),
      ],
    ]);
    const result: ReturnType<typeof parsePVCObject> = parsePVCObject(pvc);
    expect(result!.metadata.name).toBe("data-0");
    expect(result!.spec.accessModes).toEqual(["ReadWriteOnce"]);
    expect(result!.spec.storageClassName).toBe("gp3");
    expect(result!.spec.volumeName).toBe("pv-abc");
    expect(result!.spec.resources.requests.storage).toBe("10Gi");
    expect(result!.status.phase).toBe("Bound");
    expect(result!.status.capacity.storage).toBe("10Gi");
  });
});

describe("snake_case (protobufjs) wire encoding", () => {
  test("parsePodObject decodes metadata delivered as string_value", () => {
    /*
     * The protobufjs transport delivers the identical field under
     * string_value. A parser that only read stringValue would silently drop
     * every object from agents on that transport.
     */
    const pod: JSONObject = kv([
      [
        "metadata",
        obj(
          kv([
            ["name", { string_value: "snake-pod" }],
            ["namespace", { string_value: "kube-system" }],
          ]),
        ),
      ],
    ]);
    const result: ReturnType<typeof parsePodObject> = parsePodObject(pod);
    expect(result!.metadata.name).toBe("snake-pod");
    expect(result!.metadata.namespace).toBe("kube-system");
  });
});
