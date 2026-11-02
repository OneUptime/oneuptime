import { JSONObject } from "../../../Types/JSON";
import { KubernetesCondition } from "../../../Types/Kubernetes/KubernetesObjectParser";
import {
  MAX_CLUSTER_VERSION_HISTORY,
  OPENSHIFT_KIND_BY_RESOURCE_TYPE,
  OPENSHIFT_RESOURCE_GROUPS,
  OpenShiftClusterOperatorObject,
  OpenShiftClusterOperatorState,
  OpenShiftClusterVersionObject,
  OpenShiftClusterVersionState,
  OpenShiftDeploymentConfigObject,
  OpenShiftDeploymentConfigState,
  OpenShiftKind,
  OpenShiftResourceType,
  OpenShiftRouteIngress,
  OpenShiftRouteObject,
  OpenShiftRouteState,
  getClusterOperatorState,
  getClusterVersionState,
  getConditionStatus,
  getDeploymentConfigState,
  getRouteState,
  parseClusterOperatorObject,
  parseClusterVersionObject,
  parseDeploymentConfigObject,
  parseRouteObject,
} from "../../../Types/Kubernetes/OpenShiftObjectParser";
import {
  PlainValue,
  toOtlpAnyValue,
} from "../../Helpers/KubernetesEventRecords";
import { describe, expect, test } from "@jest/globals";

/*
 * OpenShift's own objects, as the kubernetes-agent chart's openshift preset
 * pulls them: each parser turns the OTLP kvlist the k8sobjects receiver sends
 * into the projection inventory stores, and each state function reads the
 * one word the Dashboard and the alert templates use.
 *
 * The fixtures are written as `oc get <kind> -o json` prints the objects and
 * encoded the way the collector encodes them (toOtlpAnyValue). Like every
 * parser on the ingest path, these return null on garbage and never throw.
 * A Route's TLS key and certificates must never reach the projection.
 */

// An object as the k8sobjects receiver sends it: the kvlist of a pulled object.
function asKvList(object: PlainValue): JSONObject {
  return toOtlpAnyValue(object)["kvlistValue"] as JSONObject;
}

const PRIVATE_KEY: string =
  "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";
const CERTIFICATE: string =
  "-----BEGIN CERTIFICATE-----\nMIIDdzCCAl+gAwIBAgIEAgAAuTANBgkq\n-----END CERTIFICATE-----";

const ROUTE: PlainValue = {
  apiVersion: "route.openshift.io/v1",
  kind: "Route",
  metadata: {
    name: "frontend",
    namespace: "shop",
    uid: "3b1c3f9e-2a4f-4a1e-9c35-0d5f0b2f1a11",
    creationTimestamp: "2026-10-01T10:00:00Z",
    labels: { app: "frontend" },
  },
  spec: {
    host: "frontend-shop.apps.ocp.example.com",
    path: "/",
    to: { kind: "Service", name: "frontend", weight: 100 },
    alternateBackends: [
      { kind: "Service", name: "frontend-canary", weight: 10 },
    ],
    port: { targetPort: "http" },
    tls: {
      termination: "edge",
      insecureEdgeTerminationPolicy: "Redirect",
      key: PRIVATE_KEY,
      certificate: CERTIFICATE,
      caCertificate: CERTIFICATE,
      destinationCACertificate: CERTIFICATE,
    },
    wildcardPolicy: "None",
  },
  status: {
    ingress: [
      {
        host: "frontend-shop.apps.ocp.example.com",
        routerName: "default",
        routerCanonicalHostname: "router-default.apps.ocp.example.com",
        wildcardPolicy: "None",
        conditions: [
          {
            type: "Admitted",
            status: "True",
            lastTransitionTime: "2026-10-01T10:00:02Z",
          },
        ],
      },
    ],
  },
};

