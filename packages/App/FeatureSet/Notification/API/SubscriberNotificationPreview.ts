import MailService, { RenderedEmail } from "../Services/MailService";
import User from "Common/Models/DatabaseModels/User";
import CommonAPI from "Common/Server/API/CommonAPI";
import TestSendAccess, {
  TestSendCaller,
} from "Common/Server/API/TestSendAccess";
import SubscriberNotificationPreviewRateLimit from "Common/Server/Middleware/SubscriberNotificationPreviewRateLimit";
import SubscriberNotificationTestSendRateLimit from "Common/Server/Middleware/SubscriberNotificationTestSendRateLimit";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import UserService from "Common/Server/Services/UserService";
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
import SubscriberNotificationPreviewBuilder, {
  SubscriberNotificationPreviewBuild,
  SubscriberNotificationPreviewPage,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationPreviewBuilder";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import SubscriberNotificationPreview, {
  SubscriberNotificationPreviewNothingSentReason,
  SubscriberNotificationPreviewRequest,
  SubscriberNotificationPreviewResult,
  SubscriberNotificationSendTestRequest,
} from "Common/Types/StatusPage/SubscriberNotificationPreview";

/*
 * "Preview notification" and "Send test to me" for status page subscriber
 * emails (see Common/Types/StatusPage/SubscriberNotificationPreview), under
 * the notification API, where the mailer and its templates are: the Dashboard
 * reaches it at NOTIFICATION_URL + /subscriber-notification-preview, as it
 * reaches /smtp-config/test.
 *
 * POST /preview   the email each status page's subscribers would get about an
 *                 incident being declared, or a public note being written:
 *                 subject, HTML, which template and why, and the "up to"
 *                 counts. No address, ever.
 *                 At most sixty times every ten minutes per user.
 * POST /send-test one page's email, sent to the caller's own verified account
 *                 email and nowhere else, at most a few times a quarter hour.
 *
 * Both run as a signed-in member of the project named in the `tenantid`
 * header (CommonAPI.assertAuthenticatedProjectMember), holding one of the
 * roles that may see an incident's audience; what they can see of which
 * incident and which status pages is then bounded by the caller's own
 * permissions (SubscriberNotificationPreviewBuilder). Emails are built by
 * SubscriberIncidentEmailBuilder, the subscriber jobs' own code path, and
 * rendered by MailService.render, which MailService.send renders with too.
 */

const router: ExpressRouter = Express.getRouter();

// What a test email waits for the mail server, so a bad host does not hang.
const TEST_EMAIL_TIMEOUT_IN_MS: number = 10000;

const NOTHING_SENT_MESSAGES: Record<
  SubscriberNotificationPreviewNothingSentReason,
  string
> = {
  [SubscriberNotificationPreviewNothingSentReason.NoMonitors]:
    "Nothing would be sent: no monitors are attached to this incident.",
  [SubscriberNotificationPreviewNothingSentReason.HiddenFromStatusPages]:
    "Nothing would be sent: this incident is hidden from status pages.",
  [SubscriberNotificationPreviewNothingSentReason.PrivateIncident]:
    "Nothing would be sent: private incidents are hidden from all status pages.",
  [SubscriberNotificationPreviewNothingSentReason.NotifyOff]:
    "Nothing would be sent: 'Notify Status Page Subscribers' is off.",
  [SubscriberNotificationPreviewNothingSentReason.NoStatusPages]:
    "Nothing would be sent: no status page that lists these monitors will show this incident.",
};

/*
 * The caller of a preview, as a signed-in member of the project in the
 * tenant header, read for that one project - as the test send below reads
 * it (TestSendAccess.getCaller). A preview sends nothing, so unlike a test it
 * stays open to a credential issued for reading only.
 */
async function getCaller(req: ExpressRequest): Promise<{
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
}> {
  const props: DatabaseCommonInteractionProps = {
    ...(await CommonAPI.getDatabaseCommonInteractionProps(req)),
    isMultiTenantRequest: false,
  };

  const projectId: ObjectID = CommonAPI.assertAuthenticatedProjectMember(props);

  return {
    props: props,
    projectId: projectId,
  };
}

