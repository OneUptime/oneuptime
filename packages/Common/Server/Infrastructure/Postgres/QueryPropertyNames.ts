import { QueryBuilder } from "typeorm";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import TypeOrmPatchVersion from "./TypeOrmPatchVersion";

/*
 * TYPEORM READS AN ENTITY'S PROPERTY NAMES ONCE, NOT ON EVERY QUERY.
 *
 * Every query TypeORM builds - each select, update, insert and delete -
 * ends in replacePropertyNamesForTheWholeQuery: the statement is written
 * with property names ("Monitor.projectId"), and that function swaps them
 * for column names. To do it, it first made, for every alias of the query,
 * a dictionary of every relation and every column of the alias's entity
 * three times over - a monitor has seventy columns - and then a regular
 * expression of the aliases. That was about a third of building a query:
 * 85 microseconds of getQuery() for a monitor's read with its labels, and
 * 7% of the App's CPU in a monitor check.
 *
 * install() makes each entity's dictionary once (it depends only on the
 * entity's metadata, which never changes once built) and each regular
 * expression once per set of aliases, and then replaces exactly as TypeORM
 * does: the same dictionary for each alias's prefix (merged, later aliases
 * winning, where two share one), the same pattern, the same replacement.
 * QueryPropertyNames.test.ts holds every statement it writes to TypeORM's
 * own, for every entity and every kind of query; TypeOrmPatchesPinned holds
 * TypeORM's function to the one this was written against.
 */

type Dictionary = Record<string, string>;

type ReplaceFunction = (
  this: QueryBuilderInternals,
  statement: string,
) => string;

const PATCHED: unique symbol = Symbol("oneuptime.queryPropertyNames");

type PatchedReplaceFunction = ReplaceFunction & {
  [PATCHED]?: ReplaceFunction | undefined;
};

interface AliasInternals {
  name: string;
  hasMetadata: boolean;
  metadata: EntityMetadata;
}

interface QueryBuilderInternals {
  expressionMap: {
    aliases: Array<AliasInternals>;
    aliasNamePrefixingEnabled: boolean;
  };
  escape: (name: string) => string;
}

// TypeORM's QueryBuilder, or a stand-in with its function.
export interface QueryBuilderClass {
  prototype: unknown;
}

// At most this many sets of aliases keep a pattern; then they start over.
const MAX_PATTERNS: number = 2000;

const dictionaries: WeakMap<EntityMetadata, Dictionary> = new WeakMap();
const patterns: Map<string, RegExp> = new Map();

const ALIAS_PREFIX_PATTERN_START: string = "([ =(]|^.{0})";
const PROPERTY_PATTERN: string = "([^ =(),]+)";
const PROPERTY_PATTERN_END: string = "(?=[ =),]|.{0}$)";

export default class QueryPropertyNames {
  /*
   * An entity's property names and the column each stands for, in the
   * order TypeORM writes them, later ones winning: a relation's own name
   * (its first join column), its join columns by path, then each column by
   * its database name, its property name and its property path.
   */
  public static dictionaryOf(metadata: EntityMetadata): Dictionary {
    let dictionary: Dictionary | undefined = dictionaries.get(metadata);

    if (dictionary) {
      return dictionary;
    }

    dictionary = {};

    for (const relation of metadata.relations) {
      if (relation.joinColumns.length > 0) {
        dictionary[relation.propertyPath] =
          relation.joinColumns[0]!.databaseName;
      }
    }

    for (const relation of metadata.relations) {
      for (const joinColumn of [
        ...relation.joinColumns,
        ...relation.inverseJoinColumns,
      ]) {
        dictionary[
          `${relation.propertyPath}.${joinColumn.referencedColumn!.propertyPath}`
        ] = joinColumn.databaseName;
      }
    }

    for (const column of metadata.columns) {
      dictionary[column.databaseName] = column.databaseName;
    }

    for (const column of metadata.columns) {
      dictionary[column.propertyName] = column.databaseName;
    }

    for (const column of metadata.columns) {
      dictionary[column.propertyPath] = column.databaseName;
    }

    dictionaries.set(metadata, dictionary);

    return dictionary;
  }

  // The pattern TypeORM matches property names with, for these prefixes.
  public static patternOf(prefixes: string): RegExp {
    let pattern: RegExp | undefined = patterns.get(prefixes);

    if (!pattern) {
      if (patterns.size >= MAX_PATTERNS) {
        patterns.clear();
      }

      pattern = new RegExp(
        ALIAS_PREFIX_PATTERN_START +
          (prefixes ? `(${prefixes})` : "") +
          PROPERTY_PATTERN +
          PROPERTY_PATTERN_END,
        "gm",
      );
      patterns.set(prefixes, pattern);
    }

    return pattern;
  }

