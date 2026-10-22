import SplunkHecSender, {
  describeSplunkSendFailure,
  isSplunkIndexName,
  isSplunkSourceType,
  splunkHecEventUrl,
} from "../../../../../Server/Utils/SecurityEvent/Destinations/Splunk/SplunkHecSender";
import SecurityEventDestinationRegistry from "../../../../../Server/Utils/SecurityEvent/Destinations/SecurityEventDestinationRegistry";
import {
  SecurityEventDestinationSettings,
  SecurityEventSendResult,
} from "../../../../../Server/Utils/SecurityEvent/Destinations/Types";
import { DataSourceHttpRequest } from "../../../../../Server/Utils/DataSource/HttpFetch";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import SecurityEventDestinationProvider from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import {
  FakeReply,
  FakeSiem,
  bodyLines,
  fakeSiem,
  noSleep,
  securityRecord,
  securityRecords,
} from "./FakeSiem";
import { describe, expect, test } from "@jest/globals";

/*
 * Splunk's HTTP Event Collector, as the sender talks to it: the token in
 * the Authorization header, a channel on every request, events one after
 * another in one body, and HEC's code read beside the HTTP status to know
 * whether to stop, split, go on past an event or try again. The fake
 * answers in HEC's own words.
 * https://docs.splunk.com/Documentation/Splunk/latest/Data/TroubleshootHTTPEventCollector
 */

const TOKEN: string = "00000000-1111-2222-3333-444444444444";

const SETTINGS: SecurityEventDestinationSettings = {
  provider: SecurityEventDestinationProvider.Splunk,
  config: {
    hecUrl: "https://splunk.example.com:8088",
    index: "security",
  },
  secrets: { hecToken: TOKEN },
};

const SUCCESS: FakeReply = { status: 200, body: { text: "Success", code: 0 } };

function sender(siem: FakeSiem): SplunkHecSender {
  return new SplunkHecSender({ transport: siem.transport, sleep: noSleep });
}

describe("the HEC endpoint", () => {
  test.each([
    [
      "https://splunk.example.com:8088",
      "https://splunk.example.com:8088/services/collector/event",
    ],
    [
      "https://splunk.example.com:8088/",
      "https://splunk.example.com:8088/services/collector/event",
    ],
    [
      "https://splunk.example.com:8088/services/collector",
      "https://splunk.example.com:8088/services/collector/event",
    ],
    [
      "https://splunk.example.com:8088/services/collector/event",
      "https://splunk.example.com:8088/services/collector/event",
    ],
    [
      "https://http-inputs-acme.splunkcloud.com",
      "https://http-inputs-acme.splunkcloud.com/services/collector/event",
    ],
  ])("%s -> %s", (pasted: string, endpoint: string) => {
    expect(splunkHecEventUrl(pasted)).toBe(endpoint);
  });
});

