import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { FindOperator } from "typeorm";

describe("OwnedScopePermission.addOwnedScopeToQuery", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const ownedIdA: ObjectID = ObjectID.generate();
  const ownedIdB: ObjectID = ObjectID.generate();

  function makeOwnedScopedMemberProps(): DatabaseCommonInteractionProps {
    const tenantPermission: UserTenantAccessPermission = {
      projectId,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
          scope: PermissionScope.Owned,
        },
      ],
    };

    return {
      userId,
      tenantId: projectId,
      userTenantAccessPermission: {
        [projectId.toString()]: tenantPermission,
      },
    };
  }

  beforeEach(() => {
    jest
      .spyOn(OwnedScopePermission as any, "getAllowedResourceIds")
      .mockResolvedValue([ownedIdA, ownedIdB]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("preserves a caller-supplied FK filter on @OwnedThrough models", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const query: any = { incidentId, projectId };

    const result: any = await OwnedScopePermission.addOwnedScopeToQuery(
      IncidentInternalNote,
      query,
      makeOwnedScopedMemberProps(),
      DatabaseRequestType.Read,
    );

    /*
     * Regression: the Owned scope used to overwrite incidentId with
     * IN(<all owned incidents>), widening per-incident child queries
     * (notes/feed/owners) to every owned incident.
     */
    expect(result.incidentId).toBeInstanceOf(FindOperator);
    expect(result.incidentId.type).toBe("and");
    expect(result.incidentId.value[0].type).toBe("equal");
    expect(result.incidentId.value[0].value).toBe(incidentId.toString());
    expect(result.incidentId.value[1].type).toBe("raw");
  });

  it("applies only the owned-ids filter when the caller has no FK filter", async () => {
    const result: any = await OwnedScopePermission.addOwnedScopeToQuery(
      IncidentInternalNote,
      { projectId } as any,
      makeOwnedScopedMemberProps(),
      DatabaseRequestType.Read,
    );

    expect(result.incidentId).toBeInstanceOf(FindOperator);
    expect(result.incidentId.type).toBe("raw");
  });

  it("preserves a caller-supplied _id on top-level operational resources", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const query: any = { _id: incidentId.toString(), projectId };

    const result: any = await OwnedScopePermission.addOwnedScopeToQuery(
      Incident,
      query,
      makeOwnedScopedMemberProps(),
      DatabaseRequestType.Update,
    );

    /*
     * Regression: the Owned scope used to overwrite _id with
     * IN(<all owned ids>), so "get/update record X" could resolve
     * against a different owned record.
     */
    expect(result._id).toBeInstanceOf(FindOperator);
    expect(result._id.type).toBe("and");
    expect(result._id.value[0].type).toBe("equal");
    expect(result._id.value[0].value).toBe(incidentId.toString());
    expect(result._id.value[1].type).toBe("raw");
  });

  it("still matches nothing when the user owns no resources", async () => {
    jest
      .spyOn(OwnedScopePermission as any, "getAllowedResourceIds")
      .mockResolvedValue([]);

    const result: any = await OwnedScopePermission.addOwnedScopeToQuery(
      Incident,
      { _id: ObjectID.generate().toString() } as any,
      makeOwnedScopedMemberProps(),
      DatabaseRequestType.Read,
    );

    // Fail-closed: _id is forced to the zero ObjectID, matching no rows.
    expect(result._id).toBeInstanceOf(FindOperator);
    expect(result._id.type).toBe("raw");
  });

  it("does not restrict users that also hold a non-Owned grant", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const tenantPermission: UserTenantAccessPermission = {
      projectId,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
          scope: PermissionScope.All,
        },
      ],
    };

    const result: any = await OwnedScopePermission.addOwnedScopeToQuery(
      IncidentInternalNote,
      { incidentId } as any,
      {
        userId,
        tenantId: projectId,
        userTenantAccessPermission: {
          [projectId.toString()]: tenantPermission,
        },
      },
      DatabaseRequestType.Read,
    );

    expect(result.incidentId).toBe(incidentId);
  });
});
