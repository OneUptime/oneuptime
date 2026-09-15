import React from "react";
import { Text, type TextProps, type TextStyle } from "react-native";
import { useTheme } from "../theme";
import { typography, type TypographyVariant } from "../theme/tokens";

export type TextTone =
  | "primary"
  | "secondary"
  | "tertiary"
  | "inverse"
  | "accent"
  | "danger"
  | "success"
  | "warning";

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  tone?: TextTone;
  /** An explicit colour wins over `tone`, for server-provided state colours. */
  color?: string;
  weight?: TextStyle["fontWeight"];
  align?: TextStyle["textAlign"];
}

/** Text that always uses the shared type scale and a theme colour. */
export default function AppText({
  variant = "body",
  tone = "primary",
  color,
  weight,
  align,
  style,
  ...rest
}: AppTextProps): React.JSX.Element {
  const { theme } = useTheme();
  const toneColors: Record<TextTone, string> = {
    primary: theme.colors.textPrimary,
    secondary: theme.colors.textSecondary,
    tertiary: theme.colors.textTertiary,
    inverse: theme.colors.textInverse,
    accent: theme.colors.actionPrimary,
    danger: theme.colors.statusError,
    success: theme.colors.statusSuccess,
    warning: theme.colors.statusWarning,
  };

  return (
    <Text
      {...rest}
      style={[
        typography[variant],
        { color: color ?? toneColors[tone] },
        weight ? { fontWeight: weight } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
