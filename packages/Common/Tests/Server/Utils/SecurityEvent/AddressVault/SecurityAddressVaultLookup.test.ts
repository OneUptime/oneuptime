import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import LogScrubRule from "../../../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../../../Models/DatabaseModels/TraceScrubRule";
import { Results } from "../../../../../Server/Services/AnalyticsDatabaseService";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import { TelemetryServiceMetadata } from "../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityAddressVaultService from "../../../../../Server/Services/SecurityAddressVaultService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SpanService from "../../../../../Server/Services/SpanService";
import TraceScrubRuleService from "../../../../../Server/Services/TraceScrubRuleService";
import SecurityAddressVaultLookup, {
  nameVaultAddress,
  readVaultToken,
} from "../../../../../Server/Utils/SecurityEvent/AddressVault/SecurityAddressVaultLookup";
import OpenStackAuditJoin from "../../../../../Server/Utils/SecurityEvent/LogScan/OpenStackAuditJoin";
import SecurityLogScanner from "../../../../../Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";
import RealTimeDetections from "../../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import SecurityRequestTrace, {
  SecurityRequestTraceRows,
} from "../../../../../Server/Utils/SecurityEvent/RequestTrace/SecurityRequestTrace";
import ScrubbedClientAddresses from "../../../../../Server/Utils/SecurityEvent/ScrubbedClientAddresses";
import SecurityTrustedProxies from "../../../../../Server/Utils/SecurityEvent/SecurityTrustedProxies";
import {
  NO_TRUSTED_PROXIES,
  toTrustedProxies,
} from "../../../../../Utils/SecurityEvent/ClientAddressTrust";
import { TelemetryScanWindow } from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanStatements";
import { TelemetryWindowRead } from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanTypes";
import TraceSecurityScan from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/TraceSecurityScan";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import ScrubHashToken from "../../../../../Server/Utils/Telemetry/ScrubHashToken";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import TraceScrubField from "../../../../../Types/Trace/TraceScrubField";
import WebAttackLogParser from "../../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  markClientAddressScrubbed,
  readHiddenClientAddress,
} from "../../../../../Utils/SecurityEvent/ScrubbedAddress";
import { logLine } from "../../../../Utils/SecurityEvent/LogParsers/LogParserFixtures";

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
 * SECURITY EVENTS NAMES THE ADDRESS BEHIND A HASH RULE'S TOKEN (#10395).
 *
 * Both scans keep the token a Hash rule left in an event's client address
 * field on the event (#10397). Before a page is stored - after the request
 * follow-up, before threat intel and the naming of the rule that hid an
 * address - the page's tokens are looked up in Security Events' address
 * vault, in one query, and a token it holds names the event's address:
 * principalIp, the request's client address and an observable, with the
 * "hidden" marker cleared. Pinned here with the vault's query and the
 * stores replaced:
 *
 *   - which tokens are looked up: today's Hash tokens in the marker, and
 *     nothing else of the event or the line;
 *   - what naming an address writes, and that an unnamed token, an older
 *     token or a failed lookup leaves the event as the scan marked it;
 *   - the trace scan and the log scan: a path traversal from 203.0.113.7,
 *     its address hashed, stored as an event that names 203.0.113.7.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10395000-0000-4000-8000-0000000000c1",
);

const ATTACKER: string = "203.0.113.7";
const OTHER_ADDRESS: string = "198.51.100.9";

function tokenOf(address: string): string {
  return ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address });
}

const ACCESS_LINE_OF: (client: string, target?: string) => string = (
  client: string,
  target: string = "/static/../../etc/passwd",
): string => {
  return `${client} - - [20/Nov/2026:10:00:05 +0000] "GET ${target} HTTP/1.1" 404 153 "-" "curl/8.5.0"`;
};

// A web attack event of an access line, as the log scan reads it.
function lineEvent(
  body: string,
  attributes: JSONObject = {},
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse(
    logLine(body, attributes),
  );

  expect(events).toHaveLength(1);

  return events[0]!;
}

