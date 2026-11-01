import { JSONObject } from "../../../Types/JSON";
import {
  KUBERNETES_STATUS_MESSAGE_MAX_LENGTH,
  KubernetesContainerStatus,
  countArrayValues,
  parseCronJobObject,
  parseDaemonSetObject,
  parseDeploymentObject,
  parseNodeObject,
  parsePodObject,
  parseStatefulSetObject,
  shortenKubernetesMessage,
} from "../../../Types/Kubernetes/KubernetesObjectParser";
import {
  ExtractedInventoryRecord,
  extractInventoryResource,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import { KubernetesHealthSeverity } from "../../../Types/Kubernetes/KubernetesHealth";
import { describe, expect, test } from "@jest/globals";

/*
 * What the parsers keep so a page can say why something is broken, not
 * only that it is: how a container's previous run ended (OOMKilled, its
 * exit code, when), what the kubelet says about a wait, why a pod failed
 * (Evicted, and Kubernetes' message), whether a node is cordoned, and how
 * far a rollout has got. Each is optional on the parsed object, so objects
 * stored before keep their shape; and the inventory row ingest builds
 * carries the object's verdict (healthSeverity), worked out at the time the
 * agent saw it.
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

function int(value: number): JSONObject {
  return { intValue: value };
}

function bool(value: boolean): JSONObject {
  return { boolValue: value };
}

function obj(kvList: JSONObject): JSONObject {
  return { kvlistValue: kvList };
}

function arrOfObjects(items: Array<JSONObject>): JSONObject {
  return {
    arrayValue: {
      values: items.map((item: JSONObject) => {
        return { kvlistValue: item };
      }),
    },
  };
}

function containerStatus(entries: Array<[string, JSONObject]>): JSONObject {
  return kv([
    ["name", str("app")],
    ["image", str("registry.example.com/app:2.0")],
    ...entries,
  ]);
}

function podWith(statusEntries: Array<[string, JSONObject]>): JSONObject {
  return kv([
    [
      "metadata",
      obj(
        kv([
          ["name", str("checkout-7d9f8b6c5-x2k4q")],
          ["namespace", str("payments")],
          ["creationTimestamp", str("2026-11-01T09:00:00Z")],
        ]),
      ),
    ],
    ["spec", obj(kv([["nodeName", str("node-1")]]))],
    ["status", obj(kv(statusEntries))],
  ]);
}

function firstContainer(pod: JSONObject): KubernetesContainerStatus {
  return parsePodObject(pod)!.status.containerStatuses[0]!;
}

describe("a container's status", () => {
  test("keeps how its previous run ended: the reason, the exit code and when", () => {
    const status: KubernetesContainerStatus = firstContainer(
      podWith([
        ["phase", str("Running")],
        [
          "containerStatuses",
          arrOfObjects([
            containerStatus([
              ["ready", bool(false)],
              ["restartCount", int(14)],
              [
                "state",
                obj(
                  kv([
                    [
                      "waiting",
                      obj(
                        kv([
                          ["reason", str("CrashLoopBackOff")],
                          [
                            "message",
                            str(
                              "back-off 5m0s restarting failed container=app pod=checkout-7d9f8b6c5-x2k4q",
                            ),
                          ],
                        ]),
                      ),
                    ],
                  ]),
                ),
              ],
              [
                "lastState",
                obj(
                  kv([
                    [
                      "terminated",
                      obj(
                        kv([
                          ["exitCode", int(137)],
                          ["reason", str("OOMKilled")],
                          ["startedAt", str("2026-11-01T11:52:00Z")],
                          ["finishedAt", str("2026-11-01T11:58:00Z")],
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
    );

    expect(status.state).toBe("waiting");
    expect(status.reason).toBe("CrashLoopBackOff");
    expect(status.restartCount).toBe(14);
    expect(status.message).toBe(
      "back-off 5m0s restarting failed container=app pod=checkout-7d9f8b6c5-x2k4q",
    );
    expect(status.lastTerminationReason).toBe("OOMKilled");
    expect(status.lastTerminationExitCode).toBe(137);
    expect(status.lastTerminatedAt).toBe("2026-11-01T11:58:00Z");
    // A waiting container has no exit code of its own.
    expect(status.exitCode).toBeUndefined();
  });

  test("keeps a running container's start and a terminated one's exit code", () => {
    const running: KubernetesContainerStatus = firstContainer(
      podWith([
        [
          "containerStatuses",
          arrOfObjects([
            containerStatus([
              [
                "state",
                obj(
                  kv([
                    [
                      "running",
                      obj(kv([["startedAt", str("2026-11-01T10:00:00Z")]])),
                    ],
                  ]),
                ),
              ],
            ]),
          ]),
        ],
      ]),
    );
    expect(running.state).toBe("running");
    expect(running.startedAt).toBe("2026-11-01T10:00:00Z");
    expect(running.lastTerminationReason).toBeUndefined();

    const ended: KubernetesContainerStatus = firstContainer(
      podWith([
        [
          "containerStatuses",
          arrOfObjects([
            containerStatus([
              [
                "state",
                obj(
                  kv([
                    [
                      "terminated",
                      obj(
                        kv([
                          ["exitCode", int(1)],
                          ["reason", str("Error")],
                          ["message", str("panic: config not found")],
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
    );
    expect(ended.state).toBe("terminated");
    expect(ended.reason).toBe("Error");
    expect(ended.exitCode).toBe(1);
    expect(ended.message).toBe("panic: config not found");
  });

  test("reads a previous run's exit code of 0 as 0, not as missing", () => {
    const status: KubernetesContainerStatus = firstContainer(
      podWith([
        [
          "containerStatuses",
          arrOfObjects([
            containerStatus([
              ["state", obj(kv([["running", obj(kv([]))]]))],
              [
                "lastState",
                obj(
                  kv([
                    [
                      "terminated",
                      obj(
                        kv([
                          ["exitCode", int(0)],
                          ["reason", str("Completed")],
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
    );
    expect(status.lastTerminationReason).toBe("Completed");
    expect(status.lastTerminationExitCode).toBe(0);
    expect(status.lastTerminatedAt).toBe("");
  });

  test("ignores a previous state that is not a termination", () => {
    const status: KubernetesContainerStatus = firstContainer(
      podWith([
        [
          "containerStatuses",
          arrOfObjects([
            containerStatus([
              ["state", obj(kv([["running", obj(kv([]))]]))],
              ["lastState", obj(kv([["running", obj(kv([]))]]))],
            ]),
          ]),
        ],
      ]),
    );
    expect(status.lastTerminationReason).toBeUndefined();
  });

  test("reads the snake_case transport of a state's details too", () => {
    const status: KubernetesContainerStatus = firstContainer(
      podWith([
        [
          "containerStatuses",
          arrOfObjects([
            containerStatus([
              [
                "state",
                obj(
                  kv([
                    [
                      "waiting",
                      {
                        kvlist_value: kv([
                          ["reason", str("ImagePullBackOff")],
                          ["message", str("pull access denied")],
                        ]),
                      },
                    ],
                  ]),
                ),
              ],
            ]),
          ]),
        ],
      ]),
    );
    expect(status.reason).toBe("ImagePullBackOff");
    expect(status.message).toBe("pull access denied");
  });

  test("keeps no more of a message than the pages show", () => {
    const long: string = `Failed to pull image: ${"x".repeat(5000)}`;
    const status: KubernetesContainerStatus = firstContainer(
      podWith([
        [
          "containerStatuses",
          arrOfObjects([
            containerStatus([
              [
                "state",
                obj(
                  kv([
                    [
                      "waiting",
                      obj(
                        kv([
                          ["reason", str("ErrImagePull")],
                          ["message", str(long)],
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
    );
    expect(status.message!.length).toBe(KUBERNETES_STATUS_MESSAGE_MAX_LENGTH);
    expect(status.message!.endsWith("…")).toBe(true);
    expect(shortenKubernetesMessage("  short  ")).toBe("short");
  });

  test("a container with no state keeps reading Unknown, as before", () => {
    const status: KubernetesContainerStatus = firstContainer(
      podWith([["containerStatuses", arrOfObjects([containerStatus([])])]]),
    );
    expect(status.state).toBe("Unknown");
    expect(status.reason).toBe("");
    expect(status.message).toBeUndefined();
  });
});

describe("a pod's status", () => {
  test("keeps why it failed and Kubernetes' message, and when it started", () => {
    const parsed: ReturnType<typeof parsePodObject> = parsePodObject(
      podWith([
        ["phase", str("Failed")],
        ["reason", str("Evicted")],
        ["message", str("The node was low on resource: memory.")],
        ["startTime", str("2026-11-01T09:00:05Z")],
      ]),
    );
    expect(parsed!.status.reason).toBe("Evicted");
    expect(parsed!.status.message).toBe(
      "The node was low on resource: memory.",
    );
    expect(parsed!.status.startTime).toBe("2026-11-01T09:00:05Z");
  });

  test("adds nothing Kubernetes did not say, so a stored pod keeps its shape", () => {
    const parsed: ReturnType<typeof parsePodObject> = parsePodObject(
      podWith([["phase", str("Running")]]),
    );
    expect(Object.keys(parsed!.status).sort()).toEqual(
      [
        "conditions",
        "containerStatuses",
        "hostIP",
        "initContainerStatuses",
        "phase",
        "podIP",
        "qosClass",
      ].sort(),
    );
  });
});

describe("a node", () => {
  test("keeps whether it is cordoned, and its taints", () => {
    const parsed: ReturnType<typeof parseNodeObject> = parseNodeObject(
      kv([
        ["metadata", obj(kv([["name", str("node-3")]]))],
        [
          "spec",
          obj(
            kv([
              ["unschedulable", bool(true)],
              [
                "taints",
                arrOfObjects([
                  kv([
                    ["key", str("node.kubernetes.io/unschedulable")],
                    ["effect", str("NoSchedule")],
                  ]),
                ]),
              ],
            ]),
          ),
        ],
        ["status", obj(kv([]))],
      ]),
    );
    expect(parsed!.spec).toEqual({
      unschedulable: true,
      taints: [
        {
          key: "node.kubernetes.io/unschedulable",
          value: "",
          effect: "NoSchedule",
        },
      ],
    });
  });

  test("with no spec has none, as nodes stored before", () => {
    const parsed: ReturnType<typeof parseNodeObject> = parseNodeObject(
      kv([["metadata", obj(kv([["name", str("node-3")]]))]]),
    );
    expect(parsed!.spec).toBeUndefined();
  });

  test("schedulable with no taints says so", () => {
    expect(
      parseNodeObject(
        kv([
          ["metadata", obj(kv([["name", str("node-4")]]))],
          ["spec", obj(kv([["podCIDR", str("10.244.1.0/24")]]))],
        ]),
      )!.spec,
    ).toEqual({ unschedulable: false, taints: [] });
  });
});

describe("a rollout's progress", () => {
  test("a Deployment keeps whether it is paused and how many replicas are updated", () => {
    const parsed: ReturnType<typeof parseDeploymentObject> =
      parseDeploymentObject(
        kv([
          ["metadata", obj(kv([["name", str("checkout")]]))],
          [
            "spec",
            obj(
              kv([
                ["replicas", int(3)],
                ["paused", bool(true)],
              ]),
            ),
          ],
          [
            "status",
            obj(
              kv([
                ["availableReplicas", int(3)],
                ["updatedReplicas", int(1)],
              ]),
            ),
          ],
        ]),
      );
    expect(parsed!.spec.paused).toBe(true);
    expect(parsed!.status.updatedReplicas).toBe(1);
  });

  test("a StatefulSet keeps its update's progress and both revisions", () => {
    const parsed: ReturnType<typeof parseStatefulSetObject> =
      parseStatefulSetObject(
        kv([
          ["metadata", obj(kv([["name", str("postgres")]]))],
          ["spec", obj(kv([["replicas", int(3)]]))],
          [
            "status",
            obj(
              kv([
                ["readyReplicas", int(2)],
                ["updatedReplicas", int(1)],
                ["availableReplicas", int(2)],
                ["currentRevision", str("postgres-7c8")],
                ["updateRevision", str("postgres-9a1")],
              ]),
            ),
          ],
        ]),
      );
    expect(parsed!.status.updatedReplicas).toBe(1);
    expect(parsed!.status.availableReplicas).toBe(2);
    expect(parsed!.status.currentRevision).toBe("postgres-7c8");
    expect(parsed!.status.updateRevision).toBe("postgres-9a1");
  });

  test("a DaemonSet keeps its updated and unavailable node counts", () => {
    const parsed: ReturnType<typeof parseDaemonSetObject> =
      parseDaemonSetObject(
        kv([
          ["metadata", obj(kv([["name", str("fluent-bit")]]))],
          [
            "status",
            obj(
              kv([
                ["desiredNumberScheduled", int(5)],
                ["numberReady", int(4)],
                ["updatedNumberScheduled", int(3)],
                ["numberUnavailable", int(1)],
              ]),
            ),
          ],
        ]),
      );
    expect(parsed!.status.updatedNumberScheduled).toBe(3);
    expect(parsed!.status.numberUnavailable).toBe(1);
  });

  test("a CronJob counts the Jobs it runs now and keeps its last success", () => {
    const parsed: ReturnType<typeof parseCronJobObject> = parseCronJobObject(
      kv([
        ["metadata", obj(kv([["name", str("invoice-run")]]))],
        ["spec", obj(kv([["schedule", str("0 2 * * *")]]))],
        [
          "status",
          obj(
            kv([
              ["lastScheduleTime", str("2026-11-01T02:00:00Z")],
              ["lastSuccessfulTime", str("2026-10-31T02:04:11Z")],
              [
                "active",
                arrOfObjects([
                  kv([
                    ["kind", str("Job")],
                    ["name", str("invoice-run-28845600")],
                  ]),
                ]),
              ],
            ]),
          ),
        ],
      ]),
    );
    expect(parsed!.status.activeCount).toBe(1);
    expect(parsed!.status.lastSuccessfulTime).toBe("2026-10-31T02:04:11Z");
  });

  test("counting an array's items reads every kind of item, and none of a string", () => {
    expect(countArrayValues(null)).toBe(0);
    expect(countArrayValues("x")).toBe(0);
    expect(countArrayValues({ values: [{ stringValue: "a" }, {}] })).toBe(2);
  });
});

describe("the inventory row ingest builds", () => {
  const SEEN: Date = new Date("2026-11-01T12:00:00.000Z");

  function record(
    resourceType: string,
    object: JSONObject,
  ): ExtractedInventoryRecord {
    const extracted: ExtractedInventoryRecord | null = extractInventoryResource(
      {
        resourceType: resourceType,
        logBody: JSON.stringify({ kvlistValue: object }),
        lastSeenAt: SEEN,
      },
    );
    expect(extracted).not.toBeNull();
    return extracted!;
  }

  function crashLoopingPod(createdAt: string): JSONObject {
    return kv([
      ["kind", str("Pod")],
      [
        "metadata",
        obj(
          kv([
            ["name", str("checkout-7d9f8b6c5-x2k4q")],
            ["namespace", str("payments")],
            ["creationTimestamp", str(createdAt)],
          ]),
        ),
      ],
      ["spec", obj(kv([]))],
      [
        "status",
        obj(
          kv([
            ["phase", str("Running")],
            [
              "containerStatuses",
              arrOfObjects([
                containerStatus([
                  ["ready", bool(false)],
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
  }

  test("carries a crash-looping pod's verdict: critical", () => {
    expect(
      record("pods", crashLoopingPod("2026-11-01T09:00:00Z")).resource
        .healthSeverity,
    ).toBe(KubernetesHealthSeverity.Critical);
  });

  test("carries no verdict for what needs nothing", () => {
    const healthy: JSONObject = kv([
      ["kind", str("Deployment")],
      [
        "metadata",
        obj(
          kv([
            ["name", str("checkout")],
            ["namespace", str("payments")],
          ]),
        ),
      ],
      ["spec", obj(kv([["replicas", int(2)]]))],
      ["status", obj(kv([["availableReplicas", int(2)]]))],
    ]);
    expect(record("deployments", healthy).resource.healthSeverity).toBeNull();
  });

  test("judges at the time the agent saw it: a pod pending three minutes is starting", () => {
    const pending: JSONObject = kv([
      ["kind", str("Pod")],
      [
        "metadata",
        obj(
          kv([
            ["name", str("new-pod")],
            ["namespace", str("payments")],
            ["creationTimestamp", str("2026-11-01T11:57:00Z")],
          ]),
        ),
      ],
      ["status", obj(kv([["phase", str("Pending")]]))],
    ]);
    expect(record("pods", pending).resource.healthSeverity).toBeNull();

    const stuck: JSONObject = kv([
      ["kind", str("Pod")],
      [
        "metadata",
        obj(
          kv([
            ["name", str("old-pod")],
            ["namespace", str("payments")],
            ["creationTimestamp", str("2026-11-01T11:00:00Z")],
          ]),
        ),
      ],
      ["status", obj(kv([["phase", str("Pending")]]))],
    ]);
    expect(record("pods", stuck).resource.healthSeverity).toBe(
      KubernetesHealthSeverity.Warning,
    );
  });

  test("stores a cordoned node's spec, and no verdict for it", () => {
    const cordoned: ExtractedInventoryRecord = record(
      "nodes",
      kv([
        ["kind", str("Node")],
        ["metadata", obj(kv([["name", str("node-3")]]))],
        ["spec", obj(kv([["unschedulable", bool(true)]]))],
        [
          "status",
          obj(
            kv([
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
      ]),
    );
    expect(cordoned.resource.spec).toEqual({
      unschedulable: true,
      taints: [],
    });
    expect(cordoned.resource.healthSeverity).toBeNull();
  });

  test("carries a node's pressure as a warning", () => {
    const pressured: ExtractedInventoryRecord = record(
      "nodes",
      kv([
        ["kind", str("Node")],
        ["metadata", obj(kv([["name", str("node-5")]]))],
        [
          "status",
          obj(
            kv([
              [
                "conditions",
                arrOfObjects([
                  kv([
                    ["type", str("Ready")],
                    ["status", str("True")],
                  ]),
                  kv([
                    ["type", str("MemoryPressure")],
                    ["status", str("True")],
                  ]),
                ]),
              ],
            ]),
          ),
        ],
      ]),
    );
    expect(pressured.resource.healthSeverity).toBe(
      KubernetesHealthSeverity.Warning,
    );
  });
});
