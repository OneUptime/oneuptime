import {
  DataBiLineageProblem,
  DataBiLineageSource,
  DataBiLineageSummary,
} from "Common/Types/DataObservability/DataBiLineage";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHY A BI TOOL'S DASHBOARDS ARE, OR ARE NOT, TIED TO WATCHED TABLES, IN
 * WORDS (#9507).
 *
 * Each read keeps a lineage summary on the tool (DataBiLineageSummary):
 * the tables its dashboards read and how many matched, the data sources
 * behind them, and what keeps the rest off a table, worst first. These say
 * it: one line under Tables Matched, the steps the Tables Matched dialog
 * lists - what is wrong, and what to do about it - and each data source's
 * standing. Power BI's own words (its tenant settings, where they are) are
 * values, so every language names them as Power BI's admin portal does.
 */

// Power BI's tenant settings, and where they are, as its admin portal names them.
export const POWER_BI_DETAILED_METADATA_SETTING: string =
  "Enhance admin APIs responses with detailed metadata";
export const POWER_BI_EXPRESSIONS_SETTING: string =
  "Enhance admin APIs responses with DAX and mashup expressions";
export const POWER_BI_SETTINGS_PLACE: string =
  "Tenant settings > Admin API settings";

// A fixed sentence in the reader's language, or in English when it has none.
function translated(translator: Translator, text: string): string {
  return translator.translateText(text) || text;
}

const NO_DATABASES: string = translationKey("No database connected yet");
const NO_TABLES: string = translationKey("Power BI sent no tables");
const NO_QUERIES: string = translationKey("Power BI sent no table queries");
const DATABASES_NOT_CONNECTED: PluralTemplate = {
  one: "{{count}} database not connected",
  other: "{{count}} databases not connected",
};
const TABLES_NOT_WATCHED: PluralTemplate = {
  one: "{{count}} table not watched",
  other: "{{count}} tables not watched",
};
const FROM_DATAFLOWS: string = translationKey("Some data comes from dataflows");
const NOT_DESCRIBED: PluralTemplate = {
  one: "{{count}} dataset Power BI cannot describe",
  other: "{{count}} datasets Power BI cannot describe",
};
const NOT_DATABASES: string = translationKey(
  "Some data comes from files and web pages",
);

export interface BiLineageStep {
  title: string;
  text: string;
}

function databasesNotConnected(summary: DataBiLineageSummary): number {
  return summary.sources.filter((source: DataBiLineageSource): boolean => {
    return Boolean(source.engine) && !source.dataStoreId;
  }).length;
}

// The line under Tables Matched: the first thing keeping dashboards off their tables; null when nothing does.
export function getBiLineageReason(
  translator: Translator,
  summary: DataBiLineageSummary,
): string | null {
  const problem: DataBiLineageProblem | undefined = summary.problems[0];

  switch (problem) {
    case DataBiLineageProblem.NoDatabases:
      return translated(translator, NO_DATABASES);
    case DataBiLineageProblem.NoTablesFromTool:
      return translated(translator, NO_TABLES);
    case DataBiLineageProblem.NoQueriesFromTool:
      return translated(translator, NO_QUERIES);
    case DataBiLineageProblem.DatabasesNotConnected:
      return translator.translatePlural(
        DATABASES_NOT_CONNECTED,
        databasesNotConnected(summary),
      );
    case DataBiLineageProblem.TablesNotWatched:
      return translator.translatePlural(
        TABLES_NOT_WATCHED,
        summary.unwatchedTables.length,
      );
    case DataBiLineageProblem.Dataflows:
      return translated(translator, FROM_DATAFLOWS);
    case DataBiLineageProblem.SchemaErrors:
      return translator.translatePlural(
        NOT_DESCRIBED,
        summary.datasets?.withSchemaError || 0,
      );
    case DataBiLineageProblem.NotDatabases:
      return translated(translator, NOT_DATABASES);
    default:
      return null;
  }
}

const STEP_TITLES: Readonly<Record<DataBiLineageProblem, string>> = {
  [DataBiLineageProblem.NoDatabases]: translationKey("Connect Your Databases"),
  [DataBiLineageProblem.NoTablesFromTool]: translationKey(
    "Let Power BI Describe Its Tables",
  ),
  [DataBiLineageProblem.NoQueriesFromTool]: translationKey(
    "Let Power BI Share Its Queries",
  ),
  [DataBiLineageProblem.DatabasesNotConnected]: translationKey(
    "Connect the Databases Your Dashboards Read",
  ),
  [DataBiLineageProblem.TablesNotWatched]: translationKey(
    "Watch the Tables Your Dashboards Read",
  ),
  [DataBiLineageProblem.Dataflows]: translationKey("Data From Dataflows"),
  [DataBiLineageProblem.SchemaErrors]: translationKey(
    "Datasets Power BI Cannot Describe",
  ),
  [DataBiLineageProblem.NotDatabases]: translationKey(
    "Data From Files and Web Pages",
  ),
};

const NO_DATABASES_TEXT: string = translationKey(
  "No database is connected to OneUptime yet, so there is no table to tie a dashboard to. Connect the databases your dashboards read, listed below.",
);
const NO_TABLES_TEXT: PluralTemplate = {
  one: "Power BI described {{count}} dataset without its tables. In Power BI's admin portal, under {{place}}, turn on {{detailedMetadata}} and {{expressions}} for the security group that holds this service principal. Power BI then describes a dataset's tables once it is refreshed or republished, and the next read matches them.",
  other:
    "Power BI described {{count}} datasets without their tables. In Power BI's admin portal, under {{place}}, turn on {{detailedMetadata}} and {{expressions}} for the security group that holds this service principal. Power BI then describes a dataset's tables once it is refreshed or republished, and the next read matches them.",
};
const NO_QUERIES_TEXT: string = translationKey(
  "Power BI named the datasets' tables but not the queries that load them, so OneUptime cannot tell which database tables they read. In Power BI's admin portal, under {{place}}, turn on {{expressions}}.",
);
const DATABASES_NOT_CONNECTED_TEXT: PluralTemplate = {
  one: "{{count}} database your dashboards read is not connected to OneUptime. Connect it below: its tables are matched at the first read after they are collected.",
  other:
    "{{count}} databases your dashboards read are not connected to OneUptime. Connect them below: their tables are matched at the first read after they are collected.",
};
const TABLES_NOT_WATCHED_TEXT: string = translationKey(
  "These tables are in databases OneUptime watches, but are not watched: {{tables}}. They may be left out of the database's scan, or not collected yet.",
);
const DATAFLOWS_TEXT: PluralTemplate = {
  one: "{{count}} dataset reads from Power BI dataflows. OneUptime does not read which tables a dataflow loads yet, so its tables are not matched.",
  other:
    "{{count}} datasets read from Power BI dataflows. OneUptime does not read which tables a dataflow loads yet, so their tables are not matched.",
};
const SCHEMA_ERRORS_TEXT: PluralTemplate = {
  one: "Power BI could not describe {{count}} dataset, and said: {{error}} It does not describe real-time datasets, datasets on a live connection to Analysis Services, Excel workbooks, or datasets over 1 GB on shared capacity.",
  other:
    "Power BI could not describe {{count}} datasets, and said: {{error}} It does not describe real-time datasets, datasets on a live connection to Analysis Services, Excel workbooks, or datasets over 1 GB on shared capacity.",
};
const NOT_DATABASES_TEXT: string = translationKey(
  "Some dashboards read files, SharePoint, web pages or other sources that are not database tables, so there is no table to tie them to. The Lineage Map draws them with the data sources Power BI names.",
);

// A problem as a step: what is wrong, and what to do about it.
export function getBiLineageStep(
  translator: Translator,
  problem: DataBiLineageProblem,
  summary: DataBiLineageSummary,
): BiLineageStep {
  const title: string = translated(translator, STEP_TITLES[problem]);
  const settings: Record<string, string> = {
    place: POWER_BI_SETTINGS_PLACE,
    detailedMetadata: POWER_BI_DETAILED_METADATA_SETTING,
    expressions: POWER_BI_EXPRESSIONS_SETTING,
  };

  switch (problem) {
    case DataBiLineageProblem.NoDatabases:
      return { title, text: translated(translator, NO_DATABASES_TEXT) };
    case DataBiLineageProblem.NoTablesFromTool:
      return {
        title,
        text: translator.translatePlural(
          NO_TABLES_TEXT,
          summary.datasets?.count || 0,
          settings,
        ),
      };
    case DataBiLineageProblem.NoQueriesFromTool:
      return {
        title,
        text: translator.translateTemplate(NO_QUERIES_TEXT, settings),
      };
    case DataBiLineageProblem.DatabasesNotConnected:
      return {
        title,
        text: translator.translatePlural(
          DATABASES_NOT_CONNECTED_TEXT,
          databasesNotConnected(summary),
        ),
      };
    case DataBiLineageProblem.TablesNotWatched:
      return {
        title,
        text: translator.translateTemplate(TABLES_NOT_WATCHED_TEXT, {
          tables: summary.unwatchedTables.join(", "),
        }),
      };
    case DataBiLineageProblem.Dataflows:
      return {
        title,
        text: translator.translatePlural(
          DATAFLOWS_TEXT,
          summary.datasets?.readingDataflows || 0,
        ),
      };
    case DataBiLineageProblem.SchemaErrors:
      return {
        title,
        text: translator.translatePlural(
          SCHEMA_ERRORS_TEXT,
          summary.datasets?.withSchemaError || 0,
          {
            error: summary.datasets?.schemaError || "",
          },
        ),
      };
    default:
      return { title, text: translated(translator, NOT_DATABASES_TEXT) };
  }
}

const DASHBOARDS_READ: PluralTemplate = {
  one: "{{count}} dashboard read",
  other: "{{count}} dashboards read",
};
const ON_DATASETS: PluralTemplate = {
  one: "built on {{count}} dataset",
  other: "built on {{count}} datasets",
};
const TABLES_WATCHED: PluralTemplate = {
  one: "{{matched}} of {{count}} table watched",
  other: "{{matched}} of {{count}} tables watched",
};
const NO_TABLES_READ: string = translationKey("no database tables read");

// What the read found, in a line: "783 dashboards read · built on 59 datasets · 0 of 12 tables watched".
export function getBiLineageFacts(
  translator: Translator,
  summary: DataBiLineageSummary,
): Array<string> {
  return [
    translator.translatePlural(DASHBOARDS_READ, summary.dashboardCount),
    ...(summary.datasets
      ? [translator.translatePlural(ON_DATASETS, summary.datasets.count)]
      : []),
    summary.tableCount > 0
      ? translator.translatePlural(TABLES_WATCHED, summary.tableCount, {
          matched: translator.formatNumber(summary.matchedTableCount),
        })
      : translated(translator, NO_TABLES_READ),
  ];
}

export enum BiSourceStanding {
  Watched = "Watched",
  NotConnected = "NotConnected",
  Elsewhere = "Elsewhere",
}

const WATCHED_AS: string = translationKey("Watched as {{name}}");
const WATCHED: string = translationKey("Watched");
const NOT_CONNECTED: string = translationKey("Not connected");
const NOT_WATCHABLE: string = translationKey("Not a database OneUptime reads");
const DATASETS: PluralTemplate = {
  one: "{{count}} dataset",
  other: "{{count}} datasets",
};
const DASHBOARDS: PluralTemplate = {
  one: "{{count}} dashboard",
  other: "{{count}} dashboards",
};

// Whether OneUptime watches a source, can, or cannot: and in words.
export function getBiSourceStanding(
  translator: Translator,
  source: DataBiLineageSource,
): { standing: BiSourceStanding; text: string } {
  if (source.dataStoreId) {
    return {
      standing: BiSourceStanding.Watched,
      text: source.dataStoreName
        ? translator.translateTemplate(WATCHED_AS, {
            name: source.dataStoreName,
          })
        : translated(translator, WATCHED),
    };
  }

  if (source.engine) {
    return {
      standing: BiSourceStanding.NotConnected,
      text: translated(translator, NOT_CONNECTED),
    };
  }

  return {
    standing: BiSourceStanding.Elsewhere,
    text: translated(translator, NOT_WATCHABLE),
  };
}

// What reads a source, and how many of its tables are watched: "12 datasets · 3 of 5 tables watched".
export function getBiSourceFacts(
  translator: Translator,
  summary: DataBiLineageSummary,
  source: DataBiLineageSource,
): Array<string> {
  return [
    translator.translatePlural(
      summary.datasets ? DATASETS : DASHBOARDS,
      source.readerCount,
    ),
    ...(source.tableCount > 0
      ? [
          translator.translatePlural(TABLES_WATCHED, source.tableCount, {
            matched: translator.formatNumber(source.matchedTableCount),
          }),
        ]
      : []),
  ];
}
