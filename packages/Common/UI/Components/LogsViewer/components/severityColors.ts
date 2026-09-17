import LogSeverity from "../../../../Types/Log/LogSeverity";

export interface SeverityColor {
  fill: string;
  label: string;
}

const severityColorMap: Record<string, SeverityColor> = {
  [LogSeverity.Fatal]: { fill: "#dc2626", label: "Fatal" },
  [LogSeverity.Error]: { fill: "#f87171", label: "Error" },
  [LogSeverity.Warning]: { fill: "#f59e0b", label: "Warning" },
  [LogSeverity.Information]: { fill: "#60a5fa", label: "Info" },
  [LogSeverity.Debug]: { fill: "#a78bfa", label: "Debug" },
  [LogSeverity.Trace]: { fill: "#9ca3af", label: "Trace" },
  Unspecified: { fill: "#cbd5e1", label: "Unspecified" },
};

const defaultSeverityColor: SeverityColor = {
  fill: "#cbd5e1",
  label: "Unknown",
};

export function getSeverityColor(severity: string): SeverityColor {
  return severityColorMap[severity] || defaultSeverityColor;
}

export function getAllSeverityKeys(): Array<string> {
  return Object.keys(severityColorMap);
}

export default severityColorMap;
