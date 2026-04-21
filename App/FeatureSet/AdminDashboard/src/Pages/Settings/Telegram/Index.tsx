import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormValues } from "Common/UI/Components/Forms/Types/FormValues";
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

// Telegram bot tokens look like "8012345678:ABCdefGHIjklMNOpqrsTUVwxyz-0987654321".
const TELEGRAM_BOT_TOKEN_PATTERN: RegExp = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;
// Telegram usernames are 5-32 chars, letters/digits/underscores, no leading digit.
const TELEGRAM_BOT_USERNAME_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

const validateBotToken: (
  values: FormValues<GlobalConfig>,
) => string | null = (values: FormValues<GlobalConfig>): string | null => {
  const value: string = String(values.telegramBotToken || "").trim();
  if (!value) {
    return "Bot token is required.";
  }
  if (!TELEGRAM_BOT_TOKEN_PATTERN.test(value)) {
    return "That doesn't look like a Telegram bot token. It should be the value @BotFather gave you — digits, a colon, then ~35 letters/digits (e.g. 123456789:ABCdef...). Don't paste the curl command here.";
  }
  return null;
};

const validateBotUsername: (
  values: FormValues<GlobalConfig>,
) => string | null = (values: FormValues<GlobalConfig>): string | null => {
  const raw: string = String(values.telegramBotUsername || "").trim();
  if (!raw) {
    return "Bot username is required.";
  }
  const value: string = raw.replace(/^@/, "");
  if (!TELEGRAM_BOT_USERNAME_PATTERN.test(value)) {
    return "Enter the bot's Telegram username without the leading @. It must be 5-32 characters, start with a letter, and contain only letters, digits, and underscores.";
  }
  return null;
};

const buildTelegramSetupMarkdown: () => string = (): string => {
  const appApiBaseUrl: string = APP_API_URL.toString().replace(/\/$/, "");
  const webhookUrl: string = `${appApiBaseUrl}/notification/telegram/webhook`;

  return [
    "### What you'll need",
    "- A Telegram account and access to [@BotFather](https://t.me/BotFather).",
    "- Admin access to OneUptime with permission to edit global notification settings.",
    "",
    "### 1. Create a bot and grab its token",
    "1. Open Telegram and chat with [@BotFather](https://t.me/BotFather).",
    "2. Send `/newbot` and follow the prompts. BotFather will return two things:",
    "   - A **bot token** that looks like `8012345678:ABCdefGHIjklMNOpqrsTUVwxyz-0987654321` — this goes into the **Bot Token** field above.",
    "   - A **bot username** ending in `bot` (for example, `OneUptimeAlertsBot`) — this goes into the **Bot Username** field above (without the leading `@`).",
    "3. Pick a strong random string to use as your **Webhook Secret Token** and paste it into the third field. OneUptime sends this back to itself via `X-Telegram-Bot-Api-Secret-Token` so spoofed webhook calls get rejected.",
    "4. Save the form.",
    "",
    "### 2. Register the webhook with Telegram",
    "Run this command in a terminal (replace `<BOT_TOKEN>` and `<SECRET>` with the values you just saved). **Do not paste this command back into the form above — it belongs in your shell.**",
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
    "Confirm the webhook is live with `curl https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo` — the `url` field should match the value above.",
    "",
    "### 3. Test end-to-end",
    "1. Use the **Send Test Telegram Message** card below to confirm your bot can reach a chat. You can get your own chat ID by sending any message to [@userinfobot](https://t.me/userinfobot).",
    "2. Ask users to open **User Settings → Notification Methods → Telegram** in the OneUptime dashboard. They'll scan a QR (or tap a deep link) to send `/start <code>` to your bot — that's how we capture their chat ID and mark the account verified.",
    "3. Once verified, users can toggle Telegram in **Notification Settings** and include Telegram in any on-call notification rule.",
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
      <Card
        title="Telegram Setup Guide"
        description="Read this first — it's the quickest path from zero to a working Telegram bot hooked up to OneUptime."
      >
        <MarkdownViewer text={telegramSetupMarkdown} />
      </Card>

      <CardModelDetail
        name="Telegram Bot Settings"
        cardProps={{
          title: "Telegram Bot Settings",
          description:
            "Paste the bot token and username @BotFather gave you. These power outbound notifications; the secret token guards the incoming webhook.",
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
              "The bot token @BotFather sent you — starts with digits, then a colon, then ~35 letters/digits. Not a URL, not a curl command.",
            placeholder: "8012345678:ABCdefGHIjklMNOpqrsTUVwxyz-0987654321",
            validation: {
              minLength: 20,
              maxLength: 200,
              noSpaces: true,
            },
            customValidation: validateBotToken,
          },
          {
            field: {
              telegramBotUsername: true,
            },
            title: "Bot Username",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description:
              "Your bot's Telegram username, without the leading @. Telegram usernames end in 'bot'.",
            placeholder: "OneUptimeAlertsBot",
            validation: {
              minLength: 5,
              maxLength: 32,
              noSpaces: true,
            },
            customValidation: validateBotUsername,
          },
          {
            field: {
              telegramWebhookSecretToken: true,
            },
            title: "Webhook Secret Token",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: false,
            description:
              "Any strong random string. OneUptime rejects webhook calls whose X-Telegram-Bot-Api-Secret-Token header does not match this value.",
            placeholder: "e.g. a 32+ char random string",
            validation: {
              maxLength: 100,
              noSpaces: true,
            },
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
    </Page>
  );
};

export default SettingsTelegram;
