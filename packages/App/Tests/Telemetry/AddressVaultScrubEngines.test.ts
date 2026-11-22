import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import { ScrubHashedAddressRecorder } from "Common/Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WHAT THE LOG AND TRACE SCRUB ENGINES TELL SECURITY EVENTS' ADDRESS VAULT
 * (#10395).
 *
 * An ingest batch whose logs or traces Security Events reads hands the
 * engines a recorder, and the engines tell it each IP address an IP
 * Address Hash rule hides, with the token it leaves - wherever in the
 * record the rule reaches, and nothing else. The record is scrubbed
 * exactly the same with a recorder or without one.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

interface Told {
  token: string;
  address: string;
}

class ListRecorder implements ScrubHashedAddressRecorder {
  public told: Array<Told> = [];

  public recordHashedAddress(data: Told): void {
    this.told.push(data);
  }

  public addresses(): Array<string> {
    return Array.from(
      new Set(
        this.told.map((told: Told): string => {
          return told.address;
        }),
      ),
    ).sort();
  }
}

function tokenOf(address: string): string {
  return ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address });
}

type CompiledRule = { rule: LogScrubRule | TraceScrubRule; regex: ScrubRegExp };

function compile(
  service: unknown,
  rule: LogScrubRule | TraceScrubRule,
): CompiledRule {
  const regex: ScrubRegExp | null = (
    service as {
      getRegexForPattern: (
        patternType: string,
        customRegex?: string,
      ) => ScrubRegExp | null;
    }
  ).getRegexForPattern(rule.patternType as string, rule.customRegex);

  expect(regex).not.toBeNull();

  return { rule, regex: regex as ScrubRegExp };
}

function logRule(data: {
  patternType: string;
  action: string;
  fields?: string | undefined;
  customRegex?: string | undefined;
}): never {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = `${data.patternType} ${data.action}`;
  rule.projectId = PROJECT_ID;
  rule.patternType = data.patternType;
  rule.scrubAction = data.action;
  rule.fieldsToScrub = data.fields || LogScrubField.Both;
  if (data.customRegex !== undefined) {
    rule.customRegex = data.customRegex;
  }

  return compile(LogScrubRuleService, rule) as never;
}

function traceRule(data: {
  patternType: string;
  action: string;
  fields?: string | undefined;
  customRegex?: string | undefined;
}): never {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = `${data.patternType} ${data.action}`;
  rule.projectId = PROJECT_ID;
  rule.patternType = data.patternType;
  rule.scrubAction = data.action;
  rule.fieldsToScrub = data.fields || TraceScrubField.All;
  if (data.customRegex !== undefined) {
    rule.customRegex = data.customRegex;
  }

  return compile(TraceScrubRuleService, rule) as never;
}

const IP_HASH_LOG: () => never = (): never => {
  return logRule({
    patternType: LogScrubPatternType.IPAddress,
    action: LogScrubAction.Hash,
  });
};

const IP_HASH_TRACE: () => never = (): never => {
  return traceRule({
    patternType: LogScrubPatternType.IPAddress,
    action: LogScrubAction.Hash,
  });
};

function logRow(): JSONObject {
  return {
    projectId: PROJECT_ID.toString(),
    body: '203.0.113.7 - - [20/Nov/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0" via 10.0.0.12',
    attributes: {
      "client.address": "::ffff:198.51.100.9",
      "net.peer.ip": "169.254.169.254",
      "http.request.headers": ["x-real-ip: 2001:DB8::7", "accept: */*"],
      "upstream.list": { primary: "192.0.2.10", backup: "fe80::1%eth0" },
      "http.request.body": '{"forwarded":"192.0.2.44","note":"from 10.1.1.1"}',
    },
  };
}

const LOG_ADDRESSES: Array<string> = [
  "192.0.2.10",
  "192.0.2.44",
  "198.51.100.9",
  "2001:db8::7",
  "203.0.113.7",
];

