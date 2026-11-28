import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventConnectionService from "../../../../../Server/Services/SecurityEventConnectionService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SecurityConnectionCases from "../../../../../Server/Utils/SecurityCase/SecurityConnectionCases";
import PushedConnectionAlerts, {
  PushedAlertsResult,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/PushedConnectionAlerts";
import RealTimeDetections from "../../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import SecurityEventDedupe from "../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_CONNECTION_ID_ATTRIBUTE } from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import CrowdSecNormalizer from "../../../../../Utils/SecurityEvent/Connectors/CrowdSecNormalizer";
import {
  CROWDSEC_APPSEC_OUTOFBAND_ALERT,
  CROWDSEC_DOCS_SSH_BF_ALERT,
  CROWDSEC_MANUAL_DECISION_ALERT,
  CROWDSEC_NOTIFICATIONS_TEST_ALERT,
} from "../../../../Utils/SecurityEvent/Connectors/CrowdSecFixtures";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * Alerts a product sends through its connection (#11158): CrowdSec's
 * notification plugin names its connection, and what arrives is kept as a
 * poll would keep it - once, attributed to the connection, screened by the
 * real-time rules - and its detections open cases at the connection's Open
 * Cases From, while a person's decision, a test and OneUptime's own ban
 * open nothing. The services the alerts are stored and cased through are
 * stood in for, so what is pinned is what the intake asks of them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-000000000001",
);

let inserted: Array<JSONObject>;
let screened: Array<JSONObject>;
let cased: Array<NormalizedSecurityEvent>;
let existing: Set<string>;
let updates: Array<JSONObject>;
let stored: SecurityEventConnection | null;

function connection(
  overrides?: Partial<SecurityEventConnection>,
): SecurityEventConnection {
  const made: SecurityEventConnection = new SecurityEventConnection();
  made._id = CONNECTION_ID.toString();
  made.projectId = PROJECT_ID;
  made.name = "CrowdSec production";
  made.provider = SecurityEventConnectorProvider.CrowdSec;
  made.isEnabled = true;
  Object.assign(made, overrides || {});
  return made;
}

function events(): Array<NormalizedSecurityEvent> {
  return [
    CROWDSEC_DOCS_SSH_BF_ALERT,
    CROWDSEC_APPSEC_OUTOFBAND_ALERT,
    CROWDSEC_NOTIFICATIONS_TEST_ALERT,
    CROWDSEC_MANUAL_DECISION_ALERT,
  ].map((alert: JSONObject): NormalizedSecurityEvent => {
    return CrowdSecNormalizer.normalize(JSON.parse(JSON.stringify(alert)));
  });
}

