import ReadPermission from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import QueryUtil from "../../../../../Server/Types/Database/QueryUtil";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MetricType from "../../../../../Models/DatabaseModels/MetricType";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../../../Models/DatabaseModels/StatusPageAnnouncement";
import RumSessionPin from "../../../../../Models/DatabaseModels/RumSessionPin";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import OnCallDutyPolicyTimeLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyTimeLog";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import InventoryItem from "../../../../../Models/DatabaseModels/InventoryItem";
import Project from "../../../../../Models/DatabaseModels/Project";
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
});

/*
 * A block with labels takes away the records carrying those labels. On a
 * model whose records carry no labels of their own it reaches a record
 * through the labelled records it belongs to - the parent the model names
 * (canAccessIfCanReadOn), else the resource its owner key names
 * (@OwnedThrough), else every labelled record it points to - and a record
 * that belongs to no labelled record is not affected: the read never fails
 * because of a block it could not apply.
 */
describe("ReadPermission.checkReadBlockPermission on models without labels", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const blockedLabel: ObjectID = ObjectID.generate();

  function propsWithBlock(
    permission: Permission,
  ): DatabaseCommonInteractionProps {
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
        {
          _type: "UserPermission",
          permission,
          labelIds: [blockedLabel],
          isBlockPermission: true,
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
      .spyOn(QueryUtil, "getManyToManyRelationMetadata")
      .mockImplementation((modelType: any, column: string) => {
        if (modelType === Incident && column === "labels") {
          return {
            joinTableName: "IncidentLabel",
            ownerColumnName: "incidentId",
            relationColumnName: "labelId",
          };
        }

        if (modelType === StatusPage && column === "labels") {
          return {
            joinTableName: "StatusPageLabel",
            ownerColumnName: "statusPageId",
            relationColumnName: "labelId",
          };
        }

        if (modelType === StatusPageAnnouncement && column === "statusPages") {
          return {
            joinTableName: "AnnouncementStatusPage",
            ownerColumnName: "announcementId",
            relationColumnName: "statusPageId",
          };
        }

        // Every other labelled model keeps its labels in "<Table>Label".
        if (column === "labels") {
          const tableName: string = new modelType().tableName;

          return {
            joinTableName: `${tableName}Label`,
            ownerColumnName: `${tableName.charAt(0).toLowerCase()}${tableName.slice(1)}Id`,
            relationColumnName: "labelId",
          };
        }

        return null;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function rawSql(operator: any, alias: string): string {
    expect(operator).toBeInstanceOf(FindOperator);
    return operator.getSql(alias);
  }

  function boundValues(operator: any): Array<string> {
    return Object.values(
      operator.objectLiteralParameters as Record<string, Array<string>>,
    )[0] as Array<string>;
  }

  it("a labelled block on the metric catalogue no longer fails every read", async () => {
    const query: any = { projectId };

    const result: any = await ReadPermission.checkReadBlockPermission(
      MetricType,
      query,
      propsWithBlock(Permission.ReadTelemetryServiceMetrics),
    );

    // The catalogue's own scope is MetricTypeService's (its services).
    expect(result.query).toEqual({ projectId });
  });

  it("a block with no labels still refuses the whole table", async () => {
    const props: DatabaseCommonInteractionProps = propsWithBlock(
      Permission.ReadTelemetryServiceMetrics,
    );
    props.userTenantAccessPermission![
      projectId.toString()
    ]!.permissions[1]!.labelIds = [];

    await expect(
      ReadPermission.checkReadBlockPermission(MetricType, { projectId }, props),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("leaves out the notes of incidents that carry a blocked label", async () => {
    const result: any = await ReadPermission.checkReadBlockPermission(
      IncidentInternalNote,
      { projectId } as any,
      propsWithBlock(Permission.IncidentViewer),
    );

    const sql: string = rawSql(result.query.incidentId, "noteIncidentId");
    expect(sql).toContain("noteIncidentId IS NULL OR noteIncidentId NOT IN");
    expect(sql).toContain('FROM "IncidentLabel"');
    expect(sql).toContain('"IncidentLabel"."labelId" IN (');
    expect(boundValues(result.query.incidentId)).toEqual([
      blockedLabel.toString(),
    ]);
  });

  it("keeps the caller's own incident filter next to the block", async () => {
    const incidentId: ObjectID = ObjectID.generate();

    const result: any = await ReadPermission.checkReadBlockPermission(
      IncidentInternalNote,
      { projectId, incidentId } as any,
      propsWithBlock(Permission.IncidentViewer),
    );

    const combined: any = result.query.incidentId;
    expect(combined).toBeInstanceOf(FindOperator);
    expect(combined.type).toBe("and");
    // The caller's incident, as the query serializes it, ANDed with the block.
    expect(Object.values(combined.value[0].objectLiteralParameters)).toEqual([
      incidentId.toString(),
    ]);
    expect(rawSql(combined.value[1], "x")).toContain('FROM "IncidentLabel"');
  });

  it("leaves out announcements shown on a status page that carries a blocked label", async () => {
    const result: any = await ReadPermission.checkReadBlockPermission(
      StatusPageAnnouncement,
      { projectId } as any,
      propsWithBlock(Permission.ProjectMember),
    );

    const sql: string = rawSql(result.query._id, "announcementId");
    expect(sql).toContain(
      'announcementId NOT IN (SELECT "AnnouncementStatusPage"."announcementId"',
    );
    expect(sql).toContain(
      '"AnnouncementStatusPage"."statusPageId" IN (SELECT "StatusPageLabel"."statusPageId"',
    );
    expect(sql).toContain('"StatusPageLabel"."labelId" IN (');
  });

  it("a block on a permission the model does not read with changes nothing", async () => {
    const result: any = await ReadPermission.checkReadBlockPermission(
      IncidentInternalNote,
      { projectId } as any,
      propsWithBlock(Permission.ReadProjectMonitor),
    );

    expect(result.query).toEqual({ projectId });
  });

  /*
   * A pin names no parent, so it belongs to every labelled record it points
   * to: its recording's application, and the incident or alert it is pinned
   * to. A pin pointing at none of them stays.
   */
  it("leaves out the rows that point to a labelled record carrying a blocked label", async () => {
    const result: any = await ReadPermission.checkReadBlockPermission(
      RumSessionPin,
      { projectId } as any,
      propsWithBlock(Permission.ReadRumSessionReplay),
    );

    for (const [foreignKey, joinTable] of [
      ["rumApplicationId", "RumApplicationLabel"],
      ["incidentId", "IncidentLabel"],
      ["alertId", "AlertLabel"],
    ] as Array<[string, string]>) {
      const sql: string = rawSql(result.query[foreignKey], "pinKey");
      expect([foreignKey, sql]).toEqual([
        foreignKey,
        expect.stringContaining("pinKey IS NULL OR pinKey NOT IN"),
      ]);
      expect(sql).toContain(`FROM "${joinTable}"`);
      expect(boundValues(result.query[foreignKey])).toEqual([
        blockedLabel.toString(),
      ]);
    }

    // The pin's own id and the session it records are left alone.
    expect(result.query._id).toBeUndefined();
    expect(result.query.projectId).toBe(projectId);
  });

  /*
   * An exception group belongs to the resource its owner key names - a
   * service, a host, a cluster ... - so a block with labels leaves it out
   * when that resource, whichever kind it is, carries one of them. Groups
   * of unattributed telemetry (the key holds the project id) stay.
   */
  it("follows the owner key to every kind of resource it can name", async () => {
    const result: any = await ReadPermission.checkReadBlockPermission(
      TelemetryException,
      { projectId } as any,
      propsWithBlock(Permission.ReadTelemetryException),
    );

    const ownerKey: any = result.query.primaryEntityId;
    expect(ownerKey).toBeInstanceOf(FindOperator);

    // One condition per kind of resource, all of which must hold.
    const conditionsSql: (operator: any) => string = (
      operator: any,
    ): string => {
      return operator.type === "and"
        ? operator.value.map(conditionsSql).join(" AND ")
        : rawSql(operator, "entityId");
    };

    const sql: string = conditionsSql(ownerKey);
    for (const joinTable of [
      "ServiceLabel",
      "HostLabel",
      "DockerHostLabel",
      "KubernetesClusterLabel",
      "RumApplicationLabel",
      "DatabaseServerLabel",
    ]) {
      expect([joinTable, sql.includes(`FROM "${joinTable}"`)]).toEqual([
        joinTable,
        true,
      ]);
    }
    expect(sql).toContain("entityId IS NULL OR entityId NOT IN");
  });

  it("follows an owner key and a plain id column alike (an on-call time log's policy and schedule)", async () => {
    const result: any = await ReadPermission.checkReadBlockPermission(
      OnCallDutyPolicyTimeLog,
      { projectId } as any,
      propsWithBlock(Permission.ReadOnCallDutyPolicyTimeLog),
    );

    const policySql: string = rawSql(
      result.query.onCallDutyPolicyId,
      "policyId",
    );
    expect(policySql).toContain("policyId IS NULL OR policyId NOT IN");
    expect(policySql).toContain('FROM "OnCallDutyPolicyLabel"');

    const scheduleSql: string = rawSql(
      result.query.onCallDutyPolicyScheduleId,
      "scheduleId",
    );
    expect(scheduleSql).toContain("scheduleId IS NULL OR scheduleId NOT IN");
    expect(scheduleSql).toContain('FROM "OnCallDutyPolicyScheduleLabel"');

    // The escalation rule and the team carry no labels: nothing to add there.
    expect(result.query.onCallDutyPolicyEscalationRuleId).toBeUndefined();
    expect(result.query.teamId).toBeUndefined();
  });

  /*
   * An AI run names the records it was about in plain id columns, with no
   * relation over them. Each is read by the model its name ends with.
   */
  it("follows plain id columns to the records they name (an AI run's monitor, agent, incident, alert)", async () => {
    const result: any = await ReadPermission.checkReadBlockPermission(
      AIRun,
      { projectId } as any,
      propsWithBlock(Permission.ProjectMember),
    );

    for (const [column, joinTable] of [
      ["monitorId", "MonitorLabel"],
      ["aiAgentId", "AIAgentLabel"],
      ["triggeredByIncidentId", "IncidentLabel"],
      ["triggeredByAlertId", "AlertLabel"],
    ] as Array<[string, string]>) {
      const sql: string = rawSql(result.query[column], "key");
      expect([column, sql.includes(`FROM "${joinTable}"`)]).toEqual([
        column,
        true,
      ]);
      expect(sql).toContain("key IS NULL OR key NOT IN");
    }

    // Records that carry no labels add nothing: the exception, the creator.
    expect(result.query.triggeredByTelemetryExceptionId).toBeUndefined();
    expect(result.query.createdByUserId).toBeUndefined();
  });

  /*
   * An inventory item names its resource by an id several kinds of resource
   * share. A record id names one record in the whole database, so the id is
   * weighed against every model that carries labels: the item is left out
   * when the resource it names, whatever its kind, carries a blocked label,
   * and an item that names no resource stays.
   */
  it("weighs a resource id of any kind against every model that carries labels", async () => {
    const result: any = await ReadPermission.checkReadBlockPermission(
      InventoryItem,
      { projectId } as any,
      propsWithBlock(Permission.ProjectMember),
    );

    const conditions: Array<any> = [];
    const collect: (operator: any) => void = (operator: any): void => {
      if (operator.type === "and") {
        operator.value.forEach(collect);
        return;
      }
      conditions.push(operator);
    };
    collect(result.query.resourceId);

    const sql: string = conditions
      .map((condition: any): string => {
        return rawSql(condition, "resourceKey");
      })
      .join(" AND ");

    for (const joinTable of [
      "MonitorLabel",
      "ServiceLabel",
      "HostLabel",
      "DockerHostLabel",
      "KubernetesClusterLabel",
      "DatabaseServerLabel",
      "StatusPageLabel",
    ]) {
      expect([joinTable, sql.includes(`FROM "${joinTable}"`)]).toEqual([
        joinTable,
        true,
      ]);
    }

    // One condition per model that carries labels, each keeping empty ids.
    expect(conditions.length).toBeGreaterThan(30);
    for (const condition of conditions) {
      expect(rawSql(condition, "resourceKey")).toContain(
        "resourceKey IS NULL OR resourceKey NOT IN",
      );
      expect(boundValues(condition)).toEqual([blockedLabel.toString()]);
    }

    // Nothing else about the item is narrowed.
    expect(result.query._id).toBeUndefined();
    expect(result.query.projectId).toBe(projectId);
  });

  it("keeps the caller's own resource filter next to the block", async () => {
    const resourceId: ObjectID = ObjectID.generate();

    const result: any = await ReadPermission.checkReadBlockPermission(
      InventoryItem,
      { projectId, resourceId } as any,
      propsWithBlock(Permission.ProjectMember),
    );

    expect(result.query.resourceId).toBeInstanceOf(FindOperator);
    expect(JSON.stringify(result.query.resourceId)).toContain(
      resourceId.toString(),
    );
  });

  it("leaves a model whose keys name no labelled record as it is (the project)", async () => {
    const result: any = await ReadPermission.checkReadBlockPermission(
      Project,
      { _id: projectId.toString() } as any,
      propsWithBlock(Permission.ProjectMember),
    );

    expect(result.query).toEqual({ _id: projectId.toString() });
  });

  it("keeps the caller's own filter on the owner key next to the block", async () => {
    const serviceId: ObjectID = ObjectID.generate();

    const result: any = await ReadPermission.checkReadBlockPermission(
      TelemetryException,
      { projectId, primaryEntityId: serviceId } as any,
      propsWithBlock(Permission.ReadTelemetryException),
    );

    const combined: any = result.query.primaryEntityId;
    expect(combined).toBeInstanceOf(FindOperator);
    expect(combined.type).toBe("and");
    expect(JSON.stringify(combined)).toContain(serviceId.toString());
  });

  it("refuses a model that names a parent it does not have", async () => {
    class NoteNamingAMissingParent extends IncidentInternalNote {}
    NoteNamingAMissingParent.prototype.canAccessIfCanReadOn =
      "incidentThatIsNotARelation";

    await expect(
      ReadPermission.checkReadBlockPermission(
        NoteNamingAMissingParent,
        { projectId } as any,
        propsWithBlock(Permission.IncidentViewer),
      ),
    ).rejects.toThrow("access-control relation metadata");
  });

  it("refuses when the labelled record's labels cannot be resolved", async () => {
    jest
      .spyOn(QueryUtil, "getManyToManyRelationMetadata")
      .mockReturnValue(null);

    await expect(
      ReadPermission.checkReadBlockPermission(
        IncidentInternalNote,
        { projectId } as any,
        propsWithBlock(Permission.IncidentViewer),
      ),
    ).rejects.toThrow("access-control relation metadata");
  });
});
