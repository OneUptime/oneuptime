import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import LogScrubRule from "../../../../../Models/DatabaseModels/LogScrubRule";
import MetricPipelineRule from "../../../../../Models/DatabaseModels/MetricPipelineRule";
import TraceScrubRule from "../../../../../Models/DatabaseModels/TraceScrubRule";
import DataSecurityCustomDataType from "../../../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityCustomDataTypeService from "../../../../../Server/Services/DataSecurityCustomDataTypeService";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../../../Server/Services/MetricPipelineRuleService";
import TraceScrubRuleService from "../../../../../Server/Services/TraceScrubRuleService";
import Service from "../../../../../Models/DatabaseModels/Service";
import ServiceService from "../../../../../Server/Services/ServiceService";
import FindOneBy from "../../../../../Server/Types/Database/FindOneBy";
import CreateBy from "../../../../../Server/Types/Database/CreateBy";
import {
  buildMetricScrubFilters,
  buildMetricScrubRule,
  buildScrubPatternForDataType,
  CoveringScrubRule,
  createScrubRuleForFinding,
  CreatedScrubRule,
  planScrubItRule,
  SCRUB_SERVICE_GONE,
  ScrubItRule,
  DATA_SECURITY_SCRUB_RULE_NAME_PREFIX,
  DATA_TYPE_OF_SCRUB_PATTERN_TYPE,
  findCoveringScrubRule,
  getScrubCoverage,
  getScrubTarget,
  INGEST_SENSITIVE_KEY_REGEX,
  isFindingScrubbed,
  MAX_METRIC_RULE_ATTRIBUTE_KEY_LENGTH,
  MAX_SCRUB_PATTERN_LENGTH,
  METRIC_NAME_NOT_SCRUBBABLE,
  METRIC_REDACT_REPLACEMENT,
  relaxLongRepeats,
  ScrubbedField,
  ScrubCoverage,
  ScrubRuleSignal,
  SESSION_DETAILS_NOT_SCRUBBABLE,
  toCoveringMetricRule,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { validateMetricPipelineRuleFilters } from "../../../../../Server/Utils/MetricPipelineRuleValidation";
import { getScrubRuleRegex } from "../../../../../Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import { validateScrubRule } from "../../../../../Server/Utils/ScrubRuleValidation";
import {
  getScrubUnavailableReason,
  ScrubTarget,
  TelemetryScrubUnavailableReason,
} from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "../../../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "../../../../../Types/Metrics/MetricPipelineRuleType";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../../../Types/DataSecurity/DataTypeCatalog";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import {
  checkScrubRuleCustomRegex,
  compileScrubRuleCustomRegex,
  LOG_SCRUB_FIELDS,
  LOG_SCRUB_PATTERN_TYPES,
  ScrubRegExp,
  TRACE_SCRUB_FIELDS,
  TRACE_SCRUB_PATTERN_TYPES,
} from "../../../../../Types/Telemetry/ScrubRule";

/*
 * Whether ingest's scrub rules already hide what a telemetry finding found,
 * and the rule "Scrub it" makes when none does: each built-in pattern type
 * finds its own data type, only on the records and fields ingest runs it
 * over; a sensitive-keys rule hides a sensitive key's whole value
 * wherever ingest reads keys; a custom pattern counts only when it is the
 * one Scrub It makes. The sensitive-key pattern is pinned to ingest's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000d5001",
);
const USER_ID: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000d5002");

const GITHUB_TOKEN: string = "ghp_R8sK2mQ9vX4tL7wN1pZ6cB3yH5jD0fG2aE8u";
const JSON_WEB_TOKEN: string =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

const APP_TELEMETRY_SERVICES: string = path.resolve(
  __dirname,
  "../../../../../../App/FeatureSet/Telemetry/Services",
);

let ruleCount: number = 0;

function rule(data: {
  signal: ScrubRuleSignal;
  patternType: string;
  fieldsToScrub: string;
  customRegex?: string | undefined;
  name?: string | undefined;
}): CoveringScrubRule {
  ruleCount++;

  return {
    id: `rule-${ruleCount}`,
    name: data.name || `Rule ${ruleCount}`,
    signal: data.signal,
    patternType: data.patternType,
    customRegex: data.customRegex,
    fieldsToScrub: data.fieldsToScrub,
  };
}

function covered(
  coverageRule: CoveringScrubRule,
  kind: DataStoreKind,
  location: string,
  dataTypeId: string,
): boolean {
  return isFindingScrubbed(
    { rules: [coverageRule] },
    {
      kind,
      dataTypeId,
      location,
    },
  );
}

function savedLogRule(data: Partial<LogScrubRule>): LogScrubRule {
  const saved: LogScrubRule = new LogScrubRule();
  saved._id = ObjectID.generate().toString();
  Object.assign(saved, data);
  return saved;
}

function savedTraceRule(data: Partial<TraceScrubRule>): TraceScrubRule {
  const saved: TraceScrubRule = new TraceScrubRule();
  saved._id = ObjectID.generate().toString();
  Object.assign(saved, data);
  return saved;
}

const CHECKOUT: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000d5401");
const PAYMENTS: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000d5402");

function savedMetricRule(
  data: Partial<MetricPipelineRule>,
): MetricPipelineRule {
  const saved: MetricPipelineRule = new MetricPipelineRule();
  saved._id = ObjectID.generate().toString();
  Object.assign(saved, data);
  return saved;
}

// A service of the project as Scrub It reads it: checkout and payments, nothing else.
function serviceNamed(id: string): Service | null {
  const name: string | undefined = new Map<string, string>([
    [CHECKOUT.toString().toLowerCase(), "checkout"],
    [PAYMENTS.toString().toLowerCase(), "payments"],
  ]).get(id.toLowerCase());

  if (!name) {
    return null;
  }

  const service: Service = new Service(new ObjectID(id));
  service.name = name;

  return service;
}

// A metric attribute finding of checkout's metrics.
function metricFinding(
  location: string,
  dataTypeId: string = "email-address",
): {
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
  serviceId: ObjectID;
} {
  return {
    kind: DataStoreKind.TelemetryMetrics,
    dataTypeId,
    location,
    serviceId: CHECKOUT,
  };
}

function coveredByMetricRule(
  saved: MetricPipelineRule,
  finding: {
    kind: DataStoreKind;
    dataTypeId: string;
    location: string;
    serviceId: ObjectID;
  },
): boolean {
  const covering: CoveringScrubRule | null = toCoveringMetricRule(saved);

  return covering ? isFindingScrubbed({ rules: [covering] }, finding) : false;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the sensitive-key pattern", () => {
  test("is exactly the one the ingest engines read keys with", () => {
    // Both engines compile a rule through one step, in Common (#10366).
    const compiled: ScrubRegExp | null = getScrubRuleRegex({
      patternType: LogScrubPatternType.SensitiveKeys,
    });

    expect(compiled).not.toBeNull();
    expect(INGEST_SENSITIVE_KEY_REGEX.source).toBe(compiled!.source);
    expect(INGEST_SENSITIVE_KEY_REGEX.flags).toBe(compiled!.flags);
  });

  test("ingest keeps no copy of its own to drift from it", () => {
    for (const fileName of [
      "LogScrubRuleService.ts",
      "TraceScrubRuleService.ts",
    ]) {
      const text: string = fs.readFileSync(
        path.join(APP_TELEMETRY_SERVICES, fileName),
        "utf8",
      );

      expect(text).not.toContain("const SENSITIVE_KEY_REGEX");
      expect(text).toContain("compileScrubRule(rule)");
    }
  });
});

describe("where a finding sits, as scrub rules see it", () => {
  test("each telemetry location names its signal, field and key", () => {
    expect(getScrubTarget(DataStoreKind.TelemetryLogs, "body")).toEqual({
      signal: "log",
      field: ScrubbedField.Body,
    });
    expect(
      getScrubTarget(DataStoreKind.TelemetryLogs, "attributes.user.email"),
    ).toEqual({
      signal: "log",
      field: ScrubbedField.Attributes,
      key: "user.email",
    });
    expect(
      getScrubTarget(DataStoreKind.TelemetryTraces, "events.login.api_token"),
    ).toEqual({
      signal: "trace",
      field: ScrubbedField.Events,
      key: "api_token",
    });
    expect(getScrubTarget(DataStoreKind.TelemetryTraces, "name")).toEqual({
      signal: "trace",
      field: ScrubbedField.Name,
    });
    expect(
      getScrubTarget(DataStoreKind.TelemetryExceptions, "message"),
    ).toEqual({ signal: "trace", field: ScrubbedField.Events });
    expect(
      getScrubTarget(DataStoreKind.TelemetryExceptions, "attributes.user.id"),
    ).toEqual({ signal: "trace", field: ScrubbedField.Events, key: "user.id" });
    expect(
      getScrubTarget(
        DataStoreKind.TelemetryAiConversations,
        "gen_ai.input.messages",
      ),
    ).toEqual({
      signal: "trace",
      field: ScrubbedField.Attributes,
      key: "gen_ai.input.messages",
    });
    expect(
      getScrubTarget(
        DataStoreKind.TelemetrySessionReplays,
        "logs.attributes.user.email",
      ),
    ).toEqual({
      signal: "log",
      field: ScrubbedField.Attributes,
      key: "user.email",
    });
    expect(
      getScrubTarget(
        DataStoreKind.TelemetrySessionReplays,
        "spans.attributes.http.url",
      ),
    ).toEqual({
      signal: "trace",
      field: ScrubbedField.Attributes,
      key: "http.url",
    });
  });

  test("no scrub rule reaches a session header, a store that is not telemetry, or an unknown location", () => {
    expect(
      getScrubTarget(
        DataStoreKind.TelemetrySessionReplays,
        "sessions.identifiedUserLabel",
      ),
    ).toBeNull();
    expect(
      getScrubTarget(DataStoreKind.AwsS3Bucket, "exports/*.csv"),
    ).toBeNull();
    expect(getScrubTarget(DataStoreKind.TelemetryLogs, "message")).toBeNull();
    expect(getScrubTarget(DataStoreKind.TelemetryTraces, "body")).toBeNull();
  });

  test("a metric's attribute, its resource's too, is a metric pipeline rule's, by its key", () => {
    expect(
      getScrubTarget(DataStoreKind.TelemetryMetrics, "attributes.user.email"),
    ).toEqual({
      signal: "metric",
      field: ScrubbedField.Attributes,
      key: "user.email",
    });
    expect(
      getScrubTarget(
        DataStoreKind.TelemetryMetrics,
        "attributes.resource.client.ip",
      ),
    ).toEqual({
      signal: "metric",
      field: ScrubbedField.Attributes,
      key: "resource.client.ip",
    });
  });

  test("no rule reaches a metric's name, and why is said for it and for a session's details", () => {
    expect(getScrubTarget(DataStoreKind.TelemetryMetrics, "name")).toBeNull();
    expect(
      getScrubTarget(DataStoreKind.TelemetryMetrics, "attributes."),
    ).toBeNull();
    expect(
      getScrubUnavailableReason(DataStoreKind.TelemetryMetrics, "name"),
    ).toBe(TelemetryScrubUnavailableReason.MetricName);
    expect(
      getScrubUnavailableReason(
        DataStoreKind.TelemetrySessionReplays,
        "sessions.identifiedUserLabel",
      ),
    ).toBe(TelemetryScrubUnavailableReason.SessionDetails);
    expect(
      getScrubUnavailableReason(DataStoreKind.TelemetryLogs, "message"),
    ).toBe(TelemetryScrubUnavailableReason.NoRule);
    expect(
      getScrubUnavailableReason(DataStoreKind.AwsS3Bucket, "exports/*.csv"),
    ).toBe(TelemetryScrubUnavailableReason.NoRule);
    // A place a rule reaches has no reason.
    expect(
      getScrubUnavailableReason(
        DataStoreKind.TelemetryMetrics,
        " attributes.user.email ",
      ),
    ).toBeNull();
    expect(
      getScrubUnavailableReason(DataStoreKind.TelemetryLogs, "body"),
    ).toBeNull();
  });
});

describe("a metric pipeline rule", () => {
  const redactEmails: MetricPipelineRuleFilterCondition = {
    checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
    attributeKey: "user.email",
    conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
    value: buildScrubPatternForDataType("email-address")!,
  };

  test("that redacts or removes the attribute, for the service or every service, covers it", () => {
    for (const ruleType of [
      MetricPipelineRuleType.RedactAttribute,
      MetricPipelineRuleType.RemoveAttribute,
    ]) {
      // The service's own rule, and a rule for every service (none named).
      for (const ofService of [{ serviceId: CHECKOUT }, {}]) {
        expect(
          coveredByMetricRule(
            savedMetricRule({
              ruleType,
              addAttributeKey: "user.email",
              filters: [],
              ...ofService,
            }),
            metricFinding("attributes.user.email"),
          ),
        ).toBe(true);
      }
    }

    // Its resource's attribute, by its key as the row holds it.
    expect(
      coveredByMetricRule(
        savedMetricRule({
          ruleType: MetricPipelineRuleType.RedactAttribute,
          addAttributeKey: "resource.client.ip",
        }),
        metricFinding("attributes.resource.client.ip", "ip-address"),
      ),
    ).toBe(true);
  });

  test("of another service, another key, or another kind, covers nothing", () => {
    expect(
      coveredByMetricRule(
        savedMetricRule({
          ruleType: MetricPipelineRuleType.RedactAttribute,
          addAttributeKey: "user.email",
          serviceId: PAYMENTS,
        }),
        metricFinding("attributes.user.email"),
      ),
    ).toBe(false);
    expect(
      coveredByMetricRule(
        savedMetricRule({
          ruleType: MetricPipelineRuleType.RedactAttribute,
          addAttributeKey: "user.id",
        }),
        metricFinding("attributes.user.email"),
      ),
    ).toBe(false);

    // A Drop rule is read (#9757), but with a person's own filter covers no attribute.
    expect(
      coveredByMetricRule(
        savedMetricRule({
          ruleType: MetricPipelineRuleType.Drop,
          addAttributeKey: "user.email",
          filters: [
            {
              checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
              conditionType: MetricPipelineRuleFilterConditionType.StartsWith,
              value: "debug.",
            },
          ],
        }),
        metricFinding("attributes.user.email"),
      ),
    ).toBe(false);

    for (const ruleType of [
      MetricPipelineRuleType.Filter,
      MetricPipelineRuleType.RenameAttribute,
      MetricPipelineRuleType.AddAttribute,
      MetricPipelineRuleType.Sample,
    ]) {
      expect(
        toCoveringMetricRule(
          savedMetricRule({ ruleType, addAttributeKey: "user.email" }),
        ),
      ).toBeNull();
    }

    // Nor a log or trace rule, nor a metric rule a log finding.
    expect(
      isFindingScrubbed(
        {
          rules: [
            rule({
              signal: "log",
              patternType: "email",
              fieldsToScrub: "both",
            }),
          ],
        },
        metricFinding("attributes.user.email"),
      ),
    ).toBe(false);
    expect(
      isFindingScrubbed(
        {
          rules: [
            toCoveringMetricRule(
              savedMetricRule({
                ruleType: MetricPipelineRuleType.RedactAttribute,
                addAttributeKey: "user.email",
              }),
            )!,
          ],
        },
        {
          kind: DataStoreKind.TelemetryLogs,
          dataTypeId: "email-address",
          location: "attributes.user.email",
        },
      ),
    ).toBe(false);
  });

  test("with filters covers only when they are exactly the one Scrub It makes for the type", () => {
    expect(
      coveredByMetricRule(
        savedMetricRule({
          ruleType: MetricPipelineRuleType.RedactAttribute,
          addAttributeKey: "user.email",
          filters: [redactEmails],
        }),
        metricFinding("attributes.user.email"),
      ),
    ).toBe(true);
    // Scrub It's filter for one type is not another type's.
    expect(
      coveredByMetricRule(
        savedMetricRule({
          ruleType: MetricPipelineRuleType.RedactAttribute,
          addAttributeKey: "user.email",
          filters: [redactEmails],
        }),
        metricFinding("attributes.user.email", "phone-number"),
      ),
    ).toBe(false);

    // A filter a person wrote never counts: it may let the data through.
    for (const filters of [
      [
        {
          checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
          conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
          value: "user.logins",
        },
      ],
      [{ ...redactEmails, value: "@acmecorp\\.io$" }],
      [
        redactEmails,
        {
          checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
          attributeKey: "region",
          conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
          value: "eu",
        },
      ],
    ] as Array<Array<MetricPipelineRuleFilterCondition>>) {
      expect(
        coveredByMetricRule(
          savedMetricRule({
            ruleType: MetricPipelineRuleType.RedactAttribute,
            addAttributeKey: "user.email",
            filters,
          }),
          metricFinding("attributes.user.email"),
        ),
      ).toBe(false);
    }
  });

  test("Scrub It's filter is the type's own pattern on the attribute's value, or none where no pattern finds the type", () => {
    expect(buildMetricScrubFilters("email-address", "user.email")).toEqual([
      redactEmails,
    ]);
    // Found by the field's name, or one of the project's own: every value under the key.
    expect(buildMetricScrubFilters("person-name", "customer.name")).toEqual([]);
    expect(
      buildMetricScrubFilters(
        "custom:0192f1a0-0000-7000-8000-0000000d5300",
        "account.code",
      ),
    ).toEqual([]);
    // Each runs at ingest: saved as a rule is checked.
    expect(() => {
      validateMetricPipelineRuleFilters(
        buildMetricScrubFilters("github-token", "config.token"),
      );
    }).not.toThrow();
  });
});

describe("a built-in pattern type", () => {
  const patternTypes: Array<[string, string]> = Object.entries(
    DATA_TYPE_OF_SCRUB_PATTERN_TYPE,
  );

  test("maps every built-in value pattern ingest knows to the data type it finds", () => {
    expect(DATA_TYPE_OF_SCRUB_PATTERN_TYPE).toEqual({
      email: "email-address",
      creditCard: "credit-card-number",
      ssn: "us-ssn",
      phoneNumber: "phone-number",
      ipAddress: "ip-address",
    });

    for (const [patternType] of patternTypes) {
      expect(LOG_SCRUB_PATTERN_TYPES).toContain(patternType);
      expect(TRACE_SCRUB_PATTERN_TYPES).toContain(patternType);
    }
  });

  test.each(patternTypes)(
    "%s covers %s, and no other type, on the records it scrubs",
    (patternType: string, dataTypeId: string) => {
      const logRule: CoveringScrubRule = rule({
        signal: "log",
        patternType,
        fieldsToScrub: "both",
      });
      const traceRule: CoveringScrubRule = rule({
        signal: "trace",
        patternType,
        fieldsToScrub: "all",
      });
      const otherType: string =
        dataTypeId === "email-address" ? "phone-number" : "email-address";

      // A log rule: logs and a RUM application's logs, never spans.
      expect(
        covered(logRule, DataStoreKind.TelemetryLogs, "body", dataTypeId),
      ).toBe(true);
      expect(
        covered(
          logRule,
          DataStoreKind.TelemetryLogs,
          "attributes.x",
          dataTypeId,
        ),
      ).toBe(true);
      expect(
        covered(
          logRule,
          DataStoreKind.TelemetrySessionReplays,
          "logs.attributes.x",
          dataTypeId,
        ),
      ).toBe(true);
      expect(
        covered(logRule, DataStoreKind.TelemetryLogs, "body", otherType),
      ).toBe(false);

      for (const [kind, location] of [
        [DataStoreKind.TelemetryTraces, "attributes.x"],
        [DataStoreKind.TelemetryExceptions, "message"],
        [DataStoreKind.TelemetryAiConversations, "gen_ai.input.messages"],
        [DataStoreKind.TelemetrySessionReplays, "spans.attributes.x"],
      ] as Array<[DataStoreKind, string]>) {
        expect(covered(logRule, kind, location, dataTypeId)).toBe(false);
        expect(covered(traceRule, kind, location, dataTypeId)).toBe(true);
        expect(covered(traceRule, kind, location, otherType)).toBe(false);
      }

      expect(
        covered(traceRule, DataStoreKind.TelemetryLogs, "body", dataTypeId),
      ).toBe(false);
      expect(
        covered(
          traceRule,
          DataStoreKind.TelemetrySessionReplays,
          "logs.attributes.x",
          dataTypeId,
        ),
      ).toBe(false);
    },
  );
});

describe("a rule's fields to scrub", () => {
  // [fields to scrub, kind, location, covered]
  const LOG_CASES: Array<[string, DataStoreKind, string, boolean]> = [
    ["both", DataStoreKind.TelemetryLogs, "body", true],
    ["both", DataStoreKind.TelemetryLogs, "attributes.user.email", true],
    ["body", DataStoreKind.TelemetryLogs, "body", true],
    ["body", DataStoreKind.TelemetryLogs, "attributes.user.email", false],
    ["attributes", DataStoreKind.TelemetryLogs, "body", false],
    ["attributes", DataStoreKind.TelemetryLogs, "attributes.user.email", true],
    [
      "attributes",
      DataStoreKind.TelemetrySessionReplays,
      "logs.attributes.email",
      true,
    ],
    [
      "body",
      DataStoreKind.TelemetrySessionReplays,
      "logs.attributes.email",
      false,
    ],
    // A value ingest does not know scrubs no field.
    ["everything", DataStoreKind.TelemetryLogs, "body", false],
  ];

  const TRACE_CASES: Array<[string, DataStoreKind, string, boolean]> = [
    ["all", DataStoreKind.TelemetryTraces, "attributes.user.email", true],
    ["all", DataStoreKind.TelemetryTraces, "events.login.email", true],
    ["all", DataStoreKind.TelemetryTraces, "name", true],
    [
      "attributes",
      DataStoreKind.TelemetryTraces,
      "attributes.user.email",
      true,
    ],
    ["attributes", DataStoreKind.TelemetryTraces, "events.login.email", false],
    ["attributes", DataStoreKind.TelemetryTraces, "name", false],
    ["events", DataStoreKind.TelemetryTraces, "attributes.user.email", false],
    ["events", DataStoreKind.TelemetryTraces, "events.login.email", true],
    ["name", DataStoreKind.TelemetryTraces, "name", true],
    ["name", DataStoreKind.TelemetryTraces, "attributes.user.email", false],
    // An exception is its span's exception event.
    ["all", DataStoreKind.TelemetryExceptions, "message", true],
    ["events", DataStoreKind.TelemetryExceptions, "message", true],
    ["events", DataStoreKind.TelemetryExceptions, "stackTrace", true],
    [
      "events",
      DataStoreKind.TelemetryExceptions,
      "attributes.user.email",
      true,
    ],
    ["attributes", DataStoreKind.TelemetryExceptions, "message", false],
    [
      "attributes",
      DataStoreKind.TelemetryExceptions,
      "attributes.user.email",
      false,
    ],
    ["name", DataStoreKind.TelemetryExceptions, "stackTrace", false],
    // A prompt is a span attribute; a prompt event, an event.
    [
      "attributes",
      DataStoreKind.TelemetryAiConversations,
      "gen_ai.input.messages",
      true,
    ],
    [
      "attributes",
      DataStoreKind.TelemetryAiConversations,
      "gen_ai.prompt[].content",
      true,
    ],
    [
      "attributes",
      DataStoreKind.TelemetryAiConversations,
      "attributes.user.email",
      true,
    ],
    [
      "events",
      DataStoreKind.TelemetryAiConversations,
      "gen_ai.input.messages",
      false,
    ],
    [
      "events",
      DataStoreKind.TelemetryAiConversations,
      "events.gen_ai.user.message.content",
      true,
    ],
    [
      "attributes",
      DataStoreKind.TelemetryAiConversations,
      "events.gen_ai.user.message.content",
      false,
    ],
    [
      "attributes",
      DataStoreKind.TelemetrySessionReplays,
      "spans.attributes.email",
      true,
    ],
    [
      "events",
      DataStoreKind.TelemetrySessionReplays,
      "spans.attributes.email",
      false,
    ],
    [
      "all",
      DataStoreKind.TelemetrySessionReplays,
      "sessions.attributes.email",
      false,
    ],
    [
      "everything",
      DataStoreKind.TelemetryTraces,
      "attributes.user.email",
      false,
    ],
  ];

  test.each(LOG_CASES)(
    "a log email rule on %s, %s %s: %s",
    (
      fieldsToScrub: string,
      kind: DataStoreKind,
      location: string,
      expected: boolean,
    ) => {
      expect(
        covered(
          rule({
            signal: "log",
            patternType: LogScrubPatternType.Email,
            fieldsToScrub,
          }),
          kind,
          location,
          "email-address",
        ),
      ).toBe(expected);
    },
  );

  test.each(TRACE_CASES)(
    "a trace email rule on %s, %s %s: %s",
    (
      fieldsToScrub: string,
      kind: DataStoreKind,
      location: string,
      expected: boolean,
    ) => {
      expect(
        covered(
          rule({
            signal: "trace",
            patternType: LogScrubPatternType.Email,
            fieldsToScrub,
          }),
          kind,
          location,
          "email-address",
        ),
      ).toBe(expected);
    },
  );
});

describe("a sensitive-keys rule", () => {
  // [signal, kind, location, covered]
  const CASES: Array<[ScrubRuleSignal, DataStoreKind, string, boolean]> = [
    ["log", DataStoreKind.TelemetryLogs, "attributes.db.password", true],
    [
      "log",
      DataStoreKind.TelemetryLogs,
      "attributes.http.request.header.authorization",
      true,
    ],
    ["log", DataStoreKind.TelemetryLogs, "attributes.user.email", false],
    /*
     * A body, and an attribute holding a JSON text, have keys the rule
     * reads (#6513, #8993), but a finding names the whole field, of which
     * the rule hides only what is under a secret key.
     */
    ["log", DataStoreKind.TelemetryLogs, "body", false],
    ["log", DataStoreKind.TelemetryLogs, "attributes.http.request.body", false],
    [
      "trace",
      DataStoreKind.TelemetryTraces,
      "attributes.http.request.body",
      false,
    ],
    ["trace", DataStoreKind.TelemetryLogs, "attributes.db.password", false],
    ["trace", DataStoreKind.TelemetryTraces, "attributes.auth_token", true],
    ["trace", DataStoreKind.TelemetryTraces, "events.login.api_key", true],
    [
      "trace",
      DataStoreKind.TelemetryTraces,
      "events.token.refresh.user",
      false,
    ],
    ["trace", DataStoreKind.TelemetryTraces, "name", false],
    ["trace", DataStoreKind.TelemetryExceptions, "attributes.session_id", true],
    ["trace", DataStoreKind.TelemetryExceptions, "message", false],
    /*
     * #8924: a record's own session or conversation id, which the rule
     * keeps when the attribute holds it, as the record's column does. An
     * event's attributes, and any other session key, are hidden as before.
     */
    ["log", DataStoreKind.TelemetryLogs, "attributes.session.id", false],
    [
      "log",
      DataStoreKind.TelemetryLogs,
      "attributes.resource.session.id",
      false,
    ],
    ["trace", DataStoreKind.TelemetryTraces, "attributes.session.id", false],
    [
      "trace",
      DataStoreKind.TelemetryAiConversations,
      "attributes.langfuse.session.id",
      false,
    ],
    [
      "trace",
      DataStoreKind.TelemetryTraces,
      "events.checkout.session_id",
      true,
    ],
    ["trace", DataStoreKind.TelemetryTraces, "attributes.app.session.id", true],
    [
      "trace",
      DataStoreKind.TelemetryAiConversations,
      "attributes.client_secret",
      true,
    ],
    [
      "trace",
      DataStoreKind.TelemetryAiConversations,
      "gen_ai.input.messages",
      false,
    ],
    [
      "log",
      DataStoreKind.TelemetrySessionReplays,
      "logs.attributes.cookie",
      true,
    ],
    [
      "trace",
      DataStoreKind.TelemetrySessionReplays,
      "spans.attributes.cookie",
      true,
    ],
    [
      "trace",
      DataStoreKind.TelemetrySessionReplays,
      "sessions.attributes.token",
      false,
    ],
  ];

  test.each(CASES)(
    "on %s rules, %s %s: %s",
    (
      signal: ScrubRuleSignal,
      kind: DataStoreKind,
      location: string,
      expected: boolean,
    ) => {
      // Whatever its fields say: ingest runs it on attributes.
      for (const fieldsToScrub of ["body", "name", "attributes", "all"]) {
        expect(
          covered(
            rule({
              signal,
              patternType: LogScrubPatternType.SensitiveKeys,
              fieldsToScrub,
            }),
            kind,
            location,
            "github-token",
          ),
        ).toBe(expected);
      }
    },
  );

  test("hides any data type under a sensitive key", () => {
    const keysRule: CoveringScrubRule = rule({
      signal: "log",
      patternType: LogScrubPatternType.SensitiveKeys,
      fieldsToScrub: "attributes",
    });

    for (const dataTypeId of ["credit-card-number", "us-ssn", "person-name"]) {
      expect(
        covered(
          keysRule,
          DataStoreKind.TelemetryLogs,
          "attributes.card_number",
          dataTypeId,
        ),
      ).toBe(true);
    }
  });
});