describe("a send", () => {
  test("posts the events in one body, with the token, a channel and through the egress guard", async () => {
    const siem: FakeSiem = fakeSiem(() => {
      return SUCCESS;
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(3),
    });

    expect(result).toMatchObject({
      processed: 3,
      sent: 3,
      rejected: 0,
      requests: 1,
      failure: "",
    });

    const request: DataSourceHttpRequest = siem.requests[0]!;

    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      "https://splunk.example.com:8088/services/collector/event",
    );
    expect(request.headers!["Authorization"]).toBe(`Splunk ${TOKEN}`);
    expect(request.headers!["X-Splunk-Request-Channel"]).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(request.egressOptions?.targetLabel).toBe("Splunk HEC");

    const events: Array<JSONObject> = bodyLines(request);

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      sourcetype: "oneuptime:security",
      index: "security",
      source: "oneuptime",
    });
  });

  test("uses the destination's own sourcetype when it has one", async () => {
    const siem: FakeSiem = fakeSiem(() => {
      return SUCCESS;
    });

    await sender(siem).send({
      settings: {
        ...SETTINGS,
        config: { ...SETTINGS.config, sourceType: "acme:oneuptime" },
      },
      events: [securityRecord()],
    });

    expect(bodyLines(siem.requests[0]!)[0]!["sourcetype"]).toBe(
      "acme:oneuptime",
    );
  });

  test("sends no more than 500 events in one request", async () => {
    const siem: FakeSiem = fakeSiem(() => {
      return SUCCESS;
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(1200),
    });

    expect(result.sent).toBe(1200);
    expect(
      siem.requests.map((request: DataSourceHttpRequest): number => {
        return bodyLines(request).length;
      }),
    ).toEqual([500, 500, 200]);
  });

  test("an event HEC finds malformed is left out; the ones before it were indexed and the rest are sent again", async () => {
    const siem: FakeSiem = fakeSiem(
      (_request: DataSourceHttpRequest, index: number) => {
        return index === 0
          ? {
              status: 400,
              body: {
                text: "Invalid data format",
                code: 6,
                "invalid-event-number": 2,
              },
            }
          : SUCCESS;
      },
    );

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(5),
    });

    expect(result).toMatchObject({
      processed: 5,
      sent: 4,
      rejected: 1,
      failure: "",
    });
    expect(result.rejectionReason).toContain("Invalid data format");
    // The two after the refused one, again.
    expect(bodyLines(siem.requests[1]!)).toHaveLength(2);
  });

  test("an event HEC cannot take (a blank event field) is found by splitting the batch", async () => {
    const bad: string = "Failed sign-in BAD";
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return String(request.body).includes(bad)
        ? {
            status: 400,
            body: { text: "Event field cannot be blank", code: 13 },
          }
        : SUCCESS;
    });

    const events: Array<ReturnType<typeof securityRecord>> = securityRecords(4);
    events[2] = securityRecord({ message: bad });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events,
    });

    expect(result).toMatchObject({ processed: 4, sent: 3, rejected: 1 });
    expect(result.rejectionReason).toContain("Event field cannot be blank");
  });

  test("an index the token may not write stops the send, saying what to change", async () => {
    const siem: FakeSiem = fakeSiem(() => {
      return { status: 400, body: { text: "Incorrect index", code: 7 } };
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(3),
    });

    expect(result.processed).toBe(0);
    expect(result.failure).toContain('Splunk refused the index "security"');
    expect(result.failure).toContain("leave Index empty");
    expect(siem.requests).toHaveLength(1);
  });

  test.each([
    [403, { text: "Invalid token", code: 4 }],
    [401, { text: "Token is required", code: 2 }],
    [403, { text: "Token disabled", code: 1 }],
  ])(
    "HTTP %s (%j) stops the send: the token is wrong",
    async (status: number, body: JSONObject) => {
      const siem: FakeSiem = fakeSiem(() => {
        return { status, body };
      });

      const result: SecurityEventSendResult = await sender(siem).send({
        settings: SETTINGS,
        events: securityRecords(2),
      });

      expect(result.failure).toContain("Splunk refused the HEC token");
      expect(result.failureStatus).toBe(status);
      expect(siem.requests).toHaveLength(1);
    },
  );

  test("a busy collector is tried again, then the send stops to go on next run", async () => {
    const siem: FakeSiem = fakeSiem(() => {
      return { status: 503, body: { text: "Server is busy", code: 9 } };
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(2),
    });

    expect(siem.requests).toHaveLength(3);
    expect(result.processed).toBe(0);
    expect(result.failure).toContain("Splunk is busy");
  });

  test("a collector that answers on the second try gets the events", async () => {
    const siem: FakeSiem = fakeSiem(
      (_request: DataSourceHttpRequest, index: number) => {
        return index === 0 ? { status: 503, body: { code: 9 } } : SUCCESS;
      },
    );

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(2),
    });

    expect(result).toMatchObject({ sent: 2, requests: 2, failure: "" });
  });

  test("a collector that cannot be reached stops the send with why", async () => {
    const siem: FakeSiem = fakeSiem(() => {
      return { status: 0, unreachable: true };
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(1),
    });

    expect(result.failure).toContain(
      "Could not reach Splunk's HTTP Event Collector: connect ECONNREFUSED",
    );
  });
});

describe("the settings", () => {
  test.each([
    [
      { hecUrl: "http://splunk.example.com:8088" },
      "HEC URL must start with https://",
    ],
    [{ hecUrl: "splunk" }, "HEC URL must be an absolute https URL"],
    [
      { hecUrl: "https://splunk.example.com:8088", index: "Security Logs" },
      "Index must be a Splunk index name",
    ],
    [
      { hecUrl: "https://splunk.example.com:8088", sourceType: "one uptime" },
      "Source type must be one word",
    ],
  ])("%j is refused", (config: JSONObject, message: string) => {
    expect(() => {
      sender(fakeSiem()).validateSettings({ ...SETTINGS, config });
    }).toThrow(message);
  });

  test("a token is required", () => {
    expect(() => {
      sender(fakeSiem()).validateSettings({ ...SETTINGS, secrets: {} });
    }).toThrow(BadDataException);
  });

  test("index names and sourcetypes as Splunk takes them", () => {
    expect(isSplunkIndexName("security")).toBe(true);
    expect(isSplunkIndexName("oneuptime_security-2")).toBe(true);
    expect(isSplunkIndexName("_internal")).toBe(false);
    expect(isSplunkIndexName("Security")).toBe(false);
    expect(isSplunkSourceType("oneuptime:security")).toBe(true);
    expect(isSplunkSourceType("a b")).toBe(false);
  });
});

describe("Send a test event", () => {
  test("sends one informational event, and says what to fix when Splunk refuses it", async () => {
    const siem: FakeSiem = fakeSiem(
      (_request: DataSourceHttpRequest, index: number) => {
        return index === 0
          ? SUCCESS
          : { status: 403, body: { text: "Invalid token", code: 4 } };
      },
    );

    await sender(siem).sendTestEvent(SETTINGS);

    const test: JSONObject = bodyLines(siem.requests[0]!)[0]!;

    expect((test["event"] as JSONObject)["message"]).toContain(
      "connection test: this destination can send security events to Splunk.",
    );
    expect((test["event"] as JSONObject)["severity"]).toBe("informational");

    await expect(sender(siem).sendTestEvent(SETTINGS)).rejects.toThrow(
      "Splunk refused the HEC token",
    );
  });

  test("is the sender the registry hands out for Splunk", () => {
    expect(
      SecurityEventDestinationRegistry.getSender(
        SecurityEventDestinationProvider.Splunk,
      ),
    ).toBeInstanceOf(SplunkHecSender);
  });

  test("a 404 says where HEC listens", () => {
    expect(
      describeSplunkSendFailure({
        ok: false,
        status: 404,
        bodyText: "",
        bodyJson: undefined,
      }),
    ).toContain("port 8088 on Splunk Enterprise");
  });
});
