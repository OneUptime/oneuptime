import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
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
    }
  | {
      episode: AlertEpisodeItem;
      type: "alert";
      onPress: () => void;
    };

export default function EpisodeCard(
  props: EpisodeCardProps,
): React.JSX.Element {
  const { episode, type, onPress } = props;
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
      className="p-[18px] rounded-2xl mb-3 bg-bg-elevated shadow-sm"
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View className="flex-row justify-between items-center mb-1.5">
        <Text className="text-[13px] font-semibold text-text-tertiary">
          {episode.episodeNumberWithPrefix || `#${episode.episodeNumber}`}
        </Text>
        <Text className="text-xs text-text-tertiary">{timeString}</Text>
      </View>

      <Text
        className="text-body-lg text-text-primary font-semibold"
        numberOfLines={2}
      >
        {episode.title}
      </Text>

      <View className="flex-row flex-wrap gap-2 mt-2.5">
        {state ? (
          <View className="flex-row items-center px-2 py-1 rounded-md bg-bg-tertiary">
            <View
              className="w-2 h-2 rounded-full mr-1.5"
              style={{ backgroundColor: stateColor }}
            />
            <Text className="text-xs font-semibold text-text-primary">
              {state.name}
            </Text>
          </View>
        ) : null}

        {severity ? (
          <View
            className="flex-row items-center px-2 py-1 rounded-md"
            style={{ backgroundColor: severityColor + "26" }}
          >
            <Text
              className="text-xs font-semibold"
              style={{ color: severityColor }}
            >
              {severity.name}
            </Text>
          </View>
        ) : null}
      </View>

      {childCount > 0 ? (
        <Text className="text-xs text-text-secondary mt-2">
          {childCount} {type === "incident" ? "incident" : "alert"}
          {childCount !== 1 ? "s" : ""}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}
