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
    Database: "Database",
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

  /*
   * What the pill below actually says, which is not always the status.
   *
   * When active monitoring is switched off the card deliberately REPLACES the
   * status pill with "Disabled", because a status nobody is checking any more
   * is a stale status: the monitor was Operational at the moment someone
   * turned it off and it will read Operational for ever after, however far the
   * service behind it has since fallen over.
   *
   * The accessibility label was built straight from currentMonitorStatus and
   * so ignored that, which left the two descriptions of one card disagreeing -
   * and the one a blind responder gets was the wrong one. It told them
   * "Operational" about the single kind of monitor that cannot tell them
   * anything of the sort. Sighted users were never shown that claim.
   */
  const statusLabel: string = isDisabled
    ? "Disabled"
    : monitor.currentMonitorStatus?.name ?? "unknown";

  return (
    <Pressable
      style={({ pressed }: { pressed: boolean }) => {
        return {
          marginBottom: 12,
          opacity: pressed ? 0.7 : 1,
        };
      }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Open details and status history"
      accessibilityLabel={`Monitor ${monitor.name}. Status: ${statusLabel}.`}
    >
      <View
        style={{
          borderRadius: 16,
          overflow: "hidden",
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: muted
            ? theme.colors.borderSubtle
            : theme.colors.borderDefault,
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowOffset: { width: 0, height: 2 },
          shadowRadius: 6,
          elevation: 1,
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
          {projectName ? (
            <View
              style={{
                alignSelf: "flex-start",
                marginBottom: 12,
                maxWidth: "100%",
              }}
            >
              <ProjectBadge name={projectName} />
            </View>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexWrap: "wrap",
                maxWidth: "100%",
                gap: 8,
              }}
            >
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
                  size={14}
                  color={theme.colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text
                  style={{
                    fontSize: 13,
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
                size={14}
                color={theme.colors.textTertiary}
                style={{ marginRight: 4 }}
              />
              <Text style={{ fontSize: 13, color: theme.colors.textTertiary }}>
                Created {timeString}
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
                fontSize: 18,
                lineHeight: 25,
                fontWeight: "600",
                flex: 1,
                paddingRight: 8,
                color: theme.colors.textPrimary,
                letterSpacing: -0.2,
              }}
              numberOfLines={3}
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
                    fontSize: 14,
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
                    fontSize: 14,
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
