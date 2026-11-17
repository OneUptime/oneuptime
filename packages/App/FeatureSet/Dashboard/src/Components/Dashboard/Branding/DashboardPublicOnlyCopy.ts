import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The settings that only a dashboard's public link reads: its Branding (the
 * public page's title, description, logos, theme and favicon) and its Custom
 * Domains. A dashboard only people in the project can view has no public
 * link, so none of them shows anywhere - and until #9134 the menu offered
 * them on every dashboard, with nothing to say they did nothing there.
 *
 * Each of those pages now says it, in one shared notice, while the
 * dashboard is not shared publicly, with the way to Sharing, where it is.
 * What the page holds is folded under the notice, still there to set up
 * before the link goes out, and opens by itself when a link names a place
 * on the page. The side menu groups both under "Public Link".
 *
 * The status page's private-only settings say the same the other way round
 * (StatusPagePrivateOnlyCopy).
 *
 * Kept free of React so the component, the pages and App/Tests read these
 * exact strings. Every sentence is wrapped in translationKey() so
 * npm run i18n:extract finds it.
 */

export enum DashboardPublicOnlyPage {
  Branding = "Branding",
  CustomDomains = "CustomDomains",
}

const DashboardPublicOnlyCopy: {
  // The notice: what is true while the dashboard is private, and the way out.
  privateNotice: string;
  privateNoticeAction: string;
  // The fold the page's settings wait under.
  foldTitle: string;
  foldDescription: string;
  foldSummary: Record<DashboardPublicOnlyPage, string>;
} = {
  privateNotice: translationKey(
    "Only people in this project can view this dashboard, so these settings do nothing until you share it with a public link.",
  ),
  privateNoticeAction: translationKey("Change sharing"),
  foldTitle: translationKey("Set Up Before Sharing Publicly"),
  foldDescription: translationKey(
    "Ready for when the dashboard has a public link.",
  ),
  foldSummary: {
    [DashboardPublicOnlyPage.Branding]: translationKey(
      "The public link's title, description, logos, theme and favicon.",
    ),
    [DashboardPublicOnlyPage.CustomDomains]: translationKey(
      "Your own domains for the public link.",
    ),
  },
};

export const DASHBOARD_PRIVATE_NOTICE_TEST_ID: string =
  "dashboard-private-notice";

export const DASHBOARD_PUBLIC_ONLY_FOLD_TEST_ID: string =
  "dashboard-public-only-fold";

/*
 * Whether the notice shows: only once the dashboard is read, and only while
 * it is not shared publicly. Unread (undefined) it shows nothing, so a public
 * dashboard never flashes it.
 */
export const isDashboardPrivateNoticeShown: (
  isPublic: boolean | undefined,
) => boolean = (isPublic: boolean | undefined): boolean => {
  return isPublic === false;
};

export default DashboardPublicOnlyCopy;
