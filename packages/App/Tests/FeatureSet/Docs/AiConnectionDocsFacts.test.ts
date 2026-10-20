import {
  AI_GATEWAYS,
  COMPANY_TOOLS,
  LLM,
  PROVIDER_ACCOUNTS,
} from "./AiObservabilityDocsPages";
import {
  DocsHeading,
  NAV_PAGES,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import LlmObservabilityConnection from "Common/Models/DatabaseModels/LlmObservabilityConnection";
import {
  LlmConnectionCatalog,
  LlmConnectionDefinition,
  LlmConnectionField,
  LlmConnectionKind,
  getLlmConnectionDefinitionsOfKind,
} from "Common/Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import {
  AllLlmProviderTokenTypes,
  LLM_CONNECTION_ID_ATTRIBUTE,
  LLM_CONNECTION_NAME_ATTRIBUTE,
  LLM_PROVIDER_API_KEY_ATTRIBUTE,
  LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE,
  LLM_PROVIDER_MODEL_ATTRIBUTE,
  LLM_PROVIDER_NAME_ATTRIBUTE,
  LLM_PROVIDER_PERSON_ATTRIBUTE,
  LLM_PROVIDER_PROJECT_ATTRIBUTE,
  LlmProviderUsageMetricNames,
} from "Common/Types/LlmObservability/LlmProviderUsageMetrics";
import Permission from "Common/Types/Permission";
import {
  LlmCompletionJsonAttributeKeys,
  LlmConversationIdAttributeKeys,
  LlmPromptJsonAttributeKeys,
  LlmUserIdBaseAttributeKeys,
} from "Common/Types/Telemetry/LlmConventions";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Connecting AI with no code: what the AI Provider Accounts and Company AI
 * Tools pages, and what the AI / LLM Observability, AI Gateways and AI
 * Coding Assistants pages say about it, held to the code that does it - the
 * connections' catalog (each provider's title, fields, credential, interval
 * and first read), the form that asks for them, the reads' schedule, the
 * metrics a provider account is kept as, the Usage and Budgets views of
 * them, and who may read a company AI tool's chats. The translations are
 * held to these English pages by AiToolingAndSecurityDocsTranslations and
 * AiObservabilityDocsTranslations.
 *
 * What the providers' own consoles call things (OpenAI's Admin keys,
 * Microsoft Graph's permissions, OpenRouter's Broadcast) is the vendors' and
 * is not in this repository; the catalog's hints name them, and the pages
 * are held to the hints.
 *
 * App tests read no React module, so the Dashboard's words are read from its
 * source files as text; Common's types are imported, and the server modules
 * that reach a database are read as text too.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";
const SERVER: string = "packages/Common/Server/Utils/LlmObservability";

const SOURCES: Record<string, string> = {
  connectPage: `${DASHBOARD}/Pages/Llm/Connect.tsx`,
  form: `${DASHBOARD}/Components/AI/Connect/LlmConnectionFormModal.tsx`,
  testPanel: `${DASHBOARD}/Components/AI/Connect/LlmConnectionTestPanel.tsx`,
  connectionsTable: `${DASHBOARD}/Components/AI/Connect/LlmConnectionsTable.tsx`,
  otherTools: `${DASHBOARD}/Components/AI/Connect/LlmOtherAiTools.tsx`,
  usagePage: `${DASHBOARD}/Pages/Llm/Usage.tsx`,
  providerUsageQuery: `${DASHBOARD}/Components/AI/LlmProviderUsageQuery.ts`,
  budgets: `${DASHBOARD}/Pages/Llm/Budgets.tsx`,
  pullRunner: `${SERVER}/LlmConnectionPullRunner.ts`,
  usageDays: `${SERVER}/LlmUsageDays.ts`,
  testResults: `${SERVER}/LlmConnectorTestResults.ts`,
  privacy: `${SERVER}/LlmConversationPrivacy.ts`,
  anthropic: `${SERVER}/Connectors/Anthropic/AnthropicConnector.ts`,
  claudeEnterprise: `${SERVER}/Connectors/ClaudeEnterprise/ClaudeEnterpriseConnector.ts`,
  copilot: `${SERVER}/Connectors/Microsoft365Copilot/Microsoft365CopilotConnector.ts`,
};

