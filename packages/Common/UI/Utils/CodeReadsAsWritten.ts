import type { PostProcessorModule, TOptions } from "i18next";
/*
 * Type-only: the one place the rules are loaded is the import() below
 * (codeInSentenceRules), so a page read from the left never downloads them.
 */
import type { setCodeApartInSentence } from "../../Types/CodeInSentence";
import { isRightToLeftLanguage } from "../../Types/ReadingDirection";
import { LazyLibrary } from "./LazyLibrary";
import { getProductNamePostProcess } from "./ProductNameTranslation";

/*
 * CODE IN A TRANSLATED SENTENCE READS AS IT IS WRITTEN.
 *
 * An Arabic or Persian sentence that names a function, a path or a flag
 * drew its brackets, slash or dashes at the code's other end
 * (Common/Types/CodeInSentence). Every frontend registers this i18next
 * post-processor, so each sentence it translates into a language read
 * from the right comes out with its code set apart in a left-to-right
 * isolate - whatever draws it: a field's description, a card's, a
 * tooltip, a placeholder, a page title. A sentence in any other language
 * comes out as it went in.
 *
 * It runs after the product's name is put in (ProductNameTranslation) and
 * after i18next fills a sentence's values, so a value given to t() is read
 * too. The Translator (Common/Types/Translator) looks a sentence up with
 * its {{placeholders}} still in it and fills them itself: the code round a
 * placeholder is set apart before its value goes in.
 *
 * Copying a sentence copies its isolates' marks, which a terminal or an
 * editor keeps: "--help" pasted with them is no flag. So each frontend
 * also leaves them out of what is copied (leaveIsolatesOutOfCopiedText).
 *
 * The rules that find the code (Common/Types/CodeInSentence) are needed
 * only in a language read from the right, so they are a file of their own
 * that a page in any other language never loads: they were 3 KiB gzipped
 * of the sign-in and status pages' first load (issue #5608). A frontend
 * that fetches a language's words when it is chosen fetches the rules with
 * an Arabic or Persian locale file (whenCodeCanBeSetApart), so those words
 * arrive with what sets their code apart. One that bundles every
 * language's words hands the rules over with them, before it starts
 * (setCodeApartWith).
 */

export const CODE_READS_AS_WRITTEN_POST_PROCESSOR: string =
  "codeReadsAsWritten";

export type CodeInSentenceRules = typeof setCodeApartInSentence;

const codeInSentenceRules: LazyLibrary<CodeInSentenceRules> =
  new LazyLibrary<CodeInSentenceRules>(
    async (): Promise<CodeInSentenceRules> => {
      const library: { setCodeApartInSentence: CodeInSentenceRules } =
        await import("../../Types/CodeInSentence");

      return library.setCodeApartInSentence;
    },
  );

// The rules a frontend that bundles every language's words handed over.
let handedOverRules: CodeInSentenceRules | null = null;

const getRules: () => CodeInSentenceRules | null =
  (): CodeInSentenceRules | null => {
    return handedOverRules || codeInSentenceRules.getLoaded();
  };

/*
 * For a frontend that bundles every language's words - the Admin
 * Dashboard, a public dashboard: the rules, bundled with them and there
 * from the first sentence it translates.
 */
export const setCodeApartWith: (rules: CodeInSentenceRules) => void = (
  rules: CodeInSentenceRules,
): void => {
  handedOverRules = rules;
};

/*
 * A sentence the page draws again and again is read once per language:
 * up to this many of each are remembered, then they are read afresh.
 */
const MOST_REMEMBERED_SENTENCES: number = 5000;

const rightToLeftLanguages: Map<string, boolean> = new Map<string, boolean>();

const readSentences: Map<string, Map<string, string>> = new Map<
  string,
  Map<string, string>
>();

// Whether `language` is read from the right, remembered: asked of every sentence.
const isReadFromTheRight: (language: string) => boolean = (
  language: string,
): boolean => {
  let isRightToLeft: boolean | undefined = rightToLeftLanguages.get(language);

  if (isRightToLeft === undefined) {
    isRightToLeft = isRightToLeftLanguage(language);
    rightToLeftLanguages.set(language, isRightToLeft);
  }

  return isRightToLeft;
};

/*
 * For a frontend that fetches a language's words when it is chosen - the
 * Dashboard, the sign-in pages, a status page: settles once `language`'s
 * sentences can be set apart, at once for a language read from the left,
 * which never loads the rules. Its locale backend waits for this beside an
 * Arabic or Persian locale file. It never fails: words whose rules cannot
 * be fetched still go out, as they are written, and the next sentence
 * asks for the rules again (LazyLibrary).
 */
export const whenCodeCanBeSetApart: (
  language: string | null | undefined,
) => Promise<void> = async (
  language: string | null | undefined,
): Promise<void> => {
  if (!language || !isReadFromTheRight(language) || getRules()) {
    return;
  }

  try {
    await codeInSentenceRules.load();
  } catch {
    // Handed back as written until a later sentence's ask brings them.
  }
};

/*
 * `sentence` as a page shows it to a reader of `language`: its code set
 * apart in a language read from the right (setCodeApartInSentence), as it
 * is in any other.
 */
