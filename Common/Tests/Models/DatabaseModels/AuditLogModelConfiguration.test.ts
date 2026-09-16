import { describe, expect, test } from "@jest/globals";
import EnableAuditLog from "../../../Types/Database/EnableAuditLog";
import EnableAuditLogOn from "../../../Types/BaseDatabase/EnableAuditLogOn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnTypeAnalytics from "../../../Types/AnalyticsDatabase/TableColumnType";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AuditLog from "../../../Models/AnalyticsModels/AuditLog";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveMonitorRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import ServiceLevelObjectiveOwnerTeam from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";

/*
 * Audit logging configuration, checked through the metadata the decorators
 * actually put on the prototype - which is what AuditLogService and
 * DatabaseService read.
 *
 * Three things go wrong silently here, and each looks like "the audit log is
 * just empty":
 *   - @EnableAuditLog copies only the keys it knows, so an option that is not
 *     copied never reaches the service;
 *   - rootResource.resourceType is a literal that has to equal the root
 *     model's singularName, or a child's entries roll up to a page that never
 *     asks for them;
 *   - an ignored or root column that is not a real column (a rename) quietly
 *     turns the feature off.
 */

const SLO_RESOURCE_TYPE: string = new ServiceLevelObjective().singularName!;

const SLO_WORKER_COLUMNS: Array<string> = [
  "currentSliPercentage",
  "errorBudgetRemainingPercentage",
  "errorBudgetRemainingSeconds",
  "errorBudgetTotalSeconds",
  "currentBurnRate",
  "sloStatus",
  "statusChangeNotificationSentAt",
  "lastEvaluatedAt",
  "nextEvaluationAt",
  "lastAccumulatedBucketEndAt",
  "autoAddedMonitors",
];

const BURN_RATE_RULE_BOOKKEEPING_COLUMNS: Array<string> = [
  "lastAlertCreatedAt",
  "lastAlertResolvedAt",
  "lastIncidentCreatedAt",
  "lastIncidentResolvedAt",
];

type SortedFunction = (values: Array<string> | undefined) => Array<string>;

const sorted: SortedFunction = (
  values: Array<string> | undefined,
): Array<string> => {
  return [...(values || [])].sort();
};

describe("EnableAuditLog decorator", () => {
  type DecorateFunction = (config?: EnableAuditLogOn) => EnableAuditLogOn;

  const decorate: DecorateFunction = (
    config?: EnableAuditLogOn,
  ): EnableAuditLogOn => {
    class Decorated {}
    EnableAuditLog(config)(Decorated);
    return (
      Decorated.prototype as unknown as {
        enableAuditLogOn: EnableAuditLogOn;
      }
    ).enableAuditLogOn;
  };

  test("defaults every action on, and adds no optional keys", () => {
    expect(decorate()).toStrictEqual({
      create: true,
      update: true,
      delete: true,
    });
  });

  test("keeps a model that configures no new option at the three-flag shape", () => {
    /*
     * InventoryItemModel.test compares this shape with toEqual; strict
     * equality here makes sure no `rootResource: undefined` sneaks in either.
     */
    expect(
      decorate({ create: false, update: true, delete: true }),
    ).toStrictEqual({ create: false, update: true, delete: true });
    expect(new InventoryItem().enableAuditLogOn).toStrictEqual({
      create: false,
      update: true,
      delete: true,
    });
  });

  test("copies rootResource, ignoreColumns and resourceNameRelation", () => {
    expect(
      decorate({
        rootResource: { resourceType: "Parent", column: "parentId" },
        ignoreColumns: ["a", "b"],
        resourceNameRelation: "user",
      }),
    ).toStrictEqual({
      create: true,
      update: true,
      delete: true,
      rootResource: { resourceType: "Parent", column: "parentId" },
      ignoreColumns: ["a", "b"],
      resourceNameRelation: "user",
    });
  });

  test("copies the options instead of aliasing the declaration", () => {
    const rootResource: { resourceType: string; column: string } = {
      resourceType: "Parent",
      column: "parentId",
    };
    const ignoreColumns: Array<string> = ["a"];

    const config: EnableAuditLogOn = decorate({ rootResource, ignoreColumns });

    rootResource.column = "somethingElse";
    ignoreColumns.push("b");

    expect(config.rootResource?.column).toBe("parentId");
    expect(config.ignoreColumns).toEqual(["a"]);
  });
});

