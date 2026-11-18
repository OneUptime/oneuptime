import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import { DEFAULT_DASHBOARD_LANGUAGE } from "Common/Types/Dashboard/DashboardLanguage";
import {
  setsPunctuationApart,
  withFrenchSpacing,
} from "Common/Types/NoBreakSpaces";
import {
  getReadingDirection,
  ReadingDirection,
} from "Common/Types/ReadingDirection";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A PRODUCT'S DOCUMENTATION PAGE, IN THE READER'S LANGUAGE (#7531).
 *
 * A product's Help > Documentation page is one long Markdown text, and it
 * was drawn in English in every language: a German reader read "Null
 * Percent" there and "Anteil NULL-Werte" on the Checks tab the page
 * explains. A product's page now holds its text in each language the
 * Dashboard is read in, one module each, and this draws the reader's.
 *
 * The English text stays in the page, drawn at once. Every other language
 * is a chunk of its own, fetched when a reader of that language opens the
 * page (each loader is a dynamic import, which the build splits off), so
 * no reader downloads the other sixteen. A language the page has no text
 * for, or a chunk that cannot be fetched, reads the English. The text is
 * laid out its language's way: Arabic and Persian from the right, their
 * code from the left as it is written (MarkdownViewer's readingDirection),
 * and French with its marks held to their words (setDocumentationText).
 */

// One language's text: a module whose default export is the Markdown.
export type DocumentationTranslation = () => Promise<{ default: string }>;

// Each language's text but English's, by the Dashboard's language code.
export type DocumentationTranslations = Readonly<
  Partial<Record<string, DocumentationTranslation>>
>;

/*
 * Each language's loader by the Dashboard's language code, whatever its
 * module holds: a page's text (DocumentationTranslations) or a setup
 * guide's words (SetupGuideTranslations). Which languages have a loader
 * is all getDocumentationLanguage reads.
 */
export type LanguageLoaders = Readonly<
  Partial<Record<string, () => Promise<unknown>>>
>;

/*
 * The language a reader of `language` reads the page in: theirs where the
 * page has a text in it, English otherwise. Only codes the page lists
 * reach a loader, so no other value is ever imported.
 */
export function getDocumentationLanguage(data: {
  language: string | null | undefined;
  translations: LanguageLoaders;
}): string {
  const language: string = (data.language || "").trim();

  if (
    language &&
    language !== DEFAULT_DASHBOARD_LANGUAGE &&
    Object.prototype.hasOwnProperty.call(data.translations, language) &&
    typeof data.translations[language] === "function"
  ) {
    return language;
  }

  return DEFAULT_DASHBOARD_LANGUAGE;
}

// A fenced code block, from its opening fence's line to its closing one.
const FENCED_CODE_BLOCK: RegExp = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm;

/*
 * `text`, the page in `language`, as that language sets a line. French
 * writes a plain space before » ? ! : and ; and after «, and a line may
 * break there, so a narrow page started a line with ":" (#8032): those
 * spaces are drawn as French's no-break ones, as the Translator draws every
 * French wording (Common/Types/NoBreakSpaces). Code is left as it is
 * written: a fenced block, and code in backticks.
 */
export function setDocumentationText(data: {
  language: string;
  text: string;
}): string {
  if (!setsPunctuationApart(data.language)) {
    return data.text;
  }

  let result: string = "";
  let proseStart: number = 0;

  for (const block of data.text.matchAll(FENCED_CODE_BLOCK)) {
    const blockStart: number = block.index || 0;

    result +=
      withFrenchSpacing(data.text.slice(proseStart, blockStart)) + block[0];
    proseStart = blockStart + block[0].length;
  }

  return result + withFrenchSpacing(data.text.slice(proseStart));
}

/*
 * The text in `language`, as its module holds it and as the language sets
 * a line; the English when the page has none in that language, or its
 * module cannot be fetched or holds no text.
 */
export async function loadDocumentationText(data: {
  language: string;
  english: string;
  translations: DocumentationTranslations;
}): Promise<{ language: string; text: string }> {
  const language: string = getDocumentationLanguage(data);
  const load: DocumentationTranslation | undefined =
    data.translations[language];

  if (language === DEFAULT_DASHBOARD_LANGUAGE || !load) {
    return { language: DEFAULT_DASHBOARD_LANGUAGE, text: data.english };
  }

  try {
    const loaded: { default: string } = await load();

    if (typeof loaded?.default === "string" && loaded.default.trim()) {
      return {
        language: language,
        text: setDocumentationText({
          language: language,
          text: loaded.default,
        }),
      };
    }
  } catch {
    // A chunk that cannot be fetched: the page is still there, in English.
  }

  return { language: DEFAULT_DASHBOARD_LANGUAGE, text: data.english };
}

export interface ComponentProps {
  // The page's text in English, drawn at once and wherever nothing else is.
  english: string;
  translations: DocumentationTranslations;
}

interface ShownText {
  // The language the page was asked in.
  askedIn: string;
  // The language its text is in: the reader's, or English.
  language: string;
  text: string;
}

const DocumentationInReadersLanguage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { language } = useTranslateValue();
  const askedIn: string = getDocumentationLanguage({
    language: language,
    translations: props.translations,
  });

  const [shown, setShown] = useState<ShownText | null>(null);

  useEffect(() => {
    if (askedIn === DEFAULT_DASHBOARD_LANGUAGE) {
      return;
    }

    let isCurrent: boolean = true;

    loadDocumentationText({
      language: askedIn,
      english: props.english,
      translations: props.translations,
    })
      .then((loaded: { language: string; text: string }): void => {
        if (isCurrent) {
          setShown({ askedIn: askedIn, ...loaded });
        }
      })
      .catch((): void => {
        if (isCurrent) {
          setShown({
            askedIn: askedIn,
            language: DEFAULT_DASHBOARD_LANGUAGE,
            text: props.english,
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [askedIn, props.english, props.translations]);

  if (askedIn === DEFAULT_DASHBOARD_LANGUAGE) {
    return <MarkdownViewer text={props.english} />;
  }

  // The reader's text is on its way: a moment, not a flash of English.
  if (!shown || shown.askedIn !== askedIn) {
    return <DetailListSkeleton fields={3} columns={1} />;
  }

  const direction: ReadingDirection | undefined =
    shown.language === DEFAULT_DASHBOARD_LANGUAGE
      ? undefined
      : getReadingDirection(shown.language);

  return <MarkdownViewer text={shown.text} readingDirection={direction} />;
};

export default DocumentationInReadersLanguage;
