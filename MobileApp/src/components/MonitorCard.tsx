import React from "react";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import ResponseRow from "./ResponseRow";
import type { MonitorItem } from "../api/types";

interface MonitorCardProps {
  monitor: MonitorItem;
  onPress: () => void;
  projectName?: string;
  muted?: boolean;
}

function getMonitorTypeLabel(monitorType?: string): string {
  const labels: Record<string, string> = {
    SSLCertificate: "SSL",
    IncomingRequest: "Incoming",
    SyntheticMonitor: "Synthetic",
    CustomJavaScriptCode: "Custom",
  };
  return monitorType ? labels[monitorType] ?? monitorType : "Monitor";
}

export default function MonitorCard({
  monitor,
  onPress,
  projectName,
  muted,
}: MonitorCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const isDisabled: boolean = monitor.disableActiveMonitoring === true;
  // Disabled monitoring cannot promise its last observed status is still true.
  const statusLabel: string = isDisabled
    ? "Disabled"
    : monitor.currentMonitorStatus?.name ?? "unknown";
  return (
    <ResponseRow
      title={monitor.name}
      kind={getMonitorTypeLabel(monitor.monitorType)}
      time={`Created ${formatRelativeTime(monitor.createdAt)}`}
      state={isDisabled ? "Disabled" : monitor.currentMonitorStatus?.name}
      stateColor={
        !isDisabled && monitor.currentMonitorStatus?.color
          ? rgbToHex(monitor.currentMonitorStatus.color)
          : theme.colors.textTertiary
      }
      projectName={projectName}
      muted={muted}
      accessibilityLabel={`Monitor ${monitor.name}. Status: ${statusLabel}.`}
      accessibilityHint="Open details and status history"
      onPress={onPress}
    />
  );
}
