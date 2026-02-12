import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
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
      className="p-[18px] rounded-2xl mb-3 bg-bg-elevated shadow-sm"
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Incident ${incident.incidentNumberWithPrefix || incident.incidentNumber}, ${incident.title}. State: ${incident.currentIncidentState?.name ?? "unknown"}. Severity: ${incident.incidentSeverity?.name ?? "unknown"}.`}
    >
      <View className="flex-row justify-between items-center mb-1.5">
        <Text className="text-[13px] font-semibold text-text-tertiary">
          {incident.incidentNumberWithPrefix || `#${incident.incidentNumber}`}
        </Text>
        <Text className="text-xs text-text-tertiary">{timeString}</Text>
      </View>

      <Text
        className="text-body-lg text-text-primary font-semibold"
        numberOfLines={2}
      >
        {incident.title}
      </Text>

      <View className="flex-row flex-wrap gap-2 mt-2.5">
        {incident.currentIncidentState ? (
          <View className="flex-row items-center px-2 py-1 rounded-md bg-bg-tertiary">
            <View
              className="w-2 h-2 rounded-full mr-1.5"
              style={{ backgroundColor: stateColor }}
            />
            <Text className="text-xs font-semibold text-text-primary">
              {incident.currentIncidentState.name}
            </Text>
          </View>
        ) : null}

        {incident.incidentSeverity ? (
          <View
            className="flex-row items-center px-2 py-1 rounded-md"
            style={{ backgroundColor: severityColor + "26" }}
          >
            <Text
              className="text-xs font-semibold"
              style={{ color: severityColor }}
            >
              {incident.incidentSeverity.name}
            </Text>
          </View>
        ) : null}
      </View>

      {monitorCount > 0 ? (
        <Text className="text-xs text-text-secondary mt-2" numberOfLines={1}>
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
