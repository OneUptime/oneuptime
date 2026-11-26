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
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
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
 * SCRUB RULES HIDE WHAT DATA SECURITY NOW FINDS, WHEREVER THEY RUN.
 *
 *   - an IPv6 address right after a key's colon, as logfmt and syslog
 *     lines write one (peer ip:2a00:..., remote:2606:..., #10936), by an
 *     IP Address rule - the address alone, not the key's last letters;
 *   - an email address in a percent-encoded URL
 *     (/signup?email=jane.doe%40acmecorp.io, #10935) and one in any script
 *     (张伟@acmecorp.io, почта@пример.рф, #10960), by an Email Address rule
 *     - the encoded address as written, and the rest of the URL kept;
 *   - a card in fullwidth, Arabic-Indic or Persian digits, or typed in two
 *     scripts (#10960), by a Credit Card rule;
 *   - an international phone number in the groups people write it in - its
 *     calling code in parentheses, its trunk prefix, no-break spaces - one
 *     in a percent-encoded URL, and one in another script's digits (#11025,
 *     #11030), by a Phone Number rule; and a Social Security number set
 *     apart by dots or in another script's digits, by an SSN rule.
 *
 * Every place a rule runs compiles its pattern in one place
 * (Common/Utils/Telemetry/ScrubBuiltInPatterns, on Data Security's own
 * detectors through TextReadings.findDetectorRanges), so each change
 * reaches each place, and these tests read each one under Redact, Mask and
 * Hash - Hash giving the token of the value written plainly: logs (body,
 * attributes, lists, JSON texts), spans (name, status message, attributes,
 * events, links), exceptions, AI calls, session replays, and OTLP ingest.
 * Data Security's coverage of each is true: the rule leaves no finding.
 * Metrics: DataSecurityMetricScrubRuleIngest.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000a10935",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000a10960",
);
const SERVICE_NAME: string = "checkout-api";
const IPV6_MASK: string = "****:****:****:****:****:****:****:****";

// A value as it is written, what reads before it, what its token is made of, and its mask.
interface Written {
  label: string;
  patternType: string;
  dataTypeId: string;
  before: string;
  written: string;
  reads: string;
  mask: string;
}

const WRITTEN: Array<Written> = [
  {
    label: "an IPv6 address right after a key's colon",
    patternType: LogScrubPatternType.IPAddress,
    dataTypeId: "ip-address",
    before: "peer ip:",
    written: "2a00:1450:4001:82a::200e",
    reads: "2a00:1450:4001:82a::200e",
    mask: IPV6_MASK,
  },
  {
    label: "one after a key that ends in a hex letter",
    patternType: LogScrubPatternType.IPAddress,
    dataTypeId: "ip-address",
    before: "remote:",
    written: "2606:4700:4700::1111",
    reads: "2606:4700:4700::1111",
    mask: IPV6_MASK,
  },
  {
    label: "one after a key that ends in a digit",
    patternType: LogScrubPatternType.IPAddress,
    dataTypeId: "ip-address",
    before: "ip6:",
    written: "2a02:6b8::feed:0ff",
    reads: "2a02:6b8::feed:0ff",
    mask: IPV6_MASK,
  },
  {
    label: "an email address in a percent-encoded URL",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "GET /signup?email=",
    written: "jane.doe%40acmecorp.io",
    reads: "jane.doe@acmecorp.io",
    mask: "j***@***.io",
  },
  {
    label: "one with its plus sign encoded too",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "next=/welcome?to=",
    written: "jane%2Bnews%40acmecorp.io",
    reads: "jane+news@acmecorp.io",
    mask: "j***@***.io",
  },
  // #11032
  {
    label: "an email address whose accented name's bytes are percent-encoded",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "GET /signup?email=",
    written: "jos%C3%A9%40acmecorp.io",
    reads: "josé@acmecorp.io",
    mask: "j***@***.io",
  },
  {
    label: "an email address whose domain in another script is percent-encoded",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "GET /verify?address=",
    written: "jane%40%E4%BE%8B%E3%81%88.jp",
    reads: "jane@例え.jp",
    mask: "j***@***.jp",
  },
  {
    label: "an email address in Han letters",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "invite sent to ",
    written: "张伟@acmecorp.io",
    reads: "张伟@acmecorp.io",
    mask: "张***@***.io",
  },
  {
    label: "an email address in Cyrillic, its domain too",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "invite sent to ",
    written: "почта@пример.рф",
    reads: "почта@пример.рф",
    mask: "п***@***.рф",
  },
  {
    label: "a card in fullwidth digits",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "card ",
    written: "４５３２ ０１５１ １２８３ ０３６６",
    reads: "4532 0151 1283 0366",
    mask: "****-****-****-0366",
  },
  {
    label: "a card in Arabic-Indic digits",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "رقم البطاقة ",
    written: "٤٥٣٢٠١٥١١٢٨٣٠٣٦٦",
    reads: "4532015112830366",
    mask: "****-****-****-0366",
  },
  {
    label: "a card in Persian digits",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "شماره کارت ",
    written: "۴۵۳۲-۰۱۵۱-۱۲۸۳-۰۳۶۶",
    reads: "4532-0151-1283-0366",
    mask: "****-****-****-0366",
  },
  {
    label: "a card typed in two scripts",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "card ",
    written: "４５３２ 0151 1283 0366",
    reads: "4532 0151 1283 0366",
    mask: "****-****-****-0366",
  },
  // #11025, #11030
  {
    label: "an international phone number",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "SMS to ",
    written: "+49 30 81234567",
    reads: "+49 30 81234567",
    mask: "***-***-4567",
  },
  {
    label: "one the US pattern only half hid",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "SMS to ",
    written: "+44 161 321 4567",
    reads: "+44 161 321 4567",
    mask: "***-***-4567",
  },
  {
    label: "one with its calling code in parentheses and its trunk prefix",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "call ",
    written: "+44 (0)20 8123 4567",
    reads: "+44 (0)20 8123 4567",
    mask: "***-***-4567",
  },
  {
    label: "one set apart by no-break spaces",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "call ",
    written: "+33\u00A06\u00A081\u00A023\u00A045\u00A067",
    reads: "+33\u00A06\u00A081\u00A023\u00A045\u00A067",
    mask: "***-***-4567",
  },
  {
    label: "a phone number in a percent-encoded URL",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "GET /callback?phone=",
    written: "%2B49%2030%2081234567",
    reads: "+49 30 81234567",
    mask: "***-***-4567",
  },
  {
    label: "a phone number in Arabic-Indic digits",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "رقم الهاتف ",
    written: "+٤٩ ٣٠ ٨١٢٣٤٥٦٧",
    reads: "+49 30 81234567",
    mask: "***-***-4567",
  },
  // #11032: each fullwidth digit's UTF-8 bytes percent-encoded.
  {
    label: "a phone number in fullwidth digits, percent-encoded",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "GET /callback?phone=",
    written: encodeURIComponent("+４９ ３０ ８１２３４５６７"),
    reads: "+49 30 81234567",
    mask: "***-***-4567",
  },
  {
    label: "a North American number in fullwidth digits",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "電話：",
    written: "(４１５) ３２１-８７３１",
    reads: "(415) 321-8731",
    mask: "***-***-8731",
  },
  {
    label: "a Social Security number set apart by dots",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "ssn ",
    written: "536.22.8731",
    reads: "536.22.8731",
    mask: "***-**-8731",
  },
  {
    label: "a Social Security number in Arabic-Indic digits",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "SSN: ",
    written: "٥٣٦-٢٢-٨٧٣١",
    reads: "536-22-8731",
    mask: "***-**-8731",
  },
];

const ACTIONS: Array<string> = [
  LogScrubAction.Redact,
  LogScrubAction.Mask,
  LogScrubAction.Hash,
];

const CASES: Array<[string, string, Written]> = ACTIONS.flatMap(
  (action: string): Array<[string, string, Written]> => {
    return WRITTEN.map((written: Written): [string, string, Written] => {
      return [written.label, action, written];
    });
  },
);

// What each rule keeps: no one's data, written the same ways.
const KEPT: Array<[string, string]> = [
  [LogScrubPatternType.IPAddress, "time:12:30:45"],
  [LogScrubPatternType.IPAddress, "mac:00:1a:2b:3c:4d:5e"],
  [LogScrubPatternType.IPAddress, "ip:fe80::1"],
  [LogScrubPatternType.Email, "GET /search?q=jane%40&n=1"],
  [LogScrubPatternType.Email, "@用户 你好"],
  // UTF-8 escapes that spell no address (#11032).
  [LogScrubPatternType.Email, "GET /assets/%E5%BC%A0%402x.png"],
  [LogScrubPatternType.Email, "GET /q?name=caf%C3%A9%40%C3"],
  [LogScrubPatternType.CreditCard, "order ４１１１ １１１１"],
  [LogScrubPatternType.CreditCard, "رقم ٤٢"],
  // What only looks like a phone or Social Security number (#11025, #11030).
  [LogScrubPatternType.PhoneNumber, "delta +51.507217 out of range"],
  [LogScrubPatternType.PhoneNumber, "at UTC +1 2026-11-24 10:15:00"],
  [LogScrubPatternType.PhoneNumber, "build v1.2.3+build.5"],
  [LogScrubPatternType.PhoneNumber, "counted +1 2 3 4 5 6 7 8"],
  [LogScrubPatternType.PhoneNumber, "دلتا +٥١.٥٠٧٢١٧"],
  [LogScrubPatternType.PhoneNumber, "GET /assets/logo%2B2x.png"],
  [LogScrubPatternType.SSN, "ref 536.22.8731.01"],
  [LogScrubPatternType.SSN, "ssn 666.22.8731"],
  [LogScrubPatternType.SSN, "ref ٥٣٦.٢٢.٨٧٣١.٠١"],
];

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

function logRules(
  patternType: string,
  action: string,
  fields: string = LogScrubField.Both,
): never {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = "Scrub";
  rule.projectId = PROJECT_ID;
  rule.patternType = patternType;
  rule.scrubAction = action;
  rule.fieldsToScrub = fields;

  return [
    { rule: rule, regex: regexOf(LogScrubRuleService, patternType) },
  ] as never;
}

function traceRules(
  patternType: string,
  action: string,
  fields: string = TraceScrubField.All,
): never {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = "Scrub";
  rule.projectId = PROJECT_ID;
  rule.patternType = patternType;
  rule.scrubAction = action;
  rule.fieldsToScrub = fields;

  return [
    { rule: rule, regex: regexOf(TraceScrubRuleService, patternType) },
  ] as never;
}

function tokenOf(written: Written): string {
  return written.patternType === LogScrubPatternType.IPAddress
    ? ScrubHashToken.ofIpAddress({
        projectId: PROJECT_ID,
        address: written.reads,
      })
    : ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: written.reads });
}

// What a rule of PROJECT_ID leaves of a value, however it is written.
function expectedOf(written: Written, action: string): string {
  if (action === LogScrubAction.Redact) {
    return "[REDACTED]";
  }

  return action === LogScrubAction.Mask ? written.mask : tokenOf(written);
}

function findingsOf(text: string, dataTypeId: string): Array<TextMatch> {
  return findSensitiveValues(text).filter((match: TextMatch): boolean => {
    return match.dataTypeId === dataTypeId;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Data Security finds each value, on its written characters", () => {
  test.each(
    WRITTEN.map((written: Written): [string, Written] => {
      return [written.label, written];
    }),
  )("%s", (_label: string, written: Written) => {
    const text: string = `${written.before}${written.written} done`;

    expect(
      findingsOf(text, written.dataTypeId).map((match: TextMatch) => {
        return text.slice(match.start, match.end);
      }),
    ).toEqual([written.written]);
  });
});

describe("the log engine", () => {
  test.each(CASES)(
    "hides %s under %s in the body, the attributes, a list and a JSON text",
    (_label: string, action: string, written: Written) => {
      const value: string = `${written.before}${written.written}`;
      const row: JSONObject = LogScrubRuleService.scrubLog(
        {
          body: `${value} done`,
          attributes: {
            "event.detail": value,
            "http.request.header.referer": [value, "kept"],
            "http.request.body": JSON.stringify({ note: value, n: 1 }),
          },
        },
        logRules(written.patternType, action),
      );
      const hidden: string = `${written.before}${expectedOf(written, action)}`;

      expect(row["body"]).toBe(`${hidden} done`);
      expect(row["attributes"]).toEqual({
        "event.detail": hidden,
        "http.request.header.referer": [hidden, "kept"],
        "http.request.body": JSON.stringify({ note: hidden, n: 1 }),
      });
    },
  );

  test.each(KEPT)(
    "a %s rule keeps %s, under every action",
    (patternType: string, kept: string) => {
      for (const action of ACTIONS) {
        const record: () => JSONObject = (): JSONObject => {
          return { body: kept, attributes: { "event.detail": kept } };
        };

        expect(
          LogScrubRuleService.scrubLog(record(), logRules(patternType, action)),
        ).toEqual(record());
      }
    },
  );

  test("hides exactly the encoded address of a URL, and keeps the rest of it", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "GET /signup?email=jane.doe%40acmecorp.io&next=%2Fhome%3Ftab%3D2 200",
        attributes: {},
      },
      logRules(LogScrubPatternType.Email, LogScrubAction.Redact),
    );

    expect(row["body"]).toBe(
      "GET /signup?email=[REDACTED]&next=%2Fhome%3Ftab%3D2 200",
    );
  });

  test("an address after a key ending in hex letters keeps its key whole", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "remote:2a00:1450::1 node:2606:4700::1111 src:2001:db8::7",
        attributes: {},
      },
      logRules(LogScrubPatternType.IPAddress, LogScrubAction.Mask),
    );

    expect(row["body"]).toBe(
      `remote:${IPV6_MASK} node:${IPV6_MASK} src:${IPV6_MASK}`,
    );
  });
});

