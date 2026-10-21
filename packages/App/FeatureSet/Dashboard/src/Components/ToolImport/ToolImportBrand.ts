import ToolImportSource from "Common/Types/ToolImport/ToolImportSource";

/*
 * How each tool's tile looks: its initial on a square in a colour of its
 * own (ToolImportLogo draws it). A tool added to ToolImportSource gets its
 * colour and initial here; the App tests hold every source to one.
 *
 * React-free, so the App tests read it.
 */

export interface ToolImportBrand {
  // A solid colour the white initial reads on, in both themes.
  color: string;
  initial: string;
}

export const TOOL_IMPORT_BRANDS: Record<ToolImportSource, ToolImportBrand> = {
  [ToolImportSource.OpsGenie]: { color: "#2563EB", initial: "O" },
  [ToolImportSource.PagerDuty]: { color: "#047C2A", initial: "P" },
  [ToolImportSource.IncidentIo]: { color: "#E5484D", initial: "i" },
  [ToolImportSource.SplunkOnCall]: { color: "#BE185D", initial: "S" },
  [ToolImportSource.GrafanaOnCall]: { color: "#C2410C", initial: "G" },
  [ToolImportSource.UptimeRobot]: { color: "#15803D", initial: "U" },
  [ToolImportSource.AtlassianStatuspage]: { color: "#0052CC", initial: "S" },
  [ToolImportSource.BetterStack]: { color: "#4338CA", initial: "B" },
  [ToolImportSource.Pingdom]: { color: "#B45309", initial: "P" },
  [ToolImportSource.StatusCake]: { color: "#0369A1", initial: "S" },
  [ToolImportSource.UptimeKuma]: { color: "#0F766E", initial: "K" },
};

// A tool this build has no brand for still gets a tile.
export const TOOL_IMPORT_FALLBACK_BRAND: ToolImportBrand = {
  color: "#6B7280",
  initial: "?",
};
