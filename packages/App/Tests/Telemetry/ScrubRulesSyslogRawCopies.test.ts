import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService, {
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import ProbeSyslogIngestService from "../../FeatureSet/Telemetry/Services/ProbeSyslogIngestService";
import SyslogIngestService from "../../FeatureSet/Telemetry/Services/SyslogIngestService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import LogService from "Common/Server/Services/LogService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import SyslogDeviceMatcher from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject } from "Common/Types/JSON";
import LogPipelineProcessorType from "Common/Types/Log/LogPipelineProcessorType";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import SyslogAttribute from "Common/Types/Syslog/SyslogAttribute";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { escapeSyslogStructuredDataValue } from "Common/Utils/Syslog/SyslogMessageParser";

/*
 * ---------------------------------------------------------------------------
 * A SYSLOG LINE'S RAW COPIES HOLD WHAT THE SCRUB RULES LEFT OF ITS PARTS
 * (#9039).
 *
 * Syslog posted over HTTP keeps the whole line as syslog.raw and an RFC
 * 5424 line's structured data as syslog.structured.raw; the syslog a probe
 * forwards keeps the structured data. A scrub rule hid a secret in the
 * body or in a structured-data parameter, and the raw copies kept it:
 *
 *   - a Sensitive Attribute Keys rule never reads free text, so the
 *     password it hid in syslog.structured.auth_1.password, and the token
 *     it hid in a JSON message, stayed in both copies;
 *   - a pattern rule reads a JSON message with its escapes read (#8923),
 *     and the raw copy as plain text, where a card number after "\n"
 *     follows the letter n and is no word of its own;
 *   - a Body Only rule never read the copies at all.
 *
 * End to end from the batch each route posts to the rows written, with the
 * project's real scrub rules: only the persistence edges are replaced.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const PROBE_ID: ObjectID = ObjectID.generate();

type CompiledRule = { rule: LogScrubRule; regex: ScrubRegExp };

function rule(
  patternType: LogScrubPatternType,
  options: {
    action?: LogScrubAction | undefined;
    fields?: LogScrubField | undefined;
    customRegex?: string | undefined;
  } = {},
): CompiledRule {
  const scrubRule: LogScrubRule = new LogScrubRule();
  scrubRule.name = patternType;
  // A Hash rule hashes with its project's key, as the rules ingest loads do.
  scrubRule.projectId = PROJECT_ID;
  scrubRule.patternType = patternType;
  scrubRule.scrubAction = options.action || LogScrubAction.Redact;
  scrubRule.fieldsToScrub = options.fields || LogScrubField.Both;

  if (options.customRegex) {
    scrubRule.customRegex = options.customRegex;
  }

  const regex: ScrubRegExp | null = (
    LogScrubRuleService as unknown as {
      getRegexForPattern: (
        patternType: string,
        customRegex?: string,
      ) => ScrubRegExp | null;
    }
  ).getRegexForPattern(patternType, options.customRegex);

  expect(regex).not.toBeNull();

  return { rule: scrubRule, regex: regex as ScrubRegExp };
}

let rules: Array<CompiledRule>;
let pipelines: Array<LoadedPipeline>;
let storedRows: Array<JSONObject>;
let probeRows: Array<JSONObject>;

beforeEach(() => {
  rules = [];
  pipelines = [];
  storedRows = [];
  probeRows = [];

  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async (data: {
      serviceName: string;
    }): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: data.serviceName,
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      } as unknown as TelemetryServiceMetadata;
    }) as never);
  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    _target: unknown,
    rows: Array<JSONObject>,
  ): Promise<{ flushed: Promise<void> }> => {
    storedRows.push(...rows);
    return { flushed: Promise.resolve() };
  }) as never);
  jest.spyOn(LogService, "insertJsonRows").mockImplementation((async (
    inserted: Array<JSONObject>,
  ): Promise<void> => {
    probeRows.push(...inserted);
  }) as never);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockImplementation((async (): Promise<Array<LoadedPipeline>> => {
      return pipelines;
    }) as never);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockImplementation((async (): Promise<Array<CompiledRule>> => {
      return rules;
    }) as never);
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(SyslogDeviceMatcher, "getProbe")
    .mockResolvedValue({ id: PROBE_ID, projectId: PROJECT_ID } as never);
  jest.spyOn(SyslogDeviceMatcher, "attribute").mockResolvedValue({
    devices: [],
    unmatchedProjectId: PROJECT_ID,
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  SyslogDeviceMatcher.clearCaches();
});

// Syslog posted over HTTP: the rows written for these lines.
async function postedOverHttp(
  lines: Array<string>,
): Promise<Array<JSONObject>> {
  storedRows = [];

  await SyslogIngestService.processSyslogFromQueue({
    projectId: PROJECT_ID,
    body: { messages: lines },
    headers: {},
    query: {},
  } as unknown as ExpressRequest);

  expect(storedRows).toHaveLength(lines.length);

  return storedRows;
}

// The syslog a probe forwards: the rows written for these lines.
async function forwardedByProbe(
  lines: Array<string>,
): Promise<Array<JSONObject>> {
  probeRows = [];

  await ProbeSyslogIngestService.processSyslogMessages(
    PROBE_ID,
    lines.map((line: string): JSONObject => {
      return {
        sourceIpAddress: "10.0.0.9",
        facility: 20,
        severity: 5,
        message: line,
        receivedAt: "2026-11-16T10:12:00.000Z",
        raw: line,
      };
    }),
  );

  expect(probeRows).toHaveLength(lines.length);

  return probeRows;
}

// A route syslog arrives by: the rows it writes for these lines.
type Ingest = (lines: Array<string>) => Promise<Array<JSONObject>>;

const ROUTES: Array<[string, Ingest]> = [
  ["syslog posted over HTTP", postedOverHttp],
  ["the syslog a probe forwards", forwardedByProbe],
];

const ACTIONS: Array<LogScrubAction> = [
  LogScrubAction.Redact,
  LogScrubAction.Mask,
  LogScrubAction.Hash,
];

function attributesOf(row: JSONObject): JSONObject {
  return row["attributes"] as JSONObject;
}

const HEADER: string =
  "<165>1 2026-11-16T10:11:12.003Z web-01 checkout 4711 ID47";

// The issue's own line.
const ISSUE_LINE: string = `${HEADER} [auth@1 password="hunter2"] {"token":"t-1"}`;

describe("the issue's line, with a Sensitive Attribute Keys rule", () => {
  test("syslog posted over HTTP: nothing the rule hid is left in syslog.raw or syslog.structured.raw", async () => {
    rules = [rule(LogScrubPatternType.SensitiveKeys)];

    const [row] = await postedOverHttp([ISSUE_LINE]);
    const attributes: JSONObject = attributesOf(row!);

    expect(row!["body"]).toBe('{"token":"[REDACTED]"}');
    expect(attributes["syslog.structured.auth_1.password"]).toBe("[REDACTED]");
    expect(attributes[SyslogAttribute.StructuredRaw]).toBe(
      '[auth@1 password="[REDACTED\\]"]',
    );
    expect(attributes[SyslogAttribute.Raw]).toBe(
      `${HEADER} [auth@1 password="[REDACTED\\]"] {"token":"[REDACTED]"}`,
    );
    expect(JSON.stringify(row)).not.toContain("hunter2");
    expect(JSON.stringify(row)).not.toContain("t-1");
  });

  test("the syslog a probe forwards: nothing the rule hid is left in syslog.structured.raw", async () => {
    rules = [rule(LogScrubPatternType.SensitiveKeys)];

    const [row] = await forwardedByProbe([ISSUE_LINE]);
    const attributes: JSONObject = attributesOf(row!);

    expect(row!["body"]).toBe('{"token":"[REDACTED]"}');
    expect(attributes[SyslogAttribute.StructuredRaw]).toBe(
      '[auth@1 password="[REDACTED\\]"]',
    );
    // A probe's syslog keeps no copy of the whole line.
    expect(attributes[SyslogAttribute.Raw]).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("hunter2");
    expect(JSON.stringify(row)).not.toContain("t-1");
  });
});

/*
 * Each rule kind, its secret in a structured-data parameter and in a JSON
 * message after a line break - written "\n" in the line, so a pattern rule
 * reading the raw copy as plain text finds no word boundary before it.
 */
