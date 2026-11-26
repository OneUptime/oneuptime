import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import { TelemetryServiceMetadata } from "../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SecurityUserErasureRequestService from "../../../../../Server/Services/SecurityUserErasureRequestService";
import SecurityUserVaultService from "../../../../../Server/Services/SecurityUserVaultService";
import TraceScrubRuleService from "../../../../../Server/Services/TraceScrubRuleService";
import OneUptimeAwsSessions from "../../../../../Server/Utils/CloudConnection/Aws/OneUptimeAwsSessions";
import SecurityAddressVaultLookup from "../../../../../Server/Utils/SecurityEvent/AddressVault/SecurityAddressVaultLookup";
import OpenStackAuditJoin from "../../../../../Server/Utils/SecurityEvent/LogScan/OpenStackAuditJoin";
import SecurityLogScanner from "../../../../../Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";
import RealTimeDetections from "../../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import SecurityRequestTrace from "../../../../../Server/Utils/SecurityEvent/RequestTrace/SecurityRequestTrace";
import ScrubbedClientAddresses from "../../../../../Server/Utils/SecurityEvent/ScrubbedClientAddresses";
import SecurityEventDedupe from "../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import SecurityTrustedProxies from "../../../../../Server/Utils/SecurityEvent/SecurityTrustedProxies";
import TraceSecurityScan from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/TraceSecurityScan";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import SecurityUserErasedTokens from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasedTokens";
import ScrubHashToken from "../../../../../Server/Utils/Telemetry/ScrubHashToken";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityEntityType,
  mergeSecurityEntities,
} from "../../../../../Types/SecurityCase/SecurityEntity";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import {
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind,
} from "../../../../../Types/SecurityEvent/SecurityTelemetrySource";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { NO_TRUSTED_PROXIES } from "../../../../../Utils/SecurityEvent/ClientAddressTrust";
import SecurityLogParser from "../../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import {
  HASHED_USER_ATTRIBUTES,
  SCRUBBED_USER_ATTRIBUTES,
  ScrubbedUserRole,
} from "../../../../../Utils/SecurityEvent/ScrubbedUser";
import { buildTelemetrySecurityEvent } from "../../../../../Utils/SecurityEvent/TelemetryScan/TelemetrySecurityEvent";
import { googleAuditEntry } from "../../../../Utils/SecurityEvent/LogParsers/GoogleCloudAuditFixtures";
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
 * THE SCANS NAME A HASHED USER BEFORE THEY STORE THE EVENT (#10632).
 *
 * The log scan (SecurityLogScanner.storeEvents) and the trace scan
 * (TraceSecurityScan.prepareEvents) look a page's user tokens up in the
 * user vault, after the request follow-up and the address vault, so the
 * stored event - what rules, cases and playbooks read - names the user.
 * Run here through each scan with the vault's read replaced: a failed
 * sign-in a Hash rule hid is stored named once the vault knows the token,
 * and a token it does not know is stored as it was.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10632000-0000-4000-8000-0000000000d1",
);

