import AlertReminderRule from "../../../Models/DatabaseModels/AlertReminderRule";
import IncidentReminderRule from "../../../Models/DatabaseModels/IncidentReminderRule";
import Entities from "../../../Models/DatabaseModels/Index";
import ScheduledMaintenanceReminderRule from "../../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertReminderRuleService from "../../../Server/Services/AlertReminderRuleService";
import AlertService from "../../../Server/Services/AlertService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentReminderRuleService from "../../../Server/Services/IncidentReminderRuleService";
import IncidentService from "../../../Server/Services/IncidentService";
import ScheduledMaintenanceReminderRuleService from "../../../Server/Services/ScheduledMaintenanceReminderRuleService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import Query from "../../../Server/Types/Database/Query";
import Select from "../../../Server/Types/Database/Select";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PartialEntity from "../../../Types/Database/PartialEntity";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { DataSource, Logger } from "typeorm";

/*
 * Opt in with RUN_POSTGRES_REMINDER_RULE_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_REMINDER_RULE_TESTS=true \
 *   REMINDER_RULE_TEST_DATABASE_HOST=127.0.0.1 \
 *   REMINDER_RULE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/ReminderRuleLookupPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml ("Test reminder
 * rule lookup on migrated Postgres"), right after that job has applied every
 * registered migration to an empty database. The Common test job's Postgres
 * is not migrated, so the suite is skipped there.
 *
 * Why a real Postgres (#4030): the criteria-backed `isEnabled` filter of the
 * Incident, Alert and Scheduled Maintenance reminder rules is a TypeORM Raw
 * whose SQL only Postgres judges. It once named its sibling column as
 * `IncidentReminderRule."criteria"`; the unquoted alias folded to lowercase
 * and every lookup failed with `missing FROM-clause entry for table
 * "incidentreminderrule"` - whether or not the project had rules - so no
 * reminder was ever scheduled. No mock notices that.
 *
 * Everything runs in a uniquely named schema holding structure-only clones
 * (LIKE ... INCLUDING ALL: columns, defaults, CHECK constraints, indexes) of
 * the migrated tables the lookup and the reminder refresh read or write,
 * listed in TABLES. LIKE does not copy triggers, so the migrated triggers of
 * those tables - on the rule tables, the one that derives the stored
 * `isEnabled` from `criteria` - are recreated on the clones from their
 * migrated definitions. The clones carry no foreign keys, so seeded rows only
 * need their NOT NULL columns. The DataSource's search path is that schema,
 * then public; no row is ever written outside the schema, and the schema is
 * dropped afterwards.
 *
 * The production services run against the clones. Only true side effects are
 * stubbed: workflow triggers (an HTTP call to the workflow service) and
 * realtime events. Every statement Postgres rejects is recorded through the
 * DataSource's logger and fails the test, even when a caller catches and logs
 * the error - which is how #4030 surfaced: "Reminder scheduling failed in
 * IncidentService.onCreateSuccess", logged and swallowed.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_REMINDER_RULE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Label",
  "IncidentReminderRule",
  "IncidentReminderRuleIncidentSeverity",
  "IncidentReminderRuleLabel",
  "IncidentSeverity",
  "IncidentState",
  "Incident",
  "IncidentLabel",
  "AlertReminderRule",
  "AlertReminderRuleAlertSeverity",
  "AlertReminderRuleLabel",
  "AlertSeverity",
  "AlertState",
  "Alert",
  "AlertLabel",
  "ScheduledMaintenanceReminderRule",
  "ScheduledMaintenanceReminderRuleLabel",
  "ScheduledMaintenanceState",
  "ScheduledMaintenance",
  "ScheduledMaintenanceLabel",
];

const MINUTE_IN_MS: number = 60 * 1000;

type ReminderRule =
  | IncidentReminderRule
  | AlertReminderRule
  | ScheduledMaintenanceReminderRule;

type SqlRow = Record<string, unknown>;

// The side-effect hooks every DatabaseService has, whatever its model.
type SideEffectHooks = Pick<
  DatabaseService<ReminderRule>,
  "onTriggerWorkflow" | "onTriggerRealtime"
>;

// A rule row as Postgres stores it.
interface StoredRule {
  isEnabled: boolean | null;
  // criteria.isEnabled, or null for a legacy rule.
  criteriaEnabled: boolean | null;
}

// A rule as a caller of the DatabaseService reads it back.
interface ReadRule {
  id: string;
  isEnabled: boolean | null | undefined;
}

// The DatabaseService paths that take an isEnabled filter, on one rule table.
interface RuleOperations {
  findByEnabled(
    projectId: ObjectID,
    isEnabled: boolean,
  ): Promise<Array<ReadRule>>;
  countByEnabled(projectId: ObjectID, isEnabled: boolean): Promise<number>;
  findEnabledById(id: ObjectID): Promise<boolean | null | undefined>;
  updateByEnabled(data: {
    projectId: ObjectID;
    isEnabled: boolean;
    setEnabled: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<number>;
  deleteByEnabled(projectId: ObjectID, isEnabled: boolean): Promise<number>;
  hardDeleteByEnabled(projectId: ObjectID, isEnabled: boolean): Promise<number>;
  create(data: {
    projectId: ObjectID;
    name: string;
    reminderIntervalInMinutes: number;
    criteria: RuleCriteria | null;
  }): Promise<ObjectID>;
}

interface ReminderKind {
  name: "Incident" | "Alert" | "ScheduledMaintenance";
  ruleTable: string;
  // The column naming the rule in its junction tables.
  ruleJunctionColumn: string;
  ruleLabelTable: string;
  // Scheduled maintenance rules have no severity restriction.
  severity: {
    table: string;
    ruleJunctionTable: string;
    junctionColumn: string;
  } | null;
  subjectTable: string;
  subjectLabelTable: string;
  subjectLabelColumn: string;
  stateTable: string;
  rules: RuleOperations;
  stateRow(data: {
    id: ObjectID;
    projectId: ObjectID;
    order: number;
    isResolvedState: boolean;
  }): SqlRow;
  subjectRow(data: {
    id: ObjectID;
    projectId: ObjectID;
    stateId: ObjectID;
    severityId: ObjectID;
  }): SqlRow;
  findMatchingRule(data: {
    projectId: ObjectID;
    severityId?: ObjectID | undefined;
    labelIds?: Array<ObjectID> | undefined;
  }): Promise<ReminderRule | null>;
  refreshReminderSchedule(data: {
    subjectId: ObjectID;
    projectId: ObjectID;
  }): Promise<void>;
}

/*
 * Records every statement Postgres rejected. PostgresQueryRunner hands each
 * failure to the logger before it throws, whatever the caller then does with
 * the error.
 */
