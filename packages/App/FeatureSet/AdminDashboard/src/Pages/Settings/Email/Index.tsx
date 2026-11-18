import PageMap from "../../../Utils/PageMap";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import { Green, Red } from "Common/Types/BrandColors";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  GLOBAL_EMAIL_PROVIDERS,
  GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
  GlobalEmailProviderTransport,
  getGlobalEmailProviderCard,
  getGlobalSmtpConfigFormFields,
  getSmtpConfigFormSteps,
  getSmtpSignInSentence,
  showsSmtpOAuthCredentials,
  showsSmtpOAuthProviderType,
  showsSmtpServerFields,
  showsSmtpUsername,
} from "Common/UI/Components/SmtpConfig/SmtpConfigFormFields";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import FieldType from "Common/UI/Components/Types/FieldType";
import IconProp from "Common/Types/Icon/IconProp";
import EmailProviderSettingsCard from "./EmailProviderSettingsCard";
import ServerAlertsCard from "./ServerAlertsCard";
import ServerEmailLogCard from "./ServerEmailLogCard";
import ServerEmailEnvironmentCard, {
  ServerEmailEnvironmentLoadingCard,
  ServerEmailEnvironmentUnusedAlert,
  useServerEmailEnvironment,
  UseServerEmailEnvironmentResult,
} from "./ServerEmailEnvironmentCard";
import ServerTestCard, {
  SERVER_TEST_CARD_COPY,
} from "../../../Components/ServerSetup/ServerTestCard";
import { SERVER_SETUP_SET_UP_EMAIL_QUERY } from "../../../Components/ServerSetup/ServerSetupChecklist";
import Navigation from "Common/UI/Utils/Navigation";
import { ServerSendingChannel } from "Common/Types/ServerSending/ServerSendingStatus";
import { ServerSetupCheckId } from "Common/Types/ServerSetup/ServerSetupChecklist";
import {
  useServerSetupChecklist,
  UseServerSetupChecklistResult,
} from "Common/UI/Utils/ServerSetupChecklist";
import ServerSendingStatusLoader from "Common/UI/Utils/ServerSending";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import GlobalConfig, {
  EmailServerType,
} from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import { useTranslation } from "react-i18next";

/*
 * Server (hostname, port, username, password, and a folded Advanced
 * section with the transport, TLS, sign-in type and OAuth), then Sender -
 * the Dashboard's Custom SMTP form, from the same builder
 * (Common/UI/Components/SmtpConfig), built once. An edit form of the one
 * GlobalConfig row: an instance saves what it holds, and only what it holds
 * nothing for starts on a default - the port on 587, the From Name on the
 * product's name (#8183).
 */
const SMTP_HOST_FORM_STEPS: Array<FormStep<GlobalConfig>> =
  getSmtpConfigFormSteps<GlobalConfig>();

const SMTP_HOST_FORM_FIELDS: Array<ModelField<GlobalConfig>> =
  getGlobalSmtpConfigFormFields();

/*
 * How the instance sends its email: its own mail server first, the default,
 * then each provider with an HTTP API of its own - SendGrid as it always
 * was, and Amazon SES, Mailgun, Postmark and Resend - one card each, with
 * its icon and a line. The stored values are the enum's, as before.
 */
export const EMAIL_SERVER_TYPE_CHOICES: Array<CardSelectOption> = [
  {
    value: EmailServerType.CustomSMTP,
    title: "Custom SMTP",
    description: "Send through your own mail server.",
    icon: IconProp.Server,
  },
  getGlobalEmailProviderCard(EmailServerType.AmazonSES)!,
  {
    value: EmailServerType.Sendgrid,
    title: "SendGrid",
    isTitleProductName: true,
    description: "Send through your SendGrid account.",
    icon: IconProp.PaperAirplane,
  },
  getGlobalEmailProviderCard(EmailServerType.Mailgun)!,
  getGlobalEmailProviderCard(EmailServerType.Postmark)!,
  getGlobalEmailProviderCard(EmailServerType.Resend)!,
];

