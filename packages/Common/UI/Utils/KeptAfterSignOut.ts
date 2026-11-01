import { COOKIE_CONSENT_STORAGE_KEY } from "../../Types/Analytics/CookieConsent";
import { DASHBOARD_LANGUAGE_STORAGE_KEY } from "../../Types/Dashboard/DashboardLanguage";
import { DASHBOARD_VISITOR_THEME_STORAGE_KEY } from "../../Types/Dashboard/DashboardTheme";
import {
  STATUS_PAGE_LANGUAGE_STORAGE_KEY,
  STATUS_PAGE_LANGUAGE_USER_CHOICE_KEY,
} from "../../Types/StatusPage/StatusPageLanguage";
import { STATUS_PAGE_VISITOR_THEME_STORAGE_KEY } from "../../Types/StatusPage/StatusPageTheme";
import { THEME_STORAGE_KEY } from "../../Types/Theme/ThemePreference";

/*
 * What signing out leaves in the browser.
 *
 * Signing out forgets the person, not the browser. Whatever ends a session -
 * the user menu's Log out, a session that lapsed (Utils/API/API.ts), an
 * account deleted - runs User.logout(), and everything the browser keeps for
 * this address goes: who the person is, their projects and permissions, how
 * they read tables and dashboards, and any name added later that nobody
 * thought about. Whoever signs in next on a shared browser finds none of it.
 *
 * What stays is named here, key by key: how this browser asks OneUptime's
 * pages to look and speak, and what it answered about cookies. Each one is
 *
 *   - read by a page shown to someone signed out. A sign-in page opens next,
 *     and it can only follow what is still there (issue #5404). Status pages,
 *     public dashboards, the docs and the API reference have visitors who
 *     never sign in; on the Dashboard's address they share its storage, and
 *     their picks were never a sign-out's to clear.
 *   - the browser's, not the account's. It is saved nowhere else, so no
 *     sign-in brings it back (docs: introduction/your-account). The cookie
 *     answer most of all: a refusal is promised to be remembered, and with no
 *     answer left, measurement starts again outside the places that ask first
 *     (Common/Server/Views/Partials/AnalyticsConsent.ejs).
 *   - a word with nobody in it: light, dark, a language, true or false. The
 *     next person on a shared browser starts from it, as they start from the
 *     device's theme, and changes it in a click.
 *
 * Deliberately not here, whatever a key's name looks like:
 *
 *   - A person's timezone. It is their account's and comes back at sign-in,
 *     and another person's would silently misdate every page (User.logout).
 *   - The time range, auto-refresh and sort they picked on a dashboard
 *     (DashboardViewerPicks.ts). The docs promise these are theirs alone and
 *     that nobody else sees them, and the sign-in pages never read them. A
 *     wall screen that must outlive a session carries its range and refresh
 *     in its address (?range=, ?refresh=), which beats a kept pick.
 *   - A table's widths, columns, density and page size: whoever signs in next
 *     finds every table as the product draws it (useColumnWidths.ts).
 *
 * A key belongs here only with reasons as good as these. Nothing is matched
 * by a prefix: the key has to be this exact name, so what is kept can always
 * be read off this list.
 */

// The docs' own theme switch (Docs/Views/Partials/Head.ejs).
export const DOCS_THEME_STORAGE_KEY: string = "oneuptime-docs-theme";

// The API reference's (APIReference/views/partials/head.ejs).
export const API_REFERENCE_THEME_STORAGE_KEY: string =
  "oneuptime-reference-theme";

export const KEYS_KEPT_AFTER_SIGN_OUT: ReadonlyArray<string> = [
  // The Dashboard, the Admin Dashboard and the sign-in pages.
  THEME_STORAGE_KEY,
  DASHBOARD_LANGUAGE_STORAGE_KEY,

  // Status pages and public dashboards on this address.
  STATUS_PAGE_VISITOR_THEME_STORAGE_KEY,
  STATUS_PAGE_LANGUAGE_STORAGE_KEY,
  STATUS_PAGE_LANGUAGE_USER_CHOICE_KEY,
  DASHBOARD_VISITOR_THEME_STORAGE_KEY,

  // The docs and the API reference.
  DOCS_THEME_STORAGE_KEY,
  API_REFERENCE_THEME_STORAGE_KEY,

  // The answer on the cookie banner, shared by every OneUptime page.
  COOKIE_CONSENT_STORAGE_KEY,
];
