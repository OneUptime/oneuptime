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
    <View className="flex-row items-center px-2 py-1 rounded-md self-start bg-bg-tertiary">
      <View
        className="w-2 h-2 rounded-full mr-1.5"
        style={{ backgroundColor: color }}
      />
      <Text className="text-xs font-semibold text-text-primary">
        {displayLabel.charAt(0).toUpperCase() + displayLabel.slice(1)}
      </Text>
    </View>
  );
}
