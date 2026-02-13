import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import ProjectBadge from "./ProjectBadge";
import GlassCard from "./GlassCard";
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
    <TouchableOpacity
      className="mb-3"
      style={{
        opacity: muted ? 0.55 : 1,
      }}
      onPress={onPress}
      activeOpacity={0.7}
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
                {episode.episodeNumberWithPrefix || `#${episode.episodeNumber}`}
              </Text>
            </View>
            <Text className="text-[12px] text-text-tertiary">{timeString}</Text>
          </View>

          <Text
            className="text-body-lg text-text-primary font-semibold mt-0.5"
            numberOfLines={2}
          >
            {episode.title}
          </Text>

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
                <Text className="text-[12px] font-semibold text-text-primary">
                  {state.name}
                </Text>
              </View>
            ) : null}

            {severity ? (
              <View
                className="flex-row items-center px-2.5 py-1 rounded-full"
                style={{ backgroundColor: severityColor + "15" }}
              >
                <Text
                  className="text-[12px] font-semibold"
                  style={{ color: severityColor }}
                >
                  {severity.name}
                </Text>
              </View>
            ) : null}

            {childCount > 0 ? (
              <View
                className="flex-row items-center px-2.5 py-1 rounded-full"
                style={{ backgroundColor: theme.colors.backgroundTertiary }}
              >
                <Text className="text-[12px] font-semibold text-text-secondary">
                  {childCount} {type === "incident" ? "incident" : "alert"}
                  {childCount !== 1 ? "s" : ""}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        </View>
      </GlassCard>
    </TouchableOpacity>
  );
}
