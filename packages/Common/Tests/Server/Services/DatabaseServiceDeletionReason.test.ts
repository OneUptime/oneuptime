import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import DeleteOneBy from "../../../Server/Types/Database/DeleteOneBy";
import Probe from "../../../Models/DatabaseModels/Probe";
import User from "../../../Models/DatabaseModels/User";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";

/*
 * "Why are you deleting this?" is asked in the confirmation dialog, so the
 * answer exists only for the length of the request that deletes the row. There
 * is nowhere to persist it on the way down - the row is about to be gone - so
 * it rides on the delete call itself and the hooks are the last place that can
 * record it. This pins the one hop where it could quietly be dropped:
 * deleteOneById rebuilding the delete as a query.
 */

const PROBE_ID: ObjectID = new ObjectID("550e8400-e29b-41d4-a716-446655440031");

describe("DatabaseService.deleteOneById and the deletion reason", () => {
  let service: DatabaseService<Probe>;
  let deleteOneByCalls: Array<DeleteOneBy<Probe>> = [];

  beforeEach(() => {
    jest.restoreAllMocks();

    service = new DatabaseService<Probe>(Probe);
    deleteOneByCalls = [];

    getJestSpyOn(
      ModelPermission,
      "checkDeletePermissionByModel",
    ).mockResolvedValue(undefined as never);

    getJestSpyOn(service, "deleteOneBy").mockImplementation((async (
      deleteOneBy: DeleteOneBy<Probe>,
    ) => {
      deleteOneByCalls.push(deleteOneBy);
      return 1;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("passes the reason on to the delete, where the hooks can see it", async () => {
    await service.deleteOneById({
      id: PROBE_ID,
      deletionReason: "No longer needed",
      props: { isRoot: true },
    });

    expect(deleteOneByCalls).toHaveLength(1);
    expect(deleteOneByCalls[0]?.deletionReason).toBe("No longer needed");
  });

  it("deletes the row the id names", async () => {
    await service.deleteOneById({
      id: PROBE_ID,
      deletionReason: "No longer needed",
      props: { isRoot: true },
    });

    expect(deleteOneByCalls[0]?.query).toEqual({ _id: PROBE_ID.toString() });
  });

  it("leaves the reason unset when the caller did not give one", async () => {
    await service.deleteOneById({
      id: PROBE_ID,
      props: { isRoot: true },
    });

    expect(deleteOneByCalls[0]?.deletionReason).toBeUndefined();
  });

  it("still carries the acting user alongside the reason", async () => {
    const actor: User = new User();
    actor._id = "550e8400-e29b-41d4-a716-446655440032";

    await service.deleteOneById({
      id: PROBE_ID,
      deletedByUser: actor,
      deletionReason: "Retiring this probe",
      props: { isRoot: true },
    });

    expect(deleteOneByCalls[0]?.deletedByUser).toBe(actor);
    expect(deleteOneByCalls[0]?.deletionReason).toBe("Retiring this probe");
  });

  /*
   * The reason travels with the request, not the row: nothing about it may
   * change who is allowed to delete what.
   */
  it("still checks delete permission before anything else", async () => {
    await service.deleteOneById({
      id: PROBE_ID,
      deletionReason: "No longer needed",
      props: { isRoot: false },
    });

    expect(ModelPermission.checkDeletePermissionByModel).toHaveBeenCalled();
  });

  it("does not delete anything when permission is refused", async () => {
    getJestSpyOn(
      ModelPermission,
      "checkDeletePermissionByModel",
    ).mockRejectedValue(new Error("not allowed") as never);

    await expect(
      service.deleteOneById({
        id: PROBE_ID,
        deletionReason: "No longer needed",
        props: { isRoot: false },
      }),
    ).rejects.toThrow("not allowed");

    expect(deleteOneByCalls).toHaveLength(0);
  });
});
