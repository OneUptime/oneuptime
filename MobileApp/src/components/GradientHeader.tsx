import React from "react";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";

interface GradientHeaderProps {
  height?: number;
  children?: React.ReactNode;
}

export default function GradientHeader({
  height = 320,
  children,
}: GradientHeaderProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <LinearGradient
      colors={[theme.colors.gradientStart, theme.colors.gradientEnd]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height,
      }}
    >
      {children}
    </LinearGradient>
  );
}
