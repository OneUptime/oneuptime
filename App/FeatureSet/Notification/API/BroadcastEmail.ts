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

const BATCH_SIZE: number = 100;

async function sendBroadcastEmailsInBackground(data: {
  subject: string;
  htmlMessage: string;
}): Promise<void> {
  let skip: number = 0;
  let sentCount: number = 0;
  let errorCount: number = 0;
  let totalUsers: number = 0;

  try {
    while (true) {
      const users: Array<User> = await UserService.findBy({
        query: {},
        select: {
          email: true,
        },
        skip: skip,
        limit: BATCH_SIZE,
        props: {
          isRoot: true,
        },
      });

      if (users.length === 0) {
        break;
      }

      totalUsers += users.length;

      for (const user of users) {
        if (!user.email) {
          continue;
        }

        try {
          const mail: EmailMessage = {
            templateType: EmailTemplateType.SimpleMessage,
            toEmail: user.email,
            subject: data.subject,
            vars: {
              subject: data.subject,
              message: data.htmlMessage,
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

      if (users.length < BATCH_SIZE) {
        break;
      }

      skip += users.length;
    }

    logger.info(
      `Broadcast email completed. Total users: ${totalUsers}, Sent: ${sentCount}, Errors: ${errorCount}`,
    );
  } catch (err) {
    logger.error(`Broadcast email background job failed: ${err}`);
  }
}

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

      const htmlMessage: string = await Markdown.convertToHTML(
        message,
        MarkdownContentType.Email,
      );

      /*
       * Send response immediately so the request doesn't timeout.
       * Emails are sent in the background.
       */
      Response.sendJsonObjectResponse(req, res, {
        message:
          "Broadcast email job has been started. Emails will be sent in the background.",
      });

      // Process emails in the background after the response is sent.
      sendBroadcastEmailsInBackground({
        subject,
        htmlMessage,
      }).catch((err: Error) => {
        logger.error(`Broadcast email background job failed: ${err}`);
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
