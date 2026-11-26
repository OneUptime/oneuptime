import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { isSecurityBlocklistFeedSecretShape } from "Common/Types/SecurityBlocklist/SecurityBlocklistFeed";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * What a feed's page asks besides its CRUD (#10345): a new secret, answered
 * once (POST /security-blocklist-feed/:id/rotate-secret), and the end of
 * every secret (revoke-secret) - Common/Server/API/SecurityBlocklistFeedAPI.
 *
 * And the one hand-off of a secret within the Dashboard: the create's
 * answer holds a new feed's secret, which the list hands to the feed's page
 * it opens (rememberSecretForFeed), and the page takes it once
 * (takeSecretForFeed). Held in this module's memory, never in the address
 * or the browser's storage, so a reload or another tab never sees it.
 */

export function getRotateSecretPath(feedId: ObjectID | string): string {
  return `/security-blocklist-feed/${feedId.toString()}/rotate-secret`;
}

export function getRevokeSecretPath(feedId: ObjectID | string): string {
  return `/security-blocklist-feed/${feedId.toString()}/revoke-secret`;
}

// A new secret: the secret itself, and what the feed keeps of it.
export interface RotatedFeedSecret {
  secret: string;
  secretHint: string;
  previousSecretExpiresAt: Date | null;
}

async function post(path: string): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(path),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

export function readRotatedFeedSecret(data: JSONObject): RotatedFeedSecret {
  const expiresAt: unknown = data["previousSecretExpiresAt"];

  return {
    secret: typeof data["secret"] === "string" ? data["secret"] : "",
    secretHint:
      typeof data["secretHint"] === "string" ? data["secretHint"] : "",
    previousSecretExpiresAt:
      typeof expiresAt === "string" && expiresAt ? new Date(expiresAt) : null,
  };
}

export async function rotateFeedSecret(
  feedId: ObjectID,
): Promise<RotatedFeedSecret> {
  return readRotatedFeedSecret(await post(getRotateSecretPath(feedId)));
}

export async function revokeFeedSecret(feedId: ObjectID): Promise<void> {
  await post(getRevokeSecretPath(feedId));
}

// ---------- A new feed's secret, from its create to its page ----------

const secretsJustMade: Map<string, string> = new Map();

// The create's answer held this feed's secret: its page shows it once.
export function rememberSecretForFeed(
  feedId: ObjectID | string,
  secret: string,
): void {
  if (secret) {
    secretsJustMade.set(feedId.toString(), secret);
  }
}

// The secret the feed's create answered, once: asked again, there is none.
export function takeSecretForFeed(feedId: ObjectID | string): string | null {
  const secret: string | undefined = secretsJustMade.get(feedId.toString());
  secretsJustMade.delete(feedId.toString());
  return secret || null;
}

// The secret a create's answer holds, as BaseAPI answers it: a string, or a HashedString's value.
export function getSecretShownOnCreate(value: unknown): string | null {
  const text: string =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "value" in value
        ? String((value as { value: unknown }).value || "")
        : value
          ? String(value)
          : "";

  return isSecurityBlocklistFeedSecretShape(text) ? text : null;
}
