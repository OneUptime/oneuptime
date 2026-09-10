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
  backgroundPrimary: "#0B1220",
  backgroundSecondary: "#101A2B",
  backgroundTertiary: "#1C2A40",
  backgroundElevated: "#142035",

  // Accent
  cardAccent: "#1A2E4B",
  backgroundGlass: "#101C30",
  iconBackground: "#21324C",

  // Blue identifies interactive controls; status colors keep their meaning.
  accentGradientStart: "#60A5FA",
  accentGradientMid: "#3B82F6",
  accentGradientEnd: "#2563EB",
  accentCyan: "#67D5E8",
  accentCyanBg: "rgba(103, 213, 232, 0.12)",
  surfaceGlow: "rgba(255, 255, 255, 0.05)",
  headerGradient: "rgba(255, 255, 255, 0.03)",
  gradientStart: "rgba(255, 255, 255, 0.07)",
  gradientEnd: "transparent",

  // Border
  borderDefault: "#32435D",
  borderSubtle: "#26364E",
  borderGlass: "#2B3C55",

  // Text
  textPrimary: "#F4F7FC",
  textSecondary: "#B4C2D6",
  textTertiary: "#94A6C0",
  textInverse: "#FFFFFF",

  // Severity
  severityCritical: "#FF8585",
  severityCriticalBg: "rgba(239, 68, 68, 0.12)",
  severityMajor: "#FFAB70",
  severityMajorBg: "rgba(249, 115, 22, 0.12)",
  severityMinor: "#EAB308",
  severityMinorBg: "rgba(234, 179, 8, 0.12)",
  severityWarning: "#F59E0B",
  severityWarningBg: "rgba(245, 158, 11, 0.12)",
  severityInfo: "#80B7FF",
  severityInfoBg: "rgba(59, 130, 246, 0.12)",

  // State
  stateCreated: "#FF8585",
  stateAcknowledged: "#F59E0B",
  stateResolved: "#5BD6A2",
  stateInvestigating: "#F97316",
  stateMuted: "#94A6C0",

  // On-Call
  oncallActive: "#5BD6A2",
  oncallActiveBg: "rgba(34, 197, 94, 0.12)",
  oncallInactive: "#94A6C0",
  oncallInactiveBg: "rgba(82, 82, 91, 0.12)",

  // Light blue supports both links on navy and dark labels on filled buttons.
  actionPrimary: "#80B7FF",
  actionPrimaryPressed: "#A5CCFF",
  actionDestructive: "#FF8585",
  actionDestructivePressed: "#DC2626",

  // Status
  statusSuccess: "#5BD6A2",
  statusSuccessBg: "rgba(34, 197, 94, 0.12)",
  statusError: "#FF8585",
  statusErrorBg: "rgba(239, 68, 68, 0.12)",
};
