import { JSONObject } from "../JSON";

/*
 * WHAT ADMIN DASHBOARD > SETTINGS > API KEY READS AND DOES (#7901).
 *
 * The server's master API key is stored hashed, so nothing reads it back:
 * not this page, not the API, not a master admin. The page reads whether
 * there is one, and makes one.
 *
 *   GET  /global-config/master-api-key   whether a key is set, and whether
 *                                        it is on. Never the key, nor its
 *                                        hash. A signed-in master admin.
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
  };
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

  return {
    isSet: json["isSet"],
    isEnabled: json["isEnabled"],
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