const DEPLOYMENT_CONFIG: PlainValue = {
  apiVersion: "apps.openshift.io/v1",
  kind: "DeploymentConfig",
  metadata: {
    name: "legacy-api",
    namespace: "shop",
    uid: "8f2d6c1a-1111-4b7e-8a2c-3e9d0c4b5a66",
    creationTimestamp: "2025-03-12T08:30:00Z",
  },
  spec: {
    replicas: 3,
    selector: { app: "legacy-api", deploymentconfig: "legacy-api" },
    strategy: { type: "Rolling", rollingParams: { timeoutSeconds: 600 } },
    triggers: [
      { type: "ConfigChange" },
      {
        type: "ImageChange",
        imageChangeParams: {
          automatic: true,
          containerNames: ["legacy-api"],
          from: { kind: "ImageStreamTag", name: "legacy-api:latest" },
        },
      },
    ],
    template: {
      metadata: { labels: { app: "legacy-api" } },
      spec: { containers: [{ name: "legacy-api", image: "legacy-api:7" }] },
    },
  },
  status: {
    latestVersion: 7,
    observedGeneration: 9,
    replicas: 3,
    readyReplicas: 3,
    availableReplicas: 3,
    unavailableReplicas: 0,
    updatedReplicas: 3,
    conditions: [
      { type: "Available", status: "True", reason: "MinimumReplicasAvailable" },
      {
        type: "Progressing",
        status: "True",
        reason: "NewReplicationControllerAvailable",
        message:
          'replication controller "legacy-api-7" successfully rolled out',
      },
    ],
  },
};

function clusterOperator(
  name: string,
  conditions: Array<{ type: string; status: string; message?: string }>,
): PlainValue {
  return {
    apiVersion: "config.openshift.io/v1",
    kind: "ClusterOperator",
    metadata: {
      name: name,
      uid: `uid-${name}`,
      creationTimestamp: "2025-01-20T09:00:00Z",
    },
    spec: {},
    status: {
      conditions: conditions.map(
        (condition: { type: string; status: string; message?: string }) => {
          return {
            type: condition.type,
            status: condition.status,
            reason: "AsExpected",
            message: condition.message || "",
            lastTransitionTime: "2026-10-30T12:00:00Z",
          };
        },
      ),
      versions: [
        { name: "operator", version: "4.18.12" },
        { name: `${name}-operand`, version: "4.18.12" },
      ],
      relatedObjects: [
        { group: "", resource: "namespaces", name: `openshift-${name}` },
      ],
    },
  };
}

const HEALTHY_OPERATOR: Array<{ type: string; status: string }> = [
  { type: "Degraded", status: "False" },
  { type: "Progressing", status: "False" },
  { type: "Available", status: "True" },
  { type: "Upgradeable", status: "True" },
];

function clusterVersion(data: {
  history: Array<{ version: string; state: string }>;
  conditions: Array<{ type: string; status: string; message?: string }>;
  desired?: string;
  desiredUpdate?: string | null;
  availableUpdates?: Array<string> | null;
}): PlainValue {
  return {
    apiVersion: "config.openshift.io/v1",
    kind: "ClusterVersion",
    metadata: { name: "version", uid: "uid-version" },
    spec: {
      channel: "stable-4.18",
      clusterID: "0f3c7e1d-1234-4cde-9abc-0123456789ab",
      ...(data.desiredUpdate
        ? {
            desiredUpdate: {
              version: data.desiredUpdate,
              image: "quay.io/openshift-release-dev/ocp-release@sha256:abc",
            },
          }
        : {}),
    },
    status: {
      desired: {
        version: data.desired || data.history[0]?.version || "",
        image: "quay.io/openshift-release-dev/ocp-release@sha256:abc",
      },
      history: data.history.map(
        (update: { version: string; state: string }) => {
          return {
            version: update.version,
            state: update.state,
            startedTime: "2026-10-30T10:00:00Z",
            completionTime:
              update.state === "Completed" ? "2026-10-30T11:00:00Z" : null,
            verified: true,
          };
        },
      ),
      conditions: data.conditions.map(
        (condition: { type: string; status: string; message?: string }) => {
          return {
            type: condition.type,
            status: condition.status,
            message: condition.message || "",
            lastTransitionTime: "2026-10-30T10:00:00Z",
          };
        },
      ),
      availableUpdates:
        data.availableUpdates === null
          ? null
          : (data.availableUpdates || []).map((version: string) => {
              return { version: version, image: `quay.io/release:${version}` };
            }),
    },
  };
}

