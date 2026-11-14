import "../../TestingUtils/Init";
import AIMemory, {
  PAST_RESOLVED_ALERTS_HEADING,
  PAST_RESOLVED_INCIDENTS_HEADING,
} from "../../../../Server/Utils/AI/SRE/AIMemory";
import ServiceKnowledge, {
  NamedService,
  SERVICE_KNOWLEDGE_HEADING,
} from "../../../../Server/Utils/AI/SRE/ServiceKnowledge";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import logger from "../../../../Server/Utils/Logger";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Service from "../../../../Models/DatabaseModels/Service";
import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import AIRunType from "../../../../Types/AI/AIRunType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Contract under test - recall by meaning (issue #6798): what an
 * investigation remembers of the project's past incidents and alerts when
 * they share no monitor or label with the one being investigated.
 *
 *  - a past case whose words say the same thing happened is recalled - a
 *    "503" incident recalls a "5xx, connection pool exhausted" one on
 *    another monitor - and says what it has in common ("Matched on");
 *  - one about something else is not, and a case that shares something
 *    (a monitor, a service, a label) still ranks above one that only reads
 *    alike;
 *  - when nothing matches at all, an incident's investigation still lists
 *    the most recent resolved incidents, and says nothing in them matched;
 *  - OneUptime AI's analysis of a case counts as its cause when a person
 *    confirmed it and no cause was recorded - read only for those, never
 *    for a private case, and never a rejected one;
 *  - what is known about the subject's services follows the past cases.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000001",
);
const CURRENT_INCIDENT: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000002",
);
const CURRENT_ALERT: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000003",
);
const RESOLVED_STATE: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000004",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000005",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000006",
);
const CHECKOUT: NamedService = {
  id: "0193c0de-dddd-4aaa-8bbb-0000000000aa",
  name: "checkout",
};

function recordId(index: number): string {
  return `0193c0de-dddd-4aaa-8bbb-0000000002${String(index).padStart(2, "0")}`;
}

function service(named: NamedService): Service {
  const row: Service = new Service(new ObjectID(named.id));
  row.name = named.name;
  return row;
}

function pastIncident(data: {
  index: number;
  title: string;
  rootCause?: string | undefined;
  monitor?: string | undefined;
  labels?: Array<string> | undefined;
  services?: Array<NamedService> | undefined;
  isPrivate?: boolean | undefined;
}): Incident {
  const incident: Incident = new Incident(new ObjectID(recordId(data.index)));
  incident.projectId = PROJECT_ID;
  incident.incidentNumber = 200 + data.index;
  incident.title = data.title;
  if (data.rootCause !== undefined) {
    incident.rootCause = data.rootCause;
  }
  incident.createdAt = new Date(
    Date.parse("2026-10-20T10:00:00.000Z") - data.index * 60 * 60 * 1000,
  );
  incident.isPrivate = data.isPrivate === true;
  incident.monitors = data.monitor
    ? [Object.assign(new Monitor(), { name: data.monitor })]
    : [];
  incident.labels = (data.labels || []).map((name: string): Label => {
    return Object.assign(new Label(), { name });
  });
  incident.services = (data.services || []).map(service);
  return incident;
}

function confirmedRun(data: {
  incident?: number | undefined;
  alert?: number | undefined;
  tldr: string;
}): AIRun {
  const run: AIRun = new AIRun(ObjectID.generate());
  if (data.incident !== undefined) {
    run.triggeredByIncidentId = new ObjectID(recordId(data.incident));
  }
  if (data.alert !== undefined) {
    run.triggeredByAlertId = new ObjectID(recordId(data.alert));
  }
  run.analysisTldr = data.tldr;
  run.humanVerdict = AIRunHumanVerdict.Confirmed;
  return run;
}

// The ids a QueryHelper.any filter matches: its one parameter's values.
function anyValues(operator: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    ((operator as { objectLiteralParameters?: Record<string, unknown> })
      .objectLiteralParameters as Record<string, unknown>) || {};

  return (Object.values(parameters)[0] as Array<string>) || [];
}

