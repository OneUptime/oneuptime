import { SecurityHuntSchedule } from "Common/Types/SecurityEvent/SecurityHunt";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of hunts in the Dashboard: Security Events > Events > Hunts, a
 * hunt's page, Save as Hunt on Events, and Add to Case wherever events are
 * listed. Each is an en.json key, looked up where it is drawn. What is
 * wrong with a hunt is the shared rules' own words
 * (Common/Types/SecurityEvent/SecurityHunt), keys too.
 *
 * A hunt's search is what a person typed, so it is always shown as written,
 * in the mono type, never looked up as words.
 *
 * React-free, so the words are pinned in a plain test.
 */

// ---------- Security Events > Events > Hunts ----------

export const HUNTS_TABLE_TITLE: string = translationKey("Hunts");

export const HUNTS_TABLE_DESCRIPTION: string = translationKey(
  "Searches over your security events, saved to open again in one click, or run on a schedule that tells you when they find something.",
);

export const HUNTS_EMPTY_TITLE: string = translationKey("No hunts yet");

/*
 * How to make the first one. What a hunt is and does is the card's
 * description, right above it: not said a second time.
 */
export const HUNTS_EMPTY_DESCRIPTION: string = translationKey(
  "Search on Events and choose Save as Hunt from its Hunts list, or create one here.",
);

export const SEARCH_EVENTS: string = translationKey("Search Events");

// One row of the list: "Create Hunt", "Showing 1-3 of 3 hunts".
export const HUNT_SINGULAR: string = translationKey("Hunt");
export const HUNT_PLURAL: string = translationKey("Hunts");

// The list's columns.
export const HUNT_COLUMN_TITLE: string = translationKey("Hunt");
export const SCHEDULE_COLUMN_TITLE: string = translationKey("Schedule");
export const LAST_FOUND_COLUMN_TITLE: string = translationKey("Last Found");

// How many filters a hunt keeps beside its search.
export const FILTER_COUNT: PluralTemplate = {
  one: "{{count}} filter",
  other: "{{count}} filters",
};

// How often a hunt runs, as the schedule's dropdown and the list say it.
export const SCHEDULE_LABELS: Record<SecurityHuntSchedule, string> = {
  [SecurityHuntSchedule.NotScheduled]: translationKey("Not Scheduled"),
  [SecurityHuntSchedule.EveryHour]: translationKey("Every Hour"),
  [SecurityHuntSchedule.EverySixHours]: translationKey("Every 6 Hours"),
  [SecurityHuntSchedule.EveryDay]: translationKey("Every Day"),
  [SecurityHuntSchedule.EveryWeek]: translationKey("Every Week"),
};

// Who a scheduled hunt tells: "Tells Maya Chen", "Tells Maya Chen and 2 more".
export const TELLS: string = translationKey("Tells {{names}}");
export const TELLS_AND_MORE: PluralTemplate = {
  one: "Tells {{names}} and {{count}} more",
  other: "Tells {{names}} and {{count}} more",
};
export const TELLS_NOBODY: string = translationKey("Tells nobody yet");

// When a scheduled hunt runs next, with the time in words: "Next run in 3 hours".
export const NEXT_RUN: string = translationKey("Next run {{time}}");

// What the last run that found something found: "3 events", with when.
export const FOUND_EVENT_COUNT: PluralTemplate = {
  one: "{{count}} event",
  other: "{{count}} events",
};
export const NOTHING_FOUND_YET: string = translationKey("Nothing found yet");
export const NOT_RUN_YET: string = translationKey("Not run yet");
export const COULD_NOT_RUN: string = translationKey("Couldn't run");

// ---------- The form ----------

export const SEARCH_STEP_TITLE: string = translationKey("Search");
export const SCHEDULE_STEP_TITLE: string = translationKey("Schedule");

export const NAME_FIELD_TITLE: string = translationKey("Name");
export const NAME_FIELD_PLACEHOLDER: string = translationKey(
  "e.g. Encoded PowerShell",
);

export const SEARCH_FIELD_TITLE: string = translationKey("Search");
export const SEARCH_FIELD_DESCRIPTION: string = translationKey(
  "What to look for, as you type it on Events: words in a message, fields such as user:alice or host:web-01, and attributes such as @threat.matched:true.",
);
export const SEARCH_FIELD_PLACEHOLDER: string =
  "processname:powershell.exe commandline:-enc";

export const SEARCH_OVER_FIELD_TITLE: string = translationKey("Time Range");
export const SEARCH_OVER_FIELD_DESCRIPTION: string = translationKey(
  "How far back the hunt looks when you open it.",
);

