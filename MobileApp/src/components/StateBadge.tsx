import React from "react";
import { View, Text } from "react-native";
import { useTheme } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";
import { withAlpha } from "../utils/color";

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

  /*
   * A state outside the five - a project's own state name passed straight
   * through - has no colour of its own. It gets a hollow ring rather than a
   * filled dot, so it cannot borrow the meaning of another state's colour.
   */
  const color: string | undefined = colorMap[state];
  const displayLabel: string = label || state;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: spacing.xs + 2,
        paddingHorizontal: spacing.sm + 2,
        paddingVertical: spacing.xs,
        borderRadius: radius.pill,
        backgroundColor: color
          ? withAlpha(color, theme.dark ? 0.18 : 0.1)
          : theme.colors.backgroundTertiary,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: radius.pill,
          backgroundColor: color ?? "transparent",
          borderWidth: color ? 0 : 1.5,
          borderColor: theme.colors.textTertiary,
        }}
      />
      <Text
        numberOfLines={1}
        style={{
          ...typography.caption,
          fontWeight: "600",
          color: theme.colors.textPrimary,
        }}
      >
        {displayLabel.charAt(0).toUpperCase() + displayLabel.slice(1)}
      </Text>
    </View>
  );
}
