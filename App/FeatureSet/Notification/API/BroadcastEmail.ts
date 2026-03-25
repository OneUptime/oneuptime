import MailService from "../Services/MailService";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import UserService from "Common/Server/Services/UserService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import User from "Common/Models/DatabaseModels/User";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/send-test",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body;

      const subject: string = body["subject"] as string;
      const message: string = body["message"] as string;
      const testEmail: string = body["testEmail"] as string;

      if (!subject) {
        throw new BadDataException("Subject is required");
      }

      if (!message) {
        throw new BadDataException("Message is required");
      }

      if (!testEmail) {
        throw new BadDataException("Test email address is required");
      }

      const htmlMessage: string = await Markdown.convertToHTML(
        message,
        MarkdownContentType.Email,
      );

      const mail: EmailMessage = {
        templateType: EmailTemplateType.SimpleMessage,
        toEmail: new Email(testEmail),
        subject: subject,
        vars: {
          subject: subject,
          message: htmlMessage,
        },
        body: "",
      };

      await MailService.send(mail);

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/send-to-all-users",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body;

      const subject: string = body["subject"] as string;
      const message: string = body["message"] as string;

      if (!subject) {
        throw new BadDataException("Subject is required");
      }

      if (!message) {
        throw new BadDataException("Message is required");
      }

      const users: Array<User> = await UserService.findAllBy({
        query: {},
        select: {
          email: true,
        },
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const htmlMessage: string = await Markdown.convertToHTML(
        message,
        MarkdownContentType.Email,
      );

      let sentCount: number = 0;
      let errorCount: number = 0;

      for (const user of users) {
        if (!user.email) {
          continue;
        }

        try {
          const mail: EmailMessage = {
            templateType: EmailTemplateType.SimpleMessage,
            toEmail: user.email,
            subject: subject,
            vars: {
              subject: subject,
              message: htmlMessage,
            },
            body: "",
          };

          await MailService.send(mail);
          sentCount++;
        } catch (err) {
          errorCount++;
          logger.error(
            `Failed to send broadcast email to ${user.email.toString()}: ${err}`,
          );
        }
      }

      return Response.sendJsonObjectResponse(req, res, {
        totalUsers: users.length,
        sentCount: sentCount,
        errorCount: errorCount,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
