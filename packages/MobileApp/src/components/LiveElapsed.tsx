import React from "react";
import { Text } from "react-native";
import { useNow } from "../hooks/useNow";
import { formatElapsed } from "../utils/duration";

// A second: the resolution formatElapsed shows.
export const LIVE_ELAPSED_INTERVAL_MS: number = 1000;

interface LiveElapsedProps {
  // When it began, in epoch milliseconds.
  since: number;
  testID?: string;
}

/**
 * How long something has been going on, counting up every second while it is
 * on screen: "2m 54s", "2m 55s", ...
 *
 * Its own component so the once-a-second re-render is this one Text, never the
 * card or the list it sits in. It renders a Text so it can sit inline inside
 * another line of text, with even-width digits so the count does not shuffle
 * the words after it as it ticks.
 */
export default function LiveElapsed({
  since,
  testID,
}: LiveElapsedProps): React.JSX.Element {
  const now: number = useNow(LIVE_ELAPSED_INTERVAL_MS);

  return (
    <Text
      testID={testID}
      accessibilityRole="timer"
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {formatElapsed(now - since)}
    </Text>
  );
}
