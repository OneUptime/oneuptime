import { DashboardCNameRecord } from "../EnvironmentConfig";
import UserMiddleware from "../Middleware/UserAuthorization";
import DashboardDomainService, {
  Service as DashboardDomainServiceType,
} from "../Services/DashboardDomainService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import DashboardDomain from "../../Models/DatabaseModels/DashboardDomain";
import CertificateOrder from "../Utils/Greenlock/CertificateOrder";

export default class DashboardDomainAPI extends BaseAPI<
  DashboardDomain,
  DashboardDomainServiceType
> {
  public constructor() {
    super(DashboardDomain, DashboardDomainService);

    // CNAME verification api
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/verify-cname/:id`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!DashboardCNameRecord) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                `Custom Domains not enabled for this
                                OneUptime installation. Please contact
                                your server admin to enable this
                                feature.`,
              ),
            );
          }

          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const id: ObjectID = new ObjectID(req.params["id"] as string);

          const domainCount: PositiveNumber =
            await DashboardDomainService.countBy({
              query: {
                _id: id.toString(),
              },
              props: databaseProps,
            });

          if (domainCount.toNumber() === 0) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "The domain does not exist or user does not have access to it.",
              ),
            );
          }

          const domain: DashboardDomain | null =
            await DashboardDomainService.findOneBy({
              query: {
                _id: id.toString(),
              },
              select: {
                _id: true,
                fullDomain: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!domain) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid token."),
            );
          }

          if (!domain.fullDomain) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid domain."),
            );
          }

          const isValid: boolean = await DashboardDomainService.isCnameValid(
            domain.fullDomain!,
          );

          if (!isValid) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "CNAME is not verified. Please make sure you have the correct record and please verify CNAME again. If you are sure that the record is correct, please wait for some time for the DNS to propagate.",
              ),
            );
          }

          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
      },
    );

    /*
     * Order SSL: the Custom Domains page's Order Free SSL. It orders the way
     * the sweeps do, through orderCertIfMissing - a domain that has its
     * certificate already, or has one being ordered right now, is not
     * ordered twice - and never for a domain on an uploaded certificate.
     *
     * One order on demand per domain per 15 minutes (the window Check now
     * uses for status page domains): an order that fails leaves the domain
     * unordered, so every click on a failing domain - or a script calling
     * this in a loop - placed another order against the account the whole
     * installation shares.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/order-ssl/:id`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!DashboardCNameRecord) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                `Custom Domains not enabled for this
                                OneUptime installation. Please contact
                                your server admin to enable this
                                feature.`,
              ),
            );
          }

          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const id: ObjectID = new ObjectID(req.params["id"] as string);

          const domainCount: PositiveNumber =
            await DashboardDomainService.countBy({
              query: {
                _id: id.toString(),
              },
              props: databaseProps,
            });

          if (domainCount.toNumber() === 0) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "The domain does not exist or user does not have access to it.",
              ),
            );
          }

          const domain: DashboardDomain | null =
            await DashboardDomainService.findOneBy({
              query: {
                _id: id.toString(),
              },
              select: {
                _id: true,
                fullDomain: true,
                cnameVerificationToken: true,
                isCnameVerified: true,
                isSslProvisioned: true,
                isCustomCertificate: true,
                // Whose on-demand orders the order counts against.
                projectId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!domain) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid token."),
            );
          }

          if (!domain.cnameVerificationToken) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid token."),
            );
          }

          if (!domain.isCnameVerified) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "CNAME is not verified. Please verify CNAME first before you provision SSL.",
              ),
            );
          }

          if (domain.isSslProvisioned) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("SSL is already provisioned."),
            );
          }

          // The sweeps never order for one either: it serves the upload.
          if (domain.isCustomCertificate) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This domain uses a certificate you uploaded, so there is no free SSL certificate to order for it.",
              ),
            );
          }

          if (!domain.fullDomain) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid domain."),
            );
          }

          logger.debug(
            "Ordering SSL",
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );

          try {
            await CertificateOrder.orderOnDemand({
              domain: domain.fullDomain,
              order: () => {
                return DashboardDomainService.orderCertIfMissing(domain, {
                  onDemand: true,
                });
              },
            });
          } catch (err) {
            // Too soon, or nothing ordered: the order's own failures go on.
            if (err instanceof TooManyRequestsException) {
              return Response.sendErrorResponse(req, res, err);
            }

            throw err;
          }

          logger.debug(
            "SSL Provisioned for domain - " + domain.fullDomain,
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );

          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
      },
    );

    /*
     * Reissue SSL API. Backs the "Reissue SSL Certificate" button in the
     * dashboard, for a customer who wants a fresh certificate now rather than
     * whenever the renewal cron next gets to this domain.
     *
     * The throttle that keeps this from becoming a way to spend the shared
     * Let's Encrypt allowance lives in the service, alongside the write that
     * claims it - a check here would be a check the automated callers do not
     * share, and one an extra caller could forget.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/reissue-ssl/:id`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!DashboardCNameRecord) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                `Custom Domains not enabled for this
                                OneUptime installation. Please contact
                                your server admin to enable this
                                feature.`,
              ),
            );
          }

          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const id: ObjectID = new ObjectID(req.params["id"] as string);

          /*
           * Scoped by the caller's own props, so a domain in someone else's
           * project is indistinguishable from one that does not exist.
           */
          const domainCount: PositiveNumber =
            await DashboardDomainService.countBy({
              query: {
                _id: id.toString(),
              },
              props: databaseProps,
            });

          if (domainCount.toNumber() === 0) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "The domain does not exist or user does not have access to it.",
              ),
            );
          }

          logger.debug(
            "Reissuing SSL",
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );

          await DashboardDomainService.reissueCert(id);

          logger.debug(
            "SSL reissued for domain id - " + id.toString(),
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );

          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
      },
    );
  }
}
