import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

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

/** A scan-friendly response row: the problem first, its context second. */
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }: { pressed: boolean }) => {
        return {
          minHeight: 112,
          padding: 18,
          marginBottom: 8,
          borderRadius: 18,
          backgroundColor: pressed
            ? theme.colors.backgroundTertiary
            : theme.colors.backgroundElevated,
        };
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View
          testID="response-status-marker"
          style={{
            width: 4,
            minHeight: 42,
            borderRadius: 2,
            marginTop: 3,
            backgroundColor: stateColor,
            opacity: muted ? 0.65 : 1,
          }}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={3}
            style={{
              fontSize: 17,
              lineHeight: 24,
              fontWeight: "600",
              letterSpacing: -0.2,
              color: theme.colors.textPrimary,
            }}
          >
            {title}
          </Text>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 7,
              marginTop: 7,
            }}
          >
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: 13,
                lineHeight: 20,
              }}
            >
              {number || kind}
            </Text>
            {number ? (
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: 13,
                  lineHeight: 20,
                }}
              >
                {kind}
              </Text>
            ) : null}
            <Text
              style={{
                color: theme.colors.textTertiary,
                fontSize: 13,
                lineHeight: 20,
              }}
            >
              ·
            </Text>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: 13,
                lineHeight: 20,
              }}
            >
              {time}
            </Text>
          </View>
          {state || severity ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 10,
              }}
            >
              {state ? (
                <Text
                  style={{
                    fontSize: 14,
                    lineHeight: 20,
                    fontWeight: "600",
                    color: theme.colors.textPrimary,
                  }}
                >
                  {state}
                </Text>
              ) : null}
              {state && severity ? (
                <Text style={{ color: theme.colors.textTertiary }}>·</Text>
              ) : null}
              {severity ? (
                <Text
                  style={{
                    fontSize: 14,
                    lineHeight: 20,
                    color: theme.colors.textSecondary,
                  }}
                >
                  {severity}
                </Text>
              ) : null}
            </View>
          ) : null}
          {context ? (
            <View style={{ marginTop: 10, gap: 2 }}>
              {contextLabel ? (
                <Text
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: 13,
                    lineHeight: 19,
                  }}
                >
                  {contextLabel}
                </Text>
              ) : null}
              <Text
                numberOfLines={2}
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: 14,
                  lineHeight: 21,
                }}
              >
                {context}
              </Text>
            </View>
          ) : null}
          {projectName ? (
            <Text
              numberOfLines={1}
              style={{
                marginTop: 9,
                color: theme.colors.textSecondary,
                fontSize: 13,
                lineHeight: 19,
              }}
            >
              {projectName}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name="chevron-forward"
          size={17}
          color={theme.colors.textTertiary}
          style={{ marginTop: 4 }}
        />
      </View>
    </Pressable>
  );
}
