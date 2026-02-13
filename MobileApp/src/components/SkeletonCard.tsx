import React, { useEffect, useRef } from "react";
import {
  View,
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
        className="rounded-2xl mb-3 overflow-hidden"
        style={{
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderSubtle,
          opacity,
        }}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        <View className="flex-row">
          <View
            className="w-1"
            style={{ backgroundColor: theme.colors.backgroundTertiary }}
          />
          <View className="flex-1 p-4">
            <View className="flex-row justify-between items-center mb-2.5">
              <View className="h-3.5 w-12 rounded-full bg-bg-tertiary" />
              <View className="h-3 w-8 rounded bg-bg-tertiary" />
            </View>
            <View className="h-[18px] rounded w-3/4 mb-3 bg-bg-tertiary" />
          </View>
        </View>
      </Animated.View>
    );
  }

  if (variant === "detail") {
    return (
      <Animated.View
        className="p-5"
        style={{ opacity }}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        <View className="flex-row gap-2 mb-3">
          <View className="h-6 w-20 rounded-full bg-bg-tertiary" />
          <View className="h-6 w-16 rounded-full bg-bg-tertiary" />
        </View>
        <View className="h-6 w-4/5 rounded mb-5 bg-bg-tertiary" />
        <View
          className="rounded-2xl p-4"
          style={{
            backgroundColor: theme.colors.backgroundSecondary,
            borderWidth: 1,
            borderColor: theme.colors.borderSubtle,
          }}
        >
          {Array.from({ length: 3 }).map((_: unknown, index: number) => {
            return (
              <View key={index} className="flex-row mb-3">
                <View className="h-3.5 w-20 rounded mr-4 bg-bg-tertiary" />
                <View className="h-3.5 w-[120px] rounded bg-bg-tertiary" />
              </View>
            );
          })}
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      className="rounded-2xl mb-3 overflow-hidden"
      style={{
        backgroundColor: theme.colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: theme.colors.borderSubtle,
        opacity,
      }}
      accessibilityLabel="Loading content"
      accessibilityRole="progressbar"
    >
      <View className="flex-row">
        <View
          className="w-1"
          style={{ backgroundColor: theme.colors.backgroundTertiary }}
        />
        <View className="flex-1 p-4">
          <View className="flex-row justify-between items-center mb-3">
            <View className="h-3.5 w-12 rounded-full bg-bg-tertiary" />
            <View className="h-3 w-9 rounded bg-bg-tertiary" />
          </View>
          <View className="h-[18px] rounded w-[70%] mb-3 bg-bg-tertiary" />
          <View className="flex-row gap-2 mb-3">
            <View className="h-6 w-20 rounded-full bg-bg-tertiary" />
            <View className="h-6 w-14 rounded-full bg-bg-tertiary" />
          </View>
          {Array.from({ length: Math.max(lines - 1, 1) }).map(
            (_: unknown, index: number) => {
              return (
                <View
                  key={index}
                  className="h-3 rounded mb-2 bg-bg-tertiary"
                  style={{ width: lineWidths[index % lineWidths.length] }}
                />
              );
            },
          )}
        </View>
      </View>
    </Animated.View>
  );
}
