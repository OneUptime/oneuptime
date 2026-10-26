import StatusPageThemeUtil, {
  useStatusPageTheme,
} from "../../Utils/StatusPageTheme";
import IconProp from "Common/Types/Icon/IconProp";
import { STATUS_PAGE_DARK_SCHEME } from "Common/Types/StatusPage/StatusPageTheme";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * The visitor's own light / dark switch, in the footer beside the language
 * switcher - on a page whose owner set it to follow each visitor's device
 * (StatusPageTheme.System). A page set to Light or Dark looks the way its
 * owner chose for everyone, and offers no switch - except on the
 * Dashboard's preview of it (its address on OneUptime), where its owner
 * sees it in the other theme too, for that visit only
 * (StatusPageThemeUtil.switchColorScheme).
 *
 * One small icon button, as calm as the footer's other links: a moon on the
 * light page (switch to dark), a sun on the dark one (switch to light), with
 * what it does as its name and tooltip. The pick is kept in the visitor's
 * browser; picking what their device asks for again lets the page follow the
 * device once more (StatusPageThemeUtil.switchColorScheme).
 *
 * The icon is 16px, as the language switcher's is; the button around it is
 * 28px square, a target a thumb can hit, with a soft ground on hover. Its
 * vertical overhang is taken back with a negative margin, so the footer's
 * row keeps the height of its text.
 */

export const THEME_SWITCH_TEST_ID: string = "status-page-theme-switch";

export const THEME_SWITCH_CLASS_NAME: string =
  "-my-1.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const ThemeSwitch: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const { theme, colorScheme } = useStatusPageTheme();

  if (!StatusPageThemeUtil.canVisitorSwitch(theme)) {
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
      className={THEME_SWITCH_CLASS_NAME}
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
