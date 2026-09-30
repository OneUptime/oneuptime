import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import SubscriptionPlan, {
  PlanType,
} from "../../../../Types/Billing/SubscriptionPlan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import AIChatMessageRole from "../../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
} from "../../../../Types/AI/AIChatPermissionMode";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../../Types/AI/AIChatTypes";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../../Models/DatabaseModels/Project";
import User from "../../../../Models/DatabaseModels/User";
import AIConversationMessageService from "../../../Services/AIConversationMessageService";
import AIConversationService from "../../../Services/AIConversationService";
import AIRunEventService from "../../../Services/AIRunEventService";
import AIRunService from "../../../Services/AIRunService";
import ProjectService from "../../../Services/ProjectService";
import LlmProviderService from "../../../Services/LlmProviderService";
import { AI_DISABLED_MESSAGE } from "../../../Services/AIService";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import { IsBillingEnabled, getAllEnvVars } from "../../../EnvironmentConfig";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ChatAgentRunner, {
  ChatTurnRequest,
  getMessageAuthorName,
  ResumeToolDecision,
} from "../Chat/ChatAgentRunner";
import ChatRunCancellation, {
  ChatRunCancellationResult,
} from "../Chat/ChatRunCancellation";
import InvestigationThread, {
  INVESTIGATION_THREAD_FEATURE,
  InvestigationThreadSubject,
  InvestigationThreadSubjectDetails,
  InvestigationThreadTurnContext,
} from "./InvestigationThread";
import logger from "../../Logger";

/*
 * What the investigation box's conversation does: show the shared thread,
 * take a responder's question (or request), approve or deny an action the
 * AI paused on, and stop an answer in flight.
 *
 * Every entry point assumes the caller (AIInvestigationConversationAPI)
 * already proved the requester can read the incident or alert inside the
 * authenticated tenant; everything here then reads and writes as root,
 * scoped to that tenant and that subject's thread. Tools still run under
 * the REQUESTER's own permissions, so asking the AI to act can never do
 * more than the person asking could do themselves.
 */

export const MAX_THREAD_MESSAGE_LENGTH: number = 8000;

// Most recent messages the box renders.
export const MAX_THREAD_VIEW_MESSAGES: number = 100;

// Live steps shown for the answer in flight.
export const MAX_THREAD_VIEW_EVENTS: number = 300;

/*
 * The mode a question runs in when the asker did not choose one. The box
 * exists to let responders get things done, so the AI acts on a clear
 * request straight away — always within the asker's own permissions, and
 * only on what they actually asked (the prompt enforces both).
 */
export const DEFAULT_THREAD_PERMISSION_MODE: AIChatPermissionMode =
  AIChatPermissionMode.AutoRun;

export interface InvestigationThreadAuthor {
  userId: string | null;
  name: string;
}

export interface InvestigationThreadSendResult {
  conversationId: ObjectID;
  userMessageId: ObjectID;
  assistantMessageId: ObjectID;
  aiRunId: ObjectID;
}

