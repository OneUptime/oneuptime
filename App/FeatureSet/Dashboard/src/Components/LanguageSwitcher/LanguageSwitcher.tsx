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

  const onChange: (event: ChangeEvent<HTMLSelectElement>) => void = (
    event: ChangeEvent<HTMLSelectElement>,
  ): void => {
    const nextLanguage: string = event.target.value;
    i18n.changeLanguage(nextLanguage);
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
        className="cursor-pointer border-0 bg-transparent p-0 text-sm font-medium text-gray-500 transition-colors duration-200 hover:text-gray-700 focus:outline-none focus:ring-0"
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
