import IconProp from "../Icon/IconProp";
import ProviderLogo from "../ProviderLogo/ProviderLogo";
import LlmConnectionProvider from "./LlmConnectionProvider";

/*
 * EVERYTHING ABOUT A CONNECTION THAT IS NOT CODE: what to call it, what it
 * brings in, which fields its form asks for (and which of them are
 * secrets), where its guide lives, and how often it is read.
 *
 * Shared by the dashboard (the Connect page's tiles, the connection form,
 * the list), the server (validating what a form saves, the connector that
 * reads the provider) and the docs tests (every connection has a guide that
 * names every field the form asks for).
 *
 * Field keys are the keys stored in LlmObservabilityConnection.config
 * (readable) and LlmObservabilityConnection.secrets (encrypted, never read
 * back). Connectors read their settings by these keys.
 *
 * The words here are shown as written in the dashboard and translated there:
 * this folder is one of the extractor's source roots
 * (Dashboard/scripts/i18n/ExtractStrings.ts), which reads the title,
 * description, summary, hint, label and placeholder of every entry.
 */

export enum LlmConnectionKind {
  // What an AI provider account used and what it cost.
  ProviderAccount = "provider-account",
  // What the company's people asked an AI tool, and what it answered.
  CompanyTool = "company-tool",
}

export type LlmConnectionFieldType = "text" | "password" | "dropdown" | "json";

export interface LlmConnectionFieldOption {
  label: string;
  value: string;
}

export interface LlmConnectionField {
  key: string;
  title: string;
  description: string;
  type: LlmConnectionFieldType;
  required: boolean;
  placeholder?: string | undefined;
  options?: Array<LlmConnectionFieldOption> | undefined;
  defaultValue?: string | undefined;
  /*
   * Folded under "More options" on the form: a setting most people leave as
   * it is (the Azure cloud, a narrower group of people).
   */
  isAdvanced?: boolean | undefined;
}

export interface LlmConnectionDefinition {
  provider: LlmConnectionProvider;
  kind: LlmConnectionKind;
  title: string;
  // One line on the tile: what connecting it does.
  description: string;
  // What arrives, in the reader's words: shown on the form and the list.
  summary: string;
  // Where the credential comes from, shown above the form's fields.
  hint: string;
  icon: IconProp;
  // The product's official logo, on its tile, its form and its row of the list.
  logo: ProviderLogo;
  /*
   * The OpenTelemetry GenAI value of gen_ai.provider.name for the calls
   * this connection describes (openai, anthropic, azure.ai.openai,
   * aws.bedrock, gcp.vertex_ai), so provider figures and span figures name
   * a provider the same way.
   */
  genAiProviderName: string;
  // The telemetry service a new connection's data belongs to.
  defaultServiceName: string;
  /*
   * The guide: a section of the provider accounts or company AI tools page,
   * e.g. "/docs/telemetry/ai-provider-accounts#openai". The anchor is the
   * English heading's (DocsLinksResolve holds it to the page).
   */
  docsPath: string;
  configFields: Array<LlmConnectionField>;
  secretFields: Array<LlmConnectionField>;
  // How often the provider is read.
  pullIntervalInMinutes: number;
  // How far back the first read goes.
  backfillDays: number;
  /*
   * True when the provider reports tokens but not money, so OneUptime prices
   * the tokens with its price list and marks the cost as an estimate.
   */
  costIsEstimated: boolean;
}

const MICROSOFT_CLOUD_OPTIONS: Array<LlmConnectionFieldOption> = [
  { label: "Azure public cloud", value: "public" },
  { label: "Azure Government (US)", value: "usgov" },
];

const AZURE_TENANT_FIELD: LlmConnectionField = {
  key: "tenantId",
  title: "Directory (tenant) ID",
  description: "The Microsoft Entra tenant of the app registration.",
  type: "text",
  required: true,
  placeholder: "00000000-0000-0000-0000-000000000000",
};

const AZURE_CLIENT_FIELD: LlmConnectionField = {
  key: "clientId",
  title: "Application (client) ID",
  description: "The app registration OneUptime signs in as.",
  type: "text",
  required: true,
  placeholder: "00000000-0000-0000-0000-000000000000",
};

const AZURE_CLOUD_FIELD: LlmConnectionField = {
  key: "cloud",
  title: "Cloud",
  description: "Which Azure cloud the tenant is in.",
  type: "dropdown",
  required: true,
  options: MICROSOFT_CLOUD_OPTIONS,
  defaultValue: "public",
  isAdvanced: true,
};

const AZURE_CLIENT_SECRET_FIELD: LlmConnectionField = {
  key: "clientSecret",
  title: "Client secret",
  description:
    "A client secret of the app registration. Stored encrypted and never shown again.",
  type: "password",
  required: true,
};

