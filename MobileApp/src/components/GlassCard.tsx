import React from "react";
import { View, ViewStyle } from "react-native";
import { useTheme } from "../theme";

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  opaque?: boolean;
}

export default function GlassCard({
  children,
  style,
  opaque = false,
}: GlassCardProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      className="rounded-2xl overflow-hidden"
      style={[
        {
          backgroundColor: opaque
            ? theme.colors.backgroundElevated
            : theme.colors.backgroundGlass,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          shadowColor: theme.colors.accentGradientStart,
          shadowOpacity: theme.isDark ? 0.08 : 0.03,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 16,
          elevation: 4,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
