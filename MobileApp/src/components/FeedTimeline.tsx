import React from "react";
import { View, Text } from "react-native";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatDateTime } from "../utils/date";
import type { FeedItem } from "../api/types";
import MarkdownContent from "./MarkdownContent";

interface FeedTimelineProps {
  feed: FeedItem[];
}

export default function FeedTimeline({
  feed,
}: FeedTimelineProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View>
      {feed.map((entry: FeedItem, index: number) => {
        const entryColor: string = entry.displayColor
          ? rgbToHex(entry.displayColor)
          : theme.colors.actionPrimary;
        const isLast: boolean = index === feed.length - 1;
        const timeString: string = formatDateTime(
          entry.postedAt || entry.createdAt,
        );
        const moreText: string | undefined = entry.moreInformationInMarkdown;

        return (
          <View key={entry._id} style={{ flexDirection: "row" }}>
            <View style={{ alignItems: "center", marginRight: 14 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 9999,
                  marginTop: 8,
                  backgroundColor: entryColor,
                }}
              />
              {!isLast ? (
                <View
                  style={{
                    width: 1,
                    flex: 1,
                    marginVertical: 6,
                    backgroundColor: theme.colors.borderDefault,
                  }}
                />
              ) : null}
            </View>
            <View
              style={{
                flex: 1,
                paddingBottom: 12,
                marginBottom: 10,
                borderRadius: 16,
                padding: 12,
                backgroundColor: theme.colors.backgroundElevated,
                borderWidth: 1,
                borderColor: theme.colors.borderGlass,
              }}
            >
              <MarkdownContent content={entry.feedInfoInMarkdown} />
              {moreText ? (
                <View style={{ marginTop: 6 }}>
                  <MarkdownContent content={moreText} variant="secondary" />
                </View>
              ) : null}
              <Text
                style={{ fontSize: 12, marginTop: 8, color: theme.colors.textTertiary }}
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
