import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import SessionReplayScrubService, {
  CompiledScrubRule,
} from "../../FeatureSet/Telemetry/Services/SessionReplayScrubService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import TraceScrubRuleService, {
  ExceptionContent,
} from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import {
  CoveringScrubRule,
  findCoveringScrubRule,
  isFindingScrubbed,
} from "Common/Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import {
  findSensitiveValues,
  TextMatch,
} from "Common/Utils/DataSecurity/TextScanner";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * IP ADDRESS RULES HIDE AN ADDRESS WITH ONE GROUP EACH SIDE OF "::" (#10466)
 * AND ONE IN A PERCENT-ENCODED URL (#10467), WHEREVER THEY RUN.
 *
 * Every place an IP Address rule runs finds its matches with one function
 * (ScrubIpAddress.findRanges, on Data Security's own detectors), so both
 * changes reach each of them, and these tests read each one, under Redact,
 * Mask and Hash:
 *
 *   - logs: the body (plain text and JSON text) and the attributes, lists
 *     and JSON texts among them;
 *   - spans: the name, the status message, the attributes, the events and
 *     the links, and the identity columns copied out of the attributes;
 *   - exceptions: the message, stack trace, type and attributes an
 *     exception copies from its span's event;
 *   - AI calls: the messages a gen_ai span carries as JSON text;
 *   - session replays, which the log rules scrub;
 *   - ingest itself: OTLP logs and traces through their ingest services.
 *
 * Metrics are not here: no IP Address rule runs on a metric (a metric
 * pipeline rule redacts an attribute by its key). And Data Security's
 * coverage says an IP address finding is scrubbed only where the rule in
 * fact hides it, which the last tests read.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000a10466",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000a10467",
);
const SERVICE_NAME: string = "checkout-api";

const IPV4_MASK: string = "***.***.***.***";
const IPV6_MASK: string = "****:****:****:****:****:****:****:****";

// An address as it is written, and the address it is: what its token is made of.
interface Address {
  label: string;
  written: string;
  address: string;
}

const ADDRESSES: Array<Address> = [
  {
    label: "one group each side of ::",
    written: "2001::1",
    address: "2001::1",
  },
  {
    label: "another one-group address",
    written: "2a00::1",
    address: "2a00::1",
  },
  {
    label: "an IPv6 address, its colons encoded",
    written: "2606%3A4700%3A%3A1111",
    address: "2606:4700::1111",
  },
  {
    label: "a one-group address, encoded",
    written: "2001%3A%3A1",
    address: "2001::1",
  },
  {
    label: "an IPv4 address, its dots encoded",
    written: "8%2E8%2E8%2E8",
    address: "8.8.8.8",
  },
  {
    label: "an IPv4 address written as IPv6, encoded",
    written: "%3A%3Affff%3A8.8.8.8",
    address: "8.8.8.8",
  },
];

// What no rule hides: no one's address, or no address at all.
const KEPT: Array<string> = [
  "fe80::1",
  "fd00::1",
  "fe80%3A%3A1",
  "10%2E0%2E0%2E1",
  "%3A%3Affff%3A10.0.0.1",
  "Abc::Def",
  "v1::api",
  "12%3A30%3A45",
  "http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F",
];

const ACTIONS: Array<string> = [
  LogScrubAction.Redact,
  LogScrubAction.Mask,
  LogScrubAction.Hash,
];

const CASES: Array<[string, Address, string]> = ACTIONS.flatMap(
  (action: string): Array<[string, Address, string]> => {
    return ADDRESSES.map((address: Address): [string, Address, string] => {
      return [address.label, address, action];
    });
  },
);

type OtlpAttribute = { key: string; value: { stringValue: string } };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

function regexOf(service: unknown, patternType: string): ScrubRegExp {
  const regex: ScrubRegExp | null = (
    service as {
      getRegexForPattern: (patternType: string) => ScrubRegExp | null;
    }
  ).getRegexForPattern(patternType);

  expect(regex).not.toBeNull();

  return regex as ScrubRegExp;
}

function logRules(action: string, fields: string = LogScrubField.Both): never {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = "Scrub IP addresses";
  rule.projectId = PROJECT_ID;
  rule.patternType = LogScrubPatternType.IPAddress;
  rule.scrubAction = action;
  rule.fieldsToScrub = fields;

  return [
    {
      rule: rule,
      regex: regexOf(LogScrubRuleService, LogScrubPatternType.IPAddress),
    },
  ] as never;
}

function traceRules(
  action: string,
  fields: string = TraceScrubField.All,
): never {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = "Scrub IP addresses";
  rule.projectId = PROJECT_ID;
  rule.patternType = TraceScrubPatternType.IPAddress;
  rule.scrubAction = action;
  rule.fieldsToScrub = fields;

  return [
    {
      rule: rule,
      regex: regexOf(TraceScrubRuleService, TraceScrubPatternType.IPAddress),
    },
  ] as never;
}

function token(address: string): string {
  return ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address });
}

