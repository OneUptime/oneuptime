import KubernetesResourceService from "../../../../Server/Services/KubernetesResourceService";
import logger from "../../../../Server/Utils/Logger";
import KubernetesEphemeralVolumeClaims, {
  K8S_CLAIM_NAME_ATTRIBUTE,
  K8S_VOLUME_TYPE_ATTRIBUTE,
  getEphemeralVolumeClaimName,
  getPodOwnedClaimKey,
  isUnnamedKubernetesVolume,
  nameEphemeralVolumeClaim,
  readKubernetesVolumeIdentity,
  toPodOwnedClaimKeys,
} from "../../../../Server/Utils/Telemetry/KubernetesEphemeralVolumeClaims";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A generic ephemeral volume's usage, filed under its claim (#9644). The
 * kubeletstats receiver (0.161.0) labels no `ephemeral:` volume: on a KinD
 * node it reported a pod's ephemeral volume "scratch" with neither
 * k8s.volume.type nor k8s.persistentvolumeclaim.name, beside its claim
 * volume "data" (persistentVolumeClaim, data2) and its token
 * (kube-api-access-*, no type either). Kubernetes made the claim
 * "web2-scratch", owned by the pod. Ingest names it so, and nothing else.
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

  test("one the receiver named no claim and gave no type it knows", () => {
    expect(
      isUnnamedKubernetesVolume(
        readKubernetesVolumeIdentity(volumeAttributes({})),
      ),
    ).toBe(true);
    // Should the receiver ever type it before naming it.
    expect(
      isUnnamedKubernetesVolume(
        readKubernetesVolumeIdentity(volumeAttributes({ type: "ephemeral" })),
      ),
    ).toBe(true);
    for (const type of ["configMap", "secret", "emptyDir", "hostPath"]) {
      expect(
        isUnnamedKubernetesVolume(
          readKubernetesVolumeIdentity(volumeAttributes({ type })),
        ),
      ).toBe(false);
    }
    expect(
      isUnnamedKubernetesVolume(
        readKubernetesVolumeIdentity(
          volumeAttributes({ type: "persistentVolumeClaim", claim: "data2" }),
        ),
      ),
    ).toBe(false);
    expect(
      isUnnamedKubernetesVolume(
        readKubernetesVolumeIdentity(volumeAttributes({ pod: "" })),
      ),
    ).toBe(false);
  });

  test("Kubernetes names the claim `<pod>-<volume>`", () => {
    expect(getEphemeralVolumeClaimName("web2", "scratch")).toBe("web2-scratch");
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
    expect(nameEphemeralVolumeClaim(attributes, OWNED)).toBe(false);
    expect(valueOf(attributes, K8S_CLAIM_NAME_ATTRIBUTE)).toBe("data2");
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
    await KubernetesEphemeralVolumeClaims.nameClaim({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      attributes: volumeAttributes({ type: "configMap" }),
    });
    await KubernetesEphemeralVolumeClaims.nameClaim({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      attributes: [{ key: "k8s.node.name", value: { stringValue: "node-1" } }],
    });
    expect(read).not.toHaveBeenCalled();
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
