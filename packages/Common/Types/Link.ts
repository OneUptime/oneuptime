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
}
