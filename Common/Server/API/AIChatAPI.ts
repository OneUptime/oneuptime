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
import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
} from "../../Types/AI/AIChatPermissionMode";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../Types/AI/AIChatTypes";
import { JSONArray, JSONObject } from "../../Types/JSON";
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
import LlmProviderService from "../Services/LlmProviderService";
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";
import ChatAgentRunner, {
  ResumeToolDecision,
} from "../Utils/AI/Chat/ChatAgentRunner";
import QueryHelper from "../Types/Database/QueryHelper";
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

      /*
       * Optional provider override chosen in the chat provider switcher. It is
       * validated against the project below (must be a global provider or one
       * owned by this project) so a member can't point a conversation at
       * another project's provider.
       */
      let requestedLlmProviderId: ObjectID | undefined = undefined;

      if (req.body["llmProviderId"]) {
        requestedLlmProviderId = new ObjectID(
          req.body["llmProviderId"] as string,
        );

        const chosenProvider: LlmProvider | null =
          await LlmProviderService.findOneById({
            id: requestedLlmProviderId,
            select: {
              _id: true,
              projectId: true,
              isGlobalLlm: true,
            },
            props: { isRoot: true },
          });

        const isAccessible: boolean = Boolean(
          chosenProvider &&
            (chosenProvider.isGlobalLlm === true ||
              chosenProvider.projectId?.toString() === projectId.toString()),
        );

        if (!isAccessible) {
          throw new BadDataException(
            "The selected AI provider is not available for this project.",
          );
        }
      }

      /*
       * Optional per-conversation permission mode chosen in the composer
       * (AskForApproval | AutoRun | ReadOnly). Like the provider, it is sticky:
       * persisted on the conversation and reused across turns. Invalid values
       * are ignored (fall through to the conversation's current mode / default).
       */
      const requestedPermissionMode: AIChatPermissionMode | undefined =
        AIChatPermissionModeHelper.isValid(req.body["permissionMode"] as string)
          ? (req.body["permissionMode"] as AIChatPermissionMode)
          : undefined;

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

      /*
       * The provider actually used for this turn: the explicit choice if made,
       * otherwise whatever the conversation was last set to (so the picker is
       * "sticky" across turns), otherwise undefined (project default).
       */
      let effectiveLlmProviderId: ObjectID | undefined = requestedLlmProviderId;

      // Same stickiness for the permission mode; default is AskForApproval.
      let effectivePermissionMode: AIChatPermissionMode =
        requestedPermissionMode || AIChatPermissionModeHelper.getDefault();

      if (req.body["conversationId"]) {
        conversationId = new ObjectID(req.body["conversationId"] as string);

        // The privacy pin makes this return null for other users' rows.
        const conversation: AIConversation | null =
          await AIConversationService.findOneById({
            id: conversationId,
            select: { _id: true, llmProviderId: true, permissionMode: true },
            props: props,
          });

        if (!conversation) {
          throw new BadDataException("Conversation not found.");
        }

        if (
          requestedLlmProviderId &&
          requestedLlmProviderId.toString() !==
            conversation.llmProviderId?.toString()
        ) {
          // The user switched providers mid-conversation — persist the change.
          await AIConversationService.updateOneById({
            id: conversationId,
            data: {
              llmProviderId: requestedLlmProviderId,
            } as never,
            props: { isRoot: true },
          });
        }

        effectiveLlmProviderId =
          requestedLlmProviderId || conversation.llmProviderId;

        effectivePermissionMode = AIChatPermissionModeHelper.parse(
          requestedPermissionMode || conversation.permissionMode,
        );

        if (
          requestedPermissionMode &&
          requestedPermissionMode !== conversation.permissionMode
        ) {
          // The user switched the permission mode mid-conversation — persist it.
          await AIConversationService.updateOneById({
            id: conversationId,
            data: {
              permissionMode: requestedPermissionMode,
            } as never,
            props: { isRoot: true },
          });
        }

        /*
         * Block a new send while the conversation is busy: a run is either
         * actively generating (Running) or paused waiting for the user to
         * approve pending actions (WaitingForApproval).
         */
        const busyRunsInConversation: number = (
          await AIRunService.countBy({
            query: {
              conversationId: conversationId,
              status: QueryHelper.any([
                AIRunStatus.Running,
                AIRunStatus.WaitingForApproval,
              ]),
            },
            props: { isRoot: true },
          })
        ).toNumber();

        if (busyRunsInConversation > 0) {
          throw new BadDataException(
            "A response is already being generated (or is waiting for your approval) in this conversation.",
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
         * user-writable. The provider choice (if any) is stored here too so it
         * sticks for the rest of the conversation.
         */
        await AIConversationService.updateOneById({
          id: conversationId,
          data: {
            title: content.substring(0, 90),
            permissionMode: effectivePermissionMode,
            ...(requestedLlmProviderId
              ? { llmProviderId: requestedLlmProviderId }
              : {}),
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
        llmProviderId: effectiveLlmProviderId,
        permissionMode: effectivePermissionMode,
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

/*
 * Lists the LLM providers a member can choose from in the chat provider
 * switcher: every provider configured for the project plus the shared global
 * providers. Secrets are never returned. `defaultProviderId` is the provider
 * the project resolves to today, so the UI can pre-select it.
 */
router.post(
  "/ai-chat/providers",
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

      const [providers, defaultProvider]: [
        Array<LlmProvider>,
        LlmProvider | null,
      ] = await Promise.all([
        LlmProviderService.getSelectableProvidersForProject(projectId),
        LlmProviderService.getLLMProviderForProject(projectId),
      ]);

      Response.sendJsonObjectResponse(req, res, {
        defaultProviderId: defaultProvider?.id?.toString() || null,
        providers: providers.map((provider: LlmProvider) => {
          return {
            id: provider.id?.toString(),
            name: provider.name,
            description: provider.description || null,
            llmType: provider.llmType?.toString() || null,
            modelName: provider.modelName || null,
            isDefault: provider.isDefault || false,
            isGlobal: provider.isGlobalLlm || false,
          };
        }),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * Responds to a paused turn's approval request: the user approves or denies the
 * pending mutating actions, and the agent turn resumes detached. Progress then
 * flows back through the same message/run/event polling as a normal turn.
 */
router.post(
  "/ai-chat/respond-to-approval",
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

      const conversationIdString: string = req.body["conversationId"] as string;
      const assistantMessageIdString: string = req.body[
        "assistantMessageId"
      ] as string;

      if (!conversationIdString || !assistantMessageIdString) {
        throw new BadDataException(
          "conversationId and assistantMessageId are required.",
        );
      }

      const conversationId: ObjectID = new ObjectID(conversationIdString);
      const assistantMessageId: ObjectID = new ObjectID(
        assistantMessageIdString,
      );

      // The privacy pin makes these return null for other users' rows.
      const conversation: AIConversation | null =
        await AIConversationService.findOneById({
          id: conversationId,
          select: { _id: true, llmProviderId: true, permissionMode: true },
          props: props,
        });

      if (!conversation) {
        throw new BadDataException("Conversation not found.");
      }

      const message: AIConversationMessage | null =
        await AIConversationMessageService.findOneById({
          id: assistantMessageId,
          select: {
            _id: true,
            conversationId: true,
            status: true,
            aiRunId: true,
            toolActions: true,
          },
          props: props,
        });

      if (
        !message ||
        message.conversationId?.toString() !== conversationId.toString()
      ) {
        throw new BadDataException("Message not found.");
      }

      if (
        message.status !== AIChatMessageStatus.WaitingForApproval ||
        !message.aiRunId
      ) {
        throw new BadDataException("This message is not waiting for approval.");
      }

      const pendingActions: Array<AIChatToolAction> = (
        message.toolActions || []
      ).filter((action: AIChatToolAction) => {
        return (
          action.status === AIChatToolActionStatus.Pending &&
          action.requiresApproval
        );
      });

      if (pendingActions.length === 0) {
        throw new BadDataException(
          "There are no actions waiting for approval on this message.",
        );
      }

      /*
       * Decisions can be provided explicitly (per tool-call) or as a single
       * `approved` boolean applied to every pending action (the Approve-all /
       * Deny-all buttons). Any pending action left without a decision defaults
       * to denied inside the runner — approvals are always explicit.
       */
      const decisions: Array<ResumeToolDecision> = [];
      const bodyDecisions: JSONArray | undefined = req.body["decisions"] as
        | JSONArray
        | undefined;

      if (Array.isArray(bodyDecisions)) {
        for (const decision of bodyDecisions) {
          const decisionObject: JSONObject = decision as JSONObject;
          const toolCallId: string = decisionObject["toolCallId"] as string;
          if (toolCallId) {
            decisions.push({
              toolCallId: toolCallId,
              approved: decisionObject["approved"] === true,
            });
          }
        }
      } else if (typeof req.body["approved"] === "boolean") {
        const approveAll: boolean = req.body["approved"] === true;
        for (const action of pendingActions) {
          decisions.push({ toolCallId: action.id, approved: approveAll });
        }
      } else {
        throw new BadDataException(
          "Provide either a `decisions` array or an `approved` boolean.",
        );
      }

      // Confirm the run is still awaiting approval before kicking the resume.
      const run: AIRun | null = await AIRunService.findOneById({
        id: message.aiRunId,
        select: { _id: true, status: true },
        props: { isRoot: true },
      });

      if (!run || run.status !== AIRunStatus.WaitingForApproval) {
        throw new BadDataException("This turn is no longer awaiting approval.");
      }

      const permissionMode: AIChatPermissionMode =
        AIChatPermissionModeHelper.parse(conversation.permissionMode);

      // Detach the resume; the client follows progress via the usual polling.
      ChatAgentRunner.resumeTurn(
        {
          projectId: projectId,
          userId: userId,
          conversationId: conversationId,
          assistantMessageId: assistantMessageId,
          aiRunId: message.aiRunId,
          llmProviderId: conversation.llmProviderId,
          permissionMode: permissionMode,
          props: props,
        },
        decisions,
      ).catch((error: Error) => {
        logger.error(`AI chat turn resume crashed: ${error.message}`);
      });

      Response.sendJsonObjectResponse(req, res, {
        conversationId: conversationId.toString(),
        assistantMessageId: assistantMessageId.toString(),
        aiRunId: message.aiRunId.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
