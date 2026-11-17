import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import EnterpriseLicenseUsageUtil, {
  EnterpriseLicenseInstanceUsage,
} from "Common/Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import {
  formatInline,
  getGlobalTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey } from "Common/Types/Translator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  EnterpriseLicenseInstanceActivityState,
  getEnterpriseLicenseInstanceActivityState,
} from "./LicenseActivityUtil";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

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

/*
 * A license's status in words: what its pill in the Status column says, and
 * what the list's Export CSV writes there. Empty for a license with no
 * expiry.
 */
export const getLicenseStatusText: (
  lifecycle: LicenseLifecycle | null,
  translator?: Translator,
) => string = (
  lifecycle: LicenseLifecycle | null,
  translator: Translator = getGlobalTranslator(),
): string => {
  if (!lifecycle) {
    return "";
  }

  if (lifecycle.state === "expired") {
    return translator.translateText("Expired") as string;
  }

  if (lifecycle.state === "expiring-soon") {
    const daysLeft: number = lifecycle.daysUntilExpiry;

    return daysLeft === 0
      ? (translator.translateText("Expires today") as string)
      : translator.translatePlural(
          {
            one: "Expires in {{count}} day",
            other: "Expires in {{count}} days",
          },
          daysLeft,
        );
  }

  return translator.translateText("Active") as string;
};

export interface LicenseStatusPillProps {
  expiresAt: Date | undefined;
  reminderDays?: number | undefined;
}

export const LicenseStatusPill: FunctionComponent<LicenseStatusPillProps> = (
  props: LicenseStatusPillProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const lifecycle: LicenseLifecycle | null = getLicenseLifecycle(
    props.expiresAt,
    props.reminderDays ?? EnterpriseLicenseUsageUtil.defaultExpiryReminderDays,
  );

  if (!lifecycle) {
    return <TableEmptyValue />;
  }

  if (lifecycle.state === "expired") {
    const daysAgo: number = Math.abs(lifecycle.daysUntilExpiry);
    return (
      <Pill
        text={getLicenseStatusText(lifecycle, translator)}
        isUserContent={true}
        color={Red}
        size={PillSize.Small}
        isTooltipUserContent={true}
        tooltip={
          daysAgo === 0
            ? (translator.translateText("Expired today") as string)
            : translator.translatePlural(
                {
                  one: "Expired {{count}} day ago",
                  other: "Expired {{count}} days ago",
                },
                daysAgo,
              )
        }
      />
    );
  }

  if (lifecycle.state === "expiring-soon") {
    return (
      <Pill
        text={getLicenseStatusText(lifecycle, translator)}
        isUserContent={true}
        color={Yellow}
        size={PillSize.Small}
        tooltip="Daily expiry reminder emails are going out to the customer's master admins."
      />
    );
  }

  return (
    <Pill
      text={getLicenseStatusText(lifecycle, translator)}
      isUserContent={true}
      color={Green}
      size={PillSize.Small}
    />
  );
};

export interface EnterpriseLicenseInstanceStatusPillProps {
  instance: EnterpriseLicenseInstanceUsage;
  isActive?: boolean | undefined;
  now?: Date | undefined;
}

/*
 * Activity is derived from the communication timestamp instead of stored as a
 * second piece of state that could drift. The same predicate drives this badge
 * and the seat aggregation.
 */
export const EnterpriseLicenseInstanceStatusPill: FunctionComponent<
  EnterpriseLicenseInstanceStatusPillProps
