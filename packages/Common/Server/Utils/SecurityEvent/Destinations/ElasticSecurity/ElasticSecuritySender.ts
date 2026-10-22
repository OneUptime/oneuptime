import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject, JSONValue } from "../../../../../Types/JSON";
import {
  ELASTIC_DEFAULT_DATA_STREAM,
  SecurityEventDestinationDefinition,
  getSecurityEventDestinationDefinition,
} from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import SecurityEventDestinationProvider from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import { SecurityEventRecord } from "../../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import { toEcsDocument } from "../../../../../Utils/SecurityEvent/Destinations/SiemEventMappers";
import {
  BatchOutcome,
  DESTINATION_REQUEST_TIMEOUT_IN_MS,
  DestinationAnswer,
  DestinationTransport,
  SleepFunction,
  defaultDestinationTransport,
  describeAnswerBody,
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
 * Sends OneUptime's security events to Elasticsearch as ECS documents
 * through the Bulk API, into a data stream:
 *
 *   POST {url}/_bulk, Authorization: ApiKey <encoded key>,
 *   one { "create": { "_index": <data stream>, "_id": <event id> } } line
 *   and one document line per event.
 *   https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-bulk.html
 *
 * A bulk request is answered 200 with one result per document, so
 * documents are settled one by one: 201 is sent; 409 (a document with
 * that id is there already) is sent too - the _id is the event's own, so
 * an event sent twice is stored once; 429 is sent again; anything else (a
 * field Elasticsearch could not map, say) is left out with its reason.
 * The request itself refused: 401 and 403 stop the send with what to fix,
 * 413 splits the batch, 429 and 5xx try it again.
 */

const ELASTIC_TITLE: string = "Elastic Security";

function readSetting(values: JSONObject, key: string): string {
  const value: JSONValue | undefined = values[key];

  return typeof value === "string" ? value.trim() : "";
}

/*
 * Elasticsearch's index name rules: lowercase, no spaces or \ / * ? " < > |
 * , # :, not starting with - _ +, not . or .., at most 255 bytes.
 */
export function isElasticIndexName(value: string): boolean {
  if (!value || value === "." || value === ".." || value.length > 255) {
    return false;
  }

  if (value.startsWith("-") || value.startsWith("_") || value.startsWith("+")) {
    return false;
  }

  for (const char of value) {
    if (char !== char.toLowerCase() || ' \\/*?"<>|,#:'.includes(char)) {
      return false;
    }
  }

  return true;
}

export function describeElasticSendFailure(answer: DestinationAnswer): string {
  const detail: string = describeAnswerBody(answer);
  const said: string = detail ? ` ${detail}` : "";

  if (answer.status === 401) {
    return `Elasticsearch refused the API key (HTTP 401). Check that the key is the encoded value and has not expired.${said}`;
  }

  if (answer.status === 403) {
    return `The API key cannot write to the data stream (HTTP 403). Give it the create_doc privilege on the data stream.${said}`;
  }

  if (answer.status === 404) {
    return `Elasticsearch did not find the bulk endpoint at this address (HTTP 404). Check the Elasticsearch URL: it is the deployment's Elasticsearch endpoint, not Kibana's.${said}`;
  }

  if (answer.status === 429) {
    return `Elasticsearch is rejecting requests for now (HTTP 429). OneUptime tries again on the next run.${said}`;
  }

  return `Elasticsearch did not accept the documents (HTTP ${answer.status}).${said}`;
}

// One bulk item's status and why it failed, if it did.
function readBulkItem(item: JSONValue): { status: number; reason: string } {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { status: 0, reason: "" };
  }

  const result: JSONValue | undefined =
    (item as JSONObject)["create"] || (item as JSONObject)["index"];

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { status: 0, reason: "" };
  }

  const status: unknown = (result as JSONObject)["status"];
  const error: unknown = (result as JSONObject)["error"];
  let reason: string = "";

  if (error && typeof error === "object" && !Array.isArray(error)) {
    const type: unknown = (error as JSONObject)["type"];
    const text: unknown = (error as JSONObject)["reason"];

    reason = [type, text]
      .filter((part: unknown): part is string => {
        return typeof part === "string" && part.length > 0;
      })
      .join(": ");
  }

  return { status: typeof status === "number" ? status : 0, reason };
}

/*
 * A 200 bulk answer, document by document: the positions Elasticsearch
 * refused (and why, for the first) and the ones to send again.
 */
export function readBulkAnswer(
  answer: DestinationAnswer,
  batchLength: number,
): Pick<BatchOutcome, "rejected" | "rejectionReason" | "retry"> {
  const json: unknown = answer.bodyJson;

  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return {};
  }

  if ((json as JSONObject)["errors"] !== true) {
    return {};
  }

  const items: JSONValue | undefined = (json as JSONObject)["items"];

  if (!Array.isArray(items)) {
    return {};
  }

  const rejected: Array<number> = [];
  const retry: Array<number> = [];
  let rejectionReason: string = "";

  (items as JSONArray)
    .slice(0, batchLength)
    .forEach((item: JSONValue, position: number): void => {
      const { status, reason } = readBulkItem(item);

      if ((status >= 200 && status < 300) || status === 409) {
        return;
      }

      if (status === 429 || status >= 500) {
        retry.push(position);
        return;
      }

      rejected.push(position);

      if (!rejectionReason) {
        rejectionReason = `Elasticsearch refused a document (HTTP ${status})${
          reason
            ? `: ${describeAnswerBody({ ok: false, status, bodyText: reason, bodyJson: undefined })}`
            : "."
        }`;
      }
    });

  return { rejected, rejectionReason, retry };
}

