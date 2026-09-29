import PageComponentProps from "../../PageComponentProps";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Only user-initiated changes appear here. Ingest bumps `lastSeenAt` through
 * the without-hooks update path and the prune sweep uses hardDeleteBy, so
 * neither reaches the audit-log hook — see EnableAuditLog on InventoryItem.
 */
const InventoryItemAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <AuditLogsTable
      title="Item Audit Logs"
      description="Changes people have made to this item. Automatic updates from telemetry are not recorded."
      resourceType="Inventory Item"
      resourceId={modelId}
    />
  );
};

export default InventoryItemAuditLogs;
