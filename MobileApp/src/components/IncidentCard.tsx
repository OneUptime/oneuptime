import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
  const monitorNames: string = incident.monitors
    .map((m: NamedEntity) => {
      return m.name;
    })
    .join(", ");
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
        className="rounded-3xl overflow-hidden"
        style={{
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          shadowColor: theme.isDark ? "#000" : stateColor,
          shadowOpacity: theme.isDark ? 0.22 : 0.1,
          shadowOffset: { width: 0, height: 8 },
          shadowRadius: 14,
          elevation: 5,
        }}
      >
        <LinearGradient
          colors={[stateColor + "22", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: "absolute",
            top: -40,
            left: -10,
            right: -10,
            height: 150,
          }}
        />
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
              <View
                className="flex-row items-center px-2 py-1 rounded-full"
                style={{ backgroundColor: theme.colors.iconBackground }}
              >
                <Ionicons
                  name="warning-outline"
                  size={10}
                  color={theme.colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text
                  className="text-[10px] font-semibold"
                  style={{ color: theme.colors.textSecondary, letterSpacing: 0.3 }}
                >
                  INCIDENT
                </Text>
              </View>
              <Text
                className="text-[11px] font-semibold"
                style={{ color: theme.colors.textTertiary }}
              >
                {incident.incidentNumberWithPrefix ||
                  `#${incident.incidentNumber}`}
              </Text>
            </View>
            <View className="flex-row items-center">
              <Ionicons
                name="time-outline"
                size={12}
                color={theme.colors.textTertiary}
                style={{ marginRight: 4 }}
              />
              <Text
                className="text-[12px]"
                style={{ color: theme.colors.textTertiary }}
              >
                {timeString}
              </Text>
            </View>
          </View>

          <View className="flex-row items-start mt-0.5">
            <Text
              className="text-[16px] font-semibold flex-1 pr-2"
              style={{ color: theme.colors.textPrimary, letterSpacing: -0.2 }}
              numberOfLines={2}
            >
              {incident.title}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={theme.colors.textTertiary}
              style={{ marginTop: 2 }}
            />
          </View>

          <View className="flex-row flex-wrap gap-2 mt-3">
            {incident.currentIncidentState ? (
              <View
                className="flex-row items-center px-2.5 py-1 rounded-full"
                style={{
                  backgroundColor: stateColor + "14",
                }}
              >
                <View
                  className="w-2 h-2 rounded-full mr-1.5"
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
                className="flex-row items-center px-2.5 py-1 rounded-full"
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
              className="flex-row items-center mt-3 pt-3"
              style={{
                borderTopWidth: 1,
                borderTopColor: theme.colors.borderSubtle,
              }}
            >
              <View
                className="w-6 h-6 rounded-full items-center justify-center mr-2"
                style={{ backgroundColor: theme.colors.iconBackground }}
              >
                <Ionicons
                  name="desktop-outline"
                  size={12}
                  color={theme.colors.textSecondary}
                />
              </View>
              <View className="flex-1">
                <Text
                  className="text-[12px]"
                  style={{ color: theme.colors.textSecondary }}
                  numberOfLines={1}
                >
                  {monitorNames}
                </Text>
                <Text
                  className="text-[11px] mt-0.5"
                  style={{ color: theme.colors.textTertiary }}
                >
                  {monitorCount} monitor{monitorCount !== 1 ? "s" : ""}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}
