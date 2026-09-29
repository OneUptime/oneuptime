import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  Animated,
  PanResponder,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type PanResponderInstance,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";
import { useHaptics } from "../hooks/useHaptics";

interface SwipeAction {
  label: string;
  /** The fill behind the row. Pick a token whose label pairing is checked. */
  color: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onAction: () => void;
}

interface SwipeableCardProps {
  children: React.ReactNode;
  leftAction?: SwipeAction;
  rightAction?: SwipeAction;
  /**
   * Space the row keeps below its own surface. ResponseRow cards carry a
   * bottom margin, and without this the action fill would paint that gap too
   * and show up taller than the card it sits behind.
   */
  actionInsetBottom?: number;
}

const SWIPE_THRESHOLD: number = 80;
const MAX_SWIPE: number = 120;

export default function SwipeableCard({
  children,
  leftAction,
  rightAction,
  actionInsetBottom = 0,
}: SwipeableCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const { mediumImpact } = useHaptics();
  const translateX: Animated.Value = useRef(new Animated.Value(0)).current;
  const hasTriggeredHaptic: React.MutableRefObject<boolean> = useRef(false);

  /*
   * The responder below is built ONCE and must stay that way: handing the
   * touch system a different set of handlers part-way through a drag abandons
   * the gesture in progress. But that also means its closures see the props
   * from the render that created it, and only those, for the life of the row.
   *
   * That is fatal here, because the actions are not stable. AlertsScreen and
   * IncidentsScreen rebuild `rightAction` on every render out of the row plus
   * the acknowledge state they look up in `statesMap`, and on the first render
   * `statesMap` is still empty - the state queries have not answered yet - so
   * the action that render produces is `undefined`. A frozen responder keeps
   * answering with that one: the green "Acknowledge" panel is painted behind
   * the row, because the JSX below does read today's props, but the drag is
   * clamped to zero and the release fires nothing - a control that is visibly
   * offered and permanently dead. Nothing arrives later to tell the responder
   * it is stale, and it is built at exactly the moment the data it needs is
   * guaranteed to be missing.
   *
   * Refreshing refs after every commit keeps the responder itself stable while
   * its handlers read the props the row has TODAY.
   */
  const leftActionRef: React.MutableRefObject<SwipeAction | undefined> =
    useRef(leftAction);
  const rightActionRef: React.MutableRefObject<SwipeAction | undefined> =
    useRef(rightAction);

  useEffect((): void => {
    leftActionRef.current = leftAction;
    rightActionRef.current = rightAction;
  }, [leftAction, rightAction]);

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
        const maxSwipe: number = MAX_SWIPE;
        let dx: number = gestureState.dx;
        if (!rightActionRef.current && dx < 0) {
          dx = 0;
        }
        if (!leftActionRef.current && dx > 0) {
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
        const left: SwipeAction | undefined = leftActionRef.current;
        const right: SwipeAction | undefined = rightActionRef.current;
        if (gestureState.dx > SWIPE_THRESHOLD && left) {
          left.onAction();
        } else if (gestureState.dx < -SWIPE_THRESHOLD && right) {
          right.onAction();
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

  /*
   * Each panel is only painted while the row is dragged towards it. At rest
   * nothing sits behind the card, so its rounded corners never show a sliver
   * of colour, and the row needs no canvas-coloured backing of its own - which
   * is what used to leave square corners on a moving card in dark mode.
   */
  const rightOpacity: Animated.AnimatedInterpolation<number> =
    translateX.interpolate({
      inputRange: [-MAX_SWIPE, -1, 0],
      outputRange: [1, 1, 0],
      extrapolate: "clamp",
    });
  const leftOpacity: Animated.AnimatedInterpolation<number> =
    translateX.interpolate({
      inputRange: [0, 1, MAX_SWIPE],
      outputRange: [0, 1, 1],
      extrapolate: "clamp",
    });

  const renderAction: (
    action: SwipeAction,
    side: "left" | "right",
  ) => React.JSX.Element = (
    action: SwipeAction,
    side: "left" | "right",
  ): React.JSX.Element => {
    return (
      <Animated.View
        testID={`swipe-action-${side}`}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: actionInsetBottom,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: side === "right" ? "flex-end" : "flex-start",
          gap: spacing.sm,
          paddingHorizontal: spacing.xl,
          borderRadius: radius.lg,
          backgroundColor: action.color,
          opacity: side === "right" ? rightOpacity : leftOpacity,
        }}
      >
        {action.icon ? (
          <Ionicons
            name={action.icon}
            size={20}
            color={theme.colors.textInverse}
          />
        ) : null}
        <Text
          style={{
            ...typography.subhead,
            fontWeight: "700",
            color: theme.colors.textInverse,
          }}
        >
          {action.label}
        </Text>
      </Animated.View>
    );
  };

  return (
    <View style={{ overflow: "hidden" }}>
      {/* Background actions */}
      {leftAction ? renderAction(leftAction, "left") : null}
      {rightAction ? renderAction(rightAction, "right") : null}

      {/* Foreground content */}
      <Animated.View
        style={{
          zIndex: 1,
          transform: [{ translateX }],
        }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}
