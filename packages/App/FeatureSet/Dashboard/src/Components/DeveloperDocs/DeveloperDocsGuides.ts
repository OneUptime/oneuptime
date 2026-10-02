import {
  DeveloperDocsPageType,
  DeveloperDocsScope,
} from "./DeveloperDocsPages";
import {
  DeveloperDocsResource,
  getDeveloperDocsPluralName,
  getDeveloperDocsSingularName,
} from "./DeveloperDocsResources";
import {
  SetupGuideLink,
  SetupGuideStepVariant,
  SetupGuideTopic,
  codeBlock,
} from "../SetupGuide/SetupGuide";
import { JSONObject } from "Common/Types/JSON";
import {
  ApiExample,
  CollectionApiExamples,
  getApiBaseUrl,
  getApiReferenceUrl,
  getCollectionApiExamples,
  getResourceApiExamples,
  ResourceApiExamples,
} from "Common/Utils/DeveloperDocs/ApiExamples";
import {
  getAssistantPrompts,
  getMcpApiKeySetupMarkdown,
  getMcpClientSetups,
  getMcpServerUrl,
  getMcpToolNames,
  McpClientSetup,
  McpToolNames,
} from "Common/Utils/DeveloperDocs/AiAssistantExamples";
import {
  getApiKeyExportCommand,
  ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE,
  toSentenceCaseName,
} from "Common/Utils/DeveloperDocs/ExampleValues";
import {
  jsonToHcl,
  TerraformSecretVariable,
} from "Common/Utils/DeveloperDocs/TerraformValues";
import {
  getTerraformDataSourceByNameHcl,
  getTerraformImportBlocksHcl,
  getTerraformProviderHcl,
  getTerraformResourceConfig,
  getTerraformShortTypeName,
  getTerraformStarterHcl,
  TerraformImportTarget,
  TerraformOmittedAttribute,
  TerraformResourceConfig,
} from "Common/Utils/DeveloperDocs/TerraformConfig";
import { getTerraformTypeName } from "Common/Utils/DeveloperDocs/TerraformSchema";
import { HclExpression } from "Common/Utils/DeveloperDocs/Hcl";

/*
 * What each Developer page says, as data: numbered steps (in the same layout
 * as the product's setup guides), folded extras, links. Pure on purpose: a
 * record's JSON and the installation's address in, text out, so every page
 * for every resource can be tested without rendering it.
 *
 * The steps' text is English, like the other in-app setup guides; the card's
 * title and description are translated by the page.
 */

export interface DeveloperDocsStep {
  title: string;
  description?: string | undefined;
  markdown?: string | undefined;
  // Tabs, one per way of doing the step (one per AI client).
  variants?: Array<SetupGuideStepVariant> | undefined;
  // Prompts, each shown with a copy button.
  prompts?: Array<string> | undefined;
}

export interface DeveloperDocsGuide {
  title: string;
  description: string;
  // Shown above the steps, e.g. that the MCP server cannot do this yet.
  notice?: string | undefined;
  steps: Array<DeveloperDocsStep>;
  // Folded under "More".
  topics: Array<SetupGuideTopic>;
  links: Array<SetupGuideLink>;
}

export interface DeveloperDocsRecord {
  id: string;
  displayName: string | null;
  // The record's API JSON (BaseModel.toJSON), with the fields the viewer may read.
  json: JSONObject;
}

export interface DeveloperDocsGuideContext {
  resource: DeveloperDocsResource;
  scope: DeveloperDocsScope;
  // `https://oneuptime.com`, or a placeholder when unknown.
  oneuptimeUrl: string;
  // The installation's version, for the provider constraint.
  platformVersion: string | null;
  // Where the reader creates an API key (an in-app route).
  apiKeysUrl: string;
  // The record, on a view page.
  record?: DeveloperDocsRecord | undefined;
  // On a list page: the records to import, and how many there are in all.
  importTargets?: Array<TerraformImportTarget> | undefined;
  totalCount?: number | undefined;
}

export const DEVELOPER_DOCS_IMPORT_LIMIT: number = 100;

// The page's own words, which it translates.
export const DEVELOPER_DOCS_LEARN_MORE_LABEL: string = "Learn more:";
export const DEVELOPER_DOCS_NOT_FOUND_MESSAGE: string =
  "This could not be found. It may have been deleted.";

