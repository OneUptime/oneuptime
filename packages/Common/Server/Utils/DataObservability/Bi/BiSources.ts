import { DataBiSource } from "../../../../Types/DataObservability/DataBiLineage";
import { isCollectorEngine } from "../DataObservabilityEngines";
import { isSameBiHost, readBiEngine } from "./BiMatching";
import { BiTableRef, getBiTableKey } from "./BiTables";

/*
 * WHERE A BI TOOL'S DATA COMES FROM: ITS DATA SOURCES, AND THE TABLES READ
 * FROM EACH.
 *
 * A data source is what the tool says its data comes from: a database by
 * its engine, server and database; a file, a web page or a dataflow by
 * where it is. Power BI lists each dataset's data sources itself
 * (PowerBiScan); for every other tool a table's database is its source.
 *
 * Each reader - a Power BI dataset, or another tool's dashboard - counts
 * once for each of its sources, and each table it reads is put with the
 * source it comes from: one of its own sources of the same engine and
 * database, on the same server where both name one; or, where none fits, a
 * source made from the table's own database.
 */

// A data source, how many datasets or dashboards read it, and the tables read from it.
export interface BiSourceRead {
  source: DataBiSource;
  readerCount: number;
  tables: Array<BiTableRef>;
}

// A dataset or dashboard: the sources it says it reads, and the tables it reads.
export interface BiSourceReader {
  sources: Array<DataBiSource>;
  tables: Array<BiTableRef>;
}

// What an engine is called, as a data source's type.
const ENGINE_TYPES: Readonly<Record<string, string>> = {
  sqlserver: "SQL Server",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  oracle: "Oracle",
  redshift: "Amazon Redshift",
  snowflake: "Snowflake",
  bigquery: "Google BigQuery",
  clickhouse: "ClickHouse",
  databricks: "Databricks",
  athena: "Amazon Athena",
  mongodb: "MongoDB",
  dataverse: "Microsoft Dataverse",
  teradata: "Teradata",
  db2: "IBM Db2",
  sybase: "Sybase",
  saphana: "SAP HANA",
  informix: "Informix",
  vertica: "Vertica",
  impala: "Impala",
};

// A database as a data source: its engine named only where OneUptime can watch it.
export function getBiDatabaseSource(
  engine: string,
  server: string | null,
  database: string | null,
): DataBiSource {
  const known: string | null = isCollectorEngine(engine)
    ? engine
    : readBiEngine(engine);

  return {
    type: ENGINE_TYPES[known || engine] || engine,
    engine: known && isCollectorEngine(known) ? known : null,
    server: server || null,
    database: database || null,
    location: null,
  };
}

// The source a table comes from, by its own database: where no listed source fits it.
export function getBiTableSource(ref: BiTableRef): DataBiSource {
  return ref.engine
    ? getBiDatabaseSource(ref.engine, ref.host, ref.database)
    : {
        type: "Database",
        engine: null,
        server: ref.host,
        database: ref.database,
        location: null,
      };
}

export function getBiSourceKey(source: DataBiSource): string {
  return [
    source.type,
    source.engine,
    source.server,
    source.database,
    source.location,
  ]
    .map((part: string | null): string => {
      return (part || "").toLowerCase();
    })
    .join("\u0000");
}

// Each source once.
export function uniqueSources(
  sources: Array<DataBiSource>,
): Array<DataBiSource> {
  const seen: Set<string> = new Set();

  return sources.filter((source: DataBiSource): boolean => {
    const key: string = getBiSourceKey(source);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function lower(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

/*
 * How well a source fits a table: 0 when it cannot be where the table is -
 * another engine, another database, another server - and more the more it
 * names that agrees.
 */
export function getBiSourceFit(source: DataBiSource, ref: BiTableRef): number {
  const engine: string | null = readBiEngine(ref.engine);

  if (!source.engine || !engine) {
    return 0;
  }

  if (
    source.engine !== engine &&
    !(
      [source.engine, engine].includes("redshift") &&
      [source.engine, engine].includes("postgresql")
    )
  ) {
    return 0;
  }

  let fit: number = 1;

  if (source.database && ref.database) {
    if (lower(source.database) !== lower(ref.database)) {
      return 0;
    }

    fit += 2;
  }

  if (source.server && ref.host) {
    if (!isSameBiHost(source.server, ref.host)) {
      return 0;
    }

    fit += 1;
  }

  return fit;
}

/*
 * Every source the readers name, with how many read it and the tables
 * read from it: each reader's tables put with the one of its own sources
 * that fits best, or with a source made from the table's database.
 */
export function collectBiSources(
  readers: Array<BiSourceReader>,
): Array<BiSourceRead> {
  const collected: Map<
    string,
    { source: DataBiSource; readers: number; tables: Map<string, BiTableRef> }
  > = new Map();
  const entry: (source: DataBiSource) => {
    source: DataBiSource;
    readers: number;
    tables: Map<string, BiTableRef>;
  } = (source: DataBiSource) => {
    const key: string = getBiSourceKey(source);
    let found:
      | {
          source: DataBiSource;
          readers: number;
          tables: Map<string, BiTableRef>;
        }
      | undefined = collected.get(key);

    if (!found) {
      found = { source, readers: 0, tables: new Map() };
      collected.set(key, found);
    }

    return found;
  };

  for (const reader of readers) {
    const read: Set<string> = new Set();
    const own: Array<DataBiSource> = uniqueSources(reader.sources);

    for (const source of own) {
      entry(source);
    }

    for (const ref of reader.tables) {
      let best: DataBiSource | null = null;
      let bestFit: number = 0;

      for (const source of own) {
        const fit: number = getBiSourceFit(source, ref);

        if (fit > bestFit) {
          best = source;
          bestFit = fit;
        }
      }

      const source: DataBiSource = best || getBiTableSource(ref);

      entry(source).tables.set(getBiTableKey(ref), ref);
      read.add(getBiSourceKey(source));
    }

    for (const source of own) {
      read.add(getBiSourceKey(source));
    }

    for (const key of read) {
      collected.get(key)!.readers++;
    }
  }

  return Array.from(collected.values()).map(
    (found: {
      source: DataBiSource;
      readers: number;
      tables: Map<string, BiTableRef>;
    }): BiSourceRead => {
      return {
        source: found.source,
        readerCount: found.readers,
        tables: Array.from(found.tables.values()),
      };
    },
  );
}
