import Dictionary from "../../../Types/Dictionary";

/*
 * Kubernetes identity for OneUptime's own telemetry.
 *
 * The Node SDK's resource detectors report `host.name`, which inside a pod is
 * the pod's hostname. With nothing else on the resource, every OneUptime pod
 * that ever ran was catalogued as a *host* — a self-hosted estate with a few
 * dozen live pods showed hundreds of "hosts", most of them replaced by
 * redeploys weeks earlier and all of them kept for the 30-day host TTL.
 *
 * Reporting the pod's Kubernetes identity fixes the classification at the
 * source: the entity model then registers a pod (24h TTL) in its namespace,
 * on its node, as a replica of its deployment, and retires the legacy host
 * row the same observation proves wrong.
 *
 * Values come from the downward API environment the Helm chart sets
 * (POD_NAME, POD_NAMESPACE, NODE_NAME, POD_UID) plus the workload / cluster
 * names only the chart knows. When the chart variables are absent but the
 * process is plainly in a pod (the API server env var every pod gets), the
 * hostname and the service account namespace file stand in for them.
 */

/*
 * Kubernetes generates ReplicaSet hashes and pod suffixes from this alphabet
 * (no vowels, no 0/1/3), which is what makes a Deployment's pod name
 * recognisable: `<deployment>-<6..10 hash>-<5 suffix>`.
 */
const K8S_NAME_ALPHABET: string = "[bcdfghjklmnpqrstvwxz2456789]";
const DEPLOYMENT_POD_NAME_REGEX: RegExp = new RegExp(
  `^(.+)-${K8S_NAME_ALPHABET}{6,10}-${K8S_NAME_ALPHABET}{5}$`,
);

export interface KubernetesResourceInput {
  env: Dictionary<string | undefined>;
  hostname: string;
  /** Reads the pod's namespace from the mounted service account, or null. */
  readServiceAccountNamespace: () => string | null;
}

function value(input: string | undefined | null): string | null {
  const trimmed: string = (input || "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `oneuptime-app-6d4f8b9c7d-x2k9p` → `oneuptime-app`; null if not that shape. */
export function deploymentNameFromPodName(podName: string): string | null {
  const match: RegExpMatchArray | null = podName.match(
    DEPLOYMENT_POD_NAME_REGEX,
  );
  return match && match[1] ? match[1] : null;
}

export function getKubernetesResourceAttributes(
  input: KubernetesResourceInput,
): Dictionary<string> {
  const env: Dictionary<string | undefined> = input.env;
  const explicitPodName: string | null = value(env["POD_NAME"]);
  const inKubernetes: boolean =
    Boolean(explicitPodName) || Boolean(value(env["KUBERNETES_SERVICE_HOST"]));

  if (!inKubernetes) {
    return {};
  }

  const attributes: Dictionary<string> = {};

  const podName: string | null = explicitPodName || value(input.hostname);
  if (podName) {
    attributes["k8s.pod.name"] = podName;
  }

  let namespace: string | null = value(env["POD_NAMESPACE"]);
  if (!namespace) {
    try {
      namespace = value(input.readServiceAccountNamespace());
    } catch {
      namespace = null;
    }
  }
  if (namespace) {
    attributes["k8s.namespace.name"] = namespace;
  }

  const nodeName: string | null = value(env["NODE_NAME"]);
  if (nodeName) {
    attributes["k8s.node.name"] = nodeName;
  }

  const podUid: string | null = value(env["POD_UID"]);
  if (podUid) {
    attributes["k8s.pod.uid"] = podUid;
  }

  const deploymentName: string | null =
    value(env["K8S_DEPLOYMENT_NAME"]) ||
    (podName ? deploymentNameFromPodName(podName) : null);
  if (deploymentName) {
    attributes["k8s.deployment.name"] = deploymentName;
  }

  const clusterName: string | null = value(env["K8S_CLUSTER_NAME"]);
  if (clusterName) {
    attributes["k8s.cluster.name"] = clusterName;
  }

  return attributes;
}
