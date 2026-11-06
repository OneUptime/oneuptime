import ObjectID from "../ObjectID";

/*
 * THE KEY A CLOUD AI AGENT CONNECTS WITH: ONE ACCOUNT'S, AND NOTHING ELSE.
 *
 * A Cloud AI agent (the resource AI agent in an AWS account, an Azure
 * subscription or a Google Cloud project) used to register with one of the
 * project's telemetry ingestion keys, kept as a secret of its cloud. That key
 * also sends telemetry for the whole project and registers the AI agent of
 * any of its resources, so whoever could read the secret could do both.
 *
 * Now the setup command carries a key made for that one cloud account: the
 * account's "Let AI fix problems" makes it (POST
 * /resource-ai-access/agent-key, RESOURCE_AI_ACCESS_AGENT_KEY_PATH) and the
 * command puts it in the cloud's secret. It names its account - "ouca_<cloud account id>_<64 hex>" - and it
 * registers that account's agent and nothing else: no other account's agent,
 * no other resource's, and no telemetry anywhere (an ingestion route never
 * knows it). Only its SHA-256 is kept (CloudAccount.aiAgentKeys, which nobody
 * may read), and it is shown once, in the command.
 *
 * A key that has not connected yet is pending: the command may not have run.
 * The agent's key so far keeps working beside it, so opening the dialog never
 * disconnects anything. The first registration with a pending key makes it
 * the agent's key, and the key it replaces stops working. A pending key that
 * never connects stops working a day after it was made, and at most
 * CLOUD_AI_AGENT_MAX_PENDING_KEYS are kept (each opening of the dialog makes
 * one; two admins setting the agent up at once both get a key that works).
 *
 * Once an agent has connected with a key of its own, the project's ingestion
 * key no longer registers that account's agent (isOwnKeyRequired). Reset
 * agent revokes every key at once and keeps that rule: the agent stays
 * disconnected until its setup command runs again, with a new key. Removing
 * the account removes its keys with it.
 *
 * An agent set up before this keeps connecting with the ingestion key it was
 * given until its setup command runs again (Change on its AI agent page) or
 * it is reset.
 *
 * Shared by the server (the key route, registration, Reset agent), the
 * dashboard and the setup commands (which check a key before writing it into
 * a command). React-free and Node-free.
 */

export const CLOUD_AI_AGENT_KEY_PREFIX: string = "ouca";
export const CLOUD_AI_AGENT_KEY_SECRET_LENGTH: number = 64;

// ouca_ + a 36-character id + _ + 64 hex: 106 characters. Nothing longer is read.
export const CLOUD_AI_AGENT_KEY_MAX_LENGTH: number = 128;

// How long a key that has not connected yet keeps working.
export const CLOUD_AI_AGENT_PENDING_KEY_LIFETIME_MS: number =
  24 * 60 * 60 * 1000;

// How many keys that have not connected yet an account keeps, newest first.
export const CLOUD_AI_AGENT_MAX_PENDING_KEYS: number = 5;

export function buildCloudAiAgentKey(data: {
  cloudAccountId: string;
  secret: string;
}): string {
  return `${CLOUD_AI_AGENT_KEY_PREFIX}_${data.cloudAccountId.toLowerCase()}_${data.secret.toLowerCase()}`;
}

function isLowerHex(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);
    const isDigit: boolean = code >= 48 && code <= 57;
    const isLetter: boolean = code >= 97 && code <= 102;

    if (!isDigit && !isLetter) {
      return false;
    }
  }

  return value.length > 0;
}

/*
 * The account a key names and its secret, or null for anything that is not
 * a Cloud AI agent key. Never throws, and reads nothing past
 * CLOUD_AI_AGENT_KEY_MAX_LENGTH characters.
 */
export function parseCloudAiAgentKey(
  value: unknown,
): { cloudAccountId: string; secret: string } | null {
  if (typeof value !== "string") {
    return null;
  }

  if (value.length === 0 || value.length > CLOUD_AI_AGENT_KEY_MAX_LENGTH) {
    return null;
  }

  const key: string = value.trim();
  const parts: Array<string> = key.split("_");

  if (parts.length !== 3 || parts[0] !== CLOUD_AI_AGENT_KEY_PREFIX) {
    return null;
  }

  const cloudAccountId: string = parts[1]!;
  const secret: string = parts[2]!;

  if (
    !ObjectID.isValidUUID(cloudAccountId) ||
    cloudAccountId !== cloudAccountId.toLowerCase() ||
    secret.length !== CLOUD_AI_AGENT_KEY_SECRET_LENGTH ||
    !isLowerHex(secret)
  ) {
    return null;
  }

  return { cloudAccountId, secret };
}

export function isCloudAiAgentKey(value: unknown): boolean {
  return parseCloudAiAgentKey(value) !== null;
}

