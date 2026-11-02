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
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "Common/Types/JSON";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  ApiExample,
  getApiBaseUrl,
  getApiReferenceUrl,
  getCurlCommand,
  getModelApiPath,
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
  DeveloperDocsApiBody,
  DeveloperDocsApiFilter,
  DeveloperDocsApiTask,
  DeveloperDocsExampleContext,
  DeveloperDocsFieldRow,
  DeveloperDocsTerraformExample,
  DeveloperDocsTerraformRecipe,
  getApiCreateExample,
  getApiFilters,
  getApiReadSelect,
  getApiTasks,
  getApiUpdateExample,
  getCreateTitle,
  getTableName,
  getTerraformCreateExample,
  getTerraformRecipes,
} from "Common/Utils/DeveloperDocs/ExampleBuilder";
import {
  getApiKeyExportCommand,
  ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE,
  toSentenceCaseName,
  withIndefiniteArticle,
} from "Common/Utils/DeveloperDocs/ExampleValues";
import {
  DeveloperDocsLiveData,
  getEmptyDeveloperDocsLiveData,
} from "Common/Utils/DeveloperDocs/LiveData";
import {
  DeveloperDocsProfile,
  getDeveloperDocsProfile,
} from "Common/Utils/DeveloperDocs/ResourceProfiles";
import { TerraformSecretVariable } from "Common/Utils/DeveloperDocs/TerraformValues";
import {
  getTerraformDataSourceByNameHcl,
  getTerraformImportBlocksHcl,
  getTerraformProviderHcl,
  getTerraformResourceConfig,
  getTerraformShortTypeName,
  TerraformImportTarget,
  TerraformOmittedAttribute,
  TerraformResourceConfig,
} from "Common/Utils/DeveloperDocs/TerraformConfig";
import {
  getTerraformModelOperations,
  getTerraformTypeName,
  isModelInPublicApi,
  TerraformModelOperations,
} from "Common/Utils/DeveloperDocs/TerraformSchema";
import {
  translatableTerm,
  TranslatableTerm,
  translateTemplate,
  translateText,
} from "Common/UI/Utils/TranslateTemplate";
import {
  CLI_NOTE_COLUMN,
  CliAction,
  CliFieldFlag,
  CliNoteTarget,
  CliOperation,
  CliStateChange,
  CliStateMachine,
  getCliActions,
  getCliDatabaseOperations,
  getCliFieldFlags,
  getCliNoteTarget,
  getCliStateMachine,
} from "Common/Utils/DeveloperDocs/CliCommands";
import {
  CliExample,
  getCliActionExample,
  getCliCommandOf,
  getCliConnectCommands,
  getCliCountExample,
  getCliCreateExample,
  getCliDeleteExample,
  getCliGetExample,
  getCliInstallScriptCommands,
  getCliListExample,
  getCliLoginCommand,
  getCliNpmInstallCommand,
  getCliUpdateExample,
} from "Common/Utils/DeveloperDocs/CliExamples";
import { INSTALL_SCRIPT_READ_FIRST_NOTE } from "../SetupGuide/AgentInstallCommands";

/*
 * What each Developer page says, as data: numbered steps (in the same layout
 * as the product's setup guides), sections of ready-made recipes, folded
 * extras, links. Pure on purpose: a record's JSON, what the page found out
 * about the project, and the installation's address in, text out, so every
 * page for every resource can be tested without rendering it.
 *
 * What makes a page specific to its resource comes from the resource's
 * profile (Common/Utils/DeveloperDocs/ResourceProfiles) and the project's own
 * records (LiveData): an incident is declared with one of the project's
 * severities and acknowledged with its own acknowledged state, a monitor is
 * created with the criteria a new monitor gets in the dashboard, and every id
 * on a page names its record in a comment.
 *
 * The steps' text is English, like the other in-app setup guides; the card's
 * title and description are translated by the page.
 */

export interface DeveloperDocsStep {
  title: string;
  description?: string | undefined;
  markdown?: string | undefined;
  // Tabs, one per way of doing the step (one per AI client, one per filter).
  variants?: Array<SetupGuideStepVariant> | undefined;
  // Prompts, each shown with a copy button.
  prompts?: Array<string> | undefined;
}

/*
 * A section after the steps: ready-made recipes for the resource, or a
 * reference. Not numbered: nothing here has to be done in order.
 */
export interface DeveloperDocsSection {
  title: string;
  description?: string | undefined;
  markdown?: string | undefined;
  // One tab per recipe.
  variants?: Array<SetupGuideStepVariant> | undefined;
}