const TERRAFORM_REGISTRY_DOCS_URL: string =
  "https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs";

export interface DeveloperDocsGuideCopy {
  title: string;
  description: string;
}

/*
 * The card's title and description, which the page translates: whole
 * sentences that name no resource, so each is one entry in every locale.
 */
export const DEVELOPER_DOCS_GUIDE_COPY: Readonly<
  Record<
    DeveloperDocsPageType,
    Readonly<Record<DeveloperDocsScope, DeveloperDocsGuideCopy>>
  >
> = {
  [DeveloperDocsPageType.Terraform]: {
    [DeveloperDocsScope.View]: {
      title: "Terraform",
      description:
        "Manage this resource as code with the OneUptime Terraform provider. The configuration below is written from its current settings, so Terraform adopts it without changing anything.",
    },
    [DeveloperDocsScope.List]: {
      title: "Terraform",
      description:
        "Manage these resources as code with the OneUptime Terraform provider: create new ones, or bring in the ones you already have.",
    },
  },
  [DeveloperDocsPageType.Api]: {
    [DeveloperDocsScope.View]: {
      title: "API",
      description:
        "Read, change and delete this resource with the OneUptime REST API. Every command below runs against this OneUptime.",
    },
    [DeveloperDocsScope.List]: {
      title: "API",
      description:
        "List and create these resources with the OneUptime REST API. Every command below runs against this OneUptime.",
    },
  },
  [DeveloperDocsPageType.AiAssistants]: {
    [DeveloperDocsScope.View]: {
      title: "AI Assistants",
      description:
        "Work with this resource from an AI assistant such as Claude, GitHub Copilot or Cursor.",
    },
    [DeveloperDocsScope.List]: {
      title: "AI Assistants",
      description:
        "Work with these resources from an AI assistant such as Claude, GitHub Copilot or Cursor.",
    },
  },
};

function guideCopy(
  page: DeveloperDocsPageType,
  context: DeveloperDocsGuideContext,
): DeveloperDocsGuideCopy {
  return DEVELOPER_DOCS_GUIDE_COPY[page][context.scope];
}

function docsUrl(context: DeveloperDocsGuideContext, path: string): string {
  return `${context.oneuptimeUrl.replace(/\/+$/, "")}/docs/${path}`;
}

function nouns(context: DeveloperDocsGuideContext): {
  singular: string;
  plural: string;
  // "the workflow "Send weekly report"" or "this workflow".
  theRecord: string;
} {
  const singular: string = toSentenceCaseName(
    getDeveloperDocsSingularName(context.resource),
  );
  const plural: string = toSentenceCaseName(
    getDeveloperDocsPluralName(context.resource),
  );

  return {
    singular,
    plural,
    theRecord: context.record?.displayName
      ? `the ${singular} "${context.record.displayName}"`
      : `this ${singular}`,
  };
}

function apiKeyStep(
  context: DeveloperDocsGuideContext,
  reader: "Terraform" | "the API" | "your assistant",
): DeveloperDocsStep {
  const { plural } = nouns(context);

  return {
    title: "Create an API key",
    description:
      reader === "your assistant"
        ? "Your assistant reads the key from the environment, so it never appears in the chat."
        : `${reader === "Terraform" ? "Terraform signs" : "Requests sign"} in to OneUptime with a project API key.`,
    markdown: [
      `Create one in [Project Settings → API Keys](${context.apiKeysUrl}) with permission to manage ${plural}, then make it available in your shell:`,
      "",
      codeBlock("bash", getApiKeyExportCommand()),
    ].join("\n"),
  };
}

function providerStep(context: DeveloperDocsGuideContext): DeveloperDocsStep {
  return {
    title: "Add the OneUptime provider",
    description:
      "Put this in a .tf file in your Terraform project. It points the provider at this OneUptime.",
    markdown: codeBlock(
      "hcl",
      getTerraformProviderHcl({
        oneuptimeUrl: context.oneuptimeUrl.startsWith("http")
          ? context.oneuptimeUrl
          : null,
        platformVersion: context.platformVersion,
      }),
    ),
  };
}

