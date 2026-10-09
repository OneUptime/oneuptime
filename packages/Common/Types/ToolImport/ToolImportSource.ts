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
  UptimeRobot = "UptimeRobot",
  Pingdom = "Pingdom",
  BetterStack = "BetterStack",
  StatusCake = "StatusCake",
  UptimeKuma = "UptimeKuma",
  AtlassianStatuspage = "AtlassianStatuspage",
}

export default ToolImportSource;

/*
 * Every tool, in the order the page offers them and the docs list them. The
 * on-call and incident tools come first - Opsgenie first, because Atlassian
 * is retiring it, then the on-call tools teams most often leave - and the
 * uptime monitoring and status page tools after them, the most used first.
 * The page shows the two groups apart (ToolImportCatalog's category).
 */
export const AllToolImportSources: Array<ToolImportSource> = [
  ToolImportSource.OpsGenie,
  ToolImportSource.PagerDuty,
  ToolImportSource.IncidentIo,
  ToolImportSource.SplunkOnCall,
  ToolImportSource.GrafanaOnCall,
  ToolImportSource.UptimeRobot,
  ToolImportSource.AtlassianStatuspage,
  ToolImportSource.BetterStack,
  ToolImportSource.Pingdom,
  ToolImportSource.StatusCake,
  ToolImportSource.UptimeKuma,
];

export function isToolImportSource(value: unknown): value is ToolImportSource {
  return (
    typeof value === "string" &&
    (AllToolImportSources as Array<string>).includes(value)
  );
}
