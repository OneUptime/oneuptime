import { JSONObject } from "../../../Types/JSON";
import { LlmConnectionKind } from "../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmChatTurn,
  LlmConnectionPullState,
  LlmUsageRecord,
} from "../../../Types/LlmObservability/LlmConnectionRecords";
import { LlmConnectionTestResult } from "../../../Types/LlmObservability/LlmConnectionTest";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";

/*
 * THE CONTRACT EVERY AI / LLM CONNECTION'S CONNECTOR KEEPS.
 *
 * A connector is stateless: every call receives the decrypted settings and
 * opens its own requests, so one instance serves every connection of every
 * project. The read loop, the "Test connection" route and the save-time
 * validation only ever talk to these interfaces; a provider is a client, a
 * mapping to OneUptime's records and one class implementing one of them.
 */

/*
 * Decrypted, server-only settings of one connection: `config` holds the
 * catalog's non-secret keys, `secrets` its secret keys. Never serialize this
 * into a response or a log line.
 */
export interface LlmConnectionSettings {
  provider: LlmConnectionProvider;
  config: JSONObject;
  secrets: JSONObject;
}

/*
 * The HTTP transport every client sends through: the SSRF-guarded
 * DataSourceHttpFetch in production, a fake provider API in tests.
 */
export type LlmConnectorTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

export interface LlmConnectorCallOptions {
  transport: LlmConnectorTransport;
  // Test seam for "now"; Date.now() when absent.
  now?: (() => Date) | undefined;
  requestTimeoutInMs?: number | undefined;
}

/*
 * The days a usage read covers, as UTC day starts: [startDay, endDay). The
 * read returns one record per day and series that has usage; a day with no
 * record had none.
 */
export interface LlmUsageWindow {
  startDay: Date;
  endDay: Date;
}

export interface LlmUsageFetchResult {
  records: Array<LlmUsageRecord>;
  requestCount: number;
  // Things the person should know that did not stop the read.
  warnings: Array<string>;
}

export interface LlmChatFetchOptions extends LlmConnectorCallOptions {
  // Where the last read got to (resume point).
  state: LlmConnectionPullState;
  // The first read looks back this far when there is no cursor.
  backfillStart: Date;
  // Read nothing newer than this (the provider's own delay).
  windowEnd: Date;
  // Bounds on one read; it stops (complete=false) when one is reached.
  maxRequests: number;
  maxDurationMs: number;
}

export interface LlmChatFetchResult {
  turns: Array<LlmChatTurn>;
  // Chats the tool reports as deleted (their content is gone there).
  deletedConversationIds: Array<string>;
  // False when a bound stopped the read before the window was done.
  complete: boolean;
  // Where the next read resumes.
  nextState: LlmConnectionPullState;
  requestCount: number;
  warnings: Array<string>;
}

export interface LlmConnectorBase {
  provider: LlmConnectionProvider;
  kind: LlmConnectionKind;
  /*
   * Shape checks the catalog's required flags cannot express (a GUID, a
   * Region, a key's prefix, a service account key's JSON). Throws a
   * BadDataException the person filling the form can act on.
   */
  validateSettings(settings: LlmConnectionSettings): void;
  /*
   * A small real read: is the credential accepted, may it read what the
   * connection needs, and what would a read bring in. Never throws:
   * failures are a result with status "fail".
   */
  testConnection(
    settings: LlmConnectionSettings,
    options: LlmConnectorCallOptions,
  ): Promise<LlmConnectionTestResult>;
}

export interface LlmProviderAccountConnector extends LlmConnectorBase {
  kind: LlmConnectionKind.ProviderAccount;
  // The usage of every day in the window. Throws LlmProviderError.
  fetchUsage(
    settings: LlmConnectionSettings,
    window: LlmUsageWindow,
    options: LlmConnectorCallOptions,
  ): Promise<LlmUsageFetchResult>;
}

export interface LlmCompanyToolConnector extends LlmConnectorBase {
  kind: LlmConnectionKind.CompanyTool;
  // The chat turns since the cursor. Throws LlmProviderError.
  fetchChats(
    settings: LlmConnectionSettings,
    options: LlmChatFetchOptions,
  ): Promise<LlmChatFetchResult>;
}

export type LlmConnector = LlmProviderAccountConnector | LlmCompanyToolConnector;

// Every secret value of a connection, for redacting what a failure says.
export function getSecretValues(settings: LlmConnectionSettings): Array<string> {
  const values: Array<string> = [];

  for (const key of Object.keys(settings.secrets || {})) {
    const value: unknown = settings.secrets[key];

    if (typeof value === "string" && value.length > 0) {
      values.push(value);
    }
  }

  return values;
}

// A trimmed string setting, "" when absent or not a string.
export function readSetting(values: JSONObject, key: string): string {
  const value: unknown = values ? values[key] : undefined;

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}
