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
import PostmortemRules, {
  POSTMORTEM_RULE_INCIDENT_SELECT,
  PostmortemDraftPlan,
  PostmortemRuleTemplate,
} from "./PostmortemRules";
import PostmortemTemplatePick from "./PostmortemTemplatePick";
import LlmProviderChoice, { RuleLlmProviderChoice } from "../LlmProviderChoice";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import {
  LlmProviderFallbackReason,
  LlmProviderSource,
} from "../../../../Types/AI/LlmProviderChoice";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import { AiContextActivity } from "../../../../Types/AI/AiContext";
import AiContextReader from "../AiContext/AiContextReader";

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
 *
 * The project's postmortem rules, when it has any, say which incidents get a
 * draft and which templates it may follow (PostmortemRules): with none,
 * every resolved incident gets one in OneUptime AI's standard outline; with
 * rules, only an incident one of them matches does, following the
 * template(s) of the first rule that matches - OneUptime AI picks the one
 * that fits best when there are several (PostmortemTemplatePick). The rules
 * are read when the incident resolves, and again when a draft that waited
 * for its calls is written.
 *
 * That rule's LLM provider writes the draft - the template pick included -
 * when it picks one (Server/Utils/AI/LlmProviderChoice), and the provider
 * checks ask about it: a rule's own provider drafts in a project whose
 * default cannot. The draft's feed item names the provider a rule picked,
 * and says why another was used when it could not be.
 */
const MAX_FEED_PREVIEW_CHARS: number = 6000;

// The most drafts that wait one run of the Workers job looks at.
const MAX_WAITING_DRAFTS_PER_RUN: number = 100;

/*
 * What deciding on, and writing, a draft reads of the incident: its
 * postmortem, and what the project's postmortem rules match on.
 */
