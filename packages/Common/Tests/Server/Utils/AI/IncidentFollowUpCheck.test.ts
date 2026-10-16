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
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Incident from "../../../../Models/DatabaseModels/Incident";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import CountBy from "../../../../Server/Types/Database/CountBy";
import FindBy from "../../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../../Server/Types/Database/FindOneBy";
import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import IncidentFollowUpCheck, {
  FOLLOW_UP_WINDOW_MINUTES,
  FollowUpCheckContext,
  MAX_INCIDENTS_PER_ALERT,
} from "../../../../Server/Utils/AI/SRE/IncidentFollowUpCheck";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import { describeLinkedResource } from "../../../../Server/Utils/AI/SRE/LinkedInfrastructureContext";
import logger from "../../../../Server/Utils/Logger";
import { AIRunEventResultSummary } from "../../../../Types/AI/AIChatTypes";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { parseInvestigationReport } from "../../../../Utils/AI/InvestigationReport";
import { ObservabilityAssistantResult } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";

/*
 * AN INCIDENT IS CHECKED AGAIN, ONCE, WHEN AN ALERT OPENS ON ITS
 * INFRASTRUCTURE AFTER ITS FIRST INVESTIGATION (issue #4787).
 *
 * The customer's rerun: the synthetic monitor's incident opened at 14:30,
 * its investigation finished at 14:33 without the host's CPU alert, which
 * opened at 14:32 - a 5-minute metric window needs a few minutes of data.
 * Now that alert has OneUptime AI check the incident again, with the alert
 * in hand. Never a loop: once per incident, only after a completed first
 * investigation, only while the incident is open and within 30 minutes of
 * it, through the queue's own gates.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const HOST_A: string = "44444444-4444-4444-8444-444444444444";
const OPEN_STATE: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const RESOLVED_STATE: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const FIRST_RUN_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const QUEUED_RUN_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const MINUTE: number = 60 * 1000;
const DECLARED_AT: Date = new Date("2026-10-16T14:30:00.000Z");

function at(minutesFromIncident: number): Date {
  return new Date(DECLARED_AT.getTime() + minutesFromIncident * MINUTE);
}

const HOST: LinkedAffectedResource = {
  type: LinkedAffectedResourceType.Host,
  id: HOST_A,
  name: "web-1",
};

interface World {
  alertOpenedAt: Date;
  alertIsPrivate: boolean;
  alertResources: Array<LinkedAffectedResource>;
  incidentResources: Array<LinkedAffectedResource>;
  incidentState: ObjectID;
  laneClosedBy: string | null;
  runs: Array<AIRun>;
  // The alerts on the incident's infrastructure, for a settled run's check.
  laterAlerts: Array<Alert>;
}

let world: World;
let enqueue: SpyInstance<typeof AIInvestigationQueue.enqueue>;
let enqueued: Array<Parameters<typeof AIInvestigationQueue.enqueue>[0]>;
let admitted: Array<boolean>;
let incidentReads: Array<FindBy<Incident>>;

function run(data: {
  status: AIRunStatus;
  startedMinutesFromIncident: number;
  followUpForAlertId?: ObjectID;
  id?: ObjectID;
}): AIRun {
  const item: AIRun = new AIRun(data.id || ObjectID.generate());
  item.runType = AIRunType.Investigation;
  item.status = data.status;
  item.createdAt = at(data.startedMinutesFromIncident);
  item.startedAt = at(data.startedMinutesFromIncident);
  item.completedAt = at(data.startedMinutesFromIncident + 1);
  item.monitorId = MONITOR_ID;
  item.triggeredByIncidentId = INCIDENT_ID;

  if (data.followUpForAlertId) {
    item.followUpForAlertId = data.followUpForAlertId;
  }

  return item;
}

function newAlert(id: ObjectID, openedAt: Date, isPrivate: boolean): Alert {
  const alert: Alert = new Alert(id);
  alert.createdAt = openedAt;
  alert.isPrivate = isPrivate;
  return alert;
}

beforeEach(() => {
  enqueued = [];
  admitted = [];
  incidentReads = [];
  world = {
    alertOpenedAt: at(2),
    alertIsPrivate: false,
    alertResources: [HOST],
    incidentResources: [HOST],
    incidentState: OPEN_STATE,
    laneClosedBy: null,
    // The first investigation: claimed at 14:30, done at 14:31.
    runs: [
      run({
        id: FIRST_RUN_ID,
        status: AIRunStatus.Completed,
        startedMinutesFromIncident: 0,
      }),
    ],
    laterAlerts: [],
  };

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  jest
    .spyOn(AlertService, "findOneBy")
    .mockImplementation(
      async (findOneBy: FindOneBy<Alert>): Promise<Alert | null> => {
        const alert: Alert = newAlert(
          ALERT_ID,
          world.alertOpenedAt,
          world.alertIsPrivate,
        );
        const select: JSONObject = findOneBy.select as unknown as JSONObject;

        if (select["title"]) {
          alert.alertNumber = 12;
          alert.title = "[Host] High CPU Utilization (>80%) - web-1";
          alert.rootCause = "CPU busy (user + system) was 97.4%.";
          alert.alertSeverity = { name: "Warning" } as never;
        }

        return alert;
      },
    );
  jest
    .spyOn(LinkedAffectedResources, "readForAlert")
    .mockImplementation(async (): Promise<Array<LinkedAffectedResource>> => {
      return world.alertResources;
    });
  jest
    .spyOn(LinkedAffectedResources, "readForIncident")
    .mockImplementation(async (): Promise<Array<LinkedAffectedResource>> => {
      return world.incidentResources;
    });
  jest
    .spyOn(AIInvestigationEngine, "getDisabledReason")
    .mockImplementation(async () => {
      return world.laneClosedBy as never;
    });
  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue([OPEN_STATE]);
  jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(
      async (findBy: FindBy<Incident>): Promise<Array<Incident>> => {
        incidentReads.push(findBy);
        const incident: Incident = new Incident(INCIDENT_ID);
        incident.createdAt = DECLARED_AT;
        return world.incidentState.toString() === OPEN_STATE.toString()
          ? [incident]
          : [];
      },
    );
  jest
    .spyOn(IncidentService, "findOneBy")
    .mockImplementation(async (): Promise<Incident | null> => {
      const incident: Incident = new Incident(INCIDENT_ID);
      incident.createdAt = DECLARED_AT;
      incident.currentIncidentStateId = world.incidentState;
      return incident;
    });
  jest
    .spyOn(AIRunService, "findBy")
    .mockImplementation(
      async (findBy: FindBy<AIRun>): Promise<Array<AIRun>> => {
        const query: JSONObject = findBy.query as unknown as JSONObject;
        const runs: Array<AIRun> = [...world.runs].filter((item: AIRun) => {
          // The previous analysis: a completed first investigation.
          if (query["followUpForAlertId"] !== undefined) {
            return (
              !item.followUpForAlertId && item.status === AIRunStatus.Completed
            );
          }
          return true;
        });

        return runs
          .sort((a: AIRun, b: AIRun): number => {
            return b.createdAt!.getTime() - a.createdAt!.getTime();
          })
          .slice(0, findBy.limit as number);
      },
    );
  jest
    .spyOn(AIRunService, "findOneBy")
    .mockImplementation(
      async (findOneBy: FindOneBy<AIRun>): Promise<AIRun | null> => {
        const id: unknown = (findOneBy.query as unknown as JSONObject)["_id"];
        return (
          world.runs.find((item: AIRun): boolean => {
            return item.id?.toString() === String(id);
          }) || null
        );
      },
    );
  jest
    .spyOn(AIRunService, "countBy")
    .mockImplementation(
      async (countBy: CountBy<AIRun>): Promise<PositiveNumber> => {
        const query: JSONObject = countBy.query as unknown as JSONObject;
        expect(query["followUpForAlertId"]).toBeDefined();
        return new PositiveNumber(
          world.runs.filter((item: AIRun): boolean => {
            return Boolean(item.followUpForAlertId);
          }).length,
        );
      },
    );
  jest
    .spyOn(AlertService, "findBy")
    .mockImplementation(async (): Promise<Array<Alert>> => {
      return world.laterAlerts;
    });
  /*
   * The queue, with its subject lock: one enqueue at a time admits and
   * creates, as InvestigationSubjectLock serializes them.
   */
  let subjectLock: Promise<unknown> = Promise.resolve();

  enqueue = jest
    .spyOn(AIInvestigationQueue, "enqueue")
    .mockImplementation(
      async (
        data: Parameters<typeof AIInvestigationQueue.enqueue>[0],
      ): Promise<ObjectID | null> => {
        enqueued.push(data);

        const create: Promise<ObjectID | null> = subjectLock.then(
          async (): Promise<ObjectID | null> => {
            const isAdmitted: boolean = data.admitInsideSubjectLock
              ? await data.admitInsideSubjectLock()
              : true;
            admitted.push(isAdmitted);

            if (!isAdmitted) {
              return null;
            }

            world.runs.push(
              run({
                id: QUEUED_RUN_ID,
                status: AIRunStatus.Queued,
                startedMinutesFromIncident: 4,
                followUpForAlertId: data.followUpForAlertId!,
              }),
            );
            return QUEUED_RUN_ID;
          },
        );

        subjectLock = create.catch((): void => {
          return undefined;
        });

        return await create;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function alertOpens(): Promise<Array<ObjectID>> {
  return await IncidentFollowUpCheck.onAlertOpened({
    projectId: PROJECT_ID,
    alertId: ALERT_ID,
  });
}

describe("an alert opens on an open incident's infrastructure", () => {
  test("the incident, investigated without it, is checked again with it in hand", async () => {
    expect(await alertOpens()).toEqual([QUEUED_RUN_ID]);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        subjectIncidentId: INCIDENT_ID,
        subjectMonitorId: MONITOR_ID,
        followUpForAlertId: ALERT_ID,
      }),
    );
    // It records nothing on the incident's AI card when it is not queued.
    expect(enqueued[0]!.onNotEnqueued).toBeUndefined();
    expect(admitted).toEqual([true]);
  });

  test("the open incidents are found by the alert's infrastructure, in the window before it", async () => {
    await alertOpens();

    expect(incidentReads).toHaveLength(1);
    const query: JSONObject = incidentReads[0]!.query as unknown as JSONObject;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(
      (query["hosts"] as Array<ObjectID>).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([HOST_A]);
    expect(query["currentIncidentStateId"]).toBeDefined();
    expect(JSON.stringify(query["createdAt"])).toContain(
      at(2 - FOLLOW_UP_WINDOW_MINUTES)
        .toISOString()
        .slice(0, 19),
    );
    expect(incidentReads[0]!.limit).toBe(MAX_INCIDENTS_PER_ALERT);
    expect(incidentReads[0]!.props).toEqual({ isRoot: true });
  });

  test("once per incident: a second alert adds nothing", async () => {
    await alertOpens();
    // The follow-up ran and completed.
    world.runs.find((item: AIRun): boolean => {
      return item.id?.toString() === QUEUED_RUN_ID.toString();
    })!.status = AIRunStatus.Completed;
    world.alertOpenedAt = at(9);

    expect(await alertOpens()).toEqual([]);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  test("two alerts at once: the lock lets one run through", async () => {
    const [first, second] = await Promise.all([alertOpens(), alertOpens()]);

    expect([...first, ...second]).toHaveLength(1);
  });

  test.each([
    [
      "a private alert: its title would reach the report",
      (): void => {
        world.alertIsPrivate = true;
      },
    ],
    [
      "an alert on no infrastructure",
      (): void => {
        world.alertResources = [
          {
            type: LinkedAffectedResourceType.Monitor,
            id: HOST_A,
            name: "Synthetic",
          },
        ];
      },
    ],
    [
      "automatic incident investigation is off",
      (): void => {
        world.laneClosedBy = "automatic_investigation_disabled";
      },
    ],
    [
      "the project's daily AI limit is reached",
      (): void => {
        world.laneClosedBy = "project_daily_limit_reached";
      },
    ],
    [
      "the incident was resolved meanwhile",
      (): void => {
        world.incidentState = RESOLVED_STATE;
      },
    ],
    [
      "the alert opened more than 30 minutes after the incident",
      (): void => {
        world.alertOpenedAt = at(FOLLOW_UP_WINDOW_MINUTES + 1);
      },
    ],
    [
      "the incident was never investigated",
      (): void => {
        world.runs = [];
      },
    ],
    [
      "its investigation is still queued: it reads the alert when it starts",
      (): void => {
        world.runs = [
          run({ status: AIRunStatus.Queued, startedMinutesFromIncident: 0 }),
        ];
      },
    ],
    [
      "its investigation is running: it is checked when that run settles",
      (): void => {
        world.runs = [
          run({ status: AIRunStatus.Running, startedMinutesFromIncident: 0 }),
        ];
      },
    ],
    [
      "its investigation failed",
      (): void => {
        world.runs = [
          run({ status: AIRunStatus.Error, startedMinutesFromIncident: 0 }),
        ];
      },
    ],
    [
      "its investigation read its context after the alert opened",
      (): void => {
        world.runs = [
          run({ status: AIRunStatus.Completed, startedMinutesFromIncident: 3 }),
        ];
      },
    ],
    [
      "its latest run is already the follow-up",
      (): void => {
        world.runs.push(
          run({
            status: AIRunStatus.Completed,
            startedMinutesFromIncident: 1,
            followUpForAlertId: ObjectID.generate(),
          }),
        );
      },
    ],
  ])(
    "nothing is checked again when %s",
    async (_label: string, arrange: () => void) => {
      arrange();

      expect(await alertOpens()).toEqual([]);
      expect(
        admitted.every((value: boolean): boolean => {
          return value === false;
        }),
      ).toBe(true);
    },
  );

  test("a failure decides nothing and never throws into the alert's creation", async () => {
    jest
      .spyOn(LinkedAffectedResources, "readForAlert")
      .mockRejectedValue(new Error("Database not connected"));

    await expect(alertOpens()).resolves.toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("an investigation settles while an alert opened", () => {
  async function settles(
    runId: ObjectID = FIRST_RUN_ID,
  ): Promise<ObjectID | null> {
    return await IncidentFollowUpCheck.onInvestigationSettled({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      aiRunId: runId,
    });
  }

  test("the first alert that opened while it read is the one the incident is checked again for", async () => {
    world.laterAlerts = [newAlert(ALERT_ID, at(2), false)];

    expect(await settles()).toEqual(QUEUED_RUN_ID);
    expect(enqueued[0]!.followUpForAlertId).toEqual(ALERT_ID);
  });

  test("a private alert is skipped for the next one", async () => {
    const LATER: ObjectID = ObjectID.generate();
    world.laterAlerts = [
      newAlert(ObjectID.generate(), at(1), true),
      newAlert(LATER, at(2), false),
    ];

    await settles();

    expect(enqueued[0]!.followUpForAlertId).toEqual(LATER);
  });

  test("no alert opened meanwhile: nothing is checked again", async () => {
    expect(await settles()).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("a follow-up's own settling never leads to another: never a loop", async () => {
    const FOLLOW_UP: ObjectID = ObjectID.generate();
    world.runs.push(
      run({
        id: FOLLOW_UP,
        status: AIRunStatus.Completed,
        startedMinutesFromIncident: 4,
        followUpForAlertId: ALERT_ID,
      }),
    );
    world.laterAlerts = [newAlert(ObjectID.generate(), at(6), false)];

    expect(await settles(FOLLOW_UP)).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("a run that did not complete leads to nothing", async () => {
    world.runs[0]!.status = AIRunStatus.Error;
    world.laterAlerts = [newAlert(ALERT_ID, at(2), false)];

    expect(await settles()).toBeNull();
  });

  test("a run that read its context after the window had closed leads to nothing", async () => {
    world.runs[0]!.startedAt = at(FOLLOW_UP_WINDOW_MINUTES + 5);
    world.laterAlerts = [newAlert(ALERT_ID, at(2), false)];

    expect(await settles()).toBeNull();
  });
});

describe("what the follow-up run is told, and says", () => {
  async function context(): Promise<FollowUpCheckContext> {
    const result: FollowUpCheckContext | null =
      await IncidentFollowUpCheck.readContext({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertId: ALERT_ID,
      });

    if (!result) {
      throw new Error("no context");
    }

    return result;
  }

  test("the alert, the incident's resource it is on, and when the first analysis finished", async () => {
    const followUp: FollowUpCheckContext = await context();

    expect(followUp).toEqual(
      expect.objectContaining({
        alertNumber: 12,
        alertTitle: "[Host] High CPU Utilization (>80%) - web-1",
        alertOpenedAt: at(2),
        alertSeverityName: "Warning",
        resources: [
          { type: LinkedAffectedResourceType.Host, id: HOST_A, name: "web-1" },
        ],
        previousAnalysisAt: at(1),
      }),
    );

    const section: string = IncidentFollowUpCheck.buildContextSection(followUp);

    expect(section.startsWith("# Why you are checking again\n")).toBe(true);
    expect(section).toContain(
      `OneUptime AI already investigated this incident (its analysis finished ${at(1).toISOString()} and is in the internal notes below). Since then, alert #12 "[Host] High CPU Utilization (>80%) - web-1" opened on ${describeLinkedResource({ type: LinkedAffectedResourceType.Host, id: HOST_A, name: "web-1" })} at ${at(2).toISOString()}, 2 minutes after this incident. Its severity is Warning. Root cause recorded on the alert: CPU busy (user + system) was 97.4%.`,
    );
    expect(section).toContain(
      "Begin the Summary by saying whether this alert changes the earlier analysis, and how.",
    );
  });

  test("a private alert gives no context: the run checks the incident as a plain investigation", async () => {
    world.alertIsPrivate = true;

    expect(
      await IncidentFollowUpCheck.readContext({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertId: ALERT_ID,
      }),
    ).toBeNull();
  });

  test("the report's first line says why it was written, and the parser reads it as the lead", async () => {
    const followUp: FollowUpCheckContext = await context();
    const markdown: string = AIInvestigationEngine.buildBrandedMarkdown(
      {
        contentInMarkdown: "",
        citations: [],
        toolCallCount: 2,
        llmCallCount: 3,
        totalTokens: 100,
      } as unknown as ObservabilityAssistantResult,
      "**Summary** — The host's CPU alert confirms the earlier analysis.\n\n**Most likely root cause** — shop-api saturated the CPU.",
      0,
      0,
      IncidentFollowUpCheck.buildReportLead(followUp),
    );

    expect(markdown).toContain(
      "**Checked again** after alert #12 (\\[Host\\] High CPU Utilization (>80%) - web-1) opened on Host web-1, 2 minutes after this incident was declared.",
    );
    expect(markdown.indexOf("Checked again")).toBeLessThan(
      markdown.indexOf("**Summary**"),
    );

    const parsed: { preamble: string; summary?: string | undefined } =
      parseInvestigationReport(markdown);

    expect(parsed.preamble).toContain("Checked again");
    expect(parsed.summary).toBe(
      "The host's CPU alert confirms the earlier analysis.",
    );
  });

  test("the run's first activity line names the alert and where it opened", async () => {
    const note: AIRunEventResultSummary =
      IncidentFollowUpCheck.buildActivityNote(await context());

    expect(note.message).toBe(
      'Checking again: alert #12 opened on Host "web-1" after the first analysis',
    );
    expect(note.followUpCheck).toEqual({
      alertNumber: 12,
      alertNumberWithPrefix: undefined,
      resourceKind: "Host",
      resourceName: "web-1",
      minutesAfterIncident: 2,
    });
  });
});

describe("isDue", () => {
  test.each([
    [AIRunStatus.Completed, 0, undefined, 2, true],
    [AIRunStatus.Completed, 3, undefined, 2, false],
    [AIRunStatus.Running, 0, undefined, 2, false],
    [AIRunStatus.Queued, 0, undefined, 2, false],
    [AIRunStatus.Error, 0, undefined, 2, false],
    [AIRunStatus.Cancelled, 0, undefined, 2, false],
    [AIRunStatus.Completed, 0, ObjectID.generate(), 2, false],
  ])(
    "a %s run started at +%s min (follow-up: %s), alert at +%s min: %s",
    (
      status: AIRunStatus,
      startedAt: number,
      followUp: ObjectID | undefined,
      alertAt: number,
      expected: boolean,
    ) => {
      expect(
        IncidentFollowUpCheck.isDue({
          latestRun: run({
            status,
            startedMinutesFromIncident: startedAt,
            ...(followUp ? { followUpForAlertId: followUp } : {}),
          }),
          alertOpenedAt: at(alertAt),
        }),
      ).toBe(expected);
    },
  );
});