// What a rule of PROJECT_ID leaves of an address, however it is written.
function expectedOf(address: Address, action: string): string {
  if (action === LogScrubAction.Redact) {
    return "[REDACTED]";
  }

  if (action === LogScrubAction.Mask) {
    return address.address.includes(":") ? IPV6_MASK : IPV4_MASK;
  }

  return token(address.address);
}

function ipFindings(text: string): Array<TextMatch> {
  return findSensitiveValues(text).filter((match: TextMatch): boolean => {
    return match.dataTypeId === "ip-address";
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("one token for an address, however it is written", () => {
  test.each(
    ADDRESSES.map((address: Address): [string, Address] => {
      return [address.label, address];
    }),
  )("%s", (_label: string, address: Address) => {
    expect(token(address.written)).toBe(token(address.address));
  });
});

describe("the log engine", () => {
  test.each(CASES)(
    "hides %s under %s in the body, the attributes and a list",
    (_label: string, address: Address, action: string) => {
      const row: JSONObject = LogScrubRuleService.scrubLog(
        {
          body: `request from ${address.written} done`,
          attributes: {
            "client.address": address.written,
            "http.request.header.x-forwarded-for": [
              address.written,
              "10.0.0.1",
            ],
          },
        },
        logRules(action),
      );
      const hidden: string = expectedOf(address, action);

      expect(row["body"]).toBe(`request from ${hidden} done`);
      expect(row["attributes"]).toEqual({
        "client.address": hidden,
        "http.request.header.x-forwarded-for": [hidden, "10.0.0.1"],
      });
    },
  );

  test.each(KEPT)(
    "keeps %s in the body and the attributes, under every action",
    (kept: string) => {
      for (const action of ACTIONS) {
        const record: () => JSONObject = (): JSONObject => {
          return {
            body: `request from ${kept} done`,
            attributes: { "client.address": kept },
          };
        };

        expect(
          LogScrubRuleService.scrubLog(record(), logRules(action)),
        ).toEqual(record());
      }
    },
  );

  test("hides exactly the encoded address of a URL a log line holds, and keeps the rest of it", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "GET /cb?target=http%3A%2F%2F%5B2606%3A4700%3A%3A1111%5D%3A8443%2F&peer=2001::1 200",
        attributes: {
          "url.query": "redirect=https%3A%2F%2F%5B2001%3Adb8%3A%3A7%5D%2Fhome",
        },
      },
      logRules(LogScrubAction.Redact),
    );

    expect(row["body"]).toBe(
      "GET /cb?target=http%3A%2F%2F%5B[REDACTED]%5D%3A8443%2F&peer=[REDACTED] 200",
    );
    expect((row["attributes"] as JSONObject)["url.query"]).toBe(
      "redirect=https%3A%2F%2F%5B[REDACTED]%5D%2Fhome",
    );
  });

  test("keeps a JSON body JSON, its encoded and one-group addresses hidden", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: JSON.stringify({
          url: "http%3A%2F%2F%5B2606%3A4700%3A%3A1111%5D%2F",
          client: "2001::1",
          peer: "fe80%3A%3A1",
          n: 1,
        }),
        attributes: {
          "http.request.body": JSON.stringify({
            ip: "2a00::1",
            hop: "10.0.0.1",
          }),
        },
      },
      logRules(LogScrubAction.Redact),
    );

    expect(JSON.parse(row["body"] as string)).toEqual({
      url: "http%3A%2F%2F%5B[REDACTED]%5D%2F",
      client: "[REDACTED]",
      peer: "fe80%3A%3A1",
      n: 1,
    });
    expect(
      JSON.parse(
        (row["attributes"] as JSONObject)["http.request.body"] as string,
      ),
    ).toEqual({ ip: "[REDACTED]", hop: "10.0.0.1" });
  });

  test("a Body Only rule leaves the attributes, an Attributes Only rule the body", () => {
    const record: () => JSONObject = (): JSONObject => {
      return {
        body: "from 2001%3A%3A1",
        attributes: { "client.address": "2a00::1" },
      };
    };

    expect(
      LogScrubRuleService.scrubLog(
        record(),
        logRules(LogScrubAction.Redact, LogScrubField.Body),
      ),
    ).toEqual({
      body: "from [REDACTED]",
      attributes: { "client.address": "2a00::1" },
    });
    expect(
      LogScrubRuleService.scrubLog(
        record(),
        logRules(LogScrubAction.Redact, LogScrubField.Attributes),
      ),
    ).toEqual({
      body: "from 2001%3A%3A1",
      attributes: { "client.address": "[REDACTED]" },
    });
  });
});

