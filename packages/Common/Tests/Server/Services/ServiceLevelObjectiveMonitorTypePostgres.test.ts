import Entities from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveMonitorRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AuditLogService from "../../../Server/Services/AuditLogService";
import MonitorService from "../../../Server/Services/MonitorService";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import ServiceLevelObjectiveMonitorRuleService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { DataSource } from "typeorm";

/*
 * Opt in with RUN_POSTGRES_SLO_MONITOR_TYPE_TESTS=true and config.env.
 * The database must already be migrated. Only table structures are copied
 * into a unique schema; every fixture and membership write stays there.
 * Persistence, validation, rule hooks and the engine use production services.
 * Only unrelated feed, audit and workflow delivery is replaced.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SLO_MONITOR_TYPE_TESTS"] === "true"
    ? describe
    : describe.skip;

function criteria(
  filters: Array<RuleCriteriaFilter>,
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition,
    filters,
  };
}

function typeFilter(
  monitorType: MonitorType,
  operator: RuleCriteriaOperator = RuleCriteriaOperator.Equals,
): RuleCriteriaFilter {
  return { field: "monitorType", operator, value: monitorType };
}

describePostgres("SLO monitor type rules against Postgres", () => {
  const schema: string = `slo_monitor_type_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const tables: Array<string> = [
    "Monitor",
    "Label",
    "MonitorLabel",
    "ServiceLevelObjective",
    "ServiceLevelObjectiveMonitor",
    "ServiceLevelObjectiveAutoAddedMonitor",
    "ServiceLevelObjectiveMonitorLabel",
    "ServiceLevelObjectiveMonitorRule",
    "ServiceLevelObjectiveMonitorRuleMonitorLabel",
  ];
  let database: DataSource;
  let sloId: ObjectID;
  let apiId: ObjectID;
  let websiteId: ObjectID;
  let otherProjectApiId: ObjectID;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["SLO_MONITOR_TYPE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["SLO_MONITOR_TYPE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SLO_MONITOR_TYPE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of tables) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest.spyOn(AuditLogService, "recordCreate").mockResolvedValue();
    jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue();
    jest
      .spyOn(
        ServiceLevelObjectiveFeedService,
        "createServiceLevelObjectiveFeedItem",
      )
      .mockResolvedValue();
    jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "onTriggerWorkflow")
      .mockResolvedValue();
    jest
      .spyOn(ServiceLevelObjectiveService, "onTriggerWorkflow")
      .mockResolvedValue();
  });

  beforeEach(async () => {
    await database.query(
      `TRUNCATE ${tables
        .map((table: string): string => {
          return `"${schema}"."${table}"`;
        })
        .join(", ")}`,
    );
    sloId = await seedSlo(projectId);
    apiId = await seedMonitor(MonitorType.API, "api-production", projectId);
    websiteId = await seedMonitor(
      MonitorType.Website,
      "website-production",
      projectId,
    );
    otherProjectApiId = await seedMonitor(
      MonitorType.API,
      "api-production",
      otherProjectId,
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function seedSlo(ownerProjectId: ObjectID): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."ServiceLevelObjective"
       ("_id", "projectId", "name", "slug", "targetPercentage", "version")
       VALUES ($1, $2, 'Synthetic SLO', $3, 99.9, 1)`,
      [id.toString(), ownerProjectId.toString(), `slo-type-${id.toString()}`],
    );
    return id;
  }

  async function seedMonitor(
    monitorType: MonitorType,
    name: string,
    ownerProjectId: ObjectID,
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."Monitor"
       ("_id", "projectId", "name", "description", "slug", "monitorType", "currentMonitorStatusId", "version")
       VALUES ($1, $2, $3, 'Customer facing production service', $4, $5, $6, 1)`,
      [
        id.toString(),
        ownerProjectId.toString(),
        name,
        `monitor-type-${id.toString()}`,
        monitorType,
        ObjectID.generate().toString(),
      ],
    );
    return id;
  }

  async function createRule(
    ruleCriteria: RuleCriteria,
    targetSloId: ObjectID = sloId,
    ownerProjectId: ObjectID = projectId,
  ): Promise<ServiceLevelObjectiveMonitorRule> {
    const rule: ServiceLevelObjectiveMonitorRule =
      new ServiceLevelObjectiveMonitorRule();
    rule.projectId = ownerProjectId;
    rule.serviceLevelObjectiveId = targetSloId;
    rule.name = "Synthetic type rule";
    rule.isEnabled = true;
    rule.criteria = ruleCriteria;
    return ServiceLevelObjectiveMonitorRuleService.create({
      data: rule,
      props: { isRoot: true },
    });
  }

  async function expectMembership(
    attachedIds: Array<ObjectID>,
    autoAddedIds: Array<ObjectID> = attachedIds,
    targetSloId: ObjectID = sloId,
  ): Promise<void> {
    const slo: ServiceLevelObjective | null =
      await ServiceLevelObjectiveService.findOneById({
        id: targetSloId,
        select: { monitors: { _id: true }, autoAddedMonitors: { _id: true } },
        props: { isRoot: true },
      });
    expect(slo).not.toBeNull();
    const ids: (monitors: Array<Monitor> | undefined) => Array<string> = (
      monitors: Array<Monitor> | undefined,
    ): Array<string> => {
      return (monitors || [])
        .map((monitor: Monitor): string => {
          return monitor.id!.toString();
        })
        .sort();
    };
    expect(ids(slo!.monitors)).toEqual(attachedIds.map(String).sort());
    expect(ids(slo!.autoAddedMonitors)).toEqual(
      autoAddedIds.map(String).sort(),
    );
  }

  test("round-trips a type criterion and backfills only matching monitors in the SLO's project", async () => {
    const savedCriteria: RuleCriteria = criteria([typeFilter(MonitorType.API)]);
    const rule: ServiceLevelObjectiveMonitorRule =
      await createRule(savedCriteria);
    const stored: ServiceLevelObjectiveMonitorRule | null =
      await ServiceLevelObjectiveMonitorRuleService.findOneById({
        id: rule.id!,
        select: { criteria: true, monitorType: true },
        props: { isRoot: true },
      });

    expect(stored?.criteria).toEqual(savedCriteria);
    await expectMembership([apiId]);
    await expect(
      ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
        serviceLevelObjectiveId: sloId,
      }),
    ).resolves.toEqual({ monitorIdsAdded: [], monitorIdsRemoved: [] });
  });

  test("editing Equals to NotEquals persists the new operator and replaces automatic membership", async () => {
    const rule: ServiceLevelObjectiveMonitorRule = await createRule(
      criteria([typeFilter(MonitorType.API)]),
    );
    const updatedCriteria: RuleCriteria = criteria([
      typeFilter(MonitorType.API, RuleCriteriaOperator.NotEquals),
    ]);
    await ServiceLevelObjectiveMonitorRuleService.updateOneById({
      id: rule.id!,
      data: { criteria: updatedCriteria },
      props: { isRoot: true },
    });
    const rows: Array<{ criteria: RuleCriteria }> = await database.query(
      `SELECT "criteria" FROM "${schema}"."ServiceLevelObjectiveMonitorRule" WHERE "_id" = $1`,
      [rule.id!.toString()],
    );
    expect(rows[0]?.criteria).toEqual(updatedCriteria);
    await expectMembership([websiteId]);
  });

  test("the nullable type column supports legacy type-only rules and existing rules without a type", async () => {
    const rule: ServiceLevelObjectiveMonitorRule =
      new ServiceLevelObjectiveMonitorRule();
    rule.projectId = projectId;
    rule.serviceLevelObjectiveId = sloId;
    rule.name = "Legacy type rule";
    rule.isEnabled = true;
    rule.monitorType = MonitorType.API;
    const created: ServiceLevelObjectiveMonitorRule =
      await ServiceLevelObjectiveMonitorRuleService.create({
        data: rule,
        props: { isRoot: true },
      });
    const stored: ServiceLevelObjectiveMonitorRule | null =
      await ServiceLevelObjectiveMonitorRuleService.findOneById({
        id: created.id!,
        select: { monitorType: true, criteria: true },
        props: { isRoot: true },
      });
    expect(stored?.monitorType).toBe(MonitorType.API);
    expect(stored?.criteria).toBeNull();
    await expectMembership([apiId]);

    const columns: Array<{
      is_nullable: string;
      column_default: string | null;
    }> = await database.query(
      `SELECT is_nullable, column_default FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'ServiceLevelObjectiveMonitorRule' AND column_name = 'monitorType'`,
      [schema],
    );
    expect(columns).toEqual([{ is_nullable: "YES", column_default: null }]);

    await ServiceLevelObjectiveMonitorRuleService.updateOneById({
      id: created.id!,
      data: {
        criteria: criteria([
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.MatchesPattern,
            value: "^website-",
          },
        ]),
      },
      props: { isRoot: true },
    });
    await expectMembership([websiteId]);
  });

  test("Match all and Match any combine a persisted type with positive and negative text patterns", async () => {
    const filters: Array<RuleCriteriaFilter> = [
      typeFilter(MonitorType.API),
      {
        field: "monitorNamePattern",
        operator: RuleCriteriaOperator.MatchesPattern,
        value: "^website-",
      },
      {
        field: "monitorDescriptionPattern",
        operator: RuleCriteriaOperator.DoesNotMatchPattern,
        value: "production",
      },
    ];
    const rule: ServiceLevelObjectiveMonitorRule = await createRule(
      criteria(filters),
    );
    await expectMembership([]);

    await ServiceLevelObjectiveMonitorRuleService.updateOneById({
      id: rule.id!,
      data: { criteria: criteria(filters, FilterCondition.Any) },
      props: { isRoot: true },
    });
    await expectMembership([apiId, websiteId]);

    await ServiceLevelObjectiveMonitorRuleService.updateOneById({
      id: rule.id!,
      data: {
        criteria: criteria([
          typeFilter(MonitorType.API),
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.MatchesPattern,
            value: "^api-",
          },
          {
            field: "monitorDescriptionPattern",
            operator: RuleCriteriaOperator.DoesNotMatchPattern,
            value: "staging",
          },
        ]),
      },
      props: { isRoot: true },
    });
    await expectMembership([apiId]);
  });

  test("monitor-side type changes attach and detach automatic members while preserving manual membership", async () => {
    await database.query(
      `INSERT INTO "${schema}"."ServiceLevelObjectiveMonitor" ("serviceLevelObjectiveId", "monitorId") VALUES ($1, $2)`,
      [sloId.toString(), websiteId.toString()],
    );
    await createRule(criteria([typeFilter(MonitorType.API)]));
    await expectMembership([apiId, websiteId], [apiId]);

    await MonitorService.updateColumnsByIdWithoutHooks({
      id: apiId,
      data: { monitorType: MonitorType.Website },
    });
    await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
      monitorId: apiId,
    });
    await expectMembership([websiteId], []);

    await MonitorService.updateColumnsByIdWithoutHooks({
      id: websiteId,
      data: { monitorType: MonitorType.API },
    });
    await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
      monitorId: websiteId,
    });
    await expectMembership([websiteId], []);

    await MonitorService.updateColumnsByIdWithoutHooks({
      id: websiteId,
      data: { monitorType: MonitorType.Website },
    });
    await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
      monitorId: websiteId,
    });
    await expectMembership([websiteId], []);

    await MonitorService.updateColumnsByIdWithoutHooks({
      id: apiId,
      data: { monitorType: MonitorType.API },
    });
    await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
      monitorId: apiId,
    });
    await expectMembership([apiId, websiteId], [apiId]);
  });

  test("a type change in another project cannot attach its monitor to this SLO", async () => {
    const otherSloId: ObjectID = await seedSlo(otherProjectId);
    await createRule(criteria([typeFilter(MonitorType.API)]));
    await createRule(
      criteria([typeFilter(MonitorType.Website)]),
      otherSloId,
      otherProjectId,
    );
    await expectMembership([], [], otherSloId);

    await MonitorService.updateColumnsByIdWithoutHooks({
      id: otherProjectApiId,
      data: { monitorType: MonitorType.Website },
    });
    await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor({
      monitorId: otherProjectApiId,
    });
    await expectMembership(
      [otherProjectApiId],
      [otherProjectApiId],
      otherSloId,
    );
    await expectMembership([apiId]);
  });

  test("disabling the type rule removes its persisted automatic membership", async () => {
    const rule: ServiceLevelObjectiveMonitorRule = await createRule(
      criteria([typeFilter(MonitorType.API)]),
    );
    await expectMembership([apiId]);
    await ServiceLevelObjectiveMonitorRuleService.updateOneById({
      id: rule.id!,
      data: { isEnabled: false },
      props: { isRoot: true },
    });
    await expectMembership([]);
  });

  test.each([
    {
      field: "monitorType",
      operator: RuleCriteriaOperator.Equals,
      value: "not-a-monitor-type",
    },
    {
      field: "monitorType",
      operator: RuleCriteriaOperator.Contains,
      value: MonitorType.API,
    },
  ])(
    "rejects invalid type criteria before changing stored rules or membership: %j",
    async (filter: RuleCriteriaFilter) => {
      const rule: ServiceLevelObjectiveMonitorRule = await createRule(
        criteria([typeFilter(MonitorType.API)]),
      );
      await expect(createRule(criteria([filter]))).rejects.toThrow();
      await expect(
        ServiceLevelObjectiveMonitorRuleService.updateOneById({
          id: rule.id!,
          data: { criteria: criteria([filter]) },
          props: { isRoot: true },
        }),
      ).rejects.toThrow();
      const rows: Array<{ criteria: RuleCriteria }> = await database.query(
        `SELECT "criteria" FROM "${schema}"."ServiceLevelObjectiveMonitorRule"`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.criteria).toEqual(
        criteria([typeFilter(MonitorType.API)]),
      );
      await expectMembership([apiId]);
    },
  );
});