// One key, as the account keeps it: never the key itself.
export interface CloudAiAgentKeyRecord {
  // The key's SHA-256, hex.
  hash: string;
  // When it was made (ISO 8601).
  madeAt: string;
  // Who made it, when a person did.
  madeByUserId?: string | undefined;
  // When an agent first connected with it.
  firstUsedAt?: string | undefined;
}

// An account's keys (CloudAccount.aiAgentKeys).
export interface CloudAiAgentKeys {
  // The key the agent connects with: the last one an agent connected with.
  current: CloudAiAgentKeyRecord | null;
  // Made for a setup command that has not connected yet, newest first.
  pending: Array<CloudAiAgentKeyRecord>;
  /*
   * An agent connected with a key of its own, or the agent was reset: the
   * project's ingestion key no longer registers this account's agent.
   */
  isOwnKeyRequired: boolean;
  // When Reset agent revoked the keys, while no key has connected since.
  revokedAt?: string | undefined;
}

// Which of an account's keys a presented key is.
export type CloudAiAgentKeyMatch = "current" | "pending";

const SHA256_HEX_LENGTH: number = 64;

function readTime(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 64) {
    return null;
  }

  const time: number = Date.parse(value);

  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function readRecord(value: unknown): CloudAiAgentKeyRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const stored: Record<string, unknown> = value as Record<string, unknown>;
  const hash: unknown = stored["hash"];
  const madeAt: string | null = readTime(stored["madeAt"]);

  if (
    typeof hash !== "string" ||
    hash.length !== SHA256_HEX_LENGTH ||
    !isLowerHex(hash) ||
    !madeAt
  ) {
    return null;
  }

  const record: CloudAiAgentKeyRecord = { hash, madeAt };
  const madeByUserId: unknown = stored["madeByUserId"];
  const firstUsedAt: string | null = readTime(stored["firstUsedAt"]);

  if (typeof madeByUserId === "string" && ObjectID.isValidUUID(madeByUserId)) {
    record.madeByUserId = madeByUserId.toLowerCase();
  }

  if (firstUsedAt) {
    record.firstUsedAt = firstUsedAt;
  }

  return record;
}

/*
 * The keys an account keeps, as they are - or null when it never had one,
 * so its agent still registers with the project's ingestion key, as every
 * agent set up before keys of their own did. A stored value of the wrong
 * shape fails closed: its keys match nothing, and the ingestion key is not
 * taken for the account (isOwnKeyRequired). Never throws.
 */
export function readCloudAiAgentKeys(value: unknown): CloudAiAgentKeys | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return { current: null, pending: [], isOwnKeyRequired: true };
  }

  const stored: Record<string, unknown> = value as Record<string, unknown>;
  const current: CloudAiAgentKeyRecord | null = readRecord(stored["current"]);
  const pending: Array<CloudAiAgentKeyRecord> = [];

  if (Array.isArray(stored["pending"])) {
    for (const item of stored["pending"]) {
      const record: CloudAiAgentKeyRecord | null = readRecord(item);

      if (record) {
        pending.push(record);
      }

      if (pending.length >= CLOUD_AI_AGENT_MAX_PENDING_KEYS) {
        break;
      }
    }
  }

  const revokedAt: string | null = readTime(stored["revokedAt"]);
  const keys: CloudAiAgentKeys = {
    current,
    pending,
    /*
     * Not required only while it says so plainly and no key ever connected
     * nor was revoked: anything else requires the account's own key.
     */
    isOwnKeyRequired:
      stored["isOwnKeyRequired"] !== false ||
      current !== null ||
      revokedAt !== null,
  };

  if (revokedAt) {
    keys.revokedAt = revokedAt;
  }

  return keys;
}

// Whether a pending key still works at `now`.
export function isPendingCloudAiAgentKeyUsable(data: {
  record: CloudAiAgentKeyRecord;
  now: Date;
}): boolean {
  const madeAt: number = Date.parse(data.record.madeAt);

  return (
    Number.isFinite(madeAt) &&
    madeAt <= data.now.getTime() + 60 * 1000 &&
    data.now.getTime() - madeAt < CLOUD_AI_AGENT_PENDING_KEY_LIFETIME_MS
  );
}

/*
 * The hashes a presented key may match at `now`: the agent's key, and the
 * pending keys that still work.
 */
export function getLiveCloudAiAgentKeyHashes(data: {
  keys: CloudAiAgentKeys | null;
  now: Date;
}): Array<{ hash: string; match: CloudAiAgentKeyMatch }> {
  if (!data.keys) {
    return [];
  }

  const hashes: Array<{ hash: string; match: CloudAiAgentKeyMatch }> = [];

  if (data.keys.current) {
    hashes.push({ hash: data.keys.current.hash, match: "current" });
  }

  for (const record of data.keys.pending) {
    if (isPendingCloudAiAgentKeyUsable({ record, now: data.now })) {
      hashes.push({ hash: record.hash, match: "pending" });
    }
  }

  return hashes;
}

