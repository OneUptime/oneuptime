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

export const lightColors: ColorTokens = {
  // Background — clean white with warm gray tones
  backgroundPrimary: "#FFFFFF",
  backgroundSecondary: "#F9FAFB",
  backgroundTertiary: "#F3F4F6",
  backgroundElevated: "#FFFFFF",

  // Accent
  cardAccent: "rgba(0, 0, 0, 0.02)",
  backgroundGlass: "rgba(255, 255, 255, 0.80)",
  iconBackground: "rgba(0, 0, 0, 0.05)",

  // Gradient — neutral monochrome accent
  accentGradientStart: "#52525B",
  accentGradientMid: "#3F3F46",
  accentGradientEnd: "#27272A",
  accentCyan: "#52525B",
  accentCyanBg: "rgba(82, 82, 91, 0.08)",
  surfaceGlow: "rgba(0, 0, 0, 0.04)",
  headerGradient: "rgba(0, 0, 0, 0.03)",
  gradientStart: "rgba(0, 0, 0, 0.04)",
  gradientEnd: "transparent",

  // Border
  borderDefault: "#E5E7EB",
  borderSubtle: "#F3F4F6",
  borderGlass: "rgba(0, 0, 0, 0.05)",

  // Text
  textPrimary: "#111827",
  textSecondary: "#6B7280",
  textTertiary: "#9CA3AF",
  textInverse: "#FFFFFF",

  // Severity
  severityCritical: "#DC2626",
  severityCriticalBg: "rgba(220, 38, 38, 0.08)",
  severityMajor: "#EA580C",
  severityMajorBg: "rgba(234, 88, 12, 0.08)",
  severityMinor: "#CA8A04",
  severityMinorBg: "rgba(202, 138, 4, 0.08)",
  severityWarning: "#D97706",
  severityWarningBg: "rgba(217, 119, 6, 0.08)",
  severityInfo: "#2563EB",
  severityInfoBg: "rgba(37, 99, 235, 0.08)",

  // State
  stateCreated: "#DC2626",
  stateAcknowledged: "#D97706",
  stateResolved: "#16A34A",
  stateInvestigating: "#EA580C",
  stateMuted: "#9CA3AF",

  // On-Call
  oncallActive: "#16A34A",
  oncallActiveBg: "rgba(22, 163, 74, 0.08)",
  oncallInactive: "#9CA3AF",
  oncallInactiveBg: "rgba(156, 163, 175, 0.08)",

  // Action — neutral accent
  actionPrimary: "#27272A",
  actionPrimaryPressed: "#3F3F46",
  actionDestructive: "#DC2626",
  actionDestructivePressed: "#B91C1C",

  // Status
  statusSuccess: "#16A34A",
  statusSuccessBg: "rgba(22, 163, 74, 0.08)",
  statusError: "#DC2626",
  statusErrorBg: "rgba(220, 38, 38, 0.08)",
};