const PATTERN_SECRETS: Array<[LogScrubPatternType, string, string?]> = [
  [LogScrubPatternType.Email, "jane@example.com"],
  [LogScrubPatternType.CreditCard, "4111 1111 1111 1111"],
  [LogScrubPatternType.SSN, "123-45-6789"],
  [LogScrubPatternType.PhoneNumber, "555-123-4567"],
  // A public address: a private one is no one's, and is kept (#10393).
  [LogScrubPatternType.IPAddress, "203.0.113.7"],
  [LogScrubPatternType.Custom, "ACME-SECRET-42", "ACME-SECRET-\\d+"],
];

function secretLine(secret: string): string {
  return `${HEADER} [meta note="paid by ${secret}" seq="9"] {"msg":"line one\\n${secret}","n":1}`;
}

// Each pattern rule kind under each action.
const PATTERN_CASES: Array<
  [LogScrubPatternType, LogScrubAction, string, string | undefined]
> = PATTERN_SECRETS.flatMap(
  ([patternType, secret, customRegex]: [
    LogScrubPatternType,
    string,
    string?,
  ]): Array<
    [LogScrubPatternType, LogScrubAction, string, string | undefined]
  > => {
    return ACTIONS.map(
      (
        action: LogScrubAction,
      ): [LogScrubPatternType, LogScrubAction, string, string | undefined] => {
        return [patternType, action, secret, customRegex];
      },
    );
  },
);

