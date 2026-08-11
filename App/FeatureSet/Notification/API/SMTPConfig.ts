import MailService from "../Services/MailService";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailTransportType from "Common/Types/Email/MailTransportType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import CommonAPI from "Common/Server/API/CommonAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/test",
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body;

      const smtpConfigId: ObjectID = new ObjectID(
        body["smtpConfigId"] as string,
      );

      /*
       * The lookup below runs as root so it can read the SMTP secrets, which
       * means the id in the body is otherwise honoured whoever it belongs to:
       * any authenticated user could name another project's config id and have
       * the server connect to that project's mail server (and, with a
       * hostile-but-valid config, learn whether it works). Establish which
       * project the caller is authorized for first, then confirm the config
       * they named is actually in it.
       */
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      const config: ProjectSmtpConfig | null =
        await ProjectSMTPConfigService.findOneById({
          id: smtpConfigId,
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            transportType: true,
            hostname: true,
            port: true,
            username: true,
            password: true,
            fromEmail: true,
            fromName: true,
            secure: true,
            projectId: true,
            authType: true,
            clientId: true,
            clientSecret: true,
            tokenUrl: true,
            scope: true,
            oauthProviderType: true,
          },
        });

      if (!config) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "smtp-config not found for id" + smtpConfigId.toString(),
          ),
        );
      }

      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: config.projectId,
        projectId: projectId,
      });

      const toEmail: Email = new Email(body["toEmail"] as string);

      if (!toEmail) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("toEmail is required"),
        );
      }

      const mail: EmailMessage = {
        templateType: EmailTemplateType.SMTPTest,
        toEmail: new Email(body["toEmail"] as string),
        subject: "Test Email from OneUptime",
        vars: {},
        body: "",
      };

      /*
       * Delegate validation + conversion to the shared service so the test
       * path always matches the runtime path.
       */
      const mailServer: EmailServer | undefined =
        ProjectSMTPConfigService.toEmailServer(config);

      if (!mailServer) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "smtp-config could not be converted to mail server config",
          ),
        );
      }

      const transportType: MailTransportType =
        mailServer.transportType || MailTransportType.SMTP;
      const authType: SMTPAuthenticationType =
        mailServer.authType || SMTPAuthenticationType.UsernamePassword;

      try {
        await MailService.send(mail, {
          emailServer: mailServer,
          projectId: config.projectId!,
          timeout: 4000,
        });
      } catch (err) {
        logger.error(err, getLogAttributesFromRequest(req as RequestLike));

        /*
         * Microsoft Graph errors already include actionable text from the
         * provider — just pass them through.
         */
        if (transportType === MailTransportType.MicrosoftGraph) {
          throw new BadDataException(
            "Microsoft Graph send failed: " +
              (err instanceof Error ? err.message : String(err)),
          );
        }

        if (authType === SMTPAuthenticationType.OAuth) {
          throw new BadDataException(
            "Cannot send email with OAuth authentication. Please verify: 1) Your Client ID, Client Secret, Token URL, and Scope are correct, 2) Your OAuth application has the required permissions, 3) Admin consent has been granted if required by your provider. If your Microsoft 365 tenant has SMTP AUTH disabled, switch Transport to 'Microsoft Graph' instead. Error: " +
              (err instanceof Error ? err.message : String(err)),
          );
        }

        throw new BadDataException(
          "Cannot send email. Please check your SMTP config. If you are using Google or Gmail, please dont since it does not support machine access to their mail servers. If you are still having issues, please uncheck SSL/TLS toggle and try again. We recommend using SendGrid or Mailgun or any large volume mail provider for SMTP.",
        );
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