describe("the trace engine", () => {
  function spanRow(written: string): JSONObject {
    return {
      name: `GET from ${written}`,
      statusMessage: `refused by ${written}`,
      attributes: { "client.address": written, "net.peer.ip": written },
      events: [
        {
          name: `retrying after ${written} refused`,
          attributes: { "exception.message": `connect ${written} refused` },
        },
      ],
      links: [{ attributes: { "peer.address": written } }],
    };
  }

  test.each(CASES)(
    "hides %s under %s in the name, status message, attributes, events and links",
    (_label: string, address: Address, action: string) => {
      const hidden: string = expectedOf(address, action);

      expect(
        TraceScrubRuleService.scrubSpan(
          spanRow(address.written),
          traceRules(action),
        ),
      ).toEqual({
        name: `GET from ${hidden}`,
        statusMessage: `refused by ${hidden}`,
        attributes: { "client.address": hidden, "net.peer.ip": hidden },
        events: [
          {
            name: `retrying after ${hidden} refused`,
            attributes: { "exception.message": `connect ${hidden} refused` },
          },
        ],
        links: [{ attributes: { "peer.address": hidden } }],
      });
    },
  );

  test.each(KEPT)(
    "keeps %s everywhere in a span, under every action",
    (kept: string) => {
      for (const action of ACTIONS) {
        expect(
          TraceScrubRuleService.scrubSpan(spanRow(kept), traceRules(action)),
        ).toEqual(spanRow(kept));
      }
    },
  );

  test.each(CASES)(
    "hides %s under %s in an exception's message, stack trace, type and attributes",
    (_label: string, address: Address, action: string) => {
      const hidden: string = expectedOf(address, action);
      const content: ExceptionContent =
        TraceScrubRuleService.scrubExceptionContent(
          {
            message: `connect ${address.written} refused from 10.0.0.12`,
            stackTrace: `at dial (net.js:1) peer=${address.written}`,
            exceptionType: `ECONNREFUSED ${address.written}`,
            attributes: { "server.address": address.written },
          },
          traceRules(action, TraceScrubField.Events),
        );

      expect(content).toEqual({
        message: `connect ${hidden} refused from 10.0.0.12`,
        stackTrace: `at dial (net.js:1) peer=${hidden}`,
        exceptionType: `ECONNREFUSED ${hidden}`,
        attributes: { "server.address": hidden },
      });
    },
  );

  test("an AI call's messages stay JSON, its addresses hidden, and so does a user id copied from an attribute", () => {
    const messages: string = JSON.stringify([
      {
        role: "user",
        content:
          "fetch http%3A%2F%2F%5B2606%3A4700%3A%3A1111%5D%2F from 2001::1 behind 10.0.0.1",
      },
    ]);
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "chat",
        attributes: { "gen_ai.input.messages": messages, "user.id": "2a00::1" },
        llmUserId: "2a00::1",
        events: [],
        links: [],
      },
      traceRules(TraceScrubAction.Redact),
    );

    expect(
      JSON.parse(
        (row["attributes"] as JSONObject)["gen_ai.input.messages"] as string,
      ),
    ).toEqual([
      {
        role: "user",
        content:
          "fetch http%3A%2F%2F%5B[REDACTED]%5D%2F from [REDACTED] behind 10.0.0.1",
      },
    ]);
    expect((row["attributes"] as JSONObject)["user.id"]).toBe("[REDACTED]");
    expect(row["llmUserId"]).toBe("[REDACTED]");
  });
});

