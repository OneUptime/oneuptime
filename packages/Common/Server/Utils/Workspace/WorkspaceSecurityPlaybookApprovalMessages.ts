import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import WorkspaceLiveMessage from "../../../Models/DatabaseModels/WorkspaceLiveMessage";
import ObjectID from "../../../Types/ObjectID";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookStepResult,
  readStepResults,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { DEFAULT_READER_LANGUAGE } from "../../../Types/ReaderLanguage";
import { NotificationRuleUpdateKind } from "../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import WorkspaceLiveMessageKey, {
  WorkspaceLiveMessageData,
  WorkspaceLiveMessageDestinationType,
} from "../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceLiveMessageService from "../../Services/WorkspaceLiveMessageService";
import WorkspaceNotificationRuleService from "../../Services/WorkspaceNotificationRuleService";
import { WorkspaceSentDirectMessage } from "../../Services/WorkspaceUserNotificationService";
import logger, { LogAttributes } from "../Logger";
import SecurityPlaybookApprovalReader, {
  SecurityPlaybookApprovalRead,
} from "../SecurityPlaybook/SecurityPlaybookApprovalReader";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceLiveMessages, {
  WorkspaceLiveMessageEdit,
} from "./LiveMessages/WorkspaceLiveMessages";
import WorkspaceSecurityPlaybookApproval, {
  SecurityPlaybookApprovalMessage,
} from "./WorkspaceSecurityPlaybookApproval";
import WorkspaceStoredValue from "./WorkspaceStoredValue";

/*
 * EVERY COPY OF A PLAYBOOK STEP'S APPROVAL MESSAGE, KEPT AND EDITED IN PLACE
 * (#10341).
 *
 * A step that waits for approval is posted to the channels and chats the
 * case's Security Case rules name for approvals (postToChannels), and sent
 * to each approver who chose Slack or Microsoft Teams for it, in their own
 * language (keepDirectMessage, through SecurityCaseNotifications). Each copy
 * is kept as it lands (WorkspaceLiveMessages) under the approval's key: the
 * run and the step.
 *
 * Once anything about the approval changes - somebody approves or rejects it
 * here, in another copy, in the Dashboard or the mobile app; the step runs
 * and finishes; a target is undone; the run is cancelled - every copy is
 * drawn again from the run as it is then (refreshRun), in the language it
 * was written in: who decided, when, how each target went, and no buttons
 * but Open Case. Each pass reads the run inside the approval's lock, so
 * passes started in any order end on what is true.
 *
 *  - Never on the way of what changed it: a pass runs in the background
 *    (refreshInBackground) and never throws; a copy that cannot be edited -
 *    deleted, the app removed, the token revoked - is logged and skipped,
 *    and a press on it is still told who decided.
 *  - A copy is edited only through the project's connection to the
 *    workspace it was sent through.
 *  - A direct message an approver deleted stays deleted.
 *  - A copy sent as the approval moved on - its message on its way while
 *    somebody decided - is drawn again as soon as it is kept.
 */
export default class WorkspaceSecurityPlaybookApprovalMessages {
  // The passes running in the background, for settle.
  private static running: Set<Promise<void>> = new Set<Promise<void>>();

  // The key every copy of a step's approval is kept under.
  public static getMessageKey(data: {
    runId: ObjectID;
    stepIndex: number;
  }): string {
    return WorkspaceLiveMessageKey.forSecurityPlaybookApproval(
      data.runId,
      data.stepIndex,
    );
  }

  /*
   * Runs `work` in the background: the caller goes on at once, and nothing
   * of `work` - not its first read, not a failure - reaches it. A failure is
   * logged.
   */
  public static inBackground(what: string, work: () => Promise<unknown>): void {
    const run: Promise<void> = Promise.resolve()
      .then(work)
      .then(
        (): void => {
          return undefined;
        },
        (err: unknown): void => {
          logger.error(`Playbook step approval: could not ${what}.`);
          logger.error(err);
        },
      );

    WorkspaceSecurityPlaybookApprovalMessages.running.add(run);

    void run.then((): void => {
      WorkspaceSecurityPlaybookApprovalMessages.running.delete(run);
    });
  }

  /*
   * Waits for the passes started so far, and for those they start: what a
   * test, or a process about to stop, waits on.
   */
  public static async settle(): Promise<void> {
    while (WorkspaceSecurityPlaybookApprovalMessages.running.size > 0) {
      await Promise.all(
        Array.from(WorkspaceSecurityPlaybookApprovalMessages.running),
      );
    }
  }

  // ---------- posting and keeping ----------