> = (props: EnterpriseLicenseInstanceStatusPillProps): ReactElement => {
  const translator: Translator = useTranslator();
  const activityState: EnterpriseLicenseInstanceActivityState =
    getEnterpriseLicenseInstanceActivityState({
      instance: props.instance,
      isActive: props.isActive,
      now: props.now,
    });

  if (activityState === "active") {
    return (
      <Pill
        text="Active"
        color={Green}
        size={PillSize.Small}
        isTooltipUserContent={true}
        tooltip={translator.translatePlural(
          {
            one: "Registered or sent a usage report within the past {{count}} day and is included in seat usage.",
            other:
              "Registered or sent a usage report within the past {{count}} days and is included in seat usage.",
          },
          EnterpriseLicenseUsageUtil.InstanceUsageFreshnessInDays,
        )}
      />
    );
  }

  return (
    <Pill
      text="Inactive"
      color={Gray500}
      size={PillSize.Small}
      isTooltipUserContent={true}
      tooltip={translator.translatePlural(
        {
          one: "Has not registered or sent a usage report for {{count}} day and is not included in seat usage.",
          other:
            "Has not registered or sent a usage report for {{count}} days and is not included in seat usage.",
        },
        EnterpriseLicenseUsageUtil.InstanceUsageFreshnessInDays,
      )}
    />
  );
};

export interface SeatUsageMeterProps {
  currentUserCount: number | undefined;
  userLimit: number | undefined;
}

/*
 * A license's seats in words, as the meter's line reads them ("13 / 150
 * users", "4 users, no limit"): what the list's Export CSV writes in its
 * Seats column. Empty before any installation has reported.
 */
export const getSeatUsageText: (
  props: SeatUsageMeterProps,
  translator?: Translator,
) => string = (
  props: SeatUsageMeterProps,
  translator: Translator = getGlobalTranslator(),
): string => {
  if (props.currentUserCount === undefined && props.userLimit === undefined) {
    return "";
  }

  const currentCount: number = props.currentUserCount || 0;

  if (!props.userLimit || props.userLimit <= 0) {
    return translator.translatePlural(
      { one: "{{count}} user, no limit", other: "{{count}} users, no limit" },
      currentCount,
    );
  }

  return translator.translatePlural(
    {
      one: "{{current}} / {{count}} user",
      other: "{{current}} / {{count}} users",
    },
    props.userLimit,
    { current: translator.formatNumber(currentCount) },
  );
};

/*
 * Meter: the fill carries severity (indigo -> amber near the limit -> red
 * over it); the unfilled track is a lighter step of the same hue so state
 * reads across the whole bar.
 */
export const SeatUsageMeter: FunctionComponent<SeatUsageMeterProps> = (
  props: SeatUsageMeterProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const current: number | undefined = props.currentUserCount;
  const limit: number | undefined = props.userLimit;

  if (current === undefined && limit === undefined) {
    return (
      <span className="text-gray-500">
        {translator.translateText("No reports yet")}
      </span>
    );
  }

  const currentCount: number = current || 0;

  if (!limit || limit <= 0) {
    return (
      <div className="text-sm text-gray-900">
        {translator.translatePlural(
          {
            one: "{{count}} user · no limit",
            other: "{{count}} users · no limit",
          },
          currentCount,
        )}
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
        {translator.formatNumber(currentCount)}{" "}
        <span className="text-gray-500">
          {translator.translatePlural(
            { one: "/ {{count}} user", other: "/ {{count}} users" },
            limit,
          )}
        </span>
        {isOver ? (
          <span className="ml-1 font-medium text-red-600">
            {formatInline(
              [
                "",
                translator.translateTemplate("{{count}} over", {
                  count: translator.formatNumber(currentCount - limit),
                }),
              ],
              translator,
            )}
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

/*
 * The license's white-labelling switch (EnterpriseLicense.canBeWhiteLabelled),
 * in the words the create form, the edit form and the details share.
 */
export const CAN_BE_WHITE_LABELLED_TITLE: string = translationKey(
  "Can be white-labelled",
);

export const CAN_BE_WHITE_LABELLED_DESCRIPTION: string = translationKey(
  "Lets the customer replace the OneUptime name and logo in Admin Dashboard > Settings > White Label once their next signed license token arrives.",
);

// Beside the license type in the list, for a license with the switch on.
export const WhiteLabelBadge: FunctionComponent = (): ReactElement => {
  return (
    <Pill
      text="White-label"
      tone={PillTone.Info}
      isDotHidden={true}
      dataTestId="license-white-label-badge"
    />
  );
};
