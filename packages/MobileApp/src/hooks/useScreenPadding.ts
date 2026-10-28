import { useContext } from "react";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { getScreenBottomPadding } from "../theme/layout";
import {
  usePane,
  useWindowLayout,
  type ResolvedPaneLayout,
} from "../layout/WindowLayout";

/**
 * Extra scroll space after the last item, including the complete tab bar.
 *
 * The bar only floats over content along the bottom of the window. Beside a
 * navigation rail (a wide window) nothing covers the bottom of a page, so it
 * keeps only the safe area and the breathing room after the last item - as
 * does a pane that stops short of the window's bottom edge, the detail above
 * a tabletop fold.
 */
export function useScreenPadding({
  tabBar = true,
}: { tabBar?: boolean } = {}): number {
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  const { navigation } = useWindowLayout();
  const pane: ResolvedPaneLayout = usePane();
  return getScreenBottomPadding(
    insets?.bottom ?? 0,
    tabBar && navigation === "bar" && pane.reachesBottom !== false,
  );
}
