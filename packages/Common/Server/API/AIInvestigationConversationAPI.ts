import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  assertSubjectReadableInTenant,
  getLoggedInProps,
  pinPropsToTenant,
} from "./AIInvestigationAPI";
import InvestigationThreadService, {
  InvestigationThreadSendResult,
} from "../Utils/AI/SRE/InvestigationThreadService";
import {
  InvestigationThreadSubject,
  InvestigationThreadSubjectType,
} from "../Utils/AI/SRE/InvestigationThread";
import { ChatRunCancellationResult } from "../Utils/AI/Chat/ChatRunCancellation";

/*
 * The conversation inside an incident's / alert's AI investigation box.
 *
 * Every route starts the same way: a logged-in member of the authenticated
 * tenant, props pinned to that tenant, and the incident or alert readable
 * under the VIEWER's own permissions inside it (the same gate as the
 * investigation panel itself). Only then does InvestigationThreadService
 * touch the shared thread. Anyone who can see the incident can read the
 * thread, ask in it, decide on an action it paused on, or stop an answer;
 * the tools the AI runs for them still run under their own permissions.
 */

const router: ExpressRouter = Express.getRouter();

export interface InvestigationConversationRequestContext {
  tenantId: ObjectID;
  userId: ObjectID;
  props: DatabaseCommonInteractionProps;
  subject: InvestigationThreadSubject;
}

export function parseInvestigationThreadSubject(
  body: JSONObject,
): InvestigationThreadSubject {
  const subjectType: unknown = body["subjectType"];

  if (subjectType !== "incident" && subjectType !== "alert") {
    throw new BadDataException('subjectType must be "incident" or "alert".');
  }

  const subjectIdRaw: unknown = body["subjectId"];

  if (typeof subjectIdRaw !== "string" || !subjectIdRaw.trim()) {
    throw new BadDataException("subjectId is required.");
  }

  ObjectID.validateUUID(subjectIdRaw.trim());

  return {
    type: subjectType as InvestigationThreadSubjectType,
    id: new ObjectID(subjectIdRaw.trim()),
  };
}

/*
 * Who is asking, in which tenant, about which subject — with the read check
 * on that subject already passed. Membership is asserted too: a thread is
 * a project member's tool, never reachable with a bare session.
 */
export async function resolveInvestigationConversationRequest(
  req: ExpressRequest,
): Promise<InvestigationConversationRequestContext> {
  const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

  const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);
  CommonAPI.assertAuthenticatedProjectMember(props);

  const viewerProps: DatabaseCommonInteractionProps = pinPropsToTenant(props);
  const subject: InvestigationThreadSubject = parseInvestigationThreadSubject(
    (req.body || {}) as JSONObject,
  );

  await assertSubjectReadableInTenant({
    subjectType: subject.type,
    subjectId: subject.id,
    tenantId,
    viewerProps,
  });

  return {
    tenantId,
    userId: props.userId!,
    props: viewerProps,
    subject,
  };
}

// The thread as the box renders it (see InvestigationThreadService.getView).
router.post(
  "/ai-investigation/conversation",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const context: InvestigationConversationRequestContext =
        await resolveInvestigationConversationRequest(req);

      const view: JSONObject = await InvestigationThreadService.getView({
        projectId: context.tenantId,
        subject: context.subject,
      });

      Response.sendJsonObjectResponse(req, res, {
        ...view,
        viewerUserId: context.userId.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

// Ask a question — or ask OneUptime AI to do something.
router.post(
  "/ai-investigation/conversation/send-message",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const context: InvestigationConversationRequestContext =
        await resolveInvestigationConversationRequest(req);

      const content: unknown = req.body["content"];

      if (typeof content !== "string") {
        throw new BadDataException("content is required.");
      }

      const permissionMode: unknown = req.body["permissionMode"];

      const result: InvestigationThreadSendResult =
        await InvestigationThreadService.sendMessage({
          projectId: context.tenantId,
          subject: context.subject,
          userId: context.userId,
          props: context.props,
          content,
          permissionMode:
            typeof permissionMode === "string" ? permissionMode : undefined,
        });

      Response.sendJsonObjectResponse(req, res, {
        conversationId: result.conversationId.toString(),
        userMessageId: result.userMessageId.toString(),
        assistantMessageId: result.assistantMessageId.toString(),
        aiRunId: result.aiRunId.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

// Approve or deny the action(s) an answer paused on.
router.post(
  "/ai-investigation/conversation/respond-to-approval",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const context: InvestigationConversationRequestContext =
        await resolveInvestigationConversationRequest(req);

      const assistantMessageIdRaw: unknown = req.body["assistantMessageId"];

      if (
        typeof assistantMessageIdRaw !== "string" ||
        !assistantMessageIdRaw.trim()
      ) {
        throw new BadDataException("assistantMessageId is required.");
      }

      ObjectID.validateUUID(assistantMessageIdRaw.trim());

      const result: { aiRunId: ObjectID } =
        await InvestigationThreadService.respondToApproval({
          projectId: context.tenantId,
          subject: context.subject,
          userId: context.userId,
          props: context.props,
          assistantMessageId: new ObjectID(assistantMessageIdRaw.trim()),
          decisions: Array.isArray(req.body["decisions"])
            ? (req.body["decisions"] as JSONArray)
            : undefined,
          approved:
            typeof req.body["approved"] === "boolean"
              ? (req.body["approved"] as boolean)
              : undefined,
        });

      Response.sendJsonObjectResponse(req, res, {
        assistantMessageId: assistantMessageIdRaw.trim(),
        aiRunId: result.aiRunId.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

// Stop the answer in flight.
router.post(
  "/ai-investigation/conversation/cancel-run",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const context: InvestigationConversationRequestContext =
        await resolveInvestigationConversationRequest(req);

      const result: ChatRunCancellationResult =
        await InvestigationThreadService.cancelRun({
          projectId: context.tenantId,
          subject: context.subject,
          userId: context.userId,
        });

      Response.sendJsonObjectResponse(req, res, {
        aiRunId: result.aiRunId.toString(),
        cancelled: result.cancelled,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
