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
    <View className="overflow-hidden rounded-xl">
      {/* Background actions */}
      <View className="absolute inset-0 flex-row justify-between items-center">
        {leftAction ? (
          <View
            className="flex-1 h-full justify-center pl-5 rounded-xl"
            style={{ backgroundColor: leftAction.color }}
          >
            <Text className="text-white text-sm font-bold tracking-tight">
              {leftAction.label}
            </Text>
          </View>
        ) : null}
        {rightAction ? (
          <View
            className="flex-1 h-full justify-center items-end pr-5 rounded-xl"
            style={{ backgroundColor: rightAction.color }}
          >
            <Text className="text-white text-sm font-bold tracking-tight">
              {rightAction.label}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Foreground content */}
      <Animated.View
        className="z-[1] bg-bg-primary"
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}
