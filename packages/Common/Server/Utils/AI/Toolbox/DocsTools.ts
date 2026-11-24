import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import {
  FIND_DASHBOARD_PAGE_TOOL_NAME,
  READ_DOCS_TOOL_NAME,
  SEARCH_DOCS_TOOL_NAME,
} from "../../../../Types/AI/AskAiDocsTools";
import {
  ASK_AI_RECORD_KINDS,
  AskAiRecordKind,
  AskAiRecordKindPages,
  AskAiRecordPage,
  isAskAiRecordKind,
} from "../../../../Types/AI/AskAiRecordPages";
import {
  DEFAULT_DOCS_LANGUAGE,
  isSupportedDocsLanguage,
} from "../../../../Types/Docs/DocsLanguage";
import ProductKey from "../../../../Types/Product/ProductKey";
import {
  getProductOffMessage,
  ServerProductOffReason,
  ServerProductsOff,
} from "../../../../Types/Product/ServerProducts";
import { IsBillingEnabled } from "../../../EnvironmentConfig";
import ServerProducts from "../../ServerProducts/ServerProducts";
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
  getDashboardPageCitationTarget,
  getRecordPageCitationTarget,
} from "../Docs/DashboardPageCitations";
import {
  getFirstOffProduct,
  getProductsOfDashboardPage,
  getProductsOfRecordPage,
} from "../Docs/DashboardPageProducts";
import DashboardRecordPageFinder from "../Docs/DashboardRecordPageFinder";
import { readDashboardRecordName } from "../Docs/DashboardRecordReaders";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

import { AI_TOOL_CITATIONS } from "../../../../Types/AI/AIReadTableWords";
import { aiActionMenuPath } from "../../../../Types/AI/AIActionWords";
import { citationSentence, ToolCitation } from "./ReadTableWords";
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

/*
 * The tools' names live in Types/AI/AskAiDocsTools, so the prompt and the
 * ratings name them without loading these tools, which read records
 * through the project's services (#7065).
 */
