import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

type EmptyIcon = "incidents" | "alerts" | "episodes" | "notes" | "default";

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  icon?: EmptyIcon;
  actionLabel?: string;
  onAction?: () => void;
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
  actionLabel,
  onAction,
}: EmptyStateProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View className="flex-1 items-center justify-center px-10 py-28">
      {/* Outer glow ring */}
      <View
        className="w-28 h-28 rounded-full items-center justify-center"
        style={{ backgroundColor: theme.colors.surfaceGlow }}
      >
        {/* Inner icon container */}
        <View
          className="w-20 h-20 rounded-full items-center justify-center"
          style={{
            backgroundColor: theme.colors.accentGradientStart + "18",
          }}
        >
          <Ionicons
            name={iconMap[icon]}
            size={36}
            color={theme.colors.accentGradientStart}
          />
        </View>
      </View>

      <Text
        className="text-title-md text-text-primary text-center mt-7"
        style={{ letterSpacing: -0.3 }}
      >
        {title}
      </Text>

      {subtitle ? (
        <Text className="text-body-md text-text-secondary text-center mt-2.5 leading-6 max-w-[280px]">
          {subtitle}
        </Text>
      ) : null}

      {actionLabel && onAction ? (
        <TouchableOpacity
          className="mt-6 px-8 py-3 rounded-xl items-center"
          style={{
            backgroundColor: theme.colors.actionPrimary,
            shadowColor: theme.colors.actionPrimary,
            shadowOpacity: 0.25,
            shadowOffset: { width: 0, height: 4 },
            shadowRadius: 12,
            elevation: 4,
          }}
          onPress={onAction}
          activeOpacity={0.8}
        >
          <Text className="text-body-md text-text-inverse font-semibold">
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
