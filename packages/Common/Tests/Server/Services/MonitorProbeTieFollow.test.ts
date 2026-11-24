import MonitorProbeService, {
  Service as MonitorProbeServiceClass,
} from "../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTieOnProbeChange from "../../../Server/Utils/NetworkDevice/MonitorTieOnProbeChange";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import Probe from "../../../Models/DatabaseModels/Probe";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A MONITOR'S TIE IS WORKED OUT AGAIN WHEN ITS PROBES CHANGE (OneUptime
 * issue #9904): a probe added to a monitor (a MonitorProbe row created) or
 * taken off it (one deleted) can change which network device it checks, as
 * two sites can each have a 10.0.0.5. MonitorProbeService's hooks hand the
 * monitor to MonitorTieOnProbeChange - but not while a new monitor is being
 * created, whose tie was worked out from all of the probes it is created
 * with, before it existed.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

let followed: SpyInstance<typeof MonitorTieOnProbeChange.followProbesOf>;

function created(): MonitorProbe {
  const row: MonitorProbe = new MonitorProbe(ObjectID.generate());
  row.monitorId = MONITOR_ID;
  row.probeId = PROBE_ID;
  return row;
}

function onCreateOf(data: {
  props: DatabaseCommonInteractionProps;
  miscDataProps?: CreateBy<MonitorProbe>["miscDataProps"];
}): OnCreate<MonitorProbe> {
  return {
    createBy: {
      data: created(),
      props: data.props,
      ...(data.miscDataProps ? { miscDataProps: data.miscDataProps } : {}),
    },
    carryForward: null,
  };
}

async function createSuccess(onCreate: OnCreate<MonitorProbe>): Promise<void> {
  await (MonitorProbeService as any).onCreateSuccess(
    onCreate,
    onCreate.createBy.data,
  );
}

beforeEach(() => {
  followed = jest
    .spyOn(MonitorTieOnProbeChange, "followProbesOf")
    .mockResolvedValue([]);
  jest
    .spyOn(MonitorService, "refreshMonitorProbeStatus")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a probe added to a monitor", () => {
  it("works the monitor's tie out again, after its status is refreshed", async () => {
    await createSuccess(
      onCreateOf({
        props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
      }),
    );

    expect(followed).toHaveBeenCalledTimes(1);
    expect(followed.mock.calls[0]![0].map(String)).toEqual([
      MONITOR_ID.toString(),
    ]);
    expect(
      (MonitorService.refreshMonitorProbeStatus as unknown as jest.Mock).mock
        .invocationCallOrder[0]!,
    ).toBeLessThan(followed.mock.invocationCallOrder[0]!);
  });

  it("does not while its new monitor is being created with it", async () => {
    await createSuccess(
      onCreateOf({
        props: { isRoot: true },
        miscDataProps: {
          [MonitorProbeServiceClass.CREATED_WITH_ITS_MONITOR]: true,
        },
      }),
    );

    expect(followed).not.toHaveBeenCalled();
  });

  it("does all the same when the mark comes from anyone but OneUptime", async () => {
    await createSuccess(
      onCreateOf({
        props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
        miscDataProps: {
          [MonitorProbeServiceClass.CREATED_WITH_ITS_MONITOR]: true,
        },
      }),
    );

    expect(followed).toHaveBeenCalledTimes(1);
  });

  it("works it out for a probe OneUptime adds to a monitor that exists", async () => {
    await createSuccess(onCreateOf({ props: { isRoot: true } }));

    expect(followed).toHaveBeenCalledTimes(1);
  });
});

describe("probes taken off monitors", () => {
  it("work each monitor's tie out again", async () => {
    const onDelete: OnDelete<MonitorProbe> = {
      deleteBy: {
        query: {},
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      } as never,
      carryForward: {
        monitorIds: [MONITOR_ID, OTHER_MONITOR_ID, MONITOR_ID],
      },
    };

    await (MonitorProbeService as any).onDeleteSuccess(onDelete, []);

    expect(followed).toHaveBeenCalledTimes(1);
    expect(followed.mock.calls[0]![0].map(String)).toEqual([
      MONITOR_ID.toString(),
      OTHER_MONITOR_ID.toString(),
      MONITOR_ID.toString(),
    ]);
  });
});

describe("the probes a new monitor is created with", () => {
  it("are created by OneUptime, marked so none works the tie out again", async () => {
    const creates: Array<CreateBy<MonitorProbe>> = [];
    jest
      .spyOn(MonitorProbeService, "create")
      .mockImplementation(async (createBy: CreateBy<MonitorProbe>) => {
        creates.push(createBy);
        return createBy.data;
      });

    const probes: Array<Probe> = [
      new Probe(PROBE_ID),
      new Probe(ObjectID.generate()),
    ];

    await MonitorService.createMonitorProbes({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      probes: probes,
    });

    expect(creates).toHaveLength(2);

    for (const createBy of creates) {
      expect(createBy.props).toEqual({ isRoot: true });
      expect(MonitorProbeServiceClass.isCreatedWithItsMonitor(createBy)).toBe(
        true,
      );
    }
  });
});
