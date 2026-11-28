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
  classifyField,
  FieldClassification,
} from "Common/Utils/DataSecurity/FieldClassifier";
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
 * SCRUB RULES HIDE, WHEREVER THEY RUN, WHAT DATA SECURITY FINDS UNDER A KEY
 * THAT NAMES IT (#11383), SET APART BY ANOTHER DASH, OR TYPED IN
 * FULLWIDTH LETTERS (#11385).
 *
 *   - a national phone number or nine digits in a row alone under an
 *     attribute whose key names them - user.phone=02012345678,
 *     customer.ssn=536221234, sent as a text or as a number - by a Phone
 *     Number or SSN rule, in a log's attributes, a span's, a link's and an
 *     event's, an exception's and a session replay's, and through OTLP
 *     ingest; what no key names is kept;
 *   - a phone number, a Social Security number or a card whose groups are
 *     set apart by the prolonged sound mark, a typeset dash or a minus sign,
 *     an email address typed in fullwidth, and a number beside its words
 *     typed so, by the rule of its type, in the body, the attributes, a
 *     list and a JSON text, a span's every text, an exception, a session
 *     replay and through ingest.
 *
 * Each under Redact, Mask and Hash, Hash giving the token of the value
 * written plainly. Data Security's coverage of each is true: the rule
 * leaves no finding.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000113830",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000113850",
);
const SERVICE_NAME: string = "signup-api";

const ACTIONS: Array<string> = [
  LogScrubAction.Redact,
  LogScrubAction.Mask,
  LogScrubAction.Hash,
];

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

  return [{ rule, regex: regexOf(LogScrubRuleService, patternType) }] as never;
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
    { rule, regex: regexOf(TraceScrubRuleService, patternType) },
  ] as never;
}

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

