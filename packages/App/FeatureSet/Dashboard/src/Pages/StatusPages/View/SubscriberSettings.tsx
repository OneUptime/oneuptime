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
import Includes from "Common/Types/BaseDatabase/Includes";
import TwilioConfigUses, {
  TwilioConfigUse,
} from "Common/Types/CallAndSMS/TwilioConfigUse";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import TimezonesElement from "../../../Components/Timezone/TimezonesElement";
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
import SubscriberNotificationsCard from "../../../Components/StatusPage/SubscriberNotificationsCard";
import SubscriberRestrictionsSettings from "../../../Components/StatusPage/SubscriberRestrictionsSettings";
import SubscriberChoicesCard from "../../../Components/StatusPage/SubscriberChoicesCard";
import SubscriberEmailFooterCard from "../../../Components/StatusPage/SubscriberEmailFooterCard";
import {
  SUBSCRIBER_SETTINGS_MORE_TEST_ID,
  SubscriberChoicesCopy,
  SubscriberSettingsMoreValues,
  getSubscriberSettingsMoreItems,
} from "../../../Components/StatusPage/SubscriberChoicesCopy";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
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
  // What the cards under More settings hold, as each one loads or saves it.
  const [moreValues, setMoreValues] = useState<SubscriberSettingsMoreValues>(
    {},
  );

  const rememberMore: (values: SubscriberSettingsMoreValues) => void = (
    values: SubscriberSettingsMoreValues,
  ): void => {
    setMoreValues(
      (current: SubscriberSettingsMoreValues): SubscriberSettingsMoreValues => {
        return { ...current, ...values };
      },
    );
  };
  // Moves on whenever Send Notifications to Subscribers is saved: the warning re-reads it.
  const [notificationsRevision, setNotificationsRevision] = useState<number>(0);
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
      <SubscriberNotificationWarnings
        key={`subscriber-notification-warnings-${notificationsRevision}`}
        statusPageId={modelId}
      />

      {/*
       * Whether the page tells its subscribers anything at all: the one
       * switch for every message they get, first because the channels below
       * only decide how visitors sign up.
       */}
      <SubscriberNotificationsCard
        statusPageId={modelId}
        onSaved={() => {
          setNotificationsRevision((current: number): number => {
            return current + 1;
          });
        }}
      />

      {/*
       * The Subscribe page and the five channels, one switch each, saved as
       * they are flipped. They used to be five one-switch cards here, and
       * all six again in a three-step card on Advanced Settings.
       */}
      <SubscriberChannelsCard statusPageId={modelId} />

      {/*
       * Who may be a subscriber, whatever the channel: only the page's
       * private users, only addresses at the page's domains.
       */}
      <SubscriberRestrictionsSettings statusPageId={modelId} />

      {/*
       * What a visitor picks when they subscribe: which parts of the page,
       * which kinds of event. Two switches, saved as they are flipped.
       */}
      <SubscriberChoicesCard statusPageId={modelId} />

      {/*
       * Set once, if ever: the timezones times are shown in, the email
       * footer, and the page's own mail server and Twilio account. Folded,
       * the header names each card and says what is set.
       */}
      <AdvancedPageSection
        description={SubscriberChoicesCopy.moreDescription}
        items={getSubscriberSettingsMoreItems(moreValues)}
        dataTestId={SUBSCRIBER_SETTINGS_MORE_TEST_ID}
      >
        <CardModelDetail<StatusPage>
          name="Status Page > Branding > Subscriber > Advanced"
          cardProps={{
            title: SubscriberChoicesCopy.timezonesTitle,
            description: SubscriberChoicesCopy.timezonesDescription,
          }}
          isEditable={true}
          editButtonText="Edit Timezones"
          editModalTitle="Edit Timezones"
          formFields={[
            {
              field: {
                subscriberTimezones: true,
              },
              title: "Subscriber Timezones",
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
              required: false,
              placeholder: "Select Timezones",
              description: SubscriberChoicesCopy.timezonesDescription,
            },
          ]}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 1,
            modelType: StatusPage,
            id: "model-detail-status-page-subscriber-timezones",
            onItemLoaded: (item: StatusPage): void => {
              rememberMore({
                timezoneCount: item.subscriberTimezones?.length || 0,
              });
            },
            fields: [
              {
                field: {
                  subscriberTimezones: true,
                },
                fieldType: FieldType.Element,
                title: "Subscriber Timezones",
                getElement: (item: StatusPage): ReactElement => {
                  if (
                    item["subscriberTimezones"] &&
                    item["subscriberTimezones"].length > 0
                  ) {
                    return (
                      <TimezonesElement
                        timezones={item["subscriberTimezones"]}
                      />
                    );
                  }

                  return (
                    <PlaceholderText
                      text={SubscriberChoicesCopy.timezonesPlaceholder}
                    />
                  );
                },
              },
            ],
            modelId: modelId,
          }}
        />

        <SubscriberEmailFooterCard
          statusPageId={modelId}
          onLoaded={(isCustomFooter: boolean): void => {
            rememberMore({ isCustomFooter: isCustomFooter });
          }}
        />

        <CardModelDetail<StatusPage>
          name="Status Page > Email > Subscriber"
          cardProps={{
            title: SubscriberChoicesCopy.smtpTitle,
            description: SubscriberChoicesCopy.smtpDescription,
          }}
          editButtonText={"Edit SMTP"}
          editModalTitle={"Edit SMTP"}
          isEditable={true}
          formFields={[
            {
              field: {
                smtpConfig: true,
              },
              title: "Custom SMTP Config",
              description:
                "The SMTP server this page sends subscriber email from. Add one in Project Settings > Notifications.",
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
            onItemLoaded: (item: StatusPage): void => {
              rememberMore({ smtpConfigName: item.smtpConfig?.name || null });
            },
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
                    return (
                      <ProjectSMTPConfig smtpConfig={item["smtpConfig"]} />
                    );
                  }
                  return (
                    <PlaceholderText
                      text={SubscriberChoicesCopy.smtpPlaceholder}
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
            title: SubscriberChoicesCopy.twilioTitle,
            description: SubscriberChoicesCopy.twilioDescription,
          }}
          editButtonText={"Edit Twilio Config"}
          editModalTitle={"Edit Twilio Config"}
          isEditable={true}
          formFields={[
            {
              field: {
                callSmsConfig: true,
              },
              title: "Twilio Config",
              description:
                "The Twilio account this page sends subscriber SMS from. Add one in Project Settings > Notifications. Configs used for calls only are not listed.",
              fieldType: FormFieldSchemaType.Dropdown,
              /*
               * Only the configs that send SMS: a page sends its
               * subscribers SMS, and a config used for calls only sends
               * none (Common/Types/CallAndSMS/TwilioConfigUse).
               */
              dropdownModal: {
                type: ProjectCallSMSConfig,
                labelField: "name",
                valueField: "_id",
                query: {
                  usedFor: new Includes([
                    TwilioConfigUse.CallsAndSms,
                    TwilioConfigUse.SmsOnly,
                  ]),
                },
              },
              required: false,
              placeholder: "Twilio Config",
            },
          ]}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 1,
            modelType: StatusPage,
            id: "model-detail-call-config",
            onItemLoaded: (item: StatusPage): void => {
              rememberMore({
                twilioConfigName: item.callSmsConfig?.name || null,
              });
            },
            fields: [
              {
                field: {
                  callSmsConfig: {
                    name: true,
                    // What it is used for: one used for calls only sends no SMS.
                    usedFor: true,
                  },
                },
                title: "Twilio Config",
                fieldType: FieldType.Element,
                getElement: (item: StatusPage): ReactElement => {
                  if (item["callSmsConfig"]) {
                    /*
                     * The picker offers only the configs that send SMS, but
                     * a page keeps the config it named when that config is
                     * later used for calls only. Its subscribers' SMS then
                     * go as without a config, which the card says, in the
                     * words of the placeholder for no config at all.
                     */
                    if (
                      !TwilioConfigUses.sendsSms(item["callSmsConfig"].usedFor)
                    ) {
                      return (
                        <div
                          className="min-w-0"
                          data-testid="status-page-twilio-config-calls-only"
                        >
                          <div>
                            <ProjectCallSMSConfigElement
                              callSmsConfig={item["callSmsConfig"]}
                            />
                          </div>
                          <PlaceholderText
                            text={SubscriberChoicesCopy.twilioCallsOnlyNote}
                          />
                        </div>
                      );
                    }

                    return (
                      <ProjectCallSMSConfigElement
                        callSmsConfig={item["callSmsConfig"]}
                      />
                    );
                  }
                  return (
                    <PlaceholderText
                      text={SubscriberChoicesCopy.twilioPlaceholder}
                    />
                  );
                },
              },
            ],
            modelId: modelId,
          }}
        />
      </AdvancedPageSection>
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
            "Link custom notification templates to this status page. You can create templates in Status Pages → Settings → Subscriber Templates.",
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
              "Select a notification template to use for this status page. You can create templates in Status Pages → Settings → Subscriber Templates.",
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
