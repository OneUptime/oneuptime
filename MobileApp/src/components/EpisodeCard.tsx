import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
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
    <TouchableOpacity
      className="mb-3"
      style={{
        opacity: muted ? 0.5 : 1,
      }}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View
        className="rounded-2xl overflow-hidden"
        style={{
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        }}
      >
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
                {episode.episodeNumberWithPrefix || `#${episode.episodeNumber}`}
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
            {episode.title}
          </Text>

          <View className="flex-row flex-wrap gap-2 mt-3">
            {state ? (
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
                  {state.name}
                </Text>
              </View>
            ) : null}

            {severity ? (
              <View
                className="flex-row items-center px-2 py-1 rounded-md"
                style={{ backgroundColor: severityColor + "14" }}
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
                className="flex-row items-center px-2 py-1 rounded-md"
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
    </TouchableOpacity>
  );
}
