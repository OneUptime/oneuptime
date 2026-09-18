export interface ColorTokens {
  // Background
  /** The canvas behind every screen. */
  backgroundPrimary: string;
  /** Headers, sheets and inputs. */
  backgroundSecondary: string;
  /** Muted fills: pressed rows, tracks, skeletons. */
  backgroundTertiary: string;
  /** Cards and grouped lists. */
  backgroundElevated: string;

  // Accent
  /** A soft tint of the action colour, for selected and highlighted surfaces. */
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
  /** Labels on filled action, success, warning and error controls. */
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
  statusWarning: string;
  statusWarningBg: string;
  statusInfo: string;
  statusInfoBg: string;

  /** Scrim behind sheets and dialogs. */
  overlay: string;
}

export const lightColors: ColorTokens = {
  // A cool grey canvas keeps white cards distinct without heavy borders.
  backgroundPrimary: "#F3F4F7",
  backgroundSecondary: "#FFFFFF",
  backgroundTertiary: "#ECEEF2",
  backgroundElevated: "#FFFFFF",

  // Accent
  cardAccent: "#EEF0FF",
  backgroundGlass: "#FFFFFF",
  iconBackground: "#EEF0FF",

  // OneUptime indigo identifies interactive controls.
  accentGradientStart: "#4F46E5",
  accentGradientMid: "#4338CA",
  accentGradientEnd: "#3730A3",
  accentCyan: "#0E7490",
  accentCyanBg: "#E3F4F7",
  surfaceGlow: "transparent",
  headerGradient: "transparent",
  gradientStart: "transparent",
  gradientEnd: "transparent",

  // Border
  borderDefault: "#D5D9E0",
  borderSubtle: "#E6E8ED",
  borderGlass: "#E6E8ED",

  // Text
  textPrimary: "#101828",
  textSecondary: "#475467",
  textTertiary: "#5B6576",
  textInverse: "#FFFFFF",

  // Severity
  severityCritical: "#B42318",
  severityCriticalBg: "#FEF0EF",
  severityMajor: "#B54708",
  severityMajorBg: "#FEF4E6",
  severityMinor: "#8A5A00",
  severityMinorBg: "#FEF7DA",
  severityWarning: "#935F00",
  severityWarningBg: "#FEF6E3",
  severityInfo: "#4F46E5",
  severityInfoBg: "#EEF0FF",

  // State
  stateCreated: "#B42318",
  stateAcknowledged: "#935F00",
  stateResolved: "#067647",
  stateInvestigating: "#B54708",
  stateMuted: "#5B6576",

  // On-Call
  oncallActive: "#067647",
  oncallActiveBg: "#E7F6EE",
  oncallInactive: "#5B6576",
  oncallInactiveBg: "#ECEEF2",

  // Action
  actionPrimary: "#4F46E5",
  actionPrimaryPressed: "#4338CA",
  actionDestructive: "#B42318",
  actionDestructivePressed: "#912018",

  // Status
  statusSuccess: "#067647",
  statusSuccessBg: "#E7F6EE",
  statusError: "#B42318",
  statusErrorBg: "#FEF0EF",
  statusWarning: "#935F00",
  statusWarningBg: "#FEF6E3",
  statusInfo: "#4F46E5",
  statusInfoBg: "#EEF0FF",

  overlay: "rgba(16, 24, 40, 0.45)",
};

/*
 * Night pages are the ones an on-call app exists for, so dark mode follows the
 * system. Filled controls use light, saturated colours with dark labels, which
 * keeps every label above 4.5:1 without dimming the action colour into mud.
 */
export const darkColors: ColorTokens = {
  backgroundPrimary: "#0C0E13",
  backgroundSecondary: "#161922",
  backgroundTertiary: "#1F232E",
  backgroundElevated: "#1A1D27",

  cardAccent: "#23264A",
  backgroundGlass: "#1A1D27",
  iconBackground: "#23264A",

  accentGradientStart: "#8E95FB",
  accentGradientMid: "#7B83F5",
  accentGradientEnd: "#6870EE",
  accentCyan: "#5CD3E6",
  accentCyanBg: "#12303A",
  surfaceGlow: "transparent",
  headerGradient: "transparent",
  gradientStart: "transparent",
  gradientEnd: "transparent",

  borderDefault: "#343947",
  borderSubtle: "#262A36",
  borderGlass: "#262A36",

  textPrimary: "#F2F4F7",
  textSecondary: "#B4BCC8",
  textTertiary: "#98A1B0",
  textInverse: "#0C0E13",

  severityCritical: "#FF8A80",
  severityCriticalBg: "#3A1A1A",
  severityMajor: "#FDB022",
  severityMajorBg: "#3A2A12",
  severityMinor: "#F5D162",
  severityMinorBg: "#352E12",
  severityWarning: "#FDB872",
  severityWarningBg: "#3A2A16",
  severityInfo: "#A5ABFF",
  severityInfoBg: "#23264A",

  stateCreated: "#FF8A80",
  stateAcknowledged: "#FDB872",
  stateResolved: "#4ADE9A",
  stateInvestigating: "#FDB022",
  stateMuted: "#98A1B0",

  oncallActive: "#4ADE9A",
  oncallActiveBg: "#123325",
  oncallInactive: "#98A1B0",
  oncallInactiveBg: "#1F232E",

  actionPrimary: "#8E95FB",
  actionPrimaryPressed: "#A5ABFF",
  actionDestructive: "#FF8A80",
  actionDestructivePressed: "#FFA39B",

  statusSuccess: "#4ADE9A",
  statusSuccessBg: "#123325",
  statusError: "#FF8A80",
  statusErrorBg: "#3A1A1A",
  statusWarning: "#FDB872",
  statusWarningBg: "#3A2A16",
  statusInfo: "#A5ABFF",
  statusInfoBg: "#23264A",

  overlay: "rgba(0, 0, 0, 0.6)",
};