const INLINE_CODE: RegExp = /`([^`]+)`/g;
const LINE_BREAK: RegExp = /\n/;
// A label written as a translation key: `label: translationKey("Model"),`.
const LABEL_KEY: RegExp = /label: translationKey\("([^"]+)"\)/g;
// A title written as a translation key: `title: translationKey("..."),`.
const TITLE_KEY: RegExp = /title: translationKey\("([^"]+)"\)/g;
// The prefix a secret field's description gives: "It starts with sk-admin-.".
const STARTS_WITH: RegExp = /It starts with (\S+?)\.(?:\s|$)/;

function source(name: string): string {
  return fs.readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

function allMatches(
  text: string,
  pattern: RegExp,
  group: number,
): Array<string> {
  return Array.from(text.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[group] as string;
    },
  );
}

function codeSpans(text: string): Array<string> {
  return allMatches(text, INLINE_CODE, 1);
}

/*
 * A section of a page: from its heading to the next heading of the same
 * level or higher, without the heading line itself.
 */
function section(markdown: string, heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

// The rows of a section's table (the first unless told), without the header.
function rowsOf(
  markdown: string,
  heading: string,
  which: number = 0,
): Array<Array<string>> {
  const found: Array<Array<Array<string>>> = tables(section(markdown, heading));

  expect(found.length).toBeGreaterThan(which);

  return (found[which] as Array<Array<string>>).slice(1);
}

function rowNamed(rows: Array<Array<string>>, name: string): Array<string> {
  const row: Array<string> | undefined = rows.find(
    (cells: Array<string>): boolean => {
      return cells[0] === name;
    },
  );

  expect({ name, found: row !== undefined }).toEqual({ name, found: true });

  return row as Array<string>;
}

// The page of the docs a connection's guide is on.
function guidePage(definition: LlmConnectionDefinition): string {
  return definition.kind === LlmConnectionKind.CompanyTool
    ? COMPANY_TOOLS
    : PROVIDER_ACCOUNTS;
}

// What each connection's credential needs, as the catalog's hint names it.
const CREDENTIAL_NEEDS: Record<LlmConnectionProvider, Array<string>> = {
  [LlmConnectionProvider.OpenAI]: ["Admin keys", "organization owners"],
  [LlmConnectionProvider.Anthropic]: ["Admin keys", "organization admins"],
  [LlmConnectionProvider.AzureOpenAI]: [
    "Microsoft Entra ID",
    "Monitoring Reader",
  ],
  [LlmConnectionProvider.AwsBedrock]: [
    "cloudwatch:GetMetricData",
    "cloudwatch:ListMetrics",
  ],
  [LlmConnectionProvider.GoogleVertexAI]: ["Monitoring Viewer", "JSON key"],
  [LlmConnectionProvider.ClaudeEnterprise]: [
    "primary owner",
    "Compliance API",
    "read:compliance_user_data",
  ],
  [LlmConnectionProvider.Microsoft365Copilot]: [
    "Microsoft Entra ID",
    "AiEnterpriseInteraction.Read.All",
    "User.Read.All",
    "admin consent",
  ],
};

// Where each page walks through connecting.
const CONNECT_SECTIONS: Record<string, string> = {
  [PROVIDER_ACCOUNTS]: "Connect an account",
  [COMPANY_TOOLS]: "Connect a tool",
};

describe("each connection's guide", () => {
  it.each(LlmConnectionCatalog)(
    "$provider links to a heading of a page in the nav, titled as its tile",
    (definition: LlmConnectionDefinition) => {
      const link: { page: string; anchor: string | null } | null =
        parseDocsLink(definition.docsPath);

      expect(link).not.toBeNull();
      expect(link!.page).toBe(guidePage(definition));
      expect(NAV_PAGES).toContain(link!.page);

      const heading: DocsHeading | undefined = scanMarkdown(
        englishPage(link!.page),
      ).headings.find((entry: DocsHeading): boolean => {
        return entry.slug === link!.anchor;
      });

      expect(heading).toEqual(
        expect.objectContaining({ level: 2, text: definition.title }),
      );
    },
  );

  it.each(LlmConnectionCatalog)(
    "$provider names every field its form asks for, as the form labels it",
    (definition: LlmConnectionDefinition) => {
      const guide: string = section(
        englishPage(guidePage(definition)),
        definition.title,
      );
      const fields: Array<LlmConnectionField> = [
        ...definition.configFields,
        ...definition.secretFields,
      ];

      for (const field of fields) {
        expect({ field: field.key, named: guide }).toEqual({
          field: field.key,
          named: expect.stringContaining(`**${field.title}**`),
        });
      }

      // A setting most people leave alone is folded, and the guide says where.
      if (
        fields.some((field: LlmConnectionField): boolean => {
          return Boolean(field.isAdvanced);
        })
      ) {
        expect(guide).toContain("under **More fields**");
      }
    },
  );

  it.each(LlmConnectionCatalog)(
    "$provider gives the credential's prefix its field's description gives",
    (definition: LlmConnectionDefinition) => {
      const guide: string = section(
        englishPage(guidePage(definition)),
        definition.title,
      );

      for (const field of definition.secretFields) {
        const prefix: RegExpMatchArray | null =
          field.description.match(STARTS_WITH);

        if (prefix) {
          expect(codeSpans(guide)).toContain(prefix[1]);
        }
      }
    },
  );

  it.each(LlmConnectionCatalog)(
    "$provider says what the credential needs, as the form's hint does",
    (definition: LlmConnectionDefinition) => {
      const guide: string = section(
        englishPage(guidePage(definition)),
        definition.title,
      );

      for (const need of CREDENTIAL_NEEDS[definition.provider]) {
        expect({ need, hint: definition.hint }).toEqual({
          need,
          hint: expect.stringContaining(need),
        });
        expect({ need, guide }).toEqual({
          need,
          guide: expect.stringContaining(need),
        });
      }
    },
  );

  it("has a guide for every provider the catalog knows, and no other", () => {
    expect(Object.keys(CREDENTIAL_NEEDS).sort()).toEqual(
      LlmConnectionCatalog.map(
        (definition: LlmConnectionDefinition): string => {
          return definition.provider;
        },
      ).sort(),
    );
  });
});

describe("the AI Provider Accounts page", () => {
  const page: string = englishPage(PROVIDER_ACCOUNTS);
  const accounts: Array<LlmConnectionDefinition> =
    getLlmConnectionDefinitionsOfKind(LlmConnectionKind.ProviderAccount);

  it("lists the providers in the order the tiles show them, with the cost each reports or OneUptime estimates", () => {
    const rows: Array<Array<string>> = rowsOf(page, "What each provider gives");

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      accounts.map((definition: LlmConnectionDefinition): string => {
        return definition.title;
      }),
    );

    for (const definition of accounts) {
      const cost: string = rowNamed(rows, definition.title)[1] as string;

      expect({ provider: definition.provider, cost }).toEqual({
        provider: definition.provider,
        cost: definition.costIsEstimated
          ? "Estimated from tokens"
          : expect.stringMatching(/ reports$/),
      });
    }
  });

  it("says every account is read every 15 minutes, and the first read goes back 30 days", () => {
    for (const definition of accounts) {
      expect(definition.pullIntervalInMinutes).toBe(15);
      expect(definition.backfillDays).toBe(30);
    }

    expect(page).toContain("OneUptime reads its usage every 15 minutes");
    expect(page).toContain("brings in the last 30 days");
    expect(
      rowNamed(rowsOf(page, "How reads are scheduled"), "The first")[1],
    ).toBe("Within a minute of connecting, back 30 days");
  });

  it("reads the last days again on every read, as many as the reads reopen", () => {
    expect(source("usageDays")).toContain(
      "export const LLM_USAGE_REOPEN_DAYS: number = 3;",
    );
    expect(page).toContain("and the last 3 days again, today included");
  });

  it("tries a failed read again when the pull runner does", () => {
    const runner: string = source("pullRunner");
    const rows: Array<Array<string>> = rowsOf(page, "How reads are scheduled");

    expect(runner).toContain(
      "const RETRY_AFTER_REFUSED_CREDENTIAL_MS: number = 60 * 60 * 1000;",
    );
    expect(runner).toContain(
      "const RETRY_AFTER_FAILURE_MS: number = 15 * 60 * 1000;",
    );
    expect(rowNamed(rows, "After a key or permission is refused")[1]).toBe(
      "60 minutes later",
    );
    expect(rowNamed(rows, "After any other failure")[1]).toBe(
      "15 minutes later",
    );
  });

  it("tests the last 7 days and keeps nothing, as the test does", () => {
    expect(source("testResults")).toContain(
      "export const LLM_CONNECTION_TEST_DAYS: number = 7;",
    );
    expect(source("testPanel")).toContain(
      '"Reads the last 7 days of usage. Nothing is kept until you connect."',
    );
    expect(page).toContain(
      "OneUptime reads the last 7 days of usage and shows what it found",
    );
    expect(page).toContain("Nothing is kept until you connect.");
  });

  it("says Anthropic counts no requests, as its connector does", () => {
    expect(source("anthropic")).toContain(
      "The usage report counts no requests",
    );
    expect(page).toContain(
      "Every provider but Anthropic counts requests too: Anthropic's usage report has none.",
    );
  });

  it("names the three metrics, their token types and the attributes each point carries", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Budgets and alerts");
    const budgets: string = section(page, "Budgets and alerts");

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      LlmProviderUsageMetricNames.map((name: string): string => {
        return `\`${name}\``;
      }),
    );

    expect(
      codeSpans(rowNamed(rows, "`oneuptime.llm.provider.tokens`")[1] as string),
    ).toEqual(["gen_ai.token.type", ...AllLlmProviderTokenTypes]);

    for (const attribute of [
      LLM_CONNECTION_ID_ATTRIBUTE,
      LLM_CONNECTION_NAME_ATTRIBUTE,
      LLM_PROVIDER_NAME_ATTRIBUTE,
      LLM_PROVIDER_MODEL_ATTRIBUTE,
      LLM_PROVIDER_PERSON_ATTRIBUTE,
      LLM_PROVIDER_PROJECT_ATTRIBUTE,
      LLM_PROVIDER_API_KEY_ATTRIBUTE,
      LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE,
    ]) {
      expect(codeSpans(budgets)).toContain(attribute);
    }
  });

  it("ranks the usage by the groupings Usage's Provider accounts offers", () => {
    const labels: Array<string> = allMatches(
      source("providerUsageQuery"),
      LABEL_KEY,
      1,
    );
    const usage: string = section(page, "See the usage");

    expect(labels).toEqual([
      "Model",
      "Person",
      "Provider",
      "Project or resource",
      "API key",
      "Connection",
    ]);

    for (const label of labels) {
      expect(usage).toContain(`**${label}**`);
    }

    expect(source("usagePage")).toContain(
      'label: translationKey("Provider accounts")',
    );
    expect(usage).toContain("Open **Usage** and pick **Provider accounts**.");
  });

  it("budgets the bill with the Budgets form's own field and option", () => {
    const budgets: string = source("budgets");

    expect(budgets).toContain('title: "Count spend from",');
    expect(budgets).toContain('title: "Provider accounts",');
    expect(budgets).toContain('title: "Your AI calls",');
    expect(page).toContain("set **Count spend from** to **Provider accounts**");
  });

  it("lists a connection's actions as the list draws them", () => {
    const table: string = source("connectionsTable");

    for (const action of [
      "Read now",
      "Test",
      "Turn off",
      "Edit",
      "View error",
    ]) {
      expect(table).toContain(`title: "${action}",`);
      expect(page).toContain(`**${action}**`);
    }

    for (const column of ["Status", "Last read"]) {
      expect(table).toContain(`title: "${column}",`);
      expect(page).toContain(`**${column}**`);
    }
  });
});

