import LogSeverity from "../../../../Types/Log/LogSeverity";

export interface SeverityTheme {
  badgeClass: string;
  dotClass: string;
  borderClass: string;
  textClass: string;
}

const severityThemeMap: Record<string, SeverityTheme> = {
  [LogSeverity.Fatal]: {
    badgeClass: "bg-rose-950/80 text-rose-100 ring-rose-500/40",
    dotClass: "bg-rose-500",
    borderClass: "border-rose-500/50",
    textClass: "text-rose-100",
  },
  [LogSeverity.Error]: {
    badgeClass: "bg-rose-900/60 text-rose-100 ring-rose-500/30",
    dotClass: "bg-rose-400",
    borderClass: "border-rose-500/40",
    textClass: "text-rose-100",
  },
  [LogSeverity.Warning]: {
    badgeClass: "bg-amber-900/50 text-amber-100 ring-amber-500/30",
    dotClass: "bg-amber-400",
    borderClass: "border-amber-400/40",
    textClass: "text-amber-100",
  },
  [LogSeverity.Information]: {
    badgeClass: "bg-sky-900/50 text-sky-100 ring-sky-500/30",
    dotClass: "bg-sky-400",
    borderClass: "border-sky-400/40",
    textClass: "text-sky-100",
  },
  [LogSeverity.Debug]: {
    badgeClass: "bg-purple-900/50 text-purple-100 ring-purple-500/30",
    dotClass: "bg-purple-400",
    borderClass: "border-purple-500/30",
    textClass: "text-purple-100",
  },
  [LogSeverity.Trace]: {
    badgeClass: "bg-slate-900/60 text-slate-300 ring-slate-500/20",
    dotClass: "bg-slate-400",
    borderClass: "border-slate-600/40",
    textClass: "text-slate-200",
  },
};

const defaultTheme: SeverityTheme = {
  badgeClass: "bg-slate-800/60 text-slate-300 ring-slate-600/20",
  dotClass: "bg-slate-500",
  borderClass: "border-slate-700",
  textClass: "text-slate-200",
};

export const getSeverityTheme = (
  severity?: LogSeverity | string | null,
): SeverityTheme => {
  if (!severity) {
    return defaultTheme;
  }

  const normalized: string = severity.toString();
  return severityThemeMap[normalized] || defaultTheme;
};

export default severityThemeMap;
