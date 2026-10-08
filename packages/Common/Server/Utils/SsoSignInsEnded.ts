import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OneUptimeDate from "../../Types/Date";
import Dictionary from "../../Types/Dictionary";
import DatabaseService from "../Services/DatabaseService";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";

/*
 * TURNING AN SSO PROVIDER OFF ENDS THE SIGN-INS IT GAVE, WHATEVER KIND OF
 * PROVIDER IT IS.
 *
 * A project's SAML and OIDC providers, the server's global ones and a status
 * page's each keep when they were last turned off (signInsEndedAt). The
 * write that turns one off writes it, in the same write, so a provider is
 * never off without it. A sign-in the provider gave before then no longer
 * counts, and turning the provider on again does not bring it back: people
 * sign in with it again. Who asks:
 *
 *   - a project's provider: ProjectSsoProviderStanding, for UserMiddleware;
 *   - a global provider: UserMiddleware.isGlobalSsoTokenAuthorizedForProject;
 *   - a status page's provider: StatusPagePrivateUserSessionService.
 *     addSignInRule, for the status page's sessions.
 *
 * Changing anything else about a provider - its certificate, client secret,
 * addresses, name or teams - writes nothing here: the sign-ins it gave were
 * checked when they were made, and the next sign-in uses the new settings.
 *
 * The time is written by the clock the sign-ins it is compared with were
 * stamped by. A project's and a global provider's sign-ins are tokens the
 * app servers issued (their iat), so those are written by the app's clock
 * (stampWhenTurnedOff). A status page's sessions are compared in the
 * database, by the time the database gave them (createdAt), so a status
 * page provider's is written by the database, in the same write
 * (stampWhenTurnedOffByDatabase): no difference between the two clocks
 * moves the line.
 */

/*
 * What a status page provider's turning-off write stores in signInsEndedAt,
 * worked out by the database in the row's own write
 * (DatabaseService.getRowWriteSql): its own time, for a row that was on; a
 * row that was off already keeps the time it has.
 */
export const SIGN_INS_ENDED_BY_DATABASE_SQL: string = `CASE WHEN "isEnabled" = true THEN now() ELSE "signInsEndedAt" END`;

// What the database says about a provider, as far as its sign-ins go.
export interface SsoProviderSignInStanding {
  // The provider is there and turned on.
  isOn: boolean;
  /*
   * When it was last turned off (milliseconds), or null when it never was:
   * a sign-in it gave before then no longer counts.
   */
  signInsEndedAtMs: number | null;
}

export default class SsoSignInsEnded {
  /*
   * Whether a provider with this standing vouches for a sign-in it gave at
   * `issuedAtMs`. A sign-in that does not say when it was given cannot be
   * placed after the provider was turned off, so it only counts for a
   * provider that never was. JWT issue times are whole seconds, rounded
   * down, so a sign-in given in the same second the provider was turned off
   * does not count either.
   */
  public static doesProviderVouchFor(
    standing: SsoProviderSignInStanding,
    issuedAtMs: number | null,
  ): boolean {
    if (!standing.isOn) {
      return false;
    }

    if (standing.signInsEndedAtMs === null) {
      return true;
    }

    return issuedAtMs !== null && issuedAtMs > standing.signInsEndedAtMs;
  }

  // A stored signInsEndedAt, in milliseconds, or null when it was never set.
  public static toSignInsEndedAtMs(value: unknown): number | null {
    if (!value) {
      return null;
    }

    const time: number = new Date(value as Date).getTime();

    return Number.isFinite(time) ? time : null;
  }

  /*
   * The Enabled switch an update writes - true or false, as DatabaseService
   * stores it by the time the hooks run - or undefined when it leaves it
   * alone. Only the write's own field counts, never one it inherits.
   */
  public static getWrittenIsEnabled(data: unknown): boolean | undefined {
    return SsoSignInsEnded.getWrittenBoolean(data, "isEnabled");
  }