// An event whose client address a rule hid, as a scan marks it.
function hiddenEvent(
  kind: ScrubbedAddressKind,
  value: string,
  place: ScrubbedAddressPlace = ScrubbedAddressPlace.LogBody,
): NormalizedSecurityEvent {
  const event: NormalizedSecurityEvent = lineEvent(
    "WARN rejected /static/../../etc/passwd",
  );

  markClientAddressScrubbed(event.attributes, {
    scrubbed: { kind, value },
    place,
  });

  return event;
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

afterEach(() => {
  jest.restoreAllMocks();
  ScrubbedClientAddresses.clearCache();
});

describe("the token an event keeps", () => {
  test("is a Hash rule's token of today's form, from the marker", () => {
    const event: NormalizedSecurityEvent = hiddenEvent(
      ScrubbedAddressKind.Hashed,
      tokenOf(ATTACKER),
    );

    expect(readVaultToken(event)).toBe(tokenOf(ATTACKER));
  });

  test.each([
    ["an older 8-hex token", ScrubbedAddressKind.Hashed, "[HASHED:8c87b489]"],
    ["what Redact leaves", ScrubbedAddressKind.Redacted, "[REDACTED]"],
    ["what Mask leaves", ScrubbedAddressKind.Masked, "***.***.***.***"],
  ])(
    "is none for %s",
    (_label: string, kind: ScrubbedAddressKind, value: string) => {
      expect(readVaultToken(hiddenEvent(kind, value))).toBeNull();
    },
  );

  test("is none for an event that names its address, or says nothing hidden", () => {
    const named: NormalizedSecurityEvent = lineEvent(ACCESS_LINE_OF(ATTACKER));

    expect(readVaultToken(named)).toBeNull();

    // A marker, but an address too: the address is the event's.
    const both: NormalizedSecurityEvent = hiddenEvent(
      ScrubbedAddressKind.Hashed,
      tokenOf(ATTACKER),
    );
    both.principalIp = OTHER_ADDRESS;

    expect(readVaultToken(both)).toBeNull();
  });

  test("is never a token the line holds anywhere but its client field", () => {
    // The client field is the line's first word; the target is the sender's.
    const event: NormalizedSecurityEvent = lineEvent(
      ACCESS_LINE_OF(
        "[REDACTED]",
        `/static/../../etc/passwd?from=${tokenOf(OTHER_ADDRESS)}`,
      ),
    );

    expect(readHiddenClientAddress(event)?.kind).toBe(
      ScrubbedAddressKind.Redacted,
    );
    expect(readVaultToken(event)).toBeNull();
  });
});

describe("naming the address the vault holds", () => {
  test("writes principalIp, the request's client address and an observable, and clears the marker", () => {
    const event: NormalizedSecurityEvent = hiddenEvent(
      ScrubbedAddressKind.Hashed,
      tokenOf(ATTACKER),
    );

    nameVaultAddress(event, ATTACKER);

    expect(event.principalIp).toBe(ATTACKER);
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddress]).toBe(
      ATTACKER,
    );
    expect(event.observables).toContain(ATTACKER);
    for (const key of CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES) {
      expect(event.attributes[key]).toBeUndefined();
    }
    expect(readHiddenClientAddress(event)).toBeNull();
    // Nothing of the token is left on the event.
    expect(JSON.stringify(event)).not.toContain(tokenOf(ATTACKER));
  });

  test("an observable already there is not added twice", () => {
    const event: NormalizedSecurityEvent = hiddenEvent(
      ScrubbedAddressKind.Hashed,
      tokenOf("2001:db8::7"),
    );
    event.observables = ["2001:DB8::7"];

    nameVaultAddress(event, "2001:db8::7");

    expect(event.observables).toEqual(["2001:DB8::7"]);
  });
});

