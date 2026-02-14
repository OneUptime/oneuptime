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
      className="mb-3"
      style={{
        opacity: muted ? 0.5 : 1,
      }}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Incident ${incident.incidentNumberWithPrefix || incident.incidentNumber}, ${incident.title}. State: ${incident.currentIncidentState?.name ?? "unknown"}. Severity: ${incident.incidentSeverity?.name ?? "unknown"}.`}
    >
      <View
        className="rounded-2xl overflow-hidden"
        style={{
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        }}
      >
        <View
          style={{
            height: 3,
            backgroundColor: stateColor,
            opacity: 0.8,
          }}
        />
        <View className="p-4">
          <View className="flex-row justify-between items-center mb-2.5">
            <View className="flex-row items-center gap-2">
              {projectName ? <ProjectBadge name={projectName} /> : null}
              <Text
                className="text-[12px] font-medium"
                style={{ color: theme.colors.textTertiary }}
              >
                {incident.incidentNumberWithPrefix ||
                  `#${incident.incidentNumber}`}
              </Text>
            </View>
            <Text
              className="text-[12px]"
              style={{ color: theme.colors.textTertiary }}
            >
              {timeString}
            </Text>
          </View>

          <Text
            className="text-[16px] font-semibold mt-0.5"
            style={{ color: theme.colors.textPrimary, letterSpacing: -0.2 }}
            numberOfLines={2}
          >
            {incident.title}
          </Text>

          <View className="flex-row flex-wrap gap-2 mt-3">
            {incident.currentIncidentState ? (
              <View
                className="flex-row items-center px-2 py-1 rounded-md"
                style={{
                  backgroundColor: stateColor + "14",
                }}
              >
                <View
                  className="w-1.5 h-1.5 rounded-full mr-1.5"
                  style={{ backgroundColor: stateColor }}
                />
                <Text
                  className="text-[11px] font-semibold"
                  style={{ color: stateColor }}
                >
                  {incident.currentIncidentState.name}
                </Text>
              </View>
            ) : null}

            {incident.incidentSeverity ? (
              <View
                className="flex-row items-center px-2 py-1 rounded-md"
                style={{ backgroundColor: severityColor + "14" }}
              >
                <Text
                  className="text-[11px] font-semibold"
                  style={{ color: severityColor }}
                >
                  {incident.incidentSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>

          {monitorCount > 0 ? (
            <View
              className="flex-row items-center mt-2.5 pt-2.5"
              style={{
                borderTopWidth: 1,
                borderTopColor: theme.colors.borderSubtle,
              }}
            >
              <Ionicons
                name="desktop-outline"
                size={11}
                color={theme.colors.textTertiary}
                style={{ marginRight: 5 }}
              />
              <Text
                className="text-[12px] flex-1"
                style={{ color: theme.colors.textTertiary }}
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
