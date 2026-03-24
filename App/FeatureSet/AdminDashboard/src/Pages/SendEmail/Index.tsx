import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement, useState } from "react";
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
            "/notification/broadcast-email/send-to-all-users",
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
        throw new Error("Failed to send emails.");
      }

      const data: JSONObject = response.data as JSONObject;
      setSendAllSuccess(
        `Emails sent successfully. Total users: ${data["totalUsers"]}, Sent: ${data["sentCount"]}, Errors: ${data["errorCount"]}`,
      );
    } catch (err) {
      setSendAllError(API.getFriendlyMessage(err));
    } finally {
      setIsSendingAll(false);
    }
  };

  return (
    <Page
      title={"Send Announcement Email"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Send Email",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SEND_EMAIL] as Route,
          ),
        },
      ]}
    >
      <Card
        title="Send Test Email"
        description="Send a test announcement email to a single email address to preview how it looks before sending to all users."
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
          submitButtonText="Send Test Email"
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
                "The body of the announcement email. This will be displayed in a branded OneUptime email template.",
              placeholder: "Enter your announcement message here...",
              required: true,
              fieldType: FormFieldSchemaType.LongText,
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
              setTestError("Please fill in all fields.");
              return;
            }

            setIsSendingTest(true);
            setTestError("");
            setTestSuccess("");

            try {
              const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.post({
                  url: URL.fromString(APP_API_URL.toString()).addRoute(
                    "/notification/broadcast-email/send-test",
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
                throw new Error("Failed to send test email.");
              }

              setTestSuccess(
                "Test email sent successfully. Please check your inbox.",
              );

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
        title="Send Email to All Users"
        description="Send an announcement email to all registered users. Please send a test email first to verify the content."
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
          submitButtonText="Send to All Users"
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
                "The body of the announcement email. This will be sent to all registered users.",
              placeholder: "Enter your announcement message here...",
              required: true,
              fieldType: FormFieldSchemaType.LongText,
            },
          ]}
          onSubmit={async (values: JSONObject) => {
            const subject: string = String(values["subject"] || "").trim();
            const message: string = String(values["message"] || "").trim();

            if (!subject || !message) {
              setSendAllSuccess("");
              setSendAllError("Please fill in all fields.");
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
          title="Confirm Send to All Users"
          description="Are you sure you want to send this announcement email to all registered users? This action cannot be undone."
          submitButtonText="Yes, Send to All Users"
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
