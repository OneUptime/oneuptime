import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import React, {
  ChangeEvent,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { SupportedLanguage, SUPPORTED_LANGUAGES } from "../../Utils/i18n";

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
   * language's bundle must be in memory BEFORE the switch happens —
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
      // Fall through to changeLanguage — English fallback still applies.
    }
    await i18n.changeLanguage(nextLanguage);
  };

  const onChange: (event: ChangeEvent<HTMLSelectElement>) => void = (
    event: ChangeEvent<HTMLSelectElement>,
  ): void => {
    const nextLanguage: string = event.target.value;
    /*
     * Optimistic: reflect the choice in the control immediately (the switch
     * itself now completes asynchronously once the locale chunk is loaded,
     * at which point the languageChanged listener above re-confirms it).
     */
    setCurrentLanguage(nextLanguage);
    switchLanguage(nextLanguage).catch((): void => {
      // Worst case the previously-active language simply stays active.
    });
  };

  return (
    <div
      className={
        props.className ||
        "flex items-center gap-1.5 text-sm text-gray-500 transition-colors duration-200 hover:text-gray-700"
      }
    >
      <Icon
        icon={IconProp.Language}
        size={SizeProp.Small}
        className="h-4 w-4"
      />
      <label htmlFor="dashboard-language-switcher" className="sr-only">
        {t("language.switchLanguage")}
      </label>
      <select
        id="dashboard-language-switcher"
        aria-label={t("language.switchLanguage")}
        value={currentLanguage}
        onChange={onChange}
        className="cursor-pointer rounded border-0 bg-transparent p-0 text-sm font-medium text-gray-500 transition-colors duration-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
      >
        {SUPPORTED_LANGUAGES.map((language: SupportedLanguage) => {
          return (
            <option key={language.code} value={language.code}>
              {language.nativeName}
            </option>
          );
        })}
      </select>
    </div>
  );
};

export default LanguageSwitcher;
