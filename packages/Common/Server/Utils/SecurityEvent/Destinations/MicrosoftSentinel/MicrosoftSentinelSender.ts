import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import {
  MICROSOFT_SENTINEL_DEFAULT_STREAM_NAME,
  SecurityEventDestinationDefinition,
  getSecurityEventDestinationDefinition,
} from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import SecurityEventDestinationProvider from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import { SecurityEventRecord } from "../../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import { toSentinelRecord } from "../../../../../Utils/SecurityEvent/Destinations/SiemEventMappers";
import {
  BatchOutcome,
  DESTINATION_REQUEST_TIMEOUT_IN_MS,
  DestinationAnswer,
  DestinationTransport,
  SleepFunction,
  defaultDestinationTransport,
  describeAnswerBody,
  emptySendResult,
  requestAnswer,
  sendInBatches,
} from "../BatchSender";
import { buildDestinationTestRecord } from "../DestinationTestEvent";
import {
  SecurityEventDestinationSettings,
  SecurityEventSendError,
  SecurityEventSendResult,
  SecurityEventSender,
} from "../Types";

/*
 * Sends OneUptime's security events to a Microsoft Sentinel workspace
 * through the Azure Monitor Logs Ingestion API, into a custom table the
 * setup guide creates with a data collection rule (DCR):
 *
 *   - a token for the app registration: POST {login}/{tenant}/oauth2/v2.0/
 *     token, client credentials, scope https://monitor.azure.com//.default;
 *   - the records: POST {endpoint}/dataCollectionRules/{dcr immutable id}/
 *     streams/{stream}?api-version=2023-01-01 with a JSON array, at most
 *     1 MB, answered 204.
 *   https://learn.microsoft.com/en-us/azure/azure-monitor/logs/logs-ingestion-api-overview
 *
 * A call is all or nothing, so a refused batch (400, 413) is split until
 * the record Azure will not take is found and left out. 401 gets a fresh
 * token once; 403 (no Monitoring Metrics Publisher role on the rule) and
 * 404 (no such rule or stream) stop the send with what to fix.
 */

export const SENTINEL_LOGS_INGESTION_API_VERSION: string = "2023-01-01";

export type SentinelCloud = "public" | "usgov";

interface SentinelCloudEndpoints {
  loginBaseUrl: string;
  scope: string;
  // The suffix of every logs ingestion endpoint host in the cloud.
  ingestionHostSuffix: string;
}

export const SENTINEL_CLOUD_ENDPOINTS: Record<
  SentinelCloud,
  SentinelCloudEndpoints
> = {
  public: {
    loginBaseUrl: "https://login.microsoftonline.com",
    scope: "https://monitor.azure.com//.default",
    ingestionHostSuffix: ".ingest.monitor.azure.com",
  },
  usgov: {
    loginBaseUrl: "https://login.microsoftonline.us",
    scope: "https://monitor.azure.us//.default",
    ingestionHostSuffix: ".ingest.monitor.azure.us",
  },
};

const SENTINEL_TITLE: string = "Microsoft Sentinel";

function readSetting(values: JSONObject, key: string): string {
  const value: JSONValue | undefined = values[key];

  return typeof value === "string" ? value.trim() : "";
}

function isHexDigit(char: string): boolean {
  return (
    (char >= "0" && char <= "9") ||
    (char >= "a" && char <= "f") ||
    (char >= "A" && char <= "F")
  );
}

// 8-4-4-4-12 hex digits.
export function isGuid(value: string): boolean {
  if (value.length !== 36) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const char: string = value.charAt(index);
    const isDash: boolean =
      index === 8 || index === 13 || index === 18 || index === 23;

    if (isDash ? char !== "-" : !isHexDigit(char)) {
      return false;
    }
  }

  return true;
}

// A tenant as Entra takes it: its GUID, or a verified domain (contoso.onmicrosoft.com).
export function isEntraTenant(value: string): boolean {
  if (isGuid(value)) {
    return true;
  }

  if (!value || value.length > 253 || !value.includes(".")) {
    return false;
  }

  for (const label of value.split(".")) {
    if (
      !label ||
      label.length > 63 ||
      label.startsWith("-") ||
      label.endsWith("-")
    ) {
      return false;
    }

    for (const char of label) {
      const ok: boolean =
        (char >= "a" && char <= "z") ||
        (char >= "A" && char <= "Z") ||
        (char >= "0" && char <= "9") ||
        char === "-";

      if (!ok) {
        return false;
      }
    }
  }

  return true;
}

// dcr- and 32 hex digits: what the rule's JSON view calls its immutableId.
export function isDcrImmutableId(value: string): boolean {
  if (!value.startsWith("dcr-") || value.length !== 36) {
    return false;
  }

  for (const char of value.slice(4)) {
    if (!isHexDigit(char)) {
      return false;
    }
  }

  return true;
}

