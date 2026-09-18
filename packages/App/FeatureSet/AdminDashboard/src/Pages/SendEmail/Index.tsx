import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import Page from "Common/UI/Components/Page/Page";
import Card from "Common/UI/Components/Card/Card";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";

const SendEmail: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [isSendingAll, setIsSendingAll] = useState<boolean>(false);
  const [testError, setTestError] = useState<string>("");
  const [testSuccess, setTestSuccess] = useState<string>("");
  const [sendAllError, setSendAllError] = useState<string>("");
  const [sendAllSuccess, setSendAllSuccess] = useState<string>("");
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [pendingSubject, setPendingSubject] = useState<string>("");
  const [pendingMessage, setPendingMessage] = useState<string>("");

  const sendToAllUsers: () => Promise<void> = async (): Promise<void> => {
    setIsSendingAll(true);
    setSendAllError("");
    setSendAllSuccess("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/email/send-to-all-users",
          ),
          data: {
            subject: pendingSubject,
            message: pendingMessage,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      if (response.isFailure()) {
        throw new Error(t("pages.sendEmail.allFailure"));
      }

      setSendAllSuccess(t("pages.sendEmail.allSuccess"));
    } catch (err) {
      setSendAllError(API.getFriendlyMessage(err));
    } finally {
      setIsSendingAll(false);
    }
  };

  return (
    <Page
      title={t("pages.sendEmail.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.sendEmail"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SEND_EMAIL] as Route,
          ),
        },
      ]}
    >
      <Card
        title={t("pages.sendEmail.testCardTitle")}
        description={t("pages.sendEmail.testCardDescription")}
      >
        {testSuccess ? (
          <Alert
            type={AlertType.SUCCESS}
            title={testSuccess}
            className="mb-4"
          />
        ) : (
          <></>
        )}

        <BasicForm
          id="send-test-email-form"
          name="Send Test Announcement Email"
          isLoading={isSendingTest}
          error={testError || ""}
          submitButtonText={t("pages.sendEmail.testSubmitButton")}
          maxPrimaryButtonWidth={true}
          initialValues={{
            subject: "",
            message: "",
            testEmail: "",
          }}
          fields={[
            {
              field: {
                subject: true,
              },
              title: "Subject",
              description: "The subject line of the announcement email.",
              placeholder: "Enter email subject",
              required: true,
              fieldType: FormFieldSchemaType.Text,
            },
            {
              field: {
                message: true,
              },
              title: "Message",
              description:
                "The body of the announcement email. This will be displayed in a branded OneUptime email template. You can use Markdown formatting.",
              placeholder: "Enter your announcement message here...",
              required: true,
              fieldType: FormFieldSchemaType.Markdown,
            },
            {
              field: {
                testEmail: true,
              },
              title: "Test Email Address",
              description:
                "The email address where the test email will be sent.",
              placeholder: "test@example.com",
              required: true,
              fieldType: FormFieldSchemaType.Email,
              disableSpellCheck: true,
            },
          ]}
          onSubmit={async (
            values: JSONObject,
            onSubmitSuccessful?: () => void,
          ) => {
            const subject: string = String(values["subject"] || "").trim();
            const message: string = String(values["message"] || "").trim();
            const testEmail: string = String(values["testEmail"] || "").trim();

            if (!subject || !message || !testEmail) {
              setTestSuccess("");
              setTestError(t("pages.sendEmail.fillAllFields"));
              return;
            }

            setIsSendingTest(true);
            setTestError("");
            setTestSuccess("");

            try {
              const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.post({
                  url: URL.fromString(APP_API_URL.toString()).addRoute(
                    "/admin/email/send-test",
                  ),
                  data: {
                    subject,
                    message,
                    testEmail,
                  },
                });

              if (response instanceof HTTPErrorResponse) {
                throw response;
              }

              if (response.isFailure()) {
                throw new Error(t("pages.sendEmail.testFailure"));
              }

              setTestSuccess(t("pages.sendEmail.testSuccess"));

              if (onSubmitSuccessful) {
                onSubmitSuccessful();
              }
            } catch (err) {
              setTestError(API.getFriendlyMessage(err));
            } finally {
              setIsSendingTest(false);
            }
          }}
        />
      </Card>

      <Card
        title={t("pages.sendEmail.allCardTitle")}
        description={t("pages.sendEmail.allCardDescription")}
      >
        {sendAllSuccess ? (
          <Alert
            type={AlertType.SUCCESS}
            title={sendAllSuccess}
            className="mb-4"
          />
        ) : (
          <></>
        )}

        <BasicForm
          id="send-all-email-form"
          name="Send Announcement to All Users"
          isLoading={isSendingAll}
          error={sendAllError || ""}
          submitButtonText={t("pages.sendEmail.allSubmitButton")}
          maxPrimaryButtonWidth={true}
          initialValues={{
            subject: "",
            message: "",
          }}
          fields={[
            {
              field: {
                subject: true,
              },
              title: "Subject",
              description: "The subject line of the announcement email.",
              placeholder: "Enter email subject",
              required: true,
              fieldType: FormFieldSchemaType.Text,
            },
            {
              field: {
                message: true,
              },
              title: "Message",
              description:
                "The body of the announcement email. This will be sent to all registered users. You can use Markdown formatting.",
              placeholder: "Enter your announcement message here...",
              required: true,
              fieldType: FormFieldSchemaType.Markdown,
            },
          ]}
          onSubmit={async (values: JSONObject) => {
            const subject: string = String(values["subject"] || "").trim();
            const message: string = String(values["message"] || "").trim();

            if (!subject || !message) {
              setSendAllSuccess("");
              setSendAllError(t("pages.sendEmail.fillAllFields"));
              return;
            }

            setPendingSubject(subject);
            setPendingMessage(message);
            setShowConfirmModal(true);
          }}
        />
      </Card>

      {showConfirmModal ? (
        <ConfirmModal
          title={t("pages.sendEmail.confirmTitle")}
          description={t("pages.sendEmail.confirmDescription")}
          submitButtonText={t("pages.sendEmail.confirmButton")}
          onSubmit={async () => {
            setShowConfirmModal(false);
            await sendToAllUsers();
          }}
          onClose={() => {
            setShowConfirmModal(false);
          }}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default SendEmail;
