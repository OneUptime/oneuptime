import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import LogScrubRule from "../../../../../Models/DatabaseModels/LogScrubRule";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import { TelemetryServiceMetadata } from "../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityAddressVaultService from "../../../../../Server/Services/SecurityAddressVaultService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import OneUptimeAwsSessions from "../../../../../Server/Utils/CloudConnection/Aws/OneUptimeAwsSessions";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import CorrelationQueries from "../../../../../Server/Utils/SecurityEvent/Correlation/CorrelationQueries";
import OpenStackAuditJoin from "../../../../../Server/Utils/SecurityEvent/LogScan/OpenStackAuditJoin";
import SecurityLogScanner from "../../../../../Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";
import RealTimeDetections from "../../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import SecurityRequestTrace from "../../../../../Server/Utils/SecurityEvent/RequestTrace/SecurityRequestTrace";
import ScrubbedClientAddresses from "../../../../../Server/Utils/SecurityEvent/ScrubbedClientAddresses";
import SecurityEventDedupe from "../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import SecurityTrustedProxies from "../../../../../Server/Utils/SecurityEvent/SecurityTrustedProxies";
import {
  buildSigmaFieldExpression,
  resolveSigmaField,
} from "../../../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
  getDetectionRuleLibraryEntry,
} from "../../../../../Types/SecurityEvent/DetectionRuleLibrary";
import { doesDetectionRuleLeaveOutEventsWithNoValue } from "../../../../../Types/SecurityEvent/DetectionUncountedEvents";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { DetectionRuleDefinition } from "../../../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRule from "../../../../../Types/SecurityEvent/SigmaRule";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { NO_TRUSTED_PROXIES } from "../../../../../Utils/SecurityEvent/ClientAddressTrust";
import { OpenStackAuditAttribute } from "../../../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import SecurityLogParser from "../../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { SecurityLogLine } from "../../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import SigmaRuleSetParser from "../../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  ScrubbedAddressRole,
  readHiddenAddress,
} from "../../../../../Utils/SecurityEvent/ScrubbedAddress";
import { IPV4_ADDRESS_MASK } from "../../../../../Utils/Telemetry/ScrubIpAddress";
import { logLine } from "../../../../Utils/SecurityEvent/LogParsers/LogParserFixtures";
import {
  SCRUBBED_ADDRESS_PROJECT_ID,
  SOURCE_ADDRESS,
  tokenOf,
} from "../../../../Utils/SecurityEvent/LogParsers/ScrubbedAddressFormats";
import { sigmaRuleMatchesEvent } from "../../../../Utils/SecurityEvent/LogParsers/SigmaTestMatcher";

