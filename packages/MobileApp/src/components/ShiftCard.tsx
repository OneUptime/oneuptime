import React from "react";
import {
  formatDuration,
  formatShiftWindow,
  millisecondsUntil,
} from "../utils/duration";
import type { OnCallShift } from "../api/types";
import Card from "./Card";
import ShiftSummary from "./ShiftSummary";

interface ShiftCardProps {
  shift: OnCallShift;
  now: number;
}

export default function ShiftCard({
  shift,
  now,
}: ShiftCardProps): React.JSX.Element {
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
    <Card testID={`shift-card-${shift.scheduleId}-${shift.status}`}>
      <ShiftSummary
        name={shift.scheduleName}
        timing={timing}
        window={formatShiftWindow(shift.startsAt, shift.endsAt, now)}
        tone={isActive ? "success" : "info"}
      />
    </Card>
  );
}
