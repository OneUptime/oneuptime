import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { spacing, typography } from "../theme/tokens";
import MarkdownContent from "./MarkdownContent";

export interface RootCauseCardProps {
  rootCauseText?: string;
}

/**
 * The content of the Root cause section. It sits inside a ResponseSection
 * card, so it draws no surface of its own; an unwritten root cause is a muted
 * sentence with an icon rather than an empty gap under the heading.
 */
export default function RootCauseCard({
  rootCauseText,
}: RootCauseCardProps): React.JSX.Element {
  const { theme } = useTheme();

  if (rootCauseText) {
    return (
      <View testID="root-cause-content">
        <MarkdownContent content={rootCauseText} />
      </View>
    );
  }

  return (
    <View
      testID="root-cause-empty"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm + 2,
        paddingVertical: spacing.xs,
      }}
    >
      <Ionicons
        name="help-circle-outline"
        size={18}
        color={theme.colors.textTertiary}
      />
      <Text
        style={{
          ...typography.subhead,
          flex: 1,
          color: theme.colors.textTertiary,
        }}
      >
        No root cause documented yet.
      </Text>
    </View>
  );
}
