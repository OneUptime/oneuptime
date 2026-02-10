import React, { useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
} from "react-native";
import { useTheme } from "../theme";
import { useHaptics } from "../hooks/useHaptics";

interface SwipeAction {
  label: string;
  color: string;
  onAction: () => void;
}

interface SwipeableCardProps {
  children: React.ReactNode;
  leftAction?: SwipeAction;
  rightAction?: SwipeAction;
}

const SWIPE_THRESHOLD = 80;

export default function SwipeableCard({
  children,
  leftAction,
  rightAction,
}: SwipeableCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const { mediumImpact } = useHaptics();
  const translateX = useRef(new Animated.Value(0)).current;
  const hasTriggeredHaptic = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 20;
      },
      onPanResponderMove: (_, gestureState) => {
        // Limit swipe range
        const maxSwipe = 120;
        let dx = gestureState.dx;
        if (!rightAction && dx < 0) {
          dx = 0;
        }
        if (!leftAction && dx > 0) {
          dx = 0;
        }
        dx = Math.max(-maxSwipe, Math.min(maxSwipe, dx));
        translateX.setValue(dx);

        // Haptic feedback at threshold
        if (Math.abs(dx) >= SWIPE_THRESHOLD && !hasTriggeredHaptic.current) {
          hasTriggeredHaptic.current = true;
          mediumImpact();
        } else if (Math.abs(dx) < SWIPE_THRESHOLD) {
          hasTriggeredHaptic.current = false;
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > SWIPE_THRESHOLD && leftAction) {
          leftAction.onAction();
        } else if (gestureState.dx < -SWIPE_THRESHOLD && rightAction) {
          rightAction.onAction();
        }

        hasTriggeredHaptic.current = false;
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }).start();
      },
      onPanResponderTerminate: () => {
        hasTriggeredHaptic.current = false;
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  return (
    <View style={styles.container}>
      {/* Background actions */}
      <View style={styles.actionsContainer}>
        {leftAction ? (
          <View
            style={[
              styles.actionLeft,
              { backgroundColor: leftAction.color },
            ]}
          >
            <Text style={styles.actionText}>{leftAction.label}</Text>
          </View>
        ) : null}
        {rightAction ? (
          <View
            style={[
              styles.actionRight,
              { backgroundColor: rightAction.color },
            ]}
          >
            <Text style={styles.actionText}>{rightAction.label}</Text>
          </View>
        ) : null}
      </View>

      {/* Foreground content */}
      <Animated.View
        style={[
          styles.foreground,
          {
            backgroundColor: theme.colors.backgroundPrimary,
            transform: [{ translateX }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    borderRadius: 12,
  },
  actionsContainer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  actionLeft: {
    flex: 1,
    height: "100%",
    justifyContent: "center",
    paddingLeft: 20,
    borderRadius: 12,
  },
  actionRight: {
    flex: 1,
    height: "100%",
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: 20,
    borderRadius: 12,
  },
  actionText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  foreground: {
    zIndex: 1,
  },
});
