import MonitorService from "../../../Server/Services/MonitorService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Label from "../../../Models/DatabaseModels/Label";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Companion to DatabaseServiceUpdateWriteRouting.test.ts, exercising the
 * write-routing contract on the model that the "updates must never resurrect
 * concurrently-deleted rows" work was actually chasing: Monitor.
 *
 * The routing rule is: DatabaseService._updateBy sends an update through
 * repository.save() ONLY when the sanitized data touches an EntityArray
 * (many-to-many) column, and through repository.update() otherwise.
 *
 * Two Monitor-specific shapes are pinned here that the sibling suite (built on
 * NetworkDeviceDiscoveryScan) cannot express:
 *
 *   1. labels — a real EntityArray column. It MUST route to save(), because a
 *      many-to-many write needs TypeORM's junction-table handling. The sibling
 *      suite only ever asserts save() is NOT called; nothing anywhere asserts
 *      the positive half of the contract, so a refactor that routed EntityArray
 *      to update() (silently breaking label writes) would pass every test. This
 *      closes that hole.
 *
 *   2. currentMonitorStatus vs currentMonitorStatusId — two decorated members
 *      over the SAME physical FK column. Expressing the write as the relation
 *      member (an Entity, many-to-one) must still take update(), never save():
 *      routing it to save() is exactly what let a concurrent monitor delete be
 *      resurrected as a zombie that then held the MonitorStatus FK forever.
 *
 * onBeforeUpdate is stubbed: it performs project-scoped reference validation
 * that needs a live DB, which is not what these tests exercise.
 */

describe("DatabaseService._updateBy — Monitor write routing (save vs update)", () => {
  let saveMock: MockFunction;
  let updateMock: MockFunction;
  let onUpdateSuccessMock: MockFunction;
  let monitorId: ObjectID;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    monitorId = ObjectID.generate();

    const foundItem: Monitor = new Monitor();
    foundItem._id = monitorId.toString();

    jest
      .spyOn(MonitorService as any, "_findBy")
      .mockResolvedValue([foundItem] as never);

    /*
     * onBeforeUpdate validates that referenced ids belong to the project,
     * which needs a DB. Bypass it — the routing decision it feeds into is the
     * subject under test, not the validation.
     */
    jest.spyOn(MonitorService as any, "onBeforeUpdate").mockImplementation(((
      updateBy: UpdateBy<Monitor>,
    ): Promise<unknown> => {
      return Promise.resolve({ updateBy, carryForward: null });
    }) as never);

    /*
     * onUpdateSuccess is a post-write hook (status-change side effects,
     * dashboard links) that fires AFTER the save()/update() routing has already
     * happened. It needs a live DB; stub it so the routing assertions run in
     * isolation.
     */
    onUpdateSuccessMock = getJestMockFunction();
    onUpdateSuccessMock.mockImplementation((onUpdate: unknown) => {
      return Promise.resolve(onUpdate);
    });
    jest
      .spyOn(MonitorService as any, "onUpdateSuccess")
      .mockImplementation(onUpdateSuccessMock as never);

    saveMock = getJestMockFunction();
    saveMock.mockImplementation((item: unknown) => {
      return Promise.resolve(item);
    });
    updateMock = getJestMockFunction();
    updateMock.mockImplementation(() => {
      return Promise.resolve({ affected: 1 });
    });
    jest
      .spyOn(MonitorService, "getRepository")
      .mockReturnValue({ save: saveMock, update: updateMock } as never);

    jest
      .spyOn(ModelPermission, "checkUpdatePermissionByModel")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation(((
        _modelType: unknown,
        query: unknown,
      ): Promise<unknown> => {
        return Promise.resolve(query);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The Monitor update-data type is a deep recursive generic; referencing it in
   * a cast trips TS2589 ("excessively deep"). Build a real Monitor instance for
   * each case and hand the whole call argument over as `any` — the routing code
   * under test reads runtime column metadata, not the static type.
   */
  const updateMonitorWith: (
    mutate: (m: Monitor) => void,
  ) => Promise<void> = async (mutate: (m: Monitor) => void): Promise<void> => {
    const monitor: Monitor = new Monitor();
    mutate(monitor);
    await MonitorService.updateOneById({
      id: monitorId,
      data: monitor,
      props: { isRoot: true },
    } as any);
  };

  test("updating labels (EntityArray) routes to save(), never update()", async () => {
    await updateMonitorWith((m: Monitor) => {
      m.labels = [new Label(ObjectID.generate())];
    });

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("updating currentMonitorStatusId (scalar FK) routes to update(), never save()", async () => {
    await updateMonitorWith((m: Monitor) => {
      m.currentMonitorStatusId = ObjectID.generate();
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();
  });

  test("updating currentMonitorStatus (the relation member of a many-to-one) still routes to update(), never save()", async () => {
    await updateMonitorWith((m: Monitor) => {
      /*
       * currentMonitorStatus and currentMonitorStatusId are the SAME physical
       * column. A save() here could re-INSERT a concurrently-deleted Monitor;
       * update() simply affects zero rows when the target is gone.
       */
      m.currentMonitorStatus = new MonitorStatus(ObjectID.generate());
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();
  });

  test("a mixed scalar + EntityArray update still needs save() for the junction write", async () => {
    await updateMonitorWith((m: Monitor) => {
      m.disableActiveMonitoring = true;
      m.labels = [new Label(ObjectID.generate())];
    });

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("a scalar update whose row was hard-deleted mid-write hands onUpdateSuccess no phantom ids", async () => {
    /*
     * Simulate the concurrent hard delete: the located row is gone by the time
     * the WHERE-clause UPDATE runs, so Postgres reports zero rows affected.
     */
    updateMock.mockImplementation(() => {
      return Promise.resolve({ affected: 0 });
    });

    await updateMonitorWith((m: Monitor) => {
      m.currentMonitorStatusId = ObjectID.generate();
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();

    /*
     * onUpdateSuccess must still fire (subclasses depend on it), but with an
     * EMPTY id list: a row that was deleted mid-update must never be handed to
     * the hook, which would re-read it and dereference null.
     */
    expect(onUpdateSuccessMock).toHaveBeenCalledTimes(1);
    const idsPassedToHook: Array<ObjectID> = onUpdateSuccessMock.mock
      .calls[0]![1] as Array<ObjectID>;
    expect(idsPassedToHook).toEqual([]);
  });
});
