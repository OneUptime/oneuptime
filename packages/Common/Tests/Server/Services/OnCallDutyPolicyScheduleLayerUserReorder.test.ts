import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import Model from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * A PERSON GIVEN ANOTHER TURN BY AN UPDATE TAKES IT, AND NOBODY ELSE MOVES
 * (issue #9573).
 *
 * The people of a schedule layer are numbered by `order`, their turn. An
 * update of a person's order used to be taken as a drag: onBeforeUpdate read
 * where they were and onUpdateSuccess stepped the people they passed aside
 * (audit finding L3 fixed one way that went wrong: dragging down drove the
 * top row to 0). Terraform numbers a layer's people one write each, all at
 * once, in no set order, and each write renumbered rows another had just
 * placed - the layer never ended as configured.
 *
 * Now an update writes the one row it names and reads or writes no other
 * row of the layer to make room: moving a person past others is a request
 * of its own (moveInList, ContiguousOrderMove), and the Layers page saves a
 * new turn order all at once (save-layers). These drive the update hooks as
 * DatabaseService does - onBeforeUpdate, then onUpdateSuccess with the ids
 * written - with the reads and writes they could make stubbed and recorded.
 */

// The project every row in these scenarios belongs to.
const PROJECT_ID: ObjectID = new ObjectID("project1");

const service: any = OnCallDutyPolicyScheduleLayerUserService as any;

// A schedule layer id shared by every row in these single-layer scenarios.
const LAYER_ID: ObjectID = new ObjectID("layer1");

const USER_A: ObjectID = new ObjectID("A");
const USER_B: ObjectID = new ObjectID("B");
const USER_C: ObjectID = new ObjectID("C");

// A write of another row's order, had the hooks made one.
interface CapturedWrite {
  id: string;
  order: number;
}

// A fake persisted row of the layer.
function row(id: ObjectID, order: number): Model {
  return {
    _id: id,
    id: id,
    order,
    onCallDutyPolicyScheduleLayerId: LAYER_ID,
    projectId: PROJECT_ID,
  } as unknown as Model;
}

// The UpdateBy giving `userId` the turn `order`, as a member's update sends it.
function updateBy(userId: ObjectID, order: number): any {
  return {
    data: { order: order },
    query: { _id: userId },
    props: {},
  } as any;
}

/*
 * Stubs the reads the hooks could make (findOneBy: the row; findBy: every
 * row of the layer) and records every write of a row (updateOneBy).
 */
function stubService(
  updatedRow: Model,
  layerRows: Array<Model>,
): Array<CapturedWrite> {
  const captured: Array<CapturedWrite> = [];

  jest.spyOn(service, "findOneBy").mockResolvedValue(updatedRow as never);

  jest.spyOn(service, "findBy").mockResolvedValue(layerRows as never);

  jest
    .spyOn(service, "updateOneBy")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const updateArg: {
        query: { _id: ObjectID };
        data: { order: number };
      } = args[0] as {
        query: { _id: ObjectID };
        data: { order: number };
      };
      captured.push({
        id: updateArg.query._id.toString(),
        order: updateArg.data.order,
      });
      return Promise.resolve();
    });

  return captured;
}

// The update hooks, as DatabaseService runs them around the row's write.
async function giveTurn(
  userId: ObjectID,
  order: number,
  props: Record<string, unknown> = {},
): Promise<any> {
  const onUpdate: any = await service.onBeforeUpdate({
    ...updateBy(userId, order),
    props: props,
  });

  await service.onUpdateSuccess(onUpdate, [userId]);

  return onUpdate;
}

describe("OnCallDutyPolicyScheduleLayerUserService: an update of a person's turn", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ["B down a place (2 -> 3)", USER_B, 2, 3],
    ["C to the top (3 -> 1)", USER_C, 3, 1],
    ["A, the top row, to the bottom (1 -> 3)", USER_A, 1, 3],
    ["B to a turn nobody has (2 -> 7)", USER_B, 2, 7],
    ["B to the turn it has (2 -> 2)", USER_B, 2, 2],
  ])(
    "moving %s writes no other row",
    async (_label: string, userId: ObjectID, from: number, to: number) => {
      const captured: Array<CapturedWrite> = stubService(row(userId, from), [
        row(USER_A, 1),
        row(USER_B, 2),
        row(USER_C, 3),
      ]);

      await giveTurn(userId, to);

      expect(captured).toEqual([]);
    },
  );

  test("reads no other row of the layer to make room", async () => {
    stubService(row(USER_B, 2), [
      row(USER_A, 1),
      row(USER_B, 2),
      row(USER_C, 3),
    ]);

    await giveTurn(USER_B, 3);

    expect(service.findBy).not.toHaveBeenCalled();
  });

  test("carries nothing from before the write to after it", async () => {
    stubService(row(USER_B, 2), [
      row(USER_A, 1),
      row(USER_B, 2),
      row(USER_C, 3),
    ]);

    const onUpdate: any = await giveTurn(USER_B, 3);

    expect(onUpdate.carryForward).toBeNull();
  });

  test("a root update of the turn writes no other row either", async () => {
    const captured: Array<CapturedWrite> = stubService(row(USER_B, 2), [
      row(USER_A, 1),
      row(USER_B, 2),
      row(USER_C, 3),
    ]);

    await giveTurn(USER_B, 3, { isRoot: true });

    expect(captured).toEqual([]);
  });

  test("an update that wrote no row writes no other row", async () => {
    const captured: Array<CapturedWrite> = stubService(row(USER_B, 2), [
      row(USER_A, 1),
      row(USER_B, 2),
      row(USER_C, 3),
    ]);

    const onUpdate: any = await service.onBeforeUpdate(updateBy(USER_B, 3));
    await service.onUpdateSuccess(onUpdate, []);

    expect(captured).toEqual([]);
  });
});

// Keep any incidental logger.error noise out of the test output.
jest.spyOn(logger, "error").mockImplementation((): void => {
  return undefined;
});
