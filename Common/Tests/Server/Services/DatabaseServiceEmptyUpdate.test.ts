import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Probe from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * A customer's workflow PUT a flat body to /api/workflow-variable/<id>, so
 * BaseAPI read `body["data"]` as undefined and handed DatabaseService an empty
 * update payload. _updateBy still ran its internal find, matched the row, wrote
 * no columns at all, and returned the MATCHED count (1). Every caller - the API
 * included - reads that number as "rows written", so the request answered 200
 * while the database was untouched, and the guard that exists precisely for
 * this ("numberOfDocsAffected === 0") could never fire.
 *
 * The fix: when the sanitized update data carries no columns, _updateBy skips
 * the find entirely and reports 0. These tests pin that down, and pin down that
 * it did not change anything about updates that DO carry columns.
 */

type ProbeUpdateData = UpdateBy<Probe>["data"];

const EMPTY_DATA: ProbeUpdateData = {} as ProbeUpdateData;

const TEST_ID: string = "550e8400-e29b-41d4-a716-446655440021";
const OTHER_ID: string = "550e8400-e29b-41d4-a716-446655440022";

const matchedRow: (id: string) => Probe = (id: string): Probe => {
  const probe: Probe = new Probe();
  probe._id = id;
  return probe;
};

describe("DatabaseService._updateBy when the update carries no columns", () => {
  let service: DatabaseService<Probe>;
  let findBySpy: jest.SpyInstance;
  let saveMock: MockFunction;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    service = new DatabaseService<Probe>(Probe);

    /*
     * Only the two surfaces that need a live Postgres are stubbed - the
     * internal find (`_findBy`) and the repository behind `save()`. Mocking
     * the TypeORM repository itself is impractical here because `_findBy`
     * builds real query metadata against a DataSource that does not exist in
     * a unit test; stubbing `_findBy` keeps the mock at the exact boundary the
     * fix is about (was the find run at all?) while leaving every line of
     * _updateBy under test - sanitizing, the hooks and the return arithmetic.
     *
     * The stub deliberately returns a MATCHING row, because that is what a
     * real database does here: the row exists and the query finds it, there is
     * simply nothing to write to it. That is the whole trap - so if _updateBy
     * ever runs this find again for an empty payload, every expectation below
     * reports the old, wrong answer (1 row "changed") instead of 0.
     */
    findBySpy = getJestSpyOn(service as any, "_findBy").mockResolvedValue([
      matchedRow(TEST_ID),
    ]);

    saveMock = getJestMockFunction();
    saveMock.mockImplementation((item: unknown) => {
      return Promise.resolve(item);
    });
    getJestSpyOn(service, "getRepository").mockReturnValue({
      save: saveMock,
    });

    // The permission layer is not what these tests are about, and needs a DB.
    getJestSpyOn(
      ModelPermission,
      "checkUpdateQueryPermissions",
    ).mockImplementation((_modelType: unknown, query: unknown) => {
      return Promise.resolve(query);
    });
    getJestSpyOn(
      ModelPermission,
      "checkUpdatePermissionByModel",
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports zero rows changed when updateOneBy is handed an empty payload", async () => {
    const numberOfDocsAffected: number = await service.updateOneBy({
      query: { _id: TEST_ID } as any,
      data: EMPTY_DATA,
      props: { isRoot: true },
    });

    expect(numberOfDocsAffected).toBe(0);
  });

  it("reports zero rows changed when updateBy is handed an empty payload", async () => {
    const numberOfDocsAffected: number = await service.updateBy({
      query: {} as any,
      data: EMPTY_DATA,
      props: { isRoot: true },
      limit: 10,
      skip: 0,
    });

    expect(numberOfDocsAffected).toBe(0);
  });

  it("reports zero rows changed when the empty payload arrives through updateOneById, which is the path the API takes", async () => {
    const numberOfDocsAffected: number = await service.updateOneById({
      id: new ObjectID(TEST_ID),
      data: EMPTY_DATA,
      props: { isRoot: true },
    });

    /*
     * This is the exact number BaseAPI.updateItem checks before answering
     * 200, so a no-column update can no longer be reported as a save.
     */
    expect(numberOfDocsAffected).toBe(0);
  });

  it("never runs the find, because a payload with no columns cannot change any row", async () => {
    await service.updateOneBy({
      query: { _id: TEST_ID } as any,
      data: EMPTY_DATA,
      props: { isRoot: true },
    });

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("never writes anything, so the count it reports and the rows it touched agree", async () => {
    /*
     * The semantic in prose: an update that writes no columns must not be
     * reported as a successful write. Nothing is saved AND the caller is told
     * zero - previously the second half of that sentence was a lie, because
     * `items.length` counted rows the query MATCHED, not rows it changed, and
     * the row matched here (see the `_findBy` stub above).
     */
    const numberOfDocsAffected: number = await service.updateOneBy({
      query: { _id: TEST_ID } as any,
      data: EMPTY_DATA,
      props: { isRoot: true },
    });

    expect(saveMock).not.toHaveBeenCalled();
    expect(numberOfDocsAffected).toBe(0);
  });

  it("still calls onUpdateSuccess, with an empty list of ids, so hooks behave exactly as they do when the query matches nothing", async () => {
    const onUpdateSuccessSpy: jest.SpyInstance = getJestSpyOn(
      service as any,
      "onUpdateSuccess",
    );

    await service.updateOneBy({
      query: { _id: TEST_ID } as any,
      data: EMPTY_DATA,
      props: { isRoot: true, ignoreHooks: false },
    });

    /*
     * Skipping the find must not quietly skip the hooks too: subclasses
     * override onUpdateSuccess and some of them rely on being told about
     * every update attempt. The id list is empty because nothing was written -
     * before the fix this hook was handed the id of the row that merely
     * matched, telling every subclass a write had happened.
     */
    expect(onUpdateSuccessSpy).toHaveBeenCalledTimes(1);
    expect(onUpdateSuccessSpy.mock.calls[0]![1]).toEqual([]);
  });
});

describe("DatabaseService._updateBy when the update does carry columns", () => {
  let service: DatabaseService<Probe>;
  let findBySpy: jest.SpyInstance;
  let saveMock: MockFunction;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    service = new DatabaseService<Probe>(Probe);

    findBySpy = getJestSpyOn(service as any, "_findBy").mockResolvedValue([
      matchedRow(TEST_ID),
      matchedRow(OTHER_ID),
    ]);

    saveMock = getJestMockFunction();
    saveMock.mockImplementation((item: unknown) => {
      return Promise.resolve(item);
    });
    getJestSpyOn(service, "getRepository").mockReturnValue({
      save: saveMock,
    });

    getJestSpyOn(
      ModelPermission,
      "checkUpdateQueryPermissions",
    ).mockImplementation((_modelType: unknown, query: unknown) => {
      return Promise.resolve(query);
    });
    getJestSpyOn(
      ModelPermission,
      "checkUpdatePermissionByModel",
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("still runs the find and still reports the number of rows it matched", async () => {
    const numberOfDocsAffected: number = await service.updateBy({
      query: {} as any,
      data: { name: "renamed-probe" } as ProbeUpdateData,
      props: { isRoot: true },
      limit: 10,
      skip: 0,
    });

    /*
     * This assertion is also what proves the `_findBy` spy in the sibling
     * describe is wired to the method _updateBy really calls: the same spy,
     * on the same private method, IS exercised as soon as the payload has a
     * column. "not.toHaveBeenCalled()" over there is therefore meaningful.
     */
    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(numberOfDocsAffected).toBe(2);
  });

  it("still writes every row the find returned", async () => {
    await service.updateOneBy({
      query: { _id: TEST_ID } as any,
      data: { name: "renamed-probe" } as ProbeUpdateData,
      props: { isRoot: true },
    });

    expect(saveMock).toHaveBeenCalledTimes(2);
  });

  it("still calls onUpdateSuccess with the ids of the rows it updated", async () => {
    const onUpdateSuccessSpy: jest.SpyInstance = getJestSpyOn(
      service as any,
      "onUpdateSuccess",
    );

    await service.updateOneBy({
      query: { _id: TEST_ID } as any,
      data: { name: "renamed-probe" } as ProbeUpdateData,
      props: { isRoot: true, ignoreHooks: false },
    });

    const updatedIds: Array<ObjectID> = onUpdateSuccessSpy.mock
      .calls[0]![1] as Array<ObjectID>;

    expect(
      updatedIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([TEST_ID, OTHER_ID]);
  });
});
