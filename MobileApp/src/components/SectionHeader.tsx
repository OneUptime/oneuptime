import React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";
import AppText from "./AppText";

interface SectionHeaderProps {
  title: string;
  iconName?: keyof typeof Ionicons.glyphMap;
  /** A total shown beside the title, e.g. how many rows follow. */
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
}

export default function SectionHeader({
  title,
  iconName,
  count,
  actionLabel,
  onAction,
}: SectionHeaderProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        marginBottom: spacing.md,
        minHeight: 28,
      }}
    >
      {iconName ? (
        <Ionicons
          name={iconName}
          size={18}
          color={theme.colors.textTertiary}
          style={{ width: 20, textAlign: "center" }}
        />
      ) : null}
      <AppText
        accessibilityRole="header"
        variant="title3"
        style={{ flexShrink: 1 }}
      >
        {title}
      </AppText>
      {count !== undefined ? (
        <View
          style={{
            minWidth: 24,
            paddingHorizontal: spacing.sm - 1,
            paddingVertical: 1,
            borderRadius: radius.pill,
            backgroundColor: theme.colors.backgroundTertiary,
            alignItems: "center",
          }}
        >
          <AppText
            variant="caption"
            tone="secondary"
            weight="700"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {count}
          </AppText>
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={10}
          style={({ pressed }: { pressed: boolean }) => {
            return {
              opacity: pressed ? 0.6 : 1,
              minHeight: 32,
              justifyContent: "center",
            };
          }}
        >
          <AppText
            style={[typography.subhead, { fontWeight: "600" }]}
            tone="accent"
          >
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