let candidates: Array<Incident>;
let runs: Array<AIRun>;
let runReads: Array<FindBy<AIRun>>;
let services: Array<NamedService>;
let knowledgeSection: string;
let readRuns: SpyInstance<typeof AIRunService.findBy>;
let knowledge: SpyInstance<typeof ServiceKnowledge.getContextSection>;

beforeEach(() => {
  candidates = [];
  runs = [];
  runReads = [];
  services = [];
  knowledgeSection = "";

  jest
    .spyOn(IncidentStateService, "getResolvedIncidentStateIds")
    .mockResolvedValue([RESOLVED_STATE]);
  jest.spyOn(IncidentService, "findBy").mockImplementation(async () => {
    return candidates;
  });
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([]);
  readRuns = jest
    .spyOn(AIRunService, "findBy")
    .mockImplementation(
      async (findBy: FindBy<AIRun>): Promise<Array<AIRun>> => {
        runReads.push(findBy);
        return runs;
      },
    );
  jest
    .spyOn(ServiceKnowledge, "readServicesOfIncident")
    .mockImplementation(async (): Promise<Array<NamedService>> => {
      return services;
    });
  jest
    .spyOn(ServiceKnowledge, "readServicesOfAlert")
    .mockImplementation(async (): Promise<Array<NamedService>> => {
      return services;
    });
  knowledge = jest
    .spyOn(ServiceKnowledge, "getContextSection")
    .mockImplementation(async (): Promise<string> => {
      return knowledgeSection;
    });
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function rememberIncident(
  data: {
    title?: string | undefined;
    description?: string | undefined;
    monitorNames?: Array<string> | undefined;
    labelNames?: Array<string> | undefined;
  } = {},
): Promise<string> {
  return await AIMemory.getPriorSimilarIncidentsContext({
    projectId: PROJECT_ID,
    currentIncidentId: CURRENT_INCIDENT,
    monitorNames: data.monitorNames || [],
    labelNames: data.labelNames || [],
    title: data.title,
    description: data.description,
  });
}

// One past case's block: from its title line to the next case.
function block(markdown: string, title: string): string {
  const start: number = markdown.indexOf(title);

  if (start < 0) {
    return "";
  }

  const next: number = markdown.indexOf("\n- **", start + 1);
  return markdown.slice(start, next < 0 ? undefined : next);
}

describe("an incident's past, recalled by meaning", () => {
  test("a past incident that shares nothing but reads alike is recalled, and says why", async () => {
    candidates = [
      pastIncident({
        index: 1,
        title: "Disk full on db-4",
        rootCause: "Logs filled the volume",
        monitor: "db-4 disk",
      }),
      pastIncident({
        index: 2,
        title: "Payments returning 5xx",
        rootCause:
          "The database connection pool was exhausted after the deploy doubled the workers",
        monitor: "payments-api",
      }),
    ];

    const markdown: string = await rememberIncident({
      title: "Checkout API returning 503 errors",
      description: "Requests time out; postgres reports too many connections",
      monitorNames: ["checkout-api"],
    });

    expect(
      markdown.startsWith(`\n\n${PAST_RESOLVED_INCIDENTS_HEADING}\n`),
    ).toBe(true);
    expect(markdown).toContain("**#202 — Payments returning 5xx**");
    expect(block(markdown, "#202")).toMatch(
      /Matched on: what happened reads alike \(.*server errors \(5xx\).*\)/,
    );
    expect(block(markdown, "#202")).toContain("connection pool exhausted");
    // Something else entirely: not a recurrence, and not listed.
    expect(markdown).not.toContain("#201");
    expect(markdown).not.toContain("Nothing in it matched");
  });

  test("a shared monitor ranks above a match by meaning alone", async () => {
    candidates = [
      pastIncident({
        index: 1,
        title: "Checkout 503s",
        rootCause: "Connection pool exhausted",
        monitor: "other-monitor",
      }),
      pastIncident({
        index: 2,
        title: "Checkout slow",
        rootCause: "A noisy neighbour on the node",
        monitor: "checkout-api",
      }),
    ];

    const markdown: string = await rememberIncident({
      title: "Checkout returning 503",
      monitorNames: ["checkout-api"],
    });

    expect(markdown.indexOf("#202")).toBeLessThan(markdown.indexOf("#201"));
    expect(block(markdown, "#202")).toContain(
      "Matched on: the same monitor (checkout-api)",
    );
  });

  test("among cases that share the same, the one that reads alike comes first", async () => {
    candidates = [
      pastIncident({
        index: 1,
        title: "Checkout slow",
        rootCause: "A noisy neighbour on the node",
        monitor: "checkout-api",
      }),
      pastIncident({
        index: 2,
        title: "Checkout 503s",
        rootCause: "The connection pool was exhausted",
        monitor: "checkout-api",
      }),
    ];

    const markdown: string = await rememberIncident({
      title: "Checkout returning 503 errors",
      description: "too many connections",
      monitorNames: ["checkout-api"],
    });

    // The older one reads alike: it comes first all the same.
    expect(markdown.indexOf("#202")).toBeLessThan(markdown.indexOf("#201"));
  });

  test("a shared service counts like a shared monitor, and is named", async () => {
    services = [CHECKOUT];
    candidates = [
      pastIncident({
        index: 1,
        title: "Something unrelated",
        rootCause: "A cron ran twice",
        services: [CHECKOUT],
      }),
    ];

    const markdown: string = await rememberIncident({ title: "Disk full" });

    expect(block(markdown, "#201")).toContain(
      "Matched on: the same service (checkout)",
    );
  });

  test("a shared label is named too", async () => {
    candidates = [
      pastIncident({
        index: 1,
        title: "Something unrelated",
        rootCause: "A cron ran twice",
        labels: ["Payments"],
      }),
    ];

    const markdown: string = await rememberIncident({
      title: "Disk full",
      labelNames: ["payments"],
    });

    expect(block(markdown, "#201")).toContain(
      "Matched on: a shared label (Payments)",
    );
  });

  test("when nothing matches, the latest are listed, and say nothing in them matched", async () => {
    candidates = [
      pastIncident({
        index: 1,
        title: "Disk full on db-4",
        rootCause: "Logs filled the volume",
      }),
    ];

    const markdown: string = await rememberIncident({
      title: "Login page shows a blank screen",
    });

    expect(markdown).toContain("**#201 — Disk full on db-4**");
    expect(block(markdown, "#201")).toContain(
      "Nothing in it matched this incident: it is one of the project's most recent resolved incidents.",
    );
    expect(block(markdown, "#201")).not.toContain("Matched on:");
  });
});

describe("what a person confirmed is remembered", () => {
  test("a confirmed analysis is the cause of an incident with none recorded", async () => {
    candidates = [
      pastIncident({ index: 1, title: "Checkout 503s", monitor: "checkout" }),
    ];
    runs = [
      confirmedRun({
        incident: 1,
        tldr: "The connection pool was exhausted by a retry storm.",
      }),
    ];

    const markdown: string = await rememberIncident({
      monitorNames: ["checkout"],
    });

    expect(block(markdown, "#201")).toContain(
      "Previously resolved. Root cause (OneUptime AI's analysis, confirmed by your team): The connection pool was exhausted by a retry storm.",
    );
  });

  test("only confirmed investigations of the incidents with no cause recorded are read, in the project", async () => {
    candidates = [
      pastIncident({
        index: 1,
        title: "Has a cause",
        rootCause: "A bad deploy",
        monitor: "checkout",
      }),
      pastIncident({ index: 2, title: "No cause", monitor: "checkout" }),
    ];

    await rememberIncident({ monitorNames: ["checkout"] });

    expect(runReads).toHaveLength(1);

    const query: JSONObject = runReads[0]!.query as unknown as JSONObject;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["humanVerdict"]).toBe(AIRunHumanVerdict.Confirmed);
    expect(query["runType"]).toBe(AIRunType.Investigation);
    expect(query["analysisTldr"]).toBeDefined();
    expect(anyValues(query["triggeredByIncidentId"])).toEqual([recordId(2)]);
  });

  test("an incident with neither a cause nor a confirmed analysis is not remembered", async () => {
    candidates = [
      pastIncident({ index: 1, title: "No cause", monitor: "checkout" }),
    ];

    expect(await rememberIncident({ monitorNames: ["checkout"] })).toBe("");
  });

  test("no analysis is read when every incident has a cause, nor for a private one", async () => {
    candidates = [
      pastIncident({
        index: 1,
        title: "Has a cause",
        rootCause: "A bad deploy",
        monitor: "checkout",
      }),
      pastIncident({
        index: 2,
        title: "Private, no cause",
        monitor: "checkout",
        isPrivate: true,
      }),
    ];

    await rememberIncident({ monitorNames: ["checkout"] });

    expect(readRuns).not.toHaveBeenCalled();
  });

  test("the newest confirmed analysis speaks for its incident; a failed read leaves the rest", async () => {
    candidates = [
      pastIncident({ index: 1, title: "Checkout 503s", monitor: "checkout" }),
    ];
    runs = [
      confirmedRun({ incident: 1, tldr: "The newest analysis." }),
      confirmedRun({ incident: 1, tldr: "An older analysis." }),
    ];

    const markdown: string = await rememberIncident({
      monitorNames: ["checkout"],
    });

    expect(markdown).toContain("The newest analysis.");
    expect(markdown).not.toContain("An older analysis.");

    readRuns.mockRejectedValue(new Error("database down"));
    candidates = [
      pastIncident({
        index: 2,
        title: "Has a cause",
        rootCause: "A bad deploy",
        monitor: "checkout",
      }),
      pastIncident({ index: 3, title: "No cause", monitor: "checkout" }),
    ];

    const after: string = await rememberIncident({
      monitorNames: ["checkout"],
    });

    expect(after).toContain("#202");
    expect(after).not.toContain("#203");
  });
});

describe("what is known about the incident's services", () => {
  test("follows the past incidents, read for the incident's own services and leaving it out", async () => {
    services = [CHECKOUT];
    knowledgeSection = `\n\n${SERVICE_KNOWLEDGE_HEADING}\nchecked`;
    candidates = [
      pastIncident({
        index: 1,
        title: "Checkout 503s",
        rootCause: "A bad deploy",
        services: [CHECKOUT],
      }),
    ];

    const markdown: string = await rememberIncident({ title: "Checkout 503" });

    expect(markdown.indexOf(PAST_RESOLVED_INCIDENTS_HEADING)).toBeLessThan(
      markdown.indexOf(SERVICE_KNOWLEDGE_HEADING),
    );
    expect(knowledge).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      services: [CHECKOUT],
      excludeIncidentId: CURRENT_INCIDENT,
    });
  });

  test("stands alone when no past incident is worth listing", async () => {
    services = [CHECKOUT];
    knowledgeSection = `\n\n${SERVICE_KNOWLEDGE_HEADING}\nchecked`;

    expect(await rememberIncident({ title: "Checkout 503" })).toBe(
      knowledgeSection,
    );
  });
});

