import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * WHAT A HELD VALUE READS AS ONCE NO RECORD ANSWERS TO IT (#10646).
 *
 * A filter restored from a link, a saved view or a setting names records by
 * their ids. Read by those ids, one that is deleted since - or out of the
 * reader's reach - is not found: it is drawn in these words, muted, and
 * can be taken out, so nothing a person saved quietly disappears or shows
 * as a raw id. The same words the dashboard's other pickers say it in
 * (EntityDropdown's notFoundLabel).
 */
export const ENTITY_DROPDOWN_NOT_FOUND_LABEL: string = translationKey(
  "No longer available",
);
