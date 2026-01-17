import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncomingCallLogItem from "Common/Models/DatabaseModels/IncomingCallLogItem";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Pill from "Common/UI/Components/Pill/Pill";
import IncomingCallStatus from "Common/Types/IncomingCall/IncomingCallStatus";
import { Green, Red, Yellow, Grey } from "Common/Types/BrandColors";
import UserElement from "../../../Components/User/User";

const IncomingCallPolicyLogViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const incomingCallLogId: ObjectID = Navigation.getLastParamAsObjectID();

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
      <ModelTable<IncomingCallLogItem>
        modelType={IncomingCallLogItem}
        id="incoming-call-log-items-table"
        userPreferencesKey="incoming-call-log-items-table"
        isDeleteable={false}
        name="Incoming Call Policy > Call Log > Timeline"
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showViewIdButton={true}
        query={{
          incomingCallLogId: incomingCallLogId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        sortBy="startedAt"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Call Timeline",
          description:
            "View the timeline of dial attempts for this incoming call.",
        }}
        noItemsMessage={"No dial attempts found for this call."}
        showRefreshButton={true}
        selectMoreFields={{
          statusMessage: true,
        }}
        columns={[
          {
            field: {
              user: {
                name: true,
                email: true,
              },
            },
            title: "User Called",
            type: FieldType.Entity,
            getElement: (item: IncomingCallLogItem): ReactElement => {
              if (item.user) {
                return <UserElement user={item.user} />;
              }
              return <span className="text-gray-400">-</span>;
            },
          },
          {
            field: {
              userPhoneNumber: true,
            },
            title: "Phone Number",
            type: FieldType.Phone,
          },
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Text,
            getElement: (item: IncomingCallLogItem): ReactElement => {
              return getStatusPill(item.status);
            },
          },
          {
            field: {
              isAnswered: true,
            },
            title: "Answered",
            type: FieldType.Boolean,
            getElement: (item: IncomingCallLogItem): ReactElement => {
              if (item.isAnswered) {
                return <Pill text="Yes" color={Green} />;
              }
              return <Pill text="No" color={Grey} />;
            },
          },
          {
            field: {
              dialDurationInSeconds: true,
            },
            title: "Duration",
            type: FieldType.Number,
            getElement: (item: IncomingCallLogItem): ReactElement => {
              if (item.dialDurationInSeconds !== undefined) {
                const minutes: number = Math.floor(
                  item.dialDurationInSeconds / 60,
                );
                const seconds: number = item.dialDurationInSeconds % 60;
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
          {
            field: {
              endedAt: true,
            },
            title: "Ended At",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default IncomingCallPolicyLogViewPage;
