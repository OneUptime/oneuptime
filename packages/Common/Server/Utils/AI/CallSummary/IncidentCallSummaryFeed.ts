import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import { Indigo500 } from "../../../../Types/BrandColors";
import {
  CallSummary,
  CallSummaryAction,
  CallSummaryBasis,
  CallSummaryFinding,
  CallSummaryFindingKind,
  CallSummaryPoint,
  CallSummaryRootCauseOutcome,
} from "../../../../Types/VideoCall/CallSummary";
import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import TranscriptText from "../../../../Utils/VideoCall/TranscriptText";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import logger, { LogAttributes } from "../../Logger";

/*
 * WHAT ONEUPTIME AI READ IN A CALL, IN THE INCIDENT'S FEED.
 *
 * When OneUptime AI has read a call's transcript, what it read goes to the
 * incident's feed - and from there to the incident's Slack and Microsoft
 * Teams channels, like the incident's other updates - so the people on the
 * incident see what the call settled without opening its page: the cause
 * the call points at, marked as a suggestion until a responder uses it,
 * what was found (confirmed on the call, or a hypothesis), what was tried
 * and decided, the follow-ups and what is still open. The sections carry
 * the AI Investigation card's own names for them.
 *
 * The channels get the feed item's own text, so the summary is that text.
 * The quoted lines stay on the incident's page, with the transcript, and
 * so does the decision about the suggested cause (Use as root cause,
 * Dismiss).
 *
 * Everything in it is somebody's text: OneUptime AI wrote the sentences, a
 * person on the call is named as a follow-up's owner. Each is placed as
 * text, with words the model wrote in backticks as code
 * (FeedMarkdown.textWithCode), so nothing in it becomes a link, an image,
 * a mention or markup.
 */

export const CALL_SUMMARY_FEED_SECTIONS: {
  confirmed: string;
  hypotheses: string;
  stepsTried: string;
  decisions: string;
  actions: string;
  openQuestions: string;
} = {
  confirmed: "Confirmed on the call",
  hypotheses: "Hypotheses",
  stepsTried: "What was tried",
  decisions: "Decisions",
  actions: "Follow-ups",
  openQuestions: "Open questions",
};

export default class IncidentCallSummaryFeed {
  /*
   * The feed item's text: who read what, the cause, then each part of the
   * summary that has something in it.
   */
  public static getFeedMarkdown(data: {
    // "Zoom meeting", or a link's own title.
    callLabel: string;
    summary: CallSummary;
    // "42 minutes, 5 speakers, 312 remarks"
    details?: string | undefined;
  }): MarkdownText {
    const summary: CallSummary = data.summary;
    const blocks: Array<MarkdownText> = [
      data.details
        ? mdText`✨ OneUptime AI read the transcript of the **${data.callLabel}** (${data.details}).`
        : mdText`✨ OneUptime AI read the transcript of the **${data.callLabel}**.`,
      IncidentCallSummaryFeed.getRootCauseMarkdown(summary),
    ];

    const findings: Array<CallSummaryFinding> = summary.findings;

    IncidentCallSummaryFeed.addSection(
      blocks,
      CALL_SUMMARY_FEED_SECTIONS.confirmed,
      findings.filter((finding: CallSummaryFinding): boolean => {
        return finding.kind === CallSummaryFindingKind.Confirmed;
      }),
    );
    IncidentCallSummaryFeed.addSection(
      blocks,
      CALL_SUMMARY_FEED_SECTIONS.hypotheses,
      findings.filter((finding: CallSummaryFinding): boolean => {
        return finding.kind !== CallSummaryFindingKind.Confirmed;
      }),
    );
    IncidentCallSummaryFeed.addSection(
      blocks,
      CALL_SUMMARY_FEED_SECTIONS.stepsTried,
      summary.stepsTried,
    );
    IncidentCallSummaryFeed.addSection(
      blocks,
      CALL_SUMMARY_FEED_SECTIONS.decisions,
      summary.decisions,
    );

    if (summary.actions.length > 0) {
      blocks.push(
        mdText`**${CALL_SUMMARY_FEED_SECTIONS.actions}**
${FeedMarkdown.bulletList(
  summary.actions.map((action: CallSummaryAction): MarkdownValue => {
    return action.owner
      ? mdText`${FeedMarkdown.textWithCode(action.text)} (${action.owner})`
      : FeedMarkdown.textWithCode(action.text);
  }),
)}`,
      );
    }

    IncidentCallSummaryFeed.addSection(
      blocks,
      CALL_SUMMARY_FEED_SECTIONS.openQuestions,
      summary.openQuestions,
    );

    return FeedMarkdown.join(blocks, "\n\n");
  }

  /*
   * The cause: OneUptime AI's suggestion, marked as one and as said on the
   * call or inferred, with where it is used or dismissed - or that the call
   * did not discuss it enough.
   */
  public static getRootCauseMarkdown(summary: CallSummary): MarkdownText {
    if (
      summary.rootCause.outcome !== CallSummaryRootCauseOutcome.Suggested ||
      !summary.rootCause.summary
    ) {
      return mdText`**Root cause:** not enough was said on the call to suggest one.`;
    }

    const basis: string =
      summary.rootCause.basis === CallSummaryBasis.StatedOnCall
        ? "Stated on the call"
        : "Inferred from the discussion";

    return mdText`**Suggested root cause** (not confirmed): ${FeedMarkdown.textWithCode(summary.rootCause.summary)}

${basis}. Use it as the incident's root cause, or dismiss it, on the incident's page.`;
  }

  /*
   * Posts what was read to the incident's feed and channels. Never throws:
   * the reading is stored either way, and the card shows it.
   */
  public static async post(data: {
    call: Pick<
      IncidentVideoCall,
      "projectId" | "incidentId" | "transcriptInfo"
    >;
    callLabel: string;
    summary: CallSummary;
  }): Promise<void> {
    try {
      const info: ReturnType<typeof TranscriptText.readInfo> =
        TranscriptText.readInfo(data.call.transcriptInfo);

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: data.call.incidentId!,
        projectId: data.call.projectId!,
        incidentFeedEventType: IncidentFeedEventType.VideoCallSummary,
        displayColor: Indigo500,
        feedInfoInMarkdown: IncidentCallSummaryFeed.getFeedMarkdown({
          callLabel: data.callLabel,
          summary: data.summary,
          details: info ? TranscriptText.describeInfo(info) : undefined,
        }).toString(),
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    } catch (error) {
      logger.error(
        `Could not post what OneUptime AI read in a call to the incident's feed: ${error}`,
        {
          projectId: data.call.projectId?.toString(),
          incidentId: data.call.incidentId?.toString(),
        } as LogAttributes,
      );
    }
  }

  private static addSection(
    blocks: Array<MarkdownText>,
    title: string,
    points: ReadonlyArray<CallSummaryPoint>,
  ): void {
    if (points.length === 0) {
      return;
    }

    blocks.push(
      mdText`**${title}**
${FeedMarkdown.bulletList(
  points.map((point: CallSummaryPoint): MarkdownValue => {
    return FeedMarkdown.textWithCode(point.text);
  }),
)}`,
    );
  }
}