jest.mock("../../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * OPENSTACK SIGN-INS WHOSE ADDRESS A SCRUB RULE HID, AS THE RULE LIBRARY
 * COUNTS THEM (#10773).
 *
 * OpenStack failed logins burst grouped its sign-ins by the parser's own
 * openstack.audit.initiator_address, and admin credential used from a new
 * address read that attribute as its new value. The attribute holds real
 * addresses only, on purpose (#10415): what a scrub rule left is never one
 * address every hidden sign-in shares. But a Hash rule's token names a real
 * address, which the log scan writes in principalIp from the vault
 * (#10419) - and the attribute stayed empty, so those sign-ins were never
 * counted. The rules count per principalIp now.
 *
 * Here the scan stores ten failed sign-ins of each attacker as the project's
 * scrub rule left them - a Hash rule, a Redact rule, a Mask rule, no rule -
 * with the vault and the stores stood in for, and the stored rows are
 * counted as the burst counts them: by its group field, read as the
 * detection read reads it, the rows with no value left out. And the admin
 * rule's first-seen read is read for what it asks of each row.
 */

const PROJECT_ID: ObjectID = SCRUBBED_ADDRESS_PROJECT_ID;

const BURST: string = "6e7a4f92-2d3b-4b31-9a55-1f0c8e7d4a10";
const ADMIN_FROM_NEW_ADDRESS: string = "c94e1b77-8a26-4d57-b2f1-0ea3f6d81c22";

// A second attacker, whose sign-ins must never merge with the first's.
const OTHER_ADDRESS: string = "198.51.100.77";

const SERVICE: TelemetryServiceMetadata = {
  serviceName: "OneUptime Logs",
  primaryEntityId: new ObjectID("10773000-0000-4000-8000-0000000000c3"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: 15,
  projectRetentionConfig: null,
  projectRetentionInDays: 30,
} as unknown as TelemetryServiceMetadata;

// The parser's own address attributes: each holds a real address only (#10415).
const ADDRESS_ONLY_ATTRIBUTES: ReadonlyArray<string> = [
  OpenStackAuditAttribute.InitiatorAddress,
  "asa.src_ip",
  "asa.dst_ip",
];

let lineCount: number = 0;

// One Keystone sign-in, as the audit middleware writes it, from what a rule left of its address.
function signIn(data: {
  address: string;
  outcome: "failure" | "success";
  username?: string | undefined;
}): SecurityLogLine {
  lineCount++;

  const index: string = String(lineCount).padStart(12, "0");

  return logLine(
    JSON.stringify({
      message_id: `6d3e8f6b-9f4a-4d3d-9a6b-${index}`,
      event_type: "identity.authenticate",
      priority: "INFO",
      publisher_id: "identity.controller",
      timestamp: "2026-11-24 10:00:00.000000",
      payload: {
        typeURI: "http://schemas.dmtf.org/cloud/audit/1.0/event",
        eventType: "activity",
        id: `payload-${index}`,
        eventTime: "2026-11-24T10:00:01.000000+0000",
        action: "authenticate",
        outcome: data.outcome,
        ...(data.outcome === "failure"
          ? { reason: { reasonCode: "401", reasonType: "Unauthorized" } }
          : {}),
        initiator: {
          typeURI: "service/security/account/user",
          id: "hashed-initiator-id",
          user_id: "0123456789abcdef0123456789abcdef",
          username: data.username || "alice",
          host: { address: data.address, agent: "python-keystoneclient" },
        },
        target: { typeURI: "service/security/account/user", id: "target-id" },
        observer: { typeURI: "service/security", id: "observer-id" },
      },
    }),
    { "resource.openstack.cloud.name": "production" },
    `0192f1a0-0000-7000-8000-${index}`,
  );
}

function eventsOf(
  lines: Array<SecurityLogLine>,
): Array<NormalizedSecurityEvent> {
  return lines.flatMap(
    (line: SecurityLogLine): Array<NormalizedSecurityEvent> => {
      return SecurityLogParser.parse(line);
    },
  );
}

function failedSignIns(address: string, count: number): Array<SecurityLogLine> {
  return Array.from({ length: count }, (): SecurityLogLine => {
    return signIn({ address, outcome: "failure" });
  });
}

function scrubRule(action: LogScrubAction): LogScrubRule {
  const rule: LogScrubRule = new LogScrubRule();

  rule.id = ObjectID.generate();
  rule.name = `${action} IP addresses`;
  rule.patternType = LogScrubPatternType.IPAddress;
  rule.scrubAction = action;
  rule.fieldsToScrub = LogScrubField.Both;

  return rule;
}

function libraryEntry(id: string): DetectionRuleLibraryEntry {
  return getDetectionRuleLibraryEntry(id)!;
}

/*
 * A stored row's value of a field, as the detection read takes it: a typed
 * column by its name, anything else from the row's attributes
 * (buildSigmaFieldExpression).
 */
function valueOf(row: JSONObject, field: string): string {
  const resolved: ReturnType<typeof resolveSigmaField> =
    resolveSigmaField(field);

  if (resolved.kind === "attribute") {
    return String(
      ((row["attributes"] || {}) as JSONObject)[resolved.attributeKey] ?? "",
    );
  }

  return String(row[resolved.column] ?? "");
}

/*
 * The burst's groups over the stored rows, as its read makes them: one per
 * value of its group field, the rows with no value left out when the rule
 * counts per value (#10415).
 */
function burstGroups(
  rows: Array<JSONObject>,
  groupByField: string = libraryEntry(BURST).groupByField!,
): Dictionary<number> {
  const entry: DetectionRuleLibraryEntry = libraryEntry(BURST);
  const leavesOutEmpty: boolean = doesDetectionRuleLeaveOutEventsWithNoValue({
    ...entry,
    groupByField,
  });
  const groups: Dictionary<number> = {};

  for (const row of rows) {
    const value: string = valueOf(row, groupByField);

    if (!value && leavesOutEmpty) {
      continue;
    }

    groups[value] = (groups[value] || 0) + 1;
  }

  return groups;
}

// The groups that reach the burst's threshold: each would fire it.
function firing(groups: Dictionary<number>): Array<string> {
  return Object.keys(groups)
    .filter((value: string): boolean => {
      return (groups[value] || 0) >= libraryEntry(BURST).matchCountThreshold;
    })
    .sort();
}

let inserted: Array<JSONObject> = [];
let rules: Array<LogScrubRule> = [];
let vault: Record<string, string> = {};

beforeEach(() => {
  inserted = [];
  rules = [];
  vault = {
    [tokenOf(SOURCE_ADDRESS)]: SOURCE_ADDRESS,
    [tokenOf(OTHER_ADDRESS)]: OTHER_ADDRESS,
  };

  jest
    .spyOn(OpenStackAuditJoin, "enrichEvents")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OneUptimeAwsSessions, "markSecurityEvents")
    .mockResolvedValue(0 as never);
  jest.spyOn(SecurityRequestTrace, "followEvents").mockResolvedValue(0);
  jest
    .spyOn(SecurityTrustedProxies, "getForProject")
    .mockResolvedValue(NO_TRUSTED_PROXIES);
  jest
    .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
    .mockResolvedValue({ eventsMatched: 0, valuesLookedUp: 0 } as never);
  jest
    .spyOn(RealTimeDetections, "screen")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityEventService, "insertJsonRows")
    .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
      inserted.push(...rows);
    });
  jest.spyOn(LogScrubRuleService, "findBy").mockImplementation((async () => {
    return rules;
  }) as never);
  jest
    .spyOn(SecurityAddressVaultService, "findAddressesOfTokens")
    .mockImplementation(
      async (data: {
        tokens: ReadonlyArray<string>;
      }): Promise<Map<string, string>> => {
        const found: Map<string, string> = new Map<string, string>();

        for (const token of data.tokens) {
          if (vault[token]) {
            found.set(token, vault[token]!);
          }
        }

        return found;
      },
    );
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityEventDedupe, "findExistingEventUids")
    .mockResolvedValue(new Set<string>());
});

