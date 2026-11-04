import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../../Models/DatabaseModels/DataAssetLineage";
import DataAssetUsage from "../../../../Models/DatabaseModels/DataAssetUsage";
import DataProduct from "../../../../Models/DatabaseModels/DataProduct";
import { SpanKind } from "../../../../Models/AnalyticsModels/Span";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  PRODUCTION_REVIEW_LIMITS,
  ProductionReviewDataChange,
  ProductionReviewDataDashboardJSON,
  ProductionReviewDataImpactJSON,
  ProductionReviewDataProductJSON,
  ProductionReviewDataServiceJSON,
  ProductionReviewDataTableJSON,
} from "../../../../Types/CodeRepository/ProductionReview";
import { DataAssetAccessKind } from "../../../../Types/DataObservability/DataAssetUsage";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import DataAssetLineageService from "../../../Services/DataAssetLineageService";
import DataAssetService from "../../../Services/DataAssetService";
import DataAssetUsageService from "../../../Services/DataAssetUsageService";
import DataProductService from "../../../Services/DataProductService";
import SpanService from "../../../Services/SpanService";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../../AnalyticsDatabase/QuerySettingsHelper";
import { getClickhouseDatabaseName } from "../../AnalyticsDatabase/ClusterConfig";
import { CodeHostChangedFile } from "../CodeHost/CodeHostTypes";
import DataTableDashboards, {
  TableDashboard,
} from "../../DataObservability/Bi/DataTableDashboards";
import { ResponseJSON } from "@clickhouse/client";

/*
 * WHAT A PULL REQUEST DOES TO THE DATA, AND WHO DEPENDS ON IT.
 *
 * A migration that drops or renames a column breaks whatever reads it, and
 * nobody sees that until after the merge. The review reads the pull
 * request's migrations - SQL files, and the migrations of Rails, Django,
 * Alembic, Sequelize, TypeORM and Knex - and its dbt models, for what they
 * change of a table: a table dropped or renamed, a column dropped, renamed
 * or retyped, a model rebuilt. Each table Data Observability watches is
 * then looked up for what depends on it:
 *
 *   - the services seen reading and writing it, from their database spans
 *     (DataAssetUsage), and for a column change, how many of each one's
 *     queries of the last day name the column;
 *   - the tables built from it (lineage);
 *   - the data products it is part of, with their owners.
 *
 * Only what the change adds is read (a migration's down step, which undoes
 * it, is left out), and a table name several databases hold is narrowed to
 * the ones the repository's own services use, when any does.
 */

export interface PullRequestDataChange {
  change: ProductionReviewDataChange;
  schema: string | null;
  table: string;
  column: string | null;
  newName: string | null;
  path: string;
  // A Django model's name: its table is the model's name after the app's.
  isModelName?: boolean | undefined;
}

// How far back a service's queries are searched for a changed column.
const COLUMN_QUERY_WINDOW_IN_HOURS: number = 24;
// The changes of one pull request looked up, and the dependents of each kept.
const MAX_CHANGES: number = 20;
const MAX_TABLES_PER_CHANGE: number = 3;
const MAX_SERVICES: number = 10;
const MAX_DOWNSTREAM: number = 10;
const MAX_DATA_PRODUCTS: number = 5;
const MAX_DASHBOARDS: number = 10;
const MAX_NAME_LENGTH: number = 240;

// A name as SQL writes it: bare, or quoted with "", `` or [].
const IDENT: string =
  '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][A-Za-z0-9_$]*)';
const QUALIFIED: string = `${IDENT}(?:\\s*\\.\\s*${IDENT}){0,2}`;