  /*
   * Posts the approval to every channel and chat the case's Security Case
   * rules name for approvals (NotificationRuleUpdates' Approval Requested -
   * a rule saved before rules chose their notices posts it too), in
   * English as every channel post is, in each workspace the project is
   * connected to, and keeps each post. A place it cannot be posted in is
   * logged in Notification Logs and left out. How many were kept.
   */
  @CaptureSpan()
  public static async postToChannels(data: {
    read: SecurityPlaybookApprovalRead;
  }): Promise<number> {
    const { read } = data;
    const projectId: ObjectID = read.round.projectId;
    const messageKey: string =
      WorkspaceSecurityPlaybookApprovalMessages.getMessageKey(read.round);
    const logAttributes: LogAttributes = {
      projectId: projectId.toString(),
    } as LogAttributes;
    let kept: number = 0;

    for (const workspaceType of await WorkspaceLiveMessages.getConnectedWorkspaceTypes(
      projectId,
    )) {
      let destinations: Array<WorkspaceMessagePayload> = [];

      try {
        destinations =
          await WorkspaceNotificationRuleService.getMessageDestinations({
            projectId,
            notificationFor: { securityCaseId: read.round.securityCaseId },
            workspaceType,
            updateKinds: [NotificationRuleUpdateKind.ApprovalRequested],
          });
      } catch (err) {
        logger.error(
          `Could not read where a playbook step's approval goes in ${workspaceType}.`,
          logAttributes,
        );
        logger.error(err, logAttributes);
        continue;
      }

      if (destinations.length === 0) {
        continue;
      }

      const message: SecurityPlaybookApprovalMessage =
        WorkspaceSecurityPlaybookApproval.getMessage({
          ask: read.ask,
          round: read.round,
          workspaceType,
          language: DEFAULT_READER_LANGUAGE,
        });

      for (const destination of destinations) {
        try {
          const keptMessage: WorkspaceLiveMessage | null =
            await WorkspaceLiveMessages.postAndKeep({
              projectId,
              messageKey,
              destination: {
                ...destination,
                messageBlocks: message.messageBlocks,
                text: message.notificationText,
              },
              messageData: { language: DEFAULT_READER_LANGUAGE },
              notificationFor: { securityCaseId: read.round.securityCaseId },
            });

          if (keptMessage) {
            kept++;
          }
        } catch (err) {
          logger.error(
            `Could not post a playbook step's approval in ${workspaceType}.`,
            logAttributes,
          );
          logger.error(err, logAttributes);
        }
      }
    }

    /*
     * Decided while it was being posted: drawn again now, so no copy asks
     * what somebody answered a moment ago.
     */
    if (kept > 0) {
      await WorkspaceSecurityPlaybookApprovalMessages.refreshStep({
        projectId,
        runId: read.round.runId,
        stepIndex: read.round.stepIndex,
      });
    }

    return kept;
  }

  /*
   * Keeps a copy of the approval as it was sent to one approver's direct
   * messages (WorkspaceUserNotificationService's onSent), in their
   * language, to edit it once the approval moves on. A copy that asks about
   * an approval that moved on while it was on its way is drawn again at
   * once. Best effort: a copy that cannot be kept keeps its buttons, and a
   * press on it is still told who decided.
   */
  @CaptureSpan()
  public static async keepDirectMessage(data: {
    read: SecurityPlaybookApprovalRead;
    userId: ObjectID;
    language: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
    sent: WorkspaceSentDirectMessage;
  }): Promise<void> {
    const { read, sent } = data;
    const projectId: ObjectID = read.round.projectId;
    const logAttributes: LogAttributes = {
      projectId: projectId.toString(),
      workspaceType: sent.workspaceType,
    } as LogAttributes;

    if (
      !WorkspaceStoredValue.isStorableId(sent.channelId) ||
      !WorkspaceStoredValue.isStorableId(sent.messageId)
    ) {
      logger.debug(
        "A playbook step's approval was sent, but where it landed cannot be kept, so it is not edited once somebody decides.",
        logAttributes,
      );
      return;
    }

    const messageData: WorkspaceLiveMessageData = {
      language: data.language,
      directMessageUserId: data.userId.toString(),
      workspaceProjectId: sent.workspaceProjectId,
      ...(sent.serviceUrl ? { serviceUrl: sent.serviceUrl } : {}),
    };

    const keptMessage: WorkspaceLiveMessage = new WorkspaceLiveMessage();
    keptMessage.projectId = projectId;
    keptMessage.workspaceType = sent.workspaceType;
    keptMessage.messageKey =
      WorkspaceSecurityPlaybookApprovalMessages.getMessageKey(read.round);
    // A Microsoft Teams direct message is a personal chat; Slack's, a channel.
    keptMessage.destinationType =
      sent.workspaceType === WorkspaceType.MicrosoftTeams
        ? WorkspaceLiveMessageDestinationType.Chat
        : WorkspaceLiveMessageDestinationType.Channel;
    keptMessage.channelId = sent.channelId;
    keptMessage.channelName = "";
    keptMessage.messageId = sent.messageId;
    keptMessage.contentHash = WorkspaceLiveMessages.getContentHash(
      data.messageBlocks,
    );
    keptMessage.messageData = messageData;

    try {
      await WorkspaceLiveMessageService.create({
        data: keptMessage,
        props: { isRoot: true },
      });
    } catch (err) {
      logger.error(
        "A playbook step's approval was sent, but OneUptime could not keep it to edit it once somebody decides.",
        logAttributes,
      );
      logger.error(err, logAttributes);
      return;
    }

    // Decided, or changed, while it was on its way: drawn again now.
    await WorkspaceSecurityPlaybookApprovalMessages.refreshStep({
      projectId,
      runId: read.round.runId,
      stepIndex: read.round.stepIndex,
    });
  }

