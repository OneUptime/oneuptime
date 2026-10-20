import DashboardTheme, {
  DashboardVisitorThemeChoice,
} from "Common/Types/Dashboard/DashboardTheme";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The words, icons and test ids of the visitor's theme menu in a public
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

/*
 * The tick on the choice in use, at the item's right end: each item's left
 * holds its own icon.
 */
export const getThemeMenuCheckTestId: (
  choice: DashboardVisitorThemeChoice,
) => string = (choice: DashboardVisitorThemeChoice): string => {
  return `${getThemeMenuChoiceTestId(choice)}-check`;
};

// Auto's own mark, a half-filled circle (ThemeMenu.tsx draws it).
export const THEME_MENU_AUTO_MARK_TEST_ID: string = `${THEME_MENU_TEST_ID}-auto-mark`;

// The button's accessible name: it shows only a sun or a moon.
export const THEME_MENU_LABEL: string = "Theme";

/*
 * The three choices, in the order the menu offers them, each with its icon,
 * as theme menus everywhere draw them:
 *
 *   Light  a sun: the light dashboard, whatever its theme
 *   Dark   a moon: the dark dashboard, whatever its theme
 *   Auto   none of the visitor's own: the dashboard's theme decides - light,
 *          dark, or as their device is set. Its mark is a half-filled circle
 *          (drawn by the menu: no icon of the set says "either"), never a
 *          screen, which would promise the device's scheme on a dashboard
 *          whose own theme is Light or Dark.
 */
export interface ThemeMenuChoice {
  choice: DashboardVisitorThemeChoice;
  title: string;
  // Light's sun and Dark's moon; Auto has the menu's own mark.
  icon?: IconProp | undefined;
}

export const THEME_MENU_CHOICES: ReadonlyArray<ThemeMenuChoice> = [
  { choice: "light", title: "Light", icon: IconProp.Sun },
  { choice: "dark", title: "Dark", icon: IconProp.Moon },
  { choice: "auto", title: "Auto" },
];

/*
 * What Auto gives on this dashboard, shown when the pointer or the keyboard
 * rests on it: the dashboard's own theme, said for the one it has, so a
 * visitor knows what "Auto" turns the page into before picking it. One
 * short line each; "matches your device" is the Branding card's own word
 * for System ("Match each visitor's device").
 */
export const getThemeMenuAutoHint: (theme: DashboardTheme) => string = (
  theme: DashboardTheme,
): string => {
  if (theme === DashboardTheme.System) {
    return "The dashboard's own theme: matches your device";
  }

  if (theme === DashboardTheme.Dark) {
    return "The dashboard's own theme: dark";
  }

  return "The dashboard's own theme: light";
};
