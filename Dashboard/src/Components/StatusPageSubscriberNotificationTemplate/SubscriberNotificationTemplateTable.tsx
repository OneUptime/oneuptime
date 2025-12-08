import ProjectUtil from "Common/UI/Utils/Project";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import Query from "Common/Types/BaseDatabase/Query";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green500, Yellow500, Blue500, Purple500, Cyan500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";

export interface ComponentProps {
  query?: Query<StatusPageSubscriberNotificationTemplate> | undefined;
  title?: string;
  description?: string;
  disableCreate?: boolean | undefined;
}

const SubscriberNotificationTemplateTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const getMethodColor = (method: StatusPageSubscriberNotificationMethod | undefined): Color => {
    switch (method) {
      case StatusPageSubscriberNotificationMethod.Email:
        return Green500;
      case StatusPageSubscriberNotificationMethod.SMS:
        return Yellow500;
      case StatusPageSubscriberNotificationMethod.Slack:
        return Purple500;
      case StatusPageSubscriberNotificationMethod.MicrosoftTeams:
        return Blue500;
      case StatusPageSubscriberNotificationMethod.Webhook:
        return Cyan500;
      default:
        return Green500;
    }
  };

  return (
    <ModelTable<StatusPageSubscriberNotificationTemplate>
      modelType={StatusPageSubscriberNotificationTemplate}
      userPreferencesKey="status-page-subscriber-notification-templates-table"
      id="table-status-page-subscriber-notification-templates"
      isDeleteable={true}
      isCreateable={!props.disableCreate}
      showViewIdButton={true}
      isEditable={true}
      name="Status Page > Subscriber Notification Templates"
      isViewable={true}
      query={{
        ...(props.query || {}),
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      cardProps={{
        title: props.title || "Subscriber Notification Templates",
        description:
          props.description ||
          "Create and manage custom notification templates for status page subscribers. These templates can be used to customize emails, SMS, Slack, and Microsoft Teams notifications.",
      }}
      noItemsMessage={"No subscriber notification templates found."}
      createEditModalWidth={ModalWidth.Large}
      showRefreshButton={true}
      viewPageRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGE_SUBSCRIBER_TEMPLATES] as Route,
      )}
      formFields={[
        {
          field: {
            templateName: true,
          },
          title: "Template Name",
          description: "A friendly name for this notification template.",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "My Email Template",
        },
        {
          field: {
            templateDescription: true,
          },
          title: "Template Description",
          description: "A description for this notification template.",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "Description of what this template is for...",
        },
        {
          field: {
            eventType: true,
          },
          title: "Event Type",
          description: "The type of event this template is for.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          placeholder: "Select Event Type",
          dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
            StatusPageSubscriberNotificationEventType,
          ),
        },
        {
          field: {
            notificationMethod: true,
          },
          title: "Notification Method",
          description:
            "The notification method this template is for. Email uses HTML, SMS uses plain text, Slack/Teams use Markdown.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          placeholder: "Select Notification Method",
          dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
            StatusPageSubscriberNotificationMethod,
          ),
        },
        {
          field: {
            emailSubject: true,
          },
          title: "Email Subject (Email only)",
          description:
            "The subject line for email notifications. Only used when notification method is Email. You can use template variables like {{incidentTitle}}.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "[{{statusPageName}}] {{incidentTitle}}",
          showIf: (values: any) => {
            return values.notificationMethod === StatusPageSubscriberNotificationMethod.Email;
          },
        },
        {
          field: {
            templateBody: true,
          },
          title: "Template Body",
          description:
            "The template content. Use {{variableName}} for variables. For Email: use HTML. For SMS: use plain text. For Slack/Teams: use Markdown.",
          fieldType: FormFieldSchemaType.HTML,
          required: true,
        },
      ]}
      filters={[
        {
          field: {
            templateName: true,
          },
          title: "Template Name",
          type: FieldType.Text,
        },
        {
          field: {
            eventType: true,
          },
          title: "Event Type",
          type: FieldType.Text,
        },
        {
          field: {
            notificationMethod: true,
          },
          title: "Notification Method",
          type: FieldType.Text,
        },
      ]}
      columns={[
        {
          field: {
            templateName: true,
          },
          title: "Template Name",
          type: FieldType.Text,
        },
        {
          field: {
            eventType: true,
          },
          title: "Event Type",
          type: FieldType.Text,
        },
        {
          field: {
            notificationMethod: true,
          },
          title: "Notification Method",
          type: FieldType.Element,
          getElement: (item: StatusPageSubscriberNotificationTemplate) => {
            return (
              <Pill
                text={item.notificationMethod || "Unknown"}
                color={getMethodColor(item.notificationMethod)}
              />
            );
          },
        },
        {
          field: {
            templateDescription: true,
          },
          title: "Description",
          type: FieldType.Text,
          noValueMessage: "-",
        },
      ]}
    />
  );
};

export default SubscriberNotificationTemplateTable;
