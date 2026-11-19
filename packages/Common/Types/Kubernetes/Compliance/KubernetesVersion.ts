/*
 * A KUBERNETES MINOR VERSION, AS THE COMPLIANCE SCORING READS ONE (#9627).
 *
 * The Pod Security Standards change with Kubernetes: a sysctl joins the safe
 * list (1.27, 1.29, 1.32, 1.37), the host of a probe becomes a Baseline
 * control (1.34), a pod in its own user namespace is relaxed (1.36). Pod
 * Security Admission scores a pod against the standard of the cluster's own
 * version unless a namespace pins another, so the cluster's Compliance page
 * does the same: the version of its nodes' kubelets - the API server's is
 * never older - capped at the newest standard this release knows.
 */

export interface KubernetesVersion {
  major: number;
  minor: number;
}

/*
 * The newest Pod Security Standards this release knows: the published
 * standard as of Kubernetes 1.37. A newer cluster is scored with it.
 */
export const NEWEST_POD_SECURITY_STANDARD: KubernetesVersion = {
  major: 1,
  minor: 37,
};

const VERSION_TEXT: RegExp = /^v?(\d+)\.(\d+)(?:[.+-]|$)/;

/*
 * "v1.31.4-eks-1a2b3c", "1.31", "v1.30.2+k3s1" -> 1.31, 1.31, 1.30; null for
 * what is not a version.
 */
export function parseKubernetesVersion(
  text: string | null | undefined,
): KubernetesVersion | null {
  const match: RegExpMatchArray | null = (text || "")
    .trim()
    .match(VERSION_TEXT);

  if (!match) {
    return null;
  }

  const major: number = parseInt(match[1] || "", 10);
  const minor: number = parseInt(match[2] || "", 10);

  return Number.isFinite(major) && Number.isFinite(minor)
    ? { major, minor }
    : null;
}

export function compareKubernetesVersions(
  a: KubernetesVersion,
  b: KubernetesVersion,
): number {
  return a.major !== b.major ? a.major - b.major : a.minor - b.minor;
}

// Whether the version is 1.<minor> or later.
export function isAtLeastMinor(
  version: KubernetesVersion,
  minor: number,
): boolean {
  return compareKubernetesVersions(version, { major: 1, minor }) >= 0;
}

export function formatKubernetesVersion(version: KubernetesVersion): string {
  return `${version.major}.${version.minor}`;
}

// The newest of the versions given (the cluster's nodes' kubelets); null for none.
export function getNewestKubernetesVersion(
  versions: ReadonlyArray<string | null | undefined>,
): KubernetesVersion | null {
  let newest: KubernetesVersion | null = null;

  for (const text of versions) {
    const version: KubernetesVersion | null = parseKubernetesVersion(text);

    if (
      version &&
      (!newest || compareKubernetesVersions(version, newest) > 0)
    ) {
      newest = version;
    }
  }

  return newest;
}

/*
 * The standard a cluster of this version is scored against: its own, or the
 * newest this release knows for a newer or an unknown one.
 */
export function getPodSecurityStandardVersion(
  clusterVersion: KubernetesVersion | null,
): KubernetesVersion {
  if (
    !clusterVersion ||
    compareKubernetesVersions(clusterVersion, NEWEST_POD_SECURITY_STANDARD) > 0
  ) {
    return NEWEST_POD_SECURITY_STANDARD;
  }

  return clusterVersion;
}