class FailedQueryRecorder implements Logger {
  public failures: Array<string> = [];

  public logQuery(): void {
    return;
  }

  public logQueryError(error: string | Error, query: string): void {
    this.failures.push(
      `${error instanceof Error ? error.message : error} in: ${query}`,
    );
  }

  public logQuerySlow(): void {
    return;
  }

  public logSchemaBuild(): void {
    return;
  }

  public logMigration(): void {
    return;
  }

  public log(): void {
    return;
  }
}

function ruleOperations<TRule extends ReminderRule>(
  service: DatabaseService<TRule>,
): RuleOperations {
  function enabledQuery(projectId: ObjectID, isEnabled: boolean): Query<TRule> {
    return { projectId: projectId, isEnabled: isEnabled } as Query<TRule>;
  }

  return {
    findByEnabled: async (
      projectId: ObjectID,
      isEnabled: boolean,
    ): Promise<Array<ReadRule>> => {
      const rules: Array<TRule> = await service.findBy({
        query: enabledQuery(projectId, isEnabled),
        select: { _id: true, isEnabled: true } as Select<TRule>,
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      });

      return rules
        .map((rule: TRule): ReadRule => {
          return { id: rule.id!.toString(), isEnabled: rule.isEnabled };
        })
        .sort((a: ReadRule, b: ReadRule): number => {
          return a.id.localeCompare(b.id);
        });
    },

    countByEnabled: async (
      projectId: ObjectID,
      isEnabled: boolean,
    ): Promise<number> => {
      return (
        await service.countBy({
          query: enabledQuery(projectId, isEnabled),
          props: { isRoot: true },
        })
      ).toNumber();
    },

    findEnabledById: async (
      id: ObjectID,
    ): Promise<boolean | null | undefined> => {
      const rule: TRule | null = await service.findOneById({
        id: id,
        select: { isEnabled: true } as Select<TRule>,
        props: { isRoot: true },
      });

      return rule?.isEnabled;
    },

    updateByEnabled: async (data: {
      projectId: ObjectID;
      isEnabled: boolean;
      setEnabled: boolean;
      props: DatabaseCommonInteractionProps;
    }): Promise<number> => {
      return await service.updateBy({
        query: enabledQuery(data.projectId, data.isEnabled),
        // Every rule model has isEnabled; TypeScript cannot see it through TRule.
        data: { isEnabled: data.setEnabled } as unknown as PartialEntity<TRule>,
        limit: 100,
        skip: 0,
        props: data.props,
      });
    },

    deleteByEnabled: async (
      projectId: ObjectID,
      isEnabled: boolean,
    ): Promise<number> => {
      return await service.deleteBy({
        query: enabledQuery(projectId, isEnabled),
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      });
    },

    hardDeleteByEnabled: async (
      projectId: ObjectID,
      isEnabled: boolean,
    ): Promise<number> => {
      return await service.hardDeleteBy({
        query: enabledQuery(projectId, isEnabled),
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      });
    },

    create: async (data: {
      projectId: ObjectID;
      name: string;
      reminderIntervalInMinutes: number;
      criteria: RuleCriteria | null;
    }): Promise<ObjectID> => {
      const rule: TRule = new service.modelType();
      rule.projectId = data.projectId;
      rule.name = data.name;
      rule.reminderIntervalInMinutes = data.reminderIntervalInMinutes;
      rule.isEnabled = true;
      if (data.criteria) {
        rule.criteria = data.criteria;
      }

      const created: TRule = await service.create({
        data: rule,
        props: { isRoot: true },
      });

      return created.id!;
    },
  };
}

function criteria(
  isEnabled: boolean,
  filters: Array<RuleCriteriaFilter> = [],
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: filterCondition,
    filters: filters,
    isEnabled: isEnabled,
  };
}

