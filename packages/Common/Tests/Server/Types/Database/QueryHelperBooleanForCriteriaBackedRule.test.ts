import Entities from "../../../../Models/DatabaseModels/Index";
import AlertReminderRule from "../../../../Models/DatabaseModels/AlertReminderRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RelationOnlyRuleBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/RelationOnlyRuleBaseModel";
import IncidentReminderRule from "../../../../Models/DatabaseModels/IncidentReminderRule";
import ScheduledMaintenanceReminderRule from "../../../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import AlertReminderRuleService from "../../../../Server/Services/AlertReminderRuleService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import IncidentReminderRuleService from "../../../../Server/Services/IncidentReminderRuleService";
import ScheduledMaintenanceReminderRuleService from "../../../../Server/Services/ScheduledMaintenanceReminderRuleService";
import Query from "../../../../Server/Types/Database/Query";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import Select from "../../../../Server/Types/Database/Select";
import ObjectID from "../../../../Types/ObjectID";
import {
  DataSource,
  EntityMetadata,
  FindOperator,
  FindOptionsSelect,
  FindOptionsWhere,
  QueryFailedError,
  QueryResult,
  QueryRunner,
  ReplicationMode,
  Repository,
} from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * OneUptime/oneuptime#4030: "Reminder scheduling failed in
 * IncidentService.onCreateSuccess: QueryFailedError: missing FROM-clause entry
 * for table "incidentreminderrule"".
 *
 * Every read or write of a relation-only rule (IncidentReminderRule,
 * AlertReminderRule, ScheduledMaintenanceReminderRule) that filters on a
 * boolean `isEnabled` is rewritten by DatabaseService into
 * QueryHelper.booleanForCriteriaBackedRule("criteria", value): a TypeORM `Raw`
 * whose SQL has to read a SECOND column, `criteria`, next to the one TypeORM
 * hands it. TypeORM calls the Raw with the UNESCAPED alias path
 * (`IncidentReminderRule.isEnabled` from a SELECT builder, plain `isEnabled`
 * from UPDATE/DELETE builders) and only afterwards rewrites tokens shaped
 * exactly `Alias.<known property>` into `"Alias"."column"`.
 *
 * The helper used to build the second reference as `IncidentReminderRule."criteria"`.
 * That token is not `Alias.<known property>`, so TypeORM left it alone, and
 * Postgres folded the unquoted qualifier to `incidentreminderrule`, which names
 * nothing in FROM (the alias is the quoted, mixed-case "IncidentReminderRule").
 * The error is raised while PLANNING the statement, so it did not depend on any
 * rows existing: every findMatchingRule() of every reminder rule kind failed,
 * whether or not a project had rules, and reminders were never scheduled.
 *
 * None of this needs a database to observe, so this file runs in every Common
 * CI shard. It checks three layers:
 *
 *  1. The fragment the Raw renders for each alias shape TypeORM produces.
 *  2. The SQL real TypeORM generates for the three rule models, on every query
 *     builder path DatabaseService uses. The DataSource builds entity metadata
 *     without connecting, and its query runners are swapped for a stand-in that
 *     records each statement instead of sending it (see installRecordingRunner).
 *  3. The public DatabaseService API (the `isEnabled` translation) and the
 *     reminder services' findMatchingRule, the exact call from the issue, with
 *     getRepository() returning that same metadata-only repository.
 */

type RuleModelType = { new (): RelationOnlyRuleBaseModel };
type AnyModelType = { new (): BaseModel };
type RawRow = Record<string, unknown>;

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  /* TypeORM renders the SQL through this, given the column alias path. */
  getSql: (aliasPath: string) => string;
}

interface CapturedQuery {
  sql: string;
  parameters: Array<unknown>;
}

type RecordingQuery = (
  sql: string,
  parameters?: Array<unknown>,
  useStructuredResult?: boolean,
) => Promise<unknown>;

type CreateQueryRunner = (mode: ReplicationMode) => QueryRunner;

const asRaw: (operator: unknown) => RawOperator = (
  operator: unknown,
): RawOperator => {
  return operator as RawOperator;
};

const soleParameterName: (operator: RawOperator) => string = (
  operator: RawOperator,
): string => {
  const names: Array<string> = Object.keys(operator.objectLiteralParameters);
  expect(names).toHaveLength(1);
  return names[0]!;
};

