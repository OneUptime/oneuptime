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
import {
  AIChatPageContext,
  AIChatPageContextHelper,
} from "../../Types/AI/AIChatPageContext";
import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
} from "../../Types/AI/AIChatPermissionMode";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../Types/AI/AIChatTypes";
import { JSONArray, JSONObject } from "../../Types/JSON";
import AIRunEventType from "../../Types/AI/AIRunEventType";
import AIRunStatus from "../../Types/AI/AIRunStatus";
import AIRunType from "../../Types/AI/AIRunType";
import AIConversation from "../../Models/DatabaseModels/AIConversation";
import AIConversationMessage, {
  AIConversationMessageFeedback,
} from "../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../Models/DatabaseModels/AIRunEvent";
import Project from "../../Models/DatabaseModels/Project";
import AIConversationService from "../Services/AIConversationService";
import AIConversationMessageService from "../Services/AIConversationMessageService";
import AIRunEventService from "../Services/AIRunEventService";
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

// Final message content and run error for a turn the user stopped.
const STOPPED_BY_USER_TEXT: string = "Stopped by user.";

/*
 * Cancel's terminal event must sort after every progress event the runner
 * emitted — same convention as the runner's own failure finalizer, which
 * starts its event sequence at 100000.
 */
const CANCEL_EVENT_SEQUENCE: number = 100000;

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

      /*
       * Optional page context — what the user was looking at when they asked
       * (an incident, a monitor, the logs explorer, …). It is a hint for the
       * system prompt, so an invalid payload is dropped, never an error.
       */
      const pageContext: AIChatPageContext | undefined =
        AIChatPageContextHelper.sanitize(
          req.body["pageContext"] as JSONObject | undefined,
        );

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
        pageContext: pageContext,
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

/*
 * Stops the conversation's in-flight turn. Flips the active run to Cancelled,
 * finalizes the in-flight assistant message as "Stopped by user." and emits a
 * terminal run event so the polling UI sees closure. Every write is guarded on
 * the row's current status, so racing the runner is safe: whichever side
 * finalizes first wins and the loser's write matches zero rows (the runner
 * also checks for cancellation cooperatively between its steps). Cancelling
 * the run is also what releases the conversation for the next send —
 * send-message's governor only blocks on Running/WaitingForApproval runs.
 */
