import IconProp from "Common/Types/Icon/IconProp";
import HeaderIconDropdownButton from "Common/UI/Components/Header/HeaderIconDropdownButton";
import ThemeUtil, { Theme, useTheme } from "Common/UI/Utils/Theme";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const ThemeToggle: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const theme: Theme = useTheme();
  const isDark: boolean = theme === Theme.Dark;

  return (
    <HeaderIconDropdownButton
      icon={isDark ? IconProp.Sun : IconProp.Moon}
      name={t("userProfile.darkTheme", "Dark theme")}
      showDropdown={false}
      isPressed={isDark}
      onClick={() => {
        ThemeUtil.toggleTheme();
      }}
    />
  );
};

export default ThemeToggle;
