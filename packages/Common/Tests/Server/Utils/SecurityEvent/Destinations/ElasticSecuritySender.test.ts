import ElasticSecuritySender, {
  isElasticIndexName,
  readBulkAnswer,
} from "../../../../../Server/Utils/SecurityEvent/Destinations/ElasticSecurity/ElasticSecuritySender";
import SecurityEventDestinationRegistry from "../../../../../Server/Utils/SecurityEvent/Destinations/SecurityEventDestinationRegistry";
import {
  SecurityEventDestinationSettings,
  SecurityEventSendResult,
} from "../../../../../Server/Utils/SecurityEvent/Destinations/Types";
import { DataSourceHttpRequest } from "../../../../../Server/Utils/DataSource/HttpFetch";
import { JSONObject } from "../../../../../Types/JSON";
import SecurityEventDestinationProvider from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import { SecurityEventRecord } from "../../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import {
  FakeReply,
  FakeSiem,
  bodyLines,
  fakeSiem,
  noSleep,
  securityRecords,
} from "./FakeSiem";
import { describe, expect, test } from "@jest/globals";

/*
 * Elasticsearch's Bulk API, as the sender talks to it: an ApiKey header,
 * an NDJSON body of a create action and an ECS document per event, the
 * event's own id as the document's - so an event sent twice is stored
 * once - and a 200 answer read document by document.
 * https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-bulk.html
 */

const URL_: string = "https://acme.es.us-east-1.aws.elastic.cloud";
const KEY: string =
  "VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==";

const SETTINGS: SecurityEventDestinationSettings = {
  provider: SecurityEventDestinationProvider.ElasticSecurity,
  config: { elasticsearchUrl: `${URL_}/` },
  secrets: { apiKey: KEY },
};

function sender(siem: FakeSiem): ElasticSecuritySender {
  return new ElasticSecuritySender({
    transport: siem.transport,
    sleep: noSleep,
  });
}

// A bulk answer: one { create: { status } } per document line in the request.
function bulkReply(
  request: DataSourceHttpRequest,
  statusFor: (document: JSONObject, position: number) => number,
): FakeReply {
  const lines: Array<JSONObject> = bodyLines(request);
  const items: Array<JSONObject> = [];
  let errors: boolean = false;

  for (let index: number = 1; index < lines.length; index += 2) {
    const status: number = statusFor(lines[index]!, (index - 1) / 2);

    if (status >= 300) {
      errors = true;
    }

    items.push({
      create: {
        _index: ".ds-logs-oneuptime.security-default-2026.10.21-000001",
        status,
        ...(status >= 300
          ? {
              error: {
                type:
                  status === 409
                    ? "version_conflict_engine_exception"
                    : status === 429
                      ? "es_rejected_execution_exception"
                      : "document_parsing_exception",
                reason: "failed to parse field [source.ip] of type [ip]",
              },
            }
          : {}),
      },
    });
  }

  return { status: 200, body: { took: 3, errors, items } };
}

