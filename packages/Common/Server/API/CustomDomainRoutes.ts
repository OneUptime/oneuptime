import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseService from "../Services/DatabaseService";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import ModelPermission from "../Types/Database/Permissions/Index";
import CertificateOrder, {
  CertificateOrderOutcome,
} from "../Utils/Greenlock/CertificateOrder";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Query from "../Types/Database/Query";
import Select from "../Types/Database/Select";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import CustomDomainVerification, {
  CustomDomainVerificationResult,
} from "../../Types/CustomDomain/CustomDomainVerification";
import CustomDomainCertificates, {
  CustomDomainCertificate,
} from "../../Types/CustomDomain/CustomDomainCertificates";

/*
 * What the routes need of a custom domain service beyond its table: a status
 * page's (StatusPageDomainService) or a dashboard's (DashboardDomainService).
 * Written as methods, so each service's own model type is accepted here.
 */
export interface CustomDomainRouteService {
  isCnameValid(fullDomain: string): Promise<boolean>;
  orderCertOnceCnameIsVerified(
    domain: BaseModel,
  ): Promise<CustomDomainVerificationResult>;
  orderCertIfMissing(
    domain: BaseModel,
    options?: { onDemand?: boolean | undefined },
  ): Promise<CertificateOrderOutcome>;
  reissueCert(domainId: ObjectID): Promise<void>;
  getCertificates(
    domains: Array<BaseModel>,
  ): Promise<Array<CustomDomainCertificate>>;
}

// What the routes read of a custom domain's row.
interface CustomDomainRow {
  fullDomain?: string | undefined;
  cnameVerificationToken?: string | undefined;
  isCnameVerified?: boolean | undefined;
  isSslProvisioned?: boolean | undefined;
  isCustomCertificate?: boolean | undefined;
}

export const CUSTOM_DOMAINS_NOT_ENABLED_MESSAGE: string =
  "Custom Domains not enabled for this OneUptime installation. Please contact your server admin to enable this feature.";

/*
 * A domain the caller may not change - one that does not exist, one in
 * another project, one outside the status pages or dashboards the caller may
 * edit - gets this one answer, so the routes never say which of those it is.
 */
export const DOMAIN_NOT_CHANGEABLE_MESSAGE: string =
  "The domain does not exist, or you do not have permission to change it.";

/*
 * The routes a Custom Domains page calls that the two kinds of custom domain
 * share word for word - Check now, Order SSL, Reissue SSL and the Status
 * column's certificates - registered once for both APIs, so the next fix to
 * one is the fix to both. They used to be two copies, and the dashboard copy
 * kept a Check now that only checked after the status page one learned to
 * order.
 */
