import React from "react";
import { View, Text } from "react-native";
import { useTheme } from "../theme";
import { rgbToHex } from "../utils/color";
import { formatDateTime } from "../utils/date";
import type { FeedItem } from "../api/types";

interface FeedTimelineProps {
  feed: FeedItem[];
}

function stripMarkdown(md: string): string {
  return md
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export default function FeedTimeline({
  feed,
}: FeedTimelineProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View className="ml-1">
      {feed.map((entry: FeedItem, index: number) => {
        const entryColor: string = entry.displayColor
          ? rgbToHex(entry.displayColor)
          : theme.colors.textTertiary;
        const isLast: boolean = index === feed.length - 1;
        const timeString: string = formatDateTime(
          entry.postedAt || entry.createdAt,
        );
        const mainText: string = stripMarkdown(entry.feedInfoInMarkdown);
        const moreText: string | undefined = entry.moreInformationInMarkdown
          ? stripMarkdown(entry.moreInformationInMarkdown)
          : undefined;

        return (
          <View key={entry._id} className="flex-row">
            {/* Timeline connector */}
            <View className="items-center mr-3">
              <View
                className="w-3 h-3 rounded-full mt-0.5"
                style={{ backgroundColor: entryColor }}
              />
              {!isLast ? (
                <View
                  className="w-0.5 flex-1 my-1"
                  style={{
                    backgroundColor: theme.colors.borderDefault,
                  }}
                />
              ) : null}
            </View>
            {/* Content */}
            <View className="flex-1 pb-4">
              <Text className="text-body-md text-text-primary leading-5">
                {mainText}
              </Text>
              {moreText ? (
                <Text
                  className="text-body-sm text-text-secondary mt-1 leading-5"
                  numberOfLines={3}
                >
                  {moreText}
                </Text>
              ) : null}
              <Text className="text-body-sm text-text-tertiary mt-1">
                {timeString}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
