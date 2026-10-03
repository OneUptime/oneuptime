import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether an incident episode or a scheduled maintenance event shows on
 * status pages, in one place: the "Status Pages" card on its Settings page.
 *
 * Each used to be a settings card ("Manage settings for this episode
 * here.", "Manage your scheduled maintenance event settings here.") whose
 * Edit Settings dialog held one switch, "Visible on Status Page" - drawn as
 * a checkbox on the episode's. Now the card is the switch, and it saves the
 * moment it is flipped (StatusPageVisibilityCard, on the shared
 * ModelSwitchCard).
 *
 * Hiding one does more than take it off the page: the subscriber
 * notification jobs skip a hidden episode or event, so its subscribers hear
 * nothing about it either. The sentences under the switch say so.
 *
 * An incident's own "Visible on Status Page" is not here: it stays in the
 * incident's Incident Settings form, with the question of whether to tell
 * subscribers about an incident that was hidden when it was declared.
 *
 * Kept free of React so the cards and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export enum StatusPageVisibilityKind {
  IncidentEpisode = "IncidentEpisode",
  ScheduledMaintenance = "ScheduledMaintenance",
}

export interface StatusPageVisibilityKindCopy {
  // The line under the card's title: what the card is for.
  cardDescription: string;
  // Under the switch while it shows on status pages.
  switchOnDescription: string;
  // Under the switch while it is hidden from them.
  switchOffDescription: string;
}

export const StatusPageVisibilitySwitchCopy: {
  cardTitle: string;
  switchTitle: string;
} = {
  cardTitle: translationKey("Status Pages"),
  switchTitle: translationKey("Visible on Status Page"),
};

export const STATUS_PAGE_VISIBILITY_KIND_COPY: Record<
  StatusPageVisibilityKind,
  StatusPageVisibilityKindCopy
> = {
  [StatusPageVisibilityKind.IncidentEpisode]: {
    cardDescription: translationKey(
      "Show or hide this episode on your status pages.",
    ),
    switchOnDescription: translationKey(
      "This episode shows on your status pages.",
    ),
    switchOffDescription: translationKey(
      "This episode is hidden from your status pages, and their subscribers are not notified about it. Its incidents are not affected.",
    ),
  },
  [StatusPageVisibilityKind.ScheduledMaintenance]: {
    cardDescription: translationKey(
      "Show or hide this event on its status pages.",
    ),
    switchOnDescription: translationKey(
      "This event shows on its status pages.",
    ),
    switchOffDescription: translationKey(
      "This event is hidden from its status pages, and their subscribers are not notified about it.",
    ),
  },
};

export const getStatusPageVisibilitySwitchDescription: (data: {
  kind: StatusPageVisibilityKind;
  isOn: boolean;
}) => string = (data: {
  kind: StatusPageVisibilityKind;
  isOn: boolean;
}): string => {
  const copy: StatusPageVisibilityKindCopy =
    STATUS_PAGE_VISIBILITY_KIND_COPY[data.kind];

  return data.isOn ? copy.switchOnDescription : copy.switchOffDescription;
};

// The column the switch writes, on IncidentEpisode and ScheduledMaintenance.
export type StatusPageVisibilitySwitchColumn = "isVisibleOnStatusPage";

export const STATUS_PAGE_VISIBILITY_SWITCH_COLUMN: StatusPageVisibilitySwitchColumn =
  "isVisibleOnStatusPage";

// The data-testid of the "Visible on Status Page" switch.
export const STATUS_PAGE_VISIBILITY_SWITCH_TEST_ID: string =
  "status-page-visibility-switch";

export default StatusPageVisibilitySwitchCopy;
