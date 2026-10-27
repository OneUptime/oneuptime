import ProviderLogo from "Common/Types/ProviderLogo/ProviderLogo";
import ToolImportSource from "Common/Types/ToolImport/ToolImportSource";

/*
 * Each tool's official logo (ToolImportLogo draws it): the picker's tiles,
 * the connect form, the preview, the progress and the earlier imports all
 * show the tool by its own mark. Splunk On-Call and Grafana OnCall are
 * Splunk's and Grafana Labs' products, and carry their makers' logos. A
 * tool added to ToolImportSource gets its logo here; the App tests hold
 * every source to one.
 *
 * React-free, so the App tests read it.
 */
export const TOOL_IMPORT_LOGOS: Readonly<
  Record<ToolImportSource, ProviderLogo>
> = {
  [ToolImportSource.OpsGenie]: ProviderLogo.Opsgenie,
  [ToolImportSource.PagerDuty]: ProviderLogo.PagerDuty,
  [ToolImportSource.IncidentIo]: ProviderLogo.IncidentIo,
  [ToolImportSource.SplunkOnCall]: ProviderLogo.Splunk,
  [ToolImportSource.GrafanaOnCall]: ProviderLogo.Grafana,
  [ToolImportSource.UptimeRobot]: ProviderLogo.UptimeRobot,
  [ToolImportSource.AtlassianStatuspage]: ProviderLogo.AtlassianStatuspage,
  [ToolImportSource.BetterStack]: ProviderLogo.BetterStack,
  [ToolImportSource.Pingdom]: ProviderLogo.Pingdom,
  [ToolImportSource.StatusCake]: ProviderLogo.StatusCake,
  [ToolImportSource.UptimeKuma]: ProviderLogo.UptimeKuma,
};
