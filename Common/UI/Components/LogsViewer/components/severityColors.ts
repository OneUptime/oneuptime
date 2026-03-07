import LogSeverity from "../../../../Types/Log/LogSeverity";

export interface SeverityColor {
  fill: string;
  label: string;
}

const severityColorMap: Record<string, SeverityColor> = {
  [LogSeverity.Fatal]: { fill: "#e11d48", label: "Fatal" },
  [LogSeverity.Error]: { fill: "#fb7185", label: "Error" },
  [LogSeverity.Warning]: { fill: "#fbbf24", label: "Warning" },
  [LogSeverity.Information]: { fill: "#38bdf8", label: "Info" },
  [LogSeverity.Debug]: { fill: "#a78bfa", label: "Debug" },
  [LogSeverity.Trace]: { fill: "#94a3b8", label: "Trace" },
  Unspecified: { fill: "#64748b", label: "Unspecified" },
};

const defaultSeverityColor: SeverityColor = {
  fill: "#64748b",
  label: "Unknown",
};

export function getSeverityColor(severity: string): SeverityColor {
  return severityColorMap[severity] || defaultSeverityColor;
}

export function getAllSeverityKeys(): Array<string> {
  return Object.keys(severityColorMap);
}

export default severityColorMap;
