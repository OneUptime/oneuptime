import { afterEach, describe, expect, test } from "@jest/globals";
import AIChatPermissionMode from "../../../../../Types/AI/AIChatPermissionMode";
import { AIChatCitationTargetType } from "../../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import AIDocsLibrary, {
  AIDocsPage,
  AIDocsReader,
  AIDocsSearchHit,
} from "../../../../../Server/Utils/AI/Docs/AIDocsLibrary";
import {
  DOCS_UNAVAILABLE_MESSAGE,
  FIND_DASHBOARD_PAGE_TOOL_NAME,
  FindDashboardPageTool,
  findDocsSection,
  getDocsLanguageArgument,
  MAX_DOCS_READ_CHARS,
  READ_DOCS_TOOL_NAME,
  ReadDocsTool,
  SEARCH_DOCS_TOOL_NAME,
  SearchDocsTool,
} from "../../../../../Server/Utils/AI/Toolbox/DocsTools";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { LLMToolDefinition } from "../../../../../Server/Utils/LLM/LLMService";

/*
 * ASK AI'S DOCS TOOLS (issue #6828): search_docs and read_docs read the
 * installation's own docs through the reader App registers, and
 * find_dashboard_page finds the page of the project where a thing is done
 * in the catalog generated from Search's page index. Each citation is what
 * takes the person to the page, so each is pinned here: built from the
 * reader's and the catalog's own values, never from the model's words.
 */

const projectId: ObjectID = new ObjectID(
  "11111111-1111-1111-1111-111111111111",
);

const contextFor: (permissions: Array<Permission>) => ToolContext = (
  permissions: Array<Permission>,
): ToolContext => {
  return {
    projectId,
    props: {
      tenantId: projectId,
      userId: new ObjectID("22222222-2222-2222-2222-222222222222"),
      userGlobalAccessPermission: {
        globalPermissions: [Permission.Public],
        projectIds: [projectId],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [projectId.toString()]: {
          projectId,
          permissions: permissions.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission" as const,
            };
          }),
          _type: "UserTenantAccessPermission",
        },
      },
    } as unknown as DatabaseCommonInteractionProps,
  };
};

const MEMBER: ToolContext = contextFor([Permission.ProjectMember]);

const PAGE: AIDocsPage = {
  page: "notifications/sms",
  title: "SMS",
  group: "Notifications",
  language: "en",
  markdown: [
    "Get a text message when something needs you.",
    "",
    "## Add a phone number",
    "",
    "1. Open **User Settings > Notification Methods**.",
    "2. Click **Add Phone Number**.",
    "",
    "### Verify it",
    "",
    "Type the code you get.",
    "",
    "```bash",
    "## not a heading",
    "```",
    "",
    "## Costs",
    "",
    "SMS is billed per message.",
  ].join("\n"),
  sections: [
    { title: "Add a phone number", anchor: "add-a-phone-number" },
    { title: "Verify it", anchor: "verify-it" },
    { title: "Costs", anchor: "costs" },
  ],
};

interface RecordingReader extends AIDocsReader {
  searches: Array<{ query: string; language: string; limit: number }>;
  reads: Array<{ page: string; language: string }>;
}

const makeReader: (data?: {
  hits?: Array<AIDocsSearchHit>;
  page?: AIDocsPage | null;
}) => RecordingReader = (data?: {
  hits?: Array<AIDocsSearchHit>;
  page?: AIDocsPage | null;
}): RecordingReader => {
  const reader: RecordingReader = {
    searches: [],
    reads: [],
    search: async (args: {
      query: string;
      language: string;
      limit: number;
    }): Promise<Array<AIDocsSearchHit>> => {
      reader.searches.push(args);
      return data?.hits || [];
    },
    readPage: async (args: {
      page: string;
      language: string;
    }): Promise<AIDocsPage | null> => {
      reader.reads.push(args);
      return data?.page === undefined ? PAGE : data.page;
    },
  };
  return reader;
};

afterEach(() => {
  AIDocsLibrary.setReader(null);
});

