import EmptyResponseData from "Common/Types/API/EmptyResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { NOTIFICATION_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const CustomSMTPTable: FunctionComponent = (): ReactElement => {
  const [showSMTPTestModal, setShowSMTPTestModal] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [currentSMTPTestConfig, setCurrentSMTPTestConfig] =
    useState<ProjectSmtpConfig | null>(null);
  const [isSMTPTestLoading, setIsSMTPTestLoading] = useState<boolean>(false);

  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);

  useEffect(() => {
    setError("");
  }, [showSMTPTestModal]);

  return (
    <>
      <ModelTable<ProjectSmtpConfig>
        modelType={ProjectSmtpConfig}
        id="smtp-table"
        userPreferencesKey="smtp-table"
        actionButtons={[
          {
            title: "Send Test Email",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Play,
            onClick: async (
              item: ProjectSmtpConfig,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentSMTPTestConfig(item);
                setShowSMTPTestModal(true);

                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Custom SMTP Configs",
          description:
            "If you need OneUptime to send emails through your SMTP Server, please enter the server details here.",
        }}
        formSteps={[
          {
            title: "Basic",
            id: "basic-info",
          },
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
            showIf: (values: FormValues<ProjectSmtpConfig>): boolean => {
              return values["authType"] === SMTPAuthenticationType.OAuth;
            },
          },
          {
            title: "Email",
            id: "email-info",
          },
        ]}
        name="Settings > Custom SMTP Config"
        noItemsMessage={"No SMTP Server Configs found."}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description:
              "Friendly name for this config so you remember what this is about.",
            placeholder: "Company SMTP Server",
            stepId: "basic-info",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            stepId: "basic-info",
            description:
              "Friendly description for this config so you remember what this is about.",
            placeholder: "Company SMTP server hosted on AWS",
          },
          {
            field: {
              hostname: true,
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
              port: true,
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
              secure: true,
            },
            title: "Use SSL / TLS",
            stepId: "server-info",
            fieldType: FormFieldSchemaType.Toggle,
            description:
              "Enable secure email communication. Recommended for most providers.",
          },
          {
            field: {
              authType: true,
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
              username: true,
            },
            title: "Username / Email",
            stepId: "authentication",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "emailuser@company.com",
            description:
              "For OAuth, this should be the email address you want to send from.",
            disableSpellCheck: true,
          },
          {
            field: {
              password: true,
            },
            title: "Password",
            stepId: "authentication",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: false,
            placeholder: "Password",
            description:
              "Required for Username and Password authentication. Not used for OAuth.",
            disableSpellCheck: true,
            showIf: (values: FormValues<ProjectSmtpConfig>): boolean => {
              return (
                values["authType"] ===
                  SMTPAuthenticationType.UsernamePassword || !values["authType"]
              );
            },
          },
          {
            field: {
              oauthProviderType: true,
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
            showIf: (values: FormValues<ProjectSmtpConfig>): boolean => {
              return values["authType"] === SMTPAuthenticationType.OAuth;
            },
          },
          {
            field: {
              clientId: true,
            },
            title: "OAuth Client ID",
            stepId: "oauth-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "12345678-1234-1234-1234-123456789012",
            description:
              "For Client Credentials: Application (Client) ID from your OAuth provider. For JWT Bearer (Google): Service account email (client_email from JSON key file).",
            disableSpellCheck: true,
            showIf: (values: FormValues<ProjectSmtpConfig>): boolean => {
              return values["authType"] === SMTPAuthenticationType.OAuth;
            },
          },
          {
            field: {
              clientSecret: true,
            },
            title: "OAuth Client Secret",
            stepId: "oauth-info",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "Client secret value",
            description:
              "For Client Credentials: Client secret from your OAuth application. For JWT Bearer (Google): The entire private_key from your service account JSON file (including BEGIN/END markers).",
            disableSpellCheck: true,
            showIf: (values: FormValues<ProjectSmtpConfig>): boolean => {
              return values["authType"] === SMTPAuthenticationType.OAuth;
            },
          },
          {
            field: {
              tokenUrl: true,
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
            showIf: (values: FormValues<ProjectSmtpConfig>): boolean => {
              return values["authType"] === SMTPAuthenticationType.OAuth;
            },
          },
          {
            field: {
              scope: true,
            },
            title: "OAuth Scope",
            stepId: "oauth-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "https://outlook.office365.com/.default",
            description:
              "The OAuth scope(s) required for SMTP access. For Microsoft 365: https://outlook.office365.com/.default. For Google: https://mail.google.com/",
            disableSpellCheck: true,
            showIf: (values: FormValues<ProjectSmtpConfig>): boolean => {
              return values["authType"] === SMTPAuthenticationType.OAuth;
            },
          },
          {
            field: {
              fromEmail: true,
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
              fromName: true,
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
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            title: "Name",
            type: FieldType.Text,
            field: {
              name: true,
            },
          },
          {
            title: "Description",
            type: FieldType.LongText,
            field: {
              description: true,
            },
          },
          {
            title: "Server Host",
            type: FieldType.Text,
            field: {
              hostname: true,
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
              description: true,
            },

            title: "Description",
            noValueMessage: "-",
            type: FieldType.LongText,
          },
          {
            field: {
              hostname: true,
            },
            title: "Server Host",
            type: FieldType.Text,
          },
          {
            field: {
              authType: true,
            },
            title: "Auth Type",
            type: FieldType.Text,
            noValueMessage: "Username/Password",
          },
        ]}
      />

      {showSMTPTestModal && currentSMTPTestConfig ? (
        <BasicFormModal
          title={`Send Test Email`}
          description={`Send a test email to verify your SMTP config.`}
          formProps={{
            error: error,
            fields: [
              {
                field: {
                  toEmail: true,
                },
                title: "Email",
                description: "Email address to send test email to.",
                fieldType: FormFieldSchemaType.Email,
                required: true,
                placeholder: "test@company.com",
              },
            ],
          }}
          submitButtonText={"Send Test Email"}
          onClose={() => {
            setShowSMTPTestModal(false);
            setError("");
          }}
          isLoading={isSMTPTestLoading}
          onSubmit={async (values: JSONObject) => {
            try {
              setIsSMTPTestLoading(true);
              setError("");

              // test SMTP config
              const response:
                | HTTPResponse<EmptyResponseData>
                | HTTPErrorResponse = await API.post({
                url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(
                  `/smtp-config/test`,
                ),
                data: {
                  toEmail: values["toEmail"],
                  smtpConfigId: new ObjectID(
                    currentSMTPTestConfig["_id"]
                      ? currentSMTPTestConfig["_id"].toString()
                      : "",
                  ).toString(),
                },
              });
              if (response.isSuccess()) {
                setIsSMTPTestLoading(false);
                setShowSMTPTestModal(false);
                setShowSuccessModal(true);
              }

              if (response instanceof HTTPErrorResponse) {
                throw response;
              }
            } catch (err) {
              setError(API.getFriendlyMessage(err));
              setIsSMTPTestLoading(false);
            }
          }}
        />
      ) : (
        <></>
      )}

      {showSuccessModal ? (
        <ConfirmModal
          title={`Email Sent`}
          error={
            error ===
            "Error connecting to server. Please try again in few minutes."
              ? "Request timed out. Please check your SMTP credentials and make sure they are correct."
              : error
          }
          description={`Email sent successfully. It should take couple of minutes to arrive, please don't forget to check spam.`}
          submitButtonType={ButtonStyleType.NORMAL}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setShowSuccessModal(false);
            setError("");
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default CustomSMTPTable;
