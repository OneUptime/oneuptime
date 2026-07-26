import PageComponentProps from "../../PageComponentProps";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/**
 * Changes made to this SLO's definition.
 *
 * `resourceType` is the model's singularName, which is what
 * AuditLogService.getResourceType writes for every ServiceLevelObjective
 * event — it must stay in step with @TableMetadata.singularName on the
 * model.
 */
const SloAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="SLO Audit Logs"
      description="Every change made to this SLO's target, compliance window, monitors and other settings."
      resourceType="Service Level Objective"
      resourceId={modelId}
    />
  );
};

export default SloAuditLogs;
