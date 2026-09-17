import LogSeverity from "../../../../Types/Log/LogSeverity";

export interface SeverityTheme {
  badgeClass: string;
  dotClass: string;
  borderClass: string;
  textClass: string;
}

const severityThemeMap: Record<string, SeverityTheme> = {
  [LogSeverity.Fatal]: {
    badgeClass: "bg-rose-50 text-rose-700 ring-rose-200",
    dotClass: "bg-rose-500",
    borderClass: "border-rose-200",
    textClass: "text-gray-800",
  },
  [LogSeverity.Error]: {
    badgeClass: "bg-red-50 text-red-700 ring-red-200",
    dotClass: "bg-red-400",
    borderClass: "border-red-200",
    textClass: "text-gray-800",
  },
  [LogSeverity.Warning]: {
    badgeClass: "bg-amber-50 text-amber-700 ring-amber-200",
    dotClass: "bg-amber-400",
    borderClass: "border-amber-200",
    textClass: "text-gray-800",
  },
  [LogSeverity.Information]: {
    badgeClass: "bg-blue-50 text-blue-700 ring-blue-200",
    dotClass: "bg-blue-400",
    borderClass: "border-blue-200",
    textClass: "text-gray-800",
  },
  [LogSeverity.Debug]: {
    badgeClass: "bg-purple-50 text-purple-700 ring-purple-200",
    dotClass: "bg-purple-400",
    borderClass: "border-purple-200",
    textClass: "text-gray-800",
  },
  [LogSeverity.Trace]: {
    badgeClass: "bg-gray-50 text-gray-600 ring-gray-200",
    dotClass: "bg-gray-400",
    borderClass: "border-gray-200",
    textClass: "text-gray-800",
  },
};

const defaultTheme: SeverityTheme = {
  badgeClass: "bg-gray-50 text-gray-600 ring-gray-200",
  dotClass: "bg-gray-400",
  borderClass: "border-gray-200",
  textClass: "text-gray-800",
};

export const getSeverityTheme: (
  severity?: LogSeverity | string | null,
) => SeverityTheme = (
  severity?: LogSeverity | string | null,
): SeverityTheme => {
  if (!severity) {
    return defaultTheme;
  }

  const normalized: string = severity.toString();
  return severityThemeMap[normalized] || defaultTheme;
};

export default severityThemeMap;
