import UserMiddleware from "../Middleware/UserAuthorization";
import DomainService, {
  Service as DomainServiceType,
} from "../Services/DomainService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CustomDomainDnsCheck from "../Utils/CustomDomain/CustomDomainDnsCheck";
import DomainType from "../Types/Domain";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import Domain from "../../Models/DatabaseModels/Domain";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
  isDnsRecordFound,
  normalizeDnsName,
} from "../../Types/CustomDomain/DnsRecordCheck";
import CustomDomainDnsCheckResultJSON from "../../Types/CustomDomain/CustomDomainDnsCheckResult";

/*
 * A project's domains (Project Settings -> Domains): the CRUD routes of
 * /domain, and the TXT check that verifies one.
 *
 * Verifying a domain used to be an update that set isVerified, refused with
 * "Verification TXT record ... not found" when the record was not there -
 * and nothing about what was there. check-txt answers what it looked up and
 * what came back (a DnsRecordCheck) either way, and verifies the domain
 * when its record is found. The Add Custom Domain dialog of a status page,
 * a dashboard or a form calls it, so a domain is verified without leaving
 * the page; the update still verifies one, as before.
 */

export const DOMAIN_NOT_VERIFIABLE_MESSAGE: string =
  "The domain does not exist, or you do not have permission to verify it.";

export default class DomainAPI extends BaseAPI<Domain, DomainServiceType> {
  public constructor() {
    super(Domain, DomainService);

    /*
     * Verifying a domain is an update of it, so it takes what an update
     * takes (findOneUpdatableById): Edit Project Domain, or a role with it.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/check-txt/:id`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const idParameter: string = (req.params["id"] as string) || "";

          if (!ObjectID.isValidUUID(idParameter)) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("The domain ID is not valid."),
            );
          }

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          let domain: Domain | null = null;

          try {
            domain = await DomainService.findOneUpdatableById({
              id: new ObjectID(idParameter),
              select: {
                _id: true,
                domain: true,
                domainVerificationText: true,
                isVerified: true,
              },
              props: props,
            });
          } catch (err) {
            if (
              err instanceof NotAuthorizedException ||
              err instanceof NotAuthenticatedException
            ) {
              return Response.sendErrorResponse(req, res, err);
            }

            throw err;
          }

          const name: string = domain?.domain?.toString() || "";
          const verificationText: string =
            domain?.domainVerificationText?.toString() || "";

          if (!domain || !name) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(DOMAIN_NOT_VERIFIABLE_MESSAGE),
            );
          }

          /*
           * Verified already, or a reserved test domain that can have no
           * record (DomainService verifies those without DNS too): found,
           * with nothing to look up.
           */
          if (domain.isVerified || DomainType.isTestDomain(name)) {
            if (!domain.isVerified) {
              await DomainAPI.markVerified(domain.id!);
            }

            return Response.sendJsonObjectResponse(
              req,
              res,
              CustomDomainDnsCheckResultJSON.toJSON({
                isVerified: true,
                records: [
                  {
                    type: DnsRecordType.TXT,
                    name: normalizeDnsName(name),
                    expectedValue: verificationText,
                    foundValues: verificationText ? [verificationText] : [],
                    outcome: DnsRecordCheckOutcome.Found,
                    checkedAt: OneUptimeDate.getCurrentDate(),
                  },
                ],
              }),
            );
          }

          if (!verificationText) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This domain has no verification text. Delete it and add it again.",
              ),
            );
          }

          const check: DnsRecordCheck = await CustomDomainDnsCheck.checkTxt({
            domain: name,
            expectedValue: verificationText,
          });

          const isVerified: boolean = isDnsRecordFound(check);

          if (isVerified) {
            await DomainAPI.markVerified(domain.id!);
          }

          return Response.sendJsonObjectResponse(
            req,
            res,
            CustomDomainDnsCheckResultJSON.toJSON({
              isVerified: isVerified,
              records: [check],
            }),
          );
        } catch (e) {
          next(e);
        }
      },
    );
  }

  /*
   * As root: the caller's right to verify it was checked above, and its
   * record was just found - the update's own TXT check would look again.
   */
  private static async markVerified(domainId: ObjectID): Promise<void> {
    await DomainService.updateOneById({
      id: domainId,
      data: {
        isVerified: true,
      },
      props: {
        isRoot: true,
      },
    });
  }
}