// The answer a stored value reads as, as the card shows it: "SendGrid", not "Sendgrid".
export const getEmailServerTypeTitle: (value: unknown) => string = (
  value: unknown,
): string => {
  const choice: CardSelectOption | undefined = getEmailServerTypeChoice(value);

  return choice ? choice.title : value ? String(value) : "";
};

export const getEmailServerTypeChoice: (
  value: unknown,
) => CardSelectOption | undefined = (
  value: unknown,
): CardSelectOption | undefined => {
  return EMAIL_SERVER_TYPE_CHOICES.find(
    (candidate: CardSelectOption): boolean => {
      return candidate.value === value;
    },
  );
};

/*
 * How the server signs in to its mail server, as the card says it: the
 * Edit dialog's own sentence (getSmtpSignInSentence), so the two say the
 * same thing (#7458). The card showed the stored Authentication Type, and
 * read "Username and Password" on a server that was never given a
 * username or a password - and so sends without signing in, as the
 * dialog said - and on one that never picked a sign-in at all.
 */
export const getSmtpSignInText: (item: GlobalConfig) => string = (
  item: GlobalConfig,
): string => {
  return getSmtpSignInSentence(item, GLOBAL_SMTP_CONFIG_FORM_COLUMNS);
};

/*
 * Whether the page was opened to set email up (Server Setup's "Set up
 * email", #7460): it then opens in the form of the server that sends the
 * email - the mail server's, or the provider's - rather than on four cards
 * whose Edit buttons each might be it.
 */