describe("connecting, on both pages", () => {
  it("walks through the form's own steps and its Connect button", () => {
    const form: string = source("form");

    for (const step of ["Credentials", "Privacy", "Test"]) {
      expect(form).toContain(`title: "${step}" }`);
    }

    /*
     * No step only reads aloud: where a credential comes from is said on
     * Credentials, above the field it goes in.
     */
    expect(form).not.toContain('title: "Set up" }');

    expect(form).toContain(
      'submitButtonText={isEditing ? "Save changes" : "Connect"}',
    );

    for (const [page, heading] of Object.entries(CONNECT_SECTIONS)) {
      const steps: string = section(englishPage(page), heading);

      expect(steps).toContain("**Products → AI / LLM → Connect**");
      expect(steps).toContain("On **Credentials**");
      expect(steps).toContain("On **Test**, click **Test connection**.");
      expect(steps).toContain("Click **Connect**.");
    }

    expect(section(englishPage(COMPANY_TOOLS), "Connect a tool")).toContain(
      "On **Privacy**",
    );
    expect(
      section(englishPage(PROVIDER_ACCOUNTS), "Connect an account"),
    ).not.toContain("**Set up**");
  });

  it("opens each kind under the tiles' own card titles", () => {
    const connect: string = source("connectPage");

    expect(connect).toContain('title="Your AI provider accounts"');
    expect(connect).toContain(`title="Your company's AI tools"`);
    expect(englishPage(PROVIDER_ACCOUNTS)).toContain(
      "Under **Your AI provider accounts**, click the provider's tile.",
    );
    expect(englishPage(COMPANY_TOOLS)).toContain(
      "Under **Your company's AI tools**, click the tool's tile.",
    );
  });

  it("says only project owners and admins connect, as the connection's permissions say", () => {
    const connection: LlmObservabilityConnection =
      new LlmObservabilityConnection();

    for (const permissions of [
      connection.getCreatePermissions(),
      connection.getUpdatePermissions(),
      connection.getDeletePermissions(),
    ]) {
      expect([...permissions].sort()).toEqual(
        [Permission.ProjectOwner, Permission.ProjectAdmin].sort(),
      );
    }

    for (const page of [PROVIDER_ACCOUNTS, COMPANY_TOOLS]) {
      expect(section(englishPage(page), "Before you begin")).toContain(
        "The Project Owner or Project Admin role. Only they can connect, change or remove",
      );
    }
  });
});

