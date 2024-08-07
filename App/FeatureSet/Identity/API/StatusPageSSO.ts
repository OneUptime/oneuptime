import SSOUtil from "../Utils/SSO";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSsoService from "Common/Server/Services/StatusPageSsoService";
import CookieUtil from "Common/Server/Utils/Cookie";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageSSO from "Common/Models/DatabaseModels/StatusPageSso";
import xml2js from "xml2js";

const router: ExpressRouter = Express.getRouter();

router.get(
  "/status-page-sso/:statusPageId/:statusPageSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.params["statusPageId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Status Page ID not found"),
        );
      }

      if (!req.params["statusPageSsoId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Status Page SSO ID not found"),
        );
      }

      const statusPageId: ObjectID = new ObjectID(req.params["statusPageId"]);

      const statusPageSSO: StatusPageSSO | null =
        await StatusPageSsoService.findOneBy({
          query: {
            statusPageId: statusPageId,
            _id: req.params["statusPageSsoId"],
            isEnabled: true,
          },
          select: {
            signOnURL: true,
            statusPageId: true,
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!statusPageSSO) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SSO Config not found"),
        );
      }

      // redirect to Identity Provider.

      if (!statusPageSSO.signOnURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Sign On URL not found"),
        );
      }

      const samlRequestUrl: URL = SSOUtil.createSAMLRequestUrl({
        acsUrl: URL.fromString(
          `${HttpProtocol}${Host}/identity/status-page-idp-login/${statusPageSSO.statusPageId?.toString()}/${statusPageSSO.id?.toString()}`,
        ),
        signOnUrl: statusPageSSO.signOnURL!,
        issuerUrl: URL.fromString(
          `${HttpProtocol}${Host}/${statusPageSSO.statusPageId?.toString()}/${statusPageSSO.id?.toString()}`,
        ),
      });

      return Response.redirect(req, res, samlRequestUrl);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/status-page-idp-login/:statusPageId/:statusPageSsoId",
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      const samlResponseBase64: string = req.body.SAMLResponse;

      const samlResponse: string = Buffer.from(
        samlResponseBase64,
        "base64",
      ).toString();

      const response: JSONObject =
        await xml2js.parseStringPromise(samlResponse);

      let issuerUrl: string = "";
      let email: Email | null = null;

      if (!req.params["statusPageId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Status Page ID not found"),
        );
      }

      if (!req.params["statusPageSsoId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Status Page SSO ID not found"),
        );
      }

      const statusPageId: ObjectID = new ObjectID(req.params["statusPageId"]);

      const statusPageSSO: StatusPageSSO | null =
        await StatusPageSsoService.findOneBy({
          query: {
            statusPageId: statusPageId,
            _id: req.params["statusPageSsoId"],
            isEnabled: true,
          },
          select: {
            signOnURL: true,
            issuerURL: true,
            publicCertificate: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!statusPageSSO) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SSO Config not found"),
        );
      }

      if (!statusPageSSO.projectId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SSO Config Project ID not found"),
        );
      }

      const projectId: ObjectID = statusPageSSO.projectId;

      // redirect to Identity Provider.

      if (!statusPageSSO.issuerURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Issuer URL not found"),
        );
      }

      // redirect to Identity Provider.

      if (!statusPageSSO.signOnURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Sign on URL not found"),
        );
      }

      if (!statusPageSSO.publicCertificate) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Public Certificate not found"),
        );
      }

      try {
        SSOUtil.isPayloadValid(response);

        if (
          !SSOUtil.isSignatureValid(
            samlResponse,
            statusPageSSO.publicCertificate,
          )
        ) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Signature is not valid"),
          );
        }

        issuerUrl = SSOUtil.getIssuer(response);

        email = SSOUtil.getEmail(response);
      } catch (err: unknown) {
        if (err instanceof Exception) {
          return Response.sendErrorResponse(req, res, err);
        }
        return Response.sendErrorResponse(req, res, new ServerException());
      }

      if (statusPageSSO.issuerURL.toString() !== issuerUrl) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Issuer URL does not match"),
        );
      }

      // Check if he already belongs to the project, If he does - then log in.

      let alreadySavedUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: { email: email, statusPageId: statusPageId },
          select: {
            _id: true,
            email: true,
            statusPageId: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!alreadySavedUser) {
        /// Create a user.

        alreadySavedUser = new StatusPagePrivateUser();
        alreadySavedUser.projectId = projectId;
        alreadySavedUser.statusPageId = statusPageId;
        alreadySavedUser.email = email;
        alreadySavedUser.password = new HashedString(
          ObjectID.generate().toString(),
        );
        alreadySavedUser.isSsoUser = true;

        alreadySavedUser = await StatusPagePrivateUserService.create({
          data: alreadySavedUser,
          props: { isRoot: true },
        });
      }

      const token: string = JSONWebToken.sign({
        data: alreadySavedUser,
        expiresInSeconds: OneUptimeDate.getSecondsInDays(
          new PositiveNumber(30),
        ),
      });

      CookieUtil.setCookie(
        res,
        CookieUtil.getUserTokenKey(alreadySavedUser.statusPageId!),
        token,
        {
          httpOnly: true,
          maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
        },
      );

      // get status page URL.
      const statusPageURL: string =
        await StatusPageService.getStatusPageFirstURL(statusPageId);

      return Response.redirect(
        req,
        res,
        URL.fromString(statusPageURL).addQueryParams({
          token: token,
        }),
      );
    } catch (err) {
      logger.error(err);
      Response.sendErrorResponse(req, res, new ServerException());
    }
  },
);

export default router;
