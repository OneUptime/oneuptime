import React from "react";
import { View, Text } from "react-native";
import { useTheme } from "../theme";

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
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 9999,
          marginRight: 6,
          backgroundColor: color || theme.colors.actionPrimary,
        }}
      />
      <Text
        style={{
          fontSize: 12,
          fontWeight: "500",
          color: theme.colors.textSecondary,
        }}
        numberOfLines={1}
      >
        {name}
      </Text>
    </View>
  );
}
