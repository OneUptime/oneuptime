import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import Log from "../../../../Models/AnalyticsModels/Log";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../Types/Permission";

describe("Analytics ModelPermission owned scope", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const ownedServiceA: ObjectID = ObjectID.generate();
  const ownedServiceB: ObjectID = ObjectID.generate();

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
      .spyOn(ModelPermission as any, "resolveOwnedParentIds")
      .mockResolvedValue(
        new Set<string>([ownedServiceA.toString(), ownedServiceB.toString()]),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function addOwnedScope(query: any): Promise<any> {
    return await (ModelPermission as any).addOwnedScopeToQuery(
      Log,
      query,
      makeOwnedScopedMemberProps(),
      DatabaseRequestType.Read,
    );
  }

  it("intersects a caller-supplied primaryEntityId filter with owned ids", async () => {
    const result: any = await addOwnedScope({
      projectId,
      primaryEntityId: ownedServiceA,
    });

    /*
     * Regression: the owned-scope filter used to overwrite the caller's
     * primaryEntityId, so a per-service telemetry page showed logs from
     * every owned service.
     */
    expect(result.primaryEntityId).toBeInstanceOf(Includes);
    expect(result.primaryEntityId.values).toEqual([ownedServiceA.toString()]);
  });

  it("matches nothing when the requested service is not owned", async () => {
    const result: any = await addOwnedScope({
      projectId,
      primaryEntityId: ObjectID.generate(),
    });

    expect(result.primaryEntityId).toBeInstanceOf(Includes);
    expect(result.primaryEntityId.values).toEqual([
      ObjectID.getZeroObjectID().toString(),
    ]);
  });

  it("intersects a caller-supplied Includes filter", async () => {
    const unownedService: ObjectID = ObjectID.generate();
    const result: any = await addOwnedScope({
      projectId,
      primaryEntityId: new Includes([ownedServiceB, unownedService]),
    });

    expect(result.primaryEntityId).toBeInstanceOf(Includes);
    expect(result.primaryEntityId.values).toEqual([ownedServiceB.toString()]);
  });

  it("applies all allowed ids when the caller has no FK filter", async () => {
    const result: any = await addOwnedScope({ projectId });

    expect(result.primaryEntityId).toBeInstanceOf(Includes);
    // Owned services plus the project-scope bucket for unattributed telemetry.
    expect(new Set(result.primaryEntityId.values)).toEqual(
      new Set([
        ownedServiceA.toString(),
        ownedServiceB.toString(),
        projectId.toString(),
      ]),
    );
  });
});
