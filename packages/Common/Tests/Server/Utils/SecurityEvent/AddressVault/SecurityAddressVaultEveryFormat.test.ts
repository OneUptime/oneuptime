import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import LogScrubRule from "../../../../../Models/DatabaseModels/LogScrubRule";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import { Results } from "../../../../../Server/Services/AnalyticsDatabaseService";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import OpenStackCloudService from "../../../../../Server/Services/OpenStackCloudService";
import { TelemetryServiceMetadata } from "../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityAddressVaultService, {
  MAX_TOKENS_PER_VAULT_LOOKUP,
} from "../../../../../Server/Services/SecurityAddressVaultService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import OneUptimeAwsSessions from "../../../../../Server/Utils/CloudConnection/Aws/OneUptimeAwsSessions";
import SecurityAddressVaultLookup, {
  nameVaultTargetAddress,
  readVaultTokenOf,
} from "../../../../../Server/Utils/SecurityEvent/AddressVault/SecurityAddressVaultLookup";
import OpenStackAuditJoin from "../../../../../Server/Utils/SecurityEvent/LogScan/OpenStackAuditJoin";
import SecurityLogScanner, {
  LOG_SCAN_PAGE_SIZE,
} from "../../../../../Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";
import RealTimeDetections from "../../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import SecurityRequestTrace from "../../../../../Server/Utils/SecurityEvent/RequestTrace/SecurityRequestTrace";
import ScrubbedClientAddresses from "../../../../../Server/Utils/SecurityEvent/ScrubbedClientAddresses";
import SecurityEventDedupe from "../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import SecurityTrustedProxies from "../../../../../Server/Utils/SecurityEvent/SecurityTrustedProxies";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import {
  NO_TRUSTED_PROXIES,
  toTrustedProxies,
} from "../../../../../Utils/SecurityEvent/ClientAddressTrust";
import SecurityLogParser from "../../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { SecurityLogLine } from "../../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import {
  CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES,
  HiddenAddress,
  SCRUBBED_ADDRESS_ROLES,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  ScrubbedAddressRole,
  TARGET_ADDRESS_SCRUB_MARKER_ATTRIBUTES,
  getScrubbedAddressMarkerAttributes,
  markAddressScrubbed,
  readHiddenAddress,
} from "../../../../../Utils/SecurityEvent/ScrubbedAddress";
import { logLine } from "../../../../Utils/SecurityEvent/LogParsers/LogParserFixtures";
import {
  DESTINATION_ADDRESS,
  SCRUBBED_ADDRESS_FORMATS,
  SCRUBBED_ADDRESS_PAIRS,
  SCRUBBED_ADDRESS_PROJECT_ID,
  SOURCE_ADDRESS,
  ScrubbedAddressFormat,
  ScrubbedAddressPair,
  lineWithScrubbed,
  tokenOf,
} from "../../../../Utils/SecurityEvent/LogParsers/ScrubbedAddressFormats";

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
 * THE LOG SCAN NAMES THE ADDRESS BEHIND A HASHED ONE IN EVERY LOG FORMAT,
 * SOURCE AND DESTINATION (#10419).
 *
 * #10395 named the address behind a Hash rule's token for web attacks: in
 * traces, and in web access logs. Every other format the log scan reads -
 * SSH, Windows, firewalls, CEF and LEEF, cloud and Kubernetes audit logs -
 * dropped the token, so the event named no address. Now each format keeps
 * the token where it reads its source and its destination
 * (ScrubbedAddressEveryFormat.test.ts), and here, with the vault's one read
 * and the stores replaced, the scan stores each event naming the address
 * behind each token:
 *
 *   - the issue's four - an SSH failed password, a Palo Alto traffic log's
 *     source and destination, a Windows 4625 failed logon, a CloudTrail
 *     record sent as a log - and one line of every other format;
 *   - a token the vault does not know: no address, the marker, and the
 *     rule that hid it named, for either address; Redact and Mask the same,
 *     without asking the vault;
 *   - one lookup a page, of every token of every format, and one query;
 *   - the message and the record's fields keep the token;
 *   - only an address its sender could not have written is named (#10416).
 */

const PROJECT_ID: ObjectID = SCRUBBED_ADDRESS_PROJECT_ID;

const SERVICE: TelemetryServiceMetadata = {
  serviceName: "OneUptime Logs",
  primaryEntityId: new ObjectID("10419000-0000-4000-8000-0000000000c3"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: 15,
  projectRetentionConfig: null,
  projectRetentionInDays: 30,
} as unknown as TelemetryServiceMetadata;

const HASHED: ScrubbedAddressPair = SCRUBBED_ADDRESS_PAIRS[0]!;

const BOTH_KNOWN: Record<string, string> = {
  [tokenOf(SOURCE_ADDRESS)]: SOURCE_ADDRESS,
  [tokenOf(DESTINATION_ADDRESS)]: DESTINATION_ADDRESS,
};

function formatNamed(name: string): ScrubbedAddressFormat {
  const format: ScrubbedAddressFormat | undefined =
    SCRUBBED_ADDRESS_FORMATS.find(
      (candidate: ScrubbedAddressFormat): boolean => {
        return candidate.name === name;
      },
    );

  if (!format) {
    throw new Error(`No format ${name}`);
  }

  return format;
}

function eventsOf(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
  const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(line);

  expect(events).toHaveLength(1);

  return events;
}

function vaultHolds(
  entries: Record<string, string>,
): ReturnType<typeof jest.spyOn> {
  return jest
    .spyOn(SecurityAddressVaultService, "findAddressesOfTokens")
    .mockImplementation(
      async (data: {
        tokens: ReadonlyArray<string>;
      }): Promise<Map<string, string>> => {
        const found: Map<string, string> = new Map<string, string>();

        for (const token of data.tokens) {
          if (entries[token]) {
            found.set(token, entries[token]!);
          }
        }

        return found;
      },
    );
}

function answer(rows: Array<JSONObject>): Results {
  return {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;
}

function logRule(action: LogScrubAction, name: string): LogScrubRule {
  const rule: LogScrubRule = new LogScrubRule();

  rule.id = ObjectID.generate();
  rule.name = name;
  rule.patternType = LogScrubPatternType.IPAddress;
  rule.scrubAction = action;
  rule.fieldsToScrub = LogScrubField.Both;

  return rule;
}

function columnOf(role: ScrubbedAddressRole): "principalIp" | "targetIp" {
  return role === ScrubbedAddressRole.Principal ? "principalIp" : "targetIp";
}

function addressOf(role: ScrubbedAddressRole): string {
  return role === ScrubbedAddressRole.Principal
    ? SOURCE_ADDRESS
    : DESTINATION_ADDRESS;
}

let inserted: Array<JSONObject> = [];
let enriched: Array<NormalizedSecurityEvent> = [];
let rules: Array<LogScrubRule> = [];

beforeEach(() => {
  inserted = [];
  enriched = [];
  rules = [logRule(LogScrubAction.Hash, "Hash IP addresses")];

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
    .mockImplementation(
      async (data: {
        events: Array<NormalizedSecurityEvent>;
      }): Promise<never> => {
        enriched.push(...data.events);
        return { eventsMatched: 0, valuesLookedUp: 0 } as never;
      },
    );
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
  /*
   * A cloud audit record another way may bring in too is stored once, under
   * its product's lock (SecurityEventStoreOnce): none was stored before.
   */
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

async function store(events: Array<NormalizedSecurityEvent>): Promise<void> {
  await SecurityLogScanner.storeEvents({
    projectId: PROJECT_ID,
    events,
    serviceMetadata: SERVICE,
  });
}

function attributesOf(row: JSONObject): JSONObject {
  return (row["attributes"] || {}) as JSONObject;
}

// The row's marker of a role, read back as a page reads it.
function hiddenOf(
  row: JSONObject,
  role: ScrubbedAddressRole,
): HiddenAddress | null {
  return readHiddenAddress(
    {
      principalIp: row["principalIp"] as string,
      targetIp: row["targetIp"] as string,
      attributes: attributesOf(row),
    },
    role,
  );
}

describe("the issue's four: each hashed address names the real one", () => {
  test("an SSH failed password", async () => {
    vaultHolds(BOTH_KNOWN);

    await store(
      eventsOf(lineWithScrubbed(formatNamed("an SSH failed password"), HASHED)),
    );

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!["principalIp"]).toBe(SOURCE_ADDRESS);
    expect(inserted[0]!["principalUser"]).toBe("root");
    expect(inserted[0]!["observables"]).toContain(SOURCE_ADDRESS);
    expect(hiddenOf(inserted[0]!, ScrubbedAddressRole.Principal)).toBeNull();
    // Its message says what the line says: the token, never the address.
    expect(inserted[0]!["message"]).toBe(
      `Failed SSH sign-in for root from ${tokenOf(SOURCE_ADDRESS)}`,
    );
  });

  test("a Palo Alto traffic log, for both its source and its destination", async () => {
    vaultHolds(BOTH_KNOWN);

    await store(
      eventsOf(
        lineWithScrubbed(formatNamed("a Palo Alto traffic log"), HASHED),
      ),
    );

    const row: JSONObject = inserted[0]!;

    expect([row["principalIp"], row["targetIp"], row["targetPort"]]).toEqual([
      SOURCE_ADDRESS,
      DESTINATION_ADDRESS,
      3389,
    ]);
    expect(row["observables"]).toEqual(
      expect.arrayContaining([SOURCE_ADDRESS, DESTINATION_ADDRESS]),
    );

    for (const key of [
      ...CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES,
      ...TARGET_ADDRESS_SCRUB_MARKER_ATTRIBUTES,
    ]) {
      expect(attributesOf(row)[key]).toBeUndefined();
    }

    // The record's own fields keep the tokens, as the log holds them.
    expect(attributesOf(row)["panos.src"]).toBe(tokenOf(SOURCE_ADDRESS));
    expect(attributesOf(row)["panos.dst"]).toBe(tokenOf(DESTINATION_ADDRESS));
    expect(row["message"]).toContain(tokenOf(DESTINATION_ADDRESS));
    // Threat intel is asked about both addresses, as about any other.
    expect(enriched[0]!.observables).toEqual(
      expect.arrayContaining([SOURCE_ADDRESS, DESTINATION_ADDRESS]),
    );
  });

  test("a Windows 4625 failed logon", async () => {
    vaultHolds(BOTH_KNOWN);

    await store(
      eventsOf(
        lineWithScrubbed(formatNamed("a Windows 4625 failed logon"), HASHED),
      ),
    );

    expect(inserted[0]!["principalIp"]).toBe(SOURCE_ADDRESS);
    expect(inserted[0]!["principalUser"]).toBe("alice");
    expect(inserted[0]!["statusName"]).toBe("Failure");
    expect(hiddenOf(inserted[0]!, ScrubbedAddressRole.Principal)).toBeNull();
  });

  test("a CloudTrail record sent as a log", async () => {
    vaultHolds(BOTH_KNOWN);

    await store(
      eventsOf(
        lineWithScrubbed(
          formatNamed("a CloudTrail record sent as a log"),
          HASHED,
        ),
      ),
    );

    expect(inserted[0]!["principalIp"]).toBe(SOURCE_ADDRESS);
    // A call from outside AWS, its address hidden, is no host.
    expect(inserted[0]!["principalHost"]).toBe("");
    expect(inserted[0]!["observables"]).toContain(SOURCE_ADDRESS);
    expect(inserted[0]!["observables"]).not.toContain(tokenOf(SOURCE_ADDRESS));
    expect(attributesOf(inserted[0]!)["sourceIPAddress"]).toBe(
      tokenOf(SOURCE_ADDRESS),
    );
  });
});

describe("every format", () => {
  const CASES: Array<[string, ScrubbedAddressFormat]> =
    SCRUBBED_ADDRESS_FORMATS.map(
      (format: ScrubbedAddressFormat): [string, ScrubbedAddressFormat] => {
        return [format.name, format];
      },
    );

  test.each(CASES)(
    "%s, hashed: the stored event names each address behind its token",
    async (_name: string, format: ScrubbedAddressFormat) => {
      vaultHolds(BOTH_KNOWN);

      await store(eventsOf(lineWithScrubbed(format, HASHED)));

      const row: JSONObject = inserted[0]!;

      for (const role of format.roles) {
        expect({ role, address: row[columnOf(role)] }).toEqual({
          role,
          address: addressOf(role),
        });
        expect(row["observables"]).toContain(addressOf(role));
      }

      for (const role of SCRUBBED_ADDRESS_ROLES) {
        expect({ role, hidden: hiddenOf(row, role) }).toEqual({
          role,
          hidden: null,
        });

        for (const key of getScrubbedAddressMarkerAttributes(role)) {
          expect(attributesOf(row)[key]).toBeUndefined();
        }
      }
    },
  );

  test.each(CASES)(
    "%s, hashed, a token the vault does not know: no address, and the rule that hid it named",
    async (_name: string, format: ScrubbedAddressFormat) => {
      vaultHolds({});

      await store(eventsOf(lineWithScrubbed(format, HASHED)));

      const row: JSONObject = inserted[0]!;

      for (const role of format.roles) {
        expect({
          role,
          address: row[columnOf(role)],
          hidden: hiddenOf(row, role),
        }).toEqual({
          role,
          address: "",
          hidden: {
            kind: ScrubbedAddressKind.Hashed,
            value:
              role === ScrubbedAddressRole.Principal
                ? HASHED.source
                : HASHED.destination,
            place: ScrubbedAddressPlace.LogBody,
            signal: "log",
            ruleId: rules[0]!.id!.toString(),
            ruleName: "Hash IP addresses",
          },
        });
      }

      expect(row["observables"]).not.toContain(HASHED.source);
      expect(row["observables"]).not.toContain(HASHED.destination);
    },
  );

  test.each(
    SCRUBBED_ADDRESS_FORMATS.flatMap(
      (
        format: ScrubbedAddressFormat,
      ): Array<
        [string, string, ScrubbedAddressFormat, ScrubbedAddressPair]
      > => {
        return SCRUBBED_ADDRESS_PAIRS.filter(
          (pair: ScrubbedAddressPair): boolean => {
            return pair.kind !== ScrubbedAddressKind.Hashed;
          },
        ).map(
          (
            pair: ScrubbedAddressPair,
          ): [string, string, ScrubbedAddressFormat, ScrubbedAddressPair] => {
            return [format.name, pair.label, format, pair];
          },
        );
      },
    ),
  )(
    "%s, with %s: the event says the rule that hid each address, and the vault is never asked",
    async (
      _name: string,
      _label: string,
      format: ScrubbedAddressFormat,
      pair: ScrubbedAddressPair,
    ) => {
      const vault: ReturnType<typeof jest.spyOn> = vaultHolds(BOTH_KNOWN);
      const action: LogScrubAction =
        pair.kind === ScrubbedAddressKind.Redacted
          ? LogScrubAction.Redact
          : LogScrubAction.Mask;
      const name: string =
        pair.kind === ScrubbedAddressKind.Redacted
          ? "Redact IP addresses"
          : "Mask IP addresses";

      rules = [
        logRule(LogScrubAction.Hash, "Hash IP addresses"),
        logRule(action, name),
      ];

      await store(eventsOf(lineWithScrubbed(format, pair)));

      const row: JSONObject = inserted[0]!;

      expect(vault).not.toHaveBeenCalled();

      for (const role of format.roles) {
        expect({
          role,
          address: row[columnOf(role)],
          hidden: hiddenOf(row, role),
        }).toEqual({
          role,
          address: "",
          hidden: expect.objectContaining({
            kind: pair.kind,
            place: ScrubbedAddressPlace.LogBody,
            ruleId: rules[1]!.id!.toString(),
            ruleName: name,
          }),
        });
      }
    },
  );
});

describe("one vault lookup a page, however many formats it holds", () => {
  function pageOfEveryFormat(): Array<NormalizedSecurityEvent> {
    return SCRUBBED_ADDRESS_FORMATS.flatMap(
      (format: ScrubbedAddressFormat): Array<NormalizedSecurityEvent> => {
        return eventsOf(lineWithScrubbed(format, HASHED));
      },
    );
  }

  test("every token of every format is one lookup, each address named", async () => {
    const vault: ReturnType<typeof jest.spyOn> = vaultHolds(BOTH_KNOWN);
    const events: Array<NormalizedSecurityEvent> = pageOfEveryFormat();

    await store(events);

    expect(vault).toHaveBeenCalledTimes(1);

    const asked: Array<string> = (
      vault.mock.calls[0]![0] as { tokens: Array<string> }
    ).tokens;
    const targets: number = SCRUBBED_ADDRESS_FORMATS.filter(
      (format: ScrubbedAddressFormat): boolean => {
        return format.roles.includes(ScrubbedAddressRole.Target);
      },
    ).length;

    // Each event's source, and each destination a format names.
    expect(asked).toHaveLength(SCRUBBED_ADDRESS_FORMATS.length + targets);
    expect(new Set(asked)).toEqual(
      new Set([tokenOf(SOURCE_ADDRESS), tokenOf(DESTINATION_ADDRESS)]),
    );
    expect(inserted).toHaveLength(SCRUBBED_ADDRESS_FORMATS.length);
    expect(
      inserted.map((row: JSONObject): unknown => {
        return row["principalIp"];
      }),
    ).toEqual(
      SCRUBBED_ADDRESS_FORMATS.map((): string => {
        return SOURCE_ADDRESS;
      }),
    );
  });

  test("and one ClickHouse query, through the vault's one read", async () => {
    jest
      .spyOn(SecurityAddressVaultService.database, "getDatasourceOptions")
      .mockReturnValue({ database: "oneuptime" } as never);
    const query: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityAddressVaultService, "executeQuery")
      .mockResolvedValue(
        answer([
          {
            token: tokenOf(SOURCE_ADDRESS),
            vaultAddresses: [SOURCE_ADDRESS],
          },
          {
            token: tokenOf(DESTINATION_ADDRESS),
            vaultAddresses: [DESTINATION_ADDRESS],
          },
        ]) as never,
      );

    await store(pageOfEveryFormat());

    expect(query).toHaveBeenCalledTimes(1);
    expect(
      inserted.every((row: JSONObject): boolean => {
        return row["principalIp"] === SOURCE_ADDRESS;
      }),
    ).toBe(true);
  });

  test("a full page of lines naming two hashed addresses each is still one query", async () => {
    expect(MAX_TOKENS_PER_VAULT_LOOKUP).toBeGreaterThanOrEqual(
      2 * LOG_SCAN_PAGE_SIZE,
    );

    jest
      .spyOn(SecurityAddressVaultService.database, "getDatasourceOptions")
      .mockReturnValue({ database: "oneuptime" } as never);
    const query: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityAddressVaultService, "executeQuery")
      .mockResolvedValue(answer([]) as never);
    const format: ScrubbedAddressFormat = formatNamed(
      "a FortiGate traffic log",
    );
    const events: Array<NormalizedSecurityEvent> = [];

    for (let index: number = 0; index < LOG_SCAN_PAGE_SIZE; index++) {
      // Two addresses no other line names: two tokens a line.
      events.push(
        ...eventsOf(
          lineWithScrubbed(format, {
            source: tokenOf(`203.0.${Math.floor(index / 250)}.${index % 250}`),
            destination: tokenOf(
              `198.51.${Math.floor(index / 250)}.${index % 250}`,
            ),
          }),
        ),
      );
    }

    await SecurityAddressVaultLookup.nameHashedAddresses({
      projectId: PROJECT_ID,
      events,
    });

    expect(query).toHaveBeenCalledTimes(1);
  });

  test("a page of tokens the vault partly knows: each it knows named, the rest still hidden", async () => {
    vaultHolds({ [tokenOf(SOURCE_ADDRESS)]: SOURCE_ADDRESS });

    await store(
      eventsOf(
        lineWithScrubbed(formatNamed("a Palo Alto traffic log"), HASHED),
      ),
    );

    const row: JSONObject = inserted[0]!;

    expect(row["principalIp"]).toBe(SOURCE_ADDRESS);
    expect(row["targetIp"]).toBe("");
    expect(hiddenOf(row, ScrubbedAddressRole.Target)).toEqual(
      expect.objectContaining({
        value: tokenOf(DESTINATION_ADDRESS),
        ruleName: "Hash IP addresses",
      }),
    );
  });

  test("a lookup that fails stores every event as marked", async () => {
    jest
      .spyOn(SecurityAddressVaultService, "findAddressesOfTokens")
      .mockRejectedValue(new Error("ClickHouse is down") as never);

    await store(
      eventsOf(
        lineWithScrubbed(formatNamed("a Palo Alto traffic log"), HASHED),
      ),
    );

    expect(inserted).toHaveLength(1);
    expect(hiddenOf(inserted[0]!, ScrubbedAddressRole.Principal)?.value).toBe(
      tokenOf(SOURCE_ADDRESS),
    );
    expect(hiddenOf(inserted[0]!, ScrubbedAddressRole.Target)?.value).toBe(
      tokenOf(DESTINATION_ADDRESS),
    );
  });
});

describe("the vault names only what the line would have named unscrubbed", () => {
  test("a token in a sign-in's message, not its address field, is never looked up", async () => {
    const vault: ReturnType<typeof jest.spyOn> = vaultHolds(BOTH_KNOWN);

    await store(
      eventsOf(
        logLine(
          `CEF:0|Fortinet|Fortigate|v7.0.12|32002|event:system login failed|7|duser=admin src=192.0.2.44 act=login outcome=failed msg=Administrator admin login failed from https(${tokenOf(DESTINATION_ADDRESS)})`,
        ),
      ),
    );

    expect(vault).not.toHaveBeenCalled();
    expect(inserted[0]!["principalIp"]).toBe("192.0.2.44");
    expect(JSON.stringify(inserted[0])).not.toContain(
      `"${DESTINATION_ADDRESS}"`,
    );
  });

  test("a Kubernetes request's hashed X-Forwarded-For is its claim: never looked up, never named", async () => {
    const vault: ReturnType<typeof jest.spyOn> = vaultHolds(BOTH_KNOWN);

    await store(
      eventsOf(
        logLine(
          JSON.stringify({
            kind: "Event",
            apiVersion: "audit.k8s.io/v1",
            level: "Metadata",
            auditID: "1d2c7f0e-6c3a-4c1e-9a55-000000000099",
            stage: "ResponseComplete",
            requestURI: "/api/v1/namespaces/default/secrets/db-password",
            verb: "get",
            user: { username: "mallory@example.com" },
            sourceIPs: [tokenOf(DESTINATION_ADDRESS), "192.0.2.44"],
            objectRef: {
              resource: "secrets",
              namespace: "default",
              name: "db-password",
            },
            responseStatus: { code: 403 },
          }),
        ),
      ),
    );

    expect(vault).not.toHaveBeenCalled();
    expect(inserted[0]!["principalIp"]).toBe("192.0.2.44");
    expect(inserted[0]!["observables"]).not.toContain(DESTINATION_ADDRESS);
  });

  test("a Kubernetes client a private load balancer forwarded, hashed, is named", async () => {
    vaultHolds(BOTH_KNOWN);

    await store(
      eventsOf(
        logLine(
          JSON.stringify({
            kind: "Event",
            apiVersion: "audit.k8s.io/v1",
            level: "Metadata",
            auditID: "1d2c7f0e-6c3a-4c1e-9a55-000000000098",
            stage: "ResponseComplete",
            verb: "get",
            user: { username: "mallory@example.com" },
            sourceIPs: [tokenOf(SOURCE_ADDRESS), "10.0.0.5"],
            objectRef: { resource: "secrets", namespace: "default" },
            responseStatus: { code: 403 },
          }),
        ),
      ),
    );

    expect(inserted[0]!["principalIp"]).toBe(SOURCE_ADDRESS);
  });

  test("a client address that is a proxy the project trusts is not named; a destination always is", async () => {
    const edge: string = "172.70.38.12";

    jest
      .spyOn(SecurityTrustedProxies, "getForProject")
      .mockResolvedValue(toTrustedProxies("172.64.0.0/13"));
    vaultHolds({ [tokenOf(edge)]: edge });

    const viaEdge: Array<NormalizedSecurityEvent> = eventsOf(
      logLine(
        JSON.stringify({
          kind: "Event",
          apiVersion: "audit.k8s.io/v1",
          level: "Metadata",
          auditID: "1d2c7f0e-6c3a-4c1e-9a55-000000000097",
          stage: "ResponseComplete",
          verb: "get",
          user: { username: "mallory@example.com" },
          sourceIPs: [tokenOf(edge), "10.0.0.5"],
          objectRef: { resource: "secrets", namespace: "default" },
          responseStatus: { code: 403 },
        }),
      ),
    );
    const toEdge: Array<NormalizedSecurityEvent> = eventsOf(
      lineWithScrubbed(formatNamed("a Palo Alto traffic log"), {
        source: "192.0.2.44",
        destination: tokenOf(edge),
      }),
    );

    await store([...viaEdge, ...toEdge]);

    // Behind a load balancer, the hashed hop is the CDN's edge: no client.
    expect(inserted[0]!["principalIp"]).toBe("");
    expect(hiddenOf(inserted[0]!, ScrubbedAddressRole.Principal)?.value).toBe(
      tokenOf(edge),
    );
    // A connection to it is a connection to it.
    expect(inserted[1]!["targetIp"]).toBe(edge);
  });
});

describe("naming a destination", () => {
  test("writes targetIp and an observable, once, and clears only its own marker", () => {
    const event: NormalizedSecurityEvent = eventsOf(
      lineWithScrubbed(formatNamed("a Palo Alto traffic log"), HASHED),
    )[0]!;

    expect(readVaultTokenOf(event, ScrubbedAddressRole.Target)).toBe(
      tokenOf(DESTINATION_ADDRESS),
    );

    event.observables = ["198.51.100.9"];
    nameVaultTargetAddress(event, DESTINATION_ADDRESS);

    expect(event.targetIp).toBe(DESTINATION_ADDRESS);
    expect(event.observables).toEqual(["198.51.100.9"]);
    expect(readHiddenAddress(event, ScrubbedAddressRole.Target)).toBeNull();
    expect(readVaultTokenOf(event, ScrubbedAddressRole.Target)).toBeNull();
    // The source is still hidden, for its own lookup.
    expect(readVaultTokenOf(event, ScrubbedAddressRole.Principal)).toBe(
      tokenOf(SOURCE_ADDRESS),
    );
  });

  test("an older token, Redact's and Mask's are never looked up as a destination", () => {
    for (const [kind, value] of [
      [ScrubbedAddressKind.Hashed, "[HASHED:8c87b489]"],
      [ScrubbedAddressKind.Redacted, "[REDACTED]"],
      [ScrubbedAddressKind.Masked, "***.***.***.***"],
    ] as Array<[ScrubbedAddressKind, string]>) {
      const event: NormalizedSecurityEvent = eventsOf(
        lineWithScrubbed(formatNamed("a Palo Alto traffic log"), {
          source: "192.0.2.44",
          destination: "198.51.100.10",
        }),
      )[0]!;

      event.targetIp = "";
      markAddressScrubbed(event.attributes, {
        role: ScrubbedAddressRole.Target,
        scrubbed: { kind, value },
        place: ScrubbedAddressPlace.LogBody,
      });

      expect({
        value,
        token: readVaultTokenOf(event, ScrubbedAddressRole.Target),
      }).toEqual({ value, token: null });
    }
  });
});

describe("an OpenStack request's events, its address hashed", () => {
  test("the notification its audit filter's event explains names the address too", async () => {
    jest.restoreAllMocks();
    inserted = [];
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
    jest
      .spyOn(LogScrubRuleService, "findBy")
      .mockResolvedValue([
        logRule(LogScrubAction.Hash, "Hash IP addresses"),
      ] as never);
    jest.spyOn(OpenStackCloudService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(GlobalCache, "getStrings").mockImplementation((async (
      _namespace: string,
      keys: Array<string>,
    ) => {
      return keys.map((): null => {
        return null;
      });
    }) as never);
    jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined as never);
    vaultHolds(BOTH_KNOWN);

    const attributes: JSONObject = {
      "resource.openstack.cloud.name": "production",
      "openstack.request_id": "req-1",
      "openstack.user_name": "alice",
    };
    const auditFilter: Array<NormalizedSecurityEvent> = eventsOf(
      logLine(
        JSON.stringify({
          event_type: "audit.http.response",
          payload: {
            typeURI: "http://schemas.dmtf.org/cloud/audit/1.0/event",
            action: "update/os-stop",
            outcome: "success",
            requestPath:
              "/compute/v2.1/servers/bcee0abb-08c3-430a-9a53-cce3284714eb/action",
            initiator: {
              id: "e988af08b4024d1f9af182fda1f9b42a",
              name: "alice",
              project_id: "fedcba9876543210fedcba9876543210",
              host: { address: tokenOf(SOURCE_ADDRESS) },
            },
            target: { id: "unknown", name: "unknown", typeURI: "unknown" },
          },
        }),
        attributes,
      ),
    );
    const notification: Array<NormalizedSecurityEvent> = eventsOf(
      logLine(
        JSON.stringify({
          event_type: "security_group_rule.create.end",
          payload: {
            security_group_rule: {
              direction: "ingress",
              protocol: "tcp",
              remote_ip_prefix: "0.0.0.0/0",
              security_group_id: "group-id",
              port_range_min: 22,
              port_range_max: 22,
            },
          },
        }),
        attributes,
      ),
    );

    expect(notification[0]!.principalIp).toBe("");
    expect(
      readHiddenAddress(notification[0]!, ScrubbedAddressRole.Principal),
    ).toBeNull();

    await store([...notification, ...auditFilter]);

    expect(
      inserted.map((row: JSONObject): unknown => {
        return row["principalIp"];
      }),
    ).toEqual([SOURCE_ADDRESS, SOURCE_ADDRESS]);
  });
});
