import { readPage } from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";
import CompareCriteria from "Common/Server/Utils/Monitor/Criteria/CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import {
  DatabaseMetricCategory,
  DatabaseMetricDefinition,
  DatabaseMetricGroup,
  getAllDatabaseMetrics,
  getDatabaseMetricCategoryOrder,
  getDatabaseMetricsByCategory,
} from "Common/Types/Monitor/DatabaseMetricCatalog";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import {
  DEFAULT_DATABASE_CONNECTION_TIMEOUT_IN_MS,
  DEFAULT_DATABASE_METRIC_GROUPS,
  DEFAULT_DATABASE_STATEMENT_TIMEOUT_IN_MS,
  MonitorStepDatabaseMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDatabaseMonitor";
import {
  MAX_SQL_CONNECTION_TIMEOUT_IN_MS,
  MAX_SQL_STATEMENT_TIMEOUT_IN_MS,
} from "Common/Types/Monitor/MonitorStepSqlMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import SqlDatabaseType, {
  SqlDatabaseTypeUtil,
} from "Common/Types/Monitor/SqlDatabaseType";
import ObjectID from "Common/Types/ObjectID";
import fs from "fs";
import path from "path";

/*
 * What the English Database Health Monitor page says about the product, held
 * to the code that makes it true: every metric table row against the metric
 * catalog the probe and the metric picker share, the ports, timeouts and
 * groups the form starts with, the criteria's filter types and comparisons,
 * the default offline and online criteria, the JavaScript expression's
 * variables, and how a threshold is read. The SQL Server and Azure grants are
 * held by DatabaseHealthMonitorDocs, and the translations to this page by
 * OtelDatabaseCephRollupDocsTranslations.
 */

const PAGE: string = "monitor/database-health-monitor";
const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function englishPage(): string {
  return readPage("en", PAGE);
}

// The text of a page from one heading line to the next heading of a level.
function sectionOf(page: string, heading: string, level: number): string {
  const lines: Array<string> = page.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const end: number = lines.findIndex((line: string, index: number) => {
    return (
      index > start &&
      new RegExp(`^#{1,${level}} `).test(line) &&
      !line.startsWith(`${"#".repeat(level + 1)} `)
    );
  });

  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

// The body rows of the first Markdown table in a text, as trimmed cells.
function firstTable(text: string): Array<Array<string>> {
  const lines: Array<string> = text.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("|");
  });

  expect(start).toBeGreaterThanOrEqual(0);

  const rows: Array<Array<string>> = [];

  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows;
}

// The rows of the Markdown table whose header row is `header`.
function tableAfter(page: string, header: string): Array<Array<string>> {
  const start: number = page.indexOf(`\n${header}\n`);

  expect({ header, found: start >= 0 }).toEqual({ header, found: true });

  return firstTable(page.slice(start + 1));
}

/*
 * The block of a source file that starts at `opening` and ends at the brace
 * that closes it.
 */
function braceBlock(source: string, opening: string): string {
  const start: number = source.indexOf(opening);

  expect({ opening, found: start >= 0 }).toEqual({ opening, found: true });

  let depth: number = 0;

  for (let index: number = start; index < source.length; index++) {
    if (source[index] === "{") {
      depth++;
    } else if (source[index] === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return source.slice(start);
}

// How the page writes each engine in a metric table's Engines column.
const ENGINE_ON_PAGE: Record<SqlDatabaseType, string> = {
  [SqlDatabaseType.PostgreSQL]: "PostgreSQL",
  [SqlDatabaseType.MySQL]: "MySQL",
  [SqlDatabaseType.MicrosoftSqlServer]: "SQL Server",
};

function expectedMetricRow(metric: DatabaseMetricDefinition): Array<string> {
  return [
    `**${metric.friendlyName}**${metric.unit ? ` (${metric.unit})` : ""}`,
    `\`${metric.metricType}\``,
    metric.group,
    metric.engines
      .map((engine: SqlDatabaseType): string => {
        return ENGINE_ON_PAGE[engine];
      })
      .join(", "),
  ];
}

const NUMBER_WORDS: Record<number, string> = {
  8: "eight",
  41: "Forty-one",
};

describe("the Database Health Monitor page's metric tables", () => {
  const metricsSection: () => string = (): string => {
    return sectionOf(englishPage(), "## Metrics collected", 2);
  };

  it("has one table per catalog category, in the picker's order", () => {
    const headings: Array<string> = metricsSection()
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("### ");
      })
      .map((line: string): string => {
        return line.slice(4);
      });

    expect(headings).toEqual(getDatabaseMetricCategoryOrder());
  });

  it("lists every catalog metric with its series, group, unit and engines", () => {
    for (const category of getDatabaseMetricCategoryOrder()) {
      const rows: Array<Array<string>> = firstTable(
        sectionOf(metricsSection(), `### ${category}`, 3),
      );

      expect({ category, rows }).toEqual({
        category,
        rows: getDatabaseMetricsByCategory(category).map(expectedMetricRow),
      });
    }
  });

  it("counts the series and the categories as the catalog does", () => {
    const metrics: number = getAllDatabaseMetrics().length;
    const categories: number = Object.values(DatabaseMetricCategory).length;

    expect(metricsSection()).toContain(
      `${NUMBER_WORDS[metrics]} series across ${NUMBER_WORDS[categories]} categories.`,
    );
  });
});