function secretsMarkdown(data: {
  variables: Array<TerraformSecretVariable>;
  omitted: Array<TerraformOmittedAttribute>;
}): string {
  const lines: Array<string> = [];

  if (data.variables.length > 0) {
    lines.push(
      "Secrets are never shown here. This configuration reads them from Terraform variables instead; set each one before you plan:",
      "",
      codeBlock(
        "bash",
        data.variables
          .map((variable: TerraformSecretVariable): string => {
            return `export TF_VAR_${variable.name}="..."`;
          })
          .join("\n"),
      ),
    );
  }

  if (data.omitted.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }

    lines.push(
      `Left out because they are secret: ${data.omitted
        .map((omitted: TerraformOmittedAttribute): string => {
          return `\`${omitted.attributeName}\``;
        })
        .join(", ")}. Terraform leaves them as they are in OneUptime.`,
    );
  }

  return lines.join("\n");
}

function terraformLinks(
  context: DeveloperDocsGuideContext,
  typeName: string | null,
): Array<SetupGuideLink> {
  const links: Array<SetupGuideLink> = [
    { title: "Terraform provider", url: docsUrl(context, "terraform/index") },
    {
      title: "Importing resources",
      url: docsUrl(context, "terraform/importing-resources"),
    },
  ];

  if (typeName) {
    links.push({
      title: `${typeName} reference`,
      url: `${TERRAFORM_REGISTRY_DOCS_URL}/resources/${getTerraformShortTypeName(typeName)}`,
    });
  }

  return links;
}

const OPEN_TOFU_TOPIC: SetupGuideTopic = {
  title: "OpenTofu",
  summary: "The same configuration works with tofu",
  markdown: [
    "The provider is published for OpenTofu too, and this configuration works unchanged. Run the same steps with `tofu`:",
    "",
    codeBlock("bash", "tofu init\ntofu plan\ntofu apply"),
  ].join("\n"),
};

function getTerraformResourceGuide(
  context: DeveloperDocsGuideContext,
  record: DeveloperDocsRecord,
): DeveloperDocsGuide {
  const { singular, theRecord } = nouns(context);
  const copy: DeveloperDocsGuideCopy = guideCopy(
    DeveloperDocsPageType.Terraform,
    context,
  );
  const typeName: string | null = getTerraformTypeName(
    context.resource.modelType,
  );
  const config: TerraformResourceConfig | null = getTerraformResourceConfig({
    modelType: context.resource.modelType,
    json: record.json,
    displayName: record.displayName,
  });

  if (!config) {
    return getTerraformUnsupportedGuide(context, typeName);
  }

  const secrets: string = secretsMarkdown({
    variables: config.variables,
    omitted: config.omittedSecrets,
  });

  return {
    ...copy,
    steps: [
      apiKeyStep(context, "Terraform"),
      providerStep(context),
      {
        title: `Add ${theRecord}`,
        description: `Its settings as a resource, and an import block: it tells Terraform the ${singular} already exists, so Terraform adopts it instead of creating a copy.`,
        markdown: [codeBlock("hcl", config.hcl), secrets]
          .filter((part: string): boolean => {
            return part.length > 0;
          })
          .join("\n\n"),
      },
      {
        title: "Import it",
        description: `The plan shows the ${singular} being imported and nothing to change. Apply it, and the ${singular} is managed by Terraform from then on.`,
        markdown: codeBlock(
          "bash",
          "terraform init\nterraform plan\nterraform apply",
        ),
      },
    ],
    topics: [
      {
        title: "Import it from the command line instead",
        summary: "For Terraform before 1.5",
        markdown: [
          "Leave out the import block and run:",
          "",
          codeBlock("bash", config.importCommand),
        ].join("\n"),
      },
      {
        title: "Read it without managing it",
        summary: "A data source",
        markdown: [
          `To use this ${singular}'s settings in other resources while it stays managed in OneUptime, read it with a data source instead:`,
          "",
          codeBlock("hcl", config.dataSourceHcl),
        ].join("\n"),
      },
      OPEN_TOFU_TOPIC,
    ],
    links: terraformLinks(context, typeName),
  };
}

