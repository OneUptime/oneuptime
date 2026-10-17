import StatusPageThemeUtil, {
  useStatusPageTheme,
} from "../../Utils/StatusPageTheme";
import IconProp from "Common/Types/Icon/IconProp";
import {
  doesStatusPageThemeFollowDevice,
  STATUS_PAGE_DARK_SCHEME,
} from "Common/Types/StatusPage/StatusPageTheme";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * The visitor's own light / dark switch, in the footer beside the language
 * switcher - only on a page whose owner set it to follow each visitor's
 * device (StatusPageTheme.System). A page set to Light or Dark looks the way
 * its owner chose for everyone, and offers no switch.
 *
 * One small icon button, as calm as the footer's other links: a moon on the
 * light page (switch to dark), a sun on the dark one (switch to light), with
 * what it does as its name and tooltip. The pick is kept in the visitor's
 * browser; picking what their device asks for again lets the page follow the
 * device once more (StatusPageThemeUtil.switchColorScheme).
 */

export const THEME_SWITCH_TEST_ID: string = "status-page-theme-switch";

const ThemeSwitch: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const { theme, colorScheme } = useStatusPageTheme();

  if (!doesStatusPageThemeFollowDevice(theme)) {
    return <></>;
  }

  const isDark: boolean = colorScheme === STATUS_PAGE_DARK_SCHEME;
  const label: string = isDark
    ? t("theme.switchToLight")
    : t("theme.switchToDark");

  return (
    <button
      type="button"
      onClick={() => {
        StatusPageThemeUtil.switchColorScheme();
      }}
      aria-label={label}
      title={label}
      data-testid={THEME_SWITCH_TEST_ID}
      data-color-scheme={colorScheme}
      className="inline-flex items-center justify-center rounded p-0.5 text-gray-500 transition-colors duration-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
    >
      <Icon
        icon={isDark ? IconProp.Sun : IconProp.Moon}
        size={SizeProp.Small}
        className="h-4 w-4"
      />
    </button>
  );
};

export default ThemeSwitch;