describe("the Company AI Tools page", () => {
  const page: string = englishPage(COMPANY_TOOLS);
  const tools: Array<LlmConnectionDefinition> =
    getLlmConnectionDefinitionsOfKind(LlmConnectionKind.CompanyTool);

  it("says every tool is read every 15 minutes, and the first read goes back 7 days", () => {
    for (const definition of tools) {
      expect(definition.pullIntervalInMinutes).toBe(15);
      expect(definition.backfillDays).toBe(7);
    }

    expect(page).toContain("into **Conversations** every 15 minutes");
    expect(page).toContain("brings in the last 7 days");
  });

  it("counts the chats of the last 7 days in a test, and reads none of them", () => {
    expect(source("testPanel")).toContain(
      '"Counts the chats of the last 7 days. Nothing anyone wrote is read, shown or kept."',
    );
    expect(page).toContain(
      "OneUptime counts the chats of the last 7 days: nothing anyone wrote is read, shown or kept.",
    );
  });

  it("brings in a question with no answer after an hour, as both tools do, with no tokens and no cost", () => {
    for (const tool of ["claudeEnterprise", "copilot"]) {
      expect(source(tool)).toContain(
        "const UNANSWERED_AFTER_IN_MS: number = 60 * 60 * 1000;",
      );
      expect(source(tool)).toContain("carry no tokens");
    }

    expect(page).toContain(
      "A question with no answer for an hour arrives on its own",
    );
    expect(page).toContain("these calls carry no tokens and no cost");
  });

  it("sets who can read with the form's own setting, options and default", () => {
    const form: string = source("form");
    const rows: Array<Array<string>> = rowsOf(page, "Privacy");
    const readers: Array<string> = rowNamed(
      rows,
      "**Who can read conversations**",
    );
    const keep: Array<string> = rowNamed(rows, "**Keep what was written**");

    expect(form).toContain('title: "Who can read conversations",');
    expect(form).toContain("defaultValue: LlmConversationReaders.Admins,");
    // Two answers in view, as radio buttons.
    expect(form).toContain('title: "Project owners and admins",');
    expect(form).toContain('title: "Everyone who can read AI calls",');
    expect(readers[1]).toContain(
      "**Project owners and admins**, the default: nobody else in the project sees these conversations",
    );
    expect(readers[1]).toContain("**Everyone who can read AI calls**");

    expect(form).toContain('title: "Keep what was written",');
    expect(form).toContain('initialValues["storeConversationText"] = true;');
    expect(keep[1]).toContain("On, the default");
  });

  it("applies a change of readers within a minute, as the privacy cache allows", () => {
    expect(source("privacy")).toContain(
      "const CACHE_TTL_MS: number = 30 * 1000;",
    );
    expect(page).toContain("A change to who can read applies within a minute.");
  });

  it("has a section for every other AI tool the Connect tab names", () => {
    const titles: Array<string> = allMatches(
      source("otherTools"),
      TITLE_KEY,
      1,
    );
    const others: Array<string> = scanMarkdown(
      section(page, "Other AI tools"),
    ).headings.map((heading: DocsHeading): string => {
      return heading.text;
    });

    expect(titles.length).toBeGreaterThan(0);
    expect(others).toEqual(titles);
  });

  it("tells the reader to tell their people first, before anything else", () => {
    // The sections, the page's title aside.
    const sections: Array<string> = scanMarkdown(page)
      .headings.filter((heading: DocsHeading): boolean => {
        return heading.level === 2;
      })
      .map((heading: DocsHeading): string => {
        return heading.text;
      });

    expect(sections[0]).toBe("Tell your people first");
    expect(section(page, "Tell your people first")).toContain("> [!IMPORTANT]");
  });
});