function getTerraformUnsupportedGuide(
  context: DeveloperDocsGuideContext,
  typeName: string | null,
): DeveloperDocsGuide {
  const { plural } = nouns(context);
  const copy: DeveloperDocsGuideCopy = guideCopy(
    DeveloperDocsPageType.Terraform,
    context,
  );

  return {
    ...copy,
    notice: `The Terraform provider cannot create or change ${plural}.${
      typeName
        ? ` You can still read them with the \`${typeName}\` data source.`
        : ""
    }`,
    steps: [apiKeyStep(context, "Terraform"), providerStep(context)],
    topics: [],
    links: terraformLinks(context, null),
  };
}

function hclExampleValues(
  resource: DeveloperDocsResource,
): Record<string, HclExpression> | undefined {
  if (!resource.exampleValues) {
    return undefined;
  }

  const values: Record<string, HclExpression> = {};

  for (const key of Object.keys(resource.exampleValues)) {
    values[key] = jsonToHcl(resource.exampleValues[key]);
  }

  return values;
}

function getTerraformCollectionGuide(
  context: DeveloperDocsGuideContext,
): DeveloperDocsGuide {
  const { singular, plural } = nouns(context);
  const copy: DeveloperDocsGuideCopy = guideCopy(
    DeveloperDocsPageType.Terraform,
    context,
  );
  const typeName: string | null = getTerraformTypeName(
    context.resource.modelType,
  );
  const starter: string | null = getTerraformStarterHcl({
    modelType: context.resource.modelType,
    singularName: getDeveloperDocsSingularName(context.resource),
    exampleValues: hclExampleValues(context.resource),
  });

  if (!starter) {
    return getTerraformUnsupportedGuide(context, typeName);
  }

  const targets: Array<TerraformImportTarget> = context.importTargets || [];
  const totalCount: number = context.totalCount ?? targets.length;
  const imports: string | null = getTerraformImportBlocksHcl({
    modelType: context.resource.modelType,
    targets,
  });
  const fileName: string = `${getTerraformShortTypeName(typeName || singular)}s.tf`;

  let importMarkdown: string;

  if (!imports) {
    importMarkdown = `There are no ${plural} in this project yet.`;
  } else {
    importMarkdown = [
      totalCount > targets.length
        ? `Import blocks for the first ${targets.length} of your ${totalCount} ${plural}:`
        : `An import block for each of your ${plural}:`,
      "",
      codeBlock("hcl", imports),
      "",
      `Then let Terraform write their configuration, review it, and apply:`,
      "",
      codeBlock(
        "bash",
        `terraform plan -generate-config-out=${fileName}\nterraform apply`,
      ),
    ].join("\n");
  }

  const placeholders: boolean = starter.includes("<");

  return {
    ...copy,
    steps: [
      apiKeyStep(context, "Terraform"),
      providerStep(context),
      {
        title: `Create a ${singular}`,
        description: placeholders
          ? "Replace the values in angle brackets with your own."
          : `The settings a new ${singular} needs. Add any others from the reference.`,
        markdown: [
          codeBlock("hcl", starter),
          "",
          codeBlock("bash", "terraform init\nterraform apply"),
        ].join("\n"),
      },
      {
        title: `Bring in the ${plural} you already have`,
        description: `Terraform adopts them as they are, without creating copies.`,
        markdown: importMarkdown,
      },
    ],
    topics: [
      {
        title: "Look one up by name",
        summary: "A data source",
        markdown: [
          `To use a ${singular} that stays managed in OneUptime, read it with a data source:`,
          "",
          codeBlock(
            "hcl",
            getTerraformDataSourceByNameHcl({
              modelType: context.resource.modelType,
              exampleName: targets[0]?.displayName || `My ${singular}`,
            }) || "",
          ),
        ].join("\n"),
      },
      OPEN_TOFU_TOPIC,
    ],
    links: terraformLinks(context, typeName),
  };
}

function curlStep(data: {
  title: string;
  description: string;
  example: ApiExample | null;
}): Array<DeveloperDocsStep> {
  if (!data.example) {
    return [];
  }

  return [
    {
      title: data.title,
      description: data.description,
      markdown: codeBlock("bash", data.example.curl),
    },
  ];
}

function apiLinks(context: DeveloperDocsGuideContext): Array<SetupGuideLink> {
  return [
    {
      title: `${getDeveloperDocsSingularName(context.resource)} API reference`,
      url: getApiReferenceUrl({
        modelType: context.resource.modelType,
        oneuptimeUrl: context.oneuptimeUrl,
      }),
    },
    {
      title: "API documentation",
      url: docsUrl(context, "api-reference/api-reference"),
    },
  ];
}

const QUERY_TOPIC: SetupGuideTopic = {
  title: "Filter, sort and choose fields",
  summary: "query, select and sort",
  markdown: [
    "List and count requests take a `query`: a field and a value to match, or an operator such as `GreaterThan` or `Search`. `select` picks the fields to return, `sort` orders them (`ASC` or `DESC`), and `skip` and `limit` in the URL page through the results.",
    "",
    codeBlock(
      "json",
      JSON.stringify(
        {
          query: {
            createdAt: {
              _type: "GreaterThan",
              value: "2026-01-01T00:00:00.000Z",
            },
          },
          select: { _id: true, createdAt: true },
          sort: { createdAt: "DESC" },
        },
        null,
        2,
      ),
    ),
  ].join("\n"),
};

function getApiResourceGuide(
  context: DeveloperDocsGuideContext,
  record: DeveloperDocsRecord,
): DeveloperDocsGuide {
  const { singular } = nouns(context);
  const examples: ResourceApiExamples = getResourceApiExamples({
    modelType: context.resource.modelType,
    apiBaseUrl: getApiBaseUrl(context.oneuptimeUrl),
    id: record.id,
    displayName: record.displayName,
  });

  return {
    ...guideCopy(DeveloperDocsPageType.Api, context),
    steps: [
      apiKeyStep(context, "the API"),
      ...curlStep({
        title: "Read it",
        description: `Ask for the fields you need in select. This ${singular}'s ID is ${record.id}.`,
        example: examples.read,
      }),
      ...curlStep({
        title: "Change it",
        description:
          "Send only the fields you want to change. Everything else stays as it is.",
        example: examples.update,
      }),
      ...curlStep({
        title: "Delete it",
        description: `This deletes the ${singular} for good.`,
        example: examples.delete,
      }),
    ],
    topics: [QUERY_TOPIC],
    links: apiLinks(context),
  };
}

