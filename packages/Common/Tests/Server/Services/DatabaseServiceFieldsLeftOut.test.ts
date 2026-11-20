jest.mock("../../../Server/Utils/Logger");

import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT A CREATE LEAVES OUT, RECORDED FOR ITS CALLER (CreateBy
 * .fieldsLeftOut, #10136).
 *
 * A create through the API goes on without what only OneUptime writes:
 * who did something to the record, a column only OneUptime writes, and a
 * value OneUptime fills in itself (a computed column the caller may read).
 * Each is named in the list the caller gave, once, by the name it was sent
 * under - also when a service takes them out before its create starts
 * (takeOutWhatTheServerSetsOnCreate), and again in the create itself.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10136100-0000-4000-8000-000000000001",
);

const OWNER: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.ProjectOwner],
    projectId: PROJECT_ID,
  }),
  ...ON_HIGHEST_PLAN,
};

class PlainCustomRoleService extends DatabaseService<CustomRole> {
  public constructor() {
    super(CustomRole);
  }

  // The step a service runs before its create starts, to call from here.
  public takeOutEarly(createBy: CreateBy<CustomRole>): void {
    this.takeOutWhatTheServerSetsOnCreate(createBy);
  }
}

const service: PlainCustomRoleService = new PlainCustomRoleService();

// A custom role as a copy of one read before sends it.
function copiedRole(): CustomRole {
  const role: CustomRole = new CustomRole();
  role.name = "On-call responders";
  role.projectId = PROJECT_ID;
  role.createdByUserId = new ObjectID("10136100-0000-4000-8000-0000000000c1");
  role.permissionCount = 12;
  return role;
}

describe("a create's caller is told what it left out", () => {
  test("who created it, and a value OneUptime fills in itself, each by its name", () => {
    const createBy: CreateBy<CustomRole> = {
      data: copiedRole(),
      props: OWNER,
      fieldsLeftOut: [],
    };

    service.takeOutEarly(createBy);

    expect(createBy.fieldsLeftOut).toEqual([
      "createdByUserId",
      "permissionCount",
    ]);
    // Left out, as before: the create goes on without them.
    expect(createBy.data.createdByUserId).toBeUndefined();
    expect(createBy.data.permissionCount).toBeUndefined();
    expect(createBy.data.name).toBe("On-call responders");
  });

  test("taken out twice - before the create starts, and in it - each is named once", () => {
    const createBy: CreateBy<CustomRole> = {
      data: copiedRole(),
      props: OWNER,
      fieldsLeftOut: [],
    };

    service.takeOutEarly(createBy);
    service.takeOutEarly(createBy);

    expect(createBy.fieldsLeftOut).toEqual([
      "createdByUserId",
      "permissionCount",
    ]);
  });

  test("OneUptime's own write keeps what it sends, and nothing is named", () => {
    const createBy: CreateBy<CustomRole> = {
      data: copiedRole(),
      props: { isRoot: true },
      fieldsLeftOut: [],
    };

    service.takeOutEarly(createBy);

    expect(createBy.fieldsLeftOut).toEqual([]);
    expect(createBy.data.permissionCount).toBe(12);
  });

  test("a caller that asks nothing is told nothing, and the create is as it was", () => {
    const createBy: CreateBy<CustomRole> = {
      data: copiedRole(),
      props: OWNER,
    };

    service.takeOutEarly(createBy);

    expect(createBy.fieldsLeftOut).toBeUndefined();
    expect(createBy.data.permissionCount).toBeUndefined();
  });
});
