import React from "react";
import { View } from "react-native";
import { useTheme } from "../theme";

/*
 * The space between two panes: a hinge that hides part of the window, or the
 * band kept clear around a tabletop fold. Stacked, the line between the panes
 * runs along the middle of the band - on the fold itself, as the divider runs
 * along a book's fold - so the crease and the line are one, with the same
 * room on either side of it.
 *
 * The list and its detail draw it between their panes (the adaptive stack),
 * and so do Home and Settings between the halves a tabletop fold splits them
 * into (FoldSplitView). Each names its own, so a screen kept mounted behind
 * another never shares the other's test ids.
 */
export interface PaneGapProps {
  size: number;
  stacked: boolean;
  /** The band's test id, and its line's. */
  testID?: string;
  lineTestID?: string;
}

export default function PaneGap({
  size,
  stacked,
  testID = "pane-gap",
  lineTestID = "pane-fold-line",
}: PaneGapProps): React.JSX.Element {
  const { theme } = useTheme();
  if (!stacked) {
    return <View testID={testID} style={{ width: size }} />;
  }
  return (
    <View testID={testID} style={{ height: size, justifyContent: "center" }}>
      <View
        testID={lineTestID}
        style={{ height: 1, backgroundColor: theme.colors.borderSubtle }}
      />
    </View>
  );
}