function conditions(
  entries: Array<[string, string]>,
): Array<KubernetesCondition> {
  return entries.map(([type, status]: [string, string]) => {
    return {
      type: type,
      status: status,
      reason: "",
      message: "",
      lastTransitionTime: "",
    };
  });
}

describe("the resource types the chart pulls", () => {
  test("name a group and a kind for each", () => {
    for (const resourceType of Object.values(OpenShiftResourceType)) {
      expect(OPENSHIFT_RESOURCE_GROUPS[resourceType]).toMatch(
        /\.openshift\.io$/,
      );
      expect(Object.values(OpenShiftKind)).toContain(
        OPENSHIFT_KIND_BY_RESOURCE_TYPE[resourceType],
      );
    }
  });

  test("are the four OpenShift objects, under their own API groups", () => {
    expect(OPENSHIFT_RESOURCE_GROUPS).toEqual({
      routes: "route.openshift.io",
      deploymentconfigs: "apps.openshift.io",
      clusteroperators: "config.openshift.io",
      clusterversions: "config.openshift.io",
    });
    expect(OPENSHIFT_KIND_BY_RESOURCE_TYPE).toEqual({
      routes: "Route",
      deploymentconfigs: "DeploymentConfig",
      clusteroperators: "ClusterOperator",
      clusterversions: "ClusterVersion",
    });
  });
});

describe("parseRouteObject", () => {
  const route: OpenShiftRouteObject = parseRouteObject(asKvList(ROUTE))!;

  test("reads the route's identity", () => {
    expect(route.metadata.name).toBe("frontend");
    expect(route.metadata.namespace).toBe("shop");
    expect(route.metadata.uid).toBe("3b1c3f9e-2a4f-4a1e-9c35-0d5f0b2f1a11");
    expect(route.metadata.labels).toEqual({ app: "frontend" });
  });

  test("reads where it routes: host, path, port and backends with their weights", () => {
    expect(route.spec.host).toBe("frontend-shop.apps.ocp.example.com");
    expect(route.spec.path).toBe("/");
    expect(route.spec.targetPort).toBe("http");
    expect(route.spec.to).toEqual({
      kind: "Service",
      name: "frontend",
      weight: 100,
    });
    expect(route.spec.alternateBackends).toEqual([
      { kind: "Service", name: "frontend-canary", weight: 10 },
    ]);
    expect(route.spec.wildcardPolicy).toBe("None");
  });

  test("reads how it terminates TLS", () => {
    expect(route.spec.tlsTermination).toBe("edge");
    expect(route.spec.insecureEdgeTerminationPolicy).toBe("Redirect");
  });

  test("never keeps the TLS key or a certificate", () => {
    const projected: string = JSON.stringify(route);

    expect(projected).not.toContain("PRIVATE KEY");
    expect(projected).not.toContain("CERTIFICATE");
    expect(projected).not.toContain("MIIE");
    expect(Object.keys(route.spec)).not.toContain("tls");
  });

  test("reads which routers admitted it", () => {
    expect(route.status.ingress).toEqual([
      {
        host: "frontend-shop.apps.ocp.example.com",
        routerName: "default",
        routerCanonicalHostname: "router-default.apps.ocp.example.com",
        conditions: [
          {
            type: "Admitted",
            status: "True",
            reason: "",
            message: "",
            lastTransitionTime: "2026-10-01T10:00:02Z",
          },
        ],
      },
    ]);
    expect(getRouteState(route.status.ingress)).toBe(
      OpenShiftRouteState.Admitted,
    );
  });

  test("reads a plain HTTP route with one backend and no weight", () => {
    const plain: OpenShiftRouteObject = parseRouteObject(
      asKvList({
        kind: "Route",
        metadata: { name: "docs", namespace: "web" },
        spec: {
          host: "docs.example.com",
          to: { kind: "Service", name: "docs" },
        },
      }),
    )!;

    expect(plain.spec.tlsTermination).toBe("");
    expect(plain.spec.insecureEdgeTerminationPolicy).toBe("");
    expect(plain.spec.to).toEqual({
      kind: "Service",
      name: "docs",
      weight: null,
    });
    expect(plain.spec.alternateBackends).toEqual([]);
    expect(plain.status.ingress).toEqual([]);
    expect(getRouteState(plain.status.ingress)).toBe(
      OpenShiftRouteState.Pending,
    );
  });
});