export interface DeveloperDocsGuide {
  title: string;
  description: string;
  // Shown above the steps, e.g. that the MCP server cannot do this yet.
  notice?: string | undefined;
  steps: Array<DeveloperDocsStep>;
  sections: Array<DeveloperDocsSection>;
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

// The first records of a type as the list request returns them.
export interface DeveloperDocsSample {
  records: Array<JSONObject>;
  count: number;
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
  // What the page found out about the project (its severities, monitors, ...).
  live?: DeveloperDocsLiveData | undefined;
  // On the API list page: the first record, as the list request returns it.
  sample?: DeveloperDocsSample | undefined;
  /*
   * The rows the page is about, when the model's rows are two products'
   * (CloudResource): the list and count examples ask for them only.
   */
  listQuery?: JSONObject | undefined;
}

export const DEVELOPER_DOCS_IMPORT_LIMIT: number = 100;

// The page's own words, which it translates.
export const DEVELOPER_DOCS_LEARN_MORE_LABEL: string = "Learn more:";
export const DEVELOPER_DOCS_NOT_FOUND_MESSAGE: string =
  "This could not be found. It may have been deleted.";

const TERRAFORM_REGISTRY_DOCS_URL: string =
  "https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs";

// How many records the list example asks for.
export const DEVELOPER_DOCS_LIST_LIMIT: number = 10;

const PLACEHOLDER_NOTE: string =
  "Replace the values in angle brackets with your own.";

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
        "Manage these resources as code with the OneUptime Terraform provider. The examples below are filled in from this project: create new ones, or bring in the ones you already have.",
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
        "List, filter and create these resources with the OneUptime REST API. Every command below runs against this OneUptime and is filled in from this project.",
    },
  },
  [DeveloperDocsPageType.Cli]: {
    [DeveloperDocsScope.View]: {
      title: "CLI",
      description:
        "Read, change and delete this resource from a terminal, a script or an AI agent with the OneUptime CLI. Every command below runs against this OneUptime.",
    },
    [DeveloperDocsScope.List]: {
      title: "CLI",
      description:
        "List, filter and create these resources from a terminal, a script or an AI agent with the OneUptime CLI. Every command below runs against this OneUptime and is filled in from this project.",
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

/*
 * The resource's names as terms of a translated sentence, cased for the
 * middle of a sentence in the reader's language, and the record the page is
 * about when it has a name. The guide's headings and descriptions are whole
 * sentences around these; its code and markdown stay as they are.
 */
function sentenceTerms(context: DeveloperDocsGuideContext): {
  singular: TranslatableTerm;
  plural: TranslatableTerm;
  recordName: string | undefined;
} {
  return {
    singular: translatableTerm(getDeveloperDocsSingularName(context.resource), {
      inSentence: true,
    }),
    plural: translatableTerm(getDeveloperDocsPluralName(context.resource), {
      inSentence: true,
    }),
    recordName: context.record?.displayName || undefined,
  };
}

function getModelType(
  context: DeveloperDocsGuideContext,
): DatabaseBaseModelType {
  return context.resource.modelType;
}

function getLive(context: DeveloperDocsGuideContext): DeveloperDocsLiveData {
  return context.live || getEmptyDeveloperDocsLiveData(new Date());
}

/*
 * What the example builders need: the project, and on a view page the
 * record (and, once its configuration is on the page, its address).
 */
function exampleContext(
  context: DeveloperDocsGuideContext,
  terraformAddress?: string | undefined,
): DeveloperDocsExampleContext {
  return {
    live: getLive(context),
    record: context.record
      ? {
          id: context.record.id,
          displayName: context.record.displayName,
          json: context.record.json,
          terraformAddress,
        }
      : undefined,
  };
}

// Text for one line of a list: no line breaks.
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/*
 * What each field of an example is for. Required fields say so; the rest
 * can be left out. A list rather than a table, so it reads as well on a
 * phone as on a wide screen.
 */
function fieldsList(rows: Array<DeveloperDocsFieldRow>): string {
  if (rows.length === 0) {
    return "";
  }

  return joinParts([
    "What each field is for:",
    rows
      .map((row: DeveloperDocsFieldRow): string => {
        return `- \`${row.name}\`${row.required ? " (required)" : ""}: ${oneLine(row.about)}`;
      })
      .join("\n"),
  ]);
}

function joinParts(parts: Array<string | undefined | null | false>): string {
  return parts
    .filter((part: string | undefined | null | false): part is string => {
      return Boolean(part && part.trim());
    })
    .join("\n\n");
}

function withPlaceholderNote(
  description: string,
  isPlaceholder: boolean,
): string {
  return isPlaceholder ? `${description} ${PLACEHOLDER_NOTE}` : description;
}

/*
 * Terraform.
 */

function connectTerraformStep(
  context: DeveloperDocsGuideContext,
): DeveloperDocsStep {
  const { plural } = nouns(context);

  return {
    title: "Connect Terraform to OneUptime",
    description:
      "Terraform signs in with a project API key, and the provider points it at this OneUptime.",
    markdown: joinParts([
      `Create a key in [Project Settings → Advanced → API Keys](${context.apiKeysUrl}) with permission to manage ${plural}, and make it available in your shell:`,
      codeBlock("bash", getApiKeyExportCommand()),
      "Then put the provider in a `.tf` file in your Terraform project:",
      codeBlock(
        "hcl",
        getTerraformProviderHcl({
          oneuptimeUrl: context.oneuptimeUrl.startsWith("http")
            ? context.oneuptimeUrl
            : null,
          platformVersion: context.platformVersion,
        }),
      ),
    ]),
  };
}

function secretsMarkdown(data: {
  variables: Array<TerraformSecretVariable>;
  omitted?: Array<TerraformOmittedAttribute> | undefined;
  // Attributes Terraform cannot set, because their name is one of its own.
  reserved?: Array<TerraformOmittedAttribute> | undefined;
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

  const omitted: Array<TerraformOmittedAttribute> = data.omitted || [];

  if (omitted.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }

    lines.push(
      `Left out because they are secret: ${omitted
        .map((item: TerraformOmittedAttribute): string => {
          return `\`${item.attributeName}\``;
        })
        .join(", ")}. Terraform leaves them as they are in OneUptime.`,
    );
  }

  const reserved: Array<TerraformOmittedAttribute> = data.reserved || [];

  if (reserved.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }

    lines.push(
      `Left out because Terraform reserves the name for its own use: ${reserved
        .map((item: TerraformOmittedAttribute): string => {
          return `\`${item.attributeName}\``;
        })
        .join(
          ", ",
        )}. Change it in OneUptime instead; Terraform leaves it as it is.`,
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

  if (typeName === "oneuptime_monitor") {
    links.push({
      title: "Monitor steps",
      url: docsUrl(context, "terraform/monitor-steps"),
    });
  }

  if (typeName) {
    links.push({
      title: translateTemplate("{{type}} reference", { type: typeName }),
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

/*
 * Recipes as one tab each: what it sets up, then the configuration. A
 * recipe on a resource's own page refers to that resource by its address,
 * so it goes in the same configuration.
 */
function recipesSection(data: {
  title: string;
  description: string;
  recipes: Array<DeveloperDocsTerraformRecipe>;
}): Array<DeveloperDocsSection> {
  if (data.recipes.length === 0) {
    return [];
  }

  return [
    {
      title: data.title,
      description: data.description,
      variants: data.recipes.map(
        (recipe: DeveloperDocsTerraformRecipe): SetupGuideStepVariant => {
          return {
            label: recipe.title,
            markdown: joinParts([
              withPlaceholderNote(recipe.description, recipe.isPlaceholder),
              codeBlock("hcl", recipe.hcl),
              secretsMarkdown({ variables: recipe.variables }),
            ]),
          };
        },
      ),
    },
  ];
}

// Names for the ids in a record's configuration: "# Critical Incident".
function describeIdFor(
  context: DeveloperDocsGuideContext,
): (id: string) => string | undefined {
  const names: Record<string, string> = getLive(context).namesById;

  return (id: string): string | undefined => {
    return names[id];
  };
}

function getTerraformResourceGuide(
  context: DeveloperDocsGuideContext,
  record: DeveloperDocsRecord,
): DeveloperDocsGuide {
  const { singular } = nouns(context);
  const terms: ReturnType<typeof sentenceTerms> = sentenceTerms(context);
  const copy: DeveloperDocsGuideCopy = guideCopy(
    DeveloperDocsPageType.Terraform,
    context,
  );
  const modelType: DatabaseBaseModelType = getModelType(context);
  const typeName: string | null = getTerraformTypeName(modelType);
  const config: TerraformResourceConfig | null = getTerraformResourceConfig({
    modelType,
    json: record.json,
    displayName: record.displayName,
    describeId: describeIdFor(context),
  });

  if (!config) {
    return getTerraformUnsupportedGuide(context, typeName);
  }

  const recipes: Array<DeveloperDocsTerraformRecipe> = getTerraformRecipes({
    modelType,
    scope: "view",
    context: exampleContext(context, config.address),
  });

  return {
    ...copy,
    steps: [
      connectTerraformStep(context),
      {
        title: terms.recordName
          ? translateTemplate('Add the {{singular}} "{{name}}"', {
              singular: terms.singular,
              name: terms.recordName,
            })
          : translateTemplate("Add this {{singular}}", {
              singular: terms.singular,
            }),
        description: translateTemplate(
          "Its settings as they are now, and an import block: it tells Terraform the {{singular}} already exists, so Terraform adopts it instead of creating a copy. Comments name the records its IDs point at.",
          { singular: terms.singular },
        ),
        markdown: joinParts([
          codeBlock("hcl", config.hcl),
          secretsMarkdown({
            variables: config.variables,
            omitted: config.omittedSecrets,
            reserved: config.omittedReserved,
          }),
        ]),
      },
      {
        title: "Import it",
        description: translateTemplate(
          "The plan shows the {{singular}} being imported and nothing to change. Apply it, and the {{singular}} is managed by Terraform from then on.",
          { singular: terms.singular },
        ),
        markdown: codeBlock(
          "bash",
          "terraform init\nterraform plan\nterraform apply",
        ),
      },
    ],
    sections: recipesSection({
      title: "Build on it",
      description: terms.recordName
        ? translateTemplate(
            'What people often set up next to the {{singular}} "{{name}}". Each one refers to it by its address in the configuration above, so put it in the same file.',
            { singular: terms.singular, name: terms.recordName },
          )
        : translateTemplate(
            "What people often set up next to this {{singular}}. Each one refers to it by its address in the configuration above, so put it in the same file.",
            { singular: terms.singular },
          ),
      recipes,
    }),
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
  const { plural } = sentenceTerms(context);
  const copy: DeveloperDocsGuideCopy = guideCopy(
    DeveloperDocsPageType.Terraform,
    context,
  );

  return {
    ...copy,
    notice: typeName
      ? translateTemplate(
          "The Terraform provider cannot create or change {{plural}}. You can still read them with the `{{typeName}}` data source.",
          { plural, typeName },
        )
      : translateTemplate(
          "The Terraform provider cannot create or change {{plural}}.",
          { plural },
        ),
    steps: [connectTerraformStep(context)],
    sections: [],
    topics: [],
    links: terraformLinks(context, null),
  };
}

// Looking one up with a data source: by name where the provider can, else by id.
function lookupTopic(
  context: DeveloperDocsGuideContext,
): SetupGuideTopic | null {
  const modelType: DatabaseBaseModelType = getModelType(context);
  const typeName: string | null = getTerraformTypeName(modelType);
  const { singular } = nouns(context);
  const first: TerraformImportTarget | undefined = context.importTargets?.[0];

  if (!typeName) {
    return null;
  }

  const byName: string | null = getTerraformDataSourceByNameHcl({
    modelType,
    exampleName: first?.displayName || `My ${singular}`,
  });

  if (byName) {
    return {
      title: "Look one up by name",
      summary: "A data source",
      markdown: [
        `To use ${withIndefiniteArticle(singular)} that stays managed in OneUptime, read it with a data source. The name must match exactly one:`,
        "",
        codeBlock("hcl", byName),
      ].join("\n"),
    };
  }

  const localName: string = getTerraformShortTypeName(typeName);

  return {
    title: "Look one up by ID",
    summary: "A data source",
    markdown: [
      `To use ${withIndefiniteArticle(singular)} that stays managed in OneUptime, read it with a data source, by its ID:`,
      "",
      codeBlock(
        "hcl",
        `data "${typeName}" "${localName}" {\n  id = "${first?.id || `<${singular} id>`}"\n}\n`,
      ),
    ].join("\n"),
  };
}

function getTerraformCollectionGuide(
  context: DeveloperDocsGuideContext,
): DeveloperDocsGuide {
  const { singular, plural } = nouns(context);
  const copy: DeveloperDocsGuideCopy = guideCopy(
    DeveloperDocsPageType.Terraform,
    context,
  );
  const modelType: DatabaseBaseModelType = getModelType(context);
  const profile: DeveloperDocsProfile = getDeveloperDocsProfile(modelType);
  const typeName: string | null = getTerraformTypeName(modelType);
  const examples: DeveloperDocsExampleContext = exampleContext(context);
  const example: DeveloperDocsTerraformExample | null =
    getTerraformCreateExample({ modelType, context: examples });
  const importHcl: string | null = getTerraformImportBlocksHcl({
    modelType,
    targets: context.importTargets || [],
  });

  if (!example && !profile.terraformCannotCreate) {
    return getTerraformUnsupportedGuide(context, typeName);
  }

  const targets: Array<TerraformImportTarget> = context.importTargets || [];
  const totalCount: number = context.totalCount ?? targets.length;
  const fileName: string = `${getTerraformShortTypeName(typeName || singular)}s.tf`;
  const createTitle: string = getCreateTitle({
    modelType,
    singularName: getDeveloperDocsSingularName(context.resource),
  });

  const createStep: DeveloperDocsStep = example
    ? {
        title: createTitle,
        description: withPlaceholderNote(
          example.usesProjectData
            ? `The fields most ${plural} set, filled in from this project.`
            : `The fields most ${plural} set.`,
          example.isPlaceholder,
        ),
        markdown: joinParts([
          profile.createNote,
          codeBlock("hcl", example.hcl),
          secretsMarkdown({ variables: example.variables }),
          codeBlock("bash", "terraform init\nterraform apply"),
          fieldsList(example.rows),
        ]),
      }
    : {
        title: createTitle,
        markdown: profile.terraformCannotCreate,
      };

  let importMarkdown: string;

  if (!importHcl) {
    importMarkdown = `There are no ${plural} in this project yet.`;
  } else {
    importMarkdown = joinParts([
      totalCount > targets.length
        ? `Import blocks for the first ${targets.length} of your ${totalCount} ${plural}:`
        : `An import block for each of your ${plural}:`,
      codeBlock("hcl", importHcl),
      "Then let Terraform write their configuration, review it, and apply:",
      codeBlock(
        "bash",
        `terraform plan -generate-config-out=${fileName}\nterraform apply`,
      ),
    ]);
  }

  const lookup: SetupGuideTopic | null = lookupTopic(context);

  return {
    ...copy,
    steps: [
      connectTerraformStep(context),
      createStep,
      {
        title: translateTemplate("Bring in the {{plural}} you already have", {
          plural: sentenceTerms(context).plural,
        }),
        description:
          "Terraform adopts them as they are, without creating copies.",
        markdown: importMarkdown,
      },
    ],
    sections: recipesSection({
      title: "Common setups",
      description: translateTemplate(
        "Ready-made configurations for {{plural}}, filled in from this project.",
        { plural: sentenceTerms(context).plural },
      ),
      recipes: getTerraformRecipes({
        modelType,
        scope: "list",
        context: examples,
      }),
    }),
    topics: [...(lookup ? [lookup] : []), OPEN_TOFU_TOPIC],
    links: terraformLinks(context, typeName),
  };
}

/*
 * API.
 */

function apiKeyStep(context: DeveloperDocsGuideContext): DeveloperDocsStep {
  const { plural } = nouns(context);

  return {
    title: "Create an API key",
    description:
      "Requests sign in with a project API key, sent in the ApiKey header. The project comes from the key.",
    markdown: [
      `Create one in [Project Settings → Advanced → API Keys](${context.apiKeysUrl}) with permission to manage ${plural}, then make it available in your shell:`,
      "",
      codeBlock("bash", getApiKeyExportCommand()),
    ].join("\n"),
  };
}

function apiUrl(context: DeveloperDocsGuideContext, path: string): string {
  return `${getApiBaseUrl(context.oneuptimeUrl)}${path}`;
}

function curl(data: {
  method: ApiExample["method"];
  url: string;
  body?: JSONObject | undefined;
}): string {
  return codeBlock("bash", getCurlCommand(data));
}

function responseBlock(json: unknown): string {
  return joinParts([
    "It answers with:",
    codeBlock("json", JSON.stringify(json, null, 2)),
  ]);
}

// Only the fields a request asked for, as the response carries them.
function pickFields(json: JSONObject, select: JSONObject): JSONObject {
  const picked: JSONObject = {};

  for (const key of Object.keys(select)) {
    if (json[key] !== undefined) {
      picked[key] = json[key] as JSONObject;
    }
  }

  return picked;
}

function apiLinks(context: DeveloperDocsGuideContext): Array<SetupGuideLink> {
  return [
    {
      title: translateTemplate("{{name}} API reference", {
        name: translatableTerm(getDeveloperDocsSingularName(context.resource)),
      }),
      url: getApiReferenceUrl({
        modelType: getModelType(context),
        oneuptimeUrl: context.oneuptimeUrl,
      }),
    },
    {
      title: "API documentation",
      url: docsUrl(context, "api-reference/api-reference"),
    },
  ];
}

/*
 * Every request the API has for the resource, as a table: the quickest
 * answer to "what can I do with these over the API, and where?".
 */
function endpointsSection(
  context: DeveloperDocsGuideContext,
): Array<DeveloperDocsSection> {
  const modelType: DatabaseBaseModelType = getModelType(context);
  const path: string | null = getModelApiPath(modelType);

  if (!path || !isModelInPublicApi(modelType)) {
    return [];
  }

  const operations: TerraformModelOperations =
    getTerraformModelOperations(modelType);
  const id: string = context.record?.id || "{id}";
  const { singular, plural } = nouns(context);
  const rows: Array<[boolean, string, string]> = [
    [operations.canRead, `List ${plural}`, `POST ${path}/get-list`],
    [operations.canRead, `Count ${plural}`, `POST ${path}/count`],
    [operations.canRead, `Read one`, `POST ${path}/${id}/get-item`],
    [
      operations.canCreate,
      `Create ${withIndefiniteArticle(singular)}`,
      `POST ${path}`,
    ],
    [operations.canUpdate, `Change one`, `PUT ${path}/${id}`],
    [operations.canDelete, `Delete one`, `DELETE ${path}/${id}`],
  ];

  return [
    {
      title: "Endpoints",
      description: translateTemplate(
        "Every request below goes to {{url}}, with the ApiKey header.",
        { url: getApiBaseUrl(context.oneuptimeUrl) },
      ),
      markdown: rows
        .filter((row: [boolean, string, string]): boolean => {
          return row[0];
        })
        .map((row: [boolean, string, string]): string => {
          return `- ${row[1]}: \`${row[2]}\``;
        })
        .join("\n"),
    },
  ];
}

