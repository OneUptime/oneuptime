import "../../TestingUtils/Init";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import LinkedInfrastructureContext, {
  LinkedInfrastructure,
  MAX_LINKED_RESOURCES,
  MAX_RELATED_ALERTS,
  RELATED_ALERTS_LOOKBACK_MINUTES,
  RelatedAlert,
  describeAlertNumber,
  describeOpenedAfterDeclared,
  describeRelativeTime,
} from "../../../../Server/Utils/AI/SRE/LinkedInfrastructureContext";
import {
  AIRunEventResultSummary,
  LinkedInfrastructureActivity,
} from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * THE INCIDENT'S LINKED INFRASTRUCTURE AND ITS ALERTS (issue #4786).
 *
 * The customer's incident came from a synthetic monitor linked to host A;
 * "host A high CPU" opened 3-8 minutes before it, and the investigation
 * never read it. The starting context now names the incident's linked
 * infrastructure with the IDs the tools take, and the alerts on it from the
 * 30 minutes before the incident, or still open.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const HOST_A: string = "33333333-3333-4333-8333-333333333333";
const DOCKER_A: string = "44444444-4444-4444-8444-444444444444";
const OTHER_HOST: string = "55555555-5555-4555-8555-555555555555";
const SERVICE_ID: string = "66666666-6666-4666-8666-666666666666";
const ROUTER_ID: string = "99999999-9999-4999-8999-999999999999";
const OPEN_STATE: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const RESOLVED_STATE: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const MINUTE: number = 60 * 1000;
const DECLARED_AT: Date = new Date("2026-10-16T14:30:00.000Z");

function minutesFromIncident(minutes: number): Date {
  return new Date(DECLARED_AT.getTime() + minutes * MINUTE);
}

function linked(
  type: LinkedAffectedResourceType,
  id: string,
  name: string,
): LinkedAffectedResource {
  return { type, id, name };
}

interface AlertFixture {
  id: string;
  number: number;
  title: string;
  openedMinutesFromIncident: number;
  isOpen: boolean;
  // The relation column it is on, and the ids there.
  column: "hosts" | "dockerHosts" | "services";
  on: Array<string>;
  isPrivate?: boolean;
  rootCause?: string;
}

function toAlert(fixture: AlertFixture): Alert {
  const alert: Alert = new Alert(new ObjectID(fixture.id));
  alert.projectId = PROJECT_ID;
  alert.alertNumber = fixture.number;
  alert.title = fixture.title;
  alert.createdAt = minutesFromIncident(fixture.openedMinutesFromIncident);
  alert.isPrivate = fixture.isPrivate === true;
  alert.currentAlertStateId = fixture.isOpen ? OPEN_STATE : RESOLVED_STATE;
  alert.alertSeverity = { name: "Critical" } as never;
  alert.currentAlertState = {
    name: fixture.isOpen ? "Created" : "Resolved",
  } as never;
  alert.monitor = { name: "web-1 CPU" } as never;

  if (fixture.rootCause) {
    alert.rootCause = fixture.rootCause;
  }

  (alert as unknown as JSONObject)[fixture.column] = fixture.on.map(
    (id: string) => {
      return { _id: id, name: "web-1", projectId: PROJECT_ID };
    },
  );

  return alert;
}

