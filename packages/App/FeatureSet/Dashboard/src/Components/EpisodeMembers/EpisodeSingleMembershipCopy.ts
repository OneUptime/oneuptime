import {
  ALERT_SINGLE_MEMBERSHIP_COLUMN,
  EpisodeSingleMembershipColumn,
  INCIDENT_SINGLE_MEMBERSHIP_COLUMN,
} from "Common/Types/Episode/EpisodeSingleMembership";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether an incident can be in only one episode, on Incidents -> Settings
 * -> Episodes, and an alert, on Alerts -> Settings -> Episodes
 * (Common/Types/Episode/EpisodeSingleMembership): one switch each, off by
 * default, that saves the moment it is flipped (EpisodeSingleMembershipCard,
 * on the shared ModelSwitchCard). Each stores a Project column that needs a
 * project owner or admin; for anyone else the switch is locked and says so.
 *
 * No dialog either way: turning it on takes nothing out of an episode - the
 * note under the switch says so - and turning it off only lets an incident
 * join several episodes again.
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export interface EpisodeSingleMembershipCopy {
  // The Project column the switch writes.
  column: EpisodeSingleMembershipColumn;
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  // Under the switch, whichever way it is set.
  note: string;
  // The data-testid of the switch.
  dataTestId: string;
}

export const INCIDENT_SINGLE_EPISODE_SWITCH_TEST_ID: string =
  "incident-single-episode-switch";

export const ALERT_SINGLE_EPISODE_SWITCH_TEST_ID: string =
  "alert-single-episode-switch";

export const INCIDENT_EPISODE_SETTINGS_COPY: EpisodeSingleMembershipCopy = {
  column: INCIDENT_SINGLE_MEMBERSHIP_COLUMN,
  cardTitle: translationKey("Episode Membership"),
  cardDescription: translationKey(
    "Choose whether an incident can be in more than one episode.",
  ),
  switchTitle: translationKey("An incident can be in only one episode"),
  switchOnDescription: translationKey(
    "An incident that is in an episode can't be added to another one. To move it, remove it from its episode first.",
  ),
  switchOffDescription: translationKey(
    "An incident can be in several episodes at once.",
  ),
  note: translationKey(
    "Turning this on takes no incident out of an episode: incidents already in several stay in them.",
  ),
  dataTestId: INCIDENT_SINGLE_EPISODE_SWITCH_TEST_ID,
};

export const ALERT_EPISODE_SETTINGS_COPY: EpisodeSingleMembershipCopy = {
  column: ALERT_SINGLE_MEMBERSHIP_COLUMN,
  cardTitle: translationKey("Episode Membership"),
  cardDescription: translationKey(
    "Choose whether an alert can be in more than one episode.",
  ),
  switchTitle: translationKey("An alert can be in only one episode"),
  switchOnDescription: translationKey(
    "An alert that is in an episode can't be added to another one. To move it, remove it from its episode first.",
  ),
  switchOffDescription: translationKey(
    "An alert can be in several episodes at once.",
  ),
  note: translationKey(
    "Turning this on takes no alert out of an episode: alerts already in several stay in them.",
  ),
  dataTestId: ALERT_SINGLE_EPISODE_SWITCH_TEST_ID,
};

/*
 * What the add dialogs say while the project allows one in only one episode:
 * an episode's Add Incidents / Add Alerts (AddEpisodeMembersModal), and the
 * lists' Add to Existing Episode and Add to New Episode. The sentences name
 * the rule whole, per kind, so each language words it once.
 */
export interface EpisodeSingleMembershipDialogCopy {
  /*
   * Under an episode's add list: why the ones in another episode are not
   * listed, or - found by a search - cannot be picked.
   */
  listRule: string;
  // The hover of a row that is in another episode, which it names.
  lockedNoteTooltip: string;
  // The same, for an episode the person cannot see.
  lockedNoteTooltipUnnamed: string;
  /*
   * At the limit of what the list shows before a search, which is only
   * the ones in no episode.
   */
  shownOutsideEpisodes: string;
  // Nothing left to add: every other one is in another episode.
  emptyAllInOtherEpisodes: string;
  /*
   * Add to Existing Episode, above its button: how many of the selected
   * ones are in another episode and so are not added.
   */
  pickNoteInAnotherEpisode: PluralTemplate;
  /*
   * Add to New Episode: how many of the selected ones are in an episode and
   * so are left out of the new one.
   */
  newEpisodeLeftOut: PluralTemplate;
  /*
   * Either list action, when every selected one is in an episode already:
   * there is nothing it could add.
   */
  nothingToAdd: PluralTemplate;
}

