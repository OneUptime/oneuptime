import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorLabelRuleEngineService from "../../../Server/Services/MonitorLabelRuleEngineService";
import MonitorOwnerRuleEngineService from "../../../Server/Services/MonitorOwnerRuleEngineService";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../Server/Services/MonitorService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import StatusPageMonitorRuleEngineService from "../../../Server/Services/StatusPageMonitorRuleEngineService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import ProbeStatusMonitorEvaluator from "../../../Server/Utils/Monitor/ProbeStatusMonitorEvaluator";
import URL from "../../../Types/API/URL";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * A Probe Status monitor is judged by the server, not by a probe, so nothing
 * would judge it until the next minute's sweep. MonitorService judges it at
 * the two moments someone is looking at it: right after it is created - the
 * create form opens the monitor's page, which should already say whether
 * its probes are connected - and right after the probes it watches change.
 *
 * Neither may cost the save anything: the create's follow-up work runs on a
 * detached chain, the update's evaluation is not awaited, and a failure in
 * either is logged and never thrown. Every other monitor type is left alone.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "75000000-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "75000000-0000-4000-8000-0000000000a1",
);
const MONITOR_STATUS_ID: ObjectID = new ObjectID(
  "75000000-0000-4000-8000-0000000000b1",
);
const PROBE_ID: string = "75000000-0000-4000-8000-0000000000c1";

// Calls a protected hook without widening the service's public surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = MonitorService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(MonitorService, args);
}

function monitorOf(monitorType: MonitorType): Monitor {
  return {
    id: MONITOR_ID,
    _id: MONITOR_ID.toString(),
    projectId: PROJECT_ID,
    name: "Probe health",
    monitorType: monitorType,
    currentMonitorStatusId: MONITOR_STATUS_ID,
  } as unknown as Monitor;
}

function stepsWatching(probeIds: Array<string>): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.setProbeStatusMonitor({ probeIds: probeIds });

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };
  return steps;
}

function onCreate(monitor: Monitor): OnCreate<Monitor> {
  return {
    createBy: {
      data: monitor,
      props: { isRoot: true, tenantId: PROJECT_ID },
    } as unknown as CreateBy<Monitor>,
    carryForward: null,
  };
}

function onUpdate(data: Record<string, unknown>): OnUpdate<Monitor> {
  return {
    updateBy: {
      query: { _id: MONITOR_ID.toString() },
      data: data,
      props: { isRoot: true, tenantId: PROJECT_ID },
    } as unknown as UpdateBy<Monitor>,
    carryForward: null,
  };
}

/*
 * The create's chain is detached, so poll for its effect instead of
 * awaiting the hook. Gives up after ~2s so a regression fails loudly.
 */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 200; attempt++) {
    if (predicate()) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }
}

// Every step of the follow-up work, in the order it ran.
const calls: Array<string> = [];
let storedMonitor: Monitor;
let evaluate: jest.SpiedFunction<
  typeof ProbeStatusMonitorEvaluator.evaluateMonitorById
>;
let loggedErrors: jest.SpiedFunction<typeof logger.error>;

