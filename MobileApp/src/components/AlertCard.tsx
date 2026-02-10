import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import type { AlertItem } from "../api/types";

interface AlertCardProps {
  alert: AlertItem;
  onPress: () => void;
}

export default function AlertCard({
  alert,
  onPress,
}: AlertCardProps): React.JSX.Element {
  const { theme } = useTheme();

  const stateColor = alert.currentAlertState?.color
    ? rgbToHex(alert.currentAlertState.color)
    : theme.colors.textTertiary;

  const severityColor = alert.alertSeverity?.color
    ? rgbToHex(alert.alertSeverity.color)
    : theme.colors.textTertiary;

  const timeString = formatRelativeTime(alert.createdAt);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.backgroundSecondary,
          borderColor: theme.colors.borderSubtle,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Alert ${alert.alertNumberWithPrefix || alert.alertNumber}, ${alert.title}. State: ${alert.currentAlertState?.name ?? "unknown"}. Severity: ${alert.alertSeverity?.name ?? "unknown"}.`}
    >
      <View style={styles.topRow}>
        <Text
          style={[
            styles.number,
            { color: theme.colors.textTertiary },
          ]}
        >
          {alert.alertNumberWithPrefix || `#${alert.alertNumber}`}
        </Text>
        <Text style={[styles.time, { color: theme.colors.textTertiary }]}>
          {timeString}
        </Text>
      </View>

      <Text
        style={[
          theme.typography.bodyLarge,
          { color: theme.colors.textPrimary, fontWeight: "600" },
        ]}
        numberOfLines={2}
      >
        {alert.title}
      </Text>

      <View style={styles.badgeRow}>
        {alert.currentAlertState ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: theme.colors.backgroundTertiary },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: stateColor }]} />
            <Text style={[styles.badgeText, { color: theme.colors.textPrimary }]}>
              {alert.currentAlertState.name}
            </Text>
          </View>
        ) : null}

        {alert.alertSeverity ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: severityColor + "26" },
            ]}
          >
            <Text style={[styles.badgeText, { color: severityColor }]}>
              {alert.alertSeverity.name}
            </Text>
          </View>
        ) : null}
      </View>

      {alert.monitor ? (
        <Text
          style={[styles.monitor, { color: theme.colors.textSecondary }]}
          numberOfLines={1}
        >
          {alert.monitor.name}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  number: {
    fontSize: 13,
    fontWeight: "600",
  },
  time: {
    fontSize: 12,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  monitor: {
    fontSize: 12,
    marginTop: 8,
  },
});
