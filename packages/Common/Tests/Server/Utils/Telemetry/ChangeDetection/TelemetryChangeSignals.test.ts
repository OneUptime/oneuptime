import { describe, expect, test } from "@jest/globals";
import { JSONArray } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import type { ParsedChangeEventEntry } from "../../../../../Server/Utils/Telemetry/ChangeEventRow";
import {
  KubernetesRolloutSignal,
  MAX_TRACKED_VALUE_LENGTH,
  ServiceVersionSignal,
  UNTRACKABLE_VERSIONS,
  buildKubernetesRolloutChangeEntry,
  buildServiceVersionChangeEntry,
  extractKubernetesRolloutSignal,
  extractServiceVersionSignal,
  flattenResourceAttributes,
  hashKeyParts,
  isTrackableVersion,
  kubernetesRolloutScopeKey,
  readResourceAttribute,
  scopedValueKey,
  serviceVersionScopeKey,
} from "../../../../../Server/Utils/Telemetry/ChangeDetection/TelemetryChangeSignals";

/*
 * The changes OneUptime reads out of one OTLP resource block: a service's
 * version and a Kubernetes Deployment's ReplicaSet. Pure, so these pin
 * every rule; TelemetryChangeDetector.test.ts covers which ones are new.
 */

function attributes(values: Record<string, string>): JSONArray {
  return Object.keys(values).map((key: string) => {
    return { key, value: { stringValue: values[key]! } };
  });
}

const PROJECT_ID: ObjectID = new ObjectID(
  "0f6c1f0e-0000-4000-8000-000000000001",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0f6c1f0e-0000-4000-8000-000000000002",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "0f6c1f0e-0000-4000-8000-000000000003",
);
const TIME: Date = new Date("2026-10-19T10:00:00.000Z");

describe("readResourceAttribute", () => {
  test("reads a string value, trimmed", () => {
    expect(
      readResourceAttribute(
        attributes({ "service.version": " 2.3.1 " }),
        "service.version",
      ),
    ).toBe("2.3.1");
  });

  test("reads integer and double values as text", () => {
    expect(
      readResourceAttribute(
        [{ key: "build", value: { intValue: "42" } }],
        "build",
      ),
    ).toBe("42");
    expect(
      readResourceAttribute(
        [{ key: "build", value: { intValue: 7 } }],
        "build",
      ),
    ).toBe("7");
    expect(
      readResourceAttribute(
        [{ key: "ratio", value: { doubleValue: 1.5 } }],
        "ratio",
      ),
    ).toBe("1.5");
  });

  test("the first attribute of a key is the one read", () => {
    expect(
      readResourceAttribute(
        [
          { key: "k", value: { stringValue: "first" } },
          { key: "k", value: { stringValue: "second" } },
        ],
        "k",
      ),
    ).toBe("first");
  });

  test("is empty for what holds no scalar", () => {
    expect(readResourceAttribute(undefined, "k")).toBe("");
    expect(readResourceAttribute(null, "k")).toBe("");
    expect(readResourceAttribute({} as unknown as JSONArray, "k")).toBe("");
    expect(readResourceAttribute([], "k")).toBe("");
    expect(readResourceAttribute([null] as unknown as JSONArray, "k")).toBe("");
    expect(readResourceAttribute([{ key: "k" }], "k")).toBe("");
    expect(
      readResourceAttribute([{ key: "k", value: { boolValue: true } }], "k"),
    ).toBe("");
    expect(
      readResourceAttribute([{ key: "k", value: { stringValue: "  " } }], "k"),
    ).toBe("");
    expect(
      readResourceAttribute(
        [{ key: "k", value: { doubleValue: Number.NaN } }],
        "k",
      ),
    ).toBe("");
  });
});

describe("flattenResourceAttributes", () => {
  test("keeps each key's first scalar value", () => {
    expect(
      flattenResourceAttributes([
        { key: "a", value: { stringValue: "1" } },
        { key: "a", value: { stringValue: "2" } },
        { key: "b", value: { intValue: 3 } },
        { key: "c", value: { arrayValue: { values: [] } } },
        { key: "", value: { stringValue: "nameless" } },
        { value: { stringValue: "keyless" } },
      ]),
    ).toEqual({ a: "1", b: "3" });
  });

  test("is empty for no attributes", () => {
    expect(flattenResourceAttributes(undefined)).toEqual({});
  });
});

