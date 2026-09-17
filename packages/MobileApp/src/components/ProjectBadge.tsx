import React from "react";
import { View, Text } from "react-native";
import { useTheme } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";

interface ProjectBadgeProps {
  name: string;
  color?: string;
}

export default function ProjectBadge({
  name,
  color,
}: ProjectBadgeProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs + 2,
        minWidth: 0,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: radius.pill,
          backgroundColor: color || theme.colors.actionPrimary,
        }}
      />
      <Text
        style={{
          ...typography.caption,
          flexShrink: 1,
          color: theme.colors.textSecondary,
        }}
        numberOfLines={1}
      >
        {name}
      </Text>
    </View>
  );
}
