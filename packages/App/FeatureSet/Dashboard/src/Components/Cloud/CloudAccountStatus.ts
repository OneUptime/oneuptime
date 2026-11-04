import { Gray500, Green, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How a cloud account's status pill reads on its Overview: read lately by
 * a cloud connection, not lately, or by no connection at all. Kept apart
 * from the page so App's tests can read it without React.
 */

// An account read within this long is being read: connections read every few minutes.
export const CLOUD_ACCOUNT_READING_WINDOW_MS: number = 60 * 60 * 1000;

// The pill's colour, as the overview hero takes it (ResourceOverviewStatusTone).
export type CloudAccountStatusTone = "positive" | "warning" | "neutral";

/*
 * The same tones as the accounts list's pills draw them, the colours the
 * Connect page's list gives a connection that works, warns or is off.
 */
export const CLOUD_ACCOUNT_STATUS_COLORS: Readonly<
  Record<CloudAccountStatusTone, Color>
> = {
  positive: Green,
  warning: Yellow,
  neutral: Gray500,
};

export interface CloudAccountStatus {
  // English, translated where it is shown.
  label: string;
  // What the state means, as the pill's hover (English, translated where shown).
  description: string;
  tone: CloudAccountStatusTone;
}

// What each state means, for the pill's hover on an account's Overview.
export const CLOUD_ACCOUNT_STATUS_DESCRIPTIONS: {
  reading: string;
  notReadLately: string;
  notConnected: string;
} = {
  reading: translationKey(
    "A cloud connection read this account within the last hour.",
  ),
  notReadLately: translationKey(
    "No cloud connection has read this account for over an hour. Cloud > Connect says why.",
  ),
  notConnected: translationKey(
    "No cloud connection reads this account any more. Connect it again from Cloud > Connect.",
  ),
};

export function getCloudAccountStatus(data: {
  lastSeenAt: Date | string | undefined | null;
  hasConnection: boolean;
  now: Date;
}): CloudAccountStatus {
  if (!data.hasConnection) {
    return {
      label: translationKey("Not connected"),
      description: CLOUD_ACCOUNT_STATUS_DESCRIPTIONS.notConnected,
      tone: "neutral",
    };
  }

  const lastSeen: number = data.lastSeenAt
    ? new Date(data.lastSeenAt).getTime()
    : NaN;

  if (
    Number.isFinite(lastSeen) &&
    data.now.getTime() - lastSeen <= CLOUD_ACCOUNT_READING_WINDOW_MS
  ) {
    return {
      label: translationKey("Reading"),
      description: CLOUD_ACCOUNT_STATUS_DESCRIPTIONS.reading,
      tone: "positive",
    };
  }

  return {
    label: translationKey("Not read lately"),
    description: CLOUD_ACCOUNT_STATUS_DESCRIPTIONS.notReadLately,
    tone: "warning",
  };
}
