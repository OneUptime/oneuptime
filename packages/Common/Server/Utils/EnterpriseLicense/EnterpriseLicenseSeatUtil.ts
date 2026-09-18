import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import EnterpriseLicenseInstanceSummary from "../../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import EnterpriseLicenseSeatsUtil, {
  SeatUsage,
} from "../../../Utils/EnterpriseLicense/EnterpriseLicenseSeats";
import { IsBillingEnabled, IsEnterpriseEdition } from "../../EnvironmentConfig";
import GlobalConfigService from "../../Services/GlobalConfigService";

/*
 * Counts the users on THIS installation. Passed in rather than called
 * directly so this util never has to import UserService — and, more usefully,
 * so the count is only paid for on the installations that actually enforce a
 * limit. On Community Edition and on oneuptime.com itself the callbacks below
 * are never invoked.
 */
export type GetLocalUserCountFunction = () => Promise<number>;

/*
 * Enforcement of the enterprise license seat limit on a self-hosted
 * installation.
 *
 * The limit itself is set on oneuptime.com and mirrored into GlobalConfig by
 * the daily report job (and by validating or refreshing the license by hand).
 * This is the half that acts on it: it is the only thing standing between a
 * customer's license terms and an unbounded User table.
 *
 * The seat arithmetic lives in Common/Utils/EnterpriseLicense/EnterpriseLicenseSeats
 * as a pure function; everything here is about reading the license state and
 * deciding whether the installation is one that enforces at all.
 */
export default class EnterpriseLicenseSeatUtil {
  /*
   * Whether this process is an installation whose users are governed by an
   * enterprise license at all.
   *
   * Community Edition has no license and no limit. oneuptime.com runs with
   * billing enabled and bounds seats through subscriptions instead
   * (TeamMemberService.onBeforeCreate) — enforcing a license limit there as
   * well would be a second, wrong answer to the same question.
   */
  public static isSeatLimitEnforceable(): boolean {
    return IsEnterpriseEdition && !IsBillingEnabled;
  }

  /*
   * Seat usage derived from an already-loaded GlobalConfig row. Kept separate
   * from the loading so a caller that has the row in hand — the license
   * endpoint, which has just read it — does not read it a second time.
   *
   * A null config (a fresh installation whose GlobalConfig has not been seeded
   * yet) yields no limit, which is the same answer as a licence with no seat
   * limit set.
   */
  public static getSeatUsageFromGlobalConfig(data: {
    config: GlobalConfig | null;
    localUserCount: number;
  }): SeatUsage {
    const config: GlobalConfig | null = data.config;

    const instances: Array<EnterpriseLicenseInstanceSummary> = Array.isArray(
      config?.enterpriseLicenseInstances,
    )
      ? config.enterpriseLicenseInstances
      : [];

    return EnterpriseLicenseSeatsUtil.getSeatUsage({
      userLimit: config?.enterpriseLicenseUserLimit,
      localUserCount: data.localUserCount,
      aggregatedUserCount: config?.enterpriseLicenseCurrentUserCount,
      instances: instances,
      thisInstanceId: config?.instanceId ? config.instanceId.toString() : null,
    });
  }

  /*
   * Seat usage for this installation right now, or null on an installation
   * that does not enforce a seat limit.
   *
   * Null rather than an unenforced SeatUsage so callers cannot accidentally
   * present Community Edition with a seat report it has no business having,
   * and so the user count is never queried there.
   */
  public static async getSeatUsage(data: {
    getLocalUserCount: GetLocalUserCountFunction;
  }): Promise<SeatUsage | null> {
    if (!this.isSeatLimitEnforceable()) {
      return null;
    }

    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: {
        enterpriseLicenseUserLimit: true,
        enterpriseLicenseCurrentUserCount: true,
        enterpriseLicenseInstances: true,
        instanceId: true,
      },
      props: {
        isRoot: true,
      },
    });

    return this.getSeatUsageForLoadedGlobalConfig({
      config: config,
      getLocalUserCount: data.getLocalUserCount,
    });
  }

  /*
   * The same answer as getSeatUsage, for a caller that has already loaded the
   * GlobalConfig row (the license endpoint reads it to build its response, and
   * reading it twice per request would be silly).
   *
   * The row must have been selected with enterpriseLicenseUserLimit,
   * enterpriseLicenseCurrentUserCount, enterpriseLicenseInstances and
   * instanceId, or the numbers here are a fiction built from missing columns.
   */
  public static async getSeatUsageForLoadedGlobalConfig(data: {
    config: GlobalConfig | null;
    getLocalUserCount: GetLocalUserCountFunction;
  }): Promise<SeatUsage | null> {
    if (!this.isSeatLimitEnforceable()) {
      return null;
    }

    /*
     * The seat limit is read before the users are counted, and the count is
     * skipped entirely when there is no limit. An unlimited licence is the
     * common case on a large installation, and that is exactly the
     * installation where counting the User table on every user creation would
     * be worth avoiding.
     */
    const withoutLocalUsers: SeatUsage = this.getSeatUsageFromGlobalConfig({
      config: data.config,
      localUserCount: 0,
    });

    if (!withoutLocalUsers.isEnforced) {
      return withoutLocalUsers;
    }

    return this.getSeatUsageFromGlobalConfig({
      config: data.config,
      localUserCount: await data.getLocalUserCount(),
    });
  }

  /*
   * Throws if this installation cannot take another user.
   *
   * Called from UserService.onBeforeCreate, which every path that creates a
   * user goes through — team invitations, self-service signup, SSO and OIDC
   * just-in-time provisioning, SCIM, and the Admin Dashboard. Enforcing on the
   * User row rather than on the invitation is what makes that true: a seat is
   * consumed by a person existing on the installation, not by the particular
   * door they came through.
   *
   * It is also why this deliberately does NOT exempt root/internal writes.
   * Team invitations create the invited user with `isRoot: true`, so an
   * isRoot escape hatch here would exempt the single most important path.
   */
  public static async assertSeatAvailableForNewUser(data: {
    getLocalUserCount: GetLocalUserCountFunction;
  }): Promise<void> {
    const seatUsage: SeatUsage | null = await this.getSeatUsage({
      getLocalUserCount: data.getLocalUserCount,
    });

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