export const isSettingUpEmailRequested: () => boolean = (): boolean => {
  return (
    Navigation.getQueryStringByName(SERVER_SETUP_SET_UP_EMAIL_QUERY.name) ===
    SERVER_SETUP_SET_UP_EMAIL_QUERY.value
  );
};

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  // Where email stands, for the test card, read again after a save.
  const checklist: UseServerSetupChecklistResult = useServerSetupChecklist();

  /*
   * Read once, and taken off the address: the page opened again, or
   * reloaded, opens as it always does.
   */
  const [isSettingUpEmail] = React.useState<boolean>(isSettingUpEmailRequested);

  useEffect(() => {
    if (isSettingUpEmail) {
      Navigation.setQueryString({
        [SERVER_SETUP_SET_UP_EMAIL_QUERY.name]: null,
      });
    }
  }, []);

  /*
   * Whether the GLOBAL_EMAIL_ environment variables set the server's email
   * settings (#7738): they are then shown in place of the saved ones,
   * read-only.
   */
  const emailEnvironment: UseServerEmailEnvironmentResult =
    useServerEmailEnvironment();

  const onSettingsSaved: () => void = (): void => {
    /*
     * Saving the settings starts email again at "not tested yet": the
     * banner at the top of the page reads where email stands again too, so
     * "Email is not set up" goes once it is (#7459).
     */
    ServerSendingStatusLoader.clear();
    void checklist.reload();
  };
  const [emailServerType, setemailServerType] = React.useState<EmailServerType>(
    EmailServerType.CustomSMTP,
  );

  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const [error, setError] = React.useState<string>("");

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    const globalConfig: GlobalConfig | null =
      await ModelAPI.getItem<GlobalConfig>({
        modelType: GlobalConfig,
        id: ObjectID.getZeroObjectID(),
        select: {
          _id: true,
          emailServerType: true,
        },
      });

    if (globalConfig) {
      setemailServerType(
        globalConfig.emailServerType || EmailServerType.CustomSMTP,
      );
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchItem().catch((err: Error) => {
      setError(err.message);
    });
  }, []);

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  // An Email Server Type in the reader's words: a provider's name is its own in every language.
  const getEmailServerTypeText: (value: unknown) => string = (
    value: unknown,
  ): string => {
    const title: string = getEmailServerTypeTitle(value);

    return getEmailServerTypeChoice(value)?.isTitleProductName
      ? title
      : t(title);
  };

  return (
    <Page
      title={t("pages.settings.title")}
      isTitleTranslated={true}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.emailSettings"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_SMTP] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      {/*
       * Does it work? Where email stands and its test send, first: it is
       * what the admin came here to make true.
       */}
      <ServerTestCard
        check={ServerSetupCheckId.Email}
        title={t(SERVER_TEST_CARD_COPY.emailTitle)}
        description={t(SERVER_TEST_CARD_COPY.emailDescription)}
        channels={[ServerSendingChannel.Email]}
        checklist={checklist}
      />

      {emailEnvironment.isLoading ? (
        <ServerEmailEnvironmentLoadingCard />
      ) : emailEnvironment.answer?.isSetByEnvironment ? (
        <ServerEmailEnvironmentCard
          answer={emailEnvironment.answer}
          getServerTypeText={getEmailServerTypeText}
        />
      ) : (
        <>
          <ServerEmailEnvironmentUnusedAlert answer={emailEnvironment.answer} />
          {/*
           * The settings saved on this page: the ones the server sends
           * with, unless the GLOBAL_EMAIL_ environment variables set them.
           */}
          <CardModelDetail
            name="Email Server Settings"
            cardProps={{
              title: t("pages.settings.email.serverCardTitle"),
              description: t("pages.settings.email.serverCardDescription"),
            }}
            isEditable={true}
            editButtonText={t("pages.settings.email.serverEditButton")}
            // Titled like the button that opens it, not "Edit Global Config".
            editModalTitle={t("pages.settings.email.serverEditButton")}
            onSaveSuccess={() => {
              window.location.reload();
            }}
            formFields={[
              /*
               * One card an answer, each with its icon and its line, where a
               * dropdown listed the enum's names (Sendgrid first) under a
               * description that only said "Email Server Type" again. The
               * stored values are the enum's, as before.
               */
              {
                field: {
                  emailServerType: true,
                },
                title: "Email Server Type",
                fieldType: FormFieldSchemaType.CardSelect,
                cardSelectOptions: EMAIL_SERVER_TYPE_CHOICES,
                // Two to a row: each card carries a line, which three columns squeeze.
                cardSelectMaxColumns: 2,
                // An instance that never picked one sends through its own server, as this page reads it.
                defaultValue: EmailServerType.CustomSMTP,
                required: true,
                hideColumnDescription: true,
                dataTestId: "email-server-type",
              },
            ]}
            modelDetailProps={{
              modelType: GlobalConfig,
              id: "model-detail-global-config",
              fields: [
                {
                  field: {
                    emailServerType: true,
                  },
                  title: "Email Server Type",
                  fieldType: FieldType.Element,
                  getElement: (item: GlobalConfig): ReactElement => {
                    // Never picked: the mail service sends through Custom SMTP.
                    const value: EmailServerType =
                      item.emailServerType || EmailServerType.CustomSMTP;

                    return <span>{getEmailServerTypeText(value)}</span>;
                  },
                },
              ],
              modelId: ObjectID.getZeroObjectID(),
            }}
          />

          {emailServerType === EmailServerType.CustomSMTP ? (
            <CardModelDetail<GlobalConfig>
              name="Host Settings"
              cardProps={{
                title: t("pages.settings.email.smtpCardTitle"),
                description: t("pages.settings.email.smtpCardDescription"),
              }}
              isEditable={true}
              editButtonText={t("pages.settings.email.smtpEditButton")}
              // Titled like the button that opens it, not "Edit Global Config".
              editModalTitle={t("pages.settings.email.smtpEditButton")}
              // Server Setup's "Set up email" lands in this form (#7460).
              startsEditing={isSettingUpEmail}
              onSaveSuccess={onSettingsSaved}
              formSteps={SMTP_HOST_FORM_STEPS}
              formFields={SMTP_HOST_FORM_FIELDS}
              modelDetailProps={{
                modelType: GlobalConfig,
                id: "model-detail-global-config",
                /*
                 * Whether a password is set: the server signs in with the
                 * username and password only when both are (the
                 * Authentication Type row). Never shown.
                 */
                selectMoreFields: {
                  smtpPassword: true,
                },
                /*
                 * What the server sends with: the rows a Microsoft Graph or
                 * OAuth server does not use are left out, as the form leaves
                 * them out.
                 */
                fields: [
                  {
                    field: {
                      smtpTransportType: true,
                    },
                    title: "Transport",
                    placeholder: "SMTP",
                  },
                  {
                    field: {
                      smtpHost: true,
                    },
                    title: "SMTP Host",
                    placeholder: "None",
                    showIf: (item: GlobalConfig): boolean => {
                      return showsSmtpServerFields(
                        item,
                        GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
                      );
                    },
                  },
                  {
                    field: {
                      smtpPort: true,
                    },
                    title: "SMTP Port",
                    placeholder: "None",
                    showIf: (item: GlobalConfig): boolean => {
                      return showsSmtpServerFields(
                        item,
                        GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
                      );
                    },
                  },
                  {
                    field: {
                      isSMTPSecure: true,
                    },
                    title: "Require TLS",
                    placeholder: "No",
                    fieldType: FieldType.Boolean,
                    showIf: (item: GlobalConfig): boolean => {
                      return showsSmtpServerFields(
                        item,
                        GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
                      );
                    },
                  },
                  {
                    field: {
                      smtpAuthType: true,
                    },
                    title: "Authentication Type",
                    fieldType: FieldType.Element,
                    getElement: (item: GlobalConfig): ReactElement => {
                      return <span>{t(getSmtpSignInText(item))}</span>;
                    },
                    showIf: (item: GlobalConfig): boolean => {
                      return showsSmtpServerFields(
                        item,
                        GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
                      );
                    },
                  },
                  {
                    field: {
                      smtpUsername: true,
                    },
                    title: "Username",
                    placeholder: "None",
                    showIf: (item: GlobalConfig): boolean => {
                      return showsSmtpUsername(
                        item,
                        GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
                      );
                    },
                  },
                  {
                    field: {
                      smtpOAuthProviderType: true,
                    },
                    title: "OAuth Provider Type",
                    // What the mail service uses when none is picked.
                    placeholder: "Client Credentials",
                    showIf: (item: GlobalConfig): boolean => {
                      return showsSmtpOAuthProviderType(
                        item,
                        GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
                      );
                    },
                  },
                  {
                    field: {
                      smtpClientId: true,
                    },
                    title: "OAuth Client ID",
                    placeholder: "None",
                    showIf: (item: GlobalConfig): boolean => {
                      return showsSmtpOAuthCredentials(
                        item,
                        GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
                      );
                    },
                  },
                  {
                    field: {
                      smtpTokenUrl: true,
                    },
                    title: "OAuth Token URL",
                    placeholder: "None",
                    showIf: (item: GlobalConfig): boolean => {
                      return showsSmtpOAuthCredentials(
                        item,
                        GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
                      );
                    },
                  },
                  {
                    field: {
                      smtpScope: true,
                    },
                    title: "OAuth Scope",
                    placeholder: "None",
                    showIf: (item: GlobalConfig): boolean => {
                      return showsSmtpOAuthCredentials(
                        item,
                        GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
                      );
                    },
                  },
                  {
                    field: {
                      smtpFromEmail: true,
                    },
                    title: "From Email",
                    placeholder: "None",
                    fieldType: FieldType.Email,
                  },
                  {
                    field: {
                      smtpFromName: true,
                    },
                    title: "From Name",
                    placeholder: "None",
                  },
                ],
                modelId: ObjectID.getZeroObjectID(),
              }}
            />
          ) : (
            <></>
          )}

          {emailServerType === EmailServerType.Sendgrid ? (
            <CardModelDetail<GlobalConfig>
              name="Sendgrid Settings"
              cardProps={{
                title: t("pages.settings.email.sendgridCardTitle"),
                description: t("pages.settings.email.sendgridCardDescription"),
              }}
              isEditable={true}
              editButtonText={t("pages.settings.email.sendgridEditButton")}
              // Titled like the button that opens it, not "Edit Global Config".
              editModalTitle={t("pages.settings.email.sendgridEditButton")}
              startsEditing={isSettingUpEmail}
              onSaveSuccess={onSettingsSaved}
              formFields={[
                {
                  field: {
                    sendgridApiKey: true,
                  },
                  title: "SendGrid API Key",
                  fieldType: FormFieldSchemaType.Text,
                  required: true,
                  placeholder: "SendGrid API Key",
                  // The column's description only said "Sendgrid API Key" again.
                  hideColumnDescription: true,
                },
                {
                  field: {
                    sendgridFromEmail: true,
                  },
                  title: "From Email",
                  fieldType: FormFieldSchemaType.Email,
                  required: true,
                  placeholder: "email@yourcompany.com",
                  hideColumnDescription: true,
                },
                {
                  field: {
                    sendgridFromName: true,
                  },
                  title: "From Name",
                  fieldType: FormFieldSchemaType.Text,
                  required: true,
                  placeholder: "Acme, Inc.",
                  hideColumnDescription: true,
                },
              ]}
              modelDetailProps={{
                modelType: GlobalConfig,
                id: "model-detail-global-config",
                selectMoreFields: {
                  sendgridFromEmail: true,
                  sendgridFromName: true,
                },
                fields: [
                  {
                    field: {
                      sendgridApiKey: true,
                    },
                    title: "",
                    placeholder: "None",
                    getElement: (item: GlobalConfig) => {
                      if (
                        item["sendgridApiKey"] &&
                        item["sendgridFromEmail"] &&
                        item["sendgridFromName"]
                      ) {
                        return (
                          <Pill
                            text={t("pages.settings.email.pillEnabled")}
                            isUserContent={true}
                            color={Green}
                          />
                        );
                      } else if (!item["sendgridApiKey"]) {
                        return (
                          <Pill
                            text={t("pages.settings.email.pillNoApiKey")}
                            isUserContent={true}
                            color={Red}
                          />
                        );
                      } else if (!item["sendgridFromEmail"]) {
                        return (
                          <Pill
                            text={t("pages.settings.email.pillNoFromEmail")}
                            isUserContent={true}
                            color={Red}
                          />
                        );
                      } else if (!item["sendgridFromName"]) {
                        return (
                          <Pill
                            text={t("pages.settings.email.pillNoFromName")}
                            isUserContent={true}
                            color={Red}
                          />
                        );
                      }

                      return <></>;
                    },
                  },
                ],
                modelId: ObjectID.getZeroObjectID(),
              }}
            />
          ) : (
            <></>
          )}

          {/* One element: Page's children are elements, not an array among them. */}
          <>
            {GLOBAL_EMAIL_PROVIDERS.map(
              (provider: {
                serverType: EmailServerType;
                transport: GlobalEmailProviderTransport;
              }): ReactElement => {
                if (emailServerType !== provider.serverType) {
                  return (
                    <React.Fragment key={provider.transport}></React.Fragment>
                  );
                }

                return (
                  <EmailProviderSettingsCard
                    onSaveSuccess={onSettingsSaved}
                    key={provider.transport}
                    transport={provider.transport}
                    startsEditing={isSettingUpEmail}
                  />
                );
              },
            )}
          </>
        </>
      )}

      {/*
       * Where OneUptime writes about the server itself: for later, once
       * email works, so after everything that makes it work (#7460).
       */}
      <CardModelDetail
        name="Admin Notification Email"
        cardProps={{
          title: t("pages.settings.email.adminNotificationCardTitle"),
          description: t(
            "pages.settings.email.adminNotificationCardDescription",
          ),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.email.adminNotificationEditButton")}
        // Titled like the button that opens it, not "Edit Global Config".
        editModalTitle={t("pages.settings.email.adminNotificationEditButton")}
        formFields={[
          {
            field: {
              adminNotificationEmail: true,
            },
            title: "Admin Notification Email",
            description:
              "Where OneUptime writes about this server, such as when a probe goes offline.",
            fieldType: FormFieldSchemaType.Email,
            required: false,
            disableSpellCheck: true,
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config",
          fields: [
            {
              field: {
                adminNotificationEmail: true,
              },
              title: "Admin Notification Email",
              fieldType: FieldType.Email,
              placeholder: "None",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      {/*
       * Where master admins are told when the server's email or its global
       * probes stop working, and work again (#6879): beside the Admin
       * Notification Email, which is told about the probes.
       */}
      <ServerAlertsCard />

      {/*
       * What the server sent, and what it failed to send, through these
       * settings (#6878): where "did the reset email go out?" is answered.
       */}
      <ServerEmailLogCard />
    </Page>
  );
};

export default Settings;
