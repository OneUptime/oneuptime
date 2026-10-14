import { searchWorkflowTemplates } from "../../../FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplatePickerUtil";
import {
  CHAT_STEP_PAGES,
  DISCORD,
  GITHUB,
  GITLAB,
  ISSUE_PAGES,
  TELEGRAM,
} from "./IntegrationsDocsPages";
import { scanMarkdown } from "./DocsContentSupport";
import {
  bold,
  codeIn,
  englishPage,
  englishSection,
  readRepoFile,
} from "./InventoryAndApiDocsSupport";
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
        `pick ${bold("On Create Incident")}. Click the trigger, and in ${bold(SELECT_FIELDS_NAME)} pick`,
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
    "%s picks in Fields to pass on every field its body reads, each one an incident's",
    (page: string) => {
      const pickLine: string = englishSection(page, "### Add the trigger");
      const picked: Array<string> = codeIn(
        pickLine.slice(pickLine.indexOf(SELECT_FIELDS_NAME)),
      );
      const body: JSONObject = jsonBlocks(page)[1] as JSONObject;
      const read: Array<string> = modelFieldsRead(
        JSON.stringify(body),
        "incident-on-create-1",
      );

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
        expect({ field, onIncident: field in new Incident() }).toEqual({
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

  it("GitHub: connects repositories through the GitHub App, from Products → Code → Tasks, then Code Repositories", () => {
    const navigation: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Utils/NavigationItems.tsx",
    );
    const sideMenu: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Components/Code/CodeSideMenu.tsx",
    );
    const repositories: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Pages/CodeRepository/CodeRepository.tsx",
    );
    const text: string = englishPage(GITHUB);

    expect(navigation).toContain('t("navbar.items.aiAgentsTitle", "Tasks")');
    expect(sideMenu).toContain('title: "Code Repositories"');
    expect(repositories).toContain(
      'translator.translateText("Connect with GitHub App")',
    );
    expect(repositories).toContain(
      "They stay in sync as repositories are added to or removed from the installation.",
    );
    expect(new CodeRepository().getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(text).toContain(
      `Open ${bold("Products → Code → Tasks")}, then ${bold("Code Repositories")}, and click ${bold("Connect with GitHub App")}.`,
    );
    expect(text).toContain(
      "Every repository in the installation is imported, and stays in step as you add repositories to the installation or take them out.",
    );
    expect(text).toContain(`On OneUptime Cloud, the ${bold("Growth")} plan.`);
  });

  it("GitLab: says plainly that OneUptime AI cannot work in a GitLab repository yet", () => {
    const providers: Array<string> = Object.values(
      ConnectProvider,
    ) as Array<string>;
    const repositories: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Pages/CodeRepository/CodeRepository.tsx",
    );

    expect(providers).toContain("github");
    expect(providers).not.toContain("gitlab");
    expect(repositories).not.toContain("Connect with GitLab");
    expect(englishPage(GITLAB)).toContain(
      "OneUptime AI opens fix pull requests only in repositories connected through the GitHub App, so it cannot work in a GitLab repository yet.",
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
  // The Log step's line, before the chat's reason.
  logLine: string;
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
    logLine: "❌ Discord could not deliver the incident notification:",
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
    logLine: "❌ Telegram could not deliver the alert notification:",
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

  it.each(CHAT_PAGES)(
    "$page lists the template's three steps, its message's fields and the line its Log step writes",
    (entry: ChatPage) => {
      const graph: { nodes: Array<TemplateNode>; edges: Array<TemplateEdge> } =
        graphOf(entry);
      const [trigger, step, log] = graph.nodes as [
        TemplateNode,
        TemplateNode,
        TemplateNode,
      ];
      const message: string = String(step.args?.["text"] || "");
      const logged: string = String(log.args?.["value"] || "");
      const text: string = englishPage(entry.page);

      expect(graph.nodes).toHaveLength(3);
      expect(trigger.metadataId).toBe(entry.trigger);
      expect(trigger.componentId).toBe(entry.triggerBlock);
      expect(step.metadataId).toBe(entry.step);
      expect(log.metadataId).toBe(ComponentID.Log);
      expect(graph.edges).toEqual([
        {
          fromComponentId: trigger.componentId,
          toComponentId: step.componentId,
          fromPort: "success",
        },
        {
          fromComponentId: step.componentId,
          toComponentId: log.componentId,
          fromPort: "error",
        },
      ]);
      expect(modelFieldsRead(message, entry.triggerBlock)).toEqual(
        entry.messageFields,
      );
      expect(logged.startsWith(entry.logLine)).toBe(true);
      expect(text).toContain(`\`${entry.logLine}\``);
      expect(text).toContain(
        `with three steps: ${bold(component(entry.trigger).title)}; ${bold(entry.stepTitle)}, which`,
      );
      expect(text).toContain(
        `and a ${bold("Log")} step on its ${bold("Error")} output.`,
      );

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
 * for the record's ID before, typed, which is what these pages said.
 */

interface RunPage {
  page: string;
  trigger: string;
  // The model's singular name: what the Run panel names the field.
  record: string;
  numberWithPrefix: string;
  sentence: string;
}

const PICKED_FROM_THE_LIST: string =
  ": the most recent ones are listed, and typing its number or part of its title finds another.";

const RUN_PAGES: Array<RunPage> = [
  ...ISSUE_PAGES.map((page: string): RunPage => {
    return {
      page: page,
      trigger: "incident-on-create",
      record: "Incident",
      numberWithPrefix: "incidentNumberWithPrefix",
      sentence: `Click ${bold("Run Workflow")}, pick a test incident under ${bold("Incident")}, and run it.`,
    };
  }),
  {
    page: DISCORD,
    trigger: "incident-on-create",
    record: "Incident",
    numberWithPrefix: "incidentNumberWithPrefix",
    sentence: `click ${bold("Run Workflow")} and pick an incident you already have under ${bold("Incident")}${PICKED_FROM_THE_LIST}`,
  },
  {
    page: TELEGRAM,
    trigger: "alert-on-create",
    record: "Alert",
    numberWithPrefix: "alertNumberWithPrefix",
    sentence: `click ${bold("Run Workflow")} and pick an alert you already have under ${bold("Alert")}${PICKED_FROM_THE_LIST}`,
  },
];

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
