import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentPostmortemActionItem, {
  POSTMORTEM_ACTION_ITEM_UPDATE_PERMISSIONS,
} from "../../../Models/DatabaseModels/IncidentPostmortemActionItem";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import {
  CodeTaskContextItem,
  CodeTaskContextType,
} from "../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Gray500, Green500 } from "../../../Types/BrandColors";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import PartialEntity from "../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PostmortemActionItemStatus, {
  PostmortemActionItemStatusUtil,
} from "../../../Types/Incident/PostmortemActionItemStatus";
import ObjectID from "../../../Types/ObjectID";
import {
  ActionItemCodeTaskKind,
  buildActionItemCodeTaskRequest,
  getPostmortemContextNote,
  MAX_ACTION_ITEM_INSTRUCTIONS_LENGTH,
} from "../../../Utils/Incident/PostmortemActionItemCodeTask";
import {
  actionItemCodeTaskMarkdown,
  actionItemDoneByPullRequestMarkdown,
} from "../../../Utils/Incident/PostmortemActionItemMarkdown";
import AIRunService from "../../Services/AIRunService";
import AIService from "../../Services/AIService";
import IncidentFeedService from "../../Services/IncidentFeedService";
import IncidentPostmortemActionItemService from "../../Services/IncidentPostmortemActionItemService";
import IncidentService from "../../Services/IncidentService";
import CodeTaskAccess from "../AI/CodeTask/CodeTaskAccess";
import CodeTaskContextBuilder from "../AI/CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../AI/CodeTask/CodeTaskGate";
import CodeTaskRuns from "../AI/CodeTask/CodeTaskRuns";
import logger from "../Logger";
import CallerPermission from "../Permission/CallerPermission";
import PrivateRecordWriteCheck from "../Permission/PrivateRecordWriteCheck";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DatabaseService from "../../Services/DatabaseService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * A POSTMORTEM'S ACTION ITEM BECOMES A PULL REQUEST OR A TEST (issue #6801).
 *
 * "Open a pull request" and "Write a test" on an action item ask OneUptime
 * AI to do it in one of the project's repositories: a request in Code
 * (CodeTaskRuns.start) that says what the action item is, with the
 * incident and its postmortem as context (PostmortemActionItemCodeTask).
 * The action item names the task (codeTaskId), so the postmortem shows the
 * task and its pull request - writing, open, merged - and when the pull
 * request merges the action item is done (onPullRequestMerged).
 *
 * As the person asking, and only as far as they may go:
 *
 *   - they read the action item (and so its incident: a private incident's
 *     only its team does), and may change it - the task is written onto it;
 *   - they may ask in the repository, and nothing else stands in the way
 *     (CodeTaskGate: AI switched on for the project, the plan, a provider
 *     and its credits, the daily limits, a connected repository, a Runner),
 *     as for any request in Code - the project's AI switch asked first, so
 *     nothing is read for a request that would not be sent;
 *   - one task at a time: while the item's task is queued or running, a
 *     second is refused - the first is the one to follow, or stop, in Code.
 */

/*
 * What "You do not have permission to ..." says when a private incident's
 * owners do not let the person ask for an action item's pull request.
 */
export const ASK_FOR_ACTION_ITEM_PULL_REQUEST_ACTION: string =
  "ask for this action item's pull request";

// The run statuses of a task still working on its turn.
const ACTIVE_RUN_STATUSES: ReadonlyArray<AIRunStatus> = [
  AIRunStatus.Queued,
  AIRunStatus.Running,
  AIRunStatus.WaitingForApproval,
];

export interface ActionItemCodeTaskStarted {
  taskId: ObjectID;
}