describe.each(ROUTES)(
  "%s, every rule kind and action",
  (_route: string, ingest: Ingest) => {
    test.each(PATTERN_CASES)(
      "%s, %s: hidden in the body and the parameter, and so in the raw copies",
      async (
        patternType: LogScrubPatternType,
        action: LogScrubAction,
        secret: string,
        customRegex: string | undefined,
      ) => {
        rules = [
          rule(patternType, { action: action, customRegex: customRegex }),
        ];

        const [row] = await ingest([secretLine(secret)]);
        const attributes: JSONObject = attributesOf(row!);

        // The parts, as the rule leaves them.
        expect(row!["body"]).not.toContain(secret);
        expect(JSON.parse(row!["body"] as string)).toEqual({
          msg: expect.stringMatching(/^line one\n/),
          n: 1,
        });
        expect(attributes["syslog.structured.meta.note"]).not.toContain(secret);

        // The raw copies: rebuilt from them, nothing of the secret left.
        expect(JSON.stringify(row)).not.toContain(secret);
        expect(attributes[SyslogAttribute.StructuredRaw]).toBe(
          `[meta note="${escapeSyslogStructuredDataValue(attributes["syslog.structured.meta.note"] as string)}" seq="9"]`,
        );

        if (ingest === postedOverHttp) {
          expect(attributes[SyslogAttribute.Raw]).toBe(
            `${HEADER} ${attributes[SyslogAttribute.StructuredRaw] as string} ${row!["body"] as string}`,
          );
        }
      },
    );

    test.each(ACTIONS)(
      "sensitiveKeys, %s: the password and the JSON message's token, hidden in the raw copies as in the parts",
      async (action: LogScrubAction) => {
        rules = [rule(LogScrubPatternType.SensitiveKeys, { action: action })];

        const [row] = await ingest([
          `${HEADER} [auth@1 password="hunter2" user="ada"] {"token":"t-123456","user":"ada"}`,
        ]);
        const attributes: JSONObject = attributesOf(row!);
        const password: string = attributes[
          "syslog.structured.auth_1.password"
        ] as string;

        expect(password).not.toBe("hunter2");
        expect(attributes[SyslogAttribute.StructuredRaw]).toBe(
          `[auth@1 password="${escapeSyslogStructuredDataValue(password)}" user="ada"]`,
        );
        expect(JSON.stringify(row)).not.toContain("hunter2");
        expect(JSON.stringify(row)).not.toContain("t-123456");

        if (ingest === postedOverHttp) {
          expect(attributes[SyslogAttribute.Raw]).toBe(
            `${HEADER} ${attributes[SyslogAttribute.StructuredRaw] as string} ${row!["body"] as string}`,
          );
        }
      },
    );

    test("the card number after a line break in a JSON message, which the raw copy read as text missed (#8923)", async () => {
      rules = [rule(LogScrubPatternType.CreditCard)];

      const [row] = await ingest([
        `${HEADER} - {"paid":"with\\n4111 1111 1111 1111"}`,
      ]);

      expect(row!["body"]).toBe('{"paid":"with\\n[REDACTED]"}');

      if (ingest === postedOverHttp) {
        expect(attributesOf(row!)[SyslogAttribute.Raw]).toBe(
          `${HEADER} - {"paid":"with\\n[REDACTED]"}`,
        );
      }
    });
  },
);

