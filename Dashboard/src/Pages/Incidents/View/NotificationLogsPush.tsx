import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import PushNotificationLog from "Common/Models/DatabaseModels/PushNotificationLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import PushStatus from "Common/Types/PushNotification/PushStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import DropdownUtil from "Common/UI/Utils/Dropdown";

const IncidentPushLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const columns: Columns<PushNotificationLog> = [
    { field: { title: true }, title: "Title", type: FieldType.Text },
    { field: { deviceType: true }, title: "Device Type", type: FieldType.Text, hideOnMobile: true },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    { field: { status: true }, title: "Status", type: FieldType.Text, getElement: (item: PushNotificationLog): ReactElement => {
      if (item["status"]) {
        return (
          <Pill isMinimal={false} color={item["status"] === PushStatus.Success ? Green : Red} text={item["status"] as string} />
        );
      }
      return <></>;
    } },
  ];

  const filters: Array<Filter<PushNotificationLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
  { field: { status: true }, title: "Status", type: FieldType.Dropdown, filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(PushStatus) },
  ];

  return (
    <ModelTable<PushNotificationLog>
      modelType={PushNotificationLog}
      id="incident-push-logs-table"
      name="Push Logs"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      showViewIdButton={true}
      userPreferencesKey="incident-push-logs-table"
      query={{ projectId: ProjectUtil.getCurrentProjectId()!, incidentId: modelId }}
      selectMoreFields={{ statusMessage: true, body: true }}
      cardProps={{ title: "Push Logs", description: "Push notifications sent for this incident." }}
      noItemsMessage="No Push logs for this incident."
      showRefreshButton={true}
      columns={columns}
      filters={filters}
    />
  );
};

export default IncidentPushLogs;
