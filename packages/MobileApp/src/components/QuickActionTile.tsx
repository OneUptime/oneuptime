import React from "react";
import { View, Pressable, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { elevation, radius, spacing } from "../theme/tokens";
import { useHaptics } from "../hooks/useHaptics";
import AppText from "./AppText";
import IconBadge from "./IconBadge";

interface QuickActionTileProps {
  label: string;
  sublabel?: string;
  iconName: keyof typeof Ionicons.glyphMap;
  accentColor?: string;
  onPress: () => void;
  /** What it opens is showing in the detail pane beside the overview. */
  selected?: boolean;
  /** Beside a detail pane the tile opens on the right, not on a new screen. */
  showChevron?: boolean;
  testID?: string;
}

/*
 * A one-tap route out of the on-call tab.
 *
 * These sit above the fold on purpose: the two things a responder does from a
 * phone are "find out who else is on" and "get someone to cover me", and both
 * of them are urgent by definition. Burying either behind a scroll makes the
 * screen a dashboard instead of a tool.
 */
export default function QuickActionTile({
  label,
  sublabel,
  iconName,
  accentColor,
  onPress,
  selected = false,
  showChevron = true,
  testID,
}: QuickActionTileProps): React.JSX.Element {
  const { theme } = useTheme();
  const { lightImpact } = useHaptics();

  const accent: string = accentColor ?? theme.colors.actionPrimary;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={sublabel ? `${label}. ${sublabel}` : label}
      accessibilityState={{ selected }}
      aria-selected={selected}
      onPress={() => {
        lightImpact();
        onPress();
      }}
      style={({ pressed }: { pressed: boolean }): ViewStyle => {
        return {
          flex: 1,
          minHeight: 116,
          // The thicker selected border must not shift the tile's content.
          padding: spacing.lg - (selected ? 1 : 0),
          gap: spacing.md,
          justifyContent: "space-between",
          borderRadius: radius.lg,
          borderWidth: selected ? 2 : 1,
          borderColor: selected
            ? theme.colors.actionPrimary
            : theme.colors.borderSubtle,
          backgroundColor: selected
            ? theme.colors.cardAccent
            : pressed
              ? theme.colors.backgroundTertiary
              : theme.colors.backgroundElevated,
          transform: pressed ? [{ scale: 0.98 }] : undefined,
          ...elevation("card", theme.dark),
        };
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <IconBadge name={iconName} color={accent} size="md" />
        {showChevron ? (
          <Ionicons
            name="chevron-forward"
            size={16}
            color={theme.colors.textTertiary}
          />
        ) : null}
      </View>

      <View style={{ gap: spacing.xxs }}>
        <AppText variant="headline">{label}</AppText>
        {sublabel ? (
          <AppText variant="footnote" tone="secondary">
            {sublabel}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}
