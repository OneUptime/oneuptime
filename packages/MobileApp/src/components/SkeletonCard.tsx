import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Animated,
  AccessibilityInfo,
  type DimensionValue,
  type ViewStyle,
} from "react-native";
import { useTheme } from "../theme";
import { elevation, radius, spacing } from "../theme/tokens";

interface SkeletonCardProps {
  lines?: number;
  variant?: "card" | "detail" | "compact";
}

/** Where the placeholders rest before the OS answers, and for reduce motion. */
const RESTING_OPACITY: number = 0.7;
const STEADY_OPACITY: number = 0.8;

/**
 * Loading placeholders shaped like the cards they stand in for.
 *
 * The surface stays solid and only the grey bars on it pulse. Fading the whole
 * card made the canvas flicker through it, which reads as a fault in dark mode,
 * and a card that keeps its outline also keeps the list from jumping when the
 * real rows arrive.
 */
export default function SkeletonCard({
  lines = 3,
  variant = "card",
}: SkeletonCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const opacity: Animated.Value = useRef(
    new Animated.Value(RESTING_OPACITY),
  ).current;

  /*
   * Three states, not two. The OS is asked asynchronously and does not answer
   * until a tick after the first render, so a boolean seeded with `false`
   * would start the pulse for everybody and only stop it once the answer
   * landed - a flash of precisely the motion the setting exists to suppress,
   * shown to a reader whose reason for setting it may be migraine, vertigo or
   * seizure risk. `null` means "the OS has not answered yet", and nothing
   * animates while the answer is unknown.
   *
   * It is state rather than a ref for the same reason: a ref mutated inside a
   * promise callback does not re-render anything, so the effect below would go
   * on reading the value it was born with.
   */
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled: boolean) => {
        setReduceMotion(enabled);
        return undefined;
      })
      .catch(() => {
        /*
         * The question itself failed, so the setting cannot be read. Resolve
         * that the safe way round: a reader who wanted motion loses a shimmer
         * on a placeholder, where a reader who asked for stillness and is
         * animated at anyway loses considerably more.
         */
        setReduceMotion(true);
      });
  }, []);

  useEffect(() => {
    if (reduceMotion === null) {
      return;
    }

    if (reduceMotion) {
      opacity.setValue(STEADY_OPACITY);
      return;
    }

    const animation: Animated.CompositeAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [opacity, reduceMotion]);

  const lineWidths: DimensionValue[] = ["55%", "80%", "40%", "68%"];

  const surface: ViewStyle = {
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.backgroundElevated,
    ...elevation("card", theme.dark),
  };

  /*
   * borderDefault stays visible on the card in both palettes; the tertiary fill
   * all but disappears on a dark card.
   */
  const bar: (style: ViewStyle) => ViewStyle = (
    style: ViewStyle,
  ): ViewStyle => {
    return {
      borderRadius: radius.pill,
      backgroundColor: theme.colors.borderDefault,
      ...style,
    };
  };

  if (variant === "compact") {
    return (
      <View
        style={surface}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        <Animated.View
          testID="skeleton-pulse"
          style={{
            opacity,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <View style={bar({ width: 10, height: 10 })} />
          <View style={bar({ height: 16, flex: 1, maxWidth: "65%" })} />
          <View style={{ flex: 1 }} />
          <View style={bar({ height: 10, width: 36 })} />
        </Animated.View>
      </View>
    );
  }

  if (variant === "detail") {
    return (
      <View
        style={{ padding: spacing.xl }}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        <View style={{ ...surface, marginBottom: spacing.lg }}>
          <Animated.View testID="skeleton-pulse" style={{ opacity }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                marginBottom: spacing.md,
              }}
            >
              <View style={bar({ width: 10, height: 10 })} />
              <View style={bar({ height: 14, width: 88 })} />
            </View>
            <View
              style={bar({
                height: 24,
                width: "85%",
                marginBottom: spacing.sm,
              })}
            />
            <View
              style={bar({
                height: 24,
                width: "55%",
                marginBottom: spacing.lg,
              })}
            />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={bar({ height: 26, width: 92 })} />
              <View style={bar({ height: 26, width: 68 })} />
            </View>
          </Animated.View>
        </View>
        <View style={{ ...surface, marginBottom: 0 }}>
          <Animated.View
            testID="skeleton-pulse"
            style={{ opacity, gap: spacing.md }}
          >
            {Array.from({ length: 3 }).map((_: unknown, index: number) => {
              return (
                <View
                  key={index}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <View style={bar({ height: 14, width: 84 })} />
                  <View style={bar({ height: 14, width: 120 })} />
                </View>
              );
            })}
          </Animated.View>
        </View>
      </View>
    );
  }

  return (
    <View
      style={surface}
      accessibilityLabel="Loading content"
      accessibilityRole="progressbar"
    >
      <Animated.View testID="skeleton-pulse" style={{ opacity }}>
        {/* Status dot, state and severity, then the time on the right. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <View style={bar({ width: 10, height: 10 })} />
          <View style={bar({ height: 10, width: 64 })} />
          <View style={bar({ height: 10, width: 44 })} />
          <View style={{ flex: 1 }} />
          <View style={bar({ height: 10, width: 40 })} />
        </View>
        {/* The title. */}
        <View
          style={bar({
            height: 16,
            width: "78%",
            marginTop: spacing.md,
          })}
        />
        {/* Meta and context lines. */}
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {Array.from({ length: Math.max(lines - 1, 1) }).map(
            (_: unknown, index: number) => {
              return (
                <View
                  key={index}
                  style={bar({
                    height: 12,
                    width: lineWidths[index % lineWidths.length],
                  })}
                />
              );
            },
          )}
        </View>
      </Animated.View>
    </View>
  );
}
