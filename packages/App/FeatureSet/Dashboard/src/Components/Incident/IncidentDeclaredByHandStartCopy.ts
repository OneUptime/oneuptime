import { START_INCIDENTS_DECLARED_BY_HAND_ACKNOWLEDGED_COLUMN } from "Common/Types/Incident/IncidentDeclaredByHandStart";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether an incident someone declares by hand starts acknowledged (#11137,
 * Common/Types/Incident/IncidentDeclaredByHandStart).
 *
 * Incidents -> Settings -> Incident State holds, under the list of states,
 * one card with one switch, "Start incidents declared by hand acknowledged",
 * that saves its Project column the moment it is flipped (the shared
 * ModelSwitchCard). It sits with the states because it says which of them a
 * new incident starts in. It is off for every project; only a project owner
 * or admin may flip it, and for anyone else it is locked and says so. No
 * dialog either way: it can be flipped back, and it changes only where
 * incidents declared from now on start.
 *
 * Each state of the switch says what it means for paging in one sentence,
 * on-call rules included - the one thing someone turning it on must know:
 * an incident that starts acknowledged pages no one.
 *
 * Declare Incident says the same where it is decided, while the switch is
 * on:
 *
 *   - Initial State's help says what leaving it empty does now, as the
 *     issue asked: it starts acknowledged, unless an on-call policy is
 *     picked to page;
 *   - under On-Call Policy, while none is picked and nothing else names the
 *     state, a note says the incident starts acknowledged and pages no one;
 *   - the review always lists Initial State, though it is folded under More
 *     fields: "Acknowledged, as you are on it: the incident pages no one." or
 *     why it starts where incidents usually do - so nobody declares an
 *     incident believing someone was paged, or the other way round.
 *
 * Initial State is never prefilled with the acknowledged state. A prefilled
 * state is a state picked, and a state picked wins: the on-call policies
 * picked two steps later would then page nobody. Left empty, the server
 * decides with the policies the incident is declared with.
 *
 * Kept free of React so the page, the form and the tests read these exact
 * strings. Every sentence is wrapped in translationKey() so npm run
 * i18n:extract finds it.
 */

export const DECLARED_BY_HAND_START_SWITCH_TEST_ID: string =
  "incident-start-declared-by-hand-acknowledged-switch";

export interface IncidentDeclaredByHandStartSettingCopy {
  // The Project column the switch writes.
  column: typeof START_INCIDENTS_DECLARED_BY_HAND_ACKNOWLEDGED_COLUMN;
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  // The data-testid of the switch.
  dataTestId: string;
}

export const INCIDENT_DECLARED_BY_HAND_START_SETTING_COPY: IncidentDeclaredByHandStartSettingCopy =
  {
    column: START_INCIDENTS_DECLARED_BY_HAND_ACKNOWLEDGED_COLUMN,
    cardTitle: translationKey("Incidents Declared by Hand"),
    cardDescription: translationKey(
      "Choose whether an incident someone declares in OneUptime, Slack or Microsoft Teams starts acknowledged, as whoever declares it is already on it.",
    ),
    switchTitle: translationKey(
      "Start incidents declared by hand acknowledged",
    ),
    switchOnDescription: translationKey(
      "They start acknowledged and page no one, on-call rules included, unless whoever declares one picks an on-call policy to page.",
    ),
    switchOffDescription: translationKey(
      "They start in the created state and page their on-call policies, as every new incident does.",
    ),
    dataTestId: DECLARED_BY_HAND_START_SWITCH_TEST_ID,
  };

// Declare Incident's Initial State: what leaving it empty does, as it always has.
export const INITIAL_STATE_DESCRIPTION: string = translationKey(
  "Leave empty for the usual starting state. Pick a later state to record an incident that is already acknowledged or resolved. No one is paged for it.",
);

// The same, in a project that starts incidents declared by hand acknowledged.
export const INITIAL_STATE_DESCRIPTION_STARTS_ACKNOWLEDGED: string =
  translationKey(
    "Leave empty to start it acknowledged, as you are on it, unless you pick an on-call policy to page. Pick a state to start it there instead.",
  );

// What Initial State says under it, for where the project starts these.
export const getInitialStateDescription: (isSwitchOn: boolean) => string = (
  isSwitchOn: boolean,
): string => {
  return isSwitchOn
    ? INITIAL_STATE_DESCRIPTION_STARTS_ACKNOWLEDGED
    : INITIAL_STATE_DESCRIPTION;
};

/*
 * The review's Initial State, left empty, in a project that starts
 * incidents declared by hand acknowledged: it starts acknowledged, or - an
 * on-call policy is picked - where incidents usually start, so the policy
 * pages.
 */
export const STARTS_ACKNOWLEDGED_SUMMARY: string = translationKey(
  "Acknowledged, as you are on it: the incident pages no one.",
);

export const STARTS_WHERE_POLICIES_PAGE_SUMMARY: string = translationKey(
  "The usual starting state, so the on-call policies you picked are paged.",
);

// Under On-Call Policy, while none is picked and it will start acknowledged.
export const NO_POLICY_STARTS_ACKNOWLEDGED_NOTE: string = translationKey(
  "With none picked, the incident starts acknowledged, as you are on it, and pages no one.",
);

export const NO_POLICY_STARTS_ACKNOWLEDGED_NOTE_TEST_ID: string =
  "incident-create-starts-acknowledged-note";