export const SCHEDULE_FIELD_TITLE: string = translationKey("Schedule");
export const SCHEDULE_FIELD_DESCRIPTION: string = translationKey(
  "Each run searches the events that arrived since the run before, and tells the people you choose when it finds something.",
);

export const TELL_FIELD_TITLE: string = translationKey("Notify");
export const TELL_FIELD_DESCRIPTION: string = translationKey(
  "Who is told when a run finds events, each as their notification settings say. Only people who can read security events are told.",
);
export const TELL_ADD_BUTTON_TEXT: string =
  translationKey("Add person or team");

export const DESCRIPTION_FIELD_TITLE: string = translationKey("Description");
export const DESCRIPTION_FIELD_PLACEHOLDER: string = translationKey(
  "Why it matters, and what to do when it finds something",
);

// ---------- A hunt's page ----------

export const HUNT_NOT_FOUND: string = translationKey(
  "This hunt was not found. It may have been deleted.",
);

export const LAST_FOUND: PluralTemplate = {
  one: "Last found {{count}} event {{time}}",
  other: "Last found {{count}} events {{time}}",
};
export const SHOW_THEM: string = translationKey("Show them");
export const RUNS_FOUND_NOTHING_YET: string = translationKey(
  "Its runs have found nothing yet.",
);
// Said as the line over it says what a run found: "Last found 3 events 2 hours ago".
export const LAST_RUN_FAILED: string = translationKey(
  "Last run failed: {{error}}",
);

/*
 * The page searches something other than what the hunt keeps: said over the
 * explorer, with what the hunt keeps ("Saved search: user:svc-*") - what
 * Save Changes replaces and Discard Changes goes back to - and both buttons.
 */
export const SEARCH_CHANGED: string = translationKey(
  "You changed this hunt's search.",
);
export const SAVED_SEARCH: string = translationKey("Saved search:");
export const SAVE_CHANGES: string = translationKey("Save Changes");
export const DISCARD_CHANGES: string = translationKey("Discard Changes");
export const EDIT_HUNT: string = translationKey("Edit");
export const EDIT_HUNT_TITLE: string = translationKey("Edit Hunt");
export const DELETE_HUNT: string = translationKey("Delete Hunt");
export const DELETE_HUNT_CONFIRM: string = translationKey(
  "Delete the hunt {{name}}? Its search and schedule are deleted. Events it found and kept on cases stay on them.",
);
export const MORE_ACTIONS: string = translationKey("More actions");
export const HUNT_ACTIONS_LABEL: string = translationKey("Hunt actions");

// ---------- The Hunts list on the Events explorer's toolbar ----------

// Its footer, which saves the search on screen; the trigger reads "Hunts".
export const HUNTS_MENU_SAVE_AS_HUNT: string = translationKey("+ Save as Hunt");
export const HUNTS_MENU_EMPTY: string = translationKey("No hunts yet.");
export const HUNTS_MENU_LOADING: string = translationKey("Loading hunts…");
// A read that failed, in red, with Try again under it.
export const HUNTS_MENU_NOT_LOADED: string = translationKey(
  "Hunts could not be loaded.",
);
export const HUNTS_MENU_TRY_AGAIN: string = translationKey("Try again");
export const HUNTS_MENU_SEARCH: string = translationKey("Search hunts...");

// ---------- Save as Hunt, on Events ----------

export const SAVE_AS_HUNT: string = translationKey("Save as Hunt");
export const SAVE_AS_HUNT_DESCRIPTION: string = translationKey(
  "Save the search on screen with a name, to open it again in one click, or run it on a schedule that tells you when it finds something.",
);
export const SAVE_AS_HUNT_NOTHING_TO_SAVE: string = translationKey(
  "Type a search or pick a filter first: a hunt saves the search on screen.",
);
export const SAVE_HUNT: string = translationKey("Save Hunt");
// What the dialog saves, over the fields: the search, its filters, its window.
export const SAVES_THIS_SEARCH: string = translationKey("Saves this search");

// ---------- Add to Case ----------

