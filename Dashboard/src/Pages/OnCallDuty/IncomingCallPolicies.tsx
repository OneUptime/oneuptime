import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import Phone from "Common/Types/Phone";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

const IncomingCallPoliciesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncomingCallPolicy>
        modelType={IncomingCallPolicy}
        id="incoming-call-policy-table"
        userPreferencesKey="incoming-call-policy-table"
        isDeleteable={false}
        name="On-Call > Incoming Call Policies"
        showViewIdButton={true}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Incoming Call Policies",
          description:
            "Configure incoming call routing policies for your on-call teams. Purchase phone numbers and set up escalation rules.",
        }}
        noItemsMessage={"No incoming call policy found."}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g., Production Support Hotline",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description of this incoming call policy",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            stepId: "labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
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
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              routingPhoneNumber: true,
            },
            title: "Phone Number",
            type: FieldType.Phone,
            getElement: (item: IncomingCallPolicy): ReactElement => {
              if (item.routingPhoneNumber) {
                return (
                  <div className="flex items-center space-x-2">
                    <Icon icon={IconProp.Call} className="h-4 w-4 text-green-500" />
                    <span className="font-mono">
                      {(item.routingPhoneNumber as Phone).toString()}
                    </span>
                  </div>
                );
              }
              return (
                <div className="flex items-center space-x-2">
                  <Icon icon={IconProp.ExclaimationCircle} className="h-4 w-4 text-yellow-500" />
                  <span className="text-yellow-600 font-medium">Setup Needed</span>
                </div>
              );
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: IncomingCallPolicy): ReactElement => {
              if (item.isEnabled) {
                return <Pill text="Enabled" color={Green} />;
              }
              return <Pill text="Disabled" color={Red} />;
            },
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            getElement: (item: IncomingCallPolicy): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default IncomingCallPoliciesPage;
