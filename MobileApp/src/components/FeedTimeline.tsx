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
          : theme.colors.actionPrimary;
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
            <View className="items-center mr-3.5">
              <View
                className="w-2.5 h-2.5 rounded-full mt-1"
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
            <View className="flex-1 pb-5">
              <Text
                className="text-[14px] leading-5"
                style={{ color: theme.colors.textPrimary }}
              >
                {mainText}
              </Text>
              {moreText ? (
                <Text
                  className="text-[13px] mt-1.5 leading-5"
                  style={{ color: theme.colors.textSecondary }}
                  numberOfLines={3}
                >
                  {moreText}
                </Text>
              ) : null}
              <Text
                className="text-[12px] mt-1.5"
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
