import PageComponentProps from "../../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import CallStatus from "Common/Types/Call/CallStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";

const AnnouncementCallLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const columns: Columns<CallLog> = [
    { field: { toNumber: true }, title: "To", type: FieldType.Phone },
    { field: { fromNumber: true }, title: "From", type: FieldType.Phone, hideOnMobile: true },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    { field: { status: true }, title: "Status", type: FieldType.Text, getElement: (item: CallLog): ReactElement => {
      if (item["status"]) {
        return (
          <Pill isMinimal={false} color={item["status"] === CallStatus.Success ? Green : Red} text={item["status"] as string} />
        );
      }
      return <></>;
    } },
  ];

  const filters: Array<Filter<CallLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Dropdown },
  ];

  return (
    <ModelTable<CallLog>
      modelType={CallLog}
      id="announcement-call-logs-table"
      name="Call Logs"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      showViewIdButton={true}
      userPreferencesKey="announcement-call-logs-table"
      query={{ projectId: ProjectUtil.getCurrentProjectId()!, statusPageAnnouncementId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{ title: "Call Logs", description: "Calls made for this announcement." }}
      noItemsMessage="No call logs for this announcement."
      showRefreshButton={true}
      columns={columns}
      filters={filters}
    />
  );
};

export default AnnouncementCallLogs;
