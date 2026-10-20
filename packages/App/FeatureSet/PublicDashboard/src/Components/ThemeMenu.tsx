import DashboardThemeUtil from "../Utils/DashboardTheme";
import { useDashboardTheme } from "../Utils/UseDashboardTheme";
import {
  THEME_MENU_AUTO_MARK_TEST_ID,
  THEME_MENU_BUTTON_TEST_ID,
  THEME_MENU_CHOICES,
  THEME_MENU_LABEL,
  THEME_MENU_TEST_ID,
  ThemeMenuChoice,
  getThemeMenuAutoHint,
  getThemeMenuCheckTestId,
  getThemeMenuChoiceTestId,
} from "./ThemeMenuCopy";
import { DASHBOARD_DARK_SCHEME } from "Common/Types/Dashboard/DashboardTheme";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The visitor's own light / dark pick, in the dashboard's toolbar beside the
 * auto-refresh picker: a sun on the light page, a moon on the dark one, and
 * three choices, each with its icon - a sun, a moon, and a half-filled
 * circle for Auto - and a tick at the right end of the one in use, as the
 * product's other menus of choices with icons draw it (a push notification
 * level's picker).
 *
 *   Light  the light dashboard, whatever its theme
 *   Dark   the dark dashboard, whatever its theme
 *   Auto   none of the visitor's own: the dashboard's theme decides - light,
 *          dark, or as their device is set. Resting on it says which, for
 *          this dashboard (getThemeMenuAutoHint).
 *
 * Every public dashboard offers it, whatever its theme: a dashboard is a
 * screen people watch for a long time, in rooms of every kind, so the
 * visitor's room has the last word. The pick is kept in the visitor's
 * browser, for every public dashboard on this address
 * (DashboardThemeUtil.setVisitorChoice). A link that names its own theme
 * (?theme=, a wall screen's or an embedding site's) offers no menu.
 */

// Its words and test ids are ThemeMenuCopy.ts's, re-exported for the app's tests.
export {
  THEME_MENU_AUTO_MARK_TEST_ID,
  THEME_MENU_BUTTON_TEST_ID,
  THEME_MENU_CHOICES,
  THEME_MENU_LABEL,
  THEME_MENU_TEST_ID,
  getThemeMenuAutoHint,
  getThemeMenuCheckTestId,
  getThemeMenuChoiceTestId,
};

/*
 * Auto's mark: a circle, half filled - light and dark at once, the page
 * taking whichever the dashboard says. Drawn like the set's outline icons
 * (24 by 24, a 1.5 stroke in the text's colour), so it sits in line with the
 * sun and the moon above it and takes the menu's hover colour as they do.
 */
const AutoThemeMark: FunctionComponent = (): ReactElement => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-4 w-4"
      aria-hidden="true"
      data-testid={THEME_MENU_AUTO_MARK_TEST_ID}
    >
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 3.75a8.25 8.25 0 0 0 0 16.5Z" fill="currentColor" />
    </svg>
  );
};

const ThemeMenu: FunctionComponent = (): ReactElement => {
  const { theme, colorScheme, visitorChoice, isVisitorChoiceOffered } =
    useDashboardTheme();

  if (!isVisitorChoiceOffered) {
    return <></>;
  }

  return (
    <div
      data-testid={THEME_MENU_TEST_ID}
      data-color-scheme={colorScheme}
      data-visitor-choice={visitorChoice}
    >
      <MoreMenu
        menuIcon={
          colorScheme === DASHBOARD_DARK_SCHEME ? IconProp.Moon : IconProp.Sun
        }
        text=""
        ariaLabel={THEME_MENU_LABEL}
        dataTestId={THEME_MENU_BUTTON_TEST_ID}
      >
        {THEME_MENU_CHOICES.map((item: ThemeMenuChoice): ReactElement => {
          const isInUse: boolean = item.choice === visitorChoice;

          return (
            <MoreMenuItem
              key={item.choice}
              text={item.title}
              icon={item.icon}
              iconElement={item.icon ? undefined : <AutoThemeMark />}
              tooltip={
                item.choice === "auto" ? getThemeMenuAutoHint(theme) : undefined
              }
              isChecked={isInUse}
              rightElement={
                isInUse ? (
                  <span
                    className="ml-3 flex"
                    data-testid={getThemeMenuCheckTestId(item.choice)}
                  >
                    <Icon
                      icon={IconProp.Check}
                      className="h-4 w-4 text-indigo-600"
                    />
                  </span>
                ) : undefined
              }
              dataTestId={getThemeMenuChoiceTestId(item.choice)}
              onClick={() => {
                DashboardThemeUtil.setVisitorChoice(item.choice);
              }}
            />
          );
        })}
      </MoreMenu>
    </div>
  );
};

export default ThemeMenu;
