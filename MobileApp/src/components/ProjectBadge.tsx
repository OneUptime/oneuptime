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
    <View className="flex-row items-center">
      <View
        className="w-2 h-2 rounded-full mr-1.5"
        style={{ backgroundColor: color || theme.colors.actionPrimary }}
      />
      <Text
        className="text-[12px] font-medium"
        style={{ color: theme.colors.textSecondary }}
        numberOfLines={1}
      >
        {name}
      </Text>
    </View>
  );
}
