import { StatusPageCNameRecord } from "../EnvironmentConfig";
import UserMiddleware from "../Middleware/UserAuthorization";
import StatusPageDomainService, {
  Service as StatusPageDomainServiceType,
} from "../Services/StatusPageDomainService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
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
import StatusPageDomain from "../../Models/DatabaseModels/StatusPageDomain";
import CertificateOrder from "../Utils/Greenlock/CertificateOrder";
import CustomDomainRoutes from "./CustomDomainRoutes";

export default class StatusPageDomainAPI extends BaseAPI<
  StatusPageDomain,
  StatusPageDomainServiceType
> {
  public constructor() {
    super(StatusPageDomain, StatusPageDomainService);

    /*
     * Check now (verify-cname) and the Status column's certificates: the
     * same routes as a dashboard's custom domains, registered once for both
     * (CustomDomainRoutes).
     */
    CustomDomainRoutes.add({
      router: this.router,
      crudApiPath: new this.entityType().getCrudApiPath()?.toString() || "",
      service: StatusPageDomainService,
      getCnameRecord: (): string => {
        return StatusPageCNameRecord;
      },
      parentColumn: "statusPageId",
    });

    /*
     * Order SSL. The dashboard no longer has a button for this: a domain's
     * certificate is ordered as soon as its CNAME is verified. It stays for
     * API callers, and orders the way everything else does, through
     * orderCertIfMissing: a domain that has its certificate already, or has
     * one being ordered right now, is not ordered twice.
     *
     * It shares Check now's window: one order on demand per domain per 15
     * minutes, whichever of the two placed it. An order that fails leaves the
     * domain unordered, so without it a script calling this in a loop placed
     * an order on every call - against the account the whole installation
     * shares, and Let's Encrypt's five failed validations per name per hour.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/order-ssl/:id`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!StatusPageCNameRecord) {
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

          // check if the user can read the domain.

          const domainCount: PositiveNumber =
            await StatusPageDomainService.countBy({
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

          const domain: StatusPageDomain | null =
            await StatusPageDomainService.findOneBy({
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

          logger.debug("Ordering SSL", getLogAttributesFromRequest(req as any));

          try {
            await CertificateOrder.orderOnDemand({
              domain: domain.fullDomain,
              order: () => {
                return StatusPageDomainService.orderCertIfMissing(domain, {
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
            getLogAttributesFromRequest(req as any),
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
          if (!StatusPageCNameRecord) {
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
            await StatusPageDomainService.countBy({
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
            getLogAttributesFromRequest(req as any),
          );

          await StatusPageDomainService.reissueCert(id);

          logger.debug(
            "SSL reissued for domain id - " + id.toString(),
            getLogAttributesFromRequest(req as any),
          );

          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
      },
    );
  }
}
