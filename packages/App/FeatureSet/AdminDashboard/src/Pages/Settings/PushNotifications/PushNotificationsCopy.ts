import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";

/*
 * What Settings > Push Notifications says, apart from the page so a test can
 * read it: the switch's test id, and what turning push off asks first.
 */

export const PUSH_NOTIFICATIONS_SWITCH_TEST_ID: string =
  "push-notifications-switch";

/*
 * Asked before push is turned off, since it stops pages to everyone whose
 * only way to be reached is a push device. Turning it back on asks nothing.
 */
export const TURN_OFF_PUSH_CONFIRMATION: ModelSwitchConfirmation = {
  title: "Turn off push notifications?",
  description:
    "Nothing will be pushed to phones or browsers, in any project, until you turn them back on, and no device can be registered. People whose only way to be reached is a push device will not be paged: add a custom channel, or ask them to add another notification method.",
  submitButtonText: "Turn Off Push Notifications",
  submitButtonType: ButtonStyleType.DANGER,
};

// What the switch says under its name, on and off.
export const getPushNotificationsSwitchDescription: (
  isOn: boolean,
) => string = (isOn: boolean): string => {
  return isOn
    ? "People can register their phones and browsers, and on-call pages and notifications are pushed to them."
    : "Nothing is pushed to phones or browsers, in any project, and no device can be registered. Reach people through a custom channel instead.";
};

// The confirmation for a move of the switch: only when it turns push off.
export const getPushNotificationsSwitchConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  return isTurningOn ? undefined : TURN_OFF_PUSH_CONFIRMATION;
};
