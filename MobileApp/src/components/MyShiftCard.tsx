import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useHaptics } from "../hooks/useHaptics";
import { formatDuration, formatShiftWindow } from "../utils/duration";
import {
  canRequestCover,
  describeCovering,
  describePolicyVariant,
  hasShiftEnded,
  isShiftActive,
  toTimestamp,
} from "../oncall/shiftGroups";
import type { MyOnCallShift } from "../api/types";

interface MyShiftCardProps {
  shift: MyOnCallShift;
  now: number;

  /* When given, an eligible shift shows a "Get cover" action. */
  onRequestCover?: (shift: MyOnCallShift) => void;
}

/*
 * One materialized shift from `/my-shifts`.
 *
 * The same silhouette as ShiftCard (schedule, project, a badge with the one
 * number the reader wants, the window underneath) so the two lists look like
 * the same list - the overview swaps between them depending on what the
 * server could answer. What this card adds is what only the server knows:
 * that the shift is held on somebody else's behalf, that it applies to one
 * policy only, and a way to hand it to somebody else.
 */
export default function MyShiftCard({
  shift,
  now,
  onRequestCover,
}: MyShiftCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const { lightImpact } = useHaptics();

  const isActive: boolean = isShiftActive(shift, now);
  const hasEnded: boolean = hasShiftEnded(shift, now);

  const accent: string = isActive
    ? theme.colors.oncallActive
    : hasEnded
      ? theme.colors.textTertiary
      : theme.colors.severityInfo;

  const accentBackground: string = isActive
    ? theme.colors.oncallActiveBg
    : hasEnded
      ? theme.colors.oncallInactiveBg
      : theme.colors.severityInfoBg;

  const badgeText: string = isActive
    ? `${formatDuration(toTimestamp(shift.end) - now)} left`
    : hasEnded
      ? "Ended"
      : `in ${formatDuration(toTimestamp(shift.start) - now)}`;

  const window: string | null = formatShiftWindow(shift.start, shift.end, now);
  const covering: string | null = describeCovering(shift);
  const policyVariant: string | null = describePolicyVariant(shift);
  const offersCover: boolean =
    Boolean(onRequestCover) && canRequestCover(shift, now);

  return (
    <View
      testID={`my-shift-card-${shift.shiftKey}`}
      style={{
        borderRadius: 18,
        padding: 16,
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              marginRight: 10,
              backgroundColor: accentBackground,
            }}
          >
            <Ionicons
              name={covering ? "swap-horizontal-outline" : "calendar-outline"}
              size={15}
              color={accent}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: "600",
                color: theme.colors.textPrimary,
              }}
              numberOfLines={1}
            >
              {shift.scheduleName}
            </Text>
            <Text
              style={{
                fontSize: 12,
                marginTop: 2,
                color: theme.colors.textTertiary,
              }}
              numberOfLines={1}
            >
              {shift.layerName
                ? `${shift.projectName ?? "Project"} · ${shift.layerName}`
                : shift.projectName ?? "Project"}
            </Text>
          </View>
        </View>

        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 9999,
            marginLeft: 10,
            backgroundColor: accentBackground,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "700",
              color: accent,
              fontVariant: ["tabular-nums"],
            }}
          >
            {badgeText}
          </Text>
        </View>
      </View>

      {window ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 12,
          }}
        >
          <Ionicons
            name="time-outline"
            size={13}
            color={theme.colors.textTertiary}
          />
          <Text
            style={{
              fontSize: 12,
              marginLeft: 6,
              color: theme.colors.textSecondary,
            }}
            numberOfLines={1}
          >
            {window}
          </Text>
        </View>
      ) : null}

      {covering || policyVariant ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 10,
          }}
        >
          {covering ? (
            <View
              testID={`covering-badge-${shift.shiftKey}`}
              style={{
                paddingHorizontal: 9,
                paddingVertical: 4,
                borderRadius: 9999,
                backgroundColor: theme.colors.severityInfoBg,
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "600",
                  color: theme.colors.severityInfo,
                }}
                numberOfLines={1}
              >
                {covering}
              </Text>
            </View>
          ) : null}

          {policyVariant ? (
            <View
              testID={`policy-variant-badge-${shift.shiftKey}`}
              style={{
                paddingHorizontal: 9,
                paddingVertical: 4,
                borderRadius: 9999,
                backgroundColor: theme.colors.severityWarningBg,
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "600",
                  color: theme.colors.severityWarning,
                }}
                numberOfLines={1}
              >
                {policyVariant}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {offersCover ? (
        <Pressable
          testID={`get-cover-${shift.shiftKey}`}
          accessibilityRole="button"
          accessibilityLabel={`Get cover for ${shift.scheduleName}`}
          onPress={() => {
            lightImpact();
            onRequestCover?.(shift);
          }}
          style={({ pressed }: { pressed: boolean }) => {
            return {
              marginTop: 12,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: theme.colors.borderSubtle,
              flexDirection: "row",
              alignItems: "center",
              opacity: pressed ? 0.7 : 1,
            };
          }}
        >
          <Ionicons
            name="swap-horizontal-outline"
            size={14}
            color={theme.colors.actionPrimary}
          />
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              marginLeft: 6,
              color: theme.colors.actionPrimary,
            }}
          >
            Get cover
          </Text>
          <View style={{ flex: 1 }} />
          <Ionicons
            name="chevron-forward"
            size={14}
            color={theme.colors.textTertiary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
