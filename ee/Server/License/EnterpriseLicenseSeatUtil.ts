import BadDataException from "Common/Types/Exception/BadDataException";
import EnterpriseLicenseSeatsUtil, {
  SeatUsage,
} from "Common/Utils/EnterpriseLicense/EnterpriseLicenseSeats";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseSnapshotUtil,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { LicenseInputs } from "./LicenseInputs";

/*
 * Counts the users on THIS installation. Passed in rather than called
 * directly so the count is only paid for on the installations that actually
 * enforce a limit: on oneuptime.com, on an installation without a usable
 * license and on a license with no seat limit, the callback is never invoked.
 */
export type GetLocalUserCountFunction = () => Promise<number>;

export interface SeatCheckData {
  // The license inputs: the aggregated count, the instances, this instance's id.
  inputs: LicenseInputs;
  // The license as classified now: whether it is usable, and its seat limit.
  snapshot: EnterpriseLicenseSnapshot | null;
  getLocalUserCount: GetLocalUserCountFunction;
}

/*
 * Enforcement of the enterprise license seat limit on a self-hosted
 * installation.
 *
 * The limit is set on oneuptime.com and reaches the installation in the
 * license: from the signed claims for a verified license, from the stored
 * column for an unverified legacy one (either way it is snapshot.userLimit).
 * This is the half that acts on it: it is the only thing standing between a
 * customer's license terms and an unbounded User table.
 *
 * The seat arithmetic lives in Common/Utils/EnterpriseLicense/EnterpriseLicenseSeats
 * as a pure function; everything here is about deciding whether the
 * installation enforces at all.
 */
export default class EnterpriseLicenseSeatUtil {
  /*
   * Whether seats are limited on this installation right now.
   *
   * oneuptime.com runs with billing enabled and bounds seats through
   * subscriptions instead (TeamMemberService.onBeforeCreate) — enforcing a
   * license limit there as well would be a second, wrong answer to the same
   * question.
   *
   * Only a license that is valid or in its grace period limits seats. An
   * expired, missing or invalid license stops limiting them rather than
   * locking a customer out of adding people: the license already stops
   * enterprise configuration changes, and that is the whole of soft
   * enforcement.
   */
  public static isSeatLimitEnforceable(
    snapshot: EnterpriseLicenseSnapshot | null,
  ): boolean {
    return !IsBillingEnabled && EnterpriseLicenseSnapshotUtil.isUsable(snapshot);
  }

  /*
   * Seat usage for a known local user count. The limit comes from the
   * snapshot; the license-wide count and the per-instance breakdown from the
   * last usage report.
   */
  public static getSeatUsageFromLicense(data: {
    inputs: LicenseInputs;
    snapshot: EnterpriseLicenseSnapshot | null;
    localUserCount: number;
  }): SeatUsage {
    return EnterpriseLicenseSeatsUtil.getSeatUsage({
      userLimit: data.snapshot ? data.snapshot.userLimit : null,
      localUserCount: data.localUserCount,
      aggregatedUserCount: data.inputs.currentUserCount,
      instances: Array.isArray(data.inputs.instances)
        ? data.inputs.instances
        : [],
      thisInstanceId: data.inputs.instanceId,
    });
  }

  /*
   * Seat usage for this installation right now, or null on an installation
   * that does not enforce a seat limit.
   *
   * Null rather than an unenforced SeatUsage so callers cannot accidentally
   * present an unlimited installation with a seat report it has no business
   * having, and so the user count is never queried there.
   */
  public static async getSeatUsageForLicense(
    data: SeatCheckData,
  ): Promise<SeatUsage | null> {
    if (!EnterpriseLicenseSeatUtil.isSeatLimitEnforceable(data.snapshot)) {
      return null;
    }

    /*
     * The seat limit is read before the users are counted, and the count is
     * skipped entirely when there is no limit. An unlimited licence is the
     * common case on a large installation, and that is exactly the
     * installation where counting the User table on every user creation would
     * be worth avoiding.
     */
    const withoutLocalUsers: SeatUsage =
      EnterpriseLicenseSeatUtil.getSeatUsageFromLicense({
        inputs: data.inputs,
        snapshot: data.snapshot,
        localUserCount: 0,
      });

    if (!withoutLocalUsers.isEnforced) {
      return withoutLocalUsers;
    }

    return EnterpriseLicenseSeatUtil.getSeatUsageFromLicense({
      inputs: data.inputs,
      snapshot: data.snapshot,
      localUserCount: await data.getLocalUserCount(),
    });
  }

  /*
   * Throws if this installation cannot take another user.
   *
   * Reached from UserService.onBeforeCreate (through EnterpriseEdition), which
   * every path that creates a user goes through — team invitations,
   * self-service signup, SSO and OIDC just-in-time provisioning, SCIM, and the
   * Admin Dashboard. Enforcing on the User row rather than on the invitation
   * is what makes that true: a seat is consumed by a person existing on the
   * installation, not by the particular door they came through.
   *
   * It is also why this deliberately does NOT exempt root/internal writes.
   * Team invitations create the invited user with `isRoot: true`, so an
   * isRoot escape hatch here would exempt the single most important path.
   */
  public static async assertSeatAvailableForNewUser(
    data: SeatCheckData,
  ): Promise<void> {
    const seatUsage: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLicense(data);

    if (!seatUsage || !seatUsage.isEnforced) {
      return;
    }

    if (seatUsage.hasSeatForNewUser) {
      return;
    }

    throw new BadDataException(
      EnterpriseLicenseSeatsUtil.getSeatLimitReachedMessage({
        seatsInUse: seatUsage.seatsInUse,
        userLimit: seatUsage.userLimit as number,
      }),
    );
  }
}
