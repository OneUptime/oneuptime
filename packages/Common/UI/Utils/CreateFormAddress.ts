import Navigation from "./Navigation";
import {
  CREATE_FORM_ADDRESS_PARAM,
  CREATE_FORM_ADDRESS_VALUE,
  CREATE_FORM_QUERY_STRING,
} from "../../Types/CreateFormAddress";

/*
 * A LIST'S CREATE FORM, OPENED FROM ITS ADDRESS (#7035).
 *
 * "?create=1" on a list page opens the list's own create form, as its Create
 * button does: Search's Create Status Page, Create On-Call Policy, Create
 * On-Call Schedule, Create Dashboard, Create Workflow and Invite User open
 * their list with it. The shared table reads it (BaseModelTable's
 * opensCreateFormFromAddress), so a list opts in with one prop and every
 * list behaves the same:
 *
 *   - The form opens only for someone the list's Create is open to: the
 *     same gate as the button, so someone who may not create sees the list
 *     with Create locked, as anyone would.
 *   - Reloading keeps the form open: the address still asks for it.
 *   - Closing the form - cancelling it or saving it - takes the ask off the
 *     address in place (no new history entry), so Back to the list never
 *     opens the form again.
 *
 * A page whose Create opens a dialog of its own (Create a dashboard, the
 * workflow templates, Invite User) takes the ask off when that dialog
 * closes, with clear().
 */

export {
  CREATE_FORM_ADDRESS_PARAM,
  CREATE_FORM_ADDRESS_VALUE,
  CREATE_FORM_QUERY_STRING,
};

export default class CreateFormAddress {
  // Whether the page's address asks for its list's create form.
  public static isAskedFor(): boolean {
    try {
      return (
        Navigation.getQueryStringByName(CREATE_FORM_ADDRESS_PARAM) ===
        CREATE_FORM_ADDRESS_VALUE
      );
    } catch {
      return false;
    }
  }

  /*
   * Takes the ask off the address, in place: the history entry is replaced,
   * not added to, so Back leaves the list rather than opening the form
   * again. Nothing happens when the address does not ask.
   */
  public static clear(): void {
    if (!CreateFormAddress.isAskedFor()) {
      return;
    }

    Navigation.setQueryString({ [CREATE_FORM_ADDRESS_PARAM]: null });
  }
}
