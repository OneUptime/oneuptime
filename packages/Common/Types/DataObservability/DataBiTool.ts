/*
 * THE BI TOOLS DATA OBSERVABILITY READS DASHBOARDS FROM.
 *
 * Each tool's dashboards, and the tables behind them, are read on a
 * schedule (DataBiSync) with the connection's own credentials, so a late
 * or broken table's alert can name the dashboards people open on it.
 */
enum DataBiTool {
  Metabase = "Metabase",
  Superset = "Superset",
  Tableau = "Tableau",
  Looker = "Looker",
  PowerBI = "Power BI",
}

export default DataBiTool;

export const DATA_BI_TOOLS: ReadonlyArray<DataBiTool> = [
  DataBiTool.Metabase,
  DataBiTool.Superset,
  DataBiTool.Tableau,
  DataBiTool.Looker,
  DataBiTool.PowerBI,
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
};

// Power BI is read from Microsoft's own API: no address to give.
export function needsBaseUrl(tool: DataBiTool): boolean {
  return tool !== DataBiTool.PowerBI;
}