afterEach(() => {
  jest.restoreAllMocks();
  ScrubbedClientAddresses.clearCache();
});

async function store(lines: Array<SecurityLogLine>): Promise<void> {
  const events: Array<NormalizedSecurityEvent> = eventsOf(lines);

  expect(events).toHaveLength(lines.length);

  await SecurityLogScanner.storeEvents({
    projectId: PROJECT_ID,
    events,
    serviceMetadata: SERVICE,
  });

  expect(inserted).toHaveLength(lines.length);
}

describe("the library's OpenStack rules count per principalIp", () => {
  test("the burst groups by principalIp, a column, and leaves out sign-ins with no address", () => {
    const entry: DetectionRuleLibraryEntry = libraryEntry(BURST);

    expect(entry.groupByField).toBe("principalIp");
    expect(resolveSigmaField(entry.groupByField!)).toEqual({
      kind: "textColumn",
      column: "principalIp",
    });
    expect(buildSigmaFieldExpression(entry.groupByField!).query).toBe(
      "principalIp",
    );
    expect(doesDetectionRuleLeaveOutEventsWithNoValue(entry)).toBe(true);
  });

  test("the burst reads the same sign-ins it read: its selection is unchanged", () => {
    const rule: SigmaRule = (
      SigmaRuleSetParser.parse(libraryEntry(BURST).sigmaRuleYaml) as Extract<
        DetectionRuleDefinition,
        { kind: "single" }
      >
    ).rule;
    const events: Array<NormalizedSecurityEvent> = eventsOf([
      signIn({ address: SOURCE_ADDRESS, outcome: "failure" }),
      signIn({ address: SOURCE_ADDRESS, outcome: "success" }),
    ]);

    // The failed sign-in is the burst's; the one that worked is not.
    expect(sigmaRuleMatchesEvent(rule, events[0]!)).toBe(true);
    expect(sigmaRuleMatchesEvent(rule, events[1]!)).toBe(false);
  });

  test("the admin rule's first-seen read takes each sign-in's principalIp, and never an empty one", () => {
    const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      libraryEntry(ADMIN_FROM_NEW_ADDRESS).sigmaRuleYaml,
    );

    if (definition.kind !== "correlation") {
      throw new Error(
        "OpenStack admin credential used from a new address is a correlation",
      );
    }

    expect(definition.correlation.condition.fields).toEqual(["principalIp"]);

    const statement: Statement = CorrelationQueries.buildNewValueStatement({
      window: {
        projectId: PROJECT_ID,
        readFrom: new Date("2026-11-24T09:50:00.000Z"),
        startTime: new Date("2026-11-24T10:00:00.000Z"),
        endTime: new Date("2026-11-24T10:05:00.000Z"),
      },
      historyFrom: new Date("2026-10-25T10:00:00.000Z"),
      correlation: definition.correlation,
      steps: definition.steps,
      tableName: "oneuptime.SecurityEvent",
      limit: 50,
    });

    expect(statement.query).toContain(
      "toString(ifNull(principalUser, '')) AS __g0, toString(ifNull(principalIp, '')) AS __v0",
    );
    // A sign-in a Redact or Mask rule hid has no address: no new one.
    expect(statement.query).toContain("HAVING __g0 != '' AND __v0 != ''");
    expect(Object.values(statement.query_params)).not.toContain(
      OpenStackAuditAttribute.InitiatorAddress,
    );
  });
});