describe("a custom rule", () => {
  test("counts when its pattern is the one Scrub It makes for the type", () => {
    const pattern: string | null = buildScrubPatternForDataType("github-token");

    expect(pattern).not.toBeNull();

    const madeByScrubIt: CoveringScrubRule = rule({
      signal: "log",
      patternType: LogScrubPatternType.Custom,
      fieldsToScrub: "attributes",
      customRegex: pattern!,
    });

    expect(
      covered(
        madeByScrubIt,
        DataStoreKind.TelemetryLogs,
        "attributes.config.github",
        "github-token",
      ),
    ).toBe(true);
    // Not another type, and not a field it does not scrub.
    expect(
      covered(
        madeByScrubIt,
        DataStoreKind.TelemetryLogs,
        "attributes.config.gitlab",
        "gitlab-token",
      ),
    ).toBe(false);
    expect(
      covered(
        madeByScrubIt,
        DataStoreKind.TelemetryLogs,
        "body",
        "github-token",
      ),
    ).toBe(false);
  });

  test("a pattern a person wrote is never taken for one that covers", () => {
    const pattern: string = buildScrubPatternForDataType("github-token")!;

    for (const customRegex of [
      "ghp_[A-Za-z0-9]{36}",
      "[\\s\\S]+",
      pattern + "|x",
    ]) {
      expect(
        covered(
          rule({
            signal: "log",
            patternType: LogScrubPatternType.Custom,
            fieldsToScrub: "both",
            customRegex,
            // Named as Scrub It names its rules, its pattern edited.
            name: `${DATA_SECURITY_SCRUB_RULE_NAME_PREFIX}GitHub token in body`,
          }),
          DataStoreKind.TelemetryLogs,
          "body",
          "github-token",
        ),
      ).toBe(false);
    }
  });
});

