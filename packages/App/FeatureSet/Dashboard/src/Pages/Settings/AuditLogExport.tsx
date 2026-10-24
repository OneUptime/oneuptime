import PageComponentProps from "../PageComponentProps";
import { ProjectAuditLogExportsLeftover } from "../../Components/Billing/AuditLogExportPlanLeftovers";
import { AUDIT_LOGS_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Settings > Audit Logs > Export: where the project's audit log is sent as
 * it is recorded - S3 or S3-compatible storage, Google Cloud Storage, Azure
 * Blob Storage, a webhook or syslog.
 *
 * The screen is part of the Enterprise Edition (ee/Dashboard/AuditLogExport),
 * and so is the exporter. This shell keeps the route: it renders the
 * Enterprise screen when the project may use audit logs and this build
 * includes it, and the upsell card otherwise - on OneUptime Cloud below the
 * Enterprise plan with the exports the project still has under it, which
 * stopped exporting and can be turned off and deleted
 * (ProjectAuditLogExportsLeftover).
 */
const AuditLogExportPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <EnterprisePluginPage
      plugin={getDashboardPlugins().SettingsAuditLogExport}
      pluginProps={props}
      requiredPlan={AUDIT_LOGS_REQUIRED_PLAN}
      belowPlan={<ProjectAuditLogExportsLeftover />}
      upsell={{
        title: "Export Audit Logs",
        description:
          "Send this project's audit log to storage or a service you choose.",
        featureName: "Audit Log Export",
        featureDescription:
          "Every entry of the audit log, sent as it is recorded to your own storage, SIEM or log pipeline, and kept there as long as you need.",
        featureIcon: IconProp.DocumentArrowUp,
        planPitchLine:
          "Audit log export is available on the Enterprise plan. Upgrade to send this project's audit log where you keep your records.",
        editionPitchLine:
          "Audit log export is a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to send the audit log where you keep your records.",
        benefits: [
          {
            icon: IconProp.Archive,
            title: "Your own storage",
            subtitle:
              "Amazon S3, S3-compatible storage, Google Cloud Storage or Azure Blob Storage, as compressed JSON files.",
          },
          {
            icon: IconProp.Link,
            title: "Your SIEM or pipeline",
            subtitle:
              "A webhook for an HTTP intake or log shipper, or syslog over TLS.",
          },
          {
            icon: IconProp.CheckCircle,
            title: "Nothing missed",
            subtitle:
              "Each entry is sent once, in order. A failed delivery is retried until it succeeds.",
          },
          {
            icon: IconProp.Lock,
            title: "No secrets in the logs",
            subtitle:
              "Keys, tokens and passwords never leave in an entry: they show as redacted.",
          },
        ],
      }}
    />
  );
};

export default AuditLogExportPage;