  // A boolean column an update writes, or undefined when it leaves it alone.
  public static getWrittenBoolean(
    data: unknown,
    column: string,
  ): boolean | undefined {
    if (
      !data ||
      typeof data !== "object" ||
      !Object.prototype.hasOwnProperty.call(data, column)
    ) {
      return undefined;
    }

    const value: unknown = (data as Record<string, unknown>)[column];

    return typeof value === "boolean" ? value : undefined;
  }

  /*
   * The last step before an update to a provider is written (the service's
   * onUpdatePermitted, once every permission check has passed): an update
   * that turns a provider off writes when, in the same write, so a provider
   * is never off without the time its sign-ins ended. An update that turns
   * none off - every provider it names is off already - keeps the times they
   * have. One that turns several off gives each the same time, one that was
   * off already included: a provider that is off gives no sign-ins, so a
   * later time ends none that an earlier one did not.
   *
   * `turnsOneOff` is what the service's own hooks found before the write,
   * from rows read under a lock; without it, the rows are read now. A
   * global provider's hooks pass true for every write that turns one off
   * (GlobalSsoProviderChanges.beforeProviderWrite): turning a global
   * provider on takes no lock, so its write stamps the provider whatever it
   * read, and one that was off already has its time moved on - ending no
   * sign-in its earlier time did not.
   */
  public static async stampWhenTurnedOff<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
    turnsOneOff?: boolean | undefined;
  }): Promise<void> {
    if (SsoSignInsEnded.getWrittenIsEnabled(data.updateBy.data) !== false) {
      return;
    }

    const turnsOneOff: boolean =
      data.turnsOneOff !== undefined
        ? data.turnsOneOff
        : await SsoSignInsEnded.isAnyOn({
            service: data.service,
            updateBy: data.updateBy,
          });

    if (!turnsOneOff) {
      return;
    }

    (data.updateBy.data as unknown as Record<string, unknown>)[
      "signInsEndedAt"
    ] = OneUptimeDate.getCurrentDate();
  }

  /*
   * For a status page provider (its onUpdatePermitted): an update that
   * turns Enabled off writes signInsEndedAt too, in the same write, worked
   * out there by the database (getDatabaseStampSql, the service's
   * getRowWriteSql): the value put here only names the column in the
   * write. Nothing is read first. The database decides each row in its own
   * write, under the row's lock - a row that is on gets its time, one that
   * is off already keeps the time it has - so a provider turned on a moment
   * before the write is stamped too, which a read made before the write
   * would miss: a status page provider is turned on and off under no lock.
   */
  public static stampWhenTurnedOffByDatabase<TModel extends BaseModel>(data: {
    updateBy: UpdateBy<TModel>;
  }): void {
    if (SsoSignInsEnded.getWrittenIsEnabled(data.updateBy.data) !== false) {
      return;
    }

    (data.updateBy.data as unknown as Record<string, unknown>)[
      "signInsEndedAt"
    ] = OneUptimeDate.getCurrentDate();
  }

  /*
   * The SQL a status page provider's update stores signInsEndedAt with
   * (the service's getRowWriteSql): only for the write that turns Enabled
   * off, which names the column (stampWhenTurnedOffByDatabase).
   */
  public static getDatabaseStampSql(written: unknown): Dictionary<string> {
    if (
      SsoSignInsEnded.getWrittenIsEnabled(written) !== false ||
      !Object.prototype.hasOwnProperty.call(written, "signInsEndedAt")
    ) {
      return {};
    }

    return { signInsEndedAt: SIGN_INS_ENDED_BY_DATABASE_SQL };
  }

  // Whether any provider the update names is on now.
  private static async isAnyOn<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<boolean> {
    const rows: Array<TModel> = await data.service.findAllBy({
      query: data.updateBy.query,
      select: {
        _id: true,
        isEnabled: true,
      } as unknown as Select<TModel>,
      limit: data.updateBy.limit,
      skip: data.updateBy.skip,
      props: {
        isRoot: true,
      },
    });

    return rows.some((row: TModel): boolean => {
      return (row as unknown as Record<string, unknown>)["isEnabled"] === true;
    });
  }
}