const ALTER_TABLE: RegExp = new RegExp(
  `\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${QUALIFIED})\\s+([^;]*)`,
  "gi",
);
const DROP_TABLE: RegExp = new RegExp(
  `\\bDROP\\s+(?:TABLE|VIEW|MATERIALIZED\\s+VIEW)\\s+(?:IF\\s+EXISTS\\s+)?(${QUALIFIED}(?:\\s*,\\s*${QUALIFIED})*)`,
  "gi",
);
const RENAME_TABLE_TO: RegExp = new RegExp(
  `^RENAME\\s+TO\\s+(${QUALIFIED})`,
  "i",
);
const RENAME_COLUMN: RegExp = new RegExp(
  `^RENAME\\s+(?:COLUMN\\s+)?(${IDENT})\\s+TO\\s+(${IDENT})`,
  "i",
);
const DROP_COLUMN: RegExp = new RegExp(
  `^DROP\\s+(COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?(${IDENT})`,
  "i",
);
const ALTER_COLUMN: RegExp = new RegExp(
  `^ALTER\\s+(COLUMN\\s+)?(${IDENT})\\s+(\\w+)`,
  "i",
);
const MODIFY_COLUMN: RegExp = new RegExp(
  `^MODIFY\\s+(?:COLUMN\\s+)?(${IDENT})`,
  "i",
);
const CHANGE_COLUMN: RegExp = new RegExp(
  `^CHANGE\\s+(?:COLUMN\\s+)?(${IDENT})\\s+(${IDENT})`,
  "i",
);

// What may follow DROP in an ALTER TABLE without being a column.
const NOT_COLUMNS: ReadonlySet<string> = new Set([
  "CONSTRAINT",
  "INDEX",
  "KEY",
  "PRIMARY",
  "FOREIGN",
  "CHECK",
  "PARTITION",
  "DEFAULT",
  "NOT",
  "TRIGGER",
  "IDENTITY",
  "EXPRESSION",
  "PERIOD",
  "SYSTEM",
]);

// What may follow ALTER COLUMN x without changing its type.
const NOT_TYPE_CHANGES: ReadonlySet<string> = new Set([
  "SET",
  "DROP",
  "ADD",
  "RESET",
  "OPTIONS",
  "RESTART",
]);