const SERVICE: TelemetryServiceMetadata = {
  serviceName: "OneUptime Logs",
  primaryEntityId: new ObjectID("10632000-0000-4000-8000-0000000000d2"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: 15,
  projectRetentionConfig: null,
  projectRetentionInDays: 30,
} as unknown as TelemetryServiceMetadata;

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

let vault: Record<string, string> = {};
let lookups: number = 0;
let inserted: Array<JSONObject> = [];

beforeEach(() => {
  vault = {};
  lookups = 0;
  inserted = [];

  // Nobody erased from the vault on request (#10908).
  SecurityUserErasedTokens.clearCache();
  jest
    .spyOn(SecurityUserErasureRequestService, "getErasedTokensOfProject")
    .mockResolvedValue(new Set<string>());

  jest
    .spyOn(SecurityUserVaultService, "findUsersOfTokens")
    .mockImplementation(
      async (data: {
        tokens: ReadonlyArray<string>;
      }): Promise<Map<string, string>> => {
        lookups++;

        const found: Map<string, string> = new Map<string, string>();

        for (const token of data.tokens) {
          if (vault[token]) {
            found.set(token, vault[token]!);
          }
        }

        return found;
      },
    );
  jest
    .spyOn(SecurityAddressVaultLookup, "nameHashedAddresses")
    .mockResolvedValue(0);
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
  // No rule hides an address here: the rule-naming read finds none.
  jest.spyOn(LogScrubRuleService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([] as never);
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

async function storeLogEvents(
  events: Array<NormalizedSecurityEvent>,
): Promise<void> {
  await SecurityLogScanner.storeEvents({
    projectId: PROJECT_ID,
    events,
    serviceMetadata: SERVICE,
  });
}

function sshFailedPassword(user: string): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse(
    logLine(
      `Nov 24 10:00:00 bastion sshd[4242]: Failed password for ${user} from 203.0.113.7 port 52314 ssh2`,
    ),
  );
}

function attributesOf(row: JSONObject): JSONObject {
  return (row["attributes"] || {}) as JSONObject;
}

describe("the log scan", () => {
  test("a failed sign-in whose user a Hash rule hid is named once the vault knows the token", async () => {
    vault = { [tokenOf("deploy")]: "deploy" };

    await storeLogEvents(sshFailedPassword(tokenOf("deploy")));

    expect(lookups).toBe(1);
    expect(inserted).toHaveLength(1);

    const row: JSONObject = inserted[0]!;

    expect(row["principalUser"]).toBe("deploy");
    expect(row["observables"]).toContain("deploy");
    expect(
      attributesOf(row)[HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Principal]],
    ).toBe(tokenOf("deploy"));
    expect(
      attributesOf(row)[
        SCRUBBED_USER_ATTRIBUTES[ScrubbedUserRole.Principal].hidden
      ],
    ).toBeUndefined();
    // Its message says what the line said: the token.
    expect(String(row["message"])).toContain(tokenOf("deploy"));
  });

  test("a cloud audit log's principal a Hash rule hid is named", async () => {
    vault = { [tokenOf("alice@example.com")]: "alice@example.com" };

    await storeLogEvents(
      SecurityLogParser.parse(
        logLine(
          JSON.stringify(
            googleAuditEntry("activity", {
              authenticationInfo: {
                principalEmail: tokenOf("alice@example.com"),
              },
            }),
          ),
        ),
      ),
    );

    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0]!["principalUser"]).toBe("alice@example.com");
  });

  test("a token the vault does not know stays hidden, and is never an account to act on", async () => {
    vault = { [tokenOf("deploy")]: "deploy" };

    await storeLogEvents(sshFailedPassword(tokenOf("root")));

    const row: JSONObject = inserted[0]!;

    expect(row["principalUser"]).toBe(tokenOf("root"));
    expect(
      attributesOf(row)[
        SCRUBBED_USER_ATTRIBUTES[ScrubbedUserRole.Principal].hidden
      ],
    ).toBe("scrub-rule");
    expect(
      mergeSecurityEntities([
        {
          type: SecurityEntityType.User,
          value: String(row["principalUser"]),
        },
      ]),
    ).toEqual([{ type: SecurityEntityType.Other, value: tokenOf("root") }]);
  });

  test("a page of every line is one lookup", async () => {
    vault = { [tokenOf("deploy")]: "deploy", [tokenOf("ci")]: "ci" };

    await storeLogEvents([
      ...sshFailedPassword(tokenOf("deploy")),
      ...sshFailedPassword(tokenOf("ci")),
      ...sshFailedPassword(tokenOf("nobody-known")),
      ...sshFailedPassword("root"),
    ]);

    expect(lookups).toBe(1);
    expect(
      inserted
        .map((row: JSONObject): string => {
          return String(row["principalUser"]);
        })
        .sort(),
    ).toEqual(["ci", "deploy", "root", tokenOf("nobody-known")].sort());
  });

  test("a user the request's trace brought in is named too: the lookup comes after the follow-up", async () => {
    vault = { [tokenOf("mallory@acme.com")]: "mallory@acme.com" };

    jest
      .spyOn(SecurityRequestTrace, "followEvents")
      .mockImplementation(
        async (data: {
          events: Array<NormalizedSecurityEvent>;
        }): Promise<number> => {
          for (const event of data.events) {
            event.principalUser = tokenOf("mallory@acme.com");
          }

          return data.events.length;
        },
      );

    await storeLogEvents(sshFailedPassword("www-data"));

    expect(inserted[0]!["principalUser"]).toBe("mallory@acme.com");
  });

  test("a lookup that fails stores the events as they were", async () => {
    jest
      .spyOn(SecurityUserVaultService, "findUsersOfTokens")
      .mockRejectedValue(new Error("ClickHouse is down") as never);

    await storeLogEvents(sshFailedPassword(tokenOf("deploy")));

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!["principalUser"]).toBe(tokenOf("deploy"));
  });
});

describe("the trace scan", () => {
  // A request's sign-in failure, as the trace scan makes it from a span.
  function spanEvent(user: string): NormalizedSecurityEvent {
    return buildTelemetrySecurityEvent({
      kind: SecurityTelemetrySourceKind.Traces,
      signal: SecurityTelemetrySignal.PromptInjection,
      time: new Date("2026-11-24T10:00:00.000Z"),
      eventUid: `trace:${user}`,
      classUid: 6003,
      activityName: "Read",
      statusName: "Success",
      severity: OcsfSeverity.Medium,
      message: `Prompt injection from ${user}`,
      principalUser: user,
      attributes: { "enduser.id": user },
    });
  }

  test("an AI call's user a Hash rule hid is named before it is stored", async () => {
    vault = { [tokenOf("dev@acme.com")]: "dev@acme.com" };

    jest
      .spyOn(TraceSecurityScan, "leaveRequestsToTheirLogs")
      .mockImplementation(
        async (data: {
          events: Array<NormalizedSecurityEvent>;
        }): Promise<Array<NormalizedSecurityEvent>> => {
          return data.events;
        },
      );
    jest
      .spyOn(TraceSecurityScan, "markFetchedForgeries")
      .mockResolvedValue(undefined as never);

    const events: Array<NormalizedSecurityEvent> =
      await TraceSecurityScan.prepareEvents({
        projectId: PROJECT_ID,
        events: [
          spanEvent(tokenOf("dev@acme.com")),
          spanEvent(tokenOf("unknown@acme.com")),
        ],
      });

    expect(lookups).toBe(1);
    expect(
      events.map((event: NormalizedSecurityEvent): string => {
        return event.principalUser || "";
      }),
    ).toEqual(["dev@acme.com", tokenOf("unknown@acme.com")]);
    expect(events[0]!.attributes["enduser.id"]).toBe("dev@acme.com");
  });
});
