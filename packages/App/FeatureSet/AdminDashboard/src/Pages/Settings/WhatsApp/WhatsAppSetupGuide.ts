import { APP_API_URL } from "Common/UI/Config";
import WhatsAppTemplateMessages, {
  WhatsAppTemplateId,
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
} from "Common/Types/WhatsApp/WhatsAppTemplates";
import {
  TemplatePlaceholder,
  findTemplatePlaceholders,
} from "Common/Utils/TemplatePlaceholders";
import {
  getGlobalTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The setup guide on Admin Dashboard > Settings > WhatsApp, as Markdown, in
 * the reader's language (#8677): each sentence is a key, its markdown kept.
 * What Meta must be given as written stays so - the templates' names,
 * languages, variables and bodies, the callback address, Meta's own labels.
 */

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
  const placeholders: Array<TemplatePlaceholder> =
    findTemplatePlaceholders(template);

  if (placeholders.length === 0) {
    return [];
  }

  const uniqueVariables: Set<string> = new Set<string>();

  for (const placeholder of placeholders) {
    // What stands between the braces: the text without its "{{" and "}}".
    const variable: string = placeholder.inner.trim();

    if (variable) {
      uniqueVariables.add(variable);
    }
  }

  return Array.from(uniqueVariables).sort((a: string, b: string) => {
    return a.localeCompare(b);
  });
};

export const buildWhatsAppSetupMarkdown: (translator?: Translator) => string = (
  translator: Translator = getGlobalTranslator(),
): string => {
  const t: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const templateKeys: Array<keyof typeof WhatsAppTemplateIds> = Object.keys(
    WhatsAppTemplateIds,
  ) as Array<keyof typeof WhatsAppTemplateIds>;

  const appApiBaseUrl: string = APP_API_URL.toString().replace(/\/$/, "");
  const primaryWebhookUrl: string = `${appApiBaseUrl}/notification/whatsapp/webhook`;

  const description: string = t(
    "Follow these steps to connect Meta WhatsApp with OneUptime so notifications can be delivered via WhatsApp.",
  );

  const prerequisitesList: Array<string> = [
    t("Meta Business Manager admin access for the WhatsApp Business Account."),
    t("A WhatsApp Business phone number approved for API messaging."),
    t(
      "Admin access to OneUptime with permission to edit global notification settings.",
    ),
    t(
      "A webhook verify token string that you'll configure identically in Meta and OneUptime.",
    ),
  ];

  const setupStepsList: Array<string> = [
    t(
      "Sign in to the [Meta Business Manager](https://business.facebook.com/) with admin access to your WhatsApp Business Account.",
    ),
    t(
      "From **Business Settings → Accounts → WhatsApp Accounts**, create or select the account that owns your sender phone number.",
    ),
    t(
      "In Business Portfolio, create a system user and assign it to the WhatsApp Business Account with the role of **Admin**.",
    ),
    t(
      "Generate a token for this system user and this will be your long-lived access token. Make sure to select the **whatsapp_business_management** and **whatsapp_business_messaging** permissions when generating the token.",
    ),
    t(
      "Paste the access token and phone number ID into the **Meta WhatsApp Settings** card above, then save. The Business Account ID, App ID and App Secret from the next steps go under **More fields** in the same form.",
    ),
    t(
      "For the **Business Account ID**, go to **Business Settings → Business Info** (or **Business Settings → WhatsApp Accounts → Settings**) and copy the **WhatsApp Business Account ID** value.",
    ),
    t(
      "To locate the **App ID** and **App Secret**, open [Meta for Developers](https://developers.facebook.com/apps/), select your WhatsApp app, then navigate to **Settings → Basic**. The App ID is shown at the top; click **Show** next to **App Secret** to reveal and copy it.",
    ),
    t(
      "Create each template listed below in the Meta WhatsApp Manager. Make sure the template name, language, and variables match exactly. You can however change the content to your preference. Please make sure it's approved by Meta.",
    ),
    t(
      "Send a test notification from OneUptime to confirm that WhatsApp delivery succeeds.",
    ),
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
          : t("_None_");

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
          : t("_None_");
      const variablesHeading: string = variables.length
        ? translator.translateTemplate("**Variables ({{count}})**", {
            count: translator.formatNumber(variables.length),
          })
        : t("**Variables**");

      return [
        `#### ${friendlyName}`,
        "",
        translator.translateTemplate("**Template Name:** {{template}}", {
          template: `\`${templateId}\``,
        }),
        translator.translateTemplate("**Language:** {{language}}", {
          language,
        }),
        "",
        variablesHeading,
        variableMarkdown,
        "",
        t("**Body**"),
        "```plaintext",
        templateMessage,
        "```",
        "",
        "---",
      ].join("\n");
    })
    .join("\n\n");

  const templateSummaryTable: string = [
    t("| Friendly Name | Template Name | Language | Variables |"),
    "| --- | --- | --- | --- |",
    tableRows,
  ]
    .filter(Boolean)
    .join("\n");

  const webhookSection: string = [
    t("### Configure Meta Webhook Subscription"),
    t(
      "1. In the OneUptime Admin Dashboard, open **Settings → WhatsApp → Meta WhatsApp Settings**, expand **More fields** and enter a strong value in **Webhook Verify Token**. Save the form so the encrypted token is stored in Global Config.",
    ),
    t(
      "2. Keep that verify token handy-Meta does not generate one for you. You'll paste the exact same value when configuring the callback.",
    ),
    t(
      "3. In [Meta for Developers](https://developers.facebook.com/apps/), select your WhatsApp app and navigate to **WhatsApp → Configuration → Webhooks**.",
    ),
    [
      t(
        "4. Click **Configure**, then supply one of the following callback URLs when Meta asks for your endpoint:",
      ),
      `   - \`${primaryWebhookUrl}\``,
    ].join("\n"),
    t(
      "5. Paste the verify token from step 1 into Meta's **Verify Token** field and submit. Meta will call the callback URL and expect that value to match before it approves the subscription.",
    ),
    t(
      "6. After verification succeeds, subscribe to the **messages** field (and any other WhatsApp webhook categories you need) so delivery status updates are forwarded to OneUptime.",
    ),
    t(
      "7. Save the **App Secret** under **More fields** as well: Meta signs every webhook call with it, and OneUptime refuses calls whose signature it cannot check.",
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    description,
    t("### Prerequisites"),
    prerequisitesMarkdown,
    t("### Setup Steps"),
    setupStepsMarkdown,
    webhookSection,
    t("### Required WhatsApp Templates"),
    templateSummaryTable,
    t("### Template Bodies"),
    t(
      "> [!NOTE]\n> Copy the exact template body below-including punctuation and spacing-when creating each template inside Meta. The variables list shows every placeholder that must be configured in WhatsApp Manager.",
    ),
    templateBodies,
  ]
    .filter(Boolean)
    .join("\n\n");
};
