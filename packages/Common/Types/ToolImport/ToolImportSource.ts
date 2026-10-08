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
}

export default ToolImportSource;

export const AllToolImportSources: Array<ToolImportSource> = [
  ToolImportSource.OpsGenie,
  ToolImportSource.IncidentIo,
];

export function isToolImportSource(value: unknown): value is ToolImportSource {
  return (
    typeof value === "string" &&
    (AllToolImportSources as Array<string>).includes(value)
  );
}
