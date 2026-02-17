import React from "react";
import { View, Text, Pressable } from "react-native";
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
  const monitorNames: string = incident.monitors
    .map((m: NamedEntity) => {
      return m.name;
    })
    .join(", ");
  const timeString: string = formatRelativeTime(
    incident.declaredAt || incident.createdAt,
  );

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
      accessibilityLabel={`Incident ${incident.incidentNumberWithPrefix || incident.incidentNumber}, ${incident.title}. State: ${incident.currentIncidentState?.name ?? "unknown"}. Severity: ${incident.incidentSeverity?.name ?? "unknown"}.`}
    >
      <View
        style={{
          borderRadius: 24,
          overflow: "hidden",
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
                  name="warning-outline"
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
                  INCIDENT
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
                  {incident.incidentNumberWithPrefix ||
                    `#${incident.incidentNumber}`}
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
              {incident.title}
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
            {incident.currentIncidentState ? (
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
                  {incident.currentIncidentState.name}
                </Text>
              </View>
            ) : null}

            {incident.incidentSeverity ? (
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
                  {incident.incidentSeverity.name}
                </Text>
              </View>
            ) : null}
          </View>

          {monitorCount > 0 ? (
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
                  {monitorNames}
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    marginTop: 2,
                    color: theme.colors.textTertiary,
                  }}
                >
                  {monitorCount} monitor{monitorCount !== 1 ? "s" : ""}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
