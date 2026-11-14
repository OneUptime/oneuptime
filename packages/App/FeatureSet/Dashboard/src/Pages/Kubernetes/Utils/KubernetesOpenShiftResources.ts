import {
  OpenShiftRouteBackend,
  OpenShiftRouteObject,
} from "Common/Types/Kubernetes/OpenShiftObjectParser";
import {
  KubernetesObjectMetadata,
  KubernetesServiceObject,
  KubernetesServicePort,
} from "./KubernetesObjectParser";
import {
  getGlobalTranslator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { LEFT_TO_RIGHT_ISOLATE } from "Common/Types/CodeInSentence";
import {
  isRightToLeftLanguage,
  POP_DIRECTIONAL_ISOLATE,
} from "Common/Types/ReadingDirection";

/*
 * What the pages of a Route, a Service and a DeploymentConfig read off those
 * objects (Common/Types/Kubernetes/OpenShiftObjectParser). Plain logic, free
 * of React and of the API client, so App/Tests can read it.
 */

/*
 * The label OpenShift sets on every pod of a DeploymentConfig, whichever
 * rollout made it: those pods are owned by the rollout's
 * ReplicationController, so their ownerReferences never name it.
 */
export const DEPLOYMENT_CONFIG_POD_LABEL: string = "deploymentconfig";

// That label on a pod's telemetry, as the chart's collectors extract it.
export const DEPLOYMENT_CONFIG_POD_ATTRIBUTE: string =
  "resource.k8s.pod.label.deploymentconfig";

// A Route's backend, with the share of traffic its weight gives it.
export interface OpenShiftRouteTarget {
  kind: string;
  name: string;
  // A percentage, or null when the Route has one backend.
  sharePercent: number | null;
}

// What a Route sends traffic to: its backend, and its alternate backends.
export function getRouteTargets(
  route: Pick<OpenShiftRouteObject, "spec">,
): Array<OpenShiftRouteTarget> {
  const backends: Array<OpenShiftRouteBackend> = [
    route.spec.to,
    ...(route.spec.alternateBackends || []),
  ].filter((backend: OpenShiftRouteBackend): boolean => {
    return Boolean(backend && backend.name);
  });

  if (backends.length < 2) {
    return backends.map(
      (backend: OpenShiftRouteBackend): OpenShiftRouteTarget => {
        return { kind: backend.kind, name: backend.name, sharePercent: null };
      },
    );
  }

  // A backend with no weight counts as OpenShift's default, 100.
  const weightOf: (backend: OpenShiftRouteBackend) => number = (
    backend: OpenShiftRouteBackend,
  ): number => {
    return backend.weight === null ? 100 : backend.weight;
  };

  const total: number = backends.reduce(
    (sum: number, backend: OpenShiftRouteBackend): number => {
      return sum + weightOf(backend);
    },
    0,
  );

  return backends.map(
    (backend: OpenShiftRouteBackend): OpenShiftRouteTarget => {
      return {
        kind: backend.kind,
        name: backend.name,
        sharePercent:
          total > 0 ? Math.round((weightOf(backend) / total) * 100) : 0,
      };
    },
  );
}

// The Route's host: its own, or the one a router assigned it.
export function getRouteHost(
  route: Pick<OpenShiftRouteObject, "spec" | "status">,
): string {
  return route.spec.host || route.status.ingress?.[0]?.host || "";
}

/*
 * The address a Route answers on, for a link. HTTPS when it terminates TLS,
 * in any of the three ways; plain HTTP otherwise. "" when it has no host
 * yet, or a wildcard one, which is no address.
 */
export function getRouteUrl(
  route: Pick<OpenShiftRouteObject, "spec" | "status">,
): string {
  const host: string = getRouteHost(route);

  if (!host || host.startsWith("*")) {
    return "";
  }

  const scheme: string = route.spec.tlsTermination ? "https" : "http";

  return `${scheme}://${host}${route.spec.path || ""}`;
}

const TLS_TERMINATIONS: Record<string, string> = {
  edge: translationKey("Edge"),
  passthrough: translationKey("Passthrough"),
  reencrypt: translationKey("Re-encrypt"),
};

// How a Route terminates TLS, in words; a plain HTTP Route says None.
export function getRouteTlsLabel(termination: string): string {
  const key: string = (termination || "").trim().toLowerCase();

  if (!key) {
    return translationKey("None");
  }

  return Object.prototype.hasOwnProperty.call(TLS_TERMINATIONS, key)
    ? (TLS_TERMINATIONS[key] as string)
    : termination;
}

/*
 * A Service's ports: "8080/TCP", "443→8443/TCP", "80:31080/TCP" for a node
 * port. Each is a notation read as written, so in a language read from the
 * right (the reader's, unless `language` says) each is set apart to read
 * from the left (LRI ... PDI). Laid out from the right, "443→8443/TCP" was
 * drawn "TCP/8443→443": its protocol first, and its arrow pointing from
 * the target port back at the port.
 */
export function getServicePortsLabel(
  ports: ReadonlyArray<KubernetesServicePort>,
  language: string = getGlobalTranslator().language,
): string {
  const isSetApart: boolean = isRightToLeftLanguage(language);

  return ports
    .map((port: KubernetesServicePort): string => {
      const target: string =
        port.targetPort && port.targetPort !== String(port.port)
          ? `→${port.targetPort}`
          : "";
      const nodePort: string = port.nodePort ? `:${port.nodePort}` : "";
      const notation: string = `${port.port}${nodePort}${target}/${port.protocol || "TCP"}`;

      return isSetApart
        ? `${LEFT_TO_RIGHT_ISOLATE}${notation}${POP_DIRECTIONAL_ISOLATE}`
        : notation;
    })
    .join(", ");
}

// Whether a Route sends traffic to a Service: only one in its own namespace.
export function isRouteToService(
  route: Pick<OpenShiftRouteObject, "metadata" | "spec">,
  service: Pick<KubernetesServiceObject, "metadata">,
): boolean {
  if (route.metadata.namespace !== service.metadata.namespace) {
    return false;
  }

  return getRouteTargets(route).some((target: OpenShiftRouteTarget) => {
    return (
      target.name === service.metadata.name &&
      (!target.kind || target.kind === "Service")
    );
  });
}

/*
 * Who owns a pod, for its page. A DeploymentConfig's pods name the
 * ReplicationController of a rollout, which has no page and says little: they
 * show the DeploymentConfig, which their label names.
 */
export function getPodOwnerReferences(
  metadata: Pick<KubernetesObjectMetadata, "labels" | "ownerReferences">,
): Array<{ kind: string; name: string }> {
  const deploymentConfig: string | undefined =
    metadata.labels[DEPLOYMENT_CONFIG_POD_LABEL];
  const owners: Array<{ kind: string; name: string }> =
    metadata.ownerReferences || [];

  const isOwnedByRollout: boolean = owners.some(
    (owner: { kind: string; name: string }): boolean => {
      return owner.kind === "ReplicationController";
    },
  );

  if (deploymentConfig && isOwnedByRollout) {
    return [{ kind: "DeploymentConfig", name: deploymentConfig }];
  }

  return owners;
}
