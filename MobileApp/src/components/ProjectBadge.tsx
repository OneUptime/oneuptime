import React from "react";
import { View, Text } from "react-native";

interface ProjectBadgeProps {
  name: string;
  color?: string;
}

export default function ProjectBadge({
  name,
  color,
}: ProjectBadgeProps): React.JSX.Element {
  return (
    <View className="flex-row items-center">
      <View
        className="w-2 h-2 rounded-full mr-1.5"
        style={color ? { backgroundColor: color } : undefined}
      />
      <Text className="text-body-sm text-text-secondary" numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}