/*
 * The fragment for a given criteria reference and isEnabled path, with the
 * CASE semantics the rollout encoding depends on: a legacy row (criteria NULL)
 * is enabled only when isEnabled is true, a criteria-backed row only when
 * isEnabled IS NULL.
 */
const expectedFragment: (data: {
  criteria: string;
  isEnabled: string;
  parameterName: string;
}) => string = (data: {
  criteria: string;
  isEnabled: string;
  parameterName: string;
}): string => {
  return `((CASE WHEN ${data.criteria} IS NULL THEN COALESCE(${data.isEnabled}, false) ELSE ${data.isEnabled} IS NULL END) = :${data.parameterName})`;
};

/*
 * An unquoted identifier used as a qualifier: `word.` right before a column,
 * not preceded by a quote. Postgres folds such a qualifier to lower case, and
 * every alias TypeORM declares for these models is a quoted mixed-case name, so
 * a folded one names nothing in FROM. This is the #4030 shape.
 */
const UNQUOTED_QUALIFIER: RegExp =
  /(?<![\w"$])([A-Za-z_][\w$]*)\.(?=["A-Za-z_])/;

// A positional parameter such as `$2` at the start of a string.
const LEADING_PLACEHOLDER: RegExp = /^\$(\d+)/;

const escapeRegExp: (text: string) => string = (text: string): string => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// `Alias.` anywhere in the statement without a double quote in front of it.
const unquotedReferenceTo: (alias: string) => RegExp = (
  alias: string,
): RegExp => {
  return new RegExp(`(?<![\\w"])${escapeRegExp(alias)}\\.`);
};

/*
 * Every model the DatabaseService translation applies to, discovered the same
 * way DatabaseService decides (`this.model instanceof
 * RelationOnlyRuleBaseModel`), so a future fourth model is exercised here
 * without anyone remembering to add it.
 */
const RULE_MODELS: Array<RuleModelType> = (
  Entities as Array<AnyModelType>
).filter((modelType: AnyModelType): boolean => {
  return new modelType() instanceof RelationOnlyRuleBaseModel;
}) as Array<RuleModelType>;

const RULE_MODEL_CASES: Array<[string, RuleModelType]> = RULE_MODELS.map(
  (modelType: RuleModelType): [string, RuleModelType] => {
    return [modelType.name, modelType];
  },
);

let dataSource: DataSource;
let originalCreateQueryRunner: CreateQueryRunner;
const capturedQueries: Array<CapturedQuery> = [];

/*
 * Rows the stand-in runner hands back to an entity SELECT. Empty unless a test
 * needs rows to reach a later statement (hardDeleteBy's DELETE, or a rule that
 * findMatchingRule should return).
 */
let entityRows: Array<RawRow> = [];

/*
 * TypeORM pages a find that joins a to-many relation in two statements: a
 * DISTINCT query for the page of ids, then the real SELECT restricted to those
 * ids. Returning one id from the first makes TypeORM render the second too.
 */
const DISTINCT_ID_COLUMN: RegExp = /AS "(ids_[^"]+)"/;

const rowsFor: (sql: string) => Array<RawRow> = (
  sql: string,
): Array<RawRow> => {
  const distinctIdColumn: RegExpExecArray | null = DISTINCT_ID_COLUMN.exec(sql);

  if (distinctIdColumn) {
    const firstRowId: unknown = entityRows[0]
      ? Object.values(entityRows[0])[0]
      : ObjectID.generate().toString();

    return [{ [distinctIdColumn[1]!]: firstRowId }];
  }

  if (sql.startsWith("SELECT") && !sql.startsWith("SELECT COUNT(")) {
    return entityRows;
  }

  return [];
};

/*
 * Every query runner the DataSource creates keeps its real construction (no
 * connection is opened until a query is sent) but records the statement
 * instead of sending it. It refuses a statement with an unquoted qualifier the
 * way Postgres does, with the production error, so a regression shows up as
 * the #4030 failure and not only as a mismatched string.
 *
 * Assigned directly rather than through jest.spyOn so restoreAllMocks() in the
 * service tests cannot silently put the real runner back.
 */