describe("parseDeploymentConfigObject", () => {
  const deploymentConfig: OpenShiftDeploymentConfigObject =
    parseDeploymentConfigObject(asKvList(DEPLOYMENT_CONFIG))!;

  test("reads replicas, strategy, its plain selector and its triggers", () => {
    expect(deploymentConfig.metadata.name).toBe("legacy-api");
    expect(deploymentConfig.metadata.namespace).toBe("shop");
    expect(deploymentConfig.spec).toEqual({
      replicas: 3,
      strategy: "Rolling",
      selector: { app: "legacy-api", deploymentconfig: "legacy-api" },
      triggers: ["ConfigChange", "ImageChange"],
      paused: false,
    });
  });

  test("reads the rollout's status and conditions", () => {
    expect(deploymentConfig.status.latestVersion).toBe(7);
    expect(deploymentConfig.status.replicas).toBe(3);
    expect(deploymentConfig.status.readyReplicas).toBe(3);
    expect(deploymentConfig.status.availableReplicas).toBe(3);
    expect(deploymentConfig.status.unavailableReplicas).toBe(0);
    expect(deploymentConfig.status.updatedReplicas).toBe(3);
    expect(
      getConditionStatus(deploymentConfig.status.conditions, "Available"),
    ).toBe("True");
    expect(getDeploymentConfigState(deploymentConfig)).toBe(
      OpenShiftDeploymentConfigState.Available,
    );
  });

  test("keeps no pod template: images and env stay out of inventory", () => {
    expect(JSON.stringify(deploymentConfig)).not.toContain("legacy-api:7");
  });

  test("reads a paused one", () => {
    const paused: OpenShiftDeploymentConfigObject = parseDeploymentConfigObject(
      asKvList({
        kind: "DeploymentConfig",
        metadata: { name: "paused", namespace: "shop" },
        spec: { replicas: 2, paused: true },
      }),
    )!;

    expect(paused.spec.paused).toBe(true);
    expect(getDeploymentConfigState(paused)).toBe(
      OpenShiftDeploymentConfigState.Paused,
    );
  });
});

describe("parseClusterOperatorObject", () => {
  const operator: OpenShiftClusterOperatorObject = parseClusterOperatorObject(
    asKvList(clusterOperator("authentication", HEALTHY_OPERATOR)),
  )!;

  test("reads the operator's name, cluster-scoped", () => {
    expect(operator.metadata.name).toBe("authentication");
    expect(operator.metadata.namespace).toBe("");
  });

  test("reads its conditions and versions", () => {
    expect(
      operator.status.conditions.map((condition: KubernetesCondition) => {
        return [condition.type, condition.status];
      }),
    ).toEqual([
      ["Degraded", "False"],
      ["Progressing", "False"],
      ["Available", "True"],
      ["Upgradeable", "True"],
    ]);
    expect(operator.status.versions).toEqual([
      { name: "operator", version: "4.18.12" },
      { name: "authentication-operand", version: "4.18.12" },
    ]);
    expect(getClusterOperatorState(operator.status.conditions)).toBe(
      OpenShiftClusterOperatorState.Available,
    );
  });

  test("keeps what an operator says is wrong", () => {
    const degraded: OpenShiftClusterOperatorObject = parseClusterOperatorObject(
      asKvList(
        clusterOperator("ingress", [
          {
            type: "Degraded",
            status: "True",
            message:
              "The deployment has Available status condition set to False",
          },
          { type: "Available", status: "True" },
        ]),
      ),
    )!;

    expect(degraded.status.conditions[0]!.message).toBe(
      "The deployment has Available status condition set to False",
    );
    expect(getClusterOperatorState(degraded.status.conditions)).toBe(
      OpenShiftClusterOperatorState.Degraded,
    );
  });
});

