import React, { useRef } from "react";
import {
  View,
  Text,
  Animated,
  PanResponder,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type PanResponderInstance,
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

const SWIPE_THRESHOLD: number = 80;

export default function SwipeableCard({
  children,
  leftAction,
  rightAction,
}: SwipeableCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const { mediumImpact } = useHaptics();
  const translateX: Animated.Value = useRef(new Animated.Value(0)).current;
  const hasTriggeredHaptic: React.MutableRefObject<boolean> = useRef(false);

  const panResponder: PanResponderInstance = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (
        _: GestureResponderEvent,
        gestureState: PanResponderGestureState,
      ) => {
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 20;
      },
      onPanResponderMove: (
        _: GestureResponderEvent,
        gestureState: PanResponderGestureState,
      ) => {
        const maxSwipe: number = 120;
        let dx: number = gestureState.dx;
        if (!rightAction && dx < 0) {
          dx = 0;
        }
        if (!leftAction && dx > 0) {
          dx = 0;
        }
        dx = Math.max(-maxSwipe, Math.min(maxSwipe, dx));
        translateX.setValue(dx);

        if (Math.abs(dx) >= SWIPE_THRESHOLD && !hasTriggeredHaptic.current) {
          hasTriggeredHaptic.current = true;
          mediumImpact();
        } else if (Math.abs(dx) < SWIPE_THRESHOLD) {
          hasTriggeredHaptic.current = false;
        }
      },
      onPanResponderRelease: (
        _: GestureResponderEvent,
        gestureState: PanResponderGestureState,
      ) => {
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
    <View style={{ overflow: "hidden", borderRadius: 12, marginBottom: 12 }}>
      {/* Background actions */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {leftAction ? (
          <View
            style={{
              flex: 1,
              height: "100%",
              justifyContent: "center",
              paddingLeft: 20,
              borderRadius: 12,
              backgroundColor: leftAction.color,
            }}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 14,
                fontWeight: "bold",
                letterSpacing: -0.5,
              }}
            >
              {leftAction.label}
            </Text>
          </View>
        ) : null}
        {rightAction ? (
          <View
            style={{
              flex: 1,
              height: "100%",
              justifyContent: "center",
              alignItems: "flex-end",
              paddingRight: 20,
              borderRadius: 12,
              backgroundColor: rightAction.color,
            }}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 14,
                fontWeight: "bold",
                letterSpacing: -0.5,
              }}
            >
              {rightAction.label}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Foreground content */}
      <Animated.View
        style={{
          zIndex: 1,
          transform: [{ translateX }],
          backgroundColor: theme.colors.backgroundPrimary,
        }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}
