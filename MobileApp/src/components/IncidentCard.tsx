import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import type { IncidentItem, NamedEntity } from "../api/types";

interface IncidentCardProps {
  incident: IncidentItem;
  onPress: () => void;
}

export default function IncidentCard({
  incident,
  onPress,
}: IncidentCardProps): React.JSX.Element {
  const { theme } = useTheme();

  const stateColor: string = incident.currentIncidentState?.color
    ? rgbToHex(incident.currentIncidentState.color)
    : theme.colors.textTertiary;

  const severityColor: string = incident.incidentSeverity?.color
    ? rgbToHex(incident.incidentSeverity.color)
    : theme.colors.textTertiary;

  const monitorCount: number = incident.monitors?.length ?? 0;
  const timeString: string = formatRelativeTime(
    incident.declaredAt || incident.createdAt,
  );

  return (
    <TouchableOpacity
      style={[
        styles.card,
        theme.shadows.sm,
        {
          backgroundColor: theme.colors.backgroundElevated,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Incident ${incident.incidentNumberWithPrefix || incident.incidentNumber}, ${incident.title}. State: ${incident.currentIncidentState?.name ?? "unknown"}. Severity: ${incident.incidentSeverity?.name ?? "unknown"}.`}
    >
      <View style={styles.topRow}>
        <Text style={[styles.number, { color: theme.colors.textTertiary }]}>
          {incident.incidentNumberWithPrefix || `#${incident.incidentNumber}`}
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
        {incident.title}
      </Text>

      <View style={styles.badgeRow}>
        {incident.currentIncidentState ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: theme.colors.backgroundTertiary },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: stateColor }]} />
            <Text
              style={[styles.badgeText, { color: theme.colors.textPrimary }]}
            >
              {incident.currentIncidentState.name}
            </Text>
          </View>
        ) : null}

        {incident.incidentSeverity ? (
          <View
            style={[styles.badge, { backgroundColor: severityColor + "26" }]}
          >
            <Text style={[styles.badgeText, { color: severityColor }]}>
              {incident.incidentSeverity.name}
            </Text>
          </View>
        ) : null}
      </View>

      {monitorCount > 0 ? (
        <Text
          style={[styles.monitors, { color: theme.colors.textSecondary }]}
          numberOfLines={1}
        >
          {incident.monitors
            .map((m: NamedEntity) => {
              return m.name;
            })
            .join(", ")}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles: ReturnType<typeof StyleSheet.create> = StyleSheet.create({
  card: {
    padding: 18,
    borderRadius: 16,
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
  monitors: {
    fontSize: 12,
    marginTop: 8,
  },
});