describe("failed sign-ins whose address a scrub rule hid, stored by the log scan", () => {
  test("a Hash rule on: each attacker's ten fire the burst, counted toward its real address", async () => {
    rules = [scrubRule(LogScrubAction.Hash)];

    await store([
      ...failedSignIns(tokenOf(SOURCE_ADDRESS), 10),
      ...failedSignIns(tokenOf(OTHER_ADDRESS), 10),
    ]);

    expect(burstGroups(inserted)).toEqual({
      [SOURCE_ADDRESS]: 10,
      [OTHER_ADDRESS]: 10,
    });
    expect(firing(burstGroups(inserted))).toEqual(
      [OTHER_ADDRESS, SOURCE_ADDRESS].sort(),
    );

    for (const row of inserted) {
      // The parser's own attribute still holds real addresses only: a token is none.
      expect(valueOf(row, OpenStackAuditAttribute.InitiatorAddress)).toBe("");
      expect(
        readHiddenAddress(
          {
            principalIp: row["principalIp"] as string,
            targetIp: row["targetIp"] as string,
            attributes: row["attributes"] as JSONObject,
          },
          ScrubbedAddressRole.Principal,
        ),
      ).toBeNull();
    }
  });

  test("a Hash rule on, grouped as the rule was before: nothing counted - the issue", async () => {
    rules = [scrubRule(LogScrubAction.Hash)];

    await store(failedSignIns(tokenOf(SOURCE_ADDRESS), 10));

    expect(
      burstGroups(inserted, OpenStackAuditAttribute.InitiatorAddress),
    ).toEqual({});
  });

  test("a Hash rule's token the vault does not know: no address, never one shared group", async () => {
    rules = [scrubRule(LogScrubAction.Hash)];
    vault = {};

    await store([
      ...failedSignIns(tokenOf(SOURCE_ADDRESS), 10),
      ...failedSignIns(tokenOf(OTHER_ADDRESS), 10),
    ]);

    expect(burstGroups(inserted)).toEqual({});

    for (const row of inserted) {
      expect(row["principalIp"]).toBe("");
    }
  });

  test("a Redact rule on: twenty hidden sign-ins of two attackers are no one address", async () => {
    rules = [scrubRule(LogScrubAction.Redact)];

    await store(failedSignIns("[REDACTED]", 20));

    expect(burstGroups(inserted)).toEqual({});
    expect(firing(burstGroups(inserted))).toEqual([]);

    for (const row of inserted) {
      expect(row["principalIp"]).toBe("");
      expect(valueOf(row, OpenStackAuditAttribute.InitiatorAddress)).toBe("");
      // The row says a rule hid it, instead.
      expect(
        readHiddenAddress(
          {
            principalIp: row["principalIp"] as string,
            targetIp: row["targetIp"] as string,
            attributes: row["attributes"] as JSONObject,
          },
          ScrubbedAddressRole.Principal,
        ),
      ).not.toBeNull();
    }
  });

  test("a Mask rule on: the same, whatever its mask", async () => {
    rules = [scrubRule(LogScrubAction.Mask)];

    await store(failedSignIns(IPV4_ADDRESS_MASK, 12));

    expect(burstGroups(inserted)).toEqual({});
  });

  test("no rule: counted toward the address as before, by either field", async () => {
    await store([
      ...failedSignIns(SOURCE_ADDRESS, 10),
      ...failedSignIns(OTHER_ADDRESS, 9),
    ]);

    expect(burstGroups(inserted)).toEqual({
      [SOURCE_ADDRESS]: 10,
      [OTHER_ADDRESS]: 9,
    });
    // Nine is under the threshold: only the first fires.
    expect(firing(burstGroups(inserted))).toEqual([SOURCE_ADDRESS]);
    expect(
      burstGroups(inserted, OpenStackAuditAttribute.InitiatorAddress),
    ).toEqual(burstGroups(inserted));
  });

  test("an admin's sign-in a Hash rule hid names its real address for the first-seen rule; a Redact rule's names none", async () => {
    rules = [scrubRule(LogScrubAction.Hash)];

    await store([
      signIn({
        address: tokenOf(SOURCE_ADDRESS),
        outcome: "success",
        username: "admin",
      }),
    ]);

    expect(valueOf(inserted[0]!, "principalIp")).toBe(SOURCE_ADDRESS);

    inserted = [];
    rules = [scrubRule(LogScrubAction.Redact)];

    await store([
      signIn({ address: "[REDACTED]", outcome: "success", username: "admin" }),
    ]);

    // Left out of the first-seen read, which keeps only values (HAVING __v0 != '').
    expect(valueOf(inserted[0]!, "principalIp")).toBe("");
  });
});

