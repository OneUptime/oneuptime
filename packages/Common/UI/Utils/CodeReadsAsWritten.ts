import type { PostProcessorModule, TOptions } from "i18next";
import { setCodeApartInSentence } from "../../Types/CodeInSentence";
import { isRightToLeftLanguage } from "../../Types/ReadingDirection";
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
 */

export const CODE_READS_AS_WRITTEN_POST_PROCESSOR: string =
  "codeReadsAsWritten";

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

  let sentences: Map<string, string> | undefined = readSentences.get(language);

  if (!sentences) {
    sentences = new Map<string, string>();
    readSentences.set(language, sentences);
  }

  const remembered: string | undefined = sentences.get(sentence);

  if (remembered !== undefined) {
    return remembered;
  }

  const shown: string = setCodeApartInSentence(sentence, language);

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
      : (node?.parentElement ?? null);

  if (!element) {
    return false;
  }

  return Boolean(
    element.closest("input, textarea, [contenteditable]:not([contenteditable='false'])"),
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
