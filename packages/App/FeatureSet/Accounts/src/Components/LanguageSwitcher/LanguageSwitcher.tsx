import LanguagePicker, {
  LANGUAGE_PICKER_CLASS_NAME,
} from "Common/UI/Components/LanguagePicker/LanguagePicker";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../../Utils/i18n";

export interface ComponentProps {
  className?: string | undefined;
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
      inputId="accounts-language-switcher"
      label={t("language.switchLanguage")}
      languages={SUPPORTED_LANGUAGES}
      value={currentLanguage}
      onChange={onChange}
      /*
       * Centred under Contact and Privacy & Terms while the footer stacks
       * them (a phone), at the start of its place in the row from md up.
       */
      className={
        props.className ||
        `${LANGUAGE_PICKER_CLASS_NAME} justify-center md:justify-start`
      }
    />
  );
};

export default LanguageSwitcher;
