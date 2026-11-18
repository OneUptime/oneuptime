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
import { switchDashboardLanguage } from "../../Utils/DashboardLanguageSwitch";

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
   * The bundle is loaded before the switch (DashboardLanguageSwitch). A
   * signed-in person's pick is theirs from then on, saved to their account
   * (Types/UserLanguage): every browser they sign in on starts in it, and
   * their on-call pages are written in it. Saving is best effort and never
   * holds the switch up.
   */
  const switchLanguage: (nextLanguage: string) => Promise<void> = async (
    nextLanguage: string,
  ): Promise<void> => {
    await switchDashboardLanguage(i18n, nextLanguage);
    await UserLanguageUtil.saveSignedInUserLanguage(nextLanguage);
  };

  const onChange: (nextLanguage: string) => void = (
    nextLanguage: string,
  ): void => {
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
    <LanguagePicker
      inputId="dashboard-language-switcher"
      label={t("language.switchLanguage")}
      languages={SUPPORTED_LANGUAGES}
      value={currentLanguage}
      onChange={onChange}
      className={props.className}
    />
  );
};

export default LanguageSwitcher;
