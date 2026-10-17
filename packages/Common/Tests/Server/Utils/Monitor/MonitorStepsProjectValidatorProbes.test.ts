import MonitorStepsProjectValidator from "../../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import MonitorStepsReferenceExtractor from "../../../../Server/Utils/Monitor/MonitorStepsReferenceExtractor";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import ProbeService from "../../../../Server/Services/ProbeService";
import Probe from "../../../../Models/DatabaseModels/Probe";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { MockInstance } from "jest-mock";

/*
 * Which probes a Probe Status monitor may watch: the ones its monitors could
 * run on - this project's own and the global probes - and nothing else. The
 * ids come from the browser, the API and Terraform alike; watching another
 * project's probe would let this project read its name and whether it is up.
 * A probe the monitor already watches is never re-checked, so one deleted
 * since does not refuse every later edit.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OWN_PROBE: string = "73000000-0000-4000-8000-000000000001";
const GLOBAL_PROBE: string = "73000000-0000-4000-8000-000000000004";
const FOREIGN_PROBE: string = "73000000-0000-4000-8000-000000000009";

function stepsWatching(...probeIdLists: Array<Array<string>>): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: probeIdLists.map(
      (probeIds: Array<string>): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.setProbeStatusMonitor({ probeIds: probeIds });
        return step;
      },
    ),
    defaultMonitorStatusId: undefined,
  };
  return steps;
}

function probe(id: string): Probe {
  const item: Probe = new Probe();
  item._id = id;
  return item;
}

let attachable: MockInstance<typeof ProbeService.getProbesAttachableToProject>;

beforeEach(() => {
  // The probes this project may use: its own, and the global one.
  attachable = jest
    .spyOn(ProbeService, "getProbesAttachableToProject")
    .mockImplementation(
      async (data: {
        probeIds: Array<ObjectID>;
        projectId: ObjectID;
      }): Promise<Array<Probe>> => {
        return data.probeIds
          .map((id: ObjectID): string => {
            return id.toString().toLowerCase();
          })
          .filter((id: string): boolean => {
            return id === OWN_PROBE || id === GLOBAL_PROBE;
          })
          .map(probe);
      },
    );

  // The other references in the steps are another test's subject.
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorStepsReferenceExtractor.extractWatchedProbeIds", () => {
  it("reads every step's probes, each once, from a MonitorSteps or its JSON", () => {
    const steps: MonitorSteps = stepsWatching(
      [OWN_PROBE, GLOBAL_PROBE],
      [GLOBAL_PROBE.toUpperCase(), FOREIGN_PROBE],
    );

    expect(
      MonitorStepsReferenceExtractor.extractWatchedProbeIds(steps),
    ).toEqual([OWN_PROBE, GLOBAL_PROBE, FOREIGN_PROBE]);
    expect(
      MonitorStepsReferenceExtractor.extractWatchedProbeIds(
        JSON.parse(JSON.stringify(steps.toJSON())) as JSONObject,
      ),
    ).toEqual([OWN_PROBE, GLOBAL_PROBE, FOREIGN_PROBE]);
  });

  it("reads a hand-written payload without the envelopes, and ids in either shape", () => {
    expect(
      MonitorStepsReferenceExtractor.extractWatchedProbeIds({
        monitorStepsInstanceArray: [
          {
            probeStatusMonitor: {
              probeIds: [
                OWN_PROBE,
                { _type: "ObjectID", value: GLOBAL_PROBE },
                "",
                7,
              ],
            },
          },
        ],
      } as unknown as JSONObject),
    ).toEqual([OWN_PROBE, GLOBAL_PROBE]);
  });

  it("finds nothing in steps of other monitor types, or no steps", () => {
    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: [new MonitorStep()],
      defaultMonitorStatusId: undefined,
    };

    expect(
      MonitorStepsReferenceExtractor.extractWatchedProbeIds(steps),
    ).toEqual([]);
    expect(MonitorStepsReferenceExtractor.extractWatchedProbeIds(null)).toEqual(
      [],
    );
    expect(
      MonitorStepsReferenceExtractor.extractWatchedProbeIds(undefined),
    ).toEqual([]);
  });

  it("is not reported as a project reference: a global probe belongs to no project", () => {
    expect(
      MonitorStepsReferenceExtractor.extract(stepsWatching([OWN_PROBE])).filter(
        (reference: { id: string }): boolean => {
          return reference.id === OWN_PROBE;
        },
      ),
    ).toEqual([]);
  });
});

describe("MonitorStepsProjectValidator: the probes a monitor watches", () => {
  it("accepts this project's own probe and a global one", async () => {
    await expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stepsWatching([OWN_PROBE, GLOBAL_PROBE]),
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    expect(attachable).toHaveBeenCalledTimes(1);
    const args: Parameters<
      typeof ProbeService.getProbesAttachableToProject
    >[0] = attachable.mock.calls[0]![0];
    expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(
      args.probeIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([OWN_PROBE, GLOBAL_PROBE]);
  });

  it("refuses another project's probe, naming it, and saves nothing", async () => {
    await expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stepsWatching([OWN_PROBE, FOREIGN_PROBE]),
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(
      new BadDataException(
        `A Probe Status monitor can watch this project's own probes and the global probes. This project has no probe with the ID ${FOREIGN_PROBE}.`,
      ),
    );
  });

  it("refuses a probe that does not exist, in any step", async () => {
    const missing: string = "73000000-0000-4000-8000-000000000077";

    await expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stepsWatching([OWN_PROBE], [missing]),
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("refuses an id that is not one before asking the database anything", async () => {
    await expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stepsWatching(["probe-1"]),
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(
      '"probe-1" is not a probe ID. A Probe Status monitor watches probes by their ID.',
    );
    expect(attachable).not.toHaveBeenCalled();
  });

  it("compares ids without regard to case", async () => {
    await expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stepsWatching([OWN_PROBE.toUpperCase()]),
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("leaves alone a probe the monitor already watches, even one deleted since", async () => {
    const deleted: string = "73000000-0000-4000-8000-000000000066";

    await expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stepsWatching([deleted, OWN_PROBE]),
        projectId: PROJECT_ID,
        alreadyStoredMonitorSteps: stepsWatching([deleted.toUpperCase()]),
      }),
    ).resolves.toBeUndefined();

    // Only what this write introduces is asked about.
    expect(
      attachable.mock.calls[0]![0].probeIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([OWN_PROBE]);
  });

  it("asks nothing when the write introduces no probe", async () => {
    await MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
      monitorSteps: stepsWatching([OWN_PROBE]),
      projectId: PROJECT_ID,
      alreadyStoredMonitorSteps: stepsWatching([OWN_PROBE]),
    });

    await MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
      monitorSteps: stepsWatching([]),
      projectId: PROJECT_ID,
    });

    expect(attachable).not.toHaveBeenCalled();
  });

  it("is skipped without a project, as the rest of the validation is", async () => {
    await expect(
      MonitorStepsProjectValidator.validateMonitorStepsBelongToProject({
        monitorSteps: stepsWatching([FOREIGN_PROBE]),
        projectId: undefined,
      }),
    ).resolves.toBeUndefined();
    expect(attachable).not.toHaveBeenCalled();
  });
});