function alertId(index: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`;
}

let alertReads: Array<FindBy<Alert>>;
let fixtures: Array<AlertFixture>;
let resources: Array<LinkedAffectedResource>;
let findAlerts: SpyInstance<typeof AlertService.findBy>;

/*
 * AlertService.findBy, answered from the fixtures the way the query asks:
 * by relation column, then "opened since the window start" or "opened
 * before it and still open".
 */
function answerAlertReads(): void {
  findAlerts = jest
    .spyOn(AlertService, "findBy")
    .mockImplementation(
      async (findBy: FindBy<Alert>): Promise<Array<Alert>> => {
        alertReads.push(findBy);
        const query: JSONObject = findBy.query as unknown as JSONObject;
        const column: string | undefined = (
          ["hosts", "dockerHosts", "services"] as Array<string>
        ).find((candidate: string): boolean => {
          return query[candidate] !== undefined;
        });
        const isOpenRead: boolean = query["currentAlertStateId"] !== undefined;
        const windowStart: Date = new Date(
          DECLARED_AT.getTime() - RELATED_ALERTS_LOOKBACK_MINUTES * MINUTE,
        );

        return fixtures
          .filter((fixture: AlertFixture): boolean => {
            const openedAt: Date = minutesFromIncident(
              fixture.openedMinutesFromIncident,
            );

            return (
              fixture.column === column &&
              (isOpenRead
                ? fixture.isOpen && openedAt.getTime() < windowStart.getTime()
                : openedAt.getTime() >= windowStart.getTime())
            );
          })
          .sort((a: AlertFixture, b: AlertFixture): number => {
            return b.openedMinutesFromIncident - a.openedMinutesFromIncident;
          })
          .slice(0, findBy.limit as number)
          .map(toAlert);
      },
    );
}

beforeEach(() => {
  alertReads = [];
  fixtures = [];
  resources = [
    linked(LinkedAffectedResourceType.Monitor, OTHER_HOST, "Shop synthetic"),
    linked(LinkedAffectedResourceType.DockerHost, DOCKER_A, "web-1"),
    linked(LinkedAffectedResourceType.Host, HOST_A, "web-1"),
  ];
  jest
    .spyOn(IncidentService, "findOneBy")
    .mockImplementation(async (): Promise<Incident | null> => {
      const incident: Incident = new Incident(INCIDENT_ID);
      incident.createdAt = DECLARED_AT;
      return incident;
    });
  jest
    .spyOn(LinkedAffectedResources, "readForIncident")
    .mockImplementation(async (): Promise<Array<LinkedAffectedResource>> => {
      return resources;
    });
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([OPEN_STATE]);
  answerAlertReads();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function readIncident(): Promise<LinkedInfrastructure> {
  const result: LinkedInfrastructure | null =
    await LinkedInfrastructureContext.readForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

  if (!result) {
    throw new Error("Nothing read");
  }

  return result;
}

describe("which resources", () => {
  test("only infrastructure, in display order: a monitor is not infrastructure", async () => {
    const result: LinkedInfrastructure = await readIncident();

    expect(result.resources).toEqual([
      { type: LinkedAffectedResourceType.Host, id: HOST_A, name: "web-1" },
      {
        type: LinkedAffectedResourceType.DockerHost,
        id: DOCKER_A,
        name: "web-1",
      },
    ]);
  });

  test("services count; SLOs and network sites do not", () => {
    expect(
      LinkedInfrastructureContext.keepInfrastructure([
        linked(
          LinkedAffectedResourceType.ServiceLevelObjective,
          OTHER_HOST,
          "Checkout SLO",
        ),
        linked(LinkedAffectedResourceType.NetworkSite, OTHER_HOST, "Berlin"),
        linked(LinkedAffectedResourceType.Service, SERVICE_ID, "checkout-api"),
      ]),
    ).toEqual([
      {
        type: LinkedAffectedResourceType.Service,
        id: SERVICE_ID,
        name: "checkout-api",
      },
    ]);
  });

  /*
   * Issue #5341: an incident on a router is about the router, and its
   * investigation reads the alerts on it as it reads a host's.
   */
  test("a network device is infrastructure, right after the hosts", () => {
    expect(
      LinkedInfrastructureContext.keepInfrastructure([
        linked(LinkedAffectedResourceType.Service, SERVICE_ID, "checkout-api"),
        linked(
          LinkedAffectedResourceType.NetworkDevice,
          ROUTER_ID,
          "WAN-RTR-01",
        ),
        linked(LinkedAffectedResourceType.Host, HOST_A, "web-1"),
      ]).map((resource: LinkedAffectedResource): string => {
        return resource.type;
      }),
    ).toEqual([
      LinkedAffectedResourceType.Host,
      LinkedAffectedResourceType.NetworkDevice,
      LinkedAffectedResourceType.Service,
    ]);
  });

  test("a router's alerts are read through the alert's network devices, and the router is named with the id the tools take", async () => {
    resources = [
      linked(LinkedAffectedResourceType.NetworkDevice, ROUTER_ID, "WAN-RTR-01"),
    ];

    const result: LinkedInfrastructure = await readIncident();

    expect(result.resources).toEqual([
      {
        type: LinkedAffectedResourceType.NetworkDevice,
        id: ROUTER_ID,
        name: "WAN-RTR-01",
      },
    ]);
    expect(alertReads).toHaveLength(2);

    for (const read of alertReads) {
      const query: JSONObject = read.query as unknown as JSONObject;

      expect(
        (query["networkDevices"] as Array<ObjectID>).map(
          (id: ObjectID): string => {
            return id.toString();
          },
        ),
      ).toEqual([ROUTER_ID]);
      expect(query["projectId"]).toBe(PROJECT_ID);
    }

    expect(LinkedInfrastructureContext.buildContextSection(result)).toContain(
      `- Network device "WAN-RTR-01" (resourceType: NetworkDevice, resourceId: ${ROUTER_ID})`,
    );
  });

  test(`at most ${MAX_LINKED_RESOURCES} resources`, () => {
    const many: Array<LinkedAffectedResource> = [];

    for (let index: number = 0; index < 15; index++) {
      many.push(
        linked(
          LinkedAffectedResourceType.Host,
          `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
          `host-${index}`,
        ),
      );
    }

    expect(LinkedInfrastructureContext.keepInfrastructure(many)).toHaveLength(
      MAX_LINKED_RESOURCES,
    );
  });

  test("no linked infrastructure: no alert is read and the context gets no section", async () => {
    resources = [
      linked(LinkedAffectedResourceType.Monitor, OTHER_HOST, "Shop synthetic"),
    ];

    const result: LinkedInfrastructure = await readIncident();

    expect(result.resources).toEqual([]);
    expect(findAlerts).not.toHaveBeenCalled();
    expect(LinkedInfrastructureContext.buildContextSection(result)).toBe("");
    expect(LinkedInfrastructureContext.buildActivityNote(result)).toBeNull();
  });

  test("an incident that cannot be read reads nothing", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);

    expect(
      await LinkedInfrastructureContext.readForIncident({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toBeNull();
    expect(findAlerts).not.toHaveBeenCalled();
  });
});

