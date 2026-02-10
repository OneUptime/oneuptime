import React, { useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  Animated,
  DimensionValue,
  AccessibilityInfo,
} from "react-native";
import { useTheme } from "../theme";

interface SkeletonCardProps {
  lines?: number;
  variant?: "card" | "detail" | "compact";
}

export default function SkeletonCard({
  lines = 3,
  variant = "card",
}: SkeletonCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const opacity: Animated.Value = useRef(new Animated.Value(0.3)).current;
  const reduceMotion: React.MutableRefObject<boolean> = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((enabled: boolean) => {
      reduceMotion.current = enabled;
    });
  }, []);

  useEffect(() => {
    if (reduceMotion.current) {
      opacity.setValue(0.5);
      return;
    }

    const animation: Animated.CompositeAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [opacity]);

  const lineWidths: DimensionValue[] = ["60%", "85%", "45%", "70%"];

  if (variant === "compact") {
    return (
      <Animated.View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.backgroundSecondary,
            borderColor: theme.colors.borderSubtle,
            opacity,
          },
        ]}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        <View style={styles.compactRow}>
          <View
            style={[
              styles.compactBadge,
              { backgroundColor: theme.colors.backgroundTertiary },
            ]}
          />
          <View
            style={[
              styles.compactTime,
              { backgroundColor: theme.colors.backgroundTertiary },
            ]}
          />
        </View>
        <View
          style={[
            styles.titleLine,
            { backgroundColor: theme.colors.backgroundTertiary, width: "75%" },
          ]}
        />
      </Animated.View>
    );
  }

  if (variant === "detail") {
    return (
      <Animated.View
        style={[styles.detailContainer, { opacity }]}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        {/* Badge row */}
        <View style={styles.badgeRow}>
          <View
            style={[
              styles.badgeSkeleton,
              { backgroundColor: theme.colors.backgroundTertiary },
            ]}
          />
          <View
            style={[
              styles.badgeSkeleton,
              { backgroundColor: theme.colors.backgroundTertiary, width: 64 },
            ]}
          />
        </View>
        {/* Title */}
        <View
          style={[
            styles.detailTitle,
            { backgroundColor: theme.colors.backgroundTertiary },
          ]}
        />
        {/* Detail card */}
        <View
          style={[
            styles.detailCard,
            {
              backgroundColor: theme.colors.backgroundSecondary,
              borderColor: theme.colors.borderSubtle,
            },
          ]}
        >
          {Array.from({ length: 3 }).map((_: unknown, index: number) => {
            return (
              <View key={index} style={styles.detailRow}>
                <View
                  style={[
                    styles.detailLabel,
                    { backgroundColor: theme.colors.backgroundTertiary },
                  ]}
                />
                <View
                  style={[
                    styles.detailValue,
                    { backgroundColor: theme.colors.backgroundTertiary },
                  ]}
                />
              </View>
            );
          })}
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.backgroundSecondary,
          borderColor: theme.colors.borderSubtle,
          opacity,
        },
      ]}
      accessibilityLabel="Loading content"
      accessibilityRole="progressbar"
    >
      {/* Top row: badge + time */}
      <View style={styles.topRow}>
        <View
          style={[
            styles.numberSkeleton,
            { backgroundColor: theme.colors.backgroundTertiary },
          ]}
        />
        <View
          style={[
            styles.timeSkeleton,
            { backgroundColor: theme.colors.backgroundTertiary },
          ]}
        />
      </View>
      {/* Title */}
      <View
        style={[
          styles.titleLine,
          { backgroundColor: theme.colors.backgroundTertiary },
        ]}
      />
      {/* Badge row */}
      <View style={styles.badgeRow}>
        <View
          style={[
            styles.badgeSkeleton,
            { backgroundColor: theme.colors.backgroundTertiary },
          ]}
        />
        <View
          style={[
            styles.badgeSkeleton,
            { backgroundColor: theme.colors.backgroundTertiary, width: 56 },
          ]}
        />
      </View>
      {/* Body lines */}
      {Array.from({ length: Math.max(lines - 1, 1) }).map(
        (_: unknown, index: number) => {
          return (
            <View
              key={index}
              style={[
                styles.line,
                {
                  backgroundColor: theme.colors.backgroundTertiary,
                  width: lineWidths[index % lineWidths.length],
                },
              ]}
            />
          );
        },
      )}
    </Animated.View>
  );
}

const styles: ReturnType<typeof StyleSheet.create> = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  numberSkeleton: {
    height: 14,
    width: 48,
    borderRadius: 4,
  },
  timeSkeleton: {
    height: 12,
    width: 36,
    borderRadius: 4,
  },
  titleLine: {
    height: 18,
    borderRadius: 4,
    width: "70%",
    marginBottom: 12,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  badgeSkeleton: {
    height: 24,
    width: 80,
    borderRadius: 6,
  },
  line: {
    height: 12,
    borderRadius: 4,
    marginBottom: 8,
  },
  // Compact variant
  compactRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  compactBadge: {
    height: 14,
    width: 48,
    borderRadius: 4,
  },
  compactTime: {
    height: 12,
    width: 32,
    borderRadius: 4,
  },
  // Detail variant
  detailContainer: {
    padding: 20,
  },
  detailTitle: {
    height: 24,
    width: "80%",
    borderRadius: 4,
    marginBottom: 20,
  },
  detailCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  detailRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  detailLabel: {
    height: 14,
    width: 80,
    borderRadius: 4,
    marginRight: 16,
  },
  detailValue: {
    height: 14,
    width: 120,
    borderRadius: 4,
  },
});
