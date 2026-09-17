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
      onPress={() => {
        lightImpact();
        onPress();
      }}
      style={({ pressed }: { pressed: boolean }): ViewStyle => {
        return {
          flex: 1,
          minHeight: 116,
          padding: spacing.lg,
          gap: spacing.md,
          justifyContent: "space-between",
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.borderSubtle,
          backgroundColor: pressed
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
        <Ionicons
          name="chevron-forward"
          size={16}
          color={theme.colors.textTertiary}
        />
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