describe.each(ROUTES)(
  "%s, escapes in a parameter's value",
  (_route: string, ingest: Ingest) => {
    test('\\", \\\\ and \\] in a hidden value: the whole value is replaced, and every other byte kept', async () => {
      rules = [rule(LogScrubPatternType.SensitiveKeys)];

      const [row] = await ingest([
        `${HEADER} [auth@1 password="hu\\"nt\\\\er\\]2" note="a \\"b\\" \\] c \\\\ d"][meta x="\\]"] done`,
      ]);
      const attributes: JSONObject = attributesOf(row!);

      expect(attributes["syslog.structured.auth_1.note"]).toBe(
        'a "b" ] c \\ d',
      );
      expect(attributes["syslog.structured.meta.x"]).toBe("]");
      expect(attributes["syslog.structured.auth_1.password"]).toBe(
        "[REDACTED]",
      );
      expect(attributes[SyslogAttribute.StructuredRaw]).toBe(
        '[auth@1 password="[REDACTED\\]" note="a \\"b\\" \\] c \\\\ d"][meta x="\\]"]',
      );
      expect(row!["body"]).toBe("done");

      if (ingest === postedOverHttp) {
        expect(attributes[SyslogAttribute.Raw]).toBe(
          `${HEADER} [auth@1 password="[REDACTED\\]" note="a \\"b\\" \\] c \\\\ d"][meta x="\\]"] done`,
        );
      }
    });

    test("a value a pattern rule changed in part is written with its escapes again", async () => {
      rules = [rule(LogScrubPatternType.Email)];

      const [row] = await ingest([
        `${HEADER} [mail@1 to="say \\"hi\\" to jane@example.com \\]"] sent`,
      ]);
      const attributes: JSONObject = attributesOf(row!);

      expect(attributes["syslog.structured.mail_1.to"]).toBe(
        'say "hi" to [REDACTED] ]',
      );
      expect(attributes[SyslogAttribute.StructuredRaw]).toBe(
        '[mail@1 to="say \\"hi\\" to [REDACTED\\] \\]"]',
      );
    });

    test("a password with a quote in it is a parameter, and is hidden: it no longer drops its element", async () => {
      rules = [rule(LogScrubPatternType.SensitiveKeys)];

      const [row] = await ingest([
        `${HEADER} [auth@1 user="ada" password="p\\"ss"] login`,
      ]);
      const attributes: JSONObject = attributesOf(row!);

      expect(attributes["syslog.structured.auth_1.user"]).toBe("ada");
      expect(attributes["syslog.structured.auth_1.password"]).toBe(
        "[REDACTED]",
      );
      expect(attributes[SyslogAttribute.StructuredRaw]).toBe(
        '[auth@1 user="ada" password="[REDACTED\\]"]',
      );
      expect(row!["body"]).toBe("login");

      if (ingest === postedOverHttp) {
        expect(attributes[SyslogAttribute.Raw]).toBe(
          `${HEADER} [auth@1 user="ada" password="[REDACTED\\]"] login`,
        );
      }
    });
  },
);

describe.each(ROUTES)(
  "%s, a parameter written twice",
  (_route: string, ingest: Ingest) => {
    test("both values of a repeated parameter are hidden, whichever the record keeps", async () => {
      rules = [
        rule(LogScrubPatternType.IPAddress),
        rule(LogScrubPatternType.SensitiveKeys),
      ];

      const [row] = await ingest([
        `${HEADER} [origin ip="192.0.2.1" ip="192.0.2.129"][auth@1 password="first" password="second"] up`,
      ]);
      const attributes: JSONObject = attributesOf(row!);

      expect(attributes["syslog.structured.origin.ip"]).toBe("[REDACTED]");
      expect(attributes[SyslogAttribute.StructuredRaw]).toBe(
        '[origin ip="[REDACTED\\]" ip="[REDACTED\\]"][auth@1 password="[REDACTED\\]" password="[REDACTED\\]"]',
      );
      expect(JSON.stringify(row)).not.toContain("192.0.2");
      expect(JSON.stringify(row)).not.toContain("first");
      expect(JSON.stringify(row)).not.toContain("second");
    });
  },
);

