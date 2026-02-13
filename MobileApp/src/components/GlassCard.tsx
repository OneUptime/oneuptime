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
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