describe("looking a page's tokens up", () => {
  test("one query for the page's tokens, each once, and each event named", async () => {
    const vault: ReturnType<typeof jest.spyOn> = vaultHolds({
      [tokenOf(ATTACKER)]: ATTACKER,
      [tokenOf(OTHER_ADDRESS)]: OTHER_ADDRESS,
    });
    const events: Array<NormalizedSecurityEvent> = [
      hiddenEvent(ScrubbedAddressKind.Hashed, tokenOf(ATTACKER)),
      hiddenEvent(ScrubbedAddressKind.Hashed, tokenOf(OTHER_ADDRESS)),
      hiddenEvent(ScrubbedAddressKind.Hashed, tokenOf(ATTACKER)),
    ];

    const named: number = await SecurityAddressVaultLookup.nameHashedAddresses({
      projectId: PROJECT_ID,
      events,
    });

    expect(named).toBe(3);
    expect(vault).toHaveBeenCalledTimes(1);
    expect(vault.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        tokens: [tokenOf(ATTACKER), tokenOf(OTHER_ADDRESS), tokenOf(ATTACKER)],
      }),
    );
    expect(
      events.map((event: NormalizedSecurityEvent): string => {
        return event.principalIp;
      }),
    ).toEqual([ATTACKER, OTHER_ADDRESS, ATTACKER]);
  });

  test("a token the vault does not hold leaves the event as the scan marked it", async () => {
    vaultHolds({});
    const event: NormalizedSecurityEvent = hiddenEvent(
      ScrubbedAddressKind.Hashed,
      tokenOf(ATTACKER),
    );
    const before: string = JSON.stringify(event);

    expect(
      await SecurityAddressVaultLookup.nameHashedAddresses({
        projectId: PROJECT_ID,
        events: [event],
      }),
    ).toBe(0);
    expect(JSON.stringify(event)).toBe(before);
    expect(readHiddenClientAddress(event)).toEqual(
      expect.objectContaining({
        kind: ScrubbedAddressKind.Hashed,
        value: tokenOf(ATTACKER),
      }),
    );
  });

  test("a page with nothing to look up asks the vault nothing", async () => {
    const vault: ReturnType<typeof jest.spyOn> = vaultHolds({});

    await SecurityAddressVaultLookup.nameHashedAddresses({
      projectId: PROJECT_ID,
      events: [
        lineEvent(ACCESS_LINE_OF(ATTACKER)),
        hiddenEvent(ScrubbedAddressKind.Redacted, "[REDACTED]"),
        hiddenEvent(ScrubbedAddressKind.Hashed, "[HASHED:8c87b489]"),
      ],
    });

    expect(vault).not.toHaveBeenCalled();
  });

  test("a lookup that fails is logged, and the events are stored as marked", async () => {
    jest
      .spyOn(SecurityAddressVaultService, "findAddressesOfTokens")
      .mockRejectedValue(new Error("ClickHouse is down") as never);
    const event: NormalizedSecurityEvent = hiddenEvent(
      ScrubbedAddressKind.Hashed,
      tokenOf(ATTACKER),
    );

    await expect(
      SecurityAddressVaultLookup.nameHashedAddresses({
        projectId: PROJECT_ID,
        events: [event],
      }),
    ).resolves.toBe(0);
    expect(event.principalIp).toBe("");
    expect(readHiddenClientAddress(event)?.value).toBe(tokenOf(ATTACKER));
  });

  test("one ClickHouse query for the page, through the vault's one read", async () => {
    jest
      .spyOn(SecurityAddressVaultService.database, "getDatasourceOptions")
      .mockReturnValue({ database: "oneuptime" } as never);
    const query: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityAddressVaultService, "executeQuery")
      .mockResolvedValue(
        answer([
          { token: tokenOf(ATTACKER), vaultAddresses: [ATTACKER] },
        ]) as never,
      );
    const events: Array<NormalizedSecurityEvent> = [];

    for (let index: number = 0; index < 50; index++) {
      events.push(hiddenEvent(ScrubbedAddressKind.Hashed, tokenOf(ATTACKER)));
    }

    await SecurityAddressVaultLookup.nameHashedAddresses({
      projectId: PROJECT_ID,
      events,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(
      events.every((event: NormalizedSecurityEvent): boolean => {
        return event.principalIp === ATTACKER;
      }),
    ).toBe(true);
  });
});

const WINDOW: TelemetryScanWindow = {
  projectId: PROJECT_ID,
  arrivedAfter: new Date("2026-11-20T10:00:00.000Z"),
  arrivedUntil: new Date("2026-11-20T10:05:00.000Z"),
  happenedAfter: new Date("2026-11-20T09:00:00.000Z"),
};

