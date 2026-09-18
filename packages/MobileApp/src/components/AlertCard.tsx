import React from "react";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import ResponseRow from "./ResponseRow";
import type { AlertItem } from "../api/types";

interface AlertCardProps {
  alert: AlertItem;
  onPress: () => void;
  projectName?: string;
  muted?: boolean;
}

export default function AlertCard({
  alert,
  onPress,
  projectName,
  muted,
}: AlertCardProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <ResponseRow
      title={alert.title}
      kind="Alert"
      number={alert.alertNumberWithPrefix || `#${alert.alertNumber}`}
      time={formatRelativeTime(alert.createdAt)}
      state={alert.currentAlertState?.name}
      stateColor={
        alert.currentAlertState?.color
          ? rgbToHex(alert.currentAlertState.color)
          : theme.colors.textTertiary
      }
      severity={alert.alertSeverity?.name}
      context={alert.monitor?.name}
      contextLabel={alert.monitor ? "Linked monitor" : undefined}
      projectName={projectName}
      muted={muted}
      accessibilityLabel={`Alert ${alert.alertNumberWithPrefix || alert.alertNumber}, ${alert.title}. State: ${alert.currentAlertState?.name ?? "unknown"}. Severity: ${alert.alertSeverity?.name ?? "unknown"}.`}
      accessibilityHint="Open details and response actions"
      onPress={onPress}
    />
  );
}
