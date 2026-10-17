import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import {
  CallSummary,
  CallSummaryAction,
  CallSummaryBasis,
  CallSummaryCitation,
  CallSummaryFinding,
  CallSummaryFindingKind,
  CallSummaryPoint,
  CallSummaryRootCauseOutcome,
  CallSummaryStatus,
  RootCauseSuggestionStatus,
  readCallSummary,
} from "../../../../Types/VideoCall/CallSummary";
import { getVideoCallLabel } from "../../../../Types/VideoCall/VideoCallProvider";
import QueryHelper from "../../../Types/Database/QueryHelper";
import IncidentVideoCallService from "../../../Services/IncidentVideoCallService";
import TranscriptText, {
  TranscriptLine,
} from "../../../../Utils/VideoCall/TranscriptText";
import logger from "../../Logger";
import ToolResultSerializer from "../Toolbox/Serializer";

/*
 * WHAT THE INCIDENT'S CALLS SAID, FOR A POSTMORTEM DRAFT.
 *
 * The postmortem OneUptime AI drafts reads the incident's record - its
 * timeline, notes and channel - and, with this, its calls: for each call
 * with a transcript, what OneUptime AI read in it, cause first and marked
 * for what it is - suggested by AI and not confirmed, used as the root cause
 * by a responder, or dismissed - so the draft can tell a confirmed cause
 * from a hypothesis. A call whose transcript has not been read (AI was off
 * when it was added, or the reading failed) gives its transcript instead,
 * held to a length like the channel's messages.
 */

// About as much as the incident's channel gets.
export const MAX_TRANSCRIPT_IN_POSTMORTEM_CHARACTERS: number = 30_000;

// Calls an incident has at most, read for a draft.
const MAX_CALLS: number = 20;

export interface IncidentCallForPrompt {
  callLabel: string;
  details: string;
  summary: CallSummary | null;
  suggestionStatus?: RootCauseSuggestionStatus | undefined;
  // Only when there is no summary to give instead.
  transcriptLines?: Array<TranscriptLine> | undefined;
}

export default class CallSummaryContext {
  /*
   * The incident's calls that have a transcript, oldest first. Never throws:
   * a draft goes ahead without its calls rather than not at all.
   */
  public static async readForIncident(
    incidentId: ObjectID,
  ): Promise<Array<IncidentCallForPrompt>> {
    try {
      const calls: Array<IncidentVideoCall> =
        await IncidentVideoCallService.findBy({
          query: {
            incidentId,
            transcriptAddedAt: QueryHelper.notNull(),
          },
          select: {
            _id: true,
            provider: true,
            title: true,
            transcript: true,
            transcriptInfo: true,
            callSummary: true,
            callSummaryStatus: true,
            rootCauseSuggestionStatus: true,
            videoCallConnection: { name: true },
          },
          sort: { createdAt: SortOrder.Ascending },
          skip: 0,
          limit: MAX_CALLS,
          props: { isRoot: true },
        });

      return calls
        .filter((call: IncidentVideoCall): boolean => {
          return Boolean(call.transcript && call.transcript.trim());
        })
        .map((call: IncidentVideoCall): IncidentCallForPrompt => {
          const summary: CallSummary | null =
            call.callSummaryStatus === CallSummaryStatus.Ready
              ? readCallSummary(call.callSummary)
              : null;
          const lines: Array<TranscriptLine> = TranscriptText.deserialize(
            call.transcript,
          );

          const forPrompt: IncidentCallForPrompt = {
            callLabel: getVideoCallLabel({
              provider: call.provider,
              title: call.title,
              connectionName: call.videoCallConnection?.name,
            }),
            details: TranscriptText.describeInfo(
              TranscriptText.readInfo(call.transcriptInfo) ||
                TranscriptText.getInfo(lines),
            ),
            summary,
            suggestionStatus: call.rootCauseSuggestionStatus,
          };

          if (!summary) {
            forPrompt.transcriptLines = lines;
          }

          return forPrompt;
        });
    } catch (error) {
      logger.debug(
        `Writing the postmortem draft without the incident's calls: ${error}`,
      );
      return [];
    }
  }