/*
 * The keys once a new one is made: it goes first among the pending ones,
 * the pending keys that no longer work go, and at most
 * CLOUD_AI_AGENT_MAX_PENDING_KEYS stay. The agent's own key is untouched.
 */
export function addCloudAiAgentKey(data: {
  keys: CloudAiAgentKeys | null;
  record: CloudAiAgentKeyRecord;
  now: Date;
}): CloudAiAgentKeys {
  const keys: CloudAiAgentKeys = data.keys || {
    current: null,
    pending: [],
    isOwnKeyRequired: false,
  };

  const next: CloudAiAgentKeys = {
    current: keys.current,
    pending: [
      data.record,
      ...keys.pending.filter((record: CloudAiAgentKeyRecord): boolean => {
        return (
          record.hash !== data.record.hash &&
          isPendingCloudAiAgentKeyUsable({ record, now: data.now })
        );
      }),
    ].slice(0, CLOUD_AI_AGENT_MAX_PENDING_KEYS),
    isOwnKeyRequired: keys.isOwnKeyRequired,
  };

  if (keys.revokedAt) {
    next.revokedAt = keys.revokedAt;
  }

  return next;
}

/*
 * The keys once an agent connected with the pending key of this hash: it is
 * the agent's key now, the key it replaces stops working, the project's
 * ingestion key no longer registers the account's agent, and the other
 * pending keys that still work keep working (another admin's command may be
 * on its way). Null when no pending key that still works has this hash.
 */
export function useCloudAiAgentKey(data: {
  keys: CloudAiAgentKeys | null;
  hash: string;
  now: Date;
}): CloudAiAgentKeys | null {
  if (!data.keys) {
    return null;
  }

  const used: CloudAiAgentKeyRecord | undefined = data.keys.pending.find(
    (record: CloudAiAgentKeyRecord): boolean => {
      return (
        record.hash === data.hash &&
        isPendingCloudAiAgentKeyUsable({ record, now: data.now })
      );
    },
  );

  if (!used) {
    return null;
  }

  return {
    current: { ...used, firstUsedAt: data.now.toISOString() },
    pending: data.keys.pending.filter(
      (record: CloudAiAgentKeyRecord): boolean => {
        return (
          record.hash !== data.hash &&
          isPendingCloudAiAgentKeyUsable({ record, now: data.now })
        );
      },
    ),
    isOwnKeyRequired: true,
  };
}

/*
 * Reset agent: every key stops working at once, and the project's ingestion
 * key never registers the account's agent again. A new key connects it.
 */
export function revokeCloudAiAgentKeys(data: { now: Date }): CloudAiAgentKeys {
  return {
    current: null,
    pending: [],
    isOwnKeyRequired: true,
    revokedAt: data.now.toISOString(),
  };
}

/*
 * What a registration with one of the account's keys did to them
 * (CloudAccountService.useAiAgentKey): whether the key may connect the
 * agent, whether it became the agent's key just now, whether that replaced
 * an earlier key of the agent's, and who made it.
 */
export interface CloudAiAgentKeyTaken {
  isUsable: boolean;
  isNewKey: boolean;
  replacedAgentKey: boolean;
  madeByUserId?: string | undefined;
}

// Whether the project's ingestion key may still register the account's agent.
export function isOwnCloudAiAgentKeyRequired(
  keys: CloudAiAgentKeys | null,
): boolean {
  return Boolean(keys && keys.isOwnKeyRequired);
}

/*
 * What the agent's key route answers (POST /resource-ai-access/agent-key):
 * the key, shown this once, and until when it works if no agent connects
 * with it.
 */
export interface CloudAiAgentKeyResponse {
  agentKey: string;
  // ISO 8601.
  worksUntilConnectedBy: string;
}

/*
 * Why a registration with a Cloud AI agent key was refused, in words for
 * the agent's log (and so for whoever reads it in the cloud). Never names
 * the key.
 */
export const CLOUD_AI_AGENT_KEY_REFUSED_MESSAGE: string =
  "This Cloud AI agent key is not the cloud account's: it was replaced by a newer one, revoked by Reset agent, never connected within a day of being made, or its account was removed. Run the agent's setup command again: Change on the account's AI agent page in OneUptime shows it.";

export const CLOUD_AI_AGENT_INGESTION_KEY_REFUSED_MESSAGE: string =
  "This cloud account's Cloud AI agent connects with a key of its own, so the project's telemetry ingestion key no longer connects it. Run the agent's setup command again: Change on the account's AI agent page in OneUptime shows it, with its key.";