describe("isTrackableVersion", () => {
  test("a real version is trackable", () => {
    for (const version of ["2.3.1", "v1", "1a2b3c4", "2026.10.19-build.7"]) {
      expect(isTrackableVersion(version)).toBe(true);
    }
  });

  test("placeholders cannot tell one deploy from the next", () => {
    for (const version of UNTRACKABLE_VERSIONS) {
      expect(isTrackableVersion(version)).toBe(false);
      expect(isTrackableVersion(version.toUpperCase())).toBe(false);
    }
    expect(isTrackableVersion("")).toBe(false);
    expect(isTrackableVersion("   ")).toBe(false);
  });

  test("an over-long value is not a version", () => {
    expect(isTrackableVersion("a".repeat(MAX_TRACKED_VALUE_LENGTH))).toBe(true);
    expect(isTrackableVersion("a".repeat(MAX_TRACKED_VALUE_LENGTH + 1))).toBe(
      false,
    );
  });
});

describe("extractServiceVersionSignal", () => {
  test("reads the version and the environment", () => {
    expect(
      extractServiceVersionSignal(
        attributes({
          "service.name": "checkout",
          "service.version": "2.3.1",
          "deployment.environment.name": "production",
        }),
      ),
    ).toEqual({
      version: "2.3.1",
      environment: "production",
      commitSha: undefined,
      branch: undefined,
      repositoryUrl: undefined,
    });
  });

  test("reads the old environment key too", () => {
    expect(
      extractServiceVersionSignal(
        attributes({
          "service.version": "2.3.1",
          "deployment.environment": "staging",
        }),
      )?.environment,
    ).toBe("staging");
  });

  test("an environment is optional", () => {
    expect(
      extractServiceVersionSignal(attributes({ "service.version": "2.3.1" }))
        ?.environment,
    ).toBe("");
  });

  test("copies the source revision, branch and repository the resource reports", () => {
    const signal: ServiceVersionSignal | null = extractServiceVersionSignal(
      attributes({
        "service.version": "2.3.1",
        "vcs.ref.head.revision": "1a2b3c4d5e6f",
        "vcs.ref.head.name": "main",
        "vcs.repository.url.full": "https://github.com/acme/checkout",
      }),
    );

    expect(signal?.commitSha).toBe("1a2b3c4d5e6f");
    expect(signal?.branch).toBe("main");
    expect(signal?.repositoryUrl).toBe("https://github.com/acme/checkout");
  });

  test("reads OpenTelemetry's older vcs names", () => {
    const signal: ServiceVersionSignal | null = extractServiceVersionSignal(
      attributes({
        "service.version": "2.3.1",
        "vcs.repository.ref.revision": "cafe1234",
        "vcs.repository.ref.name": "release",
      }),
    );

    expect(signal?.commitSha).toBe("cafe1234");
    expect(signal?.branch).toBe("release");
  });

  test("caps what it copies", () => {
    const long: string = "x".repeat(MAX_TRACKED_VALUE_LENGTH + 10);
    const signal: ServiceVersionSignal | null = extractServiceVersionSignal(
      attributes({
        "service.version": "2.3.1",
        "deployment.environment.name": long,
        "vcs.ref.head.revision": long,
      }),
    );

    expect(signal?.environment).toHaveLength(MAX_TRACKED_VALUE_LENGTH);
    expect(signal?.commitSha).toHaveLength(MAX_TRACKED_VALUE_LENGTH);
  });

  test("no trackable version, no signal", () => {
    expect(extractServiceVersionSignal(attributes({}))).toBeNull();
    expect(
      extractServiceVersionSignal(attributes({ "service.version": "latest" })),
    ).toBeNull();
    expect(
      extractServiceVersionSignal(attributes({ version: "2.3.1" })),
    ).toBeNull();
    expect(extractServiceVersionSignal(undefined)).toBeNull();
  });
});