const QUERY_TOPIC: SetupGuideTopic = {
  title: "Filter, sort and choose fields",
  summary: "query, select and sort",
  markdown: [
    "List and count requests take a `query`. A field and a value matches that value; an object with a `_type` is an operator:",
    "",
    '- `{"_type": "Search", "value": "api"}`: text that contains the value.',
    '- `{"_type": "NotEqual", "value": "..."}`: anything but the value.',
    '- `{"_type": "GreaterThan", "value": "2026-01-01T00:00:00.000Z"}`: later dates or larger numbers. `LessThan`, `GreaterThanOrEqual` and `LessThanOrEqual` work the same way.',
    '- `{"_type": "InBetween", "startValue": "...", "endValue": "..."}`: dates or numbers in a range.',
    '- `{"_type": "Includes", "value": ["...", "..."]}`: any of the values.',
    '- A plain list on a list relation, such as `"labels": ["..."]`: records with any of those labels (or monitors, teams, ...).',
    '- `{"_type": "IsNull"}` and `{"_type": "NotNull"}`: empty, or set.',
    "",
    '`select` picks the fields to return (`_id` always comes back), and `sort` orders them, `ASC` or `DESC`. Dates and ids come back wrapped, as `{"_type": "DateTime", "value": "..."}` and `{"_type": "ObjectID", "value": "..."}`.',
  ].join("\n"),
};