describe("the other AI pages", () => {
  it("AI / LLM Observability shows the provider accounts beside the calls, and never adds them", () => {
    const page: string = englishPage(LLM);

    expect(source("usagePage")).toContain(
      'label: translationKey("Your AI calls")',
    );
    expect(page).toContain(
      "These are **Your AI calls**. Pick **Provider accounts** instead",
    );
    expect(page).toContain("The two are never added together.");
    expect(page).toContain(
      "A budget whose **Count spend from** is **Provider accounts** counts what your connected accounts were billed instead",
    );
    expect(page).toContain(
      "The conversations of a company AI tool are the exception: only project owners and admins can read them",
    );
  });

  it("AI Gateways reads OpenRouter's user and session as the person and the conversation", () => {
    const openRouter: string = section(englishPage(AI_GATEWAYS), "OpenRouter");

    expect(LlmUserIdBaseAttributeKeys[0]).toBe("user.id");
    expect(LlmConversationIdAttributeKeys).toContain("session.id");
    expect(LlmPromptJsonAttributeKeys).toContain("gen_ai.prompt");
    expect(LlmCompletionJsonAttributeKeys).toContain("gen_ai.completion");
    expect(openRouter).toContain(
      "A request's `user` arrives as `user.id`, which OneUptime reads as the person who made the call",
    );
    expect(openRouter).toContain(
      "its `session_id` as `session.id`, which groups calls into a conversation",
    );
    expect(openRouter).toContain("as `gen_ai.prompt` and `gen_ai.completion`");
    expect(openRouter).toContain("`https://oneuptime.com/otlp/v1/traces`");
  });

  it("AI Coding Assistants no longer says OneUptime reads no provider's usage", () => {
    const page: string = englishPage("telemetry/ai-coding-assistants");

    expect(page).not.toContain(
      "does not poll any vendor's admin or billing API",
    );
    expect(page).not.toContain("OpenAI's usage and costs endpoints");
    expect(page).toContain(
      "[AI Provider Accounts](/docs/telemetry/ai-provider-accounts)",
    );
  });
});
