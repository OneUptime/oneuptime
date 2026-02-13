import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
      {/* Outer gradient glow ring */}
      <View
        className="w-28 h-28 rounded-full items-center justify-center overflow-hidden"
      >
        <LinearGradient
          colors={[
            theme.colors.accentGradientStart + "26",
            theme.colors.accentGradientEnd + "26",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
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
        <View className="mt-6 w-[200px]">
          <GradientButton label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
