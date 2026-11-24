import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";
import { copyToClipboard } from "../utils/clipboard";
import { getErrorReference } from "../utils/error";
import { COPY_REFERENCE_LABEL } from "../utils/errorAlert";

interface QueryErrorNoticeProps {
  message: string;
  retryLabel: string;
  onRetry: () => unknown;
  /*
   * The read's failure, for its reference: when the server failed in a way
   * nobody explained, the notice shows the reference with a button that
   * copies it (#7275).
   */
  error?: unknown;
}

/** A failed read, said plainly, with the way to try again right beside it. */
export default function QueryErrorNotice({
  message,
  retryLabel,
  onRetry,
  error,
}: QueryErrorNoticeProps): React.JSX.Element {
  const { theme } = useTheme();
  const reference: string | null = getErrorReference(error);
  const [isCopied, setIsCopied] = useState<boolean>(false);

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
      {reference ? (
        <View
          testID="query-error-reference"
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            marginLeft: 32,
            gap: spacing.sm,
          }}
        >
          <Text
            selectable={true}
            style={{
              ...typography.footnote,
              color: theme.colors.textSecondary,
            }}
          >
            {`Reference: ${reference}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={COPY_REFERENCE_LABEL}
            onPress={() => {
              setIsCopied(copyToClipboard(reference));
            }}
            hitSlop={6}
            style={({ pressed }: { pressed: boolean }) => {
              return {
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
              {isCopied ? "Copied" : COPY_REFERENCE_LABEL}
            </Text>
          </Pressable>
        </View>
      ) : null}
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
