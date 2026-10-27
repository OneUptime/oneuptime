import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Text from "../../../Types/Text";
import Typeof from "../../../Types/Typeof";
import { FindOperator, Raw } from "typeorm";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import { toLikePattern } from "../../../Types/BaseDatabase/WildcardPattern";
import CaptureSpan from "../../Utils/Telemetry/CaptureSpan";
import { OwnedByMatch } from "../../../Types/BaseDatabase/OwnedBy";
import buildJSONColumnQuery, {
  JSONColumnQuery,
  escapeLikePattern,
} from "./JSONColumnQuery";

export type { FindOperator };

/*
 * One of the two tables a kind's owners are kept in (MonitorOwnerUser,
 * MonitorOwnerTeam): its name, its column naming the record owned
 * (monitorId) and its column naming the owner (userId or teamId).
 */
export interface OwnerTableColumns {
  tableName: string;
  resourceColumnName: string;
  ownerColumnName: string;
}

/*
 * What the grant conditions on a record's id read: the related entity ids,
 * the record's keys naming other records (each with the join tables that
 * link those records to the ids), and the parents it belongs to through a
 * join table.
 */
export interface LinkedToAnyData {
  values: Array<string | ObjectID>;
  keys: Array<{
    columnName: string;
    joinTables: Array<{
      joinTableName: string;
      ownerColumnName: string;
      relationColumnName: string;
    }>;
  }>;
  parents: Array<{
    // The record -> parent join table.
    parentJoinTableName: string;
    parentOwnerColumnName: string;
    parentRelationColumnName: string;
    // The parent -> related entity join table.
    joinTableName: string;
    ownerColumnName: string;
    relationColumnName: string;
  }>;
}

export default class QueryHelper {
  /** Read a boolean whose criteria-backed `true` state is encoded as null. */
  @CaptureSpan()
  public static booleanForCriteriaBackedRule(
    criteriaColumnName: string,
    value: boolean,
  ): FindWhereProperty<any> {
    if (criteriaColumnName.match(/^[A-Za-z_][A-Za-z0-9_]*$/) === null) {
      throw new Error("Criteria column name must be a plain identifier.");
    }

    const rid: string = Text.generateRandomText(10);

    return Raw(
      (alias: string) => {
        /*
         * SELECT builders hand Raw the unescaped `Alias.property` path and
         * quote it afterwards, but only where the whole token is `Alias.<known
         * property>`. `Alias."criteria"` is not such a token, so an unquoted
         * qualifier reached Postgres as-is and folded to lowercase, which
         * names no table in FROM ("missing FROM-clause entry for table
         * "incidentreminderrule""). Quote the qualifier here instead.
         *
         * UPDATE and DELETE builders hand Raw the bare property name, with no
         * alias, and there criteria stays a bare quoted column.
         */
        const separatorIndex: number = alias.lastIndexOf(".");
        const qualifier: string =
          separatorIndex >= 0
            ? `${QueryHelper.quoteIdentifier(alias.slice(0, separatorIndex))}.`
            : "";
        const criteriaAlias: string = `${qualifier}"${criteriaColumnName}"`;

        return `((CASE WHEN ${criteriaAlias} IS NULL THEN COALESCE(${alias}, false) ELSE ${alias} IS NULL END) = :${rid})`;
      },
      {
        [rid]: value,
      },
    );
  }

  /*
   * A Postgres quoted identifier. TypeORM 0.3 always hands Raw an unescaped
   * alias; one that is already quoted is kept as is, defensively.
   */
  private static quoteIdentifier(identifier: string): string {
    if (
      identifier.length >= 2 &&
      identifier.startsWith('"') &&
      identifier.endsWith('"')
    ) {
      return identifier;
    }

    return `"${identifier.replace(/"/g, '""')}"`;
  }

