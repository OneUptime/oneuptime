import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF A PROJECT'S API KEY, SHOWN ONCE (#8902).
 *
 * A project's API keys are stored as their hash, so no page can show a key
 * again: Create API Key and Reset API Key show the new key once, in a
 * dialog that says so, and the key's pages say how it ends in its place
 * (#8903), so a person can tell it from the project's other keys and match
 * it against the key they hold.
 *
 * Kept free of React so the pages and their tests read these exact
 * strings. Each is a key of the Dashboard's locales, in every language.
 */

export const API_KEY_SHOWN_ONCE_TEST_ID: string = "api-key-shown-once";
export const API_KEY_SHOWN_ONCE_VALUE_TEST_ID: string =
  "api-key-shown-once-value";
export const API_KEY_HINT_TEST_ID: string = "api-key-hint";
export const RESET_API_KEY_CARD_TEST_ID: string = "reset-api-key-card";

// The dialog Reset API Key asks first, in English; the dialog translates it.
export interface ResetApiKeyConfirmation {
  title: string;
  description: string;
  submitButtonText: string;
  submitButtonType: ButtonStyleType;
}

export const ApiKeyShownOnceCopy: {
  shownOnceTitle: string;
  shownOnceDescription: string;
  done: string;
  endsIn: string;
  keyFieldDescription: string;
  resetCardTitle: string;
  resetCardDescription: string;
  resetConfirmation: ResetApiKeyConfirmation;
  notAnswered: string;
} = {
  shownOnceTitle: translationKey("Copy Your API Key"),
  shownOnceDescription: translationKey(
    "Copy it now and keep it somewhere safe, such as a secret manager. It is shown only this once: OneUptime keeps only a hash of it.",
  ),
  done: translationKey("Done"),
  // In place of the key, which nothing can show again: its last four characters.
  endsIn: translationKey("Ends in {{hint}}"),
  keyFieldDescription: translationKey(
    "Shown only once, when it was made. Reset it to get a new one.",
  ),
  resetCardTitle: translationKey("Reset API Key"),
  resetCardDescription: translationKey(
    "Makes a new key and shows it once. The current key stops working within a minute.",
  ),
  // Asked before a key in use is replaced: the reset cannot be undone.
  resetConfirmation: {
    title: translationKey("Reset API Key?"),
    description: translationKey(
      "The current key stops working within a minute, for every script and tool that uses it. The new key is shown once.",
    ),
    submitButtonText: translationKey("Reset Key"),
    submitButtonType: ButtonStyleType.DANGER,
  },
  notAnswered: translationKey(
    "The server did not answer with the new API key. Try again.",
  ),
};
