import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import {
  AppVersion,
  EnterpriseLicenseValidationUrl,
  Host,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import PartialEntity from "Common/Types/Database/PartialEntity";
import EnterpriseLicenseInstanceSummary from "Common/Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/Utils/API";
import LicenseInputsUtil, { LicenseInputs } from "./LicenseInputs";
import licenseProvider from "./LicenseProvider";
import LicenseRanking, { GuardedLicenseUpdate } from "./LicenseRanking";
import LicenseStore from "./LicenseStore";
import { LicenseTokenClassification } from "./LicenseToken";
import { getTrustedLicenseKeys } from "./TrustedLicenseKeys";

/*
 * The license client's writes: activating a license online (a license key
 * checked with oneuptime.com) or offline (a signed license token pasted in),
 * and refreshing the license this installation already holds.
 *
 * Every write goes through LicenseStore as root, and every write refreshes this
 * process's license cache before returning, so the answer the caller gets and
 * the next permission check agree.
 */

export type LicenseValidationMode = "activate" | "refresh";

// Whitespace a copy-paste can put inside a token (line wrapping, a trailing newline).
const WHITESPACE: RegExp = /\s+/g;

const describeError: (err: unknown) => string = (err: unknown): string => {
  return err instanceof Error ? err.message : String(err);
};

export default class LicenseClient {
  public static normalizePastedToken(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.replace(WHITESPACE, "");
  }

  /*
   * Maps a /enterprise-license/validate answer onto the GlobalConfig columns,
   * exactly as activation always has: every term is written, a term the
   * server did not send is written as empty. Throws on an expiry that is not a
   * date, before anything is stored.
   */
  public static mapValidationResponse(data: {
    payload: JSONObject;
    licenseKey: string;
    mode: LicenseValidationMode;
  }): PartialEntity<GlobalConfig> {
    const payload: JSONObject = data.payload || {};

    const companyName: string =
      (payload["companyName"] as string | undefined)?.toString().trim() || "";
    const expiresAtRaw: string =
      (payload["expiresAt"] as string | undefined) || "";
    const token: string = (payload["token"] as string | undefined) || "";

    let expiresAt: Date | null = null;

    if (expiresAtRaw) {
      const parsedDate: Date = new Date(expiresAtRaw);

      if (Number.isNaN(parsedDate.getTime())) {
        throw new BadDataException(
          "License expiration returned from server is invalid.",
        );
      }

      expiresAt = parsedDate;
    }

    const userLimitRaw: unknown = payload["userLimit"];
    const currentUserCountRaw: unknown = payload["currentUserCount"];

    let userCountUpdatedAt: Date | null = null;
    const userCountUpdatedAtRaw: unknown = payload["userCountUpdatedAt"];

    if (typeof userCountUpdatedAtRaw === "string" && userCountUpdatedAtRaw) {
      const parsedReportedAt: Date = new Date(userCountUpdatedAtRaw);

      if (!Number.isNaN(parsedReportedAt.getTime())) {
        userCountUpdatedAt = parsedReportedAt;
      }
    }

    const update: PartialEntity<GlobalConfig> = {
      enterpriseCompanyName: companyName || null,
      enterpriseLicenseExpiresAt: expiresAt,
      enterpriseLicenseToken: token || null,
      enterpriseLicenseIsEvaluation: payload["isEvaluationLicense"] === true,
      enterpriseLicenseUserLimit:
        typeof userLimitRaw === "number" && Number.isFinite(userLimitRaw)
          ? userLimitRaw
          : null,
      enterpriseLicenseCurrentUserCount:
        typeof currentUserCountRaw === "number" &&
        Number.isFinite(currentUserCountRaw)
          ? currentUserCountRaw
          : null,
      enterpriseLicenseUserCountUpdatedAt: userCountUpdatedAt,
      enterpriseLicenseInstances: Array.isArray(payload["instances"])
        ? (payload["instances"] as Array<EnterpriseLicenseInstanceSummary>)
        : [],
    };

    /*
     * Activation stores the key the server echoes back (or the one typed).
     * A refresh never lets the response swap the key it authenticated with.
     */
    if (data.mode === "activate") {
      update.enterpriseLicenseKey =
        (payload["licenseKey"] as string | undefined)?.toString().trim() ||
        data.licenseKey;
    }

    return update;
  }

  /*
   * Asks oneuptime.com what this license key is worth today and stores the
   * answer. Shared by activation and refresh so the two cannot drift.
   *
   *   activate  an explicit administrator action: the returned license
   *             replaces the stored one, unless it is unusable here at all
   *             ("invalid" - a bad signature, another instance's license) or
   *             it would downgrade the license this installation already
   *             holds. Either way NOTHING is stored and the error says why.
   *   refresh   the same never-downgrade rule, applied through
   *             LicenseRanking.guardUpdate: the license terms are dropped from
   *             the write, the installed ones are kept, the usage figures are
   *             still stored, and the error says so.
   *
   * The two refuse the same writes and report them differently on purpose.
   * A refresh is also a background job (Jobs/ReportUserCount runs the same
   * guard daily), so it has to store the half of the answer that is always
   * safe - the usage report - and carry on. An activation is one person
   * pressing one button and reading one error: a half-applied activation would
   * leave enterpriseLicenseKey (which is NOT a license-term column, so
   * guardUpdate does not protect it) pointing at the license whose terms were
   * just refused, and the usage figures beside it would describe that refused
   * license too. "Either the license was replaced or nothing changed" is the
   * only contract worth giving a human here, and it is the one activation
   * already gave for an unusable license.
   */
  public static async validateWithLicenseServer(data: {
    licenseKey: string;
    mode: LicenseValidationMode;
  }): Promise<void> {
    const now: Date = new Date();
    const inputs: LicenseInputs = await LicenseStore.loadLicenseInputs(now);

    /*
     * Send this instance's id and host along with the key so the license
     * server registers this instance against the license and it shows up in
     * the instance list on every instance that shares the license.
     */
    const instanceId: ObjectID = inputs.instanceId
      ? new ObjectID(inputs.instanceId)
      : ObjectID.generate();

    const validationResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: EnterpriseLicenseValidationUrl,
        data: {
          licenseKey: data.licenseKey,
          instanceId: instanceId.toString(),
          host: Host,
          /*
           * Sent here as well as from the daily report job so the version
           * lands on the license server the moment the key is validated,
           * rather than up to 24 hours later.
           */
          version: AppVersion,
        },
      });

    if (!validationResponse.isSuccess()) {
      const errorMessage: string =
        validationResponse instanceof HTTPErrorResponse
          ? validationResponse.message || "Failed to validate license key."
          : "Failed to validate license key.";
      throw new BadDataException(errorMessage);
    }

    const update: PartialEntity<GlobalConfig> =
      LicenseClient.mapValidationResponse({
        payload: (validationResponse.data as JSONObject) || {},
        licenseKey: data.licenseKey,
        mode: data.mode,
      });

    if (!inputs.instanceId) {
      // Installs that predate instance ids: persist the one just reported.
      update.instanceId = instanceId;
    }

    if (data.mode === "activate") {
      const candidateInputs: LicenseInputs = LicenseInputsUtil.withUpdate(
        inputs,
        update,
      );
      const candidate: LicenseTokenClassification = LicenseInputsUtil.classify(
        candidateInputs,
        now,
      );

      if (candidate.status === "invalid") {
        throw new BadDataException(
          `OneUptime returned a license this installation cannot use: ${candidate.message || "it is not valid"}. Nothing was changed.`,
        );
      }

      /*
       * The never-downgrade rule, on the path that used to skip it.
       *
       * "invalid" alone stopped being enough the moment a token with no
       * recorded expiry stopped classifying that way: an answer that carries a
       * token and forgets expiresAt now classifies as the unlicensed trial, so
       * an administrator pressing Validate on a correctly licensed install
       * would have overwritten a working license with one that cannot say
       * whether it is current - losing single sign-on, SCIM and audit logging
       * on the spot, and reporting 200. The same ranking the refresh path has
       * always applied catches it, and catches everything else that would take
       * this installation backwards.
       *
       * It is the ranking and not a special case for the missing expiry
       * because an activation has no way to tell the difference: whatever the
       * answer's shape, the question is only ever "does this leave the
       * installation with less than it has now".
       */
      const current: LicenseTokenClassification = LicenseInputsUtil.classify(
        inputs,
        now,
      );

      if (
        !LicenseRanking.mayReplace({
          current,
          candidate,
          sameToken: inputs.token === candidateInputs.token,
        })
      ) {
        throw new BadDataException(
          `OneUptime returned a license that classifies as ${LicenseRanking.describe(candidate)}, ` +
            `which is worse than the ${LicenseRanking.describe(current)} license this installation already holds` +
            `${candidate.message ? ` (${candidate.message})` : ""}. ` +
            "Activating it would have left this installation with less than it has now, " +
            "so nothing was changed and the installed license was kept.",
        );
      }

      await LicenseClient.store(update, inputs);
      return;
    }

    const guarded: GuardedLicenseUpdate = LicenseRanking.guardUpdate({
      inputs,
      update,
      now,
    });

    await LicenseClient.store(guarded.update, inputs);

    if (guarded.downgrade) {
      throw new BadDataException(
        LicenseRanking.describeDowngrade(guarded.downgrade),
      );
    }
  }

  /*
   * Refreshes the license this installation already holds, with the key it
   * already holds. Deliberately takes no key: a refresh that accepted one
   * would be an activation with a friendlier name, and would let a mistyped
   * key replace a working license by accident.
   */
  public static async refreshStoredLicense(): Promise<void> {
    const inputs: LicenseInputs = await LicenseStore.loadLicenseInputs(
      new Date(),
    );

    if (!inputs.licenseKey) {
      throw new BadDataException(
        LicenseInputsUtil.isOfflineActivated(inputs)
          ? "This installation was activated offline with a license token, so there is no license key to refresh from OneUptime. Paste a new license token to replace it."
          : "This installation does not have an enterprise license key yet. Enter a license key to activate it first.",
      );
    }

    await LicenseClient.validateWithLicenseServer({
      licenseKey: inputs.licenseKey,
      mode: "refresh",
    });
  }

  /*
   * Offline activation: a signed license token pasted by a master admin, for
   * an installation that cannot reach oneuptime.com.
   *
   * Only a VERIFIED token is accepted - one signed by a key this build
   * trusts. An unverifiable token would turn this form into a license
   * forger, so it is refused outright rather than treated as a legacy
   * license.
   *
   * And only a token bound to THIS instance (an instanceId claim equal to
   * this installation's id). A token bound to another instance is refused,
   * and so is a verified token bound to none: that is the token oneuptime.com
   * hands an ONLINE installation (LicenseSigner.signOnlineToken), which GET
   * /global-config/license shows its master admins. Accepted here, one online
   * license could be pasted into any number of air-gapped installs, none of
   * which ever reports its usage. Offline tokens are issued per instance
   * (EnterpriseLicenseOfflineTokenAPI) and always carry the claim.
   *
   * The installation is then marked as offline-activated by holding the token
   * but no license key: it has nothing to call home with, so the daily usage
   * report and the boot refresh skip it.
   */
  public static async activateOffline(pastedToken: unknown): Promise<void> {
    const token: string = LicenseClient.normalizePastedToken(pastedToken);

    if (!token) {
      throw new BadDataException("License token is required.");
    }

    const now: Date = new Date();
    const inputs: LicenseInputs = await LicenseStore.loadLicenseInputs(now);
    const instanceId: ObjectID = inputs.instanceId
      ? new ObjectID(inputs.instanceId)
      : ObjectID.generate();

    const candidate: LicenseTokenClassification = LicenseInputsUtil.classify(
      {
        ...inputs,
        instanceId: instanceId.toString(),
        token,
        licenseKey: null,
      },
      now,
    );

    if (
      candidate.reason === "malformed" ||
      candidate.reason === "unsupported-algorithm"
    ) {
      throw new BadDataException(
        `This is not a OneUptime license token: ${candidate.message || "it could not be read"}`,
      );
    }

    if (candidate.reason === "instance-mismatch") {
      throw await LicenseClient.instanceBindingRefusal({
        inputs,
        instanceId,
        message: `This license token is bound to a different OneUptime instance${
          candidate.instanceId ? ` (${candidate.instanceId})` : ""
        }. This installation's instance id is ${instanceId.toString()}: ask OneUptime for a token issued for it.`,
      });
    }

    if (candidate.verification !== "verified") {
      throw new BadDataException(
        "This build does not trust the key that signed this token, so it cannot be activated offline. " +
          "Activate online with your license key instead, or upgrade OneUptime to a release that trusts the key.",
      );
    }

    if (candidate.status === "invalid") {
      throw new BadDataException(
        `This license token is not valid: ${candidate.message || "it could not be verified"}.`,
      );
    }

    /*
     * Verified, but bound to no instance: an online installation's token (see
     * above). Checked after the signature, so a tampered token is still
     * reported as not valid, and before the expiry, because a renewed online
     * token would be refused all the same.
     */
    if (!candidate.instanceId) {
      throw await LicenseClient.instanceBindingRefusal({
        inputs,
        instanceId,
        message:
          "This license token is not bound to a OneUptime instance, so it cannot be activated offline: " +
          "it is the token an installation that activates online receives. " +
          `This installation's instance id is ${instanceId.toString()}: ask OneUptime for an offline license token issued for it, ` +
          "or activate online with your license key.",
      });
    }

    if (candidate.status === "expired") {
      throw new BadDataException(
        `This license token expired${
          candidate.expiresAt ? ` on ${candidate.expiresAt.toISOString()}` : ""
        } and its grace period is over. Ask OneUptime for a renewed token.`,
      );
    }

    const update: PartialEntity<GlobalConfig> = {
      enterpriseLicenseToken: token,
      enterpriseLicenseKey: null,
      // Mirrors of the signed claims, for anything that reads the columns.
      enterpriseCompanyName: candidate.companyName || null,
      enterpriseLicenseExpiresAt: candidate.expiresAt || null,
      enterpriseLicenseUserLimit: candidate.userLimit,
      enterpriseLicenseIsEvaluation: candidate.isEvaluation,
      /*
       * Usage figures come from oneuptime.com's daily report, which an offline
       * installation never gets: clear the last online ones rather than
       * enforce seats against a stale license-wide count forever.
       */
      enterpriseLicenseCurrentUserCount: null,
      enterpriseLicenseUserCountUpdatedAt: null,
      enterpriseLicenseInstances: [],
    };

    if (!inputs.instanceId) {
      update.instanceId = instanceId;
    }

    await LicenseClient.store(update, inputs);
  }

  /*
   * At boot, an online installation whose stored token cannot be verified
   * (every license issued before signed licenses) asks oneuptime.com for a
   * fresh one - which, once the license server signs, is a verified token.
   * Runs in the background: the boot never waits on the network.
   *
   * Only while this build trusts at least one signing key. Before the key
   * ceremony no answer can be verified, so every pod of every installation
   * would call home on every boot for nothing; the daily usage report still
   * keeps the license terms current. After it, the first successful refresh
   * stores a verified token and later boots skip this again.
   *
   * Returns the started refresh (for tests), or null when none was needed.
   */
  public static startBootRefreshIfUnverified(
    inputs: LicenseInputs | null,
  ): Promise<void> | null {
    if (IsBillingEnabled || !inputs || !inputs.licenseKey || !inputs.token) {
      return null;
    }

    if (getTrustedLicenseKeys().length === 0) {
      return null;
    }

    const classification: LicenseTokenClassification =
      LicenseInputsUtil.classify(inputs, new Date());

    if (classification.verification !== "unverified") {
      return null;
    }

    return LicenseClient.refreshStoredLicense().catch((err: unknown): void => {
      logger.warn(
        `OneUptime Enterprise Edition: could not refresh the unverified license at boot; keeping the stored one. ${describeError(err)}`,
      );
    });
  }

  /*
   * The refusal for an offline token bound to another instance, or to none.
   * The message names this installation's instance id, the id to ask
   * OneUptime for a token for. An installation that predates instance ids has
   * none stored, and the one generated for this request would be forgotten
   * with it, so it is kept first (only the id, as root, as the first
   * activation would have kept it): the id quoted is then the id a token must
   * carry. Nothing about the license changes.
   */
  private static async instanceBindingRefusal(data: {
    inputs: LicenseInputs;
    instanceId: ObjectID;
    message: string;
  }): Promise<BadDataException> {
    if (!data.inputs.instanceId) {
      await LicenseStore.writeLicenseColumns({
        update: { instanceId: data.instanceId },
        rowExists: data.inputs.hasConfigRow,
      });
    }

    return new BadDataException(data.message);
  }

  private static async store(
    update: PartialEntity<GlobalConfig>,
    inputs: LicenseInputs,
  ): Promise<void> {
    await LicenseStore.writeLicenseColumns({
      update,
      rowExists: inputs.hasConfigRow,
    });

    await licenseProvider.refresh();
  }
}
