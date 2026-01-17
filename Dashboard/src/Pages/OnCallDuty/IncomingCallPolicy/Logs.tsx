import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncomingCallLog from "Common/Models/DatabaseModels/IncomingCallLog";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Pill from "Common/UI/Components/Pill/Pill";
import IncomingCallStatus from "Common/Types/IncomingCall/IncomingCallStatus";
import { Green, Red, Yellow, Grey } from "Common/Types/BrandColors";
import UserElement from "../../../Components/User/User";

const IncomingCallPolicyLogsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const getStatusPill: (status?: IncomingCallStatus) => ReactElement = (
    status?: IncomingCallStatus,
  ): ReactElement => {
    switch (status) {
      case IncomingCallStatus.Completed:
        return <Pill text="Completed" color={Green} />;
      case IncomingCallStatus.Connected:
        return <Pill text="Connected" color={Green} />;
      case IncomingCallStatus.NoAnswer:
        return <Pill text="No Answer" color={Yellow} />;
      case IncomingCallStatus.Failed:
        return <Pill text="Failed" color={Red} />;
      case IncomingCallStatus.Initiated:
        return <Pill text="Initiated" color={Grey} />;
      case IncomingCallStatus.Ringing:
        return <Pill text="Ringing" color={Yellow} />;
      case IncomingCallStatus.Escalated:
        return <Pill text="Escalated" color={Yellow} />;
      case IncomingCallStatus.CallerHungUp:
        return <Pill text="Caller Hung Up" color={Grey} />;
      case IncomingCallStatus.Busy:
        return <Pill text="Busy" color={Red} />;
      default:
        return <Pill text="Unknown" color={Grey} />;
    }
  };

  return (
    <Fragment>
      <ModelTable<IncomingCallLog>
        modelType={IncomingCallLog}
        id="incoming-call-logs-table"
        userPreferencesKey="incoming-call-logs-table"
        isDeleteable={false}
        name="Incoming Call Policy > Call Logs"
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showViewIdButton={true}
        query={{
          incomingCallPolicyId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        sortBy="startedAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: "Call Logs",
          description: "View incoming call history for this policy.",
        }}
        noItemsMessage={"No call logs found."}
        showRefreshButton={true}
        filters={[
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Text,
          },
          {
            field: {
              callerPhoneNumber: true,
            },
            title: "Caller Phone",
            type: FieldType.Phone,
          },
          {
            field: {
              startedAt: true,
            },
            title: "Started At",
            type: FieldType.DateTime,
          },
        ]}
        columns={[
          {
            field: {
              callerPhoneNumber: true,
            },
            title: "Caller",
            type: FieldType.Phone,
          },
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Text,
            getElement: (item: IncomingCallLog): ReactElement => {
              return getStatusPill(item.status);
            },
          },
          {
            field: {
              answeredByUser: {
                name: true,
                email: true,
              },
            },
            title: "Answered By",
            type: FieldType.Entity,
            getElement: (item: IncomingCallLog): ReactElement => {
              if (item.answeredByUser) {
                return <UserElement user={item.answeredByUser} />;
              }
              return <span className="text-gray-400">-</span>;
            },
          },
          {
            field: {
              callDurationInSeconds: true,
            },
            title: "Duration",
            type: FieldType.Number,
            getElement: (item: IncomingCallLog): ReactElement => {
              if (item.callDurationInSeconds !== undefined) {
                const minutes: number = Math.floor(
                  item.callDurationInSeconds / 60,
                );
                const seconds: number = item.callDurationInSeconds % 60;
                return (
                  <span>
                    {minutes}m {seconds}s
                  </span>
                );
              }
              return <span>-</span>;
            },
          },
          {
            field: {
              startedAt: true,
            },
            title: "Started At",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default IncomingCallPolicyLogsPage;
