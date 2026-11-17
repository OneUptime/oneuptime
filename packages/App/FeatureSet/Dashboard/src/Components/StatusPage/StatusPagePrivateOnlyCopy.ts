import { StatusPageAccess } from "Common/Types/StatusPage/StatusPageAccess";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The settings that only a private status page reads: its private users,
 * its single sign-on providers (SAML and OIDC) and SCIM. On a public page
 * (Access: "Anyone with the link") the server lets every visitor in without
 * signing in, so none of them does anything there - and until #9130 none of
 * their pages said so: a person could add private users or a SAML provider
 * to a public page and wait for a sign-in page that never came.
 *
 * Each of those pages now says it, in one shared notice, while the page is
 * public, with the way to Access, where the page is made private. What the
 * page holds is folded under the notice, still there to set up before the
 * page goes private (so nobody is locked out the moment it does), and opens
 * by itself when a link names a place on the page.
 *
 * Kept free of React so the component, the pages and App/Tests read these
 * exact strings. Every sentence is wrapped in translationKey() so
 * npm run i18n:extract finds it.
 */

/*
 * Each page's own words for what it folds away, said under the fold's title
 * while it is folded, so nobody opens it to learn what is in it.
 */
export enum StatusPagePrivateOnlyPage {
  PrivateUsers = "PrivateUsers",
  SingleSignOn = "SingleSignOn",
  Scim = "Scim",
}

const StatusPagePrivateOnlyCopy: {
  // The notice: what is true while the page is public, and the way out.
  publicNotice: string;
  publicNoticeAction: string;
  // The fold the page's settings wait under.
  foldTitle: string;
  foldDescription: string;
  foldSummary: Record<StatusPagePrivateOnlyPage, string>;
} = {
  publicNotice: translationKey(
    "This status page is public, so these settings do nothing until you make it private.",
  ),
  publicNoticeAction: translationKey("Change access"),
  foldTitle: translationKey("Set Up Before Making It Private"),
  foldDescription: translationKey(
    "Ready for when the page is private, so nobody is locked out when it changes.",
  ),
  foldSummary: {
    [StatusPagePrivateOnlyPage.PrivateUsers]: translationKey(
      "Private users and sign-in links.",
    ),
    [StatusPagePrivateOnlyPage.SingleSignOn]: translationKey(
      "SAML and OIDC providers, and Require SSO for Login.",
    ),
    [StatusPagePrivateOnlyPage.Scim]: translationKey(
      "SCIM connections that add and remove private users.",
    ),
  },
};

export const STATUS_PAGE_PUBLIC_NOTICE_TEST_ID: string =
  "status-page-public-notice";

export const STATUS_PAGE_PRIVATE_ONLY_FOLD_TEST_ID: string =
  "status-page-private-only-fold";

/*
 * Whether the notice shows: only once the page is read, and only while it is
 * public. Unread (undefined) it shows nothing, so a private page never
 * flashes it.
 */
export const isStatusPagePublicNoticeShown: (
  access: StatusPageAccess | undefined,
) => boolean = (access: StatusPageAccess | undefined): boolean => {
  return access === StatusPageAccess.Anyone;
};

export default StatusPagePrivateOnlyCopy;
