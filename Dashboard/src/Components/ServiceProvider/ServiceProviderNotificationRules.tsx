import DashboardNavigation from "../../Utils/Navigation";
import Color from "Common/Types/Color";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Label from "Common/Models/DatabaseModels/Label";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ServiceProviderType from "Common/Types/ServiceProvider/ServiceProviderType";
import ServiceProviderNotificationRule from "Common/Models/DatabaseModels/ServiceProviderNotificationRule";
import NotificationRuleEventType from "Common/Types/ServiceProvider/NotificationRules/EventType";

export interface ComponentProps {
  serviceProviderType: ServiceProviderType;
  eventType: NotificationRuleEventType;
}

const Labels: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<ServiceProviderNotificationRule>
        modelType={ServiceProviderNotificationRule}
        query={{
          projectId: DashboardNavigation.getProjectId()!,
        }}
        id="servie-provider-table"
        name="Settings > Service Provider Notification Rules"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: `${props.eventType} - ${props.serviceProviderType} Notification Rules`,
          description: `Manage ${props.eventType} notification rules for ${props.serviceProviderType}.`,
        }}
        noItemsMessage={"No notification rules found."}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Rule Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            stepId: "basic",
            placeholder: "Notify DevOps Team",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "basic",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Notify DevOps Team when a new incident is created.",
          },
          {
            field: {
              color: true,
            },
            title: "Label Color",
            fieldType: FormFieldSchemaType.Color,
            required: true,
            placeholder: "Please select color for this label.",
          },
        ]}
        formSteps={[
          {
            title: "Basic",
            id: "basic",
          },
          {
            title: "Criteria",
            id: "criteria",
          },
        ]}
        showRefreshButton={true}
        selectMoreFields={{
          color: true,
        }}
        showViewIdButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              description: true,
            },
            type: FieldType.Text,
            title: "Description",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,

            getElement: (item: Label): ReactElement => {
              return (
                <Pill
                  color={item["color"] as Color}
                  text={item["name"] as string}
                />
              );
            },
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.Text,
          },
        ]}
      />
    </Fragment>
  );
};

export default Labels;