// The step that undoes a migration: everything from it on is left out.
const DOWN_STEP: RegExp =
  /\b(?:public\s+)?(?:async\s+)?down\s*\(|\bdef\s+down(?:grade)?\b|\bdown\s*:\s*(?:async\s*)?(?:\(|function)|\bexports\.down\b|--\s*\+migrate\s+down|--\s*migrate:down/i;

const MIGRATION_DIRECTORY: RegExp =
  /(^|\/)(migrations?|migrate|schemamigrations|flyway|liquibase|alembic|versions|changelogs?|ddl)(\/)/i;
const DBT_MODEL: RegExp = /(^|\/)models\/.+\.sql$/i;
const DBT_OTHER: RegExp = /(^|\/)(macros|tests|analyses|seeds|snapshots)\//i;
// Undo and down files of Flyway, golang-migrate and dbmate.
const UNDO_FILE: RegExp = /(^|\/)U\d[^/]*__[^/]*\.sql$|\.down\.sql$/i;

// A Ruby symbol or a string: one of remove_columns' columns, never an option.
const SYMBOL_OR_STRING: RegExp = /^:?["']?\w+["']?$/;
// Alembic's alter_column changing a type.
const TYPE_ARGUMENT: RegExp = /\btype_\s*=/;
// The languages a migration directory's migrations are read in.
const MIGRATION_LANGUAGE: RegExp = /\.(rb|py|ts|js|mjs|cjs)$/;
const JAVASCRIPT_FILE: RegExp = /\.(ts|js|mjs|cjs)$/;

const RAILS: Array<{
  pattern: RegExp;
  read: (match: RegExpMatchArray) => Array<Omit<PullRequestDataChange, "path">>;
}> = [
  {
    pattern:
      /\bremove_column[ \t]*\(?[ \t]*:?["']?(\w+)["']?[ \t]*,[ \t]*:?["']?(\w+)/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        change(ProductionReviewDataChange.DropColumn, match[1]!, match[2]!),
      ];
    },
  },
  {
    // remove_columns :orders, :total, :coupon, type: :string - the columns, never an option.
    pattern: /\bremove_columns[ \t]*\(?[ \t]*:?["']?(\w+)["']?[ \t]*,([^\n]*)/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return match[2]!
        .split(",")
        .map((part: string): string => {
          return part.trim().replace(/\)\s*$/, "");
        })
        .filter((part: string): boolean => {
          return SYMBOL_OR_STRING.test(part);
        })
        .map((part: string): Omit<PullRequestDataChange, "path"> => {
          return change(
            ProductionReviewDataChange.DropColumn,
            match[1]!,
            part.replace(/[:"']/g, ""),
          );
        });
    },
  },
  {
    pattern:
      /\brename_column\s*\(?\s*:?["']?(\w+)["']?\s*,\s*:?["']?(\w+)["']?\s*,\s*:?["']?(\w+)/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        change(
          ProductionReviewDataChange.RenameColumn,
          match[1]!,
          match[2]!,
          match[3]!,
        ),
      ];
    },
  },
  {
    pattern: /\bchange_column\s*\(?\s*:?["']?(\w+)["']?\s*,\s*:?["']?(\w+)/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        change(ProductionReviewDataChange.AlterColumn, match[1]!, match[2]!),
      ];
    },
  },
  {
    pattern: /\bdrop_table\s*\(?\s*:?["']?(\w+)/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [change(ProductionReviewDataChange.DropTable, match[1]!)];
    },
  },
  {
    pattern: /\brename_table\s*\(?\s*:?["']?(\w+)["']?\s*,\s*:?["']?(\w+)/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        change(
          ProductionReviewDataChange.RenameTable,
          match[1]!,
          null,
          match[2]!,
        ),
      ];
    },
  },
];

const PYTHON: typeof RAILS = [
  {
    pattern: /\bop\.drop_column\(\s*["'](\w+)["']\s*,\s*["'](\w+)["']/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        change(ProductionReviewDataChange.DropColumn, match[1]!, match[2]!),
      ];
    },
  },
  {
    pattern: /\bop\.drop_table\(\s*["'](\w+)["']/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [change(ProductionReviewDataChange.DropTable, match[1]!)];
    },
  },
  {
    pattern: /\bop\.rename_table\(\s*["'](\w+)["']\s*,\s*["'](\w+)["']/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        change(
          ProductionReviewDataChange.RenameTable,
          match[1]!,
          null,
          match[2]!,
        ),
      ];
    },
  },
  {
    pattern:
      /\bop\.alter_column\(\s*["'](\w+)["']\s*,\s*["'](\w+)["']([^)]*)\)/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      const rename: RegExpMatchArray | null = (match[3] || "").match(
        /new_column_name\s*=\s*["'](\w+)["']/,
      );

      if (rename) {
        return [
          change(
            ProductionReviewDataChange.RenameColumn,
            match[1]!,
            match[2]!,
            rename[1]!,
          ),
        ];
      }

      return TYPE_ARGUMENT.test(match[3] || "")
        ? [change(ProductionReviewDataChange.AlterColumn, match[1]!, match[2]!)]
        : [];
    },
  },
  {
    pattern:
      /migrations\.RemoveField\(\s*model_name\s*=\s*["'](\w+)["']\s*,\s*name\s*=\s*["'](\w+)["']/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        {
          ...change(
            ProductionReviewDataChange.DropColumn,
            match[1]!,
            match[2]!,
          ),
          isModelName: true,
        },
      ];
    },
  },
  {
    pattern:
      /migrations\.RenameField\(\s*model_name\s*=\s*["'](\w+)["']\s*,\s*old_name\s*=\s*["'](\w+)["']\s*,\s*new_name\s*=\s*["'](\w+)["']/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        {
          ...change(
            ProductionReviewDataChange.RenameColumn,
            match[1]!,
            match[2]!,
            match[3]!,
          ),
          isModelName: true,
        },
      ];
    },
  },
  {
    pattern: /migrations\.DeleteModel\(\s*name\s*=\s*["'](\w+)["']/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        {
          ...change(ProductionReviewDataChange.DropTable, match[1]!),
          isModelName: true,
        },
      ];
    },
  },
];

