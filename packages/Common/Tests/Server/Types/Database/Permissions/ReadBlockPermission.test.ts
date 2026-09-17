import ReadPermission from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import QueryUtil from "../../../../../Server/Types/Database/QueryUtil";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "../../../../../Types/BaseDatabase/IncludesAnyOfGroups";
import IncludesNone from "../../../../../Types/BaseDatabase/IncludesNone";
import EqualTo from "../../../../../Types/BaseDatabase/EqualTo";
import NotEqual from "../../../../../Types/BaseDatabase/NotEqual";
import Search from "../../../../../Types/BaseDatabase/Search";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { FindOperator, In } from "typeorm";

describe("ReadPermission.checkReadBlockPermission", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const blockedLabelA: ObjectID = ObjectID.generate();
  const blockedLabelB: ObjectID = ObjectID.generate();

  beforeEach(() => {
    jest
      .spyOn(QueryUtil, "getManyToManyRelationMetadata")
      .mockImplementation((modelType: any, column: string) => {
        if (column !== "labels") {
          return null;
        }
        return {
          joinTableName:
            modelType === Monitor ? "MonitorLabel" : "IncidentLabel",
          ownerColumnName: modelType === Monitor ? "monitorId" : "incidentId",
          relationColumnName: "labelId",
        };
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  /*
   * Read the owner-row exclusion predicate, including the relation table it
   * uses, so the test checks that label blocks are composed independently of
   * the caller's relation filters.
   */
  function deniedLabelIds(
    operator: any,
    joinTableName: string = "IncidentLabel",
  ): Array<string> {
    expect(operator).toBeInstanceOf(FindOperator);
    expect(operator.type).toBe("raw");

    const sql: string = operator.getSql("ownerId");
    expect(sql).toContain("ownerId NOT IN (SELECT");
    expect(sql).toContain(`FROM "${joinTableName}"`);
    expect(sql).toContain(`WHERE "${joinTableName}"."labelId" IN (`);

    return Object.values(
      operator.objectLiteralParameters as Record<string, Array<string>>,
    )[0] as Array<string>;
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

    expect(result.query.labels).toBeUndefined();
    expect(deniedLabelIds(result.query._id)).toEqual([
      blockedLabelA.toString(),
    ]);
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

    expect(deniedLabelIds(result.query._id)).toEqual([
      blockedLabelA.toString(),
      blockedLabelB.toString(),
    ]);
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

    expect(result.query.labels).toBeUndefined();
    expect(deniedLabelIds(result.query._id, "MonitorLabel")).toEqual([
      blockedLabelA.toString(),
    ]);
  });

  it("preserves an existing label selection while adding the block condition", async () => {
    const labels: Includes = new Includes([ObjectID.generate().toString()]);
    const query: any = { projectId, labels };

    const result: any = await ReadPermission.checkReadBlockPermission(
      Monitor,
      query,
      makeProps([blockPermission(Permission.ProjectMember, [blockedLabelA])]),
    );

    expect(result.query.labels).toBe(labels);
    expect(result.query.projectId).toBe(projectId);
    expect(deniedLabelIds(result.query._id, "MonitorLabel")).toEqual([
      blockedLabelA.toString(),
    ]);
  });

  it("preserves grouped dashboard labels, project, status, and the selected record through query serialization", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    const fixedLabelId: string = ObjectID.generate().toString();
    const selectedLabelId: string = ObjectID.generate().toString();
    const labels: IncludesAnyOfGroups = new IncludesAnyOfGroups([
      [fixedLabelId],
      [selectedLabelId],
    ]);
    const currentMonitorStatusId: ObjectID = ObjectID.generate();
    const query: any = {
      projectId,
      _id: monitorId,
      labels,
      currentMonitorStatusId,
    };

    const result: any = await ReadPermission.checkReadBlockPermission(
      Monitor,
      query,
      makeProps([blockPermission(Permission.ProjectMember, [blockedLabelA])]),
    );

    expect(result.query.labels).toBe(labels);
    expect(result.query.projectId).toBe(projectId);
    expect(result.query.currentMonitorStatusId).toBe(currentMonitorStatusId);
    expect(result.query._id.type).toBe("and");
    expect(result.query._id.value[0].type).toBe("raw");
    expect(
      Object.values(result.query._id.value[0].objectLiteralParameters),
    ).toEqual([monitorId.toString()]);
    expect(deniedLabelIds(result.query._id.value[1], "MonitorLabel")).toEqual([
      blockedLabelA.toString(),
    ]);

    const recordAndBlockCondition: FindOperator<any> = result.query._id;
    const serialized: any = QueryUtil.serializeQuery(Monitor, result.query);
    expect(serialized.labels).toBeUndefined();
    expect(serialized._id.type).toBe("and");
    const clauses: Array<FindOperator<any>> = serialized._id.value;
    expect(clauses).toHaveLength(3);
    expect(clauses[0]).toBe(recordAndBlockCondition);
    expect(Object.values(clauses[1]!.objectLiteralParameters || {})).toEqual([
      [fixedLabelId],
    ]);
    expect(Object.values(clauses[2]!.objectLiteralParameters || {})).toEqual([
      [selectedLabelId],
    ]);
    expect(Object.values(serialized.projectId.objectLiteralParameters)).toEqual(
      [projectId.toString()],
    );
    expect(
      Object.values(serialized.currentMonitorStatusId.objectLiteralParameters),
    ).toEqual([currentMonitorStatusId.toString()]);
  });

  it("combines with an existing database ID condition without replacing it", async () => {
    const idFilter: FindOperator<string> = In([ObjectID.generate().toString()]);
    const query: any = { projectId, _id: idFilter };

    const result: any = await ReadPermission.checkReadBlockPermission(
      Incident,
      query,
      makeProps([blockPermission(Permission.ProjectMember, [blockedLabelA])]),
    );

    expect(result.query._id.type).toBe("and");
    expect(result.query._id.value[0]).toBe(idFilter);
    expect(deniedLabelIds(result.query._id.value[1])).toEqual([
      blockedLabelA.toString(),
    ]);
  });

  const requestedId: string = ObjectID.generate().toString();

  it.each([
    {
      name: "EqualTo",
      idFilter: new EqualTo(requestedId),
      expectedSql: "Monitor._id = :",
      expectedParameters: [requestedId],
    },
    {
      name: "IncludesNone",
      idFilter: new IncludesNone([new ObjectID(requestedId)]),
      expectedSql: "Monitor._id NOT IN (",
      expectedParameters: [[requestedId]],
    },
    {
      name: "NotEqual",
      idFilter: new NotEqual(requestedId),
      expectedSql: "Monitor._id != :",
      expectedParameters: [requestedId],
    },
    {
      name: "Search",
      idFilter: new Search(requestedId),
      expectedSql: "CAST(Monitor._id AS TEXT) ILIKE",
      expectedParameters: [`%${requestedId}%`],
    },
    {
      name: "Includes",
      idFilter: new Includes([requestedId]),
      expectedSql: "Monitor._id IN (",
      expectedParameters: [[requestedId]],
    },
  ])(
    "preserves the $name ID filter when composing read label restrictions",
    async ({
      idFilter,
      expectedSql,
      expectedParameters,
    }: {
      idFilter: unknown;
      expectedSql: string;
      expectedParameters: Array<unknown>;
    }): Promise<void> => {
      const labels: IncludesAnyOfGroups = new IncludesAnyOfGroups([
        [ObjectID.generate().toString()],
        [ObjectID.generate().toString()],
      ]);
      const query: any = { projectId, _id: idFilter, labels };

      const result: any = await ReadPermission.checkReadBlockPermission(
        Monitor,
        query,
        makeProps([blockPermission(Permission.ProjectMember, [blockedLabelA])]),
      );

      expect(result.query.labels).toBe(labels);
      expect(result.query._id.type).toBe("and");
      const callerCondition: FindOperator<unknown> = result.query._id.value[0];
      expect(callerCondition.type).toBe("raw");
      expect(callerCondition.getSql?.("Monitor._id")).toContain(expectedSql);
      expect(
        Object.values(callerCondition.objectLiteralParameters || {}),
      ).toEqual(expectedParameters);
      expect(deniedLabelIds(result.query._id.value[1], "MonitorLabel")).toEqual(
        [blockedLabelA.toString()],
      );

      const recordAndBlockCondition: FindOperator<unknown> = result.query._id;
      const serialized: any = QueryUtil.serializeQuery(Monitor, result.query);
      expect(serialized._id.value[0]).toBe(recordAndBlockCondition);
      expect(serialized._id.value).toHaveLength(3);
    },
  );

  it("rejects an unsupported ID condition before changing the caller's query", async () => {
    const idFilter: Record<string, unknown> = { comparison: "unsupported" };
    const labels: Includes = new Includes([ObjectID.generate().toString()]);
    const query: any = { projectId, _id: idFilter, labels };

    await expect(
      ReadPermission.checkReadBlockPermission(
        Monitor,
        query,
        makeProps([blockPermission(Permission.ProjectMember, [blockedLabelA])]),
      ),
    ).rejects.toThrow("unsupported ID filter");
    expect(query).toEqual({ projectId, _id: idFilter, labels });
  });

  it("reports missing relation metadata without changing the caller's filters", async () => {
    jest
      .spyOn(QueryUtil, "getManyToManyRelationMetadata")
      .mockReturnValue(null);
    const labels: IncludesAnyOfGroups = new IncludesAnyOfGroups([
      [ObjectID.generate().toString()],
      [ObjectID.generate().toString()],
    ]);
    const monitorId: ObjectID = ObjectID.generate();
    const query: any = { projectId, labels, _id: monitorId };

    await expect(
      ReadPermission.checkReadBlockPermission(
        Monitor,
        query,
        makeProps([blockPermission(Permission.ProjectMember, [blockedLabelA])]),
      ),
    ).rejects.toThrow(BadDataException);
    expect(query).toEqual({ projectId, labels, _id: monitorId });
  });

  it("reports an unavailable access-control column before composing label restrictions", async () => {
    jest
      .spyOn(Monitor.prototype, "getAccessControlColumn")
      .mockReturnValue(null);
    const query: any = { projectId };

    await expect(
      ReadPermission.checkReadBlockPermission(
        Monitor,
        query,
        makeProps([blockPermission(Permission.ProjectMember, [blockedLabelA])]),
      ),
    ).rejects.toThrow("access-control relation metadata");
    expect(query).toEqual({ projectId });
  });
});
