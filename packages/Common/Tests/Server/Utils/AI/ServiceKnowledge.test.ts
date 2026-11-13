import "../../TestingUtils/Init";
import ServiceKnowledge, {
  FailureMode,
  LearnedCase,
  MAX_FAILURE_MODES,
  MAX_SERVICES,
  NamedService,
  SERVICE_KNOWLEDGE_HEADING,
  ServiceLessons,
} from "../../../../Server/Utils/AI/SRE/ServiceKnowledge";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorService from "../../../../Server/Services/MonitorService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import logger from "../../../../Server/Utils/Logger";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Service from "../../../../Models/DatabaseModels/Service";
import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
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
 * Contract under test - what OneUptime AI has learned about each service
 * (ServiceKnowledge, issue #6798):
 *
 *  - a service's resolved incidents and alerts - linked to it, or raised
 *    by a monitor of it - whose cause is known (recorded, or OneUptime AI's
 *    analysis a person confirmed) or that OneUptime AI fixed, grouped by
 *    meaning into the failures that keep happening, most frequent first;
 *  - each failure says how often and when it was last seen, which records,
 *    its cause and the fix that worked;
 *  - never a private record, a record of another project, or the subject
 *    itself; at most a few services and failures; every read bounded;
 *  - nothing here throws: what cannot be read is no knowledge.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-000000000001",
);
const RESOLVED_STATE: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-000000000002",
);
const CURRENT_INCIDENT: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-000000000003",
);
const CHECKOUT: NamedService = {
  id: "0193c0de-cccc-4aaa-8bbb-0000000000a1",
  name: "checkout",
};
const PAYMENTS: NamedService = {
  id: "0193c0de-cccc-4aaa-8bbb-0000000000a2",
  name: "payments",
};
const CHECKOUT_MONITOR: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-0000000000b1",
);

function recordId(index: number): string {
  return `0193c0de-cccc-4aaa-8bbb-0000000003${String(index).padStart(2, "0")}`;
}

function serviceRow(named: NamedService): Service {
  const row: Service = new Service(new ObjectID(named.id));
  row.name = named.name;
  return row;
}

function learned(data: {
  reference: string;
  cause?: string | undefined;
  fix?: string | undefined;
  title?: string | undefined;
  daysAgo: number;
  isConfirmedAnalysis?: boolean | undefined;
}): LearnedCase {
  return {
    reference: data.reference,
    title: data.title || "Untitled",
    cause: data.cause || null,
    isConfirmedAnalysis: data.isConfirmedAnalysis === true,
    fix: data.fix || null,
    happenedAt: new Date(
      Date.parse("2026-11-10T12:00:00.000Z") - data.daysAgo * 86400000,
    ),
  };
}

describe("grouping a service's past into failures", () => {
  test("causes that read alike are one failure, seen as often as they happened", () => {
    const modes: Array<FailureMode> = ServiceKnowledge.groupIntoFailureModes([
      learned({
        reference: "incident #9",
        cause: "The database connection pool was exhausted after a deploy",
        daysAgo: 1,
      }),
      learned({
        reference: "alert #31",
        cause: "Disk full on the log volume",
        daysAgo: 2,
      }),
      learned({
        reference: "incident #7",
        cause: "Too many connections to postgres; the pool ran out",
        daysAgo: 5,
      }),
      learned({
        reference: "alert #12",
        cause: "connection pool exhausted by a retry storm",
        daysAgo: 9,
      }),
    ]);

    expect(
      modes.map((mode: FailureMode): Array<string> => {
        return mode.cases.map((item: LearnedCase): string => {
          return item.reference;
        });
      }),
    ).toEqual([["incident #9", "incident #7", "alert #12"], ["alert #31"]]);
  });

  test("among failures seen as often, the most recently seen comes first", () => {
    const modes: Array<FailureMode> = ServiceKnowledge.groupIntoFailureModes([
      learned({
        reference: "a",
        cause: "Disk full on the log volume",
        daysAgo: 1,
      }),
      learned({ reference: "b", cause: "TLS certificate expired", daysAgo: 3 }),
    ]);

    expect(
      modes.map((mode: FailureMode): string => {
        return mode.cases[0]!.reference;
      }),
    ).toEqual(["a", "b"]);
  });

  test("a case OneUptime AI fixed with no cause recorded groups by what happened and the fix", () => {
    const modes: Array<FailureMode> = ServiceKnowledge.groupIntoFailureModes([
      learned({
        reference: "alert #2",
        title: "Checkout pods OOMKilled",
        fix: "ran `kubectl rollout restart deployment/checkout`",
        daysAgo: 1,
      }),
      learned({
        reference: "alert #1",
        title: "checkout out of memory",
        fix: "ran `kubectl rollout restart deployment/checkout`",
        daysAgo: 4,
      }),
    ]);

    expect(modes).toHaveLength(1);
    expect(modes[0]!.cases).toHaveLength(2);
  });

  test("nothing to group is no failure", () => {
    expect(ServiceKnowledge.groupIntoFailureModes([])).toEqual([]);
  });
});