export const ADD_TO_CASE: string = translationKey("Add to Case");
export const ADD_TO_CASE_TITLE: string = translationKey("Add to a Case");
export const ADD_TO_CASE_DESCRIPTION: string = translationKey(
  "Keep the events on a case's Evidence page, as they are now: the case still shows them once they are past their retention.",
);
export const ADD_EVENTS_BUTTON: PluralTemplate = {
  one: "Add {{count}} Event",
  other: "Add {{count}} Events",
};
export const SEARCH_CASES_PLACEHOLDER: string = translationKey(
  "Search open cases by number or title",
);
// Open Case is in an event's panel, which a click on the event opens.
export const NO_OPEN_CASES: string = translationKey(
  "No open cases. To start one, click an event and choose Open Case.",
);
export const NO_MATCHING_CASES: string = translationKey(
  "No open case matches this search.",
);
export const CASES_NOT_LOADED: string = translationKey(
  "Couldn't load the open cases.",
);
export const ADD_TO_CASE_CAP_TOOLTIP: string = translationKey(
  "Select {{count}} or fewer to add them to a case.",
);
export const OPEN_CASE_NUMBER: string = translationKey("Open {{number}}");
export const OPEN_THE_CASE: string = translationKey("Open the case");
// Under an event's Add to Case: the case's number, a link to its Evidence page.
export const ADDED_TO_CASE_NUMBER: string =
  translationKey("Added to {{case}}.");
export const ALREADY_ON_CASE_NUMBER: string = translationKey(
  "Already kept on {{case}}.",
);
export const ADDED_TO_CASE: PluralTemplate = {
  one: "{{count}} {{itemName}} added to the case",
  other: "{{count}} {{itemsName}} added to the case",
};
export const NOT_ADDED_TO_CASE: PluralTemplate = {
  one: "{{count}} {{itemName}} not added",
  other: "{{count}} {{itemsName}} not added",
};
// The ones the case kept already, left as they were (not "not changed").
export const ALREADY_ON_CASE_COUNT: PluralTemplate = {
  one: "{{count}} {{itemName}} already on the case",
  other: "{{count}} {{itemsName}} already on the case",
};
export const EVENT_SINGULAR: string = translationKey("Event");
export const EVENT_PLURAL: string = translationKey("Events");

// ---------- An event kept on a case ----------

export const FOUND_BY_HUNT: string = translationKey(
  "Found by the hunt {{hunt}}",
);
export const VIEW_EVENT: string = translationKey("View Event");
export const KEPT_EVENT_NOTE: string = translationKey(
  "Kept on this case as OneUptime read it {{time}}.",
);

export const HUNTS_TEST_IDS: {
  table: string;
  nameCell: string;
  nameFacts: string;
  searchLine: string;
  scheduleCell: string;
  lastFoundCell: string;
  header: string;
  headerFacts: string;
  headerDescription: string;
  headerSchedule: string;
  lastFound: string;
  showThem: string;
  changed: string;
  savedSearch: string;
  nothingToSave: string;
  saveChanges: string;
  discardChanges: string;
  edit: string;
  more: string;
  delete: string;
  huntsMenu: string;
  menuNotLoaded: string;
  saveSummary: string;
  addToCase: string;
  addToCaseResult: string;
  caseList: string;
  casePicker: string;
  caseOption: string;
  eventEvidenceMeta: string;
  eventEvidenceHunt: string;
} = {
  table: "security-hunts-table",
  nameCell: "security-hunt-name",
  nameFacts: "security-hunt-name-facts",
  searchLine: "security-hunt-search",
  scheduleCell: "security-hunt-schedule",
  lastFoundCell: "security-hunt-last-found",
  header: "security-hunt-header",
  headerFacts: "security-hunt-facts",
  headerDescription: "security-hunt-description",
  headerSchedule: "security-hunt-schedule-line",
  lastFound: "security-hunt-last-found-line",
  showThem: "security-hunt-show-them",
  changed: "security-hunt-changed",
  savedSearch: "security-hunt-saved-search",
  nothingToSave: "security-hunt-nothing-to-save",
  saveChanges: "security-hunt-save-changes",
  discardChanges: "security-hunt-discard-changes",
  edit: "security-hunt-edit",
  more: "security-hunt-more",
  delete: "security-hunt-delete",
  huntsMenu: "security-events-hunts-menu",
  menuNotLoaded: "security-events-hunts-menu-not-loaded",
  saveSummary: "security-hunt-save-summary",
  addToCase: "security-event-add-to-case",
  addToCaseResult: "security-event-add-to-case-result",
  caseList: "security-add-to-case-list",
  // The open cases' list (EpisodePickerList), which names each case in it `${casePicker}-option`.
  casePicker: "security-add-to-case-picker",
  caseOption: "security-add-to-case-picker-option",
  eventEvidenceMeta: "security-case-evidence-event-meta",
  eventEvidenceHunt: "security-case-evidence-event-hunt",
};
