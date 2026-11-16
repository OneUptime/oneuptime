import React from "react";
import { useTheme } from "../theme";
import { formatRelativeTime } from "../utils/date";
import {
  getMonitorRowStatus,
  type MonitorRowStatus,
} from "../utils/monitorHealth";
import { getMonitorStatusColor } from "../monitors/statusGuidance";
import ResponseRow from "./ResponseRow";
import type { MonitorItem } from "../api/types";

interface MonitorCardProps {
  monitor: MonitorItem;
  onPress: () => void;
  projectName?: string;
  muted?: boolean;
  /** Open in the detail pane beside the list. */
  selected?: boolean;
  showChevron?: boolean;
  /** Decides whether a first result is overdue; the current time otherwise. */
  now?: Date;
}

/*
 * The list's shorthand for a long type, by its name as the server stores it
 * ("SSL Certificate", not the enum's key SSLCertificate, which the server
 * never sends).
 */
function getMonitorTypeLabel(monitorType?: string): string {
  const labels: Record<string, string> = {
    "SSL Certificate": "SSL",
    "Incoming Request": "Incoming",
    "Synthetic Monitor": "Synthetic",
    "Custom JavaScript Code": "Custom",
  };
  return monitorType ? labels[monitorType] ?? monitorType : "Monitor";
}

export default function MonitorCard({
  monitor,
  onPress,
  projectName,
  muted,
  selected,
  showChevron,
  now,
}: MonitorCardProps): React.JSX.Element {
  const { theme } = useTheme();
  /*
   * What the web's row says of it (utils/monitorHealth): Disabled, Probes Not
   * Enabled, Probes Disconnected, or - for a monitor nothing has checked yet
   * - Paused, No results yet or Waiting for data, where its status is one no
   * check stands behind; otherwise its status. The screen reader hears the
   * same words.
   */
  const rowStatus: MonitorRowStatus = getMonitorRowStatus(monitor, now);
  return (
    <ResponseRow
      title={monitor.name}
      kind={getMonitorTypeLabel(monitor.monitorType)}
      time={`Created ${formatRelativeTime(monitor.createdAt)}`}
      state={rowStatus.text}
      stateColor={getMonitorStatusColor(
        theme.colors,
        rowStatus,
        monitor.currentMonitorStatus?.color,
      )}
      projectName={projectName}
      muted={muted}
      selected={selected}
      showChevron={showChevron}
      accessibilityLabel={`Monitor ${monitor.name}. Status: ${rowStatus.text}.`}
      accessibilityHint="Open details and status history"
      onPress={onPress}
    />
  );
}