describe("the docs tools in the toolbox", () => {
  test("are offered in every permission mode, Read-only too: they change nothing", () => {
    for (const mode of [
      AIChatPermissionMode.ReadOnly,
      AIChatPermissionMode.AskForApproval,
      AIChatPermissionMode.AutoRun,
    ]) {
      const names: Array<string> = AIToolbox.getLlmToolDefinitions(mode).map(
        (definition: LLMToolDefinition): string => {
          return definition.name;
        },
      );
      expect(names).toEqual(
        expect.arrayContaining([
          SEARCH_DOCS_TOOL_NAME,
          READ_DOCS_TOOL_NAME,
          FIND_DASHBOARD_PAGE_TOOL_NAME,
        ]),
      );
    }

    for (const name of [
      SEARCH_DOCS_TOOL_NAME,
      READ_DOCS_TOOL_NAME,
      FIND_DASHBOARD_PAGE_TOOL_NAME,
    ]) {
      expect(AIToolbox.isMutationTool(name)).toBe(false);
    }
  });

  test("any member of the project may use them, a viewer too", () => {
    for (const tool of [SearchDocsTool, ReadDocsTool, FindDashboardPageTool]) {
      expect(AIToolbox.hasPermissionForTool(tool, MEMBER)).toBe(true);
      expect(
        AIToolbox.hasPermissionForTool(tool, contextFor([Permission.Viewer])),
      ).toBe(true);
      expect(AIToolbox.hasPermissionForTool(tool, contextFor([]))).toBe(false);
    }
  });

  test("run through the toolbox's gate and hand their result back", async () => {
    AIDocsLibrary.setReader(
      makeReader({
        hits: [
          {
            page: "notifications/sms",
            title: "SMS",
            group: "Notifications",
            summary: "Get a text message.",
            language: "en",
          },
        ],
      }),
    );

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: SEARCH_DOCS_TOOL_NAME,
      args: { query: "text message" },
      ctx: MEMBER,
    });

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("notifications/sms");
  });
});

describe("getDocsLanguageArgument", () => {
  test("keeps a language the docs are written in, and reads the forms a model may pass", () => {
    expect(getDocsLanguageArgument({ language: "de" })).toBe("de");
    expect(getDocsLanguageArgument({ language: "fa" })).toBe("fa");
    expect(getDocsLanguageArgument({ language: "de-DE" })).toBe("de");
    expect(getDocsLanguageArgument({ language: "DE" })).toBe("de");
    expect(getDocsLanguageArgument({ language: "zh-cn" })).toBe("zh-CN");
    expect(getDocsLanguageArgument({ language: "zh-Hant" })).toBe("zh-TW");
    expect(getDocsLanguageArgument({ language: "pt_BR" })).toBe("pt");
  });

  test("falls back to English for none, or one the docs are not written in", () => {
    expect(getDocsLanguageArgument({})).toBe("en");
    expect(getDocsLanguageArgument({ language: "tlh" })).toBe("en");
    expect(getDocsLanguageArgument({ language: 42 } as JSONObject)).toBe(
      "en",
    );
  });
});

