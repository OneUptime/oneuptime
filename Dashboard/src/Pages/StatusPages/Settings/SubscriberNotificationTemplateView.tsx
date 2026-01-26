import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { getSubscriberNotificationTemplateVariablesDocumentation } from "../../../Utils/SubscriberNotificationTemplateVariables";

const SubscriberNotificationTemplateView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [eventType, setEventType] = useState<
    StatusPageSubscriberNotificationEventType | undefined
  >(undefined);
  const [notificationMethod, setNotificationMethod] = useState<
    StatusPageSubscriberNotificationMethod | undefined
  >(undefined);

  useEffect(() => {
    // Fetch the template to get its event type
    const fetchTemplate: () => Promise<void> = async (): Promise<void> => {
      try {
        const template: StatusPageSubscriberNotificationTemplate | null =
          await ModelAPI.getItem<StatusPageSubscriberNotificationTemplate>({
            modelType: StatusPageSubscriberNotificationTemplate,
            id: modelId,
            select: {
              eventType: true,
              notificationMethod: true,
            },
          });
        if (template) {
          setEventType(template.eventType);
          setNotificationMethod(template.notificationMethod);
        }
      } catch {
        // Handle error silently - the card will show generic variables
      }
    };
    fetchTemplate();
  }, [modelId]);

  const getTemplateBodyFieldType: () => FormFieldSchemaType =
    (): FormFieldSchemaType => {
      if (notificationMethod === StatusPageSubscriberNotificationMethod.Email) {
        return FormFieldSchemaType.HTML;
      }
      return FormFieldSchemaType.LongText;
    };

  return (
    <Fragment>
      {/* Subscriber Notification Template Overview */}
      <CardModelDetail<StatusPageSubscriberNotificationTemplate>
        name="Subscriber Notification Template Details"
        cardProps={{
          title: "Template Overview",
          description:
            "Basic information about this subscriber notification template.",
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
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
            description: "Optional description for this template",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description of what this template is used for",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: StatusPageSubscriberNotificationTemplate,
          id: "model-detail-subscriber-notification-template",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Template ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                templateName: true,
              },
              title: "Template Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                templateDescription: true,
              },
              title: "Template Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                eventType: true,
              },
              title: "Event Type",
              fieldType: FieldType.Text,
            },
            {
              field: {
                notificationMethod: true,
              },
              title: "Notification Method",
              fieldType: FieldType.Text,
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                updatedAt: true,
              },
              title: "Updated",
              fieldType: FieldType.DateTime,
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Template Content Card */}
      <CardModelDetail<StatusPageSubscriberNotificationTemplate>
        name="Template Content"
        cardProps={{
          title: "Template Content",
          description:
            notificationMethod === StatusPageSubscriberNotificationMethod.Email
              ? "The email subject and template body for this notification template."
              : "The template body for this notification template.",
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        formFields={
          notificationMethod === StatusPageSubscriberNotificationMethod.Email
            ? [
                {
                  field: {
                    emailSubject: true,
                  },
                  title: "Email Subject",
                  description:
                    "Subject line for email notifications. You can use template variables like {{incidentTitle}}.",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  placeholder: "{{statusPageName}}: {{incidentTitle}}",
                },
                {
                  field: {
                    templateBody: true,
                  },
                  title: "Template Body",
                  description:
                    "The template content using HTML. You can use template variables.",
                  fieldType: getTemplateBodyFieldType(),
                  required: true,
                  placeholder:
                    "<p>Hello,</p><p>{{incidentTitle}} has been created.</p>",
                },
              ]
            : [
                {
                  field: {
                    templateBody: true,
                  },
                  title: "Template Body",
                  description:
                    notificationMethod ===
                    StatusPageSubscriberNotificationMethod.SMS
                      ? "The template content using plain text. Keep it concise for SMS. You can use template variables."
                      : "The template content. For Slack/Teams: Use Markdown. You can use template variables.",
                  fieldType: getTemplateBodyFieldType(),
                  required: true,
                  placeholder:
                    notificationMethod ===
                    StatusPageSubscriberNotificationMethod.SMS
                      ? "{{statusPageName}}: {{incidentTitle}} - {{incidentDescription}}"
                      : "**{{incidentTitle}}**\n{{incidentDescription}}",
                },
              ]
        }
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPageSubscriberNotificationTemplate,
          id: "model-detail-template-content",
          fields:
            notificationMethod === StatusPageSubscriberNotificationMethod.Email
              ? [
                  {
                    field: {
                      emailSubject: true,
                    },
                    title: "Email Subject",
                    fieldType: FieldType.Text,
                  },
                  {
                    field: {
                      templateBody: true,
                    },
                    title: "Template Body",
                    fieldType: FieldType.HTML,
                  },
                ]
              : [
                  {
                    field: {
                      templateBody: true,
                    },
                    title: "Template Body",
                    fieldType:
                      notificationMethod ===
                      StatusPageSubscriberNotificationMethod.SMS
                        ? FieldType.Text
                        : FieldType.Markdown,
                  },
                ],
          modelId: modelId,
        }}
      />

      {/* Template Variables Reference */}
      <Card
        title="Template Variables Reference"
        description={
          notificationMethod === StatusPageSubscriberNotificationMethod.Email
            ? "Available variables you can use in your template body and email subject based on the selected event type."
            : "Available variables you can use in your template body based on the selected event type."
        }
      >
        <div className="p-4">
          <MarkdownViewer
            text={getSubscriberNotificationTemplateVariablesDocumentation(
              eventType,
              notificationMethod,
            )}
          />
        </div>
      </Card>

      {/* Connected Status Pages */}
      <ModelTable<StatusPageSubscriberNotificationTemplateStatusPage>
        modelType={StatusPageSubscriberNotificationTemplateStatusPage}
        id="status-pages-for-template-table"
        userPreferencesKey="status-pages-for-template-table"
        name="Subscriber Notification Template > Status Pages"
        isDeleteable={true}
        createVerb="Link"
        isCreateable={true}
        isEditable={false}
        isViewable={false}
        query={{
          statusPageSubscriberNotificationTemplateId: modelId,
        }}
        onBeforeCreate={(
          item: StatusPageSubscriberNotificationTemplateStatusPage,
        ): Promise<StatusPageSubscriberNotificationTemplateStatusPage> => {
          item.statusPageSubscriberNotificationTemplateId = modelId;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Connected Status Pages",
          description:
            "Status pages that use this notification template. Link this template to more status pages or remove existing connections.",
        }}
        noItemsMessage={
          "This template is not linked to any status pages yet."
        }
        showRefreshButton={true}
        formFields={[
          {
            field: {
              statusPage: true,
            },
            title: "Status Page",
            description:
              "Select a status page to link this template to.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: StatusPage,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Status Page",
          },
        ]}
        filters={[
          {
            field: {
              statusPage: {
                name: true,
              },
            },
            title: "Status Page Name",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              statusPage: {
                name: true,
              },
            },
            title: "Status Page Name",
            type: FieldType.Element,
            getElement: (
              item: StatusPageSubscriberNotificationTemplateStatusPage,
            ): ReactElement => {
              return (
                <span>
                  {item.statusPage?.name || "Unknown"}
                </span>
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Linked At",
            type: FieldType.DateTime,
          },
        ]}
      />

      <ModelDelete
        modelType={StatusPageSubscriberNotificationTemplate}
        modelId={Navigation.getLastParamAsObjectID()}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteMap[
              PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES
            ] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default SubscriberNotificationTemplateView;