/*
 * No library rule counts per a parser's own address attribute, or any
 * attribute that names an address: such an attribute holds what the log
 * wrote, so a Hash rule's token leaves it empty, and the rule would miss
 * every sign-in the token hid. A rule counts per principalIp or targetIp,
 * which the scan fills from the vault - in its group field, its distinct
 * count, and a correlation's group-by, aliases and first-seen field.
 */
describe("no library rule counts per an address the log wrote (#10773)", () => {
  const ADDRESS_WORD: RegExp =
    /(address|(^|[._])(ip|src_?ip|dst_?ip|srcip|dstip|client_?ip|source_?ip|remote_?ip|ip_?addr))$/i;

  // Each field a rule counts by: what it groups by, counts distinct, or reads as new.
  function countedFieldsOf(entry: DetectionRuleLibraryEntry): Array<string> {
    const fields: Array<string> = [
      entry.groupByField || "",
      entry.distinctCountField || "",
    ];
    const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      entry.sigmaRuleYaml,
    );

    if (definition.kind === "correlation") {
      fields.push(
        ...definition.correlation.groupBy,
        ...definition.correlation.condition.fields,
      );

      for (const byRule of Object.values(definition.correlation.aliases)) {
        fields.push(...Object.values(byRule || {}));
      }
    }

    return fields.filter((field: string): boolean => {
      return field.trim().length > 0;
    });
  }

  test("each field a library rule counts by is never a parser's own address attribute", () => {
    for (const entry of DETECTION_RULE_LIBRARY) {
      for (const field of countedFieldsOf(entry)) {
        expect({
          rule: entry.title,
          field,
          addressOnly: ADDRESS_ONLY_ATTRIBUTES.includes(field),
        }).toEqual({ rule: entry.title, field, addressOnly: false });
      }
    }
  });

  test("an address a library rule counts by is a column the scan names from the vault, never an attribute", () => {
    let addresses: number = 0;

    for (const entry of DETECTION_RULE_LIBRARY) {
      for (const field of countedFieldsOf(entry)) {
        const resolved: ReturnType<typeof resolveSigmaField> =
          resolveSigmaField(field);

        if (resolved.kind !== "attribute") {
          if (["principalIp", "targetIp"].includes(resolved.column)) {
            addresses++;
          }

          continue;
        }

        expect({
          rule: entry.title,
          field,
          namesAnAddress: ADDRESS_WORD.test(resolved.attributeKey),
        }).toEqual({ rule: entry.title, field, namesAnAddress: false });
      }
    }

    // Brute force, password spraying, OpenStack's two and the rest count per an address.
    expect(addresses).toBeGreaterThan(10);
  });

  test("the guard's word for an address knows the attributes it must catch", () => {
    for (const field of [
      ...ADDRESS_ONLY_ATTRIBUTES,
      "client_ip",
      "source.ip",
      "remote_ip_addr",
    ]) {
      expect({ field, caught: ADDRESS_WORD.test(field) }).toEqual({
        field,
        caught: true,
      });
    }

    for (const field of [
      "web.sensitive_file.path",
      "user.username",
      "openstack.audit.target_id",
      "recipientAccountId",
    ]) {
      expect({ field, caught: ADDRESS_WORD.test(field) }).toEqual({
        field,
        caught: false,
      });
    }
  });
});
