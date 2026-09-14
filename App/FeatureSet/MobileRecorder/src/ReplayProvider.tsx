import React, {
  createContext,
  ReactElement,
  ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";
import {
  findNodeHandle,
  GestureResponderEvent,
  StyleProp,
  View,
  ViewStyle,
} from "react-native";
import { MobileReplayStartOptions } from "./Config";
import { RecordedTouch } from "./Events";
import MobileReplayRecorder from "./MobileReplayRecorder";

export const defaultMobileReplayRecorder: MobileReplayRecorder =
  new MobileReplayRecorder();

const ReplayContext: React.Context<MobileReplayRecorder> =
  createContext<MobileReplayRecorder>(defaultMobileReplayRecorder);

export interface OneUptimeReplayProviderProps {
  children: ReactNode;
  recorder?: MobileReplayRecorder;
  /** Optional convenience start; callers may instead call recorder.start(). */
  options?: MobileReplayStartOptions;
  stopOnUnmount?: boolean;
  style?: StyleProp<ViewStyle>;
}

export interface GestureTouchPoint {
  x: number;
  y: number;
}

export function touchPointFromEvent(
  event: GestureResponderEvent,
): GestureTouchPoint {
  const nativeEvent: GestureResponderEvent["nativeEvent"] = event.nativeEvent;
  const x: number =
    typeof nativeEvent.pageX === "number"
      ? nativeEvent.pageX
      : typeof nativeEvent.locationX === "number"
        ? nativeEvent.locationX
        : 0;
  const y: number =
    typeof nativeEvent.pageY === "number"
      ? nativeEvent.pageY
      : typeof nativeEvent.locationY === "number"
        ? nativeEvent.locationY
        : 0;
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

export function OneUptimeReplayProvider(
  props: OneUptimeReplayProviderProps,
): ReactElement {
  const recorder: MobileReplayRecorder =
    props.recorder ?? defaultMobileReplayRecorder;
  const rootRef: React.RefObject<View | null> = useRef<View>(null);
  const initialOptions: React.MutableRefObject<
    MobileReplayStartOptions | undefined
  > = useRef(props.options);

  useEffect((): (() => void) => {
    const tag: number | null = findNodeHandle(rootRef.current);
    recorder.setRootTag(tag);
    if (initialOptions.current) {
      void recorder.start(initialOptions.current);
    }

    return (): void => {
      recorder.setRootTag(null);
      if (initialOptions.current && props.stopOnUnmount !== false) {
        void recorder.stop();
      }
    };
  }, [props.stopOnUnmount, recorder]);

  const record: (
    phase: "start" | "move" | "end",
    event: GestureResponderEvent,
  ) => void = (
    phase: "start" | "move" | "end",
    event: GestureResponderEvent,
  ): void => {
    const point: GestureTouchPoint = touchPointFromEvent(event);
    const targetTag: unknown = event.nativeEvent.target;
    const pointerId: unknown = (
      event.nativeEvent as unknown as Record<string, unknown>
    )["identifier"];
    const touch: RecordedTouch = {
      phase,
      x: point.x,
      y: point.y,
      timestamp: Date.now(),
    };
    if (typeof targetTag === "number" && Number.isSafeInteger(targetTag)) {
      touch.targetTag = targetTag;
    }
    if (
      (typeof pointerId === "number" && Number.isSafeInteger(pointerId)) ||
      typeof pointerId === "string"
    ) {
      touch.pointerId = pointerId;
    }
    recorder.recordTouch(touch);
  };

  return (
    <ReplayContext.Provider value={recorder}>
      <View
        ref={rootRef}
        collapsable={false}
        style={[{ flex: 1 }, props.style]}
        onTouchStart={(event: GestureResponderEvent): void => {
          record("start", event);
        }}
        onTouchMove={(event: GestureResponderEvent): void => {
          record("move", event);
        }}
        onTouchEnd={(event: GestureResponderEvent): void => {
          record("end", event);
        }}
      >
        {props.children}
      </View>
    </ReplayContext.Provider>
  );
}

export function useOneUptimeReplay(): MobileReplayRecorder {
  return useContext(ReplayContext);
}

export interface ReplayMaskProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** A hard native traversal boundary; descendants are never serialized. */
export function ReplayMask(props: ReplayMaskProps): ReactElement {
  return (
    <View
      collapsable={false}
      nativeID="oneuptime-replay-mask"
      testID="oneuptime-replay-mask"
      style={props.style}
    >
      {props.children}
    </View>
  );
}

export const ReplayProvider: typeof OneUptimeReplayProvider =
  OneUptimeReplayProvider;