describe("what each rule's Fields to Scrub reaches", () => {
  const LINE: string = `${HEADER} [meta note="ada@example.com"] mail from jane@example.com`;

  test("Body Only: the message's address is hidden in syslog.raw too; the parameter's, which no rule hid, is kept", async () => {
    rules = [rule(LogScrubPatternType.Email, { fields: LogScrubField.Body })];

    const [row] = await postedOverHttp([LINE]);
    const attributes: JSONObject = attributesOf(row!);

    expect(row!["body"]).toBe("mail from [REDACTED]");
    expect(attributes["syslog.structured.meta.note"]).toBe("ada@example.com");
    expect(attributes[SyslogAttribute.StructuredRaw]).toBe(
      '[meta note="ada@example.com"]',
    );
    expect(attributes[SyslogAttribute.Raw]).toBe(
      `${HEADER} [meta note="ada@example.com"] mail from [REDACTED]`,
    );
  });

  test("Attributes Only: the raw copies, attributes, hide both; the body is not the rule's to scrub", async () => {
    rules = [
      rule(LogScrubPatternType.Email, { fields: LogScrubField.Attributes }),
    ];

    const [row] = await postedOverHttp([LINE]);
    const attributes: JSONObject = attributesOf(row!);

    expect(row!["body"]).toBe("mail from jane@example.com");
    expect(attributes["syslog.structured.meta.note"]).toBe("[REDACTED]");
    expect(attributes[SyslogAttribute.StructuredRaw]).toBe(
      '[meta note="[REDACTED\\]"]',
    );
    expect(attributes[SyslogAttribute.Raw]).toBe(
      `${HEADER} [meta note="[REDACTED\\]"] mail from [REDACTED]`,
    );
  });

  test("a Sensitive Attribute Keys rule saved as Body Only still hides the parameter in both copies", async () => {
    rules = [
      rule(LogScrubPatternType.SensitiveKeys, { fields: LogScrubField.Body }),
    ];

    const [row] = await postedOverHttp([ISSUE_LINE]);

    expect(JSON.stringify(row)).not.toContain("hunter2");
    expect(JSON.stringify(row)).not.toContain("t-1");
  });
});

describe("RFC 3164 lines, posted over HTTP", () => {
  // Documentation addresses, which an IP Address rule hides as public ones.
  const LINE: string =
    "<34>Oct 11 22:14:15 203.0.113.3 sshd[4321]: Accepted password for ada@example.com from 198.51.100.7";

  test("a host name an IP rule hides is hidden where the line writes it", async () => {
    rules = [
      rule(LogScrubPatternType.IPAddress, { fields: LogScrubField.Attributes }),
    ];

    const [row] = await postedOverHttp([LINE]);
    const attributes: JSONObject = attributesOf(row!);

    expect(attributes[SyslogAttribute.Hostname]).toBe("[REDACTED]");
    expect(row!["body"]).toBe(
      "Accepted password for ada@example.com from 198.51.100.7",
    );
    expect(attributes[SyslogAttribute.Raw]).toBe(
      "<34>Oct 11 22:14:15 [REDACTED] sshd[4321]: Accepted password for ada@example.com from [REDACTED]",
    );
  });

  test("a Body Only rule: the message is the body's, the header is kept", async () => {
    rules = [
      rule(LogScrubPatternType.Email, { fields: LogScrubField.Body }),
      rule(LogScrubPatternType.IPAddress, { fields: LogScrubField.Body }),
    ];

    const [row] = await postedOverHttp([LINE]);

    expect(row!["body"]).toBe(
      "Accepted password for [REDACTED] from [REDACTED]",
    );
    expect(attributesOf(row!)[SyslogAttribute.Raw]).toBe(
      "<34>Oct 11 22:14:15 203.0.113.3 sshd[4321]: Accepted password for [REDACTED] from [REDACTED]",
    );
  });

  test("a private host and peer, which an IP Address rule keeps, are kept in the raw copy too (#10393)", async () => {
    const privateLine: string =
      "<34>Oct 11 22:14:15 10.1.2.3 sshd[4321]: Accepted password for ada from 10.9.8.7";

    rules = [rule(LogScrubPatternType.IPAddress)];

    const [row] = await postedOverHttp([privateLine]);
    const attributes: JSONObject = attributesOf(row!);

    expect(attributes[SyslogAttribute.Hostname]).toBe("10.1.2.3");
    expect(row!["body"]).toBe("Accepted password for ada from 10.9.8.7");
    expect(attributes[SyslogAttribute.Raw]).toBe(privateLine);
  });

  test("a JSON message after a tag: the keys rule's hidden token is hidden in syslog.raw", async () => {
    rules = [rule(LogScrubPatternType.SensitiveKeys)];

    const [row] = await postedOverHttp([
      '<34>Oct 11 22:14:15 web-01 app[7]: {"event":"login","api_key":"k-77","user":"ada"}',
    ]);

    expect(attributesOf(row!)[SyslogAttribute.Raw]).toBe(
      '<34>Oct 11 22:14:15 web-01 app[7]: {"event":"login","api_key":"[REDACTED]","user":"ada"}',
    );
  });
});

