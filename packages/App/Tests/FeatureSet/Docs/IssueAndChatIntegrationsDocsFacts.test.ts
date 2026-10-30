import { searchWorkflowTemplates } from "../../../FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplatePickerUtil";
import {
  CHAT_STEP_PAGES,
  DISCORD,
  GITHUB,
  GITLAB,
  INTEGRATIONS_PAGES,
  IRC,
  ISSUE_PAGES,
  IntegrationsDocsPageEntry,
  OPSGENIE,
  OVERVIEW,
  PAGERDUTY,
  SERVICENOW,
  TELEGRAM,
} from "./IntegrationsDocsPages";
import {
  DOCS_LANGUAGES,
  listPages,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { dashboardLabel, drawnActionLabel } from "./DocsDashboardLabels";
import {
  bold,
  boldIn,
  englishPage,
  englishSection,
  leadOf,
  readRepoFile,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import {
  FieldListInstruction,
  FieldPick,
  fieldListInstructions,
  pickedField,
  pickerFields,
} from "./IntegrationsFieldLists";
import { FieldOption } from "Common/UI/Components/Workflow/FieldPicker/FieldPickerOptions";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import Incident from "Common/Models/DatabaseModels/Incident";
import Alert from "Common/Models/DatabaseModels/Alert";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import DiscordSendMessage from "Common/Server/Types/Workflow/Components/Discord/SendMessageToChannel";
import { DISCORD_WEBHOOK_DOMAINS } from "Common/Server/Types/Workflow/Components/IncomingWebhookUtils";
import TelegramSendMessage from "Common/Server/Types/Workflow/Components/Telegram/SendMessageToChat";
import {
  RunOptions,
  RunReturnType,
} from "Common/Server/Types/Workflow/ComponentCode";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata, {
  Argument,
  ComponentCategory,
  ComponentType,
  Port,
  ReturnValue,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import { SELECT_FIELDS_NAME } from "Common/Types/Workflow/Components/BaseModel";
import {
  RunRecordColumns,
  RunRecordEvent,
  RunRecordTriggerInfo,
  getRunRecordColumns,
  getRunRecordTriggerInfo,
} from "Common/Types/Workflow/RunRecord";
import {
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplates,
} from "Common/Types/Workflow/Templates";
import { ConnectProvider } from "Common/Types/Workspace/ConnectCallback";
import {
  ComponentSearchResult,
  getComponentSearchIndex,
  searchComponents,
} from "Common/UI/Components/Workflow/ComponentPicker/ComponentSearch";
import {
  POPULAR_COMPONENT_IDS,
  PickerCatalog,
  buildPickerCatalog,
} from "Common/UI/Components/Workflow/ComponentPicker/PickerCatalog";
import { loadComponentsAndCategories } from "Common/UI/Components/Workflow/Utils";
import API from "Common/Utils/API";
import {
  MAX_DISCORD_MESSAGE_LENGTH,
  MAX_TELEGRAM_MESSAGE_LENGTH,
  TRUNCATED_TEXT_NOTE,
} from "Common/Utils/MessageFit";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Docs overhaul task 28c: what the GitHub, GitLab, Discord and Telegram
 * pages say, held to the code that makes it true.
 *
 * GitHub and GitLab build a workflow that opens an issue for every
 * incident: its trigger and block are the Builder's own, the fields its
 * body reads are the ones it picks, its JSON is JSON, and the plan and the
 * secret variable are the product's. GitHub's page also leads with the
 * GitHub App, which connects repositories from the Code product.
 *
 * Discord and Telegram start from a ready-made template, or from scratch
 * with a chat step: the template's name, its workflow, its settings and
 * variables, its steps and its message are the ones Templates.ts builds,
 * and the step does what the pages say: Discord's address is pinned, a long
 * message is cut with the note the pages quote, Telegram's text goes out
 * plain, and each chat's own reason comes back on the Error output.
 *
 * Two sections reach past these four pages. Run Workflow, as every
 * integrations page that tests a workflow with it says: pick the trigger's
 * record under the name the Run panel draws it with, never type its ID, in
 * every language. And the Integrations Overview's chat rows: each says
 * what its tool's templates send, Telegram's alerts and the others'
 * incidents.
 *
 * IntegrationsDocsFacts holds every integration page's references and
 * step names; IntegrationsDocsTranslations holds the 16 translations of
 * each page to its English page, line for line.
 */

const catalog: {
  components: Array<ComponentMetadata>;
  categories: Array<ComponentCategory>;
} = loadComponentsAndCategories();

function component(id: string): ComponentMetadata {
  const found: ComponentMetadata | undefined = catalog.components.find(
    (candidate: ComponentMetadata): boolean => {
      return candidate.id === id;
    },
  );

  if (!found) {
    throw new Error(`No step has the id ${id}`);
  }

  return found;
}

function argumentNames(metadata: ComponentMetadata): Array<string> {
  return metadata.arguments.map((argument: Argument): string => {
    return argument.name;
  });
}

function argumentNamed(metadata: ComponentMetadata, name: string): Argument {
  const found: Argument | undefined = metadata.arguments.find(
    (argument: Argument): boolean => {
      return argument.name === name;
    },
  );

  if (!found) {
    throw new Error(`${metadata.title} has no setting ${name}`);
  }

  return found;
}

function pickerOf(componentsType: ComponentType): PickerCatalog {
  return buildPickerCatalog({
    components: catalog.components,
    categories: catalog.categories,
    componentsType: componentsType,
  });
}

// The JSON code blocks of a page, parsed, in order.
function jsonBlocks(page: string): Array<JSONObject> {
  return scanMarkdown(englishPage(page))
    .fences.filter((fence: { lang: string }): boolean => {
      return fence.lang === "json";
    })
    .map((fence: { code: string }): JSONObject => {
      return JSON.parse(fence.code) as JSONObject;
    });
}

// The fields of `model` a text reads: model.title, model.incidentSeverity.
function modelFieldsRead(text: string, block: string): Array<string> {
  const prefix: string = `local.components.${block}.returnValues.model.`;

  return Array.from(text.matchAll(/\{\{([^{}]+?)\}\}/g))
    .map((match: RegExpMatchArray): string => {
      return (match[1] as string).trim();
    })
    .filter((reference: string): boolean => {
      return reference.startsWith(prefix);
    })
    .map((reference: string): string => {
      return reference.slice(prefix.length).split(".")[0] as string;
    });
}

function runOptions(): RunOptions {
  return {
    log: (): void => {},
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  } as RunOptions;
}

async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }

  throw new Error("Expected the step to stop the run");
}

// What API.post was asked to send, by its last call.
interface PostedRequest {
  url: { toString: () => string };
  data: JSONObject;
  options?: { doNotFollowRedirects?: boolean } | undefined;
}

// API.post, answered with `answer`: what a test reads of its calls.
interface PostSpy {
  mock: { calls: Array<Array<unknown>> };
}

function spyOnPost(
  answer: HTTPResponse<JSONObject> | HTTPErrorResponse,
): PostSpy {
  return jest
    .spyOn(API, "post")
    .mockResolvedValue(answer as never) as unknown as PostSpy;
}

function lastPost(spy: PostSpy): PostedRequest {
  const calls: Array<Array<unknown>> = spy.mock.calls;

  return calls[calls.length - 1]![0] as PostedRequest;
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ------------------------------------------------- GitHub and GitLab issues
 */

describe("GitHub and GitLab: an issue for every incident", () => {
  it.each(ISSUE_PAGES)(
    "%s builds its workflow from an On Create Incident trigger and an API Post (JSON) block, as the Builder names them",
    (page: string) => {
      const trigger: ComponentMetadata = component("incident-on-create");
      const post: ComponentMetadata = component(ComponentID.ApiPost);
      const text: string = englishPage(page);

      expect(trigger.title).toBe("On Create Incident");
      expect(SELECT_FIELDS_NAME).toBe("Fields to pass on");
      expect(argumentNames(trigger)).toContain(SELECT_FIELDS_NAME);
      expect(post.title).toBe("API Post (JSON)");
      expect(argumentNames(post)).toEqual([
        "URL",
        "Request Body",
        "Request Headers",
      ]);
      // Request Headers are folded under More fields, and hidden in run logs.
      expect(argumentNamed(post, "Request Headers").isAdvanced).toBe(true);
      expect(argumentNamed(post, "Request Headers").isSensitive).toBe(true);
      expect(
        post.outPorts.map((port: Port): string => {
          return port.title;
        }),
      ).toEqual(["Success", "Error"]);
      expect(
        post.returnValues.map((value: ReturnValue): string => {
          return value.name;
        }),
      ).toEqual(expect.arrayContaining(["Response Status", "Response Body"]));

      expect(text).toContain(
        `pick ${bold("On Create Incident")}. Click the trigger: its ${bold(SELECT_FIELDS_NAME)} starts with ${bold("Title")}, so click ${bold("Add field")} and pick`,
      );
      expect(text).toContain(
        `Under ${bold("More fields")}, set its ${bold("Request Headers")} to:`,
      );
      expect(text).toContain(
        `Its ${bold("Response Status")} and ${bold("Response Body")} in the run say why.`,
      );
    },
  );

  it.each(ISSUE_PAGES)(
    "%s passes on in Fields to pass on every field its body reads, the title it starts with and the fields it picks, each one an incident's",
    async (page: string) => {
      const instructions: Array<FieldListInstruction> = fieldListInstructions(
        englishSection(page, "### Add the trigger"),
      );
      const options: Array<FieldOption> = await pickerFields(
        "Incident",
        SELECT_FIELDS_NAME,
      );

      expect(instructions).toHaveLength(1);

      const instruction: FieldListInstruction =
        instructions[0] as FieldListInstruction;
      // The list as Add field draws it: the title it starts with, then the picks.
      const picked: Array<string | undefined> = [
        ...instruction.startsWith.map((label: string) => {
          return pickedField(options, { label })?.path;
        }),
        ...instruction.picks.map((pick: FieldPick) => {
          return pickedField(options, pick)?.path;
        }),
      ];
      const body: JSONObject = jsonBlocks(page)[1] as JSONObject;
      const read: Array<string> = modelFieldsRead(
        JSON.stringify(body),
        "incident-on-create-1",
      );

      expect(instruction.startsWith).toEqual(["Title"]);
      expect(picked).toEqual([
        "title",
        "description",
        "incidentNumberWithPrefix",
      ]);
      expect(read.length).toBeGreaterThan(0);

      for (const field of read) {
        expect(picked).toContain(field);
      }

      for (const field of picked) {
        expect({
          field,
          onIncident: (field as string) in new Incident(),
        }).toEqual({
          field,
          onIncident: true,
        });
      }
    },
  );

  it("GitHub: posts JSON to GitHub's issues endpoint, with the token from the secret variable it saved", () => {
    const [headers, body] = jsonBlocks(GITHUB) as [JSONObject, JSONObject];
    const text: string = englishPage(GITHUB);

    expect(
      new URL("https://api.github.com/repos/your-org/your-repo/issues").origin,
    ).toBe("https://api.github.com");
    expect(text).toContain(
      `Set its ${bold("URL")} to \`https://api.github.com/repos/your-org/your-repo/issues\``,
    );
    expect(headers).toEqual({
      Authorization: "Bearer {{global.variables.GITHUB_TOKEN}}",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    expect(Object.keys(body)).toEqual(["title", "body", "labels"]);
    expect(Array.isArray(body["labels"])).toBe(true);
    expect(englishSection(GITHUB, "## Store the token")).toContain(
      `Name it \`GITHUB_TOKEN\` and click ${bold("Next")}.`,
    );
  });

  it("GitLab: posts JSON to the project's issues, with the token from the secret variable it saved, and no Content-Type of its own", () => {
    const [headers, body] = jsonBlocks(GITLAB) as [JSONObject, JSONObject];
    const text: string = englishPage(GITLAB);

    expect(headers).toEqual({
      "PRIVATE-TOKEN": "{{global.variables.GITLAB_TOKEN}}",
    });
    expect(Object.keys(body)).toEqual(["title", "description", "labels"]);
    expect(typeof body["labels"]).toBe("string");
    expect(text).toContain(
      `Set its ${bold("URL")} to \`https://gitlab.com/api/v4/projects/12345678/issues\``,
    );
    expect(englishSection(GITLAB, "## Store the token")).toContain(
      `Name it \`GITLAB_TOKEN\` and click ${bold("Next")}.`,
    );
    // An API block sends JSON with its own Content-Type.
    expect(readRepoFile("Common/Utils/API.ts")).toContain(
      '"Content-Type": "application/json;charset=UTF-8"',
    );
    expect(text).toContain(
      "The block sends JSON, so it needs no `Content-Type` header.",
    );
    // A URL is sent as written, so a project's path is encoded by hand.
    expect(readRepoFile("Common/Types/API/URL.ts")).toContain(
      "Values go back out verbatim",
    );
    expect(text).toContain(
      "The URL is sent exactly as written, so encode it yourself.",
    );
  });

  it("GitHub: connects repositories through the GitHub App, from Products → Code", () => {
    const navigation: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Utils/NavigationItems.tsx",
    );
    const repositories: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Components/Code/GitHubConnect.tsx",
    );
    const text: string = englishPage(GITHUB);

    expect(navigation).toContain('t("navbar.items.codeTitle", "Code")');
    expect(repositories).toContain(
      'translator.translateText("Connect GitHub")',
    );
    expect(new CodeRepository().getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(text).toContain(
      `Open ${bold("Products → Code")} and click ${bold("Connect GitHub")}.`,
    );
    expect(text).toContain(
      "Every repository in the installation is imported, and stays in step as you add repositories to the installation or take them out.",
    );
    expect(text).toContain(`On OneUptime Cloud, the ${bold("Growth")} plan.`);
  });

  /*
   * Installing again on an account that has the app only opens the
   * installation's settings on GitHub, which send nobody back: the link
   * under the card signs in to GitHub instead, and the server connects an
   * installation only for an account that administers it.
   */
  it("GitHub: sends an account that already has the app to Connect an existing installation, for an account that administers it", () => {
    const repositories: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Components/Code/GitHubConnect.tsx",
    );
    const github: string = readRepoFile(
      "Common/Server/Utils/CodeRepository/GitHub/GitHub.ts",
    );
    const text: string = englishPage(GITHUB);

    // The link follows the Connect GitHub button.
    expect(
      repositories.indexOf(
        'data-testid="connect-existing-github-installation"',
      ),
    ).toBeGreaterThan(repositories.indexOf('id="connect-github-app"'));
    expect(repositories).toContain('id="connect-github-app"');
    expect(repositories).toContain('"Connect an existing installation"');
    expect(readRepoFile("Common/Server/API/GitHubAPI.ts")).toContain(
      '"/github/connect-existing-url"',
    );
    // A personal account's owner, or admin on every repository it can access.
    expect(github).toContain(
      "return data.installation.accountId === data.userId;",
    );
    expect(github).toContain('if (permissions?.["admin"] !== true) {');
    expect(text).toContain(
      `click ${bold("Connect an existing installation")}, under ${bold("Connect GitHub")}, instead of installing it again.`,
    );
    expect(text).toContain(
      "This needs a GitHub account that administers the installation: the owner of a personal account, or someone with admin on every repository the installation can access",
    );
  });

  it("GitLab: says OneUptime AI works in GitLab repositories, connected in Code with an access token", () => {
    const providers: Array<string> = Object.values(
      ConnectProvider,
    ) as Array<string>;
    const hosts: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Components/Code/CodeHostCopy.ts",
    );

    // Workflows still sign in to GitHub only; Code connects GitLab itself.
    expect(providers).toContain("github");
    expect(providers).not.toContain("gitlab");
    expect(hosts).toContain(
      '"GitLab.com or your own GitLab, with an access token."',
    );
    expect(hosts).toContain(
      'opened: translationKey("Opened merge request !{{number}}")',
    );
    expect(englishPage(GITLAB)).toContain(
      "OneUptime AI works in GitLab repositories too: connect them in Code with an access token, and it opens a merge request for each fix. See [Connect a repository](/docs/ai/ai-agent#connect-a-repository).",
    );
  });
});

/*
 * ----------------------------------------------------- the four pages alike
 */

describe("every workflow page of this task", () => {
  it.each([...ISSUE_PAGES, ...CHAT_STEP_PAGES])(
    "%s needs the plan workflows are sold on, as the page says",
    (page: string) => {
      expect(new Workflow().getCreateBillingPlan()).toBe(PlanType.Growth);
      expect(new WorkflowVariable().getCreateBillingPlan()).toBe(
        PlanType.Growth,
      );
      expect(englishPage(page)).toContain(
        `On OneUptime Cloud, workflows need the ${bold("Growth")} plan or above.`,
      );
    },
  );
});

/*
 * -------------------------------------------------- Discord and Telegram
 */

interface ChatPage {
  page: string;
  templateId: string;
  templateName: string;
  workflowName: string;
  category: WorkflowTemplateCategory;
  // The trigger the template starts from, and the block it names.
  trigger: string;
  triggerBlock: string;
  step: string;
  stepTitle: string;
  stepSettings: Array<string>;
  // What the search on the page is typed as, and in Add Component.
  searchedAs: string;
  searchedInPickerAs: string;
  // The fields the template's message reads.
  messageFields: Array<string>;
}

const CHAT_PAGES: Array<ChatPage> = [
  {
    page: DISCORD,
    templateId: "incident-created-discord",
    templateName: "Tell Discord when an incident opens",
    workflowName: "Notify Discord on new incident",
    category: WorkflowTemplateCategory.Incidents,
    trigger: "incident-on-create",
    triggerBlock: "incident-on-create-1",
    step: ComponentID.DiscordSendMessageToChannel,
    stepTitle: "Send Message to Discord",
    stepSettings: ["Discord Incoming Webhook URL", "Message Text"],
    searchedAs: "Discord",
    searchedInPickerAs: "discord",
    messageFields: [
      "incidentNumberWithPrefix",
      "title",
      "incidentSeverity",
      "currentIncidentState",
    ],
  },
  {
    page: TELEGRAM,
    templateId: "alert-created-telegram",
    templateName: "Tell Telegram when an alert fires",
    workflowName: "Notify Telegram on new alert",
    category: WorkflowTemplateCategory.Alerts,
    trigger: "alert-on-create",
    triggerBlock: "alert-on-create-1",
    step: ComponentID.TelegramSendMessageToChat,
    stepTitle: "Send Message to Telegram",
    stepSettings: ["Telegram Bot Token", "Chat ID", "Message Text"],
    searchedAs: "Telegram",
    searchedInPickerAs: "telegram",
    messageFields: [
      "alertNumberWithPrefix",
      "title",
      "alertSeverity",
      "currentAlertState",
    ],
  },
];

interface TemplateNode {
  componentId: string;
  metadataId: string;
  componentType?: ComponentType | undefined;
  args?: JSONObject | undefined;
}

interface TemplateEdge {
  fromComponentId: string;
  toComponentId: string;
  fromPort: string;
}

function templateOf(entry: ChatPage): WorkflowTemplate {
  const template: WorkflowTemplate | null = getWorkflowTemplate(
    entry.templateId,
  );

  if (!template) {
    throw new Error(`No template ${entry.templateId}`);
  }

  return template;
}

function graphOf(entry: ChatPage): {
  nodes: Array<TemplateNode>;
  edges: Array<TemplateEdge>;
} {
  return getTemplateGraphSpec(entry.templateId) as unknown as {
    nodes: Array<TemplateNode>;
    edges: Array<TemplateEdge>;
  };
}

describe("Discord and Telegram: a message from a template, or from scratch", () => {
  it.each(CHAT_PAGES)(
    "$page names the template, the workflow it creates and the settings it asks for as the picker and the wizard show them",
    (entry: ChatPage) => {
      const template: WorkflowTemplate = templateOf(entry);
      const text: string = englishPage(entry.page);

      expect(template.name).toBe(entry.templateName);
      expect(template.workflowName).toBe(entry.workflowName);
      expect(template.category).toBe(entry.category);
      expect(text).toContain(
        `Type \`${entry.searchedAs}\` in ${bold("Search templates…")}, click ${bold(entry.templateName)}, then click ${bold("Use this template")}.`,
      );
      expect(text).toContain(
        `Keep the name, ${bold(entry.workflowName)}, or change it, and click ${bold("Next")}.`,
      );

      for (const variable of template.variables) {
        expect(text).toContain(bold(variable.title));
      }

      // Typing the chat's name finds its template first.
      expect(
        searchWorkflowTemplates(getWorkflowTemplates(), entry.searchedAs)[0]
          ?.id,
      ).toBe(entry.templateId);
    },
  );

  it.each(CHAT_PAGES)(
    "$page names the variables the template saves, and which are secret",
    (entry: ChatPage) => {
      const variables: Array<WorkflowTemplateVariable> =
        templateOf(entry).variables;
      const secret: Array<string> = variables
        .filter((variable: WorkflowTemplateVariable): boolean => {
          return variable.isSecret;
        })
        .map((variable: WorkflowTemplateVariable): string => {
          return variable.name;
        });
      const plain: Array<string> = variables
        .filter((variable: WorkflowTemplateVariable): boolean => {
          return !variable.isSecret;
        })
        .map((variable: WorkflowTemplateVariable): string => {
          return variable.name;
        });
      const text: string = englishPage(entry.page);

      if (entry.page === DISCORD) {
        expect(secret).toEqual(["discordWebhookUrl"]);
        expect(plain).toEqual([]);
        expect(text).toContain(
          "The URL is saved as the workflow's secret variable `discordWebhookUrl`.",
        );
      } else {
        expect(secret).toEqual(["telegramBotToken"]);
        expect(plain).toEqual(["telegramChatId"]);
        expect(text).toContain(
          "The token is saved as the workflow's secret variable `telegramBotToken`, and the ID as `telegramChatId`.",
        );
      }
    },
  );

  /*
   * Two steps: nothing on the chat step's Error output, so a message the
   * chat refuses fails the run, and its Steps say why
   * (Types/Workflow/UnhandledStepFailure) - where the template had a Log.
   */
  it.each(CHAT_PAGES)(
    "$page lists the template's two steps and its message's fields, and says a refused message fails the run",
    (entry: ChatPage) => {
      const graph: { nodes: Array<TemplateNode>; edges: Array<TemplateEdge> } =
        graphOf(entry);
      const [trigger, step] = graph.nodes as [TemplateNode, TemplateNode];
      const message: string = String(step.args?.["text"] || "");
      const text: string = englishPage(entry.page);

      expect(graph.nodes).toHaveLength(2);
      expect(trigger.metadataId).toBe(entry.trigger);
      expect(trigger.componentId).toBe(entry.triggerBlock);
      expect(step.metadataId).toBe(entry.step);
      expect(graph.edges).toEqual([
        {
          fromComponentId: trigger.componentId,
          toComponentId: step.componentId,
          fromPort: "success",
        },
      ]);
      expect(modelFieldsRead(message, entry.triggerBlock)).toEqual(
        entry.messageFields,
      );
      expect(text).toContain(
        `with two steps: ${bold(component(entry.trigger).title)}, and ${bold(entry.stepTitle)}, which`,
      );
      expect(text).toContain(
        `With nothing connected to ${bold("Error")}, as in the template, a run that could not`,
      );
      expect(text).not.toContain(`${bold("Log")} step`);

      // The page's sample message is how the template's message starts.
      const sample: string = scanMarkdown(text)
        .fences.find((fence: { lang: string }): boolean => {
          return fence.lang === "text";
        })!
        .code.trim();

      expect(message.startsWith(sample)).toBe(true);
    },
  );

  it.each(CHAT_PAGES)(
    "$page names the step and its settings as the step defines them, and finds it in Add Component",
    (entry: ChatPage) => {
      const metadata: ComponentMetadata = component(entry.step);
      const text: string = englishPage(entry.page);
      const found: Array<ComponentSearchResult> = searchComponents(
        getComponentSearchIndex(pickerOf(ComponentType.Component)),
        entry.searchedInPickerAs,
      ).results;

      expect(metadata.title).toBe(entry.stepTitle);
      expect(argumentNames(metadata)).toEqual(entry.stepSettings);
      expect(
        metadata.outPorts.map((port: Port): string => {
          return port.title;
        }),
      ).toEqual(["Success", "Error"]);
      expect(found[0]?.component.id).toBe(entry.step);
      expect(text).toContain(
        `search for \`${entry.searchedInPickerAs}\`, and click ${bold(entry.stepTitle)}.`,
      );

      for (const setting of entry.stepSettings) {
        expect(text).toContain(bold(setting));
      }

      // The webhook URL and the bot token are kept out of run logs.
      expect(
        argumentNamed(metadata, entry.stepSettings[0] as string).isSensitive,
      ).toBe(true);
    },
  );

  it.each(CHAT_PAGES)(
    "$page picks its trigger under Popular in Add Trigger",
    (entry: ChatPage) => {
      const popular: Array<string> = pickerOf(
        ComponentType.Trigger,
      ).popular.map((metadata: ComponentMetadata): string => {
        return metadata.title;
      });
      const title: string = component(entry.trigger).title;

      expect(POPULAR_COMPONENT_IDS[ComponentType.Trigger]).toContain(
        entry.trigger,
      );
      expect(popular).toContain(title);
      expect(englishPage(entry.page)).toContain(
        `pick ${bold(title)} under ${bold("Popular")}.`,
      );
    },
  );

  it("Discord: posts only to Discord's own addresses, without following redirects, and stops the run in the words the page quotes", async () => {
    const spy: PostSpy = spyOnPost(new HTTPResponse<JSONObject>(204, {}, {}));
    const refused: string = await failureOf(() => {
      return new DiscordSendMessage().run(
        {
          "webhook-url": "https://hooks.example.com/api/webhooks/1/abc",
          text: "Incident declared",
        },
        runOptions(),
      );
    });

    await new DiscordSendMessage().run(
      {
        "webhook-url": "https://discord.com/api/webhooks/1234567890/abc",
        text: "Incident declared",
      },
      runOptions(),
    );

    expect(DISCORD_WEBHOOK_DOMAINS).toEqual(["discord.com", "discordapp.com"]);
    expect(refused).toBe(
      "Discord Webhook URL must be an https URL on discord.com or discordapp.com.",
    );
    expect(lastPost(spy).options?.doNotFollowRedirects).toBe(true);
    expect(englishPage(DISCORD)).toContain(
      ':::details The run stops with "Discord Webhook URL must be an https URL on discord.com or discordapp.com"',
    );
    expect(englishPage(DISCORD)).toContain(
      "The step posts to an `https` URL on `discord.com` or `discordapp.com`, and doesn't follow redirects",
    );
  });

  it("Discord: cuts a message past 2,000 characters with the note the page quotes, and returns Discord's own reason on Error", async () => {
    const spy: PostSpy = spyOnPost(new HTTPResponse<JSONObject>(204, {}, {}));

    await new DiscordSendMessage().run(
      {
        "webhook-url": "https://discord.com/api/webhooks/1234567890/abc",
        text: "x".repeat(2500),
      },
      runOptions(),
    );

    const content: string = String(lastPost(spy).data["content"]);

    expect(MAX_DISCORD_MESSAGE_LENGTH).toBe(2000);
    expect(content.length).toBe(2000);
    expect(content.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);

    spyOnPost(
      new HTTPErrorResponse(
        404,
        { message: "Unknown Webhook", code: 10015 },
        {},
      ),
    );

    const result: RunReturnType = await new DiscordSendMessage().run(
      {
        "webhook-url": "https://discord.com/api/webhooks/1234567890/abc",
        text: "Incident declared",
      },
      runOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe("Unknown Webhook");

    const text: string = englishPage(DISCORD);

    expect(text).toContain(
      `Discord takes messages of up to 2,000 characters. A longer one is cut, and ends with "${TRUNCATED_TEXT_NOTE}", rather than refused.`,
    );
    expect(text).toContain(
      ':::details "Unknown Webhook" or "Invalid Webhook Token"',
    );
  });

  it("Telegram: sends plain text, cuts a message past 4,096 characters with the note the page quotes, and returns Telegram's reason with its reminder on Error", async () => {
    const token: string = "123456789:ABCdefGhIJKlmnoPQRstuVWxyz";
    const spy: PostSpy = spyOnPost(
      new HTTPResponse<JSONObject>(200, { ok: true }, {}),
    );

    await new TelegramSendMessage().run(
      {
        "bot-token": token,
        "chat-id": "-1001234567890",
        text: "y".repeat(5000),
      },
      runOptions(),
    );

    const posted: PostedRequest = lastPost(spy);

    expect(MAX_TELEGRAM_MESSAGE_LENGTH).toBe(4096);
    // Plain text: no parse mode, so Telegram reads no formatting.
    expect(Object.keys(posted.data).sort()).toEqual(["chat_id", "text"]);
    expect(String(posted.data["text"]).length).toBeLessThanOrEqual(4096);
    expect(String(posted.data["text"]).endsWith(TRUNCATED_TEXT_NOTE)).toBe(
      true,
    );

    spyOnPost(
      new HTTPErrorResponse(
        400,
        {
          ok: false,
          error_code: 400,
          description: "Bad Request: chat not found",
        },
        {},
      ),
    );

    const result: RunReturnType = await new TelegramSendMessage().run(
      { "bot-token": token, "chat-id": "-100999", text: "Alert fired" },
      runOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(
      String(result.returnValues["error"]).startsWith(
        "Bad Request: chat not found",
      ),
    ).toBe(true);
    expect(String(result.returnValues["error"])).toContain(
      "For groups/channels, the bot must be added as a member or admin.",
    );

    const text: string = englishPage(TELEGRAM);

    expect(text).toContain(
      "The step sends the text as typed, without Telegram's formatting, so `*` and `_` show as they are.",
    );
    expect(text).toContain(
      `Telegram takes messages of up to 4,096 characters. A longer one is cut, and ends with "${TRUNCATED_TEXT_NOTE}", rather than refused.`,
    );
    expect(text).toContain(':::details "Bad Request: chat not found"');
  });

  it("Telegram: stops the run on a token that is not shaped like one, without writing the token, and takes the page's example", async () => {
    const pasted: string = "not-a-telegram-token";
    const refused: string = await failureOf(() => {
      return new TelegramSendMessage().run(
        { "bot-token": pasted, "chat-id": "@channel", text: "Alert fired" },
        runOptions(),
      );
    });

    expect(
      refused.startsWith("Telegram Bot Token is not in a valid format."),
    ).toBe(true);
    expect(refused).not.toContain(pasted);
    expect(
      TelegramSendMessage.isValidBotToken(
        "123456789:ABCdefGhIJKlmnoPQRstuVWxyz",
      ),
    ).toBe(true);
    expect(englishPage(TELEGRAM)).toContain(
      "It gives you the bot's token, such as `123456789:ABCdefGhIJKlmnoPQRstuVWxyz`.",
    );
    expect(englishPage(TELEGRAM)).toContain(
      "A token that is not shaped like `123456789:ABCdef…` stops the run before anything is sent, and the token is never written to the log.",
    );
  });
});

/*
 * ------------------------------------------------ Run Workflow, by hand
 *
 * Run Workflow on a record trigger asks for the record, under its name
 * (RunForm draws the field as the model's singular name), and lists the
 * newest ones; typing a number or part of a title finds another. It asked
 * for the record's ID before, typed, which is what these pages said: the
 * Integrations Overview's outbound recipe and the PagerDuty, Opsgenie and
 * ServiceNow pages did until task 28c's follow-up.
 *
 * RUN_PAGES is every integrations page that tests its workflow with Run
 * Workflow, with the trigger that workflow starts from. A page that starts
 * naming Run Workflow fails "lists every integrations page that names Run
 * Workflow" until it is listed here, and then each of its 17 languages is
 * held to the field the Run panel draws for that trigger.
 */

interface RunPage {
  page: string;
  trigger: string;
  // The model's singular name: what the Run panel names the field.
  record: string;
  numberWithPrefix: string;
  sentence: string;
  /*
   * What the page says the run shows, straight after the sentence: the
   * response of the tool the API Post (JSON) step calls.
   */
  shows?: string | undefined;
}

const PICKED_FROM_THE_LIST: string =
  ": the most recent ones are listed, and typing its number or part of its title finds another.";

// How a page that builds its own workflow on incidents tests it.
const PICK_A_TEST_INCIDENT: string = `Click ${bold("Run Workflow")}, pick a test incident under ${bold("Incident")}, and run it.`;

// What the API Post (JSON) step shows, as a page with one says it.
function postShows(response: string): string {
  return `The ${bold("API Post (JSON)")} step shows a ${response}`;
}

// A workflow built on incidents, tested with one picked under Incident.
function incidentRunPage(
  page: string,
  sentence: string,
  shows?: string,
): RunPage {
  return {
    page: page,
    trigger: "incident-on-create",
    record: "Incident",
    numberWithPrefix: "incidentNumberWithPrefix",
    sentence: sentence,
    shows: shows,
  };
}

const RUN_PAGES: Array<RunPage> = [
  incidentRunPage(
    OVERVIEW,
    `5. Click ${bold("Run Workflow")}, pick an incident under ${bold("Incident")}, and run it.`,
    "A test run really sends the request.",
  ),
  incidentRunPage(
    PAGERDUTY,
    PICK_A_TEST_INCIDENT,
    postShows('`202` response with `"status": "success"`'),
  ),
  incidentRunPage(OPSGENIE, PICK_A_TEST_INCIDENT, postShows("`202` response")),
  incidentRunPage(
    SERVICENOW,
    PICK_A_TEST_INCIDENT,
    postShows("`201` response holding the new record"),
  ),
  ...ISSUE_PAGES.map((page: string): RunPage => {
    return incidentRunPage(
      page,
      PICK_A_TEST_INCIDENT,
      postShows("`201` response holding the new issue"),
    );
  }),
  incidentRunPage(
    DISCORD,
    `click ${bold("Run Workflow")} and pick an incident you already have under ${bold("Incident")}${PICKED_FROM_THE_LIST}`,
  ),
  {
    page: TELEGRAM,
    trigger: "alert-on-create",
    record: "Alert",
    numberWithPrefix: "alertNumberWithPrefix",
    sentence: `click ${bold("Run Workflow")} and pick an alert you already have under ${bold("Alert")}${PICKED_FROM_THE_LIST}`,
  },
  incidentRunPage(
    IRC,
    `click ${bold("Run Workflow")} and pick an incident you already have under ${bold("Incident")}${PICKED_FROM_THE_LIST}`,
  ),
];

/*
 * Integrations pages whose workflow starts from a trigger that runs without
 * a record: Run Workflow asks there for the trigger's own values - the
 * Huntress Incident Report trigger's Event and Report ID - rather than a
 * record to pick, and the page's own suite holds what it says to type
 * (HuntressIntegrationDocs).
 */
const RUN_WITHOUT_RECORD_PAGES: ReadonlyArray<{
  page: string;
  trigger: string;
}> = [
  {
    page: "integrations/huntress",
    trigger: ComponentID.HuntressIncidentReport,
  },
];

function runsWithoutRecord(page: string): boolean {
  return RUN_WITHOUT_RECORD_PAGES.some(
    (entry: { page: string; trigger: string }): boolean => {
      return entry.page === page;
    },
  );
}

describe("Run Workflow: the trigger's record, picked rather than typed", () => {
  it.each(RUN_PAGES)(
    "$page picks the record under its name, as the Run panel asks for it",
    (entry: RunPage) => {
      const trigger: ComponentMetadata = component(entry.trigger);
      const info: RunRecordTriggerInfo | null =
        getRunRecordTriggerInfo(trigger);
      const text: string = englishPage(entry.page);

      expect(info?.singularName).toBe(entry.record);
      expect(info?.event).toBe(RunRecordEvent.Created);
      expect(trigger.runWorkflowManuallyArguments?.[0]?.id).toBe("_id");
      expect(
        readRepoFile("Common/UI/Components/Workflow/RunForm.tsx"),
      ).toContain("title: info.singularName,");
      expect(text).toContain(entry.sentence);

      // The rest of the step is as it was: what the run shows.
      if (entry.shows) {
        expect(text).toContain(`${entry.sentence} ${entry.shows}`);
      }

      // Neither the ID the panel asked for before, nor the setting's old name.
      expect(text).not.toContain(`${entry.record} ID`);
      expect(text).not.toContain("Select Fields");
    },
  );

  it.each(RUN_PAGES)(
    "$page's record is found by its number or part of its title, and the newest are listed first",
    (entry: RunPage) => {
      const info: RunRecordTriggerInfo | null = getRunRecordTriggerInfo(
        component(entry.trigger),
      );
      const columns: RunRecordColumns = getRunRecordColumns(
        entry.record === "Alert" ? new Alert() : new Incident(),
      );

      expect(info?.hasNumber).toBe(true);
      expect(info?.hasName).toBe(true);
      expect(columns.number?.numberWithPrefixColumn).toBe(
        entry.numberWithPrefix,
      );
      expect(columns.nameColumn).toBe("title");
      expect(
        readRepoFile("Common/UI/Components/Workflow/RunRecordField.tsx"),
      ).toContain('mostRecent: translationKey("Most recent")');
    },
  );
});

/*
 * Every integrations page, in every language: a line that names the Run
 * Workflow button picks the record under the field the Run panel draws for
 * the page's trigger, each named as the page names the Dashboard's labels
 * in that language (labelOnPage), and never asks for an Incident ID or an
 * Alert ID.
 */

// The integrations pages of a language, as "integrations/<page>".
function integrationsPages(language: string): Array<string> {
  return listPages(language).filter((page: string): boolean => {
    return page.startsWith("integrations/");
  });
}

// The field a trigger's run asks for its record under: the record's name.
function runRecordField(trigger: string): string {
  const info: RunRecordTriggerInfo | null = getRunRecordTriggerInfo(
    component(trigger),
  );

  if (!info) {
    throw new Error(`${trigger} runs without a record`);
  }

  return info.singularName;
}

// The fields the Run panel asked for before it let the reader pick.
const ID_FIELDS: ReadonlyArray<string> = ["Incident ID", "Alert ID"];

// The title of every trigger a workflow can start from.
const TRIGGER_TITLES: ReadonlyArray<string> = catalog.components
  .filter((metadata: ComponentMetadata): boolean => {
    return metadata.componentType === ComponentType.Trigger;
  })
  .map((metadata: ComponentMetadata): string => {
    return metadata.title;
  });

/*
 * A Dashboard label as a page in a language names it. The pages tasks 28a
 * to 28c rewrote (INTEGRATIONS_PAGES) name every label as that language's
 * Dashboard draws it, Persian included, which IntegrationsDocsTranslations
 * holds. The integrations page with a suite of its own, IRC, keeps the
 * Persian page's labels in English, which IrcIntegrationDocs holds
 * (dashboardLabel).
 */
function labelOnPage(page: string, language: string, english: string): string {
  const drawnOnThisPage: boolean = INTEGRATIONS_PAGES.some(
    (entry: IntegrationsDocsPageEntry): boolean => {
      return entry.page === page;
    },
  );

  return drawnOnThisPage
    ? drawnActionLabel(language, english)
    : dashboardLabel(language, english);
}

// What a language's integrations pages say wrong about Run Workflow, by line.
function runWorkflowProblems(language: string): {
  problems: Array<string>;
  pagesThatRun: Array<string>;
} {
  // Run Workflow as a page names it in either way, so no line is missed.
  const runWorkflow: Array<string> = [
    bold("Run Workflow"),
    bold(drawnActionLabel(language, "Run Workflow")),
  ];
  const idFields: Array<string> = ID_FIELDS.flatMap(
    (field: string): Array<string> => {
      return [bold(field), bold(drawnActionLabel(language, field))];
    },
  );
  const problems: Array<string> = [];
  const pagesThatRun: Array<string> = [];

  for (const page of integrationsPages(language)) {
    if (runsWithoutRecord(page)) {
      continue;
    }

    const entry: RunPage | undefined = RUN_PAGES.find(
      (candidate: RunPage): boolean => {
        return candidate.page === page;
      },
    );

    readPage(language, page)
      .split("\n")
      .forEach((line: string, index: number): void => {
        if (
          !runWorkflow.some((label: string): boolean => {
            return line.includes(label);
          })
        ) {
          return;
        }

        const where: string = `${language}/${page}:${index + 1}`;

        if (!entry) {
          problems.push(`${where} names Run Workflow, but RUN_PAGES does not`);
          return;
        }

        if (!pagesThatRun.includes(page)) {
          pagesThatRun.push(page);
        }

        const field: string = bold(
          labelOnPage(page, language, runRecordField(entry.trigger)),
        );
        const button: string = bold(
          labelOnPage(page, language, "Run Workflow"),
        );

        if (!line.includes(button)) {
          problems.push(`${where} does not name the button as ${button}`);
        }

        if (!line.includes(field)) {
          problems.push(`${where} does not pick the record under ${field}`);
        }

        for (const idField of idFields) {
          if (line.includes(idField)) {
            problems.push(`${where} asks for ${idField}`);
          }
        }
      });
  }

  return { problems, pagesThatRun };
}

describe("Run Workflow on every integrations page, in every language", () => {
  it("the Run panel draws a record trigger's field under the record's name, through the Dashboard's locale, as a form draws every label", () => {
    expect(readRepoFile("Common/UI/Components/Workflow/RunForm.tsx")).toContain(
      "title: info.singularName,",
    );
    expect(
      readRepoFile("Common/UI/Components/Forms/Fields/FieldLabel.tsx"),
    ).toContain("translateString(props.title) ?? props.title");
    // The two triggers these pages run, and the fields they draw.
    expect(runRecordField("incident-on-create")).toBe("Incident");
    expect(runRecordField("alert-on-create")).toBe("Alert");
    expect(labelOnPage(OPSGENIE, "de", "Incident")).toBe("Vorfall");
    expect(labelOnPage(TELEGRAM, "ja", "Alert")).toBe("アラート");
    // Persian: drawn on the rewritten pages, in English on IRC's.
    expect(labelOnPage(OVERVIEW, "fa", "Incident")).toBe(
      drawnActionLabel("fa", "Incident"),
    );
    expect(labelOnPage(OVERVIEW, "fa", "Incident")).not.toBe("Incident");
    expect(labelOnPage(IRC, "fa", "Incident")).toBe("Incident");
    expect(labelOnPage(IRC, "de", "Incident")).toBe("Vorfall");
  });

  it("the pages left out run a trigger that asks for no record", () => {
    for (const entry of RUN_WITHOUT_RECORD_PAGES) {
      expect({
        page: entry.page,
        record: getRunRecordTriggerInfo(component(entry.trigger)),
        namesRunWorkflow: englishPage(entry.page).includes(
          bold("Run Workflow"),
        ),
      }).toEqual({ page: entry.page, record: null, namesRunWorkflow: true });
    }
  });

  it("lists every integrations page that names Run Workflow, and only those", () => {
    const naming: Array<string> = integrationsPages("en").filter(
      (page: string): boolean => {
        return (
          englishPage(page).includes(bold("Run Workflow")) &&
          !runsWithoutRecord(page)
        );
      },
    );

    expect([...naming].sort()).toEqual(
      RUN_PAGES.map((entry: RunPage): string => {
        return entry.page;
      }).sort(),
    );
  });

  it.each(RUN_PAGES)(
    "$page names the trigger its workflow starts from before it says to run it",
    (entry: RunPage) => {
      const lines: Array<string> = englishPage(entry.page).split("\n");
      const runAt: number = lines.findIndex((line: string): boolean => {
        return line.includes(bold("Run Workflow"));
      });
      const named: Array<string> = lines
        .slice(0, runAt + 1)
        .flatMap((line: string): Array<string> => {
          return boldIn(line);
        })
        .filter((span: string): boolean => {
          return TRIGGER_TITLES.includes(span);
        });

      expect(runAt).toBeGreaterThan(0);
      expect(named[named.length - 1]).toBe(component(entry.trigger).title);
      expect(entry.record).toBe(runRecordField(entry.trigger));
    },
  );

  it.each(DOCS_LANGUAGES)(
    "%s: every integrations page picks the record under the field its Dashboard's Run panel draws, and asks for no ID",
    (language: string) => {
      const found: { problems: Array<string>; pagesThatRun: Array<string> } =
        runWorkflowProblems(language);

      expect(found.problems).toEqual([]);
      // Every listed page tells its reader to run it, in this language too.
      expect([...found.pagesThatRun].sort()).toEqual(
        RUN_PAGES.map((entry: RunPage): string => {
          return entry.page;
        }).sort(),
      );
    },
  );
});

/*
 * --------------------------------------- the Overview's chat tool rows
 *
 * The Integrations Overview says in one line what each chat tool's page
 * sets up. A tool whose ready-made templates all start from one kind of
 * record names that record in its row, and no other: Discord's and IRC's
 * incidents, Telegram's alerts. Telegram's row said "incident updates"
 * while its one template sends a message when an alert fires. Mattermost's
 * templates start from incidents, alerts, monitors and maintenance, so its
 * row is held to none of them. Slack and Microsoft Teams are built-in
 * connections, not a step.
 */

// The workflow step each outbound chat tool's row stands for.
const CHAT_ROW_STEPS: Readonly<Record<string, string>> = {
  Mattermost: ComponentID.MattermostSendMessageToChannel,
  Discord: ComponentID.DiscordSendMessageToChannel,
  Telegram: ComponentID.TelegramSendMessageToChat,
  IRC: ComponentID.IRCSendMessageToChannel,
};

interface ChatRow {
  tool: string;
  target: string;
  direction: string;
  description: string;
}

// The rows of the Overview's Chat tools table.
function chatRows(): Array<ChatRow> {
  return tableWithHeader(
    englishSection(OVERVIEW, "### Chat tools"),
    "Tool",
  ).map((row: Array<string>): ChatRow => {
    const cell: string = row[0] as string;

    return {
      tool: cell.slice(1, cell.indexOf("]")),
      target: scanMarkdown(cell).links[0]?.target || "",
      direction: row[1] as string,
      description: row[2] as string,
    };
  });
}

function chatRow(tool: string): ChatRow {
  const row: ChatRow | undefined = chatRows().find(
    (candidate: ChatRow): boolean => {
      return candidate.tool === tool;
    },
  );

  if (!row) {
    throw new Error(`The Overview's chat tools have no ${tool} row`);
  }

  return row;
}

function nodesOf(templateId: string): Array<TemplateNode> {
  return (
    getTemplateGraphSpec(templateId) as unknown as {
      nodes: Array<TemplateNode>;
    }
  ).nodes;
}

// The templates that send with a step.
function templatesSendingWith(step: string): Array<WorkflowTemplate> {
  return getWorkflowTemplates().filter(
    (template: WorkflowTemplate): boolean => {
      return nodesOf(template.id).some((node: TemplateNode): boolean => {
        return node.metadataId === step;
      });
    },
  );
}

/*
 * The record a template's trigger starts from, by its name ("Incident"),
 * or null for a trigger that starts from none, such as a webhook.
 */
function recordStartedFrom(templateId: string): string | null {
  const trigger: TemplateNode | undefined = nodesOf(templateId).find(
    (node: TemplateNode): boolean => {
      return node.componentType === ComponentType.Trigger;
    },
  );

  if (!trigger) {
    throw new Error(`${templateId} has no trigger`);
  }

  return (
    getRunRecordTriggerInfo(component(trigger.metadataId))?.singularName || null
  );
}

// The records a chat tool's templates start from, each once.
function recordsOf(tool: string): Array<string | null> {
  return Array.from(
    new Set(
      templatesSendingWith(CHAT_ROW_STEPS[tool] as string).map(
        (template: WorkflowTemplate): string | null => {
          return recordStartedFrom(template.id);
        },
      ),
    ),
  );
}

describe("the Integrations Overview's chat rows", () => {
  it("list every outbound chat tool by the step it sends with, after the built-in connections", () => {
    const rows: Array<ChatRow> = chatRows();

    expect(
      rows
        .filter((row: ChatRow): boolean => {
          return row.direction === "Outbound";
        })
        .map((row: ChatRow): string => {
          return row.tool;
        }),
    ).toEqual(Object.keys(CHAT_ROW_STEPS));

    for (const step of Object.values(CHAT_ROW_STEPS)) {
      expect(component(step).componentType).toBe(ComponentType.Component);
      expect(templatesSendingWith(step).length).toBeGreaterThan(0);
    }

    for (const tool of ["Slack", "Microsoft Teams"]) {
      expect(
        chatRow(tool).description.startsWith("A built-in connection:"),
      ).toBe(true);
    }
  });

  it("name, for each chat tool, the one record its templates start from, and no other", () => {
    const tools: Array<string> = Object.keys(CHAT_ROW_STEPS);
    const everyRecord: Array<string> = Array.from(
      new Set(
        tools.flatMap((tool: string): Array<string> => {
          return recordsOf(tool).filter(
            (record: string | null): record is string => {
              return record !== null;
            },
          );
        }),
      ),
    );

    // What these pages' templates start from.
    expect(recordsOf("Discord")).toEqual(["Incident"]);
    expect(recordsOf("IRC")).toEqual(["Incident"]);
    expect(recordsOf("Telegram")).toEqual(["Alert"]);
    expect(recordsOf("Mattermost").length).toBeGreaterThan(1);

    let held: number = 0;

    for (const tool of tools) {
      const records: Array<string | null> = recordsOf(tool);

      if (records.length !== 1 || records[0] === null) {
        continue;
      }

      const description: string = chatRow(tool).description.toLowerCase();
      const named: Array<string> = everyRecord.filter(
        (record: string): boolean => {
          return description.includes(record.toLowerCase());
        },
      );

      held += 1;
      expect({ tool, named }).toEqual({ tool, named: records });
    }

    expect(held).toBe(3);
  });

  it("say Telegram sends a message to a chat when an alert fires, as its one template does", () => {
    const templates: Array<WorkflowTemplate> = templatesSendingWith(
      ComponentID.TelegramSendMessageToChat,
    );
    const template: WorkflowTemplate = templates[0] as WorkflowTemplate;
    const when: string = template.name.slice(template.name.indexOf(" when "));

    expect(
      templates.map((candidate: WorkflowTemplate): string => {
        return candidate.id;
      }),
    ).toEqual(["alert-created-telegram"]);
    expect(when).toBe(" when an alert fires");
    expect(template.category).toBe(WorkflowTemplateCategory.Alerts);
    expect(
      template.description.startsWith("Sends a message to a Telegram chat"),
    ).toBe(true);
    expect(recordStartedFrom(template.id)).toBe("Alert");
    expect(chatRow("Telegram")).toEqual({
      tool: "Telegram",
      target: `/docs/${TELEGRAM}`,
      direction: "Outbound",
      description: `Send a message to a Telegram chat${when}.`,
    });
    // As the Telegram page says first, in its lead.
    const lead: string = leadOf(englishPage(TELEGRAM));

    expect(lead.startsWith("Send a message to a [Telegram](")).toBe(true);
    expect(lead).toContain(") chat, group or channel when an alert fires");
  });
});
