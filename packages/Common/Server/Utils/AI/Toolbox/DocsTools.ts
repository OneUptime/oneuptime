import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import {
  DEFAULT_DOCS_LANGUAGE,
  isSupportedDocsLanguage,
} from "../../../../Types/Docs/DocsLanguage";
import { IsBillingEnabled } from "../../../EnvironmentConfig";
import AIDocsLibrary, {
  AIDocsPage,
  AIDocsReader,
  AIDocsSearchHit,
  AIDocsSection,
} from "../Docs/AIDocsLibrary";
import DashboardPageFinder, {
  AIDashboardPage,
} from "../Docs/DashboardPageFinder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * "HOW DO I...?" ANSWERED FROM OneUptime's OWN DOCS (issue #6828).
 *
 * Ask AI answered only from the project's data, and was told to refuse
 * the rest, so a newcomer's first questions - "how do I get a text when my
 * site is down?", "what is an episode?" - got nothing. These tools give it
 * the docs this installation serves (Docs/AIDocsLibrary), and the page of
 * the project where a thing is done (Docs/DashboardPageFinder):
 *
 * - search_docs finds the pages, in the reader's language;
 * - read_docs reads one, or one of its sections, and its citation opens
 *   that page of the docs at that section;
 * - find_dashboard_page finds the Dashboard page by the name the menus
 *   give it, and its citation opens that page of the project.
 *
 * They read nothing of the project, so every member may use them. Kept
 * small and alike, so a later tool that sets something up by conversation
 * (#6829) reads the docs and names the page the same way.
 */

export const SEARCH_DOCS_TOOL_NAME: string = "search_docs";
export const READ_DOCS_TOOL_NAME: string = "read_docs";
export const FIND_DASHBOARD_PAGE_TOOL_NAME: string = "find_dashboard_page";

// Everyone in the project: the docs and the Dashboard's page names are no one's data.
const DOCS_TOOL_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
];

// How much of a page one read hands the model; a longer page is read a section at a time.
export const MAX_DOCS_READ_CHARS: number = 24_000;
const DEFAULT_SEARCH_LIMIT: number = 6;
const MAX_SEARCH_LIMIT: number = 10;
const DASHBOARD_PAGE_LIMIT: number = 5;

export const DOCS_UNAVAILABLE_MESSAGE: string =
  "The docs are not available to this conversation. Say that you could not read OneUptime's docs here, and do not answer from memory.";

const LANGUAGE_ARGUMENT: JSONObject = {
  type: "string",
  description:
    "The code of the language the person writes in: en, de, fr, es, it, pt, nl, da, no, sv, ru, ja, ko, zh-CN, zh-TW, hi or fa. A page not translated into it is read in English. Defaults to en.",
};

export const getDocsLanguageArgument: (args: JSONObject) => string = (
  args: JSONObject,
): string => {
  const language: string | undefined = ToolArgs.getString(args, "language");

  if (!language) {
    return DEFAULT_DOCS_LANGUAGE;
  }

  if (isSupportedDocsLanguage(language)) {
    return language;
  }

  // "de-DE", "zh-cn", "ZH-TW": the docs' own code for it.
  const lowered: string = language.toLowerCase();
  if (lowered === "zh-cn" || lowered === "zh-hans") {
    return "zh-CN";
  }
  if (lowered === "zh-tw" || lowered === "zh-hant") {
    return "zh-TW";
  }
  const base: string = lowered.split(/[-_]/)[0] || "";
  return isSupportedDocsLanguage(base) ? base : DEFAULT_DOCS_LANGUAGE;
};

const unavailable: (citationLabel: string) => ToolExecutionResult = (
  citationLabel: string,
): ToolExecutionResult => {
  return {
    dataForLlm: DOCS_UNAVAILABLE_MESSAGE,
    rowCount: 0,
    citationLabel,
    redactionCount: 0,
    isTruncated: false,
  };
};

/*
 * A section of `page`, by its anchor or its heading: from its heading to
 * the next heading of the same level or higher. Null when it has none.
 */
