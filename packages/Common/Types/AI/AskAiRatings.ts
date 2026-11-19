import { PRODUCT_TITLES } from "../Product/ProductCatalog";
import ProductKey, { PRODUCT_KEYS } from "../Product/ProductKey";
import { translationKey } from "../Translator";
import { ASK_AI_DOCS_TOOL_NAMES } from "./AskAiDocsTools";

/*
 * HOW ASK AI'S ANSWERS WERE RATED, WITHOUT ANYONE'S WORDS (#7365).
 *
 * Ask AI stores a thumb on each answer (AIConversationMessage.userFeedback).
 * A conversation is private to the person who had it (the privacy pin of
 * AIConversationMessageService), so what anyone else reads of the answers
 * rated down is what they drew on, never what was asked or answered:
 *
 *   - the products whose data an answer read - Logs, Incidents, Monitors -
 *     by the tools it ran (its citations' tool names, through the server's
 *     ToolProducts), each product counted once an answer;
 *   - the OneUptime docs, for an answer that searched or read them;
 *   - other OneUptime data (its probes, teams, setup health), for a tool of
 *     no one product;
 *   - nothing, for an answer that read no data at all.
 *
 * A project's owners and admins read their project's (GET /ai-chat/ratings,
 * Project Settings > AI > AI Results), and a server's master admins every
 * project's (Admin Dashboard > Feedback): on OneUptime Cloud the OneUptime
 * team, who thus learn which topics Ask AI gets wrong without any
 * customer's words leaving their project.
 *
 * React-free and server-free: the server, both dashboards and the tests read
 * it. The words it marks (translationKey) are keys of both dashboards'
 * locales: each dashboard's extractor reads this file for them.
 */

// The days the ratings are counted over: the Admin Dashboard's window too.
export const ASK_AI_RATINGS_DAYS: number = 90;

// GET, under /api: a project's ratings, for its owners and admins.
export const ASK_AI_RATINGS_ROUTE: string = "/ai-chat/ratings";

// The most answers rated down read to say what they drew on.
export const ASK_AI_RATED_DOWN_SCAN_LIMIT: number = 1000;

// What an answer drew on that is no one product.
export enum AskAiSourceOfNoProduct {
  // The docs: search_docs, read_docs, find_dashboard_page.
  Docs = "docs",
  // A tool of no one product: the project's probes, teams, setup health.
  OtherData = "other_data",
  // No tool ran: the answer read nothing.
  Nothing = "nothing",
}

// A product's key, or one of AskAiSourceOfNoProduct.
export type AskAiSource = ProductKey | AskAiSourceOfNoProduct;

export interface AskAiSourceCount {
  source: AskAiSource;
  // How many answers rated down drew on it.
  answers: number;
}

// A project's ratings, as GET /ai-chat/ratings answers.
export interface AskAiProjectRatings {
  sinceDays: number;
  helpful: number;
  notHelpful: number;
  // What the answers rated down drew on, most first.
  ratedDownDrewOn: Array<AskAiSourceCount>;
}

// The tools whose answers drew on the docs (Server/Utils/AI/Toolbox/DocsTools).
export const ASK_AI_DOCS_TOOLS: ReadonlyArray<string> = ASK_AI_DOCS_TOOL_NAMES;

const NO_PRODUCT_SOURCES: ReadonlyArray<string> = Object.values(
  AskAiSourceOfNoProduct,
);

export const isAskAiSource: (value: unknown) => value is AskAiSource = (
  value: unknown,
): value is AskAiSource => {
  return (
    typeof value === "string" &&
    ((PRODUCT_KEYS as ReadonlyArray<string>).includes(value) ||
      NO_PRODUCT_SOURCES.includes(value))
  );
};

/*
 * What one answer drew on, from the names of the tools it ran: each product
 * once, the docs once, other data once - or nothing.
 */