function paginationTopic(context: DeveloperDocsGuideContext): SetupGuideTopic {
  const { plural } = nouns(context);

  return {
    title: "Page through all of them",
    summary: "skip and limit",
    markdown: [
      `\`limit\` (up to ${LIMIT_PER_PROJECT}) says how many ${plural} come back, and \`skip\` how many to pass over first. The response's \`count\` is how many match the query in all, so keep asking with a larger \`skip\` until you have them all: \`skip=0\`, then \`skip=${DEVELOPER_DOCS_LIST_LIMIT}\`, \`skip=${DEVELOPER_DOCS_LIST_LIMIT * 2}\` and so on.`,
    ].join("\n"),
  };
}

function getApiResourceGuide(
  context: DeveloperDocsGuideContext,
  record: DeveloperDocsRecord,
): DeveloperDocsGuide {
  const modelType: DatabaseBaseModelType = getModelType(context);
  const path: string | null = getModelApiPath(modelType);
  const operations: TerraformModelOperations =
    getTerraformModelOperations(modelType);
  const examples: DeveloperDocsExampleContext = exampleContext(context);

  if (!path || !isModelInPublicApi(modelType)) {
    return {
      ...guideCopy(DeveloperDocsPageType.Api, context),
      notice: translateTemplate("The REST API does not cover {{plural}}.", {
        plural: sentenceTerms(context).plural,
      }),
      steps: [],
      sections: [],
      topics: [],
      links: apiLinks(context),
    };
  }

  const itemUrl: string = apiUrl(context, `${path}/${record.id}`);
  const select: JSONObject = getApiReadSelect(modelType);
  const readJson: JSONObject = pickFields(record.json, select);
  const update: { data: JSONObject; description: string } | null =
    operations.canUpdate
      ? getApiUpdateExample({ modelType, context: examples })
      : null;
  const steps: Array<DeveloperDocsStep> = [apiKeyStep(context)];

  if (operations.canRead) {
    steps.push({
      title: "Read it",
      description: translateTemplate(
        "Ask for the fields you need in select. This {{singular}}'s ID is {{id}}.",
        { singular: sentenceTerms(context).singular, id: record.id },
      ),
      markdown: joinParts([
        curl({ method: "POST", url: `${itemUrl}/get-item`, body: { select } }),
        Object.keys(readJson).length > 1 ? responseBlock(readJson) : "",
      ]),
    });
  }

  if (update) {
    steps.push({
      title: "Change it",
      description: update.description,
      markdown: curl({
        method: "PUT",
        url: itemUrl,
        body: { data: update.data },
      }),
    });
  }

  if (operations.canDelete) {
    steps.push({
      title: "Delete it",
      description: translateTemplate(
        "This deletes the {{singular}} for good.",
        {
          singular: sentenceTerms(context).singular,
        },
      ),
      markdown: curl({ method: "DELETE", url: itemUrl }),
    });
  }

  const tasks: Array<DeveloperDocsApiTask> = getApiTasks({
    modelType,
    scope: "view",
    context: examples,
  });

  return {
    ...guideCopy(DeveloperDocsPageType.Api, context),
    steps,
    sections: [...tasksSection(context, tasks), ...endpointsSection(context)],
    topics: [QUERY_TOPIC],
    links: apiLinks(context),
  };
}

