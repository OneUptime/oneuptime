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
  // Background — rich near-black, not pure black
  backgroundPrimary: "#09090B",
  backgroundSecondary: "#0F0F12",
  backgroundTertiary: "#18181F",
  backgroundElevated: "#141418",

  // Accent
  cardAccent: "rgba(255, 255, 255, 0.04)",
  backgroundGlass: "rgba(255, 255, 255, 0.03)",
  iconBackground: "rgba(255, 255, 255, 0.08)",

  // Gradient — neutral monochrome accent
  accentGradientStart: "#52525B",
  accentGradientMid: "#3F3F46",
  accentGradientEnd: "#27272A",
  accentCyan: "#A1A1AA",
  accentCyanBg: "rgba(161, 161, 170, 0.12)",
  surfaceGlow: "rgba(255, 255, 255, 0.05)",
  headerGradient: "rgba(255, 255, 255, 0.03)",
  gradientStart: "rgba(255, 255, 255, 0.07)",
  gradientEnd: "transparent",

  // Border
  borderDefault: "rgba(255, 255, 255, 0.06)",
  borderSubtle: "rgba(255, 255, 255, 0.04)",
  borderGlass: "rgba(255, 255, 255, 0.06)",

  // Text
  textPrimary: "#FAFAFA",
  textSecondary: "#A1A1AA",
  textTertiary: "#52525B",
  textInverse: "#FFFFFF",

  // Severity
  severityCritical: "#EF4444",
  severityCriticalBg: "rgba(239, 68, 68, 0.12)",
  severityMajor: "#F97316",
  severityMajorBg: "rgba(249, 115, 22, 0.12)",
  severityMinor: "#EAB308",
  severityMinorBg: "rgba(234, 179, 8, 0.12)",
  severityWarning: "#F59E0B",
  severityWarningBg: "rgba(245, 158, 11, 0.12)",
  severityInfo: "#3B82F6",
  severityInfoBg: "rgba(59, 130, 246, 0.12)",

  // State
  stateCreated: "#EF4444",
  stateAcknowledged: "#F59E0B",
  stateResolved: "#22C55E",
  stateInvestigating: "#F97316",
  stateMuted: "#52525B",

  // On-Call
  oncallActive: "#22C55E",
  oncallActiveBg: "rgba(34, 197, 94, 0.12)",
  oncallInactive: "#52525B",
  oncallInactiveBg: "rgba(82, 82, 91, 0.12)",

  // Action — neutral accent
  actionPrimary: "#D4D4D8",
  actionPrimaryPressed: "#A1A1AA",
  actionDestructive: "#EF4444",
  actionDestructivePressed: "#DC2626",

  // Status
  statusSuccess: "#22C55E",
  statusSuccessBg: "rgba(34, 197, 94, 0.12)",
  statusError: "#EF4444",
  statusErrorBg: "rgba(239, 68, 68, 0.12)",
};
