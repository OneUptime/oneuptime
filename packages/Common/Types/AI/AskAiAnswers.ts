import { AIChatCitation, AIChatCitationTargetType } from "./AIChatTypes";
import { ASK_AI_DOCS_TOOL_NAMES } from "./AskAiDocsTools";
import { isAISetupAction } from "./AISetupActions";

/*
 * WHAT KIND OF ANSWER ASK AI GAVE, AND WHEN THE DOCS LET IT DOWN (#7064).
 *
 * Ask AI answers two kinds of question (#6828): about the project's data,
 * from its tools, and about OneUptime itself, from the docs. Its answers
 * are rated with a thumb, and a rating means little until it says which
 * kind of answer it was: a docs answer rated down is a page to write, a
 * data answer rated down a tool to fix. And when the docs do not say,
 * Ask AI says "The docs do not cover this." instead of guessing: each of
 * those is a docs page missing, and the product's analytics count them -
 * never the question, only the docs pages the answer read.
 *
 * Both are read from what the answer did, never from what was asked: the
 * names of the tools it ran (its citations) and of the actions it
 * proposed, and its own words for "the docs do not cover this", in the
 * language it answered in.
 *
 * Pure: the server's prompt, the Dashboard's events and the eval read it.
 */

export enum AskAiAnswerKind {
  // Read only the docs: a question about OneUptime itself.
  Docs = "docs",
  // Read only the project's data.
  Data = "data",
  // Both: "why did nobody get paged for INC-12?".
  DocsAndData = "docs_and_data",
  // Proposed setting something up (#6829): a plan on a card.
  Setup = "setup",
  // Ran no tool at all.
  None = "none",
}

/*
 * The kind of an answer, from the names of the tools it ran and of the
 * actions it proposed.
 */
export const getAskAiAnswerKind: (data: {
  toolNames: ReadonlyArray<string>;
  actionNames?: ReadonlyArray<string> | undefined;
}) => AskAiAnswerKind = (data: {
  toolNames: ReadonlyArray<string>;
  actionNames?: ReadonlyArray<string> | undefined;
}): AskAiAnswerKind => {
  const actionNames: ReadonlyArray<string> = data.actionNames || [];

  if (actionNames.some(isAISetupAction)) {
    return AskAiAnswerKind.Setup;
  }

  const names: Array<string> = [...data.toolNames, ...actionNames].filter(
    Boolean,
  );
  const readDocs: boolean = names.some((name: string): boolean => {
    return ASK_AI_DOCS_TOOL_NAMES.includes(name);
  });
  const readData: boolean = names.some((name: string): boolean => {
    return !ASK_AI_DOCS_TOOL_NAMES.includes(name);
  });

  if (readDocs && readData) {
    return AskAiAnswerKind.DocsAndData;
  }

  if (readDocs) {
    return AskAiAnswerKind.Docs;
  }

  return readData ? AskAiAnswerKind.Data : AskAiAnswerKind.None;
};

// The kind of an answer, from its citations and the actions it proposed.
export const getAskAiAnswerKindOf: (message: {
  citations?: ReadonlyArray<AIChatCitation> | undefined;
  toolActions?: ReadonlyArray<{ toolName: string }> | undefined;
}) => AskAiAnswerKind = (message: {
  citations?: ReadonlyArray<AIChatCitation> | undefined;
  toolActions?: ReadonlyArray<{ toolName: string }> | undefined;
}): AskAiAnswerKind => {
  return getAskAiAnswerKind({
    toolNames: (message.citations || []).map(
      (citation: AIChatCitation): string => {
        return typeof citation?.toolName === "string" ? citation.toolName : "";
      },
    ),
    actionNames: (message.toolActions || []).map(
      (action: { toolName: string }): string => {
        return typeof action?.toolName === "string" ? action.toolName : "";
      },
    ),
  });
};

/*
 * The docs pages an answer read, by their address under /docs/<lang>/
 * ("monitor/website-monitor"), in the order it read them, each once: what
 * its read_docs citations opened.
 */
export const getDocsPagesRead: (
  citations: ReadonlyArray<AIChatCitation> | undefined,
) => Array<string> = (
  citations: ReadonlyArray<AIChatCitation> | undefined,
): Array<string> => {
  const pages: Array<string> = [];

  for (const citation of citations || []) {
    if (citation?.target?.type !== AIChatCitationTargetType.DocsPage) {
      continue;
    }

    const page: unknown = citation.target.params?.["page"];

    if (typeof page === "string" && page && !pages.includes(page)) {
      pages.push(page);
    }
  }

  return pages;
};

/*
 * "The docs do not cover this." in each language Ask AI answers in: the
 * prompt hands the model the sentence of the reader's language, and an
 * answer that says it in any of them - in the language the person wrote
 * in, which may not be the Dashboard's - is one the docs did not cover.
 */
export const DOCS_NOT_COVERED_SENTENCE: string = "The docs do not cover this.";

export const DOCS_NOT_COVERED_SENTENCES: Readonly<Record<string, string>> = {
  en: DOCS_NOT_COVERED_SENTENCE,
  de: "Die Dokumentation deckt das nicht ab.",
  fr: "La documentation ne couvre pas ce point.",
  es: "La documentación no cubre esto.",
  it: "La documentazione non tratta questo argomento.",
  pt: "A documentação não aborda isso.",
  nl: "De documentatie behandelt dit niet.",
  da: "Dokumentationen dækker ikke dette.",
  no: "Dokumentasjonen dekker ikke dette.",
  sv: "Dokumentationen täcker inte detta.",
  ru: "В документации об этом не сказано.",
  ja: "ドキュメントにはこの内容は記載されていません。",
  ko: "문서에서 이 내용을 다루지 않습니다.",
  "zh-CN": "文档中没有涉及这一点。",
  "zh-TW": "文件中沒有涵蓋這一點。",
  hi: "दस्तावेज़ में यह शामिल नहीं है।",
  fa: "مستندات این موضوع را پوشش نمی‌دهد.",
  ar: "لا تغطي الوثائق هذا الأمر.",
};

// The sentence in a reader's language, or English for one it has none in.
export const getDocsNotCoveredSentence: (
  language: string | undefined,
) => string = (language: string | undefined): string => {
  return (
    (language && DOCS_NOT_COVERED_SENTENCES[language]) ||
    DOCS_NOT_COVERED_SENTENCE
  );
};

// Text as it is compared: one case, one form of each letter, one space, no last stop.
const normalized: (text: string) => string = (text: string): string => {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‌‍]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。।!]+$/u, "");
};

const NORMALIZED_SENTENCES: ReadonlyArray<string> = Object.values(
  DOCS_NOT_COVERED_SENTENCES,
).map(normalized);

// Whether an answer says the docs do not cover the question, in any language.
export const isDocsNotCoveredAnswer: (text: string | undefined) => boolean = (
  text: string | undefined,
): boolean => {
  if (!text) {
    return false;
  }

  const answer: string = normalized(text);

  return NORMALIZED_SENTENCES.some((sentence: string): boolean => {
    return answer.includes(sentence);
  });
};