describe("a send", () => {
  test("posts NDJSON: a create action with the event's id, then its ECS document", async () => {
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return bulkReply(request, () => {
        return 201;
      });
    });

    const events: Array<SecurityEventRecord> = securityRecords(2);
    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events,
    });

    expect(result).toMatchObject({
      processed: 2,
      sent: 2,
      rejected: 0,
      requests: 1,
      failure: "",
    });

    const request: DataSourceHttpRequest = siem.requests[0]!;

    expect(request.url).toBe(`${URL_}/_bulk`);
    expect(request.headers!["Authorization"]).toBe(`ApiKey ${KEY}`);
    expect(request.headers!["Content-Type"]).toBe("application/x-ndjson");
    expect(String(request.body).endsWith("\n")).toBe(true);
    expect(request.egressOptions?.targetLabel).toBe("Elasticsearch");

    const lines: Array<JSONObject> = bodyLines(request);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toEqual({
      create: { _index: "logs-oneuptime.security-default", _id: events[0]!.id },
    });
    expect(lines[1]!["@timestamp"]).toBe("2026-10-21T10:00:00.000Z");
    expect((lines[1]!["event"] as JSONObject)["dataset"]).toBe(
      "oneuptime.security",
    );
  });

  test("writes to the destination's own data stream when it names one", async () => {
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return bulkReply(request, () => {
        return 201;
      });
    });

    await sender(siem).send({
      settings: {
        ...SETTINGS,
        config: { ...SETTINGS.config, dataStream: "logs-security-prod" },
      },
      events: securityRecords(1),
    });

    expect(bodyLines(siem.requests[0]!)[0]).toMatchObject({
      create: { _index: "logs-security-prod" },
    });
  });

  test("a document stored already (409) counts as sent: an event sent twice is stored once", async () => {
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return bulkReply(request, (_document: JSONObject, position: number) => {
        return position === 0 ? 409 : 201;
      });
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(3),
    });

    expect(result).toMatchObject({ processed: 3, sent: 3, rejected: 0 });
  });

  test("a document Elasticsearch cannot map is left out with its reason; the rest are stored", async () => {
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return bulkReply(request, (_document: JSONObject, position: number) => {
        return position === 1 ? 400 : 201;
      });
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(3),
    });

    expect(result).toMatchObject({ processed: 3, sent: 2, rejected: 1 });
    expect(result.rejectionReason).toContain(
      "Elasticsearch refused a document (HTTP 400): document_parsing_exception",
    );
  });

  test("documents Elasticsearch could not take for now (429) are sent again, and only they", async () => {
    let call: number = 0;
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      call++;
      return bulkReply(request, (_document: JSONObject, position: number) => {
        return call === 1 && position === 2 ? 429 : 201;
      });
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(4),
    });

    expect(result).toMatchObject({ processed: 4, sent: 4, failure: "" });
    expect(siem.requests).toHaveLength(2);
    // Only the third document, again.
    expect(bodyLines(siem.requests[1]!)).toHaveLength(2);
  });

  test("documents still refused for now after the retries stop the send at the first of them", async () => {
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return bulkReply(request, (document: JSONObject) => {
        return String(document["message"]).endsWith("BUSY") ? 429 : 201;
      });
    });

    const events: Array<SecurityEventRecord> = securityRecords(4);
    events[2]!.message = "Failed sign-in BUSY";

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events,
    });

    // The two before it were stored; the next run goes on from the third.
    expect(result.processed).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failure).toContain(
      "Elasticsearch is rejecting requests for now",
    );
  });

  test.each([
    [401, "Elasticsearch refused the API key"],
    [403, "create_doc privilege"],
    [404, "not Kibana's"],
  ])("HTTP %s stops the send: %s", async (status: number, message: string) => {
    const siem: FakeSiem = fakeSiem(() => {
      return {
        status,
        body: { error: { type: "security_exception" }, status },
      };
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(2),
    });

    expect(result.processed).toBe(0);
    expect(result.failure).toContain(message);
    expect(siem.requests).toHaveLength(1);
  });

  test("a request too large (413) is split in two", async () => {
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return bodyLines(request).length > 4
        ? { status: 413, body: "Request Entity Too Large" }
        : bulkReply(request, () => {
            return 201;
          });
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(4),
    });

    expect(result).toMatchObject({ sent: 4, failure: "" });
    expect(siem.requests).toHaveLength(3);
  });
});

describe("the settings", () => {
  test.each([
    [
      { elasticsearchUrl: "http://acme.es.example.com" },
      "must start with https://",
    ],
    [{ elasticsearchUrl: "acme" }, "must be an absolute https URL"],
    [
      { elasticsearchUrl: URL_, dataStream: "Logs Security" },
      "Data stream must be an Elasticsearch data stream name",
    ],
    [
      { elasticsearchUrl: URL_, dataStream: "_internal" },
      "Data stream must be",
    ],
  ])("%j is refused", (config: JSONObject, message: string) => {
    expect(() => {
      sender(fakeSiem()).validateSettings({ ...SETTINGS, config });
    }).toThrow(message);
  });

  test("data stream names as Elasticsearch takes them", () => {
    expect(isElasticIndexName("logs-oneuptime.security-default")).toBe(true);
    expect(isElasticIndexName("logs:x")).toBe(false);
    expect(isElasticIndexName("..")).toBe(false);
    expect(isElasticIndexName("-logs")).toBe(false);
  });

  test("a bulk answer without errors settles nothing one by one", () => {
    expect(
      readBulkAnswer(
        {
          ok: true,
          status: 200,
          bodyText: "",
          bodyJson: { errors: false, items: [] },
        },
        3,
      ),
    ).toEqual({});
  });
});

describe("Send a test event", () => {
  test("stores one document, and says why when Elasticsearch refuses it", async () => {
    let status: number = 201;
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return bulkReply(request, () => {
        return status;
      });
    });

    await sender(siem).sendTestEvent(SETTINGS);

    const lines: Array<JSONObject> = bodyLines(siem.requests[0]!);

    expect(lines[0]).toEqual({
      create: { _index: "logs-oneuptime.security-default" },
    });
    expect(String(lines[1]!["message"])).toContain(
      "connection test: this destination can send security events to Elastic Security.",
    );

    status = 400;

    await expect(sender(siem).sendTestEvent(SETTINGS)).rejects.toThrow(
      "document_parsing_exception",
    );
  });

  test("is the sender the registry hands out for Elastic Security", () => {
    expect(
      SecurityEventDestinationRegistry.getSender(
        SecurityEventDestinationProvider.ElasticSecurity,
      ),
    ).toBeInstanceOf(ElasticSecuritySender);
  });
});
