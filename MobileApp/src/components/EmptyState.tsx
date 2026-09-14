import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import AppText from "./AppText";
import GradientButton from "./GradientButton";
import IconBadge from "./IconBadge";

type EmptyIcon =
  | "incidents"
  | "alerts"
  | "episodes"
  | "notes"
  | "monitors"
  | "success"
  | "error"
  | "default";

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  icon?: EmptyIcon;
  actionLabel?: string;
  onAction?: () => void;
  /** Keep the state tight when it sits inside a card or a short section. */
  compact?: boolean;
}

const iconMap: Record<EmptyIcon, keyof typeof Ionicons.glyphMap> = {
  incidents: "warning-outline",
  alerts: "notifications-outline",
  episodes: "layers-outline",
  notes: "document-text-outline",
  monitors: "pulse-outline",
  success: "checkmark-circle-outline",
  error: "cloud-offline-outline",
  default: "remove-circle-outline",
};

export default function EmptyState({
  title,
  subtitle,
  icon = "default",
  actionLabel,
  onAction,
  compact = false,
}: EmptyStateProps): React.JSX.Element {
  const { theme } = useTheme();
  const iconColor: string =
    icon === "success"
      ? theme.colors.statusSuccess
      : icon === "error"
        ? theme.colors.statusError
        : theme.colors.actionPrimary;

  return (
    <View
      style={{
        flex: compact ? undefined : 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.xxl,
        paddingVertical: compact ? spacing.xxl : spacing.xxxl + spacing.lg,
      }}
    >
      <IconBadge
        name={iconMap[icon] ?? iconMap.default}
        color={iconColor}
        size="lg"
        shape="circle"
      />

      <AppText
        accessibilityRole="header"
        variant="title3"
        align="center"
        style={{ marginTop: spacing.lg, fontSize: 19, lineHeight: 25 }}
      >
        {title}
      </AppText>

      {subtitle ? (
        <AppText
          variant="subhead"
          tone="secondary"
          align="center"
          style={{ marginTop: spacing.sm, maxWidth: 300 }}
        >
          {subtitle}
        </AppText>
      ) : null}

      {actionLabel && onAction ? (
        <View style={{ marginTop: spacing.xl, minWidth: 180 }}>
          <GradientButton
            label={actionLabel}
            onPress={onAction}
            variant="tonal"
          />
        </View>
      ) : null}
    </View>
  );
}
