import PageComponentProps from "../../PageComponentProps";
import ResourceSecurityEventsPage from "../../../Components/ResourceSecurity/ResourceSecurityEventsPage";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One cluster's Security Events (#9547): the Security Events explorer on
 * the events naming this cluster by its k8s.cluster.name - what its audit
 * log says, a shell opened in a pod, a secret read, a role changed, and any
 * other source's events naming it - the ones its Security card on Overview
 * counts, beside its Logs and Events (ResourceSecurityEventsPage).
 */
const KubernetesClusterSecurityEvents: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceSecurityEventsPage
      {...props}
      kind={SecurityConnectionKind.KubernetesCluster}
    />
  );
};

export default KubernetesClusterSecurityEvents;