describe("a session replay, which the log rules scrub", () => {
  test.each(ACTIONS)(
    "hides both shapes under %s, and keeps what is no one's",
    async (action: string) => {
      const events: Array<JSONValue> = [
        {
          text: "visit http%3A%2F%2F%5B2606%3A4700%3A%3A1111%5D%2F from 2001::1",
        },
        { text: "fe80%3A%3A1 Abc::Def 10%2E0%2E0%2E1" },
      ];
      const rules: Array<CompiledScrubRule> = logRules(
        action,
      ) as unknown as Array<CompiledScrubRule>;

      await SessionReplayScrubService.scrubEvents(events, rules);

      const encoded: Address = ADDRESSES[2]!;
      const short: Address = ADDRESSES[0]!;

      expect((events[0] as JSONObject)["text"]).toBe(
        `visit http%3A%2F%2F%5B${expectedOf(encoded, action)}%5D%2F from ${expectedOf(short, action)}`,
      );
      expect((events[1] as JSONObject)["text"]).toBe(
        "fe80%3A%3A1 Abc::Def 10%2E0%2E0%2E1",
      );
    },
  );
});

describe("Data Security's coverage is true for both shapes", () => {
  const LOG_RULE: CoveringScrubRule = {
    id: "rule-log-ip",
    name: "Scrub IP addresses",
    signal: "log",
    patternType: LogScrubPatternType.IPAddress,
    fieldsToScrub: LogScrubField.Both,
  };
  const TRACE_RULE: CoveringScrubRule = {
    id: "rule-trace-ip",
    name: "Scrub IP addresses",
    signal: "trace",
    patternType: TraceScrubPatternType.IPAddress,
    fieldsToScrub: TraceScrubField.All,
  };

  test.each([
    ["client 2001::1 connected"],
    ["client 2606::1 connected"],
    ["GET /cb?target=http%3A%2F%2F%5B2606%3A4700%3A%3A1111%5D%2F"],
    ["peer=8%2E8%2E8%2E8"],
  ])(
    "a log body's finding in %s is covered, and the rule leaves no finding",
    (body: string) => {
      expect(ipFindings(body)).toHaveLength(1);
      expect(
        isFindingScrubbed(
          { rules: [LOG_RULE] },
          {
            kind: DataStoreKind.TelemetryLogs,
            dataTypeId: "ip-address",
            location: "body",
          },
        ),
      ).toBe(true);

      for (const action of ACTIONS) {
        const row: JSONObject = LogScrubRuleService.scrubLog(
          { body: body, attributes: {} },
          logRules(action),
        );

        expect([action, ipFindings(row["body"] as string)]).toEqual([
          action,
          [],
        ]);
      }
    },
  );

  test("a span attribute's encoded finding is covered, and the rule leaves no finding", () => {
    const query: string = "next=http%3A%2F%2F%5B2a00%3A%3A1%5D%2F";

    expect(ipFindings(query)).toHaveLength(1);
    expect(
      findCoveringScrubRule(
        { rules: [TRACE_RULE] },
        {
          kind: DataStoreKind.TelemetryTraces,
          dataTypeId: "ip-address",
          location: "attributes.url.query",
        },
      ),
    ).toEqual(TRACE_RULE);

    for (const action of ACTIONS) {
      const row: JSONObject = TraceScrubRuleService.scrubSpan(
        {
          name: "GET /",
          attributes: { "url.query": query },
          events: [],
          links: [],
        },
        traceRules(action),
      );

      expect([
        action,
        ipFindings((row["attributes"] as JSONObject)["url.query"] as string),
      ]).toEqual([action, []]);
    }
  });

  test("what is no one's, encoded or not, is no finding, so no rule is asked to hide it", () => {
    for (const kept of KEPT) {
      expect([kept, ipFindings(`peer ${kept}`)]).toEqual([kept, []]);
    }
  });
});

