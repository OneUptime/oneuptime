import EmptyResponseData from "Common/Types/API/EmptyResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import {
  PROJECT_SMTP_CONFIG_CREATE_INITIAL_VALUES,
  PROJECT_SMTP_CONFIG_FORM_COLUMNS,
  getProjectSmtpConfigFormFields,
  getSmtpConfigFormSteps,
  withoutValuesGraphIgnores,
} from "Common/UI/Components/SmtpConfig/SmtpConfigFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import { NOTIFICATION_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import UserUtil from "Common/UI/Utils/User";
import {
  getTestSendLock,
  TestSendLock,
  TestSendTargets,
} from "../TestSend/TestSendLock";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Server (name, hostname, port, username, password, and a folded Advanced
 * section with the transport, TLS, sign-in type, OAuth and description),
 * then Sender. Built with the Admin Dashboard's instance mail server form
 * from one builder (SmtpConfigFormFields), once.
 */
const SMTP_CONFIG_FORM_STEPS: Array<FormStep<ProjectSmtpConfig>> =
  getSmtpConfigFormSteps<ProjectSmtpConfig>();

const SMTP_CONFIG_FORM_FIELDS: Array<ModelField<ProjectSmtpConfig>> =
  getProjectSmtpConfigFormFields();

const CustomSMTPTable: FunctionComponent = (): ReactElement => {
  const [showSMTPTestModal, setShowSMTPTestModal] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [currentSMTPTestConfig, setCurrentSMTPTestConfig] =
    useState<ProjectSmtpConfig | null>(null);
  const [isSMTPTestLoading, setIsSMTPTestLoading] = useState<boolean>(false);

  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);

  // Locked, saying why, for someone who may not send a test (TestSendLock).
  const testEmailLock: TestSendLock = getTestSendLock(
    TestSendTargets.SmtpConfig,
  );

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
            disabled: testEmailLock.isLocked,
            tooltip: testEmailLock.tooltip,
            /*
             * The row's own button, so a config is one click from being
             * tried the moment it is saved: Edit and Delete wait in the menu.
             */
            placement: ActionButtonPlacement.Primary,
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
        formSteps={SMTP_CONFIG_FORM_STEPS}
        name="Settings > Custom SMTP Config"
        noItemsMessage={"No SMTP Server Configs found."}
        formFields={SMTP_CONFIG_FORM_FIELDS}
        // Port 587 to start from: the column has no default.
        createInitialValues={PROJECT_SMTP_CONFIG_CREATE_INITIAL_VALUES}
        /*
         * A Microsoft Graph config is created without the hostname, port,
         * username and password the form hid once Graph was picked.
         */
        onBeforeCreate={async (
          item: ProjectSmtpConfig,
        ): Promise<ProjectSmtpConfig> => {
          return withoutValuesGraphIgnores<ProjectSmtpConfig>(
            item,
            PROJECT_SMTP_CONFIG_FORM_COLUMNS,
          );
        }}
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
              transportType: true,
            },
            title: "Transport",
            type: FieldType.Text,
            noValueMessage: "SMTP",
          },
          {
            field: {
              hostname: true,
            },
            title: "Server Host",
            type: FieldType.Text,
            noValueMessage: "-",
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
                // Your own inbox to start with: change it to try another.
                defaultValue: UserUtil.getEmail()?.toString() || undefined,
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
                /*
                 * `/smtp-config/test` is a custom route, so it is reached with
                 * a raw API.post rather than ModelAPI - and BaseAPI.getHeaders()
                 * does not add a `tenantid` header. ModelAPI.getCommonHeaders()
                 * is the only thing in the codebase that does.
                 *
                 * Without it the server has no project to scope the request to,
                 * and the route's CommonAPI.assertAuthenticatedProjectMember
                 * guard answers every click with "Project ID is required".
                 */
                headers: ModelAPI.getCommonHeaders(),
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
