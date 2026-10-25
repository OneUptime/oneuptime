import { useContext } from "react";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { getScreenBottomPadding } from "../theme/layout";
import { useWindowLayout } from "../layout/WindowLayout";

/**
 * Extra scroll space after the last item, including the complete tab bar.
 *
 * The bar only floats over content along the bottom of the window. Beside a
 * navigation rail (a wide window) nothing covers the bottom of a page, so it
 * keeps only the safe area and the breathing room after the last item.
 */
export function useScreenPadding({
  tabBar = true,
}: { tabBar?: boolean } = {}): number {
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  const { navigation } = useWindowLayout();
  return getScreenBottomPadding(
    insets?.bottom ?? 0,
    tabBar && navigation === "bar",
  );
}