export const INCIDENT_SINGLE_MEMBERSHIP_DIALOG_COPY: EpisodeSingleMembershipDialogCopy =
  {
    listRule: translationKey(
      "An incident can be in only one episode in this project, so incidents that are in another episode can't be added.",
    ),
    lockedNoteTooltip: translationKey(
      "An incident can be in only one episode in this project. To add it here, remove it from episode {{number}} first.",
    ),
    lockedNoteTooltipUnnamed: translationKey(
      "An incident can be in only one episode in this project. To add it here, remove it from that episode first.",
    ),
    shownOutsideEpisodes: translationKey(
      "Showing the {{count}} most recent incidents that are in no episode. Search to find others.",
    ),
    emptyAllInOtherEpisodes: translationKey(
      "Every other incident you can see is in another episode, and an incident can be in only one episode in this project.",
    ),
    pickNoteInAnotherEpisode: {
      one: "{{count}} of them is already in another episode, so it is not added: an incident can be in only one episode in this project.",
      other:
        "{{count}} of them are already in another episode, so they are not added: an incident can be in only one episode in this project.",
    },
    newEpisodeLeftOut: {
      one: "{{count}} of them is already in an episode, so it is left out: an incident can be in only one episode in this project.",
      other:
        "{{count}} of them are already in an episode, so they are left out: an incident can be in only one episode in this project.",
    },
    nothingToAdd: {
      one: "The selected incident is already in an episode, and an incident can be in only one episode in this project. To move it, remove it from its episode first.",
      other:
        "All {{count}} selected incidents are already in an episode, and an incident can be in only one episode in this project. To move them, remove them from their episodes first.",
    },
  };

export const ALERT_SINGLE_MEMBERSHIP_DIALOG_COPY: EpisodeSingleMembershipDialogCopy =
  {
    listRule: translationKey(
      "An alert can be in only one episode in this project, so alerts that are in another episode can't be added.",
    ),
    lockedNoteTooltip: translationKey(
      "An alert can be in only one episode in this project. To add it here, remove it from episode {{number}} first.",
    ),
    lockedNoteTooltipUnnamed: translationKey(
      "An alert can be in only one episode in this project. To add it here, remove it from that episode first.",
    ),
    shownOutsideEpisodes: translationKey(
      "Showing the {{count}} most recent alerts that are in no episode. Search to find others.",
    ),
    emptyAllInOtherEpisodes: translationKey(
      "Every other alert you can see is in another episode, and an alert can be in only one episode in this project.",
    ),
    pickNoteInAnotherEpisode: {
      one: "{{count}} of them is already in another episode, so it is not added: an alert can be in only one episode in this project.",
      other:
        "{{count}} of them are already in another episode, so they are not added: an alert can be in only one episode in this project.",
    },
    newEpisodeLeftOut: {
      one: "{{count}} of them is already in an episode, so it is left out: an alert can be in only one episode in this project.",
      other:
        "{{count}} of them are already in an episode, so they are left out: an alert can be in only one episode in this project.",
    },
    nothingToAdd: {
      one: "The selected alert is already in an episode, and an alert can be in only one episode in this project. To move it, remove it from its episode first.",
      other:
        "All {{count}} selected alerts are already in an episode, and an alert can be in only one episode in this project. To move them, remove them from their episodes first.",
    },
  };

/*
 * A row of an episode's add list that is in another episode, and so cannot
 * be picked while the project allows one in only one episode: its note
 * names that episode when the person can see it.
 */
export const LOCKED_NOTE: string = translationKey(
  "Already in episode {{number}}",
);

export const LOCKED_NOTE_UNNAMED: string = translationKey(
  "Already in another episode",
);