function getApiCollectionGuide(
  context: DeveloperDocsGuideContext,
): DeveloperDocsGuide {
  const { singular, plural } = nouns(context);
  const examples: CollectionApiExamples = getCollectionApiExamples({
    modelType: context.resource.modelType,
    apiBaseUrl: getApiBaseUrl(context.oneuptimeUrl),
    singularName: getDeveloperDocsSingularName(context.resource),
    exampleValues: context.resource.exampleValues,
  });

  const topics: Array<SetupGuideTopic> = [QUERY_TOPIC];

  if (examples.count) {
    topics.push({
      title: `Count your ${plural}`,
      summary: "count",
      markdown: codeBlock("bash", examples.count.curl),
    });
  }

  return {
    ...guideCopy(DeveloperDocsPageType.Api, context),
    steps: [
      apiKeyStep(context, "the API"),
      ...curlStep({
        title: `List your ${plural}`,
        description: "Newest first, ten at a time.",
        example: examples.list,
      }),
      ...curlStep({
        title: `Create a ${singular}`,
        description:
          examples.create && JSON.stringify(examples.create.body).includes("<")
            ? "Replace the values in angle brackets with your own."
            : `The fields a new ${singular} needs. Add any others from the reference.`,
        example: examples.create,
      }),
    ],
    topics,
    links: apiLinks(context),
  };
}

function mcpToolsTopic(
  tools: McpToolNames,
  plural: string,
  singular: string,
): SetupGuideTopic {
  return {
    title: "The tools your assistant uses",
    summary: `${tools.get}, ${tools.list}, ${tools.update} and more`,
    markdown: [
      `| Tool | What it does |`,
      `| --- | --- |`,
      `| \`${tools.get}\` | Reads one ${singular} |`,
      `| \`${tools.list}\` | Lists and searches ${plural} |`,
      `| \`${tools.count}\` | Counts ${plural} |`,
      `| \`${tools.create}\` | Creates a ${singular} |`,
      `| \`${tools.update}\` | Changes a ${singular} |`,
      `| \`${tools.delete}\` | Deletes a ${singular} (your assistant asks first) |`,
      "",
      "A client you authorize as read only can use the first three.",
    ].join("\n"),
  };
}

