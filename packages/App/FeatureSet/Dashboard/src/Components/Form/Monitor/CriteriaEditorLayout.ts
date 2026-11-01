/*
 * The boxes of the monitor criteria editor, and how they lie on a phone.
 *
 * "The criteria editor on phones is still nested several boxes deep: a
 * redesign." (follow-up to #5292). At 390px an alert's fields sat in the
 * page's card, the step's Monitor Criteria card, the criteria's box, the
 * Actions section and the action's own box, each a frame with its padding,
 * and the alert's description editor, in a sixth frame (its fold), was
 * 166px wide. It is 260px now, its title field 287px.
 *
 * From sm up nothing here changes. On a phone:
 *
 * - the step's cards are sections of the page's card or the dialog
 *   (MonitorStep draws them in CardSectionsOnPhones);
 * - the criteria's box is the one frame round its fields;
 * - inside it, Filters, Actions and Settings, a filter's box and an
 *   action's box reach out over the 12px the box around them pads by
 *   (-mx-3), each a band as wide as the criteria's box, ruled above and
 *   below, its words 12px in - where the criteria's own start.
 *
 * So the bands keep the light grey that tells a section's header and an
 * action's fields apart, and cost the fields no width.
 */

/*
 * A criteria's box (MonitorCriteria), its accent bar at the start of the
 * line: blue, or grey while the criteria is turned off. The bar's colour is
 * important, so it wins over the box's border-gray-200 - whose dark rule
 * colours every side, and without which the other three sides kept the
 * light default grey: a white frame on the dark theme.
 */
export const CRITERIA_BOX_CLASS_NAME: string =
  "mb-4 overflow-hidden rounded-lg border border-l-4 border-gray-200 bg-white";

export const CRITERIA_ACCENT_CLASS_NAME: string = "!border-l-blue-500";

export const CRITERIA_DISABLED_ACCENT_CLASS_NAME: string = "!border-l-gray-300";

/*
 * The criteria's body, under its header (MonitorCriteria): 12px sides on a
 * phone - what the sections inside reach out over - and 16 from sm up.
 */
export const CRITERIA_BODY_CLASS_NAME: string =
  "px-3 pb-3 bg-white sm:px-4 sm:pb-4";

/*
 * Filters, Actions and Settings (CollapsibleSection, bordered, flush on a
 * phone): across the criteria's box on a phone, framed from sm up.
 */
export const CRITERIA_SECTION_CLASS_NAME: string = "mb-4 -mx-3 sm:mx-0";

/*
 * The box that opens under an action's switch - the status to change to,
 * the alert or incident to open. From sm up it is set in under the switch's
 * words. On a phone it is a band across the criteria's box, reaching out
 * over the Actions section's 12px: its fields start where the switch does,
 * as wide as the criteria's name.
 */
export const CRITERIA_ACTION_FORM_CLASS_NAME: string =
  "-mx-3 mt-4 border-y border-gray-100 bg-gray-50 p-3 sm:ml-6 sm:mr-0 sm:rounded-md sm:border";

/*
 * One filter's box (CriteriaFilter): a band across the criteria's box on a
 * phone, reaching out over the Filters section's 12px, and from sm up the
 * box with a 2px border it always was.
 */
export const CRITERIA_FILTER_BOX_CLASS_NAME: string =
  "-mx-3 my-5 border-y border-gray-200 bg-gray-50 p-3 sm:mx-0 sm:rounded-md sm:border-2 sm:p-2";