describe("the Database Health Monitor page's configuration", () => {
  it("gives each engine the port the form starts with", () => {
    const rows: Array<Array<string>> = tableAfter(
      englishPage(),
      "| Database | Default port |",
    );

    expect(
      rows.map((cells: Array<string>): Array<string> => {
        return [cells[0] as string, cells[1] as string];
      }),
    ).toEqual(
      SqlDatabaseTypeUtil.getSupportedDatabaseTypes().map(
        (type: SqlDatabaseType): Array<string> => {
          return [
            `**${type}**`,
            `\`${SqlDatabaseTypeUtil.getDefaultPort(type)}\``,
          ];
        },
      ),
    );
  });

  it("gives the timeouts' defaults and maxima, and lowers a value above the maximum", () => {
    const rows: Array<Array<string>> = tableAfter(
      englishPage(),
      "| Field | Default | Maximum | What it limits |",
    );

    expect(
      rows.map((cells: Array<string>): Array<string> => {
        return cells.slice(0, 3);
      }),
    ).toEqual([
      [
        "**Connection Timeout (ms)**",
        `\`${DEFAULT_DATABASE_CONNECTION_TIMEOUT_IN_MS}\``,
        `\`${MAX_SQL_CONNECTION_TIMEOUT_IN_MS}\``,
      ],
      [
        "**Statement Timeout (ms)**",
        `\`${DEFAULT_DATABASE_STATEMENT_TIMEOUT_IN_MS}\``,
        `\`${MAX_SQL_STATEMENT_TIMEOUT_IN_MS}\``,
      ],
    ]);

    const clamped: { connection: number; statement: number } = ((): {
      connection: number;
      statement: number;
    } => {
      const config: ReturnType<typeof MonitorStepDatabaseMonitorUtil.fromJSON> =
        MonitorStepDatabaseMonitorUtil.fromJSON({
          connectionTimeoutInMs: MAX_SQL_CONNECTION_TIMEOUT_IN_MS + 1,
          statementTimeoutInMs: MAX_SQL_STATEMENT_TIMEOUT_IN_MS + 1,
        });

      return {
        connection: config.connectionTimeoutInMs,
        statement: config.statementTimeoutInMs,
      };
    })();

    expect(clamped).toEqual({
      connection: MAX_SQL_CONNECTION_TIMEOUT_IN_MS,
      statement: MAX_SQL_STATEMENT_TIMEOUT_IN_MS,
    });
    expect(englishPage()).toContain(
      "A value above the maximum is lowered to the maximum.",
    );
  });

  it("starts with every metric group on, and puts every group back when all are cleared", () => {
    expect([...DEFAULT_DATABASE_METRIC_GROUPS]).toEqual(
      Object.values(DatabaseMetricGroup),
    );
    expect(MonitorStepDatabaseMonitorUtil.sanitizeMetricGroups([])).toEqual(
      Object.values(DatabaseMetricGroup),
    );
    expect(englishPage()).toContain("All are on by default;");
    expect(englishPage()).toContain(
      "an empty list is normalized back to all groups",
    );
  });

  it("lists the metric groups the probe reports, in its order", () => {
    const groups: Array<string> = tableAfter(
      englishPage(),
      "| Group | What it collects | Needs |",
    ).map((cells: Array<string>): string => {
      return cells[0] as string;
    });

    expect(groups).toEqual(Object.values(DatabaseMetricGroup));
  });
});

