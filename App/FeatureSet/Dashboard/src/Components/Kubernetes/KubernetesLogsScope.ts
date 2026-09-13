/*
 * How the Kubernetes pod / container Logs tab scopes the logs viewer, and
 * what its locked chips read.
 *
 * Kept free of React so the filter the tab sends and the chips it shows can
 * be unit-tested directly — the App suite runs in plain Node.
 */

export const KUBERNETES_CLUSTER_NAME_ATTRIBUTE: string =
  "resource.k8s.cluster.name";
export const KUBERNETES_POD_NAME_ATTRIBUTE: string = "resource.k8s.pod.name";
export const KUBERNETES_CONTAINER_NAME_ATTRIBUTE: string =
  "resource.k8s.container.name";
export const KUBERNETES_NAMESPACE_NAME_ATTRIBUTE: string =
  "resource.k8s.namespace.name";

export interface KubernetesLogsScopeInput {
  clusterIdentifier: string;
  clusterName?: string | undefined;
  podName?: string | undefined;
  containerName?: string | undefined;
  namespace?: string | undefined;
}

type HasValueFunction = (value: string | undefined) => boolean;

const hasValue: HasValueFunction = (value: string | undefined): boolean => {
  return Boolean(value && value.trim().length > 0);
};

type BuildKubernetesLogsAttributeFiltersFunction = (
  input: KubernetesLogsScopeInput,
) => Record<string, string>;

/**
 * The `logQuery.attributes` the tab pins on the viewer.
 *
 * The cluster is the scope boundary and is always sent: dropping it would
 * widen the tab to every cluster that happens to run a pod or container of
 * the same name.
 *
 * Pod, container and namespace are only sent when they carry a value. An
 * empty string is NOT "no filter" — the analytics query compiles a bare
 * attribute value to `attributes['<key>'] = ''`, which matches only rows
 * WITHOUT that attribute. The container detail page has no pod name and
 * used to pass `podName=""`, so its Logs tab silently asked for container
 * logs that carry no pod name (none, for the filelog receiver) and rendered
 * an empty "Pod:" chip on top of it.
 */
export const buildKubernetesLogsAttributeFilters: BuildKubernetesLogsAttributeFiltersFunction =
  (input: KubernetesLogsScopeInput): Record<string, string> => {
    const attributeFilters: Record<string, string> = {
      [KUBERNETES_CLUSTER_NAME_ATTRIBUTE]: input.clusterIdentifier,
    };

    if (hasValue(input.podName)) {
      attributeFilters[KUBERNETES_POD_NAME_ATTRIBUTE] = input.podName!;
    }

    if (hasValue(input.containerName)) {
      attributeFilters[KUBERNETES_CONTAINER_NAME_ATTRIBUTE] =
        input.containerName!;
    }

    if (hasValue(input.namespace)) {
      attributeFilters[KUBERNETES_NAMESPACE_NAME_ATTRIBUTE] = input.namespace!;
    }

    return attributeFilters;
  };

/*
 * Friendly labels for the locked chips. Pinned explicitly here rather than
 * relying on the viewer's built-in fallbacks, so the chip reads "Cluster"
 * and never the raw OTel key even if those fallbacks change.
 */
export const KUBERNETES_LOGS_ATTRIBUTE_DISPLAY_KEYS: Record<string, string> = {
  [KUBERNETES_CLUSTER_NAME_ATTRIBUTE]: "Cluster",
  [KUBERNETES_POD_NAME_ATTRIBUTE]: "Pod",
  [KUBERNETES_CONTAINER_NAME_ATTRIBUTE]: "Container",
  [KUBERNETES_NAMESPACE_NAME_ATTRIBUTE]: "Namespace",
};

type GetKubernetesClusterDisplayNameFunction = (input: {
  clusterIdentifier?: string | undefined;
  clusterName?: string | undefined;
}) => string;

/*
 * The cluster's name as the user gave it, falling back to the
 * k8s.cluster.name identifier telemetry carries when no name is loaded.
 */
export const getKubernetesClusterDisplayName: GetKubernetesClusterDisplayNameFunction =
  (input: {
    clusterIdentifier?: string | undefined;
    clusterName?: string | undefined;
  }): string => {
    if (hasValue(input.clusterName)) {
      return input.clusterName!.trim();
    }

    return input.clusterIdentifier || "";
  };

type BuildKubernetesLogsAttributeDisplayValuesFunction = (
  input: KubernetesLogsScopeInput,
) => Record<string, string>;

/**
 * Display-only overrides for the locked chips. The filter keeps matching the
 * cluster identifier (that is what telemetry carries in k8s.cluster.name);
 * only the chip swaps it for the cluster's name. Pod, container and
 * namespace values already are the names people know, so they are left
 * alone.
 */
export const buildKubernetesLogsAttributeDisplayValues: BuildKubernetesLogsAttributeDisplayValuesFunction =
  (input: KubernetesLogsScopeInput): Record<string, string> => {
    const displayName: string = getKubernetesClusterDisplayName({
      clusterIdentifier: input.clusterIdentifier,
      clusterName: input.clusterName,
    });

    if (!displayName) {
      return {};
    }

    return {
      [KUBERNETES_CLUSTER_NAME_ATTRIBUTE]: displayName,
    };
  };
