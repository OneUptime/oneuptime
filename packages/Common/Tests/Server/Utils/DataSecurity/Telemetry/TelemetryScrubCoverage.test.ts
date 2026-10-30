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
import TraceScrubRule from "../../../../../Models/DatabaseModels/TraceScrubRule";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../../../../Server/Services/TraceScrubRuleService";
import CreateBy from "../../../../../Server/Types/Database/CreateBy";
import {
  buildScrubPatternForDataType,
  CoveringScrubRule,
  createScrubRuleForFinding,
  CreatedScrubRule,
  DATA_SECURITY_SCRUB_RULE_NAME_PREFIX,
  DATA_TYPE_OF_SCRUB_PATTERN_TYPE,
  findCoveringScrubRule,
  getScrubCoverage,
  getScrubTarget,
  INGEST_SENSITIVE_KEY_REGEX,
  isFindingScrubbed,
  MAX_SCRUB_PATTERN_LENGTH,
  relaxLongRepeats,
  ScrubbedField,
  ScrubCoverage,
  ScrubRuleSignal,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { validateScrubRule } from "../../../../../Server/Utils/ScrubRuleValidation";
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

function ingestSensitiveKeyRegex(fileName: string): RegExp {
  const text: string = fs.readFileSync(
    path.join(APP_TELEMETRY_SERVICES, fileName),
    "utf8",
  );
  const declaration: string = "const SENSITIVE_KEY_REGEX: RegExp =";
  const start: number = text.indexOf(declaration);

  expect(start).toBeGreaterThanOrEqual(0);

  const literalStart: number = text.indexOf("/", start + declaration.length);
  const literal: string = text
    .slice(literalStart, text.indexOf(";", literalStart))
    .trim();
  const lastSlash: number = literal.lastIndexOf("/");

  return new RegExp(literal.slice(1, lastSlash), literal.slice(lastSlash + 1));
}

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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the sensitive-key pattern", () => {
  test("is exactly the one both ingest engines read keys with", () => {
    for (const fileName of [
      "LogScrubRuleService.ts",
      "TraceScrubRuleService.ts",
    ]) {
      const ingest: RegExp = ingestSensitiveKeyRegex(fileName);

      expect(INGEST_SENSITIVE_KEY_REGEX.source).toBe(ingest.source);
      expect(INGEST_SENSITIVE_KEY_REGEX.flags).toBe(ingest.flags);
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
    // Bodies have no keys.
    ["log", DataStoreKind.TelemetryLogs, "body", false],
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

    const coverage: ScrubCoverage = await getScrubCoverage(PROJECT_ID);

    for (const spy of [logFindBy, traceFindBy]) {
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
    ]);
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

  beforeEach(() => {
    jest.spyOn(LogScrubRuleService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([] as never);
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

  test("an email in a log body: the built-in email pattern on log bodies", async () => {
    const created: CreatedScrubRule = await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "email-address",
      location: "body",
    });

    expect(created).toEqual({
      signal: "log",
      scrubRuleId: "0192f1a0-0000-7000-8000-0000000d5101",
      scrubRuleName: "Data Security: Email address in body",
    });

    const saved: LogScrubRule = createdLogRule();

    expect(saved.projectId).toEqual(PROJECT_ID);
    expect(saved.patternType).toBe("email");
    expect(saved.fieldsToScrub).toBe("body");
    expect(saved.scrubAction).toBe("redact");
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
    expect(saved.name!.length).toBeLessThanOrEqual(50);
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
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "github-token",
      location: "attributes.api_token",
    });

    const saved: LogScrubRule = createdLogRule();

    expect(saved.patternType).toBe("sensitiveKeys");
    expect(saved.customRegex).toBeUndefined();
    expect(saved.fieldsToScrub).toBe("attributes");
  });

  test("a token in an exception message: a trace rule on events", async () => {
    await createScrubRuleForFinding({
      projectId: PROJECT_ID,
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
});
