import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import ProjectBadge from "./ProjectBadge";
import type { IncidentItem, NamedEntity } from "../api/types";

interface IncidentCardProps {
  incident: IncidentItem;
  onPress: () => void;
  projectName?: string;
  muted?: boolean;
}

export default function IncidentCard({
  incident,
  onPress,
  projectName,
  muted,
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
      className="rounded-2xl mb-3 bg-bg-elevated border border-border-subtle overflow-hidden"
      style={{
        opacity: muted ? 0.55 : 1,
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 8,
        elevation: 2,
      }}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Incident ${incident.incidentNumberWithPrefix || incident.incidentNumber}, ${incident.title}. State: ${incident.currentIncidentState?.name ?? "unknown"}. Severity: ${incident.incidentSeverity?.name ?? "unknown"}.`}
    >
      <View className="flex-row">
        <View
          className="w-1"
          style={{ backgroundColor: stateColor }}
        />
        <View className="flex-1 p-4">
          {projectName ? (
            <View className="mb-1.5">
              <ProjectBadge name={projectName} />
            </View>
          ) : null}
          <View className="flex-row justify-between items-center mb-1.5">
            <View
              className="px-2 py-0.5 rounded-full"
              style={{ backgroundColor: theme.colors.backgroundTertiary }}
            >
              <Text className="text-[12px] font-semibold text-text-tertiary">
                {incident.incidentNumberWithPrefix || `#${incident.incidentNumber}`}
              </Text>
            </View>
            <Text className="text-[12px] text-text-tertiary">{timeString}</Text>
          </View>

          <Text
            className="text-body-lg text-text-primary font-semibold mt-0.5"
            numberOfLines={2}
          >
            {incident.title}
          </Text>

          <View className="flex-row flex-wrap gap-2 mt-2.5">
            {incident.currentIncidentState ? (
              <View className="flex-row items-center px-2.5 py-0.5 rounded-full bg-bg-tertiary">
                <View
                  className="w-2 h-2 rounded-full mr-1.5"
                  style={{ backgroundColor: stateColor }}
                />
                <Text className="text-[12px] font-semibold text-text-primary">
                  {incident.currentIncidentState.name}
                </Text>
              </View>
            ) : null}

            {incident.incidentSeverity ? (
              <View
                className="flex-row items-center px-2.5 py-0.5 rounded-full"
                style={{ backgroundColor: severityColor + "1A" }}
              >
                <Text
                  className="text-[12px] font-semibold"
                  style={{ color: severityColor }}
                >
                  {incident.incidentSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>

          {monitorCount > 0 ? (
            <View className="flex-row items-center mt-2.5">
              <Ionicons
                name="desktop-outline"
                size={12}
                color={theme.colors.textTertiary}
                style={{ marginRight: 4 }}
              />
              <Text
                className="text-[12px] text-text-secondary flex-1"
                numberOfLines={1}
              >
                {incident.monitors
                  .map((m: NamedEntity) => {
                    return m.name;
                  })
                  .join(", ")}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}