function hashRule<T extends LogScrubRule | TraceScrubRule>(rule: T): T {
  rule.id = ObjectID.generate();
  rule.name = "Hash IP addresses";
  rule.patternType = LogScrubPatternType.IPAddress;
  rule.scrubAction = LogScrubAction.Hash;

  return rule;
}

/*
 * A server span of a path traversal, its client's address hashed: the
 * span's peer, the address its sender could not have written (#10416
 * makes client.address only a claim).
 */
function traversalSpan(clientAddress: string): JSONObject {
  return {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    name: "GET /download",
    kind: "SPAN_KIND_SERVER",
    durationUnixNano: "12000000",
    startTime: "2026-11-20 10:00:00.000000000",
    attributes: {
      "url.path": "/download",
      "url.query": "file=../../../../etc/passwd",
      "http.request.method": "GET",
      "http.response.status_code": "200",
      "network.peer.address": clientAddress,
    },
  };
}

describe("the trace scan names the address behind a span's token", () => {
  async function scanSpan(row: JSONObject): Promise<NormalizedSecurityEvent> {
    jest.spyOn(SecurityEventService, "findBy").mockResolvedValue([]);
    jest.spyOn(SecurityRequestTrace, "followEvents").mockResolvedValue(0);
    jest
      .spyOn(SpanService, "executeQuery")
      .mockResolvedValue(answer([row]) as never);

    const read: TelemetryWindowRead = await TraceSecurityScan.readWindow({
      window: WINDOW,
      offset: 0,
      pageSize: 100,
    });
    const prepared: Array<NormalizedSecurityEvent> =
      await TraceSecurityScan.prepareEvents({
        projectId: PROJECT_ID,
        events: read.events,
      });

    expect(prepared).toHaveLength(1);

    return prepared[0]!;
  }

  test("a path traversal from 203.0.113.7, its address hashed, names 203.0.113.7", async () => {
    vaultHolds({ [tokenOf(ATTACKER)]: ATTACKER });
    const rules: ReturnType<typeof jest.spyOn> = jest.spyOn(
      TraceScrubRuleService,
      "findBy",
    );

    const event: NormalizedSecurityEvent = await scanSpan(
      traversalSpan(tokenOf(ATTACKER)),
    );

    expect(event.principalIp).toBe(ATTACKER);
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddress]).toBe(
      ATTACKER,
    );
    expect(event.observables).toContain(ATTACKER);
    expect(readHiddenClientAddress(event)).toBeNull();
    expect(event.message).toContain("Path traversal attempt");
    // Nothing is hidden, so no rule is asked about.
    expect(rules).not.toHaveBeenCalled();
  });

  test("a token the vault does not hold: the event says a Hash rule hid the address, and names the rule", async () => {
    vaultHolds({});
    const rule: TraceScrubRule = hashRule(new TraceScrubRule());
    rule.fieldsToScrub = TraceScrubField.All;
    jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([rule]);

    const event: NormalizedSecurityEvent = await scanSpan(
      traversalSpan(tokenOf(ATTACKER)),
    );

    expect(event.principalIp).toBe("");
    expect(readHiddenClientAddress(event)).toEqual(
      expect.objectContaining({
        kind: ScrubbedAddressKind.Hashed,
        value: tokenOf(ATTACKER),
        place: ScrubbedAddressPlace.SpanAttributes,
        ruleId: rule.id!.toString(),
        ruleName: "Hash IP addresses",
      }),
    );
  });

  test("looks up after the request is followed, and before the rule that hid an address is named", async () => {
    const calls: Array<string> = [];

    jest.spyOn(SecurityEventService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(SecurityRequestTrace, "followEvents")
      .mockImplementation(async (): Promise<number> => {
        calls.push("follow");
        return 0;
      });
    jest
      .spyOn(SecurityAddressVaultLookup, "nameHashedAddresses")
      .mockImplementation(async (): Promise<number> => {
        calls.push("vault");
        return 0;
      });
    jest
      .spyOn(ScrubbedClientAddresses, "nameScrubRules")
      .mockImplementation(async (): Promise<void> => {
        calls.push("rules");
      });

    await TraceSecurityScan.prepareEvents({
      projectId: PROJECT_ID,
      events: [hiddenEvent(ScrubbedAddressKind.Hashed, tokenOf(ATTACKER))],
    });

    expect(calls).toEqual(["follow", "vault", "rules"]);
  });
});

