import PageComponentProps from "../PageComponentProps";
import AuditLogsEnterpriseUpgrade from "../../Components/AuditLogs/AuditLogsEnterpriseUpgrade";
import { EnterpriseUpgradeReason } from "../../Components/EnterpriseEdition/EnterpriseFeatureUpgrade";
import { AUDIT_LOGS_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Settings > Audit Logs: the project's recording switch and retention.
 *
 * The settings form is Enterprise code (ee/Dashboard/AuditLogs/
 * AuditLogsSettings); this page stays at its route's path and renders it
 * through the Dashboard plugin when the project may have audit logs and the
 * build includes the Enterprise screens, and the audit log upsell card
 * otherwise.
 */
const AuditLogsSettings: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <EnterprisePluginPage<PageComponentProps>
      plugin={getDashboardPlugins().SettingsAuditLogsSettings}
      pluginProps={props}
      requiredPlan={AUDIT_LOGS_REQUIRED_PLAN}
      renderUpsell={(reason: EnterpriseUpgradeReason): ReactElement => {
        return (
          <AuditLogsEnterpriseUpgrade
            title="Audit Logs Settings"
            description="Configure how long audit logs are retained for this project."
            featureDescription="Toggle audit logging for this project and choose how long we keep the history."
            reason={reason}
          />
        );
      }}
    />
  );
};

export default AuditLogsSettings;
