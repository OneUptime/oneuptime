import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * A PROJECT'S API KEY, SHOWN ONCE (#8902).
 *
 * A project's API keys are stored as their hash (Server/Utils/APIKey/
 * HashedApiKey), so nothing reads a key back: not its page, not the API.
 * The key is answered once, when it is made:
 *
 *   POST /api-key                     creates a key. The answer is the new
 *                                     record, holding the key in `apiKey`
 *                                     (as BaseAPI answers every create) -
 *                                     the one time it is ever sent.
 *   POST /api-key/:id/reset-key       makes the key a new one, in place of
 *                                     the one before, which stops working.
 *                                     The answer holds the new key and its
 *                                     hint. Asks what a change of the key
 *                                     asks: Project Owner, Project Admin or
 *                                     Edit API Key.
 *
 * Neither answer may be kept by a cache (Cache-Control: no-store). What a
 * key's pages show in its place is its hint, its last four characters:
 * "ends in 2b34".
 *
 * Server/API/ApiKeyAPI answers both, Server/Services/ApiKeyService makes the
 * keys, and the Dashboard's API key pages show them.
 */

export const RESET_API_KEY_PATH: string = "reset-key";

// POST /api-key/:id/reset-key, for the key with this id.
export const getResetApiKeyRoute: (apiKeyId: ObjectID | string) => string = (
  apiKeyId: ObjectID | string,
): string => {
  return `/api-key/${apiKeyId.toString()}/${RESET_API_KEY_PATH}`;
};

// What a reset answers: the new key, shown once, and the hint kept of it.
export interface ResetApiKeyAnswer {
  apiKey: string;
  apiKeyHint: string;
}

export const toResetApiKeyAnswerJSON: (
  answer: ResetApiKeyAnswer,
) => JSONObject = (answer: ResetApiKeyAnswer): JSONObject => {
  return {
    apiKey: answer.apiKey,
    apiKeyHint: answer.apiKeyHint,
  };
};

export const parseResetApiKeyAnswer: (
  value: unknown,
) => ResetApiKeyAnswer | null = (value: unknown): ResetApiKeyAnswer | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;

  if (
    typeof json["apiKey"] !== "string" ||
    !json["apiKey"] ||
    typeof json["apiKeyHint"] !== "string"
  ) {
    return null;
  }

  return {
    apiKey: json["apiKey"],
    apiKeyHint: json["apiKeyHint"],
  };
};

/*
 * The key a create's answer holds, as the Dashboard reads it off the new
 * record: whatever BaseModel.fromJSON made of it - a HashedString holding
 * the key, its JSON ({ _type, value }) or its text. Null when the answer
 * held none.
 */
export const getKeyShownOnCreate: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const wrapped: unknown = (value as JSONObject)["value"];

  if (typeof wrapped === "string") {
    return wrapped.trim() || null;
  }

  const text: string = String(value);

  return text && text !== "[object Object]" ? text.trim() || null : null;
};