describe("parseClusterVersionObject", () => {
  test("reads the channel, the version it runs and the update it moves to", () => {
    const version: OpenShiftClusterVersionObject = parseClusterVersionObject(
      asKvList(
        clusterVersion({
          desiredUpdate: "4.18.13",
          history: [
            { version: "4.18.13", state: "Partial" },
            { version: "4.18.12", state: "Completed" },
            { version: "4.18.10", state: "Completed" },
          ],
          conditions: [
            { type: "Available", status: "True" },
            { type: "Failing", status: "False" },
            {
              type: "Progressing",
              status: "True",
              message:
                "Working towards 4.18.13: 512 of 868 done (58% complete)",
            },
          ],
          availableUpdates: ["4.18.14", "4.18.15"],
        }),
      ),
    )!;

    expect(version.metadata.name).toBe("version");
    expect(version.spec.channel).toBe("stable-4.18");
    expect(version.spec.clusterID).toBe("0f3c7e1d-1234-4cde-9abc-0123456789ab");
    expect(version.spec.desiredUpdate).toBe("4.18.13");
    expect(version.status.desiredVersion).toBe("4.18.13");
    // The newest Completed update: what the cluster runs while it updates.
    expect(version.status.currentVersion).toBe("4.18.12");
    expect(
      version.status.history.map((update: { state: string }): string => {
        return update.state;
      }),
    ).toEqual(["Partial", "Completed", "Completed"]);
    expect(version.status.availableUpdateCount).toBe(2);
    expect(getClusterVersionState(version.status.conditions)).toBe(
      OpenShiftClusterVersionState.Updating,
    );
  });

  test("a cluster that never completed an update runs no known version yet", () => {
    const version: OpenShiftClusterVersionObject = parseClusterVersionObject(
      asKvList(
        clusterVersion({
          history: [{ version: "4.18.0", state: "Partial" }],
          conditions: [{ type: "Progressing", status: "True" }],
        }),
      ),
    )!;

    expect(version.status.currentVersion).toBe("");
    expect(version.status.desiredVersion).toBe("4.18.0");
  });

  test(`keeps the latest ${MAX_CLUSTER_VERSION_HISTORY} updates of a long history`, () => {
    const history: Array<{ version: string; state: string }> = [];
    for (let minor: number = 30; minor > 0; minor--) {
      history.push({ version: `4.18.${minor}`, state: "Completed" });
    }

    const version: OpenShiftClusterVersionObject = parseClusterVersionObject(
      asKvList(
        clusterVersion({
          history: history,
          conditions: [{ type: "Available", status: "True" }],
        }),
      ),
    )!;

    expect(version.status.history).toHaveLength(MAX_CLUSTER_VERSION_HISTORY);
    expect(version.status.history[0]!.version).toBe("4.18.30");
    expect(version.status.currentVersion).toBe("4.18.30");
  });

  test("no available updates, or a null list, counts none", () => {
    for (const availableUpdates of [[], null]) {
      const version: OpenShiftClusterVersionObject = parseClusterVersionObject(
        asKvList(
          clusterVersion({
            history: [{ version: "4.18.12", state: "Completed" }],
            conditions: [{ type: "Available", status: "True" }],
            availableUpdates: availableUpdates,
          }),
        ),
      )!;
      expect(version.status.availableUpdateCount).toBe(0);
    }
  });
});

