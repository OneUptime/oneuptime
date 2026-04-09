import UserMiddleware from "../Middleware/UserAuthorization";
import DashboardService, {
  Service as DashboardServiceType,
} from "../Services/DashboardService";
import DashboardDomainService from "../Services/DashboardDomainService";
import CookieUtil from "../Utils/Cookie";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";
import Dashboard from "../../Models/DatabaseModels/Dashboard";
import DashboardDomain from "../../Models/DatabaseModels/DashboardDomain";
import { EncryptionSecret } from "../EnvironmentConfig";
import { DASHBOARD_MASTER_PASSWORD_INVALID_MESSAGE } from "../../Types/Dashboard/MasterPassword";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import JSONFunctions from "../../Types/JSONFunctions";

export default class DashboardAPI extends BaseAPI<
  Dashboard,
  DashboardServiceType
> {
  public constructor() {
    super(Dashboard, DashboardService);

    // SEO endpoint - resolve dashboard by ID or domain
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/seo/:dashboardIdOrDomain`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const dashboardIdOrDomain: string = req.params[
            "dashboardIdOrDomain"
          ] as string;

          let dashboardId: ObjectID | null = null;

          if (dashboardIdOrDomain && dashboardIdOrDomain.includes(".")) {
            // This is a domain - resolve to dashboard ID
            const dashboardDomain: DashboardDomain | null =
              await DashboardDomainService.findOneBy({
                query: {
                  fullDomain: dashboardIdOrDomain,
                  domain: {
                    isVerified: true,
                  } as any,
                },
                select: {
                  dashboardId: true,
                },
                props: {
                  isRoot: true,
                },
              });

            if (!dashboardDomain || !dashboardDomain.dashboardId) {
              return Response.sendErrorResponse(
                req,
                res,
                new NotFoundException("Dashboard not found"),
              );
            }

            dashboardId = dashboardDomain.dashboardId;
          } else {
            try {
              dashboardId = new ObjectID(dashboardIdOrDomain);
            } catch (err) {
              logger.error(
                err,
                getLogAttributesFromRequest(req as OneUptimeRequest),
              );
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException("Invalid dashboard ID"),
              );
            }
          }

          const dashboard: Dashboard | null =
            await DashboardService.findOneById({
              id: dashboardId,
              select: {
                _id: true,
                name: true,
                description: true,
                pageTitle: true,
                pageDescription: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotFoundException("Dashboard not found"),
            );
          }

          return Response.sendJsonObjectResponse(req, res, {
            _id: dashboard._id?.toString() || "",
            title: dashboard.pageTitle || dashboard.name || "Dashboard",
            description:
              dashboard.pageDescription ||
              dashboard.description ||
              "View dashboard metrics and insights.",
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // Domain resolution endpoint
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/domain`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!req.body["domain"]) {
            throw new BadDataException("domain is required in request body");
          }

          const domain: string = req.body["domain"] as string;

          const dashboardDomain: DashboardDomain | null =
            await DashboardDomainService.findOneBy({
              query: {
                fullDomain: domain,
                domain: {
                  isVerified: true,
                } as any,
              },
              select: {
                dashboardId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboardDomain) {
            throw new BadDataException("No dashboard found with this domain");
          }

          const objectId: ObjectID = dashboardDomain.dashboardId!;

          return Response.sendJsonObjectResponse(req, res, {
            dashboardId: objectId.toString(),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // Metadata endpoint - returns dashboard info for the public viewer
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/metadata/:dashboardId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const dashboardId: ObjectID = new ObjectID(
            req.params["dashboardId"] as string,
          );

          const dashboard: Dashboard | null =
            await DashboardService.findOneById({
              id: dashboardId,
              select: {
                _id: true,
                name: true,
                description: true,
                isPublicDashboard: true,
                enableMasterPassword: true,
                pageTitle: true,
                pageDescription: true,
                logoFile: {
                  file: true,
                  fileType: true,
                },
                faviconFile: {
                  file: true,
                  fileType: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard) {
            throw new NotFoundException("Dashboard not found");
          }

          return Response.sendJsonObjectResponse(req, res, {
            _id: dashboard._id?.toString() || "",
            name: dashboard.name || "Dashboard",
            description: dashboard.description || "",
            isPublicDashboard: dashboard.isPublicDashboard || false,
            enableMasterPassword: dashboard.enableMasterPassword || false,
            pageTitle: dashboard.pageTitle || "",
            pageDescription: dashboard.pageDescription || "",
            logoFile: DashboardAPI.getFileAsBase64JSONObject(
              dashboard.logoFile,
            ),
            faviconFile: DashboardAPI.getFileAsBase64JSONObject(
              dashboard.faviconFile,
            ),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // Public view-config endpoint - returns dashboard view config for the public viewer
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/view-config/:dashboardId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const dashboardId: ObjectID = new ObjectID(
            req.params["dashboardId"] as string,
          );

          // Check read access (handles public check, IP whitelist, master password)
          const accessResult: {
            hasReadAccess: boolean;
            error?: NotAuthenticatedException | ForbiddenException;
          } = await DashboardService.hasReadAccess({
            dashboardId,
            req,
          });

          if (!accessResult.hasReadAccess) {
            throw (
              accessResult.error ||
              new BadDataException("Access denied to this dashboard.")
            );
          }

          const dashboard: Dashboard | null =
            await DashboardService.findOneById({
              id: dashboardId,
              select: {
                _id: true,
                name: true,
                description: true,
                dashboardViewConfig: true,
                pageTitle: true,
                pageDescription: true,
                logoFile: {
                  file: true,
                  fileType: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard) {
            throw new NotFoundException("Dashboard not found");
          }

          return Response.sendJsonObjectResponse(req, res, {
            _id: dashboard._id?.toString() || "",
            name: dashboard.name || "Dashboard",
            description: dashboard.description || "",
            pageTitle: dashboard.pageTitle || "",
            pageDescription: dashboard.pageDescription || "",
            logoFile: DashboardAPI.getFileAsBase64JSONObject(
              dashboard.logoFile,
            ),
            dashboardViewConfig: dashboard.dashboardViewConfig
              ? JSONFunctions.serialize(dashboard.dashboardViewConfig as any)
              : null,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/master-password/:dashboardId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!req.params["dashboardId"]) {
            throw new BadDataException("Dashboard ID not found");
          }

          const dashboardId: ObjectID = new ObjectID(
            req.params["dashboardId"] as string,
          );

          const password: string | undefined =
            req.body && (req.body["password"] as string);

          if (!password) {
            throw new BadDataException("Master password is required.");
          }

          const dashboard: Dashboard | null =
            await DashboardService.findOneById({
              id: dashboardId,
              select: {
                _id: true,
                projectId: true,
                enableMasterPassword: true,
                masterPassword: true,
                isPublicDashboard: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard) {
            throw new NotFoundException("Dashboard not found");
          }

          if (!dashboard.isPublicDashboard) {
            throw new BadDataException(
              "This dashboard is not publicly accessible.",
            );
          }

          if (!dashboard.enableMasterPassword || !dashboard.masterPassword) {
            throw new BadDataException(
              "Master password has not been configured for this dashboard.",
            );
          }

          const hashedInput: string = await HashedString.hashValue(
            password,
            EncryptionSecret,
          );

          if (hashedInput !== dashboard.masterPassword.toString()) {
            throw new BadDataException(
              DASHBOARD_MASTER_PASSWORD_INVALID_MESSAGE,
            );
          }

          CookieUtil.setDashboardMasterPasswordCookie({
            expressResponse: res,
            dashboardId,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private static getFileAsBase64JSONObject(
    file: any,
  ): { file: string; fileType: string } | null {
    if (!file || !file.file) {
      return null;
    }

    let base64: string;
    const fileBuffer: any = file.file;

    if (Buffer.isBuffer(fileBuffer)) {
      base64 = fileBuffer.toString("base64");
    } else if (
      fileBuffer &&
      typeof fileBuffer === "object" &&
      fileBuffer.value &&
      fileBuffer.value.data
    ) {
      base64 = Buffer.from(fileBuffer.value.data).toString("base64");
    } else if (typeof fileBuffer === "string") {
      base64 = fileBuffer;
    } else {
      return null;
    }

    return {
      file: base64,
      fileType: (file.fileType as string) || "image/png",
    };
  }
}
