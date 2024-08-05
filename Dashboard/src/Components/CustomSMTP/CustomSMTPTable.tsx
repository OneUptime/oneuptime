import EmptyResponseData from "Common/Types/API/EmptyResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import BasicFormModal from "CommonUI/src/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "CommonUI/src/Components/Modal/ConfirmModal";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import { NOTIFICATION_URL } from "CommonUI/src/Config";
import API from "CommonUI/src/Utils/API/API";
import Navigation from "CommonUI/src/Utils/Navigation";
import ProjectSmtpConfig from "Common/AppModels/Models/ProjectSmtpConfig";
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
            required: true,
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
          },
          {
            field: {
              secure: true,
            },
            title: "Use SSL / TLS",
            stepId: "server-info",
            fieldType: FormFieldSchemaType.Toggle,
            description: "Make email communication secure?",
          },
          {
            field: {
              username: true,
            },
            title: "Username",
            stepId: "authentication",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "emailuser",
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
              "This is the display email your team and customers see, when they receive emails from OneUptime.",
            placeholder: "email@company.com",
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
            type: FieldType.Text,
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
            type: FieldType.Text,
          },
          {
            field: {
              hostname: true,
            },
            title: "Server Host",
            type: FieldType.Text,
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
                | HTTPErrorResponse = await API.post(
                URL.fromString(NOTIFICATION_URL.toString()).addRoute(
                  `/smtp-config/test`,
                ),

                {
                  toEmail: values["toEmail"],
                  smtpConfigId: new ObjectID(
                    currentSMTPTestConfig["_id"]
                      ? currentSMTPTestConfig["_id"].toString()
                      : "",
                  ).toString(),
                },
              );
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
