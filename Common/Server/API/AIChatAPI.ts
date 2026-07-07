import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import PositiveNumber from "../../Types/PositiveNumber";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import { IsBillingEnabled, getAllEnvVars } from "../EnvironmentConfig";
import AIChatMessageRole from "../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../Types/AI/AIChatMessageStatus";
import AIRunStatus from "../../Types/AI/AIRunStatus";
import AIRunType from "../../Types/AI/AIRunType";
import AIConversation from "../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../Models/DatabaseModels/AIRun";
import Project from "../../Models/DatabaseModels/Project";
import AIConversationService from "../Services/AIConversationService";
import AIConversationMessageService from "../Services/AIConversationMessageService";
import AIRunService from "../Services/AIRunService";
import ProjectService from "../Services/ProjectService";
import ChatAgentRunner from "../Utils/AI/Chat/ChatAgentRunner";
import logger from "../Utils/Logger";

const MAX_USER_MESSAGE_LENGTH: number = 8000;
const MAX_CONCURRENT_RUNS_PER_PROJECT: number = 3;

const router: ExpressRouter = Express.getRouter();

/*
 * Starts a chat turn: validates and gates the request, creates the user and
 * assistant message rows and the run, then kicks the agent loop off detached
 * and returns immediately. The client follows progress by polling/receiving
 * realtime events on the assistant message and the run events.
 */
