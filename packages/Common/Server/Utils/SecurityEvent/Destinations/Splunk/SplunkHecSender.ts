import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SPLUNK_DEFAULT_SOURCE_TYPE,
  getSecurityEventDestinationDefinition,
  SecurityEventDestinationDefinition,
} from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import SecurityEventDestinationProvider from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import { SecurityEventRecord } from "../../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import { toSplunkHecEvent } from "../../../../../Utils/SecurityEvent/Destinations/SiemEventMappers";
import {
  BatchOutcome,
  DESTINATION_REQUEST_TIMEOUT_IN_MS,
  DestinationAnswer,
  DestinationTransport,
  SleepFunction,
  defaultDestinationTransport,
  describeAnswerBody,
  readAnswerNumber,
  readAnswerString,
  requestAnswer,
  sendInBatches,
} from "../BatchSender";
import { buildDestinationTestRecord } from "../DestinationTestEvent";
import {
  SecurityEventDestinationSettings,
  SecurityEventSendResult,
  SecurityEventSender,
} from "../Types";

/*
 * Sends OneUptime's security events to Splunk through its HTTP Event
 * Collector: POST {HEC URL}/services/collector/event, the token in the
 * Authorization header ("Splunk <token>"), several events in one body.
 * https://docs.splunk.com/Documentation/Splunk/latest/Data/HECRESTendpoints
 *
 * HEC answers with a code beside the HTTP status, which says more:
 *
 *   - 0: accepted;
 *   - 1-4 (a token disabled, missing, refused or unknown): stop - nothing
 *     more can be sent with this token;
 *   - 6 (invalid data format): HEC indexed the events before the one it
 *     names (invalid-event-number) and refused that one; the rest are sent
 *     again;
 *   - 12, 13, 15 (an event field missing, blank or not indexable): the
 *     batch is split until the event is found, and left out;
 *   - 7 (an index the token may not write): stop, with what to change;
 *   - 9 (server busy) and 5xx: tried again after a pause.
 *
 * Every request names a channel (X-Splunk-Request-Channel), so a token
 * with indexer acknowledgment on takes the events too.
 */

const HEC_EVENT_PATH: string = "/services/collector/event";

// HEC's codes for an event it refused on its own.
const HEC_EVENT_LEVEL_CODES: ReadonlyArray<number> = [12, 13, 15];
const HEC_INVALID_DATA_FORMAT_CODE: number = 6;
const HEC_INCORRECT_INDEX_CODE: number = 7;

const SPLUNK_TITLE: string = "Splunk";

function readSetting(values: JSONObject, key: string): string {
  const value: JSONValue | undefined = values[key];

  return typeof value === "string" ? value.trim() : "";
}

// Lowercase letters, digits, underscores and hyphens, from a letter or digit: Splunk's index names.
export function isSplunkIndexName(value: string): boolean {
  if (!value || value.length > 80) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const char: string = value.charAt(index);
    const isLetterOrDigit: boolean =
      (char >= "a" && char <= "z") || (char >= "0" && char <= "9");

    if (
      index === 0
        ? !isLetterOrDigit
        : !(isLetterOrDigit || char === "_" || char === "-")
    ) {
      return false;
    }
  }

  return true;
}

// Printable text without spaces: a sourcetype such as oneuptime:security.
export function isSplunkSourceType(value: string): boolean {
  if (!value || value.length > 100) {
    return false;
  }

  for (const char of value) {
    const code: number = char.charCodeAt(0);

    if (code <= 32 || code >= 127) {
      return false;
    }
  }

  return true;
}