describe("every parser, on what it cannot read", () => {
  const parsers: Array<[string, (kvList: JSONObject) => unknown]> = [
    ["parseRouteObject", parseRouteObject],
    ["parseDeploymentConfigObject", parseDeploymentConfigObject],
    ["parseClusterOperatorObject", parseClusterOperatorObject],
    ["parseClusterVersionObject", parseClusterVersionObject],
  ];

  test.each(parsers)(
    "%s returns null for an object without metadata",
    (_name: string, parse: (kvList: JSONObject) => unknown) => {
      expect(
        parse(asKvList({ kind: "Route", spec: { host: "x" } })),
      ).toBeNull();
    },
  );

  test.each(parsers)(
    "%s returns null, never throws, on garbage",
    (_name: string, parse: (kvList: JSONObject) => unknown) => {
      for (const garbage of [
        {},
        { values: null },
        { values: "nope" },
        { values: [{ key: "metadata", value: { stringValue: "x" } }] },
      ] as Array<JSONObject>) {
        expect(() => {
          return parse(garbage);
        }).not.toThrow();
        expect(parse(garbage)).toBeNull();
      }
    },
  );

  test.each(parsers)(
    "%s reads an object with nothing but its name",
    (_name: string, parse: (kvList: JSONObject) => unknown) => {
      expect(parse(asKvList({ metadata: { name: "bare" } }))).not.toBeNull();
    },
  );

  test("reads the protobuf encoding (snake_case) as well as JSON", () => {
    const snakeCase: JSONObject = JSON.parse(
      JSON.stringify(asKvList(clusterOperator("dns", HEALTHY_OPERATOR)))
        .replace(/"stringValue"/g, '"string_value"')
        .replace(/"kvlistValue"/g, '"kvlist_value"')
        .replace(/"arrayValue"/g, '"array_value"'),
    );

    const operator: OpenShiftClusterOperatorObject | null =
      parseClusterOperatorObject(snakeCase);

    expect(operator?.metadata.name).toBe("dns");
    expect(getClusterOperatorState(operator!.status.conditions)).toBe(
      OpenShiftClusterOperatorState.Available,
    );
  });
});

describe("getClusterOperatorState", () => {
  test.each([
    [
      [
        ["Available", "True"],
        ["Progressing", "False"],
        ["Degraded", "False"],
      ],
      "Available",
    ],
    [
      [
        ["Available", "True"],
        ["Progressing", "True"],
        ["Degraded", "False"],
      ],
      "Progressing",
    ],
    [
      [
        ["Available", "True"],
        ["Progressing", "False"],
        ["Degraded", "True"],
      ],
      "Degraded",
    ],
    /*
     * Down wins over everything it says beside it: an operator that is down
     * nearly always says Degraded too, and that must not read as the lesser.
     */
    [
      [
        ["Available", "False"],
        ["Progressing", "True"],
        ["Degraded", "True"],
      ],
      "Unavailable",
    ],
    [
      [
        ["Available", "False"],
        ["Progressing", "False"],
        ["Degraded", "True"],
      ],
      "Unavailable",
    ],
    // Degraded wins over a rollout, which is no problem by itself.
    [
      [
        ["Available", "True"],
        ["Progressing", "True"],
        ["Degraded", "True"],
      ],
      "Degraded",
    ],
    [
      [
        ["Available", "False"],
        ["Progressing", "False"],
        ["Degraded", "False"],
      ],
      "Unavailable",
    ],
    [
      [
        ["Available", "False"],
        ["Progressing", "True"],
        ["Degraded", "False"],
      ],
      "Unavailable",
    ],
    [[["Available", "Unknown"]], "Unknown"],
    [[], "Unknown"],
  ] as Array<[Array<[string, string]>, string]>)(
    "%j is %s",
    (entries: Array<[string, string]>, state: string) => {
      expect(getClusterOperatorState(conditions(entries))).toBe(state);
    },
  );
});

