import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import Model from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * OnCallDutyPolicyScheduleLayerUserService re-sequences the `order` of the
 * other rows in a schedule layer when a user is dragged to a new position:
 * onBeforeUpdate reads where the user is, and onUpdateSuccess - once the update
 * has moved it, and only if it did - shifts the rows it passed (through
 * ContiguousOrder). Audit finding L3: the "moving down" branch (newOrder > currentOrder)
 * decremented EVERY row with `order <= newOrder`, including rows ABOVE the moved
 * user. Dragging a user downward therefore drove the top row's order to 0 (and
 * negative after repeated down-drags) and opened a gap at 1, breaking the
 * 1-based contiguous invariant that create-default (count+1) and delete
 * re-sequencing depend on.
 *
 * The fix adds the missing lower bound `resource.order > currentOrder`, so only
 * rows strictly between the old and new position shift — mirroring the
 * double-bounded "moving up" branch (`order >= newOrder && order < currentOrder`).
 *
 * These tests stub the three persistence helpers the hooks call
 * (findOneBy -> moved row's current order + layer id; findBy -> every row in the
 * layer; updateOneBy -> the per-row shift) and CAPTURE each updateOneBy so we can
 * assert exactly which rows moved and to what order. No Postgres involved.
 */

// The project every row in these scenarios belongs to.
const PROJECT_ID: ObjectID = new ObjectID("project1");

const service: any = OnCallDutyPolicyScheduleLayerUserService as any;

// A schedule layer id shared by every row in these single-layer scenarios.
const LAYER_ID: ObjectID = new ObjectID("layer1");

const USER_A: ObjectID = new ObjectID("A");
const USER_B: ObjectID = new ObjectID("B");
const USER_C: ObjectID = new ObjectID("C");

// A captured updateOneBy shift: which row and what order it was set to.
interface CapturedShift {
  id: string;
  order: number;
}

// Build a fake persisted row for the layer.
function row(id: ObjectID, order: number): Model {
  return {
    _id: id,
    id: id,
    order,
    onCallDutyPolicyScheduleLayerId: LAYER_ID,
    projectId: PROJECT_ID,
  } as unknown as Model;
}

/*
 * Move a user the way DatabaseService does: onBeforeUpdate, then (once the
 * update has written the row) onUpdateSuccess with the ids it wrote. Returns
 * the shifts captured before the update, which must be none.
 */
async function moveUser(
  captured: Array<CapturedShift>,
  movedId: ObjectID,
  newOrder: number,
  writtenIds: Array<ObjectID> = [movedId],
): Promise<Array<CapturedShift>> {
  const onUpdate: any = await service.onBeforeUpdate(
    updateBy(movedId, newOrder),
  );
  const shiftedBeforeTheUpdate: Array<CapturedShift> = [...captured];

  await service.onUpdateSuccess(onUpdate, writtenIds);

  return shiftedBeforeTheUpdate;
}

// Build the UpdateBy passed to onBeforeUpdate for moving `movedId` to `newOrder`.
function updateBy(movedId: ObjectID, newOrder: number): any {
  return {
    data: { order: newOrder },
    query: { _id: movedId },
    props: {},
  } as any;
}

/*
 * Stub findOneBy (moved row lookup), findBy (all rows in the layer) and
 * updateOneBy (record the shift). Returns the array captured shifts are pushed
 * into so each test can inspect exactly what moved.
 */
