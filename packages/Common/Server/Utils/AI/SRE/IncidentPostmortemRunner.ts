import ObjectID from "../../../../Types/ObjectID";
import { Blue500 } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Incident from "../../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import Project from "../../../../Models/DatabaseModels/Project";
import IncidentService from "../../../Services/IncidentService";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import IncidentVideoCallService from "../../../Services/IncidentVideoCallService";
import ProjectService from "../../../Services/ProjectService";
import AIService from "../../../Services/AIService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AIInvestigationEngine from "./AIInvestigationEngine";
import IncidentPostmortemCallWait from "./IncidentPostmortemCallWait";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * AI SRE — auto-draft postmortem on resolve (Phase 3, "close the loop").
 *
 * When an incident moves to a resolved state, AI drafts a postmortem from
 * the incident timeline + telemetry (reusing the existing
 * IncidentService.generatePostmortemFromAI) and saves it to the incident for a
 * human to review and edit — turning a ~90-minute manual writeup into a review.
 *
 * It NEVER overwrites a postmortem that already exists (human work wins),
 * never drafts into one already switched on for the status page (the draft
 * would go out unreviewed, and subscribers be told about it), is
 * gated by its own per-project opt-in (Project.enableAutomaticPostmortemDraft)
 * plus the same AI switch, LLM provider, AI balance and project daily AI
 * limits as investigations, and is fire-and-forget: failures are logged,
 * never surfaced to the resolve flow.
 *
 * It reads what was said on the incident's calls too, so when a call's
 * transcript is still on its way at the resolve - the call ended with the
 * incident - the draft waits for it (IncidentPostmortemCallWait), and is
 * written once the transcript has been read or no longer can be.
 */
const MAX_FEED_PREVIEW_CHARS: number = 6000;

// The most drafts that wait one run of the Workers job looks at.
const MAX_WAITING_DRAFTS_PER_RUN: number = 100;

// What deciding on, and writing, a draft reads of the incident.
const DRAFT_SELECT: {
  _id: true;
  incidentNumber: true;
  postmortemNote: true;
  showPostmortemOnStatusPage: true;
} = {
  _id: true,
  incidentNumber: true,
  postmortemNote: true,
  showPostmortemOnStatusPage: true,
};