// Each page's email as the mailer renders it.
export async function renderPreview(
  build: SubscriberNotificationPreviewBuild,
): Promise<SubscriberNotificationPreviewResult> {
  const result: SubscriberNotificationPreviewResult = {
    event: build.event,
    nothingSentReason: build.nothingSentReason,
    audience: build.audience,
    statusPages: [],
  };

  for (const page of build.statusPages) {
    const rendered: RenderedEmail = await MailService.render(
      page.email.envelope,
    );

    result.statusPages.push({
      statusPageId: page.statusPageId,
      name: page.name,
      subscriberCounts: { ...page.subscriberCounts },
      subject: rendered.subject,
      html: rendered.body,
      templateChoice: { ...page.templateChoice },
    });
  }

  return result;
}

router.post(
  SubscriberNotificationPreview.previewPath,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  // A preview renders an email per page: bounded per user.
  SubscriberNotificationPreviewRateLimit.getMiddleware(),
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const caller: {
        props: DatabaseCommonInteractionProps;
        projectId: ObjectID;
      } = await getCaller(req);

      const request: SubscriberNotificationPreviewRequest =
        SubscriberNotificationPreviewBuilder.parseRequest(req.body);

      const build: SubscriberNotificationPreviewBuild =
        await SubscriberNotificationPreviewBuilder.build({
          projectId: caller.projectId,
          props: caller.props,
          request: request,
        });

      const result: SubscriberNotificationPreviewResult =
        await renderPreview(build);

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        SubscriberNotificationPreview.toJSON(result),
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  SubscriberNotificationPreview.sendTestPath,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  // Per user, before anything is read (SubscriberNotificationTestSendRateLimit).
  SubscriberNotificationTestSendRateLimit.getMiddleware(),
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      /*
       * A test the caller sends themselves, as a signed-in member of the
       * project, on a credential that may make changes, read for that one
       * project (TestSendAccess). Who may see an incident's audience, and
       * which incident and pages, the builder decides below.
       */
      const caller: TestSendCaller = await TestSendAccess.getCaller(req);

      const request: SubscriberNotificationSendTestRequest =
        SubscriberNotificationPreviewBuilder.parseSendTestRequest(req.body);

      /*
       * Who the test goes to: the caller, at their own account email, and
       * only once it is verified. The route takes no address, so it cannot be
       * pointed at anyone else's inbox, nor used to mail an address someone
       * signed up with but never proved they own.
       */
      const user: User | null = await UserService.findOneById({
        id: caller.userId,
        select: {
          email: true,
          isEmailVerified: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!user || !user.email) {
        throw new BadDataException(
          "Your account has no email address to send a test email to.",
        );
      }

      if (!user.isEmailVerified) {
        throw new BadDataException(
          "Verify your account's email address before sending yourself a test email.",
        );
      }

      const build: SubscriberNotificationPreviewBuild =
        await SubscriberNotificationPreviewBuilder.build({
          projectId: caller.projectId,
          props: caller.props,
          request: request,
          onlyStatusPageId: request.statusPageId,
        });

      if (build.nothingSentReason) {
        throw new BadDataException(
          NOTHING_SENT_MESSAGES[build.nothingSentReason],
        );
      }

      const page: SubscriberNotificationPreviewPage | undefined =
        build.statusPages[0];

      if (!page) {
        throw new BadDataException(
          "This status page would not be sent this notification, or you do not have access to it.",
        );
      }

      /*
       * The page's email, through the page's own SMTP server when it has one
       * (as the jobs send it), so the test also shows the page's mail
       * settings work. Marked as a test in the subject.
       */
      try {
        await MailService.send(
          {
            ...page.email.envelope,
            toEmail: user.email,
            subject:
              SubscriberNotificationPreview.testEmailSubjectPrefix +
              page.email.subject,
            isSubjectLiteral: true,
          },
          {
            emailServer: ProjectSMTPConfigService.toEmailServer(
              page.statusPage.smtpConfig,
            ),
            projectId: caller.projectId,
            statusPageId: new ObjectID(page.statusPageId),
            userId: caller.userId,
            timeout: TEST_EMAIL_TIMEOUT_IN_MS,
          },
        );
      } catch (err) {
        logger.error(err, getLogAttributesFromRequest(req as RequestLike));

        throw new BadDataException(
          "The test email could not be sent: " +
            (err instanceof Error && err.message
              ? err.message
              : "the mail server did not accept it."),
        );
      }

      return Response.sendJsonObjectResponse(req, res, {
        sentTo: user.email.toString(),
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
