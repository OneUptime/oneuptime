import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

type EmptyIcon = "incidents" | "alerts" | "episodes" | "notes" | "default";

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  icon?: EmptyIcon;
}

const iconMap: Record<EmptyIcon, keyof typeof Ionicons.glyphMap> = {
  incidents: "warning-outline",
  alerts: "notifications-outline",
  episodes: "layers-outline",
  notes: "document-text-outline",
  default: "remove-circle-outline",
};

export default function EmptyState({
  title,
  subtitle,
  icon = "default",
}: EmptyStateProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View className="flex-1 items-center justify-center px-10 py-20">
      <View className="w-16 h-16 items-center justify-center">
        <Ionicons
          name={iconMap[icon]}
          size={40}
          color={theme.colors.textTertiary}
        />
      </View>
      <Text className="text-title-sm text-text-primary text-center mt-5">
        {title}
      </Text>
      {subtitle ? (
        <Text className="text-body-md text-text-secondary text-center mt-2 leading-5">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