function tasksSection(
  context: DeveloperDocsGuideContext,
  tasks: Array<DeveloperDocsApiTask>,
): Array<DeveloperDocsSection> {
  const variants: Array<SetupGuideStepVariant> = tasks
    .map((task: DeveloperDocsApiTask): SetupGuideStepVariant | null => {
      const path: string | null = getModelApiPath(task.modelType);

      if (!path) {
        return null;
      }

      return {
        label: task.title,
        markdown: joinParts([
          withPlaceholderNote(task.description, task.isPlaceholder),
          curl(
            task.operation === "create"
              ? { method: "POST", url: apiUrl(context, path), body: task.body }
              : {
                  method: "POST",
                  url: apiUrl(
                    context,
                    `${path}/get-list?skip=0&limit=${DEVELOPER_DOCS_LIST_LIMIT}`,
                  ),
                  body: task.body,
                },
          ),
        ]),
      };
    })
    .filter(
      (
        variant: SetupGuideStepVariant | null,
      ): variant is SetupGuideStepVariant => {
        return variant !== null;
      },
    );

  if (variants.length === 0) {
    return [];
  }

  return [
    {
      title: "Common tasks",
      description: sentenceTerms(context).recordName
        ? translateTemplate(
            'What people do most with the {{singular}} "{{name}}" over the API, filled in with this project\'s own records.',
            {
              singular: sentenceTerms(context).singular,
              name: sentenceTerms(context).recordName as string,
            },
          )
        : translateTemplate(
            "What people do most with this {{singular}} over the API, filled in with this project's own records.",
            { singular: sentenceTerms(context).singular },
          ),
      variants,
    },
  ];
}

function getApiCollectionGuide(
  context: DeveloperDocsGuideContext,
): DeveloperDocsGuide {
  const { plural } = nouns(context);
  const modelType: DatabaseBaseModelType = getModelType(context);
  const path: string | null = getModelApiPath(modelType);
  const operations: TerraformModelOperations =
    getTerraformModelOperations(modelType);
  const examples: DeveloperDocsExampleContext = exampleContext(context);

  if (!path || !isModelInPublicApi(modelType)) {
    return {
      ...guideCopy(DeveloperDocsPageType.Api, context),
      notice: translateTemplate("The REST API does not cover {{plural}}.", {
        plural: sentenceTerms(context).plural,
      }),
      steps: [],
      sections: [],
      topics: [],
      links: apiLinks(context),
    };
  }

  const collectionUrl: string = apiUrl(context, path);
  const select: JSONObject = getApiReadSelect(modelType);
  const steps: Array<DeveloperDocsStep> = [apiKeyStep(context)];
  const topics: Array<SetupGuideTopic> = [];

  if (operations.canRead) {
    const sample: DeveloperDocsSample | undefined = context.sample;

    steps.push({
      title: translateTemplate("List your {{plural}}", {
        plural: sentenceTerms(context).plural,
      }),
      description: translateTemplate("Newest first, {{limit}} at a time.", {
        limit: DEVELOPER_DOCS_LIST_LIMIT,
      }),
      markdown: joinParts([
        curl({
          method: "POST",
          url: `${collectionUrl}/get-list?skip=0&limit=${DEVELOPER_DOCS_LIST_LIMIT}`,
          body: {
            ...(context.listQuery ? { query: context.listQuery } : {}),
            select,
            sort: { createdAt: "DESC" },
          },
        }),
        sample
          ? responseBlock({
              data: sample.records
                .slice(0, 1)
                .map((record: JSONObject): JSONObject => {
                  return pickFields(record, select);
                }),
              count: sample.count,
              skip: 0,
              limit: DEVELOPER_DOCS_LIST_LIMIT,
            })
          : "",
        sample && sample.count > 1
          ? `Shown with the first of your ${sample.count} ${plural}; \`count\` is how many there are in all.`
          : "",
      ]),
    });

    const filters: Array<DeveloperDocsApiFilter> = getApiFilters({
      modelType,
      context: examples,
    });

    if (filters.length > 0) {
      steps.push({
        title: "Find the ones you need",
        description:
          "Add a query to the same request. Each of these is filled in from this project.",
        variants: filters.map(
          (filter: DeveloperDocsApiFilter): SetupGuideStepVariant => {
            return {
              label: filter.title,
              markdown: joinParts([
                filter.description,
                curl({
                  method: "POST",
                  url: `${collectionUrl}/get-list?skip=0&limit=${DEVELOPER_DOCS_LIST_LIMIT}`,
                  body: filter.body,
                }),
              ]),
            };
          },
        ),
      });
    }

    topics.push(paginationTopic(context));
    topics.push(QUERY_TOPIC);
    topics.push({
      title: translateTemplate("Count your {{plural}}", {
        plural: sentenceTerms(context).plural,
      }),
      summary: "count",
      markdown: joinParts([
        "Takes the same query as a list, and answers with how many match.",
        curl({
          method: "POST",
          url: `${collectionUrl}/count`,
          body: { query: context.listQuery || {} },
        }),
        sample ? responseBlock({ count: sample.count }) : "",
      ]),
    });
  }

  if (operations.canCreate) {
    const create: DeveloperDocsApiBody = getApiCreateExample({
      modelType,
      context: examples,
    });
    const profile: DeveloperDocsProfile = getDeveloperDocsProfile(modelType);

    if (Object.keys(create.body).length > 0) {
      steps.push({
        title: getCreateTitle({
          modelType,
          singularName: getDeveloperDocsSingularName(context.resource),
        }),
        description: withPlaceholderNote(
          `${
            create.usesProjectData
              ? `The fields most ${plural} set, filled in from this project.`
              : `The fields most ${plural} set.`
          } It answers with the new one, and its _id.`,
          create.isPlaceholder,
        ),
        markdown: joinParts([
          profile.createNote,
          curl({
            method: "POST",
            url: collectionUrl,
            body: { data: create.body },
          }),
          fieldsList(create.rows),
        ]),
      });
    }
  }

  return {
    ...guideCopy(DeveloperDocsPageType.Api, context),
    steps,
    sections: endpointsSection(context),
    topics,
    links: apiLinks(context),
  };
}

/*
 * AI Assistants.
 */

function mcpToolsTopic(
  tools: McpToolNames,
  plural: string,
  singular: string,
): SetupGuideTopic {
  return {
    title: "The tools your assistant uses",
    summary: translateTemplate("{{get}}, {{list}}, {{update}} and more", {
      get: tools.get,
      list: tools.list,
      update: tools.update,
    }),
    markdown: [
      `| Tool | What it does |`,
      `| --- | --- |`,
      `| \`${tools.get}\` | Reads one ${singular} |`,
      `| \`${tools.list}\` | Lists and searches ${plural} |`,
      `| \`${tools.count}\` | Counts ${plural} |`,
      `| \`${tools.create}\` | Creates ${withIndefiniteArticle(singular)} |`,
      `| \`${tools.update}\` | Changes ${withIndefiniteArticle(singular)} |`,
      `| \`${tools.delete}\` | Deletes ${withIndefiniteArticle(singular)} (your assistant asks first) |`,
      "",
      "A client you authorize as read only can use the first three.",
    ].join("\n"),
  };
}

