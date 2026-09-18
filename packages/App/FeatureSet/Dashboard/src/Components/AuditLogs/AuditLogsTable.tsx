import AuditLogsEnterpriseUpgrade from "./AuditLogsEnterpriseUpgrade";
import { EnterpriseUpgradeReason } from "../EnterpriseEdition/EnterpriseFeatureUpgrade";
import { AUDIT_LOGS_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { AuditLogsTableProps } from "../../Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The audit log table every resource page shows (Monitors, Incidents, SLOs,
 * Settings > Audit Logs and the rest - this component and its props are what
 * they all import, so none of them changes).
 *
 * The table itself is Enterprise code (ee/Dashboard/AuditLogs/AuditLogsTable):
 * this shell renders it through the Dashboard plugin when the project may
 * have audit logs AND this build includes the Enterprise screens, and the
 * audit log upsell card otherwise - with the reason, so a Cloud project on the
 * Enterprise plan is never told to upgrade its plan when the build merely
 * lacks the Enterprise screens.
 */
export type ComponentProps = AuditLogsTableProps;

const AuditLogsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <EnterprisePluginPage<ComponentProps>
      plugin={getDashboardPlugins().AuditLogsTable}
      pluginProps={props}
      requiredPlan={AUDIT_LOGS_REQUIRED_PLAN}
      renderUpsell={(reason: EnterpriseUpgradeReason): ReactElement => {
        return (
          <AuditLogsEnterpriseUpgrade
            title={props.title}
            description={props.description}
            reason={reason}
          />
        );
      }}
    />
  );
};

export default AuditLogsTable;