const installRecordingRunner: () => void = (): void => {
  originalCreateQueryRunner = dataSource.driver.createQueryRunner.bind(
    dataSource.driver,
  );

  dataSource.driver.createQueryRunner = (
    mode: ReplicationMode,
  ): QueryRunner => {
    const runner: QueryRunner = originalCreateQueryRunner(mode);

    const recordingQuery: RecordingQuery = (
      sql: string,
      parameters?: Array<unknown>,
      useStructuredResult?: boolean,
    ): Promise<unknown> => {
      capturedQueries.push({ sql, parameters: parameters || [] });

      const unquotedQualifier: RegExpExecArray | null =
        UNQUOTED_QUALIFIER.exec(sql);

      if (unquotedQualifier) {
        return Promise.reject(
          new QueryFailedError(
            sql,
            parameters,
            new Error(
              `missing FROM-clause entry for table "${unquotedQualifier[1]!.toLowerCase()}"`,
            ),
          ),
        );
      }

      const rows: Array<RawRow> = rowsFor(sql);

      if (!useStructuredResult) {
        return Promise.resolve(rows);
      }

      const result: QueryResult = new QueryResult();
      result.records = rows;
      result.raw = rows;
      result.affected = rows.length;

      return Promise.resolve(result);
    };

    (runner as unknown as { query: RecordingQuery }).query = recordingQuery;

    return runner;
  };
};

const takeCapturedQueries: () => Array<CapturedQuery> =
  (): Array<CapturedQuery> => {
    return capturedQueries.splice(0, capturedQueries.length);
  };

/*
 * The effective-enabled predicate exactly as Postgres must receive it. With a
 * table alias (SELECT builders) both columns read `"Alias"."column"`; UPDATE
 * and DELETE builders do not prefix, so both read a bare `"column"`. Beyond
 * the predicate, the whole statement must be free of unquoted qualifiers, and
 * the placeholder in it must be bound to the requested state.
 */
const expectEffectiveEnabledPredicate: (
  query: CapturedQuery,
  data: {
    alias: string;
    qualified: boolean;
    value: boolean;
  },
) => void = (
  query: CapturedQuery,
  data: {
    alias: string;
    qualified: boolean;
    value: boolean;
  },
): void => {
  const column: (name: string) => string = (name: string): string => {
    return data.qualified ? `"${data.alias}"."${name}"` : `"${name}"`;
  };
  const predicate: string = `(CASE WHEN ${column("criteria")} IS NULL THEN COALESCE(${column("isEnabled")}, false) ELSE ${column("isEnabled")} IS NULL END) = $`;

  expect(query.sql).toContain(predicate);
  expect(query.sql).not.toMatch(UNQUOTED_QUALIFIER);
  expect(query.sql).not.toMatch(unquotedReferenceTo(data.alias));

  const placeholder: RegExpExecArray | null = LEADING_PLACEHOLDER.exec(
    query.sql.slice(query.sql.indexOf(predicate) + predicate.length - 1),
  );

  expect(placeholder).not.toBeNull();
  expect(query.parameters[Number(placeholder![1]) - 1]).toBe(data.value);
};

const whereFor: (
  value: boolean,
) => FindOptionsWhere<RelationOnlyRuleBaseModel> = (
  value: boolean,
): FindOptionsWhere<RelationOnlyRuleBaseModel> => {
  return {
    projectId: ObjectID.generate().toString(),
    isEnabled: QueryHelper.booleanForCriteriaBackedRule("criteria", value),
  } as unknown as FindOptionsWhere<RelationOnlyRuleBaseModel>;
};

const manyToManyRelationNames: (metadata: EntityMetadata) => Array<string> = (
  metadata: EntityMetadata,
): Array<string> => {
  return metadata.manyToManyRelations.map(
    (relation: EntityMetadata["manyToManyRelations"][number]): string => {
      return relation.propertyName;
    },
  );
};

beforeAll(async () => {
  dataSource = new DataSource({
    type: "postgres",
    entities: Entities,
    synchronize: false,
  });
  /*
   * DataSource.initialize() would connect. buildMetadatas() is the part of it
   * that compiles the entity metadata the query builders need, and is enough
   * to render and "run" real SQL offline. Protected, hence the cast.
   */
  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
  installRecordingRunner();
});

afterAll(() => {
  if (dataSource && originalCreateQueryRunner) {
    dataSource.driver.createQueryRunner = originalCreateQueryRunner;
  }
});

beforeEach(() => {
  capturedQueries.length = 0;
  entityRows = [];
});