describe("through log and trace ingest", () => {
  const AUTO_DISCOVERY_METHODS: Array<string> = [
    "autoDiscoverKubernetesCluster",
    "autoDiscoverDockerHost",
    "autoDiscoverPodmanHost",
    "autoDiscoverProxmoxCluster",
    "autoDiscoverVMwareVCenter",
    "autoDiscoverCephCluster",
    "autoDiscoverStorageArray",
    "autoDiscoverDockerSwarmCluster",
    "autoDiscoverHost",
    "autoDiscoverServerless",
    "autoDiscoverCloudResource",
    "autoDiscoverRum",
    "autoDiscoverDatabaseServer",
  ];

  let logRows: Array<JSONObject> = [];
  let spanRows: Array<JSONObject> = [];
  let exceptionRows: Array<JSONObject> = [];

  function attribute(key: string, value: string): OtlpAttribute {
    return { key: key, value: { stringValue: value } };
  }

  function setupIngest(data: {
    logRules?: never | undefined;
    traceRules?: never | undefined;
  }): void {
    for (const ingestService of [
      OtelLogsIngestService,
      OtelTracesIngestService,
    ]) {
      const service: IngestTestMethods =
        ingestService as unknown as IngestTestMethods;

      for (const method of AUTO_DISCOVERY_METHODS) {
        jest.spyOn(service, method).mockResolvedValue(null);
      }

      jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
        serviceName: SERVICE_NAME,
        primaryEntityId: new ObjectID(SERVICE_ID.toString()),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      });
    }

    jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
    jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
    jest
      .spyOn(LogScrubRuleService, "loadScrubRules")
      .mockResolvedValue(data.logRules || ([] as never));
    jest.spyOn(TracePipelineService, "loadPipelines").mockResolvedValue([]);
    jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
    jest
      .spyOn(TraceScrubRuleService, "loadScrubRules")
      .mockResolvedValue(data.traceRules || ([] as never));
    jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
    jest
      .spyOn(TelemetryFanInWriter, "submit")
      .mockImplementation(
        async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
          if (target === LogService) {
            logRows.push(...batch);
          } else if (target === SpanService) {
            spanRows.push(...batch);
          } else if (target === ExceptionInstanceService) {
            exceptionRows.push(...batch);
          } else {
            throw new Error(
              `unexpected fan-in target ${target.model.tableName}`,
            );
          }

          return { flushed: Promise.resolve() };
        },
      );
    jest
      .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
      .mockImplementation(
        async (_payloads: Array<TelemetryExceptionPayload>): Promise<void> => {
          // The exception's group: not what these tests read.
        },
      );
    jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  }

  function request(body: JSONObject): TelemetryRequest {
    return {
      projectId: new ObjectID(PROJECT_ID.toString()),
      body: body,
      headers: {},
    } as unknown as TelemetryRequest;
  }

  beforeEach(() => {
    logRows = [];
    spanRows = [];
    exceptionRows = [];
  });

  test("a log's encoded and one-group addresses are stored as the project's tokens, what is no one's as it came", async () => {
    setupIngest({ logRules: logRules(LogScrubAction.Hash) });

    await OtelLogsIngestService.processLogsFromQueue(
      request({
        resourceLogs: [
          {
            resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
            scopeLogs: [
              {
                scope: {},
                logRecords: [
                  {
                    timeUnixNano: `${Date.now()}000000`,
                    severityNumber: 9,
                    body: {
                      stringValue:
                        "GET /cb?target=http%3A%2F%2F%5B2606%3A4700%3A%3A1111%5D%2F from 2001::1 via 10.0.0.12",
                    },
                    attributes: [
                      attribute("client.address", "2a00::1"),
                      attribute("url.query", "peer=8%2E8%2E8%2E8"),
                      attribute("server.address", "fe80%3A%3A1"),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(logRows).toHaveLength(1);

    const row: JSONObject = logRows[0]!;
    const attributes: JSONObject = row["attributes"] as JSONObject;

    expect(row["body"]).toBe(
      `GET /cb?target=http%3A%2F%2F%5B${token("2606:4700::1111")}%5D%2F from ${token("2001::1")} via 10.0.0.12`,
    );
    expect(attributes["client.address"]).toBe(token("2a00::1"));
    expect(attributes["url.query"]).toBe(`peer=${token("8.8.8.8")}`);
    expect(attributes["server.address"]).toBe("fe80%3A%3A1");
    expect(JSON.stringify(row)).not.toContain("2606%3A4700");
    expect(JSON.stringify(row)).not.toContain("2001::1");
    expect(JSON.stringify(row)).not.toContain("8%2E8%2E8%2E8");
  });

  test("a span's and its exception's addresses are hidden, and the encoded metadata address stays for Security Events", async () => {
    setupIngest({ traceRules: traceRules(TraceScrubAction.Redact) });

    const nowNano: string = `${Date.now()}000000`;

    await OtelTracesIngestService.processTracesFromQueue(
      request({
        resourceSpans: [
          {
            resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
            scopeSpans: [
              {
                scope: {},
                spans: [
                  {
                    traceId: "0af7651916cd43dd8448eb211c80319c",
                    spanId: "b7ad6b7169203331",
                    parentSpanId: "",
                    name: "GET /fetch",
                    kind: 2,
                    startTimeUnixNano: nowNano,
                    endTimeUnixNano: nowNano,
                    status: { code: 2, message: "upstream 2606::1 refused" },
                    attributes: [
                      attribute("http.request.method", "GET"),
                      attribute("url.path", "/fetch"),
                      attribute(
                        "url.query",
                        "target=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F&from=http%3A%2F%2F%5B2a00%3A%3A1%5D",
                      ),
                      attribute("client.address", "2001::1"),
                    ],
                    events: [
                      {
                        name: "exception",
                        timeUnixNano: nowNano,
                        attributes: [
                          attribute(
                            "exception.message",
                            "connect http%3A%2F%2F%5B2606%3A4700%3A%3A1111%5D refused",
                          ),
                          attribute("exception.type", "ECONNREFUSED"),
                          attribute(
                            "exception.stacktrace",
                            "Error: connect 2001::1\n    at dial (net.js:10:5)",
                          ),
                        ],
                      },
                    ],
                    links: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(spanRows).toHaveLength(1);

    const row: JSONObject = spanRows[0]!;
    const attributes: JSONObject = row["attributes"] as JSONObject;

    expect(row["statusMessage"]).toBe("upstream [REDACTED] refused");
    expect(attributes["client.address"]).toBe("[REDACTED]");
    expect(attributes["url.query"]).toBe(
      "target=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F&from=http%3A%2F%2F%5B[REDACTED]%5D",
    );
    expect(exceptionRows).toHaveLength(1);
    expect(exceptionRows[0]!["message"]).toBe(
      "connect http%3A%2F%2F%5B[REDACTED]%5D refused",
    );
    expect(String(exceptionRows[0]!["stackTrace"])).toContain(
      "connect [REDACTED]",
    );
    expect(JSON.stringify(exceptionRows[0])).not.toContain("2606%3A4700");
  });
});
