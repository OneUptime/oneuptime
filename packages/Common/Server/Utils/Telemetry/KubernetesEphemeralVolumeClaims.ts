import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import KubernetesResourceService from "../../Services/KubernetesResourceService";
import logger from "../Logger";

/*
 * A GENERIC EPHEMERAL VOLUME'S USAGE, FILED UNDER ITS CLAIM (#9644).
 *
 * A pod volume declared `ephemeral:` is backed by a persistent volume claim
 * that Kubernetes makes for the pod, named `<pod>-<volume>` and owned by the
 * pod. The kubeletstats receiver labels no such volume (its
 * setResourcesFromVolume has no case for one, collector 0.161.0), so its
 * k8s.volume.* series named no claim: the claim's row said "Not reported",
 * its page charted nothing and PVC Almost Full never saw it.
 *
 * So ingest names it as the receiver names a claim's volume -
 * k8s.persistentvolumeclaim.name and k8s.volume.type persistentVolumeClaim -
 * when the claim `<pod>-<volume>` is in the cluster's inventory, owned by that
 * pod, before the rows are built: every page, template and Needs attention
 * then reads it as any other claim's. Kubernetes itself refuses a pod whose
 * `<pod>-<volume>` claim some other owner holds, so the owner is what tells
 * the claim apart from a namesake. A volume the receiver named, a volume of a
 * type it knows, and every volume no pod-owned claim matches go on as they
 * came. When the receiver learns of ephemeral volumes, it names them itself
 * and this does nothing.
 */

export const K8S_VOLUME_NAME_ATTRIBUTE: string = "k8s.volume.name";
export const K8S_VOLUME_TYPE_ATTRIBUTE: string = "k8s.volume.type";
export const K8S_CLAIM_NAME_ATTRIBUTE: string =
  "k8s.persistentvolumeclaim.name";
export const K8S_POD_NAME_ATTRIBUTE: string = "k8s.pod.name";
export const K8S_NAMESPACE_ATTRIBUTE: string = "k8s.namespace.name";
export const K8S_CLAIM_VOLUME_TYPE: string = "persistentVolumeClaim";

/*
 * How long a process keeps a cluster's pod-owned claims. A pod's claim is in
 * the inventory from the snapshot after it is made (every five minutes), so
 * a minute more costs at most a minute of a new pod's first readings.
 */
export const EPHEMERAL_CLAIMS_CACHE_MS: number = 60 * 1000;

// What a volume's resource says of it, as the receiver stamps it.
export interface KubernetesVolumeIdentity {
  namespace: string;
  podName: string;
  volumeName: string;
  claimName: string;
  volumeType: string;
}

function readString(attributes: JSONArray, key: string): string {
  for (const attribute of attributes) {
    if (!attribute || (attribute as JSONObject)["key"] !== key) {
      continue;
    }
    const value: JSONValue | undefined = (
      (attribute as JSONObject)["value"] as JSONObject | undefined
    )?.["stringValue"];
    return typeof value === "string" ? value.trim() : "";
  }
  return "";
}

/*
 * A volume's identity from its resource's attributes (an OTLP KeyValue
 * list), or null when the resource is no volume's.
 */
export function readKubernetesVolumeIdentity(
  attributes: JSONArray | undefined | null,
): KubernetesVolumeIdentity | null {
  if (!Array.isArray(attributes)) {
    return null;
  }
  const volumeName: string = readString(attributes, K8S_VOLUME_NAME_ATTRIBUTE);
  if (!volumeName) {
    return null;
  }
  return {
    namespace: readString(attributes, K8S_NAMESPACE_ATTRIBUTE),
    podName: readString(attributes, K8S_POD_NAME_ATTRIBUTE),
    volumeName: volumeName,
    claimName: readString(attributes, K8S_CLAIM_NAME_ATTRIBUTE),
    volumeType: readString(attributes, K8S_VOLUME_TYPE_ATTRIBUTE),
  };
}

/*
 * A volume that could be a generic ephemeral volume's: one the receiver
 * named no claim and gave no type it knows.
 */
export function isUnnamedKubernetesVolume(
  identity: KubernetesVolumeIdentity | null,
): identity is KubernetesVolumeIdentity {
  return Boolean(
    identity &&
      identity.namespace &&
      identity.podName &&
      !identity.claimName &&
      (!identity.volumeType || identity.volumeType === "ephemeral"),
  );
}

// The claim Kubernetes makes for a pod's ephemeral volume.
export function getEphemeralVolumeClaimName(
  podName: string,
  volumeName: string,
): string {
  return `${podName}-${volumeName}`;
}

