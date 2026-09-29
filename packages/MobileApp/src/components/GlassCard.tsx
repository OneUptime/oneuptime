import React from "react";
import { View, ViewStyle } from "react-native";
import { useTheme } from "../theme";
import { radius } from "../theme/tokens";

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
      style={{
        borderRadius: radius.lg,
        overflow: "hidden",
        backgroundColor: opaque
          ? theme.colors.backgroundElevated
          : theme.colors.backgroundGlass,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
        ...style,
      }}
    >
      {children}
    </View>
  );
}
