import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import MoreSideMenu from "./SideMenu";
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
import Modal from "Common/UI/Components/Modal/Modal";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";

const MoreEmail: FunctionComponent = (): ReactElement => {
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [isSendingAll, setIsSendingAll] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const [testEmail, setTestEmail] = useState<string>("");
  const [testError, setTestError] = useState<string>("");
  const [testSuccess, setTestSuccess] = useState<string>("");
  const [pendingSubject, setPendingSubject] = useState<string>("");
  const [pendingMessage, setPendingMessage] = useState<string>("");
  const [currentFormValues, setCurrentFormValues] = useState<JSONObject>({
    subject: "",
    message: "",
  });

  const sendTestEmail: () => Promise<void> = async (): Promise<void> => {
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
            subject: pendingSubject,
            message: pendingMessage,
            testEmail: testEmail,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      if (response.isFailure()) {
        throw new Error("Failed to send test email.");
      }

      setTestSuccess("Test email sent successfully. Please check your inbox.");
    } catch (err) {
      setTestError(API.getFriendlyMessage(err));
    } finally {
      setIsSendingTest(false);
    }
  };

  const sendToAllUsers: () => Promise<void> = async (): Promise<void> => {
    setIsSendingAll(true);
    setError("");
    setSuccess("");

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
        throw new Error("Failed to send emails.");
      }

      const data: JSONObject = response.data as JSONObject;
      setSuccess(
        `Emails sent successfully. Total users: ${data["totalUsers"]}, Sent: ${data["sentCount"]}, Errors: ${data["errorCount"]}`,
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
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
          title: "More",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.MORE_EMAIL] as Route,
          ),
        },
        {
          title: "Send Email",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.MORE_EMAIL] as Route,
          ),
        },
      ]}
      sideMenu={<MoreSideMenu />}
    >
      <Card
        title="Send Announcement Email"
        description="Compose an announcement email to send to all registered users. You can send a test email first to preview how it looks."
      >
        {success ? (
          <Alert
            type={AlertType.SUCCESS}
            title={success}
            className="mb-4"
          />
        ) : (
          <></>
        )}

        <BasicForm
          id="send-email-form"
          name="Send Announcement Email"
          isLoading={isSendingAll}
          error={error || ""}
          hideSubmitButton={true}
          onChange={(values: JSONObject) => {
            setCurrentFormValues(values as JSONObject);
          }}
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
                "The body of the announcement email. This will be displayed in a branded OneUptime email template.",
              placeholder: "Enter your announcement message here...",
              required: true,
              fieldType: FormFieldSchemaType.LongText,
            },
          ]}
          onSubmit={async () => {}}
          footer={
            <div className="flex w-full justify-end mt-3 space-x-3">
              <Button
                title="Send Test Email"
                buttonStyle={ButtonStyleType.NORMAL}
                onClick={() => {
                  const subject: string = String(
                    currentFormValues["subject"] || "",
                  ).trim();
                  const message: string = String(
                    currentFormValues["message"] || "",
                  ).trim();

                  if (!subject || !message) {
                    setError(
                      "Please fill in subject and message before sending a test.",
                    );
                    return;
                  }

                  setError("");
                  setPendingSubject(subject);
                  setPendingMessage(message);
                  setTestEmail("");
                  setTestError("");
                  setTestSuccess("");
                  setShowTestModal(true);
                }}
              />
              <Button
                title="Send to All Users"
                buttonStyle={ButtonStyleType.PRIMARY}
                isLoading={isSendingAll}
                onClick={() => {
                  const subject: string = String(
                    currentFormValues["subject"] || "",
                  ).trim();
                  const message: string = String(
                    currentFormValues["message"] || "",
                  ).trim();

                  if (!subject || !message) {
                    setSuccess("");
                    setError("Please fill in all fields.");
                    return;
                  }

                  setError("");
                  setPendingSubject(subject);
                  setPendingMessage(message);
                  setShowConfirmModal(true);
                }}
              />
            </div>
          }
        />
      </Card>

      {showTestModal ? (
        <Modal
          title="Send Test Email"
          description="Enter an email address to send a test of this announcement."
          onClose={() => {
            setShowTestModal(false);
          }}
          submitButtonText="Send Test"
          isLoading={isSendingTest}
          onSubmit={() => {
            if (!testEmail.trim()) {
              setTestError("Please enter a test email address.");
              return;
            }
            sendTestEmail().catch(() => {});
          }}
          error={testError}
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
          <div className="mb-4">
            <label
              htmlFor="test-email-input"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Test Email Address
            </label>
            <input
              id="test-email-input"
              type="email"
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              placeholder="test@example.com"
              value={testEmail}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setTestEmail(e.target.value);
              }}
            />
          </div>
        </Modal>
      ) : (
        <></>
      )}

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

export default MoreEmail;