export const getAskAiAnswerSources: (data: {
  toolNames: ReadonlyArray<string>;
  getToolProducts: (toolName: string) => ReadonlyArray<ProductKey>;
}) => Array<AskAiSource> = (data: {
  toolNames: ReadonlyArray<string>;
  getToolProducts: (toolName: string) => ReadonlyArray<ProductKey>;
}): Array<AskAiSource> => {
  const sources: Set<AskAiSource> = new Set<AskAiSource>();

  for (const toolName of data.toolNames) {
    if (!toolName) {
      continue;
    }

    if (ASK_AI_DOCS_TOOLS.includes(toolName)) {
      sources.add(AskAiSourceOfNoProduct.Docs);
      continue;
    }

    const products: ReadonlyArray<ProductKey> = data.getToolProducts(toolName);

    if (products.length === 0) {
      sources.add(AskAiSourceOfNoProduct.OtherData);
      continue;
    }

    for (const product of products) {
      sources.add(product);
    }
  }

  if (sources.size === 0) {
    return [AskAiSourceOfNoProduct.Nothing];
  }

  return Array.from(sources);
};

/*
 * The answers rated down, by what they drew on: most first, then in the
 * products menu's order, the docs, other data and nothing last.
 */
export const countAskAiSources: (
  answers: ReadonlyArray<ReadonlyArray<AskAiSource>>,
) => Array<AskAiSourceCount> = (
  answers: ReadonlyArray<ReadonlyArray<AskAiSource>>,
): Array<AskAiSourceCount> => {
  const counts: Map<AskAiSource, number> = new Map<AskAiSource, number>();

  for (const sources of answers) {
    for (const source of new Set<AskAiSource>(sources)) {
      counts.set(source, (counts.get(source) || 0) + 1);
    }
  }

  const order: Array<string> = [
    ...(PRODUCT_KEYS as ReadonlyArray<string>),
    ...NO_PRODUCT_SOURCES,
  ];

  return Array.from(counts.entries())
    .map(([source, count]: [AskAiSource, number]): AskAiSourceCount => {
      return { source: source, answers: count };
    })
    .sort((a: AskAiSourceCount, b: AskAiSourceCount): number => {
      return (
        b.answers - a.answers ||
        order.indexOf(a.source) - order.indexOf(b.source)
      );
    });
};

// The counts as a server answered them, keeping only what is one.
export const readAskAiSourceCounts: (
  value: unknown,
) => Array<AskAiSourceCount> = (value: unknown): Array<AskAiSourceCount> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry: unknown): entry is AskAiSourceCount => {
    const data: Record<string, unknown> =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : {};

    return (
      isAskAiSource(data["source"]) &&
      typeof data["answers"] === "number" &&
      Number.isInteger(data["answers"]) &&
      data["answers"] > 0
    );
  });
};

const readCount: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
};

// GET /ai-chat/ratings' answer, or null for anything that is not one.
export const readAskAiProjectRatings: (
  value: unknown,
) => AskAiProjectRatings | null = (
  value: unknown,
): AskAiProjectRatings | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data: Record<string, unknown> = value as Record<string, unknown>;
  const sinceDays: number | null = readCount(data["sinceDays"]);
  const helpful: number | null = readCount(data["helpful"]);
  const notHelpful: number | null = readCount(data["notHelpful"]);

  if (sinceDays === null || helpful === null || notHelpful === null) {
    return null;
  }

  return {
    sinceDays: sinceDays,
    helpful: helpful,
    notHelpful: notHelpful,
    ratedDownDrewOn: readAskAiSourceCounts(data["ratedDownDrewOn"]),
  };
};

// What an answer drew on that is no product, in the dashboards' words.
export const ASK_AI_SOURCE_OF_NO_PRODUCT_TITLES: Readonly<
  Record<AskAiSourceOfNoProduct, string>
> = {
  [AskAiSourceOfNoProduct.Docs]: translationKey("OneUptime docs"),
  [AskAiSourceOfNoProduct.OtherData]: translationKey("Other OneUptime data"),
  [AskAiSourceOfNoProduct.Nothing]: translationKey("No data read"),
};

/*
 * A source's name, in English: a product by its menu's name (ProductCatalog,
 * a key of both dashboards' locales), else the words above.
 */
export const getAskAiSourceTitle: (source: AskAiSource) => string = (
  source: AskAiSource,
): string => {
  if (
    Object.prototype.hasOwnProperty.call(
      ASK_AI_SOURCE_OF_NO_PRODUCT_TITLES,
      source,
    )
  ) {
    return ASK_AI_SOURCE_OF_NO_PRODUCT_TITLES[source as AskAiSourceOfNoProduct];
  }

  return PRODUCT_TITLES[source as ProductKey] || source;
};
