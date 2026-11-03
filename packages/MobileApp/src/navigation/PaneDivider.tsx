import React, { useRef, useState } from "react";
import {
  Platform,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { radius, touchTarget, useTheme } from "../theme";
import type { ListPaneWidthRange } from "../layout/windowLayout";
import {
  clampListPaneWidth,
  describeListPaneShare,
  getDividerKeyMove,
  moveListPaneWidthByKey,
  snapListPaneWidth,
  stepListPaneWidth,
  toPreferredListPaneWidth,
  type DividerKeyMove,
} from "../layout/paneDivider";

/*
 * The handle on the divider between a list and its detail.
 *
 * It is offered only where the platform has said the window is not folded
 * like a book (windowLayout.ts): on a foldable lying flat open, on a tablet,
 * on a window that does not fold. Half open, the divider belongs on the fold,
 * and where nothing reports the fold the divider stays where it has always
 * been; neither layout shows a handle.
 *
 * The handle is a small pill in the middle of the divider, as Material's pane
 * expansion handle is, so it never takes a swipe meant for a card beside it.
 * Dragging it moves the divider at once; letting go keeps the width, and
 * close to where the layout puts the divider it settles exactly there. A
 * double tap puts it back. With a screen reader it is an adjustable control:
 * swipe up or down to widen or narrow the list. From a keyboard it is a tab
 * stop: the arrow keys move it, Home and End take it to either end, and
 * Enter puts it back (layout/paneDivider.ts) - with a ring around it and
 * the divider's line drawn while it has focus, so the reader sees what the
 * keys move.
 */

/*
 * A key pressed while the handle has focus. The web build delivers every
 * key; React Native delivers them to a focused view where its key events
 * are on. Typed by hand because React Native's own View types do not list
 * the key props yet.
 */
interface DividerKeyEvent {
  nativeEvent?: { key?: unknown };
  key?: unknown;
  preventDefault?: () => void;
}

function keyOf(event: DividerKeyEvent): string {
  const key: unknown = event.nativeEvent?.key ?? event.key;
  return typeof key === "string" ? key : "";
}

/*
 * Whether the handle took focus from a keyboard, so it shows its ring. On a
 * phone or a tablet a touch never focuses it - only a keyboard does - but a
 * browser focuses it on a click too, and there the ring follows the
 * browser's own rule for showing focus (:focus-visible).
 */
export function isKeyboardFocus(event: unknown): boolean {
  if (Platform.OS !== "web") {
    return true;
  }
  const target: unknown = (event as { target?: unknown } | null)?.target;
  const matches: unknown = (target as { matches?: unknown } | null)?.matches;
  if (typeof matches !== "function") {
    return true;
  }
  try {
    return Boolean(
      (matches as (selector: string) => boolean).call(target, ":focus-visible"),
    );
  } catch {
    return true;
  }
}

/**
 * The handle's touch target, centred on the divider: as wide as every other
 * control's minimum (touchTarget), and twice that tall.
 */
export const DIVIDER_HANDLE_TOUCH_WIDTH: number = touchTarget;
export const DIVIDER_HANDLE_TOUCH_HEIGHT: number = touchTarget * 2;

/** The pill the reader sees. */
const PILL_WIDTH: number = 4;
const PILL_HEIGHT: number = 48;

// Two taps closer together than this put the divider back where the layout has it.
export const DOUBLE_TAP_INTERVAL_MS: number = 300;

// Movement under this many points between press and release is a tap, not a drag.
const TAP_SLOP: number = 4;

export interface PaneDividerProps {
  /** Where the divider is drawn now: the list's width, while dragging included. */
  width: number;
  /** The width the layout would give the list (where a double tap puts the divider). */
  defaultWidth: number;
  range: ListPaneWidthRange;
  /** The width the list and its detail share, for what a screen reader says. */
  contentWidth: number;
  /** While dragging: the width the list would have if the reader let go here. */
  onDrag: (width: number) => void;
  /** On letting go: the width to keep, or null to follow the layout again. */
  onCommit: (width: number | null) => void;
  /** A drag that ended without moving, or was taken over by the system. */
  onCancel: () => void;
}

interface DragStart {
  pageX: number;
  width: number;
}

export default function PaneDivider({
  width,
  defaultWidth,
  range,
  contentWidth,
  onDrag,
  onCommit,
  onCancel,
}: PaneDividerProps): React.JSX.Element {
  const { theme } = useTheme();
  const [active, setActive] = useState<boolean>(false);
  // Focused from a keyboard: the keys move the divider.
  const [focused, setFocused] = useState<boolean>(false);
  const dragStart: React.MutableRefObject<DragStart | null> =
    useRef<DragStart | null>(null);
  const moved: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const lastTapAt: React.MutableRefObject<number> = useRef<number>(0);

  const widthAt: (event: GestureResponderEvent) => number = (
    event: GestureResponderEvent,
  ): number => {
    const start: DragStart | null = dragStart.current;
    if (!start) {
      return width;
    }
    return start.width + (event.nativeEvent.pageX - start.pageX);
  };

  const finish: () => void = (): void => {
    dragStart.current = null;
    setActive(false);
  };

  const onRelease: (event: GestureResponderEvent) => void = (
    event: GestureResponderEvent,
  ): void => {
    const wasMoved: boolean = moved.current;
    const next: number = widthAt(event);
    finish();

    if (!wasMoved) {
      const now: number = Date.now();
      if (now - lastTapAt.current <= DOUBLE_TAP_INTERVAL_MS) {
        lastTapAt.current = 0;
        onCommit(null);
        return;
      }
      lastTapAt.current = now;
      onCancel();
      return;
    }

    lastTapAt.current = 0;
    const settled: number = snapListPaneWidth(next, range, defaultWidth);
    onCommit(toPreferredListPaneWidth(settled, defaultWidth));
  };

  const onAccessibilityAction: (event: AccessibilityActionEvent) => void = (
    event: AccessibilityActionEvent,
  ): void => {
    const action: string = event.nativeEvent.actionName;
    if (action === "increment" || action === "decrement") {
      const next: number = stepListPaneWidth(
        width,
        action === "increment" ? 1 : -1,
        range,
        defaultWidth,
      );
      onCommit(toPreferredListPaneWidth(next, defaultWidth));
    } else if (action === "activate") {
      // A screen reader's double tap, as the hint says: back where the layout has it.
      onCommit(null);
    }
  };

  const onKeyDown: (event: DividerKeyEvent) => void = (
    event: DividerKeyEvent,
  ): void => {
    const move: DividerKeyMove | null = getDividerKeyMove(keyOf(event));
    if (!move) {
      return;
    }
    // The page would scroll on an arrow key; here it moves the divider instead.
    event.preventDefault?.();
    // The reader is on the keyboard now, whatever focused the handle: show what the keys move.
    setFocused(true);
    const next: number | null = moveListPaneWidthByKey(
      width,
      move,
      range,
      defaultWidth,
    );
    onCommit(next === null ? null : toPreferredListPaneWidth(next, defaultWidth));
  };

  const keyProps: ViewProps = {
    onKeyDown,
  } as unknown as ViewProps;

  const tint: string =
    active || focused ? theme.colors.actionPrimary : theme.colors.textTertiary;

  /*
   * In a browser: the resize cursor, and no outline of the browser's own -
   * the handle draws its ring itself, in the app's colour.
   */
  const webCursor: ViewStyle | null =
    Platform.OS === "web"
      ? ({ cursor: "col-resize", outlineStyle: "none" } as unknown as ViewStyle)
      : null;

  return (
    <>
      {active || focused ? (
        <View
          testID="pane-divider-line"
          style={{
            pointerEvents: "none",
            position: "absolute",
            top: 0,
            bottom: 0,
            left: width - 1,
            width: 2,
            backgroundColor: theme.colors.actionPrimary,
          }}
        />
      ) : null}
      <View
        testID="pane-divider"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="List width"
        // Swiping up or down to adjust is the screen reader's own gesture for a slider, and it says so itself.
        accessibilityHint="Double tap to put the divider back."
        accessibilityValue={{
          min: Math.round(range.min),
          max: Math.round(range.max),
          now: Math.round(width),
          text: describeListPaneShare(width, contentWidth),
        }}
        accessibilityActions={[
          { name: "increment", label: "Wider list" },
          { name: "decrement", label: "Narrower list" },
          { name: "activate", label: "Put the divider back" },
        ]}
        onAccessibilityAction={onAccessibilityAction}
        focusable
        onFocus={(event: unknown): void => {
          setFocused(isKeyboardFocus(event));
        }}
        onBlur={(): void => {
          setFocused(false);
        }}
        {...keyProps}
        onStartShouldSetResponder={(): boolean => {
          return true;
        }}
        onMoveShouldSetResponder={(): boolean => {
          return true;
        }}
        // Once the reader holds the handle, a list's scroll does not take the drag away.
        onResponderTerminationRequest={(): boolean => {
          return false;
        }}
        onResponderGrant={(event: GestureResponderEvent): void => {
          dragStart.current = { pageX: event.nativeEvent.pageX, width };
          moved.current = false;
          setActive(true);
        }}
        onResponderMove={(event: GestureResponderEvent): void => {
          const start: DragStart | null = dragStart.current;
          if (!start) {
            return;
          }
          if (Math.abs(event.nativeEvent.pageX - start.pageX) >= TAP_SLOP) {
            moved.current = true;
          }
          if (moved.current) {
            onDrag(clampListPaneWidth(widthAt(event), range));
          }
        }}
        onResponderRelease={onRelease}
        onResponderTerminate={(): void => {
          finish();
          onCancel();
        }}
        style={[
          {
            position: "absolute",
            top: "50%",
            left: width - DIVIDER_HANDLE_TOUCH_WIDTH / 2,
            width: DIVIDER_HANDLE_TOUCH_WIDTH,
            height: DIVIDER_HANDLE_TOUCH_HEIGHT,
            marginTop: -DIVIDER_HANDLE_TOUCH_HEIGHT / 2,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.md,
            borderWidth: 2,
            // The focus ring: the keys move what it surrounds.
            borderColor: focused ? theme.colors.actionPrimary : "transparent",
          },
          webCursor,
        ]}
      >
        <View
          testID="pane-divider-pill"
          style={{
            width: PILL_WIDTH,
            height: PILL_HEIGHT,
            borderRadius: PILL_WIDTH / 2,
            backgroundColor: tint,
          }}
        />
      </View>
    </>
  );
}