describe("which alerts", () => {
  test("two reads per kind of resource, held to the project, its linked ids and the window", async () => {
    await readIncident();

    // Hosts and Docker hosts: recent, then still open from before.
    expect(alertReads).toHaveLength(4);

    const windowStart: Date = minutesFromIncident(
      -RELATED_ALERTS_LOOKBACK_MINUTES,
    );

    for (const read of alertReads) {
      const query: JSONObject = read.query as unknown as JSONObject;

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(read.props).toEqual({ isRoot: true });
      expect(read.limit).toBe(MAX_RELATED_ALERTS + 1);
      expect(read.sort).toEqual({ createdAt: "DESC" });
    }

    const hostReads: Array<JSONObject> = alertReads
      .map((read: FindBy<Alert>): JSONObject => {
        return read.query as unknown as JSONObject;
      })
      .filter((query: JSONObject): boolean => {
        return query["hosts"] !== undefined;
      });

    expect(hostReads).toHaveLength(2);
    expect(
      (hostReads[0]!["hosts"] as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([HOST_A]);
    expect(JSON.stringify(hostReads[0]!["createdAt"])).toContain(
      windowStart.toISOString().slice(0, 19),
    );
    expect(hostReads[1]!["currentAlertStateId"]).toBeDefined();
  });

  test("the customer's case: the host's CPU alert from before the incident, and one from after", async () => {
    fixtures = [
      {
        id: alertId(1),
        number: 41,
        title: "[Host] High CPU Utilization (>80%) - web-1",
        openedMinutesFromIncident: -5,
        isOpen: true,
        column: "hosts",
        on: [HOST_A],
        rootCause: "CPU busy (user + system) was 97.4% for 5 minutes.",
      },
      {
        id: alertId(2),
        number: 42,
        title: "[Docker] Container shop-api restarted",
        openedMinutesFromIncident: 3,
        isOpen: false,
        column: "dockerHosts",
        on: [DOCKER_A],
      },
    ];

    const result: LinkedInfrastructure = await readIncident();

    expect(
      result.alerts.map((alert: RelatedAlert): number | undefined => {
        return alert.alertNumber;
      }),
    ).toEqual([42, 41]);
    expect(result.alerts[1]!.isOpen).toBe(true);
    expect(result.alerts[1]!.resources).toEqual([
      { type: LinkedAffectedResourceType.Host, id: HOST_A, name: "web-1" },
    ]);
    expect(result.alerts[0]!.isOpen).toBe(false);
    expect(result.hasMoreAlerts).toBe(false);

    const section: string =
      LinkedInfrastructureContext.buildContextSection(result);

    expect(section).toContain("# Linked infrastructure");
    expect(section).toContain(
      `- Host "web-1" (resourceType: Host, resourceId: ${HOST_A})`,
    );
    expect(section).toContain(
      `- Docker host "web-1" (resourceType: DockerHost, resourceId: ${DOCKER_A}; query_containers lists its containers)`,
    );
    expect(section).toContain(
      `Alerts on these resources that opened from ${minutesFromIncident(-30).toISOString()} (30 minutes before this incident) to now, or are still open, newest first:`,
    );
    expect(section).toContain(
      `- Alert #41 "[Host] High CPU Utilization (>80%) - web-1" on Host "web-1": Critical, still open (Created), opened ${minutesFromIncident(-5).toISOString()} (5 minutes before this incident), monitor "web-1 CPU". Root cause recorded: CPU busy (user + system) was 97.4% for 5 minutes.`,
    );
    expect(section).toContain(
      `- Alert #42 "[Docker] Container shop-api restarted" on Docker host "web-1": Critical, resolved (Resolved), opened ${minutesFromIncident(3).toISOString()} (3 minutes after this incident)`,
    );
    expect(section).toContain("read these alerts first");
    expect(section).toContain("read them per state, never as one average");
  });

  test("an alert from before the window counts only while still open", async () => {
    fixtures = [
      {
        id: alertId(1),
        number: 1,
        title: "Disk 95% full on web-1",
        openedMinutesFromIncident: -600,
        isOpen: true,
        column: "hosts",
        on: [HOST_A],
      },
      {
        id: alertId(2),
        number: 2,
        title: "Disk 90% full on web-1",
        openedMinutesFromIncident: -700,
        isOpen: false,
        column: "hosts",
        on: [HOST_A],
      },
    ];

    const result: LinkedInfrastructure = await readIncident();

    expect(
      result.alerts.map((alert: RelatedAlert): number | undefined => {
        return alert.alertNumber;
      }),
    ).toEqual([1]);
  });

  test("a private alert is never listed: its title would reach the report", async () => {
    fixtures = [
      {
        id: alertId(1),
        number: 7,
        title: "Payroll export failed",
        openedMinutesFromIncident: -2,
        isOpen: true,
        column: "hosts",
        on: [HOST_A],
        isPrivate: true,
      },
    ];

    const result: LinkedInfrastructure = await readIncident();

    expect(result.alerts).toEqual([]);
    expect(
      LinkedInfrastructureContext.buildContextSection(result),
    ).not.toContain("Payroll");
  });

  test("an alert on two linked resources is listed once, on both", async () => {
    fixtures = [
      {
        id: alertId(1),
        number: 9,
        title: "web-1 unreachable",
        openedMinutesFromIncident: -1,
        isOpen: true,
        column: "hosts",
        on: [HOST_A],
      },
      {
        id: alertId(1),
        number: 9,
        title: "web-1 unreachable",
        openedMinutesFromIncident: -1,
        isOpen: true,
        column: "dockerHosts",
        on: [DOCKER_A],
      },
    ];

    const result: LinkedInfrastructure = await readIncident();

    expect(result.alerts).toHaveLength(1);
    expect(
      result.alerts[0]!.resources.map(
        (resource: { type: LinkedAffectedResourceType }) => {
          return resource.type;
        },
      ),
    ).toEqual([
      LinkedAffectedResourceType.Host,
      LinkedAffectedResourceType.DockerHost,
    ]);
  });

  test(`at most ${MAX_RELATED_ALERTS} alerts, the newest, and the context says there were more`, async () => {
    for (let index: number = 0; index < 14; index++) {
      fixtures.push({
        id: alertId(index),
        number: index,
        title: `Alert ${index}`,
        openedMinutesFromIncident: -index,
        isOpen: true,
        column: "hosts",
        on: [HOST_A],
      });
    }

    const result: LinkedInfrastructure = await readIncident();

    expect(result.alerts).toHaveLength(MAX_RELATED_ALERTS);
    expect(result.alerts[0]!.alertNumber).toBe(0);
    expect(result.hasMoreAlerts).toBe(true);
    expect(LinkedInfrastructureContext.buildContextSection(result)).toContain(
      `(more alerts matched than the ${MAX_RELATED_ALERTS} listed; query_alerts lists the rest)`,
    );
  });

  test("no alert: the context says so - that is evidence too", async () => {
    const result: LinkedInfrastructure = await readIncident();

    expect(LinkedInfrastructureContext.buildContextSection(result)).toContain(
      `No alert on these resources opened from ${minutesFromIncident(-30).toISOString()} (30 minutes before this incident) to now, and none of them has an alert still open.`,
    );
  });

  test("an alert's investigation never lists the alert itself", async () => {
    const SUBJECT: string = alertId(5);

    jest
      .spyOn(AlertService, "findOneBy")
      .mockImplementation(async (): Promise<Alert | null> => {
        const alert: Alert = new Alert(new ObjectID(SUBJECT));
        alert.createdAt = DECLARED_AT;
        return alert;
      });
    jest
      .spyOn(LinkedAffectedResources, "readForAlert")
      .mockResolvedValue([
        linked(LinkedAffectedResourceType.Host, HOST_A, "web-1"),
      ]);
    fixtures = [
      {
        id: SUBJECT,
        number: 5,
        title: "The subject",
        openedMinutesFromIncident: 0,
        isOpen: true,
        column: "hosts",
        on: [HOST_A],
      },
      {
        id: alertId(6),
        number: 6,
        title: "Another alert on web-1",
        openedMinutesFromIncident: -1,
        isOpen: true,
        column: "hosts",
        on: [HOST_A],
      },
    ];

    const result: LinkedInfrastructure | null =
      await LinkedInfrastructureContext.readForAlert({
        projectId: PROJECT_ID,
        alertId: new ObjectID(SUBJECT),
      });

    expect(
      result!.alerts.map((alert: RelatedAlert): number | undefined => {
        return alert.alertNumber;
      }),
    ).toEqual([6]);
    expect(LinkedInfrastructureContext.buildContextSection(result)).toContain(
      "minutes before this alert",
    );
  });
});

describe("never another project's", () => {
  test("a related row of another project is dropped before anything is read for it", () => {
    const records: Array<JSONObject> = [
      {
        projectId: PROJECT_ID,
        hosts: [
          { _id: HOST_A, name: "web-1", projectId: PROJECT_ID },
          {
            _id: OTHER_HOST,
            name: "their-host",
            projectId: new ObjectID("99999999-9999-4999-8999-999999999999"),
          },
        ],
      },
    ];

    expect(
      LinkedInfrastructureContext.keepInfrastructure(
        LinkedAffectedResources.collect({
          projectId: PROJECT_ID,
          records,
        }),
      ),
    ).toEqual([
      { type: LinkedAffectedResourceType.Host, id: HOST_A, name: "web-1" },
    ]);
  });
});

describe("what people see in the run's activity", () => {
  test("the resources and how many open or recent alerts were on them", async () => {
    fixtures = [
      {
        id: alertId(1),
        number: 41,
        title: "High CPU",
        openedMinutesFromIncident: -5,
        isOpen: true,
        column: "hosts",
        on: [HOST_A],
      },
      {
        id: alertId(2),
        number: 42,
        title: "Restarted",
        openedMinutesFromIncident: 3,
        isOpen: false,
        column: "dockerHosts",
        on: [DOCKER_A],
      },
    ];

    const note: AIRunEventResultSummary | null =
      LinkedInfrastructureContext.buildActivityNote(await readIncident());
    const activity: LinkedInfrastructureActivity = note!.linkedInfrastructure!;

    expect(activity).toEqual({
      resources: [
        { kind: "Host", name: "web-1" },
        { kind: "DockerHost", name: "web-1" },
      ],
      alertCount: 2,
      openAlertCount: 1,
      hasMoreAlerts: false,
      lookbackMinutes: 30,
    });
    expect(note!.message).toBe(
      "Read 2 open or recent alerts on Host web-1 and Docker host web-1",
    );
    expect(note!.severity).toBe("Info");
  });

  test("its English line, for none, one, many and more resources than it names", () => {
    const base: LinkedInfrastructureActivity = {
      resources: [{ kind: "Host", name: "web-1" }],
      alertCount: 0,
      openAlertCount: 0,
      hasMoreAlerts: false,
      lookbackMinutes: 30,
    };

    expect(LinkedInfrastructureContext.describeActivity(base)).toBe(
      "No open or recent alerts on Host web-1",
    );
    expect(
      LinkedInfrastructureContext.describeActivity({ ...base, alertCount: 1 }),
    ).toBe("Read 1 open or recent alert on Host web-1");
    expect(
      LinkedInfrastructureContext.describeActivity({
        ...base,
        alertCount: 10,
        hasMoreAlerts: true,
      }),
    ).toBe("Read the 10 newest open or recent alerts on Host web-1");
    expect(
      LinkedInfrastructureContext.describeActivity({
        ...base,
        resources: [
          { kind: "Host", name: "a" },
          { kind: "Host", name: "b" },
          { kind: "KubernetesCluster", name: "prod" },
          { kind: "Service", name: "api" },
          { kind: "DatabaseServer", name: "orders" },
        ],
      }),
    ).toBe(
      "No open or recent alerts on Host a, Host b, Kubernetes cluster prod and 2 more",
    );
    expect(
      LinkedInfrastructureContext.describeActivity({
        ...base,
        resources: [
          { kind: "Host", name: "a" },
          { kind: "DockerHost", name: "b" },
          { kind: "KubernetesCluster", name: "c" },
        ],
      }),
    ).toBe(
      "No open or recent alerts on Host a, Docker host b and Kubernetes cluster c",
    );
  });
});

describe("the words for times and numbers", () => {
  test("before, after and within a minute of the subject", () => {
    expect(
      describeRelativeTime({
        time: minutesFromIncident(-5),
        subjectCreatedAt: DECLARED_AT,
        subjectKind: "incident",
      }),
    ).toBe("5 minutes before this incident");
    expect(
      describeRelativeTime({
        time: minutesFromIncident(1),
        subjectCreatedAt: DECLARED_AT,
        subjectKind: "alert",
      }),
    ).toBe("1 minute after this alert");
    expect(
      describeRelativeTime({
        time: new Date(DECLARED_AT.getTime() + 20 * 1000),
        subjectCreatedAt: DECLARED_AT,
        subjectKind: "incident",
      }),
    ).toBe("within a minute of this incident");
    expect(
      describeOpenedAfterDeclared({
        openedAt: minutesFromIncident(3),
        incidentCreatedAt: DECLARED_AT,
      }),
    ).toBe("3 minutes after this incident was declared");
    expect(
      describeOpenedAfterDeclared({
        openedAt: DECLARED_AT,
        incidentCreatedAt: DECLARED_AT,
      }),
    ).toBe("within a minute of this incident being declared");
  });

  test("an alert's number, with its prefix when it has one", () => {
    expect(describeAlertNumber({ alertNumber: 12 })).toBe("Alert #12");
    expect(
      describeAlertNumber({ alertNumber: 12 }, { midSentence: true }),
    ).toBe("alert #12");
    expect(
      describeAlertNumber({ alertNumber: 12, alertNumberWithPrefix: "ALT-12" }),
    ).toBe("Alert ALT-12");
    expect(describeAlertNumber({})).toBe("An alert");
  });
});
