import ProjectUtil from "Common/UI/Utils/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import User from "Common/UI/Utils/User";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import React, { ReactElement, useState } from "react";
import OneUptimeDate from "Common/Types/Date";

const Webhook: () => JSX.Element = (): ReactElement => {
  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const [testError, setTestError] = useState<string>("");
  const [testMessage, setTestMessage] = useState<string>("");
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [currentItem, setCurrentItem] = useState<UserWebhook | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  const sendTest: (item: UserWebhook) => Promise<void> = async (
    item: UserWebhook,
  ): Promise<void> => {
    setIsTesting(true);
    setTestError("");
    setTestMessage("");
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/user-webhook/test",
          ),
          data: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            itemId: item["_id"],
          },
        });

      if (response.isFailure()) {
        setTestError(API.getFriendlyMessage(response));
      } else {
        const data: JSONObject = response.data as JSONObject;
        const statusCode: number | undefined = data["responseStatusCode"] as
          | number
          | undefined;
        const statusMessage: string =
          (data["statusMessage"] as string) ||
          "Test webhook sent successfully.";
        setTestMessage(
          statusCode ? `${statusMessage} (HTTP ${statusCode})` : statusMessage,
        );
      }
    } catch (err) {
      setTestError(API.getFriendlyMessage(err));
    }
    setIsTesting(false);
  };

  return (
    <>
      <ModelTable<UserWebhook>
        modelType={UserWebhook}
        userPreferencesKey={"user-webhook-table"}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId().toString(),
        }}
        refreshToggle={refreshToggle}
        onBeforeCreate={(model: UserWebhook): Promise<UserWebhook> => {
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.userId = User.getUserId();
          return Promise.resolve(model);
        }}
        createVerb={"Add"}
        actionButtons={[
          {
            title: "Send Test",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Play,
            onClick: async (
              item: UserWebhook,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentItem(item);
                setShowTestModal(true);
                await sendTest(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        id="user-webhook"
        name="User Settings > Notification Methods > Webhooks"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Webhooks for Notifications",
          description:
            "Send incoming OneUptime notifications to your own HTTPS endpoints as JSON POST requests.",
        }}
        noItemsMessage={
          "No webhooks added yet. Add one to receive notifications as HTTP POST requests."
        }
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "My internal alerts",
            description: "A label so you can recognize this webhook later.",
            validation: {
              minLength: 1,
            },
          },
          {
            field: {
              webhookUrl: true,
            },
            title: "Webhook URL",
            fieldType: FormFieldSchemaType.URL,
            required: true,
            placeholder: "https://example.com/oneuptime/hook",
            description:
              "HTTPS endpoint that will receive POST requests with a JSON payload. Private, loopback, and link-local addresses are not allowed.",
          },
          {
            field: {
              secret: true,
            },
            title: "Signing Secret (optional)",
            fieldType: FormFieldSchemaType.Password,
            required: false,
            placeholder: "shared secret",
            description:
              "If set, each request will include an HMAC-SHA256 signature in the X-OneUptime-Signature header (sha256=<hex>) computed over the raw JSON body.",
          },
        ]}
        showRefreshButton={true}
        filters={[]}
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
              webhookUrl: true,
            },
            title: "URL",
            type: FieldType.Text,
          },
        ]}
      />

      {showTestModal && currentItem ? (
        <ConfirmModal
          title={"Webhook Test"}
          error={testError}
          description={
            isTesting
              ? "Sending test request…"
              : testMessage ||
                "Sending a test event to your webhook URL. Check your endpoint logs for receipt."
          }
          submitButtonText={"Close"}
          isLoading={isTesting}
          onSubmit={async () => {
            setShowTestModal(false);
            setTestError("");
            setTestMessage("");
            setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
          }}
        />
      ) : null}
    </>
  );
};

export default Webhook;
