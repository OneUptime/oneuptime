import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import MoreSideMenu from "./SideMenu";
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
import Modal from "Common/UI/Components/Modal/Modal";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";

const MoreEmail: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
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
        throw new Error(t("pages.moreEmail.testFailure"));
      }

      setTestSuccess(t("pages.moreEmail.testSuccess"));
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
        throw new Error(t("pages.moreEmail.allFailure"));
      }

      setSuccess(t("pages.moreEmail.allSuccess"));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSendingAll(false);
    }
  };

  return (
    <Page
      title={t("pages.moreEmail.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.more"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.MORE_EMAIL] as Route,
          ),
        },
        {
          title: t("breadcrumbs.sendEmail"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.MORE_EMAIL] as Route,
          ),
        },
      ]}
      sideMenu={<MoreSideMenu />}
    >
      <Card
        title={t("pages.moreEmail.cardTitle")}
        description={t("pages.moreEmail.cardDescription")}
      >
        {success ? (
          <Alert type={AlertType.SUCCESS} title={success} className="mb-4" />
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
                "The body of the announcement email. This will be displayed in a branded OneUptime email template. You can use Markdown formatting.",
              placeholder: "Enter your announcement message here...",
              required: true,
              fieldType: FormFieldSchemaType.Markdown,
            },
          ]}
          onSubmit={async () => {}}
          footer={
            <div className="flex w-full justify-end mt-3 space-x-3">
              <Button
                title={t("pages.moreEmail.sendTestButton")}
                buttonStyle={ButtonStyleType.NORMAL}
                onClick={() => {
                  const subject: string = String(
                    currentFormValues["subject"] || "",
                  ).trim();
                  const message: string = String(
                    currentFormValues["message"] || "",
                  ).trim();

                  if (!subject || !message) {
                    setError(t("pages.moreEmail.fillSubjectMessage"));
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
                title={t("pages.moreEmail.sendAllButton")}
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
                    setError(t("pages.moreEmail.fillAllFields"));
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
          title={t("pages.moreEmail.testModalTitle")}
          description={t("pages.moreEmail.testModalDescription")}
          onClose={() => {
            setShowTestModal(false);
          }}
          submitButtonText={t("pages.moreEmail.testModalSubmitButton")}
          isLoading={isSendingTest}
          onSubmit={() => {
            if (!testEmail.trim()) {
              setTestError(t("pages.moreEmail.testModalMissingEmail"));
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
              {t("pages.moreEmail.testModalEmailLabel")}
            </label>
            <input
              id="test-email-input"
              type="email"
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              placeholder={t("pages.moreEmail.testModalEmailPlaceholder")}
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
          title={t("pages.moreEmail.confirmTitle")}
          description={t("pages.moreEmail.confirmDescription")}
          submitButtonText={t("pages.moreEmail.confirmButton")}
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
