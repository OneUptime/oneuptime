import Alert from "../../../Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import { AiRemediationCommandPlanUtil } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { ExternalMcpToolCallPlanUtil } from "../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Indigo500 } from "../../../Types/BrandColors";
import PartialEntity from "../../../Types/Database/PartialEntity";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  buildVerifiedFixRunbook,
  getUniqueRunbookName,
  getVerifiedFixRunbookRefusal,
  VERIFIED_FIX_RUNBOOK_REFUSAL_MESSAGES,
  VerifiedFixRunbookDraft,
  VerifiedFixRunbookInput,
  VerifiedFixRunbookRefusal,
} from "../../../Utils/AiRemediation/VerifiedFixRunbook";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import AlertFeedService from "../../Services/AlertFeedService";
import AlertService from "../../Services/AlertService";
import AutoRemediationSuggestionService from "../../Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../Services/IncidentFeedService";
import IncidentService from "../../Services/IncidentService";
import RunbookService from "../../Services/RunbookService";
import QueryHelper from "../../Types/Database/QueryHelper";
import ServerSetColumns from "../Database/ServerSetColumns";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { findAccessibleSuggestion } from "./RemediationApproval";

/*
 * SAVE A VERIFIED FIX AS A RUNBOOK (issue #6801): the fix's card on an
 * incident or an alert writes down what OneUptime AI ran - and what worked -
 * as a runbook the team reviews and reuses (VerifiedFixRunbook).
 *
 * As the person asking:
 *
 *   - they read the fix (findAccessibleSuggestion: "not found" and "not
 *     yours" read alike);
 *   - the fix was verified, ran its own commands or MCP calls (not a
 *     runbook), and is not saved yet - the card's offer asks the same
 *     refusal (VerifiedFixRunbookSuggestion);
 *   - the runbook is created with their permissions, so whoever may not
 *     create runbooks is refused as on the Runbooks page, and it is theirs.
 *
 * The runbook starts turned off and names where it comes from. The fix
 * then names it (savedAsRunbookId, OneUptime's to write), so the card links
 * to it instead of offering a second one, and the subject's feed says it
 * was saved. Its name is the fix's, made unique in the project.
 */

export interface VerifiedFixRunbookSaved {
  runbookId: ObjectID;
  runbookName: string;
}

// The most runbooks read to make a name unique: names that start the same.
const MAX_SIMILAR_NAMES: number = 1000;

export default class VerifiedFixRunbookSave {
  @CaptureSpan()
  public static async save(data: {
    props: DatabaseCommonInteractionProps;
    suggestionId: unknown;
  }): Promise<VerifiedFixRunbookSaved> {
    const suggestionId: ObjectID = await findAccessibleSuggestion(
      data.suggestionId,
      data.props,
    );

    const suggestion: AutoRemediationSuggestion | null =
      await AutoRemediationSuggestionService.findOneById({
        id: suggestionId,
        select: {
          _id: true,
          projectId: true,
          incidentId: true,
          alertId: true,
          suggestionType: true,
          verificationStatus: true,
          commandPlan: true,
          mcpToolCallPlan: true,
          savedAsRunbookId: true,
        },
        props: { isRoot: true },
      });

    if (!suggestion || !suggestion.projectId) {
      throw new BadDataException(
        "Auto-remediation suggestion not found (or you do not have access to it).",
      );
    }

    const input: VerifiedFixRunbookInput = {
      suggestionType: suggestion.suggestionType,
      verificationStatus: suggestion.verificationStatus,
      commandPlan: AiRemediationCommandPlanUtil.parse(suggestion.commandPlan),
      mcpToolCallPlan: ExternalMcpToolCallPlanUtil.parse(
        suggestion.mcpToolCallPlan,
      ),
      savedAsRunbookId: suggestion.savedAsRunbookId?.toString(),
      subject: await VerifiedFixRunbookSave.readSubject(suggestion),
    };

    const refusal: VerifiedFixRunbookRefusal | null =
      getVerifiedFixRunbookRefusal(input);

    if (refusal) {
      throw new BadDataException(
        VERIFIED_FIX_RUNBOOK_REFUSAL_MESSAGES[refusal],
      );
    }

    const draft: VerifiedFixRunbookDraft = buildVerifiedFixRunbook(input);

    const similar: Array<Runbook> = await RunbookService.findBy({
      query: {
        projectId: suggestion.projectId,
        name: QueryHelper.startsWith(draft.name),
      },
      select: { name: true },
      skip: 0,
      limit: MAX_SIMILAR_NAMES,
      props: { isRoot: true },
    });

    const runbook: Runbook = new Runbook();
    runbook.projectId = suggestion.projectId;
    runbook.name = getUniqueRunbookName(
      draft.name,
      similar.map((existing: Runbook): string => {
        return existing.name || "";
      }),
    );
    runbook.description = draft.description;
    /*
     * The steps are OneUptime's - what its verified fix ran, written down -
     * not the person's, and marked so: whoever may create a runbook may save
     * the fix, though writing steps that run takes permission to change
     * runbooks (RunbookService.assertMayWriteStepsThatRun), because the
     * runbook starts turned off.
     */
    ServerSetColumns.set(runbook, {
      steps: draft.steps as unknown as JSONArray,
    });
    // A draft: nobody runs it, and OneUptime AI never picks it, until it is reviewed and turned on.
    runbook.isEnabled = false;

    const created: Runbook = await RunbookService.create({
      data: runbook,
      props: data.props,
    });

    if (!created.id) {
      throw new BadDataException(
        "The runbook was not saved. Try again in a moment.",
      );
    }

    await AutoRemediationSuggestionService.updateColumnsByIdWithoutHooks({
      id: suggestionId,
      data: {
        savedAsRunbookId: created.id,
      } as unknown as PartialEntity<AutoRemediationSuggestion>,
    });

    await VerifiedFixRunbookSave.postFeedItem({
      suggestion,
      runbookName: runbook.name,
      userId: data.props.userId,
    });

    return { runbookId: created.id, runbookName: runbook.name };
  }

