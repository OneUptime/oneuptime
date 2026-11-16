import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF ADMIN DASHBOARD > SETTINGS > API KEY (#7901).
 *
 * The master API key is stored hashed, so the page cannot show it: it says
 * whether there is one, makes one (Create Key, or Reset Key in place of the
 * one there is) and shows the new key once, in a dialog that says so. The
 * switch beside it turns the key off and on.
 *
 * Kept free of React so the page and its tests read these exact strings.
 * Each is a key of the Admin Dashboard's locales, in every language.
 */

export const MASTER_API_KEY_CARD_TEST_ID: string = "master-api-key-card";
export const MASTER_API_KEY_STATE_TEST_ID: string = "master-api-key-state";
export const MASTER_API_KEY_SWITCH_TEST_ID: string = "master-api-key-enabled";
export const MASTER_API_KEY_SHOWN_ONCE_TEST_ID: string =
  "master-api-key-shown-once";
export const MASTER_API_KEY_VALUE_TEST_ID: string = "master-api-key-value";

// The dialog Reset Key asks first, in English; the dialog translates it.
export interface MasterApiKeyResetConfirmation {
  title: string;
  description: string;
  submitButtonText: string;
  submitButtonType: ButtonStyleType;
}

export const MasterApiKeyCopy: {
  cardTitle: string;
  cardDescription: string;
  noKey: string;
  keySet: string;
  createButton: string;
  resetButton: string;
  switchTitle: string;
  switchOn: string;
  switchOff: string;
  resetConfirmation: MasterApiKeyResetConfirmation;
  shownOnceTitle: string;
  shownOnceDescription: string;
  done: string;
  notAnswered: string;
} = {
  cardTitle: translationKey("Master API Key"),
  cardDescription: translationKey(
    "Has root access to every project on this server.",
  ),
  noKey: translationKey(
    "No key yet. Create one for scripts and tools that call the API as a master admin.",
  ),
  keySet: translationKey(
    "A key is set. It was shown once, when it was made: only its hash is kept, so it can't be shown again. If you lost it, reset it.",
  ),
  createButton: translationKey("Create Key"),
  resetButton: translationKey("Reset Key"),
  switchTitle: translationKey("Enabled"),
  switchOn: translationKey("Requests with the key are accepted."),
  switchOff: translationKey(
    "While it is off, every request with the key fails.",
  ),
  // Asked before a key in use is replaced: the reset cannot be undone.
  resetConfirmation: {
    title: translationKey("Reset Master API Key?"),
    description: translationKey(
      "The current key stops working at once, for every script and tool that uses it. The new key is shown once.",
    ),
    submitButtonText: translationKey("Reset Key"),
    submitButtonType: ButtonStyleType.DANGER,
  },
  shownOnceTitle: translationKey("Copy Your Master API Key"),
  shownOnceDescription: translationKey(
    "Copy it now and keep it somewhere safe, such as a secret manager. It is shown only this once: OneUptime keeps only a hash of it.",
  ),
  done: translationKey("Done"),
  notAnswered: translationKey(
    "The server did not answer with the master API key. Try again.",
  ),
};

// What the switch says under its name, on and off.
export const getMasterApiKeySwitchDescription: (isOn: boolean) => string = (
  isOn: boolean,
): string => {
  return isOn ? MasterApiKeyCopy.switchOn : MasterApiKeyCopy.switchOff;
};
