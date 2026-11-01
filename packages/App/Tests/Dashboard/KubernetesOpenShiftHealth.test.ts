import { describe, expect, test } from "@jest/globals";
import {
  OpenShiftClusterOperatorObject,
  OpenShiftClusterOperatorState,
  OpenShiftClusterVersionObject,
  OpenShiftClusterVersionState,
} from "Common/Types/Kubernetes/OpenShiftObjectParser";
import { KubernetesCondition } from "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectParser";
import {
  KubernetesClusterHealth,
  OpenShiftClusterHealth,
  OpenShiftOperatorHealth,
  getOpenShiftClusterHealth,
  getOpenShiftOperatorHealth,
  getWorseClusterHealth,
} from "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesOpenShiftHealth";

/*
 * What the Overview says about an OpenShift cluster, from its ClusterOperators
 * and its ClusterVersion. packages/E2E/OpenShiftPages draws the card; these
 * hold the reading of it, as `oc get clusteroperators` and `oc get
 * clusterversion` read theirs.
 */

function condition(
  type: string,
  status: string,
  reason: string = "",
  message: string = "",
): KubernetesCondition {
  return {
    type,
    status,
    reason,
    message,
    lastTransitionTime: "2026-11-01T09:00:00Z",
  };
}

const FINE: Array<KubernetesCondition> = [
  condition("Available", "True"),
  condition("Progressing", "False"),
  condition("Degraded", "False"),
];

function operator(
  name: string,
  conditions: Array<KubernetesCondition> = FINE,
  version: string = "4.16.12",
): OpenShiftClusterOperatorObject {
  return {
    metadata: {
      name,
      namespace: "",
      uid: "",
      creationTimestamp: "",
      labels: {},
      annotations: {},
      ownerReferences: [],
    },
    status: {
      conditions,
      versions: version
        ? [
            { name: "operand", version: "1.29.5" },
            { name: "operator", version },
          ]
        : [],
    },
  };
}

function clusterVersion(
  conditions: Array<KubernetesCondition>,
  status: Partial<OpenShiftClusterVersionObject["status"]> = {},
): Pick<OpenShiftClusterVersionObject, "spec" | "status"> {
  return {
    spec: { channel: "stable-4.16", clusterID: "", desiredUpdate: "" },
    status: {
      desiredVersion: "4.16.12",
      currentVersion: "4.16.12",
      history: [],
      conditions,
      availableUpdateCount: 0,
      ...status,
    },
  };
}

const CALM: Pick<OpenShiftClusterVersionObject, "spec" | "status"> =
  clusterVersion([
    condition("Available", "True"),
    condition("Progressing", "False"),
    condition("Failing", "False"),
  ]);

function healthOf(
  operators: Array<OpenShiftClusterOperatorObject>,
  version: Pick<OpenShiftClusterVersionObject, "spec" | "status"> = CALM,
): OpenShiftClusterHealth {
  return getOpenShiftClusterHealth({ operators, clusterVersion: version })!;
}

function names(rows: Array<OpenShiftOperatorHealth>): Array<string> {
  return rows.map((row: OpenShiftOperatorHealth): string => {
    return row.name;
  });
}

describe("getWorseClusterHealth", () => {
  test.each([
    ["Healthy", undefined, "Healthy"],
    ["Degraded", undefined, "Degraded"],
    ["Healthy", "Healthy", "Healthy"],
    ["Healthy", "Degraded", "Degraded"],
    ["Healthy", "Unhealthy", "Unhealthy"],
    ["Degraded", "Healthy", "Degraded"],
    ["Degraded", "Unhealthy", "Unhealthy"],
    ["Unhealthy", "Degraded", "Unhealthy"],
    ["Unhealthy", "Healthy", "Unhealthy"],
  ])(
    "%s and %s read %s",
    (first: string, second: string | undefined, worse: string) => {
      expect(
        getWorseClusterHealth(
          first as KubernetesClusterHealth,
          second as KubernetesClusterHealth | undefined,
        ),
      ).toBe(worse);
    },
  );
});

