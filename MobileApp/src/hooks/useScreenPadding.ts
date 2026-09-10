import { useContext } from "react";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { getScreenBottomPadding } from "../theme/layout";

/** Extra scroll space after the last item, including the complete tab bar. */
export function useScreenPadding({
  tabBar = true,
}: { tabBar?: boolean } = {}): number {
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  return getScreenBottomPadding(insets?.bottom ?? 0, tabBar);
}