function getAiGuide(context: DeveloperDocsGuideContext): DeveloperDocsGuide {
  const { singular, plural, theRecord } = nouns(context);
  const mcpUrl: string = getMcpServerUrl(context.oneuptimeUrl);
  const tools: McpToolNames | null = getMcpToolNames(
    context.resource.modelType,
  );
  const prompts: Array<string> = getAssistantPrompts({
    modelType: context.resource.modelType,
    singularName: getDeveloperDocsSingularName(context.resource),
    pluralName: getDeveloperDocsPluralName(context.resource),
    displayName: context.record?.displayName,
    id: context.record?.id,
    apiReferenceUrl: getApiReferenceUrl({
      modelType: context.resource.modelType,
      oneuptimeUrl: context.oneuptimeUrl,
    }),
  });
  const variants: Array<SetupGuideStepVariant> = getMcpClientSetups(mcpUrl).map(
    (setup: McpClientSetup): SetupGuideStepVariant => {
      return { label: setup.label, markdown: setup.markdown };
    },
  );
  const askTitle: string = context.record
    ? `Ask about ${theRecord}`
    : `Ask about your ${plural}`;
  const links: Array<SetupGuideLink> = [
    { title: "MCP server", url: docsUrl(context, "ai/mcp-server") },
  ];

  if (tools) {
    return {
      ...guideCopy(DeveloperDocsPageType.AiAssistants, context),
      steps: [
        {
          title: "Connect your assistant to OneUptime",
          description:
            "Add OneUptime's MCP server. Your assistant asks you to sign in to OneUptime the first time; there is no key to copy.",
          variants,
        },
        {
          title: askTitle,
          description: context.record
            ? `Try one of these. Each names the ${singular} and its ID, so the assistant finds it straight away.`
            : "Try one of these.",
          prompts,
        },
      ],
      topics: [
        mcpToolsTopic(tools, plural, singular),
        {
          title: "Connect an agent that runs on its own",
          summary: "With an API key, for jobs nobody signs in to",
          markdown: getMcpApiKeySetupMarkdown(mcpUrl),
        },
      ],
      links,
    };
  }

  return {
    ...guideCopy(DeveloperDocsPageType.AiAssistants, context),
    notice: `OneUptime's MCP server does not have tools for ${plural} yet. An assistant that can run commands (Claude Code, Cursor, or GitHub Copilot in agent mode) can still work with ${
      context.record ? `this ${singular}` : `your ${plural}`
    } through the REST API.`,
    steps: [
      apiKeyStep(context, "your assistant"),
      {
        title: askTitle,
        description: `Start your assistant in the same shell, so it can use the key in ${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}, then try one of these.`,
        prompts,
      },
    ],
    topics: [
      {
        title: "Connect the MCP server for the rest of your project",
        summary: "Monitors, incidents, alerts, status pages and more",
        markdown: [
          `The MCP server works with monitors, incidents, alerts, status pages, on-call policies, scheduled maintenance, teams and labels. Add it to your assistant and sign in to OneUptime when it asks:`,
          "",
          codeBlock(
            "bash",
            `claude mcp add --transport http oneuptime ${mcpUrl}`,
          ),
          "",
          "Other assistants take the same URL; see the MCP server documentation.",
        ].join("\n"),
      },
    ],
    links: [...apiLinks(context).slice(0, 1), ...links],
  };
}

export function getDeveloperDocsGuide(
  page: DeveloperDocsPageType,
  context: DeveloperDocsGuideContext,
): DeveloperDocsGuide {
  const isRecord: boolean =
    context.scope === DeveloperDocsScope.View && Boolean(context.record);

  switch (page) {
    case DeveloperDocsPageType.Terraform:
      return isRecord
        ? getTerraformResourceGuide(context, context.record!)
        : getTerraformCollectionGuide(context);
    case DeveloperDocsPageType.Api:
      return isRecord
        ? getApiResourceGuide(context, context.record!)
        : getApiCollectionGuide(context);
    case DeveloperDocsPageType.AiAssistants:
      return getAiGuide(context);
  }
}
