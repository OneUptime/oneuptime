import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import SmsStatus from "Common/Types/SmsStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";

const IncidentSmsLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const columns: Columns<SmsLog> = [
    { field: { toNumber: true }, title: "To", type: FieldType.Phone },
    { field: { fromNumber: true }, title: "From", type: FieldType.Phone, hideOnMobile: true },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    { field: { status: true }, title: "Status", type: FieldType.Text, getElement: (item: SmsLog): ReactElement => {
      if (item["status"]) {
        return (
          <Pill isMinimal={false} color={item["status"] === SmsStatus.Success ? Green : Red} text={item["status"] as string} />
        );
      }
      return <></>;
    } },
  ];

  const filters: Array<Filter<SmsLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
  ];

  return (
    <ModelTable<SmsLog>
      modelType={SmsLog}
      id="incident-sms-logs-table"
      name="SMS Logs"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      showViewIdButton={true}
      userPreferencesKey="incident-sms-logs-table"
      query={{ projectId: ProjectUtil.getCurrentProjectId()!, incidentId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{ title: "SMS Logs", description: "SMS sent for this incident." }}
      noItemsMessage="No SMS logs for this incident."
      showRefreshButton={true}
      columns={columns}
      filters={filters}
    />
  );
};

export default IncidentSmsLogs;