  // What TypeORM's replacePropertyNamesForTheWholeQuery returns.
  public static replace(
    queryBuilder: QueryBuilderInternals,
    statement: string,
  ): string {
    const replacements: Record<string, Dictionary> = {};

    for (const alias of queryBuilder.expressionMap.aliases) {
      if (!alias.hasMetadata) {
        continue;
      }

      const prefix: string =
        queryBuilder.expressionMap.aliasNamePrefixingEnabled && alias.name
          ? `${alias.name}.`
          : "";
      const dictionary: Dictionary = QueryPropertyNames.dictionaryOf(
        alias.metadata,
      );
      const existing: Dictionary | undefined = replacements[prefix];

      replacements[prefix] = existing
        ? { ...existing, ...dictionary }
        : dictionary;
    }

    const prefixKeys: Array<string> = Object.keys(replacements);

    if (prefixKeys.length === 0) {
      return statement;
    }

    const prefixes: string = prefixKeys
      .map((key: string): string => {
        return escapeRegExp(key);
      })
      .join("|");

    return statement.replace(
      QueryPropertyNames.patternOf(prefixes),
      (...matches: Array<string>): string => {
        if (prefixes) {
          const prefix: string = matches[2]!;
          const property: string = matches[3]!;
          const column: string | undefined = replacements[prefix]?.[property];

          if (column) {
            return `${matches[1]}${queryBuilder.escape(
              prefix.substring(0, prefix.length - 1),
            )}.${queryBuilder.escape(column)}`;
          }
        } else {
          const column: string | undefined = replacements[""]?.[matches[2]!];

          if (column) {
            return `${matches[1]}${queryBuilder.escape(column)}`;
          }
        }

        return matches[0]!;
      },
    );
  }

  /*
   * Replace TypeORM's function once per process. PostgresDatabase.connect
   * calls this before it opens the pool. Not against a TypeORM other than
   * the one this was written for (TypeOrmPatchVersion): its own runs there.
   */
  public static install(
    queryBuilderClass: QueryBuilderClass = QueryBuilder as unknown as QueryBuilderClass,
  ): void {
    if (!TypeOrmPatchVersion.isPatchedVersion()) {
      return;
    }

    const prototype: {
      replacePropertyNamesForTheWholeQuery: PatchedReplaceFunction;
    } = queryBuilderClass.prototype as {
      replacePropertyNamesForTheWholeQuery: PatchedReplaceFunction;
    };
    const original: PatchedReplaceFunction =
      prototype.replacePropertyNamesForTheWholeQuery;

    if (original[PATCHED]) {
      return;
    }

    const patched: PatchedReplaceFunction = function (
      this: QueryBuilderInternals,
      statement: string,
    ): string {
      return QueryPropertyNames.replace(this, statement);
    };

    patched[PATCHED] = original;
    prototype.replacePropertyNamesForTheWholeQuery = patched;
  }

  // Whether install() has run (tests).
  public static isInstalled(
    queryBuilderClass: QueryBuilderClass = QueryBuilder as unknown as QueryBuilderClass,
  ): boolean {
    const prototype: {
      replacePropertyNamesForTheWholeQuery: PatchedReplaceFunction;
    } = queryBuilderClass.prototype as {
      replacePropertyNamesForTheWholeQuery: PatchedReplaceFunction;
    };

    return Boolean(prototype.replacePropertyNamesForTheWholeQuery[PATCHED]);
  }

  // TypeORM's own function, installed or not (tests).
  public static getOriginal(
    queryBuilderClass: QueryBuilderClass = QueryBuilder as unknown as QueryBuilderClass,
  ): ReplaceFunction {
    const prototype: {
      replacePropertyNamesForTheWholeQuery: PatchedReplaceFunction;
    } = queryBuilderClass.prototype as {
      replacePropertyNamesForTheWholeQuery: PatchedReplaceFunction;
    };

    return (
      prototype.replacePropertyNamesForTheWholeQuery[PATCHED] ||
      prototype.replacePropertyNamesForTheWholeQuery
    );
  }

  // Undo install() (tests).
  public static uninstall(
    queryBuilderClass: QueryBuilderClass = QueryBuilder as unknown as QueryBuilderClass,
  ): void {
    const prototype: {
      replacePropertyNamesForTheWholeQuery: PatchedReplaceFunction;
    } = queryBuilderClass.prototype as {
      replacePropertyNamesForTheWholeQuery: PatchedReplaceFunction;
    };
    const original: ReplaceFunction | undefined =
      prototype.replacePropertyNamesForTheWholeQuery[PATCHED];

    if (original) {
      prototype.replacePropertyNamesForTheWholeQuery = original;
    }
  }
}