// Custom-<name>: a custom table's stream, letters, digits and underscores.
export function isSentinelStreamName(value: string): boolean {
  if (!value.startsWith("Custom-") || value.length > 80) {
    return false;
  }

  const name: string = value.slice("Custom-".length);

  if (!name) {
    return false;
  }

  for (const char of name) {
    const ok: boolean =
      (char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      (char >= "0" && char <= "9") ||
      char === "_";

    if (!ok) {
      return false;
    }
  }

  return true;
}

export function readSentinelCloud(value: string): SentinelCloud {
  return value === "usgov" ? "usgov" : "public";
}

export function describeSentinelSendFailure(answer: DestinationAnswer): string {
  const detail: string = describeAnswerBody(answer);
  const said: string = detail ? ` ${detail}` : "";

  if (answer.status === 401) {
    return `Azure refused the app registration's token (HTTP 401). Check the tenant, the client ID and the client secret.${said}`;
  }

  if (answer.status === 403) {
    return `The app registration cannot send to this data collection rule (HTTP 403). Give it the Monitoring Metrics Publisher role on the rule.${said}`;
  }

  if (answer.status === 404) {
    return `Azure did not find the data collection rule or its stream (HTTP 404). Check the immutable ID, the stream name and the logs ingestion endpoint.${said}`;
  }

  if (answer.status === 429) {
    return `Azure Monitor is throttling this app registration (HTTP 429). OneUptime tries again on the next run.${said}`;
  }

  return `Microsoft Sentinel did not accept the records (HTTP ${answer.status}).${said}`;
}

export default class MicrosoftSentinelSender implements SecurityEventSender {
  private readonly transport: DestinationTransport;
  private readonly sleep: SleepFunction | undefined;

  public constructor(
    options: {
      transport?: DestinationTransport | undefined;
      sleep?: SleepFunction | undefined;
    } = {},
  ) {
    this.transport = options.transport || defaultDestinationTransport;
    this.sleep = options.sleep;
  }

  private getDefinition(): SecurityEventDestinationDefinition {
    return getSecurityEventDestinationDefinition(
      SecurityEventDestinationProvider.MicrosoftSentinel,
    )!;
  }

  public validateSettings(settings: SecurityEventDestinationSettings): void {
    const tenantId: string = readSetting(settings.config, "tenantId");

    if (!isEntraTenant(tenantId)) {
      throw new BadDataException(
        "Directory (tenant) ID must be the tenant's GUID or a verified domain such as contoso.onmicrosoft.com.",
      );
    }

    if (!isGuid(readSetting(settings.config, "clientId"))) {
      throw new BadDataException(
        "Application (client) ID must be a GUID, from the app registration's Overview page.",
      );
    }

    const cloud: SentinelCloud = readSentinelCloud(
      readSetting(settings.config, "cloud"),
    );
    const endpoint: string = readSetting(
      settings.config,
      "logsIngestionEndpoint",
    );
    let parsed: URL;

    try {
      parsed = new URL(endpoint);
    } catch {
      throw new BadDataException(
        "Logs ingestion endpoint must be an https URL, e.g. https://my-dce-abcd.eastus-1.ingest.monitor.azure.com.",
      );
    }

    const suffix: string = SENTINEL_CLOUD_ENDPOINTS[cloud].ingestionHostSuffix;

    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname.toLowerCase().endsWith(suffix)
    ) {
      throw new BadDataException(
        `Logs ingestion endpoint must be an https address ending in ${suffix}, from the data collection endpoint's (or rule's) Overview page.`,
      );
    }

    if (!isDcrImmutableId(readSetting(settings.config, "dcrImmutableId"))) {
      throw new BadDataException(
        "Data collection rule immutable ID must look like dcr-0123456789abcdef0123456789abcdef, from the rule's JSON view.",
      );
    }

    const stream: string = readSetting(settings.config, "streamName");

    if (stream && !isSentinelStreamName(stream)) {
      throw new BadDataException(
        "Stream must be the rule's custom stream, Custom- and the table's name, such as Custom-OneUptimeSecurityEvents_CL.",
      );
    }

    if (!readSetting(settings.secrets, "clientSecret")) {
      throw new BadDataException(
        "Client secret is required for Microsoft Sentinel.",
      );
    }
  }

  // A token for the Logs Ingestion API, as the app registration.
  public async getAccessToken(
    settings: SecurityEventDestinationSettings,
  ): Promise<string> {
    const cloud: SentinelCloudEndpoints =
      SENTINEL_CLOUD_ENDPOINTS[
        readSentinelCloud(readSetting(settings.config, "cloud"))
      ];
    const tenantId: string = readSetting(settings.config, "tenantId");

    const answer: DestinationAnswer = await requestAnswer(this.transport, {
      method: "POST",
      url: `${cloud.loginBaseUrl}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      body: {
        grant_type: "client_credentials",
        client_id: readSetting(settings.config, "clientId"),
        client_secret: readSetting(settings.secrets, "clientSecret"),
        scope: cloud.scope,
      },
      formUrlEncoded: true,
      timeoutInMs: DESTINATION_REQUEST_TIMEOUT_IN_MS,
      egressOptions: { targetLabel: "Microsoft Entra" },
    });

    const json: unknown = answer.bodyJson;
    const token: unknown =
      json && typeof json === "object" && !Array.isArray(json)
        ? (json as JSONObject)["access_token"]
        : undefined;

    if (!answer.ok || typeof token !== "string" || !token) {
      const error: unknown =
        json && typeof json === "object" && !Array.isArray(json)
          ? (json as JSONObject)["error_description"] ||
            (json as JSONObject)["error"]
          : undefined;

      throw new SecurityEventSendError(
        `Microsoft Entra did not give the app registration a token (HTTP ${answer.status}). Check the tenant, the client ID and the client secret.${
          typeof error === "string" && error
            ? ` ${describeAnswerBody({ ...answer, bodyText: error })}`
            : ""
        }`,
        answer.status || null,
      );
    }

    return token;
  }

  private ingestionUrl(settings: SecurityEventDestinationSettings): string {
    let endpoint: string = readSetting(
      settings.config,
      "logsIngestionEndpoint",
    );

    while (endpoint.endsWith("/")) {
      endpoint = endpoint.slice(0, -1);
    }

    const stream: string =
      readSetting(settings.config, "streamName") ||
      MICROSOFT_SENTINEL_DEFAULT_STREAM_NAME;

    return `${endpoint}/dataCollectionRules/${encodeURIComponent(
      readSetting(settings.config, "dcrImmutableId"),
    )}/streams/${encodeURIComponent(stream)}?api-version=${SENTINEL_LOGS_INGESTION_API_VERSION}`;
  }

  private async post(data: {
    settings: SecurityEventDestinationSettings;
    records: Array<JSONObject>;
    token: { value: string };
  }): Promise<DestinationAnswer> {
    const send: () => Promise<DestinationAnswer> =
      (): Promise<DestinationAnswer> => {
        return requestAnswer(this.transport, {
          method: "POST",
          url: this.ingestionUrl(data.settings),
          headers: {
            Authorization: `Bearer ${data.token.value}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data.records),
          timeoutInMs: DESTINATION_REQUEST_TIMEOUT_IN_MS,
          egressOptions: { targetLabel: "Azure Monitor logs ingestion" },
        });
      };

    let answer: DestinationAnswer = await send();

    // A token that ran out between calls: once more with a new one.
    if (answer.status === 401) {
      data.token.value = await this.getAccessToken(data.settings);
      answer = await send();
    }

    return answer;
  }

  public async send(data: {
    settings: SecurityEventDestinationSettings;
    events: Array<SecurityEventRecord>;
  }): Promise<SecurityEventSendResult> {
    this.validateSettings(data.settings);

    if (data.events.length === 0) {
      return emptySendResult();
    }

    const definition: SecurityEventDestinationDefinition = this.getDefinition();
    let tokenValue: string;

    try {
      tokenValue = await this.getAccessToken(data.settings);
    } catch (error) {
      // Nothing was sent: the next run starts from the same event.
      return {
        ...emptySendResult(),
        requests: 1,
        failure:
          error instanceof SecurityEventSendError
            ? error.message
            : `Could not reach Microsoft Entra for a token: ${
                error instanceof Error ? error.message : String(error)
              }`,
        failureStatus:
          error instanceof SecurityEventSendError ? error.status : null,
      };
    }

    const token: { value: string } = { value: tokenValue };
    const records: Array<JSONObject> = data.events.map(toSentinelRecord);

    const result: SecurityEventSendResult = await sendInBatches<JSONObject>({
      items: records,
      sizeOf: (record: JSONObject): number => {
        return JSON.stringify(record).length + 1;
      },
      maxItems: definition.maxEventsPerRequest,
      maxBytes: definition.maxBytesPerRequest,
      post: async (batch: Array<JSONObject>): Promise<BatchOutcome> => {
        return {
          answer: await this.post({
            settings: data.settings,
            records: batch,
            token,
          }),
        };
      },
      isSplittable: (outcome: BatchOutcome): boolean => {
        return outcome.answer.status === 400 || outcome.answer.status === 413;
      },
      describeFailure: describeSentinelSendFailure,
      describeUnreachable: (error: unknown): string => {
        return `Could not reach Azure Monitor's logs ingestion endpoint: ${
          error instanceof Error ? error.message : String(error)
        }`;
      },
      sleep: this.sleep,
    });

    // The token request is a request too.
    result.requests += 1;

    return result;
  }

  public async sendTestEvent(
    settings: SecurityEventDestinationSettings,
  ): Promise<void> {
    this.validateSettings(settings);

    let token: string;

    try {
      token = await this.getAccessToken(settings);
    } catch (error) {
      throw new BadDataException(
        error instanceof Error ? error.message : String(error),
      );
    }

    const answer: DestinationAnswer = await this.post({
      settings,
      records: [toSentinelRecord(buildDestinationTestRecord(SENTINEL_TITLE))],
      token: { value: token },
    });

    if (!answer.ok) {
      throw new BadDataException(describeSentinelSendFailure(answer));
    }
  }
}
