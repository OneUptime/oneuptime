import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import { Green, Red } from "Common/Types/BrandColors";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import GlobalConfig, {
  EmailServerType,
} from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import { useTranslation } from "react-i18next";

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
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
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.emailSettings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_SMTP] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      {/* Project Settings View  */}

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
        formFields={[
          {
            field: {
              adminNotificationEmail: true,
            },
            title: "Admin Notification Email",
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

      <CardModelDetail
        name="Email Server Settings"
        cardProps={{
          title: t("pages.settings.email.serverCardTitle"),
          description: t("pages.settings.email.serverCardDescription"),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.email.serverEditButton")}
        onSaveSuccess={() => {
          window.location.reload();
        }}
        formFields={[
          {
            field: {
              emailServerType: true,
            },
            title: "Email Server Type",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(EmailServerType),
            required: true,
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
              fieldType: FieldType.Text,
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
          formSteps={[
            {
              title: "SMTP Server",
              id: "server-info",
            },
            {
              title: "Authentication",
              id: "authentication",
            },
            {
              title: "OAuth Settings",
              id: "oauth-info",
              showIf: (values: FormValues<GlobalConfig>): boolean => {
                return values["smtpAuthType"] === SMTPAuthenticationType.OAuth;
              },
            },
            {
              title: "Email",
              id: "email-info",
            },
          ]}
          formFields={[
            {
              field: {
                smtpHost: true,
              },
              title: "Hostname",
              stepId: "server-info",
              fieldType: FormFieldSchemaType.Hostname,
              required: true,
              placeholder: "smtp.server.com",
              description:
                "SMTP server hostname. Examples: smtp.office365.com (Microsoft 365), smtp.gmail.com (Google)",
              disableSpellCheck: true,
            },
            {
              field: {
                smtpPort: true,
              },
              title: "Port",
              stepId: "server-info",
              fieldType: FormFieldSchemaType.Port,
              required: true,
              placeholder: "587",
              description:
                "SMTP port. Common ports: 587 (STARTTLS), 465 (SSL/TLS)",
            },
            {
              field: {
                isSMTPSecure: true,
              },
              title: "Use SSL / TLS",
              stepId: "server-info",
              fieldType: FormFieldSchemaType.Toggle,
              description:
                "If you use port 465, please enable this. Do not enable this if you use port 587.",
            },
            {
              field: {
                smtpAuthType: true,
              },
              title: "Authentication Type",
              stepId: "authentication",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
                SMTPAuthenticationType,
              ),
              required: true,
              defaultValue: SMTPAuthenticationType.UsernamePassword,
              description:
                "Select the authentication method. Use OAuth for providers like Microsoft 365, Google Workspace, etc.",
            },
            {
              field: {
                smtpUsername: true,
              },
              title: "Username / Email",
              stepId: "authentication",
              fieldType: FormFieldSchemaType.Text,
              required: false,
              placeholder: "emailuser",
              description:
                "For OAuth, this should be the email address you want to send from.",
              disableSpellCheck: true,
            },
            {
              field: {
                smtpPassword: true,
              },
              title: "Password",
              stepId: "authentication",
              fieldType: FormFieldSchemaType.EncryptedText,
              required: false,
              placeholder: "Password",
              description:
                "Required for Username and Password authentication. Not used for OAuth.",
              disableSpellCheck: true,
              showIf: (values: FormValues<GlobalConfig>): boolean => {
                return (
                  values["smtpAuthType"] ===
                    SMTPAuthenticationType.UsernamePassword ||
                  !values["smtpAuthType"]
                );
              },
            },
            {
              field: {
                smtpOAuthProviderType: true,
              },
              title: "OAuth Provider Type",
              stepId: "oauth-info",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnum(OAuthProviderType),
              required: true,
              defaultValue: OAuthProviderType.ClientCredentials,
              description:
                "Select the OAuth grant type. Use 'Client Credentials' for Microsoft 365 and most providers. Use 'JWT Bearer' for Google Workspace service accounts.",
              showIf: (values: FormValues<GlobalConfig>): boolean => {
                return values["smtpAuthType"] === SMTPAuthenticationType.OAuth;
              },
            },
            {
              field: {
                smtpClientId: true,
              },
              title: "OAuth Client ID",
              stepId: "oauth-info",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "12345678-1234-1234-1234-123456789012",
              description:
                "For Client Credentials: Application (Client) ID from your OAuth provider. For JWT Bearer (Google): Service account email (client_email from JSON key file).",
              disableSpellCheck: true,
              showIf: (values: FormValues<GlobalConfig>): boolean => {
                return values["smtpAuthType"] === SMTPAuthenticationType.OAuth;
              },
            },
            {
              field: {
                smtpClientSecret: true,
              },
              title: "OAuth Client Secret",
              stepId: "oauth-info",
              fieldType: FormFieldSchemaType.LongText,
              required: true,
              placeholder: "Client secret value",
              description:
                "For Client Credentials: Client secret from your OAuth application. For JWT Bearer (Google): The entire private_key from your service account JSON file (including BEGIN/END markers).",
              disableSpellCheck: true,
              showIf: (values: FormValues<GlobalConfig>): boolean => {
                return values["smtpAuthType"] === SMTPAuthenticationType.OAuth;
              },
            },
            {
              field: {
                smtpTokenUrl: true,
              },
              title: "OAuth Token URL",
              stepId: "oauth-info",
              fieldType: FormFieldSchemaType.URL,
              required: true,
              placeholder:
                "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token",
              description:
                "The OAuth token endpoint URL. For Microsoft 365: https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token. For Google: https://oauth2.googleapis.com/token",
              disableSpellCheck: true,
              showIf: (values: FormValues<GlobalConfig>): boolean => {
                return values["smtpAuthType"] === SMTPAuthenticationType.OAuth;
              },
            },
            {
              field: {
                smtpScope: true,
              },
              title: "OAuth Scope",
              stepId: "oauth-info",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "https://outlook.office365.com/.default",
              description:
                "The OAuth scope(s) required for SMTP access. For Microsoft 365: https://outlook.office365.com/.default. For Google: https://mail.google.com/",
              disableSpellCheck: true,
              showIf: (values: FormValues<GlobalConfig>): boolean => {
                return values["smtpAuthType"] === SMTPAuthenticationType.OAuth;
              },
            },
            {
              field: {
                smtpFromEmail: true,
              },
              title: "Email From",
              stepId: "email-info",
              fieldType: FormFieldSchemaType.Email,
              required: true,
              description:
                "Email used to log in to this SMTP Server. This is also the email your customers will see. ",
              placeholder: "email@company.com",
              disableSpellCheck: true,
            },
            {
              field: {
                smtpFromName: true,
              },
              title: "From Name",
              stepId: "email-info",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              description:
                "This is the display name your team and customers see, when they receive emails from OneUptime.",
              placeholder: "Company, Inc.",
              disableSpellCheck: true,
            },
          ]}
          modelDetailProps={{
            modelType: GlobalConfig,
            id: "model-detail-global-config",
            fields: [
              {
                field: {
                  smtpHost: true,
                },
                title: "SMTP Host",
                placeholder: "None",
              },
              {
                field: {
                  smtpPort: true,
                },
                title: "SMTP Port",
                placeholder: "None",
              },
              {
                field: {
                  smtpAuthType: true,
                },
                title: "Authentication Type",
                placeholder: "Username and Password",
              },
              {
                field: {
                  smtpUsername: true,
                },
                title: "SMTP Username / Email",
                placeholder: "None",
              },
              {
                field: {
                  smtpOAuthProviderType: true,
                },
                title: "OAuth Provider Type",
                placeholder: "None",
              },
              {
                field: {
                  smtpClientId: true,
                },
                title: "OAuth Client ID",
                placeholder: "None",
              },
              {
                field: {
                  smtpTokenUrl: true,
                },
                title: "OAuth Token URL",
                placeholder: "None",
              },
              {
                field: {
                  smtpScope: true,
                },
                title: "OAuth Scope",
                placeholder: "None",
              },
              {
                field: {
                  smtpFromEmail: true,
                },
                title: "SMTP Email",
                placeholder: "None",
                fieldType: FieldType.Email,
              },
              {
                field: {
                  smtpFromName: true,
                },
                title: "SMTP From Name",
                placeholder: "None",
              },
              {
                field: {
                  isSMTPSecure: true,
                },
                title: "Use SSL/TLS",
                placeholder: "No",
                fieldType: FieldType.Boolean,
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
          formFields={[
            {
              field: {
                sendgridApiKey: true,
              },
              title: "Sendgrid API Key",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Sendgrid API Key",
            },
            {
              field: {
                sendgridFromEmail: true,
              },
              title: "From Email",
              fieldType: FormFieldSchemaType.Email,
              required: true,
              placeholder: "email@yourcompany.com",
            },
            {
              field: {
                sendgridFromName: true,
              },
              title: "From Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Acme, Inc.",
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
                        color={Green}
                      />
                    );
                  } else if (!item["sendgridApiKey"]) {
                    return (
                      <Pill
                        text={t("pages.settings.email.pillNoApiKey")}
                        color={Red}
                      />
                    );
                  } else if (!item["sendgridFromEmail"]) {
                    return (
                      <Pill
                        text={t("pages.settings.email.pillNoFromEmail")}
                        color={Red}
                      />
                    );
                  } else if (!item["sendgridFromName"]) {
                    return (
                      <Pill
                        text={t("pages.settings.email.pillNoFromName")}
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
    </Page>
  );
};

export default Settings;
