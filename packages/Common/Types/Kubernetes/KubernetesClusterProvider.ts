import { normalizeCloudPlatform } from "../Cloud/CloudPlatform";

/*
 * The platform a Kubernetes cluster runs on, as a cluster's Provider
 * (KubernetesCluster.provider) names it, read from the resource attributes
 * of the telemetry the cluster sends.
 *
 *   - The kubernetes-agent chart's openshift preset stamps
 *     oneuptime.kubernetes.distribution=openshift on everything its
 *     collectors send (kubernetes-agent.distributionAttribute), on every
 *     platform, on-premises included: "OpenShift".
 *   - Otherwise a managed platform's cloud.platform, which an application's
 *     OpenTelemetry resource detector sets: "EKS", "GKE", "AKS", ...
 *
 * Anything else names no platform: null, which ingest never writes, so a
 * batch that carries neither leaves what the cluster shows.
 *
 * The label is the same for every record a cluster sends, so it never
 * alternates between two. That is why an OpenShift cluster is "OpenShift"
 * and not "OpenShift on AWS": the cloud comes from the collector's openshift
 * detector, which not every record has run through (the profiler's records
 * have not, and a collector whose detector failed at startup sends none).
 * The cloud stays on the telemetry itself, as cloud.provider and
 * cloud.platform.
 */

export const KUBERNETES_DISTRIBUTION_ATTRIBUTE: string =
  "oneuptime.kubernetes.distribution";

// What an OpenShift cluster's Provider reads.
export const OPENSHIFT_KUBERNETES_PROVIDER: string = "OpenShift";

// oneuptime.kubernetes.distribution values, lowercase, and their label.
export const KUBERNETES_DISTRIBUTION_PROVIDERS: Readonly<
  Record<string, string>
> = {
  openshift: OPENSHIFT_KUBERNETES_PROVIDER,
};

// The semantic conventions' Kubernetes cloud.platform values, and their label.
export const KUBERNETES_CLOUD_PLATFORM_PROVIDERS: Readonly<
  Record<string, string>
> = {
  aws_eks: "EKS",
  gcp_kubernetes_engine: "GKE",
  azure_aks: "AKS",
  alibaba_cloud_ack: "ACK",
  tencent_cloud_eks: "Tencent EKS",
  aws_openshift: OPENSHIFT_KUBERNETES_PROVIDER,
  azure_openshift: OPENSHIFT_KUBERNETES_PROVIDER,
  gcp_openshift: OPENSHIFT_KUBERNETES_PROVIDER,
  ibm_cloud_openshift: OPENSHIFT_KUBERNETES_PROVIDER,
};

/*
 * Own-property lookup only: the values come off the wire, and a plain object
 * lookup would hand back Object.prototype members for "constructor",
 * "__proto__" or "toString".
 */
function labelFor(
  labels: Readonly<Record<string, string>>,
  key: string,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(labels, key)) {
    return null;
  }
  const label: string | undefined = labels[key];
  return typeof label === "string" && label ? label : null;
}

export function getKubernetesClusterProvider(data: {
  distribution?: string | null | undefined;
  cloudPlatform?: string | null | undefined;
}): string | null {
  const distribution: string = (data.distribution || "").trim().toLowerCase();

  if (distribution) {
    const label: string | null = labelFor(
      KUBERNETES_DISTRIBUTION_PROVIDERS,
      distribution,
    );

    if (label) {
      return label;
    }
  }

  const cloudPlatform: string | null = normalizeCloudPlatform(
    data.cloudPlatform,
  );

  if (cloudPlatform) {
    return labelFor(KUBERNETES_CLOUD_PLATFORM_PROVIDERS, cloudPlatform);
  }

  return null;
}

/*
 * Whether a cluster's stored Provider says it is OpenShift, for what is true
 * of the platform whichever cloud it runs on. Every way to it writes the same
 * label, and the comparison ignores case, as the distribution's does.
 */
export function isOpenShiftClusterProvider(
  provider: string | null | undefined,
): boolean {
  return (
    (provider || "").trim().toLowerCase() ===
    OPENSHIFT_KUBERNETES_PROVIDER.toLowerCase()
  );
}

/*
 * What a cluster's Provider shows for the stored value: nothing when no
 * telemetry has named the platform yet (the column's default is "unknown").
 */
export function getKubernetesClusterProviderLabel(
  provider: string | null | undefined,
): string | null {
  const trimmed: string = (provider || "").trim();

  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    return null;
  }

  return trimmed;
}