export default class CustomDomainRoutes {
  /*
   * Check now, Order SSL and Reissue SSL change a domain: they verify its
   * record, order or replace its certificate, and write down what came of
   * it. So they take what editing the domain takes, asked the way an update
   * of the domain asks it: one of the domain table's update permissions in
   * the caller's project, no team block on them, and the domain inside the
   * caller's update scope (the labels and the Owned scope of its status page
   * or dashboard). Reading the domain is not enough. Whoever may only read
   * it - a Viewer, a read-only API key - sees its status and the record to
   * add, and the 15-minute checks verify it and order its certificate on
   * their own.
   *
   * Answers null when the caller may change the domain, or the refusal to
   * send: what the update itself would refuse with when the caller may not
   * update this kind of domain at all (no credentials is a 401), and
   * DOMAIN_NOT_CHANGEABLE_MESSAGE when they may, but not this domain.
   */
  public static async getChangeRefusal(data: {
    service: DatabaseService<BaseModel>;
    domainId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Exception | null> {
    const service: DatabaseService<BaseModel> = data.service;

    let changeableQuery: Query<BaseModel>;

    try {
      // The team block list, and the table's update permissions.
      await ModelPermission.checkUpdatePermissionByModel({
        modelType: service.modelType,
        fetchModelWithAccessControlIds: async (): Promise<BaseModel | null> => {
          return await service.findOneById({
            id: data.domainId,
            select: {
              _id: true,
            } as Select<BaseModel>,
            props: {
              isRoot: true,
            },
          });
        },
        props: data.props,
      });

      // The caller's project, labels and Owned scope, as a query.
      changeableQuery = await ModelPermission.checkUpdateQueryPermissions(
        service.modelType,
        {
          _id: data.domainId.toString(),
        } as Query<BaseModel>,
        {},
        data.props,
      );
    } catch (err) {
      if (
        err instanceof NotAuthorizedException ||
        err instanceof NotAuthenticatedException
      ) {
        return err;
      }

      // A domain that is gone by the time the block list asks for it.
      if (err instanceof BadDataException) {
        return new BadDataException(DOMAIN_NOT_CHANGEABLE_MESSAGE);
      }

      throw err;
    }

    const changeableCount: PositiveNumber = await service.countBy({
      query: changeableQuery,
      props: {
        isRoot: true,
      },
    });

    if (changeableCount.toNumber() === 0) {
      return new BadDataException(DOMAIN_NOT_CHANGEABLE_MESSAGE);
    }

    return null;
  }

  public static add(data: {
    router: ExpressRouter;
    // The domain table's API path: "/status-page-domain", "/dashboard-domain".
    crudApiPath: string;
    service: DatabaseService<BaseModel> & CustomDomainRouteService;
    /*
     * What each domain's CNAME record must point to on this installation,
     * read on every request. Empty where custom domains of this kind are off.
     */
    getCnameRecord: () => string;
    // The column - and route parameter - naming the status page or dashboard.
    parentColumn: string;
  }): void {
    const service: DatabaseService<BaseModel> & CustomDomainRouteService =
      data.service;

    /*
     * What every route that changes a domain asks first, in this order:
     * custom domains are on, the id is one, and the caller may change the
     * domain (getChangeRefusal). Answers the domain's id, or null once the
     * refusal has been sent.
     */
    const getDomainIdCallerMayChange: (
      req: ExpressRequest,
      res: ExpressResponse,
    ) => Promise<ObjectID | null> = async (
      req: ExpressRequest,
      res: ExpressResponse,
    ): Promise<ObjectID | null> => {
      if (!data.getCnameRecord()) {
        Response.sendErrorResponse(
          req,
          res,
          new BadDataException(CUSTOM_DOMAINS_NOT_ENABLED_MESSAGE),
        );
        return null;
      }

      const idParameter: string = (req.params["id"] as string) || "";

      // A malformed id is the caller's mistake, not a server error.
      if (!ObjectID.isValidUUID(idParameter)) {
        Response.sendErrorResponse(
          req,
          res,
          new BadDataException("The domain ID is not valid."),
        );
        return null;
      }

      const domainId: ObjectID = new ObjectID(idParameter);

      const refusal: Exception | null =
        await CustomDomainRoutes.getChangeRefusal({
          service: service,
          domainId: domainId,
          props: await CommonAPI.getDatabaseCommonInteractionProps(req),
        });

      if (refusal) {
        Response.sendErrorResponse(req, res, refusal);
        return null;
      }

      return domainId;
    };

    /*
     * CNAME verification: the domain's Check now button.
     *
     * The sweeps verify every domain every 15 minutes anyway; this is for the
     * person who has just added the record and wants to know now. Once the
     * record is found the domain's free certificate is ordered straight away
     * (the service's orderCertOnceCnameIsVerified), and the answer says what
     * happens to the certificate next.
     */
    data.router.get(
      `${data.crudApiPath}/verify-cname/:id`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const domainId: ObjectID | null = await getDomainIdCallerMayChange(
            req,
            res,
          );

          if (!domainId) {
            return;
          }

          const domain: BaseModel | null = await service.findOneBy({
            query: {
              _id: domainId.toString(),
            } as Query<BaseModel>,
            select: {
              _id: true,
              fullDomain: true,
              isCustomCertificate: true,
              isSslOrdered: true,
              // Whose on-demand orders the order counts against.
              projectId: true,
            } as Select<BaseModel>,
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

          const fullDomain: string | undefined = (
            domain as unknown as CustomDomainRow
          ).fullDomain;

          if (!fullDomain) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid domain."),
            );
          }

          const isValid: boolean = await service.isCnameValid(fullDomain);

          if (!isValid) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                `We could not find a CNAME record for ${fullDomain} that points to ${data.getCnameRecord()} yet. Please check the record at your DNS provider. A new record can take a while to show up, and we keep checking every 15 minutes.`,
              ),
            );
          }

          const result: CustomDomainVerificationResult =
            await service.orderCertOnceCnameIsVerified(domain);

          return Response.sendJsonObjectResponse(
            req,
            res,
            CustomDomainVerification.toJSON(result),
          );
        } catch (e) {
          next(e);
        }
      },
    );

    /*
     * Order SSL. The dashboard has no button for this: a domain's
     * certificate is ordered as soon as its CNAME is verified, by Check now
     * or by the sweeps. It stays for API callers, and orders the way
     * everything else does, through orderCertIfMissing - a domain that has
     * its certificate already, or has one being ordered right now, is not
     * ordered twice - and never for a domain on an uploaded certificate.
     *
     * It shares Check now's window: one order on demand per domain per 15
     * minutes, whichever of the two placed it. An order that fails leaves the
     * domain unordered, so without it a script calling this in a loop placed
     * an order on every call, against the account the whole installation
     * shares.
     */
    data.router.get(
      `${data.crudApiPath}/order-ssl/:id`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const domainId: ObjectID | null = await getDomainIdCallerMayChange(
            req,
            res,
          );

          if (!domainId) {
            return;
          }

          const domain: BaseModel | null = await service.findOneBy({
            query: {
              _id: domainId.toString(),
            } as Query<BaseModel>,
            select: {
              _id: true,
              fullDomain: true,
              cnameVerificationToken: true,
              isCnameVerified: true,
              isSslProvisioned: true,
              isCustomCertificate: true,
              // Whose on-demand orders the order counts against.
              projectId: true,
            } as Select<BaseModel>,
            props: {
              isRoot: true,
            },
          });

          const row: CustomDomainRow | null =
            domain as unknown as CustomDomainRow | null;

          if (!domain || !row || !row.cnameVerificationToken) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid token."),
            );
          }

          if (!row.isCnameVerified) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "CNAME is not verified. Please verify CNAME first before you provision SSL.",
              ),
            );
          }

          if (row.isSslProvisioned) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("SSL is already provisioned."),
            );
          }

          // The sweeps never order for one either: it serves the upload.
          if (row.isCustomCertificate) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This domain uses a certificate you uploaded, so there is no free SSL certificate to order for it.",
              ),
            );
          }

          const fullDomain: string | undefined = row.fullDomain;

          if (!fullDomain) {
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
              domain: fullDomain,
              order: () => {
                return service.orderCertIfMissing(domain, {
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
            "SSL Provisioned for domain - " + fullDomain,
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );

          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
      },
    );

    /*
     * Reissue SSL. Backs the "Reissue SSL Certificate" button, for a customer
     * who wants a fresh certificate now rather than whenever the renewal cron
     * next gets to this domain.
     *
     * The throttle that keeps this from becoming a way to spend the shared
     * Let's Encrypt allowance lives in the service, alongside the write that
     * claims it - a check here would be a check the automated callers do not
     * share, and one an extra caller could forget.
     */
    data.router.get(
      `${data.crudApiPath}/reissue-ssl/:id`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const domainId: ObjectID | null = await getDomainIdCallerMayChange(
            req,
            res,
          );

          if (!domainId) {
            return;
          }

          logger.debug(
            "Reissuing SSL",
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );

          await service.reissueCert(domainId);

          logger.debug(
            "SSL reissued for domain id - " + domainId.toString(),
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );

          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
      },
    );

    /*
     * Where the certificates of a status page's or a dashboard's custom
     * domains stand, for the Custom Domains page's Status column: each
     * domain's certificate expiry, and why its last order failed while no
     * order since has succeeded (CustomDomainCertificates). Neither is on the
     * domain row, so without this an order that kept failing showed as
     * "Issuing" for good.
     *
     * Reads only: the domains are looked up with the caller's own props, so
     * a caller sees the domains they may read and nothing else.
     */
    data.router.get(
      `${data.crudApiPath}/certificates/:${data.parentColumn}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const parentParameter: string =
            (req.params[data.parentColumn] as string) || "";

          if (!ObjectID.isValidUUID(parentParameter)) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("The ID is not valid."),
            );
          }

          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const domains: Array<BaseModel> = await service.findBy({
            query: {
              [data.parentColumn]: new ObjectID(parentParameter),
            } as Query<BaseModel>,
            select: {
              _id: true,
              fullDomain: true,
            } as Select<BaseModel>,
            limit: LIMIT_MAX,
            skip: 0,
            props: databaseProps,
          });

          const certificates: Array<CustomDomainCertificate> =
            await service.getCertificates(domains);

          return Response.sendJsonObjectResponse(
            req,
            res,
            CustomDomainCertificates.toJSON(certificates),
          );
        } catch (e) {
          next(e);
        }
      },
    );
  }
}
