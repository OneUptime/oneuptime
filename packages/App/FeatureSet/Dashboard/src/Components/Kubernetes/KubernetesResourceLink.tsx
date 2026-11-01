import React, { FunctionComponent, ReactElement } from "react";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  getDeploymentConfigNameFromReplicationController,
  getDeploymentNameFromReplicaSet,
} from "Common/Types/Kubernetes/KubernetesHealth";
import { getKubernetesPartRoute } from "../../Pages/Kubernetes/Utils/KubernetesPartRoutes";

/*
 * A link to a Kubernetes object's page, by its kind and name - an owner
 * reference, a pod's node, a workload's namespace. A ReplicaSet opens the
 * Deployment that made it (`<deployment>-<hash>`), a ReplicationController
 * its DeploymentConfig (`<deploymentconfig>-<version>`): OneUptime has no
 * page of their own. A namespaced object opens in its namespace
 * (KubernetesPartRoutes), so a same-named one elsewhere never opens instead.
 */

export interface ComponentProps {
  modelId: ObjectID;
  resourceKind: string;
  resourceName: string;
  // Which one, for a kind whose names repeat across namespaces.
  namespace?: string | undefined;
  className?: string | undefined;
}

export function getKubernetesResourceLinkTarget(data: {
  kind: string;
  name: string;
}): { kind: string; name: string } {
  if (data.kind === "ReplicaSet") {
    return {
      kind: "Deployment",
      name: getDeploymentNameFromReplicaSet(data.name),
    };
  }
  if (data.kind === "ReplicationController") {
    return {
      kind: "DeploymentConfig",
      name: getDeploymentConfigNameFromReplicationController(data.name),
    };
  }
  return data;
}

const KubernetesResourceLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const target: { kind: string; name: string } =
    getKubernetesResourceLinkTarget({
      kind: props.resourceKind,
      name: props.resourceName,
    });
  const route: Route | undefined = getKubernetesPartRoute(props.modelId, {
    kind: target.kind,
    name: target.name,
    namespace: props.namespace,
  });

  if (!route) {
    // No detail page for this kind — render as plain text
    return <span className={props.className}>{props.resourceName}</span>;
  }

  return (
    <span
      onClick={() => {
        Navigation.navigate(route);
      }}
      className={`text-indigo-600 hover:text-indigo-800 cursor-pointer font-medium ${props.className || ""}`}
    >
      {props.resourceName}
    </span>
  );
};

export default KubernetesResourceLink;
