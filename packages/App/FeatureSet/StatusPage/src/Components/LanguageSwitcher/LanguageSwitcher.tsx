import LanguagePicker from "Common/UI/Components/LanguagePicker/LanguagePicker";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  LANGUAGE_USER_CHOICE_KEY,
  SupportedLanguage,
  SUPPORTED_LANGUAGES,
} from "../../Utils/i18n";

export interface ComponentProps {
  className?: string | undefined;
  enabledLanguages?: Array<string> | null | undefined;
}

const LanguageSwitcher: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { i18n, t } = useTranslation();
  const [currentLanguage, setCurrentLanguage] = useState<string>(
    i18n.resolvedLanguage || i18n.language || "en",
  );

  useEffect(() => {
    const handleLanguageChanged: (lng: string) => void = (
      lng: string,
    ): void => {
      setCurrentLanguage(lng);
    };
    i18n.on("languageChanged", handleLanguageChanged);
    return () => {
      i18n.off("languageChanged", handleLanguageChanged);
    };
  }, [i18n]);

  const availableLanguages: Array<SupportedLanguage> = useMemo(() => {
    if (!props.enabledLanguages || props.enabledLanguages.length === 0) {
      return SUPPORTED_LANGUAGES;
    }
    const allowed: Set<string> = new Set(props.enabledLanguages);
    const filtered: Array<SupportedLanguage> = SUPPORTED_LANGUAGES.filter(
      (language: SupportedLanguage) => {
        return allowed.has(language.code);
      },
    );
    return filtered.length > 0 ? filtered : SUPPORTED_LANGUAGES;
  }, [props.enabledLanguages]);

  // Hide the switcher entirely if the owner configured only one language.
  if (availableLanguages.length <= 1) {
    return <></>;
  }

  /*
   * Non-English locales are lazy chunks (Utils/i18n.ts), so the target
   * language's bundle must be in memory BEFORE the switch happens -
   * otherwise every translated string briefly renders as a raw key while
   * the chunk downloads. loadLanguages resolves instantly for anything
   * already loaded (including the statically-bundled English), and if the
   * chunk cannot be fetched we still switch: i18next then serves the
   * English fallback strings for the missing keys.
   */
  const switchLanguage: (nextLanguage: string) => Promise<void> = async (
    nextLanguage: string,
  ): Promise<void> => {
    try {
      await i18n.loadLanguages(nextLanguage);
    } catch {
      // Fall through to changeLanguage - English fallback still applies.
    }

    await i18n.changeLanguage(nextLanguage);
  };

  const onChange: (nextLanguage: string) => void = (
    nextLanguage: string,
  ): void => {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(LANGUAGE_USER_CHOICE_KEY, "true");
    }
    /*
     * Optimistic: reflect the choice in the control immediately (the switch
     * itself completes asynchronously once the locale chunk is loaded, at
     * which point the languageChanged listener above re-confirms it).
     */
    setCurrentLanguage(nextLanguage);
    switchLanguage(nextLanguage).catch((): void => {
      // Worst case the previously-active language simply stays active.
    });
  };

  return (
    <LanguagePicker
      inputId="status-page-language-switcher"
      label={t("language.switchLanguage")}
      languages={availableLanguages}
      value={currentLanguage}
      onChange={onChange}
      className={props.className}
    />
  );
};

export default LanguageSwitcher;