  // ---------- drawing them again ----------

  /*
   * Once anything about a run's approvals changes: every kept copy of each,
   * drawn again in the background (refreshRun).
   */
  public static refreshInBackground(data: {
    projectId: ObjectID;
    runId: ObjectID;
  }): void {
    WorkspaceSecurityPlaybookApprovalMessages.inBackground(
      "update the chat messages of a playbook run's approval",
      async (): Promise<number> => {
        return await WorkspaceSecurityPlaybookApprovalMessages.refreshRun(data);
      },
    );
  }

  /*
   * Every kept copy of the run's approvals, drawn again as each stands now:
   * the step the run waits on, and each step that was asked about. How
   * many were edited.
   */
  @CaptureSpan()
  public static async refreshRun(data: {
    projectId: ObjectID;
    runId: ObjectID;
  }): Promise<number> {
    const run: SecurityPlaybookRun | null =
      await SecurityPlaybookApprovalReader.readRun(data);

    if (!run) {
      return 0;
    }

    let steps: Array<SecurityPlaybookStep>;

    try {
      steps = parseSecurityPlaybookSteps(run.steps);
    } catch {
      return 0;
    }

    const results: Array<SecurityPlaybookStepResult> = readStepResults(
      run.stepResults,
      steps,
    );

    let edited: number = 0;

    for (let stepIndex: number = 0; stepIndex < steps.length; stepIndex++) {
      const result: SecurityPlaybookStepResult | undefined = results[stepIndex];
      const wasAsked: boolean = Boolean(
        result?.approval ||
          result?.status === SecurityPlaybookStepStatus.WaitingForApproval ||
          stepIndex === (run.currentStepIndex || 0),
      );

      if (!wasAsked) {
        continue;
      }

      edited += await WorkspaceSecurityPlaybookApprovalMessages.refreshStep({
        projectId: data.projectId,
        runId: data.runId,
        stepIndex,
      });
    }

    return edited;
  }

  /*
   * Every kept copy of one step's approval, drawn again from the run as it
   * is now, each in its own chat and language. Done holding the approval's
   * key, with the run read inside it: two passes a moment apart end on the
   * newer. Never throws. How many were edited.
   */
  @CaptureSpan()
  public static async refreshStep(data: {
    projectId: ObjectID;
    runId: ObjectID;
    stepIndex: number;
  }): Promise<number> {
    const messageKey: string =
      WorkspaceSecurityPlaybookApprovalMessages.getMessageKey(data);

    try {
      return await WorkspaceLiveMessages.withLock(
        messageKey,
        async (): Promise<number> => {
          const kept: Array<WorkspaceLiveMessage> =
            await WorkspaceLiveMessageService.findByMessageKey({
              projectId: data.projectId,
              messageKey,
            });

          if (kept.length === 0) {
            return 0;
          }

          const read: SecurityPlaybookApprovalRead | null =
            await SecurityPlaybookApprovalReader.read({
              projectId: data.projectId,
              runId: data.runId,
              stepIndex: data.stepIndex,
            });

          // Gone with its run or case: a press on a copy says so.
          if (!read) {
            return 0;
          }

          let edited: number = 0;

          for (const keptMessage of kept) {
            if (!keptMessage.workspaceType) {
              continue;
            }

            const message: SecurityPlaybookApprovalMessage =
              WorkspaceSecurityPlaybookApproval.getMessage({
                ask: read.ask,
                round: read.round,
                workspaceType: keptMessage.workspaceType,
                language:
                  keptMessage.messageData?.language || DEFAULT_READER_LANGUAGE,
              });

            try {
              const edit: WorkspaceLiveMessageEdit =
                await WorkspaceLiveMessages.updateKept({
                  keptMessage,
                  messageBlocks: message.messageBlocks,
                  text: message.notificationText,
                });

              if (
                edit === WorkspaceLiveMessageEdit.Updated ||
                edit === WorkspaceLiveMessageEdit.Reposted
              ) {
                edited++;
              }
            } catch (err) {
              logger.error(
                `Could not update a playbook step's approval in ${keptMessage.workspaceType}.`,
                { projectId: data.projectId.toString() } as LogAttributes,
              );
              logger.error(err, {
                projectId: data.projectId.toString(),
              } as LogAttributes);
            }
          }

          return edited;
        },
      );
    } catch (err) {
      logger.error(
        "Could not update the chat messages of a playbook step's approval.",
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      logger.error(err, {
        projectId: data.projectId.toString(),
      } as LogAttributes);
      return 0;
    }
  }
}
