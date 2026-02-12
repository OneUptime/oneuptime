import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
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

  const stateColor: string = alert.currentAlertState?.color
    ? rgbToHex(alert.currentAlertState.color)
    : theme.colors.textTertiary;

  const severityColor: string = alert.alertSeverity?.color
    ? rgbToHex(alert.alertSeverity.color)
    : theme.colors.textTertiary;

  const timeString: string = formatRelativeTime(alert.createdAt);

  return (
    <TouchableOpacity
      className="p-[18px] rounded-2xl mb-3 bg-bg-elevated shadow-sm"
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Alert ${alert.alertNumberWithPrefix || alert.alertNumber}, ${alert.title}. State: ${alert.currentAlertState?.name ?? "unknown"}. Severity: ${alert.alertSeverity?.name ?? "unknown"}.`}
    >
      <View className="flex-row justify-between items-center mb-1.5">
        <Text className="text-[13px] font-semibold text-text-tertiary">
          {alert.alertNumberWithPrefix || `#${alert.alertNumber}`}
        </Text>
        <Text className="text-xs text-text-tertiary">{timeString}</Text>
      </View>

      <Text
        className="text-body-lg text-text-primary font-semibold"
        numberOfLines={2}
      >
        {alert.title}
      </Text>

      <View className="flex-row flex-wrap gap-2 mt-2.5">
        {alert.currentAlertState ? (
          <View className="flex-row items-center px-2 py-1 rounded-md bg-bg-tertiary">
            <View
              className="w-2 h-2 rounded-full mr-1.5"
              style={{ backgroundColor: stateColor }}
            />
            <Text className="text-xs font-semibold text-text-primary">
              {alert.currentAlertState.name}
            </Text>
          </View>
        ) : null}

        {alert.alertSeverity ? (
          <View
            className="flex-row items-center px-2 py-1 rounded-md"
            style={{ backgroundColor: severityColor + "26" }}
          >
            <Text
              className="text-xs font-semibold"
              style={{ color: severityColor }}
            >
              {alert.alertSeverity.name}
            </Text>
          </View>
        ) : null}
      </View>

      {alert.monitor ? (
        <Text className="text-xs text-text-secondary mt-2" numberOfLines={1}>
          {alert.monitor.name}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}
