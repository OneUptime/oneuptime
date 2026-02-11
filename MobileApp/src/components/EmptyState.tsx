import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme";

type EmptyIcon = "incidents" | "alerts" | "episodes" | "notes" | "default";

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  icon?: EmptyIcon;
}

function EmptyIcon({
  icon,
  color,
}: {
  icon: EmptyIcon;
  color: string;
}): React.JSX.Element {
  /*
   * Simple geometric SVG-style icons using View primitives
   * Monochrome, clean, professional — not cartoon/playful
   */
  if (icon === "incidents") {
    return (
      <View style={styles.iconContainer}>
        <View style={[styles.iconShield, { borderColor: color }]}>
          <View style={[styles.iconCheckmark, { backgroundColor: color }]} />
        </View>
      </View>
    );
  }

  if (icon === "alerts") {
    return (
      <View style={styles.iconContainer}>
        <View style={[styles.iconBell, { borderColor: color }]}>
          <View style={[styles.iconBellClapper, { backgroundColor: color }]} />
        </View>
      </View>
    );
  }

  if (icon === "episodes") {
    return (
      <View style={styles.iconContainer}>
        <View style={[styles.iconStack, { borderColor: color }]} />
        <View
          style={[styles.iconStackBack, { borderColor: color, opacity: 0.4 }]}
        />
      </View>
    );
  }

  // Default: simple circle with line through it
  return (
    <View style={styles.iconContainer}>
      <View style={[styles.iconCircle, { borderColor: color }]}>
        <View style={[styles.iconLine, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function EmptyState({
  title,
  subtitle,
  icon = "default",
}: EmptyStateProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View style={styles.container}>
      <EmptyIcon icon={icon} color={theme.colors.textTertiary} />
      <Text
        style={[
          theme.typography.titleSmall,
          {
            color: theme.colors.textPrimary,
            textAlign: "center",
            marginTop: 20,
          },
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
              lineHeight: 20,
            },
          ]}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles: ReturnType<typeof StyleSheet.create> = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  iconContainer: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  // Shield icon (incidents)
  iconShield: {
    width: 44,
    height: 52,
    borderWidth: 2,
    borderRadius: 6,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCheckmark: {
    width: 16,
    height: 3,
    borderRadius: 1.5,
    transform: [{ rotate: "-45deg" }],
  },
  // Bell icon (alerts)
  iconBell: {
    width: 36,
    height: 36,
    borderWidth: 2,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 4,
  },
  iconBellClapper: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // Stack icon (episodes)
  iconStack: {
    width: 40,
    height: 32,
    borderWidth: 2,
    borderRadius: 8,
    position: "absolute",
    top: 12,
  },
  iconStackBack: {
    width: 32,
    height: 28,
    borderWidth: 2,
    borderRadius: 6,
    position: "absolute",
    top: 6,
  },
  // Default circle icon
  iconCircle: {
    width: 48,
    height: 48,
    borderWidth: 2,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  iconLine: {
    width: 20,
    height: 2,
    borderRadius: 1,
  },
});
