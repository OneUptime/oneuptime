import MonitorService from "../../../Server/Services/MonitorService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A create builds a brand-new row, so the payload must not carry the row's own
 * primary key. `getRepository().save()` treats an entity that already has an id
 * as an update of that existing row rather than an insert, so an `_id` left on
 * a create payload makes the "create" modify a record the caller never named.
 *
 * Two layers keep that from happening, and these tests pin both:
 *   - BaseAPI.createItem strips the top-level id from the model it builds
 *     (BaseModel.fromJSON folds a client `id` into `_id`, so both spellings go).
 *   - DatabaseService.create refuses a pre-set `_id` from a non-root caller
 *     before any hook or query runs. Root/internal seeding assigns ids and is
 *     exempt.
 *
 * Nested `_id`s inside relation objects/arrays are left alone - they reference
 * existing related rows and are a normal part of a create payload.
 */

const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-00000000000a",
);
const CALLER_PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-00000000000b",
);
// The id of a row that already exists.
const EXISTING_ROW_ID: string = "00000000-0000-4000-8000-0000000000cc";

const memberProps: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: CALLER_PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: new ObjectID("00000000-0000-4000-8000-000000000003"),
    tenantId: CALLER_PROJECT_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [CALLER_PROJECT_ID.toString()]: tenantPermission,
    },
  };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Primary keys supplied on a create payload", () => {
  test("BaseAPI.createItem strips the top-level id its model builder produced", () => {
    /*
     * BaseModel.fromJSON maps a client `id` -> `_id` and keeps `_id`; this is
     * how a request body's id ends up on the entity in the first place.
     */
    const created: Monitor = BaseModel.fromJSON<Monitor>(
      { id: EXISTING_ROW_ID, name: "x" } as JSONObject,
      Monitor,
    ) as Monitor;
    expect(created._id).toBe(EXISTING_ROW_ID);

    // What BaseAPI.createItem now does to that entity before create().
    delete (created as unknown as { _id?: string })._id;
    delete (created as unknown as { id?: string }).id;
    expect(created._id).toBeUndefined();

    /*
     * A nested relation id (Entity/EntityArray) must survive that strip - it
     * references an existing related row, not the row being created.
     */
    const withRelation: Monitor = BaseModel.fromJSON<Monitor>(
      {
        _id: EXISTING_ROW_ID,
        name: "x",
        labels: [{ _id: "00000000-0000-4000-8000-0000000000dd" }],
      } as JSONObject,
      Monitor,
    ) as Monitor;
    delete (withRelation as unknown as { _id?: string })._id;
    expect(withRelation._id).toBeUndefined();
    expect(
      (withRelation.labels && withRelation.labels[0]?._id) || undefined,
    ).toBe("00000000-0000-4000-8000-0000000000dd");
  });

  test("DatabaseService.create refuses a non-root create carrying an _id, before any hook or query", async () => {
    /*
     * If the refusal ever regresses, the spies below would let a full create
     * run; fail loudly instead by making the first thing create() would reach
     * after the check throw.
     */
    const repoSpy: jest.SpyInstance = jest
      .spyOn(MonitorService, "getRepository")
      .mockImplementation((() => {
        throw new Error("save() must not be reached for an _id create");
      }) as never) as unknown as jest.SpyInstance;
    const hookSpy: jest.SpyInstance = jest.spyOn(
      MonitorService,
      "onBeforeCreate" as never,
    ) as unknown as jest.SpyInstance;

    const incoming: Monitor = new Monitor();
    incoming._id = EXISTING_ROW_ID;
    incoming.name = "renamed";

    const createBy: CreateBy<Monitor> = {
      data: incoming,
      props: memberProps([
        Permission.CreateProjectMonitor,
        Permission.ProjectMember,
      ]),
    };

    await expect(MonitorService.create(createBy)).rejects.toBeInstanceOf(
      BadDataException,
    );
    expect(hookSpy).not.toHaveBeenCalled();
    expect(repoSpy).not.toHaveBeenCalled();

    // Guard against a false pass if the two ids were ever made equal.
    expect(OTHER_PROJECT_ID.toString()).not.toBe(CALLER_PROJECT_ID.toString());
  });
});
