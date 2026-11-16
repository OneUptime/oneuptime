import { JSONObject } from "../JSON";

/*
 * WHAT ADMIN DASHBOARD > SETTINGS > API KEY READS AND DOES (#7901).
 *
 * The server's master API key is stored hashed, so nothing reads it back:
 * not this page, not the API, not a master admin. The page reads whether
 * there is one - and which one it is (#8903): when it was made, by whom,
 * and how it ends - and makes one.
 *
 *   GET  /global-config/master-api-key   whether a key is set, whether it
 *                                        is on, when it was made, by whom
 *                                        and its hint. Never the key, nor
 *                                        its hash. A signed-in master
 *                                        admin.
 *   POST /global-config/master-api-key   makes a new key, in place of the
 *                                        one before, which stops working at
 *                                        once, and turns it on. The answer
 *                                        holds the key: the one time it is
 *                                        ever sent. A signed-in master
 *                                        admin, never the key itself, so a
 *                                        leaked key cannot replace itself.
 *
 * Server/Services/GlobalConfigService makes and reads it, and
 * Server/Utils/MasterApiKey holds how it is hashed and matched.
 */

export const MASTER_API_KEY_ROUTE: string = "/global-config/master-api-key";

export interface MasterApiKeyState {
  // The server has a master API key. Only its hash is kept.
  isSet: boolean;
  // Requests with it are accepted (GlobalConfig.isMasterApiKeyEnabled).
  isEnabled: boolean;
  /*
   * When the key was made, and who made it - their name, or their email
   * when they have none. Null for a key made before they were recorded
   * (one the HashMasterApiKey data migration hashed), and for a maker who
   * was since deleted.
   */
  createdAt: Date | null;
  createdByName: string | null;
  // Its last four characters: "ends in 2b34". Never enough to use it.
  hint: string | null;
}

// The answer to POST: the new key, as it is shown once.
export interface CreatedMasterApiKey extends MasterApiKeyState {
  masterApiKey: string;
}

export const toMasterApiKeyStateJSON: (
  state: MasterApiKeyState,
) => JSONObject = (state: MasterApiKeyState): JSONObject => {
  return {
    isSet: state.isSet,
    isEnabled: state.isEnabled,
    createdAt: state.createdAt ? state.createdAt.toISOString() : null,
    createdByName: state.createdByName,
    hint: state.hint,
  };
};

// A text field of the answer: its text, or null when it holds none.
const readText: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

// The answer's createdAt: an ISO 8601 time, or null.
const readDate: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = new Date(value);

  return isNaN(date.getTime()) ? null : date;
};

export const parseMasterApiKeyState: (
  value: unknown,
) => MasterApiKeyState | null = (value: unknown): MasterApiKeyState | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;

  if (
    typeof json["isSet"] !== "boolean" ||
    typeof json["isEnabled"] !== "boolean"
  ) {
    return null;
  }

  // Which key it is says nothing while none is set.
  const isSet: boolean = json["isSet"];

  return {
    isSet: isSet,
    isEnabled: json["isEnabled"],
    createdAt: isSet ? readDate(json["createdAt"]) : null,
    createdByName: isSet ? readText(json["createdByName"]) : null,
    hint: isSet ? readText(json["hint"]) : null,
  };
};

export const parseCreatedMasterApiKey: (
  value: unknown,
) => CreatedMasterApiKey | null = (
  value: unknown,
): CreatedMasterApiKey | null => {
  const state: MasterApiKeyState | null = parseMasterApiKeyState(value);
  const masterApiKey: unknown = state
    ? (value as JSONObject)["masterApiKey"]
    : undefined;

  if (!state || typeof masterApiKey !== "string" || !masterApiKey) {
    return null;
  }

  return { ...state, masterApiKey: masterApiKey };
};
