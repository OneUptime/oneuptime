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
import ShiftSummary from "./ShiftSummary";

interface MyShiftCardProps {
  shift: MyOnCallShift;
  now: number;
  onRequestCover?: (shift: MyOnCallShift) => void;
}

/** A precise duty window, with context and a clear, eligible handoff action. */
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
  const timing: string = isActive
    ? `${formatDuration(toTimestamp(shift.end) - now)} left`
    : hasEnded
      ? "Ended"
      : `in ${formatDuration(toTimestamp(shift.start) - now)}`;
  const covering: string | null = describeCovering(shift);
  const policyVariant: string | null = describePolicyVariant(shift);
  const offersCover: boolean =
    Boolean(onRequestCover) && canRequestCover(shift, now);
  return (
    <View
      testID={`my-shift-card-${shift.shiftKey}`}
      style={{
        borderRadius: 18,
        padding: 18,
        backgroundColor: theme.colors.backgroundElevated,
      }}
    >
      <ShiftSummary
        name={shift.scheduleName}
        layer={shift.layerName}
        timing={timing}
        window={formatShiftWindow(shift.start, shift.end, now)}
        accent={accent}
      />
      {covering || policyVariant ? (
        <View
          style={{
            marginTop: 12,
            paddingLeft: 12,
            borderLeftWidth: 2,
            borderLeftColor: theme.colors.borderDefault,
            gap: 5,
          }}
        >
          {covering ? (
            <Text
              testID={`covering-badge-${shift.shiftKey}`}
              style={{
                color: theme.colors.textSecondary,
                fontSize: 14,
                lineHeight: 21,
              }}
            >
              {covering}
            </Text>
          ) : null}
          {policyVariant ? (
            <Text
              testID={`policy-variant-badge-${shift.shiftKey}`}
              style={{
                color: theme.colors.textSecondary,
                fontSize: 14,
                lineHeight: 21,
              }}
            >
              {policyVariant}
            </Text>
          ) : null}
        </View>
      ) : null}
      {offersCover ? (
        <Pressable
          testID={`get-cover-${shift.shiftKey}`}
          accessibilityRole="button"
          accessibilityLabel={`Get cover for ${shift.scheduleName}`}
          onPress={(): void => {
            lightImpact();
            onRequestCover?.(shift);
          }}
          style={({ pressed }: { pressed: boolean }) => {
            return {
              marginTop: 14,
              paddingHorizontal: 12,
              minHeight: 48,
              borderRadius: 12,
              backgroundColor: pressed
                ? theme.colors.backgroundTertiary
                : theme.colors.iconBackground,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            };
          }}
        >
          <Ionicons
            name="swap-horizontal-outline"
            size={18}
            color={theme.colors.actionPrimary}
          />
          <Text
            style={{
              flex: 1,
              color: theme.colors.actionPrimary,
              fontSize: 15,
              fontWeight: "600",
            }}
          >
            Get cover
          </Text>
          <Ionicons
            name="arrow-forward"
            size={17}
            color={theme.colors.actionPrimary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
