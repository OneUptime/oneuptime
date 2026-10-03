import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether an alert is private, in one place: the "Who can see this alert"
 * card on the alert's Settings page.
 *
 * It used to be an "Alert Settings" card ("Manage settings for this alert
 * here.") whose Edit Settings dialog held one switch, "Private Alert". Now
 * the card is the switch, and it saves the moment it is flipped
 * (AlertPrivacyCard, on the shared ModelSwitchCard).
 *
 * Making an alert private asks first. A private alert is hidden from
 * everyone but its owners, project admins and project owners - so the
 * person flipping it can lose access to it the moment it saves, and could
 * not flip it back. Making it visible again saves at once.
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export const AlertPrivacySwitchCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  // Under the switch while the alert is private: who keeps access.
  switchOnDescription: string;
  // Under the switch while it is not.
  switchOffDescription: string;
  // The dialog before an alert is made private.
  makePrivateConfirmTitle: string;
  makePrivateConfirmDescription: string;
  makePrivateConfirmButton: string;
} = {
  cardTitle: translationKey("Who can see this alert"),
  cardDescription: translationKey("Keep this alert to the people who own it."),
  switchTitle: translationKey("Private Alert"),
  switchOnDescription: translationKey(
    "Only its owners (its owner users and the members of its owner teams), project admins and project owners can see this alert.",
  ),
  switchOffDescription: translationKey(
    "Everyone in the project who can see alerts can see this alert.",
  ),
  makePrivateConfirmTitle: translationKey("Make this alert private?"),
  makePrivateConfirmDescription: translationKey(
    "Only its owners (its owner users and the members of its owner teams), project admins and project owners will be able to see it. If you are none of these, you will lose access to it too.",
  ),
  makePrivateConfirmButton: translationKey("Make private"),
};

// The column the switch writes.
export type AlertPrivacySwitchColumn = "isPrivate";

export const ALERT_PRIVACY_SWITCH_COLUMN: AlertPrivacySwitchColumn =
  "isPrivate";

// The data-testid of the "Private Alert" switch.
export const ALERT_PRIVACY_SWITCH_TEST_ID: string = "alert-privacy-switch";

export default AlertPrivacySwitchCopy;
