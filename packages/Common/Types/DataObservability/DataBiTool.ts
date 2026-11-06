/*
 * THE TOOLS DATA OBSERVABILITY READS CONSUMERS FROM.
 *
 * Each BI tool's dashboards, and the tables behind them, are read on a
 * schedule (DataBiSync) with the connection's own credentials, so a late
 * or broken table's alert can name the dashboards people open on it. A reverse
 * ETL tool's syncs are read the same way: a sync that copies a table into a
 * CRM depends on that table just as a dashboard does.
 */
enum DataBiTool {
  Metabase = "Metabase",
  Superset = "Superset",
  Tableau = "Tableau",
  Looker = "Looker",
  PowerBI = "Power BI",
  Hightouch = "Hightouch",
  Census = "Census",
}

export default DataBiTool;

export const DATA_BI_TOOLS: ReadonlyArray<DataBiTool> = [
  DataBiTool.Metabase,
  DataBiTool.Superset,
  DataBiTool.Tableau,
  DataBiTool.Looker,
  DataBiTool.PowerBI,
  DataBiTool.Hightouch,
  DataBiTool.Census,
];

export function isDataBiTool(value: unknown): value is DataBiTool {
  return (
    typeof value === "string" &&
    (DATA_BI_TOOLS as ReadonlyArray<string>).includes(value)
  );
}

/*
 * What each tool's credentials are, as JSON: what the connect form says,
 * and what the connectors read (DataBiConnectors).
 */
export const DATA_BI_TOOL_CREDENTIALS: Readonly<Record<DataBiTool, string>> = {
  [DataBiTool.Metabase]: '{ "apiKey": "mb_..." }',
  [DataBiTool.Superset]: '{ "username": "oneuptime", "password": "..." }',
  [DataBiTool.Tableau]:
    '{ "tokenName": "oneuptime", "tokenSecret": "...", "site": "acme" }',
  [DataBiTool.Looker]: '{ "clientId": "...", "clientSecret": "..." }',
  [DataBiTool.PowerBI]:
    '{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }',
  [DataBiTool.Hightouch]: '{ "apiKey": "..." }',
  [DataBiTool.Census]: '{ "apiKey": "...", "region": "us" }',
};

// Power BI, Hightouch and Census are read from their makers' own APIs: no address to give.
export function needsBaseUrl(tool: DataBiTool): boolean {
  return (
    tool !== DataBiTool.PowerBI &&
    tool !== DataBiTool.Hightouch &&
    tool !== DataBiTool.Census
  );
}