describe("ServiceLevelObjective audit logging", () => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();

  test("records create, update and delete, as a top-level resource", () => {
    expect(slo.enableAuditLogOn?.create).toBe(true);
    expect(slo.enableAuditLogOn?.update).toBe(true);
    expect(slo.enableAuditLogOn?.delete).toBe(true);
    expect(slo.enableAuditLogOn?.rootResource).toBeUndefined();
  });

  test("ignores exactly the evaluation worker's output columns", () => {
    expect(sorted(slo.enableAuditLogOn?.ignoreColumns)).toEqual(
      sorted(SLO_WORKER_COLUMNS),
    );
  });

  test("never ignores a column a person edits", () => {
    /*
     * Ignoring any of these would make the audit log lie by omission about
     * exactly the edits it exists for.
     */
    const editedByPeople: Array<string> = [
      "name",
      "description",
      "labels",
      "isEnabled",
      "isArchived",
      "sliType",
      "multiMonitorMode",
      "monitors",
      "downtimeMonitorStatuses",
      "metricQueryConfig",
      "targetPercentage",
      "windowType",
      "windowDays",
      "timezone",
      "atRiskThresholdPercentage",
    ];

    for (const column of editedByPeople) {
      expect(slo.isTableColumn(column)).toBe(true);
      expect(slo.enableAuditLogOn?.ignoreColumns).not.toContain(column);
    }
  });
});

describe("SLO child models roll their entries up to the SLO", () => {
  const children: Array<{ name: string; model: BaseModel }> = [
    {
      name: "ServiceLevelObjectiveBurnRateRule",
      model: new ServiceLevelObjectiveBurnRateRule(),
    },
    {
      name: "ServiceLevelObjectiveMonitorRule",
      model: new ServiceLevelObjectiveMonitorRule(),
    },
    {
      name: "ServiceLevelObjectiveOwnerUser",
      model: new ServiceLevelObjectiveOwnerUser(),
    },
    {
      name: "ServiceLevelObjectiveOwnerTeam",
      model: new ServiceLevelObjectiveOwnerTeam(),
    },
  ];

  test.each(children)(
    "$name records create, update and delete",
    ({ model }: { model: BaseModel }) => {
      expect(model.enableAuditLogOn?.create).toBe(true);
      expect(model.enableAuditLogOn?.update).toBe(true);
      expect(model.enableAuditLogOn?.delete).toBe(true);
    },
  );

  test.each(children)(
    "$name points at the SLO through serviceLevelObjectiveId",
    ({ model }: { model: BaseModel }) => {
      expect(model.enableAuditLogOn?.rootResource).toEqual({
        resourceType: SLO_RESOURCE_TYPE,
        column: "serviceLevelObjectiveId",
      });

      expect(model.getTableColumnMetadata("serviceLevelObjectiveId").type).toBe(
        TableColumnType.ObjectID,
      );
    },
  );

  test("the root type literal is the SLO's singularName, which is what the SLO's own entries carry", () => {
    expect(SLO_RESOURCE_TYPE).toBe("Service Level Objective");
  });

  test("burn-rate rules ignore their refire bookkeeping and nothing else", () => {
    const rule: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule();

    expect(sorted(rule.enableAuditLogOn?.ignoreColumns)).toEqual(
      sorted(BURN_RATE_RULE_BOOKKEEPING_COLUMNS),
    );
  });

  test("monitor rules ignore nothing", () => {
    expect(
      new ServiceLevelObjectiveMonitorRule().enableAuditLogOn?.ignoreColumns,
    ).toBeUndefined();
  });

  test.each([
    {
      name: "owner user",
      model: new ServiceLevelObjectiveOwnerUser() as BaseModel,
      relation: "user",
      idColumn: "userId",
      relatedModel: User as { new (): BaseModel },
    },
    {
      name: "owner team",
      model: new ServiceLevelObjectiveOwnerTeam() as BaseModel,
      relation: "team",
      idColumn: "teamId",
      relatedModel: Team as { new (): BaseModel },
    },
  ])(
    "the $name row is named after its $relation and ignores isOwnerNotified",
    (data: {
      model: BaseModel;
      relation: string;
      idColumn: string;
      relatedModel: { new (): BaseModel };
    }) => {
      expect(data.model.enableAuditLogOn?.resourceNameRelation).toBe(
        data.relation,
      );

      const metadata: TableColumnMetadata = data.model.getTableColumnMetadata(
        data.relation,
      );

      expect(metadata.type).toBe(TableColumnType.Entity);
      expect(metadata.modelType).toBe(data.relatedModel);
      expect(metadata.manyToOneRelationColumn).toBe(data.idColumn);
      expect(data.model.enableAuditLogOn?.ignoreColumns).toEqual([
        "isOwnerNotified",
      ]);
    },
  );
});