describe("the patterns Scrub It makes", () => {
  test.each(
    DATA_TYPE_CATALOG.map((info: DataTypeInfo): [string] => {
      return [info.id];
    }),
  )(
    "for %s: none, or one a custom rule can be saved with",
    (dataTypeId: string) => {
      const pattern: string | null = buildScrubPatternForDataType(dataTypeId);

      if (pattern === null) {
        return;
      }

      expect(pattern.length).toBeLessThanOrEqual(MAX_SCRUB_PATTERN_LENGTH);
      expect(checkScrubRuleCustomRegex(pattern)).toBeNull();
      expect(compileScrubRuleCustomRegex(pattern)).not.toBeNull();
      // Made the same way every time: a rule keeps counting as Scrub It's.
      expect(buildScrubPatternForDataType(dataTypeId)).toBe(pattern);
    },
  );

  test("scrub what their detectors find, at ingest", () => {
    const cases: Array<[string, string]> = [
      ["github-token", GITHUB_TOKEN],
      ["json-web-token", JSON_WEB_TOKEN],
      ["aws-access-key-id", "AKIAQWERTYUIOPASDFGH"],
    ];

    for (const [dataTypeId, secret] of cases) {
      const compiled: ScrubRegExp | null = compileScrubRuleCustomRegex(
        buildScrubPatternForDataType(dataTypeId),
      );

      expect(compiled).not.toBeNull();
      expect(
        compiled!.replace(`sent ${secret} at 10:00`, (): string => {
          return "[REDACTED]";
        }),
      ).toBe("sent [REDACTED] at 10:00");
    }
  });

  test("a JSON web token's pattern, too large to run as written, runs with its long counts open", () => {
    expect(buildScrubPatternForDataType("json-web-token")).toContain("{2,}");
  });

  test("none for a type found by names, one only its context tells apart, or a document's marking", () => {
    expect(buildScrubPatternForDataType("person-name")).toBeNull();
    expect(buildScrubPatternForDataType("us-bank-routing-number")).toBeNull();
    expect(buildScrubPatternForDataType("not-a-type")).toBeNull();
    // Hiding the word "Confidential" would not hide the document.
    expect(buildScrubPatternForDataType("confidential-document")).toBeNull();
    expect(buildScrubPatternForDataType("privileged-document")).toBeNull();
  });

  test("open only the counts that are too wide, outside classes and escapes", () => {
    expect(relaxLongRepeats("a{2,8000}b{1,13}")).toBe("a{2,}b{1,13}");
    expect(relaxLongRepeats("[{2,8000}]x")).toBe("[{2,8000}]x");
    expect(relaxLongRepeats("\\{2,8000}")).toBe("\\{2,8000}");
    expect(relaxLongRepeats("[\\]{]{5,1000}")).toBe("[\\]{]{5,}");
    expect(relaxLongRepeats("a{3}b{2,}")).toBe("a{3}b{2,}");
  });
});

