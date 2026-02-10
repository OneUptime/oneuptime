import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme";

interface EmptyStateProps {
  title: string;
  subtitle?: string;
}

export default function EmptyState({
  title,
  subtitle,
}: EmptyStateProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View style={styles.container}>
      <Text
        style={[
          theme.typography.titleSmall,
          { color: theme.colors.textPrimary, textAlign: "center" },
        ]}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={[
            theme.typography.bodyMedium,
            {
              color: theme.colors.textSecondary,
              textAlign: "center",
              marginTop: theme.spacing.sm,
            },
          ]}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
});
