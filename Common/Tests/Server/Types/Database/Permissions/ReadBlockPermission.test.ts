import ReadPermission from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { FindOperator } from "typeorm";

describe("ReadPermission.checkReadBlockPermission", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const blockedLabelA: ObjectID = ObjectID.generate();
  const blockedLabelB: ObjectID = ObjectID.generate();

  function makeProps(
    permissions: Array<UserPermission>,
  ): DatabaseCommonInteractionProps {
    const tenantPermission: UserTenantAccessPermission = {
      projectId,
      _type: "UserTenantAccessPermission",
      permissions,
    };

    return {
      userId,
      tenantId: projectId,
      userTenantAccessPermission: {
        [projectId.toString()]: tenantPermission,
      },
    };
  }

  function blockPermission(
    permission: Permission,
    labelIds: Array<ObjectID>,
  ): UserPermission {
    return {
      _type: "UserPermission",
      permission,
      labelIds,
      isBlockPermission: true,
    };
  }

  function allowPermission(
    permission: Permission,
    labelIds: Array<ObjectID>,
  ): UserPermission {
    return {
      _type: "UserPermission",
      permission,
      labelIds,
      isBlockPermission: false,
    };
  }

  it("leaves the query untouched for a root request", async () => {
    const query: any = { projectId };

    const result: any = await ReadPermission.checkReadBlockPermission(
      Incident,
      query,
      {
        isRoot: true,
        ...makeProps([
          blockPermission(Permission.ProjectMember, [blockedLabelA]),
        ]),
      },
    );

    expect(result.query.labels).toBeUndefined();
  });

  it("leaves the query untouched for a master admin request", async () => {
    const query: any = { projectId };

    const result: any = await ReadPermission.checkReadBlockPermission(
      Incident,
      query,
      {
        isMasterAdmin: true,
        ...makeProps([
          blockPermission(Permission.ProjectMember, [blockedLabelA]),
        ]),
      },
    );

    expect(result.query.labels).toBeUndefined();
  });

  it("throws when a block permission on this model carries no labels", async () => {
    /*
     * A block row without labels is a table-level deny: there is no subset of
     * rows left to read, so the request is refused rather than filtered.
     */
    const query: any = { projectId };

    await expect(
      ReadPermission.checkReadBlockPermission(
        Incident,
        query,
        makeProps([blockPermission(Permission.ProjectMember, [])]),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("filters the blocked labels out of the query when the block carries labels", async () => {
    const query: any = { projectId };

    const result: any = await ReadPermission.checkReadBlockPermission(
      Incident,
      query,
      makeProps([blockPermission(Permission.ProjectMember, [blockedLabelA])]),
    );

    expect(result.query.labels).toBeDefined();
    expect(result.query.labels._id).toBeInstanceOf(FindOperator);
    // The caller's own filters survive the rewrite.
    expect(result.query.projectId).toEqual(projectId);
  });

  it("merges the labels of every block permission that belongs to the model", async () => {
    const query: any = { projectId };

    const result: any = await ReadPermission.checkReadBlockPermission(
      Incident,
      query,
      makeProps([
        blockPermission(Permission.ProjectMember, [blockedLabelA]),
        blockPermission(Permission.IncidentViewer, [blockedLabelB]),
      ]),
    );

    const raw: string = JSON.stringify(result.query.labels._id);
    expect(raw).toContain(blockedLabelA.toString());
    expect(raw).toContain(blockedLabelB.toString());
  });

  it("ignores a block permission that does not belong to this model", async () => {
    /*
     * Monitor-only permissions must not narrow an Incident read, otherwise a
     * block on one resource would silently hide rows of another.
     */
    const query: any = { projectId };

    const result: any = await ReadPermission.checkReadBlockPermission(
      Incident,
      query,
      makeProps([blockPermission(Permission.MonitorViewer, [blockedLabelA])]),
    );

    expect(result.query.labels).toBeUndefined();
  });

  it("ignores labels carried by an allow permission", async () => {
    /*
     * Labels on an allow row scope what the user can see; only a block row
     * subtracts from it. Reading the flag the wrong way round would turn a
     * grant into a deny.
     */
    const query: any = { projectId };

    const result: any = await ReadPermission.checkReadBlockPermission(
      Incident,
      query,
      makeProps([allowPermission(Permission.ProjectMember, [blockedLabelA])]),
    );

    expect(result.query.labels).toBeUndefined();
  });

  it("applies the same filtering to another labelled model", async () => {
    const query: any = { projectId };

    const result: any = await ReadPermission.checkReadBlockPermission(
      Monitor,
      query,
      makeProps([blockPermission(Permission.ProjectMember, [blockedLabelA])]),
    );

    expect(result.query.labels).toBeDefined();
    expect(result.query.labels._id).toBeInstanceOf(FindOperator);
  });
});