const DRAFT_SELECT: {
  _id: true;
  incidentNumber: true;
  postmortemNote: true;
  showPostmortemOnStatusPage: true;
} & typeof POSTMORTEM_RULE_INCIDENT_SELECT = {
  _id: true,
  incidentNumber: true,
  postmortemNote: true,
  showPostmortemOnStatusPage: true,
  ...POSTMORTEM_RULE_INCIDENT_SELECT,
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
    /*
     * The LLM provider the postmortem rule that matched picks, when one
     * does: the provider, AI credits and spend asked about are the ones
     * the draft would use.
     */
    llmProviderId?: ObjectID | undefined,
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

    if (!AIIncidentPostmortemRunner.isDraftingOn(project)) {
      return false;
    }

    if (
      (await AIInvestigationEngine.getProviderOrBalanceReason(
        projectId,
        llmProviderId,
      )) !== null
    ) {
      return false;
    }

    // The spend limit stops a draft only on a provider AI credits pay for.
    const llmProvider: LlmProvider | null | undefined = llmProviderId
      ? (
          await LlmProviderChoice.decide({
            projectId,
            pickedProviderId: llmProviderId,
          })
        ).providerRow
      : undefined;

    return (
      (await AIService.getReachedProjectDailyLimit({
        projectId,
        project,
        ...(llmProvider !== undefined ? { llmProvider } : {}),
      })) === null
    );
  }

  /*
   * The two switches: AI on, and drafting on (=== true: unset reads as
   * off). The cheap half of isEnabledForProject, asked before the incident
   * and its rules are read.
   */
  private static isDraftingOn(project: Project | null): boolean {
    return Boolean(
      project &&
        project.enableAi !== false &&
        project.enableAutomaticPostmortemDraft === true,
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
      // The switches first: with drafting off, nothing else is read.
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          enableAi: true,
          enableAutomaticPostmortemDraft: true,
        },
        props: { isRoot: true },
      });

      if (!AIIncidentPostmortemRunner.isDraftingOn(project)) {
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
       * The project's postmortem rules, when it has any: only an incident
       * one of them matches gets a draft. Decided before any wait, so an
       * incident no rule matches waits for nothing.
       */
      const plan: PostmortemDraftPlan | null =
        await AIIncidentPostmortemRunner.getDraftPlan({ projectId, incident });

      if (!plan) {
        return;
      }

      /*
       * A provider to write it with, AI credits for it and room under the
       * daily AI limits - for the provider the matching rule picks, when it
       * picks one.
       */
      if (!(await this.isEnabledForProject(projectId, plan.llmProviderId))) {
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
        plan,
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

    if (!AIIncidentPostmortemRunner.isDraftable(incident)) {
      return;
    }

    // The rules as they are now: a rule changed during the wait decides.
    const plan: PostmortemDraftPlan | null =
      await AIIncidentPostmortemRunner.getDraftPlan({
        projectId: incident.projectId,
        incident,
      });

    if (
      !plan ||
      !(await this.isEnabledForProject(incident.projectId, plan.llmProviderId))
    ) {
      return;
    }

    await AIIncidentPostmortemRunner.writeDraft({
      incidentId: data.incidentId,
      projectId: incident.projectId,
      incidentNumber: incident.incidentNumber,
      plan,
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

  /*
   * Whether the project's postmortem rules give the incident a draft, and
   * the templates it may follow - null when they do not: no rule matches it,
   * or the rules could not be read (PostmortemRules logs why).
   */
  private static async getDraftPlan(data: {
    projectId: ObjectID;
    incident: Incident;
  }): Promise<PostmortemDraftPlan | null> {
    const plan: PostmortemDraftPlan | null =
      await PostmortemRules.getIncidentDraftPlan(data);

    if (plan && !plan.isInScope) {
      logger.debug(
        `AI: none of the ${plan.rulesChecked} postmortem rules matched incident ${data.incident.id?.toString()}, so no postmortem is drafted.`,
      );
      return null;
    }

    return plan;
  }

  /*
   * What the draft's feed item says of its LLM provider, after the sentence
   * that says what it was drafted from: nothing when no rule picked one;
   * the provider the rule picked; or the one used instead, and why.
   */
  public static describeDraftProvider(data: {
    choice: RuleLlmProviderChoice;
    ruleName: string;
  }): MarkdownText {
    const choice: RuleLlmProviderChoice = data.choice;

    if (!choice.activity) {
      return mdText``;
    }

    const rule: MarkdownText = data.ruleName
      ? mdText`postmortem rule **${data.ruleName}**`
      : mdText`the postmortem rule`;

    if (!choice.fallbackReason && choice.provider) {
      return mdText` It was written with **${choice.provider.name}**, the LLM provider of ${rule}.`;
    }

    // What happened to the rule's provider: "The LLM provider of ... <why>."
    const why: string =
      choice.fallbackReason === LlmProviderFallbackReason.CreditsUsedUp
        ? "runs on AI credits, which are used up"
        : choice.fallbackReason === LlmProviderFallbackReason.SpendLimitReached
          ? "is stopped by the project's daily AI spend limit"
          : "is no longer available";

    if (!choice.provider) {
      return mdText` The LLM provider of ${rule} ${why}.`;
    }

    const used: string =
      choice.source === LlmProviderSource.Global
        ? "the global LLM provider"
        : "the project's default LLM provider";

    return mdText` It was written with **${choice.provider.name}**, ${used}, because the LLM provider of ${rule} ${why}.`;
  }

  /*
   * What the draft was written from, as its feed item says it: the
   * timeline and telemetry always, what was said on the incident's calls
   * when it read a transcript, and the project's AI context when it read
   * one.
   */
  public static describeDraftSources(data: {
    callsRead: number;
    readAiContext: boolean;
  }): string {
    const sources: Array<string> = ["the incident timeline", "telemetry"];

    if (data.callsRead > 0) {
      sources.push("what was said on its calls");
    }

    if (data.readAiContext) {
      sources.push("the project's AI context");
    }

    return `${sources.slice(0, -1).join(", ")} and ${sources[sources.length - 1]}`;
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
    if (incident.showPostmortemOnStatusPage === true) {
      return false;
    }

    return true;
  }

  private static async writeDraft(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    incidentNumber?: number | undefined;
    plan: PostmortemDraftPlan;
  }): Promise<void> {
    const { incidentId, projectId } = data;

    /*
     * The LLM provider the draft is written with: the one the rule that
     * matched picks, else what it falls back to (LlmProviderChoice).
     */
    const llmProviderChoice: RuleLlmProviderChoice =
      await LlmProviderChoice.decideIfPicked({
        projectId,
        pickedProviderId: data.plan.llmProviderId,
      });

    /*
     * The template the draft follows: none (OneUptime AI's standard
     * outline), the matching rule's one template, or the one OneUptime AI
     * picks from its several.
     */
    const template: PostmortemRuleTemplate | null =
      await PostmortemTemplatePick.pick({
        projectId,
        incidentId,
        templates: data.plan.templates,
        llmProviderId: llmProviderChoice.llmProviderId,
      });

    /*
     * The project's AI context (issue #5198): the team's notes on its
     * systems - who owns what, what depends on what - read first by the
     * draft, and named in its feed item as one of what it was written
     * from.
     */
    const aiContext: AiContextActivity | null = await AiContextReader.read({
      projectId,
    });

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
        ...(template ? { template: template.outline } : {}),
        llmProviderId: llmProviderChoice.llmProviderId,
        aiContext,
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

    const sources: string = AIIncidentPostmortemRunner.describeDraftSources({
      callsRead,
      readAiContext: aiContext !== null,
    });

    // The template the draft followed, by name, when it followed one.
    const followed: MarkdownText = template
      ? mdText`, following the postmortem template **${template.name || "Unnamed template"}**`
      : mdText``;

    // The LLM provider a postmortem rule picked, or why another wrote it.
    const writtenWith: MarkdownText =
      AIIncidentPostmortemRunner.describeDraftProvider({
        choice: llmProviderChoice,
        ruleName: data.plan.rule?.name || "",
      });

    await IncidentFeedService.createIncidentFeedItem({
      incidentId,
      projectId,
      incidentFeedEventType: IncidentFeedEventType.PostmortemNote,
      displayColor: Blue500,
      feedInfoInMarkdown:
        mdText`## 🧠 AI — Draft Postmortem\n\nOneUptime AI drafted a postmortem for incident #${data.incidentNumber} from ${sources}${followed}.${writtenWith} It has been saved on the incident for you to review and edit.`.toString(),
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