export default class AIIncidentPostmortemRunner {
  /*
   * The draft has its own switch, separate from automatic incident
   * investigation, because a draft writes to the incident and posts to the
   * project's Slack/Teams channels where an investigation only reads. Both
   * are on for new projects; a project that existed before keeps its own
   * value, and unset reads as off (=== true). The AI kill switch, the LLM
   * provider, the AI balance and the project's own daily AI limits gate it
   * exactly as they gate an investigation: a draft refused by a limit would
   * only log an error for every incident resolved until midnight UTC.
   */
  public static async isEnabledForProject(
    projectId: ObjectID,
  ): Promise<boolean> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        enableAi: true,
        enableAutomaticPostmortemDraft: true,
        aiDailyTokenLimit: true,
        aiDailySpendLimitInUSD: true,
        aiDailyTokenLimitReachedAt: true,
        aiDailySpendLimitReachedAt: true,
      },
      props: { isRoot: true },
    });

    if (
      !project ||
      project.enableAi === false ||
      project.enableAutomaticPostmortemDraft !== true
    ) {
      return false;
    }

    if (
      (await AIInvestigationEngine.getProviderOrBalanceReason(projectId)) !==
      null
    ) {
      return false;
    }

    return (
      (await AIService.getReachedProjectDailyLimit({ projectId, project })) ===
      null
    );
  }

  @CaptureSpan()
  public static async draftPostmortemOnResolve(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    // When the incident resolved; now unless a test says otherwise.
    now?: Date | undefined;
  }): Promise<void> {
    const { incidentId, projectId } = data;

    try {
      if (!(await this.isEnabledForProject(projectId))) {
        return;
      }

      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentId,
        select: DRAFT_SELECT,
        props: { isRoot: true },
      });

      if (!incident || !AIIncidentPostmortemRunner.isDraftable(incident)) {
        return;
      }

      /*
       * The draft reads what was said on the incident's calls, and a call
       * usually ends about when the incident does: its transcript, and
       * OneUptime AI's reading of it, come after the resolve. While one is
       * on its way the draft waits for it (IncidentPostmortemCallWait); a
       * finished reading, a call that will get no transcript, or the job
       * that looks again once the wait is over writes it
       * (draftWaitingPostmortem).
       */
      const now: Date = data.now || new Date();

      if (
        await IncidentPostmortemCallWait.isWaiting({
          incidentId,
          waitingSince: now,
          now,
        })
      ) {
        await IncidentService.startPostmortemDraftWait({
          incidentId,
          waitingSince: now,
        });

        logger.debug(
          `AI: the postmortem draft of incident ${incidentId.toString()} waits for its calls' transcripts.`,
        );
        return;
      }

      await AIIncidentPostmortemRunner.writeDraft({
        incidentId,
        projectId,
        incidentNumber: incident.incidentNumber,
      });
    } catch (error) {
      logger.error(
        `AI: failed to draft postmortem for incident ${incidentId.toString()}: ${error}`,
      );
    }
  }

  /*
   * Writes a draft that waited for the incident's calls, once nothing more
   * is expected from them - every reading done, no transcript still on its
   * way, or the wait's longest is over - and only for an incident that is
   * still resolved, still has no postmortem, and whose project still drafts
   * them. Whoever ends the wait writes the draft
   * (IncidentService.endPostmortemDraftWait), so a reading that finishes
   * while the job looks again never writes it twice. An incident reopened
   * meanwhile stops waiting: its next resolve decides again.
   */
  @CaptureSpan()
  public static async draftWaitingPostmortem(data: {
    incidentId: ObjectID;
    now?: Date | undefined;
  }): Promise<void> {
    const now: Date = data.now || new Date();

    const incident: Incident | null = await IncidentService.findOneById({
      id: data.incidentId,
      select: {
        ...DRAFT_SELECT,
        projectId: true,
        currentIncidentStateId: true,
        postmortemDraftWaitingSince: true,
      },
      props: { isRoot: true },
    });

    if (
      !incident ||
      !incident.projectId ||
      !incident.postmortemDraftWaitingSince
    ) {
      return;
    }

    const waitingSince: Date = OneUptimeDate.fromString(
      incident.postmortemDraftWaitingSince,
    );
    const isResolved: boolean = await IncidentPostmortemCallWait.isResolved({
      projectId: incident.projectId,
      currentIncidentStateId: incident.currentIncidentStateId,
    });

    if (
      isResolved &&
      (await IncidentPostmortemCallWait.isWaiting({
        incidentId: data.incidentId,
        waitingSince,
        now,
      }))
    ) {
      return;
    }

    const ended: number = await IncidentService.endPostmortemDraftWait({
      incidentId: data.incidentId,
      waitingSince: incident.postmortemDraftWaitingSince,
    });

    if (ended === 0 || !isResolved) {
      return;
    }

    if (
      !AIIncidentPostmortemRunner.isDraftable(incident) ||
      !(await this.isEnabledForProject(incident.projectId))
    ) {
      return;
    }

    await AIIncidentPostmortemRunner.writeDraft({
      incidentId: data.incidentId,
      projectId: incident.projectId,
      incidentNumber: incident.incidentNumber,
    });
  }

  /*
   * Every draft that waits for its incident's calls, for the Workers job
   * that looks again every few minutes: the ones whose wait is over are
   * written, the rest wait on. One that fails is logged; the others go on.
   */
  @CaptureSpan()
  public static async draftWaitingPostmortems(
    options: {
      now?: Date | undefined;
      limit?: number | undefined;
    } = {},
  ): Promise<void> {
    const incidents: Array<Incident> = await IncidentService.findBy({
      query: { postmortemDraftWaitingSince: QueryHelper.notNull() },
      select: { _id: true },
      sort: { postmortemDraftWaitingSince: SortOrder.Ascending },
      skip: 0,
      limit: options.limit || MAX_WAITING_DRAFTS_PER_RUN,
      props: { isRoot: true },
    });

    for (const incident of incidents) {
      try {
        await AIIncidentPostmortemRunner.draftWaitingPostmortem({
          incidentId: incident.id!,
          now: options.now,
        });
      } catch (error) {
        logger.error(
          `AI: failed to draft a postmortem that waited for its calls, for incident ${incident.id?.toString()}: ${error}`,
        );
      }
    }
  }

  // A postmortem the draft may be written into: none yet, and not on the status page.
  private static isDraftable(incident: Incident): boolean {
    // Never clobber an existing postmortem (human or previously drafted).
    if (incident.postmortemNote && incident.postmortemNote.trim().length > 0) {
      return false;
    }

    /*
     * A draft is for a human to review. Saved into a postmortem already
     * switched on for the status page, it would be the note the status
     * page shows the moment it is written - published unreviewed, and
     * announced to every subscriber (IncidentPostmortemPublication).
     */
    return incident.showPostmortemOnStatusPage !== true;
  }

  private static async writeDraft(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    incidentNumber?: number | undefined;
  }): Promise<void> {
    const { incidentId, projectId } = data;

    /*
     * The draft is written from the incident's timeline and telemetry,
     * which can carry text meant to steer the model. It is saved on the
     * incident and previewed in its feed as the Markdown the model wrote,
     * with nothing in it that acts on its own: no chat mention, no image
     * or diagram, no link whose words hide where it goes, no HTML tag
     * (FeedMarkdown.aiWritten).
     */
    const draft: string = FeedMarkdown.aiWritten(
      await IncidentService.generatePostmortemFromAI({
        incidentId,
      }),
    ).toString();

    if (!draft || !draft.trim()) {
      return;
    }

    await IncidentService.updateOneById({
      id: incidentId,
      data: {
        postmortemNote: draft,
      },
      props: { isRoot: true },
    });

    // The calls whose transcripts the draft read, if any.
    const callsRead: number = (
      await IncidentVideoCallService.countBy({
        query: { incidentId, transcriptAddedAt: QueryHelper.notNull() },
        props: { isRoot: true },
      })
    ).toNumber();

    const sources: string =
      callsRead > 0
        ? "the incident timeline, telemetry and what was said on its calls"
        : "the incident timeline and telemetry";

    await IncidentFeedService.createIncidentFeedItem({
      incidentId,
      projectId,
      incidentFeedEventType: IncidentFeedEventType.PostmortemNote,
      displayColor: Blue500,
      feedInfoInMarkdown:
        mdText`## 🧠 AI — Draft Postmortem\n\nOneUptime AI drafted a postmortem for incident #${data.incidentNumber} from ${sources}. It has been saved on the incident for you to review and edit.`.toString(),
      moreInformationInMarkdown:
        draft.length > MAX_FEED_PREVIEW_CHARS
          ? mdText`${FeedMarkdown.asMarkdown(draft.substring(0, MAX_FEED_PREVIEW_CHARS))}\n\n…(truncated — the full draft is saved on the incident.)`.toString()
          : draft,
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    logger.debug(
      `AI: drafted postmortem for incident ${incidentId.toString()}.`,
    );
  }
}
