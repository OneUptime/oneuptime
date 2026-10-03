import ProjectCallSMSConfigElement from "../../../Components/ProjectCallSMSConfig/ProjectCallSMSConfig";
import ProjectSMTPConfig from "../../../Components/ProjectSMTPConfig/ProjectSMTPConfig";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import PlaceholderText from "Common/UI/Components/Detail/PlaceholderText";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import TimezonesElement from "../../../Components/Timezone/TimezonesElement";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import StatusPageSubscriberNotificationTemplateStatusPage from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  Green500,
  Yellow500,
  Blue500,
  Purple500,
  Cyan500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import useAsyncEffect from "use-async-effect";
import SubscriberNotificationWarnings from "../../../Components/StatusPage/SubscriberNotificationWarnings";
import SubscriberChannelsCard from "../../../Components/StatusPage/SubscriberChannelsCard";
import {
  getTemplateConfigurationWarning,
  TemplateConfigurationWarning,
} from "../../../Components/StatusPage/SubscriberTemplateConfiguration";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const StatusPageSubscriberSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [statusPage, setStatusPage] = useState<StatusPage | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  /*
   * The notification method of every template linked to this page, or null
   * until they are known. Read again each time the table below loads, so
   * linking or unlinking one updates the warning above it.
   */
  const [linkedMethods, setLinkedMethods] = useState<Array<
    StatusPageSubscriberNotificationMethod | undefined
  > | null>(null);

  // Fetch status page to check SMTP and Twilio config
  useAsyncEffect(async () => {
    try {
      setIsLoading(true);
      const fetchedStatusPage: StatusPage | null =
        await ModelAPI.getItem<StatusPage>({
          modelType: StatusPage,
          id: modelId,
          select: {
            smtpConfig: {
              _id: true,
            },
            callSmsConfig: {
              _id: true,
            },
          },
        });
      setStatusPage(fetchedStatusPage);
    } catch {
      // Handle error silently - warning won't show but functionality continues
    } finally {
      setIsLoading(false);
    }
  }, [modelId.toString()]);

  const fetchLinkedMethods: () => Promise<void> = async (): Promise<void> => {
    try {
      const linked: ListResult<StatusPageSubscriberNotificationTemplateStatusPage> =
        await ModelAPI.getList<StatusPageSubscriberNotificationTemplateStatusPage>(
          {
            modelType: StatusPageSubscriberNotificationTemplateStatusPage,
            query: {
              statusPageId: modelId,
            },
            select: {
              _id: true,
              statusPageSubscriberNotificationTemplate: {
                notificationMethod: true,
              },
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {},
          },
        );

      setLinkedMethods(
        linked.data.map(
          (
            link: StatusPageSubscriberNotificationTemplateStatusPage,
          ): StatusPageSubscriberNotificationMethod | undefined => {
            return link.statusPageSubscriberNotificationTemplate
              ?.notificationMethod;
          },
        ),
      );
    } catch {
      // As above: no warning, and the table below says what went wrong.
    }
  };

  /*
   * Only a linked Email template without a Custom SMTP, or a linked SMS
   * template without a Twilio Config, goes unused (see
   * SubscriberTemplateConfiguration.ts). The tab used to warn whenever the
   * page had no Custom SMTP or no Twilio Config, linked templates or not.
   */
  const templateWarning: TemplateConfigurationWarning | null =
    !isLoading && statusPage && linkedMethods
      ? getTemplateConfigurationWarning({
          linkedMethods: linkedMethods,
          hasCustomSmtp: Boolean(statusPage.smtpConfig),
          hasCustomTwilio: Boolean(statusPage.callSmsConfig),
        })
      : null;

  const getMethodColor: (
    method: StatusPageSubscriberNotificationMethod | undefined,
  ) => Color = (
    method: StatusPageSubscriberNotificationMethod | undefined,
  ): Color => {
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

  const settingsContent: ReactElement = (
    <Fragment>
      <SubscriberNotificationWarnings statusPageId={modelId} />

      {/*
       * The Subscribe page and the five channels, one switch each, saved as
       * they are flipped. They used to be five one-switch cards here, and
       * all six again in a three-step card on Advanced Settings.
       */}
      <SubscriberChannelsCard statusPageId={modelId} />

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Subscriber > Advanced"
        cardProps={{
          title: "Advanced Subscriber Settings",
          description: "Advanced subscriber settings for this status page.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              allowSubscribersToChooseResources: true,
            },
            title: "Allow Subscribers to Choose Resources",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            placeholder:
              "Can subscribers choose which resources they want to subscribe to?",
          },
          {
            field: {
              allowSubscribersToChooseEventTypes: true,
            },
            title: "Allow Subscribers to Choose Event Types",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            placeholder:
              "Can subscribers choose which event types they want to subscribe to (like Incidents, Announcements or Scheduled Events)?",
          },
          {
            field: {
              subscriberTimezones: true,
            },
            title: "Subscriber Timezones",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
            required: false,
            placeholder: "Select Timezones",
            description:
              "Select timezones for subscribers. Subscribers will see time in these timezones when they receive notifications.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page",
          fields: [
            {
              field: {
                allowSubscribersToChooseResources: true,
              },
              fieldType: FieldType.Boolean,
              title: "Allow Subscribers to Choose Resources",
              description:
                "Can subscribers choose which resources they want to subscribe to?",
            },
            {
              field: {
                allowSubscribersToChooseEventTypes: true,
              },
              fieldType: FieldType.Boolean,
              title: "Allow Subscribers to Choose Event Types",
              description:
                "Can subscribers choose which event types they want to subscribe to (like Incidents, Announcements or Scheduled Events)?",
            },
            {
              field: {
                subscriberTimezones: true,
              },
              fieldType: FieldType.Element,
              title: "Subscriber Timezones",
              description:
                "Subscribers will see time in these timezones when they receive notifications.",
              getElement: (item: StatusPage): ReactElement => {
                if (
                  item["subscriberTimezones"] &&
                  item["subscriberTimezones"].length > 0
                ) {
                  return (
                    <TimezonesElement timezones={item["subscriberTimezones"]} />
                  );
                }
                /*
                 * Two sentences, in the placeholder chip every unset value
                 * on a detail card has: the chip wraps inside the card.
                 */
                return (
                  <PlaceholderText text="No subscriber timezones selected so far. Subscribers will receive notifications with times shown in GMT, EST, PST, IST, ACT timezones by default." />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Subscriber > Email Footer"
        cardProps={{
          title: "Email Footer Settings",
          description:
            "Custom footer text settings for subscriber email notifications.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              enableCustomSubscriberEmailNotificationFooterText: true,
            },
            title: "Enable Custom Email Footer Text",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Enable custom footer text in subscriber email notifications. If disabled, default footer text will be used.",
          },
          {
            field: {
              subscriberEmailNotificationFooterText: true,
            },
            title: "Subscriber Email Notification Footer Text",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "This is an automated email sent to you because you are subscribed to Status Page.",
            description:
              "This text will be added at the end of the email notification sent to subscribers. You can use this to add any additional information or links.",
            showIf: (item: FormValues<StatusPage>): boolean => {
              return (
                item.enableCustomSubscriberEmailNotificationFooterText === true
              );
            },
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-email-footer",
          fields: [
            {
              field: {
                enableCustomSubscriberEmailNotificationFooterText: true,
              },
              fieldType: FieldType.Boolean,
              title: "Enable Custom Email Footer Text",
              description:
                "Enable custom footer text in subscriber email notifications. If disabled, default footer text will be used.",
            },
            {
              field: {
                subscriberEmailNotificationFooterText: true,
              },
              fieldType: FieldType.LongText,
              title: "Subscriber Email Notification Footer Text",
              description:
                "This text will be added at the end of the email notification sent to subscribers. You can use this to add any additional information or links.",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Email > Subscriber"
        cardProps={{
          title: "Custom SMTP",
          description:
            "Custom SMTP settings for this status page. This will be used to send emails to subscribers.",
        }}
        editButtonText={"Edit SMTP"}
        isEditable={true}
        formFields={[
          {
            field: {
              smtpConfig: true,
            },
            title: "Custom SMTP Config",
            description:
              "Select SMTP Config to use for this status page to send email to subscribers. You can add SMTP Config in Project Settings >  Notification Settings > Custom SMTP.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: ProjectSmtpConfig,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "SMTP Config",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page",
          fields: [
            {
              field: {
                smtpConfig: {
                  name: true,
                },
              },
              title: "Custom SMTP Config",
              fieldType: FieldType.Element,
              getElement: (item: StatusPage): ReactElement => {
                if (item["smtpConfig"]) {
                  return <ProjectSMTPConfig smtpConfig={item["smtpConfig"]} />;
                }
                return (
                  <PlaceholderText
                    text="No Custom SMTP Config selected so far
                                    for this status page."
                  />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Call and SMS > Subscriber"
        cardProps={{
          title: "Twilio Config",
          description:
            "Twilio Config settings for this status page. This will be used to send SMS to subscribers.",
        }}
        editButtonText={"Edit Twilio Config"}
        isEditable={true}
        formFields={[
          {
            field: {
              callSmsConfig: true,
            },
            title: "Twilio Config",
            description:
              "Select Twilio Config to use for this status page to send SMS to subscribers. You can add Twilio Config in Project Settings > Notification Settings > Twilio Config.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: ProjectCallSMSConfig,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Twilio Config",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-call-config",
          fields: [
            {
              field: {
                callSmsConfig: {
                  name: true,
                },
              },
              title: "Twilio Config",
              fieldType: FieldType.Element,
              getElement: (item: StatusPage): ReactElement => {
                if (item["callSmsConfig"]) {
                  return (
                    <ProjectCallSMSConfigElement
                      callSmsConfig={item["callSmsConfig"]}
                    />
                  );
                }
                return (
                  <PlaceholderText text="No Twilio Config selected so far." />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );

  const notificationTemplatesContent: ReactElement = (
    <Fragment>
      {templateWarning && (
        <Alert
          type={AlertType.WARNING}
          strongTitle="Custom Templates Require Configuration"
          dataTestId="custom-templates-require-configuration"
          className="mb-5"
          title={
            templateWarning === TemplateConfigurationWarning.SmtpAndTwilio
              ? "Custom SMTP and Twilio Config are not configured for this status page. Custom notification templates for Email and SMS will not be used. Please configure them in the Settings tab above to use custom templates."
              : templateWarning === TemplateConfigurationWarning.Smtp
                ? "Custom SMTP is not configured for this status page. Custom Email notification templates will not be used. Please configure Custom SMTP in the Settings tab above to use custom email templates."
                : "Twilio Config is not configured for this status page. Custom SMS notification templates will not be used. Please configure Twilio Config in the Settings tab above to use custom SMS templates."
          }
        />
      )}
      <ModelTable<StatusPageSubscriberNotificationTemplateStatusPage>
        modelType={StatusPageSubscriberNotificationTemplateStatusPage}
        id="status-page-subscriber-notification-templates-table"
        userPreferencesKey="status-page-subscriber-notification-templates-table"
        saveFilterProps={{
          tableId: "status-page-view-subscriber-notification-templates-table",
        }}
        name="Status Page > Subscriber Notification Templates"
        isDeleteable={true}
        createVerb="Link"
        isCreateable={true}
        isEditable={false}
        isViewable={false}
        query={{
          statusPageId: modelId,
        }}
        onBeforeCreate={(
          item: StatusPageSubscriberNotificationTemplateStatusPage,
        ): Promise<StatusPageSubscriberNotificationTemplateStatusPage> => {
          item.statusPageId = modelId;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Notification Templates",
          description:
            "Link custom notification templates to this status page. You can create templates in Project Settings > Status Pages > Subscriber Templates.",
        }}
        noItemsMessage={
          "No notification templates linked to this status page. Default templates will be used."
        }
        showRefreshButton={true}
        onFetchSuccess={() => {
          void fetchLinkedMethods();
        }}
        formFields={[
          {
            field: {
              statusPageSubscriberNotificationTemplate: true,
            },
            title: "Notification Template",
            description:
              "Select a notification template to use for this status page. You can create templates in Project Settings > Status Pages > Subscriber Templates.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: StatusPageSubscriberNotificationTemplate,
              labelField: "templateName",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Template",
          },
        ]}
        filters={[
          {
            field: {
              statusPageSubscriberNotificationTemplate: {
                templateName: true,
              },
            },
            title: "Template Name",
            type: FieldType.Text,
          },
          {
            field: {
              statusPageSubscriberNotificationTemplate: {
                eventType: true,
              },
            },
            title: "Event Type",
            type: FieldType.Dropdown,
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageSubscriberNotificationEventType,
            ),
          },
          {
            field: {
              statusPageSubscriberNotificationTemplate: {
                notificationMethod: true,
              },
            },
            title: "Notification Method",
            type: FieldType.Dropdown,
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageSubscriberNotificationMethod,
            ),
          },
        ]}
        columns={[
          {
            field: {
              statusPageSubscriberNotificationTemplate: {
                templateName: true,
              },
            },
            title: "Template Name",
            type: FieldType.Element,
            getElement: (
              item: StatusPageSubscriberNotificationTemplateStatusPage,
            ): ReactElement => {
              return (
                <span>
                  {item.statusPageSubscriberNotificationTemplate
                    ?.templateName || translator.translateText("Unknown")}
                </span>
              );
            },
          },
          {
            field: {
              statusPageSubscriberNotificationTemplate: {
                eventType: true,
              },
            },
            title: "Event Type",
            type: FieldType.Element,
            getElement: (
              item: StatusPageSubscriberNotificationTemplateStatusPage,
            ): ReactElement => {
              return (
                <span>
                  {item.statusPageSubscriberNotificationTemplate?.eventType ||
                    translator.translateText("Unknown")}
                </span>
              );
            },
          },
          {
            field: {
              statusPageSubscriberNotificationTemplate: {
                notificationMethod: true,
              },
            },
            title: "Notification Method",
            type: FieldType.Element,
            getElement: (
              item: StatusPageSubscriberNotificationTemplateStatusPage,
            ): ReactElement => {
              const method: StatusPageSubscriberNotificationMethod | undefined =
                item.statusPageSubscriberNotificationTemplate
                  ?.notificationMethod;
              return (
                <Pill
                  text={method || "Unknown"}
                  color={getMethodColor(method)}
                />
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
    </Fragment>
  );

  return (
    <Fragment>
      <Tabs
        tabs={[
          {
            name: "Settings",
            children: settingsContent,
          },
          {
            name: "Notification Templates",
            children: notificationTemplatesContent,
          },
        ]}
        onTabChange={() => {}}
      />
    </Fragment>
  );
};

export default StatusPageSubscriberSettings;