// A pod-owned claim's key: its namespace, its name and the pod that owns it.
export function getPodOwnedClaimKey(
  namespace: string,
  claimName: string,
  podName: string,
): string {
  return `${namespace}\u0000${claimName}\u0000${podName}`;
}

export function toPodOwnedClaimKeys(
  claims: Array<{ namespace: string; name: string; podName: string }>,
): Set<string> {
  return new Set<string>(
    claims.map(
      (claim: { namespace: string; name: string; podName: string }): string => {
        return getPodOwnedClaimKey(claim.namespace, claim.name, claim.podName);
      },
    ),
  );
}

/*
 * Names an unnamed volume's claim on its resource, when its pod owns the
 * claim `<pod>-<volume>`. True when it did.
 */
export function nameEphemeralVolumeClaim(
  attributes: JSONArray,
  podOwnedClaims: ReadonlySet<string>,
): boolean {
  const identity: KubernetesVolumeIdentity | null =
    readKubernetesVolumeIdentity(attributes);
  if (!isUnnamedKubernetesVolume(identity)) {
    return false;
  }

  const claimName: string = getEphemeralVolumeClaimName(
    identity.podName,
    identity.volumeName,
  );
  if (
    !podOwnedClaims.has(
      getPodOwnedClaimKey(identity.namespace, claimName, identity.podName),
    )
  ) {
    return false;
  }

  // In place: what is stamped here is what the rows are built from.
  for (let i: number = attributes.length - 1; i >= 0; i--) {
    const key: unknown = (attributes[i] as JSONObject | undefined)?.["key"];
    if (key === K8S_CLAIM_NAME_ATTRIBUTE || key === K8S_VOLUME_TYPE_ATTRIBUTE) {
      attributes.splice(i, 1);
    }
  }
  attributes.push(
    { key: K8S_CLAIM_NAME_ATTRIBUTE, value: { stringValue: claimName } },
    {
      key: K8S_VOLUME_TYPE_ATTRIBUTE,
      value: { stringValue: K8S_CLAIM_VOLUME_TYPE },
    },
  );
  return true;
}

const claimsByCluster: InMemoryTTLCache<Set<string>> = new InMemoryTTLCache<
  Set<string>
>(5000);
const loading: Map<string, Promise<Set<string>>> = new Map();

export default class KubernetesEphemeralVolumeClaims {
  /*
   * Names the claim of a generic ephemeral volume's resource, in place,
   * before its rows are built. Reads the cluster's pod-owned claims at most
   * once a minute per process, and only for a volume that could be one.
   * Never throws: a read that fails leaves the volume as it came.
   */
  public static async nameClaim(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    attributes: JSONArray;
  }): Promise<boolean> {
    if (
      !isUnnamedKubernetesVolume(readKubernetesVolumeIdentity(data.attributes))
    ) {
      return false;
    }

    const claims: Set<string> = await this.getPodOwnedClaims({
      projectId: data.projectId,
      kubernetesClusterId: data.kubernetesClusterId,
    });

    if (claims.size === 0) {
      return false;
    }

    return nameEphemeralVolumeClaim(data.attributes, claims);
  }

  private static async getPodOwnedClaims(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
  }): Promise<Set<string>> {
    const cacheKey: string = `${data.projectId.toString()}:${data.kubernetesClusterId.toString()}`;
    const cached: Set<string> | undefined = claimsByCluster.get(cacheKey);
    if (cached) {
      return cached;
    }

    // One read for every batch of the cluster that asks at once.
    const inFlight: Promise<Set<string>> | undefined = loading.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const load: Promise<Set<string>> = (async (): Promise<Set<string>> => {
      let claims: Set<string> = new Set<string>();
      try {
        claims = toPodOwnedClaimKeys(
          await KubernetesResourceService.getPodOwnedVolumeClaims({
            projectId: data.projectId,
            kubernetesClusterId: data.kubernetesClusterId,
          }),
        );
      } catch (err) {
        logger.warn(
          `Could not read the pod-owned claims of Kubernetes cluster ${data.kubernetesClusterId.toString()}; its ephemeral volumes go unnamed for a minute: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      // An empty answer is kept too: a cluster with none asks again in a minute.
      claimsByCluster.set(cacheKey, claims, EPHEMERAL_CLAIMS_CACHE_MS);
      return claims;
    })();

    loading.set(cacheKey, load);
    try {
      return await load;
    } finally {
      loading.delete(cacheKey);
    }
  }

  // For tests: forget every cluster's claims.
  public static clearCache(): void {
    claimsByCluster.clear();
    loading.clear();
  }
}
