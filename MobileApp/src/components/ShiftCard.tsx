import React from "react";
import { View } from "react-native";
import { useTheme } from "../theme";
import {
  formatDuration,
  formatShiftWindow,
  millisecondsUntil,
} from "../utils/duration";
import type { OnCallShift } from "../api/types";
import ShiftSummary from "./ShiftSummary";

interface ShiftCardProps {
  shift: OnCallShift;
  now: number;
}

export default function ShiftCard({
  shift,
  now,
}: ShiftCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const isActive: boolean = shift.status === "active";
  const remaining: number | null = millisecondsUntil(
    isActive ? shift.endsAt : shift.startsAt,
    now,
  );
  const timing: string =
    remaining === null
      ? isActive
        ? "On now"
        : "Scheduled"
      : isActive
        ? `${formatDuration(remaining)} left`
        : `in ${formatDuration(remaining)}`;
  return (
    <View
      testID={`shift-card-${shift.scheduleId}-${shift.status}`}
      style={{
        borderRadius: 18,
        padding: 18,
        backgroundColor: theme.colors.backgroundElevated,
      }}
    >
      <ShiftSummary
        name={shift.scheduleName}
        timing={timing}
        window={formatShiftWindow(shift.startsAt, shift.endsAt, now)}
        accent={
          isActive ? theme.colors.oncallActive : theme.colors.severityInfo
        }
      />
    </View>
  );
}
