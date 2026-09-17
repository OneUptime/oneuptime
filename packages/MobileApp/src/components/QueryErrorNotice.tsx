import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";

interface QueryErrorNoticeProps {
  message: string;
  retryLabel: string;
  onRetry: () => unknown;
}

/** A failed read, said plainly, with the way to try again right beside it. */
export default function QueryErrorNotice({
  message,
  retryLabel,
  onRetry,
}: QueryErrorNoticeProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={{
        padding: spacing.md + 2,
        borderRadius: radius.lg,
        backgroundColor: theme.colors.statusWarningBg,
        marginBottom: spacing.lg,
        gap: spacing.sm + 2,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.md,
        }}
      >
        <Ionicons
          name="cloud-offline-outline"
          size={20}
          color={theme.colors.statusWarning}
          style={{ marginTop: 1 }}
        />
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{
            ...typography.subhead,
            flex: 1,
            color: theme.colors.textPrimary,
          }}
        >
          {message}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
        onPress={onRetry}
        hitSlop={6}
        style={({ pressed }: { pressed: boolean }) => {
          return {
            alignSelf: "flex-start",
            marginLeft: 32,
            justifyContent: "center",
            minHeight: 40,
            paddingHorizontal: spacing.md,
            borderRadius: radius.pill,
            backgroundColor: theme.colors.backgroundElevated,
            opacity: pressed ? 0.7 : 1,
          };
        }}
      >
        <Text
          style={{
            ...typography.footnote,
            fontWeight: "700",
            color: theme.colors.actionPrimary,
          }}
        >
          {retryLabel}
        </Text>
      </Pressable>
    </View>
  );
}