describe("an operator", () => {
  test("reads its conditions and its own version, not its operand's", () => {
    expect(getOpenShiftOperatorHealth(operator("dns"))).toMatchObject({
      name: "dns",
      state: OpenShiftClusterOperatorState.Available,
      available: "True",
      progressing: "False",
      degraded: "False",
      version: "4.16.12",
      reason: "",
      message: "",
      since: "",
    });
  });

  test("a condition it does not report is empty, not False", () => {
    expect(
      getOpenShiftOperatorHealth(
        operator("dns", [condition("Available", "True")]),
      ),
    ).toMatchObject({ progressing: "", degraded: "" });
  });

  test("no version is empty", () => {
    expect(getOpenShiftOperatorHealth(operator("dns", FINE, "")).version).toBe(
      "",
    );
  });

  test("a stored row without conditions or versions still reads", () => {
    const stored: OpenShiftClusterOperatorObject = operator("dns");
    stored.status = {} as OpenShiftClusterOperatorObject["status"];

    expect(getOpenShiftOperatorHealth(stored)).toMatchObject({
      state: OpenShiftClusterOperatorState.Unknown,
      version: "",
    });
  });

  test("being down explains itself first, even when it also says Degraded and rolls out", () => {
    const health: OpenShiftOperatorHealth = getOpenShiftOperatorHealth(
      operator("ingress", [
        condition("Available", "False", "Down", "not available"),
        condition("Progressing", "True", "Rolling", "rolling out"),
        condition("Degraded", "True", "Broken", "routers down"),
      ]),
    );

    expect(health.state).toBe(OpenShiftClusterOperatorState.Unavailable);
    expect(health.reason).toBe("Down");
    expect(health.message).toBe("not available");
    expect(health.since).toBe("2026-11-01T09:00:00Z");
  });

  test("Degraded explains itself before a rollout", () => {
    expect(
      getOpenShiftOperatorHealth(
        operator("ingress", [
          condition("Available", "True"),
          condition("Progressing", "True", "Rolling", "rolling out"),
          condition("Degraded", "True", "Broken", "routers down"),
        ]),
      ),
    ).toMatchObject({
      state: OpenShiftClusterOperatorState.Degraded,
      reason: "Broken",
      message: "routers down",
    });
  });

  test("a rollout explains itself", () => {
    expect(
      getOpenShiftOperatorHealth(
        operator("monitoring", [
          condition("Available", "True"),
          condition("Progressing", "True", "Rolling", "rolling out"),
          condition("Degraded", "False"),
        ]),
      ),
    ).toMatchObject({
      state: OpenShiftClusterOperatorState.Progressing,
      reason: "Rolling",
    });
  });

  test("what a healthy condition says is not shown as a problem", () => {
    expect(
      getOpenShiftOperatorHealth(
        operator("dns", [
          condition("Available", "True", "AsExpected", "DNS is serving"),
          condition("Progressing", "False", "AsExpected", "All is well"),
          condition("Degraded", "False", "AsExpected", "All is well"),
        ]),
      ),
    ).toMatchObject({ reason: "", message: "" });
  });
});

describe("the cluster's health", () => {
  test("no operators is no OpenShift to speak of", () => {
    expect(getOpenShiftClusterHealth({ operators: [] })).toBeNull();
    expect(
      getOpenShiftClusterHealth({ operators: [], clusterVersion: CALM }),
    ).toBeNull();
  });

  test("every operator fine and no update running is Healthy", () => {
    const health: OpenShiftClusterHealth = healthOf([
      operator("dns"),
      operator("etcd"),
    ]);

    expect(health.health).toBe("Healthy");
    expect(health.operatorsToReview).toEqual([]);
    expect(health.counts).toEqual({
      total: 2,
      healthy: 2,
      available: 2,
      progressing: 0,
      degraded: 0,
      unavailable: 0,
      unknown: 0,
    });
  });

  test("a rollout is healthy, and worth a look", () => {
    const health: OpenShiftClusterHealth = healthOf([
      operator("dns"),
      operator("monitoring", [
        condition("Available", "True"),
        condition("Progressing", "True"),
        condition("Degraded", "False"),
      ]),
    ]);

    expect(health.health).toBe("Healthy");
    expect(health.counts.healthy).toBe(2);
    expect(health.counts.progressing).toBe(1);
    expect(names(health.operatorsToReview)).toEqual(["monitoring"]);
  });

  test("a degraded operator is Degraded and not healthy", () => {
    const health: OpenShiftClusterHealth = healthOf([
      operator("dns"),
      operator("authentication", [
        condition("Available", "True"),
        condition("Progressing", "False"),
        condition("Degraded", "True"),
      ]),
    ]);

    expect(health.health).toBe("Degraded");
    expect(health.counts.healthy).toBe(1);
    expect(health.counts.degraded).toBe(1);
  });

  test("an unavailable operator is Unhealthy", () => {
    const health: OpenShiftClusterHealth = healthOf([
      operator("ingress", [
        condition("Available", "False"),
        condition("Progressing", "False"),
        condition("Degraded", "False"),
      ]),
    ]);

    expect(health.health).toBe("Unhealthy");
    expect(health.counts.unavailable).toBe(1);
  });

  test("an operator down and saying Degraded too is Unhealthy, the usual outage", () => {
    const health: OpenShiftClusterHealth = healthOf([
      operator("ingress", [
        condition("Available", "False"),
        condition("Progressing", "False"),
        condition("Degraded", "True"),
      ]),
    ]);

    expect(health.health).toBe("Unhealthy");
    expect(health.counts.unavailable).toBe(1);
    expect(health.counts.degraded).toBe(0);
  });

  test("Unhealthy outranks Degraded", () => {
    expect(
      healthOf([
        operator("a", [
          condition("Available", "True"),
          condition("Degraded", "True"),
        ]),
        operator("b", [
          condition("Available", "False"),
          condition("Degraded", "False"),
        ]),
      ]).health,
    ).toBe("Unhealthy");
  });

  test("an operator that reports nothing is unknown: worth a look, no alarm", () => {
    const health: OpenShiftClusterHealth = healthOf([operator("new", [])]);

    expect(health.health).toBe("Healthy");
    expect(health.counts.unknown).toBe(1);
    expect(health.counts.healthy).toBe(0);
    expect(names(health.operatorsToReview)).toEqual(["new"]);
  });

  test("lists the worst first, then by name", () => {
    const degraded: Array<KubernetesCondition> = [
      condition("Available", "True"),
      condition("Degraded", "True"),
    ];
    const unavailable: Array<KubernetesCondition> = [
      condition("Available", "False"),
    ];
    const progressing: Array<KubernetesCondition> = [
      condition("Available", "True"),
      condition("Progressing", "True"),
    ];

    expect(
      names(
        healthOf([
          operator("z-fine"),
          operator("y-progressing", progressing),
          operator("b-degraded", degraded),
          operator("a-degraded", degraded),
          operator("x-unknown", []),
          operator("c-down", unavailable),
          operator("a-fine"),
        ]).operators,
      ),
    ).toEqual([
      "c-down",
      "a-degraded",
      "b-degraded",
      "y-progressing",
      "x-unknown",
      "a-fine",
      "z-fine",
    ]);
  });
});

