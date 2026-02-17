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
      style={({ pressed }: { pressed: boolean }) => {
        return {
          marginBottom: 12,
          opacity: pressed ? 0.7 : muted ? 0.5 : 1,
        };
      }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Alert ${alert.alertNumberWithPrefix || alert.alertNumber}, ${alert.title}. State: ${alert.currentAlertState?.name ?? "unknown"}. Severity: ${alert.alertSeverity?.name ?? "unknown"}.`}
    >
      <View
        style={{
          borderRadius: 24,
          overflow: "hidden",
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          shadowColor: "#000",
          shadowOpacity: 0.22,
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
        <View style={{ padding: 16 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              {projectName ? <ProjectBadge name={projectName} /> : null}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 9999,
                  backgroundColor: theme.colors.iconBackground,
                }}
              >
                <Ionicons
                  name="notifications-outline"
                  size={10}
                  color={theme.colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: "600",
                    color: theme.colors.textSecondary,
                    letterSpacing: 0.3,
                  }}
                >
                  ALERT
                </Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 9999,
                  backgroundColor: theme.colors.backgroundTertiary,
                  borderWidth: 1,
                  borderColor: theme.colors.borderDefault,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "bold",
                    color: theme.colors.textPrimary,
                    letterSpacing: 0.2,
                  }}
                >
                  {alert.alertNumberWithPrefix || `#${alert.alertNumber}`}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Ionicons
                name="time-outline"
                size={12}
                color={theme.colors.textTertiary}
                style={{ marginRight: 4 }}
              />
              <Text
                style={{ fontSize: 12, color: theme.colors.textTertiary }}
              >
                {timeString}
              </Text>
            </View>
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              marginTop: 2,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                flex: 1,
                paddingRight: 8,
                color: theme.colors.textPrimary,
                letterSpacing: -0.2,
              }}
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

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 12,
            }}
          >
            {alert.currentAlertState ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 9999,
                  backgroundColor: theme.colors.backgroundTertiary,
                }}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 9999,
                    marginRight: 6,
                    backgroundColor: stateColor,
                  }}
                />
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "600",
                    color: stateColor,
                  }}
                >
                  {alert.currentAlertState.name}
                </Text>
              </View>
            ) : null}

            {alert.alertSeverity ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 9999,
                  backgroundColor: theme.colors.backgroundTertiary,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "600",
                    color: severityColor,
                  }}
                >
                  {alert.alertSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>

          {alert.monitor ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginTop: 12,
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: theme.colors.borderSubtle,
              }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 9999,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 8,
                  backgroundColor: theme.colors.iconBackground,
                }}
              >
                <Ionicons
                  name="pulse-outline"
                  size={12}
                  color={theme.colors.textSecondary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{ fontSize: 12, color: theme.colors.textSecondary }}
                  numberOfLines={1}
                >
                  {alert.monitor.name}
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    marginTop: 2,
                    color: theme.colors.textTertiary,
                  }}
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
