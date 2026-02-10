import React from "react";
import { View, Text, StyleSheet } from "react-native";
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
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.text, { color: colors.text }]}>
        {displayLabel.toUpperCase()}
      </Text>
    </View>
  );
}

const styles: ReturnType<typeof StyleSheet.create> = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
});
