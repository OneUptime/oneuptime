import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import AccessControlPermission from "../../../../../Server/Types/Database/Permissions/AccessControlPermission";
import QueryUtil from "../../../../../Server/Types/Database/QueryUtil";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { FindOperator } from "typeorm";

describe("AccessControlPermission.addAccessControlIdsToQuery", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const permittedLabelA: ObjectID = ObjectID.generate();
  const permittedLabelB: ObjectID = ObjectID.generate();

  function makeLabelRestrictedProps(): DatabaseCommonInteractionProps {
    // A user whose ONLY read grant on Monitor is label-restricted.
    const tenantPermission: UserTenantAccessPermission = {
      projectId,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ReadProjectMonitor,
          labelIds: [permittedLabelA, permittedLabelB],
          isBlockPermission: false,
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

  function mockJoinTableMetadata(): void {
    jest.spyOn(QueryUtil, "getManyToManyRelationMetadata").mockReturnValue({
      joinTableName: "MonitorLabel",
      ownerColumnName: "monitorId",
      relationColumnName: "labelId",
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adds the permitted-label filter when the caller has no label filter", async () => {
    mockJoinTableMetadata();
    const query: any = { projectId };

    const result: any =
      await AccessControlPermission.addAccessControlIdsToQuery(
        Monitor,
        query,
        null,
        makeLabelRestrictedProps(),
        DatabaseRequestType.Read,
      );

    expect(
      (result.labels as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([permittedLabelA.toString(), permittedLabelB.toString()]);
    expect(result._id).toBeUndefined();
  });

  it("preserves a caller-supplied label filter and ANDs the permitted set onto _id", async () => {
    mockJoinTableMetadata();
    const requestedLabel: ObjectID = ObjectID.generate();
    const callerLabelFilter: Array<ObjectID> = [requestedLabel];
    const query: any = { projectId, labels: callerLabelFilter };

    const result: any =
      await AccessControlPermission.addAccessControlIdsToQuery(
        Monitor,
        query,
        null,
        makeLabelRestrictedProps(),
        DatabaseRequestType.Read,
      );

    /*
     * Regression: the permitted set used to overwrite the caller's label
     * filter, so "filter by label X" silently widened to "any permitted
     * label". The caller's filter must survive untouched, with the
     * permitted-set predicate applied separately (join-table subquery on
     * _id) so both must hold.
     */
    expect(result.labels).toBe(callerLabelFilter);
    expect(result._id).toBeInstanceOf(FindOperator);
    expect(result._id.type).toBe("raw");
    expect(Object.values(result._id.objectLiteralParameters)).toEqual([
      [permittedLabelA.toString(), permittedLabelB.toString()],
    ]);
  });

  it("AND-combines the permitted-set predicate with an existing _id filter", async () => {
    mockJoinTableMetadata();
    const monitorId: ObjectID = ObjectID.generate();
    const query: any = {
      projectId,
      _id: monitorId.toString(),
      labels: [ObjectID.generate()],
    };

    const result: any =
      await AccessControlPermission.addAccessControlIdsToQuery(
        Monitor,
        query,
        null,
        makeLabelRestrictedProps(),
        DatabaseRequestType.Read,
      );

    expect(result._id).toBeInstanceOf(FindOperator);
    expect(result._id.type).toBe("and");
    expect(result._id.value[0].type).toBe("equal");
    expect(result._id.value[0].value).toBe(monitorId.toString());
    expect(result._id.value[1].type).toBe("raw");
  });

  it("fails closed to the permitted set when join metadata is unavailable", async () => {
    jest
      .spyOn(QueryUtil, "getManyToManyRelationMetadata")
      .mockReturnValue(null);
    const query: any = { projectId, labels: [ObjectID.generate()] };

    const result: any =
      await AccessControlPermission.addAccessControlIdsToQuery(
        Monitor,
        query,
        null,
        makeLabelRestrictedProps(),
        DatabaseRequestType.Read,
      );

    expect(
      (result.labels as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([permittedLabelA.toString(), permittedLabelB.toString()]);
    expect(result._id).toBeUndefined();
  });

  it("leaves the query untouched for users with an unrestricted grant", async () => {
    mockJoinTableMetadata();
    const callerLabelFilter: Array<ObjectID> = [ObjectID.generate()];
    const query: any = { projectId, labels: callerLabelFilter };

    const tenantPermission: UserTenantAccessPermission = {
      projectId,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    };

    const result: any =
      await AccessControlPermission.addAccessControlIdsToQuery(
        Monitor,
        query,
        null,
        {
          userId,
          tenantId: projectId,
          userTenantAccessPermission: {
            [projectId.toString()]: tenantPermission,
          },
        },
        DatabaseRequestType.Read,
      );

    expect(result.labels).toBe(callerLabelFilter);
    expect(result._id).toBeUndefined();
  });
});
