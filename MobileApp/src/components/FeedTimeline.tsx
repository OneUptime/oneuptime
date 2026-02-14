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
          <View key={entry._id} className="flex-row">
            <View className="items-center mr-3.5">
              <View
                className="w-2.5 h-2.5 rounded-full mt-2"
                style={{ backgroundColor: entryColor }}
              />
              {!isLast ? (
                <View
                  className="w-px flex-1 my-1.5"
                  style={{
                    backgroundColor: theme.colors.borderDefault,
                  }}
                />
              ) : null}
            </View>
            <View
              className="flex-1 pb-3 mb-2.5 rounded-2xl p-3"
              style={{
                backgroundColor: theme.colors.backgroundElevated,
                borderWidth: 1,
                borderColor: theme.colors.borderGlass,
              }}
            >
              <MarkdownContent content={entry.feedInfoInMarkdown} />
              {moreText ? (
                <View className="mt-1.5">
                  <MarkdownContent content={moreText} variant="secondary" />
                </View>
              ) : null}
              <Text
                className="text-[12px] mt-2"
                style={{ color: theme.colors.textTertiary }}
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