export default class InvestigationThreadService {
  /*
   * The whole thread as the box renders it: messages oldest-first with who
   * asked each question, and — while an answer is in flight — its run and
   * live steps. Null conversationId means nobody has asked anything yet.
   */
  public static async getView(data: {
    projectId: ObjectID;
    subject: InvestigationThreadSubject;
  }): Promise<JSONObject> {
    const conversation: AIConversation | null =
      await InvestigationThread.findThread(data);

    if (!conversation || !conversation.id) {
      return {
        conversationId: null,
        messages: [],
        activeRun: null,
        isBusy: false,
      };
    }

    const messages: Array<AIConversationMessage> = (
      await AIConversationMessageService.findBy({
        query: {
          conversationId: conversation.id,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          role: true,
          contentInMarkdown: true,
          status: true,
          citations: true,
          widgets: true,
          toolActions: true,
          errorMessage: true,
          aiRunId: true,
          createdAt: true,
          userId: true,
          user: { name: true, email: true },
        },
        sort: { createdAt: SortOrder.Descending },
        limit: MAX_THREAD_VIEW_MESSAGES,
        skip: 0,
        props: { isRoot: true },
      })
    ).reverse();

    const activeMessage: AIConversationMessage | undefined = [...messages]
      .reverse()
      .find((message: AIConversationMessage): boolean => {
        return (
          message.role === AIChatMessageRole.Assistant &&
          (message.status === AIChatMessageStatus.InProgress ||
            message.status === AIChatMessageStatus.WaitingForApproval ||
            message.status === AIChatMessageStatus.Pending)
        );
      });

    let activeRun: JSONObject | null = null;

    if (activeMessage?.aiRunId) {
      const run: AIRun | null = await AIRunService.findOneBy({
        query: {
          _id: activeMessage.aiRunId.toString(),
          projectId: data.projectId,
        },
        select: { _id: true, status: true, startedAt: true },
        props: { isRoot: true },
      });

      const events: Array<AIRunEvent> = await AIRunEventService.findBy({
        query: { aiRunId: activeMessage.aiRunId, projectId: data.projectId },
        // No tool arguments: the feed never shows them, and they stay private.
        select: {
          _id: true,
          sequence: true,
          eventType: true,
          toolName: true,
          resultSummary: true,
          createdAt: true,
        },
        sort: { sequence: SortOrder.Ascending },
        limit: MAX_THREAD_VIEW_EVENTS,
        skip: 0,
        props: { isRoot: true },
      });

      activeRun = {
        aiRunId: activeMessage.aiRunId.toString(),
        assistantMessageId: activeMessage.id?.toString() || null,
        status: run?.status || null,
        startedAt: run?.startedAt ? OneUptimeDate.toString(run.startedAt) : null,
        events: BaseModel.toJSONArray(events, AIRunEvent),
      };
    }

    // Who asked: the user row's name on each question and on its answer.
    const messageJson: JSONArray = messages.map(
      (message: AIConversationMessage): JSONObject => {
        const author: InvestigationThreadAuthor = {
          userId: message.userId ? message.userId.toString() : null,
          name: getMessageAuthorName(message.user as User | undefined),
        };

        return {
          _id: message.id?.toString() || null,
          role: message.role || null,
          contentInMarkdown: message.contentInMarkdown || "",
          status: message.status || null,
          citations: (message.citations || []) as unknown as JSONArray,
          widgets: (message.widgets || []) as unknown as JSONArray,
          toolActions: (message.toolActions || []) as unknown as JSONArray,
          errorMessage: message.errorMessage || null,
          aiRunId: message.aiRunId ? message.aiRunId.toString() : null,
          createdAt: message.createdAt
            ? OneUptimeDate.toString(message.createdAt)
            : null,
          author: author as unknown as JSONObject,
        };
      },
    );

    return {
      conversationId: conversation.id.toString(),
      messages: messageJson,
      activeRun,
      isBusy: Boolean(activeMessage),
    };
  }

