import LanguagePicker from "Common/UI/Components/LanguagePicker/LanguagePicker";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import UserLanguageUtil from "Common/UI/Utils/UserLanguage";
import { SUPPORTED_LANGUAGES } from "../../Utils/i18n";
import { switchAdminDashboardLanguage } from "../../Utils/AdminDashboardLanguageSwitch";

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

  const onChange: (nextLanguage: string) => void = (
    nextLanguage: string,
  ): void => {
    /*
     * The language's words are a lazy chunk, loaded before the switch
     * (AdminDashboardLanguageSwitch): the control shows the pick at once,
     * and the languageChanged listener above confirms it once they arrive.
     */
    setCurrentLanguage(nextLanguage);
    switchAdminDashboardLanguage(i18n, nextLanguage).catch((): void => {
      // Worst case the language shown before simply stays.
    });
    /*
     * A signed-in person's pick is theirs from then on, saved to their
     * account (Types/UserLanguage), as the Dashboard's language menu saves
     * it. Best effort: it never holds the switch up.
     */
    void UserLanguageUtil.saveSignedInUserLanguage(nextLanguage);
  };

  return (
    <LanguagePicker
      inputId="admin-dashboard-language-switcher"
      label={t("language.switchLanguage")}
      languages={SUPPORTED_LANGUAGES}
      value={currentLanguage}
      onChange={onChange}
      className={props.className}
    />
  );
};

export default LanguageSwitcher;