describe.each(ROUTES)(
  "%s, a line no rule changes",
  (_route: string, ingest: Ingest) => {
    test("keeps both raw copies byte for byte, with every rule kind configured", async () => {
      rules = [
        rule(LogScrubPatternType.SensitiveKeys),
        ...PATTERN_SECRETS.map(
          ([patternType, , customRegex]: [
            LogScrubPatternType,
            string,
            string?,
          ]): CompiledRule => {
            return rule(patternType, { customRegex: customRegex });
          },
        ),
      ];

      const lines: Array<string> = [
        `${HEADER} [meta seq="9" note="a \\"quoted\\" \\] word \\\\ done"] [origin software="rsyslogd"] all quiet on web-01`,
        `${HEADER} - {"event":"login","user":"ada","attempt":2}`,
        `${HEADER} [exampleSDID@32473 iut="3" eventSource="Application" eventID="1011"] BOMan application event`,
        "<34>Oct 11 22:14:15 mymachine su[123]: 'su root' failed for lonvick on /dev/pts/8",
      ];

      const rows: Array<JSONObject> = await ingest(lines);

      rows.forEach((row: JSONObject, index: number): void => {
        const line: string = lines[index]!;
        const attributes: JSONObject = attributesOf(row);
        const structuredData: RegExpMatchArray | null =
          line.match(/ID47 (\[.*\])(?: \S)/);

        if (ingest === postedOverHttp) {
          expect({ line, raw: attributes[SyslogAttribute.Raw] }).toEqual({
            line,
            raw: line,
          });
        }

        expect({
          line,
          structured: attributes[SyslogAttribute.StructuredRaw],
        }).toEqual({
          line,
          structured: structuredData ? structuredData[1] : undefined,
        });
      });
    });
  },
);

describe("pipelines read the raw copies the rules left", () => {
  test("a pipeline that copies syslog.raw copies it rebuilt", async () => {
    rules = [rule(LogScrubPatternType.SensitiveKeys)];
    pipelines = [
      {
        pipeline: { name: "copy the line" },
        compiledFilter: compileFilter(""),
        processors: [
          {
            name: "copy",
            processorType: LogPipelineProcessorType.AttributeRemapper,
            configuration: {
              sourceKey: SyslogAttribute.Raw,
              targetKey: "line.copy",
              preserveSource: true,
              overrideOnConflict: true,
            },
          },
        ],
      },
    ] as unknown as Array<LoadedPipeline>;

    const [row] = await postedOverHttp([ISSUE_LINE]);

    expect(attributesOf(row!)["line.copy"]).toBe(
      `${HEADER} [auth@1 password="[REDACTED\\]"] {"token":"[REDACTED]"}`,
    );
  });
});
