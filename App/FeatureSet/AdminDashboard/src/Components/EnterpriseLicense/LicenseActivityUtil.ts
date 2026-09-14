import OneUptimeDate from "Common/Types/Date";
import EnterpriseLicenseUsageSnapshot from "Common/Types/EnterpriseLicense/EnterpriseLicenseUsageSnapshot";
import EnterpriseLicenseUsageUtil, {
  EnterpriseLicenseInstanceUsage,
} from "Common/Utils/EnterpriseLicense/EnterpriseLicenseUsage";

export const EnterpriseLicenseUsageRefreshIntervalInMilliseconds: number =
  60 * 1000;
export const EnterpriseLicenseUsageMinimumRefreshDelayInMilliseconds: number = 1000;

export const isEnterpriseLicenseUsageRequestCurrent: (
  requestId: number,
  latestRequestId: number,
) => boolean = (requestId: number, latestRequestId: number): boolean => {
  return requestId === latestRequestId;
};

export const getEnterpriseLicenseUsageBoundaryRefreshDelay: (
  snapshot: EnterpriseLicenseUsageSnapshot,
  elapsedSinceRequestStartedInMilliseconds?: number,
) => number | null = (
  snapshot: EnterpriseLicenseUsageSnapshot,
  elapsedSinceRequestStartedInMilliseconds: number = 0,
): number | null => {
  if (!snapshot.nextInstanceStatusChangeAt) {
    return null;
  }

  const nextChangeAt: number = new Date(
    snapshot.nextInstanceStatusChangeAt,
  ).getTime();
  const calculatedAt: number = new Date(snapshot.calculatedAt).getTime();

  if (!Number.isFinite(nextChangeAt) || !Number.isFinite(calculatedAt)) {
    return null;
  }

  const elapsedRequestTime: number = Number.isFinite(
    elapsedSinceRequestStartedInMilliseconds,
  )
    ? Math.max(0, elapsedSinceRequestStartedInMilliseconds)
    : 0;

  /*
   * Both timestamps come from the server. Using the browser clock here can
   * turn clock skew into a zero-delay refresh loop while the server still
   * considers the instance active. The timer starts only after the response,
   * so subtract monotonic time elapsed since the request began as well.
   */
  return Math.max(
    EnterpriseLicenseUsageMinimumRefreshDelayInMilliseconds,
    nextChangeAt - calculatedAt - elapsedRequestTime,
  );
};

export type EnterpriseLicenseInstanceActivityState = "active" | "inactive";

export interface EnterpriseLicenseInstanceActivityInput {
  instance: EnterpriseLicenseInstanceUsage;
  isActive?: boolean | undefined;
  now?: Date | undefined;
}

export const getEnterpriseLicenseInstanceActivityState: (
  input: EnterpriseLicenseInstanceActivityInput,
) => EnterpriseLicenseInstanceActivityState = (
  input: EnterpriseLicenseInstanceActivityInput,
): EnterpriseLicenseInstanceActivityState => {
  const isActive: boolean =
    typeof input.isActive === "boolean"
      ? input.isActive
      : EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage(
          input.instance,
          input.now || OneUptimeDate.getCurrentDate(),
        );

  return isActive ? "active" : "inactive";
};