describe("every audited model's configuration is consistent", () => {
  const audited: Array<BaseModel> = AllModelTypes.map(
    (modelType: { new (): BaseModel }) => {
      return new modelType();
    },
  ).filter((model: BaseModel) => {
    return Boolean(model.enableAuditLogOn);
  });

  const auditedResourceTypes: Set<string> = new Set<string>(
    audited.map((model: BaseModel) => {
      return model.singularName!;
    }),
  );

  test("the sweep sees the models this change audits", () => {
    const names: Array<string> = audited.map((model: BaseModel) => {
      return model.tableName!;
    });

    expect(names).toEqual(
      expect.arrayContaining([
        "ServiceLevelObjective",
        "ServiceLevelObjectiveBurnRateRule",
        "ServiceLevelObjectiveMonitorRule",
        "ServiceLevelObjectiveOwnerUser",
        "ServiceLevelObjectiveOwnerTeam",
      ]),
    );
    expect(new Monitor().enableAuditLogOn?.rootResource).toBeUndefined();
  });

  test.each(
    audited.map((model: BaseModel) => {
      return [model.tableName, model];
    }),
  )(
    "%s: ignored columns are real columns",
    (_name: unknown, model: unknown) => {
      for (const column of (model as BaseModel).enableAuditLogOn
        ?.ignoreColumns || []) {
        expect((model as BaseModel).isTableColumn(column)).toBe(true);
      }
    },
  );

  test.each(
    audited.map((model: BaseModel) => {
      return [model.tableName, model];
    }),
  )(
    "%s: a root pointer names an ObjectID column and an audited root type",
    (_name: unknown, model: unknown) => {
      const auditedModel: BaseModel = model as BaseModel;
      const rootResource: EnableAuditLogOn["rootResource"] =
        auditedModel.enableAuditLogOn?.rootResource;

      if (!rootResource) {
        return;
      }

      expect(auditedModel.isTableColumn(rootResource.column)).toBe(true);
      expect(
        auditedModel.getTableColumnMetadata(rootResource.column).type,
      ).toBe(TableColumnType.ObjectID);

      // A root nobody audits has no entries of its own and no page asking for these.
      expect(auditedResourceTypes.has(rootResource.resourceType)).toBe(true);
    },
  );

  test.each(
    audited.map((model: BaseModel) => {
      return [model.tableName, model];
    }),
  )(
    "%s: a name relation is a many-to-one column",
    (_name: unknown, model: unknown) => {
      const auditedModel: BaseModel = model as BaseModel;
      const relation: string | undefined =
        auditedModel.enableAuditLogOn?.resourceNameRelation;

      if (!relation) {
        return;
      }

      const metadata: TableColumnMetadata =
        auditedModel.getTableColumnMetadata(relation);

      expect(metadata.type).toBe(TableColumnType.Entity);
      expect(metadata.modelType).toBeDefined();
      expect(
        auditedModel.isTableColumn(metadata.manyToOneRelationColumn!),
      ).toBe(true);
    },
  );
});

describe("AuditLog root-resource columns", () => {
  const auditLog: AuditLog = new AuditLog();

  type ColumnFunction = (key: string) => AnalyticsTableColumn;

  const column: ColumnFunction = (key: string): AnalyticsTableColumn => {
    const found: AnalyticsTableColumn | undefined = auditLog.tableColumns.find(
      (candidate: AnalyticsTableColumn) => {
        return candidate.key === key;
      },
    );
    expect(found).toBeDefined();
    return found!;
  };

  test("are optional, so rows written before them still insert and read", () => {
    expect(column("rootResourceType").required).toBe(false);
    expect(column("rootResourceType").type).toBe(TableColumnTypeAnalytics.Text);
    expect(column("rootResourceId").required).toBe(false);
    expect(column("rootResourceId").type).toBe(
      TableColumnTypeAnalytics.ObjectID,
    );
  });

  test("rootResourceId carries a bloom filter, since the sort key cannot change", () => {
    expect(column("rootResourceId").skipIndex).toEqual({
      name: "idx_root_resource_id",
      type: SkipIndexType.BloomFilter,
      params: [0.01],
      granularity: 1,
    });
    expect(auditLog.sortKeys).toEqual([
      "projectId",
      "createdAt",
      "resourceType",
      "resourceId",
    ]);
  });

  test("are readable by exactly who can read the rest of the entry", () => {
    const resourceIdAccess: unknown = column("resourceId").accessControl;

    expect(column("rootResourceType").accessControl).toEqual(resourceIdAccess);
    expect(column("rootResourceId").accessControl).toEqual(resourceIdAccess);
  });

  test("round-trip through their accessors", () => {
    const entry: AuditLog = new AuditLog();
    entry.rootResourceType = SLO_RESOURCE_TYPE;
    entry.rootResourceId = undefined;

    expect(entry.rootResourceType).toBe(SLO_RESOURCE_TYPE);
  });
});
