import GlobalConfigService, {
  Service as GlobalConfigServiceType,
} from "../Services/GlobalConfigService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import Select from "../Types/Database/Select";
import { AppVersion, DisableUpdateCheck } from "../EnvironmentConfig";
import EnterpriseLicenseInstanceSummary from "../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import VersionUtil from "../../Utils/VersionUtil";
import UserMiddleware from "../Middleware/UserAuthorization";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseSnapshotUtil,
  SeatUsage,
} from "../Enterprise/EnterpriseLicenseSnapshot";

/*
 * Who is asking for the license state, which decides how much of it they get.
 *
 *   master-admin  everything, including the license key, the token, the
 *                 instance topology, this installation's version and seat
 *                 usage - the things a master admin needs to manage the
 *                 license and nobody else has any business reading.
 *   public        anybody else, signed in or not (this route also serves the
 *                 signed-out login page): only what the edition pill shows.
 */
export type LicenseResponseAudience = "master-admin" | "public";

export interface BuildLicenseResponseData {
  audience: LicenseResponseAudience;
  // Whether the enterprise module is loaded in this process.
  isEnterpriseEditionLoaded: boolean;
  // The license snapshot, or null on the Community Edition.
  snapshot: EnterpriseLicenseSnapshot | null;
  /*
   * The GlobalConfig row, selected with LICENSE_RESPONSE_CONFIG_SELECT. Only
   * read for the master-admin audience.
   */
  config: GlobalConfig | null;
  // Seat usage as the license client enforces it. Only for master admins.
  seatUsage: SeatUsage | null;
}

// Everything buildLicenseResponse reads off the GlobalConfig row.
export const LICENSE_RESPONSE_CONFIG_SELECT: Select<GlobalConfig> = {
  enterpriseLicenseKey: true,
  enterpriseLicenseToken: true,
  enterpriseLicenseCurrentUserCount: true,
  enterpriseLicenseUserCountUpdatedAt: true,
  enterpriseLicenseInstances: true,
  instanceId: true,
  latestReleaseVersion: true,
  latestReleasePublishedAt: true,
  latestReleaseCheckedAt: true,
};

export default class GlobalConfigAPI extends BaseAPI<
  GlobalConfig,
  GlobalConfigServiceType
