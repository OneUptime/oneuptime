import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "Common/Models/DatabaseModels/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FieldType from "Common/UI/Components/Types/FieldType";
import UserElement from "../../../Components/User/User";
import BadDataException from "Common/Types/Exception/BadDataException";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

enum NotifyType {
  User = "User",
  OnCallSchedule = "OnCallSchedule",
}

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
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        showAs={ShowAs.List}
        listDetailOptions={{
          showDetailsInNumberOfColumns: 2,
        }}
        onBeforeCreate={(
          item: IncomingCallPolicyEscalationRule,
        ): Promise<IncomingCallPolicyEscalationRule> => {
          item.incomingCallPolicyId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;

          // Validation: either userId or onCallDutyPolicyScheduleId must be set
          if (!item.userId && !item.onCallDutyPolicyScheduleId) {
            throw new BadDataException(
              "Please select either a User or an On-Call Schedule",
            );
          }

          // Clear the opposite field to ensure only one is set
          if (item.userId) {
            delete (item as Partial<IncomingCallPolicyEscalationRule>)
              .onCallDutyPolicyScheduleId;
          }
          if (item.onCallDutyPolicyScheduleId) {
            delete (item as Partial<IncomingCallPolicyEscalationRule>).userId;
          }

          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Escalation Rules",
          description:
            "Define the order in which users or schedules are called when an incoming call is received.",
        }}
        noItemsMessage={"No escalation rules found."}
        formSteps={[
          {
            title: "Overview",
            id: "overview",
          },
          {
            title: "Notification",
            id: "notification",
          },
          {
            title: "Escalation",
            id: "escalation",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Rule Name",
            stepId: "overview",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "e.g., Primary On-Call",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "overview",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Optional description for this rule",
          },
          {
            overrideField: {
              notifyType: true,
            },
            overrideFieldKey: "notifyType",
            showEvenIfPermissionDoesNotExist: true,
            title: "Notify",
            stepId: "notification",
            description: "Select who should be notified when a call comes in.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            defaultValue: NotifyType.OnCallSchedule,
            fetchDropdownOptions: async () => {
              return [
                {
                  label: "On-Call Schedule",
                  value: NotifyType.OnCallSchedule,
                },
                {
                  label: "User",
                  value: NotifyType.User,
                },
              ];
            },
          },
          {
            field: {
              onCallDutyPolicyScheduleId: true,
            },
            title: "On-Call Schedule",
            stepId: "notification",
            description:
              "Select an on-call schedule. The current on-call user will be called.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: OnCallDutyPolicySchedule,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select On-Call Schedule",
            showIf: (
              formValues: FormValues<IncomingCallPolicyEscalationRule> & {
                notifyType?: NotifyType;
              },
            ): boolean => {
              return (
                !formValues.notifyType ||
                formValues.notifyType === NotifyType.OnCallSchedule
              );
            },
          },
          {
            field: {
              userId: true,
            },
            showEvenIfPermissionDoesNotExist: true,
            title: "User",
            stepId: "notification",
            description: "Select a user to call directly.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: User,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select User",
            showIf: (
              formValues: FormValues<IncomingCallPolicyEscalationRule> & {
                notifyType?: NotifyType;
              },
            ): boolean => {
              return formValues.notifyType === NotifyType.User;
            },
          },
          {
            field: {
              escalateAfterSeconds: true,
            },
            title: "Escalate After (Seconds)",
            stepId: "escalation",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "30",
            description:
              "Time to wait before escalating to the next rule if no answer",
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
            title: "Escalation Rule Order",
            description: "The order in which this rule is executed.",
            type: FieldType.Number,
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            description: "The name of the escalation rule.",
            type: FieldType.Text,
            noValueMessage: "-",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            description: "The description of the escalation rule.",
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
            description:
              "On-call schedule which will be called when a call comes in.",
            type: FieldType.Entity,
            getElement: (
              item: IncomingCallPolicyEscalationRule,
            ): ReactElement => {
              if (item.onCallDutyPolicySchedule?.name) {
                return <span>{item.onCallDutyPolicySchedule.name}</span>;
              }
              return <></>;
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
            description: "User who will be called when a call comes in.",
            type: FieldType.Entity,
            getElement: (
              item: IncomingCallPolicyEscalationRule,
            ): ReactElement => {
              if (item.user) {
                return <UserElement user={item.user} />;
              }
              return <></>;
            },
          },
          {
            field: {
              escalateAfterSeconds: true,
            },
            title: "Escalate After (seconds)",
            description:
              "Time to wait before escalating to the next rule if no answer.",
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
