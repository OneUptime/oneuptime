import { PlanLeftoverTitle } from "./PlanLeftoverCopy";
import PlanLeftoverTable from "./PlanLeftoverTable";
import { AUDIT_LOGS_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a project below the Enterprise plan still has of audit log export,
 * drawn under the Export page's upsell (EnterprisePluginPage's belowPlan):
 * its exports, which stopped exporting - the exporter asks the plan before
 * every batch - and keep their place for when the project is back on it.
 * They can be turned off and deleted on every plan, like any configuration
 * a lower plan cannot use (Common/Types/Billing/PlanGatedTable). Their
 * credentials are never shown.
 */
export const ProjectAuditLogExportsLeftover: FunctionComponent =
  (): ReactElement => {
    return (
      <PlanLeftoverTable<AuditLogExport>
        modelType={AuditLogExport}
        id="project-audit-log-exports"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        requiredPlan={AUDIT_LOGS_REQUIRED_PLAN}
        title={PlanLeftoverTitle.auditLogExports}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
      />
    );
  };
