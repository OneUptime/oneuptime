import { useEffect, useMemo, useState } from "react";
import { Keyboard, Platform, type EmitterSubscription } from "react-native";
import { useWindowLayout } from "./WindowLayout";
import type { WindowLayout } from "./windowLayout";
import { getSheetPlacement, type SheetPlacement } from "./sheetPlacement";

/*
 * Whether the keyboard is up, followed only while `enabled`: a sheet needs to
 * know only half open on a table, where the keys take the half it rises over.
 * iOS says before the keyboard moves, Android once it has.
 */
export function useKeyboardShown(enabled: boolean): boolean {
  const [shown, setShown] = useState<boolean>(false);

  useEffect((): (() => void) | undefined => {
    if (!enabled) {
      setShown(false);
      return undefined;
    }

    setShown(Keyboard.isVisible());

    const showSubscription: EmitterSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (): void => {
        setShown(true);
      },
    );
    const hideSubscription: EmitterSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      (): void => {
        setShown(false);
      },
    );

    return (): void => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [enabled]);

  return enabled && shown;
}

/** Where a sheet goes in the current window (sheetPlacement.ts). */
export function useSheetPlacement(): SheetPlacement {
  const layout: WindowLayout = useWindowLayout();
  const keyboardShown: boolean = useKeyboardShown(
    layout.paneArrangement === "stacked",
  );

  return useMemo((): SheetPlacement => {
    return getSheetPlacement(layout, keyboardShown);
  }, [layout, keyboardShown]);
}
