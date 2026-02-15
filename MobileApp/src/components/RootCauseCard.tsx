import React from "react";
import { View, Text } from "react-native";
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
