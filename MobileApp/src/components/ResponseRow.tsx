import React from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { elevation, radius, spacing, typography } from "../theme/tokens";

interface ResponseRowProps {
  title: string;
  kind: string;
  number?: string;
  time: string;
  state?: string;
  stateColor: string;
  severity?: string;
  context?: string;
  contextLabel?: string;
  projectName?: string;
  muted?: boolean;
  accessibilityLabel: string;
  accessibilityHint: string;
  onPress: () => void;
}

/**
 * A scan-friendly response card: status first, then the problem, then where
 * it came from. State is always spelled out; the coloured dot only repeats it.
 */
export default function ResponseRow({
  title,
  kind,
  number,
  time,
  state,
  stateColor,
  severity,
  context,
  contextLabel,
  projectName,
  muted,
  accessibilityLabel,
  accessibilityHint,
  onPress,
}: ResponseRowProps): React.JSX.Element {
  const { theme } = useTheme();
  const meta: string = [number, kind].filter(Boolean).join(" · ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }: { pressed: boolean }): ViewStyle => {
        return {
          padding: spacing.lg,
          marginBottom: spacing.md,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.borderSubtle,
          backgroundColor: pressed
            ? theme.colors.backgroundTertiary
            : theme.colors.backgroundElevated,
          ...elevation(muted ? "none" : "card", theme.dark),
        };
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            columnGap: spacing.sm,
            rowGap: spacing.xs,
          }}
        >
          <View
            testID="response-status-marker"
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: stateColor,
              opacity: muted ? 0.6 : 1,
            }}
          />
          {state ? (
            <Text
              style={{
                ...typography.footnote,
                fontWeight: "700",
                color: theme.colors.textPrimary,
              }}
            >
              {state}
            </Text>
          ) : null}
          {state && severity ? (
            <Text
              style={{
                ...typography.footnote,
                color: theme.colors.textTertiary,
              }}
            >
              ·
            </Text>
          ) : null}
          {severity ? (
            <Text
              style={{
                ...typography.footnote,
                fontWeight: "500",
                color: theme.colors.textSecondary,
              }}
            >
              {severity}
            </Text>
          ) : null}
        </View>
        <Text
          style={{
            ...typography.footnote,
            color: theme.colors.textTertiary,
            fontVariant: ["tabular-nums"],
          }}
        >
          {time}
        </Text>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.sm,
          marginTop: spacing.sm,
        }}
      >
        <Text
          numberOfLines={3}
          style={{
            ...typography.headline,
            fontSize: 17,
            lineHeight: 23,
            flex: 1,
            minWidth: 0,
            color: muted
              ? theme.colors.textSecondary
              : theme.colors.textPrimary,
          }}
        >
          {title}
        </Text>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={theme.colors.textTertiary}
          style={{ marginTop: 2 }}
        />
      </View>

      <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
        <Text
          numberOfLines={1}
          style={{ ...typography.footnote, color: theme.colors.textSecondary }}
        >
          {meta}
        </Text>
        {context ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.xs + 2,
            }}
          >
            <Ionicons
              name="pulse-outline"
              size={14}
              color={theme.colors.textTertiary}
              style={{ marginTop: 2 }}
            />
            <Text
              numberOfLines={2}
              style={{
                ...typography.footnote,
                flex: 1,
                color: theme.colors.textSecondary,
              }}
            >
              {contextLabel ? `${contextLabel}: ${context}` : context}
            </Text>
          </View>
        ) : null}
        {projectName ? (
          <Text
            numberOfLines={1}
            style={{
              ...typography.footnote,
              color: theme.colors.textSecondary,
            }}
          >
            {projectName}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