export default class PostmortemActionItemCodeTasks {
  @CaptureSpan()
  public static async start(data: {
    props: DatabaseCommonInteractionProps;
    actionItemId: ObjectID;
    kind: ActionItemCodeTaskKind;
    repositoryId: ObjectID;
    instructions?: string | null | undefined;
  }): Promise<ActionItemCodeTaskStarted> {
    if (!data.props.userId) {
      throw new NotAuthorizedException(
        "Sign in to ask OneUptime AI for a pull request: it is asked by a person, not an API key.",
      );
    }

    const actionItem: IncidentPostmortemActionItem | null =
      await IncidentPostmortemActionItemService.findOneById({
        id: data.actionItemId,
        select: {
          _id: true,
          projectId: true,
          incidentId: true,
          title: true,
          description: true,
          status: true,
          codeTaskId: true,
        },
        props: data.props,
      });

    if (!actionItem || !actionItem.projectId || !actionItem.incidentId) {
      throw new BadDataException(
        "The action item was not found, or you cannot read it. Open the postmortem again, then ask again.",
      );
    }

    const projectId: ObjectID = actionItem.projectId;

    if (
      !CallerPermission.holdsAnyOf(
        data.props,
        POSTMORTEM_ACTION_ITEM_UPDATE_PERMISSIONS,
        { projectId },
      )
    ) {
      throw new NotAuthorizedException(
        "Asking OneUptime AI to write an action item's pull request takes permission to edit the action item. Ask a Project Admin for the Edit Postmortem Action Item permission.",
      );
    }

    /*
     * A private incident's action item is changed only through the
     * incident's owners, as every part of a private record is
     * (PrivateRecordPermission): the permission above counts only through
     * a team that owns it, or for a person named as its owner. The task is
     * written onto the item as OneUptime below, so it is asked here.
     */
    await PrivateRecordWriteCheck.assertReaches({
      modelType: IncidentPostmortemActionItem,
      type: DatabaseRequestType.Update,
      recordService:
        IncidentService as unknown as DatabaseService<DatabaseBaseModel>,
      recordId: actionItem.incidentId,
      props: data.props,
      action: ASK_FOR_ACTION_ITEM_PULL_REQUEST_ACTION,
    });

    if (PostmortemActionItemStatusUtil.isClosed(actionItem.status)) {
      throw new BadDataException(
        "This action item is closed. Reopen it first, then ask OneUptime AI for its pull request.",
      );
    }

    // AI switched off for the project: refused before anything is read for the request.
    await AIService.assertProjectAIEnabled(projectId);

    if (actionItem.codeTaskId) {
      const task: AIRun | null = await AIRunService.findOneById({
        id: actionItem.codeTaskId,
        select: { _id: true, status: true },
        props: { isRoot: true },
      });

      // A reply in Code is a run of its own: the task works while its newest turn does.
      const latestTurn: AIRun | null = task
        ? await CodeTaskRuns.getLatestTurn({ projectId, task })
        : null;

      if (
        latestTurn?.status &&
        ACTIVE_RUN_STATUSES.includes(latestTurn.status)
      ) {
        throw new BadDataException(
          "OneUptime AI is still working on this action item's task. Follow it in Code, or stop it there before you ask again.",
        );
      }
    }

    const repository: CodeRepository =
      await CodeTaskAccess.getReadableRepository({
        props: data.props,
        projectId,
        repositoryId: data.repositoryId,
      });

    await CodeTaskGate.assertCanStart({
      props: data.props,
      projectId,
      repository,
      canAsk: await CodeTaskAccess.canAskInRepository({
        props: data.props,
        projectId,
        repositoryId: data.repositoryId,
      }),
    });

    const incident: Incident | null = await IncidentService.findOneById({
      id: actionItem.incidentId,
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        postmortemNote: true,
      },
      props: data.props,
    });

    if (!incident) {
      throw new BadDataException(
        "The incident this action item is from was not found, or you cannot read it.",
      );
    }

    const instructions: string =
      typeof data.instructions === "string" ? data.instructions.trim() : "";

    if (instructions.length > MAX_ACTION_ITEM_INSTRUCTIONS_LENGTH) {
      throw new BadDataException(
        `What you add for OneUptime AI can be at most ${MAX_ACTION_ITEM_INSTRUCTIONS_LENGTH.toString()} characters. Shorten it, and put the rest in the action item's description.`,
      );
    }

    const message: string = buildActionItemCodeTaskRequest({
      kind: data.kind,
      title: actionItem.title || "",
      description: actionItem.description,
      incidentNumber:
        incident.incidentNumberWithPrefix ||
        (incident.incidentNumber !== undefined &&
        incident.incidentNumber !== null
          ? `#${incident.incidentNumber.toString()}`
          : undefined),
      incidentTitle: incident.title,
      instructions,
    });

