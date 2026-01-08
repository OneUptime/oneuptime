import MailService from "../Services/MailService";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
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
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/test",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body;

      const smtpConfigId: ObjectID = new ObjectID(
        body["smtpConfigId"] as string,
      );

      const config: ProjectSmtpConfig | null =
        await ProjectSMTPConfigService.findOneById({
          id: smtpConfigId,
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
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
            tenantId: true,
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

      // Get auth type, default to UsernamePassword for backward compatibility
      const authType: SMTPAuthenticationType =
        (config.authType as SMTPAuthenticationType) ||
        SMTPAuthenticationType.UsernamePassword;

      const mailServer: EmailServer = {
        id: config.id!,
        host: config.hostname!,
        port: config.port!,
        username: config.username,
        password: config.password,
        fromEmail: config.fromEmail!,
        fromName: config.fromName!,
        secure: Boolean(config.secure),
        authType: authType,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tenantId: config.tenantId,
      };

      try {
        await MailService.send(mail, {
          emailServer: mailServer,
          projectId: config.projectId!,
          timeout: 4000,
        });
      } catch (err) {
        logger.error(err);

        // Provide more specific error messages based on auth type
        if (authType === SMTPAuthenticationType.OAuth) {
          throw new BadDataException(
            "Cannot send email with OAuth authentication. Please verify: 1) Your Client ID, Client Secret, and Tenant ID are correct, 2) The application has SMTP.SendAsApp permission in Microsoft Entra, 3) Admin consent has been granted, 4) The service principal is registered in Exchange Online. Error: " +
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