describe("search_docs", () => {
  test("says the docs are not here, rather than guess, when no reader is registered", async () => {
    const result: ToolExecutionResult = await SearchDocsTool.execute(
      { query: "sms" },
      MEMBER,
    );
    expect(result.dataForLlm).toBe(DOCS_UNAVAILABLE_MESSAGE);
    expect(result.rowCount).toBe(0);
    expect(result.citationTarget).toBeUndefined();
  });

  test("asks for a query when it has none, and searches nothing", async () => {
    const reader: RecordingReader = makeReader();
    AIDocsLibrary.setReader(reader);

    const result: ToolExecutionResult = await SearchDocsTool.execute(
      { query: "   " },
      MEMBER,
    );
    expect(result.dataForLlm).toContain("pass query");
    expect(reader.searches).toEqual([]);
  });

  test("searches in the person's language, with a bounded limit", async () => {
    const reader: RecordingReader = makeReader();
    AIDocsLibrary.setReader(reader);

    await SearchDocsTool.execute(
      { query: "SMS", language: "de-AT", limit: 500 },
      MEMBER,
    );
    expect(reader.searches).toEqual([
      { query: "SMS", language: "de", limit: 10 },
    ]);
  });

  test("says nothing matched, and that the docs then do not cover it", async () => {
    AIDocsLibrary.setReader(makeReader({ hits: [] }));

    const result: ToolExecutionResult = await SearchDocsTool.execute(
      { query: "quantum billing" },
      MEMBER,
    );
    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("the docs do not cover this");
  });

  test("returns each page with its best section, and the language a page is still in", async () => {
    AIDocsLibrary.setReader(
      makeReader({
        hits: [
          {
            page: "notifications/sms",
            title: "SMS",
            group: "Benachrichtigungen",
            summary: "Eine SMS bekommen.",
            language: "de",
            section: {
              title: "Telefonnummer hinzufügen",
              anchor: "telefonnummer-hinzufugen",
            },
          },
          {
            page: "status-pages/custom-domain",
            title: "Custom Domain",
            group: "Status Pages",
            summary: "Not translated yet.",
            language: "en",
          },
        ],
      }),
    );

    const result: ToolExecutionResult = await SearchDocsTool.execute(
      { query: "SMS", language: "de" },
      MEMBER,
    );
    const data: JSONObject = JSON.parse(result.dataForLlm) as JSONObject;
    const pages: Array<JSONObject> = data["pages"] as Array<JSONObject>;

    expect(result.rowCount).toBe(2);
    expect(pages[0]).toEqual({
      page: "notifications/sms",
      title: "SMS",
      group: "Benachrichtigungen",
      bestSection: "Telefonnummer hinzufügen",
      anchor: "telefonnummer-hinzufugen",
      summary: "Eine SMS bekommen.",
    });
    expect(pages[1]!["writtenIn"]).toBe("en");
    // A search is not evidence: it opens nothing, and says to read the page.
    expect(result.citationTarget).toBeUndefined();
    expect(String(data["next"])).toContain("read_docs");
  });
});

describe("read_docs", () => {
  test("says the docs are not here when no reader is registered", async () => {
    const result: ToolExecutionResult = await ReadDocsTool.execute(
      { page: "notifications/sms" },
      MEMBER,
    );
    expect(result.dataForLlm).toBe(DOCS_UNAVAILABLE_MESSAGE);
    expect(result.citationTarget).toBeUndefined();
  });

  test("a page that does not exist opens nothing, and says to search", async () => {
    AIDocsLibrary.setReader(makeReader({ page: null }));

    const result: ToolExecutionResult = await ReadDocsTool.execute(
      { page: "made/up-page" },
      MEMBER,
    );
    expect(result.rowCount).toBe(0);
    expect(result.citationTarget).toBeUndefined();
    expect(result.dataForLlm).toContain("search_docs");
  });

  test("reads the whole page, and its citation opens it in the language its text is in", async () => {
    const reader: RecordingReader = makeReader({
      page: { ...PAGE, language: "en" },
    });
    AIDocsLibrary.setReader(reader);

    const result: ToolExecutionResult = await ReadDocsTool.execute(
      { page: "notifications/sms", language: "fa" },
      MEMBER,
    );
    const data: JSONObject = JSON.parse(result.dataForLlm) as JSONObject;

    expect(reader.reads).toEqual([
      { page: "notifications/sms", language: "fa" },
    ]);
    expect(data["content"]).toBe(PAGE.markdown);
    expect(data["writtenIn"]).toBe("en");
    expect(data["sections"]).toHaveLength(3);
    expect(result.citationLabel).toBe("Docs: SMS");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.DocsPage,
      params: { page: "notifications/sms", language: "en" },
    });
  });

  test("reads one section by its anchor, and its citation opens the page at it", async () => {
    AIDocsLibrary.setReader(makeReader());

    const result: ToolExecutionResult = await ReadDocsTool.execute(
      { page: "notifications/sms", section: "#add-a-phone-number" },
      MEMBER,
    );
    const data: JSONObject = JSON.parse(result.dataForLlm) as JSONObject;

    expect(data["section"]).toBe("Add a phone number");
    expect(String(data["content"])).toContain("Add Phone Number");
    // Its own h3 is part of it; the next h2 is not.
    expect(String(data["content"])).toContain("Verify it");
    expect(String(data["content"])).not.toContain("billed per message");
    expect(result.citationLabel).toBe("Docs: SMS > Add a phone number");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.DocsPage,
      params: {
        page: "notifications/sms",
        language: "en",
        anchor: "add-a-phone-number",
      },
    });
  });

  test("reads the whole page, saying so, when the section asked for is not on it", async () => {
    AIDocsLibrary.setReader(makeReader());

    const result: ToolExecutionResult = await ReadDocsTool.execute(
      { page: "notifications/sms", section: "pricing tiers" },
      MEMBER,
    );
    const data: JSONObject = JSON.parse(result.dataForLlm) as JSONObject;

    expect(String(data["note"])).toContain('no section "pricing tiers"');
    expect(data["content"]).toBe(PAGE.markdown);
    expect(result.citationTarget?.params?.["anchor"]).toBeUndefined();
  });

  test("cuts a page longer than one read, and says to read a section", async () => {
    AIDocsLibrary.setReader(
      makeReader({
        page: { ...PAGE, markdown: "word ".repeat(MAX_DOCS_READ_CHARS) },
      }),
    );

    const result: ToolExecutionResult = await ReadDocsTool.execute(
      { page: "notifications/sms" },
      MEMBER,
    );
    const data: JSONObject = JSON.parse(result.dataForLlm) as JSONObject;

    expect(result.isTruncated).toBe(true);
    expect(String(data["content"]).length).toBe(MAX_DOCS_READ_CHARS);
    expect(String(data["note"])).toContain("section");
  });
});

