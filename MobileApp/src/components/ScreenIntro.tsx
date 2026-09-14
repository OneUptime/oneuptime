import React from "react";
import { View, Text, type ViewStyle } from "react-native";
import { useTheme } from "../theme";

interface ScreenIntroProps {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  style?: ViewStyle;
  compact?: boolean;
}

export default function ScreenIntro({
  title,
  description,
  eyebrow,
  action,
  style,
  compact = false,
}: ScreenIntroProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={[{ marginBottom: compact ? 16 : 24, gap: compact ? 6 : 8 }, style]}
    >
      {eyebrow ? (
        <Text
          style={{
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 1.5,
            color: theme.colors.textTertiary,
          }}
        >
          {eyebrow.toUpperCase()}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text
          accessibilityRole="header"
          style={{
            flex: 1,
            fontSize: compact ? 28 : 34,
            lineHeight: compact ? 35 : 42,
            fontWeight: "800",
            letterSpacing: -1.2,
            color: theme.colors.textPrimary,
          }}
        >
          {title}
        </Text>
        {action}
      </View>
      {description ? (
        <Text
          style={{
            fontSize: 15,
            lineHeight: 23,
            color: theme.colors.textSecondary,
          }}
        >
          {description}
        </Text>
      ) : null}
    </View>
  );
}
