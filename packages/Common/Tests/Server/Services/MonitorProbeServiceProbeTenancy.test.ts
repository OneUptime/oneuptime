import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProbeService from "../../../Server/Services/ProbeService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import Probe from "../../../Models/DatabaseModels/Probe";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * Tenancy of the probe attached through the MonitorProbe CRUD path.
 *
 * The monitor create path already refused ids from outside the tenant, but
 * POST /api/monitor-probe - what the Monitor > Probes table posts - only
 * checked for duplicates and for a monitor type that supports probes, so a
 * crafted request naming another project's probe was accepted. Both paths now
 * share ProbeService.getProbesAttachableToProject; these tests pin the CRUD
 * half of it and the shared rule itself.
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

type MockProbeLookupFunction = (data: {
  globalProbes: Array<Probe>;
  projectProbes: Array<Probe>;
}) => jest.SpyInstance<any, any>;

const mockProbeLookup: MockProbeLookupFunction = (data: {
  globalProbes: Array<Probe>;
  projectProbes: Array<Probe>;
}): jest.SpyInstance<any, any> => {
  return getJestSpyOn(ProbeService, "findBy").mockImplementation(
    async (findBy: any): Promise<Array<Probe>> => {
      return findBy.query.isGlobalProbe === true
        ? data.globalProbes
        : data.projectProbes;
    },
  );
};