describe("findDocsSection", () => {
  test("finds a section by its heading as well as its anchor", () => {
    expect(findDocsSection(PAGE, "Costs")?.markdown).toBe(
      "## Costs\n\nSMS is billed per message.",
    );
    expect(findDocsSection(PAGE, "costs")?.section.anchor).toBe("costs");
  });

  test("an h3 ends at the next heading of any level up to its own", () => {
    const found: { markdown: string } | null = findDocsSection(
      PAGE,
      "verify-it",
    );
    expect(found?.markdown).toContain("Type the code you get.");
    // The fenced "## not a heading" is code, not the end of the section.
    expect(found?.markdown).toContain("## not a heading");
    expect(found?.markdown).not.toContain("## Costs");
  });

  test("is null for a section the page does not have", () => {
    expect(findDocsSection(PAGE, "nope")).toBeNull();
  });
});

describe("find_dashboard_page", () => {
  test("its citation opens the page it found first, by the catalog's route and title", async () => {
    const result: ToolExecutionResult = await FindDashboardPageTool.execute(
      { query: "Notification Methods" },
      MEMBER,
    );
    const data: JSONObject = JSON.parse(result.dataForLlm) as JSONObject;

    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.DashboardPage,
      params: {
        path: "/dashboard/:projectId/user-settings/notification-methods",
        title: "Notification Methods",
      },
    });
    expect(result.citationLabel).toBe(
      "Page: User Settings > Alerts & Notifications > Notification Methods",
    );
    expect(String(data["citationOpens"])).toContain("Notification Methods");
    // The model is told where each page is, never an address to write.
    expect(result.dataForLlm).not.toContain("/dashboard/");
  });

  test("finds the page Search's create action opens", async () => {
    const result: ToolExecutionResult = await FindDashboardPageTool.execute(
      { query: "Create Monitor" },
      MEMBER,
    );
    expect(result.citationTarget?.params?.["path"]).toBe(
      "/dashboard/:projectId/monitors/create",
    );
  });

  test("opens nothing when no page is named like that", async () => {
    const result: ToolExecutionResult = await FindDashboardPageTool.execute(
      { query: "zzqx flux capacitor" },
      MEMBER,
    );
    expect(result.rowCount).toBe(0);
    expect(result.citationTarget).toBeUndefined();
    expect(result.dataForLlm).toContain("without a page");
  });

  test("opens nothing for an empty query", async () => {
    const result: ToolExecutionResult = await FindDashboardPageTool.execute(
      {},
      MEMBER,
    );
    expect(result.citationTarget).toBeUndefined();
  });
});
