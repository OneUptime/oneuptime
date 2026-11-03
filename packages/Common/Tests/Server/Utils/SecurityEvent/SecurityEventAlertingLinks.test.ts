/*
 * The alert creation path pulls the native isolated-vm addon through its
 * template renderer; stub it out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import {
  AlertableMatch,
  openDedupedAlerts,
  openDedupedIncidents,
  readMatchAffectedResources,
} from "../../../../Server/Utils/SecurityEvent/SecurityEventAlerting";
import SecurityConnections from "../../../../Server/Utils/SecurityEvent/Connections/SecurityConnections";
import { SecurityConnectedRecord } from "../../../../Server/Utils/SecurityEvent/Connections/SecurityConnectedRecords";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import logger from "../../../../Server/Utils/Logger";
import {
  AiAffectedResourceKind,
  AiAffectedResourceRef,
} from "../../../../Types/AI/AiAffectedResources";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
} from "../../../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import { getJestSpyOn } from "../../../Spy";
import { mockProjectStates } from "../../TestingUtils/Services/ProjectStatesHelper";
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

/*
 * WHAT A SECURITY ALERT OR INCIDENT IS ABOUT (#5303's follow-up).
 *
 * A detection rule's match, a threat intel feed's and Data Security's issue
 * opened their alerts and incidents linked to nothing, so OneUptime AI had
 * nothing to investigate or fix there, the host's owners' rules never
 * applied and its page never listed them. Every one now goes through
 * SecurityEventAlerting linked to what its match is about:
 *
 *   - what the source knows it comes from (affectedResources);
 *   - the records its entities name exactly, read as OneUptime in the
 *     window its events are in (SecurityConnections.readEntityLinks) -
 *     enrichment: a read that fails links what the source knew, and the
 *     alert still opens;
 *   - read only for a match that opens a record: an open one keeps its links.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const HOST_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLOUD_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DATABASE_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const WINDOW: { start: Date; end: Date } = {
  start: new Date("2026-11-03T09:55:00.000Z"),
  end: new Date("2026-11-03T10:00:00.000Z"),
};

const ENTITIES: Array<SecurityEntity> = [
  { type: SecurityEntityType.Host, value: "web-1" },
  { type: SecurityEntityType.IpAddress, value: "10.0.4.1" },
];

function connected(
  kind: SecurityConnectionKind,
  id: string,
  name: string,
  certainty: SecurityConnectionCertainty = SecurityConnectionCertainty.Exact,
): SecurityConnectedRecord {
  return {
    kind,
    id,
    name,
    certainty,
    matches: [
      {
        entity: { type: SecurityEntityType.Host, value: name },
        certainty,
        reason: SecurityConnectionReason.HostName,
        matchedValue: name,
      },
    ],
  };
}

function match(
  fingerprint: string,
  extra: Partial<AlertableMatch> = {},
): AlertableMatch {
  return {
    fingerprint,
    title: `title for ${fingerprint}`,
    description: "what happened",
    rootCause: "the source matched",
    ...extra,
  };
}

function idsOf(list: unknown): Array<string> {
  return ((list as Array<{ id?: ObjectID | null }> | undefined) || []).map(
    (row: { id?: ObjectID | null }): string => {
      return row.id?.toString() || "";
    },
  );
}

let alertFindSpy: Spy;
let alertCreateSpy: Spy;
let incidentFindSpy: Spy;
let incidentCreateSpy: Spy;
let entityLinksSpy: Spy;
let errorSpy: Spy;

beforeEach(() => {
  mockProjectStates();
  alertFindSpy = getJestSpyOn(AlertService, "findBy").mockResolvedValue(
    [] as never,
  );
  alertCreateSpy = getJestSpyOn(AlertService, "create").mockImplementation(
    (async (data: { data: Alert }) => {
      const created: Alert = new Alert(ObjectID.generate());

      if (data.data.seriesFingerprint) {
        created.seriesFingerprint = data.data.seriesFingerprint;
      }

      return created;
    }) as never,
  );
  incidentFindSpy = getJestSpyOn(IncidentService, "findBy").mockResolvedValue(
    [] as never,
  );
  incidentCreateSpy = getJestSpyOn(
    IncidentService,
    "create",
  ).mockImplementation((async () => {
    return new Incident(ObjectID.generate());
  }) as never);
  entityLinksSpy = getJestSpyOn(
    SecurityConnections,
    "readEntityLinks",
  ).mockResolvedValue([
    connected(SecurityConnectionKind.Host, HOST_ID, "web-1"),
    connected(SecurityConnectionKind.NetworkDevice, DEVICE_ID, "edge-fw"),
  ] as never);
  errorSpy = getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function createdAlert(index: number = 0): Alert {
  return (alertCreateSpy.mock.calls[index]![0] as { data: Alert }).data;
}

function createdIncident(index: number = 0): Incident {
  return (incidentCreateSpy.mock.calls[index]![0] as { data: Incident }).data;
}

describe("an alert a detection opens is linked to what its match is about", () => {
  test("the records its entities name exactly, read as OneUptime in the run's window", async () => {
    const created: number = await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "test",
      eventWindow: WINDOW,
      matches: [match("fp-1", { entities: ENTITIES })],
    });

    expect(created).toBe(1);
    expect(entityLinksSpy).toHaveBeenCalledTimes(1);
    expect(entityLinksSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      entities: ENTITIES,
      window: WINDOW,
    });

    const alert: Alert = createdAlert();
    expect(idsOf(alert.hosts)).toEqual([HOST_ID]);
    expect(idsOf(alert.networkDevices)).toEqual([DEVICE_ID]);
    // Nothing else is touched: a security match is never a monitor's.
    expect(alert.monitorId).toBeUndefined();
    expect(alert.kubernetesClusters).toBeUndefined();
    // It is still the detection's alert, created as OneUptime.
    expect(alert.seriesFingerprint).toBe("fp-1");
    expect(alert.isCreatedAutomatically).toBe(true);
    expect(
      (alertCreateSpy.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
  });

  test("what the source knows it comes from, beside what its entities name, each once", async () => {
    entityLinksSpy.mockResolvedValue([
      connected(SecurityConnectionKind.Host, HOST_ID, "web-1"),
      connected(SecurityConnectionKind.CloudResource, CLOUD_ID, "bucket"),
    ] as never);

    await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "test",
      eventWindow: WINDOW,
      matches: [
        match("fp-1", {
          entities: ENTITIES,
          affectedResources: [
            { kind: AiAffectedResourceKind.CloudResource, id: CLOUD_ID },
            { kind: AiAffectedResourceKind.DatabaseServer, id: DATABASE_ID },
          ],
        }),
      ],
    });

    const alert: Alert = createdAlert();
    expect(idsOf(alert.cloudResources)).toEqual([CLOUD_ID]);
    expect(idsOf(alert.databaseServers)).toEqual([DATABASE_ID]);
    expect(idsOf(alert.hosts)).toEqual([HOST_ID]);
  });

  test("a match that names no entity reads nothing, and is linked to what the source knows only", async () => {
    await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "test",
      matches: [
        match("fp-1", {
          affectedResources: [
            { kind: AiAffectedResourceKind.DatabaseServer, id: DATABASE_ID },
          ],
        }),
        match("fp-2"),
      ],
    });

    expect(entityLinksSpy).not.toHaveBeenCalled();
    expect(idsOf(createdAlert(0).databaseServers)).toEqual([DATABASE_ID]);
    // A match about nothing is linked to nothing, as before.
    const bare: Alert = createdAlert(1);
    expect(bare.hosts).toBeUndefined();
    expect(bare.databaseServers).toBeUndefined();
  });

  test("an alert already open for the fingerprint is not read for: it keeps the links it has", async () => {
    const open: Alert = new Alert(ObjectID.generate());
    open.seriesFingerprint = "fp-1";
    alertFindSpy.mockResolvedValue([open] as never);

    await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "test",
      eventWindow: WINDOW,
      matches: [
        match("fp-1", { entities: ENTITIES }),
        match("fp-2", { entities: [ENTITIES[0]!] }),
      ],
    });

    // Read once - for the match that opens one.
    expect(entityLinksSpy).toHaveBeenCalledTimes(1);
    expect(
      (entityLinksSpy.mock.calls[0]![0] as { entities: unknown }).entities,
    ).toEqual([ENTITIES[0]]);
    expect(alertCreateSpy).toHaveBeenCalledTimes(1);
    expect(createdAlert().seriesFingerprint).toBe("fp-2");
  });

  test("what its entities name cannot be read: it opens all the same, linked to what the source knows, and the read is logged", async () => {
    entityLinksSpy.mockRejectedValue(new Error("ClickHouse went away"));

    const created: number = await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "DetectionRuleEvaluator: rule 1",
      eventWindow: WINDOW,
      matches: [
        match("fp-1", {
          entities: ENTITIES,
          affectedResources: [
            { kind: AiAffectedResourceKind.CloudResource, id: CLOUD_ID },
          ],
        }),
      ],
    });

    expect(created).toBe(1);
    expect(idsOf(createdAlert().cloudResources)).toEqual([CLOUD_ID]);
    expect(createdAlert().hosts).toBeUndefined();
    expect(String(errorSpy.mock.calls[0]![0])).toContain(
      "DetectionRuleEvaluator: rule 1: what a match names could not be read",
    );
  });

  test("a possible match is never linked: the reader only hands over exact ones", async () => {
    entityLinksSpy.mockResolvedValue([
      connected(
        SecurityConnectionKind.Host,
        HOST_ID,
        "web-1.staging",
        SecurityConnectionCertainty.Possible,
      ),
    ] as never);

    await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "test",
      eventWindow: WINDOW,
      matches: [match("fp-1", { entities: ENTITIES })],
    });

    expect(createdAlert().hosts).toBeUndefined();
  });

  test("each new alert is read for on its own: two matches, two hosts", async () => {
    const OTHER_HOST_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    entityLinksSpy
      .mockResolvedValueOnce([
        connected(SecurityConnectionKind.Host, HOST_ID, "web-1"),
      ] as never)
      .mockResolvedValueOnce([
        connected(SecurityConnectionKind.Host, OTHER_HOST_ID, "web-2"),
      ] as never);

    await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "test",
      eventWindow: WINDOW,
      matches: [
        match("fp-1", {
          entities: [{ type: SecurityEntityType.Host, value: "web-1" }],
        }),
        match("fp-2", {
          entities: [{ type: SecurityEntityType.Host, value: "web-2" }],
        }),
      ],
    });

    expect(idsOf(createdAlert(0).hosts)).toEqual([HOST_ID]);
    expect(idsOf(createdAlert(1).hosts)).toEqual([OTHER_HOST_ID]);
  });

  test("with no window given, what the entities name is read in the half hour up to now", async () => {
    const before: number = Date.now();

    await openDedupedAlerts({
      projectId: PROJECT_ID,
      alertSeverityId: SEVERITY_ID,
      logLabel: "test",
      matches: [match("fp-1", { entities: ENTITIES })],
    });

    const after: number = Date.now();
    const window: { start: Date; end: Date } = (
      entityLinksSpy.mock.calls[0]![0] as { window: { start: Date; end: Date } }
    ).window;

    expect(window.end.getTime()).toBeGreaterThanOrEqual(before);
    expect(window.end.getTime()).toBeLessThanOrEqual(after);
    expect(window.end.getTime() - window.start.getTime()).toBe(30 * 60 * 1000);
  });
});

describe("an incident a detection declares is linked the same way", () => {
  test("the records its entities name exactly, and what the source knows, in the run's window", async () => {
    const created: number = await openDedupedIncidents({
      projectId: PROJECT_ID,
      incidentSeverityId: SEVERITY_ID,
      logLabel: "test",
      eventWindow: WINDOW,
      matches: [
        match("fp-1", {
          entities: ENTITIES,
          affectedResources: [
            { kind: AiAffectedResourceKind.DatabaseServer, id: DATABASE_ID },
          ],
        }),
      ],
    });

    expect(created).toBe(1);
    expect(entityLinksSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      entities: ENTITIES,
      window: WINDOW,
    });

    const incident: Incident = createdIncident();
    expect(idsOf(incident.databaseServers)).toEqual([DATABASE_ID]);
    expect(idsOf(incident.hosts)).toEqual([HOST_ID]);
    expect(idsOf(incident.networkDevices)).toEqual([DEVICE_ID]);
    // Never a monitor: an incident on a monitor changes its status.
    expect(incident.monitors).toBeUndefined();
  });

  test("an incident already open for the fingerprint reads nothing and declares nothing", async () => {
    const open: Incident = new Incident(ObjectID.generate());
    open.seriesFingerprint = "fp-1";
    incidentFindSpy.mockResolvedValue([open] as never);

    const created: number = await openDedupedIncidents({
      projectId: PROJECT_ID,
      incidentSeverityId: SEVERITY_ID,
      logLabel: "test",
      eventWindow: WINDOW,
      matches: [match("fp-1", { entities: ENTITIES })],
    });

    expect(created).toBe(0);
    expect(entityLinksSpy).not.toHaveBeenCalled();
    expect(incidentCreateSpy).not.toHaveBeenCalled();
  });

  test("a read that fails declares it all the same", async () => {
    entityLinksSpy.mockRejectedValue(new Error("Postgres went away"));

    const created: number = await openDedupedIncidents({
      projectId: PROJECT_ID,
      incidentSeverityId: SEVERITY_ID,
      logLabel: "test",
      eventWindow: WINDOW,
      matches: [match("fp-1", { entities: ENTITIES })],
    });

    expect(created).toBe(1);
    expect(createdIncident().hosts).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("readMatchAffectedResources", () => {
  test("what the source knows first, then what the entities name, each once", async () => {
    entityLinksSpy.mockResolvedValue([
      connected(SecurityConnectionKind.CloudResource, CLOUD_ID, "bucket"),
      connected(SecurityConnectionKind.Host, HOST_ID, "web-1"),
      connected(SecurityConnectionKind.User, DEVICE_ID, "Kim"),
    ] as never);

    const refs: Array<AiAffectedResourceRef> = await readMatchAffectedResources(
      {
        projectId: PROJECT_ID,
        match: match("fp-1", {
          entities: ENTITIES,
          affectedResources: [
            { kind: AiAffectedResourceKind.CloudResource, id: CLOUD_ID },
          ],
        }),
        eventWindow: WINDOW,
        logLabel: "test",
      },
    );

    expect(refs).toEqual([
      { kind: AiAffectedResourceKind.CloudResource, id: CLOUD_ID },
      { kind: AiAffectedResourceKind.Host, id: HOST_ID },
    ]);
  });

  test("never throws: a failing read leaves what the source knows", async () => {
    entityLinksSpy.mockRejectedValue(new Error("boom"));

    await expect(
      readMatchAffectedResources({
        projectId: PROJECT_ID,
        match: match("fp-1", { entities: ENTITIES }),
        logLabel: "test",
      }),
    ).resolves.toEqual([]);
  });
});

describe("the connections are read through the loader", () => {
  test("SecurityEventAlerting imports no connection at load: IncidentService's imports reach it", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../Server/Utils/SecurityEvent/SecurityEventAlerting.ts",
      ),
      "utf-8",
    );

    expect(source).toContain(
      'import { loadSecurityConnections } from "./Connections/ConnectionsLoader";',
    );
    expect(source).not.toContain('from "./Connections/SecurityConnections"');
    expect(source).not.toContain(
      'from "./Connections/SecurityConnectedRecords"',
    );
  });
});
