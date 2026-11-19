import PageComponentProps from "../PageComponentProps";
import KubernetesFleetComplianceSection from "../../Components/KubernetesCompliance/KubernetesFleetComplianceSection";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Kubernetes > Compliance (#9876): every cluster's hardening on one page -
 * each framework's score and failing controls, the lowest score first, each
 * cluster linked to its own Compliance page, and the project's export.
 */
const KubernetesCompliance: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <KubernetesFleetComplianceSection />;
};

export default KubernetesCompliance;