    const context: Array<CodeTaskContextItem> =
      await CodeTaskContextBuilder.build({
        projectId,
        props: data.props,
        inputs: [
          {
            type: CodeTaskContextType.Incident,
            id: actionItem.incidentId.toString(),
          },
        ],
      });

    const postmortem: string | null = getPostmortemContextNote(
      incident.postmortemNote,
    );

    if (postmortem) {
      context.push(
        await CodeTaskContextBuilder.buildItem(
          { type: CodeTaskContextType.Note, text: postmortem },
          { projectId, props: data.props },
        ),
      );
    }

    const run: AIRun = await CodeTaskRuns.start({
      projectId,
      userId: data.props.userId,
      repository,
      message,
      context,
    });

    await IncidentPostmortemActionItemService.updateColumnsByIdWithoutHooks({
      id: data.actionItemId,
      data: {
        codeTaskId: run.id!,
      } as unknown as PartialEntity<IncidentPostmortemActionItem>,
    });

    try {
      await IncidentFeedService.createIncidentFeedItem({
        projectId,
        incidentId: actionItem.incidentId,
        incidentFeedEventType: IncidentFeedEventType.PostmortemNote,
        feedInfoInMarkdown: actionItemCodeTaskMarkdown({
          title: actionItem.title || "",
          kind: data.kind,
          repositoryName: repository.name || "",
        }).toString(),
        displayColor: Gray500,
        userId: data.props.userId,
      });
    } catch (error) {
      // The task is started; what the feed says about it must not undo that.
      logger.error(
        `PostmortemActionItemCodeTasks: could not record the task for action item ${data.actionItemId.toString()}:`,
      );
      logger.error(error);
    }

    return { taskId: run.id! };
  }

  /*
   * A pull request OneUptime AI opened merged: every open action item whose
   * task it is - the run that opened it, or the task that run is a turn of
   * - is done, by OneUptime, and its incident's feed says so. Best effort:
   * it never throws, so the pull request sweep that calls it goes on.
   */
  @CaptureSpan()
  public static async onPullRequestMerged(data: {
    aiRunId: ObjectID;
    pullRequestNumber?: number | undefined;
  }): Promise<number> {
    try {
      const run: AIRun | null = await AIRunService.findOneById({
        id: data.aiRunId,
        select: { _id: true, codeTaskId: true },
        props: { isRoot: true },
      });

      if (!run || !run.id) {
        return 0;
      }

      const taskId: ObjectID = run.codeTaskId || run.id;

      const items: Array<IncidentPostmortemActionItem> =
        await IncidentPostmortemActionItemService.findBy({
          query: {
            codeTaskId: taskId,
            status: PostmortemActionItemStatus.Open,
          },
          select: {
            _id: true,
            projectId: true,
            incidentId: true,
            title: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        });

      let doneCount: number = 0;

      for (const item of items) {
        if (!item.id || !item.projectId || !item.incidentId) {
          continue;
        }

        await IncidentPostmortemActionItemService.updateColumnsByIdWithoutHooks(
          {
            id: item.id,
            data: {
              status: PostmortemActionItemStatus.Done,
              closedAt: OneUptimeDate.getCurrentDate(),
              closedByUserId: null,
            } as unknown as PartialEntity<IncidentPostmortemActionItem>,
            // Only while it is still open: a person's close in the meantime stands.
            expectedData: {
              status: PostmortemActionItemStatus.Open,
            } as unknown as PartialEntity<IncidentPostmortemActionItem>,
          },
        );

        doneCount++;

        await IncidentFeedService.createIncidentFeedItem({
          projectId: item.projectId,
          incidentId: item.incidentId,
          incidentFeedEventType: IncidentFeedEventType.PostmortemNote,
          feedInfoInMarkdown: actionItemDoneByPullRequestMarkdown({
            title: item.title || "",
            pullRequestNumber: data.pullRequestNumber,
          }).toString(),
          displayColor: Green500,
        });
      }

      return doneCount;
    } catch (error) {
      logger.error(
        `PostmortemActionItemCodeTasks: could not close the action items of the merged pull request of run ${data.aiRunId.toString()}:`,
      );
      logger.error(error);
      return 0;
    }
  }
}
