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
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import {
  EMAIL_PROVIDER_CHOICES,
  PROJECT_SMTP_CONFIG_CREATE_INITIAL_VALUES,
  PROJECT_SMTP_CONFIG_FORM_COLUMNS,
  getProjectSmtpConfigFormFields,
  getProjectSmtpConfigFormSteps,
  withoutValuesTransportIgnores,
} from "Common/UI/Components/SmtpConfig/SmtpConfigFormFields";
import EmailProviderSummary from "./EmailProviderSummary";
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
 * Provider (name, the provider, and the description folded), then the step
 * of the provider picked - an SMTP server's Server (and OAuth, when it signs
 * in with OAuth), Microsoft Graph's OAuth, or Amazon SES's, SendGrid's,
 * Mailgun's, Postmark's or Resend's own - then Sender. Built from the
 * builder the Admin Dashboard's mail server forms share
 * (SmtpConfigFormFields), once.
 */
const SMTP_CONFIG_FORM_STEPS: Array<FormStep<ProjectSmtpConfig>> =
  getProjectSmtpConfigFormSteps();

const SMTP_CONFIG_FORM_FIELDS: Array<ModelField<ProjectSmtpConfig>> =
  getProjectSmtpConfigFormFields();

/*
 * The providers, as the table's filter offers them: by the name people
 * know, read as their cards and the Sends Through cells read them - a
 * product's name as written (isTitleProductName), so "Resend" is never the
 * verb "Reenviar" in a Spanish menu or chip (#7690); "SMTP Server" in the
 * reader's words.
 */
export const EMAIL_PROVIDER_FILTER_OPTIONS: Array<DropdownOption> =
  EMAIL_PROVIDER_CHOICES.map((choice: CardSelectOption): DropdownOption => {
    return {
      label: choice.title,
      value: choice.value,
      isUserContent: choice.isTitleProductName,
    };
  });

export interface ComponentProps {
  /*
   * How many configs the table lists after each load, so the page's folded
   * More settings can say so.
   */
  onCountChange?: ((count: number) => void) | undefined;
}

const CustomSMTPTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
            "Send this project's email through your own mail server, or through Amazon SES, SendGrid, Mailgun, Postmark, Resend or Microsoft Graph. A status page picks one under Subscriber Settings.",
        }}
        formSteps={SMTP_CONFIG_FORM_STEPS}
        name="Settings > Custom SMTP Config"
        formFields={SMTP_CONFIG_FORM_FIELDS}
        // Port 587 to start from: the column has no default.
        createInitialValues={PROJECT_SMTP_CONFIG_CREATE_INITIAL_VALUES}
        /*
         * A config is created without what the form hid once its provider
         * was picked: no hostname, port or password for an API provider or
         * Microsoft Graph, and no key of another provider.
         */
        onBeforeCreate={async (
          item: ProjectSmtpConfig,
        ): Promise<ProjectSmtpConfig> => {
          return withoutValuesTransportIgnores<ProjectSmtpConfig>(
            item,
            PROJECT_SMTP_CONFIG_FORM_COLUMNS,
          );
        }}
        showRefreshButton={true}
        onFetchSuccess={(
          _items: Array<ProjectSmtpConfig>,
          totalCount: number,
        ): void => {
          props.onCountChange?.(totalCount);
        }}
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
          {
            title: "Provider",
            type: FieldType.Dropdown,
            field: {
              transportType: true,
            },
            filterDropdownOptions: EMAIL_PROVIDER_FILTER_OPTIONS,
          },
        ]}
        /*
         * What tells the configs apart at a glance: the name, what mail goes
         * through - an SMTP server's host, or the provider and where it
         * sends from (EmailProviderSummary) - and who it comes from. The
         * sign-in and the description are in the config's Edit dialog.
         */
        selectMoreFields={{
          transportType: true,
          amazonSesRegion: true,
          mailgunDomain: true,
          mailgunRegion: true,
        }}
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
              hostname: true,
            },
            title: "Sends Through",
            type: FieldType.Text,
            getElement: (item: ProjectSmtpConfig): ReactElement => {
              return <EmailProviderSummary config={item} />;
            },
          },
          {
            field: {
              fromEmail: true,
            },
            title: "From Email",
            type: FieldType.Email,
          },
        ]}
      />

      {showSMTPTestModal && currentSMTPTestConfig ? (
        <BasicFormModal
          title={`Send Test Email`}
          description={`Send a test email through this config, to check it works.`}
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
