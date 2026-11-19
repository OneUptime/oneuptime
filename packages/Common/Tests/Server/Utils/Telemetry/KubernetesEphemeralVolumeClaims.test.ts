import KubernetesResourceService from "../../../../Server/Services/KubernetesResourceService";
import logger from "../../../../Server/Utils/Logger";
import KubernetesEphemeralVolumeClaims, {
  K8S_CLAIM_NAME_ATTRIBUTE,
  K8S_CLAIM_VOLUME_TYPE,
  K8S_EPHEMERAL_VOLUME_TYPE,
  K8S_VOLUME_TYPE_ATTRIBUTE,
  KubernetesVolumeClaimPlan,
  KubernetesVolumeClaimSource,
  getEphemeralVolumeClaimName,
  getPodOwnedClaimKey,
  nameEphemeralVolumeClaim,
  needsKubernetesVolumeClaimLookup,
  planKubernetesVolumeClaim,
  readKubernetesVolumeIdentity,
  toPodOwnedClaimKeys,
} from "../../../../Server/Utils/Telemetry/KubernetesEphemeralVolumeClaims";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
/*
 * jest itself is the global one: @jest/globals types jest.spyOn() as a spy
 * the global jest.SpiedFunction annotations here do not accept.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A generic ephemeral volume's usage, filed under its claim (#9644, #9842).
 * The kubeletstats receiver (0.161.0 to 0.165.0) labels no `ephemeral:`
 * volume: on a KinD node it reported a pod's ephemeral volume "scratch" with
 * neither k8s.volume.type nor k8s.persistentvolumeclaim.name, beside its
 * claim volume "data" (persistentVolumeClaim, data2) and its token
 * (kube-api-access-*, no type either). Kubernetes made the claim
 * "web2-scratch", owned by the pod. Ingest names it so, and nothing else.
 *
 * A collector that types the volume `ephemeral` (the pull request upstream,
 * opentelemetry-collector-contrib#52321), or names its claim as well (what
 * #52198 asks for), says what the lookup was for: its claim is then named
 * from the series alone, with no read of the cluster's claims.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const CLUSTER: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
const OTHER_CLUSTER: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000003",
);

// A volume's resource attributes, as the receiver stamps them.
function volumeAttributes(fields: {
  namespace?: string;
  pod?: string;
  volume?: string;
  type?: string | undefined;
  claim?: string | undefined;
}): JSONArray {
  const attributes: Array<[string, string]> = [
    ["k8s.cluster.name", "prod"],
    ["k8s.namespace.name", fields.namespace ?? "web"],
    ["k8s.pod.name", fields.pod ?? "web2"],
    ["k8s.pod.uid", "pod-uid"],
    ["k8s.volume.name", fields.volume ?? "scratch"],
  ];
  if (fields.type !== undefined) {
    attributes.push(["k8s.volume.type", fields.type]);
  }
  if (fields.claim !== undefined) {
    attributes.push(["k8s.persistentvolumeclaim.name", fields.claim]);
  }
  return attributes.map(([key, value]: [string, string]): JSONObject => {
    return { key: key, value: { stringValue: value } };
  });
}

function valueOf(attributes: JSONArray, key: string): unknown {
  const attribute: JSONObject | undefined = (
    attributes as Array<JSONObject>
  ).find((item: JSONObject): boolean => {
    return item["key"] === key;
  });
  return (attribute?.["value"] as JSONObject | undefined)?.["stringValue"];
}

const OWNED: ReadonlySet<string> = toPodOwnedClaimKeys([
  { namespace: "web", name: "web2-scratch", podName: "web2" },
]);

describe("which volumes could be a generic ephemeral volume's", () => {
  test("reads a volume's identity, and no other resource's", () => {
    expect(
      readKubernetesVolumeIdentity(
        volumeAttributes({ type: "persistentVolumeClaim", claim: "data2" }),
      ),
    ).toEqual({
      namespace: "web",
      podName: "web2",
      volumeName: "scratch",
      claimName: "data2",
      volumeType: "persistentVolumeClaim",
    });
    expect(
      readKubernetesVolumeIdentity([
        { key: "k8s.node.name", value: { stringValue: "node-1" } },
      ]),
    ).toBeNull();
    expect(readKubernetesVolumeIdentity(undefined)).toBeNull();
  });

  test("Kubernetes names the claim `<pod>-<volume>`", () => {
    expect(getEphemeralVolumeClaimName("web2", "scratch")).toBe("web2-scratch");
  });
});

describe("where a generic ephemeral volume's claim comes from", () => {
  function planOf(fields: Parameters<typeof volumeAttributes>[0]): unknown {
    return planKubernetesVolumeClaim(
      readKubernetesVolumeIdentity(volumeAttributes(fields)),
    );
  }

  test("a collector that types the volume ephemeral and names its claim: the series' claim, as it came", () => {
    expect(planOf({ type: "ephemeral", claim: "web2-scratch" })).toEqual({
      source: KubernetesVolumeClaimSource.Series,
      claimName: "web2-scratch",
    });
    // The series is believed over the rule it follows.
    expect(planOf({ type: "ephemeral", claim: "scratch-claim" })).toEqual({
      source: KubernetesVolumeClaimSource.Series,
      claimName: "scratch-claim",
    });
  });

  test("a series that names a claim on a volume it types not: that claim too", () => {
    expect(planOf({ claim: "web2-scratch" })).toEqual({
      source: KubernetesVolumeClaimSource.Series,
      claimName: "web2-scratch",
    });
    expect(planOf({ type: "", claim: "data2" })).toEqual({
      source: KubernetesVolumeClaimSource.Series,
      claimName: "data2",
    });
  });

  test("a collector that types the volume ephemeral and names no claim: `<pod>-<volume>`, with no lookup", () => {
    expect(planOf({ type: "ephemeral" })).toEqual({
      source: KubernetesVolumeClaimSource.Type,
      claimName: "web2-scratch",
    });
    expect(planOf({ type: K8S_EPHEMERAL_VOLUME_TYPE, pod: "db-0" })).toEqual({
      source: KubernetesVolumeClaimSource.Type,
      claimName: "db-0-scratch",
    });
  });

  test("a collector that neither types nor names it (0.165.0): `<pod>-<volume>`, once the cluster's claims confirm it", () => {
    expect(planOf({})).toEqual({
      source: KubernetesVolumeClaimSource.Lookup,
      claimName: "web2-scratch",
    });
    expect(planOf({ type: "" })).toEqual({
      source: KubernetesVolumeClaimSource.Lookup,
      claimName: "web2-scratch",
    });
    expect(
      needsKubernetesVolumeClaimLookup(
        readKubernetesVolumeIdentity(volumeAttributes({})),
      ),
    ).toBe(true);
  });

  test("only that one needs the cluster's claims", () => {
    for (const fields of [
      { type: "ephemeral" },
      { type: "ephemeral", claim: "web2-scratch" },
      { claim: "web2-scratch" },
      { type: "persistentVolumeClaim", claim: "data2" },
      { type: "projected" },
      { type: "configMap" },
    ]) {
      expect(
        needsKubernetesVolumeClaimLookup(
          readKubernetesVolumeIdentity(volumeAttributes(fields)),
        ),
      ).toBe(false);
    }
  });

  test("a claim's volume the receiver typed and named, and a disk's own type, are left alone", () => {
    expect(planOf({ type: "persistentVolumeClaim", claim: "data2" })).toBe(
      null,
    );
    // A receiver that reads the PersistentVolume names the disk instead.
    expect(planOf({ type: "awsElasticBlockStore", claim: "data2" })).toBe(null);
    expect(planOf({ type: "local", claim: "data2" })).toBe(null);
    // Typed a claim's but naming none: nothing to file it under.
    expect(planOf({ type: "persistentVolumeClaim" })).toBe(null);
  });

  test("no volume of any other type is a claim's: a projected one, a configMap, a secret, an emptyDir", () => {
    for (const type of [
      "projected",
      "configMap",
      "secret",
      "downwardAPI",
      "emptyDir",
      "hostPath",
    ]) {
      expect({ type, plan: planOf({ type }) }).toEqual({ type, plan: null });
    }
  });

  test("a volume with no pod or namespace names no claim it would have to make up", () => {
    expect(planOf({ pod: "" })).toBe(null);
    expect(planOf({ namespace: "" })).toBe(null);
    expect(planOf({ type: "ephemeral", pod: "" })).toBe(null);
    // A claim the series names needs neither.
    expect(
      planOf({ type: "ephemeral", pod: "", claim: "web2-scratch" }),
    ).toEqual({
      source: KubernetesVolumeClaimSource.Series,
      claimName: "web2-scratch",
    });
  });

  test("a resource that is no volume's has no plan", () => {
    expect(planKubernetesVolumeClaim(null)).toBe(null);
    expect(
      planKubernetesVolumeClaim(
        readKubernetesVolumeIdentity([
          { key: "k8s.node.name", value: { stringValue: "node-1" } },
        ]),
      ),
    ).toBe(null);
  });
});

describe("naming an ephemeral volume's claim", () => {
  test("stamps the claim's name and type, as the receiver names any claim's volume", () => {
    const attributes: JSONArray = volumeAttributes({});

    expect(nameEphemeralVolumeClaim(attributes, OWNED)).toBe(true);
    expect(valueOf(attributes, K8S_CLAIM_NAME_ATTRIBUTE)).toBe("web2-scratch");
    expect(valueOf(attributes, K8S_VOLUME_TYPE_ATTRIBUTE)).toBe(
      "persistentVolumeClaim",
    );
    // Each once.
    expect(
      (attributes as Array<JSONObject>).filter((item: JSONObject): boolean => {
        return item["key"] === K8S_VOLUME_TYPE_ATTRIBUTE;
      }),
    ).toHaveLength(1);
  });

  test("replaces an empty type it found", () => {
    const attributes: JSONArray = volumeAttributes({ type: "" });
    expect(nameEphemeralVolumeClaim(attributes, OWNED)).toBe(true);
    expect(valueOf(attributes, K8S_VOLUME_TYPE_ATTRIBUTE)).toBe(
      "persistentVolumeClaim",
    );
  });

  test("leaves a token, a projected volume or any volume no pod-owned claim matches as it came", () => {
    for (const volume of ["kube-api-access-x7k2p", "my-projected"]) {
      const attributes: JSONArray = volumeAttributes({ volume });
      const before: string = JSON.stringify(attributes);
      expect(nameEphemeralVolumeClaim(attributes, OWNED)).toBe(false);
      expect(JSON.stringify(attributes)).toBe(before);
    }
  });

  test("a claim of that name some other pod owns is not this volume's", () => {
    expect(
      nameEphemeralVolumeClaim(
        volumeAttributes({}),
        toPodOwnedClaimKeys([
          { namespace: "web", name: "web2-scratch", podName: "web2-old" },
        ]),
      ),
    ).toBe(false);
  });

  test("nor is one in another namespace", () => {
    expect(
      nameEphemeralVolumeClaim(volumeAttributes({ namespace: "other" }), OWNED),
    ).toBe(false);
    expect(getPodOwnedClaimKey("web", "web2-scratch", "web2")).not.toBe(
      getPodOwnedClaimKey("other", "web2-scratch", "web2"),
    );
  });

  test("never renames a volume the receiver named", () => {
    const attributes: JSONArray = volumeAttributes({
      type: "persistentVolumeClaim",
      claim: "data2",
    });
    const before: string = JSON.stringify(attributes);
    expect(nameEphemeralVolumeClaim(attributes, OWNED)).toBe(false);
    expect(valueOf(attributes, K8S_CLAIM_NAME_ATTRIBUTE)).toBe("data2");
    expect(JSON.stringify(attributes)).toBe(before);
  });

  test("a claim the series names is kept, and its volume typed a claim's, with no claims to look in", () => {
    const attributes: JSONArray = volumeAttributes({
      type: "ephemeral",
      claim: "scratch-claim",
    });

    expect(nameEphemeralVolumeClaim(attributes, null)).toBe(true);
    expect(valueOf(attributes, K8S_CLAIM_NAME_ATTRIBUTE)).toBe("scratch-claim");
    expect(valueOf(attributes, K8S_VOLUME_TYPE_ATTRIBUTE)).toBe(
      K8S_CLAIM_VOLUME_TYPE,
    );
    for (const key of [K8S_CLAIM_NAME_ATTRIBUTE, K8S_VOLUME_TYPE_ATTRIBUTE]) {
      expect(
        (attributes as Array<JSONObject>).filter(
          (item: JSONObject): boolean => {
            return item["key"] === key;
          },
        ),
      ).toHaveLength(1);
    }
    // Everything else as it came.
    expect(valueOf(attributes, "k8s.volume.name")).toBe("scratch");
    expect(valueOf(attributes, "k8s.pod.name")).toBe("web2");
  });

  test("a volume typed ephemeral is named `<pod>-<volume>` whatever the cluster's claims say", () => {
    for (const claims of [null, new Set<string>(), OWNED]) {
      const attributes: JSONArray = volumeAttributes({ type: "ephemeral" });

      expect(nameEphemeralVolumeClaim(attributes, claims)).toBe(true);
      expect(valueOf(attributes, K8S_CLAIM_NAME_ATTRIBUTE)).toBe(
        "web2-scratch",
      );
      expect(valueOf(attributes, K8S_VOLUME_TYPE_ATTRIBUTE)).toBe(
        K8S_CLAIM_VOLUME_TYPE,
      );
    }
  });

  test("an unlabelled volume is never named without the cluster's claims", () => {
    const attributes: JSONArray = volumeAttributes({});
    const before: string = JSON.stringify(attributes);

    expect(nameEphemeralVolumeClaim(attributes, null)).toBe(false);
    expect(nameEphemeralVolumeClaim(attributes, new Set<string>())).toBe(false);
    expect(JSON.stringify(attributes)).toBe(before);
  });

  test("a volume typed projected is never a claim's, whatever its name", () => {
    for (const volume of ["scratch", "kube-api-access-x7k2p", "bundle"]) {
      const attributes: JSONArray = volumeAttributes({
        volume,
        type: "projected",
      });
      const before: string = JSON.stringify(attributes);
      // Even where a claim of its `<pod>-<volume>` name is the pod's own.
      const claims: ReadonlySet<string> = toPodOwnedClaimKeys([
        { namespace: "web", name: `web2-${volume}`, podName: "web2" },
      ]);

      expect(nameEphemeralVolumeClaim(attributes, claims)).toBe(false);
      expect(JSON.stringify(attributes)).toBe(before);
    }
  });

  test("names what the plan says, and only that", () => {
    const cases: Array<{
      fields: Parameters<typeof volumeAttributes>[0];
      claim: string | undefined;
    }> = [
      { fields: {}, claim: "web2-scratch" },
      { fields: { type: "ephemeral" }, claim: "web2-scratch" },
      { fields: { type: "ephemeral", claim: "c1" }, claim: "c1" },
      { fields: { claim: "c2" }, claim: "c2" },
      {
        fields: { type: "persistentVolumeClaim", claim: "data2" },
        claim: "data2",
      },
      { fields: { type: "emptyDir" }, claim: undefined },
    ];

    for (const testCase of cases) {
      const attributes: JSONArray = volumeAttributes(testCase.fields);
      const plan: KubernetesVolumeClaimPlan | null = planKubernetesVolumeClaim(
        readKubernetesVolumeIdentity(attributes),
      );
      nameEphemeralVolumeClaim(attributes, OWNED);

      expect({
        fields: testCase.fields,
        claim: valueOf(attributes, K8S_CLAIM_NAME_ATTRIBUTE),
      }).toEqual({ fields: testCase.fields, claim: testCase.claim });
      if (plan) {
        expect(valueOf(attributes, K8S_CLAIM_NAME_ATTRIBUTE)).toBe(
          plan.claimName,
        );
      }
    }
  });
});

describe("KubernetesEphemeralVolumeClaims.nameClaim", () => {
  let read: jest.SpiedFunction<
    typeof KubernetesResourceService.getPodOwnedVolumeClaims
  >;

  beforeEach(() => {
    KubernetesEphemeralVolumeClaims.clearCache();
    read = jest
      .spyOn(KubernetesResourceService, "getPodOwnedVolumeClaims")
      .mockResolvedValue([
        { namespace: "web", name: "web2-scratch", podName: "web2" },
      ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    KubernetesEphemeralVolumeClaims.clearCache();
  });

  test("names the claim from the cluster's pod-owned claims", async () => {
    const attributes: JSONArray = volumeAttributes({});

    expect(
      await KubernetesEphemeralVolumeClaims.nameClaim({
        projectId: PROJECT,
        kubernetesClusterId: CLUSTER,
        attributes,
      }),
    ).toBe(true);
    expect(valueOf(attributes, K8S_CLAIM_NAME_ATTRIBUTE)).toBe("web2-scratch");
    expect(read).toHaveBeenCalledWith({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
    });
  });

  test("reads a cluster's claims once a minute, whatever the number of volumes", async () => {
    for (let i: number = 0; i < 5; i++) {
      await KubernetesEphemeralVolumeClaims.nameClaim({
        projectId: PROJECT,
        kubernetesClusterId: CLUSTER,
        attributes: volumeAttributes({ volume: `v-${i}` }),
      });
    }
    expect(read).toHaveBeenCalledTimes(1);

    await KubernetesEphemeralVolumeClaims.nameClaim({
      projectId: PROJECT,
      kubernetesClusterId: OTHER_CLUSTER,
      attributes: volumeAttributes({}),
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("batches that ask at once share one read", async () => {
    await Promise.all(
      [0, 1, 2].map((i: number) => {
        return KubernetesEphemeralVolumeClaims.nameClaim({
          projectId: PROJECT,
          kubernetesClusterId: CLUSTER,
          attributes: volumeAttributes({ volume: `v-${i}` }),
        });
      }),
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("never reads for a volume the receiver labelled, nor for a resource that is no volume", async () => {
    for (const type of ["configMap", "projected", "persistentVolumeClaim"]) {
      await KubernetesEphemeralVolumeClaims.nameClaim({
        projectId: PROJECT,
        kubernetesClusterId: CLUSTER,
        attributes: volumeAttributes({ type }),
      });
    }
    await KubernetesEphemeralVolumeClaims.nameClaim({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      attributes: [{ key: "k8s.node.name", value: { stringValue: "node-1" } }],
    });
    expect(read).not.toHaveBeenCalled();
  });

  test("takes the claim a series names, and reads none", async () => {
    const attributes: JSONArray = volumeAttributes({
      type: "ephemeral",
      claim: "web2-scratch",
    });

    expect(
      await KubernetesEphemeralVolumeClaims.nameClaim({
        projectId: PROJECT,
        kubernetesClusterId: CLUSTER,
        attributes,
      }),
    ).toBe(true);
    expect(valueOf(attributes, K8S_CLAIM_NAME_ATTRIBUTE)).toBe("web2-scratch");
    expect(valueOf(attributes, K8S_VOLUME_TYPE_ATTRIBUTE)).toBe(
      K8S_CLAIM_VOLUME_TYPE,
    );
    expect(read).not.toHaveBeenCalled();
  });

  test("names a volume typed ephemeral `<pod>-<volume>`, reading none, before the inventory has its claim", async () => {
    // A pod made since the last inventory snapshot: its claim is not there yet.
    read.mockResolvedValue([]);
    const attributes: JSONArray = volumeAttributes({
      pod: "web3",
      type: "ephemeral",
    });

    expect(
      await KubernetesEphemeralVolumeClaims.nameClaim({
        projectId: PROJECT,
        kubernetesClusterId: CLUSTER,
        attributes,
      }),
    ).toBe(true);
    expect(valueOf(attributes, K8S_CLAIM_NAME_ATTRIBUTE)).toBe("web3-scratch");
    expect(read).not.toHaveBeenCalled();
  });

  test("falls back to the cluster's claims for a volume the series neither types nor names", async () => {
    const named: JSONArray = volumeAttributes({});
    const unmatched: JSONArray = volumeAttributes({ volume: "bundle" });

    expect(
      await KubernetesEphemeralVolumeClaims.nameClaim({
        projectId: PROJECT,
        kubernetesClusterId: CLUSTER,
        attributes: named,
      }),
    ).toBe(true);
    expect(
      await KubernetesEphemeralVolumeClaims.nameClaim({
        projectId: PROJECT,
        kubernetesClusterId: CLUSTER,
        attributes: unmatched,
      }),
    ).toBe(false);

    expect(valueOf(named, K8S_CLAIM_NAME_ATTRIBUTE)).toBe("web2-scratch");
    expect(valueOf(unmatched, K8S_CLAIM_NAME_ATTRIBUTE)).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("a read that fails names nothing, says so once, and is not retried for a minute", async () => {
    read.mockRejectedValue(new Error("connection refused"));
    const warn: jest.SpiedFunction<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined as never;
      });
    const attributes: JSONArray = volumeAttributes({});

    expect(
      await KubernetesEphemeralVolumeClaims.nameClaim({
        projectId: PROJECT,
        kubernetesClusterId: CLUSTER,
        attributes,
      }),
    ).toBe(false);
    await KubernetesEphemeralVolumeClaims.nameClaim({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      attributes: volumeAttributes({}),
    });

    expect(valueOf(attributes, K8S_CLAIM_NAME_ATTRIBUTE)).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
