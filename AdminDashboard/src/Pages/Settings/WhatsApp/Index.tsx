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
import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import WhatsAppTemplateMessages, {
  WhatsAppTemplateId,
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
} from "Common/Types/WhatsApp/WhatsAppTemplates";

const toFriendlyName = (value: string): string => {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const extractTemplateVariables = (template: string): Array<string> => {
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

const buildWhatsAppSetupMarkdown = (): string => {
  const templateKeys: Array<keyof typeof WhatsAppTemplateIds> = Object.keys(
    WhatsAppTemplateIds,
  ) as Array<keyof typeof WhatsAppTemplateIds>;

  const header: string = "# Configure Meta WhatsApp";
  const description: string =
    "Follow these steps to connect Meta WhatsApp with OneUptime so notifications can be delivered via WhatsApp.";
  const steps: string = [
    "1. Sign in to the [Meta Business Manager](https://business.facebook.com/) with admin access to your WhatsApp Business Account.",
    "2. From **Business Settings → Accounts → WhatsApp Accounts**, create or select the account that owns your sender phone number.",
    "3. Under **WhatsApp Manager → API Setup**, generate a long-lived access token and copy the phone number ID.",
    "4. Paste the access token and phone number ID into the **Meta WhatsApp Settings** card above, then save.",
    "5. (Optional) Record the Business Account ID, App ID, and App Secret if you use signed webhooks or Meta app features.",
    "6. Create each template listed below in the Meta WhatsApp Manager. Make sure the template name, language, and variables match exactly.",
    "7. Send a test notification from OneUptime to confirm that WhatsApp delivery succeeds.",
  ].join("\n");

  const tableRows: string = templateKeys
    .map((enumKey: keyof typeof WhatsAppTemplateIds) => {
      const templateId: WhatsAppTemplateId = WhatsAppTemplateIds[enumKey];
      const friendlyName: string = toFriendlyName(enumKey.toString());
      const templateMessage: string = WhatsAppTemplateMessages[templateId];
      const language: string =
        WhatsAppTemplateLanguage[templateId] || "en";
      const variables: Array<string> = extractTemplateVariables(
        templateMessage,
      );
      const variableList: string =
        variables.length > 0
          ? variables.map((variable: string) => `\`${variable}\``).join(", ")
          : "_None_";

      return `| ${friendlyName} | \`${templateId}\` | ${language} | ${variableList} |`;
    })
    .join("\n");

  const templateBodies: string = templateKeys
    .map((enumKey: keyof typeof WhatsAppTemplateIds) => {
      const templateId: WhatsAppTemplateId = WhatsAppTemplateIds[enumKey];
      const friendlyName: string = toFriendlyName(enumKey.toString());
      const templateMessage: string = WhatsAppTemplateMessages[templateId];
      const language: string =
        WhatsAppTemplateLanguage[templateId] || "en";
      const variables: Array<string> = extractTemplateVariables(
        templateMessage,
      );
      const variableMarkdown: string =
        variables.length > 0
          ? variables
              .map((variable: string) => {
                return `- \`${variable}\``;
              })
              .join("\n")
          : "- _None_";
      return `### ${friendlyName} (\`${templateId}\`)\n\n**Language:** ${language}\n\n**Variables:**\n${variableMarkdown}\n\n**Body:**\n\n\`\`\`\n${templateMessage}\n\`\`\`\n`;
    })
    .join("\n\n");

  return [
    `${header}\n\n${description}\n\n${steps}`,
    "## Required WhatsApp Templates",
    "| Friendly Name | Template Name | Language | Variables |",
    "| --- | --- | --- | --- |",
    tableRows,
    "## Template Bodies",
    templateBodies,
  ]
    .filter(Boolean)
    .join("\n\n");
};

const whatsappSetupMarkdown: string = buildWhatsAppSetupMarkdown();

const SettingsWhatsApp: FunctionComponent = (): ReactElement => {
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
              fieldType: FieldType.Text,
              placeholder: "Not Configured",
            },
            {
              field: {
                metaWhatsAppBusinessAccountId: true,
              },
              title: "Business Account ID",
              fieldType: FieldType.Text,
              placeholder: "Optional",
            },
            {
              field: {
                metaWhatsAppAppId: true,
              },
              title: "App ID",
              fieldType: FieldType.Text,
              placeholder: "Optional",
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
        title="Meta WhatsApp Setup Guide"
        description="Steps to connect Meta WhatsApp and the templates you must provision."
      >
        <MarkdownViewer text={whatsappSetupMarkdown} />
      </Card>
    </Page>
  );
};

export default SettingsWhatsApp;
