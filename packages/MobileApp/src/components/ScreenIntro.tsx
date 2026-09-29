import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { spacing } from "../theme/tokens";
import AppText from "./AppText";

interface ScreenIntroProps {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

/** A screen's large title with an optional short explanation beneath it. */
export default function ScreenIntro({
  title,
  description,
  eyebrow,
  action,
  style,
  compact = false,
}: ScreenIntroProps): React.JSX.Element {
  return (
    <View
      style={[
        {
          marginBottom: compact ? spacing.lg : spacing.xl,
          gap: spacing.xs,
        },
        style,
      ]}
    >
      {eyebrow ? (
        <AppText variant="overline" tone="accent">
          {eyebrow}
        </AppText>
      ) : null}
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
      >
        <AppText
          accessibilityRole="header"
          variant={compact ? "title" : "largeTitle"}
          style={{ flex: 1 }}
        >
          {title}
        </AppText>
        {action}
      </View>
      {description ? (
        <AppText variant="callout" tone="secondary">
          {description}
        </AppText>
      ) : null}
    </View>
  );
}
