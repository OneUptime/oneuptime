import ThemeUtil from "Common/UI/Utils/Theme";

/*
 * The sign-in pages' theme: the person's own (Common/Types/Theme/
 * ThemePreference.ts) - Light or Dark as they picked it in the Dashboard's
 * user menu, on this browser, or as their device is set when they picked
 * System or nothing - so signing in looks like the Dashboard they land in.
 *
 * views/index.ejs has drawn the page in it before the first paint (Common/
 * Server/Views/Partials/Theme.ejs); initialize() keeps it there while the
 * page is open, following the device and a pick made in another tab.
 *
 * One kind of page is not the person's: a public form (/accounts/form/...,
 * and the incident form links shared before Forms, /accounts/incident-form/
 * ...) is its owner's page, branded with the owner's logo, and is drawn
 * light whoever opens it - the Dashboard's Form Branding previews show it
 * so. views/index.ejs gives its first script the same addresses
 * (Common/Tests/App/Accounts/AccountsTheme.test.tsx holds the two to each
 * other).
 */

export const ALWAYS_LIGHT_PATH_PREFIXES: ReadonlyArray<string> = [
  "/accounts/form/",
  "/accounts/incident-form/",
];

// Whether the page at this address is drawn light, whatever the person picked.
export const isAlwaysLightPath: (pathname: string) => boolean = (
  pathname: string,
): boolean => {
  return ALWAYS_LIGHT_PATH_PREFIXES.some((prefix: string): boolean => {
    return pathname.startsWith(prefix);
  });
};

const isOnAlwaysLightPage: () => boolean = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  return isAlwaysLightPath(window.location.pathname);
};

export default class AccountsTheme {
  // As the app starts.
  public static initialize(): void {
    ThemeUtil.initialize({ isAlwaysLight: isOnAlwaysLightPage });
  }

  /*
   * On every move to another page of the app: a page that is always light,
   * or one in the person's theme.
   */
  public static followPage(): void {
    ThemeUtil.applyPreferredTheme();
  }
}