  // The calls as a section of the draft's incident data; "" for none.
  public static formatForPrompt(calls: Array<IncidentCallForPrompt>): string {
    if (calls.length === 0) {
      return "";
    }

    let text: string = "# Incident Calls\n\n";
    let transcriptBudget: number = MAX_TRANSCRIPT_IN_POSTMORTEM_CHARACTERS;

    for (const call of calls) {
      text += `## ${call.callLabel} (${call.details})\n\n`;

      if (call.summary) {
        text += CallSummaryContext.formatSummary(call.summary, {
          suggestionStatus: call.suggestionStatus,
        });
        continue;
      }

      const transcript: { text: string; used: number } =
        CallSummaryContext.formatTranscript(
          call.transcriptLines || [],
          transcriptBudget,
        );

      transcriptBudget -= transcript.used;
      text += transcript.text;
    }

    return text;
  }

  private static formatSummary(
    summary: CallSummary,
    options: { suggestionStatus?: RootCauseSuggestionStatus | undefined },
  ): string {
    let text: string = "What OneUptime AI read in the call's transcript:\n\n";

    if (summary.rootCause.outcome === CallSummaryRootCauseOutcome.Suggested) {
      const standing: string =
        options.suggestionStatus === RootCauseSuggestionStatus.Accepted
          ? "used as the root cause by a responder"
          : options.suggestionStatus === RootCauseSuggestionStatus.Dismissed
            ? "dismissed by a responder: do not present it as the cause"
            : "suggested by AI, not confirmed by a responder: a hypothesis";
      const basis: string =
        summary.rootCause.basis === CallSummaryBasis.StatedOnCall
          ? "stated on the call"
          : "inferred from the discussion";

      text += `- Root cause from the call (${standing}; ${basis}): ${summary.rootCause.summary || ""}\n`;
      text += CallSummaryContext.formatCitations(summary.rootCause.citations);
    } else {
      text +=
        "- Root cause: the call did not discuss what caused the incident enough to tell.\n";
    }

    text += CallSummaryContext.formatFindings(summary.findings);
    text += CallSummaryContext.formatPoints("Steps tried", summary.stepsTried);
    text += CallSummaryContext.formatPoints("Decisions", summary.decisions);
    text += CallSummaryContext.formatPoints(
      "Follow-up actions",
      summary.actions.map((action: CallSummaryAction): CallSummaryPoint => {
        return {
          text: action.owner
            ? `${action.text} (owner: ${action.owner})`
            : action.text,
          citations: action.citations,
        };
      }),
    );
    text += CallSummaryContext.formatPoints(
      "Open questions",
      summary.openQuestions,
    );

    return `${text}\n`;
  }

  private static formatFindings(findings: Array<CallSummaryFinding>): string {
    if (findings.length === 0) {
      return "";
    }

    let text: string = "- Findings:\n";

    for (const finding of findings) {
      text += `  - (${finding.kind === CallSummaryFindingKind.Confirmed ? "confirmed on the call" : "hypothesis"}) ${finding.text}\n`;
    }

    return text;
  }

  private static formatPoints(
    title: string,
    points: Array<CallSummaryPoint>,
  ): string {
    if (points.length === 0) {
      return "";
    }

    let text: string = `- ${title}:\n`;

    for (const point of points) {
      text += `  - ${point.text}\n`;
    }

    return text;
  }

  private static formatCitations(citations: Array<CallSummaryCitation>): string {
    return citations
      .map((citation: CallSummaryCitation): string => {
        const line: string = TranscriptText.toReadableLine({
          offsetInSeconds: undefined,
          speaker: citation.speaker,
          text: citation.text,
        });

        return `  - ${citation.time ? `[${citation.time}] ` : ""}${ToolResultSerializer.redactAndOmitEmbeddedData(line).text}\n`;
      })
      .join("");
  }

  // The transcript itself, redacted, up to `budget` characters.
  private static formatTranscript(
    lines: Array<TranscriptLine>,
    budget: number,
  ): { text: string; used: number } {
    const leftOut: { text: string; used: number } = {
      text: "(The transcript is left out: the calls above used the space for transcripts.)\n\n",
      used: 0,
    };

    if (budget <= 0) {
      return leftOut;
    }

    let text: string = "The call's transcript (OneUptime AI has not read it):\n\n";
    let used: number = 0;
    let included: number = 0;

    for (const line of lines) {
      const written: string = `${ToolResultSerializer.redactAndOmitEmbeddedData(TranscriptText.toReadableLine(line)).text}\n`;

      if (used + written.length > budget) {
        break;
      }

      text += written;
      used += written.length;
      included++;
    }

    // Not one line fits in what the calls above left.
    if (included === 0 && lines.length > 0) {
      return leftOut;
    }

    if (included < lines.length) {
      text += `(…the last ${lines.length - included} of ${lines.length} lines are left out.)\n`;
    }

    return { text: `${text}\n`, used };
  }
}