function hasAnyOfLabels(labelIds: Array<ObjectID>): RuleCriteriaFilter {
  return {
    field: "labels",
    operator: RuleCriteriaOperator.HasAnyOf,
    value: labelIds.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

function hasNoneOfLabels(labelIds: Array<ObjectID>): RuleCriteriaFilter {
  return {
    field: "labels",
    operator: RuleCriteriaOperator.HasNoneOf,
    value: labelIds.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

const KINDS: Array<ReminderKind> = [
  {
    name: "Incident",
    ruleTable: "IncidentReminderRule",
    ruleJunctionColumn: "incidentReminderRuleId",
    ruleLabelTable: "IncidentReminderRuleLabel",
    severity: {
      table: "IncidentSeverity",
      ruleJunctionTable: "IncidentReminderRuleIncidentSeverity",
      junctionColumn: "incidentSeverityId",
    },
    subjectTable: "Incident",
    subjectLabelTable: "IncidentLabel",
    subjectLabelColumn: "incidentId",
    stateTable: "IncidentState",
    rules: ruleOperations(IncidentReminderRuleService),
    stateRow: (data: {
      id: ObjectID;
      projectId: ObjectID;
      order: number;
      isResolvedState: boolean;
    }): SqlRow => {
      return {
        _id: data.id.toString(),
        projectId: data.projectId.toString(),
        name: `State ${data.order}`,
        slug: `state-${data.id.toString()}`,
        color: "#000000",
        order: data.order,
        isResolvedState: data.isResolvedState,
        version: 1,
      };
    },
    subjectRow: (data: {
      id: ObjectID;
      projectId: ObjectID;
      stateId: ObjectID;
      severityId: ObjectID;
    }): SqlRow => {
      return {
        _id: data.id.toString(),
        projectId: data.projectId.toString(),
        title: "Checkout is failing",
        slug: `incident-${data.id.toString()}`,
        currentIncidentStateId: data.stateId.toString(),
        incidentSeverityId: data.severityId.toString(),
        version: 1,
      };
    },
    findMatchingRule: (data: {
      projectId: ObjectID;
      severityId?: ObjectID | undefined;
      labelIds?: Array<ObjectID> | undefined;
    }): Promise<ReminderRule | null> => {
      return IncidentReminderRuleService.findMatchingRule({
        projectId: data.projectId,
        incidentSeverityId: data.severityId,
        labelIds: data.labelIds,
      });
    },
    refreshReminderSchedule: (data: {
      subjectId: ObjectID;
      projectId: ObjectID;
    }): Promise<void> => {
      return IncidentService.refreshReminderSchedule({
        incidentId: data.subjectId,
        projectId: data.projectId,
      });
    },
  },
  {
    name: "Alert",
    ruleTable: "AlertReminderRule",
    ruleJunctionColumn: "alertReminderRuleId",
    ruleLabelTable: "AlertReminderRuleLabel",
    severity: {
      table: "AlertSeverity",
      ruleJunctionTable: "AlertReminderRuleAlertSeverity",
      junctionColumn: "alertSeverityId",
    },
    subjectTable: "Alert",
    subjectLabelTable: "AlertLabel",
    subjectLabelColumn: "alertId",
    stateTable: "AlertState",
    rules: ruleOperations(AlertReminderRuleService),
    stateRow: (data: {
      id: ObjectID;
      projectId: ObjectID;
      order: number;
      isResolvedState: boolean;
    }): SqlRow => {
      return {
        _id: data.id.toString(),
        projectId: data.projectId.toString(),
        name: `State ${data.order}`,
        color: "#000000",
        order: data.order,
        isResolvedState: data.isResolvedState,
        version: 1,
      };
    },
    subjectRow: (data: {
      id: ObjectID;
      projectId: ObjectID;
      stateId: ObjectID;
      severityId: ObjectID;
    }): SqlRow => {
      return {
        _id: data.id.toString(),
        projectId: data.projectId.toString(),
        title: "Checkout p95 latency is high",
        currentAlertStateId: data.stateId.toString(),
        alertSeverityId: data.severityId.toString(),
        version: 1,
      };
    },
    findMatchingRule: (data: {
      projectId: ObjectID;
      severityId?: ObjectID | undefined;
      labelIds?: Array<ObjectID> | undefined;
    }): Promise<ReminderRule | null> => {
      return AlertReminderRuleService.findMatchingRule({
        projectId: data.projectId,
        alertSeverityId: data.severityId,
        labelIds: data.labelIds,
      });
    },
    refreshReminderSchedule: (data: {
      subjectId: ObjectID;
      projectId: ObjectID;
    }): Promise<void> => {
      return AlertService.refreshReminderSchedule({
        alertId: data.subjectId,
        projectId: data.projectId,
      });
    },
  },
  {
    name: "ScheduledMaintenance",
    ruleTable: "ScheduledMaintenanceReminderRule",
    ruleJunctionColumn: "scheduledMaintenanceReminderRuleId",
    ruleLabelTable: "ScheduledMaintenanceReminderRuleLabel",
    severity: null,
    subjectTable: "ScheduledMaintenance",
    subjectLabelTable: "ScheduledMaintenanceLabel",
    subjectLabelColumn: "scheduledMaintenanceId",
    stateTable: "ScheduledMaintenanceState",
    rules: ruleOperations(ScheduledMaintenanceReminderRuleService),
    stateRow: (data: {
      id: ObjectID;
      projectId: ObjectID;
      order: number;
      isResolvedState: boolean;
    }): SqlRow => {
      return {
        _id: data.id.toString(),
        projectId: data.projectId.toString(),
        name: `State ${data.order}`,
        slug: `state-${data.id.toString()}`,
        color: "#000000",
        order: data.order,
        isResolvedState: data.isResolvedState,
        version: 1,
      };
    },
    subjectRow: (data: {
      id: ObjectID;
      projectId: ObjectID;
      stateId: ObjectID;
    }): SqlRow => {
      /*
       * Already started, so a rule that does not remind while the event is
       * scheduled still schedules from now; the deferred case has its own
       * test.
       */
      return {
        _id: data.id.toString(),
        projectId: data.projectId.toString(),
        title: "Database upgrade",
        slug: `maintenance-${data.id.toString()}`,
        currentScheduledMaintenanceStateId: data.stateId.toString(),
        startsAt: new Date(Date.now() - 60 * MINUTE_IN_MS),
        endsAt: new Date(Date.now() + 60 * MINUTE_IN_MS),
        version: 1,
      };
    },
    findMatchingRule: (data: {
      projectId: ObjectID;
      labelIds?: Array<ObjectID> | undefined;
    }): Promise<ReminderRule | null> => {
      return ScheduledMaintenanceReminderRuleService.findMatchingRule({
        projectId: data.projectId,
        labelIds: data.labelIds,
      });
    },
    refreshReminderSchedule: (data: {
      subjectId: ObjectID;
      projectId: ObjectID;
    }): Promise<void> => {
      return ScheduledMaintenanceService.refreshReminderSchedule({
        scheduledMaintenanceId: data.subjectId,
        projectId: data.projectId,
      });
    },
  },
];

describePostgres("reminder rule lookup against a migrated Postgres", () => {
  const schema: string = `reminder_rule_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();
  let database: DataSource;

  // Per kind, the open and the resolved state of the test project.
  let openStateIds: Record<string, ObjectID> = {};
  let resolvedStateIds: Record<string, ObjectID> = {};

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["REMINDER_RULE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["REMINDER_RULE_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["REMINDER_RULE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logger: failedQueries,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();

    // Read the migrated triggers before the clones exist.
    const migratedTriggers: Array<{ table: string; definition: string }> =
      await database.query(
        `SELECT c.relname AS "table", pg_get_triggerdef(t.oid) AS "definition"
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND NOT t.tgisinternal
            AND c.relname = ANY($1)
          ORDER BY c.relname, t.tgname`,
        [TABLES],
      );

    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    for (const trigger of migratedTriggers) {
      const definition: string = trigger.definition.replace(
        ` ON public."${trigger.table}" `,
        ` ON "${schema}"."${trigger.table}" `,
      );
      expect(definition).toContain(`ON "${schema}"."${trigger.table}"`);
      await database.query(definition);
    }

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    /*
     * Workflow triggers POST to the workflow service and realtime events go
     * to the socket server: the only side effects of these paths that leave
     * Postgres. The subjects' updates fire them, and so do the rules'
     * creates, updates and deletes.
     */
    const servicesWithSideEffects: Array<SideEffectHooks> = [
      IncidentService,
      AlertService,
      ScheduledMaintenanceService,
      IncidentReminderRuleService,
      AlertReminderRuleService,
      ScheduledMaintenanceReminderRuleService,
    ];

    for (const service of servicesWithSideEffects) {
      jest.spyOn(service, "onTriggerWorkflow").mockResolvedValue(undefined);
      jest.spyOn(service, "onTriggerRealtime").mockResolvedValue(undefined);
    }
  });

  beforeEach(async () => {
    failedQueries.failures = [];

    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      }).join("; "),
    );

    openStateIds = {};
    resolvedStateIds = {};

    for (const kind of KINDS) {
      openStateIds[kind.name] = ObjectID.generate();
      resolvedStateIds[kind.name] = ObjectID.generate();

      await insert(
        kind.stateTable,
        kind.stateRow({
          id: openStateIds[kind.name]!,
          projectId: projectId,
          order: 1,
          isResolvedState: false,
        }),
      );
      await insert(
        kind.stateTable,
        kind.stateRow({
          id: resolvedStateIds[kind.name]!,
          projectId: projectId,
          order: 2,
          isResolvedState: true,
        }),
      );
    }
  });

  afterEach(() => {
    // A failed statement fails the test, even if a caller swallowed it.
    expect(failedQueries.failures).toEqual([]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function insert(table: string, row: SqlRow): Promise<void> {
    const columns: Array<string> = Object.keys(row);
    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        return row[column];
      }),
    );
  }

  async function seedLabel(project: ObjectID = projectId): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await insert("Label", {
      _id: id.toString(),
      projectId: project.toString(),
      name: `Label ${id.toString()}`,
      slug: `label-${id.toString()}`,
      color: "#000000",
      version: 1,
    });
    return id;
  }

  async function seedSeverity(kind: ReminderKind): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await insert(kind.severity!.table, {
      _id: id.toString(),
      projectId: projectId.toString(),
      name: `Severity ${id.toString()}`,
      slug: `severity-${id.toString()}`,
      color: "#000000",
      order: 1,
      version: 1,
    });
    return id;
  }

  interface RuleSeed {
    name: string;
    order: number;
    /*
     * The legacy column as a legacy row stores it. A criteria-backed row's
     * stored value is derived from criteria.isEnabled by the migrated
     * trigger, whatever is written here.
     */
    isEnabled?: boolean | null;
    criteria?: RuleCriteria | null;
    reminderIntervalInMinutes?: number;
    project?: ObjectID;
    deletedAt?: Date | null;
    labelIds?: Array<ObjectID>;
    severityIds?: Array<ObjectID>;
    remindWhileScheduled?: boolean;
  }

  async function seedRule(
    kind: ReminderKind,
    seed: RuleSeed,
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    const row: SqlRow = {
      _id: id.toString(),
      projectId: (seed.project || projectId).toString(),
      name: seed.name,
      order: seed.order,
      isEnabled: seed.isEnabled === undefined ? true : seed.isEnabled,
      criteria: seed.criteria ? JSON.stringify(seed.criteria) : null,
      reminderIntervalInMinutes: seed.reminderIntervalInMinutes || 30,
      deletedAt: seed.deletedAt || null,
      version: 1,
    };

    if (seed.remindWhileScheduled !== undefined) {
      row["remindWhileScheduled"] = seed.remindWhileScheduled;
    }

    await insert(kind.ruleTable, row);

    for (const labelId of seed.labelIds || []) {
      await insert(kind.ruleLabelTable, {
        [kind.ruleJunctionColumn]: id.toString(),
        labelId: labelId.toString(),
      });
    }

    for (const severityId of seed.severityIds || []) {
      await insert(kind.severity!.ruleJunctionTable, {
        [kind.ruleJunctionColumn]: id.toString(),
        [kind.severity!.junctionColumn]: severityId.toString(),
      });
    }

    return id;
  }

  // Every enabled/disabled encoding a rule table holds, plus decoys.
  interface SeededRuleSet {
    legacyEnabled: ObjectID;
    legacyDisabled: ObjectID;
    legacyNull: ObjectID;
    criteriaEnabled: ObjectID;
    criteriaDisabled: ObjectID;
    otherProjectEnabled: ObjectID;
    softDeletedEnabled: ObjectID;
  }

  async function seedEveryEncoding(kind: ReminderKind): Promise<SeededRuleSet> {
    return {
      legacyDisabled: await seedRule(kind, {
        name: "legacy disabled",
        order: 1,
        isEnabled: false,
      }),
      legacyNull: await seedRule(kind, {
        name: "legacy with a NULL isEnabled",
        order: 2,
        isEnabled: null,
      }),
      criteriaDisabled: await seedRule(kind, {
        name: "criteria-backed disabled",
        order: 3,
        criteria: criteria(false),
      }),
      legacyEnabled: await seedRule(kind, {
        name: "legacy enabled",
        order: 4,
        isEnabled: true,
      }),
      criteriaEnabled: await seedRule(kind, {
        name: "criteria-backed enabled",
        order: 5,
        criteria: criteria(true),
      }),
      otherProjectEnabled: await seedRule(kind, {
        name: "another project's enabled rule",
        order: 0,
        isEnabled: true,
        project: otherProjectId,
      }),
      softDeletedEnabled: await seedRule(kind, {
        name: "soft-deleted enabled rule",
        order: 0,
        isEnabled: true,
        deletedAt: new Date(),
      }),
    };
  }

  async function storedRules(
    kind: ReminderKind,
  ): Promise<Record<string, StoredRule>> {
    const rows: Array<{
      _id: string;
      isEnabled: boolean | null;
      criteria: RuleCriteria | null;
    }> = await database.query(
      `SELECT "_id", "isEnabled", "criteria" FROM "${schema}"."${kind.ruleTable}"`,
    );

    const stored: Record<string, StoredRule> = {};

    for (const row of rows) {
      stored[row._id] = {
        isEnabled: row.isEnabled,
        criteriaEnabled:
          row.criteria && typeof row.criteria.isEnabled === "boolean"
            ? row.criteria.isEnabled
            : null,
      };
    }

    return stored;
  }

  async function countRules(kind: ReminderKind): Promise<number> {
    const rows: Array<{ count: string }> = await database.query(
      `SELECT count(*)::text AS "count" FROM "${schema}"."${kind.ruleTable}"`,
    );
    return Number(rows[0]!.count);
  }

  async function seedSubject(
    kind: ReminderKind,
    options: {
      severityId?: ObjectID;
      labelIds?: Array<ObjectID>;
      enableReminders?: boolean;
      resolved?: boolean;
      nextReminderNotificationAt?: Date | null;
      startsAt?: Date;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    const row: SqlRow = kind.subjectRow({
      id: id,
      projectId: projectId,
      stateId: options.resolved
        ? resolvedStateIds[kind.name]!
        : openStateIds[kind.name]!,
      severityId: options.severityId || ObjectID.generate(),
    });

    row["enableReminders"] =
      options.enableReminders === undefined ? true : options.enableReminders;
    row["nextReminderNotificationAt"] =
      options.nextReminderNotificationAt || null;

    if (options.startsAt) {
      row["startsAt"] = options.startsAt;
    }

    await insert(kind.subjectTable, row);

    for (const labelId of options.labelIds || []) {
      await insert(kind.subjectLabelTable, {
        [kind.subjectLabelColumn]: id.toString(),
        labelId: labelId.toString(),
      });
    }

    return id;
  }

  async function nextReminderAt(
    kind: ReminderKind,
    subjectId: ObjectID,
  ): Promise<Date | null> {
    const rows: Array<{ nextReminderNotificationAt: Date | null }> =
      await database.query(
        `SELECT "nextReminderNotificationAt" FROM "${schema}"."${kind.subjectTable}" WHERE "_id" = $1`,
        [subjectId.toString()],
      );
    expect(rows).toHaveLength(1);
    return rows[0]!.nextReminderNotificationAt;
  }

  /*
   * Runs the refresh and returns the window its "now" fell into, so the
   * scheduled time is checked without depending on the clock.
   */
  async function refresh(
    kind: ReminderKind,
    subjectId: ObjectID,
  ): Promise<{ startedAt: number; finishedAt: number }> {
    const startedAt: number = Date.now();
    await kind.refreshReminderSchedule({
      subjectId: subjectId,
      projectId: projectId,
    });
    const finishedAt: number = Date.now();
    return { startedAt, finishedAt };
  }

  function expectScheduledIn(
    scheduled: Date | null,
    window: { startedAt: number; finishedAt: number },
    intervalInMinutes: number,
  ): void {
    expect(scheduled).toBeInstanceOf(Date);
    expect(scheduled!.getTime()).toBeGreaterThanOrEqual(
      window.startedAt + intervalInMinutes * MINUTE_IN_MS,
    );
    expect(scheduled!.getTime()).toBeLessThanOrEqual(
      window.finishedAt + intervalInMinutes * MINUTE_IN_MS,
    );
  }

  function ids(values: Array<ObjectID>): Array<string> {
    return values
      .map((value: ObjectID): string => {
        return value.toString();
      })
      .sort();
  }

  describe("the migrated rule tables", () => {
    test.each(KINDS)(
      "$name: the stored isEnabled of a criteria-backed rule is derived from criteria.isEnabled",
      async (kind: ReminderKind) => {
        /*
         * The rollout encoding the lookup decodes: a criteria-backed rule
         * stores NULL when enabled and false when disabled, so an older
         * worker asking for isEnabled = true sees neither. The migrated
         * trigger enforces it on every write, whatever the writer sent.
         */
        const enabled: ObjectID = await seedRule(kind, {
          name: "criteria-backed, sent as true",
          order: 1,
          isEnabled: true,
          criteria: criteria(true),
        });
        const disabled: ObjectID = await seedRule(kind, {
          name: "criteria-backed, sent as true but disabled",
          order: 2,
          isEnabled: true,
          criteria: criteria(false),
        });

        expect(await storedRules(kind)).toEqual({
          [enabled.toString()]: { isEnabled: null, criteriaEnabled: true },
          [disabled.toString()]: { isEnabled: false, criteriaEnabled: false },
        });
      },
    );
  });

  describe.each(KINDS)("$name reminder rules", (kind: ReminderKind) => {
    describe("findMatchingRule", () => {
      test("with no rules at all, finds no match and raises no SQL error", async () => {
        expect(await countRules(kind)).toBe(0);

        await expect(
          kind.findMatchingRule({ projectId: projectId }),
        ).resolves.toBeNull();
        await expect(
          kind.findMatchingRule({
            projectId: projectId,
            severityId: ObjectID.generate(),
            labelIds: [ObjectID.generate()],
          }),
        ).resolves.toBeNull();
      });

      test("finds the enabled legacy rule and skips disabled and NULL legacy rules", async () => {
        await seedRule(kind, { name: "disabled", order: 1, isEnabled: false });
        await seedRule(kind, { name: "NULL", order: 2, isEnabled: null });

        await expect(
          kind.findMatchingRule({ projectId: projectId }),
        ).resolves.toBeNull();

        const enabled: ObjectID = await seedRule(kind, {
          name: "enabled",
          order: 3,
          isEnabled: true,
          reminderIntervalInMinutes: 45,
        });

        const match: ReminderRule | null = await kind.findMatchingRule({
          projectId: projectId,
        });

        expect(match?.id?.toString()).toBe(enabled.toString());
        expect(match?.name).toBe("enabled");
        expect(match?.reminderIntervalInMinutes).toBe(45);
        expect(match?.criteria).toBeNull();
      });

      test("finds an enabled criteria-backed rule, which reads back as enabled, and skips a disabled one", async () => {
        const disabled: ObjectID = await seedRule(kind, {
          name: "criteria-backed disabled",
          order: 1,
          criteria: criteria(false),
        });

        await expect(
          kind.findMatchingRule({ projectId: projectId }),
        ).resolves.toBeNull();

        const enabled: ObjectID = await seedRule(kind, {
          name: "criteria-backed enabled",
          order: 2,
          criteria: criteria(true),
        });

        const match: ReminderRule | null = await kind.findMatchingRule({
          projectId: projectId,
        });

        expect(match?.id?.toString()).toBe(enabled.toString());
        expect(match?.criteria).toEqual(criteria(true));

        // Stored as NULL; every reader is handed the logical value.
        expect(await kind.rules.findEnabledById(enabled)).toBe(true);
        expect(await kind.rules.findEnabledById(disabled)).toBe(false);
      });

      test("the lowest order among the matching enabled rules wins", async () => {
        await seedRule(kind, {
          name: "disabled, lowest order",
          order: 1,
          isEnabled: false,
        });
        await seedRule(kind, { name: "order 5", order: 5 });
        const winner: ObjectID = await seedRule(kind, {
          name: "order 2, criteria-backed",
          order: 2,
          criteria: criteria(true),
        });
        await seedRule(kind, { name: "order 3", order: 3 });

        const match: ReminderRule | null = await kind.findMatchingRule({
          projectId: projectId,
        });

        expect(match?.id?.toString()).toBe(winner.toString());
        expect(match?.order).toBe(2);
      });

      test("a legacy label restriction is honoured", async () => {
        const matchingLabel: ObjectID = await seedLabel();
        const otherLabel: ObjectID = await seedLabel();

        const restricted: ObjectID = await seedRule(kind, {
          name: "only for the label",
          order: 1,
          labelIds: [matchingLabel],
        });

        // Without a fallback rule, a subject outside the label matches nothing.
        await expect(
          kind.findMatchingRule({
            projectId: projectId,
            labelIds: [otherLabel],
          }),
        ).resolves.toBeNull();
        await expect(
          kind.findMatchingRule({ projectId: projectId }),
        ).resolves.toBeNull();

        const fallback: ObjectID = await seedRule(kind, {
          name: "everything else",
          order: 2,
        });

        expect(
          (
            await kind.findMatchingRule({
              projectId: projectId,
              labelIds: [otherLabel, matchingLabel],
            })
          )?.id?.toString(),
        ).toBe(restricted.toString());
        expect(
          (
            await kind.findMatchingRule({
              projectId: projectId,
              labelIds: [otherLabel],
            })
          )?.id?.toString(),
        ).toBe(fallback.toString());
        expect(
          (
            await kind.findMatchingRule({ projectId: projectId })
          )?.id?.toString(),
        ).toBe(fallback.toString());
      });

      if (kind.severity) {
        test("a legacy severity restriction is honoured", async () => {
          const critical: ObjectID = await seedSeverity(kind);
          const minor: ObjectID = await seedSeverity(kind);

          const criticalRule: ObjectID = await seedRule(kind, {
            name: "critical only",
            order: 1,
            severityIds: [critical],
          });
          const minorRule: ObjectID = await seedRule(kind, {
            name: "minor only",
            order: 2,
            severityIds: [minor],
          });

          expect(
            (
              await kind.findMatchingRule({
                projectId: projectId,
                severityId: critical,
              })
            )?.id?.toString(),
          ).toBe(criticalRule.toString());
          expect(
            (
              await kind.findMatchingRule({
                projectId: projectId,
                severityId: minor,
              })
            )?.id?.toString(),
          ).toBe(minorRule.toString());
          await expect(
            kind.findMatchingRule({
              projectId: projectId,
              severityId: ObjectID.generate(),
            }),
          ).resolves.toBeNull();
          await expect(
            kind.findMatchingRule({ projectId: projectId }),
          ).resolves.toBeNull();
        });
      }

      test("a criteria-backed rule's criteria decide, not its stale legacy relations", async () => {
        const production: ObjectID = await seedLabel();
        const staging: ObjectID = await seedLabel();

        /*
         * The junction row is what an older version saved before criteria
         * were configured; once criteria exist they alone decide.
         */
        const productionRule: ObjectID = await seedRule(kind, {
          name: "production",
          order: 1,
          criteria: criteria(true, [hasAnyOfLabels([production])]),
          labelIds: [staging],
          reminderIntervalInMinutes: 15,
        });
        const everythingElse: ObjectID = await seedRule(kind, {
          name: "everything but production",
          order: 2,
          criteria: criteria(true, [hasNoneOfLabels([production])]),
          reminderIntervalInMinutes: 120,
        });

        expect(
          (
            await kind.findMatchingRule({
              projectId: projectId,
              labelIds: [production],
            })
          )?.id?.toString(),
        ).toBe(productionRule.toString());
        expect(
          (
            await kind.findMatchingRule({
              projectId: projectId,
              labelIds: [staging],
            })
          )?.id?.toString(),
        ).toBe(everythingElse.toString());
        expect(
          (
            await kind.findMatchingRule({ projectId: projectId })
          )?.id?.toString(),
        ).toBe(everythingElse.toString());
      });

      test("ignores another project's rules and soft-deleted rules", async () => {
        await seedRule(kind, {
          name: "another project's",
          order: 1,
          project: otherProjectId,
        });
        await seedRule(kind, {
          name: "another project's, criteria-backed",
          order: 1,
          project: otherProjectId,
          criteria: criteria(true),
        });
        await seedRule(kind, {
          name: "deleted",
          order: 1,
          deletedAt: new Date(),
        });
        await seedRule(kind, {
          name: "deleted, criteria-backed",
          order: 1,
          deletedAt: new Date(),
          criteria: criteria(true),
        });

        await expect(
          kind.findMatchingRule({ projectId: projectId }),
        ).resolves.toBeNull();

        const own: ObjectID = await seedRule(kind, { name: "own", order: 9 });

        expect(
          (
            await kind.findMatchingRule({ projectId: projectId })
          )?.id?.toString(),
        ).toBe(own.toString());
      });
    });

    describe("the DatabaseService paths filtering on isEnabled", () => {
      test("findBy and countBy return exactly the logically enabled or disabled rules", async () => {
        const rules: SeededRuleSet = await seedEveryEncoding(kind);

        expect(await kind.rules.findByEnabled(projectId, true)).toEqual(
          ids([rules.legacyEnabled, rules.criteriaEnabled]).map(
            (id: string): ReadRule => {
              return { id: id, isEnabled: true };
            },
          ),
        );
        expect(await kind.rules.countByEnabled(projectId, true)).toBe(2);

        // A disabled criteria-backed rule reads back as false, like a legacy one.
        const disabled: Array<ReadRule> = await kind.rules.findByEnabled(
          projectId,
          false,
        );
        expect(
          disabled.map((rule: ReadRule): string => {
            return rule.id;
          }),
        ).toEqual(
          ids([rules.legacyDisabled, rules.legacyNull, rules.criteriaDisabled]),
        );
        expect(
          disabled.find((rule: ReadRule): boolean => {
            return rule.id === rules.criteriaDisabled.toString();
          })?.isEnabled,
        ).toBe(false);
        expect(
          disabled.find((rule: ReadRule): boolean => {
            return rule.id === rules.legacyDisabled.toString();
          })?.isEnabled,
        ).toBe(false);
        expect(await kind.rules.countByEnabled(projectId, false)).toBe(3);

        // The other project's rules are counted there, not here.
        expect(await kind.rules.countByEnabled(otherProjectId, true)).toBe(1);
      });

      test("updateBy changes exactly the rules the filter selects, in their own encoding", async () => {
        const rules: SeededRuleSet = await seedEveryEncoding(kind);
        const before: Record<string, StoredRule> = await storedRules(kind);

        expect(
          await kind.rules.updateByEnabled({
            projectId: projectId,
            isEnabled: true,
            setEnabled: false,
            props: { isRoot: true },
          }),
        ).toBe(2);

        expect(await storedRules(kind)).toEqual({
          ...before,
          [rules.legacyEnabled.toString()]: {
            isEnabled: false,
            criteriaEnabled: null,
          },
          [rules.criteriaEnabled.toString()]: {
            isEnabled: false,
            criteriaEnabled: false,
          },
        });

        // Now five disabled rules in the project, and none enabled.
        expect(
          await kind.rules.updateByEnabled({
            projectId: projectId,
            isEnabled: false,
            setEnabled: true,
            props: { isRoot: true },
          }),
        ).toBe(5);

        expect(await storedRules(kind)).toEqual({
          ...before,
          [rules.legacyEnabled.toString()]: {
            isEnabled: true,
            criteriaEnabled: null,
          },
          [rules.legacyDisabled.toString()]: {
            isEnabled: true,
            criteriaEnabled: null,
          },
          [rules.legacyNull.toString()]: {
            isEnabled: true,
            criteriaEnabled: null,
          },
          [rules.criteriaEnabled.toString()]: {
            isEnabled: null,
            criteriaEnabled: true,
          },
          [rules.criteriaDisabled.toString()]: {
            isEnabled: null,
            criteriaEnabled: true,
          },
        });
        expect(await kind.rules.countByEnabled(projectId, true)).toBe(5);
      });

      test("deleteBy deletes exactly the rules the filter selects", async () => {
        const rules: SeededRuleSet = await seedEveryEncoding(kind);

        expect(await kind.rules.deleteByEnabled(projectId, false)).toBe(3);

        expect(Object.keys(await storedRules(kind)).sort()).toEqual(
          ids([
            rules.legacyEnabled,
            rules.criteriaEnabled,
            rules.otherProjectEnabled,
            rules.softDeletedEnabled,
          ]),
        );
      });

      /*
       * Unlike the paths above, hardDeleteBy hands the filter to TypeORM's
       * DeleteQueryBuilder, which calls the Raw with a bare column name
       * instead of `Alias.column`. A hard delete also reaches soft-deleted
       * rows, so the soft-deleted enabled rule goes too.
       */
      test("hardDeleteBy, whose DELETE statement carries the filter itself, deletes exactly the rules it selects", async () => {
        const rules: SeededRuleSet = await seedEveryEncoding(kind);

        expect(await kind.rules.hardDeleteByEnabled(projectId, true)).toBe(3);

        expect(Object.keys(await storedRules(kind)).sort()).toEqual(
          ids([
            rules.legacyDisabled,
            rules.legacyNull,
            rules.criteriaDisabled,
            rules.otherProjectEnabled,
          ]),
        );
      });
    });

    describe("refreshReminderSchedule", () => {
      test("with no rules at all, completes and leaves the next reminder unset", async () => {
        const subjectId: ObjectID = await seedSubject(kind);

        await refresh(kind, subjectId);

        expect(await nextReminderAt(kind, subjectId)).toBeNull();
      });

      test.each([
        ["a legacy rule", null],
        ["a criteria-backed rule", criteria(true)],
      ] as Array<[string, RuleCriteria | null]>)(
        "with %s matching, schedules the next reminder one interval from now",
        async (_label: string, ruleCriteria: RuleCriteria | null) => {
          await seedRule(kind, {
            name: "disabled, shorter interval",
            order: 1,
            isEnabled: false,
            reminderIntervalInMinutes: 5,
          });
          await seedRule(kind, {
            name: "matching",
            order: 2,
            criteria: ruleCriteria,
            reminderIntervalInMinutes: 30,
          });
          const subjectId: ObjectID = await seedSubject(kind);

          const window: { startedAt: number; finishedAt: number } =
            await refresh(kind, subjectId);

          expectScheduledIn(await nextReminderAt(kind, subjectId), window, 30);
        },
      );

      test("uses the rule the subject's labels select", async () => {
        const production: ObjectID = await seedLabel();
        await seedRule(kind, {
          name: "production",
          order: 1,
          labelIds: [production],
          reminderIntervalInMinutes: 15,
        });
        await seedRule(kind, {
          name: "everything else",
          order: 2,
          reminderIntervalInMinutes: 240,
        });
        const productionSubject: ObjectID = await seedSubject(kind, {
          labelIds: [production],
        });
        const otherSubject: ObjectID = await seedSubject(kind);

        const productionWindow: { startedAt: number; finishedAt: number } =
          await refresh(kind, productionSubject);
        const otherWindow: { startedAt: number; finishedAt: number } =
          await refresh(kind, otherSubject);

        expectScheduledIn(
          await nextReminderAt(kind, productionSubject),
          productionWindow,
          15,
        );
        expectScheduledIn(
          await nextReminderAt(kind, otherSubject),
          otherWindow,
          240,
        );
      });

      test("when no rule of the project matches the subject, leaves the next reminder unset and clears a stale one", async () => {
        const production: ObjectID = await seedLabel();
        const staging: ObjectID = await seedLabel();
        await seedRule(kind, {
          name: "production only",
          order: 1,
          labelIds: [production],
        });
        await seedRule(kind, {
          name: "production only, criteria-backed",
          order: 2,
          criteria: criteria(true, [hasAnyOfLabels([production])]),
        });
        const subjectId: ObjectID = await seedSubject(kind, {
          labelIds: [staging],
          nextReminderNotificationAt: new Date(Date.now() + MINUTE_IN_MS),
        });

        await refresh(kind, subjectId);

        expect(await nextReminderAt(kind, subjectId)).toBeNull();
      });

      test("with reminders turned off for the subject, leaves the next reminder unset and clears a stale one", async () => {
        await seedRule(kind, { name: "matching", order: 1 });
        const subjectId: ObjectID = await seedSubject(kind, {
          enableReminders: false,
        });
        const staleSubjectId: ObjectID = await seedSubject(kind, {
          enableReminders: false,
          nextReminderNotificationAt: new Date(Date.now() + MINUTE_IN_MS),
        });

        await refresh(kind, subjectId);
        await refresh(kind, staleSubjectId);

        expect(await nextReminderAt(kind, subjectId)).toBeNull();
        expect(await nextReminderAt(kind, staleSubjectId)).toBeNull();
      });

      test("with only disabled rules, leaves the next reminder unset and clears a stale one", async () => {
        await seedRule(kind, { name: "disabled", order: 1, isEnabled: false });
        await seedRule(kind, { name: "NULL", order: 2, isEnabled: null });
        await seedRule(kind, {
          name: "criteria-backed disabled",
          order: 3,
          criteria: criteria(false),
        });
        await seedRule(kind, {
          name: "another project's",
          order: 4,
          project: otherProjectId,
        });
        const subjectId: ObjectID = await seedSubject(kind, {
          nextReminderNotificationAt: new Date(Date.now() + MINUTE_IN_MS),
        });

        await refresh(kind, subjectId);

        expect(await nextReminderAt(kind, subjectId)).toBeNull();
      });

      test("for a resolved subject, leaves the next reminder unset", async () => {
        await seedRule(kind, { name: "matching", order: 1 });
        const subjectId: ObjectID = await seedSubject(kind, {
          resolved: true,
        });

        await refresh(kind, subjectId);

        expect(await nextReminderAt(kind, subjectId)).toBeNull();
      });
    });

    describe("editing rules through the service re-evaluates open subjects", () => {
      /*
       * The path a user takes: the dashboard saves the rule, and the create
       * hook re-evaluates every open subject of the project.
       */
      test.each([
        ["legacy", null, { isEnabled: true, criteriaEnabled: null }],
        [
          "criteria-backed",
          criteria(true, [], FilterCondition.Any),
          { isEnabled: null, criteriaEnabled: true },
        ],
      ] as Array<[string, RuleCriteria | null, StoredRule]>)(
        "a %s rule created through the service is found, and creating it schedules the open subjects' reminders",
        async (
          _label: string,
          ruleCriteria: RuleCriteria | null,
          expectedStored: StoredRule,
        ) => {
          const openSubject: ObjectID = await seedSubject(kind);
          const resolvedSubject: ObjectID = await seedSubject(kind, {
            resolved: true,
          });

          const startedAt: number = Date.now();
          const ruleId: ObjectID = await kind.rules.create({
            projectId: projectId,
            name: "created through the service",
            reminderIntervalInMinutes: 20,
            criteria: ruleCriteria,
          });
          const finishedAt: number = Date.now();

          expect(await storedRules(kind)).toEqual({
            [ruleId.toString()]: expectedStored,
          });
          expect(
            (
              await kind.findMatchingRule({ projectId: projectId })
            )?.id?.toString(),
          ).toBe(ruleId.toString());
          expectScheduledIn(
            await nextReminderAt(kind, openSubject),
            { startedAt, finishedAt },
            20,
          );
          expect(await nextReminderAt(kind, resolvedSubject)).toBeNull();
        },
      );

      test("disabling and re-enabling the matching rule through updateBy clears and reschedules the open subject's reminder", async () => {
        await seedRule(kind, {
          name: "matching",
          order: 1,
          criteria: criteria(true),
          reminderIntervalInMinutes: 25,
        });
        const subjectId: ObjectID = await seedSubject(kind);
        await refresh(kind, subjectId);
        expect(await nextReminderAt(kind, subjectId)).not.toBeNull();

        // The update hook refreshes the tenant's open subjects.
        const props: DatabaseCommonInteractionProps = {
          isRoot: true,
          tenantId: projectId,
        };

        expect(
          await kind.rules.updateByEnabled({
            projectId: projectId,
            isEnabled: true,
            setEnabled: false,
            props: props,
          }),
        ).toBe(1);
        expect(await nextReminderAt(kind, subjectId)).toBeNull();

        const startedAt: number = Date.now();
        expect(
          await kind.rules.updateByEnabled({
            projectId: projectId,
            isEnabled: false,
            setEnabled: true,
            props: props,
          }),
        ).toBe(1);
        const finishedAt: number = Date.now();

        expectScheduledIn(
          await nextReminderAt(kind, subjectId),
          { startedAt, finishedAt },
          25,
        );
      });
    });
  });

  describe("a scheduled maintenance that has not started yet", () => {
    const kind: ReminderKind = KINDS.find((candidate: ReminderKind) => {
      return candidate.name === "ScheduledMaintenance";
    })!;

    test("is first reminded one interval after it starts, unless the rule reminds while it is scheduled", async () => {
      const startsAt: Date = new Date(Date.now() + 120 * MINUTE_IN_MS);
      const subjectId: ObjectID = await seedSubject(kind, {
        startsAt: startsAt,
      });

      const ruleId: ObjectID = await seedRule(kind, {
        name: "after it starts",
        order: 1,
        reminderIntervalInMinutes: 10,
        remindWhileScheduled: false,
      });

      await refresh(kind, subjectId);

      expect((await nextReminderAt(kind, subjectId))?.getTime()).toBe(
        startsAt.getTime() + 10 * MINUTE_IN_MS,
      );

      await database.query(
        `UPDATE "${schema}"."${kind.ruleTable}" SET "remindWhileScheduled" = true WHERE "_id" = $1`,
        [ruleId.toString()],
      );

      const window: { startedAt: number; finishedAt: number } = await refresh(
        kind,
        subjectId,
      );

      expectScheduledIn(await nextReminderAt(kind, subjectId), window, 10);
    });
  });
});