  // The incident or alert the fix was for, as the runbook names it.
  private static async readSubject(
    suggestion: AutoRemediationSuggestion,
  ): Promise<VerifiedFixRunbookInput["subject"]> {
    if (suggestion.incidentId) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: suggestion.incidentId,
        select: {
          title: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        },
        props: { isRoot: true },
      });

      return {
        kind: "incident",
        handle:
          incident?.incidentNumberWithPrefix ||
          (incident?.incidentNumber !== undefined &&
          incident?.incidentNumber !== null
            ? `#${incident.incidentNumber.toString()}`
            : ""),
        title: incident?.title || "",
      };
    }

    if (suggestion.alertId) {
      const alert: Alert | null = await AlertService.findOneById({
        id: suggestion.alertId,
        select: {
          title: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
        },
        props: { isRoot: true },
      });

      return {
        kind: "alert",
        handle:
          alert?.alertNumberWithPrefix ||
          (alert?.alertNumber !== undefined && alert?.alertNumber !== null
            ? `#${alert.alertNumber.toString()}`
            : ""),
        title: alert?.title || "",
      };
    }

    return { kind: "incident", handle: "", title: "" };
  }

  // Best effort: the runbook is saved whatever the feed says.
  private static async postFeedItem(data: {
    suggestion: AutoRemediationSuggestion;
    runbookName: string;
    userId: ObjectID | undefined;
  }): Promise<void> {
    const markdown: string =
      mdText`📘 Saved OneUptime AI's verified fix as the runbook **${data.runbookName}**. It stays off until someone reviews its steps and turns it on.`.toString();

    try {
      if (data.suggestion.incidentId && data.suggestion.projectId) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.suggestion.incidentId,
          projectId: data.suggestion.projectId,
          incidentFeedEventType: IncidentFeedEventType.AutoRemediation,
          displayColor: Indigo500,
          feedInfoInMarkdown: markdown,
          userId: data.userId,
          workspaceNotification: {
            sendWorkspaceNotification: false,
            leadWithAuthor: true,
          },
        });
      } else if (data.suggestion.alertId && data.suggestion.projectId) {
        await AlertFeedService.createAlertFeedItem({
          alertId: data.suggestion.alertId,
          projectId: data.suggestion.projectId,
          alertFeedEventType: AlertFeedEventType.AutoRemediation,
          displayColor: Indigo500,
          feedInfoInMarkdown: markdown,
          userId: data.userId,
          workspaceNotification: {
            sendWorkspaceNotification: false,
            leadWithAuthor: true,
          },
        });
      }
    } catch (error) {
      logger.error(
        `VerifiedFixRunbookSave: could not post the saved runbook to the feed of fix ${data.suggestion.id?.toString() || ""}:`,
      );
      logger.error(error);
    }
  }
}