  @CaptureSpan()
  public static modulo(
    moduloBy: number,
    reminder: number,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    const rid2: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} % :${rid} = :${rid2})`;
      },
      {
        [rid]: moduloBy,
        [rid2]: reminder,
      },
    );
  }

  @CaptureSpan()
  public static findWithSameText(
    text: string | number,
  ): FindWhereProperty<any> {
    let isString: boolean = false;

    if (typeof text === Typeof.String) {
      text = (text as string).toLowerCase().trim();
      isString = true;
    }
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return isString
          ? `(LOWER(${alias}) = :${rid})`
          : `(${alias} = :${rid})`;
      },
      {
        [rid]: `${text}`,
      },
    );
  }

  /*
   * Case-insensitive `IN (...)` — the multi-value twin of
   * findWithSameText. Used where a user-typed identifier has to match an
   * ingest-stamped name that may differ only by case (monitor step
   * configs vs. the resource rows discovered from telemetry), and where
   * issuing one findOneBy per identifier would cost a round-trip each.
   *
   * An empty list would compile to `IN ()`, which is a syntax error, so
   * callers must not pass one; they have nothing to look up anyway.
   */
  @CaptureSpan()
  public static findWithSameTextAnyOf(
    texts: Array<string>,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);

    const normalizedTexts: Array<string> = texts.map((text: string): string => {
      return text.toLowerCase().trim();
    });

    return Raw(
      (alias: string) => {
        return `(LOWER(${alias}) IN (:...${rid}))`;
      },
      {
        [rid]: normalizedTexts,
      },
    );
  }

  /*
   * Case-insensitive "starts with any of these" - the prefix twin of
   * findWithSameTextAnyOf: the hosts whose name is one of these bare names
   * and a domain (web-1 for web-1.acme.internal). Each prefix is bound as a
   * parameter with LIKE's own characters escaped, so a prefix holding "_" or
   * "%" matches only itself. Callers must not pass an empty list.
   */
  @CaptureSpan()
  public static startsWithAnyOf(
    prefixes: Array<string>,
  ): FindWhereProperty<any> {
    const parameters: Dictionary<string> = {};
    const names: Array<string> = [];

    for (const prefix of prefixes) {
      const rid: string = Text.generateRandomText(10);
      parameters[rid] = `${escapeLikePattern(prefix.toLowerCase().trim())}%`;
      names.push(rid);
    }

    return Raw((alias: string) => {
      return `(${names
        .map((rid: string): string => {
          return `LOWER(${alias}) LIKE :${rid}`;
        })
        .join(" OR ")})`;
    }, parameters);
  }

  /*
   * A jsonb array of objects holding an object whose `key` is one of these
   * texts, compared without case: the security cases whose entities name
   * "web-1", however an event spelled it ("WEB-1"). The key and the texts
   * are bound parameters; anything that is not an array of objects matches
   * nothing rather than aborting the query. Callers must not pass an empty
   * list.
   */
  @CaptureSpan()
  public static jsonArrayObjectsHaveTextAnyOf(data: {
    key: string;
    texts: Array<string>;
  }): FindWhereProperty<any> {
    const keyParameter: string = Text.generateRandomText(10);
    const textsParameter: string = Text.generateRandomText(10);

    return Raw(
      (alias: string): string => {
        return `(EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${alias}) = 'array' THEN ${alias} ELSE '[]'::jsonb END) AS json_array_item(item) WHERE jsonb_typeof(json_array_item.item) = 'object' AND LOWER(json_array_item.item ->> :${keyParameter}) = ANY(CAST(:${textsParameter} AS text[]))))`;
      },
      {
        [keyParameter]: data.key,
        [textsParameter]: data.texts.map((text: string): string => {
          return text.toLowerCase().trim();
        }),
      },
    );
  }

  @CaptureSpan()
  public static isNull(): any {
    return Raw((alias: string) => {
      return `(${alias} IS NULL)`;
    });
  }

  @CaptureSpan()
  public static notNull(): any {
    return Raw((alias: string) => {
      return `(${alias} IS NOT NULL)`;
    });
  }

  @CaptureSpan()
  public static equalToOrNull(
    value: string | ObjectID | Array<string | ObjectID>,
  ): FindWhereProperty<any> {
    const rid: Array<string> = [];
    const valuesObj: Dictionary<string> = {};

    if (Array.isArray(value)) {
      for (const item of value) {
        const temp: string = Text.generateRandomText(10);
        rid.push(temp);
        valuesObj[temp] = item.toString();
      }
    } else {
      const temp: string = Text.generateRandomText(10);
      rid.push(temp);
      valuesObj[temp] = value.toString();
    }

    // construct string

    type ConstructQueryFunction = (alias: string) => string;

    const constructQuery: ConstructQueryFunction = (alias: string): string => {
      let query: string = "(";

      query += rid
        .map((item: string) => {
          return `${alias} = :${item}`;
        })
        .join(" or ");

      query += ` or ${alias} IS NULL)`;

      return query;
    };

    return Raw(
      (alias: string) => {
        return constructQuery(alias);
      },
      {
        ...valuesObj,
      },
    );
  }

  @CaptureSpan()
  public static notEquals(value: string | ObjectID): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} != :${rid})`;
      },
      {
        [rid]: value.toString(),
      },
    );
  }

  @CaptureSpan()
  public static search(name: string): FindWhereProperty<any> {
    name = name.toLowerCase().trim();
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `((CAST(${alias} AS TEXT) ILIKE :${rid}))`;
      },
      {
        [rid]: `%${name}%`,
      },
    );
  }

  /*
   * Every word has to appear somewhere in the column, in any order.
   *
   * `search` is one substring, so "michigan 104822" misses a row called
   * "Unit 104822 - Michigan Ave" even though both words are in it. Here each
   * word gets its own ILIKE, AND-joined, which is how people recall a name
   * they half remember.
   *
   * A word is matched literally: a `%` or `_` somebody typed is escaped
   * rather than read as a wildcard.
   *
   * No words matches NOTHING. An AND over zero predicates is vacuously true,
   * and "every row in the table" is never what an empty search box meant.
   */
  @CaptureSpan()
  public static searchAllWords(words: Array<string>): FindWhereProperty<any> {
    const rids: Array<string> = [];
    const valuesObj: Dictionary<string> = {};

    for (const word of words) {
      const trimmed: string = (word || "").trim();
      if (!trimmed) {
        continue;
      }
      const rid: string = Text.generateRandomText(10);
      rids.push(rid);
      valuesObj[rid] = `%${escapeLikePattern(trimmed)}%`;
    }

    if (rids.length === 0) {
      return Raw(() => {
        return `TRUE = FALSE`; // this will always return false
      }, {});
    }

    return Raw(
      (alias: string) => {
        const conditions: string = rids
          .map((rid: string) => {
            return `CAST(${alias} AS TEXT) ILIKE :${rid}`;
          })
          .join(" AND ");
        return `(${conditions})`;
      },
      {
        ...valuesObj,
      },
    );
  }

  /**
   * Searches the provided entity property names with a single OR-joined ILIKE.
   *
   * IMPORTANT: emit unquoted `alias.propertyName` references and let
   * TypeORM's `replacePropertyNamesForTheWholeQuery` post-processor escape
   * the table alias and translate property names → DB column names. Pre-
   * quoting (e.g. `Incident."title"`) bypasses that pass, which leaves an
   * unquoted `Incident` in the final SQL — Postgres then lowercases it and
   * fails with `missing FROM-clause entry for table "incident"`.
   */
  @CaptureSpan()
  public static multiSearch(
    entityPropertyNames: Array<string>,
    value: string,
  ): FindWhereProperty<any> {
    const trimmed: string = value.toLowerCase().trim();
    const rid: string = Text.generateRandomText(10);

    return Raw(
      (alias: string) => {
        const tableAlias: string = alias.includes(".")
          ? (alias.split(".")[0] as string)
          : alias;

        const orConditions: string = entityPropertyNames
          .map((field: string) => {
            return `(CAST(${tableAlias}.${field} AS TEXT) ILIKE :${rid})`;
          })
          .join(" OR ");

        return `(${orConditions})`;
      },
      {
        [rid]: `%${trimmed}%`,
      },
    );
  }

  @CaptureSpan()
  public static notContains(name: string): FindWhereProperty<any> {
    name = name.toLowerCase().trim();
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(CAST(${alias} AS TEXT) NOT ILIKE :${rid} OR ${alias} IS NULL)`;
      },
      {
        [rid]: `%${name}%`,
      },
    );
  }

  @CaptureSpan()
  public static startsWith(name: string): FindWhereProperty<any> {
    name = name.toLowerCase().trim();
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(CAST(${alias} AS TEXT) ILIKE :${rid})`;
      },
      {
        [rid]: `${name}%`,
      },
    );
  }

  @CaptureSpan()
  public static endsWith(name: string): FindWhereProperty<any> {
    name = name.toLowerCase().trim();
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(CAST(${alias} AS TEXT) ILIKE :${rid})`;
      },
      {
        [rid]: `%${name}`,
      },
    );
  }

  /*
   * Glob matching (`api-*`, `*.internal`). The pattern comes from
   * `toLikePattern`, which is also what the ClickHouse side uses, so a
   * wildcard filter means the same thing on a Postgres model and on a
   * telemetry model. Unlike the helpers above, the value is NOT lowercased
   * first: `ILIKE` is already case-insensitive, and lowercasing would corrupt
   * a `\A` escape into `\a`.
   */
  @CaptureSpan()
  public static wildcard(glob: string): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(CAST(${alias} AS TEXT) ILIKE :${rid})`;
      },
      {
        [rid]: toLikePattern(glob.trim()),
      },
    );
  }

  /*
   * The negation lets NULL through explicitly: a row with no value at all
   * trivially does not match a glob, but `NULL ILIKE ...` is NULL, which
   * would filter it out. Mirrors `notContains` above.
   */
  @CaptureSpan()
  public static notWildcard(glob: string): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(CAST(${alias} AS TEXT) NOT ILIKE :${rid} OR ${alias} IS NULL)`;
      },
      {
        [rid]: toLikePattern(glob.trim()),
      },
    );
  }

  @CaptureSpan()
  public static all(values: Array<string | ObjectID>): FindWhereProperty<any> {
    values = values.map((value: string | ObjectID) => {
      return value.toString();
    });
    const rid: string = Text.generateRandomText(10);

    if (!values || values.length === 0) {
      return Raw(() => {
        return `TRUE = FALSE`; // this will always return false
      }, {});
    }

    return Raw(
      (alias: string) => {
        return `(${alias} = ALL(:${rid}))`;
      },
      {
        [rid]: values,
      },
    );
  }

  @CaptureSpan()
  public static any(
    values: Array<string | ObjectID | number>,
  ): FindWhereProperty<any> {
    return this.in(values); // any and in are the same
  }

  /**
   * Returns a filter that matches owner rows that are linked to *none* of the
   * provided related entity ids through a many-to-many join table. The
   * returned FindOperator is intended to be applied to the primary id column
   * of the owner entity.
   */
  @CaptureSpan()
  public static noneEntitiesInManyToMany(data: {
    values: Array<string | ObjectID>;
    joinTableName: string;
    ownerColumnName: string;
    relationColumnName: string;
  }): FindWhereProperty<any> {
    const values: Array<string> = data.values.map(
      (value: string | ObjectID) => {
        return value.toString();
      },
    );

    if (!values || values.length === 0) {
      return Raw(() => {
        return `TRUE = TRUE`;
      }, {});
    }

    const valuesRid: string = Text.generateRandomText(10);

    const joinTable: string = data.joinTableName.replace(/"/g, '""');
    const ownerCol: string = data.ownerColumnName.replace(/"/g, '""');
    const relationCol: string = data.relationColumnName.replace(/"/g, '""');

    return Raw(
      (alias: string) => {
        return `(${alias} NOT IN (SELECT "${joinTable}"."${ownerCol}" FROM "${joinTable}" WHERE "${joinTable}"."${relationCol}" IN (:...${valuesRid})))`;
      },
      {
        [valuesRid]: values,
      },
    );
  }

  /**
   * Applied to a record's foreign key to the record it belongs to (a note's
   * incidentId): matches records whose parent is linked to *none* of the
   * provided related entity ids through the parent's many-to-many join table
   * (the incident's labels), and records that belong to no parent at all.
   * An empty values array matches everything.
   */
  @CaptureSpan()
  public static parentLinkedToNoneInManyToMany(data: {
    values: Array<string | ObjectID>;
    joinTableName: string;
    ownerColumnName: string;
    relationColumnName: string;
  }): FindWhereProperty<any> {
    // One parent model: the same condition over a single join table.
    return QueryHelper.linkedToNoneInAnyManyToMany({
      values: data.values,
      joinTables: [
        {
          joinTableName: data.joinTableName,
          ownerColumnName: data.ownerColumnName,
          relationColumnName: data.relationColumnName,
        },
      ],
    });
  }

  /**
   * parentLinkedToNoneInManyToMany for a key that can name a record of any
   * of several models (an inventory item's resource id): matches records
   * whose key names no record linked, in any of the given join tables, to
   * one of the provided related entity ids (labels), and records whose key
   * is empty. One subquery over every join table. An empty values or join
   * table list matches everything.
   */
  @CaptureSpan()
  public static linkedToNoneInAnyManyToMany(data: {
    values: Array<string | ObjectID>;
    joinTables: Array<{
      joinTableName: string;
      ownerColumnName: string;
      relationColumnName: string;
    }>;
  }): FindWhereProperty<any> {
    const values: Array<string> = data.values.map(
      (value: string | ObjectID) => {
        return value.toString();
      },
    );

    if (values.length === 0 || data.joinTables.length === 0) {
      return Raw(() => {
        return `TRUE = TRUE`;
      }, {});
    }

    const valuesRid: string = Text.generateRandomText(10);

    const linkedRecords: string = QueryHelper.getRecordsLinkedToAnySql(
      data.joinTables,
      valuesRid,
    );

    return Raw(
      (alias: string) => {
        return `(${alias} IS NULL OR ${alias} NOT IN (${linkedRecords}))`;
      },
      {
        [valuesRid]: values,
      },
    );
  }

  /**
   * A grant's condition on a record that carries no labels of its own, but
   * those of the records it names: applied to the record's primary id,
   * matches the records that name none of them at all - every one of `keys`
   * empty and no parent - and the records of which one key names, or one
   * parent is, a record linked to one of the provided related entity ids
   * (labels).
   *
   * `keys` are other columns of the same row, each naming a record of one
   * of several models (a note's incidentId, an inventory item's resource
   * id); `parents` are the records the row belongs to through a join table
   * (an announcement's status pages). They are written beside the id the
   * condition is applied to, as the id itself is written. An empty values
   * array matches only the records that name nothing (fail closed).
   */
  @CaptureSpan()
  public static namesNothingOrOneLinkedToAny(
    data: LinkedToAnyData,
  ): FindWhereProperty<any> {
    return QueryHelper.linkedToAny(data, true);
  }

  /**
   * namesNothingOrOneLinkedToAny without the records that name nothing:
   * applied to a record's primary id, matches only the records of which one
   * key names, or one parent is, a record linked to one of the provided
   * related entity ids (a note whose incident carries one of the labels).
   * A record with every key empty and no parent, a key or parent whose
   * model has no join table, and an empty values array match nothing (fail
   * closed).
   */
  @CaptureSpan()
  public static oneLinkedToAny(data: LinkedToAnyData): FindWhereProperty<any> {
    return QueryHelper.linkedToAny(data, false);
  }

  // The two operators above; `keepNamingNothing` adds the records that name nothing.
  private static linkedToAny(
    data: LinkedToAnyData,
    keepNamingNothing: boolean,
  ): FindWhereProperty<any> {
    const values: Array<string> = data.values.map(
      (value: string | ObjectID) => {
        return value.toString();
      },
    );

    const valuesRid: string = Text.generateRandomText(10);
    const quote: (identifier: string) => string = QueryHelper.escapeIdentifier;

    return Raw(
      (alias: string) => {
        const namesNothing: Array<string> = [];
        const linkedToValue: Array<string> = [];

        for (const key of data.keys) {
          const column: string = QueryHelper.getColumnBeside(
            alias,
            key.columnName,
          );

          namesNothing.push(`${column} IS NULL`);

          if (values.length > 0 && key.joinTables.length > 0) {
            linkedToValue.push(
              `${column} IN (${QueryHelper.getRecordsLinkedToAnySql(
                key.joinTables,
                valuesRid,
              )})`,
            );
          }
        }

        for (const parent of data.parents) {
          const parentJoinTable: string = quote(parent.parentJoinTableName);
          const parentOwnerCol: string = quote(parent.parentOwnerColumnName);
          const parentRelationCol: string = quote(
            parent.parentRelationColumnName,
          );
          const belongsToParent: string = `SELECT 1 FROM "${parentJoinTable}" WHERE "${parentJoinTable}"."${parentOwnerCol}" = ${alias}`;

          namesNothing.push(`NOT EXISTS (${belongsToParent})`);

          if (values.length > 0) {
            const joinTable: string = quote(parent.joinTableName);
            const ownerCol: string = quote(parent.ownerColumnName);
            const relationCol: string = quote(parent.relationColumnName);

            linkedToValue.push(
              `EXISTS (${belongsToParent} AND "${parentJoinTable}"."${parentRelationCol}" IN (SELECT "${joinTable}"."${ownerCol}" FROM "${joinTable}" WHERE "${joinTable}"."${relationCol}" IN (:...${valuesRid})))`,
            );
          }
        }

        const conditions: Array<string> = [
          ...(keepNamingNothing
            ? [
                namesNothing.length > 0
                  ? `(${namesNothing.join(" AND ")})`
                  : "TRUE",
              ]
            : []),
          ...linkedToValue,
        ];

        return conditions.length > 0
          ? `(${conditions.join(" OR ")})`
          : "(FALSE)";
      },
      values.length > 0 ? { [valuesRid]: values } : {},
    );
  }

  /**
   * Several conditions on a record, of which it meets at least one: applied
   * to the record's primary id, each condition is written on the id itself
   * or, with `columnName`, on another column of the same row (a note's
   * incidentId), as the grant conditions above write the keys beside the id.
   * For grants that each reach some records - the ones carrying a grant's
   * labels, the ones a grant's holder owns - whose records together are what
   * the caller reaches. Each condition is one this class builds (a Raw); an
   * empty list matches nothing (fail closed).
   */
  @CaptureSpan()
  public static anyOfConditions(
    conditions: Array<{
      columnName?: string | undefined;
      condition: FindWhereProperty<any>;
    }>,
  ): FindWhereProperty<any> {
    const parameters: Dictionary<unknown> = {};
    const writers: Array<(alias: string) => string> = [];

    for (const each of conditions) {
      const getSql: (alias: string) => string = QueryHelper.getRawSql(
        each.condition,
      );

      Object.assign(
        parameters,
        (each.condition as unknown as FindOperator<unknown>)
          .objectLiteralParameters || {},
      );

      writers.push((alias: string): string => {
        return getSql(
          each.columnName
            ? QueryHelper.getColumnBeside(alias, each.columnName)
            : alias,
        );
      });
    }

    return Raw((alias: string) => {
      return writers.length > 0
        ? `(${writers
            .map((writer: (alias: string) => string): string => {
              return writer(alias);
            })
            .join(" OR ")})`
        : "(FALSE)";
    }, parameters);
  }

  /**
   * Applied to a key naming a record of `tableName` (a security case note's
   * securityCaseId), matches the keys that name a record meeting
   * `condition` - one this class builds, written on that record's id, whose
   * other columns it reads beside the id - or, with no condition, any record
   * of the table. For the records a model is read through that are kept by
   * their own table's rule. An empty key matches nothing.
   */
  @CaptureSpan()
  public static inRecordsWhere(data: {
    tableName: string;
    condition?: FindWhereProperty<any> | undefined;
  }): FindWhereProperty<any> {
    const table: string = QueryHelper.escapeIdentifier(data.tableName);
    // The record's own alias, so its columns are never read as the outer row's.
    const recordAlias: string = `record${Text.generateRandomText(10)}`;
    const getSql: ((alias: string) => string) | null = data.condition
      ? QueryHelper.getRawSql(data.condition)
      : null;

    return Raw(
      (alias: string) => {
        const kept: string = getSql
          ? ` WHERE ${getSql(`"${recordAlias}"."_id"`)}`
          : "";

        return `(${alias} IN (SELECT "${recordAlias}"."_id" FROM "${table}" "${recordAlias}"${kept}))`;
      },
      data.condition
        ? (data.condition as unknown as FindOperator<unknown>)
            .objectLiteralParameters || {}
        : {},
    );
  }

  /*
   * The SQL a condition this class builds writes for a column (a Raw's
   * generator). Any other condition cannot be written inside another one,
   * and is refused rather than dropped.
   */
  private static getRawSql(
    condition: FindWhereProperty<any>,
  ): (alias: string) => string {
    const operator: FindOperator<unknown> =
      condition as unknown as FindOperator<unknown>;
    const getSql: unknown =
      operator instanceof FindOperator && operator.type === "raw"
        ? operator.getSql
        : undefined;

    if (typeof getSql !== "function") {
      throw new BadDataException(
        "Only a condition QueryHelper writes as SQL can be held with others.",
      );
    }

    return getSql as (alias: string) => string;
  }

  // An identifier's characters as they are written between double quotes.
  private static escapeIdentifier(identifier: string): string {
    return identifier.replace(/"/g, '""');
  }

  /*
   * The ids of the records linked, in any of `joinTables`, to one of the
   * values bound as `valuesRid`: one subquery over every join table.
   */
  private static getRecordsLinkedToAnySql(
    joinTables: Array<{
      joinTableName: string;
      ownerColumnName: string;
      relationColumnName: string;
    }>,
    valuesRid: string,
  ): string {
    return joinTables
      .map(
        (joinTableData: {
          joinTableName: string;
          ownerColumnName: string;
          relationColumnName: string;
        }): string => {
          const joinTable: string = QueryHelper.escapeIdentifier(
            joinTableData.joinTableName,
          );
          const ownerCol: string = QueryHelper.escapeIdentifier(
            joinTableData.ownerColumnName,
          );
          const relationCol: string = QueryHelper.escapeIdentifier(
            joinTableData.relationColumnName,
          );

          return `SELECT "${joinTable}"."${ownerCol}" FROM "${joinTable}" WHERE "${joinTable}"."${relationCol}" IN (:...${valuesRid})`;
        },
      )
      .join(" UNION ALL ");
  }

  /*
   * Another column of the row whose column `alias` is, quoted. SELECT
   * builders hand Raw `Alias.property`, and quote it afterwards only where
   * the whole token is `Alias.<known property>`, so the qualifier is quoted
   * here (as booleanForCriteriaBackedRule does); UPDATE and DELETE builders
   * hand the bare property name, and the column stays bare and quoted.
   */
  private static getColumnBeside(alias: string, columnName: string): string {
    const separatorIndex: number = alias.lastIndexOf(".");
    const qualifier: string =
      separatorIndex >= 0
        ? `${QueryHelper.quoteIdentifier(alias.slice(0, separatorIndex))}.`
        : "";

    return `${qualifier}"${QueryHelper.escapeIdentifier(columnName)}"`;
  }

  /**
   * Applied to a record's primary id when it belongs to several parents
   * through a many-to-many join table (an announcement on status pages):
   * matches records linked to *no* parent that is itself linked to any of
   * the provided related entity ids (the status pages' labels). An empty
   * values array matches everything.
   */
  @CaptureSpan()
  public static noParentLinkedToAnyInManyToMany(data: {
    values: Array<string | ObjectID>;
    // The record -> parent join table.
    parentJoinTableName: string;
    parentOwnerColumnName: string;
    parentRelationColumnName: string;
    // The parent -> related entity join table.
    joinTableName: string;
    ownerColumnName: string;
    relationColumnName: string;
  }): FindWhereProperty<any> {
    const values: Array<string> = data.values.map(
      (value: string | ObjectID) => {
        return value.toString();
      },
    );

    if (values.length === 0) {
      return Raw(() => {
        return `TRUE = TRUE`;
      }, {});
    }

    const valuesRid: string = Text.generateRandomText(10);

    const quote: (identifier: string) => string = (
      identifier: string,
    ): string => {
      return identifier.replace(/"/g, '""');
    };

    const parentJoinTable: string = quote(data.parentJoinTableName);
    const parentOwnerCol: string = quote(data.parentOwnerColumnName);
    const parentRelationCol: string = quote(data.parentRelationColumnName);
    const joinTable: string = quote(data.joinTableName);
    const ownerCol: string = quote(data.ownerColumnName);
    const relationCol: string = quote(data.relationColumnName);

    return Raw(
      (alias: string) => {
        return `(${alias} NOT IN (SELECT "${parentJoinTable}"."${parentOwnerCol}" FROM "${parentJoinTable}" WHERE "${parentJoinTable}"."${parentRelationCol}" IN (SELECT "${joinTable}"."${ownerCol}" FROM "${joinTable}" WHERE "${joinTable}"."${relationCol}" IN (:...${valuesRid}))))`;
      },
      {
        [valuesRid]: values,
      },
    );
  }

  /**
   * Returns a filter that matches owner rows that are linked to *any* of the
   * provided related entity ids through a many-to-many join table. The
   * returned FindOperator is intended to be applied to the primary id column
   * of the owner entity. An empty values array matches nothing (fail closed).
   */
  @CaptureSpan()
  public static anyOfEntitiesInManyToMany(data: {
    values: Array<string | ObjectID>;
    joinTableName: string;
    ownerColumnName: string;
    relationColumnName: string;
  }): FindWhereProperty<any> {
    const values: Array<string> = data.values.map(
      (value: string | ObjectID) => {
        return value.toString();
      },
    );

    if (!values || values.length === 0) {
      return Raw(() => {
        return `TRUE = FALSE`;
      }, {});
    }

    const valuesRid: string = Text.generateRandomText(10);

    const joinTable: string = data.joinTableName.replace(/"/g, '""');
    const ownerCol: string = data.ownerColumnName.replace(/"/g, '""');
    const relationCol: string = data.relationColumnName.replace(/"/g, '""');

    return Raw(
      (alias: string) => {
        return `(${alias} IN (SELECT "${joinTable}"."${ownerCol}" FROM "${joinTable}" WHERE "${joinTable}"."${relationCol}" IN (:...${valuesRid})))`;
      },
      {
        [valuesRid]: values,
      },
    );
  }

  /**
   * WHO OWNS A RECORD (OwnedBy), applied to the record's primary id: the
   * records one of the people (`userIds`, in `userTable`) or teams
   * (`teamIds`, in `teamTable`) owns, those none of them owns, those someone
   * owns, or those nobody owns.
   *
   * The positive matches are one uncorrelated subquery,
   *
   *   _id IN (SELECT "monitorId" FROM "MonitorOwnerUser" WHERE "userId" IN (...)
   *     UNION ALL SELECT "monitorId" FROM "MonitorOwnerTeam" WHERE "teamId" IN (...))
   *
   * which Postgres answers as a semi-join: from the owners' side through the
   * owner tables' index on userId / teamId, or from the records' side through
   * their index on the record's id, whichever is cheaper. The negative ones
   * are a NOT EXISTS per owner table, correlated with the record's id - an
   * anti-join through that same index. A NOT IN would hash every id the
   * owners hold, and rescan them for every record once they outgrow the
   * planner's memory. An UPDATE or a DELETE statement names the record's id
   * bare, where a correlated subquery would read the owner table's own _id,
   * so there the negative ones are NOT IN after all. Owner rows marked
   * deleted are no owners.
   */
  @CaptureSpan()
  public static ownedBy(data: {
    match: OwnedByMatch;
    userIds: Array<string | ObjectID>;
    teamIds: Array<string | ObjectID>;
    userTable: OwnerTableColumns;
    teamTable: OwnerTableColumns;
  }): FindWhereProperty<any> {
    interface OwnerBranch {
      table: OwnerTableColumns;
      // The parameter holding the owners named; null reads every owner.
      valuesRid: string | null;
    }

    const namesOwners: boolean =
      data.match === OwnedByMatch.AnyOf || data.match === OwnedByMatch.NoneOf;
    const isPositive: boolean =
      data.match === OwnedByMatch.AnyOf || data.match === OwnedByMatch.AnyOwner;

    const parameters: Dictionary<Array<string>> = {};
    const branches: Array<OwnerBranch> = [];

    const tables: Array<[OwnerTableColumns, Array<string | ObjectID>]> = [
      [data.userTable, data.userIds],
      [data.teamTable, data.teamIds],
    ];

    for (const [table, ids] of tables) {
      if (!namesOwners) {
        branches.push({ table: table, valuesRid: null });
        continue;
      }

      if (ids.length === 0) {
        continue;
      }

      const valuesRid: string = Text.generateRandomText(10);

      parameters[valuesRid] = ids.map((id: string | ObjectID): string => {
        return id.toString();
      });

      branches.push({ table: table, valuesRid: valuesRid });
    }

    const quote: (identifier: string) => string = QueryHelper.escapeIdentifier;

    // The owner rows of one table that are the owners asked about.
    const getOwnerRowsWhere: (branch: OwnerBranch) => string = (
      branch: OwnerBranch,
    ): string => {
      const table: string = quote(branch.table.tableName);
      const ownerColumn: string = quote(branch.table.ownerColumnName);
      const ownersNamed: string = branch.valuesRid
        ? `"${table}"."${ownerColumn}" IN (:...${branch.valuesRid}) AND `
        : "";

      return `${ownersNamed}"${table}"."deletedAt" IS NULL`;
    };

    return Raw((alias: string) => {
      if (branches.length === 0) {
        // Nothing named (OwnedBy refuses it): no record, or every record.
        return isPositive ? "(FALSE)" : "(TRUE)";
      }

      // The ids of the records the owners asked about own, per owner table.
      const ownedIds: Array<string> = branches.map(
        (branch: OwnerBranch): string => {
          const table: string = quote(branch.table.tableName);
          const resourceColumn: string = quote(branch.table.resourceColumnName);

          return `SELECT "${table}"."${resourceColumn}" FROM "${table}" WHERE "${table}"."${resourceColumn}" IS NOT NULL AND ${getOwnerRowsWhere(branch)}`;
        },
      );

      if (isPositive) {
        return `(${alias} IN (${ownedIds.join(" UNION ALL ")}))`;
      }

      // A SELECT names the record's id with its table; UPDATE and DELETE bare.
      if (!alias.includes(".")) {
        return `(${ownedIds
          .map((subquery: string): string => {
            return `${alias} NOT IN (${subquery})`;
          })
          .join(" AND ")})`;
      }

      return `(${branches
        .map((branch: OwnerBranch): string => {
          const table: string = quote(branch.table.tableName);
          const resourceColumn: string = quote(branch.table.resourceColumnName);

          return `NOT EXISTS (SELECT 1 FROM "${table}" WHERE "${table}"."${resourceColumn}" = ${alias} AND ${getOwnerRowsWhere(branch)})`;
        })
        .join(" AND ")})`;
    }, parameters);
  }

  /**
   * Matches owner rows that have no rows in the join table — i.e. the
   * many-to-many collection is empty. Apply to the owner's primary id column.
   */
  @CaptureSpan()
  public static noEntitiesInManyToMany(data: {
    joinTableName: string;
    ownerColumnName: string;
  }): FindWhereProperty<any> {
    const joinTable: string = data.joinTableName.replace(/"/g, '""');
    const ownerCol: string = data.ownerColumnName.replace(/"/g, '""');

    return Raw((alias: string) => {
      return `(${alias} NOT IN (SELECT "${joinTable}"."${ownerCol}" FROM "${joinTable}" WHERE "${joinTable}"."${ownerCol}" IS NOT NULL))`;
    }, {});
  }

  /**
   * Matches owner rows that have at least one row in the join table — i.e.
   * the many-to-many collection has at least one entry. Apply to the
   * owner's primary id column.
   */
  @CaptureSpan()
  public static anyEntitiesInManyToMany(data: {
    joinTableName: string;
    ownerColumnName: string;
  }): FindWhereProperty<any> {
    const joinTable: string = data.joinTableName.replace(/"/g, '""');
    const ownerCol: string = data.ownerColumnName.replace(/"/g, '""');

    return Raw((alias: string) => {
      return `(${alias} IN (SELECT "${joinTable}"."${ownerCol}" FROM "${joinTable}" WHERE "${joinTable}"."${ownerCol}" IS NOT NULL))`;
    }, {});
  }

  /**
   * Returns a filter that matches owner rows that are linked to *all* of the
   * provided related entity ids through a many-to-many join table. The
   * returned FindOperator is intended to be applied to the primary id column
   * of the owner entity.
   */
  @CaptureSpan()
  public static allEntitiesInManyToMany(data: {
    values: Array<string | ObjectID>;
    joinTableName: string;
    ownerColumnName: string;
    relationColumnName: string;
  }): FindWhereProperty<any> {
    const values: Array<string> = data.values.map(
      (value: string | ObjectID) => {
        return value.toString();
      },
    );

    if (!values || values.length === 0) {
      return Raw(() => {
        return `TRUE = FALSE`;
      }, {});
    }

    const valuesRid: string = Text.generateRandomText(10);
    const countRid: string = Text.generateRandomText(10);

    // Escape identifiers so they can safely be embedded in the SQL string.
    const joinTable: string = data.joinTableName.replace(/"/g, '""');
    const ownerCol: string = data.ownerColumnName.replace(/"/g, '""');
    const relationCol: string = data.relationColumnName.replace(/"/g, '""');

    return Raw(
      (alias: string) => {
        return `(${alias} IN (SELECT "${joinTable}"."${ownerCol}" FROM "${joinTable}" WHERE "${joinTable}"."${relationCol}" IN (:...${valuesRid}) GROUP BY "${joinTable}"."${ownerCol}" HAVING COUNT(DISTINCT "${joinTable}"."${relationCol}") >= :${countRid}))`;
      },
      {
        [valuesRid]: values,
        [countRid]: values.length,
      },
    );
  }

  private static in(
    values: Array<string | ObjectID | number>,
  ): FindWhereProperty<any> {
    values = values.map((value: string | ObjectID | number) => {
      return value.toString();
    });
    const rid: string = Text.generateRandomText(10);

    if (!values || values.length === 0) {
      return Raw(() => {
        return `TRUE = FALSE`; // this will always return false
      }, {});
    }

    return Raw(
      (alias: string) => {
        return `(${alias} IN (:...${rid}))`;
      },
      {
        [rid]: values,
      },
    );
  }

  @CaptureSpan()
  public static notIn(
    values: Array<string | ObjectID>,
  ): FindWhereProperty<any> {
    values = values.map((value: string | ObjectID) => {
      return value.toString();
    });
    const rid: string = Text.generateRandomText(10);

    if (!values || values.length === 0) {
      return Raw(() => {
        return `TRUE = TRUE`; // this will always return true
      }, {});
    }

    return Raw(
      (alias: string) => {
        return `(${alias} NOT IN (:...${rid}))`;
      },
      {
        [rid]: values,
      },
    );
  }

  /*
   * Matches rows whose column holds one of `values`, or nothing at all. An
   * empty `values` matches only the rows whose column is empty.
   */
  @CaptureSpan()
  public static inOrNull(
    values: Array<string | ObjectID>,
  ): FindWhereProperty<any> {
    const stringValues: Array<string> = values.map(
      (value: string | ObjectID) => {
        return value.toString();
      },
    );

    if (stringValues.length === 0) {
      return Raw((alias: string) => {
        return `(${alias} IS NULL)`;
      }, {});
    }

    const rid: string = Text.generateRandomText(10);

    return Raw(
      (alias: string) => {
        return `(${alias} IN (:...${rid}) OR ${alias} IS NULL)`;
      },
      {
        [rid]: stringValues,
      },
    );
  }

  @CaptureSpan()
  public static notInOrNull(
    values: Array<string | ObjectID>,
  ): FindWhereProperty<any> {
    values = values.map((value: string | ObjectID) => {
      return value.toString();
    });
    const rid: string = Text.generateRandomText(10);

    if (!values || values.length === 0) {
      return Raw(() => {
        return `TRUE = TRUE`; // this will always return true
      }, {});
    }

    return Raw(
      (alias: string) => {
        return `(${alias} NOT IN (:...${rid}) or ${alias} IS NULL)`;
      },
      {
        [rid]: values,
      },
    );
  }

  @CaptureSpan()
  public static inRelationArray(
    values: Array<BaseModel | ObjectID>,
  ): Array<any> {
    return values.map((item: BaseModel | ObjectID) => {
      if (item instanceof ObjectID) {
        return item;
      }

      return item.id!;
    });
  }

  @CaptureSpan()
  public static equalTo(value: string): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} = :${rid})`;
      },
      {
        [rid]: value.toString(),
      },
    );
  }

  @CaptureSpan()
  public static greaterThanEqualTo<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} >= :${rid})`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static greaterThanEqualToOrNull<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} >= :${rid} or ${alias} IS NULL)`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static lessThanEqualTo<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} <= :${rid})`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static lessThanOrNull<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} < :${rid} or ${alias} IS NULL)`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static lessThanEqualToOrNull<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} <= :${rid} or ${alias} IS NULL)`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static greaterThan<T extends number | Date | ObjectID>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} > :${rid})`;
      },
      {
        [rid]: value instanceof ObjectID ? value.toString() : value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static greaterThanOrNull<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} > :${rid} or ${alias} IS NULL)`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static inBetween<T extends number | Date>(
    startValue: T,
    endValue: T,
  ): FindWhereProperty<any> {
    const rid1: string = Text.generateRandomText(10);
    const rid2: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} >= :${rid1} and ${alias} <= :${rid2})`;
      },
      {
        [rid1]: startValue,
        [rid2]: endValue,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static inBetweenOrNull<T extends number | Date>(
    startValue: T,
    endValue: T,
  ): FindWhereProperty<any> {
    const rid1: string = Text.generateRandomText(10);
    const rid2: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(((${alias} >= :${rid1} and ${alias} <= :${rid2})) or (${alias} IS NULL))`;
      },
      {
        [rid1]: startValue,
        [rid2]: endValue,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static notInBetween<T extends number | Date>(
    startValue: T,
    endValue: T,
  ): FindWhereProperty<any> {
    const rid1: string = Text.generateRandomText(10);
    const rid2: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} < :${rid1} or ${alias} > :${rid2})`;
      },
      {
        [rid1]: startValue,
        [rid2]: endValue,
      },
    ) as FindWhereProperty<any>;
  }

  /**
   * Filter on the keys of a jsonb column — `customFields` above all, whose
   * keys are the names a project gave its custom fields.
   *
   * The per-key predicates (equality, "is any of", contains, numeric
   * comparison, is-empty, and their negations) live in JSONColumnQuery. Two
   * things this used to get wrong and no longer does: the key was spliced
   * straight into the SQL string, and every value was compared with `=`, so an
   * operator such as `Includes` reached Postgres stringified.
   */
  @CaptureSpan()
  public static queryJson(value: JSONObject): FindWhereProperty<any> {
    if (value instanceof FindOperator) {
      return value;
    }

    const jsonQuery: JSONColumnQuery = buildJSONColumnQuery({
      value: value as JSONObject,
    });

    return Raw((alias: string) => {
      /*
       * alias is table name + column name like tableName.columnName
       * we need to convert this to "tableName"."columnName"
       */

      const columnReference: string = alias
        .split(".")
        .map((item: string) => {
          return `"${item}"`;
        })
        .join(".");

      return jsonQuery.toSql(columnReference);
    }, jsonQuery.parameters);
  }

  /**
   * Matches a jsonb document whose named array contains an object with a
   * particular discriminator and whose second named property contains any of
   * the supplied values.
   *
   * For example, rule criteria store filters as:
   * `{ filters: [{ field: "monitorLabels", value: ["label-id"] }] }`.
   * Keeping every key, discriminator, and value in the parameter bag makes
   * this helper safe for other jsonb documents too. The CASE expressions make
   * malformed legacy json harmless instead of letting
   * `jsonb_array_elements*` abort the entire query.
   */
  @CaptureSpan()
  public static jsonArrayObjectsContainAnyArrayValue(data: {
    arrayKey: string;
    discriminatorKey: string;
    discriminatorValue: string;
    valueArrayKey: string;
    values: Array<string | ObjectID>;
  }): FindWhereProperty<any> {
    const values: Array<string> = Array.from(
      new Set(
        data.values.map((value: string | ObjectID): string => {
          return value.toString();
        }),
      ),
    );

    if (values.length === 0) {
      return Raw(() => {
        return "TRUE = FALSE";
      }, {});
    }

    if (values.length > LIMIT_MAX) {
      throw new Error(
        `JSON array value filters cannot bind more than ${LIMIT_MAX} unique values.`,
      );
    }

    const arrayKeyParameter: string = Text.generateRandomText(10);
    const discriminatorKeyParameter: string = Text.generateRandomText(10);
    const discriminatorValueParameter: string = Text.generateRandomText(10);
    const valueArrayKeyParameter: string = Text.generateRandomText(10);
    const valuesParameter: string = Text.generateRandomText(10);

    return Raw(
      (alias: string): string => {
        return `(EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${alias} -> :${arrayKeyParameter}) = 'array' THEN ${alias} -> :${arrayKeyParameter} ELSE '[]'::jsonb END) AS json_array_item(item) WHERE json_array_item.item ->> :${discriminatorKeyParameter} = :${discriminatorValueParameter} AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(json_array_item.item -> :${valueArrayKeyParameter}) = 'array' THEN json_array_item.item -> :${valueArrayKeyParameter} ELSE '[]'::jsonb END) AS json_array_value(value) WHERE json_array_value.value = ANY(CAST(:${valuesParameter} AS text[])))))`;
      },
      {
        [arrayKeyParameter]: data.arrayKey,
        [discriminatorKeyParameter]: data.discriminatorKey,
        [discriminatorValueParameter]: data.discriminatorValue,
        [valueArrayKeyParameter]: data.valueArrayKey,
        [valuesParameter]: values,
      },
    );
  }

  /**
   * Matches a jsonb column that contains `value` (Postgres `@>`). For an array
   * of objects, `[{ id: "C123" }]` matches any array holding an object whose
   * `id` is "C123", whatever its other keys. The value travels as a bound
   * parameter, never as SQL.
   */
  @CaptureSpan()
  public static jsonContains(
    value: JSONObject | Array<JSONObject>,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);

    return Raw(
      (alias: string) => {
        return `(${alias} @> CAST(:${rid} AS JSONB))`;
      },
      {
        [rid]: JSON.stringify(value),
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static lessThan<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} < :${rid})`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }
}