function getAiGuide(context: DeveloperDocsGuideContext): DeveloperDocsGuide {
  const { singular, plural } = nouns(context);
  const mcpUrl: string = getMcpServerUrl(context.oneuptimeUrl);
  const tools: McpToolNames | null = getMcpToolNames(getModelType(context));
  const prompts: Array<string> = getAssistantPrompts({
    modelType: getModelType(context),
    singularName: getDeveloperDocsSingularName(context.resource),
    pluralName: getDeveloperDocsPluralName(context.resource),
    displayName: context.record?.displayName,
    id: context.record?.id,
    apiReferenceUrl: getApiReferenceUrl({
      modelType: getModelType(context),
      oneuptimeUrl: context.oneuptimeUrl,
    }),
  });
  const variants: Array<SetupGuideStepVariant> = getMcpClientSetups(mcpUrl).map(
    (setup: McpClientSetup): SetupGuideStepVariant => {
      return { label: setup.label, markdown: setup.markdown };
    },
  );
  const askTitle: string = context.record
    ? sentenceTerms(context).recordName
      ? translateTemplate('Ask about the {{singular}} "{{name}}"', {
          singular: sentenceTerms(context).singular,
          name: sentenceTerms(context).recordName as string,
        })
      : translateTemplate("Ask about this {{singular}}", {
          singular: sentenceTerms(context).singular,
        })
    : translateTemplate("Ask about your {{plural}}", {
        plural: sentenceTerms(context).plural,
      });
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
            ? translateTemplate(
                "Try one of these. Each names the {{singular}} and its ID, so the assistant finds it straight away.",
                { singular: sentenceTerms(context).singular },
              )
            : "Try one of these.",
          prompts,
        },
      ],
      sections: [],
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
    notice: context.record
      ? translateTemplate(
          "OneUptime's MCP server does not have tools for {{plural}} yet. An assistant that can run commands (Claude Code, Cursor, or GitHub Copilot in agent mode) can still work with this {{singular}} through the REST API.",
          {
            plural: sentenceTerms(context).plural,
            singular: sentenceTerms(context).singular,
          },
        )
      : translateTemplate(
          "OneUptime's MCP server does not have tools for {{plural}} yet. An assistant that can run commands (Claude Code, Cursor, or GitHub Copilot in agent mode) can still work with your {{plural}} through the REST API.",
          { plural: sentenceTerms(context).plural },
        ),
    steps: [
      {
        ...apiKeyStep(context),
        description:
          "Your assistant reads the key from the environment, so it never appears in the chat.",
      },
      {
        title: askTitle,
        description: translateTemplate(
          "Start your assistant in the same shell, so it can use the key in {{variable}}, then try one of these.",
          { variable: ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE },
        ),
        prompts,
      },
    ],
    sections: [],
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

/*
 * CLI.
 *
 * The API page's requests as commands of the OneUptime CLI: the same
 * create, filters, change and tasks, from the same example data, so each
 * command is filled in from the project and sends what the API page's curl
 * sends (packages/CLI/Tests/DeveloperDocsCommands runs them through the
 * CLI). A dashboard button the CLI has a command for - acknowledge,
 * resolve, a note - is written as that command.
 */

const CLI_DOCS_PATH: string = "cli/index";
const CLI_AGENTS_DOCS_PATH: string = "cli/ai-agents";
const CLI_REFERENCE_DOCS_PATH: string = "cli/command-reference";

function cliLinks(context: DeveloperDocsGuideContext): Array<SetupGuideLink> {
  return [
    { title: "CLI", url: docsUrl(context, CLI_DOCS_PATH) },
    {
      title: "Command reference",
      url: docsUrl(context, CLI_REFERENCE_DOCS_PATH),
    },
    {
      title: "The CLI for AI agents",
      url: docsUrl(context, CLI_AGENTS_DOCS_PATH),
    },
  ];
}

function installCliStep(context: DeveloperDocsGuideContext): DeveloperDocsStep {
  return {
    title: "Install the CLI",
    description:
      "It runs on Node.js 22 or later. The script installs the CLI of this OneUptime's version, so its commands match the resources this OneUptime has.",
    variants: [
      {
        label: "Install script",
        markdown: joinParts([
          codeBlock(
            "bash",
            getCliInstallScriptCommands(context.oneuptimeUrl),
          ),
          translateText(INSTALL_SCRIPT_READ_FIRST_NOTE) ||
            INSTALL_SCRIPT_READ_FIRST_NOTE,
        ]),
      },
      {
        label: "npm",
        markdown: codeBlock(
          "bash",
          `${getCliNpmInstallCommand(context.platformVersion)}\noneuptime --version`,
        ),
      },
    ],
  };
}

function connectCliStep(context: DeveloperDocsGuideContext): DeveloperDocsStep {
  const { plural } = nouns(context);

  return {
    title: "Connect it to OneUptime",
    description:
      "The CLI signs in with a project API key. The project comes from the key.",
    markdown: joinParts([
      `Create a key in [Project Settings → Advanced → API Keys](${context.apiKeysUrl}) with permission to manage ${plural}. Then make it and this OneUptime's address available in your shell, and check that OneUptime takes them:`,
      codeBlock("bash", getCliConnectCommands(context.oneuptimeUrl)),
      `To save them on this machine instead, run \`${getCliLoginCommand(context.oneuptimeUrl)}\`.`,
    ]),
  };
}

// "- `--title` (required): Title of this incident."
function cliFieldsList(
  modelType: DatabaseBaseModelType,
  rows: Array<DeveloperDocsFieldRow>,
): string {
  if (rows.length === 0) {
    return "";
  }

  const flags: Map<string, CliFieldFlag> = new Map(
    getCliFieldFlags(modelType).map(
      (flag: CliFieldFlag): [string, CliFieldFlag] => {
        return [flag.columnName, flag];
      },
    ),
  );

  return joinParts([
    "What each flag is for:",
    rows
      .map((row: DeveloperDocsFieldRow): string => {
        const flag: CliFieldFlag | undefined = flags.get(row.name);
        const name: string = flag
          ? flag.person
            ? `\`${flag.flag}\` or \`${flag.person.flag}\``
            : `\`${flag.flag}\``
          : `\`${row.name}\` in \`--data\``;

        return `- ${name}${row.required ? " (required)" : ""}: ${oneLine(row.about)}`;
      })
      .join("\n"),
  ]);
}

/*
 * The viewer's own address by their ID, so a person the examples name is
 * named by it (--user-email), as the Terraform pages name them.
 */
function emailsByIdOf(
  context: DeveloperDocsGuideContext,
): Record<string, string> {
  const live: DeveloperDocsLiveData = getLive(context);

  return live.currentUserId && live.currentUserEmail
    ? { [live.currentUserId]: live.currentUserEmail }
    : {};
}

// What the CLI prints for a list: the records, without the API's envelope.
function cliListResponse(
  records: Array<JSONObject>,
  select: JSONObject,
): string {
  return responseBlock(
    records.map((record: JSONObject): JSONObject => {
      return pickFields(record, select);
    }),
  );
}

/*
 * Every command the CLI has for the resource, one a line: the quickest
 * answer to "what can I do with these from a terminal?".
 */
