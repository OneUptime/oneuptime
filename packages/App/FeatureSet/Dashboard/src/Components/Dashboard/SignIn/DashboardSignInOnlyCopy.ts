import { DashboardAccess } from "Common/Types/Dashboard/DashboardAccess";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The settings that only Only people who sign in reads (#10250): a
 * dashboard's Private Users and its Single Sign-On. While the dashboard is
 * shared another way - only with its project, with anyone who has the link,
 * or behind a password - nobody signs in to its link, so none of them does
 * anything, and each page says so first, in one shared notice with the way
 * to Sharing, and folds its settings under it: they can still be set up
 * before the choice changes. A status page's private-only settings say the
 * same (StatusPagePrivateOnlyCopy), as do a dashboard's public-only ones
 * (DashboardPublicOnlyCopy).
 *
 * Kept free of React so the component, the pages and App/Tests read these
 * exact strings. Every sentence is wrapped in translationKey() so
 * npm run i18n:extract finds it.
 */

export enum DashboardSignInOnlyPage {
  PrivateUsers = "PrivateUsers",
  SingleSignOn = "SingleSignOn",
}

const DashboardSignInOnlyCopy: {
  notice: string;
  noticeAction: string;
  foldTitle: string;
  foldDescription: string;
  foldSummary: Record<DashboardSignInOnlyPage, string>;
} = {
  notice: translationKey(
    "This dashboard does not ask its visitors to sign in, so these settings do nothing until you choose Only people who sign in.",
  ),
  noticeAction: translationKey("Change sharing"),
  foldTitle: translationKey("Set Up Before Asking Visitors to Sign In"),
  foldDescription: translationKey(
    "Ready for when only people who sign in can view the dashboard.",
  ),
  foldSummary: {
    [DashboardSignInOnlyPage.PrivateUsers]: translationKey(
      "The people you invite to sign in.",
    ),
    [DashboardSignInOnlyPage.SingleSignOn]: translationKey(
      "Your SAML and OIDC identity providers, and Require SSO to Sign In.",
    ),
  },
};

export const DASHBOARD_SIGN_IN_ONLY_NOTICE_TEST_ID: string =
  "dashboard-sign-in-only-notice";

export const DASHBOARD_SIGN_IN_ONLY_FOLD_TEST_ID: string =
  "dashboard-sign-in-only-fold";

/*
 * Whether the notice shows: only once the dashboard is read, and only while
 * it is shared some other way. Unread (undefined) it shows nothing, so a
 * dashboard that asks visitors to sign in never flashes it.
 */
export const isDashboardSignInOnlyNoticeShown: (
  access: DashboardAccess | undefined,
) => boolean = (access: DashboardAccess | undefined): boolean => {
  return access !== undefined && access !== DashboardAccess.SignIn;
};

export default DashboardSignInOnlyCopy;
