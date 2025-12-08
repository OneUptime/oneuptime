import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { RouteUtil } from "../../Utils/RouteMap";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { getSubscriberNotificationTemplateVariablesDocumentation } from "../../Utils/SubscriberNotificationTemplateVariables";

const SubscriberNotificationTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const getTemplateTable = (
    notificationMethod: StatusPageSubscriberNotificationMethod,
  ): ReactElement => {
    const methodDescriptions: Record<
      StatusPageSubscriberNotificationMethod,
      string
    > = {
      [StatusPageSubscriberNotificationMethod.Email]:
        "Create custom email notification templates for status page subscribers. Use HTML for formatting.",
      [StatusPageSubscriberNotificationMethod.SMS]:
        "Create custom SMS notification templates for status page subscribers. Use plain text format.",
      [StatusPageSubscriberNotificationMethod.Slack]:
        "Create custom Slack notification templates for status page subscribers. Use Markdown for formatting.",
      [StatusPageSubscriberNotificationMethod.MicrosoftTeams]:
        "Create custom Microsoft Teams notification templates for status page subscribers. Use Markdown for formatting.",
      [StatusPageSubscriberNotificationMethod.Webhook]:
        "Create custom Webhook payload templates for status page subscribers. Use JSON format.",
    };

    const templateBodyFieldType: FormFieldSchemaType =
      notificationMethod === StatusPageSubscriberNotificationMethod.Email
        ? FormFieldSchemaType.HTML
        : FormFieldSchemaType.LongText;

    return (
      <ModelTable<StatusPageSubscriberNotificationTemplate>
        modelType={StatusPageSubscriberNotificationTemplate}
        id={`subscriber-notification-templates-table-${notificationMethod.toLowerCase().replace(/\s+/g, "-")}`}
        userPreferencesKey={`subscriber-notification-templates-table-${notificationMethod.toLowerCase().replace(/\s+/g, "-")}`}
        name={`Settings > Subscriber Notification Templates > ${notificationMethod}`}
        isDeleteable={false}
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        isEditable={false}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        isViewable={true}
        cardProps={{
          title: `${notificationMethod} Templates`,
          description: methodDescriptions[notificationMethod],
        }}
        noItemsMessage={`No ${notificationMethod} notification templates found.`}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          notificationMethod: notificationMethod,
        }}
        onBeforeCreate={(
          item: StatusPageSubscriberNotificationTemplate,
        ): Promise<StatusPageSubscriberNotificationTemplate> => {
          item.notificationMethod = notificationMethod;
          return Promise.resolve(item);
        }}
        showViewIdButton={true}
        formSteps={[
          {
            title: "Template Info",
            id: "template-info",
          },
          {
            title: "Template Settings",
            id: "template-settings",
          },
          {
            title: "Template Content",
            id: "template-content",
          },
        ]}
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            stepId: "template-info",
            description: "A friendly name for this notification template",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "My Custom Template",
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Template Description",
            stepId: "template-info",
            description: "Optional description for this template",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description of what this template is used for",
          },
          {
            field: {
              eventType: true,
            },
            title: "Event Type",
            stepId: "template-settings",
            description:
              "Select the type of event this template will be used for",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageSubscriberNotificationEventType,
            ),
            required: true,
            placeholder: "Select Event Type",
          },
          ...(notificationMethod ===
          StatusPageSubscriberNotificationMethod.Email
            ? [
                {
                  field: {
                    emailSubject: true,
                  },
                  title: "Email Subject",
                  stepId: "template-content",
                  description:
                    "You can use template variables like {{statusPageName}}, etc. Please refer to the documentation below for available variables.",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  placeholder: "Update from {{statusPageName}}",
                },
              ]
            : []),
          {
            field: {
              templateBody: true,
            },
            title: "Template Body",
            stepId: "template-content",
            description:
              notificationMethod ===
              StatusPageSubscriberNotificationMethod.Email
                ? "The template content in HTML format. You can use template variables like {{statusPageName}}, etc. Please refer to the documentation below for available variables."
                : notificationMethod ===
                    StatusPageSubscriberNotificationMethod.SMS
                  ? "The template content in plain text format. Keep it concise for SMS. You can use template variables like {{statusPageName}}, etc. Please refer to the documentation below for available variables."
                  : notificationMethod ===
                      StatusPageSubscriberNotificationMethod.Webhook
                    ? "The template content in JSON format. You can use template variables like {{statusPageName}}, etc. Please refer to the documentation below for available variables."
                    : "The template content in Markdown format. You can use template variables like {{statusPageName}}, etc. Please refer to the documentation below for available variables.",
            fieldType: templateBodyFieldType,
            required: true,
            getFooterElement: (
              values: FormValues<StatusPageSubscriberNotificationTemplate>,
            ): ReactElement => {
              const eventType:
                | StatusPageSubscriberNotificationEventType
                | undefined = values.eventType as
                | StatusPageSubscriberNotificationEventType
                | undefined;
              return (
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 mt-4">
                  <MarkdownViewer
                    text={getSubscriberNotificationTemplateVariablesDocumentation(
                      eventType,
                    )}
                  />
                </div>
              );
            },
          },
        ]}
        showRefreshButton={true}
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
            type: FieldType.Dropdown,
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageSubscriberNotificationEventType,
            ),
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.Date,
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
              createdAt: true,
            },
            title: "Created",
            type: FieldType.DateTime,
          },
        ]}
      />
    );
  };

  return (
    <Fragment>
      <Tabs
        tabs={[
          {
            name: "Email",
            children: getTemplateTable(
              StatusPageSubscriberNotificationMethod.Email,
            ),
          },
          {
            name: "SMS",
            children: getTemplateTable(
              StatusPageSubscriberNotificationMethod.SMS,
            ),
          },
          {
            name: "Slack",
            children: getTemplateTable(
              StatusPageSubscriberNotificationMethod.Slack,
            ),
          },
          {
            name: "Microsoft Teams",
            children: getTemplateTable(
              StatusPageSubscriberNotificationMethod.MicrosoftTeams,
            ),
          },
          {
            name: "Webhook",
            children: getTemplateTable(
              StatusPageSubscriberNotificationMethod.Webhook,
            ),
          },
        ]}
        onTabChange={() => {}}
      />
    </Fragment>
  );
};

export default SubscriberNotificationTemplates;
