import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import ProjectBadge from "./ProjectBadge";
import GlassCard from "./GlassCard";
import type { AlertItem } from "../api/types";

interface AlertCardProps {
  alert: AlertItem;
  onPress: () => void;
  projectName?: string;
  muted?: boolean;
}

export default function AlertCard({
  alert,
  onPress,
  projectName,
  muted,
}: AlertCardProps): React.JSX.Element {
  const { theme } = useTheme();

  const stateColor: string = alert.currentAlertState?.color
    ? rgbToHex(alert.currentAlertState.color)
    : theme.colors.textTertiary;

  const severityColor: string = alert.alertSeverity?.color
    ? rgbToHex(alert.alertSeverity.color)
    : theme.colors.textTertiary;

  const timeString: string = formatRelativeTime(alert.createdAt);

  return (
    <TouchableOpacity
      className="mb-3"
      style={{
        opacity: muted ? 0.55 : 1,
      }}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Alert ${alert.alertNumberWithPrefix || alert.alertNumber}, ${alert.title}. State: ${alert.currentAlertState?.name ?? "unknown"}. Severity: ${alert.alertSeverity?.name ?? "unknown"}.`}
    >
      <GlassCard>
        <View className="flex-row">
          <LinearGradient
            colors={[stateColor, stateColor + "40"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={{ width: 3 }}
          />
          <View className="flex-1 p-4">
          {projectName ? (
            <View className="mb-2">
              <ProjectBadge name={projectName} />
            </View>
          ) : null}
          <View className="flex-row justify-between items-center mb-2">
            <View
              className="px-2.5 py-0.5 rounded-full"
              style={{ backgroundColor: theme.colors.backgroundTertiary }}
            >
              <Text className="text-[12px] font-semibold text-text-tertiary">
                {alert.alertNumberWithPrefix || `#${alert.alertNumber}`}
              </Text>
            </View>
            <Text className="text-[12px] text-text-tertiary">{timeString}</Text>
          </View>

          <Text
            className="text-body-lg text-text-primary font-semibold mt-0.5"
            numberOfLines={2}
          >
            {alert.title}
          </Text>

          <View className="flex-row flex-wrap gap-2 mt-3">
            {alert.currentAlertState ? (
              <View
                className="flex-row items-center px-2.5 py-1 rounded-full"
                style={{
                  backgroundColor: theme.colors.backgroundTertiary,
                }}
              >
                <View
                  className="w-2 h-2 rounded-full mr-1.5"
                  style={{ backgroundColor: stateColor }}
                />
                <Text className="text-[12px] font-semibold text-text-primary">
                  {alert.currentAlertState.name}
                </Text>
              </View>
            ) : null}

            {alert.alertSeverity ? (
              <View
                className="flex-row items-center px-2.5 py-1 rounded-full"
                style={{ backgroundColor: severityColor + "15" }}
              >
                <Text
                  className="text-[12px] font-semibold"
                  style={{ color: severityColor }}
                >
                  {alert.alertSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>

          {alert.monitor ? (
            <View className="flex-row items-center mt-3">
              <Ionicons
                name="desktop-outline"
                size={12}
                color={theme.colors.textTertiary}
                style={{ marginRight: 5 }}
              />
              <Text
                className="text-[12px] text-text-secondary flex-1"
                numberOfLines={1}
              >
                {alert.monitor.name}
              </Text>
            </View>
          ) : null}
        </View>
        </View>
      </GlassCard>
    </TouchableOpacity>
  );
}
