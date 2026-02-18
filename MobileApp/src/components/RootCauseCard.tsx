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
      style={{
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
      }}
    >
      <View style={{ padding: 16 }}>
        {rootCauseText ? (
          <MarkdownContent content={rootCauseText} />
        ) : (
          <Text
            style={{
              fontSize: 14,
              lineHeight: 22,
              color: theme.colors.textTertiary,
            }}
          >
            No root cause documented yet.
          </Text>
        )}
      </View>
    </View>
  );
}
