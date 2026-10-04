import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseService from "../Services/DatabaseService";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Query from "../Types/Database/Query";
import Select from "../Types/Database/Select";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import CustomDomainVerification, {
  CustomDomainVerificationResult,
} from "../../Types/CustomDomain/CustomDomainVerification";
import CustomDomainCertificates, {
  CustomDomainCertificate,
} from "../../Types/CustomDomain/CustomDomainCertificates";

/*
 * What the two routes need of a custom domain service beyond its table: a
 * status page's (StatusPageDomainService) or a dashboard's
 * (DashboardDomainService). Written as methods, so each service's own
 * model type is accepted here.
 */
export interface CustomDomainRouteService {
  isCnameValid(fullDomain: string): Promise<boolean>;
  orderCertOnceCnameIsVerified(
    domain: BaseModel,
  ): Promise<CustomDomainVerificationResult>;
  getCertificates(
    domains: Array<BaseModel>,
  ): Promise<Array<CustomDomainCertificate>>;
}

// What the routes read of a custom domain's row.
interface CustomDomainRow {
  fullDomain?: string | undefined;
}

/*
 * The routes a Custom Domains page calls that the two kinds of custom domain
 * share word for word - Check now and the Status column's certificates -
 * registered once for both APIs, so the next fix to one is the fix to both.
 * They used to be two copies, and the dashboard copy kept a Check now that
 * only checked after the status page one learned to order.
 */
export default class CustomDomainRoutes {
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
          const cnameRecord: string = data.getCnameRecord();

          if (!cnameRecord) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Custom Domains not enabled for this OneUptime installation. Please contact your server admin to enable this feature.",
              ),
            );
          }

          const idParameter: string = (req.params["id"] as string) || "";

          // A malformed id is the caller's mistake, not a server error.
          if (!ObjectID.isValidUUID(idParameter)) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("The domain ID is not valid."),
            );
          }

          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const id: ObjectID = new ObjectID(idParameter);

          // Whether the caller may read the domain, with their own props.
          const domainCount: PositiveNumber = await service.countBy({
            query: {
              _id: id.toString(),
            } as Query<BaseModel>,
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

          const domain: BaseModel | null = await service.findOneBy({
            query: {
              _id: id.toString(),
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
                `We could not find a CNAME record for ${fullDomain} that points to ${cnameRecord} yet. Please check the record at your DNS provider. A new record can take a while to show up, and we keep checking every 15 minutes.`,
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
