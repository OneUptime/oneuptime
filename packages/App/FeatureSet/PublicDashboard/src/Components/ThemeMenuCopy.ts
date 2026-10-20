import { DashboardVisitorThemeChoice } from "Common/Types/Dashboard/DashboardTheme";

/*
 * The words and test ids of the visitor's theme menu in a public
 * dashboard's toolbar (ThemeMenu.tsx), kept free of React so the guides'
 * tests and the browser suite read these exact values.
 */

/*
 * The menu's wrapper, which says what the page is drawn in
 * (data-color-scheme) and what the visitor picked (data-visitor-choice); its
 * button is `${id}-button`.
 */
export const THEME_MENU_TEST_ID: string = "public-dashboard-theme-menu";

export const THEME_MENU_BUTTON_TEST_ID: string = `${THEME_MENU_TEST_ID}-button`;

// A choice's menu item.
export const getThemeMenuChoiceTestId: (
  choice: DashboardVisitorThemeChoice,
) => string = (choice: DashboardVisitorThemeChoice): string => {
  return `${THEME_MENU_TEST_ID}-${choice}`;
};

// The button's accessible name: it shows only a sun or a moon.
export const THEME_MENU_LABEL: string = "Theme";

/*
 * The three choices, in the order the menu offers them:
 *
 *   Light  the light dashboard, whatever its theme
 *   Dark   the dark dashboard, whatever its theme
 *   Auto   none of the visitor's own: the dashboard's theme decides - light,
 *          dark, or as their device is set
 */
export interface ThemeMenuChoice {
  choice: DashboardVisitorThemeChoice;
  title: string;
}

export const THEME_MENU_CHOICES: ReadonlyArray<ThemeMenuChoice> = [
  { choice: "light", title: "Light" },
  { choice: "dark", title: "Dark" },
  { choice: "auto", title: "Auto" },
];