describe("QueryHelper.booleanForCriteriaBackedRule: the rendered Raw fragment", () => {
  test.each([
    ["IncidentReminderRule"],
    ["AlertReminderRule"],
    ["ScheduledMaintenanceReminderRule"],
  ])(
    "quotes the table qualifier of criteria for a SELECT alias path on %s (the #4030 shape)",
    (alias: string) => {
      const operator: RawOperator = asRaw(
        QueryHelper.booleanForCriteriaBackedRule("criteria", true),
      );
      const parameterName: string = soleParameterName(operator);
      const sql: string = operator.getSql(`${alias}.isEnabled`);

      /*
       * The isEnabled path stays exactly as TypeORM passed it, because TypeORM
       * quotes that token itself afterwards. Only the criteria reference,
       * which TypeORM does not recognise, has to arrive already quoted.
       */
      expect(sql).toBe(
        expectedFragment({
          criteria: `"${alias}"."criteria"`,
          isEnabled: `${alias}.isEnabled`,
          parameterName,
        }),
      );
      // The pre-fix `IncidentReminderRule."criteria"`, spelled out.
      expect(sql).not.toMatch(
        new RegExp(`(?<!")${escapeRegExp(alias)}\\."criteria"`),
      );
    },
  );

  test("uses a bare quoted column when the path has no qualifier (UPDATE and DELETE builders)", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.booleanForCriteriaBackedRule("criteria", false),
    );
    const parameterName: string = soleParameterName(operator);

    expect(operator.getSql("isEnabled")).toBe(
      expectedFragment({
        criteria: '"criteria"',
        isEnabled: "isEnabled",
        parameterName,
      }),
    );
    expect(operator.getSql("isEnabled")).not.toContain('."criteria"');
  });

  test.each([
    // A joined relation alias as SelectQueryBuilder names it.
    ["IncidentReminderRule__IncidentReminderRule_labels"],
    ["AlertReminderRule__AlertReminderRule_alertSeverities"],
    // DatabaseService.aggregateBy's de-duplicating subquery alias.
    ["IncidentReminderRule_aggregate_scope"],
    ["ScheduledMaintenanceReminderRule_aggregate_scope"],
    /*
     * TypeORM's hashed alias for a name over Postgres' 63 characters. It
     * starts with a digit, which would not even parse unquoted.
     */
    ["466ecbee0a1bc4f90a7bd5528e511bb1766a0db1"],
  ])(
    "quotes a long or generated alias %s as one identifier",
    (qualifier: string) => {
      const operator: RawOperator = asRaw(
        QueryHelper.booleanForCriteriaBackedRule("criteria", true),
      );
      const parameterName: string = soleParameterName(operator);

      expect(operator.getSql(`${qualifier}.isEnabled`)).toBe(
        expectedFragment({
          criteria: `"${qualifier}"."criteria"`,
          isEnabled: `${qualifier}.isEnabled`,
          parameterName,
        }),
      );
    },
  );

  test("does not quote a qualifier that already arrives quoted", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.booleanForCriteriaBackedRule("criteria", true),
    );
    const parameterName: string = soleParameterName(operator);
    const sql: string = operator.getSql('"IncidentReminderRule"."isEnabled"');

    expect(sql).toBe(
      expectedFragment({
        criteria: '"IncidentReminderRule"."criteria"',
        isEnabled: '"IncidentReminderRule"."isEnabled"',
        parameterName,
      }),
    );
    expect(sql).not.toContain('""IncidentReminderRule""');
  });

  test.each([
    ['Odd"Alias', '"Odd""Alias"'],
    ['a"b"c', '"a""b""c"'],
    // Opens with a quote but is not a quoted identifier: escaped, not kept.
    ['"Half', '"""Half"'],
    // A lone quote is not a quoted identifier either.
    ['"', '""""'],
  ])(
    "escapes a double quote inside the qualifier %s by doubling it",
    (qualifier: string, quotedQualifier: string) => {
      const operator: RawOperator = asRaw(
        QueryHelper.booleanForCriteriaBackedRule("criteria", true),
      );
      const parameterName: string = soleParameterName(operator);

      expect(operator.getSql(`${qualifier}.isEnabled`)).toBe(
        expectedFragment({
          criteria: `${quotedQualifier}."criteria"`,
          isEnabled: `${qualifier}.isEnabled`,
          parameterName,
        }),
      );
    },
  );

  test("qualifies a custom criteria column name the same way", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.booleanForCriteriaBackedRule("ruleCriteria_2", true),
    );
    const parameterName: string = soleParameterName(operator);

    expect(operator.getSql("AlertReminderRule.isEnabled")).toBe(
      expectedFragment({
        criteria: '"AlertReminderRule"."ruleCriteria_2"',
        isEnabled: "AlertReminderRule.isEnabled",
        parameterName,
      }),
    );
  });

  test("renders correctly for each alias it is given, because one operator is reused across builders", () => {
    /*
     * hardDeleteBy passes the same query object to a SELECT (alias-prefixed)
     * and then to repository.delete() (no prefix), so one Raw renders under
     * both alias shapes.
     */
    const operator: RawOperator = asRaw(
      QueryHelper.booleanForCriteriaBackedRule("criteria", false),
    );
    const parameterName: string = soleParameterName(operator);

    expect(operator.getSql("IncidentReminderRule.isEnabled")).toBe(
      expectedFragment({
        criteria: '"IncidentReminderRule"."criteria"',
        isEnabled: "IncidentReminderRule.isEnabled",
        parameterName,
      }),
    );
    expect(operator.getSql("isEnabled")).toBe(
      expectedFragment({
        criteria: '"criteria"',
        isEnabled: "isEnabled",
        parameterName,
      }),
    );
    expect(
      operator.getSql("IncidentReminderRule_aggregate_scope.isEnabled"),
    ).toContain('"IncidentReminderRule_aggregate_scope"."criteria"');
  });

  test.each([true, false])(
    "binds the requested state %p as its only parameter, never inlined",
    (value: boolean) => {
      const operator: RawOperator = asRaw(
        QueryHelper.booleanForCriteriaBackedRule("criteria", value),
      );

      expect(operator).toBeInstanceOf(FindOperator);
      expect(operator.type).toBe("raw");

      const parameterName: string = soleParameterName(operator);

      expect(parameterName).toMatch(/^[A-Za-z]{10}$/);
      expect(operator.objectLiteralParameters[parameterName]).toBe(value);
      expect(operator.getSql("IncidentReminderRule.isEnabled")).toMatch(
        new RegExp(`\\) = :${parameterName}\\)$`),
      );
    },
  );

  test("mints a distinct parameter name per call, so two filters can share a statement", () => {
    const names: Set<string> = new Set<string>();

    for (let index: number = 0; index < 25; index++) {
      names.add(
        soleParameterName(
          asRaw(
            QueryHelper.booleanForCriteriaBackedRule(
              "criteria",
              index % 2 === 0,
            ),
          ),
        ),
      );
    }

    expect(names.size).toBe(25);
  });

  test.each([
    ['criteria" IS NULL OR TRUE --'],
    ['"criteria"'],
    ["1criteria"],
    ["crit eria"],
    ["schema.criteria"],
    [""],
  ])(
    "rejects the criteria column name %p because it is not a plain identifier",
    (criteriaColumnName: string) => {
      expect(() => {
        QueryHelper.booleanForCriteriaBackedRule(criteriaColumnName, true);
      }).toThrow("Criteria column name must be a plain identifier.");
    },
  );
});