describe("the log scan names the address behind a line's token, as its row is stored", () => {
  let inserted: Array<JSONObject> = [];
  let enriched: Array<NormalizedSecurityEvent> = [];

  const SERVICE: TelemetryServiceMetadata = {
    serviceName: "OneUptime Logs",
    primaryEntityId: new ObjectID("10395000-0000-4000-8000-0000000000c3"),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: 15,
    projectRetentionConfig: null,
    projectRetentionInDays: 30,
  } as unknown as TelemetryServiceMetadata;

  beforeEach(() => {
    inserted = [];
    enriched = [];
    jest
      .spyOn(OpenStackAuditJoin, "enrichEvents")
      .mockResolvedValue(undefined as never);
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
    const rule: LogScrubRule = hashRule(new LogScrubRule());
    rule.fieldsToScrub = LogScrubField.Both;
    jest.spyOn(LogScrubRuleService, "findBy").mockResolvedValue([rule]);
  });

  async function store(events: Array<NormalizedSecurityEvent>): Promise<void> {
    await SecurityLogScanner.storeEvents({
      projectId: PROJECT_ID,
      events,
      serviceMetadata: SERVICE,
    });
  }

  test("an nginx access line whose client a Hash rule hid: the event names 203.0.113.7", async () => {
    jest.spyOn(SecurityRequestTrace, "followEvents").mockResolvedValue(0);
    vaultHolds({ [tokenOf(ATTACKER)]: ATTACKER });

    await store([lineEvent(ACCESS_LINE_OF(tokenOf(ATTACKER)))]);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!["principalIp"]).toBe(ATTACKER);
    expect(inserted[0]!["observables"]).toContain(ATTACKER);
    expect(inserted[0]!["attributes"]).toEqual(
      expect.objectContaining({
        [SECURITY_REQUEST_ATTRIBUTES.clientAddress]: ATTACKER,
      }),
    );
    for (const key of CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES) {
      expect((inserted[0]!["attributes"] as JSONObject)[key]).toBeUndefined();
    }
    // Threat intel is asked about the address, as about any other.
    expect(enriched[0]!.observables).toContain(ATTACKER);
  });

  test.each([
    [
      "a JSON access log's client field",
      `{"remote_addr":"${"TOKEN"}","request":"GET /static/../../etc/passwd HTTP/1.1","status":404}`,
      {},
    ],
    [
      "a record's peer address attribute",
      "WARN rejected /static/../../etc/passwd",
      { "network.peer.address": "TOKEN" },
    ],
  ])(
    "%s, hashed, names its address",
    async (_label: string, body: string, attributes: JSONObject) => {
      jest.spyOn(SecurityRequestTrace, "followEvents").mockResolvedValue(0);
      vaultHolds({ [tokenOf(ATTACKER)]: ATTACKER });

      const withToken: (text: string) => string = (text: string): string => {
        return text.replace("TOKEN", tokenOf(ATTACKER));
      };
      const lineAttributes: JSONObject = {};

      for (const [key, value] of Object.entries(attributes)) {
        lineAttributes[key] = withToken(String(value));
      }

      await store([lineEvent(withToken(body), lineAttributes)]);

      expect(inserted[0]!["principalIp"]).toBe(ATTACKER);
    },
  );

  test("the sender's words never name an address: a hidden client field names only its own", async () => {
    jest.spyOn(SecurityRequestTrace, "followEvents").mockResolvedValue(0);
    // The vault knows the sender's address too: a Hash rule hid it in the URL.
    vaultHolds({
      [tokenOf(ATTACKER)]: ATTACKER,
      [tokenOf(OTHER_ADDRESS)]: OTHER_ADDRESS,
    });

    await store([
      lineEvent(
        ACCESS_LINE_OF(
          tokenOf(ATTACKER),
          `/static/../../etc/passwd?from=${tokenOf(OTHER_ADDRESS)}&ip=${tokenOf(OTHER_ADDRESS)}`,
        ),
      ),
      lineEvent(
        ACCESS_LINE_OF(
          "[REDACTED]",
          `/static/../../etc/passwd?client=${tokenOf(OTHER_ADDRESS)}`,
        ),
      ),
    ]);

    expect(
      inserted.map((row: JSONObject): unknown => {
        return row["principalIp"];
      }),
    ).toEqual([ATTACKER, ""]);
    expect(JSON.stringify(inserted)).not.toContain(`"${OTHER_ADDRESS}"`);
  });

  test("a line followed into its trace: the trace's hashed client address names the address", async () => {
    vaultHolds({ [tokenOf(ATTACKER)]: ATTACKER });
    const traceRows: Map<string, SecurityRequestTraceRows> = new Map([
      [
        "4bf92f3577b34da6a3ce929d0e0e4736",
        {
          spans: [
            {
              spanId: "00f067aa0ba902b7",
              parentSpanId: "",
              name: "GET /static",
              kind: "SPAN_KIND_SERVER",
              statusCode: 0,
              durationMs: 3,
              attributes: {
                "http.response.status_code": "404",
                "network.peer.address": tokenOf(ATTACKER),
              },
            },
          ],
          exceptions: [],
        },
      ],
    ]);
    jest.spyOn(SecurityRequestTrace, "readTraces").mockResolvedValue(traceRows);

    const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
      ...logLine("WARN rejected /static/../../etc/passwd"),
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
    });

    await store(events);

    expect(inserted[0]!["principalIp"]).toBe(ATTACKER);
  });

  test("a line whose client a log rule redacted, in a trace a Hash rule left a token in: the token names it", async () => {
    vaultHolds({ [tokenOf(ATTACKER)]: ATTACKER });
    jest.spyOn(SecurityRequestTrace, "readTraces").mockResolvedValue(
      new Map([
        [
          "4bf92f3577b34da6a3ce929d0e0e4736",
          {
            spans: [
              {
                spanId: "00f067aa0ba902b7",
                parentSpanId: "",
                name: "GET /static",
                kind: "SPAN_KIND_SERVER",
                statusCode: 0,
                durationMs: 3,
                attributes: { "network.peer.address": tokenOf(ATTACKER) },
              },
            ],
            exceptions: [],
          },
        ],
      ]),
    );

    const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
      ...logLine(ACCESS_LINE_OF("[REDACTED]")),
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
    });

    await store(events);

    expect(inserted[0]!["principalIp"]).toBe(ATTACKER);
  });

  test("a token the vault does not hold: the row says a scrub rule hid the address, and names the rule", async () => {
    jest.spyOn(SecurityRequestTrace, "followEvents").mockResolvedValue(0);
    vaultHolds({});

    await store([lineEvent(ACCESS_LINE_OF(tokenOf(ATTACKER)))]);

    expect(inserted[0]!["principalIp"]).toBe("");
    expect(inserted[0]!["attributes"]).toEqual(
      expect.objectContaining({
        "oneuptime.request.client_address_hidden": "scrub-rule",
        "oneuptime.request.client_address_scrubbed": tokenOf(ATTACKER),
        "oneuptime.request.client_address_scrubbed_in": "log-body",
        "oneuptime.request.client_address_scrub_rule": "Hash IP addresses",
      }),
    );
    expect(inserted[0]!["observables"]).not.toContain(tokenOf(ATTACKER));
  });

  test("looks up after the request is followed, and before threat intel and the rule's name", async () => {
    const calls: Array<string> = [];

    jest
      .spyOn(SecurityRequestTrace, "followEvents")
      .mockImplementation(async (): Promise<number> => {
        calls.push("follow");
        return 0;
      });
    jest
      .spyOn(SecurityAddressVaultLookup, "nameHashedAddresses")
      .mockImplementation(async (): Promise<number> => {
        calls.push("vault");
        return 0;
      });
    jest
      .spyOn(ScrubbedClientAddresses, "nameScrubRules")
      .mockImplementation(async (): Promise<void> => {
        calls.push("rules");
      });
    jest
      .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
      .mockImplementation(async (): Promise<never> => {
        calls.push("threat-intel");
        return { eventsMatched: 0, valuesLookedUp: 0 } as never;
      });

    await store([lineEvent(ACCESS_LINE_OF(tokenOf(ATTACKER)))]);

    expect(calls).toEqual(["follow", "vault", "rules", "threat-intel"]);
  });
});