function cliCommandsSection(
  context: DeveloperDocsGuideContext,
): Array<DeveloperDocsSection> {
  const modelType: DatabaseBaseModelType = getModelType(context);
  const operations: Array<CliOperation> = getCliDatabaseOperations(modelType);

  if (operations.length === 0) {
    return [];
  }

  const command: string = getCliCommandOf(modelType);
  const id: string = context.record?.id || "<id>";
  const { singular, plural } = nouns(context);
  const lines: Array<string> = [];

  for (const operation of operations) {
    switch (operation) {
      case CliOperation.List:
        lines.push(`- List ${plural}: \`oneuptime ${command} list\``);
        break;
      case CliOperation.Get:
        lines.push(`- Read one: \`oneuptime ${command} get ${id}\``);
        break;
      case CliOperation.Create:
        lines.push(
          `- Create ${withIndefiniteArticle(singular)}: \`oneuptime ${command} create\``,
        );
        break;
      case CliOperation.Update:
        lines.push(`- Change one: \`oneuptime ${command} update ${id}\``);
        break;
      case CliOperation.Delete:
        lines.push(`- Delete one: \`oneuptime ${command} delete ${id}\``);
        break;
      case CliOperation.Count:
        lines.push(`- Count ${plural}: \`oneuptime ${command} count\``);
        break;
    }
  }

  lines.push(`- Its fields and flags: \`oneuptime ${command} fields\``);

  const actionLabels: Readonly<Record<CliAction, string>> = {
    [CliAction.Acknowledge]: "Acknowledge one",
    [CliAction.Resolve]: "Resolve one",
    [CliAction.Start]: "Start one",
    [CliAction.End]: "End one",
    [CliAction.AddNote]: "Add a note",
  };

  for (const action of getCliActions(getTableName(modelType))) {
    lines.push(
      `- ${actionLabels[action]}: \`oneuptime ${command} ${action} ${id}\``,
    );
  }

  return [
    {
      title: "Commands",
      description:
        "Every command the CLI has for these. Add --help to any of them for its flags.",
      markdown: lines.join("\n"),
    },
  ];
}

/*
 * A task as the CLI writes it: the dashboard button's own command where
 * the CLI has one (acknowledge, resolve, a note), else the create or list
 * the API page sends.
 */
function cliTaskExample(
  context: DeveloperDocsGuideContext,
  task: DeveloperDocsApiTask,
): CliExample | null {
  const modelType: DatabaseBaseModelType = getModelType(context);
  const tableName: string = getTableName(modelType);
  const record: DeveloperDocsRecord | undefined = context.record;
  const data: JSONObject = (task.body["data"] as JSONObject) || {};

  if (record && task.operation === "create") {
    const machine: CliStateMachine | undefined = getCliStateMachine(tableName);
    const change: CliStateChange | undefined =
      machine && task.modelType === machine.timelineModelType
        ? machine.changes.find((candidate: CliStateChange): boolean => {
            return (
              task.liveFlags[machine.stateColumn] === candidate.stateFlag
            );
          })
        : undefined;

    if (change && getCliActions(tableName).includes(change.action)) {
      return getCliActionExample({
        modelType,
        action: change.action,
        id: record.id,
      });
    }

    const notes: CliNoteTarget | undefined = getCliNoteTarget(tableName);
    const isInternal: boolean =
      Boolean(notes) && task.modelType === notes?.internalNoteModelType;
    const isPublic: boolean =
      Boolean(notes?.publicNoteModelType) &&
      task.modelType === notes?.publicNoteModelType;

    if (
      (isInternal || isPublic) &&
      getCliActions(tableName).includes(CliAction.AddNote)
    ) {
      return getCliActionExample({
        modelType,
        action: CliAction.AddNote,
        id: record.id,
        note: String(data[CLI_NOTE_COLUMN] || ""),
        isPublic,
      });
    }
  }

  if (getCliDatabaseOperations(task.modelType).length === 0) {
    return null;
  }

  if (task.operation === "create") {
    return getCliCreateExample({
      modelType: task.modelType,
      values: data,
      emailsById: emailsByIdOf(context),
    });
  }

  return getCliListExample({
    modelType: task.modelType,
    query: task.body["query"] as JSONObject | undefined,
    select: task.body["select"] as JSONObject | undefined,
    sort: task.body["sort"] as JSONObject | undefined,
    limit: DEVELOPER_DOCS_LIST_LIMIT,
  });
}

function cliTasksSection(
  context: DeveloperDocsGuideContext,
  tasks: Array<DeveloperDocsApiTask>,
): Array<DeveloperDocsSection> {
  const variants: Array<SetupGuideStepVariant> = tasks
    .map((task: DeveloperDocsApiTask): SetupGuideStepVariant | null => {
      const command: CliExample | null = cliTaskExample(context, task);

      if (!command) {
        return null;
      }

      return {
        label: task.title,
        markdown: joinParts([
          withPlaceholderNote(task.description, task.isPlaceholder),
          codeBlock("bash", command.command),
        ]),
      };
    })
    .filter(
      (
        variant: SetupGuideStepVariant | null,
      ): variant is SetupGuideStepVariant => {
        return variant !== null;
      },
    );

  if (variants.length === 0) {
    return [];
  }

  const terms: ReturnType<typeof sentenceTerms> = sentenceTerms(context);

  return [
    {
      title: "Common tasks",
      description: terms.recordName
        ? translateTemplate(
            'What people do most with the {{singular}} "{{name}}" from the command line, filled in with this project\'s own records.',
            { singular: terms.singular, name: terms.recordName },
          )
        : translateTemplate(
            "What people do most with this {{singular}} from the command line, filled in with this project's own records.",
            { singular: terms.singular },
          ),
      variants,
    },
  ];
}

/*
 * When an agent should use the CLI, and when the MCP server: the page the
 * docs have on it, in short (cli/ai-agents).
 */
function cliAgentsTopic(context: DeveloperDocsGuideContext): SetupGuideTopic {
  const command: string = getCliCommandOf(getModelType(context));

  return {
    title: "Use it from an AI agent",
    summary: "The CLI or the MCP server",
    markdown: joinParts([
      "An agent that runs commands - Claude Code, Cursor, GitHub Copilot in agent mode, a CI job - can work with OneUptime through the CLI instead of the MCP server. It installs with the steps above and reads the key from `ONEUPTIME_API_KEY`, so the key never appears in a chat.",
      "Use the MCP server for an assistant you chat with, signed in as you. Use the CLI for an agent that runs commands in a terminal, a script or a pipeline, or where no MCP client is.",
      "Tell it to add `--json` to every command: it prints JSON, and errors come as one JSON object on standard error. These show it what it can do:",
      codeBlock(
        "bash",
        [
          "oneuptime resources --json",
          `oneuptime ${command} fields --json`,
          `oneuptime ${command} --help`,
        ].join("\n"),
      ),
    ]),
  };
}

const CLI_SCRIPTS_TOPIC: SetupGuideTopic = {
  title: "Use it in a script",
  summary: "Exit codes and JSON",
  markdown: [
    "Every command exits with `0` when it worked, `1` when OneUptime refused it, `2` when the API key is missing or refused, and `3` when the record is not there. Answers go to standard output and errors to standard error, so a script reads one and logs the other:",
    "",
    codeBlock(
      "bash",
      [
        'if ! oneuptime incident get "$INCIDENT_ID" --json > incident.json; then',
        '  echo "Could not read the incident" >&2',
        "  exit 1",
        "fi",
        "jq -r '.title' incident.json",
      ].join("\n"),
    ),
  ].join("\n"),
};

function cliPagingTopic(context: DeveloperDocsGuideContext): SetupGuideTopic {
  const command: string = getCliCommandOf(getModelType(context));
  const { plural } = nouns(context);

  return {
    title: "Page through all of them",
    summary: "--all, or --skip and --limit",
    markdown: joinParts([
      `\`--all\` reads every page and prints all your ${plural} at once. Or ask for a page at a time: \`--limit\` (up to ${LIMIT_PER_PROJECT}) says how many come back, and \`--skip\` how many to pass over first.`,
      codeBlock(
        "bash",
        [
          `oneuptime ${command} list --all --json`,
          `oneuptime ${command} list --limit ${DEVELOPER_DOCS_LIST_LIMIT} --skip ${DEVELOPER_DOCS_LIST_LIMIT} --json`,
        ].join("\n"),
      ),
    ]),
  };
}

