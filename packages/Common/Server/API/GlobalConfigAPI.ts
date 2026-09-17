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
import BadDataException from "../../Types/Exception/BadDataException";
import API from "../../Utils/API";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import PartialEntity from "../../Types/Database/PartialEntity";
import {
  AppVersion,
  DisableUpdateCheck,
  EnterpriseLicenseValidationUrl,
  Host,
} from "../EnvironmentConfig";
import EnterpriseLicenseInstanceSummary from "../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import VersionUtil from "../../Utils/VersionUtil";
import UserMiddleware from "../Middleware/UserAuthorization";
import MasterAdminAuthorization from "../Middleware/MasterAdminAuthorization";
import EnterpriseLicenseSeatUtil from "../Utils/EnterpriseLicense/EnterpriseLicenseSeatUtil";
import { SeatUsage } from "../../Utils/EnterpriseLicense/EnterpriseLicenseSeats";
import UserService from "../Services/UserService";
import PositiveNumber from "../../Types/PositiveNumber";

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

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/license`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const config: GlobalConfig | null =
            await GlobalConfigService.findOneById({
              id: ObjectID.getZeroObjectID(),
              select: {
                enterpriseCompanyName: true,
                enterpriseLicenseExpiresAt: true,
                enterpriseLicenseKey: true,
                enterpriseLicenseToken: true,
                enterpriseLicenseIsEvaluation: true,
                enterpriseLicenseUserLimit: true,
                enterpriseLicenseCurrentUserCount: true,
                enterpriseLicenseUserCountUpdatedAt: true,
                enterpriseLicenseInstances: true,
                instanceId: true,
                latestReleaseVersion: true,
                latestReleasePublishedAt: true,
                latestReleaseCheckedAt: true,
              },
              props: {
                isRoot: true,
              },
            });

          /*
           * This route also serves the login page (before sign-in), so it
           * cannot require authentication outright. Anonymous callers only
           * get enough to render the edition pill — the license key, token
           * and instance topology require a signed-in user.
           */
          const isAuthenticatedUser: boolean = Boolean(
            (req as OneUptimeRequest).userAuthorization?.userId,
          );

          const licenseValid: boolean = Boolean(
            config?.enterpriseLicenseToken &&
              config?.enterpriseLicenseExpiresAt &&
              config.enterpriseLicenseExpiresAt.getTime() > Date.now(),
          );

          /*
           * What the seat limit actually means on this installation right now,
           * as opposed to what oneuptime.com last reported. Only for signed-in
           * callers: it is derived from the live User table, and an anonymous
           * visitor on the login page has no business being told how close this
           * server is to refusing new accounts.
           */
          const seatUsage: SeatUsage | null = isAuthenticatedUser
            ? await EnterpriseLicenseSeatUtil.getSeatUsageForLoadedGlobalConfig(
                {
                  config: config,
                  getLocalUserCount: GlobalConfigAPI.getLocalUserCount,
                },
              )
            : null;

          const responseBody: JSONObject = {
            companyName: config?.enterpriseCompanyName || null,
            expiresAt: config?.enterpriseLicenseExpiresAt
              ? config.enterpriseLicenseExpiresAt.toISOString()
              : null,
            licenseKey: isAuthenticatedUser
              ? config?.enterpriseLicenseKey || null
              : null,
            token: isAuthenticatedUser
              ? config?.enterpriseLicenseToken || null
              : null,
            licenseValid: licenseValid,
            /*
             * Whether this is an evaluation/testing license. Benign like the
             * company name and expiry, so it is not gated behind sign-in — the
             * edition modal shows the evaluation notice to anyone who opens it.
             */
            isEvaluationLicense: Boolean(config?.enterpriseLicenseIsEvaluation),
            userLimit:
              typeof config?.enterpriseLicenseUserLimit === "number"
                ? config.enterpriseLicenseUserLimit
                : null,
            currentUserCount:
              typeof config?.enterpriseLicenseCurrentUserCount === "number"
                ? config.enterpriseLicenseCurrentUserCount
                : null,
            userCountUpdatedAt: config?.enterpriseLicenseUserCountUpdatedAt
              ? config.enterpriseLicenseUserCountUpdatedAt.toISOString()
              : null,
            instances:
              isAuthenticatedUser &&
              Array.isArray(config?.enterpriseLicenseInstances)
                ? config.enterpriseLicenseInstances
                : [],
            instanceId:
              isAuthenticatedUser && config?.instanceId
                ? config.instanceId.toString()
                : null,
            /*
             * Which build this installation runs, and whether a newer one has
             * been released, are gated the same way as the instance topology:
             * telling an anonymous visitor on the login page that this server
             * is behind on patches advertises an unpatched target.
             */
            currentVersion: isAuthenticatedUser ? AppVersion : null,
            latestVersion: isAuthenticatedUser
              ? config?.latestReleaseVersion || null
              : null,
            latestVersionPublishedAt:
              isAuthenticatedUser && config?.latestReleasePublishedAt
                ? config.latestReleasePublishedAt.toISOString()
                : null,
            latestVersionCheckedAt:
              isAuthenticatedUser && config?.latestReleaseCheckedAt
                ? config.latestReleaseCheckedAt.toISOString()
                : null,
            isUpdateAvailable: isAuthenticatedUser
              ? VersionUtil.isUpdateAvailable({
                  currentVersion: AppVersion,
                  latestVersion: config?.latestReleaseVersion,
                })
              : false,
            /*
             * Lets the modal say "update checks are off" instead of "has not
             * checked yet", which would be a promise the installation is never
             * going to keep.
             */
            isUpdateCheckDisabled: isAuthenticatedUser
              ? DisableUpdateCheck
              : false,
            ...GlobalConfigAPI.getSeatUsageResponseFields(seatUsage),
          };

          return Response.sendJsonObjectResponse(req, res, responseBody);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Activating (or replacing) the license key for the whole installation.
     *
     * Master admin only. This writes the terms that bound how many users the
     * installation may have, so anyone who can reach it can change the seat
     * limit UserService now enforces. It used to run on
     * UserMiddleware.getUserMiddleware, which lets anonymous callers through
     * (it has to — the GET above serves the signed-out login page), so the
     * route was in practice unauthenticated.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/license`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const licenseKey: string =
            (req.body["licenseKey"] as string | undefined)?.trim() || "";

          if (!licenseKey) {
            throw new BadDataException("License key is required");
          }

          const responseBody: JSONObject =
            await this.validateAndStoreLicenseKey(licenseKey);

          return Response.sendJsonObjectResponse(req, res, responseBody);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Re-fetch the license this installation already holds.
     *
     * The seat limit and the expiry live on oneuptime.com and can change on
     * any day — a customer buys ten more seats at noon. The daily report job
     * picks that up eventually; this is the button an administrator presses
     * when "eventually" is not good enough, and it is the only way to apply a
     * change without re-typing the key.
     *
     * Deliberately takes no license key: it uses the stored one. A refresh
     * that accepted a key would be an activation with a friendlier name, and
     * would let a mistyped key replace a working license by accident.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/license/refresh`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const config: GlobalConfig | null =
            await GlobalConfigService.findOneById({
              id: ObjectID.getZeroObjectID(),
              select: {
                enterpriseLicenseKey: true,
              },
              props: {
                isRoot: true,
              },
            });

          const licenseKey: string = config?.enterpriseLicenseKey?.trim() || "";

          if (!licenseKey) {
            throw new BadDataException(
              "This installation does not have an enterprise license key yet. Enter a license key to activate it first.",
            );
          }

          const responseBody: JSONObject =
            await this.validateAndStoreLicenseKey(licenseKey);

          return Response.sendJsonObjectResponse(req, res, responseBody);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * Ask oneuptime.com what this license key is worth today, and mirror the
   * answer into GlobalConfig.
   *
   * Shared by activation and refresh so the two cannot drift: the whole point
   * of refresh is that it applies exactly what activation would have applied,
   * and a second hand-written copy of this mapping is how the seat limit came
   * to be dropped on the floor by the daily report job before.
   */
  private async validateAndStoreLicenseKey(
    licenseKey: string,
  ): Promise<JSONObject> {
    const globalConfigId: ObjectID = ObjectID.getZeroObjectID();

    const existingConfig: GlobalConfig | null =
      await GlobalConfigService.findOneById({
        id: globalConfigId,
        select: {
          _id: true,
          instanceId: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

    /*
     * Send this instance's id and host along with the key so the
     * license server registers this instance against the license and
     * it shows up in the instance list on all instances that share
     * the license.
     */
    const instanceId: ObjectID =
      existingConfig?.instanceId || ObjectID.generate();

    const validationResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: EnterpriseLicenseValidationUrl,
        data: {
          licenseKey,
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

    const payload: JSONObject = validationResponse.data as JSONObject;

    const companyNameRaw: string =
      (payload["companyName"] as string | undefined)?.trim() || "";
    const expiresAtRaw: string =
      (payload["expiresAt"] as string | undefined) || "";
    const licenseKeyRaw: string =
      (payload["licenseKey"] as string | undefined)?.trim() || licenseKey;
    const licenseToken: string = (payload["token"] as string | undefined) || "";

    let licenseExpiry: Date | undefined = undefined;
    if (expiresAtRaw) {
      const parsedDate: Date = new Date(expiresAtRaw);

      if (Number.isNaN(parsedDate.getTime())) {
        throw new BadDataException(
          "License expiration returned from server is invalid.",
        );
      }

      licenseExpiry = parsedDate;
    }

    const userLimitRaw: unknown = payload["userLimit"];
    const userLimit: number | null =
      typeof userLimitRaw === "number" && Number.isFinite(userLimitRaw)
        ? userLimitRaw
        : null;

    const currentUserCountRaw: unknown = payload["currentUserCount"];
    const currentUserCount: number | null =
      typeof currentUserCountRaw === "number" &&
      Number.isFinite(currentUserCountRaw)
        ? currentUserCountRaw
        : null;

    const userCountUpdatedAtRaw: string | undefined = payload[
      "userCountUpdatedAt"
    ] as string | undefined;
    let userCountUpdatedAt: Date | null = null;
    if (userCountUpdatedAtRaw) {
      const parsedReportedAt: Date = new Date(userCountUpdatedAtRaw);
      if (!Number.isNaN(parsedReportedAt.getTime())) {
        userCountUpdatedAt = parsedReportedAt;
      }
    }

    const isEvaluationLicense: boolean =
      payload["isEvaluationLicense"] === true;

    const instances: Array<EnterpriseLicenseInstanceSummary> = Array.isArray(
      payload["instances"],
    )
      ? (payload["instances"] as Array<EnterpriseLicenseInstanceSummary>)
      : [];

    const updatePayload: PartialEntity<GlobalConfig> = {
      enterpriseCompanyName: companyNameRaw || null,
      enterpriseLicenseKey: licenseKeyRaw || null,
      enterpriseLicenseExpiresAt: licenseExpiry || null,
      enterpriseLicenseToken: licenseToken || null,
      enterpriseLicenseIsEvaluation: isEvaluationLicense,
      enterpriseLicenseUserLimit: userLimit,
      enterpriseLicenseCurrentUserCount: currentUserCount,
      enterpriseLicenseUserCountUpdatedAt: userCountUpdatedAt,
      enterpriseLicenseInstances: instances,
    };

    if (!existingConfig?.instanceId) {
      // Installs that predate instance ids: persist the one we generated.
      updatePayload.instanceId = instanceId;
    }

    if (existingConfig) {
      await GlobalConfigService.updateOneById({
        id: globalConfigId,
        data: updatePayload,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    } else {
      const newConfig: GlobalConfig = new GlobalConfig();
      newConfig.id = globalConfigId;

      if (companyNameRaw) {
        newConfig.enterpriseCompanyName = companyNameRaw;
      }

      if (licenseKeyRaw) {
        newConfig.enterpriseLicenseKey = licenseKeyRaw;
      }

      if (licenseToken) {
        newConfig.enterpriseLicenseToken = licenseToken;
      }

      newConfig.enterpriseLicenseIsEvaluation = isEvaluationLicense;

      if (licenseExpiry) {
        newConfig.enterpriseLicenseExpiresAt = licenseExpiry;
      }

      if (userLimit !== null) {
        newConfig.enterpriseLicenseUserLimit = userLimit;
      }

      if (currentUserCount !== null) {
        newConfig.enterpriseLicenseCurrentUserCount = currentUserCount;
      }

      if (userCountUpdatedAt) {
        newConfig.enterpriseLicenseUserCountUpdatedAt = userCountUpdatedAt;
      }

      newConfig.enterpriseLicenseInstances = instances;
      newConfig.instanceId = instanceId;

      await GlobalConfigService.create({
        data: newConfig,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    }

    /*
     * Seat usage recomputed from what was just stored, so the dialog that
     * triggered this can show the new limit against the real user count
     * without a second round trip - and so an administrator who just bought
     * seats sees them land.
     */
    const seatUsage: SeatUsage | null =
      await GlobalConfigAPI.getSeatUsageForResponse({
        userLimit: userLimit,
        currentUserCount: currentUserCount,
        instances: instances,
        instanceId: instanceId,
      });

    return {
      companyName: companyNameRaw || null,
      expiresAt: licenseExpiry ? licenseExpiry.toISOString() : null,
      licenseKey: licenseKeyRaw || null,
      token: licenseToken || null,
      isEvaluationLicense: isEvaluationLicense,
      userLimit: userLimit,
      currentUserCount: currentUserCount,
      userCountUpdatedAt: userCountUpdatedAt
        ? userCountUpdatedAt.toISOString()
        : null,
      instances: instances,
      instanceId: instanceId.toString(),
      ...GlobalConfigAPI.getSeatUsageResponseFields(seatUsage),
    };
  }

  /*
   * Seat usage built from license terms held in memory rather than re-read
   * from the database. Used right after a write, where re-reading would race
   * the write it is describing.
   */
  private static async getSeatUsageForResponse(data: {
    userLimit: number | null;
    currentUserCount: number | null;
    instances: Array<EnterpriseLicenseInstanceSummary>;
    instanceId: ObjectID;
  }): Promise<SeatUsage | null> {
    const config: GlobalConfig = new GlobalConfig();
    config.instanceId = data.instanceId;
    config.enterpriseLicenseInstances = data.instances;

    if (data.userLimit !== null) {
      config.enterpriseLicenseUserLimit = data.userLimit;
    }

    if (data.currentUserCount !== null) {
      config.enterpriseLicenseCurrentUserCount = data.currentUserCount;
    }

    return EnterpriseLicenseSeatUtil.getSeatUsageForLoadedGlobalConfig({
      config: config,
      getLocalUserCount: GlobalConfigAPI.getLocalUserCount,
    });
  }

  /*
   * How many users exist on this installation right now. Deliberately the live
   * count rather than the last reported one: the number an administrator is
   * about to act on is the number that decides whether the next invitation
   * goes through.
   */
  private static async getLocalUserCount(): Promise<number> {
    const userCount: PositiveNumber = await UserService.countBy({
      query: {},
      props: {
        isRoot: true,
      },
    });

    return userCount.toNumber();
  }

  /*
   * The seat-enforcement half of a license response. Always the same keys, so
   * a client never has to tell "this build does not report seats" apart from
   * "this installation does not enforce them" by which fields are missing:
   * isSeatLimitEnforced is the single flag that answers that.
   */
  private static getSeatUsageResponseFields(
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
}
