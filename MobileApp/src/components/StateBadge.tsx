import React from "react";
import { View, Text } from "react-native";
import { useTheme } from "../theme";

export type StateType =
  | "created"
  | "acknowledged"
  | "resolved"
  | "investigating"
  | "muted";

interface StateBadgeProps {
  state: StateType;
  label?: string;
}

export default function StateBadge({
  state,
  label,
}: StateBadgeProps): React.JSX.Element {
  const { theme } = useTheme();

  const colorMap: Record<StateType, string> = {
    created: theme.colors.stateCreated,
    acknowledged: theme.colors.stateAcknowledged,
    resolved: theme.colors.stateResolved,
    investigating: theme.colors.stateInvestigating,
    muted: theme.colors.stateMuted,
  };

  const color: string = colorMap[state];
  const displayLabel: string = label || state;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        alignSelf: "flex-start",
        backgroundColor: theme.colors.backgroundTertiary,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 9999,
          marginRight: 6,
          backgroundColor: color,
        }}
      />
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: theme.colors.textPrimary,
        }}
      >
        {displayLabel.charAt(0).toUpperCase() + displayLabel.slice(1)}
      </Text>
    </View>
  );
}
