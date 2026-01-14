import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "Common/Models/DatabaseModels/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import UserElement from "Common/UI/Components/User/User";
import BadDataException from "Common/Types/Exception/BadDataException";
import DashboardNavigation from "../../../Utils/Navigation";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

const IncomingCallPolicyEscalationPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<IncomingCallPolicyEscalationRule>
        modelType={IncomingCallPolicyEscalationRule}
        id="incoming-call-policy-escalation-rules-table"
        userPreferencesKey="incoming-call-policy-escalation-rules-table"
        isDeleteable={true}
        name="Incoming Call Policy > Escalation Rules"
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          incomingCallPolicyId: modelId,
          projectId: DashboardNavigation.getProjectId()!,
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        onBeforeCreate={(
          item: IncomingCallPolicyEscalationRule,
        ): Promise<IncomingCallPolicyEscalationRule> => {
          item.incomingCallPolicyId = modelId;
          item.projectId = DashboardNavigation.getProjectId()!;

          // Validation: either userId or onCallDutyPolicyScheduleId must be set
          if (!item.userId && !item.onCallDutyPolicyScheduleId) {
            throw new BadDataException(
              "Please select either a User or an On-Call Schedule",
            );
          }

          if (item.userId && item.onCallDutyPolicyScheduleId) {
            throw new BadDataException(
              "Please select only one: either a User or an On-Call Schedule, not both",
            );
          }

          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Escalation Rules",
          description:
            "Define the order in which users or schedules are called when an incoming call is received.",
        }}
        noItemsMessage={"No escalation rules found."}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Rule Name",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "e.g., Primary On-Call",
          },
          {
            field: {
              order: true,
            },
            title: "Escalation Order",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "1",
            description:
              "Rules are executed in ascending order (1 = first, 2 = second, etc.)",
          },
          {
            field: {
              escalateAfterSeconds: true,
            },
            title: "Escalate After (Seconds)",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "30",
            description:
              "Time to wait before escalating to the next rule if no answer",
          },
          {
            field: {
              onCallDutyPolicyScheduleId: true,
            },
            title: "On-Call Schedule",
            description:
              "Select an on-call schedule. The current on-call user will be called. Leave empty to specify a user directly.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: OnCallDutyPolicySchedule,
              labelField: "name",
              valueField: "_id",
            },
            fetchDropdownOptions: async () => {
              return {
                query: {
                  projectId: ProjectUtil.getCurrentProjectId()!,
                },
              };
            },
            required: false,
            placeholder: "Select On-Call Schedule",
          },
          {
            field: {
              userId: true,
            },
            title: "Direct User",
            description:
              "Select a user to call directly. Leave empty if using an on-call schedule.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: User,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select User",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Optional description for this rule",
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              order: true,
            },
            title: "Order",
            type: FieldType.Number,
          },
        ]}
        columns={[
          {
            field: {
              order: true,
            },
            title: "Order",
            type: FieldType.Number,
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
            noValueMessage: "-",
          },
          {
            field: {
              onCallDutyPolicySchedule: {
                name: true,
              },
            },
            title: "On-Call Schedule",
            type: FieldType.Entity,
            getElement: (
              item: IncomingCallPolicyEscalationRule,
            ): ReactElement => {
              if (item.onCallDutyPolicySchedule?.name) {
                return <span>{item.onCallDutyPolicySchedule.name}</span>;
              }
              return <span className="text-gray-400">-</span>;
            },
          },
          {
            field: {
              user: {
                name: true,
                email: true,
              },
            },
            title: "User",
            type: FieldType.Entity,
            getElement: (
              item: IncomingCallPolicyEscalationRule,
            ): ReactElement => {
              if (item.user) {
                return <UserElement user={item.user} />;
              }
              return <span className="text-gray-400">-</span>;
            },
          },
          {
            field: {
              escalateAfterSeconds: true,
            },
            title: "Escalate After",
            type: FieldType.Number,
            getElement: (
              item: IncomingCallPolicyEscalationRule,
            ): ReactElement => {
              return <span>{item.escalateAfterSeconds}s</span>;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default IncomingCallPolicyEscalationPage;