beforeEach(() => {
  inserted = [];
  screened = [];
  cased = [];
  existing = new Set();
  updates = [];
  stored = connection();
  PushedConnectionAlerts.clearCache();

  jest
    .spyOn(SecurityEventDedupe, "findExistingEventUids")
    .mockImplementation((async (data: { ids: Array<string> }) => {
      return new Set(
        data.ids.filter((id: string): boolean => {
          return existing.has(id);
        }),
      );
    }) as never);

  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async () => {
      return {
        serviceName: "CrowdSec",
        primaryEntityId: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001"),
        primaryEntityType: "OpenTelemetry",
        entityKeys: [],
      } as unknown as TelemetryServiceMetadata;
    }) as never);

  jest
    .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
    .mockImplementation((async () => {
      return undefined;
    }) as never);

  jest.spyOn(SecurityEventService, "insertJsonRows").mockImplementation((async (
    rows: Array<JSONObject>,
  ) => {
    inserted.push(...rows);
  }) as never);

  jest.spyOn(RealTimeDetections, "screen").mockImplementation((async (data: {
    rows: Array<JSONObject>;
  }) => {
    screened.push(...data.rows);
  }) as never);

  jest
    .spyOn(SecurityConnectionCases, "recordImportedAlerts")
    .mockImplementation((async (data: {
      events: Array<NormalizedSecurityEvent>;
    }) => {
      cased.push(...data.events);
      return data.events.length;
    }) as never);

  jest
    .spyOn(SecurityEventConnectionService, "findOneBy")
    .mockImplementation((async () => {
      return stored;
    }) as never);

  jest
    .spyOn(SecurityEventConnectionService, "updateOneById")
    .mockImplementation((async (args: JSONObject) => {
      updates.push(args);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the connection a request names", () => {
  test("is the project's connection of a product that sends its alerts", async () => {
    await expect(
      PushedConnectionAlerts.findConnection({
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID.toString(),
      }),
    ).resolves.toBe(stored);
  });

  test("is refused, with where to copy it from, when it is no id, no connection, or a polled product's", async () => {
    await expect(
      PushedConnectionAlerts.findConnection({
        projectId: PROJECT_ID,
        connectionId: "not-an-id",
      }),
    ).rejects.toThrow(BadDataException);

    stored = null;
    await expect(
      PushedConnectionAlerts.findConnection({
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID.toString(),
      }),
    ).rejects.toThrow("Copy the address from the connection's Send alerts");

    PushedConnectionAlerts.clearCache();
    stored = connection({
      provider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
    });
    await expect(
      PushedConnectionAlerts.findConnection({
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID.toString(),
      }),
    ).rejects.toThrow("no connection of that ID that receives alerts");
  });

  test("is read once a minute, however many requests name it", async () => {
    for (let index: number = 0; index < 5; index++) {
      await PushedConnectionAlerts.findConnection({
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID.toString(),
      });
    }

    expect(SecurityEventConnectionService.findOneBy).toHaveBeenCalledTimes(1);
  });

  test("of another project is none of this one's", async () => {
    await PushedConnectionAlerts.findConnection({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID.toString(),
    });

    const query: JSONObject = (
      (SecurityEventConnectionService.findOneBy as jest.Mock).mock
        .calls[0]![0] as { query: JSONObject }
    ).query;
    expect(query["projectId"]).toBe(PROJECT_ID);
  });
});

describe("alerts sent through it", () => {
  test("are stored once, as the connection's, screened, and its detections - only - open cases", async () => {
    const result: PushedAlertsResult = await PushedConnectionAlerts.receive({
      projectId: PROJECT_ID,
      connection: connection(),
      events: events(),
    });

    expect(result).toEqual({
      received: 4,
      duplicates: 0,
      stored: 4,
      detections: 2,
      casesOpened: 2,
    });

    expect(inserted).toHaveLength(4);
    expect(screened).toHaveLength(4);

    for (const row of inserted) {
      const attributes: JSONObject = row["attributes"] as JSONObject;
      expect(attributes[SECURITY_CONNECTION_ID_ATTRIBUTE]).toBe(
        CONNECTION_ID.toString(),
      );
      expect(attributes["oneuptime.security_connection.provider"]).toBe(
        SecurityEventConnectorProvider.CrowdSec,
      );
      expect(row["vendorName"]).toBe("CrowdSec");
      expect(row["productName"]).toBe("CrowdSec");
    }

    // The SSH brute force and the AppSec alert; not the test, not the person's ban.
    expect(
      cased.map((event: NormalizedSecurityEvent): string => {
        return event.ruleId;
      }),
    ).toEqual([
      "crowdsecurity/ssh-bf",
      "crowdsecurity/crowdsec-appsec-outofband",
    ]);
  });

  test("notes when the last of them arrived", async () => {
    await PushedConnectionAlerts.receive({
      projectId: PROJECT_ID,
      connection: connection(),
      events: events(),
    });

    expect(updates).toHaveLength(1);
    expect((updates[0]!["id"] as ObjectID).toString()).toBe(
      CONNECTION_ID.toString(),
    );
    expect(
      (updates[0]!["data"] as JSONObject)["lastEventIngestedAt"],
    ).toBeInstanceOf(Date);
    expect(updates[0]!["props"]).toEqual({ isRoot: true });
  });

  test("an alert sent again, or twice in one batch, is stored once and opens nothing new", async () => {
    const batch: Array<NormalizedSecurityEvent> = events();
    existing.add(batch[0]!.eventUid);

    const result: PushedAlertsResult = await PushedConnectionAlerts.receive({
      projectId: PROJECT_ID,
      connection: connection(),
      events: [...batch, ...events()],
    });

    expect(result.received).toBe(8);
    expect(result.stored).toBe(3);
    expect(result.duplicates).toBe(5);
    expect(
      cased.map((event: NormalizedSecurityEvent): string => {
        return event.ruleId;
      }),
    ).toEqual(["crowdsecurity/crowdsec-appsec-outofband"]);
  });

  test("a batch of nothing new stores nothing and notes nothing", async () => {
    const batch: Array<NormalizedSecurityEvent> = events();

    for (const event of batch) {
      existing.add(event.eventUid);
    }

    const result: PushedAlertsResult = await PushedConnectionAlerts.receive({
      projectId: PROJECT_ID,
      connection: connection(),
      events: batch,
    });

    expect(result.stored).toBe(0);
    expect(inserted).toEqual([]);
    expect(cased).toEqual([]);
    expect(updates).toEqual([]);
  });

  test("a connection that is not enabled keeps them as events, and opens no case", async () => {
    const result: PushedAlertsResult = await PushedConnectionAlerts.receive({
      projectId: PROJECT_ID,
      connection: connection({ isEnabled: false }),
      events: events(),
    });

    expect(result.stored).toBe(4);
    expect(result.casesOpened).toBe(0);
    expect(cased).toEqual([]);
  });

  test("a connection whose time cannot be noted still keeps its alerts", async () => {
    (
      SecurityEventConnectionService.updateOneById as jest.Mock
    ).mockImplementation((async () => {
      throw new Error("database is down");
    }) as never);

    const result: PushedAlertsResult = await PushedConnectionAlerts.receive({
      projectId: PROJECT_ID,
      connection: connection(),
      events: events(),
    });

    expect(result.stored).toBe(4);
  });
});