describe("extractKubernetesRolloutSignal", () => {
  test("reads the Deployment, its ReplicaSet, the namespace and the cluster", () => {
    expect(
      extractKubernetesRolloutSignal(
        attributes({
          "k8s.cluster.name": "prod-eu",
          "k8s.namespace.name": "web",
          "k8s.deployment.name": "api",
          "k8s.replicaset.name": "api-7d4f9c",
          "k8s.pod.name": "api-7d4f9c-x2x9z",
        }),
      ),
    ).toEqual({
      clusterName: "prod-eu",
      namespace: "web",
      deploymentName: "api",
      replicaSetName: "api-7d4f9c",
    });
  });

  test("the namespace and the cluster are optional", () => {
    expect(
      extractKubernetesRolloutSignal(
        attributes({
          "k8s.deployment.name": "api",
          "k8s.replicaset.name": "api-7d4f9c",
        }),
      ),
    ).toEqual({
      clusterName: "",
      namespace: "",
      deploymentName: "api",
      replicaSetName: "api-7d4f9c",
    });
  });

  test("needs both the Deployment and the ReplicaSet", () => {
    expect(
      extractKubernetesRolloutSignal(
        attributes({ "k8s.deployment.name": "api" }),
      ),
    ).toBeNull();
    expect(
      extractKubernetesRolloutSignal(
        attributes({ "k8s.replicaset.name": "api-7d4f9c" }),
      ),
    ).toBeNull();
    // A StatefulSet's pods name no ReplicaSet.
    expect(
      extractKubernetesRolloutSignal(
        attributes({ "k8s.statefulset.name": "db", "k8s.pod.name": "db-0" }),
      ),
    ).toBeNull();
  });

  test("over-long names are not a signal", () => {
    expect(
      extractKubernetesRolloutSignal(
        attributes({
          "k8s.deployment.name": "a".repeat(MAX_TRACKED_VALUE_LENGTH + 1),
          "k8s.replicaset.name": "api-7d4f9c",
        }),
      ),
    ).toBeNull();
  });
});

describe("cache keys", () => {
  test("hashKeyParts is stable, bounded and unambiguous", () => {
    expect(hashKeyParts(["a", "b"])).toBe(hashKeyParts(["a", "b"]));
    expect(hashKeyParts(["a", "b"])).toHaveLength(40);
    expect(hashKeyParts(["a:b", "c"])).not.toBe(hashKeyParts(["a", "b:c"]));
    expect(hashKeyParts(["x".repeat(100_000)])).toHaveLength(40);
  });

  test("a service's versions are tracked per environment, whatever its case", () => {
    const production: string = serviceVersionScopeKey({
      projectId: PROJECT_ID,
      serviceId: SERVICE_ID,
      environment: "production",
    });

    expect(
      serviceVersionScopeKey({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        environment: "Production",
      }),
    ).toBe(production);
    expect(
      serviceVersionScopeKey({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        environment: "staging",
      }),
    ).not.toBe(production);
    expect(
      serviceVersionScopeKey({
        projectId: PROJECT_ID,
        serviceId: ObjectID.generate(),
        environment: "production",
      }),
    ).not.toBe(production);
  });

  test("a Deployment is tracked per cluster and namespace", () => {
    const signal: KubernetesRolloutSignal = {
      clusterName: "prod-eu",
      namespace: "web",
      deploymentName: "api",
      replicaSetName: "api-1",
    };
    const byId: string = kubernetesRolloutScopeKey({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      signal,
    });

    // The ReplicaSet is the value, not part of the scope.
    expect(
      kubernetesRolloutScopeKey({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        signal: { ...signal, replicaSetName: "api-2" },
      }),
    ).toBe(byId);
    expect(
      kubernetesRolloutScopeKey({
        projectId: PROJECT_ID,
        kubernetesClusterId: ObjectID.generate(),
        signal,
      }),
    ).not.toBe(byId);
    expect(
      kubernetesRolloutScopeKey({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        signal: { ...signal, namespace: "staging" },
      }),
    ).not.toBe(byId);
    // Without OneUptime's id, the collector's cluster name tells clusters apart.
    expect(
      kubernetesRolloutScopeKey({ projectId: PROJECT_ID, signal }),
    ).not.toBe(
      kubernetesRolloutScopeKey({
        projectId: PROJECT_ID,
        signal: { ...signal, clusterName: "prod-us" },
      }),
    );
  });

  test("a value's key sits under its scope's", () => {
    expect(scopedValueKey("scope", "2.3.1")).toBe(
      `scope:${hashKeyParts(["2.3.1"])}`,
    );
    expect(scopedValueKey("scope", "2.3.1")).not.toBe(
      scopedValueKey("scope", "2.3.2"),
    );
  });
});

