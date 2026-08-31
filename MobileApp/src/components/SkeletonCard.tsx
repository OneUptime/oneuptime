import React, { useEffect, useRef, useState } from "react";
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
      opacity.setValue(0.5);
      return;
    }

    const animation: Animated.CompositeAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.6,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.25,
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

  const lineWidths: DimensionValue[] = ["60%", "85%", "45%", "70%"];

  if (variant === "compact") {
    return (
      <Animated.View
        style={{
          borderRadius: 16,
          marginBottom: 12,
          overflow: "hidden",
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          opacity,
        }}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        <View
          style={{
            height: 3,
            backgroundColor: theme.colors.backgroundTertiary,
          }}
        />
        <View style={{ padding: 16 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <View
              style={{
                height: 16,
                width: 56,
                borderRadius: 4,
                backgroundColor: theme.colors.backgroundTertiary,
              }}
            />
            <View
              style={{
                height: 12,
                width: 32,
                borderRadius: 4,
                backgroundColor: theme.colors.backgroundTertiary,
              }}
            />
          </View>
          <View
            style={{
              height: 18,
              borderRadius: 4,
              width: "75%",
              marginBottom: 12,
              backgroundColor: theme.colors.backgroundTertiary,
            }}
          />
        </View>
      </Animated.View>
    );
  }

  if (variant === "detail") {
    return (
      <Animated.View
        style={{ padding: 20, opacity }}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        <View
          style={{
            borderRadius: 16,
            overflow: "hidden",
            marginBottom: 20,
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <View
            style={{
              height: 3,
              backgroundColor: theme.colors.backgroundTertiary,
            }}
          />
          <View style={{ padding: 20 }}>
            <View
              style={{
                height: 16,
                width: 64,
                borderRadius: 4,
                marginBottom: 12,
                backgroundColor: theme.colors.backgroundTertiary,
              }}
            />
            <View
              style={{
                height: 28,
                width: "80%",
                borderRadius: 4,
                marginBottom: 12,
                backgroundColor: theme.colors.backgroundTertiary,
              }}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View
                style={{
                  height: 24,
                  width: 80,
                  borderRadius: 6,
                  backgroundColor: theme.colors.backgroundTertiary,
                }}
              />
              <View
                style={{
                  height: 24,
                  width: 56,
                  borderRadius: 6,
                  backgroundColor: theme.colors.backgroundTertiary,
                }}
              />
            </View>
          </View>
        </View>
        <View
          style={{
            borderRadius: 12,
            overflow: "hidden",
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
            borderLeftWidth: 3,
            borderLeftColor: theme.colors.backgroundTertiary,
          }}
        >
          <View style={{ padding: 16 }}>
            {Array.from({ length: 3 }).map((_: unknown, index: number) => {
              return (
                <View
                  key={index}
                  style={{ flexDirection: "row", marginBottom: 12 }}
                >
                  <View
                    style={{
                      height: 14,
                      width: 80,
                      borderRadius: 4,
                      marginRight: 16,
                      backgroundColor: theme.colors.backgroundTertiary,
                    }}
                  />
                  <View
                    style={{
                      height: 14,
                      width: 120,
                      borderRadius: 4,
                      backgroundColor: theme.colors.backgroundTertiary,
                    }}
                  />
                </View>
              );
            })}
          </View>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={{
        borderRadius: 16,
        marginBottom: 12,
        overflow: "hidden",
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
        opacity,
      }}
      accessibilityLabel="Loading content"
      accessibilityRole="progressbar"
    >
      <View
        style={{
          height: 3,
          backgroundColor: theme.colors.backgroundTertiary,
        }}
      />
      <View style={{ padding: 16 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <View
            style={{
              height: 14,
              width: 56,
              borderRadius: 4,
              backgroundColor: theme.colors.backgroundTertiary,
            }}
          />
          <View
            style={{
              height: 12,
              width: 40,
              borderRadius: 4,
              backgroundColor: theme.colors.backgroundTertiary,
            }}
          />
        </View>
        <View
          style={{
            height: 18,
            borderRadius: 4,
            width: "70%",
            marginBottom: 12,
            backgroundColor: theme.colors.backgroundTertiary,
          }}
        />
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <View
            style={{
              height: 24,
              width: 80,
              borderRadius: 6,
              backgroundColor: theme.colors.backgroundTertiary,
            }}
          />
          <View
            style={{
              height: 24,
              width: 56,
              borderRadius: 6,
              backgroundColor: theme.colors.backgroundTertiary,
            }}
          />
        </View>
        {Array.from({ length: Math.max(lines - 1, 1) }).map(
          (_: unknown, index: number) => {
            return (
              <View
                key={index}
                style={{
                  height: 12,
                  borderRadius: 4,
                  marginBottom: 8,
                  width: lineWidths[index % lineWidths.length],
                  backgroundColor: theme.colors.backgroundTertiary,
                }}
              />
            );
          },
        )}
      </View>
    </Animated.View>
  );
}
