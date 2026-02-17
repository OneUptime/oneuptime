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
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 40,
        paddingVertical: 112,
      }}
    >
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
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
        style={{
          fontSize: 20,
          fontWeight: "bold",
          color: theme.colors.textPrimary,
          textAlign: "center",
          marginTop: 24,
          letterSpacing: -0.3,
        }}
      >
        {title}
      </Text>

      {subtitle ? (
        <Text
          style={{
            fontSize: 15,
            color: theme.colors.textSecondary,
            textAlign: "center",
            marginTop: 8,
            lineHeight: 22,
            maxWidth: 280,
          }}
        >
          {subtitle}
        </Text>
      ) : null}

      {actionLabel && onAction ? (
        <View style={{ marginTop: 24, width: 180 }}>
          <GradientButton label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
