import ComplianceFramework, {
  ALL_COMPLIANCE_FRAMEWORKS,
  isComplianceFramework,
} from "./ComplianceFramework";
import {
  ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS,
  KubernetesComplianceFramework,
  isKubernetesComplianceFramework,
} from "../Kubernetes/Compliance/KubernetesComplianceFramework";

/*
 * WHAT A COMPLIANCE SETTING CAN TURN OFF (#9555, #9627): a data framework
 * Data Security scores over a resource's data stores, or - on a Kubernetes
 * cluster - one of the frameworks the cluster itself is scored against.
 * One record, DataSecurityComplianceSetting, holds both, so every
 * Compliance page turns things off, and says who did and why, one way.
 */
export type ComplianceSettingFramework =
  | ComplianceFramework
  | KubernetesComplianceFramework;

export const ALL_COMPLIANCE_SETTING_FRAMEWORKS: ReadonlyArray<ComplianceSettingFramework> =
  [...ALL_COMPLIANCE_FRAMEWORKS, ...ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS];

export function isComplianceSettingFramework(
  value: unknown,
): value is ComplianceSettingFramework {
  return isComplianceFramework(value) || isKubernetesComplianceFramework(value);
}