describe("getClusterVersionState", () => {
  test.each([
    [
      [
        ["Available", "True"],
        ["Failing", "False"],
        ["Progressing", "False"],
      ],
      "Available",
    ],
    [
      [
        ["Available", "True"],
        ["Failing", "False"],
        ["Progressing", "True"],
      ],
      "Updating",
    ],
    [
      [
        ["Available", "True"],
        ["Failing", "True"],
        ["Progressing", "True"],
      ],
      "Failing",
    ],
    [
      [
        ["Available", "False"],
        ["Failing", "True"],
      ],
      "Failing",
    ],
    [[["Available", "Unknown"]], "Unknown"],
    [[], "Unknown"],
  ] as Array<[Array<[string, string]>, string]>)(
    "%j is %s",
    (entries: Array<[string, string]>, state: string) => {
      expect(getClusterVersionState(conditions(entries))).toBe(state);
    },
  );
});

describe("getRouteState", () => {
  function router(status: string | null): OpenShiftRouteIngress {
    return {
      host: "h",
      routerName: "r",
      routerCanonicalHostname: "",
      conditions: status === null ? [] : conditions([["Admitted", status]]),
    };
  }

  test.each([
    [["True"], "Admitted"],
    [["False"], "Rejected"],
    [[null], "Pending"],
    [[], "Pending"],
    // Admitted by any router is admitted, as the route serves through it.
    [["False", "True"], "Admitted"],
    [["False", null], "Rejected"],
    [["Unknown"], "Pending"],
  ] as Array<[Array<string | null>, string]>)(
    "routers answering %j: %s",
    (answers: Array<string | null>, state: string) => {
      expect(getRouteState(answers.map(router))).toBe(state);
    },
  );
});

describe("getDeploymentConfigState", () => {
  function state(
    spec: { replicas: number; paused?: boolean },
    availableReplicas: number,
  ): string {
    return getDeploymentConfigState({
      spec: {
        replicas: spec.replicas,
        strategy: "Rolling",
        selector: {},
        triggers: [],
        paused: Boolean(spec.paused),
      },
      status: {
        latestVersion: 1,
        replicas: spec.replicas,
        readyReplicas: availableReplicas,
        availableReplicas: availableReplicas,
        unavailableReplicas: Math.max(0, spec.replicas - availableReplicas),
        updatedReplicas: availableReplicas,
        conditions: [],
      },
    });
  }

  test("every wanted replica available is Available", () => {
    expect(state({ replicas: 3 }, 3)).toBe("Available");
    expect(state({ replicas: 3 }, 4)).toBe("Available");
  });

  test("some available is Progressing; none is Unavailable", () => {
    expect(state({ replicas: 3 }, 1)).toBe("Progressing");
    expect(state({ replicas: 3 }, 0)).toBe("Unavailable");
  });

  test("no replicas wanted is Scaled to zero", () => {
    expect(state({ replicas: 0 }, 0)).toBe("Scaled to zero");
  });

  test("paused is Paused, whatever its replicas", () => {
    expect(state({ replicas: 3, paused: true }, 0)).toBe("Paused");
    expect(state({ replicas: 0, paused: true }, 0)).toBe("Paused");
  });
});

describe("getConditionStatus", () => {
  test("reads a condition's status by its type, or nothing when absent", () => {
    const entries: Array<KubernetesCondition> = conditions([
      ["Available", "True"],
      ["Degraded", "False"],
    ]);

    expect(getConditionStatus(entries, "Available")).toBe("True");
    expect(getConditionStatus(entries, "Degraded")).toBe("False");
    expect(getConditionStatus(entries, "Upgradeable")).toBe("");
    expect(getConditionStatus([], "Available")).toBe("");
  });
});