export {
  FIND_DASHBOARD_PAGE_TOOL_NAME,
  READ_DOCS_TOOL_NAME,
  SEARCH_DOCS_TOOL_NAME,
};

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
const FENCE_LINE: RegExp = /^\s*(```|~~~)/;
const HEADING_LINE: RegExp = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

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

const unavailable: (citation: ToolCitation) => ToolExecutionResult = (
  citation: ToolCitation,
): ToolExecutionResult => {
  return {
    dataForLlm: DOCS_UNAVAILABLE_MESSAGE,
    rowCount: 0,
    ...citation,
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

    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const heading: RegExpMatchArray | null = line.match(HEADING_LINE);

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
          'What to look for, in a few words: "SMS notifications", "episode", "custom domain status page". Words of the docs\' language work best.',
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
    // In the reader's language (issue #8311).
    const citation: ToolCitation = citationSentence(
      AI_TOOL_CITATIONS.docsSearch,
      { query },
    );
    const reader: AIDocsReader | null = AIDocsLibrary.getReader();

    if (!reader) {
      return unavailable(citation);
    }

    if (!query) {
      return {
        dataForLlm:
          "Error: pass query, the words to look for in the docs. Adjust the arguments and try again.",
        rowCount: 0,
        ...citation,
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
        ...citation,
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
              ...(hit.language !== language ? { writtenIn: hit.language } : {}),
            };
          }),
          next: "Read the page that fits with read_docs (page, and section for the best section) before answering from it.",
        },
        null,
        1,
      ),
      rowCount: hits.length,
      ...citation,
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
      return unavailable(
        citationSentence(AI_TOOL_CITATIONS.docsPage, { page: pageArgument }),
      );
    }

    const page: AIDocsPage | null = pageArgument
      ? await reader.readPage({ page: pageArgument, language })
      : null;

    if (!page) {
      return {
        dataForLlm: `There is no docs page "${pageArgument}". Find the page with search_docs, and pass its page exactly as returned.`,
        rowCount: 0,
        ...citationSentence(AI_TOOL_CITATIONS.docsPage, {
          page: pageArgument,
        }),
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
      ...(section
        ? citationSentence(AI_TOOL_CITATIONS.docsSection, {
            page: page.title,
            section: section.title,
          })
        : citationSentence(AI_TOOL_CITATIONS.docsPage, { page: page.title })),
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

/*
 * What is switched off on this server, to leave its pages out (#6815).
 * Read for every person alike, and kept for a few seconds
 * (ServerProducts): "everything on" when it cannot be read, as every
 * other place that hides a switched-off product reads it.
 */
const readOffProducts: () => Promise<ServerProductsOff> =
  async (): Promise<ServerProductsOff> => {
    try {
      return await ServerProducts.getOff();
    } catch {
      return {};
    }
  };

const noPage: (
  dataForLlm: string,
  citation: ToolCitation,
) => ToolExecutionResult = (
  dataForLlm: string,
  citation: ToolCitation,
): ToolExecutionResult => {
  return {
    dataForLlm,
    rowCount: 0,
    ...citation,
    redactionCount: 0,
    isTruncated: false,
  };
};

// What the model is told of a page it may not offer, its product being off.
const productOffText: (data: {
  page: string;
  off: { product: ProductKey; reason: ServerProductOffReason };
}) => string = (data: {
  page: string;
  off: { product: ProductKey; reason: ServerProductOffReason };
}): string => {
  return `"${data.page}" is a page of a product this server has switched off: ${getProductOffMessage(data.off)} Say so plainly, and end the answer without a page: do not send the person to it another way.`;
};

/*
 * Where a page of one record is, as the menus say it: the record's kind,
 * its section and its title - "Status Page > Branding > Custom Domains" -
 * leaving out a section that only repeats the title ("Overview").
 */
export const getRecordPageMenuPath: (data: {
  kind: AskAiRecordKindPages;
  page: AskAiRecordPage;
}) => Array<string> = (data: {
  kind: AskAiRecordKindPages;
  page: AskAiRecordPage;
}): Array<string> => {
  return data.page.section === data.page.title
    ? [data.kind.recordName, data.page.title]
    : [data.kind.recordName, data.page.section, data.page.title];
};

/*
 * ONE RECORD'S OWN PAGE (#7065): "how do I put this status page on my own
 * domain?" ends with that status page's Custom Domains. Only for a record
 * the person may open: it is read with their own props first
 * (DashboardRecordReaders), and a record they may not read - or of a
 * product switched off on the server - gets no page, without a word on
 * whether it exists. The citation carries the page's route and the
 * record's id, never an address: the Dashboard fills the id in only when
 * the route is one of its own and the id is one (AskAiPageLinks).
 */
const findRecordPage: (data: {
  query: string;
  place: string | undefined;
  recordType: string | undefined;
  recordId: string | undefined;
  ctx: ToolContext;
}) => Promise<ToolExecutionResult> = async (data: {
  query: string;
  place: string | undefined;
  recordType: string | undefined;
  recordId: string | undefined;
  ctx: ToolContext;
}): Promise<ToolExecutionResult> => {
  const citation: ToolCitation = citationSentence(
    AI_TOOL_CITATIONS.dashboardPageSearch,
    { query: data.query },
  );

  if (!isAskAiRecordKind(data.recordType)) {
    return noPage(
      `Error: recordType must be one of ${ASK_AI_RECORD_KINDS.join(", ")}, with recordId. Adjust the arguments and try again, or call without them for the project's pages.`,
      citation,
    );
  }

  if (!data.recordId || !ObjectID.isValidUUID(data.recordId)) {
    return noPage(
      "Error: recordId must be the record's ID, as the page context or a tool that read the record gave it. Never guess one: call without recordType and recordId for the project's pages.",
      citation,
    );
  }

  const recordType: AskAiRecordKind = data.recordType;
  const kind: AskAiRecordKindPages | undefined =
    DashboardRecordPageFinder.getKind(recordType);

  if (!kind) {
    return noPage(
      "No page of such a record can be opened. End the answer without a page.",
      citation,
    );
  }

  const recordName: string | null = await readDashboardRecordName({
    kind: recordType,
    id: new ObjectID(data.recordId),
    props: data.ctx.props,
  });

  if (recordName === null) {
    return noPage(
      `The person cannot open a ${kind.recordName.toLowerCase()} with that ID. End the answer without a page of it, and say nothing of whether it exists. To send them to a page of the project instead, call again without recordType and recordId.`,
      citation,
    );
  }

  const found: Array<AskAiRecordPage> = DashboardRecordPageFinder.find({
    kind: recordType,
    query: data.query,
    limit: DASHBOARD_PAGE_LIMIT,
    place: data.place,
  });
  const best: AskAiRecordPage | undefined = found[0];
  const recordLabel: string = recordName
    ? `${kind.recordName} "${recordName}"`
    : kind.recordName;

  if (!best) {
    return noPage(
      data.place
        ? `No page of a ${kind.recordName.toLowerCase()} named like "${data.query}" is in "${data.place}". Call again without place to see where the pages of that name are.`
        : `No page of a ${kind.recordName.toLowerCase()} is named like "${data.query}". Try the name its menu gives the page, once; otherwise end the answer without a page.`,
      citation,
    );
  }

  const off: ServerProductsOff = await readOffProducts();
  const bestOff: {
    product: ProductKey;
    reason: ServerProductOffReason;
  } | null = getFirstOffProduct({
    products: getProductsOfRecordPage(best),
    off,
  });

  if (bestOff) {
    return noPage(
      productOffText({
        page: `${recordLabel} > ${best.title}`,
        off: bestOff,
      }),
      citation,
    );
  }

  const pages: Array<AskAiRecordPage> = found.filter(
    (page: AskAiRecordPage): boolean => {
      return !getFirstOffProduct({
        products: getProductsOfRecordPage(page),
        off,
      });
    },
  );

  return {
    dataForLlm: JSON.stringify(
      {
        record: {
          kind: recordType,
          ...(recordName ? { name: recordName } : {}),
        },
        pages: pages.map((page: AskAiRecordPage): JSONObject => {
          return { title: page.title, section: page.section };
        }),
        citationOpens: [
          recordLabel,
          ...getRecordPageMenuPath({ kind, page: best }).slice(1),
        ].join(" > "),
        ...(pages.length > 1
          ? {
              toCiteAnother:
                "Call again with its title as query and its section as place, with the same recordType and recordId.",
            }
          : {}),
      },
      null,
      1,
    ),
    rowCount: pages.length,
    // The chip names the page where the record's menu puts it, each name in the reader's language.
    ...citationSentence(AI_TOOL_CITATIONS.dashboardPage, {
      path: aiActionMenuPath(getRecordPageMenuPath({ kind, page: best })),
    }),
    // The record's name as the person reads it, beside its button.
    citationTarget: getRecordPageCitationTarget({
      page: best,
      recordId: data.recordId,
      recordTitle: recordName,
    }),
    redactionCount: 0,
    isTruncated: false,
  };
};