describe("buildServiceVersionChangeEntry", () => {
  test("a deploy, with the previous version and everything the resource reports", () => {
    const entry: ParsedChangeEventEntry = buildServiceVersionChangeEntry({
      serviceName: "checkout",
      signal: {
        version: "2.3.1",
        environment: "production",
        commitSha: "1a2b3c4d5e6f",
        branch: "main",
        repositoryUrl: "https://github.com/acme/checkout",
      },
      previousVersion: "2.3.0",
      time: TIME,
    });

    expect(entry).toEqual({
      time: TIME,
      eventType: "deployment",
      title: "Deployed checkout 2.3.1",
      description:
        "checkout started reporting service.version 2.3.1 in production; it reported 2.3.0 before. OneUptime recorded this from the service's telemetry.",
      attributes: {
        "oneuptime.change.source": "service-version",
        "service.version": "2.3.1",
        "oneuptime.change.previous_version": "2.3.0",
        "deployment.environment.name": "production",
        "vcs.ref.head.revision": "1a2b3c4d5e6f",
        "vcs.ref.head.name": "main",
        "vcs.repository.url.full": "https://github.com/acme/checkout",
      },
    });
  });

  test("leaves out what the resource does not report", () => {
    const entry: ParsedChangeEventEntry = buildServiceVersionChangeEntry({
      serviceName: "  ",
      signal: { version: "2", environment: "" },
      previousVersion: "1",
      time: TIME,
    });

    expect(entry.title).toBe("Deployed service 2");
    expect(entry.description).toBe(
      "service started reporting service.version 2; it reported 1 before. OneUptime recorded this from the service's telemetry.",
    );
    expect(entry.attributes).toEqual({
      "oneuptime.change.source": "service-version",
      "service.version": "2",
      "oneuptime.change.previous_version": "1",
    });
  });
});

describe("buildKubernetesRolloutChangeEntry", () => {
  test("a rollout, with the previous ReplicaSet and the cluster", () => {
    const entry: ParsedChangeEventEntry = buildKubernetesRolloutChangeEntry({
      signal: {
        clusterName: "prod-eu",
        namespace: "web",
        deploymentName: "api",
        replicaSetName: "api-7d4f9c",
      },
      previousReplicaSetName: "api-5b8c2d",
      kubernetesClusterId: CLUSTER_ID,
      serviceVersion: "2.3.1",
      time: TIME,
    });

    expect(entry.time).toBe(TIME);
    expect(entry.eventType).toBe("deployment");
    expect(entry.title).toBe("Rolled out web/api");
    expect(entry.description).toContain(
      "Kubernetes deployment web/api in cluster prod-eu started a new ReplicaSet, api-7d4f9c; its pods ran api-5b8c2d before.",
    );
    expect(entry.attributes).toEqual({
      "oneuptime.change.source": "kubernetes",
      "k8s.deployment.name": "api",
      "k8s.replicaset.name": "api-7d4f9c",
      "oneuptime.change.previous_replicaset": "api-5b8c2d",
      "k8s.namespace.name": "web",
      "k8s.cluster.name": "prod-eu",
      "oneuptime.kubernetes.cluster.id": CLUSTER_ID.toString(),
      "service.version": "2.3.1",
    });
  });

  test("leaves out what is not known, and a placeholder version", () => {
    const entry: ParsedChangeEventEntry = buildKubernetesRolloutChangeEntry({
      signal: {
        clusterName: "",
        namespace: "",
        deploymentName: "api",
        replicaSetName: "api-2",
      },
      previousReplicaSetName: "api-1",
      serviceVersion: "latest",
      time: TIME,
    });

    expect(entry.title).toBe("Rolled out api");
    expect(entry.description).toContain(
      "Kubernetes deployment api started a new ReplicaSet, api-2",
    );
    expect(entry.attributes).toEqual({
      "oneuptime.change.source": "kubernetes",
      "k8s.deployment.name": "api",
      "k8s.replicaset.name": "api-2",
      "oneuptime.change.previous_replicaset": "api-1",
    });
  });
});
