import MailService from "../Services/MailService";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailTransportType, {
  isApiKeyMailTransport,
  toMailTransportType,
} from "Common/Types/Email/MailTransportType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import { PROJECT_SMTP_CONFIG_SEND_SELECT } from "Common/Server/Utils/Mail/ProjectSmtpConfigSelect";
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
import TestSendAccess, {
  TestSendCaller,
} from "Common/Server/API/TestSendAccess";
import AmazonSesProjectRole, {
  AmazonSesRoleSignInError,
} from "Common/Server/Utils/Mail/AmazonSesProjectRole";
import DatabaseRequestType from "Common/Server/Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "Common/Server/Types/Database/Permissions/BillingPermission";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { AmazonSesRoleSetup } from "Common/Types/Email/AmazonSesRoleSetup";

/*
 * A project's SMTP configs, beside their CRUD routes:
 *
 *   POST /smtp-config/test { smtpConfigId, toEmail }
 *     sends a test email through a saved config. An Amazon SES config that
 *     signs in with an IAM role in the project's own AWS account (#7378)
 *     has its role checked afresh first, and what the check finds holds for
 *     every server's emails at once.
 *
 *   GET /smtp-config/aws-role-setup
 *     -> AmazonSesRoleSetup: whether this OneUptime can sign in to an IAM
 *        role, the principal the role must trust, this project's email
 *        external id and the trust policy to copy - what the config's
 *        Amazon SES step shows. For whoever may create the project's SMTP
 *        configs, team blocks counted, on the plan they are sold on.
 */

const router: ExpressRouter = Express.getRouter();

// What a member who may not create SMTP configs is told by the role setup.
export const AMAZON_SES_ROLE_SETUP_PERMISSION_MESSAGE: string =
  "You do not have permission to create SMTP configs in this project.";

router.get(
  "/aws-role-setup",
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      BillingPermissions.checkFeatureIsOnPlan(
        ProjectSmtpConfig,
        props,
        DatabaseRequestType.Create,
      );

      CommonAPI.assertCanCreateTable({
        modelType: ProjectSmtpConfig,
        props: props,
        errorMessage: AMAZON_SES_ROLE_SETUP_PERMISSION_MESSAGE,
      });

      // The project the request is signed in to, never one it names.
      const setup: AmazonSesRoleSetup = await AmazonSesProjectRole.getRoleSetup(
        {
          projectId: projectId.toString(),
        },
      );

      return Response.sendJsonObjectResponse(
        req,
        res,
        setup as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

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
       * "Send Test Email" sends through the project's own mail server, so it
       * asks what every test send asks (TestSendAccess), before anything is
       * read: a signed-in member, on a credential that may make changes, on
       * the plan custom SMTP is sold on, who could add an SMTP config - team
       * blocks counted - and a config they may read, in their own project.
       * One of another project and one that does not exist are answered
       * alike.
       */
      const caller: TestSendCaller = await TestSendAccess.assertMaySendTest({
        req: req,
        modelType: ProjectSmtpConfig,
        record: {
          service: ProjectSMTPConfigService,
          id: smtpConfigId,
        },
      });

      // Read as OneUptime only now, for the secrets the send needs.
      const config: ProjectSmtpConfig | null =
        await ProjectSMTPConfigService.findOneById({
          id: smtpConfigId,
          props: {
            isRoot: true,
          },
          // Every column a send reads, for every transport, and the project.
          select: {
            ...PROJECT_SMTP_CONFIG_SEND_SELECT,
            projectId: true,
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
        projectId: caller.projectId,
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
        subject: `Test Email from ${ProductBrandingText.getProductName()}`,
        isSubjectLiteral: true,
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

      const transportType: MailTransportType = toMailTransportType(
        mailServer.transportType,
      );
      const authType: SMTPAuthenticationType =
        mailServer.authType || SMTPAuthenticationType.UsernamePassword;

      /*
       * An IAM role is checked afresh by a test (#7378): a trust policy fixed
       * a minute ago is sent through at once, on every server, and one found
       * taking any external id is sent through no more. Its session is kept
       * for the send below.
       */
      if (mailServer.awsRoleArn && mailServer.awsRoleProjectId) {
        try {
          await AmazonSesProjectRole.getSession({
            projectId: mailServer.awsRoleProjectId,
            configId: config.id!.toString(),
            roleArn: mailServer.awsRoleArn,
            region: mailServer.awsRegion || "",
            checksAfresh: true,
          });
        } catch (err) {
          if (err instanceof AmazonSesRoleSignInError) {
            throw new BadDataException(err.message);
          }

          throw err;
        }
      }

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

        /*
         * So do the HTTP API providers': each says what the provider said
         * and what to change, starting with the provider's name ("Amazon SES
         * needs a verified identity in us-east-1 for ..."), with no key in
         * it (HttpMailApi.scrub).
         */
        if (isApiKeyMailTransport(transportType)) {
          throw new BadDataException(
            err instanceof Error && err.message
              ? err.message
              : `${transportType} did not send the test email.`,
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
