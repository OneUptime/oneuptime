import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";

const buildTelegramSetupMarkdown: () => string = (): string => {
  const appApiBaseUrl: string = APP_API_URL.toString().replace(/\/$/, "");
  const webhookUrl: string = `${appApiBaseUrl}/notification/telegram/webhook`;

  return [
    "Follow these steps to connect a Telegram bot with OneUptime so notifications can be delivered via Telegram.",
    "",
    "### Prerequisites",
    "- A Telegram account.",
    "- Ability to chat with [@BotFather](https://t.me/BotFather) on Telegram.",
    "- Admin access to OneUptime with permission to edit global notification settings.",
    "",
    "### Setup Steps",
    "1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather).",
    "2. Send `/newbot` and follow the prompts to create a new bot. BotFather will return a **bot token** (something like `123456:ABC-DEF...`) and the bot's **username**.",
    "3. Paste the **bot token** and **bot username** (without the leading `@`) into the **Telegram Bot Settings** card above. Save the form.",
    "4. Pick a strong random string to use as a **Webhook Secret Token** and enter it in the form as well. This value will be sent back to OneUptime in the `X-Telegram-Bot-Api-Secret-Token` header so we can reject spoofed webhook calls.",
    "5. Register the webhook with Telegram. Run the following (replace `<BOT_TOKEN>` and `<SECRET>` with the values you just saved):",
    "",
    "```bash",
    `curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \\`,
    '  -H "Content-Type: application/json" \\',
    "  -d '{",
    `    "url": "${webhookUrl}",`,
    '    "secret_token": "<SECRET>",',
    '    "allowed_updates": ["message"]',
    "  }'",
    "```",
    "",
    "6. Confirm the webhook is live with `curl https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo`. The `url` field should match the value above.",
    "7. Ask users to open **User Settings → Notification Methods → Telegram** in the OneUptime dashboard. They'll scan a QR (or tap a deep link) to send `/start <code>` to your bot — that's how we capture their chat ID and mark the account verified.",
    "8. Once verified, users can toggle Telegram in **Notification Settings** and include Telegram in any on-call notification rule.",
    "",
    "### Webhook endpoint",
    `- \`${webhookUrl}\``,
    "",
    "This endpoint only reacts to `/start <code>` messages from users. Every other update is ignored.",
  ].join("\n");
};

const telegramSetupMarkdown: string = buildTelegramSetupMarkdown();

const SettingsTelegram: FunctionComponent = (): ReactElement => {
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [testError, setTestError] = useState<string>("");
  const [testSuccess, setTestSuccess] = useState<string>("");

  return (
    <Page
      title={"Admin Settings"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: "Telegram",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_TELEGRAM] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <CardModelDetail
        name="Telegram Bot Settings"
        cardProps={{
          title: "Telegram Bot Settings",
          description:
            "Configure the Telegram bot credentials. These values are used to send Telegram notifications and to verify incoming webhook calls.",
        }}
        isEditable={true}
        editButtonText="Edit Telegram Config"
        formFields={[
          {
            field: {
              telegramBotToken: true,
            },
            title: "Bot Token",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: true,
            description:
              "Bot token issued by @BotFather when you created the bot.",
            placeholder: "123456:ABC-DEF...",
          },
          {
            field: {
              telegramBotUsername: true,
            },
            title: "Bot Username",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description:
              "Your bot's Telegram username (without the leading @). Used to build verification deep links users click from the dashboard.",
            placeholder: "OneUptimeAlertsBot",
          },
          {
            field: {
              telegramWebhookSecretToken: true,
            },
            title: "Webhook Secret Token",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: false,
            description:
              "Secret string passed to Telegram `setWebhook`. Telegram echoes it back on each call via the X-Telegram-Bot-Api-Secret-Token header.",
            placeholder: "A strong random string",
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config-telegram",
          fields: [
            {
              field: {
                telegramBotToken: true,
              },
              title: "Bot Token",
              fieldType: FieldType.HiddenText,
              placeholder: "Not Configured",
            },
            {
              field: {
                telegramBotUsername: true,
              },
              title: "Bot Username",
              fieldType: FieldType.Text,
              placeholder: "Not Configured",
            },
            {
              field: {
                telegramWebhookSecretToken: true,
              },
              title: "Webhook Secret Token",
              fieldType: FieldType.HiddenText,
              placeholder: "Not Configured",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      <Card
        title="Send Test Telegram Message"
        description="Send a test Telegram message to confirm your bot configuration."
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
          id="send-test-telegram-form"
          name="Send Test Telegram Message"
          isLoading={isSendingTest}
          error={testError || ""}
          submitButtonText="Send Test Message"
          maxPrimaryButtonWidth={true}
          initialValues={{
            toChatId: "",
          }}
          fields={[
            {
              field: {
                toChatId: true,
              },
              title: "Recipient Telegram Chat ID",
              description:
                "The numeric chat ID of the recipient. A user can get their own chat ID by sending any message to @userinfobot on Telegram.",
              placeholder: "123456789",
              required: true,
              fieldType: FormFieldSchemaType.Text,
              disableSpellCheck: true,
            },
          ]}
          onSubmit={async (
            values: JSONObject,
            onSubmitSuccessful?: () => void,
          ) => {
            const toChatId: string = String(values["toChatId"] || "").trim();

            if (!toChatId) {
              setTestSuccess("");
              setTestError(
                "Please enter a Telegram chat ID before sending a test message.",
              );
              return;
            }

            setIsSendingTest(true);
            setTestError("");
            setTestSuccess("");

            try {
              const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                await API.post({
                  url: URL.fromString(APP_API_URL.toString()).addRoute(
                    "/notification/telegram/test",
                  ),
                  data: {
                    toChatId,
                  },
                });

              if (response instanceof HTTPErrorResponse) {
                throw response;
              }

              if (response.isFailure()) {
                throw new Error("Failed to send test Telegram message.");
              }

              setTestSuccess(
                "Test Telegram message sent successfully. Check the recipient device to confirm delivery.",
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
        title="Telegram Setup Guide"
        description="Steps to connect a Telegram bot and register the webhook."
      >
        <MarkdownViewer text={telegramSetupMarkdown} />
      </Card>
    </Page>
  );
};

export default SettingsTelegram;