describe("a project's coverage", () => {
  test("is its enabled rules, read as OneUptime, with each rule's default fields, and none that scrubs nothing", async () => {
    const logFindBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(LogScrubRuleService, "findBy")
      .mockResolvedValue([
        savedLogRule({ name: "Emails", patternType: "email" }),
        savedLogRule({
          name: "Broken",
          patternType: "custom",
          customRegex: "(",
        }),
        savedLogRule({ name: "Unknown", patternType: "Email" }),
        savedLogRule({
          name: "Nowhere",
          patternType: "ssn",
          fieldsToScrub: "everywhere",
        }),
      ] as never);
    const traceFindBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TraceScrubRuleService, "findBy")
      .mockResolvedValue([
        savedTraceRule({
          name: "Keys",
          patternType: "sensitiveKeys",
          fieldsToScrub: "name",
        }),
      ] as never);
    const metricFindBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(MetricPipelineRuleService, "findBy")
      .mockResolvedValue([
        savedMetricRule({
          name: "Hide checkout's user emails",
          ruleType: MetricPipelineRuleType.RedactAttribute,
          addAttributeKey: "user.email",
          serviceId: CHECKOUT,
        }),
        /*
         * A Drop rule with a person's own filter: read, but it covers no
         * attribute (#9757); nor a rule that names no key.
         */
        savedMetricRule({
          name: "Drop debug metrics",
          ruleType: MetricPipelineRuleType.Drop,
          filters: [
            {
              checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
              conditionType: MetricPipelineRuleFilterConditionType.StartsWith,
              value: "debug.",
            },
          ],
        }),
        savedMetricRule({
          name: "No key",
          ruleType: MetricPipelineRuleType.RemoveAttribute,
          addAttributeKey: " ",
        }),
      ] as never);

    const coverage: ScrubCoverage = await getScrubCoverage(PROJECT_ID);

    for (const spy of [logFindBy, traceFindBy, metricFindBy]) {
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { projectId: PROJECT_ID, isEnabled: true },
          props: { isRoot: true },
        }),
      );
    }

    expect(
      coverage.rules.map((covering: CoveringScrubRule): unknown => {
        return [covering.name, covering.signal, covering.fieldsToScrub];
      }),
    ).toEqual([
      ["Emails", "log", "both"],
      ["Keys", "trace", "name"],
      ["Hide checkout's user emails", "metric", "attributes"],
      ["Drop debug metrics", "metric", "name"],
    ]);
    expect(
      isFindingScrubbed(coverage, metricFinding("attributes.user.email")),
    ).toBe(true);
    expect(
      isFindingScrubbed(coverage, {
        ...metricFinding("attributes.user.email"),
        serviceId: PAYMENTS,
      }),
    ).toBe(false);
    expect(
      isFindingScrubbed(coverage, {
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "email-address",
        location: "attributes.user.email",
      }),
    ).toBe(true);
    expect(
      isFindingScrubbed(coverage, {
        kind: DataStoreKind.TelemetryTraces,
        dataTypeId: "github-token",
        location: "attributes.github.token",
      }),
    ).toBe(true);
    expect(
      isFindingScrubbed(coverage, {
        kind: DataStoreKind.TelemetryTraces,
        dataTypeId: "email-address",
        location: "attributes.user.email",
      }),
    ).toBe(false);
    expect(
      findCoveringScrubRule(coverage, {
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "email-address",
        location: "body",
      })?.name,
    ).toBe("Emails");
  });
});

