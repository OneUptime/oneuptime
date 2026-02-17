import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import ProjectBadge from "./ProjectBadge";
import type {
  IncidentEpisodeItem,
  AlertEpisodeItem,
  NamedEntityWithColor,
} from "../api/types";

type EpisodeCardProps =
  | {
      episode: IncidentEpisodeItem;
      type: "incident";
      onPress: () => void;
      projectName?: string;
      muted?: boolean;
    }
  | {
      episode: AlertEpisodeItem;
      type: "alert";
      onPress: () => void;
      projectName?: string;
      muted?: boolean;
    };

export default function EpisodeCard(
  props: EpisodeCardProps,
): React.JSX.Element {
  const { episode, type, onPress, projectName, muted } = props;
  const { theme } = useTheme();

  const state: NamedEntityWithColor =
    type === "incident"
      ? (episode as IncidentEpisodeItem).currentIncidentState
      : (episode as AlertEpisodeItem).currentAlertState;

  const severity: NamedEntityWithColor =
    type === "incident"
      ? (episode as IncidentEpisodeItem).incidentSeverity
      : (episode as AlertEpisodeItem).alertSeverity;

  const childCount: number =
    type === "incident"
      ? (episode as IncidentEpisodeItem).incidentCount
      : (episode as AlertEpisodeItem).alertCount;

  const stateColor: string = state?.color
    ? rgbToHex(state.color)
    : theme.colors.textTertiary;

  const severityColor: string = severity?.color
    ? rgbToHex(severity.color)
    : theme.colors.textTertiary;

  const timeString: string = formatRelativeTime(
    (episode as IncidentEpisodeItem).declaredAt || episode.createdAt,
  );

  return (
    <Pressable
      style={({ pressed }) => ({
        marginBottom: 12,
        opacity: pressed ? 0.7 : muted ? 0.5 : 1,
      })}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${type === "incident" ? "Incident" : "Alert"} episode ${episode.episodeNumberWithPrefix || episode.episodeNumber}, ${episode.title}. State: ${state?.name ?? "unknown"}. Severity: ${severity?.name ?? "unknown"}.`}
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
                  name={
                    type === "incident"
                      ? "warning-outline"
                      : "notifications-outline"
                  }
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
                  {type === "incident" ? "INCIDENT EPISODE" : "ALERT EPISODE"}
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
                  {episode.episodeNumberWithPrefix ||
                    `#${episode.episodeNumber}`}
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
              {episode.title}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={theme.colors.textTertiary}
              style={{ marginTop: 2 }}
            />
          </View>

          <View className="flex-row flex-wrap gap-2 mt-3">
            {state ? (
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
                  {state.name}
                </Text>
              </View>
            ) : null}

            {severity ? (
              <View
                className="flex-row items-center px-2.5 py-1 rounded-full"
                style={{ backgroundColor: theme.colors.backgroundTertiary }}
              >
                <Text
                  className="text-[11px] font-semibold"
                  style={{ color: severityColor }}
                >
                  {severity.name}
                </Text>
              </View>
            ) : null}

            {childCount > 0 ? (
              <View
                className="flex-row items-center px-2.5 py-1 rounded-full"
                style={{ backgroundColor: theme.colors.iconBackground }}
              >
                <Text
                  className="text-[11px] font-semibold"
                  style={{ color: theme.colors.actionPrimary }}
                >
                  {childCount} {type === "incident" ? "incident" : "alert"}
                  {childCount !== 1 ? "s" : ""}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
