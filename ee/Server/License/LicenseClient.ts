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
   *             ("invalid" - a bad signature, another instance's license),
   *             in which case nothing is stored and the error says why.
   *   refresh   the never-downgrade rule: a returned license that classifies
   *             worse than the installed one is refused, the installed one is
   *             kept (the usage figures are still updated), and the error says
   *             so - the administrator pressed the button for a reason.
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
      const candidate: LicenseTokenClassification = LicenseInputsUtil.classify(
        LicenseInputsUtil.withUpdate(inputs, update),
        now,
      );

      if (candidate.status === "invalid") {
        throw new BadDataException(
          `OneUptime returned a license this installation cannot use: ${candidate.message || "it is not valid"}. Nothing was changed.`,
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
   * license. A token bound to another instance is refused too.
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
      throw new BadDataException(
        `This license token is bound to a different OneUptime instance${
          candidate.instanceId ? ` (${candidate.instanceId})` : ""
        }. This installation's instance id is ${instanceId.toString()}: ask OneUptime for a token issued for it.`,
      );
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
   * Returns the started refresh (for tests), or null when none was needed.
   */
  public static startBootRefreshIfUnverified(
    inputs: LicenseInputs | null,
  ): Promise<void> | null {
    if (IsBillingEnabled || !inputs || !inputs.licenseKey || !inputs.token) {
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
