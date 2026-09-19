import EnterpriseFeatureUpgrade, {
  Benefit,
  EnterpriseUpgradeReason,
} from "../EnterpriseEdition/EnterpriseFeatureUpgrade";
import {
  AUDIT_LOGS_REQUIRED_PLAN,
  isEnterpriseFeatureEligible,
} from "../../Enterprise/EnterpriseEligibility";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Audit logs are the one enterprise feature sold at the Enterprise plan rather
 * than Scale, so the same eligibility check runs with that tier. Kept as its
 * own export because the audit log table, the settings page and their tests
 * all import it under this name.
 */
export const isAuditLogsEnterpriseEligible: () => boolean = (): boolean => {
  return isEnterpriseFeatureEligible(AUDIT_LOGS_REQUIRED_PLAN);
};

export interface ComponentProps {
  title: string;
  description: string;
  featureDescription?: string | undefined;
  // Defaults to Plan on the Cloud and Edition when self-hosted.
  reason?: EnterpriseUpgradeReason | undefined;
}

const DEFAULT_FEATURE_DESCRIPTION: string =
  "Record every create, update and delete performed on this project's resources.";

const BENEFITS: Array<Benefit> = [
  {
    icon: IconProp.ClipboardDocumentList,
    title: "Track every change",
    subtitle:
      "Who changed what, when, and how — across monitors, incidents, on-call, status pages, and more.",
  },
  {
    icon: IconProp.ShieldCheck,
    title: "Compliance-ready",
    subtitle:
      "Retain a tamper-resistant history to support SOC 2, ISO 27001, HIPAA and internal reviews.",
  },
  {
    icon: IconProp.MagnifyingGlass,
    title: "Diff-level detail",
    subtitle:
      "See exact field-level before/after values for every create, update and delete action.",
  },
  {
    icon: IconProp.Clock,
    title: "Configurable retention",
    subtitle:
      "Keep audit history for 7 to 180 days to match your compliance requirements.",
  },
];

/*
 * The audit log upsell is the shared enterprise card with audit-log wording:
 * one card, so the two can no longer drift apart (they were two copies of the
 * same markup, each with its own eligibility rule).
 */
const AuditLogsEnterpriseUpgrade: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <EnterpriseFeatureUpgrade
      title={props.title}
      description={props.description}
      featureName="Audit Logs"
      featureDescription={
        props.featureDescription || DEFAULT_FEATURE_DESCRIPTION
      }
      featureIcon={IconProp.ClipboardDocumentList}
      benefits={BENEFITS}
      requiredPlan={AUDIT_LOGS_REQUIRED_PLAN}
      reason={props.reason}
      planPitchLine="Audit Logs are available on the Enterprise plan. Upgrade to turn on audit logging for this project."
      editionPitchLine="Audit Logs are a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to enable audit logging."
    />
  );
};

export default AuditLogsEnterpriseUpgrade;
