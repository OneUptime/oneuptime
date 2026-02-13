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
          shadowColor: "#000000",
          shadowOpacity: theme.isDark ? 0.3 : 0.08,
          shadowOffset: { width: 0, height: 2 },
          shadowRadius: 12,
          elevation: 3,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
