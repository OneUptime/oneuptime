import Route from "./API/Route";
import URL from "./API/URL";

export default interface Link {
  title: string;
  to: Route | URL;
  openInNewTab?: boolean | undefined;
  /*
   * The title is a name someone gave a record - "Incident Responder" at the
   * end of a custom role's trail - and is drawn as it was typed. Interface
   * words are looked up in the reader's language; a name never is, or one
   * that happens to match some interface text ("Incident Responder" is a
   * placeholder the Dashboard translates) would be shown translated.
   */
  isRecordName?: boolean | undefined;
  /*
   * The title is in the reader's words already: a front end's own keyed
   * text, as the Admin Dashboard's crumbs are (t("breadcrumbs.settings")).
   * Drawn as given - in the trail, the browser tab and the phone's menu -
   * never looked up again: looked up again, a translation that is itself
   * an English word reads as another word (#8075, as "Red" read "Rojo" in
   * #7790). Left out, the title is English, looked up where it is drawn.
   */
  isTitleTranslated?: boolean | undefined;
  /*
   * The name of the one record this crumb stands for - "Website: acme.com"
   * where the trail says "View Monitor" - shown in its place, as typed, and
   * in the browser tab's title. The title stays the page's own name, which
   * is what names the page wherever a record's name does not belong (the
   * page view the product analytics records, among them).
   */
  recordName?: string | undefined;
  /*
   * That record's number, for a record its project numbers - "INC-18" -
   * drawn before its name and never cut, so two incidents with the same
   * title are told apart in the trail and in the browser tab
   * (Utils/Project/RecordNumber). Like the name, never sent to the product
   * analytics.
   */
  recordNumber?: string | undefined;
}
