import DashboardThemeUtil from "../Utils/DashboardTheme";
import { useDashboardTheme } from "../Utils/UseDashboardTheme";
import {
  THEME_MENU_BUTTON_TEST_ID,
  THEME_MENU_CHOICES,
  THEME_MENU_LABEL,
  THEME_MENU_TEST_ID,
  ThemeMenuChoice,
  getThemeMenuChoiceTestId,
} from "./ThemeMenuCopy";
import { DASHBOARD_DARK_SCHEME } from "Common/Types/Dashboard/DashboardTheme";
import IconProp from "Common/Types/Icon/IconProp";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The visitor's own light / dark pick, in the dashboard's toolbar beside the
 * auto-refresh picker: a sun on the light page, a moon on the dark one, and
 * three choices with a tick on the one in use, drawn the way the
 * auto-refresh picker draws its own.
 *
 *   Light  the light dashboard, whatever its theme
 *   Dark   the dark dashboard, whatever its theme
 *   Auto   none of the visitor's own: the dashboard's theme decides - light,
 *          dark, or as their device is set
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
  THEME_MENU_BUTTON_TEST_ID,
  THEME_MENU_CHOICES,
  THEME_MENU_LABEL,
  THEME_MENU_TEST_ID,
  getThemeMenuChoiceTestId,
};

const ThemeMenu: FunctionComponent = (): ReactElement => {
  const { colorScheme, visitorChoice, isVisitorChoiceOffered } =
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
              icon={isInUse ? IconProp.Check : undefined}
              isIconSpaceReserved={true}
              isChecked={isInUse}
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
