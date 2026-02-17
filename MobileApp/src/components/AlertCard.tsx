import React from "react";
import { View, Text, Pressable } from "react-native";
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
    <Pressable
      style={({ pressed }) => ({
        marginBottom: 12,
        opacity: pressed ? 0.7 : muted ? 0.5 : 1,
      })}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Alert ${alert.alertNumberWithPrefix || alert.alertNumber}, ${alert.title}. State: ${alert.currentAlertState?.name ?? "unknown"}. Severity: ${alert.alertSeverity?.name ?? "unknown"}.`}
    >
      <View
        className="rounded-3xl overflow-hidden"
        style={{
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          shadowColor: theme.isDark ? "#000" : "#111827",
          shadowOpacity: theme.isDark ? 0.22 : 0.08,
          shadowOffset: { width: 0, height: 8 },
          shadowRadius: 14,
          elevation: 5,
        }}
      >
        <View
          style={{
            height: 3,
            backgroundColor: theme.colors.borderSubtle,
            opacity: 1,
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
                  name="notifications-outline"
                  size={10}
                  color={theme.colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text
                  className="text-[10px] font-semibold"
                  style={{
                    color: theme.colors.textSecondary,
                    letterSpacing: 0.3,
                  }}
                >
                  ALERT
                </Text>
              </View>
              <View
                className="px-2.5 py-1 rounded-full"
                style={{
                  backgroundColor: theme.colors.backgroundTertiary,
                  borderWidth: 1,
                  borderColor: theme.colors.borderDefault,
                }}
              >
                <Text
                  className="text-[12px] font-bold"
                  style={{
                    color: theme.colors.textPrimary,
                    letterSpacing: 0.2,
                  }}
                >
                  {alert.alertNumberWithPrefix || `#${alert.alertNumber}`}
                </Text>
              </View>
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
              {alert.title}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={theme.colors.textTertiary}
              style={{ marginTop: 2 }}
            />
          </View>

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
                className="flex-row items-center px-2.5 py-1 rounded-full"
                style={{ backgroundColor: theme.colors.backgroundTertiary }}
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
                  {alert.monitor.name}
                </Text>
                <Text
                  className="text-[11px] mt-0.5"
                  style={{ color: theme.colors.textTertiary }}
                >
                  Linked monitor
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
