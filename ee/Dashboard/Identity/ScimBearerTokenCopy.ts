import { getKeyShownOnCreate } from "Common/Types/ApiKey/ApiKeyShownOnce";
import { translationKey } from "Common/Types/Translator";

/*
 * THE WORDS OF A SCIM BEARER TOKEN, SHOWN ONCE (#9012).
 *
 * A SCIM connection's bearer token is what the identity provider adds people
 * to teams with, and it is kept only as its hash: no page can show it again.
 * So adding a connection and Reset Bearer Token show the token once, in a
 * dialog that says so (ShownOnceSecretModal), and the SCIM URLs dialog says
 * where a lost token comes from: Reset Bearer Token.
 *
 * Kept free of React so the pages and their tests read these exact strings.
 * Each is a key of the Dashboard's locales, in every language.
 */

export const SCIM_BEARER_TOKEN_SHOWN_ONCE_TEST_ID: string =
  "scim-bearer-token-shown-once";
export const SCIM_BEARER_TOKEN_SHOWN_ONCE_VALUE_TEST_ID: string =
  "scim-bearer-token-shown-once-value";
export const SCIM_BEARER_TOKEN_NOT_SHOWN_AGAIN_TEST_ID: string =
  "scim-bearer-token-not-shown-again";

export const ScimBearerTokenCopy: {
  shownOnceTitle: string;
  shownOnceDescription: string;
  done: string;
  notShownAgain: string;
} = {
  shownOnceTitle: translationKey("Copy Your Bearer Token"),
  shownOnceDescription: translationKey(
    "Paste it into your identity provider now, or keep it somewhere safe. It is shown only this once: OneUptime keeps only a hash of it.",
  ),
  done: translationKey("Done"),
  notShownAgain: translationKey(
    "The bearer token is shown only once, when the connection is added or its token is reset. If you no longer have it, use Reset Bearer Token to make a new one.",
  ),
};

/*
 * The token a create's answer holds, the one time it is sent: OneUptime made
 * it for the new connection. Null when the answer held none.
 */
export const getBearerTokenShownOnCreate: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return getKeyShownOnCreate(value);
};
