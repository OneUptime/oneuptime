import PageComponentProps from "../../PageComponentProps";
import KubernetesComplianceSection from "../../../Components/KubernetesCompliance/KubernetesComplianceSection";
import ResourceCompliancePage from "../../../Components/ResourceDataSecurity/ResourceCompliancePage";
import {
  ResourceDataSecurityMenu,
  useResourceDataSecurityMenu,
} from "../../../Components/ResourceDataSecurity/UseResourceSecurityMenu";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One cluster's Compliance: how the cluster itself stands against the Pod
 * Security Standards and the CIS Kubernetes Benchmark (#9627,
 * KubernetesComplianceSection), and - while Data Security is shown for it
 * and the cluster runs a database it read - how those databases stand
 * against each framework Data Security scores (#9555,
 * ResourceCompliancePage). Each has the switches that turn a framework, or
 * one of its controls or requirements, off for this cluster.
 */
const DATABASES_TITLE: string = translationKey("Databases on This Cluster");

const KubernetesClusterCompliance: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const dataSecurity: ResourceDataSecurityMenu | null =
    useResourceDataSecurityMenu({
      kind: DataStoreResourceKind.KubernetesCluster,
      modelId,
    });

  return (
    <div className="space-y-4">
      <KubernetesComplianceSection clusterId={modelId} />
      {dataSecurity ? (
        <ResourceCompliancePage
          {...props}
          kind={DataStoreResourceKind.KubernetesCluster}
          title={DATABASES_TITLE}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default KubernetesClusterCompliance;
