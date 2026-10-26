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

export interface CloudAccountStatus {
  // English, translated where it is shown.
  label: string;
  tone: CloudAccountStatusTone;
}

export function getCloudAccountStatus(data: {
  lastSeenAt: Date | string | undefined | null;
  hasConnection: boolean;
  now: Date;
}): CloudAccountStatus {
  if (!data.hasConnection) {
    return { label: translationKey("Not connected"), tone: "neutral" };
  }

  const lastSeen: number = data.lastSeenAt
    ? new Date(data.lastSeenAt).getTime()
    : NaN;

  if (
    Number.isFinite(lastSeen) &&
    data.now.getTime() - lastSeen <= CLOUD_ACCOUNT_READING_WINDOW_MS
  ) {
    return { label: translationKey("Reading"), tone: "positive" };
  }

  return { label: translationKey("Not read lately"), tone: "warning" };
}