interface BulkDocument {
  id: string;
  document: JSONObject;
}

export default class ElasticSecuritySender implements SecurityEventSender {
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
      SecurityEventDestinationProvider.ElasticSecurity,
    )!;
  }

  public validateSettings(settings: SecurityEventDestinationSettings): void {
    const url: string = readSetting(settings.config, "elasticsearchUrl");
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      throw new BadDataException(
        "Elasticsearch URL must be an absolute https URL, e.g. https://my-deployment.es.us-east-1.aws.elastic.cloud.",
      );
    }

    if (parsed.protocol !== "https:") {
      throw new BadDataException(
        "Elasticsearch URL must start with https://: the API key travels with every request.",
      );
    }

    const dataStream: string = readSetting(settings.config, "dataStream");

    if (dataStream && !isElasticIndexName(dataStream)) {
      throw new BadDataException(
        'Data stream must be an Elasticsearch data stream name: lowercase, without spaces or \\ / * ? " < > | , # :.',
      );
    }

    if (!readSetting(settings.secrets, "apiKey")) {
      throw new BadDataException("API key is required for Elastic Security.");
    }
  }

  private bulkUrl(settings: SecurityEventDestinationSettings): string {
    let url: string = readSetting(settings.config, "elasticsearchUrl");

    while (url.endsWith("/")) {
      url = url.slice(0, -1);
    }

    return `${url}/_bulk`;
  }

  private async post(
    settings: SecurityEventDestinationSettings,
    documents: Array<BulkDocument>,
  ): Promise<DestinationAnswer> {
    const dataStream: string =
      readSetting(settings.config, "dataStream") || ELASTIC_DEFAULT_DATA_STREAM;

    const lines: Array<string> = [];

    for (const document of documents) {
      lines.push(
        JSON.stringify({
          create: {
            _index: dataStream,
            ...(document.id ? { _id: document.id } : {}),
          },
        }),
      );
      lines.push(JSON.stringify(document.document));
    }

    return requestAnswer(this.transport, {
      method: "POST",
      url: this.bulkUrl(settings),
      headers: {
        Authorization: `ApiKey ${readSetting(settings.secrets, "apiKey")}`,
        "Content-Type": "application/x-ndjson",
      },
      // The bulk body ends with a newline.
      body: `${lines.join("\n")}\n`,
      timeoutInMs: DESTINATION_REQUEST_TIMEOUT_IN_MS,
      egressOptions: { targetLabel: "Elasticsearch" },
    });
  }

  public async send(data: {
    settings: SecurityEventDestinationSettings;
    events: Array<SecurityEventRecord>;
  }): Promise<SecurityEventSendResult> {
    this.validateSettings(data.settings);

    const definition: SecurityEventDestinationDefinition = this.getDefinition();
    const documents: Array<BulkDocument> = data.events.map(
      (record: SecurityEventRecord): BulkDocument => {
        return { id: record.id, document: toEcsDocument(record) };
      },
    );

    return sendInBatches<BulkDocument>({
      items: documents,
      sizeOf: (document: BulkDocument): number => {
        return JSON.stringify(document.document).length + 120;
      },
      maxItems: definition.maxEventsPerRequest,
      maxBytes: definition.maxBytesPerRequest,
      post: async (batch: Array<BulkDocument>): Promise<BatchOutcome> => {
        const answer: DestinationAnswer = await this.post(data.settings, batch);

        return {
          answer,
          ...(answer.ok ? readBulkAnswer(answer, batch.length) : {}),
        };
      },
      isSplittable: (outcome: BatchOutcome): boolean => {
        return outcome.answer.status === 413;
      },
      describeFailure: describeElasticSendFailure,
      describeUnreachable: (error: unknown): string => {
        return `Could not reach Elasticsearch: ${
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

    const record: SecurityEventRecord =
      buildDestinationTestRecord(ELASTIC_TITLE);
    const answer: DestinationAnswer = await this.post(settings, [
      { id: "", document: toEcsDocument(record) },
    ]);

    if (!answer.ok) {
      throw new BadDataException(describeElasticSendFailure(answer));
    }

    const settled: Pick<
      BatchOutcome,
      "rejected" | "rejectionReason" | "retry"
    > = readBulkAnswer(answer, 1);

    if (
      (settled.rejected || []).length > 0 ||
      (settled.retry || []).length > 0
    ) {
      throw new BadDataException(
        settled.rejectionReason ||
          "Elasticsearch did not store the test document. Try again in a moment.",
      );
    }
  }
}
