/*
 * The tools a project can bring its setup over from (Project Settings >
 * Import from another tool). The value is stored on ToolImportRun.source and
 * ToolImportRecord.source, so a value never changes once shipped.
 *
 * Adding a tool is one adapter on the server (Server/Utils/ToolImport/
 * Adapters/<Tool>), one entry here and one in ToolImportCatalog: the
 * preview, the import, the report and the page are shared by every tool.
 */
enum ToolImportSource {
  OpsGenie = "OpsGenie",
  IncidentIo = "IncidentIo",
  PagerDuty = "PagerDuty",
  SplunkOnCall = "SplunkOnCall",
  GrafanaOnCall = "GrafanaOnCall",
}

export default ToolImportSource;

/*
 * Every tool, in the order the page offers them and the docs list them:
 * Opsgenie first, because Atlassian is retiring it, then the on-call tools
 * teams most often leave.
 */
export const AllToolImportSources: Array<ToolImportSource> = [
  ToolImportSource.OpsGenie,
  ToolImportSource.PagerDuty,
  ToolImportSource.IncidentIo,
  ToolImportSource.SplunkOnCall,
  ToolImportSource.GrafanaOnCall,
];

export function isToolImportSource(value: unknown): value is ToolImportSource {
  return (
    typeof value === "string" &&
    (AllToolImportSources as Array<string>).includes(value)
  );
}