beforeEach(() => {
  calls.length = 0;
  storedMonitor = monitorOf(MonitorType.ProbeStatus);

  evaluate = jest
    .spyOn(ProbeStatusMonitorEvaluator, "evaluateMonitorById")
    .mockImplementation(async (monitorId: ObjectID): Promise<void> => {
      calls.push(`evaluate ${monitorId.toString()}`);
    });

  loggedErrors = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });

  jest
    .spyOn(MonitorService, "findOneById")
    .mockImplementation((async (): Promise<Monitor> => {
      return storedMonitor;
    }) as never);

  // The rest of the create's follow-up work, which is other tests' subject.
  const service: never = MonitorService as never;

  jest
    .spyOn(service, "handleWorkspaceOperationsAsync" as never)
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(service, "addProbesToMonitor" as never)
    .mockResolvedValue(undefined as never);
  jest.spyOn(service, "changeMonitorStatus" as never).mockImplementation((async (
    _projectId: ObjectID,
    monitorIds: Array<ObjectID>,
  ): Promise<void> => {
    calls.push(`first status ${monitorIds[0]!.toString()}`);
  }) as never);
  jest
    .spyOn(service, "refreshMonitorProbeStatus" as never)
    .mockImplementation((async (): Promise<void> => {
      calls.push("refresh probe status");
    }) as never);
  jest
    .spyOn(MonitorLabelRuleEngineService, "applyRulesToMonitor")
    .mockResolvedValue(undefined);
  jest
    .spyOn(MonitorOwnerRuleEngineService, "applyRulesToMonitor")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ServiceLevelObjectiveMonitorRuleEngineService, "syncSlosForMonitor")
    .mockResolvedValue([]);
  jest
    .spyOn(StatusPageMonitorRuleEngineService, "syncRulesForMonitor")
    .mockResolvedValue([]);

  // And what an update of the steps does besides.
  jest
    .spyOn(MonitorService, "getMonitorLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/monitor") as never,
    );
  jest
    .spyOn(MonitorProbeService, "pruneStaleLastMonitoringLogEntries")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorProbeService, "updateNextPingAtForMonitor")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorService: a Probe Status monitor is judged as soon as it is created", () => {
  it("evaluates it once, after its first status is written", async () => {
    await callHook("onCreateSuccess", onCreate(storedMonitor), storedMonitor);

    await waitFor(() => {
      return evaluate.mock.calls.length > 0;
    });

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0]![0].toString()).toBe(MONITOR_ID.toString());
    expect(calls).toEqual([
      `first status ${MONITOR_ID.toString()}`,
      "refresh probe status",
      `evaluate ${MONITOR_ID.toString()}`,
    ]);
  });

  it("leaves every other monitor type to its probes", async () => {
    for (const monitorType of [
      MonitorType.Manual,
      MonitorType.Ping,
      MonitorType.IncomingRequest,
    ]) {
      calls.length = 0;
      storedMonitor = monitorOf(monitorType);

      await callHook("onCreateSuccess", onCreate(storedMonitor), storedMonitor);

      // The last step before the evaluation's: the chain has run its course.
      await waitFor(() => {
        return calls.includes("refresh probe status");
      });
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
    }

    expect(evaluate).not.toHaveBeenCalled();
  });

  it("logs an evaluation that fails and never fails the create", async () => {
    evaluate.mockRejectedValue(new Error("probe table locked"));

    await expect(
      callHook("onCreateSuccess", onCreate(storedMonitor), storedMonitor),
    ).resolves.toBeDefined();

    await waitFor(() => {
      return loggedErrors.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          typeof call[0] === "string" &&
          call[0].includes("First Probe Status evaluation failed")
        );
      });
    });

    expect(
      loggedErrors.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          call[0] instanceof Error &&
          call[0].message === "probe table locked"
        );
      }),
    ).toBe(true);
    // Its own catch: the chain's last-resort handler never saw it.
    expect(
      loggedErrors.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          typeof call[0] === "string" &&
          call[0].includes("Critical error in MonitorService")
        );
      }),
    ).toBe(false);
  });
});

describe("MonitorService: changing the probes a Probe Status monitor watches judges it again", () => {
  it("evaluates it when its steps are written, without the save waiting for it", async () => {
    let finishEvaluation: () => void = (): void => {};
    evaluate.mockImplementation((): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        finishEvaluation = resolve;
      });
    });

    // The save returns while the evaluation is still running.
    await expect(
      callHook(
        "onUpdateSuccess",
        onUpdate({ monitorSteps: stepsWatching([PROBE_ID]) }),
        [MONITOR_ID],
      ),
    ).resolves.toBeDefined();

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0]![0].toString()).toBe(MONITOR_ID.toString());

    finishEvaluation();
  });

  it("logs an evaluation that fails, and the save still succeeds", async () => {
    evaluate.mockRejectedValue(new Error("probe table locked"));

    await expect(
      callHook(
        "onUpdateSuccess",
        onUpdate({ monitorSteps: stepsWatching([PROBE_ID]) }),
        [MONITOR_ID],
      ),
    ).resolves.toBeDefined();

    await waitFor(() => {
      return loggedErrors.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          typeof call[0] === "string" &&
          call[0].includes("Probe Status evaluation after an update failed")
        );
      });
    });

    expect(
      loggedErrors.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          call[0] instanceof Error &&
          call[0].message === "probe table locked"
        );
      }),
    ).toBe(true);
  });

  it("evaluates nothing when the steps are not written", async () => {
    await callHook("onUpdateSuccess", onUpdate({ name: "Probe health (EU)" }), [
      MONITOR_ID,
    ]);
    await callHook(
      "onUpdateSuccess",
      onUpdate({ monitoringInterval: "*/5 * * * *" }),
      [MONITOR_ID],
    );

    expect(evaluate).not.toHaveBeenCalled();
  });

  it("evaluates nothing when another monitor type's steps are written", async () => {
    storedMonitor = monitorOf(MonitorType.Ping);

    await callHook(
      "onUpdateSuccess",
      onUpdate({ monitorSteps: stepsWatching([]) }),
      [MONITOR_ID],
    );

    expect(evaluate).not.toHaveBeenCalled();
  });
});