// What a rule leaves of a value, by its action.
function leftOf(action: string, mask: string, reads: string): string {
  if (action === LogScrubAction.Redact) {
    return "[REDACTED]";
  }

  return action === LogScrubAction.Mask ? mask : tokenOf(reads);
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ---------------------------------------------------------------------------
 * #11383: UNDER A KEY THAT NAMES IT.
 * ---------------------------------------------------------------------------
 */

interface Keyed {
  label: string;
  patternType: string;
  dataTypeId: string;
  key: string;
  value: string | number;
  reads: string;
  mask: string;
}

const KEYED: Array<Keyed> = [
  {
    label: "a national number alone under user.phone",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    key: "user.phone",
    value: "02012345678",
    reads: "02012345678",
    mask: "***-***-5678",
  },
  {
    label: "a phone's shape under customer.mobile",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    key: "customer.mobile",
    value: "020 1234 5678",
    reads: "020 1234 5678",
    mask: "***-***-5678",
  },
  {
    label: "a phone number sent as a number under msisdn",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    key: "msisdn",
    value: 447700900123,
    reads: "447700900123",
    mask: "***-***-0123",
  },
  {
    label: "nine digits under customer.ssn",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    key: "customer.ssn",
    value: "536221234",
    reads: "536221234",
    mask: "***-**-1234",
  },
  {
    label: "an SSN sent as a number under applicant.ssn",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    key: "applicant.ssn",
    value: 536221234,
    reads: "536221234",
    mask: "***-**-1234",
  },
];

const KEYED_CASES: Array<[string, string, Keyed]> = ACTIONS.flatMap(
  (action: string): Array<[string, string, Keyed]> => {
    return KEYED.map((keyed: Keyed): [string, string, Keyed] => {
      return [keyed.label, action, keyed];
    });
  },
);

// What no key names: kept by every engine, under every action.
const KEYED_KEPT: Array<[string, string, string | number]> = [
  [LogScrubPatternType.PhoneNumber, "order.id", "02012345678"],
  [LogScrubPatternType.PhoneNumber, "duration_ns", 2012345678],
  [LogScrubPatternType.SSN, "invoice.number", "536221234"],
  [LogScrubPatternType.SSN, "batch.size", 536221234],
];

describe("under a key that names it (#11383): Data Security finds each", () => {
  test.each(
    KEYED.map((keyed: Keyed): [string, Keyed] => {
      return [keyed.label, keyed];
    }),
  )("%s", (_label: string, keyed: Keyed) => {
    expect(
      classifyField(`attributes.${keyed.key}`, [keyed.value]).map(
        (classification: FieldClassification): string => {
          return classification.dataTypeId;
        },
      ),
    ).toContain(keyed.dataTypeId);
  });
});

describe("under a key that names it (#11383): the log engine", () => {
  test.each(KEYED_CASES)(
    "hides %s under %s",
    (_label: string, action: string, keyed: Keyed) => {
      const row: JSONObject = LogScrubRuleService.scrubLog(
        {
          body: `stored ${String(keyed.value)}`,
          attributes: { [keyed.key]: keyed.value, "http.method": "POST" },
        },
        logRules(keyed.patternType, action),
      );

      // The body has no key: its digits beside no word are kept.
      expect(row).toEqual({
        body: `stored ${String(keyed.value)}`,
        attributes: {
          [keyed.key]: leftOf(action, keyed.mask, keyed.reads),
          "http.method": "POST",
        },
      });
    },
  );

  test.each(KEYED_KEPT)(
    "a %s rule keeps under %s: %s",
    (patternType: string, key: string, value: string | number) => {
      for (const action of ACTIONS) {
        expect(
          LogScrubRuleService.scrubLog(
            { body: "", attributes: { [key]: value } },
            logRules(patternType, action),
          )["attributes"],
        ).toEqual({ [key]: value });
      }
    },
  );
});

describe("under a key that names it (#11383): the trace engine", () => {
  test.each(KEYED_CASES)(
    "hides %s under %s in a span's, a link's and an event's attributes, and an exception's",
    (_label: string, action: string, keyed: Keyed) => {
      const left: string = leftOf(action, keyed.mask, keyed.reads);

      expect(
        TraceScrubRuleService.scrubSpan(
          {
            name: "POST /signup",
            attributes: { [keyed.key]: keyed.value },
            events: [
              { name: "verified", attributes: { [keyed.key]: keyed.value } },
            ],
            links: [{ attributes: { [keyed.key]: keyed.value } }],
          },
          traceRules(keyed.patternType, action),
        ),
      ).toEqual({
        name: "POST /signup",
        attributes: { [keyed.key]: left },
        events: [{ name: "verified", attributes: { [keyed.key]: left } }],
        links: [{ attributes: { [keyed.key]: left } }],
      });

      const content: ExceptionContent =
        TraceScrubRuleService.scrubExceptionContent(
          {
            message: "verify failed",
            stackTrace: "at verify (app.js:1)",
            attributes: { [keyed.key]: keyed.value },
          },
          traceRules(keyed.patternType, action, TraceScrubField.Events),
        );

      expect(content.attributes).toEqual({ [keyed.key]: left });
    },
  );
});

describe("under a key that names it (#11383): a session replay, which the log rules scrub", () => {
  test.each(
    ACTIONS.map((action: string): [string] => {
      return [action];
    }),
  )(
    "hides a number under a DOM attribute named for it, under %s, and keeps one under any other",
    async (action: string) => {
      const events: Array<JSONValue> = [
        {
          type: 2,
          data: {
            node: {
              type: 2,
              tagName: "span",
              attributes: {
                "data-phone": "02012345678",
                "data-order": "02012345678",
                title: "ref 536221234",
              },
            },
          },
        },
      ];

      await SessionReplayScrubService.scrubEvents(
        events,
        logRules(
          LogScrubPatternType.PhoneNumber,
          action,
        ) as unknown as Array<CompiledScrubRule>,
      );

      const attributes: JSONObject = (
        ((events[0] as JSONObject)["data"] as JSONObject)["node"] as JSONObject
      )["attributes"] as JSONObject;

      expect(attributes).toEqual({
        "data-phone": leftOf(action, "***-***-5678", "02012345678"),
        "data-order": "02012345678",
        title: "ref 536221234",
      });
    },
  );
});

describe("under a key that names it (#11383): Data Security's coverage is true", () => {
  test.each(
    KEYED.map((keyed: Keyed): [string, Keyed] => {
      return [keyed.label, keyed];
    }),
  )(
    "a log attribute's finding of %s is covered, and the rule leaves no finding",
    (_label: string, keyed: Keyed) => {
      const rule: CoveringScrubRule = {
        id: "rule",
        name: "Scrub",
        signal: "log",
        patternType: keyed.patternType,
        fieldsToScrub: LogScrubField.Both,
      };
      const location: string = `attributes.${keyed.key}`;

      expect(
        isFindingScrubbed(
          { rules: [rule] },
          {
            kind: DataStoreKind.TelemetryLogs,
            dataTypeId: keyed.dataTypeId,
            location,
          },
        ),
      ).toBe(true);

      for (const action of ACTIONS) {
        const left: unknown = (
          LogScrubRuleService.scrubLog(
            { body: "", attributes: { [keyed.key]: keyed.value } },
            logRules(keyed.patternType, action),
          )["attributes"] as JSONObject
        )[keyed.key];

        expect([
          action,
          classifyField(location, [left]).some(
            (classification: FieldClassification): boolean => {
              return classification.dataTypeId === keyed.dataTypeId;
            },
          ),
        ]).toEqual([action, false]);
      }
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * #11385: SET APART BY ANOTHER DASH, OR TYPED IN FULLWIDTH LETTERS.
 * ---------------------------------------------------------------------------
 */

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
    label:
      "a phone number set apart by the prolonged sound mark, typed in fullwidth",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "電話 ",
    written: "＋８１ ３ー１２３４ー５６７８",
    reads: "+81 3-1234-5678",
    mask: "***-***-5678",
  },
  {
    label: "a phone number set apart by a non-breaking hyphen",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "call ",
    written: "+44 20 7123‑4567",
    reads: "+44 20 7123-4567",
    mask: "***-***-4567",
  },
  {
    label: "a North American number set apart by an en dash",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "tel ",
    written: "(415) 555–2671",
    reads: "(415) 555-2671",
    mask: "***-***-2671",
  },
  {
    label: "a national number beside its word typed in fullwidth",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "ＴＥＬ　",
    written: "０３１２３４５６７８",
    reads: "0312345678",
    mask: "***-***-5678",
  },
  {
    label: "a Social Security number set apart by en dashes",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "ssn ",
    written: "536–22–8731",
    reads: "536-22-8731",
    mask: "***-**-8731",
  },
  {
    label: "a Social Security number set apart by minus signs",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "SSN: ",
    written: "536−22−8731",
    reads: "536-22-8731",
    mask: "***-**-8731",
  },
  {
    label: "a card typed in fullwidth, set apart by the prolonged sound mark",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "カード番号：",
    written: "４５３２ー０１５１ー１２８３ー０３６６",
    reads: "4532-0151-1283-0366",
    mask: "****-****-****-0366",
  },
  {
    label: "a card set apart by figure dashes",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "card ",
    written: "4532‒0151‒1283‒0366",
    reads: "4532-0151-1283-0366",
    mask: "****-****-****-0366",
  },
  {
    label: "an email address typed in fullwidth",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "メール ",
    written: "ｊａｎｅ．ｄｏｅ＠ａｃｍｅｃｏｒｐ．ｉｏ",
    reads: "jane.doe@acmecorp.io",
    mask: "j***@***.io",
  },
  {
    label: "an email address with its at sign alone in fullwidth",
    patternType: LogScrubPatternType.Email,
    dataTypeId: "email-address",
    before: "連絡先：",
    written: "jane.doe＠acmecorp.io",
    reads: "jane.doe@acmecorp.io",
    mask: "j***@***.io",
  },
];

const CASES: Array<[string, string, Written]> = ACTIONS.flatMap(
  (action: string): Array<[string, string, Written]> => {
    return WRITTEN.map((written: Written): [string, string, Written] => {
      return [written.label, action, written];
    });
  },
);

// What is no value, written so: kept by every engine, under every action.
const KEPT: Array<[string, string]> = [
  [LogScrubPatternType.PhoneNumber, "サーバー3台 データ2ー3件"],
  [LogScrubPatternType.PhoneNumber, "pages 10–20 of 2020–2026"],
  [LogScrubPatternType.PhoneNumber, "気温 −5 度"],
  [
    LogScrubPatternType.PhoneNumber,
    "ｐｈｏｎｅ＝ｅ＋７７７６９８３２６２８８５８",
  ],
  [LogScrubPatternType.Email, "ＩＴ部門＠本社 へ連絡してください"],
  [LogScrubPatternType.Email, "設定を確認してください。（注）以上です！"],
];

function hiddenOf(written: Written, action: string): string {
  return `${written.before}${leftOf(action, written.mask, written.reads)}`;
}

function findingsOf(text: string, dataTypeId: string): Array<TextMatch> {
  return findSensitiveValues(text).filter((match: TextMatch): boolean => {
    return match.dataTypeId === dataTypeId;
  });
}

describe("set apart by another dash, or typed in fullwidth letters (#11385): Data Security finds each, on its written characters", () => {
  test.each(
    WRITTEN.map((written: Written): [string, Written] => {
      return [written.label, written];
    }),
  )("%s", (_label: string, written: Written) => {
    const text: string = `${written.before}${written.written} done`;

    expect(
      findingsOf(text, written.dataTypeId).map((match: TextMatch): string => {
        return text.slice(match.start, match.end);
      }),
    ).toEqual([written.written]);
  });
});

describe("set apart by another dash, or typed in fullwidth letters (#11385): the log engine", () => {
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
      const hidden: string = hiddenOf(written, action);

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
});

describe("set apart by another dash, or typed in fullwidth letters (#11385): the trace engine", () => {
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
      expect(
        TraceScrubRuleService.scrubSpan(
          spanRow(`${written.before}${written.written}`),
          traceRules(written.patternType, action),
        ),
      ).toEqual(spanRow(hiddenOf(written, action)));
    },
  );

  test.each(CASES)(
    "hides %s under %s in an exception's message, stack trace, type and attributes",
    (_label: string, action: string, written: Written) => {
      const value: string = `${written.before}${written.written}`;
      const hidden: string = hiddenOf(written, action);

      expect(
        TraceScrubRuleService.scrubExceptionContent(
          {
            message: `failed ${value}`,
            stackTrace: `at handle (app.js:1) ${value}`,
            exceptionType: `Error ${value}`,
            attributes: { "event.detail": value },
          },
          traceRules(written.patternType, action, TraceScrubField.Events),
        ),
      ).toEqual({
        message: `failed ${hidden}`,
        stackTrace: `at handle (app.js:1) ${hidden}`,
        exceptionType: `Error ${hidden}`,
        attributes: { "event.detail": hidden },
      });
    },
  );
});

describe("set apart by another dash, or typed in fullwidth letters (#11385): a session replay", () => {
  test.each(CASES)(
    "hides %s under %s",
    async (_label: string, action: string, written: Written) => {
      const events: Array<JSONValue> = [
        { text: `visit ${written.before}${written.written}` },
      ];

      await SessionReplayScrubService.scrubEvents(
        events,
        logRules(
          written.patternType,
          action,
        ) as unknown as Array<CompiledScrubRule>,
      );

      expect((events[0] as JSONObject)["text"]).toBe(
        `visit ${hiddenOf(written, action)}`,
      );
    },
  );
});

describe("set apart by another dash, or typed in fullwidth letters (#11385): Data Security's coverage is true", () => {
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

/*
 * ---------------------------------------------------------------------------
 * THROUGH LOG AND TRACE INGEST: OTLP IN, ROWS STORED.
 * ---------------------------------------------------------------------------
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

type OtlpAttribute = {
  key: string;
  value: { stringValue: string } | { intValue: string };
};

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

  function text(key: string, value: string): OtlpAttribute {
    return { key, value: { stringValue: value } };
  }

  function integer(key: string, value: number): OtlpAttribute {
    return { key, value: { intValue: String(value) } };
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
          } else if (target !== ExceptionInstanceService) {
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
  });

  test("a log's numbers under keys that name them are stored as their tokens, sent as texts or as numbers, and its dashed and fullwidth values too", async () => {
    setupIngest({
      logRules: [
        ...(logRules(
          LogScrubPatternType.PhoneNumber,
          LogScrubAction.Hash,
        ) as unknown as Array<unknown>),
        ...(logRules(
          LogScrubPatternType.SSN,
          LogScrubAction.Hash,
        ) as unknown as Array<unknown>),
        ...(logRules(
          LogScrubPatternType.Email,
          LogScrubAction.Hash,
        ) as unknown as Array<unknown>),
      ] as never,
    });

    await OtelLogsIngestService.processLogsFromQueue(
      request({
        resourceLogs: [
          {
            resource: { attributes: [text("service.name", SERVICE_NAME)] },
            scopeLogs: [
              {
                scope: {},
                logRecords: [
                  {
                    timeUnixNano: `${Date.now()}000000`,
                    severityNumber: 9,
                    body: {
                      stringValue:
                        "signup 電話 ＋８１ ３ー１２３４ー５６７８ ssn 536–22–8731 メール ｊａｎｅ＠ａｃｍｅｃｏｒｐ．ｉｏ",
                    },
                    attributes: [
                      text("user.phone", "02012345678"),
                      integer("customer.ssn", 536221234),
                      text("order.id", "02012345678"),
                      integer("duration_ms", 1732752000123),
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
      `signup 電話 ${tokenOf("+81 3-1234-5678")} ssn ${tokenOf("536-22-8731")} メール ${tokenOf("jane@acmecorp.io")}`,
    );
    expect(attributes["user.phone"]).toBe(tokenOf("02012345678"));
    expect(attributes["customer.ssn"]).toBe(tokenOf("536221234"));
    // Under keys that name nothing: kept, a number as the number it is.
    expect(attributes["order.id"]).toBe("02012345678");
    expect(String(attributes["duration_ms"])).toBe("1732752000123");
  });

  test("a span's numbers under keys that name them, in its attributes and its events, are hidden", async () => {
    setupIngest({
      traceRules: [
        ...(traceRules(
          LogScrubPatternType.PhoneNumber,
          LogScrubAction.Redact,
        ) as unknown as Array<unknown>),
        ...(traceRules(
          LogScrubPatternType.SSN,
          LogScrubAction.Redact,
        ) as unknown as Array<unknown>),
      ] as never,
    });

    await OtelTracesIngestService.processTracesFromQueue(
      request({
        resourceSpans: [
          {
            resource: { attributes: [text("service.name", SERVICE_NAME)] },
            scopeSpans: [
              {
                scope: {},
                spans: [
                  {
                    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                    spanId: "00f067aa0ba902b7",
                    name: "POST /signup",
                    kind: 2,
                    startTimeUnixNano: `${Date.now()}000000`,
                    endTimeUnixNano: `${Date.now() + 5}000000`,
                    attributes: [
                      text("user.phone", "02012345678"),
                      integer("customer.ssn", 536221234),
                      text("order.id", "02012345678"),
                    ],
                    events: [
                      {
                        timeUnixNano: `${Date.now()}000000`,
                        name: "verified",
                        attributes: [
                          text("customer.mobile", "612345678"),
                          text("contact", "ssn 536–22–8731"),
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(spanRows).toHaveLength(1);

    const stored: string = JSON.stringify(spanRows[0]);

    expect(stored).not.toContain("536221234");
    expect(stored).not.toContain("612345678");
    expect(stored).not.toContain("536–22–8731");
    // The order id under a key that names nothing is kept.
    expect(stored).toContain("02012345678");
    expect((spanRows[0]!["attributes"] as JSONObject)["user.phone"]).toBe(
      "[REDACTED]",
    );
  });
});