  /*
   * A responder's question: gates, the thread (created on first use), the
   * run and both message rows, then the turn itself detached — the box
   * follows it by polling getView.
   */
  public static async sendMessage(data: {
    projectId: ObjectID;
    subject: InvestigationThreadSubject;
    userId: ObjectID;
    props: DatabaseCommonInteractionProps;
    content: string;
    permissionMode?: string | undefined;
  }): Promise<InvestigationThreadSendResult> {
    const content: string = (data.content || "").trim();

    if (!content) {
      throw new BadDataException("Please type a question or a request.");
    }

    if (content.length > MAX_THREAD_MESSAGE_LENGTH) {
      throw new BadDataException(
        `That message is too long. Keep it under ${MAX_THREAD_MESSAGE_LENGTH} characters.`,
      );
    }

    const permissionMode: AIChatPermissionMode =
      AIChatPermissionModeHelper.isValid(data.permissionMode)
        ? (data.permissionMode as AIChatPermissionMode)
        : DEFAULT_THREAD_PERMISSION_MODE;

    await this.assertAiAvailable({
      projectId: data.projectId,
      props: data.props,
    });

    const details: InvestigationThreadSubjectDetails =
      await InvestigationThread.getSubjectDetails(data);

    const conversation: AIConversation =
      await InvestigationThread.findOrCreateThread({
        projectId: data.projectId,
        subject: data.subject,
        title: `${details.label}: ${details.title}`,
      });

    const conversationId: ObjectID = conversation.id!;

    await this.assertThreadIdle({ projectId: data.projectId, conversationId });

    const run: AIRun = new AIRun();
    run.projectId = data.projectId;
    run.runType = AIRunType.Chat;
    run.status = AIRunStatus.Running;
    run.userId = data.userId;
    run.conversationId = conversationId;
    run.startedAt = OneUptimeDate.getCurrentDate();
    run.lastHeartbeatAt = OneUptimeDate.getCurrentDate();

    const createdRun: AIRun = await AIRunService.create({
      data: run,
      props: { isRoot: true },
    });

    /*
     * Close the check-then-act race: two responders pressing Send together
     * both pass assertThreadIdle. Whoever's run is not the oldest running
     * one in the thread cancels itself and is told to wait.
     */
    const runningRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        conversationId,
        status: AIRunStatus.Running,
      },
      select: { _id: true },
      sort: { createdAt: SortOrder.Ascending },
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
            "Cancelled: another question was already being answered in this thread.",
        } as never,
        props: { isRoot: true },
      });

      throw new BadDataException(
        "OneUptime AI just started answering someone else's question in this thread. Ask again as soon as it finishes.",
      );
    }

    const userMessage: AIConversationMessage = new AIConversationMessage();
    userMessage.projectId = data.projectId;
    userMessage.conversationId = conversationId;
    userMessage.userId = data.userId;
    userMessage.role = AIChatMessageRole.User;
    userMessage.contentInMarkdown = content;
    userMessage.status = AIChatMessageStatus.Completed;

    const createdUserMessage: AIConversationMessage =
      await AIConversationMessageService.create({
        data: userMessage,
        props: { isRoot: true },
      });

    const assistantMessage: AIConversationMessage = new AIConversationMessage();
    assistantMessage.projectId = data.projectId;
    assistantMessage.conversationId = conversationId;
    // The asker, so the answer is attributed to the question it answers.
    assistantMessage.userId = data.userId;
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
      data: { lastMessageAt: OneUptimeDate.getCurrentDate() } as never,
      props: { isRoot: true },
    });

    // Detached: the request returns now and the box polls for progress.
    this.runTurnInBackground({
      turn: {
        projectId: data.projectId,
        userId: data.userId,
        conversationId,
        assistantMessageId: createdAssistantMessage.id!,
        aiRunId: createdRun.id!,
        llmProviderId: conversation.llmProviderId,
        permissionMode,
        props: data.props,
      },
      subject: data.subject,
    }).catch((error: unknown) => {
      logger.error(`AI: investigation thread turn crashed: ${error}`);
    });

    return {
      conversationId,
      userMessageId: createdUserMessage.id!,
      assistantMessageId: createdAssistantMessage.id!,
      aiRunId: createdRun.id!,
    };
  }

  /*
   * Approve or deny the action(s) an answer paused on. Anyone who can read
   * the subject may decide, and approved actions run under the DECIDER's
   * own permissions — the person who clicked Approve is the one acting.
   */
  public static async respondToApproval(data: {
    projectId: ObjectID;
    subject: InvestigationThreadSubject;
    userId: ObjectID;
    props: DatabaseCommonInteractionProps;
    assistantMessageId: ObjectID;
    decisions?: JSONArray | undefined;
    approved?: boolean | undefined;
  }): Promise<{ aiRunId: ObjectID }> {
    const conversation: AIConversation | null =
      await InvestigationThread.findThread(data);

    if (!conversation || !conversation.id) {
      throw new BadDataException("This conversation has no messages yet.");
    }

    const message: AIConversationMessage | null =
      await AIConversationMessageService.findOneBy({
        query: {
          _id: data.assistantMessageId.toString(),
          conversationId: conversation.id,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          status: true,
          aiRunId: true,
          toolActions: true,
        },
        props: { isRoot: true },
      });

    if (!message) {
      throw new BadDataException("Message not found in this conversation.");
    }

    if (
      message.status !== AIChatMessageStatus.WaitingForApproval ||
      !message.aiRunId
    ) {
      throw new BadDataException(
        "This answer is no longer waiting for approval.",
      );
    }

    const decisions: Array<ResumeToolDecision> = this.parseDecisions({
      pendingActions: (message.toolActions || []).filter(
        (action: AIChatToolAction): boolean => {
          return (
            action.status === AIChatToolActionStatus.Pending &&
            action.requiresApproval
          );
        },
      ),
      decisions: data.decisions,
      approved: data.approved,
    });

    const run: AIRun | null = await AIRunService.findOneBy({
      query: { _id: message.aiRunId.toString(), projectId: data.projectId },
      select: { _id: true, status: true },
      props: { isRoot: true },
    });

    if (!run || run.status !== AIRunStatus.WaitingForApproval) {
      throw new BadDataException(
        "This answer is no longer waiting for approval.",
      );
    }

    this.resumeTurnInBackground({
      turn: {
        projectId: data.projectId,
        userId: data.userId,
        conversationId: conversation.id,
        assistantMessageId: data.assistantMessageId,
        aiRunId: message.aiRunId,
        llmProviderId: conversation.llmProviderId,
        // Only an Ask-for-approval turn ever pauses.
        permissionMode: AIChatPermissionMode.AskForApproval,
        props: data.props,
      },
      subject: data.subject,
      decisions,
    }).catch((error: unknown) => {
      logger.error(`AI: investigation thread resume crashed: ${error}`);
    });

    return { aiRunId: message.aiRunId };
  }

  // Stop the answer in flight. Anyone who can read the subject may stop it.
  public static async cancelRun(data: {
    projectId: ObjectID;
    subject: InvestigationThreadSubject;
    userId: ObjectID;
  }): Promise<ChatRunCancellationResult> {
    const conversation: AIConversation | null =
      await InvestigationThread.findThread(data);

    const cancellation: ChatRunCancellationResult | null =
      conversation?.id
        ? await ChatRunCancellation.cancelActiveRun({
            projectId: data.projectId,
            conversationId: conversation.id,
            userId: data.userId,
          })
        : null;

    if (!cancellation) {
      throw new BadDataException("OneUptime AI is not answering anything.");
    }

    return cancellation;
  }

  /*
   * Decisions come per action, or as one approve/deny-all. An action left
   * without a decision is denied by the runner — approval is explicit.
   */
  public static parseDecisions(data: {
    pendingActions: Array<AIChatToolAction>;
    decisions?: JSONArray | undefined;
    approved?: boolean | undefined;
  }): Array<ResumeToolDecision> {
    if (data.pendingActions.length === 0) {
      throw new BadDataException(
        "There are no actions waiting for approval on this answer.",
      );
    }

    if (Array.isArray(data.decisions)) {
      const pendingIds: Set<string> = new Set(
        data.pendingActions.map((action: AIChatToolAction): string => {
          return action.id;
        }),
      );
      const decisions: Array<ResumeToolDecision> = [];

      for (const decision of data.decisions) {
        const decisionObject: JSONObject = (decision || {}) as JSONObject;
        const toolCallId: unknown = decisionObject["toolCallId"];

        if (typeof toolCallId === "string" && pendingIds.has(toolCallId)) {
          decisions.push({
            toolCallId,
            approved: decisionObject["approved"] === true,
          });
        }
      }

      return decisions;
    }

    if (typeof data.approved === "boolean") {
      return data.pendingActions.map(
        (action: AIChatToolAction): ResumeToolDecision => {
          return { toolCallId: action.id, approved: data.approved === true };
        },
      );
    }

    throw new BadDataException(
      "Provide either a `decisions` array or an `approved` boolean.",
    );
  }

  /*
   * The plan, the unpaid gate, the project's AI switch and a provider to
   * call — refused up front with the sentence the rest of the product uses,
   * rather than as a failed answer after the fact.
   */
  private static async assertAiAvailable(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (
      IsBillingEnabled &&
      data.props.currentPlan &&
      !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
        PlanType.Growth,
        data.props.currentPlan,
        getAllEnvVars(),
      )
    ) {
      throw new PaymentRequiredException(
        "Please upgrade your plan to Growth to talk to OneUptime AI.",
      );
    }

    if (IsBillingEnabled && data.props.isSubscriptionUnpaid) {
      throw new PaymentRequiredException(
        "Your subscription is unpaid. Please update your payment method to talk to OneUptime AI.",
      );
    }

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: { enableAi: true },
      props: { isRoot: true },
    });

    if (project && project.enableAi === false) {
      throw new BadDataException(AI_DISABLED_MESSAGE);
    }

    const provider: LlmProvider | null =
      await LlmProviderService.getLLMProviderForProject(data.projectId);

    if (!provider) {
      throw new BadDataException(
        "No AI model is set up for this project yet. Add one in Project Settings → AI → LLM Providers, then ask again.",
      );
    }
  }

  // One answer at a time per thread: a second question waits for the first.
  private static async assertThreadIdle(data: {
    projectId: ObjectID;
    conversationId: ObjectID;
  }): Promise<void> {
    const busyRun: AIRun | null = await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        conversationId: data.conversationId,
        status: QueryHelper.any([
          AIRunStatus.Running,
          AIRunStatus.WaitingForApproval,
        ]),
      },
      select: { _id: true, status: true },
      props: { isRoot: true },
    });

    if (!busyRun) {
      return;
    }

    throw new BadDataException(
      busyRun.status === AIRunStatus.WaitingForApproval
        ? "OneUptime AI is waiting for someone to approve or deny an action in this thread. Decide on it (or stop it) before asking something new."
        : "OneUptime AI is still answering a question in this thread. Ask again as soon as it finishes, or stop it.",
    );
  }

  /*
   * The thread's context is rebuilt from current data for every turn (the
   * report may have landed, a cluster may have come online). A failure
   * degrades to a turn without that enrichment — the AI can still query
   * everything itself — never to an unanswered question.
   */
  private static async buildTurnContextSafely(data: {
    projectId: ObjectID;
    subject: InvestigationThreadSubject;
    aiRunId: ObjectID;
  }): Promise<InvestigationThreadTurnContext | null> {
    try {
      return await InvestigationThread.buildTurnContext(data);
    } catch (error) {
      logger.error(
        `AI: could not build the investigation thread context for ${data.subject.type} ${data.subject.id.toString()}; answering without it: ${error}`,
      );
      return null;
    }
  }

  private static async withThreadContext(data: {
    turn: ChatTurnRequest;
    subject: InvestigationThreadSubject;
  }): Promise<ChatTurnRequest> {
    const context: InvestigationThreadTurnContext | null =
      await this.buildTurnContextSafely({
        projectId: data.turn.projectId,
        subject: data.subject,
        aiRunId: data.turn.aiRunId,
      });

    return {
      ...data.turn,
      isSharedThread: true,
      feature: INVESTIGATION_THREAD_FEATURE,
      ...(context
        ? {
            additionalSystemInstructions: context.additionalSystemInstructions,
            extraTools: context.extraTools,
            pageContext: context.pageContext,
          }
        : {}),
    };
  }

  private static async runTurnInBackground(data: {
    turn: ChatTurnRequest;
    subject: InvestigationThreadSubject;
  }): Promise<void> {
    await ChatAgentRunner.runTurn(await this.withThreadContext(data));
  }

  private static async resumeTurnInBackground(data: {
    turn: ChatTurnRequest;
    subject: InvestigationThreadSubject;
    decisions: Array<ResumeToolDecision>;
  }): Promise<void> {
    await ChatAgentRunner.resumeTurn(
      await this.withThreadContext(data),
      data.decisions,
    );
  }
}