export const setCodeApartInTranslation: (
  sentence: string,
  language: string | null | undefined,
) => string = (
  sentence: string,
  language: string | null | undefined,
): string => {
  if (!sentence || !language || !isReadFromTheRight(language)) {
    return sentence;
  }

  const setCodeApart: CodeInSentenceRules | null = getRules();

  if (!setCodeApart) {
    /*
     * Asked for before the rules arrived - a frontend fetches them with
     * its Arabic and Persian words, so only a sentence asked for in such a
     * language before its words gets here. It is handed back as it is
     * written, not remembered, so it is read again once they are there,
     * and it asks for them.
     */
    void whenCodeCanBeSetApart(language);

    return sentence;
  }

  let sentences: Map<string, string> | undefined = readSentences.get(language);

  if (!sentences) {
    sentences = new Map<string, string>();
    readSentences.set(language, sentences);
  }

  const remembered: string | undefined = sentences.get(sentence);

  if (remembered !== undefined) {
    return remembered;
  }

  const shown: string = setCodeApart(sentence, language);

  if (sentences.size >= MOST_REMEMBERED_SENTENCES) {
    sentences.clear();
  }

  sentences.set(sentence, shown);

  return shown;
};

export const codeReadsAsWrittenPostProcessor: PostProcessorModule = {
  type: "postProcessor",
  name: CODE_READS_AS_WRITTEN_POST_PROCESSOR,
  process: (
    value: string,
    _key: string | Array<string>,
    options: TOptions,
    translator: { language?: string | undefined } | undefined,
  ): string => {
    if (typeof value !== "string") {
      return value;
    }

    // A t() call may ask for a language of its own; else the instance's.
    const language: unknown = options?.lng || translator?.language;

    return setCodeApartInTranslation(
      value,
      typeof language === "string" ? language : undefined,
    );
  },
};

/*
 * The `postProcess` init option for a frontend's i18next instance: the
 * installation's own name first, when it has one, then the code.
 */
export const getTranslationPostProcess: () => Array<string> =
  (): Array<string> => {
    const productName: Array<string> | false = getProductNamePostProcess();

    return [
      ...(productName ? productName : []),
      CODE_READS_AS_WRITTEN_POST_PROCESSOR,
    ];
  };

// LRI, RLI, FSI and PDI: the marks an isolate is made of.
const ISOLATE_MARKS_REGEX: RegExp = /[\u{2066}-\u{2069}]/gu;

const ISOLATE_MARK_REGEX: RegExp = /[\u{2066}-\u{2069}]/u;

// `text` without the marks of the isolates a page sets apart its code and values in.
export const withoutIsolates: (text: string) => string = (
  text: string,
): string => {
  return text.replace(ISOLATE_MARKS_REGEX, "");
};

// Where a reader types: what they copy there is their own text, as typed.
const isTypingPlace: (node: Node | null | undefined) => boolean = (
  node: Node | null | undefined,
): boolean => {
  const element: Element | null =
    node && node.nodeType === 1
      ? (node as Element)
      : node?.parentElement ?? null;

  if (!element) {
    return false;
  }

  return Boolean(
    element.closest(
      "input, textarea, [contenteditable]:not([contenteditable='false'])",
    ),
  );
};

/*
 * Copied text as the reader saw it, without the isolates' marks: a page
 * that sets code apart (codeReadsAsWrittenPostProcessor) and values
 * (Translator's setsValuesApart) in a sentence read from the right copied
 * "--help" between two marks, which a terminal reads as no flag. Only a
 * copy whose text holds such a mark is touched; a copy from a field the
 * reader types in, or one a component already handled, is left to the
 * browser.
 */
export const copyWithoutIsolates: (event: ClipboardEvent) => void = (
  event: ClipboardEvent,
): void => {
  if (event.defaultPrevented || !event.clipboardData) {
    return;
  }

  const view: (Window & typeof globalThis) | null =
    typeof window === "undefined" ? null : window;
  const selection: Selection | null | undefined = view?.getSelection();

  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return;
  }

  if (
    isTypingPlace(selection.anchorNode) ||
    isTypingPlace(selection.focusNode) ||
    isTypingPlace(document.activeElement)
  ) {
    return;
  }

  const text: string = selection.toString();

  if (!ISOLATE_MARK_REGEX.test(text)) {
    return;
  }

  const holder: HTMLElement = document.createElement("div");

  for (let index: number = 0; index < selection.rangeCount; index++) {
    holder.appendChild(selection.getRangeAt(index).cloneContents());
  }

  event.clipboardData.setData("text/plain", withoutIsolates(text));
  event.clipboardData.setData("text/html", withoutIsolates(holder.innerHTML));
  event.preventDefault();
};

const listeningDocuments: WeakSet<Document> = new WeakSet<Document>();

/*
 * Leaves the isolates' marks out of whatever is copied from the page, once
 * per document (copyWithoutIsolates). Each frontend calls it beside its
 * i18next set-up.
 */
export const leaveIsolatesOutOfCopiedText: (
  target?: Document | undefined,
) => void = (target?: Document | undefined): void => {
  const page: Document | undefined =
    target || (typeof document === "undefined" ? undefined : document);

  if (!page || listeningDocuments.has(page)) {
    return;
  }

  listeningDocuments.add(page);
  page.addEventListener("copy", copyWithoutIsolates);
};