describe("the Database Health Monitor page's criteria", () => {
  const CRITERIA_FORM: string =
    "App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter.ts";

  // The enum member names inside a source block, as the enum's values.
  function membersIn<T extends string>(
    block: string,
    enumName: string,
    values: Record<string, T>,
  ): Array<T> {
    return Array.from(
      block.matchAll(new RegExp(`${enumName}\\.(\\w+)`, "g")),
    ).map((match: RegExpMatchArray): T => {
      const member: string = match[1] as string;

      expect({ member, known: member in values }).toEqual({
        member,
        known: true,
      });

      return values[member] as T;
    });
  }

  it("lists the filter types the criteria form offers a Database Health monitor", () => {
    const offered: Array<CheckOn> = membersIn(
      braceBlock(
        readSource(CRITERIA_FORM),
        "if (monitorType === MonitorType.Database) {",
      ),
      "CheckOn",
      CheckOn as unknown as Record<string, CheckOn>,
    );

    const onPage: Array<string> = tableAfter(
      englishPage(),
      "| Filter type | What it checks |",
    ).map((cells: Array<string>): string => {
      return (cells[0] as string).replace(/\*\*/g, "");
    });

    expect(onPage).toEqual(offered);
  });

  it("names the comparisons Database Metric offers, in the form's order", () => {
    const comparisons: Array<FilterType> = membersIn(
      braceBlock(
        readSource(CRITERIA_FORM),
        "if (checkOn === CheckOn.DatabaseMetric) {",
      ),
      "FilterType",
      FilterType as unknown as Record<string, FilterType>,
    );

    expect(comparisons.length).toBeGreaterThan(1);

    const written: string = `${comparisons.slice(0, -1).join(", ")} or ${comparisons[comparisons.length - 1]}`;

    expect(englishPage()).toContain(
      `Pick a metric, then compare it: ${written}.`,
    );
  });

  it("offers Contains on Database Collection Error", () => {
    const collectionError: Array<FilterType> = membersIn(
      braceBlock(
        readSource(CRITERIA_FORM),
        "if (checkOn === CheckOn.DatabaseCollectionError) {",
      ),
      "FilterType",
      FilterType as unknown as Record<string, FilterType>,
    );

    expect(collectionError).toContain(FilterType.Contains);
    expect(englishPage()).toContain(
      "or use Contains to watch for one specific group",
    );
  });

  it("reads a threshold as a whole number", () => {
    expect(CompareCriteria.convertToNumber("90.5")).toBe(90);
    expect(englishPage()).toContain(
      "Thresholds are whole numbers. Write `90`, not `90.5`",
    );
  });

  it("starts the monitor with the offline and online criteria the example builds on", () => {
    const ids: {
      monitorStatusId: ObjectID;
      incidentSeverityId: ObjectID;
      alertSeverityId: ObjectID;
    } = {
      monitorStatusId: ObjectID.generate(),
      incidentSeverityId: ObjectID.generate(),
      alertSeverityId: ObjectID.generate(),
    };

    const offline: CriteriaFilter | undefined =
      MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
        monitorType: MonitorType.Database,
        monitorName: "orders-db",
        ...ids,
      }).data?.filters[0];

    const online: CriteriaFilter | undefined =
      MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
        monitorType: MonitorType.Database,
        monitorName: "orders-db",
        monitorStatusId: ids.monitorStatusId,
      })?.data?.filters[0];

    expect([offline?.checkOn, offline?.filterType]).toEqual([
      CheckOn.DatabaseIsOnline,
      FilterType.False,
    ]);
    expect([online?.checkOn, online?.filterType]).toEqual([
      CheckOn.DatabaseIsOnline,
      FilterType.True,
    ]);

    const example: Array<Array<string>> = tableAfter(
      englishPage(),
      "| Order | Criteria | Filter |",
    );

    expect(example[0]?.[2]).toBe(
      `\`${CheckOn.DatabaseIsOnline}\` is \`${FilterType.False.toLowerCase()}\`.`,
    );
    expect(example[example.length - 1]?.[2]).toBe(
      `\`${CheckOn.DatabaseIsOnline}\` is \`${FilterType.True.toLowerCase()}\`.`,
    );
  });

  it("lists exactly the variables a JavaScript expression gets", () => {
    const branch: string = braceBlock(
      readSource("Common/Server/Utils/Monitor/MonitorCriteriaEvaluator.ts"),
      "if (input.monitor.monitorType === MonitorType.Database) {",
    );
    const storageMap: string = braceBlock(
      branch.slice(branch.indexOf("storageMap = {")),
      "{",
    );

    // The map's own keys: the first identifier on each top-level line.
    const keys: Array<string> = [];
    let depth: number = 0;

    for (const line of storageMap.split("\n").slice(1)) {
      if (depth === 0) {
        const key: RegExpMatchArray | null = line.match(/^\s*(\w+):/);

        if (key) {
          keys.push(key[1] as string);
        }
      }

      depth += (line.match(/[{(]/g) || []).length;
      depth -= (line.match(/[})]/g) || []).length;
    }

    const onPage: Array<string> = tableAfter(
      englishPage(),
      "| Variable | Type | Description |",
    ).map((cells: Array<string>): string => {
      return (cells[0] as string).replace(/`/g, "");
    });

    expect(onPage).toEqual(keys);
  });
});