/*
 * The vault names only an address its sender could not have written
 * (#10416): it reads a token only from the #10397 marker, which the scans
 * set only for a verified address, and an address a proxy forwarded that
 * turns out to be a proxy the project trusts is no client.
 */
describe("the address the vault names is one its sender could not have written (#10416)", () => {
  const EDGE: string = "172.70.38.12";

  async function scanSpanWith(
    attributes: Record<string, string>,
  ): Promise<NormalizedSecurityEvent> {
    jest.spyOn(SecurityEventService, "findBy").mockResolvedValue([]);
    jest.spyOn(SecurityRequestTrace, "followEvents").mockResolvedValue(0);
    jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([]);
    jest.spyOn(SpanService, "executeQuery").mockResolvedValue(
      answer([
        {
          ...traversalSpan(""),
          attributes: {
            "url.path": "/download",
            "url.query": "file=../../../../etc/passwd",
            "http.request.method": "GET",
            "http.response.status_code": "200",
            ...attributes,
          },
        },
      ]) as never,
    );

    const read: TelemetryWindowRead = await TraceSecurityScan.readWindow({
      window: WINDOW,
      offset: 0,
      pageSize: 100,
    });
    const prepared: Array<NormalizedSecurityEvent> =
      await TraceSecurityScan.prepareEvents({
        projectId: PROJECT_ID,
        events: read.events,
      });

    expect(prepared).toHaveLength(1);

    return prepared[0]!;
  }

  test("a token only client.address held is a claim: the vault is never asked, and no address is named", async () => {
    jest
      .spyOn(SecurityTrustedProxies, "getForProject")
      .mockResolvedValue(NO_TRUSTED_PROXIES);
    const vault: ReturnType<typeof jest.spyOn> = vaultHolds({
      [tokenOf(OTHER_ADDRESS)]: OTHER_ADDRESS,
    });

    const event: NormalizedSecurityEvent = await scanSpanWith({
      "client.address": tokenOf(OTHER_ADDRESS),
    });

    expect(vault).not.toHaveBeenCalled();
    expect(event.principalIp).toBe("");
    expect(event.observables).not.toContain(OTHER_ADDRESS);
    expect(readHiddenClientAddress(event)).toBeNull();
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust],
    ).toBe("claimed");
  });

  test("the hop a private load balancer appended to the recorded X-Forwarded-For is named", async () => {
    jest
      .spyOn(SecurityTrustedProxies, "getForProject")
      .mockResolvedValue(NO_TRUSTED_PROXIES);
    vaultHolds({
      [tokenOf(OTHER_ADDRESS)]: OTHER_ADDRESS,
      [tokenOf(ATTACKER)]: ATTACKER,
    });

    const event: NormalizedSecurityEvent = await scanSpanWith({
      "network.peer.address": "10.0.0.5",
      "client.address": tokenOf(OTHER_ADDRESS),
      "http.request.header.x-forwarded-for": `["${tokenOf(OTHER_ADDRESS)}, ${tokenOf(ATTACKER)}"]`,
    });

    expect(event.principalIp).toBe(ATTACKER);
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust],
    ).toBe("trusted-proxy");
    // The sender's claim stays a claim, as the rule left it.
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress],
    ).toBe(tokenOf(OTHER_ADDRESS));
    expect(event.observables).not.toContain(OTHER_ADDRESS);
  });

  test("a hop that turns out to be a proxy the project trusts - a hashed CDN edge - is not named, and stays hidden", async () => {
    jest
      .spyOn(SecurityTrustedProxies, "getForProject")
      .mockResolvedValue(toTrustedProxies("172.64.0.0/13"));
    vaultHolds({ [tokenOf(EDGE)]: EDGE });

    const event: NormalizedSecurityEvent = await scanSpanWith({
      "network.peer.address": "10.0.0.5",
      "http.request.header.x-forwarded-for": `192.0.2.44, ${tokenOf(EDGE)}`,
    });

    expect(event.principalIp).toBe("");
    expect(event.observables).not.toContain(EDGE);
    expect(readHiddenClientAddress(event)?.value).toBe(tokenOf(EDGE));
  });
});
