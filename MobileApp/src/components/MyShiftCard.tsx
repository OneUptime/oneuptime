import React from "react";
import { View, Pressable, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius, spacing, touchTarget } from "../theme/tokens";
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
import AppText from "./AppText";
import Card from "./Card";
import ShiftSummary from "./ShiftSummary";
import type { StatusTone } from "./StatusPill";

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
  const tone: StatusTone = isActive ? "success" : hasEnded ? "neutral" : "info";
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
    <Card
      testID={`my-shift-card-${shift.shiftKey}`}
      variant={hasEnded ? "outlined" : "elevated"}
    >
      <ShiftSummary
        name={shift.scheduleName}
        layer={shift.layerName}
        timing={timing}
        window={formatShiftWindow(shift.start, shift.end, now)}
        tone={tone}
      />
      {covering || policyVariant ? (
        <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
          {covering ? (
            <DetailLine
              testID={`covering-badge-${shift.shiftKey}`}
              iconName="swap-horizontal-outline"
              text={covering}
            />
          ) : null}
          {policyVariant ? (
            <DetailLine
              testID={`policy-variant-badge-${shift.shiftKey}`}
              iconName="git-branch-outline"
              text={policyVariant}
            />
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
          style={({ pressed }: { pressed: boolean }): ViewStyle => {
            return {
              marginTop: spacing.lg,
              paddingHorizontal: spacing.md,
              minHeight: touchTarget,
              borderRadius: radius.md,
              backgroundColor: pressed
                ? theme.colors.backgroundTertiary
                : theme.colors.cardAccent,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            };
          }}
        >
          <Ionicons
            name="swap-horizontal-outline"
            size={18}
            color={theme.colors.actionPrimary}
          />
          <AppText
            variant="callout"
            weight="600"
            tone="accent"
            style={{ flex: 1 }}
          >
            Get cover
          </AppText>
          <Ionicons
            name="arrow-forward"
            size={17}
            color={theme.colors.actionPrimary}
          />
        </Pressable>
      ) : null}
    </Card>
  );
}

function DetailLine({
  iconName,
  text,
  testID,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  text: string;
  testID: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.xs + 2,
      }}
    >
      <Ionicons
        name={iconName}
        size={15}
        color={theme.colors.textTertiary}
        style={{ marginTop: 3 }}
      />
      <AppText
        testID={testID}
        variant="subhead"
        tone="secondary"
        style={{ flex: 1 }}
      >
        {text}
      </AppText>
    </View>
  );
}
