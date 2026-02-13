export interface ColorTokens {
  // Background
  backgroundPrimary: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
  backgroundElevated: string;

  // Accent
  cardAccent: string;
  backgroundGlass: string;
  iconBackground: string;

  // Gradient
  accentGradientStart: string;
  accentGradientMid: string;
  accentGradientEnd: string;
  accentCyan: string;
  accentCyanBg: string;
  surfaceGlow: string;
  headerGradient: string;
  gradientStart: string;
  gradientEnd: string;

  // Border
  borderDefault: string;
  borderSubtle: string;
  borderGlass: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;

  // Severity
  severityCritical: string;
  severityCriticalBg: string;
  severityMajor: string;
  severityMajorBg: string;
  severityMinor: string;
  severityMinorBg: string;
  severityWarning: string;
  severityWarningBg: string;
  severityInfo: string;
  severityInfoBg: string;

  // State
  stateCreated: string;
  stateAcknowledged: string;
  stateResolved: string;
  stateInvestigating: string;
  stateMuted: string;

  // On-Call
  oncallActive: string;
  oncallActiveBg: string;
  oncallInactive: string;
  oncallInactiveBg: string;

  // Action
  actionPrimary: string;
  actionPrimaryPressed: string;
  actionDestructive: string;
  actionDestructivePressed: string;

  // Status
  statusSuccess: string;
  statusSuccessBg: string;
  statusError: string;
  statusErrorBg: string;
}

export const darkColors: ColorTokens = {
  // Background
  backgroundPrimary: "#050810",
  backgroundSecondary: "#0C1018",
  backgroundTertiary: "#151B28",
  backgroundElevated: "#111722",

  // Accent
  cardAccent: "rgba(99, 102, 241, 0.15)",
  backgroundGlass: "rgba(255, 255, 255, 0.06)",
  iconBackground: "rgba(99, 102, 241, 0.15)",

  // Gradient
  accentGradientStart: "#6366F1",
  accentGradientMid: "#7C3AED",
  accentGradientEnd: "#8B5CF6",
  accentCyan: "#06B6D4",
  accentCyanBg: "rgba(6, 182, 212, 0.12)",
  surfaceGlow: "rgba(99, 102, 241, 0.08)",
  headerGradient: "rgba(99, 102, 241, 0.06)",
  gradientStart: "rgba(99, 102, 241, 0.15)",
  gradientEnd: "transparent",

  // Border
  borderDefault: "#1A2030",
  borderSubtle: "#131925",
  borderGlass: "rgba(255, 255, 255, 0.06)",

  // Text
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#6E7681",
  textInverse: "#050810",

  // Severity
  severityCritical: "#F85149",
  severityCriticalBg: "#F8514926",
  severityMajor: "#F0883E",
  severityMajorBg: "#F0883E26",
  severityMinor: "#D29922",
  severityMinorBg: "#D2992226",
  severityWarning: "#E3B341",
  severityWarningBg: "#E3B34126",
  severityInfo: "#58A6FF",
  severityInfoBg: "#58A6FF26",

  // State
  stateCreated: "#F85149",
  stateAcknowledged: "#D29922",
  stateResolved: "#3FB950",
  stateInvestigating: "#F0883E",
  stateMuted: "#6E7681",

  // On-Call
  oncallActive: "#3FB950",
  oncallActiveBg: "#3FB95026",
  oncallInactive: "#6E7681",
  oncallInactiveBg: "#6E768126",

  // Action
  actionPrimary: "#6366F1",
  actionPrimaryPressed: "#4F46E5",
  actionDestructive: "#F85149",
  actionDestructivePressed: "#DA3633",

  // Status
  statusSuccess: "#3FB950",
  statusSuccessBg: "#3FB95026",
  statusError: "#F85149",
  statusErrorBg: "#F8514926",
};

export const lightColors: ColorTokens = {
  // Background
  backgroundPrimary: "#FFFFFF",
  backgroundSecondary: "#F8F9FB",
  backgroundTertiary: "#F0F1F5",
  backgroundElevated: "#FFFFFF",

  // Accent
  cardAccent: "rgba(99, 102, 241, 0.08)",
  backgroundGlass: "rgba(255, 255, 255, 0.80)",
  iconBackground: "rgba(99, 102, 241, 0.08)",

  // Gradient
  accentGradientStart: "#6366F1",
  accentGradientMid: "#7C3AED",
  accentGradientEnd: "#8B5CF6",
  accentCyan: "#0891B2",
  accentCyanBg: "rgba(8, 145, 178, 0.08)",
  surfaceGlow: "rgba(99, 102, 241, 0.04)",
  headerGradient: "rgba(99, 102, 241, 0.03)",
  gradientStart: "rgba(99, 102, 241, 0.08)",
  gradientEnd: "transparent",

  // Border
  borderDefault: "#E5E7EB",
  borderSubtle: "#F0F1F5",
  borderGlass: "rgba(0, 0, 0, 0.06)",

  // Text
  textPrimary: "#111827",
  textSecondary: "#6B7280",
  textTertiary: "#9CA3AF",
  textInverse: "#FFFFFF",

  // Severity
  severityCritical: "#CF222E",
  severityCriticalBg: "#CF222E1A",
  severityMajor: "#BC4C00",
  severityMajorBg: "#BC4C001A",
  severityMinor: "#9A6700",
  severityMinorBg: "#9A67001A",
  severityWarning: "#BF8700",
  severityWarningBg: "#BF87001A",
  severityInfo: "#0969DA",
  severityInfoBg: "#0969DA1A",

  // State
  stateCreated: "#CF222E",
  stateAcknowledged: "#9A6700",
  stateResolved: "#1A7F37",
  stateInvestigating: "#BC4C00",
  stateMuted: "#8C959F",

  // On-Call
  oncallActive: "#1A7F37",
  oncallActiveBg: "#1A7F371A",
  oncallInactive: "#8C959F",
  oncallInactiveBg: "#8C959F1A",

  // Action
  actionPrimary: "#6366F1",
  actionPrimaryPressed: "#4F46E5",
  actionDestructive: "#CF222E",
  actionDestructivePressed: "#A40E26",

  // Status
  statusSuccess: "#1A7F37",
  statusSuccessBg: "#1A7F371A",
  statusError: "#CF222E",
  statusErrorBg: "#CF222E1A",
};