function stubService(
  movedRow: Model,
  layerRows: Array<Model>,
): Array<CapturedShift> {
  const captured: Array<CapturedShift> = [];

  jest.spyOn(service, "findOneBy").mockResolvedValue(movedRow as never);

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

describe("OnCallDutyPolicyScheduleLayerUserService reorder on update", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * ----------------------------------------------------------------------- *
   * 1. MOVE DOWN B: order 2 -> 3. Only C (3 -> 2) shifts; A is untouched.
   * -----------------------------------------------------------------------
   */
  test("moving B down (2 -> 3) decrements ONLY C and never touches A", async () => {
    const captured: Array<CapturedShift> = stubService(row(USER_B, 2), [
      row(USER_A, 1),
      row(USER_B, 2),
      row(USER_C, 3),
    ]);

    // Nothing moves before the update has moved B.
    expect(await moveUser(captured, USER_B, 3)).toEqual([]);

    // Exactly one row shifted, and it was C going from 3 down to 2.
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ id: USER_C.toString(), order: 2 });

    // A (the top row) must never be decremented — the regression.
    const aShifts: Array<CapturedShift> = captured.filter(
      (c: CapturedShift): boolean => {
        return c.id === USER_A.toString();
      },
    );
    expect(aShifts).toHaveLength(0);

    /*
     * After the shift, with the outer update setting B = 3, the resulting layer
     * is contiguous {A:1, C:2, B:3}.
     */
    const finalOrders: Record<string, number> = {
      [USER_A.toString()]: 1, // untouched
      [USER_C.toString()]: 2, // shifted
      [USER_B.toString()]: 3, // set by the outer update
    };
    expect(finalOrders[USER_A.toString()]).toBe(1);
    expect(finalOrders[USER_C.toString()]).toBe(2);
    expect(finalOrders[USER_B.toString()]).toBe(3);
  });

  /*
   * ----------------------------------------------------------------------- *
   * 2. MOVE UP C: order 3 -> 1. A (1 -> 2) and B (2 -> 3) increment; C untouched.
   * -----------------------------------------------------------------------
   */
  test("moving C up (3 -> 1) increments ONLY A and B", async () => {
    const captured: Array<CapturedShift> = stubService(row(USER_C, 3), [
      row(USER_A, 1),
      row(USER_B, 2),
      row(USER_C, 3),
    ]);

    expect(await moveUser(captured, USER_C, 1)).toEqual([]);

    expect(captured).toHaveLength(2);

    const byId: Record<string, number> = {};
    for (const shift of captured) {
      byId[shift.id] = shift.order;
    }

    expect(byId[USER_A.toString()]).toBe(2);
    expect(byId[USER_B.toString()]).toBe(3);
    // C itself is not part of the shift loop; the outer update sets it to 1.
    expect(byId[USER_C.toString()]).toBeUndefined();

    // Contiguous {C:1, A:2, B:3}.
    const finalOrders: Record<string, number> = {
      [USER_C.toString()]: 1,
      [USER_A.toString()]: 2,
      [USER_B.toString()]: 3,
    };
    expect(Object.values(finalOrders).sort()).toEqual([1, 2, 3]);
  });

  /*
   * ----------------------------------------------------------------------- *
   * 3. MOVE DOWN A: order 1 -> 3 (dragging the TOP row all the way down).
   *    Only B (2 -> 1) and C (3 -> 2) decrement; A is not touched by the loop.
   * -----------------------------------------------------------------------
   */
  test("moving the top row A down (1 -> 3) decrements ONLY B and C, no row hits 0", async () => {
    const captured: Array<CapturedShift> = stubService(row(USER_A, 1), [
      row(USER_A, 1),
      row(USER_B, 2),
      row(USER_C, 3),
    ]);

    expect(await moveUser(captured, USER_A, 3)).toEqual([]);

    expect(captured).toHaveLength(2);

    const byId: Record<string, number> = {};
    for (const shift of captured) {
      byId[shift.id] = shift.order;
    }

    expect(byId[USER_B.toString()]).toBe(1);
    expect(byId[USER_C.toString()]).toBe(2);
    // A is the moved row itself — the shift loop must not decrement it.
    expect(byId[USER_A.toString()]).toBeUndefined();

    // Nothing collapsed to 0 or negative.
    for (const shift of captured) {
      expect(shift.order).toBeGreaterThan(0);
    }
  });

  /*
   * ----------------------------------------------------------------------- *
   * 4. Regression: in a move-down, NO captured shift may set an order <= 0.
   *    Before the fix, dragging B down drove A's order to 0. This asserts the
   *    invariant across the whole move-down code path.
   * -----------------------------------------------------------------------
   */
  test("regression: no move-down shift ever sets order <= 0", async () => {
    const captured: Array<CapturedShift> = stubService(row(USER_B, 2), [
      row(USER_A, 1),
      row(USER_B, 2),
      row(USER_C, 3),
    ]);

    await moveUser(captured, USER_B, 3);

    for (const shift of captured) {
      expect(shift.order).toBeGreaterThan(0);
    }
  });

  /*
   * ----------------------------------------------------------------------- *
   * 5. An update that did not write the moved row (refused, or narrowed to
   *    nothing) moves no other row either.
   * -----------------------------------------------------------------------
   */
  test("no row shifts when the update did not write the moved user", async () => {
    const captured: Array<CapturedShift> = stubService(row(USER_B, 2), [
      row(USER_A, 1),
      row(USER_B, 2),
      row(USER_C, 3),
    ]);

    await moveUser(captured, USER_B, 3, []);

    expect(captured).toEqual([]);
  });

  test("a root update of the order leaves the other rows to the caller", async () => {
    const captured: Array<CapturedShift> = stubService(row(USER_B, 2), [
      row(USER_A, 1),
      row(USER_B, 2),
      row(USER_C, 3),
    ]);

    const onUpdate: any = await service.onBeforeUpdate({
      ...updateBy(USER_B, 3),
      props: { isRoot: true },
    });
    await service.onUpdateSuccess(onUpdate, [USER_B]);

    expect(captured).toEqual([]);
  });

  test("the rows that shift are looked up in the moved user's layer and project", async () => {
    const captured: Array<CapturedShift> = stubService(row(USER_B, 2), [
      row(USER_A, 1),
      row(USER_B, 2),
      row(USER_C, 3),
    ]);

    await moveUser(captured, USER_B, 3);

    expect(service.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          onCallDutyPolicyScheduleLayerId: LAYER_ID,
          projectId: PROJECT_ID,
        }),
      }),
    );
  });
});

// Keep any incidental logger.error noise out of the test output.
jest.spyOn(logger, "error").mockImplementation((): void => {
  return undefined;
});
