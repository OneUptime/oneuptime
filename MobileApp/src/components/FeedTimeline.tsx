import React from "react";
import { View, Text } from "react-native";
import { useTheme } from "../theme";
import { spacing, typography } from "../theme/tokens";
import { rgbToHex, withAlpha } from "../utils/color";
import type { FeedItem } from "../api/types";
import MarkdownContent from "./MarkdownContent";
import { formatResponseTimestamp } from "./ResponseDetailLayout";

interface FeedTimelineProps {
  feed: FeedItem[];
}

/** Size of the soft halo around each dot, and of the dot inside it. */
const HALO_SIZE: number = 20;
const DOT_SIZE: number = 10;

/**
 * A vertical timeline: one dot per entry on a rail that stops at the last
 * one, the entry's markdown beside it and its time underneath. Entries render
 * in the order the server sent them (newest first).
 */
export default function FeedTimeline({
  feed,
}: FeedTimelineProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View testID="feed-timeline">
      {feed.map((entry: FeedItem, index: number) => {
        const entryColor: string = entry.displayColor
          ? rgbToHex(entry.displayColor)
          : theme.colors.actionPrimary;
        const isLast: boolean = index === feed.length - 1;
        const timeString: string = formatResponseTimestamp(
          entry.postedAt || entry.createdAt,
        );
        const moreText: string | undefined = entry.moreInformationInMarkdown;

        return (
          <View
            key={entry._id}
            testID="feed-entry"
            style={{ flexDirection: "row", gap: spacing.md }}
          >
            <View style={{ alignItems: "center", width: HALO_SIZE }}>
              <View
                testID="feed-entry-halo"
                style={{
                  width: HALO_SIZE,
                  height: HALO_SIZE,
                  borderRadius: HALO_SIZE / 2,
                  marginTop: spacing.xs + 1,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: withAlpha(
                    entryColor,
                    theme.dark ? 0.24 : 0.16,
                  ),
                }}
              >
                <View
                  testID="feed-entry-dot"
                  style={{
                    width: DOT_SIZE,
                    height: DOT_SIZE,
                    borderRadius: DOT_SIZE / 2,
                    backgroundColor: entryColor,
                  }}
                />
              </View>
              {!isLast ? (
                <View
                  testID="feed-entry-connector"
                  style={{
                    width: 2,
                    flex: 1,
                    marginTop: spacing.xs,
                    borderRadius: 1,
                    backgroundColor: theme.colors.borderSubtle,
                  }}
                />
              ) : null}
            </View>
            <View
              style={{
                flex: 1,
                paddingBottom: isLast ? 0 : spacing.lg,
              }}
            >
              <MarkdownContent content={entry.feedInfoInMarkdown} />
              {moreText ? (
                <View style={{ marginTop: spacing.xxs }}>
                  <MarkdownContent content={moreText} variant="secondary" />
                </View>
              ) : null}
              <Text
                testID="feed-entry-time"
                style={{
                  ...typography.footnote,
                  marginTop: spacing.xs,
                  color: theme.colors.textTertiary,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {timeString}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
