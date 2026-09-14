import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

interface QueryErrorNoticeProps {
  message: string;
  retryLabel: string;
  onRetry: () => unknown;
}

export default function QueryErrorNotice({
  message,
  retryLabel,
  onRetry,
}: QueryErrorNoticeProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={{
        padding: 16,
        borderRadius: 12,
        backgroundColor: theme.colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: theme.colors.borderDefault,
        marginBottom: 16,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <Ionicons
          name="information-circle-outline"
          size={20}
          color={theme.colors.textSecondary}
          style={{ marginTop: 1 }}
        />
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{
            flex: 1,
            color: theme.colors.textSecondary,
            fontSize: 14,
            lineHeight: 22,
          }}
        >
          {message}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
        onPress={onRetry}
        style={({ pressed }: { pressed: boolean }) => {
          return {
            alignSelf: "flex-start" as const,
            justifyContent: "center" as const,
            minHeight: 48,
            paddingHorizontal: 12,
            borderRadius: 8,
            backgroundColor: theme.colors.cardAccent,
            opacity: pressed ? 0.7 : 1,
          };
        }}
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            color: theme.colors.actionPrimary,
          }}
        >
          {retryLabel}
        </Text>
      </Pressable>
    </View>
  );
}