export const FindDashboardPageTool: ObservabilityTool = {
  name: FIND_DASHBOARD_PAGE_TOOL_NAME,
  description:
    'Find the page of this project in the OneUptime Dashboard where something is done or set - by the page\'s or the setting\'s English name as the docs and the menus give it ("Create Monitor", "Notification Methods", "API Keys", "Incidents Custom Fields"). Returns the best pages with where each is. The citation of this result opens its first page for the person: cite it at the end of a how-do-I answer. Two pages can share a name ("Insights" is the Traces explorer\'s tab, where "Traces", and OneUptime AI\'s findings, where "Traces > AI"): to send them to another of the pages returned, call again with that page\'s title as query and its where as place, and cite that result. For one record\'s own page - this status page\'s Custom Domains, a monitor\'s Criteria, a policy\'s Escalation Rules - pass recordType and recordId too: its pages are searched instead, and the citation opens that record\'s page.',
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          'The page\'s or setting\'s name in English, with where it is when the name is common: "Phone Numbers for SMS Notifications", "Status Pages Custom Fields". For a record\'s page, its name in the record\'s menu: "Custom Domains", "Criteria".',
      },
      place: {
        type: "string",
        description:
          'Optional: where the page is, exactly as a result of this tool gave it ("Traces", "Traces > AI", "Project Settings > Advanced"; for a record\'s page, its section: "Branding"). Only the pages there are found, so the citation opens the one you mean.',
      },
      recordType: {
        type: "string",
        enum: [...ASK_AI_RECORD_KINDS],
        description:
          'Optional, with recordId: the kind of the one record whose own page to find - "status-pages", "monitors", "on-call-policies" and so on.',
      },
      recordId: {
        type: "string",
        description:
          "With recordType: the record's ID, as the page context or a tool that read the record gave it. Never guess one. The person gets a page only of a record they may open.",
      },
    },
    required: ["query"],
  },
  requiredPermissions: DOCS_TOOL_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const query: string = (ToolArgs.getString(args, "query") || "").slice(
      0,
      200,
    );
    // Where the page is, as a result said it: only the pages there (#8829).
    const place: string | undefined =
      (ToolArgs.getString(args, "place") || "").slice(0, 200).trim() ||
      undefined;
    const recordType: string | undefined =
      (ToolArgs.getString(args, "recordType") || "").trim() || undefined;
    const recordId: string | undefined =
      (ToolArgs.getString(args, "recordId") || "").trim() || undefined;

    // One record's own page (#7065).
    if (recordType || recordId) {
      return findRecordPage({ query, place, recordType, recordId, ctx });
    }

    const citation: ToolCitation = citationSentence(
      AI_TOOL_CITATIONS.dashboardPageSearch,
      { query },
    );
    // More than are returned, so the pages of a product switched off can be left out.
    const found: Array<AIDashboardPage> = query
      ? DashboardPageFinder.find({
          query,
          limit: DASHBOARD_PAGE_LIMIT * 2,
          isBillingEnabled: IsBillingEnabled,
          place,
        })
      : [];
    const first: AIDashboardPage | undefined = found[0];

    if (!first && place) {
      return noPage(
        `No page of the Dashboard named like "${query}" is in "${place}". Call again without place to see where the pages of that name are.`,
        citation,
      );
    }

    if (!first) {
      return noPage(
        `No page of the Dashboard is named like "${query}". Try the name the docs give the page, once; otherwise end the answer without a page.`,
        citation,
      );
    }

    /*
     * Never a page of a product switched off on the server (#6815): the
     * menus and Search leave it out, and its page says it is off. When the
     * page asked for is one, the answer says so instead of offering
     * another page in its place.
     */
    const off: ServerProductsOff = await readOffProducts();
    const firstOff: {
      product: ProductKey;
      reason: ServerProductOffReason;
    } | null = getFirstOffProduct({
      products: getProductsOfDashboardPage(first.path),
      off,
    });

    if (firstOff) {
      return noPage(
        productOffText({
          page: `${first.where.join(" > ")} > ${first.title}`,
          off: firstOff,
        }),
        citation,
      );
    }

    const pages: Array<AIDashboardPage> = found
      .filter((page: AIDashboardPage): boolean => {
        return !getFirstOffProduct({
          products: getProductsOfDashboardPage(page.path),
          off,
        });
      })
      .slice(0, DASHBOARD_PAGE_LIMIT);

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
          ...(pages.length > 1
            ? {
                toCiteAnother:
                  "Call again with its title as query and its where as place.",
              }
            : {}),
        },
        null,
        1,
      ),
      rowCount: pages.length,
      /*
       * The chip names the page where the Dashboard's menus put it, each
       * name in the reader's language; its label, which the model reads in
       * a turn's history, stays English (#8831).
       */
      ...citationSentence(AI_TOOL_CITATIONS.dashboardPage, {
        path: aiActionMenuPath(
          [...first.where, first.titleKey ?? first.title],
          first.titleKey ? first.titleValues : undefined,
        ),
      }),
      citationTarget: getDashboardPageCitationTarget(first),
      redactionCount: 0,
      isTruncated: false,
    };
  },
};
