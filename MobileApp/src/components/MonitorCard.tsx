import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import ProjectBadge from "./ProjectBadge";
import type { MonitorItem } from "../api/types";

interface MonitorCardProps {
  monitor: MonitorItem;
  onPress: () => void;
  projectName?: string;
  muted?: boolean;
}

function getMonitorTypeLabel(monitorType?: string): string {
  if (!monitorType) {
    return "Monitor";
  }
  const labels: Record<string, string> = {
    Website: "Website",
    API: "API",
    Ping: "Ping",
    IP: "IP",
    Port: "Port",
    DNS: "DNS",
    SSLCertificate: "SSL",
    Domain: "Domain",
    Server: "Server",
    IncomingRequest: "Incoming",
    SyntheticMonitor: "Synthetic",
    CustomJavaScriptCode: "Custom",
    Logs: "Logs",
    Metrics: "Metrics",
    Traces: "Traces",
    Manual: "Manual",
  };
  return labels[monitorType] ?? monitorType;
}

export default function MonitorCard({
  monitor,
  onPress,
  projectName,
  muted,
}: MonitorCardProps): React.JSX.Element {
  const { theme } = useTheme();

  const statusColor: string = monitor.currentMonitorStatus?.color
    ? rgbToHex(monitor.currentMonitorStatus.color)
    : theme.colors.textTertiary;

  const timeString: string = formatRelativeTime(monitor.createdAt);
  const isDisabled: boolean = monitor.disableActiveMonitoring === true;

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
      accessibilityLabel={`Monitor ${monitor.name}. Status: ${monitor.currentMonitorStatus?.name ?? "unknown"}.`}
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
            backgroundColor: isDisabled
              ? theme.colors.textTertiary
              : statusColor,
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
                  name="pulse-outline"
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
                  {getMonitorTypeLabel(monitor.monitorType).toUpperCase()}
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
              <Text style={{ fontSize: 12, color: theme.colors.textTertiary }}>
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
              {monitor.name}
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
            {isDisabled ? (
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
                    backgroundColor: theme.colors.textTertiary,
                  }}
                />
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "600",
                    color: theme.colors.textTertiary,
                  }}
                >
                  Disabled
                </Text>
              </View>
            ) : monitor.currentMonitorStatus ? (
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
                    backgroundColor: statusColor,
                  }}
                />
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "600",
                    color: statusColor,
                  }}
                >
                  {monitor.currentMonitorStatus.name}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