describe("Scrub It", () => {
  let logCreate: ReturnType<typeof jest.spyOn>;
  let traceCreate: ReturnType<typeof jest.spyOn>;
  let metricCreate: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.spyOn(LogScrubRuleService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(MetricPipelineRuleService, "findBy")
      .mockResolvedValue([] as never);
    // The project's services, by the names a rule is given after them (#10433).
    jest.spyOn(ServiceService, "findOneBy").mockImplementation((async (
      findOneBy: FindOneBy<Service>,
    ): Promise<Service | null> => {
      return serviceNamed(
        String((findOneBy.query as Record<string, unknown>)["_id"]),
      );
    }) as never);
    metricCreate = jest
      .spyOn(MetricPipelineRuleService, "create")
      .mockImplementation((async (
        createBy: CreateBy<MetricPipelineRule>,
      ): Promise<MetricPipelineRule> => {
        createBy.data._id = "0192f1a0-0000-7000-8000-0000000d5103";
        return createBy.data;
      }) as never);
    logCreate = jest
      .spyOn(LogScrubRuleService, "create")
      .mockImplementation((async (
        createBy: CreateBy<LogScrubRule>,
      ): Promise<LogScrubRule> => {
        createBy.data._id = "0192f1a0-0000-7000-8000-0000000d5101";
        return createBy.data;
      }) as never);
    traceCreate = jest
      .spyOn(TraceScrubRuleService, "create")
      .mockImplementation((async (
        createBy: CreateBy<TraceScrubRule>,
      ): Promise<TraceScrubRule> => {
        createBy.data._id = "0192f1a0-0000-7000-8000-0000000d5102";
        return createBy.data;
      }) as never);
  });

  function createdLogRule(): LogScrubRule {
    return (logCreate.mock.calls[0]![0] as CreateBy<LogScrubRule>).data;
  }

  function createdTraceRule(): TraceScrubRule {
    return (traceCreate.mock.calls[0]![0] as CreateBy<TraceScrubRule>).data;
  }

  function createdMetricRule(): MetricPipelineRule {
    return (metricCreate.mock.calls[0]![0] as CreateBy<MetricPipelineRule>)
      .data;
  }

  test("an email in a metric's label: a rule for its service that redacts the label's emails", async () => {
    const created: CreatedScrubRule = await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryMetrics,
      dataTypeId: "email-address",
      location: "attributes.user.email",
      serviceId: CHECKOUT,
    });

    expect(created).toEqual({
      signal: "metric",
      scrubRuleId: "0192f1a0-0000-7000-8000-0000000d5103",
      scrubRuleName: "Data Security: Email address in attributes.user.email",
    });

    const saved: MetricPipelineRule = createdMetricRule();

    expect(saved.projectId).toEqual(PROJECT_ID);
    expect(saved.serviceId).toEqual(CHECKOUT);
    expect(saved.ruleType).toBe(MetricPipelineRuleType.RedactAttribute);
    expect(saved.addAttributeKey).toBe("user.email");
    expect(saved.redactReplacement).toBe(METRIC_REDACT_REPLACEMENT);
    expect(saved.filterCondition).toBe(FilterCondition.All);
    expect(saved.filters).toEqual(
      buildMetricScrubFilters("email-address", "user.email"),
    );
    expect(saved.isEnabled).toBe(true);
    expect(saved.name!.length).toBeLessThanOrEqual(100);
    expect(saved.description).toContain("Made by Data Security");
    expect(saved.description).toContain(
      "every value of user.email that holds email address",
    );
    expect(() => {
      validateMetricPipelineRuleFilters(saved.filters);
    }).not.toThrow();
    expect(logCreate).not.toHaveBeenCalled();
    expect(traceCreate).not.toHaveBeenCalled();
    // No person named: made as OneUptime itself, the caller having checked.
    expect(metricCreate.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ props: { isRoot: true } }),
    );

    // Once made, it is the rule that covers the finding.
    expect(
      coveredByMetricRule(saved, metricFinding("attributes.user.email")),
    ).toBe(true);
  });

  test("a name found by the label's key: every value of the label redacted", async () => {
    await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryMetrics,
      dataTypeId: "person-name",
      location: "attributes.resource.customer.full_name",
      serviceId: CHECKOUT,
    });

    const saved: MetricPipelineRule = createdMetricRule();

    expect(saved.addAttributeKey).toBe("resource.customer.full_name");
    expect(saved.filters).toEqual([]);
    expect(saved.description).toContain(
      "every value of resource.customer.full_name with",
    );
  });

  test("made as the person who asked, so the metric pipeline rules' own permissions apply", async () => {
    const memberProps: DatabaseCommonInteractionProps = {
      userId: USER_ID,
      tenantId: PROJECT_ID,
    };

    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue(memberProps as never);

    await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      userId: USER_ID,
      kind: DataStoreKind.TelemetryMetrics,
      dataTypeId: "ip-address",
      location: "attributes.resource.client.ip",
      serviceId: CHECKOUT,
    });

    expect(metricCreate.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ props: memberProps }),
    );
  });

  test("a metric attribute a rule already hides gets that rule", async () => {
    jest.spyOn(MetricPipelineRuleService, "findBy").mockResolvedValue([
      savedMetricRule({
        _id: "0192f1a0-0000-7000-8000-0000000d5198",
        name: "Remove emails everywhere",
        ruleType: MetricPipelineRuleType.RemoveAttribute,
        addAttributeKey: "user.email",
      }),
    ] as never);

    const created: CreatedScrubRule = await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryMetrics,
      dataTypeId: "email-address",
      location: "attributes.user.email",
      serviceId: CHECKOUT,
    });

    expect(created).toEqual({
      signal: "metric",
      scrubRuleId: "0192f1a0-0000-7000-8000-0000000d5198",
      scrubRuleName: "Remove emails everywhere",
    });
    expect(metricCreate).not.toHaveBeenCalled();
  });

  test("refuses a metric's name, saying why, a key longer than a rule can name, and a service that is gone", async () => {
    await expect(
      createScrubRuleForFinding({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId: "email-address",
        location: "name",
        serviceId: CHECKOUT,
      }),
    ).rejects.toThrow(METRIC_NAME_NOT_SCRUBBABLE);
    await expect(
      createScrubRuleForFinding({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetrySessionReplays,
        dataTypeId: "email-address",
        location: "sessions.identifiedUserLabel",
      }),
    ).rejects.toThrow(SESSION_DETAILS_NOT_SCRUBBABLE);
    await expect(
      createScrubRuleForFinding({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId: "email-address",
        location: `attributes.${"k".repeat(MAX_METRIC_RULE_ATTRIBUTE_KEY_LENGTH + 1)}`,
        serviceId: CHECKOUT,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      createScrubRuleForFinding({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId: "email-address",
        location: "attributes.user.email",
      }),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(metricCreate).not.toHaveBeenCalled();
    // The rule is built the same way either way.
    expect(() => {
      buildMetricScrubRule({
        projectId: PROJECT_ID,
        serviceId: "not-an-id",
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId: "email-address",
        location: "attributes.user.email",
        target: getScrubTarget(
          DataStoreKind.TelemetryMetrics,
          "attributes.user.email",
        )!,
      });
    }).toThrow(BadDataException);
  });

  test("an email in a log body: the built-in email pattern on log bodies", async () => {
    const created: CreatedScrubRule = await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      serviceId: CHECKOUT,
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "email-address",
      location: "body",
    });

    expect(created).toEqual({
      signal: "log",
      scrubRuleId: "0192f1a0-0000-7000-8000-0000000d5101",
      scrubRuleName: "Data Security: Email address in log bodies of checkout",
    });

    const saved: LogScrubRule = createdLogRule();

    expect(saved.projectId).toEqual(PROJECT_ID);
    expect(saved.patternType).toBe("email");
    expect(saved.fieldsToScrub).toBe("body");
    // Personal data is masked, as a finding's samples are (#10366).
    expect(saved.scrubAction).toBe("mask");
    expect(saved.isEnabled).toBe(true);
    expect(saved.description).toContain("Made by Data Security");
    expect(saved.description).toContain("from a finding");
    expect(() => {
      validateScrubRule(saved, {
        recordNoun: "logs",
        patternTypes: LOG_SCRUB_PATTERN_TYPES,
        fieldsToScrub: LOG_SCRUB_FIELDS,
      });
    }).not.toThrow();
    expect(traceCreate).not.toHaveBeenCalled();
    // No person named: made as OneUptime itself, the caller having checked.
    expect(logCreate.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ props: { isRoot: true } }),
    );
  });

  test("a card in span attributes: the built-in card pattern, masked, on span attributes", async () => {
    const created: CreatedScrubRule = await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      serviceId: CHECKOUT,
      kind: DataStoreKind.TelemetryTraces,
      dataTypeId: "credit-card-number",
      location: "attributes.payment.card",
    });

    expect(created.signal).toBe("trace");
    expect(created.scrubRuleId).toBe("0192f1a0-0000-7000-8000-0000000d5102");

    const saved: TraceScrubRule = createdTraceRule();

    expect(saved.patternType).toBe("creditCard");
    expect(saved.fieldsToScrub).toBe("attributes");
    expect(saved.scrubAction).toBe("mask");
    expect(saved.name).toBe(
      "Data Security: Card number in span attributes of checkout",
    );
    expect(saved.name!.length).toBeLessThanOrEqual(100);
    expect(saved.name!.startsWith(DATA_SECURITY_SCRUB_RULE_NAME_PREFIX)).toBe(
      true,
    );
    expect(() => {
      validateScrubRule(saved, {
        recordNoun: "spans",
        patternTypes: TRACE_SCRUB_PATTERN_TYPES,
        fieldsToScrub: TRACE_SCRUB_FIELDS,
      });
    }).not.toThrow();
    expect(logCreate).not.toHaveBeenCalled();
  });

  test("a GitHub token in a log attribute: a custom pattern ingest can scrub with", async () => {
    const created: CreatedScrubRule = await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      serviceId: CHECKOUT,
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "github-token",
      location: "attributes.config.github",
    });

    expect(created.signal).toBe("log");

    const saved: LogScrubRule = createdLogRule();

    expect(saved.patternType).toBe("custom");
    expect(saved.fieldsToScrub).toBe("attributes");
    expect(saved.scrubAction).toBe("redact");
    expect(saved.customRegex).toBe(
      buildScrubPatternForDataType("github-token"),
    );
    expect(checkScrubRuleCustomRegex(saved.customRegex)).toBeNull();
    expect(() => {
      validateScrubRule(saved, {
        recordNoun: "logs",
        patternTypes: LOG_SCRUB_PATTERN_TYPES,
        fieldsToScrub: LOG_SCRUB_FIELDS,
      });
    }).not.toThrow();

    const compiled: ScrubRegExp | null = compileScrubRuleCustomRegex(
      saved.customRegex,
    );

    expect(
      compiled!.replace(`token=${GITHUB_TOKEN};`, (): string => {
        return "[REDACTED]";
      }),
    ).toBe("token=[REDACTED];");

    // Once made, it is the rule that covers the finding.
    expect(
      isFindingScrubbed(
        {
          rules: [
            rule({
              signal: "log",
              patternType: saved.patternType!,
              fieldsToScrub: saved.fieldsToScrub!,
              customRegex: saved.customRegex,
            }),
          ],
        },
        {
          kind: DataStoreKind.TelemetryLogs,
          dataTypeId: "github-token",
          location: "attributes.config.github",
        },
      ),
    ).toBe(true);
  });

  test("a secret under a sensitive key: a sensitive-keys rule", async () => {
    await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      serviceId: CHECKOUT,
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "github-token",
      location: "attributes.api_token",
    });

    const saved: LogScrubRule = createdLogRule();

    expect(saved.patternType).toBe("sensitiveKeys");
    expect(saved.customRegex).toBeUndefined();
    expect(saved.fieldsToScrub).toBe("attributes");
    // What it hides, a JSON text held in a string included (#8993).
    expect(saved.description).toContain(
      "and every value under such a key inside a list, a map, a log body or a JSON text",
    );
    expect(saved.description!.length).toBeLessThanOrEqual(500);
  });

  /*
   * One of the project's own data types under a sensitive key (#10363): the
   * rule is named, and described, by the name the project gave the type -
   * never "Custom data type", and never its id.
   */
  describe("one of the project's own data types", () => {
    const EMPLOYEE_ROW: string = "0192f1a0-0000-7000-8000-0000000d5301";
    const EMPLOYEE: string = `custom:${EMPLOYEE_ROW}`;

    function projectTypes(
      names: Array<[string, string]>,
    ): ReturnType<typeof jest.spyOn> {
      return jest
        .spyOn(DataSecurityCustomDataTypeService, "findBy")
        .mockResolvedValue(
          names.map(([id, name]: [string, string]) => {
            const row: DataSecurityCustomDataType =
              new DataSecurityCustomDataType(new ObjectID(id));
            row.name = name;
            return row;
          }) as never,
        );
    }

    test("a log rule is named and described by the type's name", async () => {
      const read: ReturnType<typeof jest.spyOn> = projectTypes([
        [EMPLOYEE_ROW, "Employee ID"],
      ]);

      const created: CreatedScrubRule = await createScrubRuleForFinding({
        projectId: PROJECT_ID,
        serviceId: CHECKOUT,
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: EMPLOYEE,
        dataTypeName: "Staff number",
        location: "attributes.api_token",
      });

      expect(created.scrubRuleName).toBe(
        "Data Security: Employee ID in log attributes of checkout",
      );
      expect(createdLogRule().description).toContain("Employee ID");
      expect(JSON.stringify(createdLogRule())).not.toContain("custom:");
      expect(read).toHaveBeenCalledTimes(1);
    });

    test("a type the project deleted keeps the name its finding was found under", async () => {
      projectTypes([]);

      const created: CreatedScrubRule = await createScrubRuleForFinding({
        projectId: PROJECT_ID,
        serviceId: CHECKOUT,
        kind: DataStoreKind.TelemetryTraces,
        dataTypeId: EMPLOYEE,
        dataTypeName: "Badge number",
        location: "attributes.api_token",
      });

      // Held to a rule name's length, as every name Scrub It makes is.
      expect(
        created.scrubRuleName.startsWith("Data Security: Badge number in "),
      ).toBe(true);
      expect(created.scrubRuleName).not.toContain("custom:");
    });

    test("a metric's rule is named by the type's name too", async () => {
      projectTypes([[EMPLOYEE_ROW, "Employee ID"]]);

      const created: CreatedScrubRule = await createScrubRuleForFinding({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId: EMPLOYEE,
        location: "attributes.employee.code",
        serviceId: CHECKOUT,
      });

      expect(created.scrubRuleName).toBe(
        "Data Security: Employee ID in attributes.employee.code",
      );
      expect(createdMetricRule().description).toContain("Employee ID");
    });

    test("a built-in type reads no project's types", async () => {
      const read: ReturnType<typeof jest.spyOn> = projectTypes([]);

      await createScrubRuleForFinding({
        projectId: PROJECT_ID,
        serviceId: CHECKOUT,
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "github-token",
        location: "attributes.api_token",
      });

      expect(read).not.toHaveBeenCalled();
    });
  });

  test("a secret in a record's session.id: not a sensitive-keys rule, which keeps the record's own session id (#8924)", async () => {
    await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      serviceId: CHECKOUT,
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "github-token",
      location: "attributes.session.id",
    });

    // A pattern for the token's shape: it reads the value whatever its key.
    expect(createdLogRule().patternType).toBe("custom");
  });

  test("a token in an exception message: a trace rule on events", async () => {
    await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      serviceId: CHECKOUT,
      kind: DataStoreKind.TelemetryExceptions,
      dataTypeId: "json-web-token",
      location: "message",
    });

    const saved: TraceScrubRule = createdTraceRule();

    expect(saved.patternType).toBe("custom");
    expect(saved.fieldsToScrub).toBe("events");
    expect(checkScrubRuleCustomRegex(saved.customRegex)).toBeNull();
  });

  test("a finding a rule already covers gets that rule, not a second one", async () => {
    jest.spyOn(LogScrubRuleService, "findBy").mockResolvedValue([
      savedLogRule({
        _id: "0192f1a0-0000-7000-8000-0000000d5199",
        name: "Emails everywhere",
        patternType: "email",
        fieldsToScrub: "both",
      }),
    ] as never);

    const created: CreatedScrubRule = await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      serviceId: CHECKOUT,
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "email-address",
      location: "attributes.user.email",
    });

    expect(created).toEqual({
      signal: "log",
      scrubRuleId: "0192f1a0-0000-7000-8000-0000000d5199",
      scrubRuleName: "Emails everywhere",
    });
    expect(logCreate).not.toHaveBeenCalled();
  });

  test("made as the person who asked, so the scrub rules' own permissions apply", async () => {
    const memberProps: DatabaseCommonInteractionProps = {
      userId: USER_ID,
      tenantId: PROJECT_ID,
    };
    const getProps: ReturnType<typeof jest.spyOn> = jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue(memberProps as never);

    await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      userId: USER_ID,
      serviceId: CHECKOUT,
      kind: DataStoreKind.TelemetryAiConversations,
      dataTypeId: "phone-number",
      location: "gen_ai.input.messages",
    });

    expect(getProps).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
    expect(traceCreate.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ props: memberProps }),
    );
    expect(createdTraceRule().patternType).toBe("phoneNumber");
    expect(createdTraceRule().scrubAction).toBe("mask");
    expect(createdTraceRule().fieldsToScrub).toBe("attributes");
  });

  test("refuses a store that is not telemetry, and a kind it does not know", async () => {
    for (const kind of [DataStoreKind.AwsS3Bucket, "Nonsense"]) {
      await expect(
        createScrubRuleForFinding({
          projectId: PROJECT_ID,
          kind: kind as DataStoreKind,
          dataTypeId: "email-address",
          location: "body",
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    }

    expect(logCreate).not.toHaveBeenCalled();
    expect(traceCreate).not.toHaveBeenCalled();
  });

  test("refuses a location no scrub rule reaches, and a type no rule can find", async () => {
    const refusals: Array<{
      kind: DataStoreKind;
      dataTypeId: string;
      location: string;
    }> = [
      {
        kind: DataStoreKind.TelemetrySessionReplays,
        dataTypeId: "email-address",
        location: "sessions.identifiedUserLabel",
      },
      {
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "email-address",
        location: "message",
      },
      {
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "person-name",
        location: "attributes.customer.first_name",
      },
      {
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "custom:0192f1a0-0000-7000-8000-0000000d5300",
        location: "body",
      },
      {
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "internal-document",
        location: "body",
      },
    ];

    for (const refusal of refusals) {
      await expect(
        createScrubRuleForFinding({ projectId: PROJECT_ID, ...refusal }),
      ).rejects.toBeInstanceOf(BadDataException);
    }

    expect(logCreate).not.toHaveBeenCalled();
    expect(traceCreate).not.toHaveBeenCalled();
  });

  /*
   * WHOSE RECORDS SCRUB IT'S RULE CHANGES (#10433): the service the finding
   * was seen in, and no other - or, for a RUM application's replays, which
   * a rule cannot name, every service and app, said so.
   */
  describe("the service it is for", () => {
    test("a log rule is its finding's service's, and its name and description say so", async () => {
      const created: CreatedScrubRule = await createScrubRuleForFinding({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "email-address",
        location: "attributes.user.email",
        serviceId: CHECKOUT,
      });
      const saved: LogScrubRule = createdLogRule();

      expect(created.scrubRuleName).toBe(
        "Data Security: Email address in log attributes of checkout",
      );
      expect(saved.serviceId?.toString()).toBe(CHECKOUT.toString());
      expect(saved.description).toContain(
        "It masks every email address in log attribute values from now on.",
      );
      expect(saved.description).toContain(
        "It applies to the logs of checkout only: other services' logs are not changed.",
      );
      // Where it was found is said in the description, not taken for all it does.
      expect(saved.description).toContain("attributes.user.email");
    });

    test("a trace rule too, for spans, exceptions and AI calls alike", async () => {
      for (const [kind, location] of [
        [DataStoreKind.TelemetryTraces, "attributes.user.email"],
        [DataStoreKind.TelemetryExceptions, "message"],
        [DataStoreKind.TelemetryAiConversations, "gen_ai.input.messages"],
      ] as Array<[DataStoreKind, string]>) {
        traceCreate.mockClear();

        await createScrubRuleForFinding({
          projectId: PROJECT_ID,
          kind,
          dataTypeId: "email-address",
          location,
          serviceId: PAYMENTS,
        });

        expect(createdTraceRule().serviceId?.toString()).toBe(
          PAYMENTS.toString(),
        );
        expect(createdTraceRule().description).toContain(
          "the spans of payments only",
        );
      }
    });

    test("a store kept without its service names it by its key", async () => {
      await createScrubRuleForFinding({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "email-address",
        location: "body",
        storeKey: `telemetry:${CHECKOUT.toString()}:Logs`,
      });

      expect(createdLogRule().serviceId?.toString()).toBe(CHECKOUT.toString());
    });

    test("a RUM application's replays: a rule for every service and app, which says so", async () => {
      const created: CreatedScrubRule = await createScrubRuleForFinding({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetrySessionReplays,
        dataTypeId: "email-address",
        location: "logs.attributes.user.email",
        storeKey:
          "telemetry:0192f1a0-0000-7000-8000-0000000d5499:Session Replays",
      });

      expect(created.scrubRuleName).toBe(
        "Data Security: Email address in log attributes",
      );
      expect(createdLogRule().serviceId).toBeUndefined();
      expect(createdLogRule().description).toContain(
        "It applies to the logs of every service and app in the project.",
      );
    });

    test("a service that is gone gets no rule: one for every service would change what nobody found anything in", async () => {
      for (const data of [
        { serviceId: "0192f1a0-0000-7000-8000-0000000d5498" },
        {},
        { serviceId: "not-an-id" },
      ]) {
        await expect(
          createScrubRuleForFinding({
            projectId: PROJECT_ID,
            kind: DataStoreKind.TelemetryLogs,
            dataTypeId: "email-address",
            location: "body",
            ...data,
          }),
        ).rejects.toThrow(SCRUB_SERVICE_GONE);
      }

      expect(logCreate).not.toHaveBeenCalled();
    });

    test("a rule of another service does not cover the finding; one of its own, or of every service, does", async () => {
      jest.spyOn(LogScrubRuleService, "findBy").mockResolvedValue([
        savedLogRule({
          _id: "0192f1a0-0000-7000-8000-0000000d5197",
          name: "Payments' emails",
          patternType: "email",
          fieldsToScrub: "both",
          serviceId: PAYMENTS,
        }),
      ] as never);

      await createScrubRuleForFinding({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "email-address",
        location: "body",
        serviceId: CHECKOUT,
      });

      // Payments' rule leaves checkout's logs as they are: a rule of checkout's is made.
      expect(logCreate).toHaveBeenCalledTimes(1);

      const covering: CreatedScrubRule = await createScrubRuleForFinding({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "email-address",
        location: "body",
        serviceId: PAYMENTS,
      });

      expect(covering.scrubRuleName).toBe("Payments' emails");
      expect(logCreate).toHaveBeenCalledTimes(1);
    });

    test("the name and the plan are what the preview shows", async () => {
      const rule: ScrubItRule = await planScrubItRule({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryTraces,
        dataTypeId: "ip-address",
        location: "attributes.client.address",
        target: getScrubTarget(
          DataStoreKind.TelemetryTraces,
          "attributes.client.address",
        ) as ScrubTarget & { signal: "log" | "trace" },
        serviceId: CHECKOUT,
      });

      expect(rule).toEqual(
        expect.objectContaining({
          signal: "trace",
          dataTypeName: "IP address",
          name: "Data Security: IP address in span attributes of checkout",
          scope: { serviceId: CHECKOUT, serviceName: "checkout" },
          plan: {
            patternType: "ipAddress",
            scrubAction: "redact",
            fieldsToScrub: "attributes",
          },
        }),
      );
    });
  });
});
