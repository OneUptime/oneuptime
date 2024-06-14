import IncidentView from "../../../Components/Incident/Incident";
import UserElement from "../../../Components/User/User";
import DashboardNavigation from "../../../Utils/Navigation";
import OnCallPolicyView from "../OnCallPolicy";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import ConfirmModal from "CommonUI/src/Components/Modal/ConfirmModal";
import Filter from "CommonUI/src/Components/ModelFilter/Filter";
import Columns from "CommonUI/src/Components/ModelTable/Columns";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import Pill from "CommonUI/src/Components/Pill/Pill";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Query from "CommonUI/src/Utils/BaseDatabase/Query";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import Navigation from "CommonUI/src/Utils/Navigation";
import Incident from "Model/Models/Incident";
import OnCallDutyPolicy from "Model/Models/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "Model/Models/OnCallDutyPolicyExecutionLog";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  onCallDutyPolicyId?: ObjectID | undefined; // if this is undefined. then it'll show logs for all policies.
}

const ExecutionLogsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showViewStatusMessageModal, setShowViewStatusMessageModal] =
    useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const query: Query<OnCallDutyPolicyExecutionLog> = {
    projectId: DashboardNavigation.getProjectId()?.toString(),
  };

  if (props.onCallDutyPolicyId) {
    query.onCallDutyPolicyId = props.onCallDutyPolicyId.toString();
  }

  let columns: Columns<OnCallDutyPolicyExecutionLog> = [];
  let filters: Array<Filter<OnCallDutyPolicyExecutionLog>> = [];

  if (!props.onCallDutyPolicyId) {
    // add a column for the policy name
    columns = columns.concat([
      {
        field: {
          onCallDutyPolicy: {
            name: true,
          },
        },
        title: "Policy Name",
        type: FieldType.Element,
        getElement: (item: OnCallDutyPolicyExecutionLog): ReactElement => {
          if (item["onCallDutyPolicy"]) {
            return (
              <OnCallPolicyView
                onCallPolicy={item["onCallDutyPolicy"] as OnCallDutyPolicy}
              />
            );
          }
          return <p>No on-call policy.</p>;
        },
      },
    ]);

    filters = filters.concat([
      {
        title: "On Call Policy",
        type: FieldType.Entity,
        field: {
          onCallDutyPolicy: true,
        },
        filterEntityType: OnCallDutyPolicy,
        filterQuery: {
          projectId: DashboardNavigation.getProjectId()?.toString(),
        },
        filterDropdownField: {
          label: "name",
          value: "_id",
        },
      },
    ]);
  }

  filters = filters.concat([
    {
      title: "Status",
      type: FieldType.Dropdown,
      field: {
        status: true,
      },
      filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
        OnCallDutyPolicyStatus,
      ),
    },
    {
      title: "Triggered at",
      type: FieldType.Date,
      field: {
        createdAt: true,
      },
    },
  ]);

  columns = columns.concat([
    {
      field: {
        triggeredByIncident: {
          title: true,
        },
      },
      title: "Triggered By Incident",
      type: FieldType.Element,
      getElement: (item: OnCallDutyPolicyExecutionLog): ReactElement => {
        if (item["triggeredByIncident"]) {
          return (
            <IncidentView incident={item["triggeredByIncident"] as Incident} />
          );
        }
        return <p>No incident.</p>;
      },
    },
    {
      field: {
        createdAt: true,
      },
      title: "Triggered at",
      type: FieldType.DateTime,
    },
    {
      field: {
        status: true,
      },
      title: "Status",
      type: FieldType.Element,

      getElement: (item: OnCallDutyPolicyExecutionLog): ReactElement => {
        if (item["status"] === OnCallDutyPolicyStatus.Completed) {
          return <Pill color={Green} text={OnCallDutyPolicyStatus.Completed} />;
        } else if (item["status"] === OnCallDutyPolicyStatus.Started) {
          return <Pill color={Yellow} text={OnCallDutyPolicyStatus.Started} />;
        } else if (item["status"] === OnCallDutyPolicyStatus.Scheduled) {
          return (
            <Pill color={Yellow} text={OnCallDutyPolicyStatus.Scheduled} />
          );
        } else if (item["status"] === OnCallDutyPolicyStatus.Executing) {
          return (
            <Pill color={Yellow} text={OnCallDutyPolicyStatus.Executing} />
          );
        }

        return <Pill color={Red} text={OnCallDutyPolicyStatus.Error} />;
      },
    },
    {
      field: {
        acknowledgedByUser: {
          name: true,
          email: true,
        },
      },
      title: "Acknowledged By",
      type: FieldType.Element,
      getElement: (item: OnCallDutyPolicyExecutionLog): ReactElement => {
        if (item["acknowledgedByUser"]) {
          return <UserElement user={item["acknowledgedByUser"]} />;
        }

        return <p>-</p>;
      },
    },
  ]);

  return (
    <>
      <ModelTable<OnCallDutyPolicyExecutionLog>
        modelType={OnCallDutyPolicyExecutionLog}
        query={query}
        id="execution-logs-table"
        name="On-Call Policy > Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        cardProps={{
          title: "On-Call Policy Logs",
          description:
            "Here are all the notification logs. This will help you to debug any notification issues that your team may face.",
        }}
        selectMoreFields={{
          statusMessage: true,
          onCallDutyPolicyId: true,
        }}
        noItemsMessage={"This policy has not executed so far."}
        viewPageRoute={Navigation.getCurrentRoute()}
        showRefreshButton={true}
        showViewIdButton={true}
        filters={filters}
        actionButtons={[
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: OnCallDutyPolicyExecutionLog,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setStatusMessage(item["statusMessage"] as string);
                setShowViewStatusMessageModal(true);

                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        viewButtonText={"View Timeline"}
        columns={columns}
      />

      {showViewStatusMessageModal ? (
        <ConfirmModal
          title={"Status Message"}
          description={statusMessage}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setShowViewStatusMessageModal(false);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ExecutionLogsTable;