router.post(
  "/ai-chat/cancel-run",
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

      if (!conversationIdString) {
        throw new BadDataException("conversationId is required.");
      }

      const conversationId: ObjectID = new ObjectID(conversationIdString);

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

      /*
       * The conversation's live run: actively generating (Running) or paused
       * for the user's approval (WaitingForApproval). The per-conversation
       * governor allows at most one, so no sort is needed.
       */
      const activeRun: AIRun | null = await AIRunService.findOneBy({
        query: {
          conversationId: conversationId,
          projectId: projectId,
          status: QueryHelper.any([
            AIRunStatus.Running,
            AIRunStatus.WaitingForApproval,
          ]),
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!activeRun) {
        throw new BadDataException(
          "No response is being generated in this conversation.",
        );
      }

      /*
       * Status-guarded finalization, the same shape as the runner's own
       * finalizer: only a still-in-flight run is flipped, so a run the runner
       * completed (or errored) inside the race window is never overwritten.
       * updateOneBy returns the matched-row count — zero from both guards
       * means the other side won and already wrote the final state.
       */
      let cancelledRunCount: number = 0;

      for (const inFlightRunStatus of [
        AIRunStatus.Running,
        AIRunStatus.WaitingForApproval,
      ]) {
        cancelledRunCount += await AIRunService.updateOneBy({
          query: {
            _id: activeRun.id!.toString(),
            status: inFlightRunStatus,
          },
          data: {
            status: AIRunStatus.Cancelled,
            completedAt: OneUptimeDate.getCurrentDate(),
            errorMessage: STOPPED_BY_USER_TEXT,
            // A cancelled turn must never be resumable.
            pausedState: null,
          } as never,
          props: { isRoot: true },
        });
      }

      /*
       * Finalize the run's in-flight assistant message the same guarded way:
       * a message another path already finalized — completed with its full
       * answer, or errored — keeps what it has.
       */
      for (const inFlightMessageStatus of [
        AIChatMessageStatus.InProgress,
        AIChatMessageStatus.WaitingForApproval,
      ]) {
        await AIConversationMessageService.updateOneBy({
          query: {
            aiRunId: activeRun.id!,
            status: inFlightMessageStatus,
          },
          data: {
            status: AIChatMessageStatus.Cancelled,
            contentInMarkdown: STOPPED_BY_USER_TEXT,
          } as never,
          props: { isRoot: true },
        });
      }

      /*
       * Terminal event, only when this request actually took the run —
       * emitting closure over a turn the runner finished would tell the UI a
       * completed answer failed. RunFailed is the event enum's terminal
       * "did not finish" member; the summary carries the human reason.
       */
      if (cancelledRunCount > 0) {
        try {
          const cancelEvent: AIRunEvent = new AIRunEvent();
          cancelEvent.projectId = projectId;
          cancelEvent.aiRunId = activeRun.id!;
          cancelEvent.userId = userId;
          cancelEvent.sequence = CANCEL_EVENT_SEQUENCE;
          cancelEvent.eventType = AIRunEventType.RunFailed;
          cancelEvent.resultSummary = { errorMessage: STOPPED_BY_USER_TEXT };

          await AIRunEventService.create({
            data: cancelEvent,
            props: { isRoot: true },
          });
        } catch (error) {
          // Events are progress telemetry — never fail the cancel over them.
          logger.error(
            `Failed to emit AI chat cancel event: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      Response.sendJsonObjectResponse(req, res, {
        conversationId: conversationId.toString(),
        aiRunId: activeRun.id!.toString(),
        cancelled: cancelledRunCount > 0,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * Stores thumbs feedback on an assistant message (or clears it with null).
 * Ownership is enforced the same way as the other routes: the message AND its
 * conversation must resolve under the requesting user's props (the privacy
 * pin returns null for other users' rows), and only assistant-role messages
 * accept feedback. Persistence only — no analytics pipeline yet.
 */
router.post(
  "/ai-chat/message-feedback",
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

      const messageIdString: string = req.body["messageId"] as string;

      if (!messageIdString) {
        throw new BadDataException("messageId is required.");
      }

      const messageId: ObjectID = new ObjectID(messageIdString);

      /*
       * Validate before any read: feedback is exactly "Up", "Down" or null
       * (null clears). Anything else — including a missing key — is a bad
       * request, never silently coerced.
       */
      if (!("feedback" in (req.body as JSONObject))) {
        throw new BadDataException(
          'feedback is required: "Up", "Down" or null (null clears feedback).',
        );
      }

      const rawFeedback: string | null | undefined = req.body["feedback"] as
        | string
        | null
        | undefined;

      let feedback: AIConversationMessageFeedback | null = null;

      if (rawFeedback !== null && rawFeedback !== undefined) {
        if (
          rawFeedback !== AIConversationMessageFeedback.Up &&
          rawFeedback !== AIConversationMessageFeedback.Down
        ) {
          throw new BadDataException(
            'feedback must be "Up", "Down" or null (null clears feedback).',
          );
        }

        feedback = rawFeedback as AIConversationMessageFeedback;
      }

      // The privacy pin makes this return null for other users' rows.
      const message: AIConversationMessage | null =
        await AIConversationMessageService.findOneById({
          id: messageId,
          select: {
            _id: true,
            conversationId: true,
            role: true,
          },
          props: props,
        });

      if (!message || !message.conversationId) {
        throw new BadDataException("Message not found.");
      }

      /*
       * Belt and braces, matching respond-to-approval: the message's
       * conversation must also resolve under this user's props.
       */
      const conversation: AIConversation | null =
        await AIConversationService.findOneById({
          id: message.conversationId,
          select: { _id: true },
          props: props,
        });

      if (!conversation) {
        throw new BadDataException("Message not found.");
      }

      if (message.role !== AIChatMessageRole.Assistant) {
        throw new BadDataException(
          "Feedback can only be left on assistant messages.",
        );
      }

      // Root write: message columns are deliberately not user-writable.
      await AIConversationMessageService.updateOneById({
        id: messageId,
        data: {
          userFeedback: feedback,
        } as never,
        props: { isRoot: true },
      });

      Response.sendJsonObjectResponse(req, res, {
        messageId: messageId.toString(),
        feedback: feedback,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
