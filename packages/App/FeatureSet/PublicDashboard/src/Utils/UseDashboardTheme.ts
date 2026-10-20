import DashboardThemeUtil, {
  DASHBOARD_THEME_CHANGE_EVENT,
} from "./DashboardTheme";
import DashboardTheme, {
  DASHBOARD_DARK_SCHEME,
  DASHBOARD_LIGHT_SCHEME,
  DASHBOARD_VISITOR_THEME_AUTO,
  DashboardColorScheme,
  DashboardVisitorThemeChoice,
} from "Common/Types/Dashboard/DashboardTheme";
import ThemeUtil, { THEME_CHANGE_EVENT, Theme } from "Common/UI/Utils/Theme";
import React from "react";

/*
 * A public dashboard's theme, for React: the half of DashboardTheme.ts that
 * needs React, kept apart so that module stays free of it.
 */

const subscribeToDashboardTheme: (onChange: () => void) => () => void = (
  onChange: () => void,
): (() => void) => {
  if (typeof window === "undefined") {
    return (): void => {};
  }

  window.addEventListener(DASHBOARD_THEME_CHANGE_EVENT, onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);

  return (): void => {
    window.removeEventListener(DASHBOARD_THEME_CHANGE_EVENT, onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
};

const getDashboardThemeSnapshot: () => DashboardTheme = (): DashboardTheme => {
  return DashboardThemeUtil.getDashboardTheme();
};

const getColorSchemeSnapshot: () => DashboardColorScheme =
  (): DashboardColorScheme => {
    return ThemeUtil.getAppliedTheme() === Theme.Dark
      ? DASHBOARD_DARK_SCHEME
      : DASHBOARD_LIGHT_SCHEME;
  };

const getVisitorChoiceSnapshot: () => DashboardVisitorThemeChoice =
  (): DashboardVisitorThemeChoice => {
    return DashboardThemeUtil.getVisitorChoice();
  };

const getLightSnapshot: () => DashboardColorScheme =
  (): DashboardColorScheme => {
    return DASHBOARD_LIGHT_SCHEME;
  };

const getFallbackThemeSnapshot: () => DashboardTheme = (): DashboardTheme => {
  return DashboardTheme.Light;
};

const getAutoSnapshot: () => DashboardVisitorThemeChoice =
  (): DashboardVisitorThemeChoice => {
    return DASHBOARD_VISITOR_THEME_AUTO;
  };

/*
 * The dashboard's theme, the scheme the page is drawn in and the visitor's
 * pick, kept up to date as any of them changes: the toolbar's theme menu
 * reads all three.
 */
export const useDashboardTheme: () => {
  theme: DashboardTheme;
  colorScheme: DashboardColorScheme;
  visitorChoice: DashboardVisitorThemeChoice;
  isVisitorChoiceOffered: boolean;
} = (): {
  theme: DashboardTheme;
  colorScheme: DashboardColorScheme;
  visitorChoice: DashboardVisitorThemeChoice;
  isVisitorChoiceOffered: boolean;
} => {
  const theme: DashboardTheme = React.useSyncExternalStore(
    subscribeToDashboardTheme,
    getDashboardThemeSnapshot,
    getFallbackThemeSnapshot,
  );

  const colorScheme: DashboardColorScheme = React.useSyncExternalStore(
    subscribeToDashboardTheme,
    getColorSchemeSnapshot,
    getLightSnapshot,
  );

  const visitorChoice: DashboardVisitorThemeChoice = React.useSyncExternalStore(
    subscribeToDashboardTheme,
    getVisitorChoiceSnapshot,
    getAutoSnapshot,
  );

  return {
    theme,
    colorScheme,
    visitorChoice,
    isVisitorChoiceOffered: DashboardThemeUtil.isVisitorChoiceOffered(),
  };
};
