import React from "react";
import { View, Text } from "react-native";
import { useTheme } from "../theme";

export type SeverityLevel = "critical" | "major" | "minor" | "warning" | "info";

interface SeverityBadgeProps {
  severity: SeverityLevel;
  label?: string;
}

export default function SeverityBadge({
  severity,
  label,
}: SeverityBadgeProps): React.JSX.Element {
  const { theme } = useTheme();

  const colorMap: Record<SeverityLevel, { text: string; bg: string }> = {
    critical: {
      text: theme.colors.severityCritical,
      bg: theme.colors.severityCriticalBg,
    },
    major: {
      text: theme.colors.severityMajor,
      bg: theme.colors.severityMajorBg,
    },
    minor: {
      text: theme.colors.severityMinor,
      bg: theme.colors.severityMinorBg,
    },
    warning: {
      text: theme.colors.severityWarning,
      bg: theme.colors.severityWarningBg,
    },
    info: {
      text: theme.colors.severityInfo,
      bg: theme.colors.severityInfoBg,
    },
  };

  const colors: { text: string; bg: string } = colorMap[severity];
  const displayLabel: string = label || severity;

  return (
    <View
      className="px-2 py-1 rounded-md self-start"
      style={{ backgroundColor: colors.bg }}
    >
      <Text
        className="text-xs font-semibold tracking-wide"
        style={{ color: colors.text }}
      >
        {displayLabel.toUpperCase()}
      </Text>
    </View>
  );
}
