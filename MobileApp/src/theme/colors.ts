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

export const lightColors: ColorTokens = {
  // Warm paper surfaces and graphite text.
  backgroundPrimary: "#F6F7F9",
  backgroundSecondary: "#FFFFFF",
  backgroundTertiary: "#EDF0F5",
  backgroundElevated: "#FFFFFF",

  // Accent
  cardAccent: "#E9EEFF",
  backgroundGlass: "#FBFCFE",
  iconBackground: "#EBEFF8",

  // Blue identifies interactive controls; status colors keep their meaning.
  accentGradientStart: "#3155D9",
  accentGradientMid: "#2949BA",
  accentGradientEnd: "#233EA5",
  accentCyan: "#096B78",
  accentCyanBg: "#E6F4F5",
  surfaceGlow: "transparent",
  headerGradient: "transparent",
  gradientStart: "transparent",
  gradientEnd: "transparent",

  // Border
  borderDefault: "#CCD3DD",
  borderSubtle: "#E6E9EF",
  borderGlass: "#E1E5EB",

  // Text
  textPrimary: "#17212F",
  textSecondary: "#526073",
  textTertiary: "#5E6B7D",
  textInverse: "#FFFFFF",

  // Severity
  severityCritical: "#B42318",
  severityCriticalBg: "#FFF0EE",
  severityMajor: "#A04311",
  severityMajorBg: "#FFF3E8",
  severityMinor: "#795B00",
  severityMinorBg: "#FFF8DC",
  severityWarning: "#8D4C08",
  severityWarningBg: "#FFF5E6",
  severityInfo: "#3155D9",
  severityInfoBg: "#E9EEFF",

  // State
  stateCreated: "#B42318",
  stateAcknowledged: "#8D4C08",
  stateResolved: "#087653",
  stateInvestigating: "#A04311",
  stateMuted: "#5E6B7D",

  // On-Call
  oncallActive: "#087653",
  oncallActiveBg: "#E7F6F0",
  oncallInactive: "#5E6B7D",
  oncallInactiveBg: "#EDF0F5",

  // Cobalt indicates action; filled controls use textInverse.
  actionPrimary: "#3155D9",
  actionPrimaryPressed: "#233EA5",
  actionDestructive: "#B42318",
  actionDestructivePressed: "#851A12",

  // Status
  statusSuccess: "#087653",
  statusSuccessBg: "#E7F6F0",
  statusError: "#B42318",
  statusErrorBg: "#FFF0EE",
};

/** Compatibility export for existing consumers; the app is now light-first. */
export const darkColors: ColorTokens = lightColors;
