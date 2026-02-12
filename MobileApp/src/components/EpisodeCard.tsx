import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
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
      style={[
        styles.card,
        theme.shadows.sm,
        {
          backgroundColor: theme.colors.backgroundElevated,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.topRow}>
        <Text style={[styles.number, { color: theme.colors.textTertiary }]}>
          {episode.episodeNumberWithPrefix || `#${episode.episodeNumber}`}
        </Text>
        <Text style={[styles.time, { color: theme.colors.textTertiary }]}>
          {timeString}
        </Text>
      </View>

      <Text
        style={[
          theme.typography.bodyLarge,
          { color: theme.colors.textPrimary, fontWeight: "600" },
        ]}
        numberOfLines={2}
      >
        {episode.title}
      </Text>

      <View style={styles.badgeRow}>
        {state ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: theme.colors.backgroundTertiary },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: stateColor }]} />
            <Text
              style={[styles.badgeText, { color: theme.colors.textPrimary }]}
            >
              {state.name}
            </Text>
          </View>
        ) : null}

        {severity ? (
          <View
            style={[styles.badge, { backgroundColor: severityColor + "26" }]}
          >
            <Text style={[styles.badgeText, { color: severityColor }]}>
              {severity.name}
            </Text>
          </View>
        ) : null}
      </View>

      {childCount > 0 ? (
        <Text
          style={[styles.childCount, { color: theme.colors.textSecondary }]}
        >
          {childCount} {type === "incident" ? "incident" : "alert"}
          {childCount !== 1 ? "s" : ""}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles: ReturnType<typeof StyleSheet.create> = StyleSheet.create({
  card: {
    padding: 18,
    borderRadius: 16,
    marginBottom: 12,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  number: {
    fontSize: 13,
    fontWeight: "600",
  },
  time: {
    fontSize: 12,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  childCount: {
    fontSize: 12,
    marginTop: 8,
  },
});
