import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius } from "../theme/tokens";
import { withAlpha } from "../utils/color";

export type IconBadgeSize = "sm" | "md" | "lg";

interface IconBadgeProps {
  name: keyof typeof Ionicons.glyphMap;
  /** Icon colour; the tile is a soft tint of it unless `background` is set. */
  color?: string;
  background?: string;
  size?: IconBadgeSize;
  shape?: "rounded" | "circle";
  testID?: string;
}

const dimensions: Record<IconBadgeSize, { box: number; icon: number }> = {
  sm: { box: 30, icon: 16 },
  md: { box: 38, icon: 20 },
  lg: { box: 52, icon: 26 },
};

/** A tinted tile that gives an icon a consistent footprint in rows and cards. */
export default function IconBadge({
  name,
  color,
  background,
  size = "md",
  shape = "rounded",
  testID,
}: IconBadgeProps): React.JSX.Element {
  const { theme } = useTheme();
  const iconColor: string = color ?? theme.colors.actionPrimary;
  const { box, icon } = dimensions[size];

  return (
    <View
      testID={testID}
      style={{
        width: box,
        height: box,
        borderRadius:
          shape === "circle" ? box / 2 : radius.md - (size === "sm" ? 3 : 0),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor:
          background ?? withAlpha(iconColor, theme.dark ? 0.2 : 0.12),
      }}
    >
      <Ionicons name={name} size={icon} color={iconColor} />
    </View>
  );
}
