import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import AppText from "./AppText";
import { useReduceMotion } from "../hooks/useReduceMotion";
import { useTheme } from "../theme";
import { radius, spacing } from "../theme/tokens";

// The words, and what a screen reader says for the whole badge.
export const CURRENTLY_ACTIVE_LABEL: string = "Currently Active";

const DOT_SIZE: number = 6;
// One beat: the ring grows out of the dot and fades away.
const PULSE_DURATION_MS: number = 1200;
const PULSE_SCALE: number = 2.6;
const PULSE_START_OPACITY: number = 0.6;

/**
 * Marks the status that is in effect right now: a small pill reading
 * "Currently Active" with a dot that beats - a ring grows out of it and fades,
 * over and over. The same marker, in the same indigo, as the status timelines
 * in the web dashboard.
 *
 * The beat only runs once the OS has said the reader does not want reduced
 * motion. Until it answers, and for a reader who asked for stillness, the dot
 * holds still and the words carry the meaning on their own.
 */
export default function CurrentlyActiveBadge(): React.JSX.Element {
  const { theme } = useTheme();
  const reduceMotion: boolean | null = useReduceMotion();
  const pulse: Animated.Value = useRef(new Animated.Value(0)).current;
  const isBeating: boolean = reduceMotion === false;

  useEffect((): (() => void) | undefined => {
    if (!isBeating) {
      pulse.setValue(0);
      return undefined;
    }

    const animation: Animated.CompositeAnimation = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: PULSE_DURATION_MS,
        useNativeDriver: true,
      }),
    );

    animation.start();

    return (): void => {
      animation.stop();
    };
  }, [pulse, isBeating]);

  const dot: { width: number; height: number; borderRadius: number } = {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  };

  return (
    <View
      testID="currently-active-badge"
      accessible={true}
      accessibilityLabel={CURRENTLY_ACTIVE_LABEL}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: spacing.xs + spacing.xxs,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xxs,
        borderRadius: radius.pill,
        backgroundColor: theme.colors.statusInfoBg,
      }}
    >
      <View
        testID="currently-active-badge-mark"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden={true}
        style={{
          ...dot,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isBeating ? (
          <Animated.View
            testID="currently-active-badge-pulse"
            style={{
              ...dot,
              position: "absolute",
              backgroundColor: theme.colors.statusInfo,
              opacity: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [PULSE_START_OPACITY, 0],
              }),
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, PULSE_SCALE],
                  }),
                },
              ],
            }}
          />
        ) : null}
        <View
          testID="currently-active-badge-dot"
          style={{ ...dot, backgroundColor: theme.colors.statusInfo }}
        />
      </View>
      <AppText
        variant="caption"
        weight="700"
        color={theme.colors.statusInfo}
        numberOfLines={1}
      >
        {CURRENTLY_ACTIVE_LABEL}
      </AppText>
    </View>
  );
}