export const findDocsSection: (
  page: AIDocsPage,
  wanted: string,
) => { section: AIDocsSection; markdown: string } | null = (
  page: AIDocsPage,
  wanted: string,
): { section: AIDocsSection; markdown: string } | null => {
  const normalized: string = wanted.trim().replace(/^#/, "").toLowerCase();

  const section: AIDocsSection | undefined = page.sections.find(
    (candidate: AIDocsSection): boolean => {
      return (
        candidate.anchor.toLowerCase() === normalized ||
        candidate.title.trim().toLowerCase() === normalized
      );
    },
  );

  if (!section) {
    return null;
  }

  const lines: Array<string> = page.markdown.split("\n");
  let start: number = -1;
  let level: number = 0;
  let inFence: boolean = false;

  for (let i: number = 0; i < lines.length; i++) {
    const line: string = lines[i]!;

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const heading: RegExpMatchArray | null = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);

    if (!heading) {
      continue;
    }

    if (start < 0) {
      if (
        heading[2]!.replace(/[`*_]/g, "").trim().toLowerCase() ===
        section.title.trim().toLowerCase()
      ) {
        start = i;
        level = heading[1]!.length;
      }
      continue;
    }

    if (heading[1]!.length <= level) {
      return {
        section,
        markdown: lines.slice(start, i).join("\n").trim(),
      };
    }
  }

  if (start < 0) {
    return null;
  }

  return { section, markdown: lines.slice(start).join("\n").trim() };
};

export const SearchDocsTool: ObservabilityTool = {
  name: SEARCH_DOCS_TOOL_NAME,
  description:
    "Search OneUptime's own documentation - the docs this installation serves - for how OneUptime works: what a word means, how to set something up, where a setting is, what a feature does. Returns the best pages, each with its group, the section that matched best and its first paragraph. Use it for questions about OneUptime itself, not about this project's data. Search results are not evidence: read the page with read_docs before you answer from it.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What to look for, in a few words: \"SMS notifications\", \"episode\", \"custom domain status page\". Words of the docs' language work best.",
      },
      language: LANGUAGE_ARGUMENT,
      limit: {
        type: "number",
        description: `How many pages to return (default ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}).`,
      },
    },
    required: ["query"],
  },
  requiredPermissions: DOCS_TOOL_PERMISSIONS,
  execute: async (args: JSONObject): Promise<ToolExecutionResult> => {
    const query: string = (ToolArgs.getString(args, "query") || "").slice(
      0,
      300,
    );
    const language: string = getDocsLanguageArgument(args);
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: DEFAULT_SEARCH_LIMIT,
      min: 1,
      max: MAX_SEARCH_LIMIT,
    });
    const citationLabel: string = `Docs search: ${query}`;
    const reader: AIDocsReader | null = AIDocsLibrary.getReader();

    if (!reader) {
      return unavailable(citationLabel);
    }

    if (!query) {
      return {
        dataForLlm:
          "Error: pass query, the words to look for in the docs. Adjust the arguments and try again.",
        rowCount: 0,
        citationLabel,
        redactionCount: 0,
        isTruncated: false,
      };
    }

    const hits: Array<AIDocsSearchHit> = await reader.search({
      query,
      language,
      limit,
    });

    if (hits.length === 0) {
      return {
        dataForLlm: `No docs page matched "${query}". Try other words, or English words, once; if nothing matches, the docs do not cover this.`,
        rowCount: 0,
        citationLabel,
        redactionCount: 0,
        isTruncated: false,
      };
    }

    return {
      dataForLlm: JSON.stringify(
        {
          pages: hits.map((hit: AIDocsSearchHit): JSONObject => {
            return {
              page: hit.page,
              title: hit.title,
              group: hit.group,
              ...(hit.section
                ? { bestSection: hit.section.title, anchor: hit.section.anchor }
                : {}),
              summary: hit.summary,
              ...(hit.language !== language
                ? { writtenIn: hit.language }
                : {}),
            };
          }),
          next: "Read the page that fits with read_docs (page, and section for the best section) before answering from it.",
        },
        null,
        1,
      ),
      rowCount: hits.length,
      citationLabel,
      redactionCount: 0,
      isTruncated: false,
    };
  },
};

export const ReadDocsTool: ObservabilityTool = {
  name: READ_DOCS_TOOL_NAME,
  description:
    "Read a page of OneUptime's own documentation, or one section of it, as Markdown, to answer how OneUptime works from it. Cite this result after every claim taken from it: its citation opens the page (at the section) for the person. A long page returns its sections to read one at a time.",
  inputSchema: {
    type: "object",
    properties: {
      page: {
        type: "string",
        description:
          'The page, as search_docs returns it: "monitor/website-monitor".',
      },
      section: {
        type: "string",
        description:
          "Optional: one section to read, by its anchor or heading, as search_docs or an earlier read returns it.",
      },
      language: LANGUAGE_ARGUMENT,
    },
    required: ["page"],
  },
  requiredPermissions: DOCS_TOOL_PERMISSIONS,
  execute: async (args: JSONObject): Promise<ToolExecutionResult> => {
    const pageArgument: string = ToolArgs.getString(args, "page") || "";
    const sectionArgument: string | undefined = ToolArgs.getString(
      args,
      "section",
    );
    const language: string = getDocsLanguageArgument(args);
    const reader: AIDocsReader | null = AIDocsLibrary.getReader();

    if (!reader) {
      return unavailable(`Docs: ${pageArgument}`);
    }

    const page: AIDocsPage | null = pageArgument
      ? await reader.readPage({ page: pageArgument, language })
      : null;

    if (!page) {
      return {
        dataForLlm: `There is no docs page "${pageArgument}". Find the page with search_docs, and pass its page exactly as returned.`,
        rowCount: 0,
        citationLabel: `Docs: ${pageArgument}`,
        redactionCount: 0,
        isTruncated: false,
      };
    }

    const sectionsList: Array<JSONObject> = page.sections.map(
      (section: AIDocsSection): JSONObject => {
        return { title: section.title, anchor: section.anchor };
      },
    );

    let section: AIDocsSection | undefined = undefined;
    let content: string = page.markdown.trim();
    let note: string | undefined = undefined;

    if (sectionArgument) {
      const found: { section: AIDocsSection; markdown: string } | null =
        findDocsSection(page, sectionArgument);

      if (found) {
        section = found.section;
        content = found.markdown;
      } else {
        note = `This page has no section "${sectionArgument}": the whole page follows.`;
      }
    }

    const isTruncated: boolean = content.length > MAX_DOCS_READ_CHARS;

    if (isTruncated) {
      content = content.slice(0, MAX_DOCS_READ_CHARS);
      note =
        "The page is longer than one read: it is cut here. Read the section you need by passing section.";
    }

    return {
      dataForLlm: JSON.stringify(
        {
          page: page.page,
          title: page.title,
          group: page.group,
          writtenIn: page.language,
          ...(section ? { section: section.title } : {}),
          ...(note ? { note } : {}),
          sections: sectionsList,
          content,
        },
        null,
        1,
      ),
      rowCount: 1,
      citationLabel: section
        ? `Docs: ${page.title} > ${section.title}`
        : `Docs: ${page.title}`,
      citationTarget: {
        type: AIChatCitationTargetType.DocsPage,
        params: {
          page: page.page,
          language: page.language,
          ...(section ? { anchor: section.anchor } : {}),
        },
      },
      redactionCount: 0,
      isTruncated,
    };
  },
};

export const FindDashboardPageTool: ObservabilityTool = {
  name: FIND_DASHBOARD_PAGE_TOOL_NAME,
  description:
    "Find the page of this project in the OneUptime Dashboard where something is done or set - by the page's or the setting's English name as the docs and the menus give it (\"Create Monitor\", \"Notification Methods\", \"API Keys\", \"Incidents Custom Fields\"). Returns the best pages with where each is. The citation of this result opens its first page for the person: cite it at the end of a how-do-I answer. To send them to another of the pages returned, call again with that page's name and place.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The page's or setting's name in English, with where it is when the name is common: \"Phone Numbers for SMS Notifications\", \"Status Pages Custom Fields\".",
      },
    },
    required: ["query"],
  },
  requiredPermissions: DOCS_TOOL_PERMISSIONS,
  execute: async (
    args: JSONObject,
    _ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const query: string = (ToolArgs.getString(args, "query") || "").slice(
      0,
      200,
    );
    const citationLabel: string = `Dashboard page: ${query}`;
    const pages: Array<AIDashboardPage> = query
      ? DashboardPageFinder.find({
          query,
          limit: DASHBOARD_PAGE_LIMIT,
          isBillingEnabled: IsBillingEnabled,
        })
      : [];
    const first: AIDashboardPage | undefined = pages[0];

    if (!first) {
      return {
        dataForLlm: `No page of the Dashboard is named like "${query}". Try the name the docs give the page, once; otherwise end the answer without a page.`,
        rowCount: 0,
        citationLabel,
        redactionCount: 0,
        isTruncated: false,
      };
    }

    return {
      dataForLlm: JSON.stringify(
        {
          pages: pages.map((page: AIDashboardPage): JSONObject => {
            return {
              title: page.title,
              where: page.where.join(" > "),
              kind: page.kind,
            };
          }),
          citationOpens: `${first.where.join(" > ")} > ${first.title}`,
        },
        null,
        1,
      ),
      rowCount: pages.length,
      citationLabel: `Page: ${[...first.where, first.title].join(" > ")}`,
      citationTarget: {
        type: AIChatCitationTargetType.DashboardPage,
        params: { path: first.path, title: first.title },
      },
      redactionCount: 0,
      isTruncated: false,
    };
  },
};
