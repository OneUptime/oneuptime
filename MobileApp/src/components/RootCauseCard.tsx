import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import MarkdownContent from "./MarkdownContent";

export interface RootCauseCardProps {
  rootCauseText?: string;
}

export default function RootCauseCard({
  rootCauseText,
}: RootCauseCardProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      className="rounded-2xl overflow-hidden"
      style={{
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
      }}
    >
      <View
        className="flex-row items-center px-4 py-2"
        style={{
          backgroundColor: theme.colors.backgroundSecondary,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.borderGlass,
        }}
      >
        <Ionicons
          name="sparkles-outline"
          size={14}
          color={theme.colors.textTertiary}
          style={{ marginRight: 6 }}
        />
        <Text
          className="text-[12px] font-semibold"
          style={{ color: theme.colors.textSecondary }}
        >
          Markdown supported
        </Text>
      </View>

      <View className="p-4">
        {rootCauseText ? (
          <MarkdownContent content={rootCauseText} />
        ) : (
          <Text
            className="text-[14px] leading-[22px]"
            style={{ color: theme.colors.textTertiary }}
          >
            No root cause documented yet.
          </Text>
        )}
      </View>
    </View>
  );
}