describe("the trace engine", () => {
  function spanRow(value: string): JSONObject {
    return {
      name: `GET ${value}`,
      statusMessage: `refused ${value}`,
      attributes: { "event.detail": value },
      events: [
        {
          name: `retrying ${value}`,
          attributes: { "exception.message": `failed ${value}` },
        },
      ],
      links: [{ attributes: { "peer.detail": value } }],
    };
  }

  test.each(CASES)(
    "hides %s under %s in the name, status message, attributes, events and links",
    (_label: string, action: string, written: Written) => {
      const hidden: string = `${written.before}${expectedOf(written, action)}`;

      expect(
        TraceScrubRuleService.scrubSpan(
          spanRow(`${written.before}${written.written}`),
          traceRules(written.patternType, action),
        ),
      ).toEqual(spanRow(hidden));
    },
  );

  test.each(CASES)(
    "hides %s under %s in an exception's message, stack trace, type and attributes",
    (_label: string, action: string, written: Written) => {
      const value: string = `${written.before}${written.written}`;
      const hidden: string = `${written.before}${expectedOf(written, action)}`;
      const content: ExceptionContent =
        TraceScrubRuleService.scrubExceptionContent(
          {
            message: `failed ${value}`,
            stackTrace: `at handle (app.js:1) ${value}`,
            exceptionType: `Error ${value}`,
            attributes: { "event.detail": value },
          },
          traceRules(written.patternType, action, TraceScrubField.Events),
        );

      expect(content).toEqual({
        message: `failed ${hidden}`,
        stackTrace: `at handle (app.js:1) ${hidden}`,
        exceptionType: `Error ${hidden}`,
        attributes: { "event.detail": hidden },
      });
    },
  );

  test.each(
    WRITTEN.map((written: Written): [string, Written] => {
      return [written.label, written];
    }),
  )(
    "an AI call's messages stay JSON, %s hidden in them",
    (_label: string, written: Written) => {
      const value: string = `${written.before}${written.written}`;
      const row: JSONObject = TraceScrubRuleService.scrubSpan(
        {
          name: "chat",
          attributes: {
            "gen_ai.input.messages": JSON.stringify([
              { role: "user", content: `look up ${value} please` },
            ]),
          },
          events: [],
          links: [],
        },
        traceRules(written.patternType, LogScrubAction.Redact),
      );

      expect(
        JSON.parse(
          (row["attributes"] as JSONObject)["gen_ai.input.messages"] as string,
        ),
      ).toEqual([
        { role: "user", content: `look up ${written.before}[REDACTED] please` },
      ]);
    },
  );
});

