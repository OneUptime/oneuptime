import React from "react";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import ResponseRow from "./ResponseRow";
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
  return (
    <ResponseRow
      title={episode.title}
      kind={type === "incident" ? "Incident episode" : "Alert episode"}
      number={episode.episodeNumberWithPrefix || `#${episode.episodeNumber}`}
      time={formatRelativeTime(
        (episode as IncidentEpisodeItem).declaredAt || episode.createdAt,
      )}
      state={state?.name}
      stateColor={
        state?.color ? rgbToHex(state.color) : theme.colors.textTertiary
      }
      severity={severity?.name}
      context={
        childCount > 0
          ? `${childCount} ${type}${childCount === 1 ? "" : "s"}`
          : undefined
      }
      projectName={projectName}
      muted={muted}
      accessibilityLabel={`${type === "incident" ? "Incident" : "Alert"} episode ${episode.episodeNumberWithPrefix || episode.episodeNumber}, ${episode.title}. State: ${state?.name ?? "unknown"}. Severity: ${severity?.name ?? "unknown"}.`}
      accessibilityHint="Open details and response actions"
      onPress={onPress}
    />
  );
}
