import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import AccessControlPermission from "../../../../../Server/Types/Database/Permissions/AccessControlPermission";
import QueryUtil from "../../../../../Server/Types/Database/QueryUtil";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
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

  function mockRelatedTable(): void {
    jest.spyOn(QueryUtil, "getManyToManyRelatedTable").mockReturnValue({
      tableName: "Label",
      columnName: "_id",
      deleteDateColumnName: "deletedAt",
    });
  }

  // The SQL a raw condition writes for a column, and what it binds.
  function sqlOf(condition: any, alias: string): string {
    return condition.getSql(alias);
  }

  /*
   * #8113: the permitted labels are a condition on the record's own id - a
   * subquery on the label join table - and never a filter through the
   * labels relation, which joined to many in the WHERE: a list's page
   * could not take its ids from the table alone, and every record came
   * back with only the permitted labels it carries.
   */
  it("keeps the records carrying a permitted label by a condition on their id, not through the labels relation", async () => {
    mockJoinTableMetadata();
    mockRelatedTable();
    const query: any = { projectId };

    const result: any =
      await AccessControlPermission.addAccessControlIdsToQuery(
        Monitor,
        query,
        null,
        makeLabelRestrictedProps(),
        DatabaseRequestType.Read,
      );

    expect(result.labels).toBeUndefined();
    expect(result.projectId).toBe(projectId);
    expect(result._id).toBeInstanceOf(FindOperator);
    expect(result._id.type).toBe("raw");
    expect(Object.values(result._id.objectLiteralParameters)).toEqual([
      [permittedLabelA.toString(), permittedLabelB.toString()],
    ]);

    // Linked to a permitted label that is there and not deleted.
    const sql: string = sqlOf(result._id, '"Monitor"."_id"');
    expect(sql).toMatch(
      /^\("Monitor"\."_id" IN \(SELECT "MonitorLabel"\."monitorId" FROM "MonitorLabel" WHERE "MonitorLabel"\."labelId" IN \(SELECT "Label"\."_id" FROM "Label" WHERE "Label"\."_id" IN \(:\.\.\.\w+\) AND "Label"\."deletedAt" IS NULL\)\)\)$/,
    );
  });

  it("keeps an id the caller filters by, serialized, beside the permitted labels", async () => {
    mockJoinTableMetadata();
    mockRelatedTable();
    const monitorA: ObjectID = ObjectID.generate();
    const monitorB: ObjectID = ObjectID.generate();

    for (const idFilter of [
      monitorA,
      new Includes([monitorA, monitorB]),
      [monitorA.toString(), monitorB.toString()],
    ]) {
      const result: any =
        await AccessControlPermission.addAccessControlIdsToQuery(
          Monitor,
          { projectId, _id: idFilter } as any,
          null,
          makeLabelRestrictedProps(),
          DatabaseRequestType.Read,
        );

      // Both hold: the caller's ids, and the permitted labels.
      expect(result._id.type).toBe("and");
      expect(result._id.value).toHaveLength(2);
      expect(result._id.value[0]).toBeInstanceOf(FindOperator);
      expect(
        Object.values(result._id.value[0].objectLiteralParameters),
      ).toEqual([
        idFilter instanceof ObjectID
          ? monitorA.toString()
          : [monitorA.toString(), monitorB.toString()],
      ]);
      expect(result._id.value[1].type).toBe("raw");
      expect(result.labels).toBeUndefined();
    }
  });

  it("asks each grant's labels in a condition of its own: one label of each", async () => {
    mockJoinTableMetadata();
    mockRelatedTable();
    const otherLabel: ObjectID = ObjectID.generate();

    let query: any = AccessControlPermission.addLabelIdsToQuery(
      Monitor,
      { projectId } as any,
      [permittedLabelA],
    );
    query = AccessControlPermission.addLabelIdsToQuery(Monitor, query, [
      otherLabel,
    ]);

    expect(query._id.type).toBe("and");
    expect(
      query._id.value.map((part: any): Array<unknown> => {
        return Object.values(part.objectLiteralParameters);
      }),
    ).toEqual([[[permittedLabelA.toString()]], [[otherLabel.toString()]]]);
  });

  it("refuses an id filter it cannot combine with the permitted labels", () => {
    mockJoinTableMetadata();
    mockRelatedTable();
    jest
      .spyOn(QueryUtil, "serializeQuery")
      .mockReturnValue({ _id: { not: "an operator" } } as any);

    expect(() => {
      AccessControlPermission.addLabelIdsToQuery(
        Monitor,
        { projectId, _id: "x" } as any,
        [permittedLabelA],
      );
    }).toThrow(BadDataException);
  });

  it("asks nothing of a model without labels, or of no labels", () => {
    mockJoinTableMetadata();
    const query: any = { projectId };

    expect(
      AccessControlPermission.addLabelIdsToQuery(Monitor, query, []),
    ).toEqual({ projectId });
    expect(
      AccessControlPermission.getCarriesLabelsCondition(TeamMember, [
        permittedLabelA,
      ]),
    ).toBeNull();
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

  /*
   * Without the join table's metadata the two conditions cannot both be
   * asked, so the list already there keeps only the labels on both: it never
   * widens to labels it did not hold (the labels of another grant asked
   * first, a write's own beside its read's), and with none on both nothing
   * matches.
   */
  it("fails closed to the labels on both when join metadata is unavailable", async () => {
    jest
      .spyOn(QueryUtil, "getManyToManyRelationMetadata")
      .mockReturnValue(null);
    const otherLabel: ObjectID = ObjectID.generate();
    const query: any = { projectId, labels: [otherLabel, permittedLabelB] };

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
    ).toEqual([permittedLabelB.toString()]);
    expect(result._id).toBeUndefined();
  });

  it("matches nothing when no label is on both and join metadata is unavailable", async () => {
    jest
      .spyOn(QueryUtil, "getManyToManyRelationMetadata")
      .mockReturnValue(null);
    const otherLabel: ObjectID = ObjectID.generate();
    const query: any = { projectId, labels: [otherLabel] };

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
    ).toEqual([otherLabel.toString()]);
    expect(
      Object.values(
        (
          result._id as unknown as {
            objectLiteralParameters: Record<string, string>;
          }
        ).objectLiteralParameters,
      ),
    ).toEqual([ObjectID.getZeroObjectID().toString()]);
  });

  it("narrows to the permitted set when join metadata is unavailable and nothing else filters the labels", async () => {
    jest
      .spyOn(QueryUtil, "getManyToManyRelationMetadata")
      .mockReturnValue(null);

    const result: any =
      await AccessControlPermission.addAccessControlIdsToQuery(
        Monitor,
        { projectId } as any,
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

describe("AccessControlPermission.getAccessControlIdsForQuery", () => {
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

  function toStrings(ids: Array<ObjectID>): Array<string> {
    return ids.map((id: ObjectID) => {
      return id.toString();
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the permitted label ids deduped for a multi-column select, same as a query-only call", () => {
    const withSelect: Array<ObjectID> =
      AccessControlPermission.getAccessControlIdsForQuery(
        Monitor,
        { projectId } as any,
        { _id: true, createdAt: true, name: true } as any,
        makeLabelRestrictedProps(),
        DatabaseRequestType.Read,
      );

    const queryOnly: Array<ObjectID> =
      AccessControlPermission.getAccessControlIdsForQuery(
        Monitor,
        { projectId } as any,
        null,
        makeLabelRestrictedProps(),
        DatabaseRequestType.Read,
      );

    expect(toStrings(withSelect)).toEqual([
      permittedLabelA.toString(),
      permittedLabelB.toString(),
    ]);
    expect(toStrings(withSelect)).toEqual(toStrings(queryOnly));
  });

  it("returns an empty array for users with an unrestricted grant regardless of column count", () => {
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

    const result: Array<ObjectID> =
      AccessControlPermission.getAccessControlIdsForQuery(
        Monitor,
        { projectId } as any,
        { _id: true, createdAt: true, updatedAt: true, name: true } as any,
        {
          userId,
          tenantId: projectId,
          userTenantAccessPermission: {
            [projectId.toString()]: tenantPermission,
          },
        },
        DatabaseRequestType.Read,
      );

    expect(result).toEqual([]);
  });

  it("computes user permissions exactly once regardless of column count", () => {
    const getUserPermissionsSpy: jest.SpyInstance = jest.spyOn(
      DatabaseCommonInteractionPropsUtil,
      "getUserPermissions",
    );

    const props: DatabaseCommonInteractionProps = makeLabelRestrictedProps();

    AccessControlPermission.getAccessControlIdsForQuery(
      Monitor,
      { projectId } as any,
      { _id: true, createdAt: true, updatedAt: true, name: true } as any,
      props,
      DatabaseRequestType.Read,
    );

    /*
     * Perf regression guard: the old code rebuilt the full user-permission
     * set once per access-controlled column plus once for the model-level
     * check. The context must be built exactly once per query: the allow
     * rows the labels are read from, then what the table check holds the
     * caller to (TablePermission.getHeldPermissions: the allow rows and the
     * block rows) - a block with no labels on the wildcard takes the
     * wildcard's grant away.
     */
    expect(getUserPermissionsSpy).toHaveBeenCalledTimes(3);
    expect(getUserPermissionsSpy).toHaveBeenNthCalledWith(
      1,
      props,
      PermissionType.Allow,
    );
    expect(getUserPermissionsSpy).toHaveBeenNthCalledWith(
      2,
      props,
      PermissionType.Allow,
    );
    expect(getUserPermissionsSpy).toHaveBeenNthCalledWith(
      3,
      props,
      PermissionType.Block,
    );
  });

  it("still applies the idempotent Public push to props exactly once", () => {
    const props: DatabaseCommonInteractionProps = makeLabelRestrictedProps();

    AccessControlPermission.getAccessControlIdsForQuery(
      Monitor,
      { projectId } as any,
      { _id: true, createdAt: true, name: true } as any,
      props,
      DatabaseRequestType.Read,
    );

    const globalPermissions: Array<Permission> =
      props.userGlobalAccessPermission?.globalPermissions || [];

    expect(
      globalPermissions.filter((permission: Permission) => {
        return permission === Permission.Public;
      }),
    ).toHaveLength(1);
  });

  it("getAccessControlIdsForModel with three args still returns the model-level permitted ids", () => {
    const result: Array<ObjectID> =
      AccessControlPermission.getAccessControlIdsForModel(
        Monitor,
        makeLabelRestrictedProps(),
        DatabaseRequestType.Read,
      );

    expect(toStrings(result)).toEqual([
      permittedLabelA.toString(),
      permittedLabelB.toString(),
    ]);
  });
});