describe("a session replay, which the log rules scrub", () => {
  test.each(CASES)(
    "hides %s under %s",
    async (_label: string, action: string, written: Written) => {
      const events: Array<JSONValue> = [
        { text: `visit ${written.before}${written.written}` },
      ];
      const rules: Array<CompiledScrubRule> = logRules(
        written.patternType,
        action,
      ) as unknown as Array<CompiledScrubRule>;

      await SessionReplayScrubService.scrubEvents(events, rules);

      expect((events[0] as JSONObject)["text"]).toBe(
        `visit ${written.before}${expectedOf(written, action)}`,
      );
    },
  );
});

describe("Data Security's coverage is true for each", () => {
  test.each(
    WRITTEN.map((written: Written): [string, Written] => {
      return [written.label, written];
    }),
  )(
    "a log body's finding of %s is covered, and the rule leaves no finding",
    (_label: string, written: Written) => {
      const rule: CoveringScrubRule = {
        id: "rule",
        name: "Scrub",
        signal: "log",
        patternType: written.patternType,
        fieldsToScrub: LogScrubField.Both,
      };
      const body: string = `${written.before}${written.written} done`;

      expect(findingsOf(body, written.dataTypeId)).toHaveLength(1);
      expect(
        isFindingScrubbed(
          { rules: [rule] },
          {
            kind: DataStoreKind.TelemetryLogs,
            dataTypeId: written.dataTypeId,
            location: "body",
          },
        ),
      ).toBe(true);

      for (const action of ACTIONS) {
        const row: JSONObject = LogScrubRuleService.scrubLog(
          { body, attributes: {} },
          logRules(written.patternType, action),
        );

        expect([
          action,
          findingsOf(row["body"] as string, written.dataTypeId),
        ]).toEqual([action, []]);
      }
    },
  );
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
    // No exceptions table here: its lookup fails at once, tried again at once.
    jest.spyOn(ExceptionUtil, "pauseBeforeLookupRetry").mockResolvedValue();
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

  test("a log's encoded and other-script addresses are stored as the tokens of the addresses they read as", async () => {
    setupIngest({
      logRules: logRules(LogScrubPatternType.Email, LogScrubAction.Hash),
    });

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
                        "GET /signup?email=jane.doe%40acmecorp.io&next=%2Fhome 200",
                    },
                    attributes: [
                      attribute("user.email", "张伟@acmecorp.io"),
                      attribute("url.query", "to=jane.doe@acmecorp.io"),
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
    const plain: string = ScrubHashToken.ofValue({
      projectId: PROJECT_ID,
      value: "jane.doe@acmecorp.io",
    });

    // One token for the address, however it is written.
    expect(row["body"]).toBe(`GET /signup?email=${plain}&next=%2Fhome 200`);
    expect(attributes["url.query"]).toBe(`to=${plain}`);
    expect(attributes["user.email"]).toBe(
      ScrubHashToken.ofValue({
        projectId: PROJECT_ID,
        value: "张伟@acmecorp.io",
      }),
    );
    expect(JSON.stringify(row)).not.toContain("jane.doe%40acmecorp.io");
    expect(JSON.stringify(row)).not.toContain("张伟");
  });

  test("a span's and its exception's keyed IPv6 addresses and other-script cards are hidden", async () => {
    setupIngest({
      traceRules: [
        ...(traceRules(
          LogScrubPatternType.IPAddress,
          LogScrubAction.Redact,
        ) as unknown as Array<unknown>),
        ...(traceRules(
          LogScrubPatternType.CreditCard,
          LogScrubAction.Mask,
        ) as unknown as Array<unknown>),
      ] as never,
    });

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
                    name: "POST /pay",
                    kind: 2,
                    startTimeUnixNano: nowNano,
                    endTimeUnixNano: nowNano,
                    status: {
                      code: 2,
                      message: "declined peer ip:2a00:1450:4001:82a::200e",
                    },
                    attributes: [
                      attribute("http.request.method", "POST"),
                      attribute(
                        "payment.card",
                        "カード ４５３２ ０１５１ １２８３ ０３６６",
                      ),
                    ],
                    events: [
                      {
                        name: "exception",
                        timeUnixNano: nowNano,
                        attributes: [
                          attribute(
                            "exception.message",
                            "declined remote:2606:4700:4700::1111 card ٤٥٣٢٠١٥١١٢٨٣٠٣٦٦",
                          ),
                          attribute("exception.type", "PaymentError"),
                          attribute(
                            "exception.stacktrace",
                            "PaymentError\n    at pay (pay.js:10:5)",
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

    expect(row["statusMessage"]).toBe("declined peer ip:[REDACTED]");
    expect((row["attributes"] as JSONObject)["payment.card"]).toBe(
      "カード ****-****-****-0366",
    );
    expect(exceptionRows).toHaveLength(1);
    expect(exceptionRows[0]!["message"]).toBe(
      "declined remote:[REDACTED] card ****-****-****-0366",
    );
    expect(JSON.stringify(row)).not.toContain("2a00:1450");
    expect(JSON.stringify(exceptionRows[0])).not.toContain("٤٥٣٢");
  });

  test("a log's international, encoded and other-script phone numbers are stored as the token of the number they read as (#11025, #11030)", async () => {
    setupIngest({
      logRules: logRules(LogScrubPatternType.PhoneNumber, LogScrubAction.Hash),
    });

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
                        "GET /callback?phone=%2B49%2030%2081234567&step=2 200",
                    },
                    attributes: [
                      attribute("user.phone", "+٤٩ ٣٠ ٨١٢٣٤٥٦٧"),
                      attribute("sms.to", "+49 30 81234567"),
                      attribute("geo.delta", "+51.507217"),
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
    const plain: string = ScrubHashToken.ofValue({
      projectId: PROJECT_ID,
      value: "+49 30 81234567",
    });

    // One token for the number, however it is written.
    expect(row["body"]).toBe(`GET /callback?phone=${plain}&step=2 200`);
    expect(attributes["user.phone"]).toBe(plain);
    expect(attributes["sms.to"]).toBe(plain);
    // And a decimal is no phone number.
    expect(attributes["geo.delta"]).toBe("+51.507217");
    expect(JSON.stringify(row)).not.toContain("81234567");
    expect(JSON.stringify(row)).not.toContain("٨١٢٣٤٥٦٧");
  });

  test("a span's and its exception's international phone numbers and Social Security numbers are hidden (#11025, #11030)", async () => {
    setupIngest({
      traceRules: [
        ...(traceRules(
          LogScrubPatternType.PhoneNumber,
          LogScrubAction.Redact,
        ) as unknown as Array<unknown>),
        ...(traceRules(
          LogScrubPatternType.SSN,
          LogScrubAction.Mask,
        ) as unknown as Array<unknown>),
      ] as never,
    });

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
                    spanId: "b7ad6b7169203332",
                    parentSpanId: "",
                    name: "POST /notify",
                    kind: 2,
                    startTimeUnixNano: nowNano,
                    endTimeUnixNano: nowNano,
                    status: {
                      code: 2,
                      message: "SMS to +44 161 321 4567 failed",
                    },
                    attributes: [
                      attribute("http.request.method", "POST"),
                      attribute("customer.ssn", "536.22.8731"),
                    ],
                    events: [
                      {
                        name: "exception",
                        timeUnixNano: nowNano,
                        attributes: [
                          attribute(
                            "exception.message",
                            "SMS to +44 (0)20 8123 4567 for ssn ٥٣٦-٢٢-٨٧٣١ failed",
                          ),
                          attribute("exception.type", "SmsDeliveryError"),
                          attribute(
                            "exception.stacktrace",
                            "SmsDeliveryError\n    at notify (notify.js:10:5)",
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

    // The whole number, where the US pattern alone hid "161 321 4567".
    expect(row["statusMessage"]).toBe("SMS to [REDACTED] failed");
    expect((row["attributes"] as JSONObject)["customer.ssn"]).toBe(
      "***-**-8731",
    );
    expect(exceptionRows).toHaveLength(1);
    expect(exceptionRows[0]!["message"]).toBe(
      "SMS to [REDACTED] for ssn ***-**-8731 failed",
    );
    expect(JSON.stringify(row)).not.toContain("+44");
    expect(JSON.stringify(exceptionRows[0])).not.toContain("8123");
    expect(JSON.stringify(exceptionRows[0])).not.toContain("٥٣٦");
  });
});
