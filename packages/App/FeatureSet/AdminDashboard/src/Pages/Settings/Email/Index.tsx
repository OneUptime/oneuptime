import PageMap from "../../../Utils/PageMap";
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
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
  getGlobalSmtpConfigFormFields,
  getSmtpConfigFormSteps,
  showsSmtpOAuthCredentials,
  showsSmtpOAuthProviderType,
  showsSmtpServerFields,
  showsSmtpUsername,
} from "Common/UI/Components/SmtpConfig/SmtpConfigFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
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
 * GlobalConfig row: nothing is filled in, so an instance saves what it
 * holds.
 */
const SMTP_HOST_FORM_STEPS: Array<FormStep<GlobalConfig>> =
  getSmtpConfigFormSteps<GlobalConfig>();

const SMTP_HOST_FORM_FIELDS: Array<ModelField<GlobalConfig>> =
  getGlobalSmtpConfigFormFields();

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
          formSteps={SMTP_HOST_FORM_STEPS}
          formFields={SMTP_HOST_FORM_FIELDS}
          modelDetailProps={{
            modelType: GlobalConfig,
            id: "model-detail-global-config",
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
                placeholder: "Username and Password",
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
