import ProbeStatusMonitorEvaluator from "../../../../Server/Utils/Monitor/ProbeStatusMonitorEvaluator";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorService from "../../../../Server/Services/MonitorService";
import ProbeService from "../../../../Server/Services/ProbeService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Probe, {
  ProbeConnectionStatus,
} from "../../../../Models/DatabaseModels/Probe";
import Dictionary from "../../../../Types/Dictionary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ProbeStatusMonitorResponse from "../../../../Types/Monitor/ProbeStatusMonitor/ProbeStatusMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { getJestSpyOn } from "../../../Spy";

/*
 * ProbeStatusMonitorEvaluator: what a Probe Status monitor is judged on and
 * when. The minute sweep and a probe's flip both come through here, so this
 * is where "never another project's probe", "a step with nothing left to
 * watch keeps its status" and "one failure does not silence the rest" are
 * held. MonitorResource (the pipeline every monitor goes through) is
 * replaced: what reaches it is the contract.
 */

jest.mock("../../../../Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: { monitorResource: jest.fn() },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const FRANKFURT: string = "73000000-0000-4000-8000-000000000001";
const SINGAPORE: string = "73000000-0000-4000-8000-000000000003";
const GLOBAL: string = "73000000-0000-4000-8000-000000000004";

type FindByArgs = Parameters<typeof ProbeService.findBy>[0];
type MonitorFindByArgs = Parameters<typeof MonitorService.findBy>[0];

// The ids QueryHelper.any was given (it builds a Raw IN operator).
function idsIn(operator: unknown): Array<string> {
  const raw: { objectLiteralParameters?: Dictionary<unknown> } = operator as {
    objectLiteralParameters?: Dictionary<unknown>;
  };

  return (
    Object.values(raw.objectLiteralParameters || {}) as Array<
      Array<string | ObjectID>
    >
  )
    .flat()
    .map((id: string | ObjectID): string => {
      return id.toString().toLowerCase();
    });
}

function makeProbe(
  id: string,
  name: string,
  status: ProbeConnectionStatus | undefined,
  isGlobalProbe: boolean = false,
): Probe {
  const probe: Probe = new Probe();
  probe._id = id;
  probe.name = name;
  if (status) {
    probe.connectionStatus = status;
  }
  probe.isGlobalProbe = isGlobalProbe;
  probe.lastAlive = new Date("2026-09-21T11:59:30.000Z");
  return probe;
}

function stepWatching(probeIds: Array<string>): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setProbeStatusMonitor({ probeIds: probeIds });
  return step;
}

function makeMonitor(data: {
  id?: ObjectID;
  steps: Array<MonitorStep>;
  monitorType?: MonitorType;
  isDisabled?: boolean;
  isArchived?: boolean;
  projectId?: ObjectID;
}): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = data.id || ObjectID.generate();
  monitor.projectId = data.projectId || PROJECT_ID;
  monitor.monitorType = data.monitorType || MonitorType.ProbeStatus;
  monitor.isArchived = Boolean(data.isArchived);
  monitor.disableActiveMonitoring = Boolean(data.isDisabled);
  monitor.disableActiveMonitoringBecauseOfManualIncident = false;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: data.steps,
    defaultMonitorStatusId: ObjectID.generate(),
  };
  monitor.monitorSteps = steps;

  return monitor;
}

let probeFindBy: jest.SpyInstance<any, any>;
let monitorResource: jest.Mock;

/*
 * The probe table as the two reads see it: global probes by the global
 * query, a project's own probes only by a query for that project.
 */
function serveProbes(probes: {
  global: Array<Probe>;
  byProject: Dictionary<Array<Probe>>;
}): void {
  probeFindBy.mockImplementation(async (args: FindByArgs) => {
    const ids: Array<string> = idsIn(args.query._id);
    const pick: (list: Array<Probe>) => Array<Probe> = (
      list: Array<Probe>,
    ): Array<Probe> => {
      return list.filter((probe: Probe): boolean => {
        return ids.includes(probe._id!.toLowerCase());
      });
    };

    if (args.query.isGlobalProbe === true) {
      return pick(probes.global);
    }

    return pick(
      probes.byProject[(args.query.projectId as ObjectID).toString()] || [],
    );
  });
}

