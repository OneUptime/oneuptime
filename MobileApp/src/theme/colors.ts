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
  backgroundPrimary: "#000000",
  backgroundSecondary: "#0A0A0A",
  backgroundTertiary: "#161616",
  backgroundElevated: "#0F0F0F",

  // Accent
  cardAccent: "rgba(255, 255, 255, 0.07)",
  backgroundGlass: "rgba(255, 255, 255, 0.05)",
  iconBackground: "rgba(255, 255, 255, 0.07)",

  // Gradient
  accentGradientStart: "#FFFFFF",
  accentGradientMid: "#E0E0E0",
  accentGradientEnd: "#C8C8C8",
  accentCyan: "#06B6D4",
  accentCyanBg: "rgba(6, 182, 212, 0.12)",
  surfaceGlow: "rgba(255, 255, 255, 0.04)",
  headerGradient: "rgba(255, 255, 255, 0.03)",
  gradientStart: "rgba(255, 255, 255, 0.05)",
  gradientEnd: "transparent",

  // Border
  borderDefault: "#1C1C1E",
  borderSubtle: "#141414",
  borderGlass: "rgba(255, 255, 255, 0.08)",

  // Text
  textPrimary: "#F0F0F0",
  textSecondary: "#8E8E93",
  textTertiary: "#636366",
  textInverse: "#000000",

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
  stateMuted: "#636366",

  // On-Call
  oncallActive: "#3FB950",
  oncallActiveBg: "#3FB95026",
  oncallInactive: "#636366",
  oncallInactiveBg: "#63636626",

  // Action
  actionPrimary: "#FFFFFF",
  actionPrimaryPressed: "#D4D4D4",
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
  backgroundSecondary: "#F8F8FA",
  backgroundTertiary: "#F0F0F2",
  backgroundElevated: "#FFFFFF",

  // Accent
  cardAccent: "rgba(0, 0, 0, 0.04)",
  backgroundGlass: "rgba(255, 255, 255, 0.85)",
  iconBackground: "rgba(0, 0, 0, 0.05)",

  // Gradient
  accentGradientStart: "#1A1A1A",
  accentGradientMid: "#2D2D2D",
  accentGradientEnd: "#3A3A3A",
  accentCyan: "#0891B2",
  accentCyanBg: "rgba(8, 145, 178, 0.08)",
  surfaceGlow: "rgba(0, 0, 0, 0.03)",
  headerGradient: "rgba(0, 0, 0, 0.02)",
  gradientStart: "rgba(0, 0, 0, 0.03)",
  gradientEnd: "transparent",

  // Border
  borderDefault: "#E5E5EA",
  borderSubtle: "#F0F0F2",
  borderGlass: "rgba(0, 0, 0, 0.06)",

  // Text
  textPrimary: "#111111",
  textSecondary: "#6B6B6B",
  textTertiary: "#9A9A9A",
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
  actionPrimary: "#1A1A1A",
  actionPrimaryPressed: "#333333",
  actionDestructive: "#CF222E",
  actionDestructivePressed: "#A40E26",

  // Status
  statusSuccess: "#1A7F37",
  statusSuccessBg: "#1A7F371A",
  statusError: "#CF222E",
  statusErrorBg: "#CF222E1A",
};
