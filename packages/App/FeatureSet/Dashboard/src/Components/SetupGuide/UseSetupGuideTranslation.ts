import { useEffect, useState } from "react";
import { DEFAULT_DASHBOARD_LANGUAGE } from "Common/Types/Dashboard/DashboardLanguage";
import useTranslateValue from "Common/UI/Utils/Translation";
import { getDocumentationLanguage } from "../Documentation/DocumentationInReadersLanguage";
import {
  SetupGuideTranslation,
  SetupGuideTranslationLoader,
  SetupGuideTranslations,
  SetupGuideWords,
  getSetupGuideWords,
} from "./SetupGuideTranslation";

/*
 * The reader's words for a setup guide (#8341), fetched as the
 * Documentation pages fetch theirs (DocumentationInReadersLanguage): each
 * language's words are a chunk of their own, loaded when a reader of that
 * language opens the guide, so no reader downloads the other sixteen. A
 * language the guide has no words in, or a chunk that cannot be fetched,
 * reads the guide in English.
 */

/*
 * The reader's words for the guide, or null for English: the language
 * reads it in English, or its chunk could not be fetched or holds nothing.
 */
export async function loadSetupGuideWords(data: {
  language: string;
  translations: SetupGuideTranslations;
}): Promise<SetupGuideWords | null> {
  const language: string = getDocumentationLanguage(data);
  const load: SetupGuideTranslationLoader | undefined =
    data.translations[language];

  if (language === DEFAULT_DASHBOARD_LANGUAGE || !load) {
    return null;
  }

  try {
    const loaded: { default: SetupGuideTranslation } = await load();
    const translation: SetupGuideTranslation | undefined = loaded?.default;

    if (
      translation &&
      typeof translation === "object" &&
      Object.keys(translation).length > 0
    ) {
      return getSetupGuideWords({
        language: language,
        translation: translation,
      });
    }
  } catch {
    // A chunk that cannot be fetched: the guide is still there, in English.
  }

  return null;
}

export interface SetupGuideTranslationState {
  // The reader's words are on their way: draw a moment, not English.
  isLoading: boolean;
  // The reader's words, or null to read the guide as it is written.
  words: SetupGuideWords | null;
}

interface LoadedWords {
  // The language they were asked in.
  askedIn: string;
  words: SetupGuideWords | null;
}

/*
 * The guide's words in the reader's language. `translations` is a module's
 * constant: a new object on each render would fetch its chunk again.
 */
export default function useSetupGuideTranslation(
  translations: SetupGuideTranslations | undefined,
): SetupGuideTranslationState {
  const { language } = useTranslateValue();
  const askedIn: string = translations
    ? getDocumentationLanguage({
        language: language,
        translations: translations,
      })
    : DEFAULT_DASHBOARD_LANGUAGE;

  const [loaded, setLoaded] = useState<LoadedWords | null>(null);

  useEffect(() => {
    if (!translations || askedIn === DEFAULT_DASHBOARD_LANGUAGE) {
      return;
    }

    let isCurrent: boolean = true;

    loadSetupGuideWords({ language: askedIn, translations: translations })
      .then((words: SetupGuideWords | null): void => {
        if (isCurrent) {
          setLoaded({ askedIn: askedIn, words: words });
        }
      })
      .catch((): void => {
        if (isCurrent) {
          setLoaded({ askedIn: askedIn, words: null });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [askedIn, translations]);

  if (askedIn === DEFAULT_DASHBOARD_LANGUAGE) {
    return { isLoading: false, words: null };
  }

  if (!loaded || loaded.askedIn !== askedIn) {
    return { isLoading: true, words: null };
  }

  return { isLoading: false, words: loaded.words };
}