describe("SQL TypeORM generates for relation-only rules (metadata only, no connection)", () => {
  test("the relation-only rule models are exactly the three reminder rules", () => {
    /*
     * If a fourth model starts extending RelationOnlyRuleBaseModel it is
     * already covered by every per-model test below; this makes sure the
     * change is noticed and this list is updated on purpose.
     */
    expect(
      RULE_MODELS.map((modelType: RuleModelType): string => {
        return modelType.name;
      }).sort(),
    ).toEqual([
      "AlertReminderRule",
      "IncidentReminderRule",
      "ScheduledMaintenanceReminderRule",
    ]);
  });

  describe.each(RULE_MODEL_CASES)(
    "%s",
    (_name: string, modelType: RuleModelType) => {
      let repository: Repository<RelationOnlyRuleBaseModel>;
      let metadata: EntityMetadata;
      let alias: string;

      beforeAll(() => {
        repository = dataSource.getRepository(modelType);
        metadata = repository.metadata;
        // Repository.find() aliases the main table by the entity name.
        alias = metadata.name;
      });

      test("stores criteria and isEnabled in physical columns of exactly those names", () => {
        /*
         * DatabaseService passes the PROPERTY name "criteria" and the Raw
         * writes it into SQL as a COLUMN name, so the two must not diverge.
         */
        const criteria: ColumnMetadata | undefined =
          metadata.findColumnWithPropertyName("criteria");
        const isEnabled: ColumnMetadata | undefined =
          metadata.findColumnWithPropertyName("isEnabled");

        expect(criteria?.databaseName).toBe("criteria");
        expect(isEnabled?.databaseName).toBe("isEnabled");
        // The rollout encoding stores "enabled, criteria-backed" as NULL.
        expect(isEnabled?.isNullable).toBe(true);
        expect(alias).toBe(modelType.name);
      });

      test.each([true, false])(
        "find: the WHERE qualifies criteria with the quoted main alias (isEnabled = %p)",
        async (value: boolean) => {
          await repository.find({
            where: whereFor(value),
            order: { _id: "ASC" },
          });

          const queries: Array<CapturedQuery> = takeCapturedQueries();

          expect(queries).toHaveLength(1);
          expectEffectiveEnabledPredicate(queries[0]!, {
            alias,
            qualified: true,
            value,
          });
        },
      );

      test("findOne: LIMIT 1 does not change the predicate", async () => {
        await repository.findOne({ where: whereFor(true) });

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(1);
        expect(queries[0]!.sql).toContain("LIMIT 1");
        expectEffectiveEnabledPredicate(queries[0]!, {
          alias,
          qualified: true,
          value: true,
        });
      });

      test("count: the COUNT statement carries the same quoted predicate", async () => {
        await repository.count({ where: whereFor(false), skip: 0, take: 10 });

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(1);
        expect(queries[0]!.sql).toMatch(/^SELECT COUNT\(/);
        expectEffectiveEnabledPredicate(queries[0]!, {
          alias,
          qualified: true,
          value: false,
        });
      });

      test("find with every many-to-many relation and take/skip: both paging statements are quoted", async () => {
        /*
         * findMatchingRule selects the rule's labels (and severities) with a
         * limit, which sends TypeORM down its two-statement distinct paging
         * path. The predicate appears in both statements.
         */
        const relations: Array<string> = manyToManyRelationNames(metadata);

        expect(relations).toContain("labels");

        const select: Record<string, unknown> = { _id: true, name: true };

        for (const relation of relations) {
          select[relation] = { _id: true };
        }

        await repository.find({
          where: whereFor(true),
          select: select as FindOptionsSelect<RelationOnlyRuleBaseModel>,
          relations: relations,
          order: { _id: "ASC" },
          take: 500,
          skip: 0,
        });

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(2);
        expect(queries[0]!.sql).toMatch(/^SELECT DISTINCT "distinctAlias"\./);

        for (const query of queries) {
          expect(query.sql).toContain("LEFT JOIN");
          expectEffectiveEnabledPredicate(query, {
            alias,
            qualified: true,
            value: true,
          });
        }
      });

      test("a derived alias (aggregateBy's scope subquery) is quoted as a whole", () => {
        const scopeAlias: string = `${alias}_aggregate_scope`;
        const [sql, parameters]: [string, Array<unknown>] = repository
          .createQueryBuilder(scopeAlias)
          .setFindOptions({ where: whereFor(true) })
          .getQueryAndParameters();

        expectEffectiveEnabledPredicate(
          { sql, parameters },
          { alias: scopeAlias, qualified: true, value: true },
        );
      });

      test("update: the UpdateQueryBuilder reads the bare criteria column", async () => {
        await repository.update(whereFor(false), {
          name: "Renamed",
        } as unknown as Parameters<
          Repository<RelationOnlyRuleBaseModel>["update"]
        >[1]);

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(1);
        expect(queries[0]!.sql).toMatch(/^UPDATE "/);
        expectEffectiveEnabledPredicate(queries[0]!, {
          alias,
          qualified: false,
          value: false,
        });
      });

      test("delete: the DeleteQueryBuilder reads the bare criteria column", async () => {
        await repository.delete(whereFor(true));

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(1);
        expect(queries[0]!.sql).toMatch(/^DELETE FROM "/);
        expectEffectiveEnabledPredicate(queries[0]!, {
          alias,
          qualified: false,
          value: true,
        });
      });
    },
  );
});

describe("DatabaseService translates a boolean isEnabled on relation-only rules", () => {
  describe.each(RULE_MODEL_CASES)(
    "%s",
    (_name: string, modelType: RuleModelType) => {
      let service: DatabaseService<RelationOnlyRuleBaseModel>;
      let alias: string;

      beforeEach(() => {
        service = new DatabaseService<RelationOnlyRuleBaseModel>(modelType);
        jest
          .spyOn(service, "getRepository")
          .mockReturnValue(dataSource.getRepository(modelType));
        alias = dataSource.getMetadata(modelType).name;
      });

      afterEach(() => {
        jest.restoreAllMocks();
      });

      const queryFor: (
        data: Record<string, unknown>,
      ) => Query<RelationOnlyRuleBaseModel> = (
        data: Record<string, unknown>,
      ): Query<RelationOnlyRuleBaseModel> => {
        return data as Query<RelationOnlyRuleBaseModel>;
      };

      test("findBy with the findMatchingRule shape (relations, limit) sends only quoted SQL", async () => {
        const select: Record<string, unknown> = {
          _id: true,
          name: true,
          criteria: true,
          labels: { _id: true },
        };

        const rules: Array<RelationOnlyRuleBaseModel> = await service.findBy({
          query: queryFor({ projectId: ObjectID.generate(), isEnabled: true }),
          select: select as Select<RelationOnlyRuleBaseModel>,
          limit: 500,
          skip: 0,
          props: { isRoot: true },
        });

        expect(rules).toEqual([]);

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(2);

        for (const query of queries) {
          expectEffectiveEnabledPredicate(query, {
            alias,
            qualified: true,
            value: true,
          });
        }
      });

      test("findOneBy for disabled rules", async () => {
        await service.findOneBy({
          query: queryFor({ isEnabled: false }),
          select: { _id: true },
          props: { isRoot: true },
        });

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(1);
        expectEffectiveEnabledPredicate(queries[0]!, {
          alias,
          qualified: true,
          value: false,
        });
      });

      test("countBy", async () => {
        const count: { toNumber: () => number } = await service.countBy({
          query: queryFor({ projectId: ObjectID.generate(), isEnabled: true }),
          props: { isRoot: true },
        });

        expect(count.toNumber()).toBe(0);

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(1);
        expectEffectiveEnabledPredicate(queries[0]!, {
          alias,
          qualified: true,
          value: true,
        });
      });

      test("aggregateBy, flat and through the de-duplicating relation scope", async () => {
        await service.aggregateBy({
          query: queryFor({ isEnabled: true }),
          select: [{ expression: "COUNT(*)", alias: "total" }],
          props: { isRoot: true },
        });
        await service.aggregateBy({
          query: queryFor({ isEnabled: false, labels: [ObjectID.generate()] }),
          select: [{ expression: "COUNT(*)", alias: "total" }],
          props: { isRoot: true },
        });

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(2);
        expectEffectiveEnabledPredicate(queries[0]!, {
          alias,
          qualified: true,
          value: true,
        });
        expectEffectiveEnabledPredicate(queries[1]!, {
          alias: `${alias}_aggregate_scope`,
          qualified: true,
          value: false,
        });
      });

      test("updateBy locates rows with the quoted predicate", async () => {
        await service.updateBy({
          query: queryFor({ isEnabled: true }),
          data: { name: "Renamed" } as unknown as Parameters<
            DatabaseService<RelationOnlyRuleBaseModel>["updateBy"]
          >[0]["data"],
          limit: 10,
          skip: 0,
          props: { isRoot: true },
        });

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(1);
        expectEffectiveEnabledPredicate(queries[0]!, {
          alias,
          qualified: true,
          value: true,
        });
      });

      test("deleteBy locates rows with the quoted predicate", async () => {
        await service.deleteBy({
          query: queryFor({ isEnabled: false }),
          limit: 10,
          skip: 0,
          props: { isRoot: true },
        });

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(1);
        expectEffectiveEnabledPredicate(queries[0]!, {
          alias,
          qualified: true,
          value: false,
        });
      });

      test("hardDeleteBy renders the same operator for its SELECT and its DELETE", async () => {
        const ruleId: string = ObjectID.generate().toString();
        entityRows = [{ [`${alias}__id`]: ruleId }];

        await service.hardDeleteBy({
          query: queryFor({ isEnabled: false }),
          limit: 10,
          skip: 0,
          props: { isRoot: true },
        });

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(2);
        expect(queries[0]!.sql).toMatch(/^SELECT /);
        expectEffectiveEnabledPredicate(queries[0]!, {
          alias,
          qualified: true,
          value: false,
        });
        expect(queries[1]!.sql).toMatch(/^DELETE FROM "/);
        expect(queries[1]!.parameters).toContain(ruleId);
        expectEffectiveEnabledPredicate(queries[1]!, {
          alias,
          qualified: false,
          value: false,
        });
      });
    },
  );
});

describe("findMatchingRule on the reminder rule services (the call in the #4030 log)", () => {
  interface ReminderRuleServiceCase {
    modelType: RuleModelType;
    service: { getRepository: () => unknown };
    findMatchingRule: () => Promise<RelationOnlyRuleBaseModel | null>;
  }

  const serviceCases: Array<[string, ReminderRuleServiceCase]> = [
    [
      "IncidentReminderRule",
      {
        modelType: IncidentReminderRule,
        service: IncidentReminderRuleService,
        findMatchingRule: (): Promise<IncidentReminderRule | null> => {
          return IncidentReminderRuleService.findMatchingRule({
            projectId: ObjectID.generate(),
            incidentSeverityId: ObjectID.generate(),
            labelIds: [ObjectID.generate()],
          });
        },
      },
    ],
    [
      "AlertReminderRule",
      {
        modelType: AlertReminderRule,
        service: AlertReminderRuleService,
        findMatchingRule: (): Promise<AlertReminderRule | null> => {
          return AlertReminderRuleService.findMatchingRule({
            projectId: ObjectID.generate(),
            alertSeverityId: ObjectID.generate(),
            labelIds: [ObjectID.generate()],
          });
        },
      },
    ],
    [
      "ScheduledMaintenanceReminderRule",
      {
        modelType: ScheduledMaintenanceReminderRule,
        service: ScheduledMaintenanceReminderRuleService,
        findMatchingRule:
          (): Promise<ScheduledMaintenanceReminderRule | null> => {
            return ScheduledMaintenanceReminderRuleService.findMatchingRule({
              projectId: ObjectID.generate(),
              labelIds: [ObjectID.generate()],
            });
          },
      },
    ],
  ];

  test("covers every relation-only rule model", () => {
    expect(
      serviceCases
        .map((serviceCase: [string, ReminderRuleServiceCase]): string => {
          return serviceCase[0];
        })
        .sort(),
    ).toEqual(
      RULE_MODELS.map((modelType: RuleModelType): string => {
        return modelType.name;
      }).sort(),
    );
  });

  describe.each(serviceCases)(
    "%s",
    (_name: string, serviceCase: ReminderRuleServiceCase) => {
      let alias: string;

      beforeEach(() => {
        jest
          .spyOn(serviceCase.service, "getRepository")
          .mockReturnValue(dataSource.getRepository(serviceCase.modelType));
        alias = dataSource.getMetadata(serviceCase.modelType).name;
      });

      afterEach(() => {
        jest.restoreAllMocks();
      });

      test("resolves to null, instead of failing, when the project has no rules", async () => {
        await expect(serviceCase.findMatchingRule()).resolves.toBeNull();

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(2);

        for (const query of queries) {
          expectEffectiveEnabledPredicate(query, {
            alias,
            qualified: true,
            value: true,
          });
        }
      });

      test("returns a configured legacy rule that matches everything", async () => {
        const ruleId: string = ObjectID.generate().toString();
        entityRows = [
          {
            [`${alias}__id`]: ruleId,
            [`${alias}_name`]: "Remind every 30 minutes",
            [`${alias}_criteria`]: null,
            [`${alias}_isEnabled`]: true,
          },
        ];

        const rule: RelationOnlyRuleBaseModel | null =
          await serviceCase.findMatchingRule();

        expect(rule).not.toBeNull();
        expect(rule!.id?.toString()).toBe(ruleId);
        expect(rule).toBeInstanceOf(serviceCase.modelType);

        const queries: Array<CapturedQuery> = takeCapturedQueries();

        expect(queries).toHaveLength(2);
        expect(queries[1]!.parameters).toContain(ruleId);

        for (const query of queries) {
          expectEffectiveEnabledPredicate(query, {
            alias,
            qualified: true,
            value: true,
          });
        }
      });
    },
  );
});