beforeEach(() => {
  probeFindBy = getJestSpyOn(ProbeService, "findBy");
  monitorResource = MonitorResourceUtil.monitorResource as unknown as jest.Mock;
  monitorResource.mockReset();
  monitorResource.mockImplementation(async () => {
    return {};
  });
  getJestSpyOn(logger, "debug").mockImplementation(() => {});
  getJestSpyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("findWatchableProbes", () => {
  test("reads the global probes and this project's own, in two queries", async () => {
    serveProbes({
      global: [makeProbe(GLOBAL, "Self-hosted probe", undefined, true)],
      byProject: {
        [PROJECT_ID.toString()]: [makeProbe(FRANKFURT, "Frankfurt", undefined)],
      },
    });

    const probes: Array<Probe> =
      await ProbeStatusMonitorEvaluator.findWatchableProbes({
        projectId: PROJECT_ID,
        probeIds: [FRANKFURT, GLOBAL],
      });

    expect(
      probes.map((probe: Probe): string => {
        return probe._id!;
      }),
    ).toEqual([GLOBAL, FRANKFURT]);

    expect(probeFindBy).toHaveBeenCalledTimes(2);
    const queries: Array<FindByArgs["query"]> = probeFindBy.mock.calls.map(
      (call: Array<unknown>): FindByArgs["query"] => {
        return (call[0] as FindByArgs).query;
      },
    );

    const globalQuery: FindByArgs["query"] = queries.find(
      (query: FindByArgs["query"]): boolean => {
        return query.isGlobalProbe === true;
      },
    )!;
    const projectQuery: FindByArgs["query"] = queries.find(
      (query: FindByArgs["query"]): boolean => {
        return query.isGlobalProbe === false;
      },
    )!;

    expect(globalQuery.projectId).toBeUndefined();
    expect((projectQuery.projectId as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    for (const query of queries) {
      expect(idsIn(query._id).sort()).toEqual([FRANKFURT, GLOBAL].sort());
    }
  });

  test("never reads another project's probe, whatever the step names", async () => {
    serveProbes({
      global: [],
      byProject: {
        [OTHER_PROJECT_ID.toString()]: [
          makeProbe(
            SINGAPORE,
            "Someone else's",
            ProbeConnectionStatus.Connected,
          ),
        ],
      },
    });

    const probes: Array<Probe> =
      await ProbeStatusMonitorEvaluator.findWatchableProbes({
        projectId: PROJECT_ID,
        probeIds: [SINGAPORE],
      });

    expect(probes).toEqual([]);
  });

  test("selects only what the evaluation reads: no key, no owners", async () => {
    serveProbes({ global: [], byProject: {} });

    await ProbeStatusMonitorEvaluator.findWatchableProbes({
      projectId: PROJECT_ID,
      probeIds: [FRANKFURT],
    });

    for (const call of probeFindBy.mock.calls) {
      expect((call[0] as FindByArgs).select).toEqual({
        _id: true,
        name: true,
        isGlobalProbe: true,
        connectionStatus: true,
        lastAlive: true,
      });
      expect((call[0] as FindByArgs).props.isRoot).toBe(true);
    }
  });

  test("an id that is not a uuid is never sent to the database", async () => {
    serveProbes({ global: [], byProject: {} });

    expect(
      await ProbeStatusMonitorEvaluator.findWatchableProbes({
        projectId: PROJECT_ID,
        probeIds: ["probe-1", "", "   "],
      }),
    ).toEqual([]);
    expect(probeFindBy).not.toHaveBeenCalled();

    await ProbeStatusMonitorEvaluator.findWatchableProbes({
      projectId: PROJECT_ID,
      probeIds: ["probe-1", FRANKFURT, FRANKFURT.toUpperCase()],
    });

    for (const call of probeFindBy.mock.calls) {
      expect(idsIn((call[0] as FindByArgs).query._id)).toEqual([FRANKFURT]);
    }
  });
});

describe("buildResponses", () => {
  beforeEach(() => {
    serveProbes({
      global: [
        makeProbe(
          GLOBAL,
          "Self-hosted probe",
          ProbeConnectionStatus.Connected,
          true,
        ),
      ],
      byProject: {
        [PROJECT_ID.toString()]: [
          makeProbe(FRANKFURT, "Frankfurt", ProbeConnectionStatus.Connected),
          makeProbe(SINGAPORE, "Singapore", ProbeConnectionStatus.Disconnected),
        ],
      },
    });
  });

  test("one evaluation per step, of the probes it names, at the given time", async () => {
    const first: MonitorStep = stepWatching([FRANKFURT, SINGAPORE]);
    const second: MonitorStep = stepWatching([GLOBAL]);
    const monitor: Monitor = makeMonitor({ steps: [first, second] });
    const checkedAt: Date = new Date("2026-09-21T12:00:00.000Z");

    const responses: Array<ProbeStatusMonitorResponse> =
      await ProbeStatusMonitorEvaluator.buildResponses({
        monitor: monitor,
        checkedAt: checkedAt,
      });

    expect(responses).toHaveLength(2);
    expect(responses[0]!.monitorStepId.toString()).toBe(first.id.toString());
    expect(responses[0]!.monitorId.toString()).toBe(monitor.id!.toString());
    expect(responses[0]!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(responses[0]!.connectedProbeCount).toBe(1);
    expect(responses[0]!.disconnectedProbeCount).toBe(1);
    expect(responses[0]!.checkedAt).toBe(checkedAt);
    expect(responses[1]!.monitorStepId.toString()).toBe(second.id.toString());
    expect(responses[1]!.probes[0]!.isGlobalProbe).toBe(true);
  });

  test("a step naming no probe yields nothing", async () => {
    const monitor: Monitor = makeMonitor({
      steps: [new MonitorStep(), stepWatching([])],
    });

    expect(
      await ProbeStatusMonitorEvaluator.buildResponses({ monitor: monitor }),
    ).toEqual([]);
    expect(probeFindBy).not.toHaveBeenCalled();
  });

  test("a step whose probes are all gone keeps the monitor as it is: no evaluation", async () => {
    const gone: string = "73000000-0000-4000-8000-000000000099";
    const monitor: Monitor = makeMonitor({ steps: [stepWatching([gone])] });

    expect(
      await ProbeStatusMonitorEvaluator.buildResponses({ monitor: monitor }),
    ).toEqual([]);
  });

  test("a step with some probes gone counts the rest and lists the gone", async () => {
    const gone: string = "73000000-0000-4000-8000-000000000099";
    const monitor: Monitor = makeMonitor({
      steps: [stepWatching([gone, FRANKFURT])],
    });

    const [response]: Array<ProbeStatusMonitorResponse> =
      await ProbeStatusMonitorEvaluator.buildResponses({ monitor: monitor });

    expect(response!.missingProbeIds).toEqual([gone]);
    expect(response!.connectedProbeCount).toBe(1);
    expect(response!.disconnectedProbeCount).toBe(0);
  });

  test("a monitor with no id or no project is not evaluated", async () => {
    const monitor: Monitor = makeMonitor({
      steps: [stepWatching([FRANKFURT])],
    });
    (monitor as unknown as { projectId: ObjectID | undefined }).projectId =
      undefined;

    expect(
      await ProbeStatusMonitorEvaluator.buildResponses({ monitor: monitor }),
    ).toEqual([]);
  });
});

describe("evaluateMonitor", () => {
  beforeEach(() => {
    serveProbes({
      global: [],
      byProject: {
        [PROJECT_ID.toString()]: [
          makeProbe(FRANKFURT, "Frankfurt", ProbeConnectionStatus.Disconnected),
        ],
      },
    });
  });

  test("hands every step's evaluation to the monitor pipeline", async () => {
    const monitor: Monitor = makeMonitor({
      steps: [stepWatching([FRANKFURT]), stepWatching([FRANKFURT])],
    });

    await ProbeStatusMonitorEvaluator.evaluateMonitor(monitor);

    expect(monitorResource).toHaveBeenCalledTimes(2);
    const response: ProbeStatusMonitorResponse = monitorResource.mock
      .calls[0]![0] as ProbeStatusMonitorResponse;
    expect(response.disconnectedProbeCount).toBe(1);
    expect(response.probes[0]!.probeName).toBe("Frankfurt");
  });

  test("a paused monitor - off, archived - is not evaluated at all", async () => {
    for (const monitor of [
      makeMonitor({ steps: [stepWatching([FRANKFURT])], isDisabled: true }),
      makeMonitor({ steps: [stepWatching([FRANKFURT])], isArchived: true }),
    ]) {
      await ProbeStatusMonitorEvaluator.evaluateMonitor(monitor);
    }

    expect(probeFindBy).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("a monitor of another type is left alone", async () => {
    await ProbeStatusMonitorEvaluator.evaluateMonitor(
      makeMonitor({
        steps: [stepWatching([FRANKFURT])],
        monitorType: MonitorType.Ping,
      }),
    );

    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("what the pipeline throws is the caller's to log", async () => {
    monitorResource.mockRejectedValueOnce(new Error("Monitor is archived"));

    await expect(
      ProbeStatusMonitorEvaluator.evaluateMonitor(
        makeMonitor({ steps: [stepWatching([FRANKFURT])] }),
      ),
    ).rejects.toThrow("Monitor is archived");
  });
});

describe("evaluateMonitorById", () => {
  test("reads the monitor as stored now and evaluates it", async () => {
    serveProbes({
      global: [],
      byProject: {
        [PROJECT_ID.toString()]: [
          makeProbe(FRANKFURT, "Frankfurt", ProbeConnectionStatus.Connected),
        ],
      },
    });
    const monitor: Monitor = makeMonitor({
      steps: [stepWatching([FRANKFURT])],
    });
    const findOneById: jest.SpyInstance<any, any> = getJestSpyOn(
      MonitorService,
      "findOneById",
    ).mockResolvedValue(monitor);

    await ProbeStatusMonitorEvaluator.evaluateMonitorById(monitor.id!);

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById.mock.calls[0]![0].select).toBe(
      ProbeStatusMonitorEvaluator.MONITOR_SELECT,
    );
    expect(monitorResource).toHaveBeenCalledTimes(1);
  });

  test("a monitor that is gone, or not a Probe Status monitor, is skipped", async () => {
    const findOneById: jest.SpyInstance<any, any> = getJestSpyOn(
      MonitorService,
      "findOneById",
    );

    findOneById.mockResolvedValueOnce(null);
    await ProbeStatusMonitorEvaluator.evaluateMonitorById(ObjectID.generate());

    findOneById.mockResolvedValueOnce(
      makeMonitor({ steps: [], monitorType: MonitorType.API }),
    );
    await ProbeStatusMonitorEvaluator.evaluateMonitorById(ObjectID.generate());

    expect(monitorResource).not.toHaveBeenCalled();
  });
});

describe("findMonitorsWatchingProbe", () => {
  let monitorFindBy: jest.SpyInstance<any, any>;

  beforeEach(() => {
    monitorFindBy = getJestSpyOn(MonitorService, "findBy");
  });

  test("a project's probe: that project's checked Probe Status monitors that name it", async () => {
    const watching: Monitor = makeMonitor({
      steps: [stepWatching([SINGAPORE, FRANKFURT.toUpperCase()])],
    });
    const notWatching: Monitor = makeMonitor({
      steps: [stepWatching([SINGAPORE])],
    });
    monitorFindBy.mockResolvedValueOnce([watching, notWatching]);

    const monitors: Array<Monitor> =
      await ProbeStatusMonitorEvaluator.findMonitorsWatchingProbe({
        probeId: new ObjectID(FRANKFURT),
        projectId: PROJECT_ID,
        isGlobalProbe: false,
      });

    expect(monitors).toEqual([watching]);

    const args: MonitorFindByArgs = monitorFindBy.mock
      .calls[0]![0] as MonitorFindByArgs;
    expect(args.query.monitorType).toBe(MonitorType.ProbeStatus);
    expect((args.query.projectId as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    // Only monitors that are checked: the same rule as every sweep.
    expect(args.query).toEqual(
      expect.objectContaining(MonitorService.getEnabledMonitorQuery()),
    );
    // Active projects only (its operators carry random parameter names).
    expect(
      Object.keys(args.query.project as Record<string, unknown>).sort(),
    ).toEqual(Object.keys(ProjectService.getActiveProjectStatusQuery()).sort());
    expect(args.select).toBe(ProbeStatusMonitorEvaluator.MONITOR_SELECT);
  });

  test("a global probe: every project's monitors that name it", async () => {
    monitorFindBy.mockResolvedValueOnce([]);

    await ProbeStatusMonitorEvaluator.findMonitorsWatchingProbe({
      probeId: new ObjectID(GLOBAL),
      projectId: undefined,
      isGlobalProbe: true,
    });

    const args: MonitorFindByArgs = monitorFindBy.mock
      .calls[0]![0] as MonitorFindByArgs;
    expect(args.query.projectId).toBeUndefined();
  });

  test("a probe of no project that is not global is watched by nobody", async () => {
    expect(
      await ProbeStatusMonitorEvaluator.findMonitorsWatchingProbe({
        probeId: new ObjectID(FRANKFURT),
      }),
    ).toEqual([]);
    expect(monitorFindBy).not.toHaveBeenCalled();
  });

  test("pages through every candidate by id until a short page", async () => {
    const pageSize: number = ProbeStatusMonitorEvaluator.WATCHER_PAGE_SIZE;
    const firstPage: Array<Monitor> = Array.from(
      { length: pageSize },
      (): Monitor => {
        return makeMonitor({ steps: [stepWatching([SINGAPORE])] });
      },
    );
    const lastWatcher: Monitor = makeMonitor({
      steps: [stepWatching([FRANKFURT])],
    });

    monitorFindBy
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([lastWatcher]);

    const monitors: Array<Monitor> =
      await ProbeStatusMonitorEvaluator.findMonitorsWatchingProbe({
        probeId: new ObjectID(FRANKFURT),
        projectId: PROJECT_ID,
      });

    expect(monitors).toEqual([lastWatcher]);
    expect(monitorFindBy).toHaveBeenCalledTimes(2);

    const second: MonitorFindByArgs = monitorFindBy.mock
      .calls[1]![0] as MonitorFindByArgs;
    expect(second.query._id).toBeDefined();
    expect(second.skip).toBe(0);
    expect(second.limit).toBe(pageSize);
  });
});

describe("evaluateMonitorsWatchingProbe", () => {
  test("evaluates every watcher, and one failing does not stop the rest", async () => {
    const probeRow: Probe = makeProbe(
      FRANKFURT,
      "Frankfurt",
      ProbeConnectionStatus.Disconnected,
    );
    probeRow.projectId = PROJECT_ID;
    getJestSpyOn(ProbeService, "findOneById").mockResolvedValue(probeRow);
    serveProbes({
      global: [],
      byProject: { [PROJECT_ID.toString()]: [probeRow] },
    });

    const first: Monitor = makeMonitor({ steps: [stepWatching([FRANKFURT])] });
    const second: Monitor = makeMonitor({ steps: [stepWatching([FRANKFURT])] });
    getJestSpyOn(MonitorService, "findBy").mockResolvedValueOnce([
      first,
      second,
    ]);

    monitorResource
      .mockRejectedValueOnce(new Error("lock held"))
      .mockResolvedValueOnce({});

    await expect(
      ProbeStatusMonitorEvaluator.evaluateMonitorsWatchingProbe(
        new ObjectID(FRANKFURT),
      ),
    ).resolves.toBeUndefined();

    expect(monitorResource).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalled();
  });

  test("never throws, even when the probe cannot be read", async () => {
    getJestSpyOn(ProbeService, "findOneById").mockRejectedValue(
      new Error("database is down"),
    );

    await expect(
      ProbeStatusMonitorEvaluator.evaluateMonitorsWatchingProbe(
        new ObjectID(FRANKFURT),
      ),
    ).resolves.toBeUndefined();
    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("a probe that is gone has nobody to evaluate", async () => {
    getJestSpyOn(ProbeService, "findOneById").mockResolvedValue(null);
    const findBy: jest.SpyInstance<any, any> = getJestSpyOn(
      MonitorService,
      "findBy",
    );

    await ProbeStatusMonitorEvaluator.evaluateMonitorsWatchingProbe(
      new ObjectID(FRANKFURT),
    );

    expect(findBy).not.toHaveBeenCalled();
  });
});