function getCliUnsupportedGuide(
  context: DeveloperDocsGuideContext,
): DeveloperDocsGuide {
  return {
    ...guideCopy(DeveloperDocsPageType.Cli, context),
    notice: translateTemplate("The CLI does not cover {{plural}}.", {
      plural: sentenceTerms(context).plural,
    }),
    steps: [],
    sections: [],
    topics: [],
    links: cliLinks(context),
  };
}

function getCliResourceGuide(
  context: DeveloperDocsGuideContext,
  record: DeveloperDocsRecord,
): DeveloperDocsGuide {
  const modelType: DatabaseBaseModelType = getModelType(context);
  const operations: Array<CliOperation> = getCliDatabaseOperations(modelType);
  const examples: DeveloperDocsExampleContext = exampleContext(context);

  if (operations.length === 0) {
    return getCliUnsupportedGuide(context);
  }

  const select: JSONObject = getApiReadSelect(modelType);
  const readJson: JSONObject = pickFields(record.json, select);
  const update: { data: JSONObject; description: string } | null =
    operations.includes(CliOperation.Update)
      ? getApiUpdateExample({ modelType, context: examples })
      : null;
  const steps: Array<DeveloperDocsStep> = [
    installCliStep(context),
    connectCliStep(context),
  ];

  if (operations.includes(CliOperation.Get)) {
    steps.push({
      title: "Read it",
      description: translateTemplate(
        "Ask for the fields you need with --fields. This {{singular}}'s ID is {{id}}.",
        { singular: sentenceTerms(context).singular, id: record.id },
      ),
      markdown: joinParts([
        codeBlock(
          "bash",
          getCliGetExample({ modelType, id: record.id, select }).command,
        ),
        Object.keys(readJson).length > 1 ? responseBlock(readJson) : "",
      ]),
    });
  }

  if (update) {
    steps.push({
      title: "Change it",
      description: update.description,
      markdown: codeBlock(
        "bash",
        getCliUpdateExample({
          modelType,
          id: record.id,
          values: update.data,
          emailsById: emailsByIdOf(context),
        }).command,
      ),
    });
  }

  if (operations.includes(CliOperation.Delete)) {
    steps.push({
      title: "Delete it",
      description: translateTemplate(
        "This deletes the {{singular}} for good.",
        { singular: sentenceTerms(context).singular },
      ),
      markdown: codeBlock(
        "bash",
        getCliDeleteExample({ modelType, id: record.id }).command,
      ),
    });
  }

  return {
    ...guideCopy(DeveloperDocsPageType.Cli, context),
    steps,
    sections: [
      ...cliTasksSection(
        context,
        getApiTasks({ modelType, scope: "view", context: examples }),
      ),
      ...cliCommandsSection(context),
    ],
    topics: [cliAgentsTopic(context), CLI_SCRIPTS_TOPIC],
    links: cliLinks(context),
  };
}

function getCliCollectionGuide(
  context: DeveloperDocsGuideContext,
): DeveloperDocsGuide {
  const { plural } = nouns(context);
  const modelType: DatabaseBaseModelType = getModelType(context);
  const operations: Array<CliOperation> = getCliDatabaseOperations(modelType);
  const examples: DeveloperDocsExampleContext = exampleContext(context);

  if (operations.length === 0) {
    return getCliUnsupportedGuide(context);
  }

  const select: JSONObject = getApiReadSelect(modelType);
  const steps: Array<DeveloperDocsStep> = [
    installCliStep(context),
    connectCliStep(context),
  ];
  const topics: Array<SetupGuideTopic> = [];

  if (operations.includes(CliOperation.List)) {
    const sample: DeveloperDocsSample | undefined = context.sample;

    steps.push({
      title: translateTemplate("List your {{plural}}", {
        plural: sentenceTerms(context).plural,
      }),
      description: translateTemplate("Newest first, {{limit}} at a time.", {
        limit: DEVELOPER_DOCS_LIST_LIMIT,
      }),
      markdown: joinParts([
        codeBlock(
          "bash",
          getCliListExample({
            modelType,
            query: context.listQuery,
            select,
            limit: DEVELOPER_DOCS_LIST_LIMIT,
          }).command,
        ),
        sample ? cliListResponse(sample.records.slice(0, 1), select) : "",
        sample && sample.count > 1
          ? `Shown with the first of your ${sample.count} ${plural}.`
          : "",
      ]),
    });

    const filters: Array<DeveloperDocsApiFilter> = getApiFilters({
      modelType,
      context: examples,
    });

    if (filters.length > 0) {
      steps.push({
        title: "Find the ones you need",
        description:
          "Add a query to the same command. Each of these is filled in from this project.",
        variants: filters.map(
          (filter: DeveloperDocsApiFilter): SetupGuideStepVariant => {
            return {
              label: filter.title,
              markdown: joinParts([
                filter.description,
                codeBlock(
                  "bash",
                  getCliListExample({
                    modelType,
                    query: filter.body["query"] as JSONObject | undefined,
                    select: filter.body["select"] as JSONObject | undefined,
                    sort: filter.body["sort"] as JSONObject | undefined,
                    limit: DEVELOPER_DOCS_LIST_LIMIT,
                  }).command,
                ),
              ]),
            };
          },
        ),
      });
    }

    topics.push(cliPagingTopic(context));
    topics.push({
      title: translateTemplate("Count your {{plural}}", {
        plural: sentenceTerms(context).plural,
      }),
      summary: "count",
      markdown: joinParts([
        "Takes the same query as a list, and prints how many match: one number, ready for a script to compare.",
        codeBlock(
          "bash",
          getCliCountExample({ modelType, query: context.listQuery }).command,
        ),
      ]),
    });
  }

  if (operations.includes(CliOperation.Create)) {
    const create: DeveloperDocsApiBody = getApiCreateExample({
      modelType,
      context: examples,
    });
    const profile: DeveloperDocsProfile = getDeveloperDocsProfile(modelType);

    if (Object.keys(create.body).length > 0) {
      steps.push({
        title: getCreateTitle({
          modelType,
          singularName: getDeveloperDocsSingularName(context.resource),
        }),
        description: withPlaceholderNote(
          `${
            create.usesProjectData
              ? `The fields most ${plural} set, filled in from this project.`
              : `The fields most ${plural} set.`
          } It prints the new one, with its _id.`,
          create.isPlaceholder,
        ),
        markdown: joinParts([
          profile.createNote,
          codeBlock(
            "bash",
            getCliCreateExample({
              modelType,
              values: create.body,
              emailsById: emailsByIdOf(context),
            }).command,
          ),
          cliFieldsList(modelType, create.rows),
        ]),
      });
    }
  }

  topics.push(cliAgentsTopic(context), CLI_SCRIPTS_TOPIC);

  return {
    ...guideCopy(DeveloperDocsPageType.Cli, context),
    steps,
    sections: cliCommandsSection(context),
    topics,
    links: cliLinks(context),
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
    case DeveloperDocsPageType.Cli:
      return isRecord
        ? getCliResourceGuide(context, context.record!)
        : getCliCollectionGuide(context);
    case DeveloperDocsPageType.AiAssistants:
      return getAiGuide(context);
  }
}