describe("the context section", () => {
  const lessons: Array<ServiceLessons> = [
    {
      service: CHECKOUT,
      failureModes: [
        {
          cases: [
            learned({
              reference: "incident #9",
              cause: "The connection pool was exhausted",
              daysAgo: 1,
            }),
            learned({
              reference: "alert #31",
              cause: "Pool exhausted again",
              fix: 'ran the runbook "Recycle the connection pool"',
              daysAgo: 3,
            }),
            learned({ reference: "incident #7", cause: "Pool", daysAgo: 6 }),
            learned({ reference: "incident #2", cause: "Pool", daysAgo: 9 }),
          ],
        },
        {
          cases: [
            learned({
              reference: "alert #40",
              title: "Checkout pods OOMKilled",
              fix: "ran `kubectl rollout restart deployment/checkout`",
              daysAgo: 2,
            }),
          ],
        },
      ],
    },
    {
      service: PAYMENTS,
      failureModes: [
        {
          cases: [
            learned({
              reference: "incident #11",
              cause: "A bad feature flag",
              isConfirmedAnalysis: true,
              daysAgo: 4,
            }),
          ],
        },
      ],
    },
  ];

  test("names each service and each failure: how often, when last, which records, the cause and the fix", () => {
    const markdown: string = ServiceKnowledge.buildContextSection(lessons);

    expect(markdown.startsWith(`\n\n${SERVICE_KNOWLEDGE_HEADING}\n`)).toBe(
      true,
    );
    expect(markdown).toContain("## Service: checkout\n");
    expect(markdown).toContain(
      '- Seen 4 times, last on 2026-11-09 (incident #9, alert #31, incident #7, ...)\n  Cause: The connection pool was exhausted\n  Fix that worked (OneUptime AI\'s, verified): ran the runbook "Recycle the connection pool"',
    );
    expect(markdown).toContain(
      "- Seen once, last on 2026-11-08 (alert #40)\n  Cause: not recorded. What happened: Checkout pods OOMKilled\n  Fix that worked (OneUptime AI's, verified): ran `kubectl rollout restart deployment/checkout`",
    );
    expect(markdown).toContain(
      "## Service: payments\n- Seen once, last on 2026-11-06 (incident #11)\n  Cause (OneUptime AI's analysis, confirmed by your team): A bad feature flag",
    );
    // The services in the order given.
    expect(markdown.indexOf("checkout")).toBeLessThan(
      markdown.indexOf("payments"),
    );
  });

  test("its words are data: an embedded image left out, a long cause cut", () => {
    const markdown: string = ServiceKnowledge.buildContextSection([
      {
        service: { id: CHECKOUT.id, name: `checkout ${"n".repeat(400)}` },
        failureModes: [
          {
            cases: [
              learned({
                reference: "incident #1",
                cause: `![shot](data:image/png;base64,${"A".repeat(5000)}) ${"y".repeat(900)}`,
                daysAgo: 1,
              }),
            ],
          },
        ],
      },
    ]);

    expect(markdown).not.toContain("data:image/png;base64,AAAA");
    expect(markdown.length).toBeLessThan(1500);
  });

  test("nothing learned is no section", () => {
    expect(ServiceKnowledge.buildContextSection([])).toBe("");
  });
});

