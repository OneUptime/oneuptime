import MonitorService from "../../../Server/Services/MonitorService";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import ProbeService from "../../../Server/Services/ProbeService";
import ProjectService from "../../../Server/Services/ProjectService";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import Probe from "../../../Models/DatabaseModels/Probe";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * Probe assignment at monitor-create time.
 *
 * Before this, every probe flagged "auto enable on new monitors" was attached
 * and there was no way to say which probe should watch a given resource. The
 * create form now sends the user's choice through miscDataProps; these tests
 * pin the three things that matter:
 *
 *   - no selection sent (API clients, monitor templates) still gets the old
 *     auto-enable defaults, unchanged,
 *   - a selection is honoured exactly - including an explicitly empty one,
 *   - ids from the browser cannot pull in another project's probes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const GLOBAL_PROBE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROJECT_PROBE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_PROJECT_PROBE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

type MakeProbeFunction = (id: ObjectID) => Probe;

const makeProbe: MakeProbeFunction = (id: ObjectID): Probe => {
  const probe: Probe = new Probe();
  probe.id = id;
  return probe;
};

describe("MonitorService probe selection", () => {
  let createdMonitorProbes: Array<MonitorProbe> = [];

  beforeEach(() => {
    createdMonitorProbes = [];

    getJestSpyOn(MonitorProbeService, "create").mockImplementation(
      async (createBy: any): Promise<MonitorProbe> => {
        createdMonitorProbes.push(createBy.data as MonitorProbe);
        return createBy.data as MonitorProbe;
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getSelectedProbeIdsFromMiscDataProps", () => {
    it("returns undefined when no probes key was sent, so defaults still apply", () => {
      expect(
        MonitorService.getSelectedProbeIdsFromMiscDataProps(undefined),
      ).toBeUndefined();

      expect(
        MonitorService.getSelectedProbeIdsFromMiscDataProps({}),
      ).toBeUndefined();
    });

    it("returns undefined when probes is not an array", () => {
      expect(
        MonitorService.getSelectedProbeIdsFromMiscDataProps({
          probes: GLOBAL_PROBE_ID.toString(),
        }),
      ).toBeUndefined();
    });

    it("returns an empty array for an explicitly empty selection", () => {
      /*
       * Distinct from undefined: the user cleared the picker, so no probes are
       * wanted - falling back to defaults here would silently re-add them.
       */
      expect(
        MonitorService.getSelectedProbeIdsFromMiscDataProps({ probes: [] }),
      ).toEqual([]);
    });

    it("coerces the plain strings that actually arrive on the wire into ObjectIDs", () => {
      /*
       * miscDataProps is not run through the model serializer, so ids reach
       * the server as strings.
       */
      const probeIds: Array<ObjectID> | undefined =
        MonitorService.getSelectedProbeIdsFromMiscDataProps({
          probes: [GLOBAL_PROBE_ID.toString(), PROJECT_PROBE_ID.toString()],
        });

      expect(probeIds).toHaveLength(2);
      expect(probeIds![0]).toBeInstanceOf(ObjectID);
      expect(
        probeIds!.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([GLOBAL_PROBE_ID.toString(), PROJECT_PROBE_ID.toString()]);
    });

    it("deduplicates repeated ids so MonitorProbeService does not reject the second insert", () => {
      const probeIds: Array<ObjectID> | undefined =
        MonitorService.getSelectedProbeIdsFromMiscDataProps({
          probes: [
            GLOBAL_PROBE_ID.toString(),
            GLOBAL_PROBE_ID.toString(),
            PROJECT_PROBE_ID.toString(),
          ],
        });

      expect(
        probeIds!.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([GLOBAL_PROBE_ID.toString(), PROJECT_PROBE_ID.toString()]);
    });

    it("skips empty entries", () => {
      const probeIds: Array<ObjectID> | undefined =
        MonitorService.getSelectedProbeIdsFromMiscDataProps({
          probes: ["", null, PROJECT_PROBE_ID.toString()],
        });

      expect(
        probeIds!.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([PROJECT_PROBE_ID.toString()]);
    });
  });

  describe("addProbesToMonitor", () => {
    it("falls back to the auto-enable defaults when nothing was selected", async () => {
      const addDefaultSpy: jest.SpyInstance<any, any> = getJestSpyOn(
        MonitorService,
        "addDefaultProbesToMonitor",
      ).mockResolvedValue(undefined);

      await MonitorService.addProbesToMonitor({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        selectedProbeIds: undefined,
      });

      expect(addDefaultSpy).toHaveBeenCalledWith(PROJECT_ID, MONITOR_ID);
    });

    it("uses the explicit selection instead of the defaults when one was sent", async () => {
      const addDefaultSpy: jest.SpyInstance<any, any> = getJestSpyOn(
        MonitorService,
        "addDefaultProbesToMonitor",
      ).mockResolvedValue(undefined);

      const addSelectedSpy: jest.SpyInstance<any, any> = getJestSpyOn(
        MonitorService,
        "addSelectedProbesToMonitor",
      ).mockResolvedValue(undefined);

      await MonitorService.addProbesToMonitor({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        selectedProbeIds: [PROJECT_PROBE_ID],
      });

      expect(addSelectedSpy).toHaveBeenCalledWith(PROJECT_ID, MONITOR_ID, [
        PROJECT_PROBE_ID,
      ]);
      expect(addDefaultSpy).not.toHaveBeenCalled();
    });

    it("attaches nothing - not the defaults - for an explicitly empty selection", async () => {
      const addDefaultSpy: jest.SpyInstance<any, any> = getJestSpyOn(
        MonitorService,
        "addDefaultProbesToMonitor",
      ).mockResolvedValue(undefined);

      await MonitorService.addProbesToMonitor({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        selectedProbeIds: [],
      });

      expect(addDefaultSpy).not.toHaveBeenCalled();
      expect(createdMonitorProbes).toHaveLength(0);
    });

    it("rejects a missing projectId or monitorId", async () => {
      await expect(
        MonitorService.addProbesToMonitor({
          projectId: undefined,
          monitorId: MONITOR_ID,
          selectedProbeIds: [],
        }),
      ).rejects.toThrow(BadDataException);

      await expect(
        MonitorService.addProbesToMonitor({
          projectId: PROJECT_ID,
          monitorId: null,
          selectedProbeIds: [],
        }),
      ).rejects.toThrow(BadDataException);
    });
  });

  describe("addSelectedProbesToMonitor", () => {
    type MockProbeLookupFunction = (data: {
      globalProbes: Array<Probe>;
      projectProbes: Array<Probe>;
    }) => void;

    const mockProbeLookup: MockProbeLookupFunction = (data: {
      globalProbes: Array<Probe>;
      projectProbes: Array<Probe>;
    }): void => {
      getJestSpyOn(ProbeService, "findBy").mockImplementation(
        async (findBy: any): Promise<Array<Probe>> => {
          return findBy.query.isGlobalProbe === true
            ? data.globalProbes
            : data.projectProbes;
        },
      );
    };

    it("creates one enabled MonitorProbe per selected probe", async () => {
      mockProbeLookup({
        globalProbes: [makeProbe(GLOBAL_PROBE_ID)],
        projectProbes: [makeProbe(PROJECT_PROBE_ID)],
      });

      await MonitorService.addSelectedProbesToMonitor(PROJECT_ID, MONITOR_ID, [
        GLOBAL_PROBE_ID,
        PROJECT_PROBE_ID,
      ]);

      expect(createdMonitorProbes).toHaveLength(2);

      for (const monitorProbe of createdMonitorProbes) {
        expect(monitorProbe.monitorId?.toString()).toEqual(
          MONITOR_ID.toString(),
        );
        expect(monitorProbe.projectId?.toString()).toEqual(
          PROJECT_ID.toString(),
        );
        expect(monitorProbe.isEnabled).toBe(true);
      }

      expect(
        createdMonitorProbes.map((monitorProbe: MonitorProbe) => {
          return monitorProbe.probeId?.toString();
        }),
      ).toEqual([GLOBAL_PROBE_ID.toString(), PROJECT_PROBE_ID.toString()]);
    });

    it("drops ids that are neither global nor owned by this project", async () => {
      /*
       * The id list comes from the browser. A probe belonging to someone
       * else's project must not become a MonitorProbe row just because its id
       * was posted.
       */
      mockProbeLookup({
        globalProbes: [],
        projectProbes: [makeProbe(PROJECT_PROBE_ID)],
      });

      await MonitorService.addSelectedProbesToMonitor(PROJECT_ID, MONITOR_ID, [
        PROJECT_PROBE_ID,
        OTHER_PROJECT_PROBE_ID,
      ]);

      expect(
        createdMonitorProbes.map((monitorProbe: MonitorProbe) => {
          return monitorProbe.probeId?.toString();
        }),
      ).toEqual([PROJECT_PROBE_ID.toString()]);
    });

    it("scopes the two lookups to global probes and to this project only", async () => {
      const findBySpy: jest.SpyInstance<any, any> = getJestSpyOn(
        ProbeService,
        "findBy",
      ).mockResolvedValue([]);

      await MonitorService.addSelectedProbesToMonitor(PROJECT_ID, MONITOR_ID, [
        PROJECT_PROBE_ID,
      ]);

      const queries: Array<any> = findBySpy.mock.calls.map(
        (call: Array<any>) => {
          return call[0].query;
        },
      );

      expect(queries).toHaveLength(2);
      expect(queries[0].isGlobalProbe).toBe(true);
      expect(queries[0].projectId).toBeUndefined();
      expect(queries[1].isGlobalProbe).toBe(false);
      expect(queries[1].projectId).toEqual(PROJECT_ID);
    });

    it("does nothing at all for an empty id list", async () => {
      const findBySpy: jest.SpyInstance<any, any> = getJestSpyOn(
        ProbeService,
        "findBy",
      ).mockResolvedValue([]);

      await MonitorService.addSelectedProbesToMonitor(
        PROJECT_ID,
        MONITOR_ID,
        [],
      );

      expect(findBySpy).not.toHaveBeenCalled();
      expect(createdMonitorProbes).toHaveLength(0);
    });
  });

  describe("addDefaultProbesToMonitor", () => {
    type MockProjectFunction = (skipGlobalProbes: boolean) => void;

    const mockProject: MockProjectFunction = (
      skipGlobalProbes: boolean,
    ): void => {
      const project: Project = new Project();
      project.id = PROJECT_ID;
      project.doNotAddGlobalProbesByDefaultOnNewMonitors = skipGlobalProbes;

      getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(project);
    };

    it("attaches every probe that opted in to new monitors", async () => {
      mockProject(false);

      getJestSpyOn(ProbeService, "findBy").mockImplementation(
        async (findBy: any): Promise<Array<Probe>> => {
          return findBy.query.isGlobalProbe === true
            ? [makeProbe(GLOBAL_PROBE_ID)]
            : [makeProbe(PROJECT_PROBE_ID)];
        },
      );

      await MonitorService.addDefaultProbesToMonitor(PROJECT_ID, MONITOR_ID);

      expect(
        createdMonitorProbes.map((monitorProbe: MonitorProbe) => {
          return monitorProbe.probeId?.toString();
        }),
      ).toEqual([GLOBAL_PROBE_ID.toString(), PROJECT_PROBE_ID.toString()]);
    });

    it("skips the global probe lookup entirely when the project opted out", async () => {
      mockProject(true);

      const findBySpy: jest.SpyInstance<any, any> = getJestSpyOn(
        ProbeService,
        "findBy",
      ).mockResolvedValue([makeProbe(PROJECT_PROBE_ID)]);

      await MonitorService.addDefaultProbesToMonitor(PROJECT_ID, MONITOR_ID);

      expect(findBySpy).toHaveBeenCalledTimes(1);
      expect(findBySpy.mock.calls[0]![0].query.isGlobalProbe).toBe(false);
      expect(
        createdMonitorProbes.map((monitorProbe: MonitorProbe) => {
          return monitorProbe.probeId?.toString();
        }),
      ).toEqual([PROJECT_PROBE_ID.toString()]);
    });

    it("only asks for probes that opted in", async () => {
      mockProject(false);

      const findBySpy: jest.SpyInstance<any, any> = getJestSpyOn(
        ProbeService,
        "findBy",
      ).mockResolvedValue([]);

      await MonitorService.addDefaultProbesToMonitor(PROJECT_ID, MONITOR_ID);

      for (const call of findBySpy.mock.calls) {
        expect(call[0].query.shouldAutoEnableProbeOnNewMonitors).toBe(true);
      }
    });
  });
});