> {
  public constructor() {
    super(GlobalConfig, GlobalConfigService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/vars`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const globalConfig: GlobalConfig | null =
            await GlobalConfigService.findOneById({
              id: ObjectID.getZeroObjectID(),
              select: {
                disableUserProjectCreation: true,
              },
              props: {
                isRoot: true,
              },
            });

          return Response.sendJsonObjectResponse(req, res, {
            disableUserProjectCreation: Boolean(
              globalConfig?.disableUserProjectCreation,
            ),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * The license state of this installation, for the edition pill and the
     * license dialog.
     *
     * This route stays in core so the Community Edition can still serve the
     * version and update-check half of the dialog. The license half comes
     * from the Enterprise license client through EnterpriseEdition; activating
     * and refreshing a license (the POSTs on this path) are served by the
     * Enterprise module itself (ee/Server/License).
     *
     * This route also serves the login page (before sign-in), so it cannot
     * require authentication outright. Anybody but a master admin gets only
     * what the edition pill shows - see buildLicenseResponse.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/license`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          /*
           * This route also serves the login page, so a caller with no session
           * normally gets the reduced anonymous payload below. Unless it says
           * it is signed in (the dashboards do): then no session means an
           * expired one, and the anonymous payload would read as "unlicensed".
           * Answer 401 so the client refreshes and asks again.
           */
          if (
            req.query["signedIn"] === "true" &&
            UserMiddleware.isAnonymousRequest(req as OneUptimeRequest)
          ) {
            throw new NotAuthenticatedException(
              UserMiddleware.AUTHENTICATION_REQUIRED_MESSAGE,
            );
          }

          const audience: LicenseResponseAudience =
            GlobalConfigAPI.getLicenseResponseAudience(req);
          const isEnterpriseEditionLoaded: boolean =
            EnterpriseEdition.isLoaded();

          const snapshot: EnterpriseLicenseSnapshot | null =
            isEnterpriseEditionLoaded
              ? await EnterpriseEdition.getLicenseSnapshot()
              : null;

          /*
           * Only a master admin's response carries anything read from the row
           * or derived from the live User table, so nobody else costs a read.
           */
          const config: GlobalConfig | null =
            audience === "master-admin"
              ? await GlobalConfigService.findOneById({
                  id: ObjectID.getZeroObjectID(),
                  select: LICENSE_RESPONSE_CONFIG_SELECT,
                  props: {
                    isRoot: true,
                  },
                })
              : null;

          const seatUsage: SeatUsage | null =
            audience === "master-admin" && isEnterpriseEditionLoaded
              ? await EnterpriseEdition.getSeatUsage()
              : null;

          return Response.sendJsonObjectResponse(
            req,
            res,
            GlobalConfigAPI.buildLicenseResponse({
              audience,
              isEnterpriseEditionLoaded,
              snapshot,
              config,
              seatUsage,
            }),
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * A master admin is recognised from the verified access token that
   * UserMiddleware.getUserMiddleware decoded. Anything else - no token, an
   * API key, a status-page user, a signed-in project member - is "public".
   */
  public static getLicenseResponseAudience(
    req: ExpressRequest,
  ): LicenseResponseAudience {
    return (req as OneUptimeRequest).userAuthorization?.isMasterAdmin === true
      ? "master-admin"
      : "public";
  }

  /*
   * The body of GET /global-config/license, and of the Enterprise license
   * client's activation and refresh responses, so the three can never
   * disagree on a field.
   *
   * licenseValid is true for a valid license AND one in its grace period:
   * grace means nothing has changed yet, and the dialog must not tell an
   * administrator the license is gone while everything still works.
   */
  public static buildLicenseResponse(
    data: BuildLicenseResponseData,
  ): JSONObject {
    const snapshot: EnterpriseLicenseSnapshot | null =
      data.isEnterpriseEditionLoaded ? data.snapshot : null;

    const publicFields: JSONObject = {
      edition: data.isEnterpriseEditionLoaded ? "enterprise" : "community",
      status: snapshot ? snapshot.status : null,
      verification: snapshot ? snapshot.verification : null,
      graceReason: snapshot?.graceReason || null,
      licenseValid: EnterpriseLicenseSnapshotUtil.isUsable(snapshot),
      companyName: snapshot?.companyName || null,
      expiresAt: GlobalConfigAPI.toIsoString(snapshot?.expiresAt),
      graceEndsAt: GlobalConfigAPI.toIsoString(snapshot?.graceEndsAt),
      isEvaluation: Boolean(snapshot?.isEvaluation),
      // The name older dialogs read; same value as isEvaluation.
      isEvaluationLicense: Boolean(snapshot?.isEvaluation),
    };

    if (data.audience !== "master-admin") {
      return publicFields;
    }

    const config: GlobalConfig | null = data.config;

    /*
     * The license columns mean nothing on the Community Edition (a leftover
     * key from an earlier Enterprise image licenses nothing here), so only
     * the version half of the dialog is filled in there.
     */
    const licenseConfig: GlobalConfig | null = snapshot ? config : null;

    const licenseToken: string | null =
      licenseConfig?.enterpriseLicenseToken || null;
    const licenseKey: string | null =
      licenseConfig?.enterpriseLicenseKey || null;

    return {
      ...publicFields,
      message: snapshot?.message || null,
      licenseKey: licenseKey,
      token: licenseToken,
      /*
       * "offline" when the license was activated by pasting a signed token:
       * such an installation holds no license key and never calls home.
       */
      activationMode: licenseToken ? (licenseKey ? "online" : "offline") : null,
      // From the signed claims for a verified license, else the stored column.
      userLimit:
        typeof snapshot?.userLimit === "number" ? snapshot.userLimit : null,
      currentUserCount:
        typeof licenseConfig?.enterpriseLicenseCurrentUserCount === "number"
          ? licenseConfig.enterpriseLicenseCurrentUserCount
          : null,
      userCountUpdatedAt: GlobalConfigAPI.toIsoString(
        licenseConfig?.enterpriseLicenseUserCountUpdatedAt,
      ),
      instances: Array.isArray(licenseConfig?.enterpriseLicenseInstances)
        ? (licenseConfig?.enterpriseLicenseInstances as Array<EnterpriseLicenseInstanceSummary>)
        : [],
      instanceId: licenseConfig?.instanceId
        ? licenseConfig.instanceId.toString()
        : null,
      /*
       * Which build this installation runs, and whether a newer one has been
       * released. Master admins only: telling anybody else that this server
       * is behind on patches advertises an unpatched target.
       */
      currentVersion: AppVersion,
      latestVersion: config?.latestReleaseVersion || null,
      latestVersionPublishedAt: GlobalConfigAPI.toIsoString(
        config?.latestReleasePublishedAt,
      ),
      latestVersionCheckedAt: GlobalConfigAPI.toIsoString(
        config?.latestReleaseCheckedAt,
      ),
      isUpdateAvailable: VersionUtil.isUpdateAvailable({
        currentVersion: AppVersion,
        latestVersion: config?.latestReleaseVersion,
      }),
      /*
       * Lets the dialog say "update checks are off" instead of "has not
       * checked yet", which would be a promise the installation is never
       * going to keep.
       */
      isUpdateCheckDisabled: DisableUpdateCheck,
      ...GlobalConfigAPI.getSeatUsageResponseFields(
        snapshot ? data.seatUsage : null,
      ),
    };
  }

  /*
   * The seat-enforcement half of a license response. Always the same keys, so
   * a client never has to tell "this build does not report seats" apart from
   * "this installation does not enforce them" by which fields are missing:
   * isSeatLimitEnforced is the single flag that answers that.
   */
  public static getSeatUsageResponseFields(
    seatUsage: SeatUsage | null,
  ): JSONObject {
    if (!seatUsage || !seatUsage.isEnforced) {
      return {
        isSeatLimitEnforced: false,
        seatsInUse: null,
        seatsRemaining: null,
        canAddMoreUsers: true,
      };
    }

    return {
      isSeatLimitEnforced: true,
      seatsInUse: seatUsage.seatsInUse,
      seatsRemaining: seatUsage.seatsRemaining,
      canAddMoreUsers: seatUsage.hasSeatForNewUser,
    };
  }

  private static toIsoString(value: Date | null | undefined): string | null {
    if (!value) {
      return null;
    }

    const date: Date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  }
}
