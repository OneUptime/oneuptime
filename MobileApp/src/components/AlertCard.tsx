import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import ProjectBadge from "./ProjectBadge";
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
      accessibilityLabel={`Alert ${alert.alertNumberWithPrefix || alert.alertNumber}, ${alert.title}. State: ${alert.currentAlertState?.name ?? "unknown"}. Severity: ${alert.alertSeverity?.name ?? "unknown"}.`}
    >
      <View className="flex-row">
        <View className="w-1" style={{ backgroundColor: stateColor }} />
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

          <View className="flex-row flex-wrap gap-2 mt-2.5">
            {alert.currentAlertState ? (
              <View className="flex-row items-center px-2.5 py-0.5 rounded-full bg-bg-tertiary">
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
                className="flex-row items-center px-2.5 py-0.5 rounded-full"
                style={{ backgroundColor: severityColor + "1A" }}
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
                {alert.monitor.name}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}
