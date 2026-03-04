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
import WhatsAppTemplateMessages, {
  WhatsAppTemplateId,
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
} from "Common/Types/WhatsApp/WhatsAppTemplates";

type ToFriendlyName = (value: string) => string;

const toFriendlyName: ToFriendlyName = (value: string): string => {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

type ExtractTemplateVariables = (template: string) => Array<string>;

const extractTemplateVariables: ExtractTemplateVariables = (
  template: string,
): Array<string> => {
  const matches: RegExpMatchArray | null = template.match(/\{\{(.*?)\}\}/g);

  if (!matches) {
    return [];
  }

  const uniqueVariables: Set<string> = new Set<string>();

  for (const match of matches) {
    const variable: string = match.replace("{{", "").replace("}}", "").trim();

    if (variable) {
      uniqueVariables.add(variable);
    }
  }

  return Array.from(uniqueVariables).sort((a: string, b: string) => {
    return a.localeCompare(b);
  });
};

type BuildWhatsAppSetupMarkdown = () => string;

const buildWhatsAppSetupMarkdown: BuildWhatsAppSetupMarkdown = (): string => {
  const templateKeys: Array<keyof typeof WhatsAppTemplateIds> = Object.keys(
    WhatsAppTemplateIds,
  ) as Array<keyof typeof WhatsAppTemplateIds>;

  const appApiBaseUrl: string = APP_API_URL.toString().replace(/\/$/, "");
  const primaryWebhookUrl: string = `${appApiBaseUrl}/notification/whatsapp/webhook`;

  const description: string =
    "Follow these steps to connect Meta WhatsApp with OneUptime so notifications can be delivered via WhatsApp.";

  const prerequisitesList: Array<string> = [
    "Meta Business Manager admin access for the WhatsApp Business Account.",
    "A WhatsApp Business phone number approved for API messaging.",
    "Admin access to OneUptime with permission to edit global notification settings.",
    "A webhook verify token string that you'll configure identically in Meta and OneUptime.",
  ];

  const setupStepsList: Array<string> = [
    "Sign in to the [Meta Business Manager](https://business.facebook.com/) with admin access to your WhatsApp Business Account.",
    "From **Business Settings → Accounts → WhatsApp Accounts**, create or select the account that owns your sender phone number.",
    "In Buisness Portfolio, create a system user and assign it to the WhatsApp Business Account with the role of **Admin**.",
    "Generate a token for this system user and this will be your long-lived access token. Make sure to select the **whatsapp_business_management** and **whatsapp_business_messaging** permissions when generating the token.",
    "Paste the access token, phone number ID, and webhook verify token into the **Meta WhatsApp Settings** card above, then save.",
    "For the **Business Account ID**, go to **Business Settings → Business Info** (or **Business Settings → WhatsApp Accounts → Settings**) and copy the **WhatsApp Business Account ID** value.",
    "To locate the **App ID** and **App Secret**, open [Meta for Developers](https://developers.facebook.com/apps/), select your WhatsApp app, then navigate to **Settings → Basic**. The App ID is shown at the top; click **Show** next to **App Secret** to reveal and copy it.",
    "Create each template listed below in the Meta WhatsApp Manager. Make sure the template name, language, and variables match exactly. You can however change the content to your preference. Please make sure it's approved by Meta.",
    "Send a test notification from OneUptime to confirm that WhatsApp delivery succeeds.",
  ];

  const prerequisitesMarkdown: string = prerequisitesList
    .map((item: string) => {
      return `- ${item}`;
    })
    .join("\n");

  const setupStepsMarkdown: string = setupStepsList
    .map((item: string, index: number) => {
      return `${index + 1}. ${item}`;
    })
    .join("\n");

  const tableRows: string = templateKeys
    .map((enumKey: keyof typeof WhatsAppTemplateIds) => {
      const templateId: WhatsAppTemplateId = WhatsAppTemplateIds[enumKey];
      const friendlyName: string = toFriendlyName(enumKey.toString());
      const templateMessage: string = WhatsAppTemplateMessages[templateId];
      const language: string = WhatsAppTemplateLanguage[templateId] || "en";
      const variables: Array<string> =
        extractTemplateVariables(templateMessage);
      const variableList: string =
        variables.length > 0
          ? variables
              .map((variable: string) => {
                return `\`${variable}\``;
              })
              .join(", ")
          : "_None_";

      return `| ${friendlyName} | \`${templateId}\` | ${language} | ${variableList} |`;
    })
    .join("\n");

  const templateBodies: string = templateKeys
    .map((enumKey: keyof typeof WhatsAppTemplateIds) => {
      const templateId: WhatsAppTemplateId = WhatsAppTemplateIds[enumKey];
      const friendlyName: string = toFriendlyName(enumKey.toString());
      const templateMessage: string = WhatsAppTemplateMessages[templateId];
      const language: string = WhatsAppTemplateLanguage[templateId] || "en";
      const variables: Array<string> =
        extractTemplateVariables(templateMessage);
      const variableMarkdown: string =
        variables.length > 0
          ? variables
              .map((variable: string) => {
                return `- \`${variable}\``;
              })
              .join("\n")
          : "_None_";
      const variablesHeading: string = variables.length
        ? `**Variables (${variables.length})**`
        : "**Variables**";

      return [
        `#### ${friendlyName}`,
        "",
        `**Template Name:** \`${templateId}\``,
        `**Language:** ${language}`,
        "",
        variablesHeading,
        variableMarkdown,
        "",
        "**Body**",
        "```plaintext",
        templateMessage,
        "```",
        "",
        "---",
      ].join("\n");
    })
    .join("\n\n");

  const templateSummaryTable: string = [
    "| Friendly Name | Template Name | Language | Variables |",
    "| --- | --- | --- | --- |",
    tableRows,
  ]
    .filter(Boolean)
    .join("\n");

  const webhookSection: string = [
    "### Configure Meta Webhook Subscription",
    "1. In the OneUptime Admin Dashboard, open **Settings → WhatsApp → Meta WhatsApp Settings** and enter a strong value in **Webhook Verify Token**. Save the form so the encrypted token is stored in Global Config.",
    "2. Keep that verify token handy-Meta does not generate one for you. You'll paste the exact same value when configuring the callback.",
    "3. In [Meta for Developers](https://developers.facebook.com/apps/), select your WhatsApp app and navigate to **WhatsApp → Configuration → Webhooks**.",
    `4. Click **Configure**, then supply one of the following callback URLs when Meta asks for your endpoint:\n   - \`${primaryWebhookUrl}\`\n `,
    "5. Paste the verify token from step 1 into Meta's **Verify Token** field and submit. Meta will call the callback URL and expect that value to match before it approves the subscription.",
    "6. After verification succeeds, subscribe to the **messages** field (and any other WhatsApp webhook categories you need) so delivery status updates are forwarded to OneUptime.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    description,
    "### Prerequisites",
    prerequisitesMarkdown,
    "### Setup Steps",
    setupStepsMarkdown,
    webhookSection,
    "### Required WhatsApp Templates",
    templateSummaryTable,
    "### Template Bodies",
    "> Copy the exact template body below-including punctuation and spacing-when creating each template inside Meta. The variables list shows every placeholder that must be configured in WhatsApp Manager.",
    templateBodies,
  ]
    .filter(Boolean)
    .join("\n\n");
};

const whatsappSetupMarkdown: string = buildWhatsAppSetupMarkdown();

const SettingsWhatsApp: FunctionComponent = (): ReactElement => {
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
          title: "WhatsApp",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_WHATSAPP] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <CardModelDetail
        name="Meta WhatsApp Settings"
        cardProps={{
          title: "Meta WhatsApp Settings",
          description:
            "Configure Meta WhatsApp credentials. These values are used to send WhatsApp notifications from OneUptime.",
        }}
        isEditable={true}
        editButtonText="Edit Meta WhatsApp Config"
        formSteps={[
          {
            title: "Credentials",
            id: "meta-credentials",
          },
          {
            title: "Meta App",
            id: "meta-app",
          },
        ]}
        formFields={[
          {
            field: {
              metaWhatsAppAccessToken: true,
            },
            title: "Access Token",
            stepId: "meta-credentials",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: true,
            description:
              "Long-lived access token generated in the Meta WhatsApp Business Platform.",
            placeholder: "EAAG...",
          },
          {
            field: {
              metaWhatsAppPhoneNumberId: true,
            },
            title: "Phone Number ID",
            stepId: "meta-credentials",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description:
              "The WhatsApp Business phone number ID associated with your sending number.",
            placeholder: "123456789012345",
          },
          {
            field: {
              metaWhatsAppBusinessAccountId: true,
            },
            title: "Business Account ID",
            stepId: "meta-credentials",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            description:
              "Optional Business Account ID that owns the WhatsApp templates.",
            placeholder: "123456789012345",
          },
          {
            field: {
              metaWhatsAppWebhookVerifyToken: true,
            },
            title: "Webhook Verify Token",
            stepId: "meta-credentials",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: false,
            description:
              "Secret token configured in Meta to validate webhook subscription requests.",
            placeholder: "Webhook verify token",
          },
          {
            field: {
              metaWhatsAppAppId: true,
            },
            title: "App ID",
            stepId: "meta-app",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            description:
              "Optional Facebook App ID tied to your WhatsApp integration.",
            placeholder: "987654321098765",
          },
          {
            field: {
              metaWhatsAppAppSecret: true,
            },
            title: "App Secret",
            stepId: "meta-app",
            fieldType: FormFieldSchemaType.EncryptedText,
            required: false,
            description:
              "Optional Facebook App Secret used for webhook signature verification.",
            placeholder: "Facebook App Secret",
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config-meta-whatsapp",
          fields: [
            {
              field: {
                metaWhatsAppAccessToken: true,
              },
              title: "Access Token",
              fieldType: FieldType.HiddenText,
              placeholder: "Not Configured",
            },
            {
              field: {
                metaWhatsAppPhoneNumberId: true,
              },
              title: "Phone Number ID",
              fieldType: FieldType.ObjectID,
              placeholder: "Not Configured",
            },
            {
              field: {
                metaWhatsAppBusinessAccountId: true,
              },
              title: "Business Account ID",
              fieldType: FieldType.ObjectID,
              placeholder: "Not Configured",
            },
            {
              field: {
                metaWhatsAppWebhookVerifyToken: true,
              },
              title: "Webhook Verify Token",
              fieldType: FieldType.HiddenText,
              placeholder: "Not Configured",
            },
            {
              field: {
                metaWhatsAppAppId: true,
              },
              title: "App ID",
              fieldType: FieldType.ObjectID,
              placeholder: "Not Configured",
            },
            {
              field: {
                metaWhatsAppAppSecret: true,
              },
              title: "App Secret",
              fieldType: FieldType.HiddenText,
              placeholder: "Not Configured",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      <Card
        title="Send Test WhatsApp Message"
        description="Send a test WhatsApp template message to confirm your Meta configuration."
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
          id="send-test-whatsapp-form"
          name="Send Test WhatsApp Message"
          isLoading={isSendingTest}
          error={testError || ""}
          submitButtonText="Send Test Message"
          maxPrimaryButtonWidth={true}
          initialValues={{
            phoneNumber: "",
          }}
          fields={[
            {
              field: {
                phoneNumber: true,
              },
              title: "Recipient WhatsApp Number",
              description:
                "Enter the full international phone number (including country code) that should receive the test message.",
              placeholder: "+11234567890",
              required: true,
              fieldType: FormFieldSchemaType.Phone,
              disableSpellCheck: true,
            },
          ]}
          onSubmit={async (
            values: JSONObject,
            onSubmitSuccessful?: () => void,
          ) => {
            const toPhone: string = String(values["phoneNumber"] || "").trim();

            if (!toPhone) {
              setTestSuccess("");
              setTestError(
                "Please enter a WhatsApp number before sending a test message.",
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
                    "/notification/whatsapp/test",
                  ),
                  data: {
                    toPhone,
                    templateKey: WhatsAppTemplateIds.TestNotification,
                    templateLanguageCode:
                      WhatsAppTemplateLanguage[
                        WhatsAppTemplateIds.TestNotification
                      ],
                  },
                });

              if (response instanceof HTTPErrorResponse) {
                throw response;
              }

              if (response.isFailure()) {
                throw new Error("Failed to send test WhatsApp message.");
              }

              setTestSuccess(
                "Test WhatsApp message sent successfully. Check the recipient device to confirm delivery.",
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
        title="Meta WhatsApp Setup Guide"
        description="Steps to connect Meta WhatsApp and the templates you must provision."
      >
        <MarkdownViewer text={whatsappSetupMarkdown} />
      </Card>
    </Page>
  );
};

export default SettingsWhatsApp;