describe("MonitorProbeService probe tenancy", () => {
  describe("onBeforeCreate", () => {
    type MakeCreateByFunction = (data: {
      probeId?: ObjectID | undefined;
      projectId?: ObjectID | undefined;
    }) => CreateBy<MonitorProbe>;

    const makeCreateBy: MakeCreateByFunction = (data: {
      probeId?: ObjectID | undefined;
      projectId?: ObjectID | undefined;
    }): CreateBy<MonitorProbe> => {
      const monitorProbe: MonitorProbe = new MonitorProbe();
      monitorProbe.monitorId = MONITOR_ID;

      if (data.probeId) {
        monitorProbe.probeId = data.probeId;
      }

      if (data.projectId) {
        monitorProbe.projectId = data.projectId;
      }

      return {
        data: monitorProbe,
        props: {
          isRoot: true,
        },
      } as CreateBy<MonitorProbe>;
    };

    type OnBeforeCreateFunction = (
      createBy: CreateBy<MonitorProbe>,
    ) => Promise<unknown>;

    const onBeforeCreate: OnBeforeCreateFunction = (
      createBy: CreateBy<MonitorProbe>,
    ): Promise<unknown> => {
      return (MonitorProbeService as any).onBeforeCreate(createBy);
    };

    beforeEach(() => {
      // Not a duplicate, and a monitor type that does support probes.
      getJestSpyOn(MonitorProbeService, "findOneBy").mockResolvedValue(null);

      const monitor: Monitor = new Monitor();
      monitor.id = MONITOR_ID;
      monitor.monitorType = MonitorType.Website;

      getJestSpyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("rejects a probe that belongs to another project", async () => {
      /*
       * The probe id is posted by the browser. Owning the monitor must not be
       * enough to pull a probe out of someone else's project.
       */
      mockProbeLookup({
        globalProbes: [],
        projectProbes: [],
      });

      await expect(
        onBeforeCreate(
          makeCreateBy({
            probeId: OTHER_PROJECT_PROBE_ID,
            projectId: PROJECT_ID,
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    it("rejects a probe id that does not exist at all", async () => {
      mockProbeLookup({
        globalProbes: [],
        projectProbes: [],
      });

      await expect(
        onBeforeCreate(
          makeCreateBy({
            probeId: new ObjectID("66666666-6666-4666-8666-666666666666"),
            projectId: PROJECT_ID,
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    it("accepts a global probe", async () => {
      mockProbeLookup({
        globalProbes: [makeProbe(GLOBAL_PROBE_ID)],
        projectProbes: [],
      });

      await expect(
        onBeforeCreate(
          makeCreateBy({
            probeId: GLOBAL_PROBE_ID,
            projectId: PROJECT_ID,
          }),
        ),
      ).resolves.toBeDefined();
    });

    it("accepts a probe owned by this project", async () => {
      mockProbeLookup({
        globalProbes: [],
        projectProbes: [makeProbe(PROJECT_PROBE_ID)],
      });

      await expect(
        onBeforeCreate(
          makeCreateBy({
            probeId: PROJECT_PROBE_ID,
            projectId: PROJECT_ID,
          }),
        ),
      ).resolves.toBeDefined();
    });

    it("scopes the lookup to global probes and to this project only", async () => {
      const findBySpy: jest.SpyInstance<any, any> = mockProbeLookup({
        globalProbes: [makeProbe(PROJECT_PROBE_ID)],
        projectProbes: [makeProbe(PROJECT_PROBE_ID)],
      });

      await onBeforeCreate(
        makeCreateBy({
          probeId: PROJECT_PROBE_ID,
          projectId: PROJECT_ID,
        }),
      );

      const calls: Array<any> = findBySpy.mock.calls.map((call: Array<any>) => {
        return call[0];
      });

      expect(calls).toHaveLength(2);
      expect(calls[0].query.isGlobalProbe).toBe(true);
      expect(calls[0].query.projectId).toBeUndefined();
      expect(calls[1].query.isGlobalProbe).toBe(false);
      expect(calls[1].query.projectId).toEqual(PROJECT_ID);

      for (const call of calls) {
        expect(call.query._id).toBeDefined();
        expect(call.props.isRoot).toBe(true);
      }
    });

    it("skips the check when the create carries no probe id", async () => {
      const findBySpy: jest.SpyInstance<any, any> = mockProbeLookup({
        globalProbes: [],
        projectProbes: [],
      });

      await expect(
        onBeforeCreate(
          makeCreateBy({
            probeId: undefined,
            projectId: PROJECT_ID,
          }),
        ),
      ).resolves.toBeDefined();

      expect(findBySpy).not.toHaveBeenCalled();
    });
  });

  describe("ProbeService.getProbesAttachableToProject", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("keeps global and own-project probes and drops the rest", async () => {
      mockProbeLookup({
        globalProbes: [makeProbe(GLOBAL_PROBE_ID)],
        projectProbes: [makeProbe(PROJECT_PROBE_ID)],
      });

      const probes: Array<Probe> =
        await ProbeService.getProbesAttachableToProject({
          probeIds: [GLOBAL_PROBE_ID, PROJECT_PROBE_ID, OTHER_PROJECT_PROBE_ID],
          projectId: PROJECT_ID,
        });

      expect(
        probes.map((probe: Probe) => {
          return probe.id?.toString();
        }),
      ).toEqual([GLOBAL_PROBE_ID.toString(), PROJECT_PROBE_ID.toString()]);
    });

    it("does not query at all for an empty id list", async () => {
      const findBySpy: jest.SpyInstance<any, any> = mockProbeLookup({
        globalProbes: [],
        projectProbes: [],
      });

      await expect(
        ProbeService.getProbesAttachableToProject({
          probeIds: [],
          projectId: PROJECT_ID,
        }),
      ).resolves.toEqual([]);

      expect(findBySpy).not.toHaveBeenCalled();
    });

    it("answers the single-probe question the CRUD path asks", async () => {
      mockProbeLookup({
        globalProbes: [],
        projectProbes: [makeProbe(PROJECT_PROBE_ID)],
      });

      await expect(
        ProbeService.isProbeAttachableToProject({
          probeId: PROJECT_PROBE_ID,
          projectId: PROJECT_ID,
        }),
      ).resolves.toBe(true);

      mockProbeLookup({
        globalProbes: [],
        projectProbes: [],
      });

      await expect(
        ProbeService.isProbeAttachableToProject({
          probeId: OTHER_PROJECT_PROBE_ID,
          projectId: PROJECT_ID,
        }),
      ).resolves.toBe(false);
    });
  });
});