// Sequelize's queryInterface, TypeORM's queryRunner and Knex's schema builder.
const JAVASCRIPT: typeof RAILS = [
  {
    pattern:
      /\b(?:removeColumn|dropColumn)\(\s*["'`](\w+)["'`]\s*,\s*["'`](\w+)["'`]/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        change(ProductionReviewDataChange.DropColumn, match[1]!, match[2]!),
      ];
    },
  },
  {
    pattern:
      /\brenameColumn\(\s*["'`](\w+)["'`]\s*,\s*["'`](\w+)["'`]\s*,\s*["'`](\w+)["'`]/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        change(
          ProductionReviewDataChange.RenameColumn,
          match[1]!,
          match[2]!,
          match[3]!,
        ),
      ];
    },
  },
  {
    pattern: /\bchangeColumn\(\s*["'`](\w+)["'`]\s*,\s*["'`](\w+)["'`]/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        change(ProductionReviewDataChange.AlterColumn, match[1]!, match[2]!),
      ];
    },
  },
  {
    pattern: /\b(?:dropTable|dropTableIfExists)\(\s*["'`](\w+)["'`]/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [change(ProductionReviewDataChange.DropTable, match[1]!)];
    },
  },
  {
    pattern: /\brenameTable\(\s*["'`](\w+)["'`]\s*,\s*["'`](\w+)["'`]/g,
    read: (
      match: RegExpMatchArray,
    ): Array<Omit<PullRequestDataChange, "path">> => {
      return [
        change(
          ProductionReviewDataChange.RenameTable,
          match[1]!,
          null,
          match[2]!,
        ),
      ];
    },
  },
];

function change(
  kind: ProductionReviewDataChange,
  qualifiedTable: string,
  column: string | null = null,
  newName: string | null = null,
): Omit<PullRequestDataChange, "path"> {
  const parts: Array<string> = splitQualified(qualifiedTable);

  return {
    change: kind,
    schema: parts.length > 1 ? parts[parts.length - 2]! : null,
    table: parts[parts.length - 1] || qualifiedTable,
    column: column ? unquote(column) : null,
    newName: newName ? unquote(newName) : null,
  };
}

// A name without its quotes: "orders", `orders` and [orders] are orders.
export function unquote(name: string): string {
  const trimmed: string = name.trim();

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("`") && trimmed.endsWith("`")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

// db.schema.table as its parts, dots inside quotes kept.
export function splitQualified(value: string): Array<string> {
  return (value.match(new RegExp(IDENT, "g")) || []).map(unquote);
}

// Splits an ALTER TABLE's actions on its commas, never one inside parentheses.
function splitActions(value: string): Array<string> {
  const actions: Array<string> = [];
  let depth: number = 0;
  let current: string = "";

  for (const character of value) {
    if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (character === "," && depth === 0) {
      actions.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  actions.push(current.trim());

  return actions.filter(Boolean);
}

// What one ALTER TABLE action does to a table or one of its columns.
function readAlterAction(
  table: string,
  action: string,
): Omit<PullRequestDataChange, "path"> | null {
  const renameTable: RegExpMatchArray | null = action.match(RENAME_TABLE_TO);

  if (renameTable) {
    return change(
      ProductionReviewDataChange.RenameTable,
      table,
      null,
      renameTable[1]!,
    );
  }

  const renameColumn: RegExpMatchArray | null = action.match(RENAME_COLUMN);

  if (renameColumn) {
    return change(
      ProductionReviewDataChange.RenameColumn,
      table,
      renameColumn[1]!,
      renameColumn[2]!,
    );
  }

  const dropColumn: RegExpMatchArray | null = action.match(DROP_COLUMN);

  if (dropColumn) {
    const hasColumnWord: boolean = Boolean(dropColumn[1]);

    return hasColumnWord || !NOT_COLUMNS.has(dropColumn[2]!.toUpperCase())
      ? change(ProductionReviewDataChange.DropColumn, table, dropColumn[2]!)
      : null;
  }

  const alterColumn: RegExpMatchArray | null = action.match(ALTER_COLUMN);

  if (alterColumn) {
    const next: string = alterColumn[3]!.toUpperCase();

    if (next === "TYPE") {
      return change(
        ProductionReviewDataChange.AlterColumn,
        table,
        alterColumn[2]!,
      );
    }

    // SQL Server's ALTER COLUMN x NVARCHAR(50), with the COLUMN word.
    return alterColumn[1] && !NOT_TYPE_CHANGES.has(next)
      ? change(ProductionReviewDataChange.AlterColumn, table, alterColumn[2]!)
      : null;
  }

  const modifyColumn: RegExpMatchArray | null = action.match(MODIFY_COLUMN);

  if (modifyColumn) {
    return change(
      ProductionReviewDataChange.AlterColumn,
      table,
      modifyColumn[1]!,
    );
  }

  const changeColumn: RegExpMatchArray | null = action.match(CHANGE_COLUMN);

  if (changeColumn) {
    const from: string = unquote(changeColumn[1]!);
    const to: string = unquote(changeColumn[2]!);

    return from.toLowerCase() === to.toLowerCase()
      ? change(ProductionReviewDataChange.AlterColumn, table, from)
      : change(ProductionReviewDataChange.RenameColumn, table, from, to);
  }

  return null;
}

// The SQL a migration runs, as its changes to tables and columns.
export function readSqlChanges(
  sql: string,
): Array<Omit<PullRequestDataChange, "path">> {
  const changes: Array<Omit<PullRequestDataChange, "path">> = [];
  // Comments say nothing a database does.
  const text: string = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  for (const match of text.matchAll(ALTER_TABLE)) {
    for (const action of splitActions(match[2] || "")) {
      const found: Omit<PullRequestDataChange, "path"> | null = readAlterAction(
        match[1]!,
        action,
      );

      if (found) {
        changes.push(found);
      }
    }
  }

  for (const match of text.matchAll(DROP_TABLE)) {
    for (const name of match[1]!.split(",")) {
      changes.push(change(ProductionReviewDataChange.DropTable, name.trim()));
    }
  }

  return changes;
}

// The lines a patch adds, as text: what the change brings, never what it removes.
export function readAddedText(patch: string | null | undefined): string {
  return (patch || "")
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("+") && !line.startsWith("+++");
    })
    .map((line: string): string => {
      return line.slice(1);
    })
    .join("\n");
}

export function isDbtModelPath(path: string): boolean {
  return DBT_MODEL.test(path) && !DBT_OTHER.test(path);
}

export function isMigrationPath(path: string): boolean {
  if (UNDO_FILE.test(path) || isDbtModelPath(path) || DBT_OTHER.test(path)) {
    return false;
  }

  const lower: string = path.toLowerCase();

  if (lower.endsWith(".sql")) {
    return true;
  }

  return MIGRATION_LANGUAGE.test(lower) && MIGRATION_DIRECTORY.test(lower);
}

/*
 * What a pull request's migrations and dbt models change, in the order the
 * files list them, each change once.
 */
export function readDataChanges(
  files: Array<CodeHostChangedFile>,
): Array<PullRequestDataChange> {
  const changes: Array<PullRequestDataChange> = [];
  const seen: Set<string> = new Set();
  const keep: (found: PullRequestDataChange) => void = (
    found: PullRequestDataChange,
  ): void => {
    const key: string = [
      found.change,
      (found.schema || "").toLowerCase(),
      found.table.toLowerCase(),
      (found.column || "").toLowerCase(),
    ].join("\u0000");

    if (
      !seen.has(key) &&
      found.table &&
      found.table.length <= MAX_NAME_LENGTH
    ) {
      seen.add(key);
      changes.push(found);
    }
  };

  for (const file of files) {
    if (file.status === "removed" || !file.patch) {
      continue;
    }

    const path: string = file.filename;

    if (isDbtModelPath(path)) {
      const model: string = (path.split("/").pop() || "").replace(
        /\.sql$/i,
        "",
      );

      if (model) {
        keep({
          change: ProductionReviewDataChange.ChangeModel,
          schema: null,
          table: model,
          column: null,
          newName: null,
          path,
        });
      }

      continue;
    }

    if (!isMigrationPath(path)) {
      continue;
    }

    const added: string = readAddedText(file.patch);
    const down: number = added.search(DOWN_STEP);
    const forward: string = down >= 0 ? added.slice(0, down) : added;
    const lower: string = path.toLowerCase();
    const patterns: typeof RAILS = lower.endsWith(".rb")
      ? RAILS
      : lower.endsWith(".py")
        ? PYTHON
        : JAVASCRIPT_FILE.test(lower)
          ? JAVASCRIPT
          : [];

    for (const found of readSqlChanges(forward)) {
      keep({ ...found, path });
    }

    for (const language of patterns) {
      for (const match of forward.matchAll(language.pattern)) {
        for (const found of language.read(match)) {
          keep({ ...found, path });
        }
      }
    }
  }

  return changes.slice(0, MAX_CHANGES);
}

// A regular expression that finds a column's name as a whole word, in any case.
export function columnPattern(column: string): string {
  return `(?i)\\b${column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`;
}

export default class ProductionReviewDataImpact {
  /*
   * The watched tables a pull request's files change, each with what
   * depends on it, at most PRODUCTION_REVIEW_LIMITS.maxDataImpacts.
   */
  public static async find(data: {
    projectId: ObjectID;
    files: Array<CodeHostChangedFile>;
    // The services the repository serves: their tables are the likeliest.
    serviceIds: Array<string>;
    now: Date;
  }): Promise<Array<ProductionReviewDataImpactJSON>> {
    const changes: Array<PullRequestDataChange> = readDataChanges(data.files);
    const impacts: Array<ProductionReviewDataImpactJSON> = [];

    for (const found of changes) {
      if (impacts.length >= PRODUCTION_REVIEW_LIMITS.maxDataImpacts) {
        break;
      }

      const assets: Array<DataAsset> =
        await ProductionReviewDataImpact.findTables({
          projectId: data.projectId,
          change: found,
          serviceIds: data.serviceIds,
        });

      for (const asset of assets) {
        if (impacts.length >= PRODUCTION_REVIEW_LIMITS.maxDataImpacts) {
          break;
        }

        impacts.push(
          await ProductionReviewDataImpact.describe({
            projectId: data.projectId,
            asset,
            change: found,
            now: data.now,
          }),
        );
      }
    }

    return impacts;
  }

  // The watched tables a change names: by schema and name, or a Django model's table.
  public static async findTables(data: {
    projectId: ObjectID;
    change: PullRequestDataChange;
    serviceIds: Array<string>;
  }): Promise<Array<DataAsset>> {
    const table: string = data.change.table.toLowerCase();
    const candidates: Array<DataAsset> = await DataAssetService.findBy({
      query: {
        projectId: data.projectId,
        isDropped: false,
        ...(data.change.isModelName
          ? { name: QueryHelper.search(table) }
          : { name: QueryHelper.findWithSameText(data.change.table) }),
      },
      select: {
        _id: true,
        name: true,
        schemaName: true,
        assetKey: true,
        dataStoreName: true,
        rowCount: true,
      },
      sort: { rowCount: SortOrder.Descending },
      limit: 50,
      skip: 0,
      props: { isRoot: true },
    });
    const named: Array<DataAsset> = candidates.filter((asset: DataAsset) => {
      const name: string = (asset.name || "").toLowerCase();
      const schema: string = (asset.schemaName || "").toLowerCase();

      if (data.change.isModelName) {
        return name === table || name.endsWith(`_${table}`);
      }

      return (
        name === table &&
        (!data.change.schema || schema === data.change.schema.toLowerCase())
      );
    });

    if (named.length <= 1) {
      return named;
    }

    // Several databases hold a table of that name: the ones this repository's services use.
    if (data.serviceIds.length > 0) {
      const used: Array<DataAssetUsage> = await DataAssetUsageService.findBy({
        query: {
          projectId: data.projectId,
          dataAssetId: new Includes(
            named.map((asset: DataAsset): ObjectID => {
              return asset.id!;
            }),
          ),
          serviceId: new Includes(
            data.serviceIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        },
        select: { dataAssetId: true },
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      });
      const usedIds: Set<string> = new Set(
        used.map((usage: DataAssetUsage): string => {
          return usage.dataAssetId?.toString() || "";
        }),
      );
      const ours: Array<DataAsset> = named.filter((asset: DataAsset) => {
        return usedIds.has(asset.id!.toString());
      });

      if (ours.length > 0) {
        return ours.slice(0, MAX_TABLES_PER_CHANGE);
      }
    }

    // A Django model's table is a guess by name: only when one table fits.
    return data.change.isModelName ? [] : named.slice(0, MAX_TABLES_PER_CHANGE);
  }

  // One table's change, and what depends on it.
  public static async describe(data: {
    projectId: ObjectID;
    asset: DataAsset;
    change: PullRequestDataChange;
    now: Date;
  }): Promise<ProductionReviewDataImpactJSON> {
    const assetId: ObjectID = data.asset.id!;
    const [usages, edges, products] = await Promise.all([
      DataAssetUsageService.findBy({
        query: { projectId: data.projectId, dataAssetId: assetId },
        select: {
          serviceId: true,
          serviceName: true,
          accessKind: true,
          callCount: true,
          lastSeenAt: true,
        },
        sort: { callCount: SortOrder.Descending },
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      }),
      DataAssetLineageService.findBy({
        query: {
          projectId: data.projectId,
          upstreamDataAssetId: assetId,
          downstreamDataAssetId: QueryHelper.notNull(),
        },
        select: {
          downstreamDataAssetId: true,
          downstreamDataAsset: { assetKey: true, name: true, schemaName: true },
        },
        sort: { lastSeenAt: SortOrder.Descending },
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      }),
      DataProductService.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.anyOfEntitiesInManyToMany({
            values: [assetId],
            joinTableName: "DataProductDataAsset",
            ownerColumnName: "dataProductId",
            relationColumnName: "dataAssetId",
          }),
        },
        select: {
          name: true,
          ownerTeam: { name: true },
          ownerUser: { name: true, email: true },
        },
        limit: MAX_DATA_PRODUCTS,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    const services: Array<ProductionReviewDataServiceJSON> =
      ProductionReviewDataImpact.groupServices(usages as Array<DataAssetUsage>);
    const dashboards: Array<TableDashboard> = await DataTableDashboards.find({
      projectId: data.projectId,
      dataAssetId: assetId,
    }).catch((): Array<TableDashboard> => {
      return [];
    });

    if (data.change.column && services.length > 0) {
      const counts: Map<string, number> | null =
        await ProductionReviewDataImpact.countColumnQueries({
          projectId: data.projectId,
          serviceIds: services
            .map((service: ProductionReviewDataServiceJSON): string => {
              return service.serviceId || "";
            })
            .filter(Boolean),
          table: data.asset.name || data.change.table,
          column: data.change.column,
          now: data.now,
        });

      for (const service of services) {
        const count: number | undefined = service.serviceId
          ? counts?.get(service.serviceId)
          : undefined;

        if (count !== undefined) {
          service.columnQueryCount = count;
        }
      }

      // The services whose queries name the column first.
      services.sort(
        (
          a: ProductionReviewDataServiceJSON,
          b: ProductionReviewDataServiceJSON,
        ) => {
          return (b.columnQueryCount || 0) - (a.columnQueryCount || 0);
        },
      );
    }

    const downstream: Array<ProductionReviewDataTableJSON> = [];
    const downstreamIds: Set<string> = new Set();

    for (const edge of edges as Array<DataAssetLineage>) {
      const id: string = edge.downstreamDataAssetId?.toString() || "";

      if (!id || downstreamIds.has(id) || id === assetId.toString()) {
        continue;
      }

      downstreamIds.add(id);

      if (downstream.length < MAX_DOWNSTREAM) {
        downstream.push({
          dataAssetId: id,
          table:
            edge.downstreamDataAsset?.assetKey ||
            edge.downstreamDataAsset?.name ||
            id,
        });
      }
    }

    return {
      dataAssetId: assetId.toString(),
      table: data.asset.assetKey || data.asset.name || data.change.table,
      storeName: data.asset.dataStoreName || "",
      change: data.change.change,
      ...(data.change.column ? { column: data.change.column } : {}),
      ...(data.change.newName ? { newName: data.change.newName } : {}),
      path: data.change.path,
      services: services.slice(0, MAX_SERVICES),
      downstreamTables: downstream,
      downstreamCount: downstreamIds.size,
      dashboards: dashboards
        .slice(0, MAX_DASHBOARDS)
        .map((dashboard: TableDashboard): ProductionReviewDataDashboardJSON => {
          return {
            dataDashboardId: dashboard.dataDashboardId,
            name: dashboard.name,
            tool: dashboard.tool,
            ...(dashboard.url ? { url: dashboard.url } : {}),
          };
        }),
      dataProducts: (products as Array<DataProduct>).map(
        (product: DataProduct): ProductionReviewDataProductJSON => {
          const owner: string =
            product.ownerTeam?.name ||
            product.ownerUser?.name?.toString() ||
            product.ownerUser?.email?.toString() ||
            "";

          return {
            dataProductId: product.id!.toString(),
            name: product.name || "",
            ...(owner ? { owner } : {}),
          };
        },
      ),
    };
  }

  // A table's usages, one row per service: whether it reads, writes, or both.
  public static groupServices(
    usages: Array<DataAssetUsage>,
  ): Array<ProductionReviewDataServiceJSON> {
    const byService: Map<string, ProductionReviewDataServiceJSON> = new Map();

    for (const usage of usages) {
      const key: string =
        usage.serviceId?.toString() || `name:${usage.serviceName || ""}`;
      const known: ProductionReviewDataServiceJSON = byService.get(key) || {
        ...(usage.serviceId ? { serviceId: usage.serviceId.toString() } : {}),
        name: usage.serviceName || "A service",
        reads: false,
        writes: false,
      };

      if (usage.accessKind === DataAssetAccessKind.Read) {
        known.reads = true;
      }

      if (usage.accessKind === DataAssetAccessKind.Write) {
        known.writes = true;
      }

      const seen: string | undefined = usage.lastSeenAt
        ? OneUptimeDate.fromString(usage.lastSeenAt).toISOString()
        : undefined;

      if (seen && (!known.lastSeenAt || seen > known.lastSeenAt)) {
        known.lastSeenAt = seen;
      }

      byService.set(key, known);
    }

    return Array.from(byService.values());
  }

  /*
   * How many of each service's queries of the last day name the column,
   * from the statements its database spans carry; null when they could not
   * be read.
   */
  public static async countColumnQueries(data: {
    projectId: ObjectID;
    serviceIds: Array<string>;
    table: string;
    column: string;
    now: Date;
  }): Promise<Map<string, number> | null> {
    if (data.serviceIds.length === 0) {
      return new Map();
    }

    try {
      const result: Results = await SpanService.executeQuery(
        buildColumnQueryStatement({
          ...data,
          since: OneUptimeDate.addRemoveHours(
            data.now,
            -COLUMN_QUERY_WINDOW_IN_HOURS,
          ),
        }),
      );
      const response: ResponseJSON<JSONObject> =
        await result.json<JSONObject>();
      const counts: Map<string, number> = new Map();

      for (const row of (response.data || []) as Array<JSONObject>) {
        const count: number = Number(row["queryCount"]);

        if (Number.isFinite(count) && count > 0) {
          counts.set(String(row["serviceId"] || ""), Math.floor(count));
        }
      }

      return counts;
    } catch {
      return null;
    }
  }
}

/*
 * The read: the services' client spans of the window whose statement names
 * the table and, as a whole word, the column, counted per service.
 */
export function buildColumnQueryStatement(data: {
  projectId: ObjectID;
  serviceIds: Array<string>;
  table: string;
  column: string;
  since: Date;
}): Statement {
  const statement: Statement = SQL`SELECT serviceId, count() AS queryCount FROM (SELECT toString(primaryEntityId) AS serviceId, multiIf(attributes['db.query.text'] != '', attributes['db.query.text'], attributes['db.statement']) AS statementText FROM `;

  statement.append(`${getClickhouseDatabaseName()}.${AnalyticsTableName.Span}`);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND primaryEntityType = ${{
      type: TableColumnType.Text,
      value: ServiceType.OpenTelemetry,
    }} AND kind = ${{
      type: TableColumnType.Text,
      value: SpanKind.Client,
    }} AND startTime >= ${{
      type: TableColumnType.Date,
      value: data.since,
    }} AND has(${{
      type: TableColumnType.ArrayText,
      value: data.serviceIds,
    }}, toString(primaryEntityId))) WHERE statementText != '' AND positionCaseInsensitive(statementText, ${{
      type: TableColumnType.Text,
      value: data.table,
    }}) > 0 AND match(statementText, ${{
      type: TableColumnType.Text,
      value: columnPattern(data.column),
    }}) GROUP BY serviceId`,
  );
  statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

  return statement;
}
