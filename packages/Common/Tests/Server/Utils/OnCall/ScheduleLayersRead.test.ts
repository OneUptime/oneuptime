import OnCallDutyPolicyScheduleLayer from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayerService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import ScheduleLayersSave from "../../../../Server/Utils/OnCall/ScheduleLayersSave";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import ScheduleLayersSaveUtil, {
  SCHEDULE_LAYERS_READ_ROUTE,
  ScheduleLayersSaveRequest,
  getScheduleLayersReadRoute,
} from "../../../../Types/OnCallDutyPolicy/ScheduleLayersSave";
import UserType from "../../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * THE LAYERS AS THE API READS THEM, TO SAVE (issue #9038).
 *
 * An API caller or Terraform changing a schedule's layers in one go sends
 * save-layers every layer the schedule keeps, in priority order, each with
 * its people in turn order, and the version the layers were at - a hash
 * of the rows no client should have to work out. GET .../:id/layers
 * answers exactly that: the layers as a save that changes nothing, with
 * basedOnVersion. The schedule is read as the caller reads it, so one they
 * may not read, or of another project, is not found; the layers and their
 * people are read as the caller reads them too.
 */

jest.mock("../../../../Server/Utils/Logger");

const PROJECT: ObjectID = new ObjectID("0d903800-0000-4000-8000-000000000001");
const SCHEDULE: ObjectID = new ObjectID("0d903800-0000-4000-8000-000000000002");
const WEEKDAYS: string = "0d903800-0000-4000-8000-0000000000a1";
const BACKUP: string = "0d903800-0000-4000-8000-0000000000a2";
const ALEX: string = "0d903800-0000-4000-8000-0000000000b1";
const SAM: string = "0d903800-0000-4000-8000-0000000000b2";
const RIA: string = "0d903800-0000-4000-8000-0000000000b3";

const props: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("0d903800-0000-4000-8000-0000000000c1"),
  userType: UserType.User,
};

function layer(id: string, order: number): OnCallDutyPolicyScheduleLayer {
  const row: OnCallDutyPolicyScheduleLayer = new OnCallDutyPolicyScheduleLayer(
    new ObjectID(id),
  );
  row.order = order;
  return row;
}

function layerUser(data: {
  id: string;
  layerId: string;
  userId: string;
  order: number;
}): OnCallDutyPolicyScheduleLayerUser {
  const row: OnCallDutyPolicyScheduleLayerUser =
    new OnCallDutyPolicyScheduleLayerUser(new ObjectID(data.id));
  row.onCallDutyPolicyScheduleLayerId = new ObjectID(data.layerId);
  row.userId = new ObjectID(data.userId);
  row.order = data.order;
  return row;
}

// Backup listed first, Sam before Alex: the read orders them itself.
const LAYERS: Array<OnCallDutyPolicyScheduleLayer> = [
  layer(BACKUP, 2),
  layer(WEEKDAYS, 1),
];

const LAYER_USERS: Array<OnCallDutyPolicyScheduleLayerUser> = [
  layerUser({
    id: "0d903800-0000-4000-8000-0000000000d2",
    layerId: WEEKDAYS,
    userId: SAM,
    order: 2,
  }),
  layerUser({
    id: "0d903800-0000-4000-8000-0000000000d1",
    layerId: WEEKDAYS,
    userId: ALEX,
    order: 1,
  }),
  layerUser({
    id: "0d903800-0000-4000-8000-0000000000d3",
    layerId: BACKUP,
    userId: RIA,
    order: 1,
  }),
];

let findSchedule: SpyInstance<typeof OnCallDutyPolicyScheduleService.findOneBy>;
let findLayers: SpyInstance<typeof OnCallDutyPolicyScheduleLayerService.findBy>;
let findLayerUsers: SpyInstance<
  typeof OnCallDutyPolicyScheduleLayerUserService.findBy
>;

beforeEach(() => {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule(
    SCHEDULE,
  );

  findSchedule = jest
    .spyOn(OnCallDutyPolicyScheduleService, "findOneBy")
    .mockResolvedValue(schedule);
  findLayers = jest
    .spyOn(OnCallDutyPolicyScheduleLayerService, "findBy")
    .mockResolvedValue(LAYERS);
  findLayerUsers = jest
    .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
    .mockResolvedValue(LAYER_USERS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reading a schedule's layers to save", () => {
  test("is a save that changes nothing: the layers by priority, their people by turn, and the version", async () => {
    const read: ScheduleLayersSaveRequest = await ScheduleLayersSave.read({
      scheduleId: SCHEDULE,
      props: props,
    });

    expect(read).toEqual({
      basedOnVersion: ScheduleLayersSaveUtil.getVersion(
        ScheduleLayersSave.getState({
          layers: LAYERS,
          layerUsers: LAYER_USERS,
        }),
      ),
      layers: [
        {
          layerId: WEEKDAYS,
          users: [
            {
              layerUserId: "0d903800-0000-4000-8000-0000000000d1",
              userId: ALEX,
            },
            {
              layerUserId: "0d903800-0000-4000-8000-0000000000d2",
              userId: SAM,
            },
          ],
        },
        {
          layerId: BACKUP,
          users: [
            {
              layerUserId: "0d903800-0000-4000-8000-0000000000d3",
              userId: RIA,
            },
          ],
        },
      ],
      deletedLayerIds: [],
    });

    // A save of it, as it is, would be held to the version the rows are at.
    expect(
      ScheduleLayersSaveUtil.isEmpty(
        ScheduleLayersSaveUtil.plan({
          state: ScheduleLayersSave.getState({
            layers: LAYERS,
            layerUsers: LAYER_USERS,
          }),
          request: read,
        }),
      ),
    ).toBe(true);
  });

  test("reads the schedule, its layers and their people as the caller, in the caller's project", async () => {
    await ScheduleLayersSave.read({ scheduleId: SCHEDULE, props: props });

    const scheduleQuery: { query: unknown; props: unknown } = findSchedule.mock
      .calls[0]![0] as unknown as { query: unknown; props: unknown };

    expect(scheduleQuery.query).toEqual({
      _id: SCHEDULE,
      projectId: PROJECT,
    });
    expect(scheduleQuery.props).toBe(props);

    for (const finder of [findLayers, findLayerUsers]) {
      const asked: { query: unknown; props: unknown } = finder.mock
        .calls[0]![0] as unknown as { query: unknown; props: unknown };

      expect(asked.query).toEqual({
        onCallDutyPolicyScheduleId: SCHEDULE,
        projectId: PROJECT,
      });
      expect(asked.props).toBe(props);
    }
  });

  test("a schedule the caller cannot read, or of another project, is not found, and no layer is read", async () => {
    findSchedule.mockResolvedValue(null);

    await expect(
      ScheduleLayersSave.read({ scheduleId: SCHEDULE, props: props }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findLayers).not.toHaveBeenCalled();
    expect(findLayerUsers).not.toHaveBeenCalled();
  });

  test("a read that names no project is refused", async () => {
    await expect(
      ScheduleLayersSave.read({
        scheduleId: SCHEDULE,
        props: { ...props, tenantId: undefined },
      }),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(findSchedule).not.toHaveBeenCalled();
  });

  test("its route sits beside save-layers, under the schedule's own path", () => {
    expect(SCHEDULE_LAYERS_READ_ROUTE).toBe("/:id/layers");
    expect(getScheduleLayersReadRoute(SCHEDULE.toString())).toBe(
      `/${SCHEDULE.toString()}/layers`,
    );
  });
});
