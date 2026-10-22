import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * The word an archived value is marked with (Common/Utils/ArchivableValues),
 * on its own so the dropdowns that draw the tag (ArchivedTag) and the
 * pickers that mark an option archived (ArchivedValuePicker) read it without
 * importing each other.
 */
export const ARCHIVED_VALUE_TAG: string = translationKey("Archived");
