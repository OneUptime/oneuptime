import React from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius, spacing, touchTarget } from "../theme/tokens";
import AppText from "./AppText";
import { getToneColors, type StatusTone } from "./StatusPill";

interface BannerProps {
  tone?: StatusTone;
  title?: string;
  message: string;
  icon?: keyof typeof Ionicons.glyphMap;
  actionLabel?: string;
  onAction?: () => void;
  /** Makes the whole banner a button, e.g. a banner that opens a screen. */
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const defaultIcons: Record<StatusTone, keyof typeof Ionicons.glyphMap> = {
  neutral: "information-circle",
  info: "information-circle",
  accent: "sparkles",
  success: "checkmark-circle",
  warning: "warning",
  danger: "alert-circle",
};

/** A tinted inline message for warnings, errors and helpful context. */
export default function Banner({
  tone = "info",
  title,
  message,
  icon,
  actionLabel,
  onAction,
  onPress,
  accessibilityLabel,
  style,
  testID,
}: BannerProps): React.JSX.Element {
  const { theme } = useTheme();
  const colors: { text: string; background: string } = getToneColors(
    theme,
    tone,
  );
  const isAlert: boolean = tone === "danger" || tone === "warning";

  const actionButton: React.JSX.Element | null =
    actionLabel && onAction ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        onPress={onAction}
        hitSlop={8}
        style={({ pressed }: { pressed: boolean }): ViewStyle => {
          return {
            alignSelf: "flex-start",
            minHeight: touchTarget - 12,
            justifyContent: "center",
            marginTop: spacing.xs,
            opacity: pressed ? 0.7 : 1,
          };
        }}
      >
        <AppText variant="subhead" weight="700" color={colors.text}>
          {actionLabel}
        </AppText>
      </Pressable>
    ) : null;

  const content: React.JSX.Element = (
    <View style={{ flexDirection: "row", gap: spacing.md }}>
      <Ionicons
        name={icon ?? defaultIcons[tone]}
        size={20}
        color={colors.text}
        style={{ marginTop: 1 }}
      />
      <View style={{ flex: 1, gap: spacing.xs }}>
        {title ? (
          <AppText variant="headline" color={colors.text}>
            {title}
          </AppText>
        ) : null}
        <AppText
          variant="subhead"
          tone={title ? "secondary" : undefined}
          color={title ? undefined : colors.text}
          accessibilityRole={isAlert && !onPress ? "alert" : undefined}
        >
          {message}
        </AppText>
        {!onPress ? actionButton : null}
      </View>
      {onPress ? (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.text}
          style={{ alignSelf: "center" }}
        />
      ) : null}
    </View>
  );

  const surface: ViewStyle = {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  };

  if (onPress) {
    /*
     * The action sits beside the tappable area, not inside it: a button nested
     * in another button cannot be focused by VoiceOver or TalkBack.
     */
    const tappable: React.JSX.Element = (
      <Pressable
        testID={actionButton ? undefined : testID}
        accessibilityRole="button"
        accessibilityLabel={
          accessibilityLabel ?? [title, message].filter(Boolean).join(". ")
        }
        onPress={onPress}
        style={({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => {
          return actionButton
            ? { opacity: pressed ? 0.8 : 1 }
            : [surface, { opacity: pressed ? 0.8 : 1 }, style];
        }}
      >
        {content}
      </Pressable>
    );

    if (!actionButton) {
      return tappable;
    }

    return (
      <View testID={testID} style={[surface, style]}>
        {tappable}
        <View style={{ marginLeft: 20 + spacing.md }}>{actionButton}</View>
      </View>
    );
  }

  return (
    <View testID={testID} style={[surface, style]}>
      {content}
    </View>
  );
}