export const LlmConnectionCatalog: Array<LlmConnectionDefinition> = [
  {
    provider: LlmConnectionProvider.OpenAI,
    logo: ProviderLogo.OpenAI,
    kind: LlmConnectionKind.ProviderAccount,
    title: "OpenAI",
    description: "Usage and cost of your OpenAI organization.",
    summary:
      "Tokens, requests and cost by day, model, project, API key and person.",
    hint: "Create an admin key in OpenAI's dashboard: Settings, Organization, Admin keys. Only organization owners can create one.",
    icon: IconProp.Sparkles,
    genAiProviderName: "openai",
    defaultServiceName: "OpenAI",
    docsPath: "/docs/telemetry/ai-provider-accounts#openai",
    configFields: [],
    secretFields: [
      {
        key: "adminKey",
        title: "Admin key",
        description:
          "An OpenAI admin key. It starts with sk-admin-. Stored encrypted and never shown again.",
        type: "password",
        required: true,
        placeholder: "sk-admin-...",
      },
    ],
    pullIntervalInMinutes: 15,
    backfillDays: 30,
    costIsEstimated: false,
  },
  {
    provider: LlmConnectionProvider.Anthropic,
    logo: ProviderLogo.Anthropic,
    kind: LlmConnectionKind.ProviderAccount,
    title: "Anthropic",
    description: "Usage and cost of your Claude API organization.",
    summary: "Tokens and cost by day, model, workspace, API key and person.",
    hint: "Create an admin key in the Claude Console: Settings, Admin keys. Only organization admins can create one.",
    icon: IconProp.ChatBubbleOvalLeftEllipsis,
    genAiProviderName: "anthropic",
    defaultServiceName: "Anthropic",
    docsPath: "/docs/telemetry/ai-provider-accounts#anthropic",
    configFields: [],
    secretFields: [
      {
        key: "adminKey",
        title: "Admin key",
        description:
          "An Anthropic admin key. It starts with sk-ant-admin01-. Stored encrypted and never shown again.",
        type: "password",
        required: true,
        placeholder: "sk-ant-admin01-...",
      },
    ],
    pullIntervalInMinutes: 15,
    backfillDays: 30,
    costIsEstimated: false,
  },
  {
    provider: LlmConnectionProvider.AzureOpenAI,
    logo: ProviderLogo.AzureOpenAI,
    kind: LlmConnectionKind.ProviderAccount,
    title: "Azure OpenAI and Microsoft Foundry",
    description:
      "Usage of every Azure OpenAI and Foundry resource in a subscription.",
    summary:
      "Tokens and requests by day, resource and deployment, with an estimated cost.",
    hint: "Register an app in Microsoft Entra ID and give it the Monitoring Reader role on the subscription.",
    icon: IconProp.Cloud,
    genAiProviderName: "azure.ai.openai",
    defaultServiceName: "Azure OpenAI",
    docsPath:
      "/docs/telemetry/ai-provider-accounts#azure-openai-and-microsoft-foundry",
    configFields: [
      AZURE_TENANT_FIELD,
      AZURE_CLIENT_FIELD,
      {
        key: "subscriptionId",
        title: "Subscription ID",
        description:
          "The Azure subscription that holds your Azure OpenAI or Foundry resources. Every one of them is read.",
        type: "text",
        required: true,
        placeholder: "00000000-0000-0000-0000-000000000000",
      },
      AZURE_CLOUD_FIELD,
    ],
    secretFields: [AZURE_CLIENT_SECRET_FIELD],
    pullIntervalInMinutes: 15,
    backfillDays: 30,
    costIsEstimated: true,
  },
  {
    provider: LlmConnectionProvider.AwsBedrock,
    logo: ProviderLogo.AmazonBedrock,
    kind: LlmConnectionKind.ProviderAccount,
    title: "Amazon Bedrock",
    description: "Usage of Amazon Bedrock models in your AWS account.",
    summary:
      "Tokens and requests by day, region and model, with an estimated cost.",
    hint: "Create an IAM user or role key that may call cloudwatch:GetMetricData and cloudwatch:ListMetrics.",
    icon: IconProp.CPUChip,
    genAiProviderName: "aws.bedrock",
    defaultServiceName: "Amazon Bedrock",
    docsPath: "/docs/telemetry/ai-provider-accounts#amazon-bedrock",
    configFields: [
      {
        key: "accessKeyId",
        title: "Access key ID",
        description: "The AWS access key ID, such as AKIA....",
        type: "text",
        required: true,
        placeholder: "AKIA...",
      },
      {
        key: "regions",
        title: "Regions",
        description:
          "The AWS Regions you call Bedrock in, separated by commas.",
        type: "text",
        required: true,
        placeholder: "us-east-1, us-west-2",
        defaultValue: "us-east-1",
      },
    ],
    secretFields: [
      {
        key: "secretAccessKey",
        title: "Secret access key",
        description:
          "The secret of the access key. Stored encrypted and never shown again.",
        type: "password",
        required: true,
      },
    ],
    pullIntervalInMinutes: 15,
    backfillDays: 30,
    costIsEstimated: true,
  },
  {
    provider: LlmConnectionProvider.GoogleVertexAI,
    logo: ProviderLogo.GoogleVertexAI,
    kind: LlmConnectionKind.ProviderAccount,
    title: "Google Vertex AI",
    description: "Usage of Gemini, Claude and other models on Vertex AI.",
    summary:
      "Tokens and requests by day, region and model, with an estimated cost.",
    hint: "Create a service account with the Monitoring Viewer role on the project, and a JSON key for it.",
    icon: IconProp.Globe,
    genAiProviderName: "gcp.vertex_ai",
    defaultServiceName: "Google Vertex AI",
    docsPath: "/docs/telemetry/ai-provider-accounts#google-vertex-ai",
    configFields: [
      {
        key: "projectId",
        title: "Project ID",
        description: "The Google Cloud project you use Vertex AI in.",
        type: "text",
        required: true,
        placeholder: "my-project-123456",
      },
    ],
    secretFields: [
      {
        key: "serviceAccountJson",
        title: "Service account key (JSON)",
        description:
          "The JSON key of the service account. Stored encrypted and never shown again.",
        type: "json",
        required: true,
        placeholder: '{ "client_email": "...", "private_key": "..." }',
      },
    ],
    pullIntervalInMinutes: 15,
    backfillDays: 30,
    costIsEstimated: true,
  },
  {
    provider: LlmConnectionProvider.ClaudeEnterprise,
    logo: ProviderLogo.Claude,
    kind: LlmConnectionKind.CompanyTool,
    title: "Claude Enterprise",
    description: "What your people ask Claude on claude.ai.",
    summary:
      "Every chat by person: what they asked Claude and what it answered.",
    hint: "The primary owner turns on the Compliance API in claude.ai (Organization settings, API) and creates a key there with the read:compliance_user_data scope.",
    icon: IconProp.ChatBubbleLeftRight,
    genAiProviderName: "anthropic",
    defaultServiceName: "Claude Enterprise",
    docsPath: "/docs/telemetry/ai-company-tools#claude-enterprise",
    configFields: [],
    secretFields: [
      {
        key: "complianceAccessKey",
        title: "Compliance access key",
        description:
          "A Claude compliance access key. It starts with sk-ant-api01-. Stored encrypted and never shown again.",
        type: "password",
        required: true,
        placeholder: "sk-ant-api01-...",
      },
    ],
    pullIntervalInMinutes: 15,
    backfillDays: 7,
    costIsEstimated: false,
  },
  {
    provider: LlmConnectionProvider.Microsoft365Copilot,
    logo: ProviderLogo.MicrosoftCopilot,
    kind: LlmConnectionKind.CompanyTool,
    title: "Microsoft 365 Copilot",
    description:
      "What your people ask Copilot in Teams, Outlook, Word and Copilot Chat.",
    summary:
      "Every Copilot prompt and answer by person, and the app it was asked in.",
    hint: "Register an app in Microsoft Entra ID with the AiEnterpriseInteraction.Read.All and User.Read.All application permissions, and grant admin consent.",
    icon: IconProp.ChatBubbleLeft,
    genAiProviderName: "microsoft.copilot",
    defaultServiceName: "Microsoft 365 Copilot",
    docsPath: "/docs/telemetry/ai-company-tools#microsoft-365-copilot",
    configFields: [
      AZURE_TENANT_FIELD,
      AZURE_CLIENT_FIELD,
      {
        key: "groupId",
        title: "Only people in this group",
        description:
          "The object ID of a Microsoft Entra group. Leave empty to read everyone's Copilot use. The app then also needs GroupMember.Read.All.",
        type: "text",
        required: false,
        placeholder: "00000000-0000-0000-0000-000000000000",
        isAdvanced: true,
      },
      AZURE_CLOUD_FIELD,
    ],
    secretFields: [AZURE_CLIENT_SECRET_FIELD],
    pullIntervalInMinutes: 15,
    backfillDays: 7,
    costIsEstimated: false,
  },
];

export function getLlmConnectionDefinition(
  provider: string | undefined | null,
): LlmConnectionDefinition | undefined {
  return LlmConnectionCatalog.find(
    (definition: LlmConnectionDefinition): boolean => {
      return definition.provider === provider;
    },
  );
}

export function getLlmConnectionTitle(
  provider: string | undefined | null,
): string {
  return getLlmConnectionDefinition(provider)?.title || provider || "";
}

export function getLlmConnectionDefinitionsOfKind(
  kind: LlmConnectionKind,
): Array<LlmConnectionDefinition> {
  return LlmConnectionCatalog.filter(
    (definition: LlmConnectionDefinition): boolean => {
      return definition.kind === kind;
    },
  );
}

export function isCompanyToolProvider(
  provider: string | undefined | null,
): boolean {
  return (
    getLlmConnectionDefinition(provider)?.kind === LlmConnectionKind.CompanyTool
  );
}
