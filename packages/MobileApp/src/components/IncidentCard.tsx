import React from "react";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import ResponseRow from "./ResponseRow";
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
  const monitorCount: number = incident.monitors?.length ?? 0;
  return (
    <ResponseRow
      title={incident.title}
      kind="Incident"
      number={
        incident.incidentNumberWithPrefix || `#${incident.incidentNumber}`
      }
      time={formatRelativeTime(incident.declaredAt || incident.createdAt)}
      state={incident.currentIncidentState?.name}
      stateColor={
        incident.currentIncidentState?.color
          ? rgbToHex(incident.currentIncidentState.color)
          : theme.colors.textTertiary
      }
      severity={incident.incidentSeverity?.name}
      context={(incident.monitors ?? [])
        .map((monitor: NamedEntity) => {
          return monitor.name;
        })
        .join(", ")}
      contextLabel={
        monitorCount
          ? `${monitorCount} ${monitorCount === 1 ? "monitor" : "monitors"}`
          : undefined
      }
      projectName={projectName}
      muted={muted}
      accessibilityLabel={`Incident ${incident.incidentNumberWithPrefix || incident.incidentNumber}, ${incident.title}. State: ${incident.currentIncidentState?.name ?? "unknown"}. Severity: ${incident.incidentSeverity?.name ?? "unknown"}.`}
      accessibilityHint="Open details and response actions"
      onPress={onPress}
    />
  );
}