describe("an alert's past, recalled by meaning", () => {
  let current: Alert;
  let recent: Array<Alert>;
  let sameMonitor: Array<Alert>;

  function pastAlert(data: {
    index: number;
    title: string;
    rootCause?: string | undefined;
    monitorId?: ObjectID | undefined;
    services?: Array<NamedService> | undefined;
  }): Alert {
    const alert: Alert = new Alert(new ObjectID(recordId(data.index)));
    alert.projectId = PROJECT_ID;
    alert.alertNumber = 400 + data.index;
    alert.title = data.title;
    if (data.rootCause !== undefined) {
      alert.rootCause = data.rootCause;
    }
    alert.createdAt = new Date(
      Date.parse("2026-11-01T10:00:00.000Z") - data.index * 60 * 60 * 1000,
    );
    alert.isPrivate = false;
    if (data.monitorId) {
      alert.monitorId = data.monitorId;
    }
    alert.labels = [];
    alert.services = (data.services || []).map(service);
    return alert;
  }

  beforeEach(() => {
    recent = [];
    sameMonitor = [];
    current = pastAlert({
      index: 0,
      title: "Checkout returns 503",
      monitorId: MONITOR_ID,
    });
    current.id = CURRENT_ALERT;
    current.description = "Requests to checkout fail with service unavailable";

    jest.spyOn(AlertService, "findOneBy").mockImplementation(async () => {
      return current;
    });
    jest
      .spyOn(AlertStateService, "getResolvedAlertStateIds")
      .mockResolvedValue([RESOLVED_STATE]);
    jest
      .spyOn(AlertService, "findBy")
      .mockImplementation(async (findBy: FindBy<Alert>) => {
        const query: JSONObject = findBy.query as unknown as JSONObject;
        return query["monitorId"] !== undefined ? sameMonitor : recent;
      });
  });

  async function rememberAlert(): Promise<string> {
    return await AIMemory.getPriorSimilarAlertsContext({
      projectId: PROJECT_ID,
      currentAlertId: CURRENT_ALERT,
    });
  }

  test("an alert on another monitor whose words match is recalled, and says why", async () => {
    recent = [
      pastAlert({
        index: 1,
        title: "Payments 5xx",
        rootCause: "Connection pool exhausted after the deploy",
        monitorId: OTHER_MONITOR_ID,
      }),
      pastAlert({
        index: 2,
        title: "Disk full on db-4",
        rootCause: "Logs filled the volume",
        monitorId: OTHER_MONITOR_ID,
      }),
    ];

    const markdown: string = await rememberAlert();

    expect(markdown.startsWith(`\n\n${PAST_RESOLVED_ALERTS_HEADING}\n`)).toBe(
      true,
    );
    expect(block(markdown, "Alert #401")).toMatch(
      /Matched on: what happened reads alike \(.*server errors \(5xx\).*\)/,
    );
    expect(markdown).not.toContain("Alert #402");
  });

  test("an alert's confirmed analysis counts as its cause", async () => {
    sameMonitor = [
      pastAlert({ index: 1, title: "CPU", monitorId: MONITOR_ID }),
    ];
    runs = [confirmedRun({ alert: 1, tldr: "A runaway cron job." })];

    const markdown: string = await rememberAlert();

    expect(block(markdown, "Alert #401")).toContain(
      "Previously resolved. Root cause (OneUptime AI's analysis, confirmed by your team): A runaway cron job.",
    );

    const query: JSONObject = runReads[0]!.query as unknown as JSONObject;

    expect(anyValues(query["triggeredByAlertId"])).toEqual([recordId(1)]);
    expect(query["triggeredByIncidentId"]).toBeUndefined();
  });

  test("an alert on the same service is named, and the alert's services are read with it", async () => {
    current.services = [service(CHECKOUT)];
    services = [CHECKOUT];
    recent = [
      pastAlert({
        index: 1,
        title: "Unrelated words",
        rootCause: "A cron ran twice",
        monitorId: OTHER_MONITOR_ID,
        services: [CHECKOUT],
      }),
    ];

    const markdown: string = await rememberAlert();

    expect(block(markdown, "Alert #401")).toContain(
      "Matched on: the same service (checkout)",
    );
    expect(ServiceKnowledge.readServicesOfAlert).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      services: current.services,
      monitorId: MONITOR_ID,
    });
    expect(knowledge).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      services: [CHECKOUT],
      excludeAlertId: CURRENT_ALERT,
    });
  });

  test("an alert that matches nothing is never listed, not even as the latest", async () => {
    recent = [
      pastAlert({
        index: 1,
        title: "Disk full on db-4",
        rootCause: "Logs filled the volume",
        monitorId: OTHER_MONITOR_ID,
      }),
    ];

    expect(await rememberAlert()).toBe("");
  });
});
