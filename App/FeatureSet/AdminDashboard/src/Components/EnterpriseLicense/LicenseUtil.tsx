import { Green, Red, Yellow } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import EnterpriseLicenseUsageUtil from "Common/Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import React, { FunctionComponent, ReactElement } from "react";

export type LicenseLifecycleState = "active" | "expiring-soon" | "expired";

export interface LicenseLifecycle {
  state: LicenseLifecycleState;
  // Negative once expired.
  daysUntilExpiry: number;
}

type GetLicenseLifecycleFunction = (
  expiresAt: Date | undefined,
  reminderDays: number,
) => LicenseLifecycle | null;

export const getLicenseLifecycle: GetLicenseLifecycleFunction = (
  expiresAt: Date | undefined,
  reminderDays: number,
): LicenseLifecycle | null => {
  if (!expiresAt) {
    return null;
  }

  const now: Date = OneUptimeDate.getCurrentDate();
  const daysUntilExpiry: number = OneUptimeDate.getDaysBetweenTwoDates(
    now,
    expiresAt,
  );

  if (OneUptimeDate.fromString(expiresAt).getTime() <= now.getTime()) {
    return { state: "expired", daysUntilExpiry };
  }

  if (daysUntilExpiry <= reminderDays) {
    return { state: "expiring-soon", daysUntilExpiry };
  }

  return { state: "active", daysUntilExpiry };
};

type IsOverUserLimitFunction = (
  userLimit: number | undefined,
  currentUserCount: number | undefined,
) => boolean;

export const isOverUserLimit: IsOverUserLimitFunction = (
  userLimit: number | undefined,
  currentUserCount: number | undefined,
): boolean => {
  return (
    typeof userLimit === "number" &&
    userLimit > 0 &&
    typeof currentUserCount === "number" &&
    currentUserCount > userLimit
  );
};

export interface LicenseStatusPillProps {
  expiresAt: Date | undefined;
  reminderDays?: number | undefined;
}

export const LicenseStatusPill: FunctionComponent<LicenseStatusPillProps> = (
  props: LicenseStatusPillProps,
): ReactElement => {
  const lifecycle: LicenseLifecycle | null = getLicenseLifecycle(
    props.expiresAt,
    props.reminderDays ?? EnterpriseLicenseUsageUtil.defaultExpiryReminderDays,
  );

  if (!lifecycle) {
    return <span className="text-gray-400">-</span>;
  }

  if (lifecycle.state === "expired") {
    const daysAgo: number = Math.abs(lifecycle.daysUntilExpiry);
    return (
      <Pill
        text="Expired"
        color={Red}
        size={PillSize.Small}
        tooltip={
          daysAgo === 0
            ? "Expired today"
            : `Expired ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`
        }
      />
    );
  }

  if (lifecycle.state === "expiring-soon") {
    const daysLeft: number = lifecycle.daysUntilExpiry;
    return (
      <Pill
        text={
          daysLeft === 0
            ? "Expires today"
            : `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
        }
        color={Yellow}
        size={PillSize.Small}
        tooltip="Daily expiry reminder emails are going out to the customer's master admins."
      />
    );
  }

  return <Pill text="Active" color={Green} size={PillSize.Small} />;
};

export interface SeatUsageMeterProps {
  currentUserCount: number | undefined;
  userLimit: number | undefined;
}

/*
 * Meter: the fill carries severity (indigo -> amber near the limit -> red
 * over it); the unfilled track is a lighter step of the same hue so state
 * reads across the whole bar.
 */
export const SeatUsageMeter: FunctionComponent<SeatUsageMeterProps> = (
  props: SeatUsageMeterProps,
): ReactElement => {
  const current: number | undefined = props.currentUserCount;
  const limit: number | undefined = props.userLimit;

  if (current === undefined && limit === undefined) {
    return <span className="text-gray-400">No reports yet</span>;
  }

  const currentCount: number = current || 0;

  if (!limit || limit <= 0) {
    return (
      <div className="text-sm text-gray-900">
        {currentCount.toLocaleString()}{" "}
        <span className="text-gray-500">users · no limit</span>
      </div>
    );
  }

  const ratio: number = currentCount / limit;
  const isOver: boolean = currentCount > limit;
  const isNearLimit: boolean = !isOver && ratio >= 0.8;

  let fillClass: string = "bg-indigo-500";
  let trackClass: string = "bg-indigo-100";

  if (isOver) {
    fillClass = "bg-red-500";
    trackClass = "bg-red-100";
  } else if (isNearLimit) {
    fillClass = "bg-amber-500";
    trackClass = "bg-amber-100";
  }

  return (
    <div className="w-full max-w-[12rem]">
      <div className="text-sm text-gray-900 tabular-nums">
        {currentCount.toLocaleString()}{" "}
        <span className="text-gray-500">/ {limit.toLocaleString()} users</span>
        {isOver ? (
          <span className="ml-1 font-medium text-red-600">
            · {(currentCount - limit).toLocaleString()} over
          </span>
        ) : (
          <></>
        )}
      </div>
      <div className={`mt-1.5 h-1.5 w-full rounded-full ${trackClass}`}>
        <div
          className={`h-1.5 rounded-full ${fillClass}`}
          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
        ></div>
      </div>
    </div>
  );
};
