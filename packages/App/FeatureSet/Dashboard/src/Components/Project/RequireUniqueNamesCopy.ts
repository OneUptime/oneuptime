import { PluralTemplate } from "Common/Types/Translator";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether two records of one kind may share a name in the project, on
 * Project Settings > Project (#10761): the Require Unique Names switch, which
 * saves the moment it is flipped (RequireUniqueNamesCard), and under it the
 * names the project holds more than once, each record linked for renaming.
 *
 * Turning it on never asks first: it refuses nothing that exists - names
 * held twice keep working until someone renames them - and turning it off
 * again undoes it. New projects start with it on.
 *
 * Kept free of React so the card and its tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export const RequireUniqueNamesCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  // Under the switch: the names held more than once.
  noneRepeat: string;
  repeatCount: PluralTemplate;
  repeatKeptWhileOn: string;
  repeatKeptWhenTurnedOn: string;
  moreNames: PluralTemplate;
  hiddenRecords: PluralTemplate;
  loadFailed: string;
} = {
  cardTitle: translationKey("Unique Names"),
  cardDescription: translationKey(
    "Whether two monitors, templates or other records of one kind may share a name in this project.",
  ),
  switchTitle: translationKey("Require Unique Names"),
  switchOnDescription: translationKey(
    "Two records of one kind cannot share a name, whether it is set here, through the API or in Terraform. Case and extra spaces do not count.",
  ),
  switchOffDescription: translationKey(
    "Records of one kind may share a name. Forms still warn when a name is already used.",
  ),
  noneRepeat: translationKey(
    "No two records of one kind share a name in this project.",
  ),
  repeatCount: {
    one: translationKey("{{count}} name is used by more than one record."),
    other: translationKey("{{count}} names are used by more than one record."),
  },
  repeatKeptWhileOn: translationKey(
    "They keep working until someone renames them. New records and renames need a name of their own.",
  ),
  repeatKeptWhenTurnedOn: translationKey(
    "Turning this on keeps them working until someone renames them.",
  ),
  moreNames: {
    one: translationKey("And {{count}} more name."),
    other: translationKey("And {{count}} more names."),
  },
  hiddenRecords: {
    one: translationKey("and {{count}} record you cannot open"),
    other: translationKey("and {{count}} records you cannot open"),
  },
  loadFailed: translationKey(
    "Could not check which names are used more than once. {{error}}",
  ),
};

// The Project column the switch writes.
export type RequireUniqueNamesColumn = "requireUniqueNames";

export const REQUIRE_UNIQUE_NAMES_COLUMN: RequireUniqueNamesColumn =
  "requireUniqueNames";

// The data-testid of the switch.
export const REQUIRE_UNIQUE_NAMES_SWITCH_TEST_ID: string =
  "project-require-unique-names-switch";

// The data-testid of the list of names held more than once.
export const DUPLICATE_NAMES_TEST_ID: string = "project-duplicate-names";

// The card's place on Project Settings > Project: #unique-names.
export const UNIQUE_NAMES_CARD_ID: string = "unique-names";

export default RequireUniqueNamesCopy;
