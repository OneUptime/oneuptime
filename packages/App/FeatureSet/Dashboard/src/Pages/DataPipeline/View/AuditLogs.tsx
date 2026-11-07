import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";

/*
 * Who changed this pipeline, and when. What its OpenLineage events say -
 * its runs, the datasets it reads and writes - is OneUptime's own
 * record, on its Overview, not a change anybody made.
 */
const DataPipelineAuditLogsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/audit-logs, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Pipeline Audit Logs"
      description="Every change made to this pipeline: who made it, when, and what changed. Its runs are on its Overview."
      rootResourceId={modelId}
    />
  );
};

export default DataPipelineAuditLogsPage;