function spanRow(): JSONObject {
  return {
    projectId: PROJECT_ID.toString(),
    name: "GET /proxy 198.51.100.21",
    statusMessage: "upstream 192.0.2.30 refused",
    attributes: {
      "client.address": "203.0.113.7",
      "server.address": "10.0.0.5",
      "url.query": "target=http://169.254.169.254/latest/meta-data/",
    },
    events: [
      {
        name: "retry after 192.0.2.31",
        attributes: { "exception.message": "connect 2001:db8::99 refused" },
      },
    ],
    links: [{ attributes: { "peer.address": "198.51.100.22" } }],
    llmUserId: "user from 192.0.2.32",
    llmUserEmail: "",
    llmTeam: "",
  };
}

const SPAN_ADDRESSES: Array<string> = [
  "192.0.2.30",
  "192.0.2.31",
  "192.0.2.32",
  "198.51.100.21",
  "198.51.100.22",
  "2001:db8::99",
  "203.0.113.7",
];

describe("the log engine", () => {
  test("tells each address an IP Address Hash rule hides, with its token, from the body and every attribute", () => {
    const recorder: ListRecorder = new ListRecorder();

    const row: JSONObject = LogScrubRuleService.scrubLog(
      logRow(),
      [IP_HASH_LOG()],
      recorder,
    );

    expect(recorder.addresses()).toEqual(LOG_ADDRESSES);

    for (const told of recorder.told) {
      expect(told.token).toBe(tokenOf(told.address));
      // The token told is the one the row keeps.
      expect(JSON.stringify(row)).toContain(told.token);
    }

    // Private, loopback and link-local addresses are kept, and told nothing (#10393).
    expect(recorder.addresses()).not.toContain("10.0.0.12");
    expect(recorder.addresses()).not.toContain("169.254.169.254");
  });

  test("the row is scrubbed the same with a recorder or without one", () => {
    const withRecorder: JSONObject = LogScrubRuleService.scrubLog(
      logRow(),
      [IP_HASH_LOG()],
      new ListRecorder(),
    );
    const without: JSONObject = LogScrubRuleService.scrubLog(logRow(), [
      IP_HASH_LOG(),
    ]);

    expect(withRecorder).toEqual(without);

    for (const address of LOG_ADDRESSES) {
      expect(JSON.stringify(withRecorder)).not.toContain(address);
    }
  });

  test("a body-only rule tells only the body's addresses", () => {
    const recorder: ListRecorder = new ListRecorder();

    LogScrubRuleService.scrubLog(
      logRow(),
      [
        logRule({
          patternType: LogScrubPatternType.IPAddress,
          action: LogScrubAction.Hash,
          fields: LogScrubField.Body,
        }),
      ],
      recorder,
    );

    expect(recorder.addresses()).toEqual(["203.0.113.7"]);
  });

  test.each([
    ["Redact", LogScrubAction.Redact],
    ["Mask", LogScrubAction.Mask],
  ])(
    "an IP Address rule that does %s tells nothing: it leaves nothing to look up",
    (_label: string, action: string) => {
      const recorder: ListRecorder = new ListRecorder();

      LogScrubRuleService.scrubLog(
        logRow(),
        [logRule({ patternType: LogScrubPatternType.IPAddress, action })],
        recorder,
      );

      expect(recorder.told).toEqual([]);
    },
  );

  test("a custom pattern that hashes addresses tells nothing: only an IP Address rule's token is resolvable", () => {
    const recorder: ListRecorder = new ListRecorder();

    const row: JSONObject = LogScrubRuleService.scrubLog(
      logRow(),
      [
        logRule({
          patternType: LogScrubPatternType.Custom,
          action: LogScrubAction.Hash,
          customRegex: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b",
        }),
      ],
      recorder,
    );

    expect(String(row["body"])).toMatch(/^\[HASHED:[0-9a-f]{16}\]/);
    expect(recorder.told).toEqual([]);
  });

  test("another pattern's hash, and a sensitive key's, tell nothing", () => {
    const recorder: ListRecorder = new ListRecorder();
    const row: JSONObject = logRow();
    (row["attributes"] as JSONObject)["password"] = "203.0.113.200";
    (row["attributes"] as JSONObject)["user.email"] = "ada@example.com";

    LogScrubRuleService.scrubLog(
      row,
      [
        logRule({
          patternType: LogScrubPatternType.SensitiveKeys,
          action: LogScrubAction.Hash,
        }),
        logRule({
          patternType: LogScrubPatternType.Email,
          action: LogScrubAction.Hash,
        }),
      ],
      recorder,
    );

    expect(recorder.told).toEqual([]);
  });

  test("after a rule that redacts, a Hash rule has no address left to tell", () => {
    const recorder: ListRecorder = new ListRecorder();

    LogScrubRuleService.scrubLog(
      logRow(),
      [
        logRule({
          patternType: LogScrubPatternType.IPAddress,
          action: LogScrubAction.Redact,
        }),
        IP_HASH_LOG(),
      ],
      recorder,
    );

    expect(recorder.told).toEqual([]);
  });
});

