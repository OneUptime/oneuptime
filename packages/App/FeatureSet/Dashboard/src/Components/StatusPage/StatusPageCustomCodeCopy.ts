import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * STATUS PAGES -> A PAGE -> BRANDING -> HTML, CSS & JAVASCRIPT.
 *
 * Four cards said "You can include header HTML to your status page.", "You
 * can include custom JavaScript classes to your status page." and, empty,
 * "No Header HTML found. Please edit this Status Page to add some.", each
 * with an "Edit Status Page" button. They left out the two things that
 * decide whether the code does what its author expects:
 *
 *   - The code runs only on the page's verified custom domains. Opened at
 *     its preview link, the page leaves it all out, because that address
 *     shares OneUptime's signed-in origin (Common/Server/Utils/
 *     StatusPageCustomizationAccess). Somebody pasting CSS and opening the
 *     preview saw nothing change.
 *   - Header and footer HTML replace the page's own header and footer
 *     (MasterPage): the logo and header links, and the copyright, footer
 *     links, language and theme switches.
 *
 * So the page says the first at its top, with Custom Domains a click away,
 * each card says what its code does in one line, and each Edit button names
 * what it edits.
 *
 * Kept free of React so the page and App/Tests read these exact strings.
 */

export const STATUS_PAGE_CUSTOM_CODE_NOTICE_TEST_ID: string =
  "status-page-custom-code-domains-notice";

export const StatusPageCustomCodeCopy: {
  notice: string;
  noticeAction: string;
  headerTitle: string;
  headerDescription: string;
  headerEmpty: string;
  headerEdit: string;
  footerTitle: string;
  footerDescription: string;
  footerEmpty: string;
  footerEdit: string;
  cssTitle: string;
  cssDescription: string;
  cssEdit: string;
  javaScriptTitle: string;
  javaScriptDescription: string;
  javaScriptEdit: string;
} = {
  notice: translationKey(
    "This code runs only when the page is opened on one of its custom domains, not at its preview link.",
  ),
  noticeAction: translationKey("Custom Domains"),
  headerTitle: translationKey("Header HTML"),
  headerDescription: translationKey(
    "Replaces the page's header: its logo and header links.",
  ),
  headerEmpty: translationKey(
    "None: the page shows its logo and header links.",
  ),
  headerEdit: translationKey("Edit Header HTML"),
  footerTitle: translationKey("Footer HTML"),
  footerDescription: translationKey(
    "Replaces the page's footer, with its links and its language and theme switches.",
  ),
  footerEmpty: translationKey("None: the page shows its own footer."),
  footerEdit: translationKey("Edit Footer HTML"),
  cssTitle: translationKey("Custom CSS"),
  cssDescription: translationKey(
    "Styles added to every page of the status page.",
  ),
  cssEdit: translationKey("Edit CSS"),
  javaScriptTitle: translationKey("Custom JavaScript"),
  javaScriptDescription: translationKey("Runs when the status page loads."),
  javaScriptEdit: translationKey("Edit JavaScript"),
};

export default StatusPageCustomCodeCopy;
