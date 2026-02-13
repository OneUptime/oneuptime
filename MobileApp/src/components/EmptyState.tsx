import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import GradientButton from "./GradientButton";

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
      <View
        className="w-20 h-20 rounded-2xl items-center justify-center"
        style={{
          backgroundColor: theme.colors.iconBackground,
        }}
      >
        <Ionicons
          name={iconMap[icon]}
          size={32}
          color={theme.colors.actionPrimary}
        />
      </View>

      <Text
        className="text-[20px] font-bold text-text-primary text-center mt-6"
        style={{ letterSpacing: -0.3 }}
      >
        {title}
      </Text>

      {subtitle ? (
        <Text className="text-[15px] text-text-secondary text-center mt-2 leading-[22px] max-w-[280px]">
          {subtitle}
        </Text>
      ) : null}

      {actionLabel && onAction ? (
        <View className="mt-6 w-[180px]">
          <GradientButton label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