describe("the trace engine", () => {
  test("tells each address an IP Address Hash rule hides: name, status, attributes, events, links and identity columns", () => {
    const recorder: ListRecorder = new ListRecorder();

    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      spanRow(),
      [IP_HASH_TRACE()],
      recorder,
    );

    expect(recorder.addresses()).toEqual(SPAN_ADDRESSES);

    for (const told of recorder.told) {
      expect(told.token).toBe(tokenOf(told.address));
    }

    for (const address of SPAN_ADDRESSES) {
      expect(JSON.stringify(row)).not.toContain(address);
    }

    // The metadata address stays, for Security Events' SSRF detection.
    expect((row["attributes"] as JSONObject)["url.query"]).toBe(
      "target=http://169.254.169.254/latest/meta-data/",
    );
  });

  test("the span is scrubbed the same with a recorder or without one", () => {
    expect(
      TraceScrubRuleService.scrubSpan(
        spanRow(),
        [IP_HASH_TRACE()],
        new ListRecorder(),
      ),
    ).toEqual(TraceScrubRuleService.scrubSpan(spanRow(), [IP_HASH_TRACE()]));
  });

  test.each([
    [TraceScrubField.Name, ["198.51.100.21"]],
    [
      TraceScrubField.Attributes,
      ["192.0.2.32", "198.51.100.22", "203.0.113.7"],
    ],
    [TraceScrubField.Events, ["2001:db8::99"]],
  ])(
    "a rule of %s tells the addresses of what it reaches",
    (fields: string, addresses: Array<string>) => {
      const recorder: ListRecorder = new ListRecorder();

      TraceScrubRuleService.scrubSpan(
        spanRow(),
        [
          traceRule({
            patternType: LogScrubPatternType.IPAddress,
            action: LogScrubAction.Hash,
            fields,
          }),
        ],
        recorder,
      );

      expect(recorder.addresses()).toEqual(addresses);
    },
  );

  test.each([
    ["Redact", LogScrubAction.Redact],
    ["Mask", LogScrubAction.Mask],
  ])("a rule that does %s tells nothing", (_label: string, action: string) => {
    const recorder: ListRecorder = new ListRecorder();

    TraceScrubRuleService.scrubSpan(
      spanRow(),
      [traceRule({ patternType: LogScrubPatternType.IPAddress, action })],
      recorder,
    );

    expect(recorder.told).toEqual([]);
  });

  test("an exception's copy of an event is scrubbed as before, and takes no recorder", () => {
    const scrubbed: {
      message: string;
      stackTrace: string;
      attributes: JSONObject;
    } = TraceScrubRuleService.scrubExceptionContent(
      {
        message: "connect 2001:db8::99 refused",
        stackTrace: "Error: connect 2001:db8::99",
        attributes: {},
      },
      [IP_HASH_TRACE()],
    );

    expect(scrubbed.message).toBe(`connect ${tokenOf("2001:db8::99")} refused`);
    /*
     * Its content, its rules and the service of the span it was copied
     * from (#10433), whose rules scrub it: no recorder.
     */
    expect(TraceScrubRuleService.scrubExceptionContent.length).toBe(3);
  });
});