// The collector's event endpoint, from the HEC URL as a person pastes it.
export function splunkHecEventUrl(hecUrl: string): string {
  const parsed: URL = new URL(hecUrl);
  let path: string = parsed.pathname;

  while (path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  if (path.endsWith(HEC_EVENT_PATH)) {
    // Pasted whole.
  } else if (path.endsWith("/services/collector")) {
    path = `${path}/event`;
  } else {
    path = `${path}${HEC_EVENT_PATH}`;
  }

  return `${parsed.origin}${path}`;
}

export function describeSplunkSendFailure(
  answer: DestinationAnswer,
  options: { index?: string | undefined } = {},
): string {
  const code: number | null = readAnswerNumber(answer, "code");
  const text: string = readAnswerString(answer, "text");
  const detail: string = describeAnswerBody(answer);
  const said: string = text ? `, ${text}` : "";

  if (code === HEC_INCORRECT_INDEX_CODE) {
    return `Splunk refused the index "${options.index || ""}" for this HEC token (HTTP ${answer.status}${said}). Allow the index on the token, or leave Index empty to use the token's default index.`;
  }

  if (
    answer.status === 401 ||
    answer.status === 403 ||
    (code !== null && code >= 1 && code <= 4)
  ) {
    return `Splunk refused the HEC token (HTTP ${answer.status}${said}). Check that the token is right and enabled.`;
  }

  if (answer.status === 404) {
    return `Splunk did not find the HTTP Event Collector at this address (HTTP 404). Check the HEC URL: port 8088 on Splunk Enterprise, https://http-inputs-<stack>.splunkcloud.com on Splunk Cloud.`;
  }

  if (answer.status === 429 || answer.status === 503 || code === 9) {
    return `Splunk is busy (HTTP ${answer.status}${said}). OneUptime tries again on the next run.`;
  }

  return `Splunk did not accept the events (HTTP ${answer.status}${said}).${
    detail && !text ? ` ${detail}` : ""
  }`;
}

export default class SplunkHecSender implements SecurityEventSender {
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
      SecurityEventDestinationProvider.Splunk,
    )!;
  }

  public validateSettings(settings: SecurityEventDestinationSettings): void {
    const hecUrl: string = readSetting(settings.config, "hecUrl");
    let parsed: URL;

    try {
      parsed = new URL(hecUrl);
    } catch {
      throw new BadDataException(
        "HEC URL must be an absolute https URL, e.g. https://splunk.example.com:8088.",
      );
    }

    if (parsed.protocol !== "https:") {
      throw new BadDataException(
        "HEC URL must start with https://: the HEC token travels with every request.",
      );
    }

    const index: string = readSetting(settings.config, "index");

    if (index && !isSplunkIndexName(index)) {
      throw new BadDataException(
        "Index must be a Splunk index name: lowercase letters, digits, underscores and hyphens.",
      );
    }

    const sourceType: string = readSetting(settings.config, "sourceType");

    if (sourceType && !isSplunkSourceType(sourceType)) {
      throw new BadDataException(
        "Source type must be one word without spaces, such as oneuptime:security.",
      );
    }

    if (!readSetting(settings.secrets, "hecToken")) {
      throw new BadDataException("HEC token is required for Splunk.");
    }
  }

  private async post(
    settings: SecurityEventDestinationSettings,
    events: Array<JSONObject>,
  ): Promise<DestinationAnswer> {
    return requestAnswer(this.transport, {
      method: "POST",
      url: splunkHecEventUrl(readSetting(settings.config, "hecUrl")),
      headers: {
        Authorization: `Splunk ${readSetting(settings.secrets, "hecToken")}`,
        "Content-Type": "application/json",
        "X-Splunk-Request-Channel": ObjectID.generate().toString(),
      },
      // HEC takes events one after another in one body.
      body: events
        .map((event: JSONObject): string => {
          return JSON.stringify(event);
        })
        .join("\n"),
      timeoutInMs: DESTINATION_REQUEST_TIMEOUT_IN_MS,
      egressOptions: { targetLabel: "Splunk HEC" },
    });
  }

  private toEvents(
    settings: SecurityEventDestinationSettings,
    records: Array<SecurityEventRecord>,
  ): Array<JSONObject> {
    const index: string = readSetting(settings.config, "index");
    const sourceType: string =
      readSetting(settings.config, "sourceType") || SPLUNK_DEFAULT_SOURCE_TYPE;

    return records.map((record: SecurityEventRecord): JSONObject => {
      return toSplunkHecEvent(record, { index, sourceType });
    });
  }

  public async send(data: {
    settings: SecurityEventDestinationSettings;
    events: Array<SecurityEventRecord>;
  }): Promise<SecurityEventSendResult> {
    this.validateSettings(data.settings);

    const definition: SecurityEventDestinationDefinition = this.getDefinition();
    const index: string = readSetting(data.settings.config, "index");
    const events: Array<JSONObject> = this.toEvents(data.settings, data.events);

    return sendInBatches<JSONObject>({
      items: events,
      sizeOf: (event: JSONObject): number => {
        return JSON.stringify(event).length + 1;
      },
      maxItems: definition.maxEventsPerRequest,
      maxBytes: definition.maxBytesPerRequest,
      post: async (batch: Array<JSONObject>): Promise<BatchOutcome> => {
        const answer: DestinationAnswer = await this.post(data.settings, batch);
        const code: number | null = readAnswerNumber(answer, "code");
        const invalidEvent: number | null = readAnswerNumber(
          answer,
          "invalid-event-number",
        );

        return {
          answer,
          acceptedBeforeRefusal:
            !answer.ok &&
            code === HEC_INVALID_DATA_FORMAT_CODE &&
            invalidEvent !== null &&
            invalidEvent >= 0
              ? invalidEvent
              : undefined,
        };
      },
      isSplittable: (outcome: BatchOutcome): boolean => {
        const code: number | null = readAnswerNumber(outcome.answer, "code");

        if (outcome.answer.status === 413) {
          return true;
        }

        return (
          outcome.answer.status === 400 &&
          code !== null &&
          (code === HEC_INVALID_DATA_FORMAT_CODE ||
            HEC_EVENT_LEVEL_CODES.includes(code))
        );
      },
      describeFailure: (answer: DestinationAnswer): string => {
        return describeSplunkSendFailure(answer, { index });
      },
      describeUnreachable: (error: unknown): string => {
        return `Could not reach Splunk's HTTP Event Collector: ${
          error instanceof Error ? error.message : String(error)
        }`;
      },
      sleep: this.sleep,
    });
  }

  public async sendTestEvent(
    settings: SecurityEventDestinationSettings,
  ): Promise<void> {
    this.validateSettings(settings);

    const answer: DestinationAnswer = await this.post(
      settings,
      this.toEvents(settings, [buildDestinationTestRecord(SPLUNK_TITLE)]),
    );

    if (!answer.ok) {
      throw new BadDataException(
        describeSplunkSendFailure(answer, {
          index: readSetting(settings.config, "index"),
        }),
      );
    }
  }
}
