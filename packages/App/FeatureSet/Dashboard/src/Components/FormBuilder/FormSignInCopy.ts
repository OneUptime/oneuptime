import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of a form's sign-in settings (#10249): the Share page's switch
 * that makes the form's link ask its visitors to sign in, and the notice
 * its Private Users and Single Sign-On pages open on while it does not.
 * A dashboard's say the same things in its own words (DashboardSharingCopy,
 * DashboardSignInOnlyCopy).
 *
 * Kept free of React so the components, the pages and App/Tests read these
 * exact strings. Every sentence is wrapped in translationKey() so
 * npm run i18n:extract finds it.
 */

export enum FormSignInOnlyPage {
  PrivateUsers = "PrivateUsers",
  SingleSignOn = "SingleSignOn",
}

const FormSignInCopy: {
  cardTitle: string;
  switchTitle: string;
  onDescription: string;
  offDescription: string;
  note: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmButton: string;
  notice: string;
  noticeAction: string;
  foldTitle: string;
  foldDescription: string;
  foldSummary: Record<FormSignInOnlyPage, string>;
} = {
  cardTitle: translationKey("Who Can Open This Form"),
  switchTitle: translationKey("Only people who sign in"),
  onDescription: translationKey(
    "Only the form's private users, and the people your single sign-on lets in, can open and submit it. Everyone else is asked to sign in.",
  ),
  offDescription: translationKey(
    "Anyone with the form's link can open and submit it.",
  ),
  note: translationKey(
    "Add the people who may sign in under Private Users, or your identity provider under Single Sign-On.",
  ),
  confirmTitle: translationKey("Ask visitors to sign in?"),
  confirmDescription: translationKey(
    "Visitors who are not private users of this form, and whom your single sign-on does not let in, can no longer open or submit it.",
  ),
  confirmButton: translationKey("Ask visitors to sign in"),
  notice: translationKey(
    "This form does not ask its visitors to sign in, so these settings do nothing until you turn on Only people who sign in on its Share page.",
  ),
  noticeAction: translationKey("Go to Share"),
  foldTitle: translationKey("Set Up Before Asking Visitors to Sign In"),
  foldDescription: translationKey(
    "Ready for when only people who sign in can open the form.",
  ),
  foldSummary: {
    [FormSignInOnlyPage.PrivateUsers]: translationKey(
      "The people you invite to sign in.",
    ),
    [FormSignInOnlyPage.SingleSignOn]: translationKey(
      "Your SAML and OIDC identity providers, and Require SSO to Sign In.",
    ),
  },
};

export const FORM_REQUIRE_SIGN_IN_SWITCH_TEST_ID: string =
  "form-require-sign-in-switch";

export const FORM_SIGN_IN_ONLY_NOTICE_TEST_ID: string =
  "form-sign-in-only-notice";

export const FORM_SIGN_IN_ONLY_FOLD_TEST_ID: string = "form-sign-in-only-fold";

/*
 * Whether the notice shows: only once the form is read, and only while it
 * does not ask its visitors to sign in. Unread (undefined) it shows
 * nothing, so a form that asks them never flashes it.
 */
export const isFormSignInOnlyNoticeShown: (
  requireSignIn: boolean | undefined,
) => boolean = (requireSignIn: boolean | undefined): boolean => {
  return requireSignIn === false;
};

export default FormSignInCopy;
