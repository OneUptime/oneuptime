import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a security case's custom fields say: Security Events > Settings >
 * Custom Fields, where a project adds the fields its team fills in on every
 * case, and a case's own Custom Fields page (under Advanced), where they are
 * filled in.
 *
 * The settings page names a field as its title does - a Case Custom Field,
 * as "Create Case Custom Field" - rather than by the model's longer name
 * ("Create Security Case Custom Field", in German "Benutzerdefiniertes Feld
 * für Sicherheitsfälle erstellen", a button wider than the card's header
 * beside the side menu). It says what the fields are for, where every other
 * product's page says what custom fields are.
 *
 * React-free, so the docs facts and the locale checks read the same words
 * the pages draw. Every sentence is a key of the Dashboard's locale files.
 */
export const SECURITY_CASE_CUSTOM_FIELDS_COPY: {
  // Security Events > Settings > Custom Fields.
  settingsTitle: string;
  settingsDescription: string;
  singularName: string;
  pluralName: string;
  // A case's Custom Fields page.
  caseCardTitle: string;
  caseCardDescription: string;
  caseEmptyMessage: string;
} = {
  settingsTitle: translationKey("Case Custom Fields"),
  settingsDescription: translationKey(
    "The fields your team fills in on every case, such as its business unit or its ticket in another tool.",
  ),
  singularName: translationKey("Case Custom Field"),
  pluralName: translationKey("Case Custom Fields"),
  caseCardTitle: translationKey("Case Custom Fields"),
  caseCardDescription: translationKey(
    "The project's own fields, filled in for this case.",
  ),
  caseEmptyMessage: translationKey(
    "This project has no custom fields for its cases yet.",
  ),
};

export default SECURITY_CASE_CUSTOM_FIELDS_COPY;
