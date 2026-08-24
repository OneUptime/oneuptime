import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import PartialEntity from "../../Types/Database/PartialEntity";
import EnterpriseLicenseInstanceSummary from "../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import { JSONObject } from "../../Types/JSON";

export interface EnterpriseLicenseSyncResult {
  /*
   * Only the columns the license server actually spoke about. A column the
   * response did not mention is absent from this object, so updateOneById
   * leaves whatever is stored alone.
   */
  updateData: PartialEntity<GlobalConfig>;

  /*
   * Fields the server sent in a shape this build cannot use. Returned rather
   * than logged so this stays a pure function the tests can drive directly;
   * the caller decides how loud to be about them.
   */
  warnings: Array<string>;
}

/*
 * Maps a license-server response (from /enterprise-license/validate or
 * /enterprise-license/report-user-count) onto the GlobalConfig columns a
 * self-hosted installation mirrors locally.
 *
 * Every field is three-state, and the distinction is the whole contract:
 *
 *   key absent  - the license server did not speak about this field. That is
 *                 what an oneuptime.com older than this build looks like, so
 *                 the stored value is left exactly as it is. Collapsing this
 *                 to null is how a daily report would wipe a perfectly good
 *                 license expiry and take the installation down.
 *   null        - the server explicitly says "there is no value". Written as
 *                 null, so clearing a seat limit on oneuptime.com actually
 *                 clears it on the customer's installation.
 *   a value     - validated, then written.
 *
 * Anything that is neither absent, null, nor a usable value is treated as
 * absent and reported as a warning: a malformed response must never be able
 * to corrupt license state that was correct a moment ago.
 */
export default class EnterpriseLicenseSyncUtil {
  /*
   * The license key is deliberately NOT synced. The installation authenticates
   * with the key it already holds, and a response must never be able to swap
   * it for another one.
   */
  public static getGlobalConfigUpdateFromLicenseResponse(data: {
    payload: JSONObject;
    /*
     * Used as the "user count as of" stamp when the server reports a count but
     * no timestamp for it. Passed in rather than read from the clock so the
     * function stays pure.
     */
    reportedAt: Date;
  }): EnterpriseLicenseSyncResult {
    const payload: JSONObject = data.payload || {};
    const updateData: PartialEntity<GlobalConfig> = {};
    const warnings: Array<string> = [];

    /*
     * The seat limit. This is the field customers change on oneuptime.com and
     * then wait for: without it here, buying seats never reaches the
     * installation that is enforcing the old number.
     */
    if (this.isPresent(payload, "userLimit")) {
      const rawUserLimit: unknown = payload["userLimit"];

      if (rawUserLimit === null) {
        updateData.enterpriseLicenseUserLimit = null;
      } else if (this.isNonNegativeInteger(rawUserLimit)) {
        updateData.enterpriseLicenseUserLimit = rawUserLimit as number;
      } else {
        warnings.push(
          `Ignored userLimit "${String(
            rawUserLimit,
          )}" from the license server: it is not a non-negative whole number.`,
        );
      }
    }

    /*
     * The count and its timestamp move together: a count with a stamp from a
     * previous report would read as "confirmed today", which is the exact
     * lie this whole sync exists to stop telling.
     */
    if (this.isPresent(payload, "currentUserCount")) {
      const rawUserCount: unknown = payload["currentUserCount"];

      if (this.isNonNegativeInteger(rawUserCount)) {
        updateData.enterpriseLicenseCurrentUserCount = rawUserCount as number;
        updateData.enterpriseLicenseUserCountUpdatedAt =
          this.parseDate(payload["userCountUpdatedAt"]) || data.reportedAt;
      } else if (rawUserCount === null) {
        /*
         * The server has never had a count for this license. Nothing useful to
         * store, and blanking the last known count would be worse than keeping
         * it, so leave both columns alone.
         */
        warnings.push(
          "The license server reported no user count for this license. Keeping the previously stored usage.",
        );
      } else {
        warnings.push(
          `Ignored currentUserCount "${String(
            rawUserCount,
          )}" from the license server: it is not a non-negative whole number. Keeping the previously stored usage.`,
        );
      }
    }

    /*
     * Expiry drives licenseValid on the installation, so a renewal that never
     * arrives here shows up as a license that expires on its original date
     * however much the customer paid. Null is treated as absent on purpose: a
     * report is not the place to strip an installation of its expiry.
     */
    if (this.isPresent(payload, "expiresAt") && payload["expiresAt"] !== null) {
      const expiresAt: Date | null = this.parseDate(payload["expiresAt"]);

      if (expiresAt) {
        updateData.enterpriseLicenseExpiresAt = expiresAt;
      } else {
        warnings.push(
          `Ignored expiresAt "${String(
            payload["expiresAt"],
          )}" from the license server: it is not a date.`,
        );
      }
    }

    if (this.isPresent(payload, "isEvaluationLicense")) {
      const rawIsEvaluation: unknown = payload["isEvaluationLicense"];

      if (typeof rawIsEvaluation === "boolean") {
        updateData.enterpriseLicenseIsEvaluation = rawIsEvaluation;
      } else {
        warnings.push(
          `Ignored isEvaluationLicense "${String(
            rawIsEvaluation,
          )}" from the license server: it is not a boolean.`,
        );
      }
    }

    if (this.isPresent(payload, "companyName")) {
      const companyName: string = this.parseNonEmptyString(
        payload["companyName"],
      );

      /*
       * An empty company name is what the server sends for a license with none
       * set, and overwriting a good name with "" would be a visible regression
       * in the modal. Only a real name is worth writing.
       */
      if (companyName) {
        updateData.enterpriseCompanyName = companyName;
      }
    }

    /*
     * The token is opaque here - it is signed with the license server's secret
     * and this side only checks that it exists. It is never cleared: a license
     * that has expired is legitimately issued no token, and clearing it on the
     * way past would compound an expiry the customer may be about to renew.
     */
    if (this.isPresent(payload, "token")) {
      const token: string = this.parseNonEmptyString(payload["token"]);

      if (token) {
        updateData.enterpriseLicenseToken = token;
      }
    }

    if (this.isPresent(payload, "instances")) {
      const rawInstances: unknown = payload["instances"];

      if (Array.isArray(rawInstances)) {
        updateData.enterpriseLicenseInstances =
          rawInstances as Array<EnterpriseLicenseInstanceSummary>;
      } else {
        warnings.push(
          "Ignored the instance list from the license server: it is not an array.",
        );
      }
    }

    return {
      updateData: updateData,
      warnings: warnings,
    };
  }

  /*
   * Present means the key is on the object, even when it carries null or
   * undefined. `"x" in payload` rather than a truthiness or undefined check,
   * because "the server said null" and "the server said nothing" have to stay
   * distinguishable all the way down.
   */
  private static isPresent(payload: JSONObject, key: string): boolean {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      return false;
    }

    // An explicit undefined is indistinguishable from silence. Treat it as one.
    return payload[key] !== undefined;
  }

  private static isNonNegativeInteger(value: unknown): boolean {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= 0
    );
  }

  private static parseNonEmptyString(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim();
  }

  private static parseDate(value: unknown): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    const parsed: Date = new Date(value.trim());

    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }
}