describe("reading what is known", () => {
  let incidentsByService: Array<Incident>;
  let incidentsByMonitor: Array<Incident>;
  let alertsByService: Array<Alert>;
  let alertsByMonitor: Array<Alert>;
  let runs: Array<AIRun>;
  let fixes: Array<AutoRemediationSuggestion>;
  let monitorReads: Array<FindBy<Monitor>>;
  let incidentReads: Array<FindBy<Incident>>;
  let alertReads: Array<FindBy<Alert>>;
  let runReads: Array<FindBy<AIRun>>;

  function incident(data: {
    index: number;
    rootCause?: string | undefined;
    services?: Array<NamedService> | undefined;
    onCheckoutMonitor?: boolean | undefined;
    isPrivate?: boolean | undefined;
    title?: string | undefined;
  }): Incident {
    const row: Incident = new Incident(new ObjectID(recordId(data.index)));
    row.incidentNumber = data.index;
    row.title = data.title || `Incident ${data.index}`;
    if (data.rootCause) {
      row.rootCause = data.rootCause;
    }
    row.createdAt = new Date(
      Date.parse("2026-11-10T12:00:00.000Z") - data.index * 86400000,
    );
    row.isPrivate = data.isPrivate === true;
    row.services = (data.services || []).map(serviceRow);
    row.monitors = data.onCheckoutMonitor
      ? [new Monitor(CHECKOUT_MONITOR)]
      : [];
    return row;
  }

  function alert(data: {
    index: number;
    rootCause?: string | undefined;
    services?: Array<NamedService> | undefined;
    onCheckoutMonitor?: boolean | undefined;
    title?: string | undefined;
  }): Alert {
    const row: Alert = new Alert(new ObjectID(recordId(data.index)));
    row.alertNumber = data.index;
    row.title = data.title || `Alert ${data.index}`;
    if (data.rootCause) {
      row.rootCause = data.rootCause;
    }
    row.createdAt = new Date(
      Date.parse("2026-11-10T12:00:00.000Z") - data.index * 86400000,
    );
    row.isPrivate = false;
    row.services = (data.services || []).map(serviceRow);
    if (data.onCheckoutMonitor) {
      row.monitorId = CHECKOUT_MONITOR;
    }
    return row;
  }

  beforeEach(() => {
    incidentsByService = [];
    incidentsByMonitor = [];
    alertsByService = [];
    alertsByMonitor = [];
    runs = [];
    fixes = [];
    monitorReads = [];
    incidentReads = [];
    alertReads = [];
    runReads = [];

    jest
      .spyOn(MonitorService, "findBy")
      .mockImplementation(async (findBy: FindBy<Monitor>) => {
        monitorReads.push(findBy);
        const monitor: Monitor = new Monitor(CHECKOUT_MONITOR);
        monitor.services = [serviceRow(CHECKOUT)];
        return [monitor];
      });
    jest
      .spyOn(IncidentStateService, "getResolvedIncidentStateIds")
      .mockResolvedValue([RESOLVED_STATE]);
    jest
      .spyOn(AlertStateService, "getResolvedAlertStateIds")
      .mockResolvedValue([RESOLVED_STATE]);
    jest
      .spyOn(IncidentService, "findBy")
      .mockImplementation(async (findBy: FindBy<Incident>) => {
        incidentReads.push(findBy);
        const query: JSONObject = findBy.query as unknown as JSONObject;
        return query["monitors"] !== undefined
          ? incidentsByMonitor
          : incidentsByService;
      });
    jest
      .spyOn(AlertService, "findBy")
      .mockImplementation(async (findBy: FindBy<Alert>) => {
        alertReads.push(findBy);
        const query: JSONObject = findBy.query as unknown as JSONObject;
        return query["monitorId"] !== undefined
          ? alertsByMonitor
          : alertsByService;
      });
    jest
      .spyOn(AIRunService, "findBy")
      .mockImplementation(async (findBy: FindBy<AIRun>) => {
        runReads.push(findBy);
        return runs;
      });
    jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockImplementation(async () => {
        return fixes;
      });
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("learns from records linked to the service and from its monitors' records, in the project", async () => {
    incidentsByService = [
      incident({
        index: 1,
        rootCause: "Connection pool exhausted",
        services: [CHECKOUT],
      }),
    ];
    incidentsByMonitor = [
      incident({
        index: 2,
        rootCause: "Too many connections; the pool ran out",
        onCheckoutMonitor: true,
      }),
    ];
    alertsByMonitor = [
      alert({
        index: 3,
        rootCause: "Pool exhausted after the deploy",
        onCheckoutMonitor: true,
      }),
    ];

    const lessons: Array<ServiceLessons> = await ServiceKnowledge.read({
      projectId: PROJECT_ID,
      services: [CHECKOUT],
    });

    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.service).toEqual(CHECKOUT);
    expect(
      lessons[0]!.failureModes[0]!.cases.map((item: LearnedCase): string => {
        return item.reference;
      }),
    ).toEqual(["incident #1", "incident #2", "alert #3"]);

    for (const read of [...incidentReads, ...alertReads, ...monitorReads]) {
      const query: JSONObject = read.query as unknown as JSONObject;
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(read.props).toEqual({ isRoot: true });
    }

    for (const read of [...incidentReads, ...alertReads]) {
      expect(read.limit).toBeLessThanOrEqual(100);
    }
  });

  test("never a private record, nor the subject itself", async () => {
    incidentsByService = [
      incident({
        index: 1,
        rootCause: "The payroll bucket was public",
        services: [CHECKOUT],
        isPrivate: true,
      }),
      incident({ index: 2, rootCause: "A bad deploy", services: [CHECKOUT] }),
    ];
    incidentsByService[1]!.id = CURRENT_INCIDENT;

    const lessons: Array<ServiceLessons> = await ServiceKnowledge.read({
      projectId: PROJECT_ID,
      services: [CHECKOUT],
      excludeIncidentId: CURRENT_INCIDENT,
    });

    expect(lessons).toEqual([]);
  });

  test("a record with neither a cause nor a fix teaches nothing; a confirmed analysis does", async () => {
    incidentsByService = [
      incident({ index: 1, services: [CHECKOUT] }),
      incident({ index: 2, services: [CHECKOUT] }),
    ];
    const run: AIRun = new AIRun(ObjectID.generate());
    run.triggeredByIncidentId = new ObjectID(recordId(2));
    run.analysisTldr = "A retry storm exhausted the pool.";
    run.humanVerdict = AIRunHumanVerdict.Confirmed;
    runs = [run];

    const lessons: Array<ServiceLessons> = await ServiceKnowledge.read({
      projectId: PROJECT_ID,
      services: [CHECKOUT],
    });

    expect(lessons[0]!.failureModes).toHaveLength(1);
    expect(lessons[0]!.failureModes[0]!.cases).toEqual([
      expect.objectContaining({
        reference: "incident #2",
        cause: "A retry storm exhausted the pool.",
        isConfirmedAnalysis: true,
      }),
    ]);

    const query: JSONObject = runReads[0]!.query as unknown as JSONObject;
    expect(query["humanVerdict"]).toBe(AIRunHumanVerdict.Confirmed);
  });

  test("the fix OneUptime AI verified is remembered with the failure", async () => {
    incidentsByService = [
      incident({ index: 1, rootCause: "Pool exhausted", services: [CHECKOUT] }),
    ];
    const fix: AutoRemediationSuggestion = new AutoRemediationSuggestion(
      ObjectID.generate(),
    );
    fix.incidentId = new ObjectID(recordId(1));
    fix.suggestionType = AutoRemediationSuggestionType.Runbook;
    fix.runbookNameSnapshot = "Recycle the connection pool";
    fixes = [fix];

    const lessons: Array<ServiceLessons> = await ServiceKnowledge.read({
      projectId: PROJECT_ID,
      services: [CHECKOUT],
    });

    expect(lessons[0]!.failureModes[0]!.cases[0]!.fix).toBe(
      'ran the runbook "Recycle the connection pool"',
    );
  });

  test("each record is learned for the services it is on, and the first few services only", async () => {
    incidentsByService = [
      incident({
        index: 1,
        rootCause: "Pool exhausted",
        services: [CHECKOUT, PAYMENTS],
      }),
      incident({ index: 2, rootCause: "Flag misfired", services: [PAYMENTS] }),
    ];

    const many: Array<NamedService> = [
      CHECKOUT,
      PAYMENTS,
      ...Array.from({ length: 5 }, (_: unknown, index: number) => {
        return {
          id: `0193c0de-cccc-4aaa-8bbb-0000000000c${index}`,
          name: `extra-${index}`,
        };
      }),
    ];

    const lessons: Array<ServiceLessons> = await ServiceKnowledge.read({
      projectId: PROJECT_ID,
      services: many,
    });

    expect(
      lessons.map((lesson: ServiceLessons): string => {
        return lesson.service.name;
      }),
    ).toEqual(["checkout", "payments"]);
    expect(lessons[1]!.failureModes).toHaveLength(2);

    const query: JSONObject = monitorReads[0]!.query as unknown as JSONObject;
    expect((query["services"] as Array<unknown>).length).toBe(MAX_SERVICES);
  });

  test("at most a few failures per service", async () => {
    incidentsByService = [
      "Disk full on the log volume",
      "TLS certificate expired",
      "DNS name resolution failed",
      "Out of memory in the worker",
      "Rate limited by the payment provider",
    ].map((cause: string, index: number): Incident => {
      return incident({
        index: index + 1,
        rootCause: cause,
        services: [CHECKOUT],
      });
    });

    const lessons: Array<ServiceLessons> = await ServiceKnowledge.read({
      projectId: PROJECT_ID,
      services: [CHECKOUT],
    });

    expect(lessons[0]!.failureModes).toHaveLength(MAX_FAILURE_MODES);
  });

  test("no services: nothing is read", async () => {
    expect(
      await ServiceKnowledge.read({ projectId: PROJECT_ID, services: [] }),
    ).toEqual([]);
    expect(
      await ServiceKnowledge.getContextSection({
        projectId: PROJECT_ID,
        services: [],
      }),
    ).toBe("");
    expect(monitorReads).toHaveLength(0);
    expect(incidentReads).toHaveLength(0);
  });

  test("nothing here throws: a failed read is no knowledge", async () => {
    (
      IncidentService.findBy as unknown as SpyInstance<
        typeof IncidentService.findBy
      >
    ).mockRejectedValue(new Error("Database not connected"));

    expect(
      await ServiceKnowledge.getContextSection({
        projectId: PROJECT_ID,
        services: [CHECKOUT],
      }),
    ).toBe("");
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("the services a subject is on", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an incident's own services, then its monitors', each once", async () => {
    const current: Incident = new Incident(CURRENT_INCIDENT);
    current.services = [serviceRow(PAYMENTS)];
    current.monitors = [new Monitor(CHECKOUT_MONITOR)];

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(current);
    jest.spyOn(MonitorService, "findBy").mockImplementation(async () => {
      const monitor: Monitor = new Monitor(CHECKOUT_MONITOR);
      monitor.services = [serviceRow(CHECKOUT), serviceRow(PAYMENTS)];
      return [monitor];
    });

    expect(
      await ServiceKnowledge.readServicesOfIncident({
        projectId: PROJECT_ID,
        incidentId: CURRENT_INCIDENT,
      }),
    ).toEqual([PAYMENTS, CHECKOUT]);
  });

  test("an incident that cannot be read is on no service", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockRejectedValue(new Error("Database not connected"));

    expect(
      await ServiceKnowledge.readServicesOfIncident({
        projectId: PROJECT_ID,
        incidentId: CURRENT_INCIDENT,
      }),
    ).toEqual([]);
  });

  test("an alert's own services stand when its monitor's cannot be read", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest
      .spyOn(MonitorService, "findBy")
      .mockRejectedValue(new Error("Database not connected"));

    expect(
      await ServiceKnowledge.readServicesOfAlert({
        projectId: PROJECT_ID,
        services: [serviceRow(CHECKOUT)],
        monitorId: CHECKOUT_MONITOR,
      }),
    ).toEqual([CHECKOUT]);
  });
});