describe("the cluster's update", () => {
  const OPERATORS: Array<OpenShiftClusterOperatorObject> = [operator("dns")];

  test("none running reads the version, the channel and what is on offer", () => {
    const health: OpenShiftClusterHealth = healthOf(
      OPERATORS,
      clusterVersion(
        [condition("Available", "True"), condition("Progressing", "False")],
        { availableUpdateCount: 3 },
      ),
    );

    expect(health).toMatchObject({
      version: "4.16.12",
      channel: "stable-4.16",
      updateState: OpenShiftClusterVersionState.Available,
      updateReason: "",
      updateMessage: "",
      updateStartedAt: "",
      availableUpdateCount: 3,
    });
  });

  test("what Progressing says while nothing runs is not repeated", () => {
    expect(
      healthOf(
        OPERATORS,
        clusterVersion([
          condition("Available", "True"),
          condition("Progressing", "False", "", "Cluster version is 4.16.12"),
        ]),
      ).updateMessage,
    ).toBe("");
  });

  test("one running says where to, since when and how far", () => {
    const health: OpenShiftClusterHealth = healthOf(
      OPERATORS,
      clusterVersion(
        [
          condition("Available", "True"),
          condition("Progressing", "True", "", "642 of 829 done"),
        ],
        {
          desiredVersion: "4.16.14",
          history: [
            {
              version: "4.16.14",
              state: "Partial",
              startedTime: "2026-11-01T09:30:00Z",
              completionTime: "",
            },
            {
              version: "4.16.12",
              state: "Completed",
              startedTime: "2026-10-01T09:30:00Z",
              completionTime: "2026-10-01T10:30:00Z",
            },
          ],
        },
      ),
    );

    expect(health).toMatchObject({
      version: "4.16.12",
      desiredVersion: "4.16.14",
      updateState: OpenShiftClusterVersionState.Updating,
      updateMessage: "642 of 829 done",
      updateStartedAt: "2026-11-01T09:30:00Z",
      health: "Healthy",
    });
  });

  test("a failing one says why and turns the cluster Degraded", () => {
    expect(
      healthOf(
        OPERATORS,
        clusterVersion([
          condition("Available", "True"),
          condition("Progressing", "True", "", "Unable to apply"),
          condition("Failing", "True", "ClusterOperatorDegraded", "auth down"),
        ]),
      ),
    ).toMatchObject({
      updateState: OpenShiftClusterVersionState.Failing,
      updateReason: "ClusterOperatorDegraded",
      updateMessage: "auth down",
      updateStartedAt: "",
      health: "Degraded",
    });
  });

  test("an unavailable operator outranks a failing update", () => {
    expect(
      healthOf(
        [operator("ingress", [condition("Available", "False")])],
        clusterVersion([condition("Failing", "True")]),
      ).health,
    ).toBe("Unhealthy");
  });

  test("no ClusterVersion yet leaves the version unreported, the operators still read", () => {
    const health: OpenShiftClusterHealth = getOpenShiftClusterHealth({
      operators: OPERATORS,
    })!;

    expect(health).toMatchObject({
      version: "",
      channel: "",
      updateState: OpenShiftClusterVersionState.Unknown,
      availableUpdateCount: 0,
      health: "Healthy",
    });
    expect(health.counts.total).toBe(1);
  });
});