router.post(
  "/ai-chat/send-message",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!props.userId) {
        throw new NotAuthorizedException(
          "AI chat requires a logged-in user session.",
        );
      }

      if (!props.tenantId) {
        throw new BadDataException("Project ID is required (tenantid header).");
      }

      const projectId: ObjectID = props.tenantId;
      const userId: ObjectID = props.userId;

      const content: string = (req.body["content"] as string) || "";

      if (!content.trim()) {
        throw new BadDataException("Message content is required.");
      }

      if (content.length > MAX_USER_MESSAGE_LENGTH) {
        throw new BadDataException(
          `Message is too long. Maximum length is ${MAX_USER_MESSAGE_LENGTH} characters.`,
        );
      }

      // Plan gate: custom endpoints get no automatic billing check.
      if (
        IsBillingEnabled &&
        props.currentPlan &&
        !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
          PlanType.Growth,
          props.currentPlan,
          getAllEnvVars(),
        )
      ) {
        throw new PaymentRequiredException(
          "Please upgrade your plan to Growth to use AI chat.",
        );
      }

      if (IsBillingEnabled && props.isSubscriptionUnpaid) {
        throw new PaymentRequiredException(
          "Your subscription is unpaid. Please update your payment method to use AI chat.",
        );
      }

      /*
       * Project AI toggle and the project-wide volume governor (parallel —
       * independent reads).
       */
      const [project, runningRunsInProject]: [Project | null, number] =
        await Promise.all([
          ProjectService.findOneById({
            id: projectId,
            select: {
              enableAi: true,
            },
            props: { isRoot: true },
          }),
          AIRunService.countBy({
            query: {
              projectId: projectId,
              runType: AIRunType.Chat,
              status: AIRunStatus.Running,
            },
            props: { isRoot: true },
          }).then((count: PositiveNumber) => {
            return count.toNumber();
          }),
        ]);

      if (project && project.enableAi === false) {
        throw new BadDataException(
          "AI features are disabled for this project. Enable them in Project Settings > AI Credits.",
        );
      }

      if (runningRunsInProject >= MAX_CONCURRENT_RUNS_PER_PROJECT) {
        throw new BadDataException(
          "Too many AI chat responses are being generated in this project right now. Please try again in a moment.",
        );
      }

      /*
       * Find or create the conversation (created with the USER's props so
       * RBAC and the Growth billing gate are enforced by the normal chain).
       */
      let conversationId: ObjectID | undefined = undefined;

      if (req.body["conversationId"]) {
        conversationId = new ObjectID(req.body["conversationId"] as string);

        // The privacy pin makes this return null for other users' rows.
        const conversation: AIConversation | null =
          await AIConversationService.findOneById({
            id: conversationId,
            select: { _id: true },
            props: props,
          });

        if (!conversation) {
          throw new BadDataException("Conversation not found.");
        }

        const runningRunsInConversation: number = (
          await AIRunService.countBy({
            query: {
              conversationId: conversationId,
              status: AIRunStatus.Running,
            },
            props: { isRoot: true },
          })
        ).toNumber();

        if (runningRunsInConversation > 0) {
          throw new BadDataException(
            "A response is already being generated in this conversation.",
          );
        }
      } else {
        const conversation: AIConversation = new AIConversation();
        conversation.projectId = projectId;

        const createdConversation: AIConversation =
          await AIConversationService.create({
            data: conversation,
            props: props,
          });

        conversationId = createdConversation.id!;

        /*
         * Title is server-generated; the column is deliberately not
         * user-writable.
         */
        await AIConversationService.updateOneById({
          id: conversationId,
          data: {
            title: content.substring(0, 90),
          } as never,
          props: { isRoot: true },
        });
      }

      /*
       * The run is created BEFORE the message rows so the concurrency check
       * below can be verified against it.
       */
      const run: AIRun = new AIRun();
      run.projectId = projectId;
      run.runType = AIRunType.Chat;
      run.status = AIRunStatus.Running;
      run.userId = userId;
      run.conversationId = conversationId;
      run.startedAt = OneUptimeDate.getCurrentDate();
      run.lastHeartbeatAt = OneUptimeDate.getCurrentDate();

      const createdRun: AIRun = await AIRunService.create({
        data: run,
        props: { isRoot: true },
      });

      /*
       * Close the check-then-act race on the per-conversation governor: after
       * creating our run, verify it is the OLDEST running run for this
       * conversation. If two sends raced, the newer one cancels itself.
       */
      const runningRuns: Array<AIRun> = await AIRunService.findBy({
        query: {
          conversationId: conversationId,
          status: AIRunStatus.Running,
        },
        select: {
          _id: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: 2,
        skip: 0,
        props: { isRoot: true },
      });

      if (
        runningRuns.length > 1 &&
        runningRuns[0]?.id?.toString() !== createdRun.id?.toString()
      ) {
        await AIRunService.updateOneById({
          id: createdRun.id!,
          data: {
            status: AIRunStatus.Cancelled,
            completedAt: OneUptimeDate.getCurrentDate(),
            errorMessage:
              "Cancelled: another response was already being generated in this conversation.",
          } as never,
          props: { isRoot: true },
        });

        throw new BadDataException(
          "A response is already being generated in this conversation.",
        );
      }

      /*
       * User message row (server-written; message create ACLs are empty by
       * design so members can't forge rows through the CRUD API).
       */
      const userMessage: AIConversationMessage = new AIConversationMessage();
      userMessage.projectId = projectId;
      userMessage.conversationId = conversationId;
      userMessage.userId = userId;
      userMessage.role = AIChatMessageRole.User;
      userMessage.contentInMarkdown = content;
      userMessage.status = AIChatMessageStatus.Completed;

      const createdUserMessage: AIConversationMessage =
        await AIConversationMessageService.create({
          data: userMessage,
          props: { isRoot: true },
        });

      // The assistant message the turn will fill in.
      const assistantMessage: AIConversationMessage =
        new AIConversationMessage();
      assistantMessage.projectId = projectId;
      assistantMessage.conversationId = conversationId;
      assistantMessage.userId = userId;
      assistantMessage.role = AIChatMessageRole.Assistant;
      assistantMessage.status = AIChatMessageStatus.InProgress;
      assistantMessage.aiRunId = createdRun.id!;

      const createdAssistantMessage: AIConversationMessage =
        await AIConversationMessageService.create({
          data: assistantMessage,
          props: { isRoot: true },
        });

      await AIConversationService.updateOneById({
        id: conversationId,
        data: {
          lastMessageAt: OneUptimeDate.getCurrentDate(),
        } as never,
        props: { isRoot: true },
      });

      /*
       * Detach the turn. The endpoint responds immediately; progress flows
       * through the message row, the run row and run events.
       */
      ChatAgentRunner.runTurn({
        projectId: projectId,
        userId: userId,
        conversationId: conversationId,
        assistantMessageId: createdAssistantMessage.id!,
        aiRunId: createdRun.id!,
        props: props,
      }).catch((error: Error) => {
        logger.error(`AI chat turn crashed: ${error.message}`);
      });

      Response.sendJsonObjectResponse(req, res, {
        conversationId: conversationId.toString(),
        userMessageId: createdUserMessage.id!.toString(),
        assistantMessageId: createdAssistantMessage.id!.toString(),
        aiRunId: createdRun.id!.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
