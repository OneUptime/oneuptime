import React, { useRef } from "react";
import {
  ScrollView,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  usePaneScrollRestoration,
  type PaneScrollRestoration,
} from "../navigation/paneState";

/*
 * A list's header with what stands in for its rows while they cannot be
 * shown: the skeleton while they load, or why they could not be, with Retry.
 *
 * Below a tabletop fold the list has half a screen, and its header alone
 * would fill it, leaving the skeleton or the error out of sight. There the
 * view opens past its header, as the list itself does (paneState.tsx), so
 * the reader sees at once that the rows are coming - or that they are not,
 * and what to do. Everywhere else it is a plain scroll view.
 */
export interface ListStatusScrollProps {
  /** The pane-state key its scroll position is kept under. */
  scrollKey: string;
  /** The list's own header: its view switch, search and filters. */
  header: React.ReactNode;
  /** The scroll view's top padding, where the header starts. */
  headerTop: number;
  contentContainerStyle: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  testID?: string;
  children: React.ReactNode;
}

export default function ListStatusScroll({
  scrollKey,
  header,
  headerTop,
  contentContainerStyle,
  refreshControl,
  testID,
  children,
}: ListStatusScrollProps): React.JSX.Element {
  const scrollRef: React.RefObject<ScrollView | null> =
    useRef<ScrollView>(null);
  const scroll: PaneScrollRestoration = usePaneScrollRestoration(
    scrollKey,
    (offsetY: number): void => {
      scrollRef.current?.scrollTo({ x: 0, y: offsetY, animated: false });
    },
    { headerTop },
  );

  return (
    <ScrollView
      ref={scrollRef}
      testID={testID}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={refreshControl}
      contentContainerStyle={contentContainerStyle}
      onScroll={scroll.onScroll}
      onContentSizeChange={scroll.onContentSizeChange}
      scrollEventThrottle={scroll.scrollEventThrottle}
    >
      <View onLayout={scroll.onHeaderLayout}>{header}</View>
      {children}
    </ScrollView>
  );
}
