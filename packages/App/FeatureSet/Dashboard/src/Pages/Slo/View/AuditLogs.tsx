import PageComponentProps from "../../PageComponentProps";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/**
 * Everything that rolls up to this SLO: edits to the SLO itself and to its
 * burn-rate rules, monitor rules and owners, each of which points its audit
 * entries at the SLO (EnableAuditLogOn.rootResource). That is why the table
 * filters on rootResourceId alone - a resourceType or resourceId filter would
 * match the SLO's own entries and drop its children's.
 *
 * The evaluation worker's writes are not recorded: the SLO ignores the columns
 * it rewrites on every tick (see @EnableAuditLog on ServiceLevelObjective), so
 * the description says so rather than promising a complete history.
 */
const SloAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="SLO Audit Logs"
      description="Changes people made to this SLO, its burn-rate rules, monitor rules and owners. Automatic evaluation updates are not recorded."
      rootResourceId={modelId}
    />
  );
};

export default SloAuditLogs;
