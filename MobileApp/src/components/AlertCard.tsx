import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
      className="mb-3"
      style={{
        opacity: muted ? 0.5 : 1,
      }}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Alert ${alert.alertNumberWithPrefix || alert.alertNumber}, ${alert.title}. State: ${alert.currentAlertState?.name ?? "unknown"}. Severity: ${alert.alertSeverity?.name ?? "unknown"}.`}
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
              <Text
                className="text-[12px] font-medium"
                style={{ color: theme.colors.textTertiary }}
              >
                {alert.alertNumberWithPrefix || `#${alert.alertNumber}`}
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
            {alert.title}
          </Text>

          <View className="flex-row flex-wrap gap-2 mt-3">
            {alert.currentAlertState ? (
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
                  {alert.currentAlertState.name}
                </Text>
              </View>
            ) : null}

            {alert.alertSeverity ? (
              <View
                className="flex-row items-center px-2 py-1 rounded-md"
                style={{ backgroundColor: severityColor + "14" }}
              >
                <Text
                  className="text-[11px] font-semibold"
                  style={{ color: severityColor }}
                >
                  {alert.alertSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>

          {alert.monitor ? (
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
                {alert.monitor.name}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}
